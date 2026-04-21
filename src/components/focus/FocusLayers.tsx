import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { Theme } from "../../constants/themes";
import type { FocusBrief, PriorityItem } from "../../types";

interface Props {
  brief: FocusBrief;
  theme: Theme;
}

export default function FocusLayers({ brief, theme }: Props) {
  const daily = (brief.priorities || []).slice(0, 3).map((p) => p.title || "");
  const weekly = (brief.weeklyFocus || []).slice(0, 3);
  const monthly = (brief.monthlyFocus || []).slice(0, 3);

  // Fall back to OKR objectives for monthly if not populated
  const monthlyItems = monthly.length > 0
    ? monthly
    : (brief.okrSnapshot || []).slice(0, 3).map((o) => o.objective || "");

  if (daily.length === 0 && weekly.length === 0 && monthlyItems.length === 0) return null;

  return (
    <View style={s.container}>
      <View style={s.row}>
        <FocusColumn label="DAILY FOCUS" color="#22c55e" items={daily} theme={theme} />
        <FocusColumn label="WEEKLY FOCUS" color="#f59e0b" items={weekly} theme={theme} />
        <FocusColumn label="MONTHLY FOCUS" color="#ef4444" items={monthlyItems} theme={theme} />
      </View>
    </View>
  );
}

function FocusColumn({ label, color, items, theme }: { label: string; color: string; items: string[]; theme: Theme }) {
  if (items.length === 0) return <View style={s.col} />;
  return (
    <View style={[s.col, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
      <Text style={[s.colLabel, { color }]}>{label}</Text>
      {items.map((item, i) => (
        <View key={i} style={s.itemRow}>
          <Text style={[s.dot, { color }]}>{"\u2022"}</Text>
          <Text style={[s.itemText, { color: theme.text }]} numberOfLines={2}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  container: { marginBottom: 12 },
  row: { flexDirection: "row", gap: 8 },
  col: { flex: 1, borderRadius: 12, borderWidth: 1, padding: 12, gap: 6 },
  colLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 1, marginBottom: 4 },
  itemRow: { flexDirection: "row", gap: 6, alignItems: "flex-start" },
  dot: { fontSize: 14, lineHeight: 18 },
  itemText: { fontSize: 13, lineHeight: 18, flex: 1 },
});
