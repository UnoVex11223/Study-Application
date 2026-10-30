// Runs a code question's tests against an answer, on this computer.
//
// A code question stores tests in Python, C or JavaScript. Your answer and the
// tests are written into one file in a fresh temporary folder, built if needed
// and run; the tests pass when the program exits with status 0 (a failing
// assert exits otherwise). Everything is time-limited and the folder is
// removed afterwards.
//
//   Python      python3, python or py (whichever is installed)
//   C           gcc, clang or cc; on Windows without one, gcc inside WSL
//   JavaScript  this app's own Node.js (nothing to install)
//
// Main process only (uses child_process); tested in tests/code-runner.test.cjs.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TIMEOUT_MS = 10000;
const MAX_OUTPUT = 4000;

const LANGS = {
  python: { file: "main.py" },
  c: { file: "main.c" },
  javascript: { file: "main.cjs" },
};

/** Run a command; resolves { code, output, timedOut, missing } (missing: the program isn't installed). */
function run(cmd, args, { cwd, env, timeout = TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let output = "", settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve({ ...r, output: output.length > MAX_OUTPUT ? `${output.slice(0, MAX_OUTPUT)}\n…` : output }); } };
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: env || process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      return done({ code: null, missing: err?.code === "ENOENT", error: err?.message });
    }
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* already gone */ } done({ code: null, timedOut: true }); }, timeout);
    const take = (d) => { if (output.length <= MAX_OUTPUT) output += d.toString(); };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (err) => { clearTimeout(timer); done({ code: null, missing: err?.code === "ENOENT", error: err?.message }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      // Windows' "python" placeholder (Microsoft Store alias) exits with 9009 when Python isn't installed.
      done({ code, missing: code === 9009 });
    });
  });
}

/** Try each candidate program until one exists. */
async function firstAvailable(candidates, args, opts) {
  for (const cmd of candidates) {
    const r = await run(cmd, typeof args === "function" ? args(cmd) : args, opts);
    if (!r.missing) return { ...r, runner: cmd };
  }
  return null;
}

/** Strip a markdown code fence around an answer, if there is one. */
function unfence(text) {
  const s = String(text || "").replace(/\r\n/g, "\n").trim();
  const m = s.match(/^```[\w+-]*\n([\s\S]*?)\n?```$/);
  return m ? m[1] : s;
}

/**
 * Run `tests` against `solution`.
 * Resolves { ok: true, passed, stage: "build" | "run", output, timedOut, runner }
 * or { ok: false, error } when the language isn't installed or something else went wrong.
 */
async function runTests({ lang, solution, tests, timeout = TIMEOUT_MS }) {
  const spec = LANGS[lang];
  if (!spec) return { ok: false, error: `Unknown language: ${lang}` };
  if (!String(tests || "").trim()) return { ok: false, error: "This question has no tests." };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tenax-run-"));
  const file = path.join(dir, spec.file);
  fs.writeFileSync(file, `${unfence(solution)}\n\n${String(tests).replace(/\r\n/g, "\n")}\n`);
  const win = process.platform === "win32";
  const opts = { cwd: dir, timeout };
  // Messages name the temporary folder; show just the file name.
  const tidy = (out) => out.split(dir + path.sep).join("").trim();
  const result = (r, stage) => ({ ok: true, passed: r.code === 0 && !r.timedOut, stage, output: tidy(r.output), timedOut: Boolean(r.timedOut), runner: r.runner });
  try {
    if (lang === "javascript") {
      // This app's own Node.js: Electron runs as plain Node with ELECTRON_RUN_AS_NODE.
      const r = await run(process.execPath, [file], { ...opts, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
      if (r.missing) return { ok: false, error: "Couldn't start Node.js." };
      return result({ ...r, runner: "node" }, "run");
    }
    if (lang === "python") {
      const r = await firstAvailable(win ? ["python", "py", "python3"] : ["python3", "python"], [file], opts);
      if (!r) return { ok: false, error: "Python isn't installed (or isn't on your PATH). Install it from python.org to run Python tests." };
      return result(r, "run");
    }
    // C: build, then run.
    const exe = path.join(dir, win ? "main.exe" : "main");
    const build = await firstAvailable(["gcc", "clang", "cc"], ["-std=c11", "-O0", "-Wall", "-o", exe, file, "-lm"], opts);
    if (build) {
      if (build.code !== 0 || build.timedOut) return result(build, "build");
      const r = await run(exe, [], opts);
      return result({ ...r, runner: build.runner }, "run");
    }
    if (win) {
      // No compiler on Windows itself: build and run inside WSL. The folder is
      // passed as an argument, never spliced into the script.
      const has = await run("wsl", ["-e", "sh", "-c", "command -v gcc"], opts);
      if (!has.missing && has.code === 0) {
        const inDir = (cmd) => ["-e", "sh", "-c", `cd "$(wslpath -a "$1")" && ${cmd}`, "sh", dir];
        const b = await run("wsl", inDir("gcc -std=c11 -O0 -Wall -o main main.c -lm"), opts);
        if (b.code !== 0 || b.timedOut) return result({ ...b, runner: "wsl gcc" }, "build");
        return result({ ...(await run("wsl", inDir("./main"), opts)), runner: "wsl gcc" }, "run");
      }
    }
    return { ok: false, error: "No C compiler found. Install gcc (MinGW, or gcc inside WSL) to run C tests." };
  } catch (err) {
    return { ok: false, error: err?.message || "Couldn't run the tests." };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* left for the OS to clean */ }
  }
}

module.exports = { runTests, unfence, LANGS };
