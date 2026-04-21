import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import type { Theme } from "../constants/themes";
import type { Task } from "../types";
import { formatFriendlyDate } from "../utils/dates";

interface Props {
  task: Task;
  theme: Theme;
  today: string;
  onPress: (task: Task) => void;
  onToggleDone: (task: Task) => void;
}

function priorityColor(priority: string): string {
  const p = (priority || "").toLowerCase();
  if (p === "high") return "#ef4444";
  if (p === "medium") return "#f59e0b";
  if (p === "low") return "#22c55e";
  return "#71717a";
}

export default function TaskListItem({
  task,
  theme,
  today,
  onPress,
  onToggleDone,
}: Props) {
  const isDone = task.status === "done" || task.status === "deferred";
  const isParked = task.status === "parked";
  const isUntitled = !task.title;
  const title = task.title || `${task.id} (untitled)`;
  const dot = priorityColor(task.priority);
  const friendlyDate = isDone ? "" : formatFriendlyDate(task.due, today);

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: theme.bgSecondary,
          borderColor: theme.borderLight,
        },
      ]}
    >
      {/* Checkbox — sibling, not child, so its tap doesn't bubble to the body */}
      <Pressable
        onPress={() => onToggleDone(task)}
        hitSlop={8}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isDone }}
        accessibilityLabel={`Mark "${title}" as ${isDone ? "not done" : "done"}`}
        style={[
          styles.checkbox,
          {
            borderColor: isDone ? theme.accent : theme.borderLight,
            backgroundColor: isDone ? theme.accent : "transparent",
          },
        ]}
      >
        {isDone && <Text style={styles.checkmark}>{"\u2713"}</Text>}
      </Pressable>

      {/* Body — opens detail on tap */}
      <Pressable
        onPress={() => onPress(task)}
        accessibilityRole="button"
        accessibilityLabel={`Open task ${title}`}
        style={({ pressed }) => [
          styles.body,
          pressed && { opacity: 0.6 },
        ]}
      >
        <Text
          style={[
            styles.title,
            {
              color: isUntitled ? theme.textMuted : theme.text,
              textDecorationLine: isDone ? "line-through" : "none",
              opacity: isDone ? 0.55 : 1,
            },
          ]}
          numberOfLines={2}
        >
          {title}
        </Text>
        {friendlyDate ? (
          <View style={styles.metaRow}>
            <Text style={[styles.metaIcon, { color: theme.textMuted }]}>
              {"\u29D6"}
            </Text>
            <Text style={[styles.metaText, { color: theme.textMuted }]}>
              {friendlyDate}
            </Text>
          </View>
        ) : null}
      </Pressable>

      {/* Priority dot */}
      {!isDone && (
        <View style={[styles.priorityDot, { backgroundColor: dot }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginHorizontal: 12,
    marginVertical: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  checkmark: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 14,
  },
  body: { flex: 1, gap: 4 },
  title: { fontSize: 15, fontWeight: "600" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaIcon: { fontSize: 12 },
  metaText: { fontSize: 12 },
  priorityDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
});
