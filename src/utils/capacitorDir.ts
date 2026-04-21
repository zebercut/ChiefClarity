/**
 * Capacitor Directory selection — shared module to avoid circular deps.
 *
 * Capacitor's Filesystem plugin requires a Directory enum value alongside
 * each path. Most data lives in app-private Documents, but folders located
 * at /storage/emulated/<X>/* require Directory.ExternalStorage AND the
 * MANAGE_EXTERNAL_STORAGE permission granted at runtime.
 *
 * filesystem.ts decides which directory to use based on the user's data
 * folder path (in setDataRoot). vault.ts and other consumers need the
 * same value, so we keep the choice in this small standalone module to
 * avoid filesystem.ts ↔ vault.ts circular imports.
 */

export type CapacitorDirectoryName = "Documents" | "ExternalStorage";

let _name: CapacitorDirectoryName = "Documents";

export function setCapacitorDirectoryName(name: CapacitorDirectoryName): void {
  _name = name;
}

export function getCapacitorDirectoryName(): CapacitorDirectoryName {
  return _name;
}

/**
 * Resolve the active directory name to the actual Capacitor Directory enum
 * value. Async because the import is dynamic.
 */
export async function getCapacitorDirectory(): Promise<any> {
  const { Directory } = await import("@capacitor/filesystem");
  return _name === "ExternalStorage" ? Directory.ExternalStorage : Directory.Documents;
}
