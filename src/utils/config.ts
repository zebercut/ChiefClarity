/**
 * App config persistence — stores API key and data folder path.
 *
 * On mobile: uses expo-secure-store (encrypted at rest via Keychain/Keystore).
 * On web: falls back to AsyncStorage (no SecureStore API available).
 * On Electron: uses a local JSON file in the app directory.
 *
 * This is intentionally separate from the data folder — it's what POINTS
 * to the data folder, so it can't live inside it.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { isWeb } from "./platform";
import type { AppConfig } from "../types";

const CONFIG_KEY = "chief_clarity_config";

/**
 * Get the secure storage adapter.
 * Uses expo-secure-store on mobile (encrypted), AsyncStorage on web (fallback).
 */
async function secureGet(key: string): Promise<string | null> {
  if (isWeb()) {
    return AsyncStorage.getItem(key);
  }
  try {
    const SecureStore = await import("expo-secure-store");
    return await SecureStore.getItemAsync(key);
  } catch {
    // SecureStore unavailable (e.g. older Expo) — fall back
    return AsyncStorage.getItem(key);
  }
}

async function secureSet(key: string, value: string): Promise<void> {
  if (isWeb()) {
    await AsyncStorage.setItem(key, value);
    return;
  }
  try {
    const SecureStore = await import("expo-secure-store");
    await SecureStore.setItemAsync(key, value);
  } catch {
    await AsyncStorage.setItem(key, value);
  }
}

async function secureDelete(key: string): Promise<void> {
  if (isWeb()) {
    await AsyncStorage.removeItem(key);
    return;
  }
  try {
    const SecureStore = await import("expo-secure-store");
    await SecureStore.deleteItemAsync(key);
  } catch {
    await AsyncStorage.removeItem(key);
  }
}

export async function loadConfig(): Promise<AppConfig | null> {
  try {
    const raw = await secureGet(CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppConfig;
    if (!parsed.anthropicApiKey || !parsed.dataFolderPath) return null;
    if (!parsed.theme) parsed.theme = "dark";
    return parsed;
  } catch {
    return null;
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await secureSet(CONFIG_KEY, JSON.stringify(config));
}

export async function clearConfig(): Promise<void> {
  await secureDelete(CONFIG_KEY);
}

// --- Encryption passphrase in secure store ---

const PASSPHRASE_KEY = "chief_clarity_passphrase";

export async function loadPassphrase(): Promise<string | null> {
  return secureGet(PASSPHRASE_KEY);
}

export async function savePassphrase(passphrase: string): Promise<void> {
  await secureSet(PASSPHRASE_KEY, passphrase);
}

export async function clearPassphrase(): Promise<void> {
  await secureDelete(PASSPHRASE_KEY);
}
