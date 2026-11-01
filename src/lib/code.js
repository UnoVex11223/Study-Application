// Code questions: a question can carry tests (item.tests = { lang, code }) that
// are run against your answer instead of grading it against key points. The
// running happens in the main process (code-runner.cjs).

export const CODE_LANGS = {
  python: { label: "Python" },
  c: { label: "C" },
  javascript: { label: "JavaScript" },
};

/** Does this question have tests to run? */
export const hasTests = (item) => Boolean(item?.tests?.code?.trim() && CODE_LANGS[item.tests.lang]);

/** The language a code question's answer is written in, from its tests or its model answer's fence. */
export function guessLang(text) {
  const m = String(text || "").match(/```\s*([\w+-]+)/);
  const tag = m?.[1]?.toLowerCase();
  if (tag === "py" || tag === "python") return "python";
  if (tag === "c" || tag === "h") return "c";
  if (tag === "js" || tag === "javascript" || tag === "node") return "javascript";
  return null;
}

/** The code inside a fenced block (the first one), or the whole text when there's no fence. */
export function codeOf(text) {
  const s = String(text || "").replace(/\r\n/g, "\n");
  const m = s.match(/```[\w+-]*\n([\s\S]*?)```/);
  return (m ? m[1] : s).trim();
}

/**
 * Run tests against an answer. Resolves { ok, passed, stage, output, timedOut }
 * or { ok: false, error } (no desktop app, or the language isn't installed).
 */
export async function runCode({ lang, solution, tests }) {
  const run = typeof window !== "undefined" && window.tenax?.code?.run;
  if (!run) return { ok: false, error: "Running code needs the desktop app." };
  try { return await run({ lang, solution: codeOf(solution), tests }); } catch (err) { return { ok: false, error: err?.message || "Couldn't run the tests." }; }
}
