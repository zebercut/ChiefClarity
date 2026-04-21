/**
 * Centralized platform detection — lazy evaluation.
 *
 * Why lazy? In Capacitor, `window.Capacitor` is injected by the native bridge
 * AFTER the JS bundle starts evaluating. Module-level const detection runs too
 * early and misclassifies mobile as "web". By deferring to first call, the
 * bridge has time to attach.
 *
 * Platforms:
 *   node      — headless runner (no window)
 *   electron  — desktop (window.electron bridge)
 *   capacitor — mobile (window.Capacitor native bridge)
 *   web       — browser dev mode (fetch to localhost:3099 proxy)
 */

export type Platform = "node" | "electron" | "capacitor" | "web";

let _cached: Platform | null = null;

// Use globalThis to avoid TS "Cannot find name 'window'" in non-DOM envs
const _g = globalThis as any;

export function getPlatform(): Platform {
  if (_cached) return _cached;

  // Node (headless): no window, has process.versions.node
  if (typeof _g.window === "undefined" && typeof process !== "undefined" && !!process.versions?.node) {
    _cached = "node";
    return _cached;
  }

  // Electron: window.electron bridge exists
  if (typeof _g.window !== "undefined" && !!_g.window.electron) {
    _cached = "electron";
    return _cached;
  }

  // Capacitor: window.Capacitor native bridge exists
  if (typeof _g.window !== "undefined" && !!_g.window.Capacitor?.isNativePlatform?.()) {
    _cached = "capacitor";
    return _cached;
  }

  // Web: has document (browser)
  if (typeof _g.document !== "undefined") {
    _cached = "web";
    return _cached;
  }

  // Fallback — shouldn't happen, treat as web
  _cached = "web";
  return _cached;
}

export const isNode = () => getPlatform() === "node";
export const isElectron = () => getPlatform() === "electron";
export const isCapacitor = () => getPlatform() === "capacitor";
export const isWeb = () => getPlatform() === "web";
