import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { Theme } from "../../constants/themes";
import type { AgendaEvent, DaySlot } from "../../types";

interface Props {
  events: AgendaEvent[];
  freeBlocks?: Array<{ start: string; end: string }>;
  today: string;
  theme: Theme;
}

const CAT_COLORS: Record<string, string> = {
  work: "#3b82f6", family: "#8b5cf6", health: "#22c55e", admin: "#a1a1aa",
  social: "#ec4899", routine: "#71717a", learning: "#06b6d4", other: "#f59e0b",
};

function formatTodayDate(today: string): string {
  const d = new Date(today + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}

export default function AgendaTimeline({ events, freeBlocks, today, theme }: Props) {
  if (!events.length) return null;
  const dateLabel = today ? formatTodayDate(today) : "";

  // Sort by time
  const sorted = [...events].sort((a, b) => (a.time || "").localeCompare(b.time || ""));

  // Interleave free blocks
  type TimelineItem = { type: "event"; event: AgendaEvent } | { type: "free"; start: string; end: string };
  const timeline: TimelineItem[] = [];
  let eventIdx = 0;
  const blocks = [...(freeBlocks || [])].sort((a, b) => a.start.localeCompare(b.start));
  let blockIdx = 0;

  while (eventIdx < sorted.length || blockIdx < blocks.length) {
    const ev = sorted[eventIdx];
    const bl = blocks[blockIdx];
    if (ev && (!bl || ev.time <= bl.start)) {
      timeline.push({ type: "event", event: ev });
      eventIdx++;
    } else if (bl) {
      timeline.push({ type: "free", start: bl.start, end: bl.end });
      blockIdx++;
    } else {
      break;
    }
  }

  return (
    <View style={s.container}>
      <Text style={[s.header, { color: theme.textMuted }]}>{"\uD83D\uDCC5"} TODAY'S AGENDA — {dateLabel}</Text>
      {timeline.map((item, i) => {
        if (item.type === "free") {
          const mins = timeDiff(item.start, item.end);
          return (
            <View key={`free-${i}`} style={[s.row, s.freeRow]}>
              <Text style={[s.time, { color: theme.textMuted }]}>{item.start}</Text>
              <Text style={[s.freeText, { color: theme.textMuted }]}>
                FREE — {mins}min
              </Text>
            </View>
          );
        }
        const ev = item.event;
        const completed = ev._completed;
        const cancelled = ev._cancelled;
        const catColor = CAT_COLORS[ev.category] || "#a1a1aa";
        const isFixed = ev.flexibility === "fixed";
        return (
          <View key={ev.id || i} style={[s.row, (completed || cancelled) && s.doneRow]}>
            <Text style={[s.time, { color: theme.textMuted }, (completed || cancelled) && s.strikethrough]}>{ev.time}</Text>
            <View style={[s.eventDot, { backgroundColor: catColor }]} />
            <Text style={[s.eventTitle, { color: theme.text }, isFixed && s.fixedText, (completed || cancelled) && s.strikethrough]} numberOfLines={1}>
              {ev.title}
              {completed ? " \u2713" : cancelled ? " \u2717" : ""}
            </Text>
            <Text style={[s.catLabel, { color: catColor }]}>
              {isFixed ? "FIXED" : ev.category}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function timeDiff(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

const s = StyleSheet.create({
  container: { marginBottom: 12 },
  header: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2, marginBottom: 8, paddingLeft: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, paddingHorizontal: 4 },
  freeRow: { opacity: 0.5 },
  doneRow: { opacity: 0.4 },
  time: { width: 42, fontSize: 12, fontWeight: "600" },
  eventDot: { width: 8, height: 8, borderRadius: 4 },
  eventTitle: { flex: 1, fontSize: 13, fontWeight: "500" },
  fixedText: { fontWeight: "700" },
  catLabel: { fontSize: 10, fontWeight: "600", textTransform: "uppercase" },
  freeText: { fontSize: 12, fontStyle: "italic" },
  strikethrough: { textDecorationLine: "line-through" },
});
