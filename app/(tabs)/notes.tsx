/**
 * Notes tab — capture freeform thoughts, process them in batches.
 * FEAT026.
 *
 * Encryption-safe: all reads/writes go through loadState() and flush(),
 * which use the encrypted filesystem layer transparently.
 */

import React, { useState, useEffect, useContext, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Platform,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { ConfigContext } from "../_layout";
import { loadState } from "../../src/modules/loader"; // used by refresh() on focus
import { flush } from "../../src/modules/executor";
import {
  addNote,
  editNote,
  deleteNote,
  retryNote,
  searchNotes,
  MAX_ATTEMPTS,
} from "../../src/modules/notesStore";
import { runNotesBatch, isNotesBatchRunning } from "../../src/modules/notesProcessor";
import { trackFeaturesUsage } from "../../src/modules/tips";
import type { Theme } from "../../src/constants/themes";
import type { AppState, Note, NoteStatus } from "../../src/types";
import { formatLocalTime } from "../../src/utils/dates";

/**
 * Cross-platform confirm dialog. On web, RN's Alert.alert with buttons does
 * not return a result, so we fall back to the native window.confirm via
 * globalThis (avoids DOM type imports). On native platforms we use Alert.alert.
 */
function confirmAsync(title: string, message: string): Promise<boolean> {
  if (Platform.OS === "web") {
    const w = globalThis as any;
    if (typeof w.confirm === "function") {
      // eslint-disable-next-line no-alert
      return Promise.resolve(Boolean(w.confirm(`${title}\n\n${message}`)));
    }
    // No confirm available — fail safe (do not delete)
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Delete", style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}

const STATUS_FILTERS: { value: NoteStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "processed", label: "Processed" },
  { value: "failed", label: "Failed" },
];

export default function NotesScreen() {
  const { theme } = useContext(ConfigContext);

  const [appState, setAppState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(true);
  const [draftText, setDraftText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<NoteStatus | "all">("all");
  // Hide processed notes by default — they're terminal and clutter the active queue.
  // The user can toggle them on via the "Show processed" checkbox.
  const [showProcessed, setShowProcessed] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const loadingRef = useRef(false);

  // ─── Load state ───────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const state = await loadState();
      setAppState(state);
    } catch (err: any) {
      // Bug 4: keep existing in-memory state on transient read failure.
      console.error("[notes] loadState failed — keeping existing state:", err?.message);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
      trackFeaturesUsage(["notes_tab_viewed"]).catch(() => {});
    }, [refresh])
  );

  // ─── Filtered list ────────────────────────────────────────────────────

  const visibleNotes = useMemo(() => {
    if (!appState) return [];
    let result = searchNotes(appState, searchQuery, statusFilter);
    // Hide processed notes unless the user opts in.
    // If the user explicitly selects the "processed" status filter, honor it.
    if (!showProcessed && statusFilter !== "processed") {
      result = result.filter((n) => n.status !== "processed");
    }
    // Newest first
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [appState, searchQuery, statusFilter, showProcessed]);

  const hiddenProcessedCount = useMemo(() => {
    if (!appState || showProcessed || statusFilter === "processed") return 0;
    return appState.notes.notes.filter((n) => {
      if (n.status !== "processed") return false;
      if (searchQuery.trim() && !n.text.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    }).length;
  }, [appState, showProcessed, statusFilter, searchQuery]);

  const pendingCount = useMemo(() => {
    if (!appState) return 0;
    return appState.notes.notes.filter(
      (n) => n.status === "pending" || (n.status === "failed" && n.attemptCount < MAX_ATTEMPTS)
    ).length;
  }, [appState]);

  // ─── Add ──────────────────────────────────────────────────────────────

  const handleAdd = useCallback(async () => {
    if (!appState || !draftText.trim()) return;
    try {
      addNote(appState, draftText);
      await flush(appState);
      setDraftText("");
      setAppState({ ...appState });
    } catch (err: any) {
      Alert.alert("Couldn't add note", err.message || String(err));
    }
  }, [appState, draftText]);

  // ─── Process ──────────────────────────────────────────────────────────

  const handleProcess = useCallback(async () => {
    if (!appState || processing || isNotesBatchRunning() || pendingCount === 0) return;
    setProcessing(true);
    setProcessingMessage(`Processing ${pendingCount} note(s)…`);
    try {
      // runNotesBatch mutates appState in place (markProcessing/markProcessed/
      // markFailed) and flushes to disk. We just need to trigger a re-render.
      // No loadState() reload — that would create a small race where notes
      // added between flush() and loadState() could be silently dropped.
      const result = await runNotesBatch(appState);
      setProcessingMessage(result.reply);
      setAppState({ ...appState });
    } catch (err: any) {
      Alert.alert("Processing failed", err.message || String(err));
    } finally {
      setProcessing(false);
    }
  }, [appState, processing, pendingCount]);

  // ─── Edit ─────────────────────────────────────────────────────────────

  const startEdit = useCallback((note: Note) => {
    if (note.status === "processing" || note.status === "processed") return;
    setEditingId(note.id);
    setEditingText(note.text);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditingText("");
  }, []);

  const saveEdit = useCallback(async () => {
    if (!appState || !editingId) return;
    try {
      editNote(appState, editingId, editingText);
      await flush(appState);
      setAppState({ ...appState });
      setEditingId(null);
      setEditingText("");
    } catch (err: any) {
      Alert.alert("Couldn't save note", err.message || String(err));
    }
  }, [appState, editingId, editingText]);

  // ─── Delete ───────────────────────────────────────────────────────────

  const handleDelete = useCallback(
    async (note: Note) => {
      if (!appState) return;
      if (note.status === "processing") return;

      const performDelete = async () => {
        try {
          deleteNote(appState, note.id);
          await flush(appState);
          setAppState({ ...appState });
        } catch (err: any) {
          Alert.alert("Couldn't delete note", err.message || String(err));
        }
      };

      // Confirm only for processed notes (audit trail warning)
      if (note.status === "processed") {
        const ok = await confirmAsync(
          "Delete processed note?",
          "This note has already been ingested. Deleting removes the audit trail but does NOT undo any tasks/events the system created from it."
        );
        if (ok) await performDelete();
      } else {
        await performDelete();
      }
    },
    [appState]
  );

  // ─── Retry ────────────────────────────────────────────────────────────

  const handleRetry = useCallback(
    async (note: Note) => {
      if (!appState) return;
      try {
        retryNote(appState, note.id);
        await flush(appState);
        setAppState({ ...appState });
      } catch (err: any) {
        Alert.alert("Couldn't retry note", err.message || String(err));
      }
    },
    [appState]
  );

  // ─── Render ───────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Notes</Text>
        <Text style={[styles.subtitle, { color: theme.textMuted }]}>
          Capture thoughts, process later
        </Text>
      </View>

      {/* Process button — also shows count */}
      <View style={styles.processRow}>
        <TouchableOpacity
          onPress={handleProcess}
          disabled={processing || pendingCount === 0}
          style={[
            styles.processButton,
            {
              backgroundColor:
                pendingCount === 0 || processing ? theme.bgTertiary : theme.accent,
            },
          ]}
        >
          {processing ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.processButtonText}>
              {pendingCount === 0 ? "Nothing to process" : `Process ${pendingCount} note${pendingCount === 1 ? "" : "s"}`}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {processingMessage && !processing && (
        <View style={[styles.processingBanner, { backgroundColor: theme.bgSecondary, borderColor: theme.accent, borderLeftWidth: 3 }]}>
          <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
            <Text style={[styles.processingBannerText, { color: theme.textSecondary, flex: 1 }]}>
              {processingMessage}
            </Text>
            <TouchableOpacity
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => setProcessingMessage(null)}
            >
              <Text style={{ color: theme.textMuted, fontSize: 16, marginLeft: 8 }}>{"\u2715"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {processingMessage && processing && (
        <View style={[styles.processingBanner, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
          <Text style={[styles.processingBannerText, { color: theme.textSecondary }]}>
            {processingMessage}
          </Text>
        </View>
      )}

      {/* Composer */}
      <View style={[styles.composer, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
        <TextInput
          value={draftText}
          onChangeText={setDraftText}
          placeholder="What's on your mind? Jot down meeting notes, ideas, to-dos, anything…"
          placeholderTextColor={theme.placeholder}
          multiline
          // Enter saves the note. Shift+Enter inserts a newline (so users can
          // still write multi-line notes). Cmd/Ctrl+Enter also saves, for muscle
          // memory from chat-style apps.
          onKeyPress={(e: any) => {
            const ne = e?.nativeEvent;
            if (!ne) return;
            if (ne.key !== "Enter") return;
            if (ne.shiftKey) return; // Shift+Enter = newline
            e.preventDefault?.();
            handleAdd();
          }}
          style={[styles.composerInput, { color: theme.text }]}
        />
        <View style={styles.composerActions}>
          <Text style={[styles.composerHint, { color: theme.textMuted }]}>Enter to save · Shift+Enter for newline</Text>
          <TouchableOpacity
            onPress={handleAdd}
            disabled={!draftText.trim()}
            style={[
              styles.addButton,
              { backgroundColor: draftText.trim() ? theme.accent : theme.bgTertiary },
            ]}
          >
            <Text style={styles.addButtonText}>+ Add Note</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search bar */}
      <View style={[styles.searchRow, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
        <Text style={[styles.searchIcon, { color: theme.textMuted }]}>{"\u{1F50D}"}</Text>
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search notes…"
          placeholderTextColor={theme.placeholder}
          style={[styles.searchInput, { color: theme.text }]}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery("")} style={styles.clearSearch}>
            <Text style={[styles.clearSearchText, { color: theme.textMuted }]}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Status filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipsRow}>
        {STATUS_FILTERS.map((f) => {
          const active = statusFilter === f.value;
          return (
            <TouchableOpacity
              key={f.value}
              onPress={() => setStatusFilter(f.value)}
              style={[
                styles.filterChip,
                {
                  backgroundColor: active ? theme.accent : theme.bgSecondary,
                  borderColor: active ? theme.accent : theme.borderLight,
                },
              ]}
            >
              <Text
                style={[
                  styles.filterChipText,
                  { color: active ? "#fff" : theme.textSecondary },
                ]}
              >
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Show processed toggle */}
      <TouchableOpacity
        onPress={() => setShowProcessed((v) => !v)}
        style={styles.checkboxRow}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: showProcessed }}
      >
        <View
          style={[
            styles.checkbox,
            {
              backgroundColor: showProcessed ? theme.accent : "transparent",
              borderColor: showProcessed ? theme.accent : theme.borderLight,
            },
          ]}
        >
          {showProcessed && <Text style={styles.checkboxMark}>✓</Text>}
        </View>
        <Text style={[styles.checkboxLabel, { color: theme.textSecondary }]}>
          Show processed notes
          {hiddenProcessedCount > 0 && (
            <Text style={{ color: theme.textMuted }}>{` (${hiddenProcessedCount} hidden)`}</Text>
          )}
        </Text>
      </TouchableOpacity>

      {/* Section header */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>
          {searchQuery || statusFilter !== "all" ? "MATCHING NOTES" : "TODAY'S NOTES"}
          <Text style={[styles.sectionCount, { color: theme.textMuted }]}>{` ${visibleNotes.length}`}</Text>
        </Text>
      </View>

      {/* Notes list */}
      {visibleNotes.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, { color: theme.textMuted }]}>
            {searchQuery || statusFilter !== "all"
              ? "No notes match your search."
              : "No notes yet. Capture thoughts to process later."}
          </Text>
          {(searchQuery || statusFilter !== "all") && (
            <TouchableOpacity
              onPress={() => {
                setSearchQuery("");
                setStatusFilter("all");
              }}
            >
              <Text style={[styles.clearLink, { color: theme.accent }]}>Clear search</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        visibleNotes.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            theme={theme}
            isEditing={editingId === note.id}
            editingText={editingText}
            onEditingTextChange={setEditingText}
            onStartEdit={() => startEdit(note)}
            onSaveEdit={saveEdit}
            onCancelEdit={cancelEdit}
            onDelete={() => handleDelete(note)}
            onRetry={() => handleRetry(note)}
          />
        ))
      )}
    </ScrollView>
  );
}

// ─── Note Card ──────────────────────────────────────────────────────────

interface NoteCardProps {
  note: Note;
  theme: Theme;
  isEditing: boolean;
  editingText: string;
  onEditingTextChange: (text: string) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onRetry: () => void;
}

function NoteCard(props: NoteCardProps) {
  const { note, theme, isEditing, editingText, onEditingTextChange, onStartEdit, onSaveEdit, onCancelEdit, onDelete, onRetry } = props;

  const canEdit = note.status === "pending" || note.status === "failed";
  const canDelete = note.status !== "processing";
  const atCap = note.status === "failed" && note.attemptCount >= MAX_ATTEMPTS;

  return (
    <View style={[cardStyles.card, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
      {/* Top row: status badge + actions */}
      <View style={cardStyles.topRow}>
        <StatusBadge status={note.status} note={note} theme={theme} />
        <View style={cardStyles.actions}>
          {canEdit && !isEditing && (
            <TouchableOpacity onPress={onStartEdit} style={cardStyles.actionButton}>
              <Text style={[cardStyles.actionIcon, { color: theme.textMuted }]}>{"\u270E"}</Text>
            </TouchableOpacity>
          )}
          {atCap && (
            <TouchableOpacity onPress={onRetry} style={cardStyles.actionButton}>
              <Text style={[cardStyles.retryText, { color: theme.accent }]}>Retry</Text>
            </TouchableOpacity>
          )}
          {canDelete && (
            <TouchableOpacity onPress={onDelete} style={cardStyles.actionButton}>
              <Text style={[cardStyles.actionIcon, { color: theme.textMuted }]}>{"\u{1F5D1}"}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Body: text or edit field */}
      {isEditing ? (
        <View>
          <TextInput
            value={editingText}
            onChangeText={onEditingTextChange}
            multiline
            autoFocus
            style={[cardStyles.editInput, { color: theme.text, borderColor: theme.borderLight }]}
          />
          <View style={cardStyles.editActions}>
            <TouchableOpacity onPress={onCancelEdit} style={[cardStyles.editBtn, { borderColor: theme.borderLight }]}>
              <Text style={[cardStyles.editBtnText, { color: theme.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onSaveEdit}
              disabled={!editingText.trim()}
              style={[cardStyles.editBtn, { backgroundColor: editingText.trim() ? theme.accent : theme.bgTertiary }]}
            >
              <Text style={[cardStyles.editBtnText, { color: "#fff" }]}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <Text style={[cardStyles.noteText, { color: theme.text }]}>{note.text}</Text>
      )}

      {/* Footer: timestamp + processed marker + error */}
      <View style={cardStyles.footer}>
        <Text style={[cardStyles.footerText, { color: theme.textMuted }]}>
          {"\u23F1 "}
          {formatClock(note.createdAt)}
        </Text>
        {note.status === "processed" && note.processedAt && (
          <Text style={[cardStyles.footerText, { color: "#22c55e" }]}>
            {"\u2713 ingested "}
            {formatClock(note.processedAt)}
          </Text>
        )}
      </View>

      {note.status === "processed" && (note.processedSummary || note.writeCount > 0) && (
        <Text style={[cardStyles.summaryText, { color: theme.textMuted }]}>
          {note.processedSummary
            ? note.processedSummary
            : `${note.writeCount} change${note.writeCount === 1 ? "" : "s"} applied.`}
        </Text>
      )}

      {note.lastError && note.status === "failed" && (
        <View style={[cardStyles.errorBox, { backgroundColor: theme.bg, borderColor: theme.borderLight }]}>
          <Text style={[cardStyles.errorText, { color: theme.danger }]}>{note.lastError}</Text>
          {atCap && (
            <Text style={[cardStyles.errorHint, { color: theme.textMuted }]}>
              Max retries reached — tap Retry to try again.
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Status Badge ──────────────────────────────────────────────────────

function StatusBadge({ status, note, theme }: { status: NoteStatus; note: Note; theme: Theme }) {
  const config: Record<NoteStatus, { label: string; bg: string; fg: string }> = {
    pending: { label: "Pending", bg: theme.bgTertiary, fg: theme.textMuted },
    processing: { label: "Processing…", bg: "#1e40af20", fg: "#60a5fa" },
    processed: { label: "Processed", bg: "#22c55e20", fg: "#22c55e" },
    failed: {
      label: note.attemptCount >= MAX_ATTEMPTS ? "Failed (max)" : `Failed (${note.attemptCount}/${MAX_ATTEMPTS})`,
      bg: "#ef444420",
      fg: theme.danger,
    },
  };
  const c = config[status];
  return (
    <View style={[badgeStyles.badge, { backgroundColor: c.bg }]}>
      {status === "processing" && <ActivityIndicator size="small" color={c.fg} />}
      <Text style={[badgeStyles.text, { color: c.fg }]}>{c.label}</Text>
    </View>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────

function formatClock(iso: string): string {
  return formatLocalTime(iso) || iso;
}

// ─── Styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 80 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  header: { marginBottom: 16 },
  title: { fontSize: 28, fontWeight: "800" },
  subtitle: { fontSize: 14, marginTop: 2 },

  processRow: { marginBottom: 12 },
  processButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  processButtonText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  processingBanner: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
  },
  processingBannerText: { fontSize: 13 },

  composer: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  composerInput: {
    minHeight: 80,
    fontSize: 15,
    textAlignVertical: "top",
  },
  composerActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  composerHint: { fontSize: 11 },
  addButton: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
  addButtonText: { color: "#fff", fontWeight: "600", fontSize: 13 },

  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  searchIcon: { fontSize: 14, marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 0 },
  clearSearch: { padding: 4 },
  clearSearchText: { fontSize: 14, fontWeight: "600" },

  filterChipsRow: { gap: 6, paddingVertical: 4, paddingRight: 8 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    marginRight: 6,
  },
  filterChipText: { fontSize: 12, fontWeight: "600" },

  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    paddingVertical: 6,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxMark: { color: "#fff", fontSize: 12, fontWeight: "700" },
  checkboxLabel: { fontSize: 13 },

  sectionHeader: { marginTop: 12, marginBottom: 6 },
  sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  sectionCount: { fontSize: 11, fontWeight: "500" },

  emptyState: { padding: 24, alignItems: "center", gap: 8 },
  emptyText: { fontSize: 13, textAlign: "center" },
  clearLink: { fontSize: 13, fontWeight: "600" },
});

const cardStyles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  actions: { flexDirection: "row", gap: 4 },
  actionButton: { padding: 6 },
  actionIcon: { fontSize: 14 },
  retryText: { fontSize: 12, fontWeight: "700" },

  noteText: { fontSize: 15, lineHeight: 22 },

  editInput: {
    minHeight: 80,
    fontSize: 15,
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    textAlignVertical: "top",
  },
  editActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 8 },
  editBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: "transparent" },
  editBtnText: { fontSize: 12, fontWeight: "600" },

  footer: { flexDirection: "row", justifyContent: "space-between", marginTop: 10 },
  footerText: { fontSize: 11 },
  summaryText: { fontSize: 11, marginTop: 6, fontStyle: "italic", lineHeight: 15 },

  errorBox: { marginTop: 8, padding: 8, borderRadius: 6, borderWidth: 1 },
  errorText: { fontSize: 12 },
  errorHint: { fontSize: 11, marginTop: 4 },
});

const badgeStyles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  text: { fontSize: 11, fontWeight: "700" },
});
