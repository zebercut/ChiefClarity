/**
 * FEAT018 — Integration registry.
 * Manages enabled/disabled state for all integrations.
 */
import type { IntegrationsConfig, GoogleCalendarConfig } from "./types";
import { DEFAULT_GCAL_CONFIG } from "./types";

let _config: IntegrationsConfig = {};

export function loadIntegrationsConfig(config: IntegrationsConfig | undefined): void {
  _config = config || {};
}

export function getIntegrationsConfig(): IntegrationsConfig {
  return _config;
}

export function getGoogleCalendarConfig(): GoogleCalendarConfig {
  return _config.googleCalendar || { ...DEFAULT_GCAL_CONFIG };
}

export function isGoogleCalendarEnabled(): boolean {
  return _config.googleCalendar?.enabled === true;
}

export function setGoogleCalendarConfig(
  update: Partial<GoogleCalendarConfig>
): GoogleCalendarConfig {
  const current = getGoogleCalendarConfig();
  const updated = { ...current, ...update };
  _config.googleCalendar = updated;
  return updated;
}

export function setGoogleCalendarError(error: string | null): void {
  if (!_config.googleCalendar) _config.googleCalendar = { ...DEFAULT_GCAL_CONFIG };
  _config.googleCalendar.error = error;
}
