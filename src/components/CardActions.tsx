import React, { useState } from "react";
import { View, Text, TouchableOpacity, TextInput, StyleSheet, Platform } from "react-native";
import type { Theme } from "../constants/themes";

interface CardAction {
  label: string;
  icon: string;
  action: "mark_done" | "cancel" | "delete" | "reschedule" | "ask" | "comment" | "update_progress" | "dismiss";
  isDirect?: boolean; // true = no LLM needed
}

interface Props {
  theme: Theme;
  targetId: string;
  targetType: "priority" | "risk" | "calendar" | "okr" | "companion";
  targetTitle: string;
  actions: CardAction[];
  annotationCount?: number;
  onDirect: (targetId: string, targetType: string, targetTitle: string, action: string) => void;
  onChat: (message: string) => void;
  onComment: (targetId: string, targetType: string, targetTitle: string, comment: string) => void;
}

export default function CardActions({
  theme, targetId, targetType, targetTitle, actions, annotationCount,
  onDirect, onChat, onComment,
}: Props) {
  const [showMenu, setShowMenu] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  function handleAction(action: CardAction) {
    setShowMenu(false);
    if (action.action === "comment") {
      setShowComment(true);
      return;
    }
    if (action.isDirect) {
      const labels: Record<string, string> = {
        mark_done: "\u2713 Marked done",
        cancel: "\u2717 Cancelled",
        delete: "\u2717 Removed",
        dismiss: "\u2713 Dismissed",
      };
      setStatusMessage(labels[action.action] || "\u2713 Done");
      onDirect(targetId, targetType, targetTitle, action.action);
      return;
    }
    // LLM actions — show "sent to chat" feedback
    const messages: Record<string, string> = {
      reschedule: `Reschedule "${targetTitle}"`,
      ask: `What's the status of "${targetTitle}"?`,
      update_progress: `Update progress on "${targetTitle}"`,
      dismiss: `Dismiss the risk "${targetTitle}"`,
    };
    setStatusMessage("\u{1F4AC} Sent to chat");
    onChat(messages[action.action] || `Tell me about "${targetTitle}"`);
  }

  function submitComment() {
    if (!commentText.trim()) return;
    onComment(targetId, targetType, targetTitle, commentText.trim());
    setCommentText("");
    setShowComment(false);
  }

  // If an action was taken, show status instead of the menu trigger
  if (statusMessage) {
    return (
      <View style={[cs.statusRow, { backgroundColor: theme.accent + "15" }]}>
        <Text style={[cs.statusText, { color: theme.accent }]}>{statusMessage}</Text>
      </View>
    );
  }

  return (
    <View>
      {/* Action trigger button */}
      <View style={cs.triggerRow}>
        <TouchableOpacity
          style={[cs.triggerBtn, { backgroundColor: theme.bgTertiary }]}
          onPress={() => { setShowMenu(!showMenu); setShowComment(false); }}
        >
          <Text style={[cs.triggerText, { color: theme.textMuted }]}>{"\u2022\u2022\u2022"}</Text>
        </TouchableOpacity>
        {(annotationCount ?? 0) > 0 && (
          <View style={[cs.badge, { backgroundColor: theme.accent }]}>
            <Text style={cs.badgeText}>{annotationCount}</Text>
          </View>
        )}
      </View>

      {/* Action menu */}
      {showMenu && (
        <View style={[cs.menu, { backgroundColor: theme.bgTertiary, borderColor: theme.borderLight }]}>
          {actions.map((action, i) => (
            <TouchableOpacity
              key={i}
              style={[cs.menuItem, i < actions.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.borderLight }]}
              onPress={() => handleAction(action)}
            >
              <Text style={cs.menuIcon}>{action.icon}</Text>
              <Text style={[cs.menuLabel, { color: theme.text }]}>{action.label}</Text>
              {action.isDirect && <Text style={[cs.menuDirect, { color: theme.textMuted }]}>instant</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Comment input */}
      {showComment && (
        <View style={[cs.commentBox, { backgroundColor: theme.bgTertiary, borderColor: theme.borderLight }]}>
          <TextInput
            style={[cs.commentInput, { color: theme.text }]}
            value={commentText}
            onChangeText={setCommentText}
            placeholder="Add a note or instruction..."
            placeholderTextColor={theme.textMuted}
            multiline
            autoFocus
            onSubmitEditing={submitComment}
            {...(Platform.OS === "web" ? { onKeyPress: (e: any) => {
              if (e.nativeEvent.key === "Enter" && !e.nativeEvent.shiftKey) {
                e.preventDefault();
                submitComment();
              }
            }} : {})}
          />
          <View style={cs.commentActions}>
            <TouchableOpacity onPress={() => setShowComment(false)}>
              <Text style={[cs.commentCancel, { color: theme.textMuted }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[cs.commentSend, { backgroundColor: commentText.trim() ? theme.accent : theme.bgTertiary }]}
              onPress={submitComment}
              disabled={!commentText.trim()}
            >
              <Text style={[cs.commentSendText, { color: commentText.trim() ? "#fff" : theme.textMuted }]}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

// Type-specific action configs
export const PRIORITY_ACTIONS: CardAction[] = [
  { label: "Mark done", icon: "\u2713", action: "mark_done", isDirect: true },
  { label: "Reschedule", icon: "\u{1F4C5}", action: "reschedule" },
  { label: "Ask about it", icon: "\u2753", action: "ask" },
  { label: "Add comment", icon: "\u{1F4AC}", action: "comment" },
];

export const RISK_ACTIONS: CardAction[] = [
  { label: "Dismiss risk", icon: "\u2717", action: "dismiss" },
  { label: "Ask about it", icon: "\u2753", action: "ask" },
  { label: "Add comment", icon: "\u{1F4AC}", action: "comment" },
];

export const CALENDAR_ACTIONS: CardAction[] = [
  { label: "Mark done", icon: "\u2713", action: "mark_done", isDirect: true },
  { label: "Cancel event", icon: "\u2717", action: "cancel", isDirect: true },
  { label: "Reschedule", icon: "\u{1F4C5}", action: "reschedule" },
  { label: "Add comment", icon: "\u{1F4AC}", action: "comment" },
];

export const OKR_ACTIONS: CardAction[] = [
  { label: "Update progress", icon: "\u{1F4CA}", action: "update_progress" },
  { label: "Ask status", icon: "\u2753", action: "ask" },
  { label: "Add comment", icon: "\u{1F4AC}", action: "comment" },
];

export const COMPANION_ACTIONS: CardAction[] = [
  { label: "Acknowledge", icon: "\u2713", action: "dismiss", isDirect: true },
  { label: "Add comment", icon: "\u{1F4AC}", action: "comment" },
];

const cs = StyleSheet.create({
  statusRow: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, marginTop: 6 },
  statusText: { fontSize: 13, fontWeight: "600" },
  triggerRow: { flexDirection: "row", alignItems: "center", position: "absolute", top: 0, right: 0 },
  triggerBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  triggerText: { fontSize: 14, letterSpacing: 2 },
  badge: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", marginLeft: 4 },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  menu: { marginTop: 4, borderRadius: 10, borderWidth: 1, overflow: "hidden" },
  menuItem: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  menuIcon: { fontSize: 14, width: 20, textAlign: "center" },
  menuLabel: { fontSize: 13, fontWeight: "500", flex: 1 },
  menuDirect: { fontSize: 10, fontStyle: "italic" },
  commentBox: { marginTop: 8, borderRadius: 10, borderWidth: 1, padding: 10 },
  commentInput: { fontSize: 14, minHeight: 40, maxHeight: 100, ...(Platform.OS === "web" ? { outlineStyle: "none" as any } : {}) },
  commentActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 8 },
  commentCancel: { fontSize: 13, paddingVertical: 4 },
  commentSend: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  commentSendText: { fontSize: 13, fontWeight: "600" },
});
