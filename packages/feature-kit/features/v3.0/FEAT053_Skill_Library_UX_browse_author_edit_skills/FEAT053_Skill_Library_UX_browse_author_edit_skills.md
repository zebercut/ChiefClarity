# FEAT053 — Skill Library UX (browse, author, edit skills)

**Type:** feature
**Status:** Planned
**MoSCoW:** SHOULD
**Category:** UX
**Priority:** 2
**Release:** v3.0
**Tags:** skills, ux, settings, authoring, library

**Depends on:** FEAT050 (Skill Runtime), FEAT051 (Skill Router and Composer)

**Created:** 2026-04-23

---

## Summary

The user-facing surface for skills. Three things: (1) **browse and manage** installed skills in a library view, (2) **save a proposed skill** after FEAT051 synthesised one for a turn, (3) **author a new skill from scratch** via a guided chat flow. All three operate on the JSON + markdown skill files from FEAT050 — no code, no dev involvement. Skills are visible, editable, disable-able, and deletable. The library is where the open-ended system becomes visible to the user.

---

## Problem Statement

FEAT050 makes skills data. FEAT051 lets the system compose a skill on demand. Without this FEAT, those capabilities are invisible: the user cannot see what skills they have, cannot accept the system's proposals, cannot tune a persona that keeps answering in a style they dislike, and cannot ask the system to learn a new skill explicitly.

Without a library UX the architecture becomes an internal developer tool, not a user product. The value of "skills as data" is only realised if the user can read and write that data.

---

## Goals

1. Give the user a clear, scannable view of every skill installed on their device.
2. Let the user save, discard, or edit a skill proposed at turn time (the output of FEAT051 Story 3).
3. Let the user author a new skill from scratch via a chat-guided flow ("teach me a new skill").
4. Let the user disable or delete skills they do not want.
5. Never expose raw JSON unless the user opts into an advanced editor — authoring happens through plain language and a small set of structured picks.

---

## Success Metrics

- The user can install a new skill end-to-end via chat in under 3 minutes.
- Proposed-skill acceptance rate is measurable (log event); target ≥ 30% of proposals accepted in QA.
- Zero TypeScript changes needed to add or edit a skill after shipping.
- The library view lists every installed skill with name, description, status (enabled / disabled), and last-used date, on both desktop and mobile.
- A user who has never seen the underlying JSON can still author, edit, disable, and delete skills.

---

## User Stories

### Story 1 — Browse installed skills

**As a** user, **I want** to see all my installed skills in one place, **so that** I know what the assistant can do.

**Acceptance Criteria:**
- [ ] The Settings panel (FEAT035) has a "Skills" section listing every installed skill with: name, one-line description, model preference (Light/Heavy badge), enabled state, last-used date.
- [ ] Tapping a skill opens a detail view showing: full description, persona preview, data sources it reads, output shape, example prompts it answers, last 5 uses (timestamp + first line of the user phrase, truncated).
- [ ] The list is scrollable and searchable; on mobile the layout adapts.
- [ ] Built-in seed skills carry a "Built-in" tag; user-created skills carry a "Custom" tag; accepted proposals carry a "Learned" tag.

### Story 2 — Save a proposed skill from chat

**As a** user who just got a useful answer from a skill the system proposed, **I want** to save that skill so the next similar question uses it automatically, **so that** the system gets smarter with me.

**Acceptance Criteria:**
- [ ] When FEAT051 returned a `proposedSkill` and executed it for the turn, the assistant message footer shows: *"Handled as a new skill: '{name}'. Save for next time?"* with actions **Save**, **Edit**, **Discard**.
- [ ] **Save** writes the manifest + persona to the skills directory and shows a confirmation ("Saved as '{name}'. I'll use it for similar questions.").
- [ ] **Edit** opens a guided editor (Story 3) pre-filled with the proposed values.
- [ ] **Discard** closes the prompt without saving.
- [ ] Not making a choice leaves the turn's result intact but does not save. The next similar phrase may re-propose, possibly with slightly different wording.
- [ ] Saved skills appear in the library (Story 1) immediately.

### Story 3 — Author a new skill from scratch

**As a** user, **I want** to describe a new skill in my own words and have the system turn it into a usable skill, **so that** I do not need to write JSON or understand prompts.

**Acceptance Criteria:**
- [ ] A "New skill" button on the Skills settings view opens a chat-guided authoring flow.
- [ ] The flow asks, in plain language: *What should this skill help you with? How should it answer? What kinds of data should it look at?*
- [ ] The system offers multiple-choice picks for: output shape (with human labels like "Gives a recommendation with reasoning", "Produces a plan", "Creates/updates tasks and events", "Free-form chat"), data sources (with human labels: "My tasks", "My calendar", "My OKRs", "My notes and facts", "My projects", etc.), model preference (labelled "Fast" / "Thoughtful", mapping to light/heavy).
- [ ] At the end the user sees a preview: the generated persona text + declared data sources + example prompts. The user can tweak the persona in a text area before saving.
- [ ] **Save** writes the skill to the skills directory. **Cancel** discards without writing.
- [ ] The authoring flow produces a valid manifest; invalid configurations are either prevented by the UI or flagged before save.

### Story 4 — Edit an installed skill

**As a** user, **I want** to change a skill's persona or data sources after using it for a while, **so that** I can tune it to my preferences.

**Acceptance Criteria:**
- [ ] The skill detail view has an **Edit** button.
- [ ] The editor lets the user change: name, description, persona text, data sources (from the declared menu), output shape, model preference, example prompts.
- [ ] The editor does NOT allow editing core skill ID once created (renaming is allowed; ID stays stable).
- [ ] Built-in seed skills are editable; changes are saved as an override file (`skill.override.json`) that takes precedence over the shipped seed. The seed can be restored via a "Reset to default" action.
- [ ] Changes take effect on the next turn (skill reloaded on save).
- [ ] An advanced "View JSON" toggle reveals the raw manifest for users who want it; this is off by default.

### Story 5 — Disable or delete a skill

**As a** user, **I want** to stop a skill from being used without deleting it outright, **so that** I can try it again later.

**Acceptance Criteria:**
- [ ] Each skill has a toggle: Enabled / Disabled.
- [ ] A disabled skill is not passed to the router; the router cannot pick it.
- [ ] A disabled skill still appears in the library with a greyed-out badge.
- [ ] Delete is a separate, confirmed action: warns that deleting is permanent (except for built-ins, which are restored to default, not deleted).
- [ ] Deleting a skill that was recently used does not delete the past chat messages it produced.

### Story 6 — Explain why a skill was (or was not) used

**As a** user, **I want** to understand why a particular skill answered a question, **so that** I can correct misrouting.

**Acceptance Criteria:**
- [ ] Every assistant message has a small footer showing the skill name (already introduced by FEAT051 Story 6).
- [ ] Tapping the skill name shows a short explanation: *"Picked because your message matches this skill's examples: {2-3 examples}."*
- [ ] The explanation view also offers **Use a different skill** — reruns the turn routed to a user-picked skill from the library.
- [ ] The explanation view offers **Improve this skill** — opens the editor prefilled, with the current phrase auto-added to `match.examples` as a suggested addition.

### Story 7 — Safe defaults and guardrails

**As a** user, **I want** the system to protect me from accidentally breaking it, **so that** experimenting with skills is low-risk.

**Acceptance Criteria:**
- [ ] Disabling every skill at once is blocked; `general_assistant` cannot be disabled (only hidden or renamed).
- [ ] Deleting a Built-in skill only restores it to default instead of removing the file.
- [ ] Creating a skill with an empty persona or no data sources is blocked at save time with a friendly error.
- [ ] A skill author cannot grant the skill access to data sources outside the declared menu — the picker only lists the menu.
- [ ] A preview of the assembled system prompt is shown before first save, so the user sees what the LLM will actually see.

### Story 8 — Skill suggestions from usage patterns

**As a** user, **I want** the system to notice I keep asking a certain kind of question and offer to save a skill for it, **so that** the library grows passively.

**Acceptance Criteria:**
- [ ] When FEAT051 has produced the same or similar proposed skill three times in a rolling window (e.g., 7 days), the system surfaces a suggestion in the library: *"You've asked {N} finance-style questions. Save a 'Financial Questions' skill?"*
- [ ] The suggestion shows the consolidated persona + data sources the system would save.
- [ ] The user accepts, edits, or dismisses the suggestion. Dismissed suggestions for the same cluster do not resurface for 30 days.

---

## Workflow

```
Browse flow
  Settings → Skills → list view → tap skill → detail view → Edit / Disable / Delete

Save-from-chat flow
  Turn completes with proposal → message footer → Save | Edit | Discard
     Save  → write to skills/ → confirm in chat
     Edit  → open editor prefilled → Save on confirm
     Discard → close

Authoring flow
  Settings → Skills → New Skill
     → "What should this skill help you with?" (free text)
     → "How should it answer?" (multi-choice of output shapes)
     → "What should it look at?" (multi-select of data sources)
     → "Fast or thoughtful?" (model preference)
     → Preview: persona + data + examples
     → Edit persona freely (text area)
     → Save | Cancel

Suggestion flow
  Pattern detector sees 3+ similar proposals → surfaces suggestion in library
     User accepts → same save path as Story 2
     User dismisses → suppressed for 30 days
```

---

## Edge Cases

| Scenario | Expected Behavior |
|---|---|
| User disables every non-default skill | Allowed. `general_assistant` handles everything. |
| User disables `general_assistant` | Blocked with a friendly message; it is the fallback. |
| User creates a skill with a name that collides | UI suggests a suffix ("... 2"). Never silently overwrite. |
| User edits a seed skill, then uninstalls the app and reinstalls | Seed restored to default. Override file is gone with the uninstall (local only). |
| Proposed skill offered, user does nothing, window closes | Not saved. Next similar request may re-propose. Logged. |
| Saved skill conflicts with an incoming app update that changes the seed | App update does not overwrite user skills or overrides. Seed changes only affect unmodified seed files. |
| Many skills (50+) | Library is searchable and paginated; router fast-path handles cache-hit scale. |
| Skill edited into an unusable state (empty persona) | Save blocked before persisting; skill stays in its previous valid state. |
| User disables a skill currently cached by FEAT052 | Next turn cannot pick that skill; cache entries keyed to that skill age out via LRU. |

---

## Out of Scope

- Sharing skills across devices, users, or a marketplace.
- Version control / history of skill edits (undo last edit only, not full history).
- Importing community skill packs.
- Skill templates or wizards beyond the authoring flow described.
- Cross-skill dependency declarations.
- Per-skill analytics dashboards beyond "last used" and count.

---

## Architecture Notes

*To be filled by Architect Agent.*

### Signals for the Architect

- The library reads and writes directly to the skills directory defined by FEAT050. No new storage.
- Seed overrides use a `skill.override.json` alongside the seed's `manifest.json`. The runtime merges override > seed at load time.
- The authoring flow produces a `SkillManifest` + persona string; reuses FEAT050 validation.
- The guided authoring UI should not special-case skills in TypeScript — every choice maps to a declared option in the menu/library.

### Integration points

| Module | Change |
|---|---|
| `src/modules/skills/runtime.ts` | Support override file resolution (merge override onto seed). |
| `src/modules/skills/authoringFlow.ts` | New. Pure-function state machine for the chat-guided author flow. |
| `src/modules/skills/suggestions.ts` | New. Pattern detector over accumulated proposals (FEAT051 log events). |
| `app/settings/skills/` | New screens: Library, Detail, Editor, New Skill, Explanation. |
| `app/(tabs)/chat.tsx` | Render proposal footer (Save/Edit/Discard). Render skill badge + tap → explanation. |
| `src/types/index.ts` | Add `SkillOverride`, `SkillUsageLog`. |

---

## Implementation Notes

| File | Change |
|---|---|
| `app/settings/skills/LibraryScreen.tsx` | Skills list. |
| `app/settings/skills/DetailScreen.tsx` | Skill detail. |
| `app/settings/skills/EditorScreen.tsx` | Guided editor. |
| `app/settings/skills/NewSkillFlow.tsx` | Authoring wizard. |
| `app/settings/skills/ExplanationSheet.tsx` | "Why this skill" sheet. |
| `src/modules/skills/authoringFlow.ts` | State machine for authoring. |
| `src/modules/skills/suggestions.ts` | Pattern detector. |
| `src/modules/skills/runtime.ts` | Override merge. |
| `src/modules/skills/usageLog.ts` | New. Append-only log of skill invocations for Last Used and detail view. |
| `docs/new_architecture_typescript.md` | Skills chapter: UX + file layout (override files, usage log). |
| `README.md` | Add Skills user-facing section. |

---

## Testing Notes

- [ ] Unit: authoring flow produces a valid manifest for every path.
- [ ] Unit: override merge (override overrides seed fields; missing override fields fall back to seed).
- [ ] Unit: suggestion detector fires after 3 similar proposals in the window.
- [ ] Integration: full author flow → save → next matching phrase uses the new skill.
- [ ] Integration: save-from-chat flow from a FEAT051 proposal → appears in library.
- [ ] Integration: disable a skill → router no longer picks it → re-enabling makes it pickable again.
- [ ] Integration: edit a seed skill → `skill.override.json` written; Reset to default removes the override.
- [ ] Regression: legacy intent-style flows continue to work throughout (via seed skills).
- [ ] Manual UX: full new-skill flow on mobile (Capacitor) and desktop.

---

## Assumptions & Open Questions

- **Assumption:** Plain-language multi-choice authoring is sufficient for 80%+ of user-authored skills. The advanced JSON editor covers the rest.
- **Assumption:** Users want to curate a small library (5-15 skills) rather than accumulate hundreds. The suggestion flow is conservative (3+ similar proposals before surfacing).
- **Open question:** Should the authoring flow be a modal wizard or a dedicated chat turn with the assistant as a guide? Recommendation: modal wizard on mobile for tight control; optionally a chat-driven path later.
- **Open question:** Should accepted proposals be editable immediately (suggesting a tweak to the auto-generated persona) or must they be used first? Recommendation: allow edit-at-save via the **Edit** action already in Story 2.
- **Open question:** How prominent should the explanation sheet be? Discovered by tap only, or hinted during first use? Recommendation: first-use hint, then discoverable.
- **Open question:** Do we surface skill usage counts/last-used times privacy-safely? They live in the usage log; the log is local only.

---

## UX Notes

Detailed UX design to follow via UX review. Minimum visual principles:

- Skill badges in chat are small, unobtrusive, and tappable. Never a modal pop-up.
- The authoring wizard uses plain language; JSON is hidden behind an advanced toggle.
- The library visually groups Built-in / Custom / Learned for quick scanning.
- Destructive actions (delete custom skill, reset seed to default) require a single confirm; disable is one-tap.
- Suggestions from usage patterns are surfaced in the library only, never as intrusive toasts.
