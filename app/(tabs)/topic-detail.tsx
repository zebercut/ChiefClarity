/**
 * Topic detail page — shows all related tasks, events, OKR connections,
 * insights, notes, and activity for a single topic.
 * FEAT023 Story 8.
 */

import React, { useState, useContext, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  Pressable,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { ConfigContext } from "../_layout";
import { loadState } from "../../src/modules/loader";
import { applyWrites, flush } from "../../src/modules/executor";
import { buildTopicCrossRef, readTopicFile, appendToTopicFile } from "../../src/modules/topicManager";
import { computeKrActivity, computeKrOutcome, buildTaskStats } from "../../src/types";
import TaskDetailSlideOver from "../../src/components/TaskDetailSlideOver";
import CreateTopicModal from "../../src/components/topics/CreateTopicModal";
import type { Theme } from "../../src/constants/themes";
import type { AppState, TopicEntry, Task, CalendarEvent, TopicDigestItem, ActionPlan } from "../../src/types";
import { formatLocalDateTime, formatLocalTime, getTodayFromTz, nowLocalIso } from "../../src/utils/dates";

const NOTES_INITIAL = 5;

export default function TopicDetailScreen() {
  const { theme } = useContext(ConfigContext);
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const topicId = params.id || "";

  const [appState, setAppState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(true);
  const [topicNotes, setTopicNotes] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(true);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [showAllNotes, setShowAllNotes] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [reassignFor, setReassignFor] = useState<{ sourceId: string; sourceType: "task" | "event" } | null>(null);
  const [showCreateInReassign, setShowCreateInReassign] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const state = await loadState();
      setAppState(state);
      const notes = await readTopicFile(topicId);
      setTopicNotes(notes);
    } catch (err: any) {
      console.error("[topic-detail] load failed:", err?.message);
    } finally {
      setLoading(false);
    }
  }, [topicId]);

  useFocusEffect(
    useCallback(() => {
      if (topicId) refresh();
    }, [topicId, refresh])
  );

  const topic: TopicEntry | null = useMemo(() => {
    return appState?.topicManifest.topics.find((t) => t.id === topicId) || null;
  }, [appState, topicId]);

  // Cross-reference for this topic
  const crossRef = useMemo(() => {
    if (!appState || !topic) return null;
    const activeTasks = appState.tasks.tasks.filter(
      (t) => t.status !== "done" && t.status !== "deferred" && t.status !== "parked"
    );
    const activeEvents = appState.calendar.events.filter(
      (e) => !e.archived && e.status !== "cancelled"
    );
    const refs = buildTopicCrossRef(appState.topicManifest, activeTasks, activeEvents);
    return refs.find((c) => c.topic === topicId) || null;
  }, [appState, topic, topicId]);

  // Related tasks
  const relatedTasks: Task[] = useMemo(() => {
    if (!appState || !crossRef) return [];
    return appState.tasks.tasks.filter(
      (t) =>
        crossRef.taskIds.includes(t.id) &&
        t.status !== "done" && t.status !== "deferred" && t.status !== "parked"
    );
  }, [appState, crossRef]);

  // Related events (future only)
  const today = appState?.hotContext?.today || getTodayFromTz(appState?.userProfile?.timezone);
  const relatedEvents: CalendarEvent[] = useMemo(() => {
    if (!appState || !crossRef) return [];
    return appState.calendar.events
      .filter(
        (e) =>
          crossRef.eventIds.includes(e.id) &&
          !e.archived &&
          e.status !== "cancelled" &&
          e.datetime &&
          e.datetime.slice(0, 10) >= today
      )
      .sort((a, b) => (a.datetime || "").localeCompare(b.datetime || ""));
  }, [appState, crossRef, today]);

  // OKR connections
  const okrConnections = useMemo(() => {
    if (!appState || !crossRef || crossRef.okrLinks.length === 0) return [];
    const taskStats = buildTaskStats(appState.tasks.tasks);
    const results: Array<{
      objective: string;
      krTitle: string;
      activity: number;
      outcome: number;
    }> = [];
    for (const krId of crossRef.okrLinks) {
      for (const obj of appState.planOkrDashboard.objectives) {
        const kr = obj.keyResults.find((k: any) => k.id === krId);
        if (kr) {
          results.push({
            objective: obj.title,
            krTitle: kr.title,
            activity: computeKrActivity(kr.id, taskStats),
            outcome: computeKrOutcome(kr),
          });
        }
      }
    }
    return results;
  }, [appState, crossRef]);

  // Digest entry for this topic from the latest focus brief (summary + insights live here)
  const digestEntry: TopicDigestItem | null = useMemo(() => {
    if (!appState?.focusBrief?.topicDigest) return null;
    return appState.focusBrief.topicDigest.find((d: TopicDigestItem) => d.topic === topicId) || null;
  }, [appState, topicId]);

  const briefGeneratedAt = appState?.focusBrief?.generatedAt || "";

  const latestInsight: { text: string; updatedAt: string } | null = useMemo(() => {
    if (!digestEntry?.newInsights) return null;
    return { text: digestEntry.newInsights, updatedAt: briefGeneratedAt };
  }, [digestEntry, briefGeneratedAt]);

  // Parse notes from markdown
  const noteEntries = useMemo(() => {
    if (!topicNotes) return [];
    // Extract content after "## Notes" if present
    let notesContent = topicNotes;
    const notesIdx = topicNotes.indexOf("## Notes");
    if (notesIdx !== -1) notesContent = topicNotes.slice(notesIdx);

    const entries: Array<{ date: string; items: string[] }> = [];
    const lines = notesContent.split("\n");
    let currentDate = "";
    let currentItems: string[] = [];

    for (const line of lines) {
      const dateMatch = line.match(/^### (\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        if (currentDate && currentItems.length > 0) {
          entries.push({ date: currentDate, items: [...currentItems] });
        }
        currentDate = dateMatch[1];
        currentItems = [];
      } else if (line.startsWith("- ") && currentDate) {
        currentItems.push(line.slice(2).trim());
      }
    }
    if (currentDate && currentItems.length > 0) {
      entries.push({ date: currentDate, items: currentItems });
    }
    // Newest first
    return entries.reverse();
  }, [topicNotes]);

  // Signal stats
  const signalStats = useMemo(() => {
    if (!appState) return { total: 0, facts: 0, tasks: 0, events: 0, mentions: 0 };
    const signals = appState.topicManifest.signals.filter((s) => s.topic === topicId);
    return {
      total: signals.length,
      facts: signals.filter((s) => s.sourceType === "fact").length,
      tasks: signals.filter((s) => s.sourceType === "task").length,
      events: signals.filter((s) => s.sourceType === "event").length,
      mentions: signals.filter((s) => s.sourceType === "mention").length,
    };
  }, [appState, topicId]);

  // Add note handler
  const handleAddNote = useCallback(async () => {
    if (!noteInput.trim() || !topic) return;
    try {
      await appendToTopicFile(topicId, topic.name, noteInput.trim(), today);
      setNoteInput("");
      setShowNoteInput(false);
      const notes = await readTopicFile(topicId);
      setTopicNotes(notes);
    } catch (err: any) {
      const msg = `Could not save note: ${err?.message || "unknown error"}`;
      if (Platform.OS === "web") {
        (globalThis as any).alert?.(msg);
      } else {
        Alert.alert("Save failed", msg);
      }
    }
  }, [noteInput, topicId, topic, today]);

  // Dispatch a topicManifest action through the executor (shared by all handlers below).
  // Failures surface to the user instead of being swallowed — a silent flush error
  // (e.g., DB migration not yet applied) would otherwise make buttons look broken.
  const dispatchTopicAction = useCallback(
    async (action: string, data: Record<string, unknown>) => {
      if (!appState) return;
      const plan: ActionPlan = {
        reply: "",
        writes: [{ file: "topicManifest", action: "add", data: { _action: action, ...data } }],
        items: [],
        conflictsToCheck: [],
        suggestions: [],
        memorySignals: [],
        topicSignals: [],
        needsClarification: false,
      };
      try {
        await applyWrites(plan, appState);
      } catch (err: any) {
        const msg = `${action} failed: ${err?.message || "unknown error"}`;
        if (Platform.OS === "web") (globalThis as any).alert?.(msg);
        else Alert.alert("Action failed", msg);
        return;
      }
      refresh();
    },
    [appState, refresh]
  );

  const handleUnassign = useCallback(
    (sourceId: string) => dispatchTopicAction("unassign_from_topic", { topicId, sourceId }),
    [dispatchTopicAction, topicId]
  );

  const handleReassignTo = useCallback(
    async (toTopicId: string) => {
      if (!reassignFor) return;
      await dispatchTopicAction("reassign_topic", {
        fromTopicId: topicId,
        toTopicId,
        sourceId: reassignFor.sourceId,
        sourceType: reassignFor.sourceType,
      });
      setReassignFor(null);
    },
    [dispatchTopicAction, reassignFor, topicId]
  );

  const handleArchiveToggle = useCallback(() => {
    if (!topic) return;
    const action = topic.archivedAt ? "unarchive_topic" : "archive_topic";
    dispatchTopicAction(action, { topicId });
  }, [dispatchTopicAction, topic, topicId]);

  // Create a brand-new topic then immediately reassign the pending item into it.
  // Both writes ride a single applyWrites call so state is consistent even if
  // the user closes the page mid-flow.
  const handleCreateAndReassign = useCallback(
    async (name: string, aliases: string[]) => {
      if (!appState || !reassignFor) return;
      // Slug has to match what the executor's create_topic action derives — keep
      // this in sync with slugifyTopic() to avoid "unknown topic" mismatches.
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const plan: ActionPlan = {
        reply: "",
        writes: [
          {
            file: "topicManifest",
            action: "add",
            data: { _action: "create_topic", name, aliases },
          },
          {
            file: "topicManifest",
            action: "add",
            data: {
              _action: "reassign_topic",
              fromTopicId: topicId,
              toTopicId: slug,
              sourceId: reassignFor.sourceId,
              sourceType: reassignFor.sourceType,
            },
          },
        ],
        items: [],
        conflictsToCheck: [],
        suggestions: [],
        memorySignals: [],
        topicSignals: [],
        needsClarification: false,
      };
      await applyWrites(plan, appState);
      setShowCreateInReassign(false);
      setReassignFor(null);
      refresh();
    },
    [appState, reassignFor, topicId, refresh]
  );

  // Task detail slide-over handlers (mirrors focus.tsx pattern)
  const selectedTask: Task | null = selectedTaskId
    ? appState?.tasks.tasks.find(t => t.id === selectedTaskId) || null
    : null;

  const handleTaskUpdate = useCallback(
    async (patch: Partial<Task>) => {
      if (!appState || !selectedTaskId) return;
      const updated: AppState = {
        ...appState,
        tasks: {
          ...appState.tasks,
          tasks: appState.tasks.tasks.map(t =>
            t.id === selectedTaskId ? { ...t, ...patch } : t
          ),
        },
        _dirty: new Set(appState._dirty),
        _loadedCounts: appState._loadedCounts,
      };
      updated._dirty.add("tasks");
      setAppState(updated);
      try { await flush(updated); } catch { /* errors surfaced elsewhere */ }
    },
    [appState, selectedTaskId]
  );

  const handleToggleDone = useCallback((task: Task) => {
    const wasDone = task.status === "done";
    handleTaskUpdate({
      status: wasDone ? "pending" : "done",
      completedAt: wasDone ? null : nowLocalIso(),
    });
  }, [handleTaskUpdate]);

  if (loading && !appState) {
    return (
      <View style={[t.container, { backgroundColor: theme.bg }]}>
        <View style={t.center}>
          <ActivityIndicator size="large" color={theme.accent} />
        </View>
      </View>
    );
  }

  if (!topic) {
    return (
      <View style={[t.container, { backgroundColor: theme.bg }]}>
        <View style={[t.headerBar, { borderBottomColor: theme.borderLight }]}>
          <TouchableOpacity onPress={() => router.back()} style={t.backBtn}>
            <Text style={[t.backText, { color: theme.accent }]}>{"\u2190"} Back</Text>
          </TouchableOpacity>
        </View>
        <View style={t.center}>
          <Text style={[t.emptyText, { color: theme.textMuted }]}>Topic not found</Text>
        </View>
      </View>
    );
  }

  const visibleNotes = showAllNotes ? noteEntries : noteEntries.slice(0, NOTES_INITIAL);
  const hiddenNoteCount = noteEntries.length - NOTES_INITIAL;

  return (
    <View style={[t.container, { backgroundColor: theme.bg }]}>
      {/* Header */}
      <View style={[t.headerBar, { borderBottomColor: theme.borderLight }]}>
        <View style={t.headerLeft}>
          <TouchableOpacity onPress={() => router.back()} style={t.backBtn}>
            <Text style={[t.backText, { color: theme.accent }]}>{"\u2190"} Topics</Text>
          </TouchableOpacity>
        </View>
        <Text style={[t.headerTitle, { color: theme.text }]}>
          {topic.archivedAt ? `${topic.name} \u{1F4E6}` : topic.name}
        </Text>
        <View style={t.headerActions}>
          <TouchableOpacity
            style={[t.headerIconBtn, { borderColor: theme.borderLight }]}
            onPress={handleArchiveToggle}
            accessibilityLabel={topic.archivedAt ? "Unarchive topic" : "Archive topic"}
          >
            <Text style={[t.headerIconText, { color: theme.textSecondary }]}>
              {topic.archivedAt ? "Unarchive" : "Archive"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[t.addNoteBtn, { backgroundColor: theme.accent }]}
            onPress={() => setShowNoteInput(!showNoteInput)}
          >
            <Text style={t.addNoteBtnText}>Add Note</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={t.scroll} contentContainerStyle={t.scrollContent}>
        {/* Meta */}
        {topic.aliases.length > 0 && (
          <Text style={[t.metaText, { color: theme.textMuted }]}>
            Also known as: {topic.aliases.join(", ")}
          </Text>
        )}
        <Text style={[t.metaText, { color: theme.textMuted }]}>
          Created: {formatLocalDateTime(topic.createdAt)}
          {topic.archivedAt
            ? ` \u00B7 Archived ${formatLocalDateTime(topic.archivedAt)}`
            : ""}
        </Text>

        {/* Summary (from latest focus brief) */}
        <View style={[t.summaryCard, { backgroundColor: theme.accent + "10", borderColor: theme.accent + "30" }]}>
          <Text style={[t.summaryLabel, { color: theme.accent }]}>{"\u2728"} SUMMARY</Text>
          {digestEntry?.summary ? (
            <>
              <Text style={[t.summaryText, { color: theme.text }]}>{digestEntry.summary}</Text>
              <Text style={[t.summaryMeta, { color: theme.textMuted }]}>
                From daily plan {"\u00B7"} {formatTimestamp(briefGeneratedAt)}
              </Text>
            </>
          ) : (
            <Text style={[t.summaryText, { color: theme.textMuted, fontStyle: "italic" }]}>
              No summary yet — the next daily plan will generate one.
            </Text>
          )}
        </View>

        {/* Note Input */}
        {showNoteInput && (
          <View style={[t.noteInputCard, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
            <TextInput
              style={[t.noteInputField, { color: theme.text, borderColor: theme.borderLight }]}
              placeholder="Add a note..."
              placeholderTextColor={theme.placeholder}
              value={noteInput}
              onChangeText={setNoteInput}
              multiline
              autoFocus
            />
            <View style={t.noteInputActions}>
              <TouchableOpacity
                style={[t.noteBtn, { backgroundColor: theme.bgTertiary, borderColor: theme.borderLight }]}
                onPress={() => { setShowNoteInput(false); setNoteInput(""); }}
              >
                <Text style={[t.noteBtnText, { color: theme.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[t.noteBtn, { backgroundColor: theme.accent }]}
                onPress={handleAddNote}
              >
                <Text style={[t.noteBtnText, { color: "#fff" }]}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Active Tasks */}
        {relatedTasks.length > 0 && (
          <View style={t.section}>
            <Text style={[t.sectionHeader, { color: theme.textMuted }]}>
              {"\u2705"} ACTIVE TASKS ({relatedTasks.length})
            </Text>
            {relatedTasks.map((task) => (
              <View
                key={task.id}
                style={[t.card, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}
              >
                <TouchableOpacity onPress={() => setSelectedTaskId(task.id)}>
                  <Text style={[t.cardTitle, { color: theme.text }]}>{task.title}</Text>
                  <View style={t.cardMeta}>
                    {task.due && (
                      <Text style={[t.metaLabel, { color: theme.textMuted }]}>
                        Due: {task.due === today ? "Today" : task.due}
                      </Text>
                    )}
                    <PrioPill priority={task.priority} />
                    <Text style={[t.metaLabel, { color: theme.textMuted }]}>{task.status}</Text>
                  </View>
                </TouchableOpacity>
                <View style={t.itemActions}>
                  <TouchableOpacity
                    style={[t.itemBtn, { backgroundColor: theme.bgTertiary, borderColor: theme.borderLight }]}
                    onPress={() => setReassignFor({ sourceId: task.id, sourceType: "task" })}
                  >
                    <Text style={[t.itemBtnText, { color: theme.textSecondary }]}>Reassign</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[t.itemBtn, { backgroundColor: theme.bgTertiary, borderColor: theme.borderLight }]}
                    onPress={() => handleUnassign(task.id)}
                  >
                    <Text style={[t.itemBtnText, { color: theme.textSecondary }]}>Unassign</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Upcoming Events */}
        {relatedEvents.length > 0 && (
          <View style={t.section}>
            <Text style={[t.sectionHeader, { color: theme.textMuted }]}>
              {"\u{1F4C5}"} UPCOMING EVENTS ({relatedEvents.length})
            </Text>
            {relatedEvents.map((ev) => (
              <View
                key={ev.id}
                style={[t.card, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}
              >
                <TouchableOpacity onPress={() => router.navigate("/(tabs)/focus" as any)}>
                  <Text style={[t.cardTitle, { color: theme.text }]}>{"\u{1F4CC}"} {ev.title}</Text>
                  <Text style={[t.metaLabel, { color: theme.textMuted }]}>
                    {formatEventDatetime(ev.datetime)} {"\u00B7"} {ev.durationMinutes} min
                  </Text>
                </TouchableOpacity>
                <View style={t.itemActions}>
                  <TouchableOpacity
                    style={[t.itemBtn, { backgroundColor: theme.bgTertiary, borderColor: theme.borderLight }]}
                    onPress={() => setReassignFor({ sourceId: ev.id, sourceType: "event" })}
                  >
                    <Text style={[t.itemBtnText, { color: theme.textSecondary }]}>Reassign</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[t.itemBtn, { backgroundColor: theme.bgTertiary, borderColor: theme.borderLight }]}
                    onPress={() => handleUnassign(ev.id)}
                  >
                    <Text style={[t.itemBtnText, { color: theme.textSecondary }]}>Unassign</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* OKR Connection */}
        {okrConnections.length > 0 && (
          <View style={t.section}>
            <Text style={[t.sectionHeader, { color: theme.textMuted }]}>
              {"\u{1F3AF}"} OKR CONNECTION
            </Text>
            <View style={[t.card, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
              {okrConnections.map((okr, i) => (
                <View key={i} style={i > 0 ? { marginTop: 12 } : undefined}>
                  <Text style={[t.okrObjective, { color: theme.text }]}>{okr.objective}</Text>
                  <Text style={[t.okrKr, { color: theme.textSecondary }]}>{"\u251C\u2500"} {okr.krTitle}</Text>
                  <View style={t.progressRow}>
                    <Text style={[t.progressLabel, { color: theme.textMuted }]}>Activity</Text>
                    <View style={[t.progressTrack, { backgroundColor: theme.bgTertiary }]}>
                      <View style={[t.progressFill, { width: `${Math.min(okr.activity, 100)}%`, backgroundColor: "#3b82f6" }]} />
                    </View>
                    <Text style={[t.progressPct, { color: theme.textMuted }]}>{okr.activity}%</Text>
                  </View>
                  <View style={t.progressRow}>
                    <Text style={[t.progressLabel, { color: theme.textMuted }]}>Outcome</Text>
                    <View style={[t.progressTrack, { backgroundColor: theme.bgTertiary }]}>
                      <View style={[t.progressFill, { width: `${Math.min(okr.outcome, 100)}%`, backgroundColor: "#22c55e" }]} />
                    </View>
                    <Text style={[t.progressPct, { color: theme.textMuted }]}>{okr.outcome}%</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Insights */}
        {latestInsight && (
          <View style={t.section}>
            <Text style={[t.sectionHeader, { color: theme.textMuted }]}>
              {"\u{1F4A1}"} INSIGHTS
            </Text>
            <View style={[t.card, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
              <Text style={[t.insightText, { color: theme.textSecondary }]}>
                "{latestInsight.text}"
              </Text>
              <Text style={[t.insightMeta, { color: theme.textMuted }]}>
                From daily plan {"\u00B7"} {formatTimestamp(latestInsight.updatedAt)}
              </Text>
            </View>
          </View>
        )}

        {/* Notes */}
        <View style={t.section}>
          <TouchableOpacity onPress={() => setNotesExpanded(!notesExpanded)}>
            <Text style={[t.sectionHeader, { color: theme.textMuted }]}>
              {notesExpanded ? "\u25BC" : "\u25B6"} {"\u{1F4DD}"} NOTES ({noteEntries.length})
            </Text>
          </TouchableOpacity>
          {notesExpanded && (
            <>
              {visibleNotes.length === 0 && (
                <Text style={[t.emptyText, { color: theme.textMuted }]}>
                  No notes yet. Use "Add Note" to start.
                </Text>
              )}
              {visibleNotes.map((entry) => (
                <View
                  key={entry.date}
                  style={[t.card, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}
                >
                  <Text style={[t.noteDate, { color: theme.textSecondary }]}>{entry.date}</Text>
                  {entry.items.map((item, i) => (
                    <Text key={i} style={[t.noteItem, { color: theme.text }]}>
                      {"\u2022"} {item}
                    </Text>
                  ))}
                </View>
              ))}
              {!showAllNotes && hiddenNoteCount > 0 && (
                <TouchableOpacity onPress={() => setShowAllNotes(true)}>
                  <Text style={[t.showMore, { color: theme.accent }]}>
                    {"\u25BC"} Show older notes ({hiddenNoteCount} more)
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>

        {/* Activity */}
        <View style={t.section}>
          <TouchableOpacity onPress={() => setActivityExpanded(!activityExpanded)}>
            <Text style={[t.sectionHeader, { color: theme.textMuted }]}>
              {activityExpanded ? "\u25BC" : "\u25B6"} {"\u{1F4CA}"} ACTIVITY
            </Text>
          </TouchableOpacity>
          {activityExpanded && (
            <View style={[t.card, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
              <Text style={[t.activityLine, { color: theme.textSecondary }]}>
                {signalStats.total} signals {"\u00B7"} {signalStats.facts} facts {"\u00B7"} {signalStats.tasks} tasks {"\u00B7"} {signalStats.events} events
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Task detail slide-over — opens when a task card is tapped */}
      {selectedTask && (
        <TaskDetailSlideOver
          task={selectedTask}
          theme={theme}
          today={today}
          onClose={() => setSelectedTaskId(null)}
          onToggleDone={handleToggleDone}
          onUpdate={handleTaskUpdate}
        />
      )}

      {/* Reassign picker */}
      {reassignFor && appState && !showCreateInReassign && (
        <ReassignPicker
          theme={theme}
          currentTopicId={topicId}
          topics={appState.topicManifest.topics.filter((x) => !x.archivedAt)}
          onCancel={() => setReassignFor(null)}
          onPick={handleReassignTo}
          onCreateNew={() => setShowCreateInReassign(true)}
        />
      )}

      {/* Create-new-topic modal (from reassign picker) */}
      {showCreateInReassign && appState && reassignFor && (
        <CreateTopicModal
          theme={theme}
          helperText="Create a topic and move the selected item into it."
          ctaLabel="Create & reassign"
          existingSlugs={appState.topicManifest.topics.map((x) => x.id)}
          onCancel={() => setShowCreateInReassign(false)}
          onCreate={async (name, aliases) => {
            await handleCreateAndReassign(name, aliases);
          }}
        />
      )}
    </View>
  );
}

// ── Reassign picker modal ────────────────────────────────────────────────────
function ReassignPicker({
  theme,
  currentTopicId,
  topics,
  onCancel,
  onPick,
  onCreateNew,
}: {
  theme: Theme;
  currentTopicId: string;
  topics: TopicEntry[];
  onCancel: () => void;
  onPick: (toTopicId: string) => void;
  onCreateNew: () => void;
}) {
  const targets = topics.filter((x) => x.id !== currentTopicId);
  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel}>
      <View style={t.modalBackdrop}>
        {/* Sibling backdrop — see CreateTopicModal for rationale. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View
          style={[t.modalPanel, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}
        >
          <Text style={[t.modalTitle, { color: theme.text }]}>Reassign to…</Text>
          <ScrollView style={{ maxHeight: 300 }}>
            {/* Create-new always pinned at the top so users can always add a new topic. */}
            <TouchableOpacity
              style={[t.pickerRow, { borderBottomColor: theme.borderLight }]}
              onPress={onCreateNew}
            >
              <Text style={[t.pickerRowText, { color: theme.accent, fontWeight: "600" }]}>
                {"\u002B"} Create new topic…
              </Text>
            </TouchableOpacity>
            {targets.length === 0 ? (
              <Text style={[t.emptyText, { color: theme.textMuted }]}>
                No other topics yet. Create one above.
              </Text>
            ) : (
              targets.map((target) => (
                <TouchableOpacity
                  key={target.id}
                  style={[t.pickerRow, { borderBottomColor: theme.borderLight }]}
                  onPress={() => onPick(target.id)}
                >
                  <Text style={[t.pickerRowText, { color: theme.text }]}>{target.name}</Text>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
          <TouchableOpacity
            style={[
              t.noteBtn,
              {
                backgroundColor: theme.bgTertiary,
                borderColor: theme.borderLight,
                marginTop: 12,
                alignSelf: "flex-end",
              },
            ]}
            onPress={onCancel}
          >
            <Text style={[t.noteBtnText, { color: theme.textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Small helpers ────────────────────────────────────────────────────────────

function PrioPill({ priority }: { priority: string }) {
  const colors: Record<string, string> = { high: "#ef4444", medium: "#f59e0b", low: "#22c55e" };
  const c = colors[priority] || "#71717a";
  return (
    <Text style={[t.prioPill, { color: c, backgroundColor: c + "15" }]}>
      {priority.toUpperCase()}
    </Text>
  );
}

function formatEventDatetime(dt: string): string {
  return formatLocalDateTime(dt);
}

function formatTimestamp(ts: string): string {
  return formatLocalDateTime(ts);
}

const t = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  headerLeft: { flexDirection: "row", alignItems: "center" },
  backBtn: { paddingVertical: 4 },
  backText: { fontSize: 14, fontWeight: "600" },
  headerTitle: { fontSize: 18, fontWeight: "700", flex: 1, textAlign: "center" },
  addNoteBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  addNoteBtnText: { fontSize: 12, fontWeight: "600", color: "#fff" },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  metaText: { fontSize: 12, marginBottom: 4 },
  section: { marginTop: 16, marginBottom: 4 },
  sectionHeader: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2, marginBottom: 8 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 8,
  },
  cardTitle: { fontSize: 14, fontWeight: "600", marginBottom: 4 },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  metaLabel: { fontSize: 11 },
  prioPill: {
    fontSize: 10,
    fontWeight: "700",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
  },
  okrObjective: { fontSize: 14, fontWeight: "600", marginBottom: 4 },
  okrKr: { fontSize: 13, marginBottom: 6 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 3 },
  progressLabel: { fontSize: 11, minWidth: 52 },
  progressTrack: { flex: 1, height: 8, borderRadius: 4, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 4 },
  progressPct: { fontSize: 11, minWidth: 32, textAlign: "right" },
  insightText: { fontSize: 14, lineHeight: 20, fontStyle: "italic" },
  insightMeta: { fontSize: 11, marginTop: 8 },
  noteDate: { fontSize: 12, fontWeight: "600", marginBottom: 4 },
  noteItem: { fontSize: 13, lineHeight: 20, marginLeft: 4 },
  showMore: { fontSize: 12, fontWeight: "600", marginTop: 4, textAlign: "center" },
  emptyText: { fontSize: 13, padding: 12 },
  activityLine: { fontSize: 12 },
  noteInputCard: { borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 12, marginBottom: 4 },
  noteInputField: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: "top",
  },
  noteInputActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 8 },
  noteBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1 },
  noteBtnText: { fontSize: 12, fontWeight: "600" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerIconBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1 },
  headerIconText: { fontSize: 12, fontWeight: "600" },
  summaryCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginTop: 12,
    marginBottom: 8,
  },
  summaryLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2, marginBottom: 6 },
  summaryText: { fontSize: 14, lineHeight: 20 },
  summaryMeta: { fontSize: 11, marginTop: 8 },
  itemActions: { flexDirection: "row", gap: 6, marginTop: 10 },
  itemBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1 },
  itemBtnText: { fontSize: 11, fontWeight: "600" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalPanel: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    width: "100%",
    maxWidth: 400,
  },
  modalTitle: { fontSize: 16, fontWeight: "700", marginBottom: 12 },
  pickerRow: { paddingVertical: 10, borderBottomWidth: 1 },
  pickerRowText: { fontSize: 14 },
});
