import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { Theme } from "../../constants/themes";
import type { OkrSnapshotItem } from "../../types";

interface Props {
  okrSnapshot: OkrSnapshotItem[];
  theme: Theme;
}

export default function OkrCard({ okrSnapshot, theme }: Props) {
  if (!okrSnapshot?.length) return null;

  return (
    <View style={[s.card, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
      <Text style={[s.header, { color: theme.textMuted }]}>{"\uD83C\uDFAF"} OKR PROGRESS</Text>
      {okrSnapshot.map((obj, i) => {
        const activity = obj.activityProgress ?? 0;
        const outcome = obj.outcomeProgress ?? 0;
        return (
          <View key={i} style={s.objRow}>
            <Text style={[s.objTitle, { color: theme.text }]}>{obj.objective || `Objective ${i + 1}`}</Text>
            <ProgressBar label="Activity" value={activity} color="#3b82f6" theme={theme} />
            <ProgressBar label="Outcome" value={outcome} color="#22c55e" theme={theme} />
          </View>
        );
      })}
    </View>
  );
}

function ProgressBar({ label, value, color, theme }: { label: string; value: number; color: string; theme: Theme }) {
  return (
    <View style={s.barRow}>
      <Text style={[s.barLabel, { color: theme.textMuted }]}>{label}</Text>
      <View style={[s.barBg, { backgroundColor: theme.bgTertiary }]}>
        <View style={[s.barFill, { width: `${Math.min(value, 100)}%`, backgroundColor: color }]} />
      </View>
      <Text style={[s.barPct, { color: theme.textMuted }]}>{value}%</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12, gap: 12 },
  header: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2 },
  objRow: { gap: 6 },
  objTitle: { fontSize: 14, fontWeight: "600" },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  barLabel: { fontSize: 11, width: 55 },
  barBg: { flex: 1, height: 8, borderRadius: 4, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 4 },
  barPct: { fontSize: 11, width: 30, textAlign: "right" },
});
