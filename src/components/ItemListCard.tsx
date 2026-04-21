import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import type { Theme } from "../constants/themes";
import type { ActionItem, AppState, Task, CalendarEvent } from "../types";

interface Props {
  items: ActionItem[];
  state: AppState;
  theme: Theme;
  onDirectAction: (actionType: string, targetId: string) => Promise<{ success: boolean; message: string }>;
}

const INITIAL_SHOW = 8;
const LOAD_MORE = 10;

const ACTION_LABELS: Record<string, { label: string; icon: string }> = {
  mark_done: { label: "Done", icon: "\u2713" },
  delete: { label: "Drop", icon: "\u2717" },
  reschedule_tomorrow: { label: "Tomorrow", icon: "\u{1F4C5}" },
  reschedule_next_week: { label: "Next week", icon: "\u{1F4C6}" },
  cancel: { label: "Cancel", icon: "\u2717" },
};

const ALL_TASK_ACTIONS = ["mark_done", "reschedule_tomorrow", "reschedule_next_week", "delete"];
const ALL_EVENT_ACTIONS = ["mark_done", "cancel", "reschedule_tomorrow"];

export default function ItemListCard({ items, state, theme, onDirectAction }: Props) {
  const [showCount, setShowCount] = useState(INITIAL_SHOW);
  const [actedOn, setActedOn] = useState<Map<string, string>>(new Map());
  const [actionInFlight, setActionInFlight] = useState(false);
  const [batchApplied, setBatchApplied] = useState(false);

  // Items that have a suggestedAction and haven't been acted on yet
  const pendingSuggestions = items.filter(
    (i) => i.suggestedAction && !actedOn.has(i.id)
  );

  // Paginate
  const allItems = items.slice(0, showCount);
  const hasMore = items.length > showCount;

  async function handleAction(actionType: string, itemId: string) {
    if (actionInFlight) return;
    setActionInFlight(true);
    try {
      const result = await onDirectAction(actionType, itemId);
      setActedOn((prev) => new Map(prev).set(itemId, result.success ? result.message : "Failed"));
    } finally {
      setActionInFlight(false);
    }
  }

  async function handleBatchApply() {
    if (actionInFlight || pendingSuggestions.length === 0) return;
    setActionInFlight(true);
    try {
      for (const item of pendingSuggestions) {
        const result = await onDirectAction(item.suggestedAction!, item.id);
        setActedOn((prev) => new Map(prev).set(item.id, result.success ? result.message : "Failed"));
      }
      setBatchApplied(true);
    } finally {
      setActionInFlight(false);
    }
  }

  function lookupTask(id: string): Task | undefined {
    return state.tasks.tasks.find((t) => t.id === id);
  }

  function lookupEvent(id: string): CalendarEvent | undefined {
    return state.calendar.events.find((e) => e.id === id);
  }

  function renderItem(item: ActionItem) {
    const done = actedOn.has(item.id);
    const doneMsg = actedOn.get(item.id);

    // Look up real data, fall back to snapshot fields for history
    const task = item.type === "task" ? lookupTask(item.id) : undefined;
    const event = item.type === "event" ? lookupEvent(item.id) : undefined;
    const title = task?.title || event?.title || (item as any)._title || item.id;
    const priority = task?.priority || event?.priority || (item as any)._priority || "";
    const due = task?.due || (item as any)._due || "";
    const status = task?.status || event?.status || (item as any)._status || "";
    const category = task?.category || event?.type || (item as any)._category || "";

    // Calculate overdue
    const tz = state.userProfile?.timezone || undefined;
    const today = state.hotContext?.today || new Date().toLocaleDateString("en-CA", { timeZone: tz });
    let daysOverdue = 0;
    if (due && due < today && status !== "done") {
      daysOverdue = Math.round((new Date(today).getTime() - new Date(due).getTime()) / 86400000);
    }

    // Determine available actions
    const availableActions = item.type === "event" ? ALL_EVENT_ACTIONS : ALL_TASK_ACTIONS;

    // Priority color — normalize to handle different naming (high/medium/low/critical/urgent)
    const prioLower = priority.toLowerCase();
    const prioColor = (prioLower === "high" || prioLower === "critical" || prioLower === "urgent") ? "#ef4444"
      : (prioLower === "medium" || prioLower === "normal") ? "#f59e0b"
      : prioLower === "low" ? "#22c55e"
      : "#71717a"; // unknown priority = gray

    if (done) {
      return (
        <View key={item.id} style={[il.card, il.cardDone, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
          <Text style={[il.doneText, { color: theme.textMuted }]}>{"\u2713"} {doneMsg}</Text>
        </View>
      );
    }

    return (
      <View key={item.id} style={[il.card, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
        {/* Title row */}
        <View style={il.titleRow}>
          <Text style={[il.title, { color: theme.text }]} numberOfLines={2}>{title}</Text>
          {priority && (
            <Text style={[il.prioPill, { color: prioColor, backgroundColor: prioColor + "15" }]}>
              {priority.toUpperCase()}
            </Text>
          )}
        </View>

        {/* Meta row */}
        <View style={il.metaRow}>
          {due && <Text style={[il.meta, { color: theme.textMuted }]}>Due: {due}</Text>}
          {daysOverdue > 0 && (
            <Text style={[il.overduePill, { color: "#ef4444", backgroundColor: "#ef444415" }]}>
              {daysOverdue}d overdue
            </Text>
          )}
          {category && <Text style={[il.meta, { color: theme.textMuted }]}>{category}</Text>}
          {status && status !== "pending" && <Text style={[il.meta, { color: theme.textMuted }]}>{status}</Text>}
        </View>

        {/* LLM commentary */}
        {item.commentary && (
          <Text style={[il.commentary, { color: theme.textSecondary }]}>{item.commentary}</Text>
        )}

        {/* Action buttons */}
        <View style={il.actionRow}>
          {availableActions.map((actionType) => {
            const cfg = ACTION_LABELS[actionType];
            if (!cfg) return null;
            const isSuggested = item.suggestedAction === actionType;
            return (
              <TouchableOpacity
                key={actionType}
                style={[
                  il.actionBtn,
                  isSuggested
                    ? { backgroundColor: theme.accent }
                    : { backgroundColor: theme.bgTertiary, borderWidth: 1, borderColor: theme.borderLight },
                ]}
                onPress={() => handleAction(actionType, item.id)}
              >
                <Text style={[il.actionText, { color: isSuggested ? "#fff" : theme.textSecondary }]}>
                  {cfg.icon} {cfg.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  }

  // Render grouped — unique keys, re-emit headers after pagination boundary
  let currentGroup = "";
  const rendered: React.ReactNode[] = [];
  let groupIdx = 0;

  for (let idx = 0; idx < allItems.length; idx++) {
    const item = allItems[idx];
    const group = item.group || "Items";
    if (group !== currentGroup) {
      currentGroup = group;
      groupIdx++;
      rendered.push(
        <Text key={`grp_${groupIdx}_${group}`} style={[il.groupHeader, { color: theme.textMuted }]}>{group}</Text>
      );
    }
    rendered.push(renderItem(item));
  }

  return (
    <View style={il.container}>
      {/* Batch apply button — only shows when there are pending suggestions */}
      {pendingSuggestions.length >= 2 && !batchApplied && (
        <TouchableOpacity
          style={[il.batchBtn, { backgroundColor: theme.accent }, actionInFlight && { opacity: 0.5 }]}
          onPress={handleBatchApply}
          disabled={actionInFlight}
        >
          <Text style={il.batchBtnText}>
            {actionInFlight ? "Applying..." : `Apply all ${pendingSuggestions.length} suggestions`}
          </Text>
        </TouchableOpacity>
      )}
      {batchApplied && (
        <View style={[il.batchDone, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
          <Text style={[il.batchDoneText, { color: theme.textMuted }]}>
            {"\u2713"} All suggestions applied
          </Text>
        </View>
      )}
      {rendered}
      {hasMore && (
        <TouchableOpacity
          style={[il.loadMoreBtn, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}
          onPress={() => setShowCount((c) => c + LOAD_MORE)}
        >
          <Text style={[il.loadMoreText, { color: theme.textMuted }]}>
            Show {Math.min(LOAD_MORE, items.length - showCount)} more ({items.length - showCount} remaining)
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const il = StyleSheet.create({
  container: { marginTop: 8, gap: 6 },
  groupHeader: {
    fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8,
    marginTop: 10, marginBottom: 2, paddingLeft: 2,
  },
  card: { borderRadius: 10, borderWidth: 1, padding: 10, gap: 6 },
  cardDone: { opacity: 0.6, paddingVertical: 8 },
  doneText: { fontSize: 13, fontStyle: "italic" },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  title: { fontSize: 14, fontWeight: "600", flex: 1 },
  prioPill: { fontSize: 10, fontWeight: "700", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: "hidden" },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  meta: { fontSize: 11 },
  overduePill: { fontSize: 10, fontWeight: "600", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, overflow: "hidden" },
  commentary: { fontSize: 13, lineHeight: 18, fontStyle: "italic" },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 },
  actionBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  actionText: { fontSize: 12, fontWeight: "600" },
  loadMoreBtn: { borderRadius: 8, paddingVertical: 8, alignItems: "center", borderWidth: 1 },
  loadMoreText: { fontSize: 12 },
  batchBtn: { borderRadius: 10, paddingVertical: 12, alignItems: "center", marginBottom: 8 },
  batchBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  batchDone: { borderRadius: 10, paddingVertical: 10, alignItems: "center", marginBottom: 8, borderWidth: 1 },
  batchDoneText: { fontSize: 13, fontStyle: "italic" },
});
