/**
 * FEAT018 — Integration configuration types.
 * Reusable for future integrations (Gmail, Outlook, etc.).
 */

export interface IntegrationConfig {
  enabled: boolean;
  lastSyncAt: string | null;
  error: string | null;
}

export interface GoogleCalendarConfig extends IntegrationConfig {
  calendarIds: string[];      // default: ["primary"]
  syncWindowDays: number;     // default: 14
  // refreshToken stored in secure store, NOT in this config
}

export interface IntegrationsConfig {
  googleCalendar?: GoogleCalendarConfig;
  // Future: gmail?: GmailConfig;
}

export const DEFAULT_GCAL_CONFIG: GoogleCalendarConfig = {
  enabled: false,
  lastSyncAt: null,
  error: null,
  calendarIds: ["primary"],
  syncWindowDays: 14,
};
