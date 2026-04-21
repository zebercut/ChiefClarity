import React, { useState } from "react";
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from "react-native";
import type { Theme } from "../../constants/themes";
import type { Task } from "../../types";
import { isTaskActive } from "../../types";
import { formatLocalTime as fmtTime } from "../../utils/dates";

interface Props {
  tasks: Task[];
  today: string;
  theme: Theme;
  onAction: (actionType: string, taskId: string) => Promise<{ success: boolean; message: string }>;
  onTaskPress?: (task: Task) => void;
}

const PRIO_COLORS: Record<string, string> = { high: "#ef4444", medium: "#f59e0b", low: "#22c55e" };

export default function TaskList({ tasks, today, theme, onAction, onTaskPress }: Props) {
  const [actedOn, setActedOn] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [commentingTask, setCommentingTask] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");

  // Split: overdue, due today, completed today
  const overdue = tasks.filter((t) => isTaskActive(t.status) && t.due && t.due < today);
  const dueToday = tasks.filter((t) => isTaskActive(t.status) && t.due === today);
  const noDate = tasks.filter((t) => isTaskActive(t.status) && (!t.due || t.due > today));
  const completed = tasks.filter((t) =>
    t.status === "done" && (t.completedAt?.startsWith(today) || t.dismissedAt?.startsWith(today))
  );
  const open = [...overdue, ...dueToday, ...noDate];
  const total = open.length + completed.length;

  async function handleAction(action: string, taskId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await onAction(action, taskId);
      if (result.success) setActedOn((m) => new Map(m).set(taskId, result.message));
    } finally {
      setBusy(false);
    }
  }

  async function submitComment(taskId: string) {
    const text = commentText.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await onAction(`add_comment:${text}`, taskId);
      setCommentText("");
      setCommentingTask(null);
    } finally {
      setBusy(false);
    }
  }

  function formatShortDate(iso: string | null | undefined): string {
    if (!iso) return "";
    return iso.slice(0, 10);
  }

  function formatLocalTime(iso: string | null | undefined): string {
    return fmtTime(iso || "");
  }

  return (
    <View style={s.container}>
      <TouchableOpacity style={s.headerRow} onPress={() => setExpanded(!expanded)} activeOpacity={0.7}>
        <Text style={[s.header, { color: theme.textMuted }]}>
          {expanded ? "\u25BC" : "\u25B6"} TODAY'S TASKS
        </Text>
        <Text style={[s.counter, { color: theme.textMuted }]}>
          {completed.length}/{total}
        </Text>
      </TouchableOpacity>

      {!expanded ? null : <>

      {open.length === 0 && completed.length === 0 && (
        <Text style={[s.empty, { color: theme.textMuted }]}>No tasks due today. Enjoy the space.</Text>
      )}

      {open.map((task) => {
        const done = actedOn.has(task.id);
        const daysOver = task.due && task.due < today
          ? Math.round((new Date(today).getTime() - new Date(task.due).getTime()) / 86400000)
          : 0;
        const isCommenting = commentingTask === task.id;
        const comments = task.comments || [];

        if (done) {
          return (
            <View key={task.id} style={[s.taskCard, s.taskDone, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
              <Text style={[s.doneText, { color: theme.textMuted }]}>{"\u2713"} {actedOn.get(task.id)}</Text>
            </View>
          );
        }

        return (
          <View key={task.id} style={[s.taskCard, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
            <View style={s.taskRow}>
              <Text style={[s.taskCircle, { color: theme.textMuted }]}>{"\u25CB"}</Text>
              <TouchableOpacity style={s.taskInfo} onPress={() => onTaskPress?.(task)} activeOpacity={onTaskPress ? 0.6 : 1}>
                <Text style={[s.taskTitle, { color: theme.text }]} numberOfLines={2}>{task.title}</Text>
                <View style={s.metaRow}>
                  {task.due && <Text style={[s.meta, { color: theme.textMuted }]}>Due: {task.due}</Text>}
                  {daysOver > 0 && (
                    <Text style={[s.overdue, { color: "#ef4444" }]}>{daysOver}d overdue</Text>
                  )}
                  {task.category && <Text style={[s.meta, { color: theme.textMuted }]}>{task.category}</Text>}
                </View>
                <Text style={[s.dateInfo, { color: theme.textMuted }]}>
                  Created: {formatShortDate(task.createdAt)}
                </Text>
              </TouchableOpacity>
              {task.priority && (
                <Text style={[s.prioBadge, { color: PRIO_COLORS[task.priority] || "#a1a1aa" }]}>
                  {task.priority.toUpperCase()}
                </Text>
              )}
            </View>

            {/* Existing comments */}
            {comments.length > 0 && (
              <View style={s.commentsSection}>
                {comments.map((c) => (
                  <View key={c.id} style={[s.commentBubble, { backgroundColor: theme.bgTertiary }]}>
                    <Text style={[s.commentText, { color: theme.textSecondary }]}>{c.text}</Text>
                    <Text style={[s.commentDate, { color: theme.textMuted }]}>{formatShortDate(c.date)}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Comment input */}
            {isCommenting && (
              <View style={s.commentInputRow}>
                <TextInput
                  style={[s.commentInput, { color: theme.text, borderColor: theme.borderLight, backgroundColor: theme.bgTertiary }]}
                  placeholder="Add a comment..."
                  placeholderTextColor={theme.textMuted}
                  value={commentText}
                  onChangeText={setCommentText}
                  onSubmitEditing={() => submitComment(task.id)}
                  autoFocus
                />
                <ActionBtn label="Save" accent onPress={() => submitComment(task.id)} theme={theme} />
                <ActionBtn label="\u2717" onPress={() => { setCommentingTask(null); setCommentText(""); }} theme={theme} />
              </View>
            )}

            <View style={s.actionRow}>
              <ActionBtn label={"\u2713 Done"} accent onPress={() => handleAction("mark_done", task.id)} theme={theme} />
              <ActionBtn label={"\u2192 Tomorrow"} onPress={() => handleAction("reschedule_tomorrow", task.id)} theme={theme} />
              <ActionBtn label={"\u2192 Next week"} onPress={() => handleAction("reschedule_next_week", task.id)} theme={theme} />
              <ActionBtn label={"\uD83D\uDCAC"} onPress={() => setCommentingTask(isCommenting ? null : task.id)} theme={theme} />
              <ActionBtn label={"\u2717"} onPress={() => handleAction("delete", task.id)} theme={theme} />
            </View>
          </View>
        );
      })}

      {completed.length > 0 && (
        <>
          {completed.map((task) => {
            const wasDismissed = !!task.dismissedAt;
            const label = wasDismissed
              ? `${task.title} — dismissed ${formatShortDate(task.dismissedAt)}`
              : `${task.title} — completed ${formatLocalTime(task.completedAt)}`;
            return (
              <View key={task.id} style={[s.taskCard, s.taskDone, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
                <Text style={[s.doneText, { color: theme.textMuted }]}>
                  {wasDismissed ? "\u2717" : "\u2713"} {label}
                </Text>
              </View>
            );
          })}
        </>
      )}

      </>}
    </View>
  );
}

function ActionBtn({ label, accent, onPress, theme }: { label: string; accent?: boolean; onPress: () => void; theme: Theme }) {
  return (
    <TouchableOpacity
      style={[s.btn, accent ? { backgroundColor: theme.accent } : { backgroundColor: theme.bgTertiary, borderWidth: 1, borderColor: theme.borderLight }]}
      onPress={onPress}
    >
      <Text style={[s.btnText, { color: accent ? "#fff" : theme.textSecondary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { marginBottom: 12 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8, paddingHorizontal: 2 },
  header: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2 },
  counter: { fontSize: 12, fontWeight: "600" },
  empty: { fontSize: 13, fontStyle: "italic", paddingVertical: 16, textAlign: "center" },
  taskCard: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 6, gap: 8 },
  taskDone: { opacity: 0.5, paddingVertical: 8 },
  doneText: { fontSize: 13, fontStyle: "italic", textDecorationLine: "line-through" },
  taskRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  taskCircle: { fontSize: 16, lineHeight: 20, marginTop: 1 },
  taskInfo: { flex: 1, gap: 3 },
  taskTitle: { fontSize: 14, fontWeight: "600" },
  metaRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  meta: { fontSize: 11 },
  dateInfo: { fontSize: 10, marginTop: 2 },
  overdue: { fontSize: 10, fontWeight: "600" },
  prioBadge: { fontSize: 10, fontWeight: "700" },
  commentsSection: { gap: 4, paddingLeft: 24 },
  commentBubble: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  commentText: { fontSize: 12 },
  commentDate: { fontSize: 10, marginTop: 2 },
  commentInputRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  commentInput: { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 13 },
  actionRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  btn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  btnText: { fontSize: 11, fontWeight: "600" },
});
