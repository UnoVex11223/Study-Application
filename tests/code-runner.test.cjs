// The code runner, against real interpreters and compilers where installed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execSync } = require("node:child_process");
const { runTests, unfence } = require("../code-runner.cjs");

const has = (cmd) => { try { execSync(process.platform === "win32" ? `where ${cmd}` : `command -v ${cmd}`, { stdio: "ignore" }); return true; } catch { return false; } };
const python = has("python3") || has("python");
const cc = has("gcc") || has("clang") || has("cc");

test("unfence: an answer in a code fence runs as its code", () => {
  assert.equal(unfence("```python\nx = 1\n```"), "x = 1");
  assert.equal(unfence("x = 1"), "x = 1");
});

test("JavaScript runs on the app's own Node.js", async () => {
  const ok = await runTests({ lang: "javascript", solution: "function add(a, b) { return a + b; }", tests: 'const assert = require("node:assert");\nassert.equal(add(2, 3), 5);' });
  assert.equal(ok.ok, true);
  assert.equal(ok.passed, true);
  const bad = await runTests({ lang: "javascript", solution: "function add(a, b) { return a - b; }", tests: 'const assert = require("node:assert");\nassert.equal(add(2, 3), 5);' });
  assert.equal(bad.passed, false);
  assert.match(bad.output, /AssertionError/);
  assert.ok(!bad.output.includes("tenax-run-"), "the temporary folder isn't shown");
});

test("Python: passing and failing tests", { skip: !python && "no Python here" }, async () => {
  const ok = await runTests({ lang: "python", solution: "```python\ndef add(a, b):\n    return a + b\n```", tests: "assert add(2, 3) == 5" });
  assert.equal(ok.passed, true);
  const bad = await runTests({ lang: "python", solution: "def add(a, b):\n    return a - b", tests: "assert add(2, 3) == 5" });
  assert.equal(bad.passed, false);
  assert.equal(bad.stage, "run");
  assert.match(bad.output, /AssertionError/);
});

test("C: builds, runs, and reports compile errors", { skip: !cc && "no C compiler here" }, async () => {
  const tests = "#include <assert.h>\nint main(void) { assert(add(2, 3) == 5); return 0; }";
  const ok = await runTests({ lang: "c", solution: "int add(int a, int b) { return a + b; }", tests });
  assert.equal(ok.passed, true, ok.output);
  const bad = await runTests({ lang: "c", solution: "int add(int a, int b) { return a + b }", tests });
  assert.equal(bad.passed, false);
  assert.equal(bad.stage, "build");
});

test("a program that never ends is stopped", { skip: !python && "no Python here" }, async () => {
  const r = await runTests({ lang: "python", solution: "while True:\n    pass", tests: "pass", timeout: 1500 });
  assert.equal(r.passed, false);
  assert.equal(r.timedOut, true);
});

test("unknown languages and missing tests are errors, not crashes", async () => {
  assert.equal((await runTests({ lang: "rust", solution: "", tests: "x" })).ok, false);
  assert.equal((await runTests({ lang: "python", solution: "x = 1", tests: "  " })).ok, false);
});
