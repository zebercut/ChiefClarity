/**
 * Topics tab — browse, search, and manage topic-based knowledge groupings.
 * FEAT023 Stories 7-8.
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
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { ConfigContext } from "../_layout";
import { loadState } from "../../src/modules/loader";
import { applyWrites } from "../../src/modules/executor";
import { buildTopicCrossRef } from "../../src/modules/topicManager";
import type { Theme } from "../../src/constants/themes";
import type { ActionPlan } from "../../src/types";
import type { AppState, TopicEntry, TopicSuggestion } from "../../src/types";
import { getTodayFromTz } from "../../src/utils/dates";
import TopicCard from "../../src/components/topics/TopicCard";
import TopicSuggestionCard from "../../src/components/topics/TopicSuggestionCard";
import CreateTopicModal from "../../src/components/topics/CreateTopicModal";

const INITIAL_SHOW = 10;
const LOAD_MORE = 10;

/** Deterministic color from topic name — cycles through 6 colors */
const TOPIC_COLORS = ["#6366f1", "#8b5cf6", "#22c55e", "#f59e0b", "#06b6d4", "#ec4899"];
function topicColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return TOPIC_COLORS[Math.abs(hash) % TOPIC_COLORS.length];
}

/** Relative date label */
function relativeDate(dateStr: string, today: string): string {
  if (!dateStr) return "No activity";
  const d = dateStr.slice(0, 10);
  if (d === today) return "Today";
  const diff = (new Date(today).getTime() - new Date(d).getTime()) / 86400000;
  if (diff <= 1) return "Yesterday";
  if (diff <= 7) return `${Math.round(diff)} days ago`;
  return d;
}

interface TopicStats {
  topic: TopicEntry;
  taskCount: number;
  eventCount: number;
  signalCount: number;
  lastActive: string;
  priorityBreakdown: { high: number; medium: number; low: number };
}

export default function TopicsScreen() {
  const { theme } = useContext(ConfigContext);
  const router = useRouter();
  const [appState, setAppState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCount, setShowCount] = useState(INITIAL_SHOW);
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const state = await loadState();
      setAppState(state);
    } catch (err: any) {
      console.error("[topics] loadState failed:", err?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  // Compute stats per topic
  const topicStats: TopicStats[] = useMemo(() => {
    if (!appState) return [];
    const manifest = appState.topicManifest;
    const activeTasks = appState.tasks.tasks.filter(
      (t) => t.status !== "done" && t.status !== "deferred" && t.status !== "parked"
    );
    const activeEvents = appState.calendar.events.filter(
      (e) => !e.archived && e.status !== "cancelled"
    );
    const crossRefs = buildTopicCrossRef(manifest, activeTasks, activeEvents);

    return manifest.topics.map((topic) => {
      const cr = crossRefs.find((c) => c.topic === topic.id);
      const taskIds = cr?.taskIds || [];
      const eventIds = cr?.eventIds || [];
      const relatedTasks = activeTasks.filter((t) => taskIds.includes(t.id));

      // Signal count for this topic
      const signalCount = manifest.signals.filter((s) => s.topic === topic.id).length;

      // Last active from signals
      const topicSignals = manifest.signals
        .filter((s) => s.topic === topic.id)
        .sort((a, b) => b.date.localeCompare(a.date));
      const lastActive = topicSignals.length > 0 ? topicSignals[0].date : topic.createdAt;

      // Priority breakdown
      const prio = { high: 0, medium: 0, low: 0 };
      for (const t of relatedTasks) {
        if (t.priority === "high") prio.high++;
        else if (t.priority === "medium") prio.medium++;
        else prio.low++;
      }

      return {
        topic,
        taskCount: taskIds.length,
        eventCount: eventIds.length,
        signalCount,
        lastActive,
        priorityBreakdown: prio,
      };
    });
  }, [appState]);

  // Split active vs archived, then sort each by last activity (most recent first)
  const { activeSorted, archivedSorted } = useMemo(() => {
    const active: TopicStats[] = [];
    const archived: TopicStats[] = [];
    for (const s of topicStats) {
      if (s.topic.archivedAt) archived.push(s);
      else active.push(s);
    }
    active.sort((a, b) => b.lastActive.localeCompare(a.lastActive));
    archived.sort((a, b) => (b.topic.archivedAt || "").localeCompare(a.topic.archivedAt || ""));
    return { activeSorted: active, archivedSorted: archived };
  }, [topicStats]);

  // Filter by search
  const filterBySearch = useCallback(
    (list: TopicStats[]) => {
      if (!search.trim()) return list;
      const q = search.toLowerCase();
      return list.filter((s) => {
        const t = s.topic;
        return (
          t.name.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q) ||
          t.aliases.some((a) => a.toLowerCase().includes(q))
        );
      });
    },
    [search]
  );

  const filtered = useMemo(() => filterBySearch(activeSorted), [activeSorted, filterBySearch]);
  const filteredArchived = useMemo(() => filterBySearch(archivedSorted), [archivedSorted, filterBySearch]);

  const visible = filtered.slice(0, showCount);
  const remaining = filtered.length - visible.length;

  // Pending suggestions
  const pendingSuggestions: TopicSuggestion[] = useMemo(() => {
    if (!appState) return [];
    return appState.topicManifest.pendingSuggestions.filter((s) => s.status === "pending");
  }, [appState]);

  const today = appState?.hotContext?.today || getTodayFromTz(appState?.userProfile?.timezone);
  const activeTopicCount = activeSorted.length;
  const archivedTopicCount = archivedSorted.length;
  const topicCount = activeTopicCount + archivedTopicCount;

  // Handle suggestion actions — all three route through the executor's
  // existing topic actions so we get fact migration, dedup, and any future
  // side-effects for free. The UI must never duplicate executor logic.
  const dispatchTopicAction = useCallback(
    async (action: string, topicSlug: string, extra: Record<string, unknown> = {}) => {
      if (!appState) return;
      const plan: ActionPlan = {
        reply: "",
        writes: [
          {
            file: "topicManifest",
            action: "add",
            data: { _action: action, topic: topicSlug, ...extra },
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
      refresh();
    },
    [appState, refresh]
  );

  const handleAccept = useCallback(
    (topicSlug: string) => {
      const name = topicSlug
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      return dispatchTopicAction("accept_suggestion", topicSlug, { name });
    },
    [dispatchTopicAction]
  );

  const handleReject = useCallback(
    (topicSlug: string) => dispatchTopicAction("reject_suggestion", topicSlug),
    [dispatchTopicAction]
  );

  const handleDefer = useCallback(
    (topicSlug: string) => dispatchTopicAction("defer_suggestion", topicSlug),
    [dispatchTopicAction]
  );

  const handleCreateTopic = useCallback(
    async (name: string, aliases: string[]) => {
      if (!appState) return;
      const plan: ActionPlan = {
        reply: "",
        writes: [
          {
            file: "topicManifest",
            action: "add",
            data: { _action: "create_topic", name, aliases },
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
      setShowCreate(false);
      refresh();
    },
    [appState, refresh]
  );

  // Loading state
  if (loading && !appState) {
    return (
      <View style={[s.container, { backgroundColor: theme.bg }]}>
        <View style={[s.header, { borderBottomColor: theme.borderLight }]}>
          <Text style={[s.headerTitle, { color: theme.text }]}>Topics</Text>
        </View>
        <View style={s.center}>
          <ActivityIndicator size="large" color={theme.accent} />
        </View>
      </View>
    );
  }

  // Empty state
  if (topicCount === 0 && pendingSuggestions.length === 0) {
    return (
      <View style={[s.container, { backgroundColor: theme.bg }]}>
        <View style={[s.header, { borderBottomColor: theme.borderLight }]}>
          <Text style={[s.headerTitle, { color: theme.text }]}>Topics</Text>
        </View>
        <View style={s.center}>
          <View style={[s.emptyAvatar, { backgroundColor: theme.accent }]}>
            <Text style={s.emptyAvatarText}>{"\u{1F4DA}"}</Text>
          </View>
          <Text style={[s.emptyTitle, { color: theme.text }]}>No topics yet</Text>
          <Text style={[s.emptySubtitle, { color: theme.textMuted }]}>
            Topics group your tasks, events, and notes by theme. They're created
            automatically when you mention something often, or you can create one in chat.
          </Text>
          <View style={s.emptyActions}>
            {["Create a topic for job search", "Create a topic for kids"].map((label) => (
              <TouchableOpacity
                key={label}
                style={[s.emptyBtn, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}
                onPress={() => router.navigate({ pathname: "/(tabs)/chat", params: { prefill: label } } as any)}
              >
                <Text style={[s.emptyBtnText, { color: theme.textSecondary }]}>"{label}"</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: theme.bg }]}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: theme.borderLight }]}>
        <View style={s.headerRow}>
          <View>
            <Text style={[s.headerTitle, { color: theme.text }]}>Topics</Text>
            <Text style={[s.headerMeta, { color: theme.textMuted }]}>
              {activeTopicCount} active{archivedTopicCount > 0 ? ` · ${archivedTopicCount} archived` : ""}
            </Text>
          </View>
          <TouchableOpacity
            style={[s.newBtn, { backgroundColor: theme.accent }]}
            onPress={() => setShowCreate(true)}
            accessibilityLabel="Create new topic"
          >
            <Text style={s.newBtnText}>{"\u002B New"}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        {/* Search */}
        <View style={[s.searchRow, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
          <Text style={[s.searchIcon, { color: theme.textMuted }]}>{"\u{1F50D}"}</Text>
          <TextInput
            style={[s.searchInput, { color: theme.text }]}
            placeholder="Search topics..."
            placeholderTextColor={theme.placeholder}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        {/* Pending Suggestions */}
        {pendingSuggestions.length > 0 && (
          <View style={s.section}>
            <TouchableOpacity onPress={() => setSuggestionsExpanded(!suggestionsExpanded)}>
              <Text style={[s.sectionHeader, { color: theme.textMuted }]}>
                {suggestionsExpanded ? "\u25BC" : "\u25B6"} {"\u{1F4A1}"} SUGGESTED ({pendingSuggestions.length})
              </Text>
            </TouchableOpacity>
            {suggestionsExpanded &&
              pendingSuggestions.map((sug) => (
                <TopicSuggestionCard
                  key={sug.topic}
                  topic={sug.topic.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
                  count={sug.count}
                  threshold={sug.threshold}
                  onAccept={() => handleAccept(sug.topic)}
                  onReject={() => handleReject(sug.topic)}
                  onDefer={() => handleDefer(sug.topic)}
                  theme={theme}
                />
              ))}
          </View>
        )}

        {/* Topics list */}
        <View style={s.section}>
          <View style={s.topicsHeaderRow}>
            <Text style={[s.sectionHeader, { color: theme.textMuted, flex: 1 }]}>
              {"\u{1F4DA}"} TOPICS ({filtered.length + (showArchived ? filteredArchived.length : 0)})
            </Text>
            {/* Filter checkbox is always visible so users know the option exists.
                Previously hidden when archivedTopicCount was 0, which created a
                chicken-and-egg: if archiving silently failed, users never saw
                the filter either. */}
            <TouchableOpacity
              style={s.filterRow}
              onPress={() => setShowArchived(!showArchived)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: showArchived }}
            >
              <View
                style={[
                  s.checkbox,
                  {
                    borderColor: showArchived ? theme.accent : theme.borderLight,
                    backgroundColor: showArchived ? theme.accent : "transparent",
                  },
                ]}
              >
                {showArchived && <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>{"\u2713"}</Text>}
              </View>
              <Text style={[s.checkboxLabel, { color: theme.textSecondary }]}>
                Show archived{archivedTopicCount > 0 ? ` (${archivedTopicCount})` : ""}
              </Text>
            </TouchableOpacity>
          </View>

          {visible.map((ts) => (
            <TopicCard
              key={ts.topic.id}
              name={ts.topic.name}
              taskCount={ts.taskCount}
              eventCount={ts.eventCount}
              signalCount={ts.signalCount}
              lastActive={relativeDate(ts.lastActive, today)}
              priorityBreakdown={ts.priorityBreakdown}
              colorDot={topicColor(ts.topic.name)}
              onPress={() =>
                router.navigate({
                  pathname: "/(tabs)/topic-detail",
                  params: { id: ts.topic.id },
                } as any)
              }
              theme={theme}
            />
          ))}

          {remaining > 0 && (
            <TouchableOpacity
              style={[s.loadMoreBtn, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}
              onPress={() => setShowCount((c) => c + LOAD_MORE)}
            >
              <Text style={[s.loadMoreText, { color: theme.textMuted }]}>
                Show {Math.min(remaining, LOAD_MORE)} more ({remaining} remaining)
              </Text>
            </TouchableOpacity>
          )}

          {/* Archived topics appear below active ones when the checkbox is checked */}
          {showArchived &&
            filteredArchived.map((ts) => (
              <TopicCard
                key={ts.topic.id}
                name={ts.topic.name}
                taskCount={ts.taskCount}
                eventCount={ts.eventCount}
                signalCount={ts.signalCount}
                lastActive={relativeDate(ts.lastActive, today)}
                priorityBreakdown={ts.priorityBreakdown}
                colorDot={topicColor(ts.topic.name)}
                archived
                onPress={() =>
                  router.navigate({
                    pathname: "/(tabs)/topic-detail",
                    params: { id: ts.topic.id },
                  } as any)
                }
                theme={theme}
              />
            ))}

          {filtered.length === 0 && search.trim() && (
            <View style={s.emptySearch}>
              <Text style={[s.emptySearchText, { color: theme.textMuted }]}>
                No topics match "{search}"
              </Text>
              <TouchableOpacity onPress={() => setSearch("")}>
                <Text style={[s.clearLink, { color: theme.accent }]}>Clear search</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>

      {showCreate && appState && (
        <CreateTopicModal
          theme={theme}
          existingSlugs={appState.topicManifest.topics.map((x) => x.id)}
          onCancel={() => setShowCreate(false)}
          onCreate={handleCreateTopic}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { borderBottomWidth: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  newBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  newBtnText: { fontSize: 12, fontWeight: "600", color: "#fff" },
  topicsHeaderRow: { flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 12 },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  checkbox: {
    width: 16,
    height: 16,
    borderWidth: 1,
    borderRadius: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: { width: 10, height: 10, borderRadius: 2 },
  checkboxLabel: { fontSize: 12 },
  headerTitle: { fontSize: 22, fontWeight: "700" },
  headerMeta: { fontSize: 12, marginTop: 2 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
    marginBottom: 16,
  },
  searchIcon: { fontSize: 14 },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  section: { marginBottom: 20 },
  sectionHeader: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2, marginBottom: 8 },
  loadMoreBtn: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
    marginTop: 4,
  },
  loadMoreText: { fontSize: 12, fontWeight: "600" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  emptyAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  emptyAvatarText: { fontSize: 28 },
  emptyTitle: { fontSize: 18, fontWeight: "600", marginBottom: 8 },
  emptySubtitle: { fontSize: 14, textAlign: "center", maxWidth: 320, lineHeight: 20, marginBottom: 20 },
  emptyActions: { gap: 8 },
  emptyBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  emptyBtnText: { fontSize: 13 },
  emptySearch: { padding: 24, alignItems: "center", gap: 8 },
  emptySearchText: { fontSize: 13 },
  clearLink: { fontSize: 13, fontWeight: "600" },
});
