import React, { useState, useContext, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Modal,
  FlatList,
} from "react-native";
import Anthropic from "@anthropic-ai/sdk";
import { saveConfig, savePassphrase as storePassphrase } from "../src/utils/config";
import { setDataRoot, fileExists, validateDataFolder, getDataRoot, getCapacitorDirectory, getCapacitorDirectoryName } from "../src/utils/filesystem";
import { isCapacitor, isWeb as isWebPlatform } from "../src/utils/platform";
import { deriveKey, cacheKey, generateSalt, setEncryptionEnabled, verifyKey } from "../src/utils/crypto";
import { readVault, writeVault, verifyKeyAgainstVault, VAULT_FILENAME } from "../src/utils/vault";

const PROXY_URL = "http://localhost:3099";
import { ConfigContext } from "./_layout";
import type { AppConfig } from "../src/types";

const MOBILE_DEFAULT_FOLDER = "ChiefClarity";

function getDefaultDbPath(): string {
  if (typeof process !== "undefined" && process.env?.USERPROFILE) {
    return process.env.USERPROFILE.replace(/\\/g, "/") + "/Documents/.lifeos";
  }
  if (typeof process !== "undefined" && process.env?.HOME) {
    return process.env.HOME + "/Documents/.lifeos";
  }
  return "";
}

type Step = "welcome" | "apikey" | "datapath" | "dbpath" | "encryption";
type TestStatus = "idle" | "testing" | "success" | "error";

// ─── Folder Browser Modal (mobile only) ──────────────────────────────────

interface FolderEntry {
  name: string;
  type: "directory" | "file";
}

function FolderBrowserModal({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<FolderEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [error, setError] = useState("");

  const resetState = useCallback(() => {
    setCurrentPath("");
    setEntries([]);
    setError("");
    setNewFolderName("");
    setShowNewFolder(false);
  }, []);

  const loadDir = useCallback(async (path: string) => {
    setLoading(true);
    setError("");
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");

      // Ensure the root exists
      if (!path) {
        try {
          await Filesystem.mkdir({
            path: "",
            directory: Directory.Documents,
            recursive: true,
          });
        } catch { /* already exists */ }
      }

      const result = await Filesystem.readdir({
        path: path || "",
        directory: Directory.Documents,
      });

      const folders = result.files
        .filter((f) => f.type === "directory")
        .sort((a, b) => a.name.localeCompare(b.name));

      setEntries(folders);
      setCurrentPath(path);
    } catch (err: any) {
      // Directory doesn't exist yet — show empty
      setEntries([]);
      setError("");
    } finally {
      setLoading(false);
    }
  }, []);

  // Reset all state and load root when modal opens
  React.useEffect(() => {
    if (visible) {
      resetState();
      loadDir("");
    }
  }, [visible, loadDir, resetState]);

  const navigateInto = (folderName: string) => {
    const next = currentPath ? `${currentPath}/${folderName}` : folderName;
    loadDir(next);
  };

  const navigateUp = () => {
    const lastSlash = currentPath.lastIndexOf("/");
    const parent = lastSlash > 0 ? currentPath.substring(0, lastSlash) : "";
    loadDir(parent);
  };

  const createFolder = async () => {
    // Sanitize: strip path separators, traversal sequences, and control chars
    const name = newFolderName.trim()
      .replace(/[\/\\]/g, "")
      .replace(/\.\./g, "")
      .replace(/[\x00-\x1f]/g, "");
    if (!name) {
      setError("Invalid folder name.");
      return;
    }

    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const newPath = currentPath ? `${currentPath}/${name}` : name;
      await Filesystem.mkdir({
        path: newPath,
        directory: Directory.Documents,
        recursive: true,
      });
      setNewFolderName("");
      setShowNewFolder(false);
      loadDir(currentPath);
    } catch (err: any) {
      setError(`Could not create folder: ${err?.message || "unknown error"}`);
    }
  };

  const selectCurrent = () => {
    if (!currentPath) {
      Alert.alert(
        "No folder selected",
        "Navigate into a folder or create a new one first."
      );
      return;
    }
    onSelect(currentPath);
    onClose();
  };

  const displayPath = currentPath || "Documents (root)";

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={bStyles.overlay}>
        <View style={bStyles.modal}>
          {/* Header */}
          <View style={bStyles.header}>
            <Text style={bStyles.headerTitle}>Choose Folder</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={bStyles.closeBtn}>Cancel</Text>
            </TouchableOpacity>
          </View>

          {/* Current path */}
          <View style={bStyles.pathBar}>
            <Text style={bStyles.pathText} numberOfLines={1}>
              {displayPath}
            </Text>
          </View>

          {/* Navigation */}
          {currentPath !== "" && (
            <TouchableOpacity style={bStyles.row} onPress={navigateUp}>
              <Text style={bStyles.folderIcon}>{"\u2190"}</Text>
              <Text style={bStyles.rowText}>.. (go up)</Text>
            </TouchableOpacity>
          )}

          {/* Folder list */}
          {loading ? (
            <View style={bStyles.center}>
              <ActivityIndicator color="#4a9eff" />
            </View>
          ) : entries.length === 0 ? (
            <View style={bStyles.center}>
              <Text style={bStyles.emptyText}>No subfolders here</Text>
            </View>
          ) : (
            <FlatList
              data={entries}
              keyExtractor={(item) => item.name}
              style={bStyles.list}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={bStyles.row}
                  onPress={() => navigateInto(item.name)}
                >
                  <Text style={bStyles.folderIcon}>{"\uD83D\uDCC1"}</Text>
                  <Text style={bStyles.rowText}>{item.name}</Text>
                  <Text style={bStyles.chevron}>{"\u203A"}</Text>
                </TouchableOpacity>
              )}
            />
          )}

          {error !== "" && (
            <Text style={bStyles.errorText}>{error}</Text>
          )}

          {/* New folder */}
          {showNewFolder ? (
            <View style={bStyles.newFolderRow}>
              <TextInput
                style={bStyles.newFolderInput}
                value={newFolderName}
                onChangeText={setNewFolderName}
                placeholder="Folder name"
                placeholderTextColor="#666"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
              />
              <TouchableOpacity
                style={[bStyles.newFolderBtn, !newFolderName.trim() && { opacity: 0.4 }]}
                onPress={createFolder}
                disabled={!newFolderName.trim()}
              >
                <Text style={bStyles.newFolderBtnText}>Create</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setShowNewFolder(false); setNewFolderName(""); }}>
                <Text style={bStyles.cancelSmall}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={bStyles.newFolderTrigger}
              onPress={() => setShowNewFolder(true)}
            >
              <Text style={bStyles.newFolderTriggerText}>+ New folder</Text>
            </TouchableOpacity>
          )}

          {/* Select button */}
          <TouchableOpacity
            style={[bStyles.selectBtn, !currentPath && { opacity: 0.4 }]}
            onPress={selectCurrent}
          >
            <Text style={bStyles.selectBtnText}>
              {currentPath ? `Use "${currentPath}"` : "Select a folder"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const bStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  modal: {
    backgroundColor: "#1a1a1a",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
    paddingBottom: 30,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#333",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  closeBtn: {
    color: "#4a9eff",
    fontSize: 15,
  },
  pathBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#111",
  },
  pathText: {
    color: "#888",
    fontSize: 13,
    fontFamily: "monospace",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },
  folderIcon: {
    fontSize: 18,
    marginRight: 12,
  },
  rowText: {
    color: "#ddd",
    fontSize: 15,
    flex: 1,
  },
  chevron: {
    color: "#555",
    fontSize: 20,
  },
  list: {
    maxHeight: 300,
  },
  center: {
    padding: 40,
    alignItems: "center",
  },
  emptyText: {
    color: "#666",
    fontSize: 14,
  },
  errorText: {
    color: "#e55",
    fontSize: 13,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  newFolderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  newFolderInput: {
    flex: 1,
    backgroundColor: "#111",
    color: "#fff",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    borderWidth: 1,
    borderColor: "#333",
  },
  newFolderBtn: {
    backgroundColor: "#1a73e8",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  newFolderBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  cancelSmall: {
    color: "#888",
    fontSize: 13,
    paddingHorizontal: 8,
  },
  newFolderTrigger: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  newFolderTriggerText: {
    color: "#4a9eff",
    fontSize: 14,
  },
  selectBtn: {
    backgroundColor: "#1a73e8",
    borderRadius: 12,
    paddingVertical: 14,
    marginHorizontal: 16,
    marginTop: 8,
    alignItems: "center",
  },
  selectBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});

export default function SetupScreen() {
  const { setConfig, theme } = useContext(ConfigContext);
  const [apiKey, setApiKey] = useState("");
  const [dataPath, setDataPath] = useState(isWebPlatform() ? "" : MOBILE_DEFAULT_FOLDER);
  const [dbPath, setDbPath] = useState("");
  const [step, setStep] = useState<Step>("welcome");
  const [saving, setSaving] = useState(false);

  // API key test state
  const [apiTestStatus, setApiTestStatus] = useState<TestStatus>("idle");
  const [apiTestMessage, setApiTestMessage] = useState("");

  // Folder validation state
  const [folderTestStatus, setFolderTestStatus] = useState<TestStatus>("idle");
  const [folderTestMessage, setFolderTestMessage] = useState("");
  const [folderListing, setFolderListing] = useState<string[] | null>(null);
  const [sensitiveProbe, setSensitiveProbe] = useState<{ name: string; status: "found" | "missing" }[] | null>(null);

  // Folder browser modal (mobile only)
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);

  // Encryption step state
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const [storeInSecureStore, setStoreInSecureStore] = useState(true);
  const [encryptionDeriving, setEncryptionDeriving] = useState(false);
  const [encryptionError, setEncryptionError] = useState("");

  // Vault detection — set when user verifies the data folder.
  // - "fresh"   → no vault, no encrypted files; create new vault
  // - "vault"   → vault file present; ask passphrase only, use vault salt
  // - "orphan"  → encrypted files present but no vault; ask passphrase + recovery code
  const [vaultMode, setVaultMode] = useState<"fresh" | "vault" | "orphan">("fresh");
  const [vaultSalt, setVaultSalt] = useState<string>(""); // populated when vaultMode === "vault"
  const [recoveryCode, setRecoveryCode] = useState(""); // user-input salt for orphan mode

  // ─── API Key Test ─────────────────────────────────────────────────────

  async function testApiKey() {
    if (!apiKey.trim()) return;

    setApiTestStatus("testing");
    setApiTestMessage("");

    try {
      if (isCapacitor()) {
        // Mobile: use CapacitorHttp — native layer, no CORS
        const { CapacitorHttp } = await import("@capacitor/core");
        const res = await CapacitorHttp.post({
          url: "https://api.anthropic.com/v1/messages",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey.trim(),
            "anthropic-version": "2023-06-01",
          },
          data: {
            model: "claude-haiku-4-5-20251001",
            max_tokens: 10,
            messages: [{ role: "user", content: "Say OK" }],
          },
        });

        if (res.status === 401) {
          setApiTestStatus("error");
          setApiTestMessage("Invalid API key. Please check and try again.");
          return;
        }
        if (res.status === 429) {
          setApiTestStatus("success");
          setApiTestMessage("Rate limited — but the key is valid. You can proceed.");
          return;
        }
        if (res.status < 200 || res.status >= 300) {
          setApiTestStatus("error");
          setApiTestMessage(`Connection failed: ${res.status}`);
          return;
        }

        const text = res.data?.content?.[0]?.text ?? "";
        if (text) {
          setApiTestStatus("success");
          setApiTestMessage("Connected successfully");
        } else {
          setApiTestStatus("error");
          setApiTestMessage("Got a response but it was empty. Check your key.");
        }
      } else {
        // Web: use SDK through localhost proxy
        const client = new Anthropic({
          apiKey: apiKey.trim(),
          ...(isWebPlatform() ? { baseURL: PROXY_URL } : {}),
        } as any);
        const response = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 10,
          messages: [{ role: "user", content: "Say OK" }],
        });
        const text = (response.content[0] as any)?.text ?? "";
        if (text) {
          setApiTestStatus("success");
          setApiTestMessage("Connected successfully");
        } else {
          setApiTestStatus("error");
          setApiTestMessage("Got a response but it was empty. Check your key.");
        }
      }
    } catch (err: any) {
      setApiTestStatus("error");
      const msg =
        err?.status === 401
          ? "Invalid API key. Please check and try again."
          : err?.status === 429
            ? "Rate limited — but the key is valid. You can proceed."
            : `Connection failed: ${err?.message ?? "Unknown error"}`;
      if (err?.status === 429) {
        setApiTestStatus("success");
      }
      setApiTestMessage(msg);
    }
  }

  // ─── Folder Validation ───────────────────────────────────────────────

  async function testDataFolder() {
    const path = dataPath.trim();
    if (!path) return;

    setFolderTestStatus("testing");
    setFolderTestMessage("");
    setFolderListing(null);

    try {
      setDataRoot(path);
      const result = await validateDataFolder();

      if (!result.ok) {
        setFolderTestStatus("error");
        setFolderTestMessage(result.error || "Could not write to this folder.");
        return;
      }

      // Diagnostic: list whatever Capacitor sees at the chosen path so the
      // user can confirm visually that their copied files are present.
      // We keep a local copy of `names` because React state updates are
      // async and won't be readable in the rest of this function.
      let localListing: string[] = [];
      let listingError: string = "";
      if (isCapacitor()) {
        try {
          const { Filesystem } = await import("@capacitor/filesystem");
          const directory = await getCapacitorDirectory();
          const root = getDataRoot().replace(/\/+$/, "");
          const listing = await Filesystem.readdir({
            path: root,
            directory,
          });
          localListing = listing.files
            .map((f) => (f.type === "directory" ? f.name + "/" : f.name))
            .sort();
          setFolderListing(localListing);
        } catch (err: any) {
          listingError = err?.message || "Could not list folder contents";
          setFolderListing([]);
        }
      }

      // If listing failed AND the user picked an external storage path,
      // surface the most likely cause: missing All Files Access permission.
      if (listingError && getCapacitorDirectoryName() === "ExternalStorage") {
        setFolderTestStatus("error");
        setFolderTestMessage(
          "Could not read this folder. The app needs 'All files access' permission to read /storage/emulated/0/* paths.\n\n" +
          "Open Android Settings → Apps → Chief Clarity → Permissions → All files access → ENABLE, then come back and tap Verify folder again.\n\n" +
          "Original error: " + listingError
        );
        return;
      }

      // Detect vault state in the chosen folder
      const vault = await readVault(getDataRoot());
      const hasData = await fileExists("tasks.json");

      // Did we see _vault.json in the directory listing? If yes but
      // readVault returned null, the file IS there but couldn't be read —
      // that's a different problem from "no vault file at all" and we
      // should make the wizard say so loudly so the user knows to report it.
      const vaultListed = localListing.some(
        (n) => n === VAULT_FILENAME || n === VAULT_FILENAME + "/"
      );

      if (vault) {
        // Existing vault — passphrase-only unlock flow
        setVaultMode("vault");
        setVaultSalt(vault.salt);
        setFolderTestStatus("success");
        setFolderTestMessage(
          "Existing encrypted vault found — you'll be asked for your passphrase next"
        );
      } else if (vaultListed) {
        // Vault file exists but readVault couldn't read it. This is a bug
        // in our Capacitor file handling, not a user error. Surface it
        // explicitly so the user doesn't go down the orphan path by mistake.
        setVaultMode("orphan");
        setFolderTestStatus("error");
        setFolderTestMessage(
          "_vault.json is in this folder but the app could not read it. Check the device console logs for [vault] errors. As a workaround, use 'I have a recovery code' on the next step and paste your salt manually."
        );
      } else if (hasData) {
        // Data files exist but there's no vault file in the listing. We
        // can't reliably tell whether the files are plaintext or encrypted
        // without reading them, and Filesystem.readFile is unreliable on
        // some Android backends. So we default to "fresh" but the wizard
        // ALWAYS exposes the "I have a recovery code" button so the user
        // can switch to orphan mode if their data is actually encrypted.
        setVaultMode("fresh");
        setFolderTestStatus("success");
        setFolderTestMessage(
          "Folder is ready — existing data found. If your data is encrypted, click 'I have a recovery code' on the next step."
        );
      } else {
        setVaultMode("fresh");
        setFolderTestStatus("success");
        setFolderTestMessage("Folder is ready — will create new data here");
      }
    } catch (err: any) {
      setFolderTestStatus("error");
      setFolderTestMessage(err?.message || "Could not access this folder.");
    }
  }

  // Sensitive file candidates we expect to exist in any encrypted data
  // folder. Order matters — most-likely-present first.
  const SENSITIVE_CANDIDATES = [
    "tasks.json",
    "calendar.json",
    "user_profile.json",
    "user_observations.json",
    "notes.json",
    "hot_context.json",
    "summaries.json",
    "context_memory.json",
    "feedback_memory.json",
    "focus_brief.json",
    "recurring_tasks.json",
    "chat_history.json",
    "plan/plan_okr_dashboard.json",
  ];

  // Find any sensitive file that physically exists in the data folder.
  // Just checks existence — does NOT try to read or decrypt. This is the
  // reliable preflight for orphan-mode recovery: if even one sensitive
  // file is present, we have something for verifyKey to work against.
  async function findAnyExistingSensitiveFile(): Promise<string | null> {
    if (!isCapacitor()) return null;
    const { Filesystem } = await import("@capacitor/filesystem");
    const directory = await getCapacitorDirectory();
    const root = getDataRoot().replace(/\/+$/, "");
    for (const rel of SENSITIVE_CANDIDATES) {
      const fullPath = root + "/" + rel;
      try {
        await Filesystem.stat({
          path: fullPath,
          directory,
        });
        return rel; // exists
      } catch {
        continue;
      }
    }
    return null;
  }

  // Probe whether a file at the given relative path is AES-GCM encrypted.
  // Reads raw bytes via Capacitor and checks the first byte against the
  // plaintext-JSON exclusion (same logic as crypto.isEncryptedBuffer).
  async function probeFileEncrypted(relativePath: string): Promise<boolean> {
    try {
      if (isCapacitor()) {
        const { Filesystem } = await import("@capacitor/filesystem");
        const directory = await getCapacitorDirectory();
        const fullPath = getDataRoot().replace(/\/+$/, "") + "/" + relativePath;
        const raw = await Filesystem.readFile({
          path: fullPath,
          directory,
        });
        const b64 = raw.data as string;
        if (!b64 || b64.length < 4) return false;
        // Decode just the first byte to check
        const bin = atob(b64.substring(0, 4));
        if (bin.length === 0) return false;
        const first = bin.charCodeAt(0);
        return first !== 0x7B && first !== 0x5B && first !== 0xEF;
      }
      // Other platforms: best-effort, treat as not-encrypted
      return false;
    } catch {
      return false;
    }
  }

  // ─── Finish ───────────────────────────────────────────────────────────

  async function handleFinish() {
    setEncryptionError("");

    if (!apiKey.trim()) {
      Alert.alert("Missing API key", "Please enter your Anthropic API key.");
      return;
    }
    if (!dataPath.trim()) {
      Alert.alert(
        "Missing data folder",
        "Please choose or type your data folder path."
      );
      return;
    }

    setSaving(true);

    setDataRoot(dataPath.trim());

    const wantsEncryption = passphrase.trim().length > 0;

    // ── Pick the salt based on vault mode ─────────────────────────────
    // - vault   → use salt from existing vault file
    // - orphan  → use the recovery code the user pasted
    // - fresh   → generate a brand-new random salt
    let salt: string | undefined;
    if (wantsEncryption) {
      if (vaultMode === "vault") {
        salt = vaultSalt;
      } else if (vaultMode === "orphan") {
        // Normalize: strip whitespace, dashes, lowercase. The salt is hex,
        // so we accept any common formatting users might paste.
        const cleaned = recoveryCode.trim().toLowerCase().replace(/[\s\-]+/g, "");
        if (cleaned.length === 0) {
          setEncryptionError("Please enter your recovery code.");
          setSaving(false);
          return;
        }
        if (cleaned.length !== 32) {
          setEncryptionError(
            `Recovery code must be exactly 32 hex characters. Got ${cleaned.length}.`
          );
          setSaving(false);
          return;
        }
        if (!/^[0-9a-f]{32}$/.test(cleaned)) {
          setEncryptionError(
            "Recovery code contains invalid characters. Only 0-9 and a-f are allowed."
          );
          setSaving(false);
          return;
        }
        salt = cleaned;
      } else {
        salt = generateSalt();
      }
    }

    const resolvedDbPath = dbPath.trim() || getDefaultDbPath();
    const config: AppConfig = {
      anthropicApiKey: apiKey.trim(),
      dataFolderPath: dataPath.trim(),
      dbPath: resolvedDbPath,
      theme: "dark",
      encryptionEnabled: wantsEncryption,
      encryptionSalt: salt,
      passphraseInSecureStore: wantsEncryption ? storeInSecureStore : undefined,
    };

    // Derive and cache encryption key before writing any files
    if (wantsEncryption && salt) {
      const key = await deriveKey(passphrase.trim(), salt);

      // Validate the key against actual ciphertext BEFORE committing —
      // otherwise a wrong salt/passphrase silently leaves the user with
      // an empty app on next launch.
      // - vault: decrypt the vault verifier blob
      // - orphan: probe a real encrypted sensitive file via verifyKey
      //           Path 3 (Capacitor file probe)
      if (vaultMode === "vault") {
        const vault = await readVault(getDataRoot());
        if (!vault || !(await verifyKeyAgainstVault(key, vault))) {
          setEncryptionError("Wrong passphrase. Please try again.");
          setSaving(false);
          return;
        }
      } else if (vaultMode === "orphan") {
        // Preflight: at least one sensitive file must exist at the path.
        // We use Filesystem.stat (not a read) so the check is robust to
        // permission/encoding edge cases.
        const found = await findAnyExistingSensitiveFile();
        if (!found) {
          setEncryptionError(
            "No data files found in this folder. Check that you picked the right folder and that the files (tasks.json, calendar.json, etc.) were actually copied here. The folder test in the previous step shows what the app can see — go back and verify."
          );
          setSaving(false);
          return;
        }
        // We have at least one sensitive file present — verifyKey will
        // attempt to decrypt it and tell us if the passphrase + salt are right.
        const valid = await verifyKey(key, getDataRoot());
        if (!valid) {
          setEncryptionError(
            "Could not decrypt your data with this passphrase + recovery code. Double-check both values (no extra spaces, exact case) and try again."
          );
          setSaving(false);
          return;
        }
      }

      cacheKey(key);
      setEncryptionEnabled(true);

      if (storeInSecureStore) {
        await storePassphrase(passphrase.trim());
      }

      // Write the vault file. For "fresh" this creates it for the first
      // time. For "orphan" this materializes a vault around the recovered
      // salt — next launch on this device will use Path 1 verification.
      // For "vault" we leave the existing file alone (no rewrite needed).
      if (vaultMode !== "vault") {
        try {
          await writeVault(getDataRoot(), key, salt);
        } catch (err: any) {
          // Non-fatal: app can run without a vault file (legacy mode), but
          // warn the user so they know recovery is fragile.
          console.warn("[setup] Could not write vault file:", err?.message);
        }
      }
    }

    await saveConfig(config);

    // Write .env file so headless runner + proxy can read the API key (web only)
    if (isWebPlatform()) {
      try {
        await fetch(`http://localhost:3099/write-env`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ANTHROPIC_API_KEY: config.anthropicApiKey,
            DATA_FOLDER_PATH: config.dataFolderPath,
            DB_PATH: config.dbPath || "",
          }),
        });
      } catch { /* non-critical on first run before proxy starts */ }
    }

    setConfig(config);
    setSaving(false);
  }

  // ─── Can proceed from each step ──────────────────────────────────────

  const canProceedFromApiKey =
    apiKey.trim().length > 0 && apiTestStatus === "success";

  const canFinish =
    dataPath.trim().length > 0 && folderTestStatus === "success" && !saving;

  // ─── Render ───────────────────────────────────────────────────────────

  // Mobile = Capacitor (true mobile build) OR React Native dev client.
  // We deliberately do NOT use Platform.OS === "web" here because Capacitor
  // runs RN inside a webview, which makes Platform.OS report "web" even on
  // a real phone. isWebPlatform() from utils/platform correctly returns
  // false on Capacitor.
  const isMobile = !isWebPlatform();

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
    >
      {/* ─── Welcome ──────────────────────────────────────────────────── */}
      {step === "welcome" && (
        <View style={styles.section}>
          <Text style={styles.title}>Welcome to Chief Clarity</Text>
          <Text style={styles.subtitle}>
            Your personal AI organizer. Everything stays on your device — your
            data, your rules.
          </Text>
          <Text style={styles.body}>
            Before we start, I need two things:{"\n\n"}
            1. Your Anthropic API key (for the AI brain){"\n"}
            2. Where your data lives (a folder on your device{isWebPlatform() ? " or cloud storage" : ""})
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => setStep("apikey")}
          >
            <Text style={styles.primaryBtnText}>Let's go</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ─── API Key ──────────────────────────────────────────────────── */}
      {step === "apikey" && (
        <View style={styles.section}>
          <Text style={styles.title}>API Key</Text>
          <Text style={styles.body}>
            Paste your Anthropic API key. It stays on this device — never sent
            anywhere except Anthropic's servers.
          </Text>
          <TextInput
            style={styles.input}
            value={apiKey}
            onChangeText={(text) => {
              setApiKey(text);
              // Reset test if key changes
              if (apiTestStatus !== "idle") {
                setApiTestStatus("idle");
                setApiTestMessage("");
              }
            }}
            placeholder="sk-ant-..."
            placeholderTextColor="#555"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />

          {/* Test Connection Button */}
          <TouchableOpacity
            style={[
              styles.testBtn,
              (!apiKey.trim() || apiTestStatus === "testing") &&
                styles.disabledBtn,
            ]}
            onPress={testApiKey}
            disabled={!apiKey.trim() || apiTestStatus === "testing"}
          >
            {apiTestStatus === "testing" ? (
              <View style={styles.testBtnInner}>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.testBtnText}>Testing connection...</Text>
              </View>
            ) : (
              <Text style={styles.testBtnText}>Test connection</Text>
            )}
          </TouchableOpacity>

          {/* Test Result */}
          {apiTestMessage !== "" && (
            <View
              style={[
                styles.testResult,
                apiTestStatus === "success"
                  ? styles.testSuccess
                  : styles.testError,
              ]}
            >
              <Text style={styles.testResultIcon}>
                {apiTestStatus === "success" ? "\u2713" : "\u2717"}
              </Text>
              <Text style={styles.testResultText}>{apiTestMessage}</Text>
            </View>
          )}

          {/* Next (only enabled after successful test) */}
          <TouchableOpacity
            style={[
              styles.primaryBtn,
              !canProceedFromApiKey && styles.disabledBtn,
            ]}
            onPress={() => canProceedFromApiKey && setStep("datapath")}
            disabled={!canProceedFromApiKey}
          >
            <Text style={styles.primaryBtnText}>Next</Text>
          </TouchableOpacity>

          {apiKey.trim() && apiTestStatus === "idle" && (
            <Text style={styles.hintSmall}>
              Test your key before continuing
            </Text>
          )}

          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => setStep("welcome")}
          >
            <Text style={styles.backBtnText}>{"\u2190"} Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ─── Data Folder ──────────────────────────────────────────────── */}
      {step === "datapath" && (
        <View style={styles.section}>
          <Text style={styles.title}>Data Folder</Text>
          <Text style={styles.body}>
            {isMobile
              ? "Your data will be stored in the app's private folder on this device. You can change the subfolder name below."
              : "Enter the full path to your data folder (e.g. C:/Users/you/Documents/ChiefClarity)."}
          </Text>

          {/* Browse button — mobile only */}
          {isMobile && (
            <TouchableOpacity
              style={styles.browseBtn}
              onPress={() => setShowFolderBrowser(true)}
            >
              <Text style={styles.browseBtnText}>Browse folders</Text>
            </TouchableOpacity>
          )}

          <TextInput
            style={styles.input}
            value={dataPath}
            onChangeText={(text) => {
              setDataPath(text);
              // Reset folder test if path changes
              if (folderTestStatus !== "idle") {
                setFolderTestStatus("idle");
                setFolderTestMessage("");
              }
            }}
            placeholder={isMobile ? "ChiefClarity" : "/path/to/your/data/folder"}
            placeholderTextColor="#555"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {/* Hint */}
          <Text style={styles.hint}>
            {isMobile
              ? "Browse or type a folder name. It will be created inside the app's Documents directory."
              : "Enter the full path to your data folder. It can be a local folder or cloud-synced storage."}
          </Text>

          {/* Folder browser modal */}
          {isMobile && (
            <FolderBrowserModal
              visible={showFolderBrowser}
              onClose={() => setShowFolderBrowser(false)}
              onSelect={(path) => {
                setDataPath(path);
                // Reset folder test since path changed
                setFolderTestStatus("idle");
                setFolderTestMessage("");
              }}
            />
          )}

          {/* Test Folder Button */}
          <TouchableOpacity
            style={[
              styles.testBtn,
              (!dataPath.trim() || folderTestStatus === "testing") &&
                styles.disabledBtn,
            ]}
            onPress={testDataFolder}
            disabled={!dataPath.trim() || folderTestStatus === "testing"}
          >
            {folderTestStatus === "testing" ? (
              <View style={styles.testBtnInner}>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.testBtnText}>Checking folder...</Text>
              </View>
            ) : (
              <Text style={styles.testBtnText}>Verify folder</Text>
            )}
          </TouchableOpacity>

          {/* Folder Test Result */}
          {folderTestMessage !== "" && (
            <View
              style={[
                styles.testResult,
                folderTestStatus === "success"
                  ? styles.testSuccess
                  : styles.testError,
              ]}
            >
              <Text style={styles.testResultIcon}>
                {folderTestStatus === "success" ? "\u2713" : "\u2717"}
              </Text>
              <Text style={styles.testResultText}>{folderTestMessage}</Text>
            </View>
          )}

          {/* Directory listing — confirm what the app actually sees */}
          {folderListing !== null && (
            <View
              style={[
                styles.testResult,
                {
                  backgroundColor: "#0a0a0a",
                  borderColor: "#333",
                  flexDirection: "column",
                  alignItems: "stretch",
                },
              ]}
            >
              <Text style={[styles.testResultText, { color: "#888", marginBottom: 6 }]}>
                Files visible in this folder ({folderListing.length}):
              </Text>
              {folderListing.length === 0 ? (
                <Text style={[styles.testResultText, { color: "#e88" }]}>
                  (empty — no files at this location)
                </Text>
              ) : (
                <Text
                  style={[
                    styles.testResultText,
                    { fontFamily: "monospace", color: "#ccc" },
                  ]}
                >
                  {folderListing.slice(0, 30).join("\n")}
                  {folderListing.length > 30 ? `\n… and ${folderListing.length - 30} more` : ""}
                </Text>
              )}
            </View>
          )}

          {/* Next (only enabled after successful folder test) */}
          <TouchableOpacity
            style={[
              styles.primaryBtn,
              !canFinish && styles.disabledBtn,
            ]}
            onPress={() => canFinish && setStep(isWebPlatform() ? "dbpath" : "encryption")}
            disabled={!canFinish}
          >
            <Text style={styles.primaryBtnText}>Next</Text>
          </TouchableOpacity>

          {dataPath.trim() && folderTestStatus === "idle" && (
            <Text style={styles.hintSmall}>
              Verify the folder before continuing
            </Text>
          )}

          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => setStep("apikey")}
          >
            <Text style={styles.backBtnText}>{"\u2190"} Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ─── Database Location (web only) ──────────────────────────────── */}
      {step === "dbpath" && (
        <View style={styles.section}>
          <Text style={styles.title}>Database Location</Text>
          <Text style={styles.body}>
            Your database needs a <Text style={{ fontWeight: "700" }}>local folder</Text> — cloud-synced
            folders (Google Drive, OneDrive) cause lock conflicts with SQLite.
            {"\n\n"}
            A backup copy is automatically saved to your data folder every 6 hours.
          </Text>

          <TextInput
            style={styles.input}
            value={dbPath}
            onChangeText={setDbPath}
            placeholder={getDefaultDbPath()}
            placeholderTextColor="#555"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.hint}>
            Leave blank to use the default: {getDefaultDbPath()}
          </Text>

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => setStep("encryption")}
          >
            <Text style={styles.primaryBtnText}>Next</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => setStep("datapath")}
          >
            <Text style={styles.backBtnText}>{"\u2190"} Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ─── Encryption ────────────────────────────────────────────────── */}
      {step === "encryption" && (
        <View style={styles.section}>
          {/* ── Title & explainer change per vault mode ── */}
          {vaultMode === "vault" && (
            <>
              <Text style={styles.title}>Unlock your vault</Text>
              <Text style={styles.body}>
                This folder already contains an encrypted vault. Enter your
                passphrase to unlock your existing data.
              </Text>
            </>
          )}
          {vaultMode === "orphan" && (
            <>
              <Text style={styles.title}>Restore from recovery code</Text>
              <Text style={styles.body}>
                This folder contains encrypted data, but the vault file is
                missing. Enter your passphrase AND your recovery code (the
                32-character salt from your original device) to restore access.
              </Text>
              <Text style={[styles.hint, { color: "#e8a838", marginBottom: 16 }]}>
                The recovery code is a 32-character hex string. You can find
                it on your original device under "Show Recovery Code".
              </Text>
            </>
          )}
          {vaultMode === "fresh" && (
            <>
              <Text style={styles.title}>Encryption</Text>
              <Text style={styles.body}>
                Protect your data with a passphrase. Your files will be
                encrypted before they're written to disk — even your cloud
                provider won't be able to read them.
              </Text>
              <Text style={[styles.hint, { color: "#e8a838", marginBottom: 16 }]}>
                If you forget your passphrase, your data cannot be recovered.
                There is no reset option.
              </Text>

              {/* Manual switch into orphan/restore mode — always available
                  so users can recover regardless of folder auto-detection */}
              <TouchableOpacity
                style={[styles.testBtn, { marginBottom: 16 }]}
                onPress={() => {
                  setVaultMode("orphan");
                  setEncryptionError("");
                  setPassphraseConfirm("");
                }}
              >
                <Text style={styles.testBtnText}>
                  I already have a recovery code (restoring existing data)
                </Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── Recovery code field (orphan mode only) ── */}
          {vaultMode === "orphan" && (
            <>
              <TextInput
                style={[styles.input, { fontFamily: "monospace" }]}
                value={recoveryCode}
                onChangeText={(t) => {
                  setRecoveryCode(t);
                  if (encryptionError) setEncryptionError("");
                }}
                placeholder="Recovery code (32 hex characters)"
                placeholderTextColor="#555"
                autoCapitalize="none"
                autoCorrect={false}
              />

              {/* Escape hatch back to fresh mode if user clicked by mistake */}
              <TouchableOpacity
                style={{ marginBottom: 12, paddingVertical: 4 }}
                onPress={() => {
                  setVaultMode("fresh");
                  setRecoveryCode("");
                  setEncryptionError("");
                }}
              >
                <Text style={[styles.hintSmall, { color: "#4a9eff", textAlign: "left", marginTop: 0 }]}>
                  ← I don't have a recovery code, set up fresh encryption instead
                </Text>
              </TouchableOpacity>
            </>
          )}

          <TextInput
            style={styles.input}
            value={passphrase}
            onChangeText={(t) => {
              setPassphrase(t);
              if (encryptionError) setEncryptionError("");
            }}
            placeholder="Passphrase"
            placeholderTextColor="#555"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />

          {/* Confirm only required for fresh setup, not unlock/restore */}
          {vaultMode === "fresh" && (
            <TextInput
              style={styles.input}
              value={passphraseConfirm}
              onChangeText={setPassphraseConfirm}
              placeholder="Confirm passphrase"
              placeholderTextColor="#555"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          )}

          {vaultMode === "fresh" && passphrase.length > 0 && passphrase.length < 8 && (
            <Text style={[styles.hintSmall, { color: "#e8a838", marginBottom: 4 }]}>
              Minimum 8 characters
            </Text>
          )}

          {vaultMode === "fresh" && passphrase.length >= 8 && passphraseConfirm.length > 0 && passphrase !== passphraseConfirm && (
            <Text style={[styles.hintSmall, { color: "#e55", marginBottom: 12 }]}>
              Passphrases don't match
            </Text>
          )}

          {encryptionError !== "" && (
            <Text style={[styles.hintSmall, { color: "#e55", marginBottom: 12 }]}>
              {encryptionError}
            </Text>
          )}

          {/* Secure store toggle */}
          <TouchableOpacity
            style={styles.toggleRow}
            onPress={() => setStoreInSecureStore(!storeInSecureStore)}
          >
            <View style={[styles.toggleBox, storeInSecureStore && styles.toggleBoxActive]}>
              {storeInSecureStore && <Text style={styles.toggleCheck}>{"\u2713"}</Text>}
            </View>
            <Text style={styles.toggleLabel}>
              Remember passphrase on this device (auto-unlock)
            </Text>
          </TouchableOpacity>

          {/* Finish / Unlock / Restore button */}
          {(() => {
            const freshInvalid = vaultMode === "fresh" && passphrase.length > 0 &&
              (passphrase.length < 8 || passphrase !== passphraseConfirm);
            const unlockInvalid = (vaultMode === "vault" || vaultMode === "orphan") &&
              passphrase.trim().length === 0;
            const orphanMissingCode = vaultMode === "orphan" && recoveryCode.trim().length === 0;
            const disabled = encryptionDeriving || freshInvalid || unlockInvalid || orphanMissingCode;

            const label = encryptionDeriving
              ? "Deriving key..."
              : saving
                ? "Setting up..."
                : vaultMode === "vault"
                  ? "Unlock"
                  : vaultMode === "orphan"
                    ? "Restore vault"
                    : passphrase.trim()
                      ? "Finish with encryption"
                      : "Skip — no encryption";

            return (
              <TouchableOpacity
                style={[styles.primaryBtn, disabled && styles.disabledBtn]}
                onPress={async () => {
                  if (disabled) return;
                  setEncryptionDeriving(true);
                  await handleFinish();
                  setEncryptionDeriving(false);
                }}
                disabled={disabled}
              >
                <Text style={styles.primaryBtnText}>{label}</Text>
              </TouchableOpacity>
            );
          })()}

          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => setStep("datapath")}
          >
            <Text style={styles.backBtnText}>{"\u2190"} Back</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f0f" },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
  },
  section: { marginBottom: 40 },
  title: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 12,
  },
  subtitle: {
    color: "#aaa",
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 20,
  },
  body: {
    color: "#ccc",
    fontSize: 15,
    lineHeight: 24,
    marginBottom: 24,
  },
  hint: {
    color: "#666",
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 20,
  },
  hintSmall: {
    color: "#666",
    fontSize: 12,
    textAlign: "center",
    marginTop: 10,
  },
  input: {
    backgroundColor: "#1e1e1e",
    color: "#fff",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#333",
  },
  primaryBtn: {
    backgroundColor: "#1a73e8",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  disabledBtn: {
    opacity: 0.4,
  },
  backBtn: {
    marginTop: 16,
    alignItems: "center",
  },
  backBtnText: {
    color: "#888",
    fontSize: 14,
  },

  // Browse folder button
  browseBtn: {
    backgroundColor: "#1e1e1e",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: "center",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#444",
    borderStyle: "dashed",
  },
  browseBtnText: {
    color: "#4a9eff",
    fontSize: 15,
    fontWeight: "500",
  },

  // Test connection / folder
  testBtn: {
    backgroundColor: "#2a2a2a",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#444",
  },
  testBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  testBtnText: {
    color: "#ccc",
    fontSize: 14,
    fontWeight: "500",
  },
  testResult: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  testSuccess: {
    backgroundColor: "#0a2e0a",
    borderWidth: 1,
    borderColor: "#1a5c1a",
  },
  testError: {
    backgroundColor: "#2e0a0a",
    borderWidth: 1,
    borderColor: "#5c1a1a",
  },
  testResultIcon: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
  testResultText: {
    color: "#ccc",
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },

  // Toggle checkbox
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
    paddingVertical: 4,
  },
  toggleBox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: "#555",
    alignItems: "center",
    justifyContent: "center",
  },
  toggleBoxActive: {
    backgroundColor: "#1a73e8",
    borderColor: "#1a73e8",
  },
  toggleCheck: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  toggleLabel: {
    color: "#ccc",
    fontSize: 14,
    flex: 1,
  },
});
