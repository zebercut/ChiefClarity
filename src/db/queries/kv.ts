import { getDb } from "../index";
import type { UserProfile, UserLifestyle } from "../../types";

// ── Generic key-value helpers ──────────────────────────────────────

async function loadKv(table: string): Promise<Record<string, unknown>> {
  const db = getDb();
  const rows = await db.execute(`SELECT key, value FROM ${table}`);
  const obj: Record<string, unknown> = {};
  for (const r of rows.rows) {
    try {
      obj[r.key as string] = JSON.parse(r.value as string);
    } catch {
      obj[r.key as string] = r.value;
    }
  }
  return obj;
}

async function saveKv(
  table: string,
  obj: Record<string, unknown>
): Promise<void> {
  const db = getDb();
  await db.execute(`DELETE FROM ${table}`);
  for (const [key, value] of Object.entries(obj)) {
    await db.execute({
      sql: `INSERT INTO ${table} (key, value) VALUES (?, ?)`,
      args: [key, JSON.stringify(value)],
    });
  }
}

// ── UserProfile ────────────────────────────────────────────────────

const DEFAULT_PROFILE: UserProfile = {
  name: "",
  timezone: "America/Toronto",
  location: "",
  language: "en",
  familyMembers: [],
};

export async function loadProfile(): Promise<UserProfile> {
  const kv = await loadKv("user_profile");
  return {
    name: (kv.name as string) ?? DEFAULT_PROFILE.name,
    timezone: (kv.timezone as string) ?? DEFAULT_PROFILE.timezone,
    location: (kv.location as string) ?? DEFAULT_PROFILE.location,
    language: (kv.language as string) ?? DEFAULT_PROFILE.language,
    familyMembers: (kv.familyMembers as UserProfile["familyMembers"]) ?? [],
  };
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  await saveKv("user_profile", profile as unknown as Record<string, unknown>);
}

// ── UserLifestyle ──────────────────────────────────────────────────

const DEFAULT_LIFESTYLE: UserLifestyle = {
  sleepWake: { wake: "07:00", sleep: "23:00" },
  weekdaySchedule: [],
  weekendSchedule: { capacity: "50%", saturday: "", sunday: "", notes: "" },
  weekStartsOn: "monday",
  availableWorkWindows: [],
  preferences: {},
};

export async function loadLifestyle(): Promise<UserLifestyle> {
  const kv = await loadKv("user_lifestyle");
  return {
    sleepWake: (kv.sleepWake as UserLifestyle["sleepWake"]) ?? DEFAULT_LIFESTYLE.sleepWake,
    weekdaySchedule: (kv.weekdaySchedule as UserLifestyle["weekdaySchedule"]) ?? [],
    weekendSchedule: (kv.weekendSchedule as UserLifestyle["weekendSchedule"]) ?? DEFAULT_LIFESTYLE.weekendSchedule,
    weekStartsOn: (kv.weekStartsOn as string) ?? "monday",
    availableWorkWindows: (kv.availableWorkWindows as UserLifestyle["availableWorkWindows"]) ?? [],
    preferences: (kv.preferences as Record<string, unknown>) ?? {},
  };
}

export async function saveLifestyle(lifestyle: UserLifestyle): Promise<void> {
  await saveKv("user_lifestyle", lifestyle as unknown as Record<string, unknown>);
}

// ── Generic KV for proactive_state, tips_state, etc. ──────────────

export async function loadKvGeneric(table: string): Promise<Record<string, unknown>> {
  return loadKv(table);
}

export async function saveKvGeneric(table: string, obj: Record<string, unknown>): Promise<void> {
  return saveKv(table, obj);
}
