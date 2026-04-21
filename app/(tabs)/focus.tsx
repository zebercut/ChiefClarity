import React, { useState, useContext, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { trackFeaturesUsage } from "../../src/modules/tips";
import { ConfigContext } from "../_layout";
import { loadState } from "../../src/modules/loader";
import { mergeWeekCalendar } from "../../src/modules/agendaMerger";
import { renderBriefToHtml } from "../../src/modules/briefRenderer";
import { fileExists } from "../../src/utils/filesystem";
import { formatLocalTime, getTodayFromTz, nowLocalIso, getDefaultTimezone } from "../../src/utils/dates";
import { executeDirectAction } from "../../src/modules/smartActions";
import { patchBrief } from "../../src/modules/briefPatcher";
import { flush } from "../../src/modules/executor";
import type { FocusBrief, AppState, CalendarSlot, AgendaEvent, Task } from "../../src/types";

// Section components
import SnapshotCard from "../../src/components/focus/SnapshotCard";
import MindsetCards from "../../src/components/focus/MindsetCards";
import FocusLayers from "../../src/components/focus/FocusLayers";
import TaskList from "../../src/components/focus/TaskList";
import AgendaTimeline from "../../src/components/focus/AgendaTimeline";
import WeekPreview from "../../src/components/focus/WeekPreview";
import CompanionCard from "../../src/components/focus/CompanionCard";
import RisksCard from "../../src/components/focus/RisksCard";
import OkrCard from "../../src/components/focus/OkrCard";
import TaskDetailSlideOver from "../../src/components/TaskDetailSlideOver";

const VARIANT_LABELS: Record<string, string> = { day: "Today", tomorrow: "Tomorrow", week: "This Week" };

export default function FocusScreen() {
  const { theme } = useContext(ConfigContext);
  const router = useRouter();
  const [brief, setBrief] = useState<FocusBrief | null>(null);
  const [appState, setAppState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const loadBrief = useCallback(async () => {
    setLoading(true);
    try {
      const state = await loadState();
      if (state.focusBrief?.id) {
        setBrief(state.focusBrief);
        setAppState(state);
        const htmlExists = await fileExists("focus_brief.html");
        if (!htmlExists) {
          try { await renderBriefToHtml(state.focusBrief, state.userProfile?.timezone); } catch {}
        }
      } else {
        setBrief(null);
        setAppState(state);
      }
    } catch (err: any) {
      console.error("[focus] loadState failed:", err?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    loadBrief();
    trackFeaturesUsage(["focus_viewed"]).catch(() => {});
  }, [loadBrief]));

  // Task action handler — executes action, patches brief, re-renders
  async function handleTaskAction(actionType: string, taskId: string): Promise<{ success: boolean; message: string }> {
    if (!appState) return { success: false, message: "No state" };
    const result = await executeDirectAction(actionType, taskId, appState);
    if (result.success) {
      // Build correct WriteOperation based on action type
      const todayStr = appState.hotContext?.today || getTodayFromTz(appState.userProfile?.timezone);
      const tomorrow = addDaysStr(todayStr, 1);
      const nextMonday = addDaysStr(todayStr, 7 - new Date(todayStr + "T00:00:00Z").getUTCDay() + 1);

      let writeAction: "update" | "delete" = "update";
      let writeData: Record<string, unknown> = {};

      switch (actionType) {
        case "mark_done":
          writeData = { status: "done" };
          break;
        case "reschedule_tomorrow":
          writeData = { due: tomorrow };
          break;
        case "reschedule_next_week":
          writeData = { due: nextMonday };
          break;
        case "delete":
          writeData = { status: "done", dismissedAt: nowLocalIso() };
          break;
        case "cancel":
          writeData = { status: "done", dismissedAt: nowLocalIso() };
          break;
      }

      patchBrief(appState, [{ file: "tasks" as any, action: writeAction, id: taskId, data: writeData }]);
      try {
        await flush(appState);
        await renderBriefToHtml(appState.focusBrief, appState.userProfile?.timezone);
      } catch {}
      setBrief({ ...appState.focusBrief });
    }
    return result;
  }

  function addDaysStr(dateStr: string, days: number): string {
    const d = new Date(dateStr + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // ─── Task detail handlers ────────────────────────────────────────────
  const selectedTask = selectedTaskId
    ? appState?.tasks?.tasks?.find((t) => t.id === selectedTaskId) || null
    : null;

  function handleToggleDone(task: Task) {
    const wasDone = task.status === "done";
    const patch: Partial<Task> = {
      status: wasDone ? "pending" : "done",
      completedAt: wasDone ? null : nowLocalIso(),
    };
    handleTaskUpdate(task.id, patch);
  }

  async function handleTaskUpdate(taskId: string, patch: Partial<Task>) {
    if (!appState) return;
    const updated: AppState = {
      ...appState,
      tasks: {
        ...appState.tasks,
        tasks: appState.tasks.tasks.map((t) =>
          t.id === taskId ? { ...t, ...patch } : t
        ),
      },
      _dirty: new Set(appState._dirty),
      _loadedCounts: appState._loadedCounts,
    };
    updated._dirty.add("tasks");
    setAppState(updated);
    try {
      await flush(updated);
      setBrief({ ...updated.focusBrief });
    } catch {}
  }

  // ─── Loading ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[f.center, { backgroundColor: theme.bg }]}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  // ─── Empty state ──────────────────────────────────────────────────
  if (!brief) {
    return (
      <View style={[f.center, { backgroundColor: theme.bg }]}>
        <View style={[f.emptyAvatar, { backgroundColor: theme.accent }]}>
          <Text style={f.emptyAvatarText}>CC</Text>
        </View>
        <Text style={[f.emptyTitle, { color: theme.text }]}>No Focus Brief yet</Text>
        <Text style={[f.emptySubtitle, { color: theme.textMuted }]}>
          Ask me to plan your day, week, or tomorrow
        </Text>
        <View style={f.emptyActions}>
          {["Plan my day", "Plan my week", "Prepare tomorrow"].map((label) => (
            <TouchableOpacity
              key={label}
              style={[f.emptyBtn, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}
              onPress={() => router.push({ pathname: "/(tabs)/chat", params: { autoSend: label } })}
            >
              <Text style={[f.emptyBtnText, { color: theme.textSecondary }]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  // ─── Brief exists ─────────────────────────────────────────────────
  const today = appState?.hotContext?.today || getTodayFromTz(appState?.userProfile?.timezone);
  const mergedCalendar = mergeWeekCalendar(brief, today);
  const todaySlot = mergedCalendar.find((s) => s.date === today);
  const todayEvents: AgendaEvent[] = todaySlot?.events || [];
  const todayFreeBlocks = brief.days?.find((d) => d.date === today)?.freeBlocks;
  const userName = appState?.userProfile?.name || "";

  // Tasks: due today + overdue + completed today
  const todayTasks = (appState?.tasks?.tasks || []).filter((t) =>
    (t.status !== "done" && t.status !== "deferred" && t.status !== "parked" && t.due && t.due <= today) ||
    (t.status === "done" && t.completedAt?.startsWith(today)) ||
    (t.status === "deferred" && t.dismissedAt?.startsWith(today))
  );

  return (
    <View style={[f.container, { backgroundColor: theme.bg }]}>
      {/* Header */}
      <View style={[f.header, { borderBottomColor: theme.border }]}>
        <View style={f.headerRow}>
          <View>
            <Text style={[f.headerTitle, { color: theme.text }]}>Daily Brief</Text>
            <Text style={[f.headerMeta, { color: theme.textMuted }]}>
              {new Date(today + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: getDefaultTimezone() || "UTC" })}
            </Text>
          </View>
          <TouchableOpacity
            style={[f.refreshBtn, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}
            onPress={() => router.push({ pathname: "/(tabs)/chat", params: { autoSend: `Plan my ${brief.variant}` } })}
          >
            <Text style={f.refreshIcon}>{"\uD83D\uDD04"}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={f.scroll} contentContainerStyle={f.scrollContent}>
        {/* Section 1: Today's Snapshot */}
        <SnapshotCard brief={brief} userName={userName} today={today} theme={theme} />

        {/* Section 2: Mindset */}
        <MindsetCards cards={brief.companion?.mindsetCards || []} theme={theme} />

        {/* Section 3: Focus Layers */}
        <FocusLayers brief={brief} theme={theme} />

        {/* Section 4: Today's Tasks (interactive) */}
        <TaskList
          tasks={todayTasks}
          today={today}
          theme={theme}
          onAction={handleTaskAction}
          onTaskPress={(task) => setSelectedTaskId(task.id)}
        />

        {/* Section 5: Today's Agenda */}
        <AgendaTimeline
          events={todayEvents}
          freeBlocks={todayFreeBlocks}
          today={today}
          theme={theme}
        />

        {/* Section 6: Next 7 Days (collapsible) */}
        <WeekPreview
          events={appState?.calendar?.events || []}
          recurringTasks={appState?.recurringTasks?.recurring || []}
          today={today}
          theme={theme}
        />

        {/* Section 7: Companion */}
        {brief.companion && (
          <CompanionCard companion={brief.companion} theme={theme} />
        )}

        {/* Section 8: Risks & Blockers */}
        <RisksCard risks={brief.risks || []} theme={theme} />

        {/* Section 9: OKR Progress */}
        <OkrCard okrSnapshot={brief.okrSnapshot || []} theme={theme} />

        {/* Footer */}
        <Text style={[f.footer, { color: theme.textMuted }]}>
          Generated {brief.generatedAt ? formatLocalTime(brief.generatedAt) : ""}
        </Text>
      </ScrollView>

      {/* Task detail slide-over */}
      {selectedTask && (
        <TaskDetailSlideOver
          task={selectedTask}
          theme={theme}
          today={today}
          onClose={() => setSelectedTaskId(null)}
          onToggleDone={handleToggleDone}
          onUpdate={(patch) => handleTaskUpdate(selectedTask.id, patch)}
          onAction={handleTaskAction}
        />
      )}
    </View>
  );
}

const f = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  header: { borderBottomWidth: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerTitle: { fontSize: 22, fontWeight: "700" },
  headerMeta: { fontSize: 12, marginTop: 2 },
  refreshBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  refreshIcon: { fontSize: 16 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  footer: { textAlign: "center", fontSize: 11, marginTop: 16, fontStyle: "italic" },
  emptyAvatar: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  emptyAvatarText: { color: "#fff", fontSize: 24, fontWeight: "700" },
  emptyTitle: { fontSize: 18, fontWeight: "600", marginBottom: 8 },
  emptySubtitle: { fontSize: 14, marginBottom: 24, textAlign: "center" },
  emptyActions: { flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "center" },
  emptyBtn: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  emptyBtnText: { fontSize: 13, fontWeight: "500" },
});
