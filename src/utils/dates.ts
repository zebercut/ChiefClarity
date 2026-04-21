import type { AppState } from "../types";

/**
 * Canonical date utilities — ALWAYS use these instead of raw Date() calls.
 *
 * All dates are in the user's timezone (from state.userProfile.timezone).
 * Never use new Date().toISOString().slice(0, 10) for "today" — that's UTC.
 * Never use new Date().toLocaleDateString("en-CA") without timeZone — that's system locale.
 */

let _defaultTz: string | undefined;

/** Set the default timezone for display formatters that lack access to state. */
export function setDefaultTimezone(tz: string): void {
  _defaultTz = tz;
}

/** Get the cached default timezone. */
export function getDefaultTimezone(): string | undefined {
  return _defaultTz;
}

/**
 * Get today's date in user's timezone. YYYY-MM-DD format.
 * Primary source: hotContext.today (set by summarizer with user timezone).
 * Fallback: computed from userProfile.timezone.
 */
export function getUserToday(state: AppState): string {
  if (state.userProfile?.timezone) _defaultTz = state.userProfile.timezone;
  if (state.hotContext?.today) return state.hotContext.today;
  const tz = state.userProfile?.timezone || undefined;
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

/**
 * Get current timestamp in user's timezone-aware ISO format.
 * Use this instead of new Date().toISOString() when the date portion matters.
 */
export function getUserNow(state: AppState): string {
  if (state.userProfile?.timezone) _defaultTz = state.userProfile.timezone;
  const tz = state.userProfile?.timezone || undefined;
  const now = new Date();
  const date = now.toLocaleDateString("en-CA", { timeZone: tz });
  const time = now.toLocaleTimeString("en-GB", { timeZone: tz, hour12: false });
  return `${date}T${time}`;
}

/**
 * Get today's date from a timezone string (without full AppState).
 * For use in places that don't have access to state.
 */
export function getTodayFromTz(timezone?: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: timezone || undefined });
}

/**
 * Current timestamp as a LOCAL ISO string in the user's timezone.
 * Returns "YYYY-MM-DDTHH:MM:SS" (no Z suffix — formatLocalTime treats it as local).
 *
 * Use this instead of `new Date().toISOString()` anywhere a timestamp is stored
 * and later compared against user-timezone dates or displayed with .slice(0,10).
 * Does NOT require AppState — uses the cached _defaultTz set during loadState().
 */
export function nowLocalIso(): string {
  const tz = _defaultTz || undefined;
  const now = new Date();
  const date = now.toLocaleDateString("en-CA", { timeZone: tz });
  const time = now.toLocaleTimeString("en-GB", { timeZone: tz, hour12: false });
  return `${date}T${time}`;
}

/**
 * Check if a due date is overdue relative to today in the user's timezone.
 */
export function isOverdue(due: string, today: string): boolean {
  if (!due) return false;
  return due.slice(0, 10) < today;
}

/**
 * Compute a date offset from a base date string. Returns YYYY-MM-DD.
 * Uses noon UTC to avoid both DST and timezone boundary issues.
 */
export function dateOffset(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Format a task `due` string into a short, human-friendly label relative to
 * `today`. Returns:
 *   - "" when there is no due date, OR when due is today and has no time
 *     (the section header already says TODAY)
 *   - "2:00 PM" when due is today AND has a time component
 *   - "Tomorrow" when due is the next day
 *   - "Friday" when due is within the next 6 days
 *   - "Apr 15" when due is later this year
 *   - "Apr 15, 2027" when due is in another year
 *
 * Accepts both bare YYYY-MM-DD and full ISO strings ("2026-04-06T14:00").
 */
export function formatFriendlyDate(due: string, today: string): string {
  if (!due) return "";
  const dueDate = due.slice(0, 10);
  const time = formatTime(due);

  if (dueDate === today) return time;

  const tomorrow = dateOffset(today, 1);
  if (dueDate === tomorrow) return "Tomorrow";

  for (let i = 2; i < 7; i++) {
    if (dueDate === dateOffset(today, i)) {
      return new Date(dueDate + "T12:00:00Z").toLocaleDateString("en-US", {
        weekday: "long",
      });
    }
  }

  const sameYear = dueDate.slice(0, 4) === today.slice(0, 4);
  return new Date(dueDate + "T12:00:00Z").toLocaleDateString(
    "en-US",
    sameYear
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" }
  );
}

const HAS_TZ = /Z$|[+-]\d{2}:\d{2}$/;

/** Canonical weekday name map — normalizes abbreviations and casing to lowercase full names. */
export const WEEKDAY_MAP: Record<string, string> = {
  monday: "monday", tuesday: "tuesday", wednesday: "wednesday",
  thursday: "thursday", friday: "friday", saturday: "saturday", sunday: "sunday",
  mon: "monday", tue: "tuesday", wed: "wednesday", thu: "thursday",
  fri: "friday", sat: "saturday", sun: "sunday",
};

/**
 * Extract and format time from an ISO string → "H:MM AM/PM".
 * Handles both UTC strings (with Z or offset) and local-time strings (no suffix).
 * UTC strings are converted using _defaultTz; local strings use regex extraction.
 */
export function formatLocalTime(isoStr: string): string {
  if (!isoStr) return "";
  if (isoStr.length <= 8 && !isoStr.includes("T") && !isoStr.includes("-")) return isoStr;

  // UTC string — parse and convert to user timezone
  if (HAS_TZ.test(isoStr)) {
    try {
      const d = new Date(isoStr);
      if (!isNaN(d.getTime())) {
        return d.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: _defaultTz || undefined,
        });
      }
    } catch {}
  }

  // Local-time string — extract directly
  const m = isoStr.match(/T(\d{2}):(\d{2})/);
  if (!m) return "";
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${min} ${ampm}`;
}

/**
 * Format an ISO string as "Mon D, H:MM AM/PM".
 * Handles both UTC and local-time strings.
 */
export function formatLocalDateTime(isoStr: string): string {
  if (!isoStr) return "";
  const dateStr = isoStr.slice(0, 10);
  if (!dateStr) return isoStr;

  // For the date portion: if UTC, parse and extract date in user timezone
  let datePart: string;
  if (HAS_TZ.test(isoStr) && _defaultTz) {
    const d = new Date(isoStr);
    datePart = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: _defaultTz });
  } else {
    const d = new Date(dateStr + "T12:00:00Z");
    datePart = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }

  const timePart = formatLocalTime(isoStr);
  return timePart ? `${datePart}, ${timePart}` : datePart;
}

/**
 * Current time as "H:MM AM/PM" in the specified timezone.
 * Use for generating display timestamps at creation time.
 */
export function nowTimeStr(tz?: string): string {
  return new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: (tz || _defaultTz) || undefined,
  });
}

/**
 * Get the current hour (0-23) in the user's timezone.
 */
export function getUserHour(tz?: string): number {
  const h = new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    hour12: false,
    timeZone: (tz || _defaultTz) || undefined,
  });
  return parseInt(h, 10);
}

function formatTime(due: string): string {
  return formatLocalTime(due);
}
