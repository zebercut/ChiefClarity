/**
 * FEAT071 — Projector registry tests.
 *
 * Run with:  npx ts-node --transpile-only src/modules/projectorRegistry.test.ts
 *       or:  npm test
 *
 * Covers:
 *   - register / getProjector / getAllProjectors round-trip
 *   - schema collision: first registration wins, duplicate logs a warn
 *   - notes_capture and inbox_triage projectors produce expected sourceIds
 *   - writeHook calls indexer with projector output (add/update path)
 *   - writeHook calls deindexer (delete path)
 *   - writeHook is a no-op when no projector is registered for fileKey
 */

import * as assert from "assert";
import {
  registerProjector,
  getProjector,
  getAllProjectors,
  _resetProjectorRegistryForTests,
} from "./rag/projectorRegistry";
import type { RagProjector } from "../types/rag";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log("  ✓", name);
    passed++;
  } catch (e: any) {
    console.error("  ✗", name);
    console.error("   ", e?.message ?? e);
    failed++;
  }
}

function section(name: string): void {
  console.log("\n  ── " + name + " ──");
}

function makeProjector(schema: string, source: string): RagProjector {
  return {
    schema,
    source: source as any,
    iterate: () => [],
    project: () => null,
  };
}

async function run(): Promise<void> {
  console.log("FEAT071 — Projector Registry\n");

  section("registration and lookup");

  await test("register + getProjector round-trip", () => {
    _resetProjectorRegistryForTests();
    const p = makeProjector("notes", "note");
    registerProjector(p);
    assert.strictEqual(getProjector("notes"), p);
    assert.strictEqual(getProjector("nonexistent"), null);
  });

  await test("getAllProjectors returns every registered projector", () => {
    _resetProjectorRegistryForTests();
    const a = makeProjector("notes", "note");
    const b = makeProjector("calendar", "event");
    registerProjector(a);
    registerProjector(b);
    const all = getAllProjectors();
    assert.strictEqual(all.length, 2);
    assert.ok(all.includes(a));
    assert.ok(all.includes(b));
  });

  await test("first registration wins on schema collision", () => {
    _resetProjectorRegistryForTests();
    const first = makeProjector("notes", "note");
    const second = makeProjector("notes", "fact"); // different source — should be ignored
    registerProjector(first);
    // Capture warn output so the collision branch is exercised quietly.
    const origWarn = console.warn;
    let warned = false;
    console.warn = () => { warned = true; };
    try {
      registerProjector(second);
    } finally {
      console.warn = origWarn;
    }
    assert.strictEqual(getProjector("notes"), first);
    assert.strictEqual(warned, true, "collision must log a warn");
  });

  await test("re-registering the SAME projector instance is a no-op (no warn)", () => {
    _resetProjectorRegistryForTests();
    const p = makeProjector("notes", "note");
    registerProjector(p);
    const origWarn = console.warn;
    let warned = false;
    console.warn = () => { warned = true; };
    try {
      registerProjector(p);
    } finally {
      console.warn = origWarn;
    }
    assert.strictEqual(warned, false, "same-instance re-register must NOT warn");
  });

  section("ship'd projectors — notes_capture");

  await test("notes_capture projector exposes the right schema and source", async () => {
    const { projector } = await import("../skills/notes_capture/projector");
    assert.strictEqual(projector.schema, "notes");
    assert.strictEqual(projector.source, "note");
  });

  await test("notes_capture projector iterates state.notes.notes and projects by id", async () => {
    const { projector } = await import("../skills/notes_capture/projector");
    const fakeState = {
      notes: {
        notes: [
          { id: "n1", text: "first note text" },
          { id: "n2", text: "second note text" },
          { id: "n3", text: "x" }, // too short — must be skipped by project
          { id: "", text: "no id" }, // missing id — skipped
        ],
      },
    };
    const items = Array.from(projector.iterate(fakeState));
    assert.strictEqual(items.length, 4);

    const projected = items.map((it) => projector.project(it));
    assert.deepStrictEqual(projected[0], { sourceId: "n1", text: "first note text" });
    assert.deepStrictEqual(projected[1], { sourceId: "n2", text: "second note text" });
    assert.strictEqual(projected[2], null, "too-short text must project to null");
    assert.strictEqual(projected[3], null, "missing id must project to null");
  });

  section("ship'd projectors — calendar_management (FEAT072)");

  await test("calendar projector exposes schema=calendar source=event", async () => {
    const { projector } = await import("../skills/calendar_management/projector");
    assert.strictEqual(projector.schema, "calendar");
    assert.strictEqual(projector.source, "event");
  });

  await test("calendar projector iterates state.calendar.events", async () => {
    const { projector } = await import("../skills/calendar_management/projector");
    const fakeState = {
      calendar: {
        events: [
          { id: "e1", title: "A" },
          { id: "e2", title: "B" },
        ],
      },
    };
    const items = Array.from(projector.iterate(fakeState));
    assert.strictEqual(items.length, 2);
  });

  await test("calendar projector skips only missing-id / missing-title events", async () => {
    const { projector } = await import("../skills/calendar_management/projector");
    // FEAT073: archived and cancelled events ARE indexed now (dropped the
    // skip filters). Only true identity gaps cause project() to return null.
    assert.strictEqual(
      projector.project({ id: "", title: "Standup", status: "scheduled" } as any),
      null
    );
    assert.strictEqual(
      projector.project({ id: "e4", title: "", status: "scheduled" } as any),
      null
    );
  });

  await test("calendar projector indexes archived events with archived:true in metadata", async () => {
    const { projector } = await import("../skills/calendar_management/projector");
    const out = projector.project({
      id: "old1",
      title: "Old meeting with Contact A",
      datetime: "2025-01-15T15:00:00",
      durationMinutes: 30,
      status: "scheduled",
      notes: "",
      archived: true,
    } as any);
    assert.ok(out, "archived events must NOT be skipped (FEAT073)");
    assert.strictEqual(out!.sourceId, "old1");
    assert.strictEqual(out!.metadata!.archived, true);
  });

  await test("calendar projector indexes cancelled events with status in metadata", async () => {
    const { projector } = await import("../skills/calendar_management/projector");
    const out = projector.project({
      id: "cx1",
      title: "Cancelled sync",
      datetime: "2026-03-01T10:00:00",
      durationMinutes: 30,
      status: "cancelled",
      notes: "",
    } as any);
    assert.ok(out, "cancelled events must NOT be skipped (FEAT073)");
    assert.strictEqual(out!.metadata!.status, "cancelled");
  });

  await test("calendar projector composes title + notes and carries metadata", async () => {
    const { projector } = await import("../skills/calendar_management/projector");
    const out = projector.project({
      id: "e1",
      title: "Sync with Contact A",
      datetime: "2026-04-15T15:00:00",
      durationMinutes: 30,
      status: "scheduled",
      notes: "discuss Project X status",
      isRecurringInstance: false,
    } as any);
    assert.ok(out);
    assert.strictEqual(out!.sourceId, "e1");
    assert.strictEqual(out!.text, "Sync with Contact A — discuss Project X status");
    assert.deepStrictEqual(out!.metadata, {
      datetime: "2026-04-15T15:00:00",
      durationMinutes: 30,
      status: "scheduled",
      archived: false,
      isRecurringInstance: false,
    });
  });

  await test("calendar projector handles events with no notes", async () => {
    const { projector } = await import("../skills/calendar_management/projector");
    const out = projector.project({
      id: "e2",
      title: "Quick check-in",
      datetime: "2026-04-15T10:00:00",
      durationMinutes: 15,
      status: "scheduled",
      notes: "",
    } as any);
    assert.ok(out);
    assert.strictEqual(out!.text, "Quick check-in");
  });

  await test("calendar projector flags isRecurringInstance in metadata", async () => {
    const { projector } = await import("../skills/calendar_management/projector");
    const out = projector.project({
      id: "e3",
      title: "Weekly Class",
      datetime: "2026-04-15T18:00:00",
      durationMinutes: 60,
      status: "scheduled",
      notes: "",
      isRecurringInstance: true,
    } as any);
    assert.ok(out);
    assert.strictEqual(out!.metadata!.isRecurringInstance, true);
  });

  section("ship'd projectors — inbox_triage (contextMemory)");

  await test("contextMemory projector handles both string and Fact items", async () => {
    const { projector } = await import("../skills/inbox_triage/projector");
    assert.strictEqual(projector.schema, "contextMemory");
    assert.strictEqual(projector.source, "contextMemory");

    const factObj = { text: "user prefers oat milk", topic: "preferences", date: "2026-01-01" };
    const factStr = "another raw string fact";

    const a = projector.project(factObj);
    const b = projector.project(factStr);

    assert.ok(a, "Fact-shaped item must project");
    assert.strictEqual(a!.text, "user prefers oat milk preferences");
    assert.deepStrictEqual(a!.metadata, { topic: "preferences" });
    assert.strictEqual(typeof a!.sourceId, "string");
    assert.strictEqual(a!.sourceId.length, 16, "fnv1a64Hex returns 16 hex chars");

    assert.ok(b, "string-shaped item must project");
    assert.strictEqual(b!.text, "another raw string fact");
    assert.strictEqual(b!.metadata, undefined);

    assert.notStrictEqual(a!.sourceId, b!.sourceId, "different content must hash differently");
  });

  await test("contextMemory projector skips empty / too-short text", async () => {
    const { projector } = await import("../skills/inbox_triage/projector");
    assert.strictEqual(projector.project(""), null);
    assert.strictEqual(projector.project({ text: "", topic: null, date: "" }), null);
    assert.strictEqual(projector.project({ text: "abc", topic: null, date: "" }), null);
    assert.strictEqual(projector.project({ text: "    ", topic: null, date: "" }), null);
  });

  await test("contextMemory projector returns stable sourceId for same content", async () => {
    const { projector } = await import("../skills/inbox_triage/projector");
    const fact = { text: "stable content", topic: null, date: "2026-01-01" };
    const a = projector.project(fact);
    const b = projector.project(fact);
    assert.deepStrictEqual(a, b, "same content must produce same sourceId on repeat");
  });

  section("write hook");

  await test("writeHook is a no-op when no projector is registered for the schema", async () => {
    _resetProjectorRegistryForTests();
    // Registry empty → writeHook should swallow + return without throwing.
    const { fireRagWriteHook } = await import("./rag/writeHook");
    await fireRagWriteHook("add", "tasks", { id: "t1", title: "x" }, "t1");
    // No assertion needed — the absence of a throw IS the test.
  });

  await test("writeHook calls indexer with projected output on add", async () => {
    _resetProjectorRegistryForTests();
    // Stub a projector that always emits a deterministic chunk
    const captured: Array<{ source: string; sourceId: string; text: string }> = [];
    const stubProjector: RagProjector = {
      schema: "fakeSchema",
      source: "note" as any,
      iterate: () => [],
      project: (item: any) => ({
        sourceId: `stub-${item.id}`,
        text: `stub text for ${item.id}`,
      }),
    };
    registerProjector(stubProjector);

    // Inject a fake vector store via store-factory so indexEntity goes
    // somewhere we can observe. Easier: import the indexer / writeHook
    // and directly observe via a stubbed default store.
    const { _setDefaultVectorStoreForTests } = await import("./rag/store-factory");
    const fakeStore = {
      async upsert(record: any): Promise<void> {
        captured.push({
          source: record.source,
          sourceId: record.sourceId,
          text: record.text,
        });
      },
      async upsertBatch() {},
      async delete() {},
      async deleteBySource() {},
      async deleteAll() {},
      async search() { return []; },
      async count() { return 0; },
      async countMismatched() { return 0; },
      async getAllIds() { return []; },
    };
    _setDefaultVectorStoreForTests(fakeStore as any);

    try {
      const { fireRagWriteHook } = await import("./rag/writeHook");
      await fireRagWriteHook("add", "fakeSchema", { id: "abc" }, "abc");
      assert.strictEqual(captured.length, 1);
      assert.strictEqual(captured[0].source, "note");
      assert.strictEqual(captured[0].sourceId, "stub-abc");
      assert.strictEqual(captured[0].text, "stub text for abc");
    } finally {
      _setDefaultVectorStoreForTests(null);
    }
  });

  await test("writeHook calls deindexer on delete with the projector's source", async () => {
    _resetProjectorRegistryForTests();
    const stubProjector: RagProjector = {
      schema: "fakeSchema",
      source: "fact" as any,
      iterate: () => [],
      project: () => null,
    };
    registerProjector(stubProjector);

    const deletes: Array<{ source: string; sourceId: string }> = [];
    const { _setDefaultVectorStoreForTests } = await import("./rag/store-factory");
    const fakeStore = {
      async upsert() {},
      async upsertBatch() {},
      async delete() {},
      async deleteBySource(source: string, sourceId: string): Promise<void> {
        deletes.push({ source, sourceId });
      },
      async deleteAll() {},
      async search() { return []; },
      async count() { return 0; },
      async countMismatched() { return 0; },
      async getAllIds() { return []; },
    };
    _setDefaultVectorStoreForTests(fakeStore as any);

    try {
      const { fireRagWriteHook } = await import("./rag/writeHook");
      await fireRagWriteHook("delete", "fakeSchema", null, "deleted-id");
      assert.strictEqual(deletes.length, 1);
      assert.strictEqual(deletes[0].source, "fact");
      assert.strictEqual(deletes[0].sourceId, "deleted-id");
    } finally {
      _setDefaultVectorStoreForTests(null);
    }
  });

  await test("writeHook swallows projector errors (executor write integrity wins)", async () => {
    _resetProjectorRegistryForTests();
    const throwingProjector: RagProjector = {
      schema: "broken",
      source: "note" as any,
      iterate: () => [],
      project: () => { throw new Error("intentional"); },
    };
    registerProjector(throwingProjector);
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      const { fireRagWriteHook } = await import("./rag/writeHook");
      // MUST NOT throw.
      await fireRagWriteHook("add", "broken", { id: "x" }, "x");
    } finally {
      console.warn = origWarn;
    }
  });

  section("Summary");
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("test runner exception:", err);
  process.exit(1);
});
