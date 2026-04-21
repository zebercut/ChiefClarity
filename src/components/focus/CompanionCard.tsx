import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { Theme } from "../../constants/themes";
import type { CompanionBrief } from "../../types";

interface Props {
  companion: CompanionBrief;
  theme: Theme;
}

const ENERGY_INDICATOR: Record<string, { color: string; icon: string; label: string }> = {
  high: { color: "#22c55e", icon: "\uD83D\uDFE2", label: "High" },
  medium: { color: "#f59e0b", icon: "\uD83D\uDFE1", label: "Medium" },
  low: { color: "#ef4444", icon: "\uD83D\uDD34", label: "Low" },
};

export default function CompanionCard({ companion, theme }: Props) {
  const energy = ENERGY_INDICATOR[companion.energyRead] || ENERGY_INDICATOR.medium;

  return (
    <View style={[s.card, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
      <Text style={[s.header, { color: theme.textMuted }]}>{"\uD83E\uDDE0"} YOUR COMPANION</Text>

      {/* Energy + Mood */}
      <View style={s.statusRow}>
        <Text style={s.statusLabel}>Energy: {energy.icon} <Text style={{ color: energy.color }}>{energy.label}</Text></Text>
        {companion.mood && <Text style={[s.statusLabel, { color: theme.textSecondary }]}>Mood: {companion.mood}</Text>}
      </View>

      {/* Motivation */}
      {companion.motivationNote && (
        <Text style={[s.motivation, { color: theme.text }]}>"{companion.motivationNote}"</Text>
      )}

      {/* Wins */}
      {companion.wins?.length > 0 && (
        <View style={s.section}>
          <Text style={[s.sectionLabel, { color: theme.textMuted }]}>{"\uD83C\uDFC6"} Recent wins:</Text>
          {companion.wins.map((w, i) => (
            <Text key={i} style={[s.listItem, { color: theme.textSecondary }]}>{"\u2022"} {w}</Text>
          ))}
        </View>
      )}

      {/* Patterns to watch */}
      {companion.patternsToWatch?.length > 0 && (
        <View style={s.section}>
          <Text style={[s.sectionLabel, { color: theme.textMuted }]}>{"\u26A0\uFE0F"} Watch for:</Text>
          {companion.patternsToWatch.map((p, i) => (
            <Text key={i} style={[s.listItem, { color: theme.textSecondary }]}>
              {"\u2022"} {p.pattern}
            </Text>
          ))}
        </View>
      )}

      {/* Coping suggestion */}
      {companion.copingSuggestion && (
        <View style={s.section}>
          <Text style={[s.sectionLabel, { color: theme.textMuted }]}>{"\uD83D\uDCA1"} Try:</Text>
          <Text style={[s.listItem, { color: theme.textSecondary }]}>{companion.copingSuggestion}</Text>
        </View>
      )}

      {/* Focus mantra */}
      {companion.focusMantra && (
        <View style={[s.mantra, { backgroundColor: theme.accent + "15", borderColor: theme.accent + "30" }]}>
          <Text style={[s.mantraText, { color: theme.accent }]}>
            {"\uD83C\uDFAF"} "{companion.focusMantra}"
          </Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12, gap: 10 },
  header: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2 },
  statusRow: { flexDirection: "row", gap: 16, flexWrap: "wrap" },
  statusLabel: { fontSize: 13 },
  motivation: { fontSize: 14, lineHeight: 20, fontStyle: "italic" },
  section: { gap: 3 },
  sectionLabel: { fontSize: 12, fontWeight: "600" },
  listItem: { fontSize: 13, lineHeight: 18, paddingLeft: 8 },
  mantra: { borderRadius: 8, borderWidth: 1, padding: 10, alignItems: "center", marginTop: 4 },
  mantraText: { fontSize: 14, fontWeight: "700", fontStyle: "italic" },
});
