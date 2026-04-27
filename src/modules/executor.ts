import { writeJsonFile } from "../utils/filesystem";
import { isWeb } from "../utils/platform";
import { FILE_MAP, collectionCountOf, isLibsqlMode, getFlushToDbFn } from "./loader";
import { checkConflicts } from "./conflict";
import { findDuplicateEvent } from "./calendarHygiene";
import type { AppState, ActionPlan, FileKey, OkrObjective, OkrKeyResult, TopicSignal } from "../types";
import { computeKrOutcome, computeKrActivity, buildTaskStats } from "../types";
import { getUserToday, nowLocalIso, WEEKDAY_MAP } from "../utils/dates";
import { slugifyTopic, appendToTopicFile, migrateFactsToTopic, updateSuggestions, recordSignal, updateTopicPagesFromBrief } from "./topicManager";

/** Maximum items per array in any data file — prevents LLM from bloating state */
const MAX_ARRAY_ITEMS = 1000;

// ── FEAT047: Semantic dedup at entry time ─────────────────────────────────
// Injected by proxy/headless at startup (same pattern as injectRetriever).
// Returns similar items from the vector store. null = not available (web, no DB).
type SemanticDedupFn = (title: string, sourceType: string, limit: number, maxDistance: number) => Promise<Array<{ sourceId: string; distance: number; data: Record<string, unknown> }> | null>;
let _semanticDedupFn: SemanticDedupFn | null = null;

export function injectSemanticDedup(fn: SemanticDedupFn): void {
  _semanticDedupFn = fn;
}

const DEDUP_BLOCK_THRESHOLD = 0.10;  // cosine distance — near-identical (conservative to avoid false positives)
const DEDUP_FLAG_THRESHOLD = 0.20;   // cosine distance — very similar

/** Generate a 12-char random ID with a prefix — ~62 bits of entropy */
function genId(prefix: string): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}_${id}`;
}

export async function applyWrites(
  plan: ActionPlan,
  state: AppState
): Promise<void> {
  // Pre-write validation: check new task/event times against lifestyle + rules
  validateAndAdjustWrites(plan, state);

  const conflicts = checkConflicts(
    plan.conflictsToCheck,
    plan.writes,
    state
  );
  if (conflicts.length > 0) {
    const shown = conflicts.slice(0, 3);
    const more = conflicts.length > 3 ? `\n  ...and ${conflicts.length - 3} more` : "";
    plan.reply += "\n\n\u26a0 **Conflicts:**\n" + shown.map((c) => `  \u2022 ${c}`).join("\n") + more;
  }

  console.log("[executor] writes:", plan.writes.map(w => `${w.file}:${w.action}`).join(", "));

  // Track applied writes for topic signal recording
  const appliedWrites: { fileKey: FileKey; id: string }[] = [];

  for (const write of plan.writes) {
    const fileKey = write.file as FileKey;
    if (!(fileKey in state) || fileKey.startsWith("_")) {
      console.warn("[executor] unknown file key:", fileKey);
      continue;
    }

    // Pre-generate ID for adds so we can track it for topic signals.
    // applyAdd clones write.data internally, but reads data.id if present.
    if (write.action === "add" && !write.data.id
        && (fileKey === "tasks" || fileKey === "calendar")) {
      write.data.id = genId(fileKey.slice(0, 4));
    }

    if (write.action === "add") await applyAdd(fileKey, write.data, state);
    else if (write.action === "update" && write.id)
      applyUpdate(fileKey, write.id, write.data, state);
    else if (write.action === "delete" && write.id)
      applyDelete(fileKey, write.id, state);

    const writeId = write.id || (write.data.id as string) || "";

    state._dirty.add(fileKey);

    if (writeId && (fileKey === "tasks" || fileKey === "calendar" || fileKey === "contextMemory")) {
      appliedWrites.push({ fileKey, id: writeId });
    }
  }

  for (const signal of plan.memorySignals) {
    logSignal(signal, state);
  }

  // Record topic signals from LLM output
  if (plan.topicSignals && plan.topicSignals.length > 0) {
    const today = getUserToday(state);
    for (const rawHint of plan.topicSignals) {
      const hint = slugifyTopic(rawHint);
      if (!hint) continue;

      if (appliedWrites.length > 0) {
        // Record a signal for each applied write
        for (const aw of appliedWrites) {
          const sourceType = aw.fileKey === "tasks" ? "task"
            : aw.fileKey === "calendar" ? "event"
            : "fact";
          recordSignal(state.topicManifest, hint, sourceType, aw.id, today);
        }
      } else {
        // Zero writes — record as a mention (user talked about the topic)
        const mentionId = `mention_${today}_${hint}`;
        recordSignal(state.topicManifest, hint, "mention", mentionId, today);
      }
    }
    state._dirty.add("topicManifest");
  }

  // Update topic suggestions based on signal counts
  if (updateSuggestions(state.topicManifest)) {
    state._dirty.add("topicManifest");
  }

  // Update topic markdown pages from focus brief topic digest
  if (state.focusBrief?.topicDigest && state.focusBrief.topicDigest.length > 0) {
    try {
      await updateTopicPagesFromBrief(state.focusBrief, state);
    } catch (err: any) {
      console.warn("[executor] topic page update failed:", err?.message);
    }
  }

  await flush(state);
}

async function applyAdd(
  fileKey: FileKey,
  data: Record<string, unknown>,
  state: AppState
): Promise<void> {
  // Clone to avoid mutating the original LLM output
  const d = { ...data };

  // focusBrief is a whole-file replace — normalize + inject real timestamp
  // recurringTasks: add to the recurring array
  if (fileKey === "recurringTasks") {
    if (!d.id) d.id = genId("rec");
    if (!d.createdAt) d.createdAt = nowLocalIso();
    if (d.active === undefined) d.active = true;
    const target = (state as any)[fileKey];
    if (!Array.isArray(target.recurring)) target.recurring = [];
    if (target.recurring.length >= MAX_ARRAY_ITEMS) {
      console.warn("[executor] recurring tasks array cap reached, skipping add");
      return;
    }
    target.recurring.push(d);
    return;
  }

  if (fileKey === "focusBrief") {
    // Use user timezone for generatedAt — prevents UTC date mismatch near midnight
    const tz = state.userProfile?.timezone || undefined;
    const now = new Date();
    const localDate = now.toLocaleDateString("en-CA", { timeZone: tz });
    const localTime = now.toLocaleTimeString("en-GB", { timeZone: tz, hour12: false });
    d.generatedAt = `${localDate}T${localTime}`;

    // Normalize routineTemplate events
    if (Array.isArray(d.routineTemplate)) {
      d.routineTemplate = d.routineTemplate.map(normalizeEvent);
    }
    if (Array.isArray(d.weekendRoutineTemplate)) {
      d.weekendRoutineTemplate = d.weekendRoutineTemplate.map(normalizeEvent);
    }

    // Normalize day additions
    if (Array.isArray(d.days)) {
      for (const day of d.days as any[]) {
        if (Array.isArray(day.additions)) {
          day.additions = day.additions.map(normalizeEvent);
        }
        if (!Array.isArray(day.removals)) day.removals = [];
        if (!Array.isArray(day.overrides)) day.overrides = [];
        if (!Array.isArray(day.freeBlocks)) day.freeBlocks = [];
        if (day.isWeekend === undefined) day.isWeekend = false;
      }
    }

    // Backward compat: if LLM sent old "calendar" format, convert it
    if (Array.isArray(d.calendar) && !Array.isArray(d.days)) {
      console.warn("[executor] focusBrief uses legacy calendar format — converting");
      d.routineTemplate = d.routineTemplate || [];
      d.days = (d.calendar as any[]).map((slot: any) => ({
        date: slot.date,
        dayLabel: slot.dayLabel,
        isWeekend: false,
        additions: Array.isArray(slot.events) ? slot.events.map(normalizeEvent) : [],
        removals: [],
        overrides: [],
        freeBlocks: slot.freeBlocks || [],
      }));
    }

    // Post-process: inject missing calendar events into days
    injectMissingCalendarEvents(d, state);

    // Deduplicate additions within each day (same title + same time)
    deduplicateDayAdditions(d);

    // Replace IDs with titles in all user-visible brief text
    humanizeBriefText(d, state);

    // Inject computed OKR progress into okrSnapshot (LLM emits placeholders)
    injectOkrProgress(d, state);

    const dayCount = Array.isArray(d.days) ? d.days.length : 0;
    const routineCount = Array.isArray(d.routineTemplate) ? d.routineTemplate.length : 0;
    console.log(`[executor] writing focusBrief, variant: ${d.variant}, days: ${dayCount}, routine items: ${routineCount}`);

    const existing = (state as any)[fileKey];

    if (d.variant === "week") {
      // Week plan: full replace + save a snapshot of the week data
      d._weekSnapshot = {
        days: d.days ? JSON.parse(JSON.stringify(d.days)) : [],
        routineTemplate: d.routineTemplate ? JSON.parse(JSON.stringify(d.routineTemplate)) : [],
        weekendRoutineTemplate: d.weekendRoutineTemplate ? JSON.parse(JSON.stringify(d.weekendRoutineTemplate)) : [],
        dateRange: d.dateRange ? { ...d.dateRange } : { start: "", end: "" },
      };
      (state as any)[fileKey] = d;
      console.log(`[executor] week plan saved (${d.days?.length || 0} days)`);
      return;
    }

    // Day/tomorrow plan: merge into existing — preserve week calendar
    if (d.variant === "day" || d.variant === "tomorrow") {
      // Recover week data from snapshot or existing brief
      const weekDays = existing?._weekSnapshot?.days || (existing?.days?.length > 1 ? existing.days : null);
      const weekRoutine = existing?._weekSnapshot?.routineTemplate || existing?.routineTemplate;
      const weekendRoutine = existing?._weekSnapshot?.weekendRoutineTemplate || existing?.weekendRoutineTemplate;
      const weekDateRange = existing?._weekSnapshot?.dateRange || existing?.dateRange;

      if (weekDays && weekDays.length > 1) {
        // Merge: update the specific day(s), keep the rest of the week
        const mergedDays = JSON.parse(JSON.stringify(weekDays));
        const newDays = Array.isArray(d.days) ? d.days : [];
        for (const newDay of newDays) {
          const idx = mergedDays.findIndex((ed: any) => ed.date === newDay.date);
          if (idx >= 0) {
            mergedDays[idx] = newDay;
          } else {
            mergedDays.push(newDay);
          }
        }

        const merged: any = {
          ...d,
          days: mergedDays,
          routineTemplate: (Array.isArray(d.routineTemplate) && d.routineTemplate.length > 0) ? d.routineTemplate : weekRoutine || [],
          weekendRoutineTemplate: weekendRoutine || d.weekendRoutineTemplate || [],
          dateRange: weekDateRange || d.dateRange,
          _weekSnapshot: existing?._weekSnapshot || {
            days: weekDays,
            routineTemplate: weekRoutine || [],
            weekendRoutineTemplate: weekendRoutine || [],
            dateRange: weekDateRange || { start: "", end: "" },
          },
        };

        (state as any)[fileKey] = merged;
        console.log(`[executor] merged ${d.variant} plan into week brief (${mergedDays.length} days preserved)`);
        return;
      }

      // No week data to preserve — full replace
      (state as any)[fileKey] = d;
      console.log(`[executor] ${d.variant} plan saved (no week data to preserve)`);
      return;
    }

    // Unknown variant: full replace
    (state as any)[fileKey] = d;
    return;
  }

  // planOkrDashboard: add objective, KR, or decision — handles its own ids
  if (fileKey === "planOkrDashboard") {
    applyOkrAdd(d, state);
    return;
  }

  // userObservations: append to the named array specified in d._arrayKey
  if (fileKey === "userObservations" && typeof d._arrayKey === "string") {
    const target = (state as any)[fileKey];
    const arrKey = d._arrayKey as string;
    delete d._arrayKey;
    delete d.id;
    delete d.createdAt;
    if (Array.isArray(target?.[arrKey])) {
      if (target[arrKey].length >= MAX_ARRAY_ITEMS) {
        console.warn(`[executor] userObservations.${arrKey} array cap reached, skipping add`);
        return;
      }
      target[arrKey].push(d);
      return;
    }
    // goalsContext is an object, not an array — merge directly
    if (target?.[arrKey] && typeof target[arrKey] === "object") {
      Object.assign(target[arrKey], d);
      return;
    }
    console.warn("[executor] userObservations: unknown _arrayKey:", arrKey);
    return;
  }

  // userLifestyle: merge sections
  if (fileKey === "userLifestyle") {
    let target = (state as any)[fileKey];
    if (!target) { (state as any)[fileKey] = target = {}; }
    delete d.id;
    delete d.createdAt;
    Object.assign(target, d);
    return;
  }

  // topicManifest: create topic, append note, handle suggestions
  if (fileKey === "topicManifest") {
    const manifest = state.topicManifest;
    const action = d._action as string;
    if (!action) {
      console.warn("[executor] topicManifest write missing _action field");
      return;
    }

    if (action === "create_topic") {
      const name = d.name as string;
      const id = slugifyTopic(name);
      if (!manifest.topics.some(t => t.id === id)) {
        manifest.topics.push({
          id,
          name,
          aliases: (d.aliases as string[]) || [],
          createdAt: nowLocalIso(),
        });
        manifest.pendingSuggestions = manifest.pendingSuggestions.filter(s => s.topic !== id);
      }
      if (d.note) {
        await appendToTopicFile(id, name, d.note as string, getUserToday(state));
      }
      return;
    }

    if (action === "append_note") {
      const topicId = d.topicId as string;
      const topic = manifest.topics.find(t => t.id === topicId);
      if (topic && d.note) {
        await appendToTopicFile(topicId, topic.name, d.note as string, getUserToday(state));
      }
      return;
    }

    if (action === "accept_suggestion") {
      const topicHint = d.topic as string;
      const name = (d.name as string) || topicHint;
      const id = slugifyTopic(name);
      if (manifest.topics.some(t => t.id === id)) return;
      manifest.topics.push({
        id,
        name,
        aliases: (d.aliases as string[]) || [],
        createdAt: nowLocalIso(),
      });
      manifest.pendingSuggestions = manifest.pendingSuggestions.filter(s => s.topic !== topicHint);
      state.contextMemory.facts = await migrateFactsToTopic(id, name, state.contextMemory.facts);
      state._dirty.add("contextMemory");
      // Intentional shrinkage: migrated facts now live in topics/{id}.md, not in
      // contextMemory. Rebase the loaded-count so the flush shrinkage guard (which
      // protects against corrupted-reload overwrites) doesn't block this legitimate
      // migration. Without this, accepting a suggestion with >50% of facts tagged
      // to that topic fails with ShrinkageGuardError.
      state._loadedCounts.contextMemory = state.contextMemory.facts.length;
      return;
    }

    if (action === "reject_suggestion") {
      const topicHint = d.topic as string;
      manifest.rejectedTopics.push(topicHint);
      manifest.pendingSuggestions = manifest.pendingSuggestions.filter(s => s.topic !== topicHint);
      return;
    }

    if (action === "defer_suggestion") {
      const topicHint = d.topic as string;
      const suggestion = manifest.pendingSuggestions.find(s => s.topic === topicHint);
      if (suggestion) {
        suggestion.threshold += 3;
        suggestion.status = "deferred";
      }
      return;
    }

    // Explicit exclusion: user said "this task/event doesn't belong to this topic".
    // Removes any matching signals and records the ID in excludedIds so name-matching
    // doesn't keep pulling it back in.
    if (action === "unassign_from_topic") {
      const topicId = d.topicId as string;
      const sourceId = d.sourceId as string;
      const topic = manifest.topics.find(t => t.id === topicId);
      if (!topic || !sourceId) return;
      if (!topic.excludedIds) topic.excludedIds = [];
      if (!topic.excludedIds.includes(sourceId)) topic.excludedIds.push(sourceId);
      manifest.signals = manifest.signals.filter(
        s => !(s.topic === topicId && s.sourceId === sourceId)
      );
      return;
    }

    // Explicit inclusion: user added a task/event to a topic it didn't auto-match.
    // Records a "mention" signal so the cross-reference picks it up.
    if (action === "assign_to_topic") {
      const topicId = d.topicId as string;
      const sourceId = d.sourceId as string;
      const sourceType = (d.sourceType as TopicSignal["sourceType"]) || "task";
      const topic = manifest.topics.find(t => t.id === topicId);
      if (!topic || !sourceId) return;
      // Remove from exclusions if previously excluded
      if (topic.excludedIds) {
        topic.excludedIds = topic.excludedIds.filter(id => id !== sourceId);
      }
      recordSignal(manifest, topicId, sourceType, sourceId, getUserToday(state));
      return;
    }

    // Move a task/event from one topic to another in a single operation.
    if (action === "reassign_topic") {
      const fromTopicId = d.fromTopicId as string;
      const toTopicId = d.toTopicId as string;
      const sourceId = d.sourceId as string;
      const sourceType = (d.sourceType as TopicSignal["sourceType"]) || "task";
      if (!sourceId || !fromTopicId || !toTopicId || fromTopicId === toTopicId) return;
      const fromTopic = manifest.topics.find(t => t.id === fromTopicId);
      const toTopic = manifest.topics.find(t => t.id === toTopicId);
      if (!fromTopic || !toTopic) return;
      // Exclude from source topic, signal to destination topic
      if (!fromTopic.excludedIds) fromTopic.excludedIds = [];
      if (!fromTopic.excludedIds.includes(sourceId)) fromTopic.excludedIds.push(sourceId);
      manifest.signals = manifest.signals.filter(
        s => !(s.topic === fromTopicId && s.sourceId === sourceId)
      );
      if (toTopic.excludedIds) {
        toTopic.excludedIds = toTopic.excludedIds.filter(id => id !== sourceId);
      }
      recordSignal(manifest, toTopicId, sourceType, sourceId, getUserToday(state));
      return;
    }

    if (action === "archive_topic") {
      const topicId = d.topicId as string;
      const topic = manifest.topics.find(t => t.id === topicId);
      if (topic) topic.archivedAt = nowLocalIso();
      return;
    }

    if (action === "unarchive_topic") {
      const topicId = d.topicId as string;
      const topic = manifest.topics.find(t => t.id === topicId);
      if (topic) topic.archivedAt = null;
      return;
    }

    return;
  }

  // contextMemory: handle structured facts with topic hints
  if (fileKey === "contextMemory") {
    const mem = state.contextMemory;
    if (d.facts && Array.isArray(d.facts)) {
      if (mem.facts.length >= MAX_ARRAY_ITEMS) {
        console.warn("[executor] contextMemory.facts cap reached, skipping add");
        return;
      }
      for (const fact of d.facts) {
        const today = getUserToday(state);
        if (typeof fact === "string") {
          mem.facts.push({ text: fact, topic: null, date: today });
        } else {
          const topic = (fact as any).topic || null;
          const text = (fact as any).text;
          const date = (fact as any).date || today;
          mem.facts.push({ text, topic, date });
        }
      }
    }
    if (d.patterns && Array.isArray(d.patterns)) {
      for (const p of d.patterns) mem.patterns.push(p as any);
    }
    if (d.recentEvents && Array.isArray(d.recentEvents)) {
      for (const e of d.recentEvents) mem.recentEvents.push(e as string);
    }
    return;
  }

  // userProfile: merge fields, no id/createdAt injection
  if (fileKey === "userProfile") {
    let target = (state as any)[fileKey];
    if (!target) { (state as any)[fileKey] = target = {}; }
    delete d.id;
    delete d.createdAt;
    Object.assign(target, d);
    return;
  }

  // Default: inject id/createdAt for array-based files (tasks, events, etc.)
  if (!d.id)
    d.id = genId(fileKey.slice(0, 4));
  if (!d.createdAt) d.createdAt = nowLocalIso();

  // Safety net: calendar event with recurring metadata → convert to RecurringTask
  if (fileKey === "calendar" && d.recurring) {
    const recDay = WEEKDAY_MAP[(String(d.recurrenceDay || "")).toLowerCase()];
    const recurrence = String(d.recurrence || "weekly").toLowerCase();
    const schedType: "daily" | "weekly" | "weekdays" = recurrence === "daily" ? "daily" : recurrence === "weekdays" ? "weekdays" : "weekly";
    const days = recDay ? [recDay] : [];
    const timeMatch = String(d.datetime || "").match(/T(\d{2}:\d{2})/);
    const time = timeMatch ? timeMatch[1] : undefined;

    const recTask = {
      id: genId("rec_"),
      title: d.title as string,
      schedule: { type: schedType, days, time },
      category: (d.type as string) || (d.category as string) || "",
      priority: ((d.priority as string) || "medium") as "high" | "medium" | "low",
      okrLink: null,
      duration: d.durationMinutes as number || 30,
      notes: d.notes as string || "",
      active: true,
      createdAt: nowLocalIso(),
    };
    state.recurringTasks.recurring.push(recTask);
    state._dirty.add("recurringTasks");
    console.log(`[executor] converted recurring calendar event "${d.title}" to RecurringTask ${recTask.id} (${schedType} ${days.join(",")} ${time || "no time"})`);
    return;
  }

  // Tasks: ensure new fields have defaults
  if (fileKey === "tasks") {
    if (d.dismissedAt === undefined) d.dismissedAt = null;
    if (!Array.isArray(d.comments)) d.comments = [];
  }

  // FEAT047 Tier 0: Semantic dedup — check vector similarity before adding.
  // Skip for recurring task instances — they're created by the recurring processor
  // which already deduplicates by ID+date. Blocking them would prevent legitimate
  // daily/weekly task creation.
  const isRecurringInstance = fileKey === "tasks" && d.notes && String(d.notes).includes("[Recurring]");
  if (_semanticDedupFn && d.title && (fileKey === "tasks" || fileKey === "calendar") && !isRecurringInstance) {
    const sourceType = fileKey === "tasks" ? "task" : "event";
    try {
      const similar = await _semanticDedupFn(d.title as string, sourceType, 3, DEDUP_FLAG_THRESHOLD);
      if (similar && similar.length > 0) {
        const best = similar[0];
        const existingTitle = (best.data.title as string) || best.sourceId;
        if (best.distance < DEDUP_BLOCK_THRESHOLD) {
          // Near-identical — block the add
          console.log(`[executor] DEDUP BLOCKED: "${d.title}" too similar to "${existingTitle}" (distance: ${best.distance.toFixed(3)})`);
          return;
        }
        if (best.distance < DEDUP_FLAG_THRESHOLD) {
          // Similar — add but flag as possible duplicate
          console.log(`[executor] DEDUP FLAGGED: "${d.title}" similar to "${existingTitle}" (distance: ${best.distance.toFixed(3)})`);
          if (fileKey === "tasks") {
            d.conflictStatus = "flagged";
            d.conflictReason = `Possible duplicate of "${existingTitle}"`;
          }
        }
      }
    } catch (err: any) {
      // Non-fatal — if embeddings fail, proceed without dedup
      console.warn("[executor] semantic dedup check failed:", err?.message);
    }
  }

  // Calendar dedup: skip if a matching event already exists (exact string match fallback)
  if (fileKey === "calendar" && d.title && d.datetime) {
    const dup = findDuplicateEvent(state.calendar.events, d.title as string, d.datetime as string);
    if (dup) {
      console.log(`[executor] skipping duplicate calendar event: "${d.title}" (matches ${dup.id})`);
      return;
    }
  }

  const target = (state as any)[fileKey];
  for (const listKey of ["tasks", "events", "items", "suggestions", "notes"] as const) {
    if (Array.isArray(target?.[listKey])) {
      if (target[listKey].length >= MAX_ARRAY_ITEMS) {
        console.warn(`[executor] array cap reached for ${fileKey}.${listKey} (${MAX_ARRAY_ITEMS}), skipping add`);
        return;
      }
      target[listKey].push(d);
      return;
    }
  }
  Object.assign(target, d);
}

function applyUpdate(
  fileKey: FileKey,
  id: string,
  data: Record<string, unknown>,
  state: AppState
): void {
  const d = { ...data };
  const target = (state as any)[fileKey];

  // recurringTasks: update by id in the recurring array
  if (fileKey === "recurringTasks") {
    const list = target?.recurring as Array<{ id: string }> | undefined;
    const record = list?.find((r) => r.id === id);
    if (record) Object.assign(record, d);
    return;
  }

  // planOkrDashboard: update objective or KR by id
  if (fileKey === "planOkrDashboard") {
    applyOkrUpdate(id, d, state);
    return;
  }

  // userLifestyle: merge fields (id is ignored, used as label only)
  if (fileKey === "userLifestyle") {
    delete d.id;
    // Deep merge for preferences so individual prefs aren't wiped
    if (d.preferences && typeof d.preferences === "object" && target.preferences) {
      Object.assign(target.preferences, d.preferences);
      delete d.preferences;
    }
    Object.assign(target, d);
    return;
  }

  // userProfile: merge fields
  if (fileKey === "userProfile") {
    delete d.id;
    Object.assign(target, d);
    return;
  }

  // userObservations: update by matching observation text in a named array
  if (fileKey === "userObservations" && typeof d._arrayKey === "string") {
    const arrKey = d._arrayKey as string;
    delete d._arrayKey;
    // goalsContext is an object — merge directly
    if (arrKey === "goalsContext" && target?.goalsContext) {
      Object.assign(target.goalsContext, d);
      return;
    }
    const list = target?.[arrKey] as Array<Record<string, unknown>> | undefined;
    const record = list?.find((r) => r.observation === id || r.category === id);
    if (record) {
      Object.assign(record, d);
      return;
    }
    console.warn("[executor] userObservations: no match for id:", id, "in", arrKey);
    return;
  }

  for (const listKey of ["tasks", "events", "items", "suggestions"] as const) {
    const list = target?.[listKey];
    if (!Array.isArray(list)) continue;
    const record = list.find((r: any) => r.id === id);
    if (record) {
      Object.assign(record, d);
      return;
    }
  }

  console.warn("[executor] applyUpdate: no record found for id:", id, "in", fileKey);
}

function applyDelete(
  fileKey: FileKey,
  id: string,
  state: AppState
): void {
  // recurringTasks: delete by id
  if (fileKey === "recurringTasks") {
    const target = (state as any)[fileKey];
    if (Array.isArray(target?.recurring)) {
      target.recurring = target.recurring.filter((r: any) => r.id !== id);
    }
    return;
  }

  // planOkrDashboard: delete objective or KR by id
  if (fileKey === "planOkrDashboard") {
    applyOkrDelete(id, state);
    return;
  }

  const target = (state as any)[fileKey];
  for (const listKey of ["tasks", "events", "items", "suggestions"] as const) {
    if (Array.isArray(target?.[listKey])) {
      target[listKey] = target[listKey].filter(
        (r: { id: string }) => r.id !== id
      );
      return;
    }
  }
}

// ─── OKR helpers ───────────────────────────────────────────────────────────

function findKrAcrossObjectives(
  objectives: OkrObjective[],
  krId: string
): { objective: OkrObjective; kr: OkrKeyResult } | null {
  for (const obj of objectives) {
    const kr = obj.keyResults.find((k) => k.id === krId);
    if (kr) return { objective: obj, kr };
  }
  return null;
}

function applyOkrAdd(
  data: Record<string, unknown>,
  state: AppState
): void {
  const dashboard = state.planOkrDashboard;
  const id = data.id as string;

  // Adding a KR to an existing objective
  if (data._targetObjective) {
    const objId = data._targetObjective as string;
    delete data._targetObjective;
    delete data.createdAt;
    if (!("targetType" in data)) data.targetType = "milestone";
    if (!("targetValue" in data)) data.targetValue = 100;
    if (typeof data.targetValue === "number" && data.targetValue <= 0) data.targetValue = 100;
    if (!("targetUnit" in data)) data.targetUnit = "";
    if (!("currentValue" in data)) data.currentValue = null;
    if (!("currentNote" in data)) data.currentNote = null;
    if (!("lastUpdated" in data)) data.lastUpdated = null;
    // Strip computed fields in case LLM sends them
    delete data.activityProgress;
    delete data.outcomeProgress;
    delete data.progress;
    const obj = dashboard.objectives.find((o) => o.id === objId);
    if (obj) {
      obj.keyResults.push(data as unknown as OkrKeyResult);
    } else {
      console.warn("[executor] OKR add KR: objective not found:", objId);
    }
    return;
  }

  // Adding a decision to an existing objective
  if (data._addDecision) {
    const objId = data._addDecision as string;
    delete data._addDecision;
    delete data.id;
    delete data.createdAt;
    const obj = dashboard.objectives.find((o) => o.id === objId);
    if (obj) {
      obj.decisions.push(data as unknown as { date: string; summary: string });
      // Keep only last 5 decisions
      if (obj.decisions.length > 5) {
        obj.decisions = obj.decisions.slice(-5);
      }
    } else {
      console.warn("[executor] OKR add decision: objective not found:", objId);
    }
    return;
  }

  // Adding a new objective
  if (!data.id) data.id = genId("obj");
  if (!data.keyResults) data.keyResults = [];
  if (!data.decisions) data.decisions = [];
  if (!("activityProgress" in data)) data.activityProgress = 0;
  if (!("outcomeProgress" in data)) data.outcomeProgress = 0;
  if (!data.status) data.status = "active";
  delete data.createdAt;
  dashboard.objectives.push(data as unknown as OkrObjective);
}

function applyOkrUpdate(
  id: string,
  data: Record<string, unknown>,
  state: AppState
): void {
  const dashboard = state.planOkrDashboard;

  // Strip computed fields — system owns these, LLM must never set them
  delete data.activityProgress;
  delete data.outcomeProgress;
  delete data.progress; // legacy field

  // Clamp targetValue to positive if provided
  if (typeof data.targetValue === "number" && data.targetValue <= 0) {
    data.targetValue = 100;
  }

  // Try objective-level first
  const obj = dashboard.objectives.find((o) => o.id === id);
  if (obj) {
    Object.assign(obj, data);
    return;
  }

  // Try KR-level (search across all objectives)
  const match = findKrAcrossObjectives(dashboard.objectives, id);
  if (match) {
    Object.assign(match.kr, data);
    return;
  }

  console.warn("[executor] OKR update: no objective or KR found for id:", id);
}

function applyOkrDelete(
  id: string,
  state: AppState
): void {
  const dashboard = state.planOkrDashboard;

  // Try deleting an objective
  const objIdx = dashboard.objectives.findIndex((o) => o.id === id);
  if (objIdx !== -1) {
    dashboard.objectives.splice(objIdx, 1);
    return;
  }

  // Try deleting a KR from any objective
  for (const obj of dashboard.objectives) {
    const krIdx = obj.keyResults.findIndex((k) => k.id === id);
    if (krIdx !== -1) {
      obj.keyResults.splice(krIdx, 1);
      return;
    }
  }

  console.warn("[executor] OKR delete: no objective or KR found for id:", id);
}

function logSignal(
  signal: { signal: string; value: string },
  state: AppState
): void {
  const mem = state.feedbackMemory;
  if (!Array.isArray(mem.behavioralSignals)) mem.behavioralSignals = [];
  const existing = mem.behavioralSignals.find(
    (s) => s.signal === signal.signal
  );
  if (existing) {
    existing.observed += 1;
    existing.lastSeen = getUserToday(state);
  } else {
    mem.behavioralSignals.push({
      signal: signal.signal,
      observed: 1,
      lastSeen: getUserToday(state),
    });
  }
  state._dirty.add("feedbackMemory");
}

/**
 * Cross-reference calendar events against the brief's days.
 * If any active event falls within the brief's date range but is missing
 * from the corresponding day's additions, inject it automatically.
 */
/**
 * Replace raw IDs with human-readable titles in all user-visible brief text.
 */
/**
 * Pre-write validation: check task/event times against the user's lifestyle
 * schedule and behavioral rules. Strips conflicting times rather than
 * blocking the write entirely.
 */
function validateAndAdjustWrites(plan: ActionPlan, state: AppState): void {
  const lifestyle = (state as any).userLifestyle;
  const rules = state.feedbackMemory?.rules || [];

  for (const write of plan.writes) {
    if (write.action !== "add") continue;
    if (write.file !== "tasks" && write.file !== "calendar") continue;

    const datetime = (write.data.datetime as string) || "";
    const due = (write.data.due as string) || "";
    const title = (write.data.title as string) || "";
    const timeStr = datetime ? datetime.slice(11, 16) : ""; // HH:MM

    if (!timeStr) continue; // no time set — nothing to validate

    const timeMin = timeToMin(timeStr);
    if (timeMin < 0) continue;

    const duration = (write.data.durationMinutes as number) || (write.data.duration as number) || 30;
    const endMin = timeMin + duration;

    // Check against fixed lifestyle blocks
    if (lifestyle?.weekdaySchedule) {
      for (const block of lifestyle.weekdaySchedule) {
        if (block.type !== "fixed") continue;

        const blockStart = timeToMin(block.time?.split("-")[0] || "");
        const blockRange = block.time?.split("-");
        let blockEnd = blockStart + 60; // default 1 hour if no end time
        if (blockRange && blockRange.length === 2) {
          blockEnd = timeToMin(blockRange[1]);
        }
        if (blockStart < 0 || blockEnd < 0) continue;

        // Interval overlap: startA < endB && startB < endA
        if (timeMin < blockEnd && blockStart < endMin) {
          console.log(`[executor] time conflict: "${title}" at ${timeStr} overlaps fixed block "${block.activity}" (${block.time})`);
          // Strip the specific time — keep the date, remove the time portion
          if (write.data.datetime) {
            write.data.datetime = (write.data.datetime as string).slice(0, 10) + "T00:00:00";
          }
          write.data.notes = ((write.data.notes as string) || "") +
            ` [Time removed — conflicts with "${block.activity}" (${block.time}, fixed)]`;
          plan.reply += `\n\n\u{1F6A7} I was going to schedule "${title}" at ${timeStr}, but that conflicts with "${block.activity}" (${block.time}). I've created it without a specific time — you can slot it when you're ready.`;
          break;
        }
      }
    }

    // Check against behavioral rules
    for (const rule of rules) {
      // Simple time-based rule matching: look for time ranges in the rule text
      const ruleTimeMatch = rule.rule.match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
      if (ruleTimeMatch) {
        const ruleStart = timeToMin(ruleTimeMatch[1]);
        const ruleEnd = timeToMin(ruleTimeMatch[2]);
        if (ruleStart >= 0 && ruleEnd >= 0 && timeMin < ruleEnd && ruleStart < endMin) {
          console.log(`[executor] rule conflict: "${title}" at ${timeStr} violates rule "${rule.rule}"`);
          if (write.data.datetime) {
            write.data.datetime = (write.data.datetime as string).slice(0, 10) + "T00:00:00";
          }
          write.data.notes = ((write.data.notes as string) || "") +
            ` [Time removed — violates rule: "${rule.rule}"]`;
          plan.reply += `\n\n\u{1F6A7} "${title}" was going to be at ${timeStr}, but you asked me to "${rule.rule}". Created without a specific time.`;
          break;
        }
      }

      // Keyword-based rule matching: check if the rule mentions the block name
      const ruleKeywords = ["never schedule", "don't schedule", "no tasks", "no meetings", "don't book"];
      const ruleLower = rule.rule.toLowerCase();
      if (ruleKeywords.some((kw) => ruleLower.includes(kw))) {
        // Check if the rule mentions a time period name that matches
        const periodNames = ["family time", "admin time", "deep work", "wind down", "sleep", "morning"];
        for (const period of periodNames) {
          if (ruleLower.includes(period)) {
            // Find this period in the lifestyle schedule
            const matchingBlock = lifestyle?.weekdaySchedule?.find(
              (b: any) => b.activity?.toLowerCase().includes(period)
            );
            if (matchingBlock) {
              const bStart = timeToMin(matchingBlock.time?.split("-")[0] || "");
              const bRange = matchingBlock.time?.split("-");
              let bEnd = bStart + 60;
              if (bRange?.length === 2) bEnd = timeToMin(bRange[1]);
              if (bStart >= 0 && bEnd >= 0 && timeMin < bEnd && bStart < endMin) {
                console.log(`[executor] keyword rule conflict: "${title}" at ${timeStr} during "${period}"`);
                if (write.data.datetime) {
                  write.data.datetime = (write.data.datetime as string).slice(0, 10) + "T00:00:00";
                }
                write.data.notes = ((write.data.notes as string) || "") +
                  ` [Time removed — "${rule.rule}"]`;
                plan.reply += `\n\n\u{1F6A7} "${title}" moved out of ${period} per your rule.`;
                break;
              }
            }
          }
        }
      }
    }
  }
}

function timeToMin(time: string): number {
  if (!time) return -1;
  const parts = time.split(":");
  if (parts.length < 2) return -1;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return -1;
  return h * 60 + m;
}

function humanizeBriefText(brief: any, state: AppState): void {
  // Build id -> title map
  const idMap = new Map<string, string>();
  for (const t of state.tasks.tasks) { if (t.id && t.title) idMap.set(t.id, t.title); }
  for (const e of state.calendar.events) { if (e.id && e.title) idMap.set(e.id, e.title); }
  for (const r of state.recurringTasks.recurring) { if (r.id && r.title) idMap.set(r.id, r.title); }
  for (const obj of state.planOkrDashboard.objectives) {
    if (obj.id && obj.title) idMap.set(obj.id, obj.title);
    for (const kr of obj.keyResults) { if (kr.id && kr.title) idMap.set(kr.id, kr.title); }
  }
  if (idMap.size === 0) return;

  const replace = (text: string): string => {
    if (!text) return text;
    return text.replace(/\b(TASK-\d+|CAL-\d+|CAL-[A-Z]+-\d+|tsk_\w+|rec_\w+|obj_\w+|kr_[\w]+|rcev_\w+)\b/g, (m) => {
      let title = idMap.get(m);
      if (!title) {
        const stripped = m.replace(/_\d{8}$/, "");
        title = idMap.get(stripped);
      }
      return title || m;
    });
  };

  if (brief.executiveSummary) brief.executiveSummary = replace(brief.executiveSummary);
  if (brief.companion?.motivationNote) brief.companion.motivationNote = replace(brief.companion.motivationNote);
  if (brief.companion?.copingSuggestion) brief.companion.copingSuggestion = replace(brief.companion.copingSuggestion);
  if (brief.companion?.focusMantra) brief.companion.focusMantra = replace(brief.companion.focusMantra);
  if (Array.isArray(brief.priorities)) {
    for (const p of brief.priorities) {
      if (p.why) p.why = replace(p.why);
    }
  }
  if (Array.isArray(brief.risks)) {
    for (const r of brief.risks) {
      if (r.title) r.title = replace(r.title);
      if (r.detail) r.detail = replace(r.detail);
    }
  }
  if (Array.isArray(brief.days)) {
    for (const day of brief.days) {
      if (day.dayNote) day.dayNote = replace(day.dayNote);
    }
  }
}

/**
 * Replace LLM-generated okrSnapshot progress placeholders with computed values.
 * The LLM emits the structure but TypeScript owns the numbers.
 */
function injectOkrProgress(brief: any, state: AppState): void {
  if (!Array.isArray(brief.okrSnapshot) || brief.okrSnapshot.length === 0) return;

  const taskStats = buildTaskStats(state.tasks.tasks);
  const dashboard = state.planOkrDashboard;

  for (const snap of brief.okrSnapshot) {
    // Find matching objective
    const obj = dashboard.objectives.find(
      (o) => o.title === snap.objective || o.id === snap.objective
    );
    if (!obj) continue;

    // Compute objective-level progress
    let actSum = 0;
    let outSum = 0;
    for (const kr of obj.keyResults) {
      const act = computeKrActivity(kr.id, taskStats);
      const out = computeKrOutcome(kr);
      actSum += act;
      outSum += out;

      // Inject into matching KR in snapshot
      if (Array.isArray(snap.keyResults)) {
        const snapKr = snap.keyResults.find(
          (sk: any) => sk.title === kr.title || sk.id === kr.id
        );
        if (snapKr) {
          snapKr.activityProgress = act;
          snapKr.outcomeProgress = out;
          snapKr.currentValue = kr.currentValue;
          snapKr.currentNote = kr.currentNote;
          snapKr.targetValue = kr.targetValue;
          snapKr.targetUnit = kr.targetUnit;
        }
      }
    }

    const krCount = obj.keyResults.length || 1;
    snap.activityProgress = Math.round(actSum / krCount);
    snap.outcomeProgress = Math.round(outSum / krCount);
  }
}

function deduplicateDayAdditions(brief: any): void {
  if (!Array.isArray(brief.days)) return;
  let totalRemoved = 0;
  for (const day of brief.days) {
    if (!Array.isArray(day.additions) || day.additions.length < 2) continue;
    const seen = new Map<string, true>();
    const unique: any[] = [];
    for (const ev of day.additions) {
      // Key by lowercase title + time (ignoring different IDs for the same event)
      const key = `${(ev.title || "").toLowerCase().trim()}|${ev.time || ""}`;
      if (seen.has(key)) {
        totalRemoved++;
        continue;
      }
      seen.set(key, true);
      unique.push(ev);
    }
    day.additions = unique;
  }
  if (totalRemoved > 0) {
    console.log(`[executor] removed ${totalRemoved} duplicate addition(s) from focusBrief`);
  }
}

function injectMissingCalendarEvents(brief: any, state: AppState): void {
  if (!Array.isArray(brief.days) || brief.days.length === 0) return;

  const today = getUserToday(state);
  const activeEvents = state.calendar.events.filter(
    (e) => !e.archived && e.status !== "cancelled" && e.datetime
      && e.datetime.slice(0, 10) >= today  // exclude past events
  );
  if (activeEvents.length === 0) return;

  // Build sets of event IDs AND title+date combos already in the brief.
  // Matching by title+date prevents duplicating recurring events whose
  // processed instance ID (rcev_*) differs from the LLM-generated agenda ID.
  const briefEventIds = new Set<string>();
  const briefTitleDates = new Set<string>();
  for (const day of brief.days) {
    for (const ev of (day.additions || [])) {
      briefEventIds.add(ev.id);
      if (ev.title && day.date) {
        briefTitleDates.add(`${String(ev.title).toLowerCase()}|${day.date}`);
      }
    }
  }

  // Check each active event — inject if missing
  let injected = 0;
  for (const event of activeEvents) {
    if (briefEventIds.has(event.id)) continue;
    // Skip recurring instances that the LLM already covered by title+date
    if (event.datetime) {
      const evDate = event.datetime.slice(0, 10);
      if (briefTitleDates.has(`${event.title.toLowerCase()}|${evDate}`)) continue;
    }

    const eventDate = event.datetime.slice(0, 10);
    const matchingDay = brief.days.find((d: any) => d.date === eventDate);
    if (!matchingDay) continue; // event not in the brief's date range

    // Inject into additions
    if (!matchingDay.additions) matchingDay.additions = [];
    matchingDay.additions.push(normalizeEvent({
      id: event.id,
      title: event.title,
      time: event.datetime.slice(11, 16),
      duration: event.durationMinutes || 30,
      category: mapTypeToCategory(event.type),
      flexibility: "fixed",
      source: "calendar",
      notes: event.notes || "",
    }));
    injected++;
  }

  if (injected > 0) {
    console.log(`[executor] injected ${injected} missing calendar event(s) into focusBrief`);
  }
}

const TIME_WORD_MAP: Record<string, string> = {
  morning: "08:00",
  "early morning": "06:30",
  noon: "12:00",
  midday: "12:00",
  afternoon: "13:00",
  evening: "18:00",
  night: "21:00",
};

const VALID_TIME_RE = /^\d{2}:\d{2}$/;

function normalizeTime(raw: string | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (VALID_TIME_RE.test(trimmed)) return trimmed;
  // Single-digit hour like "8:00" → "08:00"
  const shortMatch = trimmed.match(/^(\d):(\d{2})$/);
  if (shortMatch) return `0${shortMatch[1]}:${shortMatch[2]}`;
  // Map known time words
  const mapped = TIME_WORD_MAP[trimmed.toLowerCase()];
  if (mapped) {
    console.warn(`[executor] normalizeTime: mapped "${trimmed}" → "${mapped}"`);
    return mapped;
  }
  console.warn(`[executor] normalizeTime: invalid time "${trimmed}", stripping`);
  return "";
}

function normalizeEvent(ev: any): any {
  return {
    id: ev.id || genId("ev"),
    title: ev.title || "",
    time: normalizeTime(ev.time),
    duration: ev.duration ?? 0,
    category: ev.category || mapTypeToCategory(ev.type) || "other",
    flexibility: ev.flexibility || ev.type || "flexible",
    source: ev.source || "generated",
    ...(ev.notes ? { notes: ev.notes } : {}),
  };
}

function mapTypeToCategory(type: string | undefined): string {
  if (!type) return "other";
  const t = type.toLowerCase();
  if (t.includes("admin") || t.includes("tax") || t.includes("errand")) return "admin";
  if (t.includes("work") || t.includes("job") || t.includes("interview") || t.includes("dev")) return "work";
  if (t.includes("family") || t.includes("kid") || t.includes("school") || t.includes("cook")) return "family";
  if (t.includes("health") || t.includes("exercise") || t.includes("walk") || t.includes("gym")) return "health";
  if (t.includes("social") || t.includes("meet") || t.includes("call")) return "social";
  if (t.includes("routine") || t.includes("sleep") || t.includes("wake")) return "routine";
  if (t.includes("learn") || t.includes("study") || t.includes("read")) return "learning";
  return "other";
}

/**
 * Minimum loaded count above which the shrinkage guard activates.
 * Below this, "shrinking from 3 to 0" is plausibly a real user action;
 * above it, a 50%+ shrink almost always means something went wrong upstream.
 */
const SHRINKAGE_GUARD_MIN_LOADED = 5;

/**
 * If the new collection length is less than this fraction of the loaded
 * length, the shrinkage guard refuses the write. 0.5 = "refuse if more
 * than half the items vanished in one flush".
 */
const SHRINKAGE_GUARD_RATIO = 0.5;

/**
 * Custom error thrown when the shrinkage guard refuses a write.
 * Callers can catch and surface this to the user, or log it loudly.
 */
export class ShrinkageGuardError extends Error {
  readonly fileKey: FileKey;
  readonly loadedCount: number;
  readonly newCount: number;
  constructor(fileKey: FileKey, loadedCount: number, newCount: number) {
    super(
      `[flush] refused to shrink ${fileKey}: loaded ${loadedCount} items, ` +
      `would write ${newCount} (>${Math.round((1 - SHRINKAGE_GUARD_RATIO) * 100)}% loss). ` +
      `This usually means the in-memory state was corrupted by a failed reload. ` +
      `Refusing to overwrite the on-disk file. Investigate before clearing the dirty flag.`
    );
    this.name = "ShrinkageGuardError";
    this.fileKey = fileKey;
    this.loadedCount = loadedCount;
    this.newCount = newCount;
  }
}

/**
 * Flush dirty state slices to disk.
 *
 * Post-incident contract (Bug 3 + Bug 8):
 *   - Per-file shrinkage guard: refuses to write a collection-shaped file
 *     whose in-memory length is dramatically smaller than the loaded baseline.
 *     This is the structural fuse that prevents wipes from propagating to
 *     disk regardless of which upstream bug fired.
 *   - Per-file failure isolation: uses Promise.allSettled instead of
 *     Promise.all. A write that fails leaves its dirty marker in place so
 *     the next flush retries it; successful writes have their dirty markers
 *     cleared. Previously, a partial failure left _dirty in an inconsistent
 *     state with disk.
 *   - Aggregated error: if any write failed, throws once with the full list.
 */
export async function flush(state: AppState): Promise<void> {
  // ── libSQL mode: persist dirty slices to database ──────────────────
  // Guard: only runs on Node (proxy/headless). On web, writeJsonFile()
  // POSTs to the proxy which handles the DB write via getDbWriter().
  const dbFlush = getFlushToDbFn();
  if (isLibsqlMode() && !isWeb() && dbFlush) {
    return dbFlush(state);
  }

  // ── JSON mode (legacy) ─────────────────────────────────────────────
  const dirtyKeys = Array.from(state._dirty);
  if (dirtyKeys.length === 0) return;

  type WritePlan = {
    key: FileKey;
    path: string;
    data: unknown;
    skipped?: { reason: string };
  };

  const plans: WritePlan[] = [];

  for (const key of dirtyKeys) {
    const path = FILE_MAP[key];
    const data = (state as any)[key];
    if (!path || data === undefined) {
      plans.push({ key, path: path || "", data, skipped: { reason: "missing path or data" } });
      continue;
    }

    // Bug 3: shrinkage guard
    const loadedCount = state._loadedCounts[key];
    const newCount = collectionCountOf(key, data);
    if (
      typeof loadedCount === "number" &&
      typeof newCount === "number" &&
      loadedCount >= SHRINKAGE_GUARD_MIN_LOADED &&
      newCount < loadedCount * SHRINKAGE_GUARD_RATIO
    ) {
      console.error(
        `[flush] SHRINKAGE GUARD TRIPPED for ${key}: ` +
        `loaded=${loadedCount} new=${newCount}. Refusing to write.`
      );
      plans.push({
        key,
        path,
        data,
        skipped: { reason: `shrinkage guard: ${loadedCount} → ${newCount}` },
      });
      continue;
    }

    plans.push({ key, path, data });
  }

  // Execute writes with per-file failure isolation
  const results = await Promise.allSettled(
    plans.map((p) =>
      p.skipped ? Promise.reject(new ShrinkageGuardError(p.key, state._loadedCounts[p.key] ?? 0, collectionCountOf(p.key, p.data) ?? 0))
                : writeJsonFile(p.path, p.data)
    )
  );

  const failures: { key: FileKey; error: any }[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const plan = plans[i];
    if (r.status === "fulfilled") {
      // Successful write → clear the dirty marker AND update the loaded
      // count baseline so the next flush has an accurate reference.
      state._dirty.delete(plan.key);
      const newCount = collectionCountOf(plan.key, plan.data);
      if (typeof newCount === "number") {
        state._loadedCounts[plan.key] = newCount;
      }
    } else {
      // Failed write → keep the dirty marker for retry, collect the error
      failures.push({ key: plan.key, error: r.reason });
      console.error(`[flush] write failed for ${plan.key}:`, r.reason?.message || r.reason);
    }
  }

  if (failures.length > 0) {
    const summary = failures
      .map((f) => `  • ${f.key}: ${f.error?.message || f.error}`)
      .join("\n");
    const err: any = new Error(
      `[flush] ${failures.length} write(s) failed:\n${summary}`
    );
    err.failures = failures;
    throw err;
  }
}
