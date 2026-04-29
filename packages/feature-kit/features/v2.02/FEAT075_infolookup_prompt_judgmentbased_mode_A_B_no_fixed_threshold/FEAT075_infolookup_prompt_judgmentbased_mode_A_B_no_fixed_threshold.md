# FEAT075 — info_lookup prompt: judgment-based Mode A/B (no fixed threshold)

**Type:** bug fix
**Status:** Done
**MoSCoW:** MUST
**Category:** Bug Fix
**Priority:** 1
**Release:** v2.02
**Tags:** info_lookup, prompt, rag, calibration
**Created:** 2026-04-29

---

## Summary

After FEAT074, *"tell me about fagner"* retrieves 5 highly relevant chunks (note + calendar event with `topScore = 0.33`), but the assistant's reply opens with the Mode B disclaimer template *"I don't have personal notes about Fagner, but in general:"* — and then proceeds to faithfully cite all five chunks anyway. Self-contradictory.

Root cause: FEAT069 calibrated the dispatcher's `minScore` threshold (0.25) against a real corpus, but `info_lookup`'s prompt still gates Mode A on `topScore >= 0.40` — a number from the original FEAT068 spec, never re-calibrated. Cosine similarity scores on short / proper-noun queries (people's names) reliably land in the 0.25–0.40 band even when the chunks are obviously about the subject. The dispatcher passes those chunks through (they're above `minScore`), and the prompt's rigid threshold lies about not having them.

## Change

Replace the threshold-based Mode A/B trigger with a judgment-based one. The LLM has the chunks in context — it should read them and decide whether they actually address the user's subject:

- **Mode A** triggers when `retrievedKnowledge` is non-empty AND at least one chunk meaningfully addresses the subject. Cite them; skip the disclaimer entirely.
- **Mode B** triggers when chunks are missing OR clearly off-topic (e.g., user asked about person X but chunks are about unrelated person Y). Use the locked disclaimer template + general-knowledge fallback.

The locked disclaimer substring (`"I don't have personal notes about"`) is preserved verbatim for Mode B, so smoke tests grepping for it still pass when the path actually fires.

## Why judgment over threshold

Embedding cosine similarity is noisy in two predictable ways:
1. **Short queries.** "Fagner" produces a sparse vector that doesn't correlate strongly with longer chunks even when they're directly about Fagner.
2. **Proper nouns.** MiniLM's training data underweights specific names; chunks scoring 0.25–0.40 for "Fagner" would score 0.55+ for "the project meeting".

A hard threshold can't distinguish "weak match because the embedding is noisy" from "weak match because the chunks are off-topic". The LLM reading the chunks can.

## Out of scope

- The `Unexpected text node: . A text node cannot be a child of a <View>` React-Native-Web warning. Cosmetic; predates this branch's work; needs a runtime React Profiler to find the actual offending element. Tracked separately.
- Re-calibrating `retrievalHook.minScoreInclude` numerically. The number is now informational rather than load-bearing — kept in the manifest for future use but no longer drives the prompt path.

## Files

| File | Change |
|------|--------|
| `src/skills/info_lookup/prompt.md` | Rewrite Mode A/B trigger conditions to be judgment-based; expand citation examples to cover `event` chunks (FEAT072). |
| `src/skills/_generated/skillBundle.ts` | Auto-regenerated. |

Tests: 505/505 passing (no test changes — the locked disclaimer substring is unchanged so smoke tests still pass).
