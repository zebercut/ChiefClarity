import React, { useState, useEffect, useContext, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  SectionList,
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Pressable,
} from "react-native";
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ConfigContext } from "../_layout";
import { loadState } from "../../src/modules/loader";
import { flush } from "../../src/modules/executor";
import { executeDirectAction } from "../../src/modules/smartActions";
import { trackFeaturesUsage } from "../../src/modules/tips";
import { getUserToday, dateOffset, nowLocalIso } from "../../src/utils/dates";
import {
  computeTaskPriority,
  type SortMode,
} from "../../src/modules/taskPrioritizer";
import {
  filterTasks,
  searchTasks,
  groupTasks,
  type GroupBy,
  type TaskFilters,
} from "../../src/modules/taskFilters";
import TaskListItem from "../../src/components/TaskListItem";
import TaskDetailSlideOver, { PickerModal } from "../../src/components/TaskDetailSlideOver";
import type { Theme } from "../../src/constants/themes";
import type { AppState, Task } from "../../src/types";

const STORAGE_KEY = "lifeos:tasks_tab:filters_v3";
const LEGACY_STORAGE_KEYS = [
  "lifeos:tasks_tab:filters_v1",
  "lifeos:tasks_tab:filters_v2",
];
const POLL_INTERVAL_MS = 5 * 60 * 1000;

interface PersistedPrefs {
  groupBy: GroupBy;
  sortBy: SortMode;
  filters: TaskFilters;
}

const DEFAULT_PREFS: PersistedPrefs = {
  groupBy: "dueBucket",
  sortBy: "default",
  filters: { includeDone: false },
};

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "due", label: "Due Date" },
  { value: "priority", label: "Priority" },
  { value: "title", label: "Title" },
];

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "dueBucket", label: "Status" },
  { value: "category", label: "Category" },
  { value: "none", label: "None" },
];

export default function TasksScreen() {
  const { theme } = useContext(ConfigContext);

  const [appState, setAppState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortMode>(DEFAULT_PREFS.sortBy);
  const [groupBy, setGroupBy] = useState<GroupBy>(DEFAULT_PREFS.groupBy);
  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_PREFS.filters);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  // Selected task is tracked by ID, not by object reference. The displayed
  // task is derived below via useMemo, so background state refreshes never
  // leave the panel pointing at a stale snapshot.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortPickerOpen, setSortPickerOpen] = useState(false);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [statsExpanded, setStatsExpanded] = useState(true);
  const [activeStat, setActiveStat] = useState<StatKey | null>(null);
  const loadingRef = useRef(false);

  const selectedTask = useMemo(() => {
    if (!appState || !selectedId) return null;
    return appState.tasks.tasks.find((t) => t.id === selectedId) || null;
  }, [appState, selectedId]);

  // Load persisted prefs once on mount. Migrates from any legacy storage key
  // (the schema bumped twice during development) and cleans up the old ones.
  useEffect(() => {
    (async () => {
      try {
        let raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) {
          for (const legacyKey of LEGACY_STORAGE_KEYS) {
            const legacy = await AsyncStorage.getItem(legacyKey);
            if (legacy) {
              raw = legacy;
              await AsyncStorage.setItem(STORAGE_KEY, legacy);
              break;
            }
          }
          // Clean up all legacy keys regardless of whether one matched
          await Promise.all(
            LEGACY_STORAGE_KEYS.map((k) => AsyncStorage.removeItem(k))
          );
        }
        if (raw) {
          const parsed: PersistedPrefs = JSON.parse(raw);
          if (parsed.groupBy) setGroupBy(parsed.groupBy);
          if (parsed.sortBy) setSortBy(parsed.sortBy);
          if (parsed.filters) setFilters(parsed.filters);
        }
      } catch {
        // ignore corrupt prefs
      } finally {
        setPrefsLoaded(true);
      }
    })();
  }, []);

  // Persist prefs whenever they change (after initial load)
  useEffect(() => {
    if (!prefsLoaded) return;
    const prefs: PersistedPrefs = { groupBy, sortBy, filters };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)).catch(() => {});
  }, [groupBy, sortBy, filters, prefsLoaded]);

  const loadTasks = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const state = await loadState();
      setAppState(state);
    } catch (err: any) {
      // Bug 4: keep the existing in-memory state on transient read failure.
      // The loader now throws on read/decrypt/parse failure — do NOT replace
      // a populated state with empty defaults from a failed reload.
      console.error("[tasks] loadState failed — keeping existing state:", err?.message);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  // Reload every time tab gains focus
  useFocusEffect(
    useCallback(() => {
      loadTasks();
      trackFeaturesUsage(["tasks_tab_viewed"]).catch(() => {});
    }, [loadTasks])
  );

  // Re-poll while the tab is open. Pause while the user has the detail panel
  // open so a background refresh can't overwrite an in-progress edit.
  useEffect(() => {
    if (selectedId) return;
    const id = setInterval(() => {
      loadTasks();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loadTasks, selectedId]);

  const today = appState ? getUserToday(appState) : "";

  // Defensive dedupe by task id. tasks.json should never contain duplicates,
  // but if it does (e.g. corrupted via a manual edit, or a sync race), the
  // SectionList below would crash with duplicate-key warnings. We keep the
  // first occurrence and log a one-time warning so the underlying data bug
  // is visible without breaking the UI.
  const dedupedTasks = useMemo(() => {
    if (!appState) return [];
    const seen = new Set<string>();
    const out: Task[] = [];
    const dupes: string[] = [];
    for (const t of appState.tasks.tasks) {
      if (seen.has(t.id)) {
        dupes.push(t.id);
        continue;
      }
      seen.add(t.id);
      out.push(t);
    }
    if (dupes.length > 0) {
      console.warn(
        `[tasks] dropped ${dupes.length} duplicate task id(s) from render:`,
        dupes
      );
    }
    return out;
  }, [appState]);

  // High-level stats for the header
  const stats = useMemo(() => {
    const total = dedupedTasks.length;
    let completed = 0;
    let overdue = 0;
    let active = 0;
    for (const t of dedupedTasks) {
      if (t.status === "done" || t.status === "deferred") {
        completed++;
        continue;
      }
      if (t.status === "parked") continue; // parked tasks excluded from active + urgent counts
      active++;
      if (t.status === "overdue" || (t.due && t.due.slice(0, 10) < today)) {
        overdue++;
      }
    }
    return { total, active, completed, overdue };
  }, [dedupedTasks, today]);

  // 7-day burndown: for each day in the trailing week, how many tasks were
  // "in scope" (existed by end of that day) and how many were already
  // completed by end of that day. Remaining = inScope - completed.
  //
  // The last point is "Today" (oldest → newest left → right), matching the
  // chart's x-axis.
  const burndown = useMemo(() => {
    if (!today) return [];
    const days: {
      date: string;
      label: string;
      remaining: number;
      completed: number;
    }[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = dateOffset(today, -i);
      const isToday = i === 0;
      const label = isToday
        ? "Today"
        : new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
            weekday: "short",
          });
      let inScope = 0;
      let completed = 0;
      for (const t of dedupedTasks) {
        const created = (t.createdAt || "").slice(0, 10);
        // Treat tasks with no createdAt as "always existed"
        if (created && created > date) continue;
        inScope++;
        if (t.status === "done" && t.completedAt) {
          const doneDay = t.completedAt.slice(0, 10);
          if (doneDay <= date) completed++;
        }
      }
      days.push({
        date,
        label,
        remaining: inScope - completed,
        completed,
      });
    }
    return days;
  }, [dedupedTasks, today]);

  // Active tasks pipeline (excluding done)
  const activeSections = useMemo(() => {
    if (!appState) return [];
    const showDone = activeStat === "done" || activeStat === "total";
    const sorted = computeTaskPriority(dedupedTasks, today, {
      sortBy,
      includeDone: showDone,
    });
    const searched = searchTasks(sorted, searchQuery);
    const filtered = filterTasks(searched, { ...filters, includeDone: showDone }, today);
    // Apply stat filter
    const statFiltered = activeStat
      ? filtered.filter((t) => {
          if (activeStat === "total") return true;
          if (activeStat === "done") return t.status === "done";
          if (activeStat === "open") return t.status !== "done";
          if (activeStat === "urgent") return t.status !== "done" && t.due && t.due.slice(0, 10) < today;
          return true;
        })
      : filtered;
    return groupTasks(statFiltered, groupBy, today);
  }, [appState, dedupedTasks, today, searchQuery, sortBy, filters, groupBy, activeStat]);

  // Completed section (always at bottom when includeDone is on)
  const completedSection = useMemo(() => {
    if (!appState || (!filters.includeDone && activeStat !== "done" && activeStat !== "total")) return null;
    const doneOnly = dedupedTasks.filter((t) => t.status === "done");
    const sorted = computeTaskPriority(doneOnly, today, {
      sortBy: "default",
      includeDone: true,
    });
    const searched = searchTasks(sorted, searchQuery);
    if (searched.length === 0) return null;
    return { title: "COMPLETED", data: searched };
  }, [appState, dedupedTasks, today, searchQuery, filters.includeDone, activeStat]);

  const sections = useMemo(() => {
    const result = activeSections.map((s) => ({
      ...s,
      // Uppercase section labels for the new design
      title: s.title.toUpperCase(),
    }));
    if (completedSection) result.push(completedSection);
    return result;
  }, [activeSections, completedSection]);

  const totalShown = useMemo(
    () => sections.reduce((n, s) => n + s.data.length, 0),
    [sections]
  );

  function resetEverything() {
    setSearchQuery("");
    setFilters({ includeDone: false });
    setSortBy("default");
    setGroupBy("dueBucket");
  }

  function toggleShowCompleted() {
    setFilters((prev) => ({ ...prev, includeDone: !prev.includeDone }));
  }

  function handleStatPress(stat: StatKey) {
    // Toggle: tap same stat again to clear filter
    setActiveStat((prev) => (prev === stat ? null : stat));
  }

  // Apply an immutable patch to a task and persist. Returns the next state so
  // callers can flush the same object that was committed to React.
  function applyTaskPatch(
    prev: AppState,
    taskId: string,
    patch: Partial<Task>
  ): AppState {
    const next: AppState = {
      ...prev,
      tasks: {
        ...prev.tasks,
        tasks: prev.tasks.tasks.map((t) =>
          t.id === taskId ? { ...t, ...patch } : t
        ),
      },
    };
    next._dirty = new Set(prev._dirty);
    next._dirty.add("tasks");
    return next;
  }

  async function markTaskDone(task: Task) {
    if (!appState) return;
    const wasDone = task.status === "done";
    const patch: Partial<Task> = {
      status: wasDone ? "pending" : "done",
      completedAt: wasDone ? null : nowLocalIso(),
    };
    let nextState: AppState | null = null;
    setAppState((prev) => {
      if (!prev) return prev;
      nextState = applyTaskPatch(prev, task.id, patch);
      return nextState;
    });
    try {
      if (nextState) await flush(nextState);
    } catch (err) {
      console.error("[tasks] failed to persist mark-done:", err);
    }
  }

  async function updateTaskFields(taskId: string, patch: Partial<Task>) {
    let nextState: AppState | null = null;
    setAppState((prev) => {
      if (!prev) return prev;
      nextState = applyTaskPatch(prev, taskId, patch);
      return nextState;
    });
    try {
      if (nextState) await flush(nextState);
    } catch (err) {
      console.error("[tasks] failed to persist task update:", err);
    }
  }

  async function handleTaskAction(actionType: string, taskId: string): Promise<{ success: boolean; message: string }> {
    if (!appState) return { success: false, message: "No state" };
    const result = await executeDirectAction(actionType, taskId, appState);
    if (result.success) {
      // Refresh state after action
      setAppState({ ...appState });
    }
    return result;
  }

  if (loading && !appState) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  const totalTasks = appState?.tasks.tasks.length || 0;
  const noTasksAtAll = totalTasks === 0;
  const noResults = !noTasksAtAll && totalShown === 0;
  const hasActiveFilters =
    searchQuery.trim().length >= 2 ||
    sortBy !== "default" ||
    groupBy !== "dueBucket" ||
    !!filters.includeDone;

  const sortLabel = SORT_OPTIONS.find((o) => o.value === sortBy)?.label || "Default";
  const groupLabel = GROUP_OPTIONS.find((o) => o.value === groupBy)?.label || "Status";

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Tasks</Text>
        <Pressable
          onPress={() => setStatsExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: statsExpanded }}
          accessibilityLabel="Toggle stats"
          style={({ pressed }) => [
            styles.statsToggle,
            {
              backgroundColor: theme.accent + "15",
              borderColor: theme.accent + "30",
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Text style={[styles.statsToggleIcon, { color: theme.accent }]}>
            {"\u{1F4CA}"}
          </Text>
          <Text style={[styles.statsToggleLabel, { color: theme.accent }]}>
            Stats
          </Text>
          <Text style={[styles.statsToggleChevron, { color: theme.accent }]}>
            {statsExpanded ? "\u25B4" : "\u25BE"}
          </Text>
        </Pressable>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <View
          style={[
            styles.searchField,
            { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight },
          ]}
        >
          <Text style={[styles.searchIcon, { color: theme.textMuted }]}>
            {"\u{1F50D}"}
          </Text>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search tasks…"
            placeholderTextColor={theme.placeholder}
            style={[styles.searchInput, { color: theme.text }]}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery("")} hitSlop={8}>
              <Text style={{ color: theme.textMuted, fontSize: 14 }}>{"\u2715"}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Sort + Group dropdowns */}
      <View style={styles.controlsRow}>
        <DropdownButton
          theme={theme}
          icon={"\u21C5"}
          label={`Sort: ${sortLabel}`}
          onPress={() => setSortPickerOpen(true)}
        />
        <DropdownButton
          theme={theme}
          icon={"\u29C9"}
          label={`Group: ${groupLabel}`}
          onPress={() => setGroupPickerOpen(true)}
        />
      </View>

      {/* Show completed toggle */}
      <View style={styles.completedToggleRow}>
        <Pressable
          onPress={toggleShowCompleted}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: !!filters.includeDone }}
          accessibilityLabel="Show completed tasks"
          style={styles.completedToggle}
          hitSlop={6}
        >
          <View
            style={[
              styles.completedCheckbox,
              {
                borderColor: filters.includeDone ? theme.accent : theme.borderLight,
                backgroundColor: filters.includeDone ? theme.accent : "transparent",
              },
            ]}
          >
            {filters.includeDone && (
              <Text style={styles.completedCheckmark}>{"\u2713"}</Text>
            )}
          </View>
          <Text style={[styles.completedToggleLabel, { color: theme.textSecondary }]}>
            Show completed
          </Text>
        </Pressable>
      </View>

      {/* Body */}
      {noTasksAtAll ? (
        <View style={styles.center}>
          <Text style={[styles.emptyTitle, { color: theme.text }]}>No tasks yet</Text>
          <Text style={[styles.emptyBody, { color: theme.textMuted }]}>
            Capture your first task in chat.
          </Text>
        </View>
      ) : noResults ? (
        <View style={styles.center}>
          <Text style={[styles.emptyTitle, { color: theme.text }]}>
            {hasActiveFilters ? "No tasks match" : "Nothing here"}
          </Text>
          {hasActiveFilters && (
            <TouchableOpacity
              onPress={resetEverything}
              style={[styles.emptyAction, { backgroundColor: theme.accent }]}
            >
              <Text style={{ color: "#fff", fontWeight: "600" }}>Reset</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            statsExpanded ? (
              <TaskStatsHeader
                theme={theme}
                stats={stats}
                burndown={burndown}
                activeStat={activeStat}
                onStatPress={handleStatPress}
              />
            ) : null
          }
          renderItem={({ item }) => (
            <TaskListItem
              task={item}
              theme={theme}
              today={today}
              onPress={(t) => setSelectedId(t.id)}
              onToggleDone={markTaskDone}
            />
          )}
          renderSectionHeader={({ section }) =>
            section.title ? (
              <View
                style={[styles.sectionHeader, { backgroundColor: theme.bg }]}
              >
                <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>
                  {section.title}
                </Text>
                <Text style={[styles.sectionCount, { color: theme.textMuted }]}>
                  {section.data.length}
                </Text>
              </View>
            ) : null
          }
          stickySectionHeadersEnabled
          contentContainerStyle={{ paddingBottom: 32 }}
        />
      )}

      {/* Sort picker */}
      <PickerModal
        visible={sortPickerOpen}
        title="Sort by"
        options={SORT_OPTIONS}
        selected={sortBy}
        theme={theme}
        onSelect={(v) => {
          setSortBy(v as SortMode);
          setSortPickerOpen(false);
        }}
        onClose={() => setSortPickerOpen(false)}
      />

      {/* Group picker */}
      <PickerModal
        visible={groupPickerOpen}
        title="Group by"
        options={GROUP_OPTIONS}
        selected={groupBy}
        theme={theme}
        onSelect={(v) => {
          setGroupBy(v as GroupBy);
          setGroupPickerOpen(false);
        }}
        onClose={() => setGroupPickerOpen(false)}
      />

      {/* Detail slide-over — only mounts when a task is selected */}
      {selectedTask && (
        <TaskDetailSlideOver
          task={selectedTask}
          theme={theme}
          today={today}
          onClose={() => setSelectedId(null)}
          onToggleDone={markTaskDone}
          onUpdate={(patch) => updateTaskFields(selectedTask.id, patch)}
          onAction={handleTaskAction}
        />
      )}
    </View>
  );
}

// ─── Stats header (cards + completion rate + burndown chart) ────────────────
// NOTE: TaskDetailSlideOver, ChipButton, PickerModal, capitalize,
// priorityChipStyle extracted to src/components/TaskDetailSlideOver.tsx

// ─── Stats header (cards + completion rate + burndown chart) ────────────────

interface TaskStats {
  total: number;
  active: number;
  completed: number;
  overdue: number;
}

interface BurndownDay {
  date: string;
  label: string;
  remaining: number;
  completed: number;
}

// Series colors used by the line chart and the legend
const REMAINING_COLOR = "#6366f1"; // indigo
const COMPLETED_COLOR = "#16a34a"; // green

const CHART_HEIGHT = 140;
const Y_AXIS_WIDTH = 24;
const CHART_VERTICAL_PADDING = 8;

type StatKey = "total" | "done" | "open" | "urgent";

const TaskStatsHeader = React.memo(function TaskStatsHeader({
  theme,
  stats,
  burndown,
  activeStat,
  onStatPress,
}: {
  theme: Theme;
  stats: TaskStats;
  burndown: BurndownDay[];
  activeStat: StatKey | null;
  onStatPress: (stat: StatKey) => void;
}) {
  const completionRate =
    stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  return (
    <View style={statsStyles.container}>
      <View
        style={[
          statsStyles.card,
          { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight },
        ]}
      >
        {/* Stat cards row */}
        <View
          style={statsStyles.cardsRow}
          accessibilityLabel={`Stats: ${stats.total} total, ${stats.completed} done, ${stats.active} open, ${stats.overdue} urgent`}
        >
          <StatPill
            value={stats.total}
            label="Total"
            valueColor={theme.text}
            bg="#f1f5f9"
            border="#e2e8f0"
            active={activeStat === "total"}
            onPress={() => onStatPress("total")}
          />
          <StatPill
            value={stats.completed}
            label="Done"
            valueColor="#16a34a"
            bg="#dcfce7"
            border="#bbf7d0"
            active={activeStat === "done"}
            onPress={() => onStatPress("done")}
          />
          <StatPill
            value={stats.active}
            label="Open"
            valueColor="#d97706"
            bg="#fef3c7"
            border="#fde68a"
            active={activeStat === "open"}
            onPress={() => onStatPress("open")}
          />
          <StatPill
            value={stats.overdue}
            label="Urgent"
            valueColor="#dc2626"
            bg="#fee2e2"
            border="#fecaca"
            active={activeStat === "urgent"}
            onPress={() => onStatPress("urgent")}
          />
        </View>

        {/* Completion rate */}
        <View style={statsStyles.completionBlock}>
          <View style={statsStyles.completionHeader}>
            <Text style={[statsStyles.completionLabel, { color: theme.text }]}>
              Completion Rate
            </Text>
            <Text style={[statsStyles.completionValue, { color: theme.accent }]}>
              {completionRate}%
            </Text>
          </View>
          <View
            style={[
              statsStyles.progressTrack,
              { backgroundColor: theme.bgTertiary },
            ]}
          >
            <View
              style={[
                statsStyles.progressFill,
                {
                  width: `${completionRate}%`,
                  backgroundColor: theme.accent,
                },
              ]}
            />
          </View>
        </View>

        {/* Burndown chart */}
        <View style={statsStyles.chartBlock}>
          <View style={statsStyles.chartHeader}>
            <Text style={[statsStyles.chartIcon, { color: theme.textMuted }]}>
              {"\u2248"}
            </Text>
            <Text style={[statsStyles.chartTitle, { color: theme.text }]}>
              Task Burndown
            </Text>
            <Text style={[statsStyles.chartRange, { color: theme.textMuted }]}>
              — This Week
            </Text>
          </View>

          <BurndownChart theme={theme} data={burndown} />

          <View style={statsStyles.legend}>
            <LegendDot color={REMAINING_COLOR} label="Remaining" theme={theme} />
            <LegendDot color={COMPLETED_COLOR} label="Completed" theme={theme} />
          </View>
        </View>
      </View>
    </View>
  );
});

function StatPill({
  value,
  label,
  valueColor,
  bg,
  border,
  active,
  onPress,
}: {
  value: number;
  label: string;
  valueColor: string;
  bg: string;
  border: string;
  active?: boolean;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        statsStyles.pill,
        { backgroundColor: bg, borderColor: border },
        active && { borderColor: valueColor, borderWidth: 2 },
      ]}
    >
      <Text
        style={[statsStyles.pillValue, { color: valueColor }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {value}
      </Text>
      <Text style={[statsStyles.pillLabel, { color: valueColor }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function LegendDot({ color, label, theme }: { color: string; label: string; theme: Theme }) {
  return (
    <View style={statsStyles.legendItem}>
      <View style={[statsStyles.legendDot, { backgroundColor: color }]} />
      <Text style={[statsStyles.legendLabel, { color: theme.textSecondary }]}>
        {label}
      </Text>
    </View>
  );
}

// ─── Burndown line chart (no SVG dependency) ────────────────────────────────

function BurndownChart({ theme, data }: { theme: Theme; data: BurndownDay[] }) {
  const [plotWidth, setPlotWidth] = useState(0);

  if (data.length === 0) {
    return (
      <View style={[statsStyles.chartEmpty, { height: CHART_HEIGHT }]}>
        <Text style={[statsStyles.chartEmptyText, { color: theme.textMuted }]}>
          Not enough data yet
        </Text>
      </View>
    );
  }

  const maxValue = Math.max(
    4,
    ...data.map((d) => Math.max(d.remaining, d.completed))
  );
  // Round up to a "nice" number for axis ticks
  const niceMax = niceCeiling(maxValue);
  const ticks = [0, niceMax / 4, niceMax / 2, (niceMax * 3) / 4, niceMax];

  const plotHeight = CHART_HEIGHT - CHART_VERTICAL_PADDING * 2;

  function pointFor(value: number, index: number) {
    const x = data.length === 1
      ? plotWidth / 2
      : (index / (data.length - 1)) * plotWidth;
    const y =
      CHART_VERTICAL_PADDING + (1 - value / niceMax) * plotHeight;
    return { x, y };
  }

  const remainingPoints = data.map((d, i) => pointFor(d.remaining, i));
  const completedPoints = data.map((d, i) => pointFor(d.completed, i));

  return (
    <View>
      <View style={statsStyles.chartRow}>
        {/* Y-axis labels */}
        <View style={[statsStyles.yAxis, { height: CHART_HEIGHT }]}>
          {[...ticks].reverse().map((t) => (
            <Text
              key={t}
              style={[statsStyles.yAxisLabel, { color: theme.textMuted }]}
            >
              {Math.round(t)}
            </Text>
          ))}
        </View>

        {/* Plot area */}
        <View
          onLayout={(e) => setPlotWidth(e.nativeEvent.layout.width)}
          style={[statsStyles.plotArea, { height: CHART_HEIGHT }]}
        >
          {/* Horizontal gridlines */}
          {ticks.map((t, i) => {
            const y =
              CHART_VERTICAL_PADDING +
              (1 - t / niceMax) * plotHeight;
            return (
              <View
                key={`grid_${i}`}
                style={[
                  statsStyles.gridLine,
                  { top: y, backgroundColor: theme.borderLight },
                ]}
              />
            );
          })}

          {/* Lines + dots — only render once we know the plot width */}
          {plotWidth > 0 && (
            <>
              <ChartSeries
                points={remainingPoints}
                color={REMAINING_COLOR}
              />
              <ChartSeries
                points={completedPoints}
                color={COMPLETED_COLOR}
              />
            </>
          )}
        </View>
      </View>

      {/* X-axis labels */}
      <View style={statsStyles.xAxis}>
        <View style={{ width: Y_AXIS_WIDTH }} />
        <View style={statsStyles.xAxisLabels}>
          {data.map((d) => (
            <Text
              key={d.date}
              style={[statsStyles.xAxisLabel, { color: theme.textMuted }]}
            >
              {d.label}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

function ChartSeries({
  points,
  color,
}: {
  points: { x: number; y: number }[];
  color: string;
}) {
  const STROKE = 2;
  const DOT = 6;
  const segments: React.ReactNode[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    // Position the segment so its midpoint sits at the midpoint of (a,b),
    // then rotate around that midpoint. This is robust regardless of
    // transformOrigin support quirks.
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    segments.push(
      <View
        key={`seg_${i}`}
        style={{
          position: "absolute",
          left: midX - length / 2,
          top: midY - STROKE / 2,
          width: length,
          height: STROKE,
          backgroundColor: color,
          transform: [{ rotate: `${angleDeg}deg` }],
        }}
      />
    );
  }
  return (
    <>
      {segments}
      {points.map((p, i) => (
        <View
          key={`dot_${i}`}
          style={{
            position: "absolute",
            left: p.x - DOT / 2,
            top: p.y - DOT / 2,
            width: DOT,
            height: DOT,
            borderRadius: DOT / 2,
            backgroundColor: color,
          }}
        />
      ))}
    </>
  );
}

function niceCeiling(value: number): number {
  if (value <= 4) return 4;
  if (value <= 8) return 8;
  if (value <= 12) return 12;
  if (value <= 16) return 16;
  if (value <= 20) return 20;
  // For larger values, round up to nearest multiple of 8
  return Math.ceil(value / 8) * 8;
}

const statsStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 18,
  },
  cardsRow: {
    flexDirection: "row",
    gap: 8,
  },
  pill: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    gap: 4,
  },
  pillValue: { fontSize: 22, fontWeight: "800" },
  pillLabel: {
    fontSize: 11,
    fontWeight: "700",
  },
  completionBlock: { gap: 8 },
  completionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  completionLabel: { fontSize: 14, fontWeight: "700" },
  completionValue: { fontSize: 14, fontWeight: "700" },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 4,
  },
  chartBlock: { gap: 12 },
  chartHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  chartIcon: { fontSize: 13, fontWeight: "700" },
  chartTitle: { fontSize: 13, fontWeight: "700" },
  chartRange: { fontSize: 13, fontWeight: "500" },
  chartRow: {
    flexDirection: "row",
  },
  yAxis: {
    width: Y_AXIS_WIDTH,
    justifyContent: "space-between",
    paddingVertical: CHART_VERTICAL_PADDING - 6,
  },
  yAxisLabel: {
    fontSize: 10,
    fontWeight: "600",
    textAlign: "right",
    paddingRight: 4,
  },
  plotArea: {
    flex: 1,
    position: "relative",
  },
  gridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    opacity: 0.5,
  },
  xAxis: {
    flexDirection: "row",
    marginTop: 6,
  },
  xAxisLabels: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  xAxisLabel: {
    fontSize: 10,
    fontWeight: "600",
    textAlign: "center",
  },
  legend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 18,
    marginTop: 4,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: { fontSize: 12, fontWeight: "600" },
  chartEmpty: {
    alignItems: "center",
    justifyContent: "center",
  },
  chartEmptyText: { fontSize: 12, fontStyle: "italic" },
});

// ─── Helper components ──────────────────────────────────────────────────────

function DropdownButton({
  theme,
  icon,
  label,
  onPress,
}: {
  theme: Theme;
  icon: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.dropdownBtn,
        { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight },
      ]}
    >
      <Text style={[styles.dropdownIcon, { color: theme.textSecondary }]}>{icon}</Text>
      <Text style={[styles.dropdownLabel, { color: theme.text }]}>{label}</Text>
      <Text style={[styles.dropdownChevron, { color: theme.textMuted }]}>{"\u25BE"}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 28, fontWeight: "800" },
  statsToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  statsToggleIcon: { fontSize: 13 },
  statsToggleLabel: { fontSize: 13, fontWeight: "700" },
  statsToggleChevron: { fontSize: 11, fontWeight: "700" },
  searchRow: { paddingHorizontal: 16, paddingBottom: 8 },
  searchField: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchIcon: { fontSize: 14 },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  controlsRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  completedToggleRow: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  completedToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
  },
  completedCheckbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  completedCheckmark: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 12,
  },
  completedToggleLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  dropdownBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  dropdownIcon: { fontSize: 14, fontWeight: "700" },
  dropdownLabel: { flex: 1, fontSize: 13, fontWeight: "600" },
  dropdownChevron: { fontSize: 12 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 6,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  sectionCount: {
    fontSize: 12,
    fontWeight: "600",
  },
  emptyTitle: { fontSize: 16, fontWeight: "600" },
  emptyBody: { fontSize: 13, textAlign: "center" },
  emptyAction: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 8,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 32,
  },
  pickerSheet: {
    margin: 24,
    marginBottom: 80,
    marginTop: "auto",
    padding: 16,
    borderRadius: 16,
    gap: 4,
  },
  pickerTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  pickerOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
  },
});

