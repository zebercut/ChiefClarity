import React, { useState, useEffect, useRef, useCallback, useContext } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
  NativeSyntheticEvent,
  TextInputKeyPressEventData,
  Alert,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import MarkdownText from "../../src/components/MarkdownText";
import { SmartActionCard, WriteSummarySection } from "../../src/components/SmartActionCard";
import ItemListCard from "../../src/components/ItemListCard";
import { detectSmartActions, buildWriteSummary, isQuestionReply, generateResponseOptions, executeDirectAction, humanizeIds } from "../../src/modules/smartActions";
import { ConfigContext } from "../_layout";
import { loadState } from "../../src/modules/loader";
import { loadChatHistory, saveChatHistory } from "../../src/modules/chatHistory";
import { checkInbox, processInbox } from "../../src/modules/inbox";
import { getUnresolvedAnnotations, resolveAnnotations } from "../../src/modules/annotations";
import { isFrictionOnCooldown, markFrictionsMentioned } from "../../src/modules/proactiveEngine";
import { startTipSession, pickTip, trackFeaturesUsage } from "../../src/modules/tips";
import { getUnshownNudges, dismissNudge } from "../../src/modules/nudges";
import type { Nudge } from "../../src/modules/proactiveEngine";
import { classifyIntentWithFallback, routeToSkill } from "../../src/modules/router";
import { dispatchSkill } from "../../src/modules/skillDispatcher";
import { shouldTryV4 } from "../../src/modules/v4Gate";
import { assembleContext } from "../../src/modules/assembler";
import { runTriage, learnScopePreference } from "../../src/modules/triage";
import type { TriageResult } from "../../src/modules/triage";
import { loadTriageContext } from "../../src/modules/triageLoader";
import { callLlm, isCircuitOpen, getCircuitBreakerStatus, resetCircuitBreaker, MODEL_HEAVY } from "../../src/modules/llm";
import { applyWrites, flush } from "../../src/modules/executor";
import { patchBrief } from "../../src/modules/briefPatcher";
import { runNotesBatch, isNotesBatchRunning } from "../../src/modules/notesProcessor";
import { renderBriefToHtml } from "../../src/modules/briefRenderer";
import {
  updateSummaries,
  rebuildHotContext,
  rebuildContradictionIndex,
} from "../../src/modules/summarizer";
import { checkEmotionalTone } from "../../src/modules/companion";
import { nowTimeStr, formatLocalTime } from "../../src/utils/dates";
import type { AppState, ConversationTurn, ChatMessage, SmartAction, IntentType } from "../../src/types";

const MAX_TURNS = 5;

type Message = ChatMessage;

const FOLLOW_UP_MESSAGES = [
  "Almost there...",
  "Putting it together...",
  "Just a moment...",
];

function useThinkingMessage(isLoading: boolean, primary: string) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!isLoading) {
      setPhase(0);
      return;
    }
    // Show primary message first, then cycle follow-ups after 4s
    const timer = setTimeout(() => setPhase(1), 4000);
    const interval = setInterval(() => {
      setPhase((prev) => Math.min(prev + 1, FOLLOW_UP_MESSAGES.length));
    }, 3000);
    return () => { clearTimeout(timer); clearInterval(interval); };
  }, [isLoading, primary]);

  if (phase === 0) return primary;
  return FOLLOW_UP_MESSAGES[Math.min(phase - 1, FOLLOW_UP_MESSAGES.length - 1)];
}

export default function ChatScreen() {
  const { theme, toggleTheme } = useContext(ConfigContext);
  const router = useRouter();
  const params = useLocalSearchParams<{ autoSend?: string }>();
  const [state, setState] = useState<AppState | null>(null);
  const stateRef = useRef<AppState | null>(null); // always points to latest state
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false); // ref for race condition guard
  const inboxProcessingRef = useRef(false); // prevents concurrent inbox processing
  const [inboxPending, setInboxPending] = useState(false);
  const [activeNudges, setActiveNudges] = useState<Nudge[]>([]);
  const [inboxResult, setInboxResult] = useState<string | null>(null);
  const [dismissedActions, setDismissedActions] = useState<Set<string>>(new Set()); // "msgIdx_actionIdx"
  const [thinkingLabel, setThinkingLabel] = useState("Thinking...");
  const thinkingMsg = useThinkingMessage(loading, thinkingLabel);
  const scrollRef = useRef<ScrollView>(null);
  const fullHistory = useRef<Message[]>([]); // all messages from disk
  const INITIAL_VISIBLE = 5;
  const LOAD_MORE_COUNT = 10;
  const inputRef = useRef<TextInput>(null);

  // Input history for up/down arrow navigation
  const inputHistory = useRef<string[]>([]);
  const historyIndex = useRef(-1); // -1 = not browsing history
  const savedInput = useRef(""); // saves current input when entering history mode

  const isFirstLoad = useRef(true);
  const loadedHistoryCount = useRef(-1); // -1 = not yet loaded

  // Keep refs in sync
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);

  // Initial load — state + chat history
  useEffect(() => {
    Promise.all([loadState(), loadChatHistory()])
      .then(([s, history]) => {
        setState(s);
        rebuildHotContext(s);
        rebuildContradictionIndex(s);
        updateSummaries(s);
        if (history.length > 0) {
          fullHistory.current = history;
          // Show only last N messages initially
          const visible = history.slice(-INITIAL_VISIBLE);
          loadedHistoryCount.current = visible.length;
          setMessages(visible);
          // Rebuild conversation buffer from last N messages
          const turns: ConversationTurn[] = history
            .slice(-MAX_TURNS * 2)
            .map((m) => ({ role: m.role, content: m.content }));
          setConversation(turns);
          // Build input history from ALL user messages (not just visible)
          inputHistory.current = history
            .filter((m) => m.role === "user")
            .map((m) => m.content);
          shouldAutoScroll.current = true;
        }
        isFirstLoad.current = false;
        startTipSession().catch(() => {});
        // Check inbox + load nudges after initial load
        tryProcessInbox();
        getUnshownNudges().then((n) => { if (n.length > 0) setActiveNudges(n); });
      })
      .catch((err) => {
        // Bug 4 (post-fix): on the INITIAL load, there is no existing state
        // to protect — silently swallowing the error would leave the app
        // showing empty defaults forever. Surface to console AND re-throw
        // so React's unhandled-rejection handling fires; the smoke test in
        // _layout.tsx should have caught this earlier, but if it didn't
        // (e.g., a race that only manifests in the chat tab), the user
        // sees the error in the dev console rather than a silent empty UI.
        // The "keep existing state on transient failure" logic ONLY applies
        // to subsequent reloads, not the first one.
        console.error("[chat] INITIAL loadState failed — app cannot start:", err);
        throw err;
      });
  }, []);

  // Reload state when tab regains focus — skip if loading (race condition guard).
  // Bug 4: catch loader errors instead of letting them silently replace state
  // with empty defaults. The loader now throws on read failure (post Bug 1
  // fix); we keep the existing in-memory state on error rather than wiping it.
  useFocusEffect(useCallback(() => {
    if (isFirstLoad.current || loadingRef.current) return;
    loadState()
      .then((s) => {
        if (loadingRef.current) return;
        rebuildHotContext(s);
        setState(s);
        tryProcessInbox();
      })
      .catch((err) => {
        console.error("[chat] focus reload failed — keeping in-memory state:", err?.message);
      });
  }, []));

  // ─── Continuous polling — app stays open for days ──────────────────────
  // Inbox + nudges: every 2 minutes
  // State refresh: every 5 minutes
  useEffect(() => {
    const inboxInterval = setInterval(() => {
      if (isFirstLoad.current || loadingRef.current || inboxProcessingRef.current) return;
      tryProcessInbox();
      getUnshownNudges().then((n) => {
        if (n.length > 0) {
          setActiveNudges((prev) => {
            // Merge: keep existing undismissed + add new (dedup by id)
            const existingIds = new Set(prev.map((p) => p.id));
            const fresh = n.filter((nudge) => !existingIds.has(nudge.id));
            return [...prev, ...fresh].slice(-5); // max 5 visible
          });
        }
      });
    }, 120000); // 2 minutes

    const stateInterval = setInterval(() => {
      if (isFirstLoad.current || loadingRef.current) return;
      // Bug 4: catch transient load failures. The loader now throws on
      // read/decrypt/parse failure (post Bug 1 fix). If a 5-minute poll
      // fails (e.g., Google Drive sync race, partial write in progress),
      // we keep the existing in-memory state instead of replacing it
      // with empty defaults that would be flushed back to disk.
      loadState()
        .then((s) => {
          if (loadingRef.current) return;
          rebuildHotContext(s);
          setState(s);

          // Stale plan detection — show a nudge instead of auto-triggering
          // (auto-trigger caused infinite retry loops when LLM calls failed)
        })
        .catch((err) => {
          console.error("[chat] periodic reload failed — keeping in-memory state:", err?.message);
        });
    }, 300000); // 5 minutes

    // Notes batch: every 4 hours (FEAT026). Headless runner also handles
    // this when the app is closed. The in-process lock in notesProcessor
    // makes concurrent triggers safe.
    const NOTES_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4h
    const notesInterval = setInterval(() => {
      if (isFirstLoad.current || loadingRef.current || isNotesBatchRunning() || isCircuitOpen()) return;
      const s = stateRef.current;
      if (!s) return;
      runNotesBatch(s)
        .then((result) => {
          if (result.ran && result.noteCount > 0) {
            console.log(`[notes] auto-batch: ${result.reply}`);
            // Refresh state so any tasks/events the batch created are visible.
            // Bug 4: catch read failures and keep in-memory state.
            loadState()
              .then((fresh) => {
                if (!loadingRef.current) {
                  rebuildHotContext(fresh);
                  setState(fresh);
                }
              })
              .catch((err) =>
                console.error("[chat] post-batch reload failed:", err?.message)
              );
          }
        })
        .catch((err) => console.warn("[notes] auto-batch failed:", err));
    }, NOTES_INTERVAL_MS);

    return () => {
      clearInterval(inboxInterval);
      clearInterval(stateInterval);
      clearInterval(notesInterval);
    };
  }, []);

  // Handle autoSend from Focus tab navigation
  const autoSendHandled = useRef<string | null>(null);
  useEffect(() => {
    if (params.autoSend && state && !loading && params.autoSend !== autoSendHandled.current) {
      autoSendHandled.current = params.autoSend;
      sendPhraseDirect(params.autoSend);
    }
  }, [params.autoSend, state, loading]);

  const shouldAutoScroll = useRef(true);
  const scrollToBottom = useCallback(() => {
    shouldAutoScroll.current = true;
  }, []);
  const onContentSizeChange = useCallback(() => {
    if (shouldAutoScroll.current) {
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  }, []);

  function handleKeyPress(e: NativeSyntheticEvent<TextInputKeyPressEventData>) {
    if (Platform.OS !== "web") return;
    const nativeEvent = e.nativeEvent as any;

    // Enter to send
    if (nativeEvent.key === "Enter" && !nativeEvent.shiftKey) {
      e.preventDefault();
      sendPhrase();
      return;
    }

    // Up arrow — browse input history backwards
    if (nativeEvent.key === "ArrowUp") {
      const hist = inputHistory.current;
      if (hist.length === 0) return;
      e.preventDefault();
      if (historyIndex.current === -1) {
        // Entering history mode — save current input
        savedInput.current = input;
        historyIndex.current = hist.length - 1;
      } else if (historyIndex.current > 0) {
        historyIndex.current--;
      }
      setInput(hist[historyIndex.current]);
      return;
    }

    // Down arrow — browse input history forwards
    if (nativeEvent.key === "ArrowDown") {
      if (historyIndex.current === -1) return; // not in history mode
      e.preventDefault();
      const hist = inputHistory.current;
      if (historyIndex.current < hist.length - 1) {
        historyIndex.current++;
        setInput(hist[historyIndex.current]);
      } else {
        // Back to current input
        historyIndex.current = -1;
        setInput(savedInput.current);
      }
      return;
    }

    // Any other key exits history browsing
    if (historyIndex.current !== -1) {
      historyIndex.current = -1;
    }
  }

  function handleSuggestionTap(suggestion: string, isQuestion: boolean) {
    if (isQuestion) {
      // Question — pre-fill input, let user edit/confirm
      setInput(suggestion);
      inputRef.current?.focus();
    } else {
      // Action — execute immediately
      setInput(suggestion);
      // Use setTimeout so state updates before sendPhrase reads it
      setTimeout(() => sendPhraseDirect(suggestion), 0);
    }
  }

  async function sendPhraseDirect(phrase: string) {
    if (!phrase.trim() || !stateRef.current || loading) return;
    setInput("");
    setLoading(true);
    inputRef.current?.focus();

    const now = nowTimeStr(stateRef.current?.userProfile?.timezone);
    setMessages((m) => [...m, { role: "user", content: phrase, timestamp: now }]);
    scrollToBottom();
    await processPhrase(phrase, now);
  }

  async function sendPhrase() {
    if (!input.trim() || !stateRef.current || loading) return;
    const phrase = input.trim();
    setInput("");
    setLoading(true);
    inputRef.current?.focus();

    const now = nowTimeStr(stateRef.current?.userProfile?.timezone);
    setMessages((m) => [...m, { role: "user", content: phrase, timestamp: now }]);
    scrollToBottom();
    await processPhrase(phrase, now);
  }

  async function processPhrase(phrase: string, now: string) {
    // Use ref to always get the latest state — avoids stale closure issues
    const s = stateRef.current;
    if (!s) return;

    try {
      // ── FEAT043: Two-stage triage pipeline ─────────────────────────
      let emotionalSignals = checkEmotionalTone(phrase, s);
      const tz = s.userProfile?.timezone || undefined;
      const userToday = s.hotContext?.today || new Date().toLocaleDateString("en-CA", { timeZone: tz });

      // Filter friction signals through cooldown
      if (emotionalSignals?.friction) {
        const filtered: string[] = [];
        for (const f of emotionalSignals.friction) {
          const onCooldown = await isFrictionOnCooldown(f, userToday);
          if (!onCooldown) filtered.push(f);
        }
        emotionalSignals.friction = filtered;
        if (emotionalSignals.emotions.length === 0 && emotionalSignals.friction.length === 0) {
          emotionalSignals = null;
        }
      }

      // Stage 1: Triage (regex fast-path or Haiku call)
      const conversationSummary = conversation.slice(-6).map((t) => `${t.role}: ${t.content.slice(0, 100)}`).join("\n");
      const triage = await runTriage(phrase, conversationSummary, s.hotContext, s);

      // ── FEAT056: v4 skill dispatch — runs AFTER triage but BEFORE
      // triage's canHandle/needsClarification short-circuits. Triage's
      // emotional/friction detection is preserved (it ran above), but
      // v4 skills get first crack at handling the phrase before triage
      // can refuse it ("can't do that") or demand clarification.
      // The gate keeps legacy as the only path when v4 is disabled,
      // when pending-context multi-turn is in flight, or when triage
      // already locked an intent (fast path). See src/modules/v4Gate.ts.
      if (shouldTryV4({ state: s, triageLegacyIntent: triage.legacyIntent ?? null })) {
        try {
          const routeResult = await routeToSkill({ phrase });
          const dispatchResult = await dispatchSkill(routeResult, phrase, { state: s });
          if (dispatchResult && !dispatchResult.degraded) {
            // FEAT057: persist any writes the v4 handler made via
            // executor.applyWrites. The handler mutates state + _dirty but
            // doesn't flush — flush is the chat surface's responsibility,
            // matching the legacy path that flushes at end of processPhrase.
            // Without this, task creates/updates would be lost on restart.
            if (s._dirty.size > 0) {
              try {
                await flush(s);
              } catch (err: any) {
                console.error("[chat] v4 flush failed (writes lost):", err);
                // Don't block render — user already sees the v4 reply.
                // The error is in the log; next turn will retry.
              }
            }

            setMessages((m: Message[]) => [...m, {
              role: "assistant" as const,
              content: dispatchResult.userMessage,
              timestamp: now,
              isQuestion: dispatchResult.clarificationRequired,
              // FEAT057: pass through structured items from the skill handler
              // (used by task_management for query results).
              items: dispatchResult.items,
              v4Meta: {
                skillId: dispatchResult.skillId,
                confidence: routeResult.confidence,
                routingMethod: routeResult.routingMethod,
              },
            }]);
            setLoading(false);
            return; // v4 handled the turn — skip legacy
          }
          // null OR degraded → fall through to legacy (silent — see
          // FEAT056 design review §3.1)
          if (dispatchResult?.degraded) {
            console.warn(
              "[chat] v4 degraded, falling through to legacy:",
              dispatchResult.degraded.reason
            );
          }
        } catch (err: any) {
          // Defensive — dispatchSkill is contracted not to throw, but if
          // it does, fall through to legacy and log loud.
          console.error("[chat] v4 hook threw — falling through to legacy:", err);
        }
      }

      // Handle "can't do that"
      if (!triage.canHandle) {
        const msg = triage.cannotHandleReason || "I can't help with that — it's outside what this app can do.";
        setMessages((m: Message[]) => [...m, { role: "assistant" as const, content: msg, timestamp: now }]);
        setLoading(false);
        return;
      }

      // Handle scope clarification — show question + quick-tap options
      if (triage.needsClarification && triage.clarificationOptions?.length) {
        const clarifyActions: SmartAction[] = [{
          text: triage.clarificationQuestion || "Could you be more specific?",
          type: "question" as const,
          quickActions: triage.clarificationOptions.map((opt) => ({
            label: opt.label,
            payload: `__scope|${opt.hint}|${phrase}`,
            isDirect: true,
          })),
        }];
        setMessages((m: Message[]) => [...m, {
          role: "assistant" as const,
          content: triage.clarificationQuestion || "Could you be more specific about the scope?",
          smartActions: clarifyActions,
          isQuestion: true,
          timestamp: now,
        }]);
        // Store the triage context for when the user picks an option
        s._pendingContext = { type: "general" as IntentType, tokenBudget: 3000, phrase } as any;
        (s as any)._pendingTriage = triage;
        setLoading(false);
        return;
      }

      // Handle pending context for multi-turn (use legacy intent if available)
      let intent = triage.legacyIntent
        ? { type: triage.legacyIntent, tokenBudget: 3000, phrase }
        : await classifyIntentWithFallback(phrase, s);
      if (s._pendingContext && intent.type === "general") {
        intent = { ...s._pendingContext, followupPhrase: phrase };
        s._pendingContext = null;
      }

      setThinkingLabel(triage.understanding || "Working on it...");

      // Load annotations for planning
      if (triage.actionType === "plan" || intent.type === "full_planning") {
        const anns = await getUnresolvedAnnotations();
        (s as any)._annotations = anns;
      }

      // Stage 2 context: use triage loader for new pipeline, assembler as fallback
      let context: Record<string, unknown>;
      let systemPromptOverride: string | undefined;

      if (triage.fastPath && triage.legacyIntent) {
        // Fast-path: use old assembler (proven, no regression)
        context = await assembleContext(intent, phrase, s, conversation);
      } else {
        // Triage-driven: load only what triage requested
        const loaded = await loadTriageContext(triage, phrase, s, conversation);
        context = loaded.context;
        systemPromptOverride = loaded.systemPrompt;
      }

      if (emotionalSignals) {
        context.emotionalSignals = emotionalSignals;
      }

      // Pick a contextual tip
      const NEGATIVE_EMOTIONS = ["stressed", "frustrated", "anxious", "low_energy", "venting"];
      const hasNegEmotion = emotionalSignals?.emotions?.some((e: string) => NEGATIVE_EMOTIONS.includes(e)) || false;
      const tip = await pickTip(intent.type, hasNegEmotion, userToday);
      if (tip) {
        context.tip = tip;
      }

      // Choose model + budget + tool_choice based on triage
      const isAnalysis = triage.actionType === "analysis";
      const plan = await callLlm(context, intent.type, {
        modelOverride: triage.complexity === "high" ? MODEL_HEAVY : undefined,
        systemPromptOverride,
        tokenBudgetOverride: isAnalysis ? 4096 : undefined,
        toolChoiceAuto: isAnalysis, // let LLM reason before structured output
      });

      if (!plan) {
        const cbStatus = getCircuitBreakerStatus();
        if (cbStatus.open) console.error("[chat] circuit breaker open, last error:", cbStatus.lastError);
        const errorMsg = cbStatus.open
          ? `I've paused to protect your API credits after ${cbStatus.failures} consecutive failures. Will auto-resume in ${cbStatus.cooldownMinutes} minutes, or tap "Resume" to retry now.`
          : "Something went wrong. Please try again.";
        setMessages((m) => [
          ...m,
          { role: "assistant", content: errorMsg, timestamp: now, _circuitBreakerTripped: cbStatus.open },
        ]);
        setLoading(false);
        return;
      }

      if (plan.needsClarification) {
        s._pendingContext = intent;
      } else {
        s._pendingContext = null;
      }

      // Mark friction signals as mentioned — but ONLY if no negative emotions.
      if (emotionalSignals?.friction?.length && !hasNegEmotion) {
        markFrictionsMentioned(emotionalSignals.friction, userToday)
          .catch((err) => console.error("[chat] markFrictionsMentioned failed:", err));
      }

      // Track feature usage for tips system (single batch save)
      const usageFeatures: string[] = [intent.type];
      if (intent.type === "full_planning" && phrase.toLowerCase().includes("week")) usageFeatures.push("week_plan");
      if (plan.writes.some((w) => w.file === "tasks" && w.action === "add")) usageFeatures.push("task_create");
      if (plan.writes.some((w) => w.action === "update") && plan.reply.toLowerCase().includes("done")) usageFeatures.push("chat_mark_done");
      trackFeaturesUsage(usageFeatures).catch(() => {});

      const briefJustGenerated = plan.writes.some((w) => w.file === "focusBrief");

      if (plan.writes.length > 0) {
        await applyWrites(plan, s);
        updateSummaries(s);
        rebuildHotContext(s);
        rebuildContradictionIndex(s);
        if (!briefJustGenerated && plan.writes.some((w) => ["tasks", "calendar", "planOkrDashboard"].includes(w.file))) {
          patchBrief(s, plan.writes);
          try {
            await renderBriefToHtml(s.focusBrief, s.userProfile?.timezone);
          } catch {}
        }

        // If a focus brief was generated, render the HTML version
        if (briefJustGenerated) {
          try {
            await renderBriefToHtml(s.focusBrief, s.userProfile?.timezone);
            console.log("[chat] focus_brief.html written");
          } catch (htmlErr) {
            console.error("[chat] focus_brief.html failed:", htmlErr);
          }
        }

        // Only resolve annotations if the LLM actually generated a focusBrief (proof it processed planning)
        if ((s as any)._annotations?.length > 0 && plan.writes.some((w) => w.file === "focusBrief")) {
          await resolveAnnotations((s as any)._annotations.map((a: any) => a.id), "llm").catch(() => {});
        }
      }

      // Replace any raw IDs with human-readable titles in all user-visible text
      let fullReply = humanizeIds(plan.reply, s);
      if (plan.suggestions) {
        plan.suggestions = plan.suggestions.map((sg) => humanizeIds(sg, s));
      }
      if (plan.items) {
        for (const item of plan.items) {
          if (item.commentary) item.commentary = humanizeIds(item.commentary, s);
        }
      }

      // Build enriched message with smart actions + write summary
      const smartActions = plan.suggestions.length > 0
        ? detectSmartActions(plan.suggestions, s)
        : [];
      const questionActions = isQuestionReply(fullReply, plan.needsClarification)
        ? generateResponseOptions(fullReply)
        : [];

      // Detect conflict warnings and create resolution actions
      const conflictActions: import("../../src/types").SmartAction[] = [];
      if (fullReply.includes("\u26a0") && fullReply.includes("Conflicts:")) {
        // Find tasks/events mentioned in conflicts and offer resolution
        for (const write of plan.writes) {
          if (write.action === "add" && (write.file === "tasks" || write.file === "calendar")) {
            const title = (write.data.title as string) || "";
            const id = (write.data.id as string) || "";
            if (title && id) {
              conflictActions.push({
                text: `"${title}" has time conflicts`,
                type: "task_followup",
                taskId: id,
                quickActions: [
                  { label: "Keep anyway", payload: "dismiss", isDirect: true },
                  { label: "Remove time", payload: "reschedule_tomorrow", isDirect: true, targetId: id },
                  { label: "Delete it", payload: "delete", isDirect: true, targetId: id },
                ],
              });
            }
          }
        }
      }

      const allActions = [...questionActions, ...conflictActions, ...smartActions];
      const writeSummary = plan.writes.length > 0 ? buildWriteSummary(plan.writes) : undefined;

      // If LLM returned structured items, use those instead of smart actions
      const hasItems = plan.items && plan.items.length > 0;
      // Snapshot display data into items for history persistence
      if (hasItems) {
        for (const item of plan.items) {
          const task = item.type === "task" ? s.tasks.tasks.find((t) => t.id === item.id) : undefined;
          const event = item.type === "event" ? s.calendar.events.find((e) => e.id === item.id) : undefined;
          item._title = task?.title || event?.title || item.id;
          item._due = task?.due || "";
          item._priority = task?.priority || event?.priority || "";
          item._status = task?.status || event?.status || "";
          item._category = task?.category || event?.type || "";
        }
      }

      // FEAT046: For planning responses, show concise summary + Focus Tab button
      // instead of the full brief inline. The rich content lives in the Focus tab.
      if (briefJustGenerated) {
        const focusAction: SmartAction = {
          text: "Your day is planned",
          type: "action" as const,
          quickActions: [{ label: "\uD83D\uDCCB Open Focus Tab", payload: "__open_focus__", isDirect: true }],
        };
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: fullReply, // executiveSummary is already concise (4-6 bullets)
            smartActions: [focusAction],
            writeSummary,
            timestamp: nowTimeStr(stateRef.current?.userProfile?.timezone),
          },
        ]);
      } else {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: fullReply,
            suggestions: undefined,
            smartActions: hasItems ? undefined : (allActions.length > 0 ? allActions : undefined),
            items: hasItems ? plan.items : undefined,
            writeSummary,
            isQuestion: plan.needsClarification,
            timestamp: nowTimeStr(stateRef.current?.userProfile?.timezone),
          },
        ]);
      }

      const newTurns: ConversationTurn[] = [
        { role: "user", content: phrase },
        { role: "assistant", content: fullReply },
      ];
      setConversation((c) => [...c, ...newTurns].slice(-(MAX_TURNS * 2)));

      // Flush any remaining dirty keys from summarizer/hotContext rebuilds
      if (s._dirty.size > 0) {
        await flush(s);
      }

      // Deep clone for React re-render — strip non-cloneable fields first
      const pending = s._pendingContext;
      const tempState = { ...s, _dirty: undefined, _pendingContext: undefined } as any;
      const cloned = structuredClone(tempState) as any;
      cloned._dirty = new Set();
      cloned._pendingContext = pending;
      setState(cloned);
    } catch (err: any) {
      console.error("[chat] error:", err?.message ?? err, err);
      const cbStatus = getCircuitBreakerStatus();
      if (cbStatus.open) console.error("[chat] circuit breaker open, last error:", cbStatus.lastError);
      const errorMsg = cbStatus.open
        ? `I've paused to protect your API credits after ${cbStatus.failures} consecutive failures. Will auto-resume in ${cbStatus.cooldownMinutes} minutes, or tap "Resume" to retry now.`
        : "Something went wrong. Please try again.";
      setMessages((m) => [
        ...m,
        { role: "assistant", content: errorMsg, timestamp: now, _circuitBreakerTripped: cbStatus.open },
      ]);
    }

    setLoading(false);
    scrollToBottom();

    // After chat turn, check inbox (deferred — uses setTimeout to let loading clear)
    setTimeout(() => {
      tryProcessInbox();
    }, 500);
  }

  /**
   * Check and process inbox if content exists.
   * Uses the same loading mutex as chat to prevent conflicts.
   */
  async function tryProcessInbox() {
    // Guard: skip if chat is active, another inbox process is running, or circuit breaker is open
    if (loadingRef.current || inboxProcessingRef.current || isCircuitOpen()) {
      return;
    }

    const text = await checkInbox();
    if (!text) {
      setInboxPending(false);
      return;
    }

    // Lock inbox processing
    inboxProcessingRef.current = true;
    setInboxPending(false);
    setThinkingLabel("Processing your inbox...");
    setLoading(true);
    const now = nowTimeStr(stateRef.current?.userProfile?.timezone);

    try {
      // Always use stateRef.current — never a captured parameter
      const currentState = stateRef.current;
      if (!currentState) { setLoading(false); inboxProcessingRef.current = false; return; }

      const result = await processInbox(text, currentState);
      if (result.processed) {
        trackFeaturesUsage(["inbox_used"]).catch(() => {});
        setMessages((m) => [
          ...m,
          { role: "assistant", content: result.reply, timestamp: now },
        ]);
        // Show persistent dismissible banner for inbox outcome
        setInboxResult(result.reply);

        // Re-read stateRef (inbox may have taken a while, state may have updated)
        const s = stateRef.current!;
        const pending = s._pendingContext;
        const tempState = { ...s, _dirty: undefined, _pendingContext: undefined } as any;
        const cloned = structuredClone(tempState) as any;
        cloned._dirty = new Set();
        cloned._pendingContext = pending;
        setState(cloned);
        scrollToBottom();
      }
    } catch (err) {
      console.error("[inbox] processing failed:", err);
    }

    setLoading(false);
    inboxProcessingRef.current = false;
  }

  function loadMoreMessages() {
    const all = fullHistory.current;
    if (all.length === 0) return;
    const currentCount = messages.length;
    const totalAvailable = all.length;
    if (currentCount >= totalAvailable) return; // nothing more to load
    // Load N more from the front of history
    const newCount = Math.min(currentCount + LOAD_MORE_COUNT, totalAvailable);
    const visible = all.slice(totalAvailable - newCount);
    loadedHistoryCount.current = visible.length;
    setMessages(visible);
  }

  const hasMoreHistory = fullHistory.current.length > messages.length;

  function handleNudgeAction(nudge: Nudge, action: any) {
    // Dismiss the nudge
    dismissNudge(nudge.id).catch((err) => console.error("[nudge] dismiss failed:", err));
    setActiveNudges((prev) => prev.filter((n) => n.id !== nudge.id));

    if (action.action === "snooze") return;

    if (action.action === "mark_done" && action.taskId) {
      // Auto-send a completion message
      handleSuggestionTap(`Mark ${action.taskId} as done`, false);
      return;
    }

    if (action.action === "reschedule" && action.taskId) {
      handleSuggestionTap(`Reschedule ${action.taskId} to next week`, true);
      return;
    }

    if (action.action === "delete" && action.taskId) {
      handleSuggestionTap(`Delete task ${action.taskId}`, false);
      return;
    }

    if (action.action === "open_chat" && action.payload) {
      handleSuggestionTap(action.payload, false);
      return;
    }
  }

  // Save chat history whenever messages change
  // Track the count that was loaded from history so we only skip THAT specific set
  // loadedHistoryCount declared near other refs (above initial load effect)
  useEffect(() => {
    // Skip the initial render (empty messages) and the history-load render
    if (loadedHistoryCount.current === -1) {
      loadedHistoryCount.current = 0; // will be set properly by the load effect
      return;
    }
    if (messages.length === loadedHistoryCount.current && loadedHistoryCount.current > 0) {
      // This is the history load render — skip saving but allow future saves
      loadedHistoryCount.current = -2; // mark as consumed
      return;
    }
    if (messages.length > 0) {
      // Merge: older hidden history + current visible messages
      const hiddenCount = fullHistory.current.length - (loadedHistoryCount.current > 0 ? loadedHistoryCount.current : 0);
      const hidden = hiddenCount > 0 ? fullHistory.current.slice(0, hiddenCount) : [];
      const allMessages = [...hidden, ...messages];
      fullHistory.current = allMessages;
      saveChatHistory(allMessages);
      inputHistory.current = allMessages
        .filter((m) => m.role === "user")
        .map((m) => m.content);
    }
  }, [messages]);

  // ─── Loading state ──────────────────────────────────────────────────────

  if (!state) {
    return (
      <View style={[s.center, { backgroundColor: theme.bg }]}>
        <ActivityIndicator size="large" color={theme.accent} />
        <Text style={[s.loadingText, { color: theme.textMuted }]}>Loading your data...</Text>
      </View>
    );
  }

  // ─── Status bar ─────────────────────────────────────────────────────────

  const statusItems = [
    state.hotContext.openTaskCount > 0 && {
      label: `${state.hotContext.openTaskCount} tasks`,
      color: theme.statusDotAccent,
    },
    state.hotContext.overdueCount > 0 && {
      label: `${state.hotContext.overdueCount} overdue`,
      color: theme.statusDotDanger,
    },
    state.hotContext.nextCalendarEvent && {
      label: `Next: ${state.hotContext.nextCalendarEvent.title}`,
      color: theme.statusDotSecondary,
    },
  ].filter(Boolean) as { label: string; color: string }[];

  const userName = state.hotContext.userName || state.userProfile.name || "there";

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <View style={[s.container, { backgroundColor: theme.bg }]}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: theme.border, backgroundColor: theme.bg }]}>
        <View style={s.headerRow}>
          <Text style={[s.headerTitle, { color: theme.text }]}>Chief Clarity</Text>
          <TouchableOpacity onPress={toggleTheme} style={[s.themeToggle, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}>
            <Text style={s.themeToggleText}>
              {theme.mode === "dark" ? "\u2600\ufe0f" : "\u{1F319}"}
            </Text>
          </TouchableOpacity>
        </View>
        {(statusItems.length > 0 || inboxPending) && (
          <View style={s.statusRow}>
            {inboxPending && (
              <View style={[s.statusChip, { backgroundColor: theme.bgSecondary }]}>
                <View style={[s.statusDot, { backgroundColor: "#06b6d4" }]} />
                <Text style={[s.statusChipText, { color: "#06b6d4" }]}>Inbox ready</Text>
              </View>
            )}
            {statusItems.map((item, i) => (
              <View key={i} style={[s.statusChip, { backgroundColor: theme.bgSecondary }]}>
                <View style={[s.statusDot, { backgroundColor: item.color }]} />
                <Text style={[s.statusChipText, { color: theme.textSecondary }]}>{item.label}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Messages */}
      <KeyboardAvoidingView
        style={s.chatArea}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <ScrollView
          ref={scrollRef}
          style={s.messages}
          contentContainerStyle={s.messagesContent}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={onContentSizeChange}
        >
          {/* Load more history */}
          {hasMoreHistory && (
            <TouchableOpacity
              style={[s.loadMoreBtn, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}
              onPress={loadMoreMessages}
            >
              <Text style={[s.loadMoreText, { color: theme.textMuted }]}>
                Load older messages ({fullHistory.current.length - messages.length} more)
              </Text>
            </TouchableOpacity>
          )}


          {messages.length === 0 && (
            <View style={s.emptyState}>
              <View style={[s.avatarCircle, { backgroundColor: theme.accent }]}>
                <Text style={s.avatarText}>CC</Text>
              </View>
              <Text style={[s.emptyTitle, { color: theme.text }]}>Hi {userName}</Text>
              <Text style={[s.emptySubtitle, { color: theme.textMuted }]}>
                What would you like to get done?
              </Text>
              <View style={s.quickActions}>
                {[
                  { label: "Plan my day", icon: "\u2600" },
                  { label: "What's overdue?", icon: "\u23f0" },
                  { label: "Add a task", icon: "\u002b" },
                  { label: "How am I doing?", icon: "\u2728" },
                ].map((action) => (
                  <TouchableOpacity
                    key={action.label}
                    style={[s.quickAction, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}
                    onPress={() => handleSuggestionTap(action.label, false)}
                  >
                    <Text style={s.quickActionIcon}>{action.icon}</Text>
                    <Text style={[s.quickActionText, { color: theme.textSecondary }]}>{action.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {messages.map((msg, i) => (
            <View
              key={i}
              style={[
                s.messageRow,
                msg.role === "user" ? s.messageRowUser : s.messageRowAi,
              ]}
            >
              {msg.role === "assistant" && (
                <View style={[s.aiBadge, { backgroundColor: theme.accent }]}>
                  <Text style={s.aiBadgeText}>CC</Text>
                </View>
              )}
              <View
                style={[
                  s.bubble,
                  msg.role === "user"
                    ? [s.userBubble, { backgroundColor: theme.userBubble }]
                    : [s.aiBubble, { backgroundColor: theme.aiBubble, borderColor: theme.aiBubbleBorder }],
                ]}
              >
                {msg.role === "user" ? (
                  <Text style={[s.bubbleText, { color: theme.userBubbleText }]}>
                    {msg.content}
                  </Text>
                ) : (
                  <MarkdownText theme={theme}>
                    {msg.content}
                  </MarkdownText>
                )}
                {/* Circuit breaker — Resume button (only show if breaker is still open) */}
                {(msg as any)._circuitBreakerTripped && isCircuitOpen() && (
                  <TouchableOpacity
                    style={[s.suggestionChip, { backgroundColor: theme.accent, borderColor: theme.accent, marginTop: 8 }]}
                    onPress={() => {
                      resetCircuitBreaker();
                      setMessages((m) => [
                        ...m,
                        { role: "assistant", content: "AI calls resumed. You can try again now.", timestamp: nowTimeStr(stateRef.current?.userProfile?.timezone) },
                      ]);
                      scrollToBottom();
                    }}
                  >
                    <Text style={[s.suggestionText, { color: "#fff" }]}>Resume</Text>
                  </TouchableOpacity>
                )}

                {/* Write summary — what was done */}
                {msg.writeSummary && msg.writeSummary.length > 0 && (
                  <WriteSummarySection writes={msg.writeSummary} theme={theme} />
                )}

                {/* Structured item list — interactive cards with direct actions */}
                {msg.items && msg.items.length > 0 && state && (
                  <ItemListCard
                    items={msg.items}
                    state={state}
                    theme={theme}
                    onDirectAction={async (actionType, targetId) => {
                      const s = stateRef.current;
                      if (!s) return { success: false, message: "No state" };
                      const result = await executeDirectAction(actionType, targetId, s);
                      if (result.success) {
                        // Re-render: clone state to trigger React update
                        const pending = s._pendingContext;
                        const temp = { ...s, _dirty: undefined, _pendingContext: undefined } as any;
                        const cloned = structuredClone(temp) as any;
                        cloned._dirty = new Set();
                        cloned._pendingContext = pending;
                        setState(cloned);
                      }
                      return result;
                    }}
                  />
                )}

                {/* Smart action cards — type-detected with quick actions */}
                {msg.smartActions && msg.smartActions.length > 0 && (
                  <View style={s.smartActionsRow}>
                    {msg.smartActions.map((action, j) => {
                      const dismissKey = `${i}_${j}`;
                      if (dismissedActions.has(dismissKey)) return null;
                      return (
                      <SmartActionCard
                        key={j}
                        action={action}
                        theme={theme}
                        onAction={async (payload, isDirect, targetId) => {
                          // Dismiss card immediately
                          setDismissedActions((prev) => new Set(prev).add(dismissKey));

                          // Dismiss-only actions
                          if (!payload || payload === "dismiss") return;

                          // FEAT046: Open Focus Tab
                          if (payload === "__open_focus__") {
                            router.push("/(tabs)/focus");
                            return;
                          }

                          // FEAT043 WP-4: Scope clarification — re-triage with user's choice
                          if (payload.startsWith("__scope|")) {
                            const pipeIdx1 = payload.indexOf("|");
                            const pipeIdx2 = payload.indexOf("|", pipeIdx1 + 1);
                            const hint = payload.slice(pipeIdx1 + 1, pipeIdx2);
                            const originalPhrase = payload.slice(pipeIdx2 + 1);
                            const s = stateRef.current;
                            if (s && (s as any)._pendingTriage) {
                              const pendingTriage = (s as any)._pendingTriage as TriageResult;
                              learnScopePreference(pendingTriage.actionType, hint, s);
                              (s as any)._pendingTriage = null;
                            }
                            const refinedPhrase = `${originalPhrase} [scope: ${hint}]`;
                            const now = nowTimeStr(stateRef.current?.userProfile?.timezone);
                            // Show the user's choice as a chat bubble
                            // Derive a readable label from the hint (e.g. "tasks:open" → "Open tasks only")
                            const readableHint = hint.replace(/:/g, " — ").replace(/_/g, " ");
                            setMessages((m: Message[]) => [...m, {
                              role: "user" as const,
                              content: readableHint,
                              timestamp: now,
                            }]);
                            setLoading(true);
                            scrollToBottom();
                            processPhrase(refinedPhrase, now);
                            return;
                          }

                          // Direct executor actions — no LLM, instant
                          if (isDirect && targetId) {
                            const s = stateRef.current;
                            if (s) {
                              const result = await executeDirectAction(payload, targetId, s);
                              if (result.success) {
                                // Show inline confirmation
                                setMessages((m) => [...m, {
                                  role: "assistant",
                                  content: `\u2713 ${result.message}`,
                                  timestamp: nowTimeStr(stateRef.current?.userProfile?.timezone),
                                }]);
                                scrollToBottom();
                              }
                            }
                            return;
                          }

                          // Pre-fill input (Type...)
                          if (payload.endsWith(": ")) {
                            setInput(payload);
                            inputRef.current?.focus();
                            return;
                          }

                          // LLM actions — send to chat
                          handleSuggestionTap(payload, false);
                        }}
                      />
                      );
                    })}
                  </View>
                )}

                {/* Legacy flat suggestions (backward compat for loaded history) */}
                {!msg.smartActions && msg.suggestions && msg.suggestions.length > 0 && (
                  <View style={s.suggestionsRow}>
                    {msg.suggestions.map((sg, j) => {
                      const isQ = /\?$/.test(sg.trim());
                      return (
                        <TouchableOpacity
                          key={j}
                          onPress={() => handleSuggestionTap(sg, isQ)}
                          style={[s.suggestionChip, { backgroundColor: theme.chipBg, borderColor: theme.chipBorder }]}
                        >
                          <Text style={[s.suggestionText, { color: theme.chipText }]}>{sg}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {/* FEAT056: v4 skill badge — shown only when a v4 skill handled this message */}
                {msg.role === "assistant" && msg.v4Meta && (
                  <TouchableOpacity
                    onPress={() => {
                      const meta = msg.v4Meta!;
                      Alert.alert(
                        `via ${meta.skillId}`,
                        `Confidence: ${meta.confidence.toFixed(2)}\nMethod: ${meta.routingMethod}`,
                        [
                          { text: "This didn't help", onPress: () => {
                            // FEAT066 (Phase 6) wires this to the feedback pipeline.
                            // For v2.02, just log a structured entry.
                            console.log(`[chat] feedback: not-useful skill=${meta.skillId} method=${meta.routingMethod}`);
                          }},
                          { text: "OK", style: "cancel" },
                        ]
                      );
                    }}
                  >
                    <Text style={[s.timestamp, { color: theme.textMuted, fontStyle: "italic" }]}>
                      via {msg.v4Meta.skillId}
                    </Text>
                  </TouchableOpacity>
                )}

                <Text style={[s.timestamp, { color: theme.textMuted }]}>{formatTimestamp(msg.timestamp)}</Text>
              </View>
            </View>
          ))}

          {loading && (
            <View style={[s.messageRow, s.messageRowAi]}>
              <View style={[s.aiBadge, { backgroundColor: theme.accent }]}>
                <Text style={s.aiBadgeText}>CC</Text>
              </View>
              <View style={[s.bubble, s.aiBubble, s.loadingBubble, { backgroundColor: theme.aiBubble, borderColor: theme.aiBubbleBorder }]}>
                <View style={s.typingDots}>
                  <View style={[s.dot, s.dot1, { backgroundColor: theme.accent }]} />
                  <View style={[s.dot, s.dot2, { backgroundColor: theme.accent }]} />
                  <View style={[s.dot, s.dot3, { backgroundColor: theme.accent }]} />
                </View>
                <Text style={[s.thinkingText, { color: theme.textMuted }]}>{thinkingMsg}</Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Inbox processing result — pinned above input until dismissed */}
        {inboxResult && (
          <View style={[s.nudgesContainer, { backgroundColor: theme.bg, borderTopColor: theme.border }]}>
            <View style={[s.nudgeCard, {
              backgroundColor: theme.bgSecondary,
              borderColor: theme.accent,
              borderLeftWidth: 3,
            }]}>
              <View style={s.nudgeHeader}>
                <Text style={[s.nudgeMessage, { color: theme.text, flex: 1 }]}>{inboxResult}</Text>
                <TouchableOpacity
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => setInboxResult(null)}
                >
                  <Text style={[s.nudgeClose, { color: theme.textMuted }]}>{"\u2715"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Proactive nudges — pinned above input, always visible */}
        {activeNudges.length > 0 && (
          <View style={[s.nudgesContainer, { backgroundColor: theme.bg, borderTopColor: theme.border }]}>
            {activeNudges.map((nudge) => (
              <View key={nudge.id} style={[s.nudgeCard, {
                backgroundColor: theme.bgSecondary,
                borderColor: nudge.priority === "urgent" ? "#ef4444" : nudge.priority === "important" ? "#f59e0b" : theme.borderLight,
                borderLeftWidth: 3,
              }]}>
                <View style={s.nudgeHeader}>
                  <Text style={[s.nudgeMessage, { color: theme.text, flex: 1 }]}>{nudge.message}</Text>
                  <TouchableOpacity
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={() => {
                      dismissNudge(nudge.id).catch((err) => console.error("[nudge] dismiss failed:", err));
                      setActiveNudges((prev) => prev.filter((n) => n.id !== nudge.id));
                    }}
                  >
                    <Text style={[s.nudgeClose, { color: theme.textMuted }]}>{"\u2715"}</Text>
                  </TouchableOpacity>
                </View>
                {nudge.actions && nudge.actions.length > 0 && (
                  <View style={s.nudgeActions}>
                    {nudge.actions.map((action, j) => (
                      <TouchableOpacity
                        key={j}
                        style={[s.nudgeActionBtn, { backgroundColor: theme.bgTertiary, borderColor: theme.borderLight }]}
                        onPress={() => handleNudgeAction(nudge, action)}
                      >
                        <Text style={[s.nudgeActionText, { color: theme.accent }]}>{action.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Input */}
        <View style={[s.inputContainer, { borderTopColor: theme.border, backgroundColor: theme.bg }]}>
          <View style={[s.inputRow, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder }]}>
            <TextInput
              ref={inputRef}
              style={[s.input, { color: theme.inputText }]}
              value={input}
              onChangeText={setInput}
              placeholder="Message Chief Clarity..."
              placeholderTextColor={theme.placeholder}
              onSubmitEditing={sendPhrase}
              onKeyPress={handleKeyPress}
              returnKeyType="send"
              editable={!loading}
              multiline
              maxLength={2000}
            />
            <TouchableOpacity
              style={[
                s.sendBtn,
                input.trim() && !loading
                  ? { backgroundColor: theme.accent }
                  : { backgroundColor: theme.bgTertiary, opacity: 0.5 },
              ]}
              onPress={sendPhrase}
              disabled={!input.trim() || loading}
            >
              <Text style={s.sendText}>{"\u2191"}</Text>
            </TouchableOpacity>
          </View>
          <Text style={[s.inputHint, { color: theme.textMuted }]}>
            Enter to send{Platform.OS === "web" ? " \u00b7 Shift+Enter for new line \u00b7 \u2191\u2193 history" : ""}
          </Text>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function formatTimestamp(ts: string | undefined): string {
  return formatLocalTime(ts || "");
}

const s = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: { marginTop: 12, fontSize: 14 },

  // Header
  header: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 56 : 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: { fontSize: 18, fontWeight: "700", letterSpacing: -0.3 },
  themeToggle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  themeToggleText: { fontSize: 18 },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 6,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusChipText: { fontSize: 12, fontWeight: "500" },

  // Chat
  chatArea: { flex: 1 },
  messages: { flex: 1 },
  messagesContent: {
    padding: 20,
    paddingBottom: 8,
    ...(Platform.OS === "web" ? { maxWidth: 720, width: "100%", alignSelf: "center" as const } : {}),
  },

  // Empty state
  emptyState: { alignItems: "center", marginTop: 60 },
  avatarCircle: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: "center", justifyContent: "center", marginBottom: 20,
  },
  avatarText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  emptyTitle: { fontSize: 26, fontWeight: "700", marginBottom: 6, letterSpacing: -0.5 },
  emptySubtitle: { fontSize: 16, marginBottom: 36 },
  quickActions: {
    flexDirection: "row", flexWrap: "wrap", justifyContent: "center",
    gap: 10, maxWidth: 400,
  },
  quickAction: {
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12,
    borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 8,
  },
  quickActionIcon: { fontSize: 16 },
  quickActionText: { fontSize: 14, fontWeight: "500" },

  // Message rows
  messageRow: { flexDirection: "row", marginBottom: 16, alignItems: "flex-end", gap: 8 },
  messageRowUser: { justifyContent: "flex-end" },
  messageRowAi: { justifyContent: "flex-start" },
  aiBadge: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center", marginBottom: 2,
  },
  aiBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },

  // Bubbles
  bubble: { maxWidth: "80%", borderRadius: 18, padding: 14, paddingHorizontal: 16 },
  userBubble: { borderBottomRightRadius: 4 },
  aiBubble: { borderBottomLeftRadius: 4, borderWidth: 1 },
  loadingBubble: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 16 },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  thinkingText: { fontSize: 13 },
  timestamp: { fontSize: 11, marginTop: 6, textAlign: "right" },

  // Typing dots
  typingDots: { flexDirection: "row", gap: 4, alignItems: "center" },
  dot: { width: 6, height: 6, borderRadius: 3, opacity: 0.4 },
  dot1: { opacity: 0.8 },
  dot2: { opacity: 0.5 },
  dot3: { opacity: 0.3 },

  // Suggestions — stacked vertically since they're often full sentences
  // Nudges
  // Load more
  // Load more
  loadMoreBtn: { alignSelf: "center", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, borderWidth: 1, marginBottom: 16 },
  loadMoreText: { fontSize: 13, fontWeight: "500" },

  // Nudges
  nudgesContainer: {
    paddingHorizontal: 12, paddingVertical: 8, gap: 8, borderTopWidth: 1,
    ...(Platform.OS === "web" ? { maxWidth: 720, width: "100%", alignSelf: "center" as const } : {}),
  },
  nudgeCard: { borderRadius: 12, padding: 14, borderWidth: 1 },
  nudgeHeader: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  nudgeClose: { fontSize: 16, lineHeight: 20, padding: 2 },
  nudgeMessage: { fontSize: 14, lineHeight: 20, marginBottom: 10 },
  nudgeActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  nudgeActionBtn: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1 },
  nudgeActionText: { fontSize: 13, fontWeight: "600" },

  // Suggestions
  // Smart actions
  smartActionsRow: { marginTop: 6, gap: 4 },

  // Legacy suggestions (backward compat)
  suggestionsRow: { flexDirection: "column", gap: 6, marginTop: 10 },
  suggestionChip: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1 },
  suggestionText: { fontSize: 13, fontWeight: "500", lineHeight: 18 },

  // Input
  inputContainer: {
    borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 32 : 12,
    ...(Platform.OS === "web" ? { maxWidth: 720, width: "100%", alignSelf: "center" as const } : {}),
  },
  inputRow: {
    flexDirection: "row", alignItems: "flex-end",
    borderRadius: 16, borderWidth: 1, paddingHorizontal: 4, paddingVertical: 4,
  },
  input: {
    flex: 1, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, maxHeight: 120,
    ...(Platform.OS === "web" ? { outlineStyle: "none" as any } : {}),
  },
  sendBtn: { borderRadius: 12, width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  sendText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  inputHint: { fontSize: 11, textAlign: "center", marginTop: 6 },
});
