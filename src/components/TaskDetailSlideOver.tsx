/**
 * Shared task detail slide-over panel.
 * Used by both the Tasks tab and Focus tab.
 */
import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  Modal, Pressable, StyleSheet,
} from "react-native";
import type { Theme } from "../constants/themes";
import type { Task, TaskComment } from "../types";
import { formatFriendlyDate, dateOffset, formatLocalDateTime, nowLocalIso } from "../utils/dates";

// ─── Public API ─────────────────────────────────────────────────────────────

interface Props {
  task: Task;
  theme: Theme;
  today: string;
  onClose: () => void;
  onToggleDone: (task: Task) => void;
  onUpdate: (patch: Partial<Task>) => void;
  onAction?: (actionType: string, taskId: string) => Promise<{ success: boolean; message: string }>;
}

const SLIDE_PANEL_MAX_WIDTH = 440;

const PRIORITY_OPTIONS: PickerOption<"high" | "medium" | "low">[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export default function TaskDetailSlideOver({
  task, theme, today, onClose, onToggleDone, onUpdate, onAction,
}: Props) {
  // Local edit buffers — re-synced only when the *selected task* changes
  const [titleDraft, setTitleDraft] = useState(task.title || "");
  const [notesDraft, setNotesDraft] = useState(task.notes || "");
  const [dueDraft, setDueDraft] = useState(task.due ? task.due.slice(0, 10) : "");
  const [dueError, setDueError] = useState(false);
  const [priorityPickerOpen, setPriorityPickerOpen] = useState(false);
  const [duePickerOpen, setDuePickerOpen] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState("");

  const lastIdRef = useRef(task.id);
  useEffect(() => {
    if (lastIdRef.current !== task.id) {
      lastIdRef.current = task.id;
      setTitleDraft(task.title || "");
      setNotesDraft(task.notes || "");
      setDueDraft(task.due ? task.due.slice(0, 10) : "");
      setDueError(false);
      setNewComment("");
      setEditingCommentId(null);
    }
  }, [task.id, task.title, task.notes, task.due]);

  const isDone = task.status === "done";
  const isDeferred = task.status === "deferred";
  const isParked = task.status === "parked";
  const isInactive = isDone || isDeferred;
  const friendlyDate = formatFriendlyDate(task.due, today);
  const pChip = priorityChipStyle(task.priority);
  const comments = task.comments || [];

  // ── Field commits ───────────────────────────────────────────────────

  function commitTitle() {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== task.title) onUpdate({ title: trimmed });
    else if (!trimmed) setTitleDraft(task.title || "");
  }

  function commitNotes() {
    if (notesDraft !== (task.notes || "")) onUpdate({ notes: notesDraft });
  }

  function commitDue() {
    const trimmed = dueDraft.trim();
    if (trimmed === (task.due || "").slice(0, 10)) return;
    if (trimmed === "") { onUpdate({ due: "" }); setDueError(false); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) { setDueError(true); return; }
    setDueError(false);
    onUpdate({ due: trimmed });
  }

  function pickQuickDue(value: string) {
    setDueDraft(value);
    setDueError(false);
    onUpdate({ due: value });
    setDuePickerOpen(false);
  }

  // ── Comment CRUD ────────────────────────────────────────────────────

  function addComment() {
    const text = newComment.trim();
    if (!text) return;
    const c: TaskComment = {
      id: `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      text,
      date: nowLocalIso(),
    };
    onUpdate({ comments: [...comments, c] } as any);
    setNewComment("");
  }

  function deleteComment(id: string) {
    onUpdate({ comments: comments.filter((c) => c.id !== id) } as any);
  }

  function startEditComment(id: string) {
    const c = comments.find((x) => x.id === id);
    if (!c) return;
    setEditingCommentId(id);
    setEditingCommentText(c.text);
  }

  function saveEditComment() {
    if (!editingCommentId) return;
    const text = editingCommentText.trim();
    if (!text) return;
    onUpdate({
      comments: comments.map((c) =>
        c.id === editingCommentId ? { ...c, text, date: nowLocalIso() } : c
      ),
    } as any);
    setEditingCommentId(null);
    setEditingCommentText("");
  }

  function cancelEditComment() {
    setEditingCommentId(null);
    setEditingCommentText("");
  }

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <Modal visible animationType="none" transparent onRequestClose={onClose}>
      <Pressable style={sl.backdrop} onPress={onClose}>
        <Pressable onPress={(e) => e.stopPropagation()} style={[sl.panel, { backgroundColor: theme.bg, borderLeftColor: theme.borderLight }]}>

          {/* Header */}
          <View style={[sl.header, { borderBottomColor: theme.borderLight }]}>
            <TouchableOpacity
              onPress={() => onToggleDone(task)}
              hitSlop={8}
              style={[sl.checkbox, { borderColor: isDone ? theme.accent : theme.borderLight, backgroundColor: isDone ? theme.accent : "transparent" }]}
            >
              {isDone && <Text style={sl.checkmark}>{"\u2713"}</Text>}
            </TouchableOpacity>
            <TextInput
              value={titleDraft}
              onChangeText={setTitleDraft}
              onBlur={commitTitle}
              onSubmitEditing={commitTitle}
              placeholder="Untitled task"
              placeholderTextColor={theme.textMuted}
              multiline
              style={[sl.titleInput, { color: theme.text, textDecorationLine: isInactive ? "line-through" : "none", opacity: isInactive ? 0.55 : isParked ? 0.7 : 1 }]}
            />
            <TouchableOpacity onPress={onClose} hitSlop={8} style={sl.close}>
              <Text style={{ color: theme.textMuted, fontSize: 20 }}>{"\u2715"}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={sl.body}>
            {/* Chip row */}
            <View style={sl.chipRow}>
              <ChipButton icon={"\u2691"} label={`${capitalize(task.priority || "Medium")} Priority`} bg={pChip.bg} fg={pChip.fg} onPress={() => setPriorityPickerOpen(true)} />
              <ChipButton icon={"\u29D6"} label={friendlyDate || "No due date"} bg={theme.bgSecondary} fg={theme.textSecondary} borderColor={theme.borderLight} onPress={() => setDuePickerOpen(true)} />
              {task.category ? <ChipButton icon={"\u25C9"} label={task.category} bg={theme.accent + "15"} fg={theme.accent} onPress={() => {}} /> : null}
            </View>

            {/* Status actions */}
            {onAction && (
              <View style={sl.chipRow}>
                {isParked ? (
                  <ChipButton icon={"\u25B6"} label="Resume" bg="#dcfce7" fg="#16a34a" onPress={() => onAction("resume", task.id)} />
                ) : !isInactive ? (
                  <>
                    <ChipButton icon={"\u23F8"} label="Park" bg="#fef3c7" fg="#d97706" onPress={() => onAction("park", task.id)} />
                    <ChipButton icon={"\u2716"} label="Defer" bg="#fee2e2" fg="#dc2626" onPress={() => onAction("defer", task.id)} />
                  </>
                ) : null}
                {isDeferred && (
                  <ChipButton icon={"\u21A9"} label="Reopen" bg="#dcfce7" fg="#16a34a" onPress={() => onAction("resume", task.id)} />
                )}
              </View>
            )}

            {/* Status badge */}
            {(isDeferred || isParked) && (
              <View style={[sl.statusBadge, { backgroundColor: isDeferred ? "#fee2e2" : "#fef3c7" }]}>
                <Text style={{ color: isDeferred ? "#dc2626" : "#d97706", fontSize: 12, fontWeight: "700" }}>
                  {isDeferred ? "DEFERRED" : "PARKED"}{task.dismissedAt ? ` — ${task.dismissedAt.slice(0, 10)}` : ""}
                </Text>
              </View>
            )}

            {/* Description */}
            <View style={sl.section}>
              <View style={sl.sectionHeading}>
                <Text style={[sl.sectionIcon, { color: theme.textMuted }]}>{"\u{1F4C4}"}</Text>
                <Text style={[sl.sectionLabel, { color: theme.textMuted }]}>DESCRIPTION</Text>
              </View>
              <View style={[sl.descriptionBox, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
                <TextInput
                  value={notesDraft}
                  onChangeText={setNotesDraft}
                  onBlur={commitNotes}
                  placeholder="Add a description\u2026"
                  placeholderTextColor={theme.textMuted}
                  multiline
                  style={[sl.descriptionInput, { color: theme.text }]}
                />
              </View>
            </View>

            {/* Comments */}
            <View style={sl.section}>
              <View style={sl.sectionHeading}>
                <Text style={[sl.sectionIcon, { color: theme.textMuted }]}>{"\uD83D\uDCAC"}</Text>
                <Text style={[sl.sectionLabel, { color: theme.textMuted }]}>COMMENTS {comments.length > 0 ? `(${comments.length})` : ""}</Text>
              </View>

              {comments.map((c) => (
                <View key={c.id} style={[sl.commentCard, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
                  {editingCommentId === c.id ? (
                    <View style={sl.commentEditRow}>
                      <TextInput
                        value={editingCommentText}
                        onChangeText={setEditingCommentText}
                        onSubmitEditing={saveEditComment}
                        multiline
                        autoFocus
                        style={[sl.commentEditInput, { color: theme.text, borderColor: theme.accent, backgroundColor: theme.bg }]}
                      />
                      <View style={sl.commentEditActions}>
                        <TouchableOpacity onPress={saveEditComment} style={[sl.smallBtn, { backgroundColor: theme.accent }]}>
                          <Text style={sl.smallBtnText}>Save</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={cancelEditComment} style={[sl.smallBtn, { backgroundColor: theme.bgTertiary }]}>
                          <Text style={[sl.smallBtnTextMuted, { color: theme.textMuted }]}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <>
                      <Text style={[sl.commentText, { color: theme.text }]}>{c.text}</Text>
                      <View style={sl.commentMeta}>
                        <Text style={[sl.commentDate, { color: theme.textMuted }]}>{formatLocalTime(c.date)}</Text>
                        <View style={sl.commentActions}>
                          <TouchableOpacity onPress={() => startEditComment(c.id)} hitSlop={6}>
                            <Text style={[sl.commentActionLink, { color: theme.accent }]}>Edit</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => deleteComment(c.id)} hitSlop={6}>
                            <Text style={[sl.commentActionLink, { color: "#ef4444" }]}>Delete</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </>
                  )}
                </View>
              ))}

              {/* Add comment */}
              <View style={[sl.commentAddRow, { borderColor: theme.borderLight, backgroundColor: theme.bgSecondary }]}>
                <TextInput
                  value={newComment}
                  onChangeText={setNewComment}
                  onSubmitEditing={addComment}
                  placeholder="Add a comment..."
                  placeholderTextColor={theme.textMuted}
                  multiline
                  style={[sl.commentAddInput, { color: theme.text }]}
                />
                {newComment.trim().length > 0 && (
                  <TouchableOpacity onPress={addComment} style={[sl.sendBtn, { backgroundColor: theme.accent }]}>
                    <Text style={sl.smallBtnText}>{"\u2191"}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>

      {/* Priority picker */}
      <PickerModal
        visible={priorityPickerOpen}
        title="Priority"
        options={PRIORITY_OPTIONS}
        selected={(task.priority as "high" | "medium" | "low") || "medium"}
        theme={theme}
        onSelect={(v) => { onUpdate({ priority: v }); setPriorityPickerOpen(false); }}
        onClose={() => setPriorityPickerOpen(false)}
      />

      {/* Due date picker */}
      <Modal visible={duePickerOpen} animationType="fade" transparent onRequestClose={() => setDuePickerOpen(false)}>
        <Pressable style={pk.backdrop} onPress={() => setDuePickerOpen(false)}>
          <Pressable onPress={(e) => e.stopPropagation()} style={[pk.sheet, { backgroundColor: theme.bgSecondary }]}>
            <Text style={[pk.title, { color: theme.textMuted }]}>Due date</Text>
            {[
              { label: "Today", value: today },
              { label: "Tomorrow", value: dateOffset(today, 1) },
              { label: "In 3 days", value: dateOffset(today, 3) },
              { label: "Next week", value: dateOffset(today, 7) },
              { label: "No due date", value: "" },
            ].map((opt) => (
              <TouchableOpacity key={opt.label} onPress={() => pickQuickDue(opt.value)} style={[pk.option, { borderColor: theme.borderLight }]}>
                <Text style={{ color: theme.text, fontSize: 15, fontWeight: "500" }}>{opt.label}</Text>
                {opt.value ? <Text style={{ color: theme.textMuted, fontSize: 12 }}>{opt.value}</Text> : null}
              </TouchableOpacity>
            ))}
            <View style={{ marginTop: 8, gap: 6 }}>
              <Text style={[pk.title, { color: theme.textMuted }]}>Custom (YYYY-MM-DD)</Text>
              <TextInput
                value={dueDraft}
                onChangeText={(v) => { setDueDraft(v); setDueError(false); }}
                onBlur={commitDue}
                onSubmitEditing={() => { commitDue(); if (!dueError) setDuePickerOpen(false); }}
                placeholder="2026-04-15"
                placeholderTextColor={theme.textMuted}
                style={[sl.dueInput, { backgroundColor: theme.bg, borderColor: dueError ? "#ef4444" : theme.borderLight, color: theme.text }]}
              />
              {dueError && <Text style={{ color: "#ef4444", fontSize: 11 }}>Use YYYY-MM-DD format</Text>}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Modal>
  );
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function ChipButton({ icon, label, bg, fg, borderColor, onPress }: {
  icon: string; label: string; bg: string; fg: string; borderColor?: string; onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={[sl.chip, { backgroundColor: bg, borderColor: borderColor || "transparent", borderWidth: borderColor ? 1 : 0 }]}>
      <Text style={[sl.chipIcon, { color: fg }]}>{icon}</Text>
      <Text style={[sl.chipLabel, { color: fg }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export interface PickerOption<T extends string> { value: T; label: string }

export function PickerModal<T extends string>({ visible, title, options, selected, theme, onSelect, onClose }: {
  visible: boolean; title: string; options: PickerOption<T>[]; selected: T; theme: Theme; onSelect: (v: T) => void; onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={pk.backdrop} onPress={onClose}>
        <Pressable onPress={(e) => e.stopPropagation()} style={[pk.sheet, { backgroundColor: theme.bgSecondary }]}>
          <Text style={[pk.title, { color: theme.textMuted }]}>{title}</Text>
          {options.map((opt) => {
            const active = opt.value === selected;
            return (
              <TouchableOpacity key={opt.value} onPress={() => onSelect(opt.value)} style={[pk.option, { borderColor: theme.borderLight }, active && { backgroundColor: theme.bgTertiary }]}>
                <Text style={{ color: active ? theme.accent : theme.text, fontSize: 15, fontWeight: active ? "700" : "500" }}>{opt.label}</Text>
                {active && <Text style={{ color: theme.accent, fontSize: 16 }}>{"\u2713"}</Text>}
              </TouchableOpacity>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function formatLocalTime(iso: string | undefined): string {
  return formatLocalDateTime(iso || "");
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

function priorityChipStyle(priority: string): { bg: string; fg: string } {
  const p = (priority || "").toLowerCase();
  if (p === "high") return { bg: "#fee2e2", fg: "#dc2626" };
  if (p === "medium") return { bg: "#fef3c7", fg: "#d97706" };
  if (p === "low") return { bg: "#dcfce7", fg: "#16a34a" };
  return { bg: "#f4f4f5", fg: "#71717a" };
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const sl = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", flexDirection: "row", justifyContent: "flex-end" },
  panel: { width: "100%", maxWidth: SLIDE_PANEL_MAX_WIDTH, height: "100%", borderLeftWidth: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, borderBottomWidth: 1 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  checkmark: { color: "#fff", fontSize: 14, fontWeight: "700", lineHeight: 14 },
  titleInput: { flex: 1, fontSize: 18, fontWeight: "700", padding: 0, margin: 0 },
  close: { padding: 4 },
  body: { padding: 20, gap: 24 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  chipIcon: { fontSize: 13, fontWeight: "700" },
  chipLabel: { fontSize: 13, fontWeight: "600" },
  section: { gap: 8 },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionIcon: { fontSize: 13 },
  sectionLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2 },
  descriptionBox: { padding: 16, borderRadius: 12, borderWidth: 1 },
  descriptionInput: { fontSize: 14, lineHeight: 21, padding: 0, margin: 0, minHeight: 60, textAlignVertical: "top" },
  dueInput: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, borderWidth: 1, fontSize: 14 },
  commentCard: { borderRadius: 10, borderWidth: 1, padding: 12, gap: 6 },
  commentText: { fontSize: 14, lineHeight: 20 },
  commentMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  commentDate: { fontSize: 11 },
  commentActions: { flexDirection: "row", gap: 12 },
  commentActionLink: { fontSize: 12, fontWeight: "600" },
  commentEditRow: { gap: 8 },
  commentEditInput: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 14, lineHeight: 20, minHeight: 44, textAlignVertical: "top" },
  commentEditActions: { flexDirection: "row", gap: 8 },
  smallBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6 },
  smallBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  smallBtnTextMuted: { fontSize: 12, fontWeight: "600" },
  commentAddRow: { flexDirection: "row", alignItems: "flex-end", borderRadius: 10, borderWidth: 1, padding: 10, gap: 8 },
  commentAddInput: { flex: 1, fontSize: 14, lineHeight: 20, padding: 0, margin: 0, minHeight: 20, maxHeight: 80, textAlignVertical: "top" },
  sendBtn: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, alignSelf: "flex-start" },
});

const pk = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { margin: 24, marginBottom: 80, marginTop: "auto", padding: 16, borderRadius: 16, gap: 4 },
  title: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2, paddingHorizontal: 8, paddingBottom: 8 },
  option: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 12, borderRadius: 8 },
});
