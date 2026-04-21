import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { Theme } from "../../constants/themes";
import type { FocusBrief } from "../../types";
import { renderBold } from "../../utils/textFormatting";
import { formatLocalTime, getUserHour, getDefaultTimezone } from "../../utils/dates";

interface Props {
  brief: FocusBrief;
  userName: string;
  today: string;
  theme: Theme;
}

export default function SnapshotCard({ brief, userName, today, theme }: Props) {
  const greeting = getGreeting();
  const energy = brief.companion?.energyRead || "medium";
  const energyTip = energy === "high"
    ? "Front-load the hard thinking before noon."
    : energy === "low"
    ? "Start easy. Build momentum before tackling the big items."
    : "Pace yourself. Alternate deep work with lighter tasks.";

  // Parse executiveSummary bullets (markdown bold → bold spans done in render)
  const bullets = (brief.executiveSummary || "")
    .split("\n")
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);

  const todayFormatted = formatDate(today);
  const generatedAt = brief.generatedAt ? formatLocalTime(brief.generatedAt) : "";
  const changelog = brief._changelog || [];
  const lastPatch = changelog.length > 0 ? formatLocalTime(changelog[changelog.length - 1].timestamp) : "";

  return (
    <View style={[s.card, { backgroundColor: theme.accent + "18", borderColor: theme.accent + "40" }]}>
      <Text style={[s.dateLabel, { color: theme.textMuted }]}>{todayFormatted}</Text>
      <Text style={[s.greeting, { color: theme.accent }]}>
        {"\u2728"} {greeting}, {userName || "there"}!
      </Text>
      <View style={s.bullets}>
        {bullets.map((b, i) => (
          <Text key={i} style={[s.bullet, { color: theme.text }]}>
            {renderBold(b, theme.accent)}
          </Text>
        ))}
      </View>
      <View style={[s.energyRow, { borderTopColor: theme.border }]}>
        <Text style={[s.energyIcon]}>
          {energy === "high" ? "\u26A1" : energy === "low" ? "\uD83D\uDD0B" : "\u2600\uFE0F"}
        </Text>
        <Text style={[s.energyText, { color: theme.textSecondary }]}>
          {energyTip}
        </Text>
      </View>
      <Text style={[s.briefMeta, { color: theme.textMuted }]}>
        {generatedAt ? `Plan created ${generatedAt}` : ""}
        {lastPatch ? ` · Updated ${lastPatch}` : ""}
      </Text>
    </View>
  );
}

function getGreeting(): string {
  const h = getUserHour();
  if (h < 12) return "GOOD MORNING";
  if (h < 17) return "GOOD AFTERNOON";
  return "GOOD EVENING";
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: getDefaultTimezone() || "UTC" });
}

const s = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 20, marginBottom: 12 },
  dateLabel: { fontSize: 13, fontWeight: "600", marginBottom: 4 },
  greeting: { fontSize: 12, fontWeight: "800", letterSpacing: 1.5, marginBottom: 12 },
  briefMeta: { fontSize: 10, marginTop: 8 },
  bullets: { gap: 6, marginBottom: 12 },
  bullet: { fontSize: 15, lineHeight: 22 },
  energyRow: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, paddingTop: 10 },
  energyIcon: { fontSize: 14 },
  energyText: { fontSize: 13, fontStyle: "italic", flex: 1 },
});
