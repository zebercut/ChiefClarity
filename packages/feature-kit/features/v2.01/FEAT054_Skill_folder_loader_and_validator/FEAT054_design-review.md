# FEAT054 — Design Review

**Reviewer:** Architect agent (per `ADLC/agents/architect-agent.md`)
**Date:** 2026-04-27
**Spec:** `FEAT054_Skill_folder_loader_and_validator.md`
**Architecture refs:** `docs/v4/02_skill_registry.md`, `docs/v4/11_v2_design_review.md §2 Phase 1`

This design review goes beyond the in-spec Architecture Notes. It covers
alternatives considered, cross-feature concerns, deeper rationale, and the
flags the Coder needs to watch.

---

## 1. Verdict

**APPROVED for implementation** subject to §6 conditions.

The spec is well-scoped and the architecture follows `02_skill_registry.md`
with one resolved trade-off (sequential vs. parallel loading — see §3.2). No
blocking issues.

---

## 2. Architecture summary (one screen)

```
                       ┌──────────────────────────┐
                       │   loadSkillRegistry()    │
                       └────────────┬─────────────┘
                                    │
                ┌───────────────────┼───────────────────┐
                ▼                   ▼                   ▼
        scan src/skills/    load .embedding_cache    boot report (opt)
                │             (mtime check)
                ▼
        for each folder (sequential):
          1. Parse manifest.json   ──────► JSON Schema validate
          2. Read prompt.md         ──────► Locked-zone parser
                                           Hash each zone (SHA-256)
                                           Validate manifest.promptLockedZones
                                           against discovered zones
          3. Validate surface       ──────► Reserved-route check
          4. Dynamic import context.ts
          5. Dynamic import handlers.ts ──► Verify exports match manifest.tools
          6. Embed manifest.description ─► Cache hit? skip. Else compute.
          7. Validate dataSchemas read/write ► Categories must exist (FEAT055
                                                wires this in v2.03; for v2.01
                                                accept any string and warn)
          8. Register in in-memory map
                │
                ▼
       ┌────────────────────┐
       │  SkillRegistry API │  getSkill / getAllSkills /
       │                    │  findSkillsByEmbedding / getAllSurfaces
       └────────────────────┘
```

**One pass, one boot report, no hot-reload.** The orchestrator (FEAT051) and
the app shell consume the registry; neither writes to it.

---

## 3. Alternatives considered

### 3.1 Sequential vs. parallel skill loading (Open Question 3)

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Sequential | Simple error handling, deterministic boot order, easier to read logs, easier to instrument boot report | Slightly slower (~50–100ms for 20 skills with warm cache; ~1s with cold cache on mobile) | **CHOSEN for v2.01** |
| `Promise.all` parallel | Faster cold boot | Race conditions in cache write, harder to attribute errors, log interleaving harms debugging, only meaningful gain when uncached | Reject for v2.01; revisit if cold-boot becomes a real complaint after FEAT044 mobile lands |
| Parallel with limit (e.g., `p-limit`) | Some speed-up, bounded concurrency | New dependency for marginal benefit at this skill count | Reject |

The 200ms warm-boot target is achievable sequentially because cache hits skip
the embedding step entirely. Cold boot is a one-time cost after manifest
edits.

### 3.2 Embedding cache location (Open Question 1)

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| `src/skills/.embedding_cache.json` | Co-located with skills, simple mtime checks, gitignore is one line | Some folks prefer separation of generated artifacts | **CHOSEN** — co-location wins on simplicity |
| `data/.skill_cache.json` | Separated from source | Extra path resolution, harder to nuke when skills change | Reject |
| OS temp dir | Truly ephemeral | Cold boot every restart on some platforms; defeats the purpose | Reject |

### 3.3 Manifest validation library

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Hand-rolled validator | Zero dependency, < 100 LOC, perfectly tailored | Slightly more boilerplate per field | **CHOSEN for v2.01** — small and complete |
| `ajv` (JSON Schema) | Industry standard | New dependency, schema-as-data overhead, error messages need formatting layer | Reject for now; revisit if schema grows past 30 fields |
| `zod` (already in project? — to verify) | Type-safe | New dependency if not present; inverts validation flow | Reject unless already present |

### 3.4 Locked-zone format

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| HTML comments `<!-- LOCKED:name -->...<!-- /LOCKED -->` | Survives any markdown renderer, distinct from prose, easy to grep | Verbose; nested zones forbidden by regex | **CHOSEN per `02 §9`** |
| Triple-backtick fenced blocks with language tag | Renders nicely in viewers | Editing tools may inject whitespace; harder to enforce immutability | Reject |
| YAML front-matter section | Structured | Splits the prompt into two parts; readability suffers | Reject |

---

## 4. Cross-feature concerns

### 4.1 Hard upstream dependency: none (this is the foundation)

FEAT054 has no v4 prerequisites. It depends on existing infrastructure only
(embeddings stack FEAT042, filesystem utils, types).

### 4.2 Hard downstream consumers (will break if FEAT054 changes)

| FEAT | How it depends |
|---|---|
| FEAT051 (rescoped Orchestrator) | Calls `findSkillsByEmbedding` |
| FEAT079 (POC priority_planning) | First skill that lives in `src/skills/` |
| FEAT080, FEAT081 (skill migrations) | Every migrated intent becomes a skill folder |
| FEAT083 (topics skill) | First skill that uses the `surface` field |
| FEAT072 (companion skill) | First skill that uses `promptLockedZones` and `model` as object |
| FEAT054 itself shapes the contract for all future skills |

**Implication:** the `SkillManifest` interface is a stability contract. Any
breaking change after Phase 2 ships will require a deprecation cycle. The
Coder must treat the interface as public API.

### 4.3 Soft downstream coupling

- **FEAT055 (Data Schema Registry):** `manifest.dataSchemas.read/write` will
  reference categories defined there. For v2.01, we validate the field shape
  but **do not validate the category names** (the registry doesn't exist
  yet). When FEAT055 ships, the loader gains category-existence validation
  and any pre-existing skill with an unknown category gets a warning.
- **FEAT058 (Locked-zone enforcement):** the loader's locked-zone parsing
  produces hash data that FEAT058 will use for the auto-improvement-loop
  elision. The hash format is fixed in this FEAT — must match what FEAT058
  expects. Coder: hash is `sha256(zoneContent)` hex digest; document it.
- **FEAT070 (self-test on patch approval):** post-apply scan re-validates
  zones against the same hash. Same format requirement.

### 4.4 Coexistence with v3 router during dual-path period

During FEAT079 → FEAT081, both the legacy `router.ts` regex path and the new
skill-routing path run in parallel behind `V4_SKILLS_ENABLED` flag. The skill
registry must boot regardless of whether any skill is enabled in the flag.
The flag is a routing concern (FEAT051), not a registry concern.

---

## 5. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `SkillManifest` interface needs a breaking change after consumers ship | Medium | High | Treat as public API; reviewer rejects breaking PRs without a migration note. Add to AGENTS.md after first occurrence. |
| Cache file gets corrupted (partial write) and skills fail to load | Low | Medium | Write cache via `filesystem.ts` atomic temp-then-rename pattern; on parse failure, rebuild silently |
| `RESERVED_ROUTES` constant drifts from actual shell routes | Medium | Medium | Add a CI grep check in a follow-up FEAT (track in `09_dev_plan.md`); for v2.01, manually audit after each shell-route change |
| Sequential boot becomes too slow on mobile (FEAT044) with 15+ skills | Low | Medium | Measure during FEAT044 testing; switch to parallel only if measured > 500ms warm boot |
| Locked-zone hash mismatch breaks FEAT058/FEAT070 | Low | High | Pin the hash format (`sha256` hex of inner content, no leading/trailing whitespace trim) in this FEAT's tests; document in skill registry types file |
| Two skills with the same id: alphabetical ordering means renaming a folder silently changes which one wins | Low | Medium | Reject duplicates with a warning that names BOTH folders so the developer notices |
| Dynamic import of `handlers.ts` fails at runtime in Capacitor (Metro bundler quirks) | Medium | High | Coder must verify dynamic import works in Capacitor build during FEAT054 dev (not wait for FEAT044); fix Metro config if needed |

---

## 6. Conditions before code-review approval

These are non-negotiable gates the Coder must hit before the Code Reviewer
agent can approve:

1. **All ACs from the spec are testable and tested** (§Testing in spec).
2. **Manifest interface is exported from `src/types/skills.ts`** and imported
   everywhere (no inline `any`).
3. **Cache file added to `.gitignore`.**
4. **Boot report fields match `SkillBootReport` interface exactly.** Tests
   assert this.
5. **Locked-zone hash format documented** in a code comment at the parsing
   site (the only acceptable comment per project style — it is a non-obvious
   contract with FEAT058/FEAT070).
6. **No `process.env` reads in this FEAT** (per `AGENTS.md` Coding rule
   pre-FEAT035 — even though FEAT035 hasn't shipped, don't add new
   violations).
7. **Capacitor smoke test:** verify dynamic import of `handlers.ts` works in
   a `npx cap sync` build, even though FEAT044 mobile is on hold. This is a
   feasibility check, not a full mobile feature.
8. **One migration per PR rule applies:** if this FEAT touches anything
   beyond `src/skills/`, `src/modules/skillRegistry.ts`, `src/types/skills.ts`,
   `app/_layout.tsx` (for nav), `.gitignore` — the PR is split.

---

## 7. UX review

UX scope is small and the spec's UX section captures it. Two architect-side
notes for the Coder:

- The dynamic surface tabs render **after** the static shell tabs. If a skill's
  `order: 50` and a static tab's implicit order is 100, the skill tab still
  appears after the static ones (because the static rendering happens
  synchronously during initial mount; surfaces append after async resolve).
  This is intentional — static UX is stable; dynamic UX joins.
- Icon: the `surface.icon` field references the existing icon set. If the
  Coder finds that the icon set is not extensible (e.g., hardcoded set of
  names), flag it back to the Architect before proceeding — this would be a
  scope-stretching UX gap.

No conflicts with the architecture.

---

## 8. Test strategy review

Spec's Testing Notes are correct and sufficient. Adding two strategic notes:

1. **Test fixture skills live in `src/skills/_examples/`** (underscore prefix
   means production loader skips them). Tests pass `skillsDir` override to
   load only fixtures. This avoids polluting production registry with test
   data and makes the tests independent of whatever real skills exist when
   they run.
2. **Routing accuracy regression set** (50 phrases, target ≥85% top-1, per
   `11 §5 Phase 1`) is **NOT** part of this FEAT. It belongs to FEAT051
   (Orchestrator). FEAT054 ships when the registry API works; FEAT051 ships
   when routing accuracy is proven. Coder should not block FEAT054 on the
   regression set.

---

## 9. Pattern Learning — additions to AGENTS.md

After implementation completes, the Code Reviewer agent should propagate any
new patterns learned (e.g., dynamic-import gotchas in Capacitor, cache
robustness patterns) back to `AGENTS.md`. No predictive additions in this
review — wait for evidence.

---

## 10. Sign-off

Architect approves the spec for implementation. Conditions in §6 are binding
for code review. Coder may proceed.

The Coder agent next implements FEAT054. After implementation, the Code
Reviewer agent does the review (with authority to fix per workflow stage 6).
After code review, the Tester agent writes and runs test cases (workflow
stage 7).
