/**
 * FEAT018 — Google Calendar Settings component.
 *
 * Shows connection status, last sync time, Sync Now + Disconnect buttons.
 * Can be embedded in the Settings panel (FEAT035) or used standalone.
 */
import React, { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Linking } from "react-native";
import type { Theme } from "../constants/themes";
import {
  isGoogleCalendarEnabled,
  getGoogleCalendarConfig,
  setGoogleCalendarConfig,
  setGoogleCalendarError,
} from "../integrations/registry";
import { hasRefreshToken, clearTokens, buildConsentUrl } from "../integrations/google/auth";
import { formatLocalDateTime } from "../utils/dates";

interface Props {
  theme: Theme;
  onSyncNow?: () => Promise<void>;
  onDisconnect?: () => Promise<void>;
  proxyBaseUrl?: string; // e.g. "http://localhost:3099"
}

export default function GoogleCalendarSettings({ theme, onSyncNow, onDisconnect, proxyBaseUrl }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<"disconnected" | "connected" | "error">("disconnected");
  const config = getGoogleCalendarConfig();

  useEffect(() => {
    if (config.enabled && hasRefreshToken()) {
      setStatus(config.error ? "error" : "connected");
    } else {
      setStatus("disconnected");
    }
  }, [config.enabled, config.error]);

  async function handleConnect() {
    // On web, redirect to proxy OAuth endpoint
    if (proxyBaseUrl) {
      Linking.openURL(`${proxyBaseUrl}/oauth/google/start`);
      return;
    }
    // On Capacitor, would use in-app browser — placeholder
    console.log("[gcal-settings] OAuth flow not implemented for this platform yet");
  }

  async function handleSyncNow() {
    if (syncing) return;
    setSyncing(true);
    try {
      if (onSyncNow) await onSyncNow();
      setStatus("connected");
    } catch (err: any) {
      console.error("[gcal-settings] sync failed:", err?.message);
      setStatus("error");
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect() {
    clearTokens();
    setGoogleCalendarConfig({ enabled: false, lastSyncAt: null, error: null });
    if (onDisconnect) await onDisconnect();
    setStatus("disconnected");
  }

  const lastSync = config.lastSyncAt
    ? formatLocalDateTime(config.lastSyncAt)
    : null;

  return (
    <View style={[s.card, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
      <View style={s.headerRow}>
        <Text style={s.icon}>{"\uD83D\uDCC5"}</Text>
        <Text style={[s.title, { color: theme.text }]}>Google Calendar</Text>
      </View>

      {status === "disconnected" && (
        <>
          <Text style={[s.statusText, { color: theme.textMuted }]}>Not connected</Text>
          <TouchableOpacity style={[s.btn, { backgroundColor: theme.accent }]} onPress={handleConnect}>
            <Text style={s.btnText}>Connect Google Calendar</Text>
          </TouchableOpacity>
        </>
      )}

      {status === "connected" && (
        <>
          <Text style={[s.statusText, { color: "#22c55e" }]}>
            {"\u2713"} Connected{lastSync ? ` — last sync: ${lastSync}` : ""}
          </Text>
          <Text style={[s.detail, { color: theme.textMuted }]}>
            Calendars: {config.calendarIds.join(", ")} · Window: {config.syncWindowDays} days
          </Text>
          <View style={s.btnRow}>
            <TouchableOpacity
              style={[s.btn, { backgroundColor: theme.bgTertiary, borderWidth: 1, borderColor: theme.borderLight }]}
              onPress={handleSyncNow}
              disabled={syncing}
            >
              {syncing
                ? <ActivityIndicator size="small" color={theme.textSecondary} />
                : <Text style={[s.btnTextSecondary, { color: theme.textSecondary }]}>Sync Now</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.btn, { backgroundColor: theme.bgTertiary, borderWidth: 1, borderColor: "#ef4444" }]}
              onPress={handleDisconnect}
            >
              <Text style={[s.btnTextSecondary, { color: "#ef4444" }]}>Disconnect</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {status === "error" && (
        <>
          <Text style={[s.statusText, { color: "#ef4444" }]}>
            {"\u26A0\uFE0F"} {config.error || "Connection error"}
          </Text>
          <TouchableOpacity style={[s.btn, { backgroundColor: theme.accent }]} onPress={handleConnect}>
            <Text style={s.btnText}>Reconnect</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 10 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  icon: { fontSize: 18 },
  title: { fontSize: 16, fontWeight: "700" },
  statusText: { fontSize: 13, fontWeight: "500" },
  detail: { fontSize: 11 },
  btn: { borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, alignItems: "center" },
  btnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  btnTextSecondary: { fontSize: 13, fontWeight: "500" },
  btnRow: { flexDirection: "row", gap: 8 },
});
