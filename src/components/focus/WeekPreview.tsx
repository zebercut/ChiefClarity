import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import type { Theme } from "../../constants/themes";
import type { CalendarEvent, RecurringTask } from "../../types";

interface Props {
  events: CalendarEvent[];
  recurringTasks: RecurringTask[];
  today: string;
  theme: Theme;
}

interface DayDetail {
  label: string;
  date: string;
  fixedEvents: Array<{ id: string; title: string; time: string }>;
  recurringItems: Array<{ id: string; title: string; category: string; priority: string }>;
}

const PRIO_DOT: Record<string, string> = { high: "\uD83D\uDD34", medium: "\uD83D\uDFE1", low: "\uD83D\uDFE2" };
const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export default function WeekPreview({ events, recurringTasks, today, theme }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const preview = buildPreview(events, recurringTasks, today);
  if (preview.length === 0) return null;

  return (
    <View style={s.container}>
      <TouchableOpacity
        style={s.headerRow}
        onPress={() => setExpanded(!expanded)}
      >
        <Text style={[s.header, { color: theme.textMuted }]}>
          {expanded ? "\u25BC" : "\u25B6"} NEXT 7 DAYS
        </Text>
      </TouchableOpacity>
      {expanded && (
        <View style={[s.body, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
          {preview.map((day, i) => {
            const isOpen = expandedDay === day.date;
            const hasContent = day.fixedEvents.length > 0 || day.recurringItems.length > 0;
            const summary = buildSummary(day);
            return (
              <View key={day.date}>
                <TouchableOpacity
                  style={[s.dayRow, i > 0 && { borderTopColor: theme.border, borderTopWidth: 1 }]}
                  onPress={() => hasContent && setExpandedDay(isOpen ? null : day.date)}
                  activeOpacity={hasContent ? 0.6 : 1}
                >
                  <Text style={[s.dayLabel, { color: theme.text }]}>
                    {hasContent ? (isOpen ? "\u25BC " : "\u25B6 ") : "  "}{day.label}
                  </Text>
                  <Text style={[s.daySummary, { color: theme.textMuted }]}>{summary}</Text>
                </TouchableOpacity>

                {isOpen && (
                  <View style={[s.dayDetail, { borderTopColor: theme.border }]}>
                    {/* Fixed calendar events — show with time */}
                    {day.fixedEvents.map((ev) => (
                      <View key={ev.id} style={s.detailRow}>
                        <Text style={[s.detailTime, { color: theme.accent }]}>{ev.time || "\u2014"}</Text>
                        <Text style={[s.detailTitle, { color: theme.text }]} numberOfLines={1}>{ev.title}</Text>
                        <Text style={[s.detailTag, { color: theme.textMuted }]}>event</Text>
                      </View>
                    ))}
                    {/* Recurring tasks — no time, just what needs to be done */}
                    {day.recurringItems.map((rt) => (
                      <View key={rt.id} style={s.detailRow}>
                        <Text style={s.detailTime}>{PRIO_DOT[rt.priority] || "\u25CB"}</Text>
                        <Text style={[s.detailTitle, { color: theme.text }]} numberOfLines={1}>{rt.title}</Text>
                        <Text style={[s.detailTag, { color: theme.textMuted }]}>{rt.category || "task"}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function buildSummary(day: DayDetail): string {
  const parts: string[] = [];
  if (day.fixedEvents.length > 0) parts.push(`${day.fixedEvents.length} event${day.fixedEvents.length > 1 ? "s" : ""}`);
  if (day.recurringItems.length > 0) parts.push(`${day.recurringItems.length} task${day.recurringItems.length > 1 ? "s" : ""}`);
  return parts.length > 0 ? parts.join(", ") : "Clear";
}

function buildPreview(
  events: CalendarEvent[],
  recurringTasks: RecurringTask[],
  today: string
): DayDetail[] {
  const activeRecurring = recurringTasks.filter((r) => r.active);
  const result: DayDetail[] = [];

  for (let i = 1; i <= 7; i++) {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayName = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
    const dayOfWeek = DAY_NAMES[d.getUTCDay()];
    const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;

    // Fixed calendar events for this day
    const fixedEvents = events
      .filter((e) => !e.archived && e.status !== "cancelled" && e.datetime?.startsWith(dateStr))
      .map((e) => ({ id: e.id, title: e.title, time: e.datetime?.slice(11, 16) || "" }))
      .sort((a, b) => a.time.localeCompare(b.time));

    // Recurring tasks that apply to this day
    const recurringItems = activeRecurring
      .filter((r) => {
        const sched = r.schedule;
        if (sched.excludeDates?.includes(dateStr)) return false;
        if (sched.type === "daily") return true;
        if (sched.type === "weekdays") return !isWeekend;
        if (sched.type === "weekly" && sched.days) return sched.days.includes(dayOfWeek);
        if (sched.type === "custom" && sched.days) return sched.days.includes(dayOfWeek);
        return false;
      })
      .map((r) => ({ id: r.id, title: r.title, category: r.category, priority: r.priority }));

    result.push({ label: dayName, date: dateStr, fixedEvents, recurringItems });
  }
  return result;
}

const s = StyleSheet.create({
  container: { marginBottom: 12 },
  headerRow: { paddingVertical: 10, paddingHorizontal: 4 },
  header: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2 },
  body: { borderRadius: 10, borderWidth: 1, overflow: "hidden" },
  dayRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, paddingHorizontal: 14 },
  dayLabel: { fontSize: 13, fontWeight: "600" },
  daySummary: { fontSize: 12 },
  dayDetail: { paddingHorizontal: 14, paddingBottom: 10, gap: 4, borderTopWidth: 1 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 },
  detailTime: { width: 40, fontSize: 11, fontWeight: "600" },
  detailTitle: { flex: 1, fontSize: 12 },
  detailTag: { fontSize: 10, textTransform: "uppercase" },
});
