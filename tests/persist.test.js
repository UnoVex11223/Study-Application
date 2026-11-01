// Loading and saving the library from the interface's side (lib/persist.js),
// against a stand-in for the database bridge in preload.cjs.
import { test } from "node:test";
import assert from "node:assert/strict";

/** A database bridge that records what it's asked to do (and can be told to fail). */
function fakeDatabase({ state = null, legacy = null } = {}) {
  const calls = [];
  let failing = 0;
  const reply = (name, arg) => {
    calls.push({ name, arg });
    if (failing > 0) { failing--; return { ok: false, error: "disk full" }; }
    return { ok: true };
  };
  return {
    calls,
    failNext: (n = 1) => { failing = n; },
    bridge: {
      load: async () => ({ ok: true, state, legacy, recovered: null }),
      apply: async (delta) => reply("apply", delta),
      replace: async (s) => reply("replace", s),
      saveNow: (payload) => reply("saveNow", payload),
      legacyDone: async () => reply("legacyDone"),
    },
  };
}

/** A fresh copy of persist.js, with `db` as the desktop app's database. */
async function freshPersist(db, tag) {
  globalThis.window = { tenax: { db: db.bridge }, addEventListener() {} };
  return import(`../src/lib/persist.js?${tag}`);
}

test("the first launch with a database brings the old library in, then archives it", async () => {
  const db = fakeDatabase({ legacy: { version: 8, courses: [{ id: "c1", name: "C" }], settings: { dailyQuestions: 25 } } });
  const persist = await freshPersist(db, "first");
  const { state } = await persist.loadState();
  assert.equal(state.courses[0].id, "c1");
  assert.equal(state.settings.dailyQuestions, 25);
  assert.deepEqual(db.calls.map(c => c.name), ["replace", "legacyDone"], "saved whole, then archived");
  assert.strictEqual(await persist.loadState().then(r => r.state), state, "loaded once");
});

test("a library an older version wrote since is merged in, not written over", async () => {
  const db = fakeDatabase({
    state: { version: 8, courses: [{ id: "c1", updatedAt: 10 }] },
    legacy: { version: 8, courses: [{ id: "c1", updatedAt: 5 }, { id: "c2", updatedAt: 20 }] },
  });
  const persist = await freshPersist(db, "merge");
  const { state } = await persist.loadState();
  assert.deepEqual(state.courses.map(c => c.id).sort(), ["c1", "c2"]);
  const apply = db.calls.find(c => c.name === "apply");
  assert.deepEqual(apply.arg.upsert.courses.map(c => c.id), ["c2"], "only what the older version added");
  assert.equal(db.calls.at(-1).name, "legacyDone");
});

test("only what changed is saved; a failed save is retried with everything since the last good one", async () => {
  const db = fakeDatabase({ state: { version: 8, courses: [{ id: "c1" }, { id: "c2" }], settings: {} } });
  const persist = await freshPersist(db, "save");
  const statuses = [];
  persist.onSaveStatus(s => statuses.push(s.error));
  const { state } = await persist.loadState();

  const v1 = { ...state, courses: [state.courses[0], { id: "c2", name: "edited" }] };
  persist.saveState(v1);
  await persist.flush();
  const first = db.calls.at(-1);
  assert.equal(first.name, "apply");
  assert.deepEqual(first.arg.upsert.courses, [{ id: "c2", name: "edited" }]);

  db.failNext();
  const v2 = { ...v1, courses: [...v1.courses, { id: "c3" }] };
  persist.saveState(v2);
  await persist.flush();
  assert.equal(statuses.at(-1), "disk full", "the failure is reported");

  const v3 = { ...v2, courses: v2.courses.filter(c => c.id !== "c1") };
  persist.saveState(v3);
  await persist.flush();
  const retry = db.calls.at(-1);
  assert.deepEqual(retry.arg.upsert.courses.map(c => c.id), ["c3"], "the change that failed goes again");
  assert.deepEqual(retry.arg.remove.courses, ["c1"], "with what changed since");
  assert.equal(statuses.at(-1), "", "and the warning clears");

  persist.saveState(v3);
  await persist.flush();
  assert.equal(db.calls.at(-1), retry, "an unchanged library isn't saved again");

  persist.saveState({ ...v3, courses: [] }, { full: true });
  await persist.flush();
  assert.equal(db.calls.at(-1).name, "replace", "a restore or reset replaces everything");
});
