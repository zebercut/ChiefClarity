import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import type { Theme } from "../../constants/themes";
import type { MindsetCard } from "../../types";
import { renderBold } from "../../utils/textFormatting";

interface Props {
  cards: MindsetCard[];
  theme: Theme;
}

const DEFAULT_CARDS: MindsetCard[] = [
  { icon: "\uD83D\uDC38", title: "EAT THE FROG", body: "Do your hardest task first while willpower is highest." },
  { icon: "\u23F1\uFE0F", title: "2-MINUTE RULE", body: "If a task takes less than 2 minutes, do it now." },
  { icon: "\uD83E\uDDD8", title: "TRANSITION RITUAL", body: "Before a big meeting, take 3 deep breaths to reset." },
];

export default function MindsetCards({ cards, theme }: Props) {
  const items = cards.length >= 2 ? cards : DEFAULT_CARDS.slice(0, 3);

  return (
    <View style={s.container}>
      <Text style={[s.header, { color: theme.textMuted }]}>{"\u2699\uFE0F"} MINDSET</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
        {items.map((card, i) => (
          <View key={i} style={[s.card, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
            <View style={s.cardHeader}>
              <Text style={s.icon}>{card.icon}</Text>
              <Text style={[s.title, { color: theme.text }]}>{card.title}</Text>
            </View>
            <Text style={[s.body, { color: theme.textSecondary }]}>{renderBold(card.body, theme.text)}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { marginBottom: 12 },
  header: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2, marginBottom: 8, paddingLeft: 2 },
  row: { gap: 10, paddingRight: 16 },
  card: { width: 200, borderRadius: 12, borderWidth: 1, padding: 14, gap: 8 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  icon: { fontSize: 16 },
  title: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5 },
  body: { fontSize: 13, lineHeight: 18 },
});
