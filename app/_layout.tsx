import React, { useState, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { Slot } from "expo-router";
import { loadConfig, saveConfig, loadPassphrase } from "../src/utils/config";
import { setDataRoot, fileExists } from "../src/utils/filesystem";
import { initLlmClient, getClient } from "../src/modules/llm";
import { setRouterClient } from "../src/modules/router";
import { setTriageClient } from "../src/modules/triage";
import { deriveKey, cacheKey, hasKey, setEncryptionEnabled, verifyKey, getCachedKey } from "../src/utils/crypto";
import { getDataRoot } from "../src/utils/filesystem";
import { loadState } from "../src/modules/loader";
import { readVault, writeVault } from "../src/utils/vault";
import { themes } from "../src/constants/themes";
import type { Theme } from "../src/constants/themes";
import type { AppConfig, ThemeMode } from "../src/types";

export const ConfigContext = React.createContext<{
  config: AppConfig | null;
  setConfig: (c: AppConfig) => void;
  theme: Theme;
  toggleTheme: () => void;
}>({
  config: null,
  setConfig: () => {},
  theme: themes.dark,
  toggleTheme: () => {},
});

export default function RootLayout() {
  const [config, setConfigState] = useState<AppConfig | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [loading, setLoading] = useState(true);
  const [needsPassphrase, setNeedsPassphrase] = useState(false);
  const [passphraseInput, setPassphraseInput] = useState("");
  const [passphraseError, setPassphraseError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [smokeTestError, setSmokeTestError] = useState<string | null>(null);

  const theme = themes[themeMode];

  useEffect(() => {
    loadConfig().then(async (c) => {
      if (c) {
        applyConfig(c);
        setConfigState(c);
        setThemeMode(c.theme || "dark");

        // Handle encryption unlock (only on platforms where THIS process
        // does the decrypting — on web the proxy does it).
        if (c.encryptionEnabled && c.encryptionSalt) {
          if (c.passphraseInSecureStore) {
            // Try auto-unlock from secure store
            const stored = await loadPassphrase();
            if (stored) {
              const key = await deriveKey(stored, c.encryptionSalt);
              const valid = await verifyKey(key, getDataRoot());
              if (valid) {
                cacheKey(key);
                setEncryptionEnabled(true);
                ensureVaultFile(c.encryptionSalt);
              } else {
                // Stored passphrase is wrong (corrupted secure store?)
                setNeedsPassphrase(true);
                setLoading(false);
                return;
              }
            } else {
              setNeedsPassphrase(true);
              setLoading(false);
              return;
            }
          } else {
            setNeedsPassphrase(true);
            setLoading(false);
            return;
          }
        }

        // Bug 10 (post-fix): smoke-test runs UNCONDITIONALLY after config
        // is applied, regardless of whether encryption was set up locally.
        // On web mode the browser doesn't do encryption — the proxy does
        // — so we still need to verify that loadState() actually returns
        // real data (not just that it doesn't throw). A successful
        // loadState that returned all defaults is just as bad as a
        // failure: both result in an empty app that wipes on next flush.
        const ok = await runLoadSmokeTest();
        if (!ok) {
          setLoading(false);
          return;
        }
      }
      setLoading(false);
    });
  }, []);

  /**
   * Smoke-test the data folder by running a full loadState().
   *
   * Two failure modes are caught:
   *   1. loadState() throws (read/decrypt/parse failure on existing files)
   *      — the loader's aggregated error tells us exactly which files broke.
   *   2. loadState() succeeds but returns all-defaults state when sensitive
   *      files actually exist on disk. This is "loaded with wrong path or
   *      wrong key, but every read returned null and the loader silently
   *      used defaults" — which would render an empty app and overwrite
   *      real data on the next flush. Fail loud.
   *
   * Either failure surfaces to the recovery screen and prevents tabs from
   * rendering. The user has to fix the underlying problem before the app
   * starts — much better than silently rendering empty state.
   */
  async function runLoadSmokeTest(): Promise<boolean> {
    let state;
    try {
      state = await loadState();
    } catch (err: any) {
      console.error("[layout] smoke-test load THREW:", err?.message);
      setSmokeTestError(
        "loadState() threw:\n\n" + (err?.message || String(err))
      );
      return false;
    }

    // Heuristic: if the loader reported zero loaded counts for ALL
    // collection-shaped files, we either have a brand-new install (legit)
    // or we're loading from the wrong place / with the wrong key. Probe
    // for at least one sensitive file on disk to disambiguate. If files
    // exist but nothing loaded, that's a smoke test failure.
    const counts = state._loadedCounts || {};
    const totalLoaded = Object.values(counts).reduce<number>(
      (sum, n) => sum + (typeof n === "number" ? n : 0),
      0
    );
    if (totalLoaded === 0) {
      // Probe — does at least one key sensitive file exist on disk?
      // If yes → app loaded empty over real data → fail.
      // If no → genuinely first run → allow.
      try {
        const tasksExist = await fileExists("tasks.json");
        const calendarExist = await fileExists("calendar.json");
        if (tasksExist || calendarExist) {
          console.error(
            "[layout] smoke-test: data files EXIST on disk but loader returned all-empty state. " +
            "Refusing to render — this is the symptom of wrong path / wrong key / proxy down."
          );
          setSmokeTestError(
            "Data files exist on disk but the app loaded an empty state. " +
            "This usually means one of:\n\n" +
            "  • The data folder path in your app config doesn't match where the files actually are.\n" +
            "  • The api-proxy isn't running (Web mode requires the proxy).\n" +
            "  • The encryption passphrase doesn't match the proxy's.\n\n" +
            "Refusing to render the app to prevent overwriting real data with empty defaults."
          );
          return false;
        }
      } catch (err: any) {
        console.warn("[layout] smoke-test: fileExists probe failed:", err?.message);
        // Non-fatal: if the existence probe itself fails, we conservatively
        // ALLOW the app to render. The shrinkage guard in flush() will
        // still catch any subsequent destructive write.
      }
    }
    return true;
  }

  // Background migration: if config has a salt but the data folder has no
  // _vault.json, materialize one. This makes every existing install's data
  // folder portable on first launch after the upgrade — copying the folder
  // to another device will then "just work" (the wizard detects the vault).
  // Errors are non-fatal; we log and move on. The user can also trigger
  // this manually from the Vault Recovery screen.
  async function ensureVaultFile(salt: string): Promise<void> {
    try {
      if (!hasKey()) return;
      const existing = await readVault(getDataRoot());
      if (existing) return; // already present, nothing to do
      await writeVault(getDataRoot(), getCachedKey(), salt);
    } catch (err: any) {
      console.warn("[layout] vault auto-migration failed:", err?.message);
    }
  }

  function setConfig(c: AppConfig) {
    applyConfig(c);
    setConfigState(c);
    setThemeMode(c.theme || "dark");
  }

  function toggleTheme() {
    const newMode: ThemeMode = themeMode === "dark" ? "light" : "dark";
    setThemeMode(newMode);
    if (config) {
      const updated = { ...config, theme: newMode };
      setConfigState(updated);
      saveConfig(updated);
    }
  }

  async function handleUnlock() {
    if (!passphraseInput.trim() || !config?.encryptionSalt) return;
    setUnlocking(true);
    setPassphraseError("");
    try {
      const key = await deriveKey(passphraseInput.trim(), config.encryptionSalt);
      const valid = await verifyKey(key, getDataRoot());
      if (!valid) {
        setPassphraseError("Wrong passphrase. Please try again.");
        setUnlocking(false);
        return;
      }
      cacheKey(key);
      setEncryptionEnabled(true);
      ensureVaultFile(config.encryptionSalt);
      // Bug 10: smoke-test before clearing the unlock screen
      const ok = await runLoadSmokeTest();
      if (!ok) {
        setUnlocking(false);
        return;
      }
      setNeedsPassphrase(false);
      setPassphraseInput("");
    } catch {
      setPassphraseError("Could not derive key. Please try again.");
    }
    setUnlocking(false);
  }

  if (loading) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.bg }]}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  // Bug 10: smoke-test failed — refuse to render tabs. Show a recovery
  // screen with the failure detail so the user can investigate before any
  // periodic flush has a chance to overwrite real data with empty defaults.
  if (smokeTestError) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.bg }]}>
        <View style={styles.unlockCard}>
          <Text style={styles.unlockTitle}>Data load failed</Text>
          <Text style={styles.unlockBody}>
            One or more sensitive data files exist on disk but could not be
            read or decrypted. The app will not start in this state because
            doing so could overwrite real data with empty defaults.{"\n\n"}
            Check your data folder and backups, then restart the app.
          </Text>
          <Text style={[styles.unlockError, { marginTop: 12 }]} numberOfLines={20}>
            {smokeTestError}
          </Text>
        </View>
      </View>
    );
  }

  if (needsPassphrase) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.bg }]}>
        <View style={styles.unlockCard}>
          <Text style={styles.unlockTitle}>Unlock your data</Text>
          <Text style={styles.unlockBody}>
            Enter your encryption passphrase to continue.
          </Text>
          <TextInput
            style={styles.unlockInput}
            value={passphraseInput}
            onChangeText={setPassphraseInput}
            placeholder="Passphrase"
            placeholderTextColor="#555"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            onSubmitEditing={handleUnlock}
          />
          {passphraseError !== "" && (
            <Text style={styles.unlockError}>{passphraseError}</Text>
          )}
          <TouchableOpacity
            style={[styles.unlockBtn, (!passphraseInput.trim() || unlocking) && { opacity: 0.4 }]}
            onPress={handleUnlock}
            disabled={!passphraseInput.trim() || unlocking}
          >
            <Text style={styles.unlockBtnText}>
              {unlocking ? "Unlocking..." : "Unlock"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ConfigContext.Provider value={{ config, setConfig, theme, toggleTheme }}>
      <Slot />
    </ConfigContext.Provider>
  );
}

function applyConfig(c: AppConfig) {
  setDataRoot(c.dataFolderPath);
  initLlmClient(c.anthropicApiKey);
  const llmClient = getClient();
  if (llmClient) {
    setRouterClient(llmClient);
    setTriageClient(llmClient);
  }
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  unlockCard: {
    width: "90%",
    maxWidth: 380,
    padding: 24,
  },
  unlockTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
  },
  unlockBody: {
    color: "#aaa",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  unlockInput: {
    backgroundColor: "#1e1e1e",
    color: "#fff",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#333",
  },
  unlockError: {
    color: "#e55",
    fontSize: 13,
    marginBottom: 12,
  },
  unlockBtn: {
    backgroundColor: "#1a73e8",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  unlockBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
