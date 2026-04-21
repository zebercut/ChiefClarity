import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { Theme } from "../../constants/themes";
import type { RiskItem } from "../../types";

interface Props {
  risks: RiskItem[];
  theme: Theme;
}

const SEV_CONFIG: Record<string, { color: string; icon: string }> = {
  high: { color: "#ef4444", icon: "\uD83D\uDD34" },
  medium: { color: "#f59e0b", icon: "\uD83D\uDFE1" },
  low: { color: "#22c55e", icon: "\uD83D\uDFE2" },
};

export default function RisksCard({ risks, theme }: Props) {
  if (!risks?.length) return null;

  return (
    <View style={[s.card, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
      <Text style={[s.header, { color: theme.textMuted }]}>{"\u26A0\uFE0F"} RISKS & BLOCKERS</Text>
      {risks.map((risk, i) => {
        const sev = SEV_CONFIG[risk.severity || "medium"] || SEV_CONFIG.medium;
        return (
          <View key={i} style={[s.riskRow, { borderLeftColor: sev.color }]}>
            <Text style={[s.riskSev, { color: sev.color }]}>
              {sev.icon} {(risk.severity || "medium").toUpperCase()}
            </Text>
            <Text style={[s.riskText, { color: theme.text }]} numberOfLines={2}>
              {risk.title || ""}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12, gap: 8 },
  header: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2 },
  riskRow: { borderLeftWidth: 3, paddingLeft: 10, paddingVertical: 4, gap: 2 },
  riskSev: { fontSize: 10, fontWeight: "700" },
  riskText: { fontSize: 13, lineHeight: 18 },
});
