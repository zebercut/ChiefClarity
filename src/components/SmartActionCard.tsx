import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import type { Theme } from "../constants/themes";
import type { SmartAction, WriteSummary } from "../types";

interface SmartActionProps {
  action: SmartAction;
  theme: Theme;
  onAction: (payload: string, isDirect?: boolean, targetId?: string) => void;
}

const TYPE_ICONS: Record<string, string> = {
  task_followup: "\u{1F4CB}",
  question: "\u2753",
  advice: "\u{1F4A1}",
  action: "\u26A1",
  generic: "\u203A",
};

const TYPE_COLORS: Record<string, string> = {
  task_followup: "#6366f1",
  question: "#06b6d4",
  advice: "#f59e0b",
  action: "#22c55e",
  generic: "#71717a",
};

export function SmartActionCard({ action, theme, onAction }: SmartActionProps) {
  const icon = TYPE_ICONS[action.type] || "\u203A";
  const accentColor = TYPE_COLORS[action.type] || theme.textMuted;

  return (
    <View style={[sc.card, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight, borderLeftColor: accentColor }]}>
      <Text style={[sc.cardText, { color: theme.text }]}>
        {icon} {action.text}
      </Text>
      <View style={sc.btnRow}>
        {action.quickActions.map((qa, j) => (
          <TouchableOpacity
            key={j}
            style={[sc.btn, { backgroundColor: theme.bgTertiary, borderColor: theme.borderLight }]}
            onPress={() => onAction(qa.payload, qa.isDirect, qa.targetId)}
          >
            <Text style={[sc.btnText, { color: qa.isDirect ? theme.textSecondary : accentColor }]}>{qa.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

interface WriteSummaryProps {
  writes: WriteSummary[];
  theme: Theme;
}

export function WriteSummarySection({ writes, theme }: WriteSummaryProps) {
  if (writes.length === 0) return null;

  return (
    <View style={[sc.writesSection, { borderTopColor: theme.borderLight }]}>
      <Text style={[sc.writesTitle, { color: theme.textMuted }]}>Changes made:</Text>
      {writes.map((w, i) => (
        <View key={i} style={sc.writeRow}>
          <Text style={[sc.writeAction, { color: w.action === "Created" ? "#22c55e" : w.action === "Updated" ? "#6366f1" : "#ef4444" }]}>
            {w.action === "Created" ? "\u002B" : w.action === "Updated" ? "\u270E" : "\u2212"}
          </Text>
          <Text style={[sc.writeText, { color: theme.textSecondary }]}>{w.title}</Text>
        </View>
      ))}
    </View>
  );
}

const sc = StyleSheet.create({
  // Smart action card
  card: {
    borderRadius: 10, borderWidth: 1, borderLeftWidth: 3,
    padding: 10, marginTop: 6,
  },
  cardText: { fontSize: 13, lineHeight: 19, marginBottom: 6 },
  btnRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  btn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  btnText: { fontSize: 12, fontWeight: "600" },

  // Write summary
  writesSection: { marginTop: 8, paddingTop: 8, borderTopWidth: 1 },
  writesTitle: { fontSize: 11, fontWeight: "600", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },
  writeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginVertical: 1 },
  writeAction: { fontSize: 14, fontWeight: "700", width: 16, textAlign: "center" },
  writeText: { fontSize: 12, flex: 1 },
});
