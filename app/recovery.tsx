/**
 * Vault Recovery screen.
 *
 * Shows the salt (recovery code) for the current vault, so the user can
 * write it down or transfer it to another device when restoring an
 * orphaned data folder (no _vault.json present).
 *
 * Also exposes a "Write vault file now" action that materializes the
 * vault file in the data folder using the in-memory salt and key. This
 * is the auto-migration path triggered manually — useful when the user
 * just upgraded and wants to make their existing data folder portable.
 */

import React, { useContext, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { ConfigContext } from "./_layout";
import { getDataRoot, getCapacitorDirectory } from "../src/utils/filesystem";
import { getCachedKey, hasKey } from "../src/utils/crypto";
import { readVault, writeVault } from "../src/utils/vault";

export default function RecoveryScreen() {
  const { config, theme } = useContext(ConfigContext);
  const router = useRouter();

  const [vaultExists, setVaultExists] = useState<boolean | null>(null);
  const [vaultSalt, setVaultSalt] = useState<string>("");
  const [writing, setWriting] = useState(false);
  const [writeMessage, setWriteMessage] = useState("");
  const [folderListing, setFolderListing] = useState<string[] | null>(null);
  const [folderListError, setFolderListError] = useState<string>("");

  const configSalt = config?.encryptionSalt ?? "";
  const encryptionEnabled = config?.encryptionEnabled === true;
  const dataFolder = config?.dataFolderPath ?? "(unknown)";
  const keyLoaded = hasKey();

  // Prefer the salt from the vault file on disk over AppConfig. The vault
  // file is the canonical source: it's what travels with the data and what
  // the api-proxy writes when encryption is configured via .env. AppConfig's
  // salt only exists if the in-app setup wizard ran with encryption enabled.
  const salt = vaultSalt || configSalt;
  const saltSource: "vault" | "config" | "none" = vaultSalt
    ? "vault"
    : configSalt
      ? "config"
      : "none";

  useEffect(() => {
    (async () => {
      try {
        const v = await readVault(getDataRoot());
        if (v) {
          setVaultExists(true);
          setVaultSalt(v.salt);
        } else {
          setVaultExists(false);
        }
      } catch {
        setVaultExists(false);
      }
    })();
  }, []);

  // Diagnostic: list whatever Capacitor actually sees at the data folder path.
  // Uses getDataRoot() (normalized) and getCapacitorDirectory() (which picks
  // ExternalStorage vs Documents based on whether the user provided an
  // absolute /storage/emulated/* path).
  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS === "web") {
          setFolderListError("(file listing only works on mobile)");
          return;
        }
        const { Filesystem } = await import("@capacitor/filesystem");
        const directory = await getCapacitorDirectory();
        const root = getDataRoot().replace(/\/+$/, "");
        const result = await Filesystem.readdir({
          path: root,
          directory,
        });
        const names = result.files
          .map((f) => (f.type === "directory" ? f.name + "/" : f.name))
          .sort();
        setFolderListing(names);
      } catch (err: any) {
        setFolderListError(err?.message || "Could not list folder contents");
      }
    })();
  }, [config?.dataFolderPath]);

  async function copyToClipboard(text: string) {
    try {
      // Web Clipboard API is available in browsers and Capacitor webviews.
      if (typeof navigator !== "undefined" && (navigator as any).clipboard?.writeText) {
        await (navigator as any).clipboard.writeText(text);
        Alert.alert("Copied", "Recovery code copied to clipboard.");
        return;
      }
      Alert.alert(
        "Copy unavailable",
        "Long-press the code above to select and copy it manually."
      );
    } catch {
      Alert.alert(
        "Copy failed",
        "Long-press the code above to select and copy it manually."
      );
    }
  }

  async function handleWriteVault() {
    if (!hasKey() || !salt) {
      setWriteMessage(
        "No encryption key is loaded on this device. If your data is " +
        "encrypted by the desktop api-proxy via .env, restart the proxy " +
        "with the latest version — it now writes the vault file " +
        "automatically on startup."
      );
      return;
    }
    setWriting(true);
    setWriteMessage("");
    try {
      await writeVault(getDataRoot(), getCachedKey(), salt);
      setVaultExists(true);
      setWriteMessage(
        "Vault file written. Your data folder is now portable — copy the entire folder to another device and the wizard will detect the vault automatically."
      );
    } catch (err: any) {
      setWriteMessage(`Could not write vault file: ${err?.message ?? "unknown error"}`);
    } finally {
      setWriting(false);
    }
  }

  // Format the salt as 4 groups of 8 hex chars for readability:
  // a1b2c3d4 e5f60718 293a4b5c 6d7e8f90
  function formatSalt(s: string): string {
    if (!s) return "";
    return s.match(/.{1,8}/g)?.join(" ") ?? s;
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
    >
      <View style={styles.section}>
        <Text style={[styles.title, { color: theme.text }]}>Vault Recovery</Text>
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          Your encrypted data is unlocked with two pieces:{"\n"}
          - Your passphrase (only you know it){"\n"}
          - Your salt / recovery code (stored on this device)
          {"\n\n"}
          To restore your data on another device — or after a reinstall — you
          need both. Save the recovery code below somewhere safe.
        </Text>

        {/* ── Diagnostic block — always visible so the user can sanity-check ── */}
        <Text style={[styles.label, { color: theme.textMuted }]}>THIS DEVICE</Text>
        <View style={[styles.notice, { borderColor: theme.borderLight, backgroundColor: "#0a0a0a" }]}>
          <Text style={styles.noticeText}>Data folder: {dataFolder}</Text>
          <Text style={styles.noticeText}>
            In-app encryption: {encryptionEnabled ? "yes" : "no"}
          </Text>
          <Text style={styles.noticeText}>
            Vault file in folder: {vaultExists === null ? "checking…" : vaultExists ? "yes" : "no"}
          </Text>
          <Text style={styles.noticeText}>
            Salt source: {saltSource === "vault" ? "vault file (portable)" : saltSource === "config" ? "in-app config (this device only)" : "none"}
          </Text>
          <Text style={styles.noticeText}>
            Key in memory: {keyLoaded ? "yes" : "no"}
          </Text>
        </View>

        {/* ── What Capacitor actually sees at the data path ── */}
        <Text style={[styles.label, { color: theme.textMuted }]}>FILES VISIBLE TO THE APP</Text>
        <View style={[styles.notice, { borderColor: theme.borderLight, backgroundColor: "#0a0a0a" }]}>
          {folderListing === null && folderListError === "" && (
            <Text style={styles.noticeText}>Reading folder…</Text>
          )}
          {folderListError !== "" && (
            <Text style={[styles.noticeText, { color: "#e88" }]}>
              Error: {folderListError}
              {"\n\n"}
              Most likely the data folder path is wrong, or this folder does
              not exist where the app is looking. The app reads from its
              app-private Documents directory, NOT the public Documents
              folder you see in a file manager.
            </Text>
          )}
          {folderListing !== null && folderListing.length === 0 && (
            <Text style={[styles.noticeText, { color: "#eb8" }]}>
              The folder exists but is empty. The app cannot see any files
              here. If you copied your data files to a public Documents
              folder via a file manager, they're not in the same place the
              app reads from on Android.
            </Text>
          )}
          {folderListing !== null && folderListing.length > 0 && (
            <Text style={[styles.noticeText, { fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) }]}>
              {folderListing.join("\n")}
            </Text>
          )}
        </View>

        {/* No salt available anywhere — neither vault file nor in-app config */}
        {!salt && (
          <View style={[styles.notice, { borderColor: "#5c5c1a", backgroundColor: "#2e2e0a" }]}>
            <Text style={styles.noticeText}>
              No recovery code is available on this device.{"\n\n"}
              Possible reasons:{"\n"}
              1. Your data is not encrypted (the app stores plaintext JSON).{"\n"}
              2. Your data IS encrypted by the desktop api-proxy via .env, but the proxy hasn't yet written a vault file to your data folder. Restart the proxy with the latest version and a vault file will be created automatically.{"\n"}
              3. You're on a different device from the one that holds your encrypted vault.
            </Text>
          </View>
        )}

        {/* Vault file is present — explain its origin if AppConfig says encryption is off */}
        {salt && saltSource === "vault" && !encryptionEnabled && (
          <View style={[styles.notice, { borderColor: "#1a5c1a", backgroundColor: "#0a2e0a" }]}>
            <Text style={styles.noticeText}>
              Your data folder contains a vault file written by the api-proxy
              (or another device). The salt below comes from that vault file —
              it's the actual key your encrypted files are using, even though
              this device's in-app encryption setting says "no" (the proxy
              handles encryption transparently here).
            </Text>
          </View>
        )}

        {salt && (
          <>
            {/* ── Recovery code display ── */}
            <Text style={[styles.label, { color: theme.textMuted }]}>RECOVERY CODE</Text>
            <View style={[styles.codeBox, { borderColor: theme.borderLight }]}>
              <Text selectable style={[styles.codeText, { color: theme.text }]}>
                {formatSalt(salt)}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.copyBtn, { backgroundColor: theme.accent }]}
              onPress={() => copyToClipboard(salt)}
            >
              <Text style={styles.copyBtnText}>Copy recovery code</Text>
            </TouchableOpacity>

            <Text style={[styles.hint, { color: theme.textMuted }]}>
              Treat this code like a password backup. Anyone with both your
              passphrase AND this code can decrypt your data folder.
            </Text>

            {/* ── Vault file status & migration ── */}
            <View style={styles.divider} />

            <Text style={[styles.label, { color: theme.textMuted }]}>VAULT FILE STATUS</Text>
            {vaultExists === null && (
              <Text style={[styles.statusText, { color: theme.textSecondary }]}>
                Checking…
              </Text>
            )}
            {vaultExists === true && (
              <View style={[styles.notice, { borderColor: "#1a5c1a", backgroundColor: "#0a2e0a" }]}>
                <Text style={styles.noticeText}>
                  ✓ Vault file is present in your data folder. The folder is
                  fully portable — copy it to another device and the setup
                  wizard will detect the vault automatically.
                </Text>
              </View>
            )}
            {vaultExists === false && (
              <>
                <View style={[styles.notice, { borderColor: "#5c5c1a", backgroundColor: "#2e2e0a" }]}>
                  <Text style={styles.noticeText}>
                    No vault file in your data folder. If you copy this folder
                    to another device, you will need to enter your recovery
                    code manually to unlock it. Click below to write the vault
                    file now and make the folder portable.
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.primaryBtn, writing && styles.disabledBtn]}
                  onPress={handleWriteVault}
                  disabled={writing}
                >
                  <Text style={styles.primaryBtnText}>
                    {writing ? "Writing…" : "Write vault file now"}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            {writeMessage !== "" && (
              <Text
                style={[
                  styles.statusText,
                  { color: writeMessage.startsWith("Could not") ? "#e55" : theme.text },
                ]}
              >
                {writeMessage}
              </Text>
            )}
          </>
        )}

        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)/chat");
          }}
        >
          <Text style={[styles.backBtnText, { color: theme.textMuted }]}>
            {"\u2190"} Back
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flexGrow: 1,
    padding: 24,
    paddingTop: Platform.OS === "ios" ? 60 : 40,
  },
  section: { marginBottom: 40 },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 12 },
  body: { fontSize: 15, lineHeight: 24, marginBottom: 24 },
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 8,
  },
  codeBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    backgroundColor: "#0a0a0a",
  },
  codeText: {
    fontSize: 16,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    letterSpacing: 1,
  },
  copyBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  copyBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12,
  },
  divider: {
    height: 1,
    backgroundColor: "#222",
    marginVertical: 24,
  },
  notice: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  noticeText: {
    color: "#ddd",
    fontSize: 13,
    lineHeight: 19,
  },
  statusText: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  primaryBtn: {
    backgroundColor: "#1a73e8",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 12,
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  disabledBtn: { opacity: 0.4 },
  backBtn: {
    marginTop: 24,
    alignItems: "center",
  },
  backBtnText: {
    fontSize: 14,
  },
});
