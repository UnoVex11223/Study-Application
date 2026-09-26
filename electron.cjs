const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const Store = require("electron-store");
const Anthropic = require("@anthropic-ai/sdk");
const pdf = require("./pdf-text.cjs");

const store = new Store();
const API_KEY = "af_api_key";

// ── Store bridge ──────────────────────────────────────────────────────────────
// The renderer can write the API key but never read it back.
ipcMain.handle("store-get", (_event, key) => (key === API_KEY ? null : store.get(key, null)));
ipcMain.handle("store-set", (_event, key, val) => {
  if (val === null || val === undefined) store.delete(key);
  else store.set(key, val);
});

// ── AI (runs here so the API key never reaches the renderer) ─────────────────
// Heavier reasoning (building a curriculum) uses the strongest model; grading
// runs many times a day, so it uses a faster one. Each list falls back in
// order if a model isn't available on the account.
const MODELS = {
  deep: ["claude-opus-5-5", "claude-opus-5"],
  fast: ["claude-sonnet-5", "claude-opus-5"],
};

function getClient() {
  const apiKey = store.get(API_KEY) || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "The API key was rejected. Check it in Settings.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited. Wait a moment and try again.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the API. Check your internet connection.";
  if (err instanceof Anthropic.APIError) return `API error: ${err.message}`;
  return err?.message || "Something went wrong.";
}

/** One structured-output call with model fallback. Returns { ok, data } or { ok:false, error }. */
async function structured({ tier, system, prompt, schema, maxTokens }) {
  const client = getClient();
  if (!client) return { ok: false, error: "no-key" };
  let lastErr = null;
  for (const model of MODELS[tier]) {
    try {
      const params = {
        model,
        max_tokens: maxTokens,
        system,
        output_config: { format: { type: "json_schema", schema } },
        messages: [{ role: "user", content: prompt }],
      };
      const message = maxTokens > 8000
        ? await client.messages.stream(params).finalMessage()
        : await client.messages.create(params);
      if (message.stop_reason === "refusal") return { ok: false, error: "The model declined this content." };
      if (message.stop_reason === "max_tokens") return { ok: false, error: "That was too much material for one pass. Try a smaller section." };
      const text = message.content.find((b) => b.type === "text")?.text ?? "";
      return { ok: true, data: JSON.parse(text), model };
    } catch (err) {
      lastErr = err;
      if (err instanceof Anthropic.NotFoundError) continue; // try the next model
      break;
    }
  }
  return { ok: false, error: friendlyError(lastErr) };
}

const str = (description) => (description ? { type: "string", description } : { type: "string" });
const strList = (description) => ({ type: "array", items: { type: "string" }, ...(description ? { description } : {}) });
const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const escapeTag = (s) => String(s ?? "").replace(/<\/(source|answer|known_concepts)>/gi, "</ $1>");

// ── 1. Curriculum extraction ─────────────────────────────────────────────────
const EXTRACT_SCHEMA = obj({
  title: str("Title for this material, e.g. 'Chapter 4: Pointers'"),
  sections: {
    type: "array",
    items: obj({
      title: str(),
      summary: str("One sentence on what this section covers"),
      concepts: {
        type: "array",
        items: obj({
          key: str("Short unique id within this response, e.g. k1, k2"),
          name: str("Short noun phrase a practitioner would use"),
          summary: str("1–2 sentence precise explanation faithful to the source"),
          kind: { type: "string", enum: ["definition", "mechanism", "distinction", "procedure", "principle", "fact"] },
          importance: { type: "string", enum: ["core", "supporting", "detail"] },
          importance_reason: str("The specific signal that makes it important"),
          excerpt: str("Verbatim quote from the source (max ~40 words) supporting the summary"),
          location: str("Heading, page or timestamp from the text, or empty"),
          prerequisites: strList("Keys from this response, or exact names from <known_concepts>, that this concept directly depends on"),
        }),
      },
    }),
  },
  gaps: strList("Places where extracted text seems to have lost information (figures, garbled equations, cut-off code)"),
});

const EXTRACT_SYSTEM = `You turn study material (a book chapter, a course lesson, lecture notes) into a curriculum of concepts worth committing to long-term memory. The learner wants to be able to define, explain and apply each idea from memory months from now, so you must separate what matters from what doesn't.

SECTIONS
Split the material into its natural sections. Use the source's own headings where they exist; otherwise group by topic. A typical chapter has 3–8 sections; short notes may have one.

CONCEPTS
Each concept is one learnable idea.
- name: short, as a practitioner would say it ("Magic number", "Pointer arithmetic", "Normal form").
- summary: 1–2 precise sentences in plain language, faithful to the source. Use markdown \`code\` for identifiers and $...$ for math.
- importance — judge by these signals, never by how often a word appears:
  • explicit learning objectives, chapter summaries, key-term lists, bolded definitions
  • ideas the source works through with examples or exercises
  • ideas later material depends on
  • mistakes or pitfalls the source warns about
  core = needed to understand the rest, or central to the material's purpose.
  supporting = worth knowing and testable, but not foundational.
  detail = incidental facts, specific numbers, historical asides.
  Be strict: usually only 30–50% of concepts are core.
- Leave out entirely anything not worth remembering: anecdotes, motivation, navigation, exercise instructions, publisher or setup boilerplate, restatements.
- excerpt: copy a short passage exactly as written in the source.
- location: text taken from a PDF contains [Page N] markers; give the page the concept comes from ("p. 243"). Otherwise use the nearest heading, or leave it empty.
- prerequisites: only direct, genuine dependencies (B can't be understood without A). Reference a concept by its key in your output, or by the exact name of a concept in <known_concepts>.

DUPLICATES
If the same idea appears in several places, make one concept. If a concept means the same thing as one in <known_concepts>, don't recreate it; reference it as a prerequisite where relevant. Match on meaning, not on shared words.

CODE, MATH AND FIGURES
In technical material the key idea often lives in a code example or equation: extract the rule or behavior it demonstrates. If the text looks like it has lost something needed to understand a passage (a figure, a garbled equation, truncated code), record it in gaps rather than guessing.

Never add facts that the source doesn't support.`;

ipcMain.handle("ai:extract", async (_e, { courseName, title, location, text, known = [] }) => {
  const knownList = known.slice(0, 400).map((k) => `- ${k.name}${k.section ? ` (${k.section})` : ""}`).join("\n");
  const prompt = `Course: ${courseName}
${title ? `Material: ${title}\n` : ""}${location ? `Location: ${location}\n` : ""}
<known_concepts>
${knownList || "(none yet)"}
</known_concepts>

<source>
${escapeTag(text)}
</source>`;
  return structured({ tier: "deep", system: EXTRACT_SYSTEM, prompt, schema: EXTRACT_SCHEMA, maxTokens: 32000 });
});

// ── 2. Practice tasks with rubrics ───────────────────────────────────────────
const ITEMS_SCHEMA = obj({
  tasks: {
    type: "array",
    items: obj({
      concept_key: str("Key of the concept this task practices"),
      ability: { type: "string", enum: ["recall", "explain", "distinguish", "apply", "connect"] },
      prompt: str("The question shown to the learner (markdown)"),
      model_answer: str("A concise expert answer (markdown)"),
      accept: strList("For recall: every acceptable short answer. Otherwise empty."),
      required_points: strList("Essential ideas a correct answer must contain"),
      misconceptions: strList("Specific wrong beliefs that make an answer wrong"),
      hint: str("A nudge that does not reveal the answer"),
    }),
  },
});

const ITEMS_SYSTEM = `You write retrieval-practice tasks. The learner answers every task by typing from memory; there are never multiple-choice options. The goal is durable memory plus the ability to explain and use each idea without help.

HOW MANY
core concept: 2–3 tasks. supporting: 1–2. detail: 1.
Across the section, write at most one "connect" task asking how 2–3 of the concepts work together; attach it to the most central one.

ABILITIES
- recall: produce a term, name or key fact. Exactly one short answer should be correct. Fill accept with every acceptable short answer (synonyms, abbreviations, alternate spellings). If the answer would be a sentence, it's an explain task instead.
- explain: what it is, how it works, or why it matters.
- distinguish: the defining difference from a concept it's easily confused with.
- apply: a NEW concrete scenario, example, code snippet or problem that isn't copied from the source, with a determinable answer (predict the output, choose and justify an approach, compute a value, find the bug).
- connect: how several ideas work together.
For core concepts, include at least one explain task and, when the concept can be used, one apply or distinguish task.

RUBRIC
- required_points: 1–3 short, checkable ideas. A learner who states all of them has answered correctly, whatever their wording. Don't require textbook phrasing or incidental detail. For recall, one point naming the answer.
- misconceptions: 0–3 realistic wrong beliefs that make an answer wrong even when it uses the right words.
- model_answer: what an expert would say in 1–4 sentences, or a short code block.
- hint: points toward the right area without revealing the answer.

WRITING
- The prompt must not contain the answer or the term it asks for.
- Vary phrasing; don't start every prompt the same way.
- Markdown: fenced code blocks with a language tag, \`inline code\`, $...$ for math.`;

ipcMain.handle("ai:items", async (_e, { courseName, sectionTitle, concepts }) => {
  const list = concepts.map((c) => `<concept key="${c.key}" importance="${c.importance}" kind="${c.kind}">
name: ${c.name}
summary: ${c.summary}
${c.excerpt ? `source: ${c.excerpt}` : ""}
</concept>`).join("\n");
  const prompt = `Course: ${courseName}
Section: ${sectionTitle}

${list}`;
  return structured({ tier: "deep", system: ITEMS_SYSTEM, prompt, schema: ITEMS_SCHEMA, maxTokens: 32000 });
});

// ── 3. Rubric grading ────────────────────────────────────────────────────────
const GRADE_SCHEMA = obj({
  points: {
    type: "array",
    items: obj({ met: { type: "boolean" }, evidence: str("Quote or paraphrase from the answer, or empty") }),
    description: "One entry per required point, in the same order",
  },
  misconceptions_found: strList("Misconceptions or clear factual errors the answer asserts"),
  uncertain: { type: "boolean" },
  follow_up: str("If uncertain, one short question that would resolve it; otherwise empty"),
  feedback: str("1–2 specific sentences"),
});

const GRADE_SYSTEM = `You grade a learner's typed answer to a retrieval-practice question against a fixed rubric.

- Grade meaning, not wording. Paraphrases, synonyms, informal language, a different order and small typos are fine.
- For each required point, decide whether the answer states it, explicitly or with clearly equivalent meaning. A vague gesture ("it's bad", "it matters") does not satisfy a point that requires a reason or mechanism.
- Don't penalize the absence of anything the rubric doesn't require, and don't reward length or keyword stuffing.
- For each listed misconception, decide whether the answer asserts it. Also report any other clear factual error that bears on the question.
- If the answer is ambiguous in a way that decides a required point, set uncertain to true and ask one short follow-up question that would settle it. Otherwise uncertain is false and follow_up is empty.
- feedback: say specifically what was missing or wrong and state the correct idea. No praise or filler.`;

ipcMain.handle("ai:grade", async (_e, { prompt, modelAnswer, points, misconceptions, excerpt, answer, followUp }) => {
  const body = `<question>
${prompt}
</question>

<model_answer>
${modelAnswer}
</model_answer>

<required_points>
${points.map((p, i) => `${i + 1}. ${p}`).join("\n")}
</required_points>

<misconceptions>
${misconceptions.length ? misconceptions.map((m) => `- ${m}`).join("\n") : "(none listed)"}
</misconceptions>
${excerpt ? `\n<source_excerpt>\n${excerpt}\n</source_excerpt>\n` : ""}
<answer>
${escapeTag(answer)}
</answer>${followUp ? `

The learner was asked a follow-up to clarify: "${followUp.question}"
<follow_up_answer>
${escapeTag(followUp.answer)}
</follow_up_answer>
Grade the original answer together with this clarification. Don't ask another follow-up.` : ""}`;
  return structured({ tier: "fast", system: GRADE_SYSTEM, prompt: body, schema: GRADE_SCHEMA, maxTokens: 2000 });
});

// ── 4. Cross-course linking ──────────────────────────────────────────────────
const LINK_SCHEMA = obj({
  links: {
    type: "array",
    items: obj({
      from: str("Concept id"),
      to: str("Concept id"),
      type: { type: "string", enum: ["prereq", "related", "contrast", "application"] },
      why: str("One illuminating sentence"),
      confidence: { type: "number" },
    }),
  },
});

const LINK_SYSTEM = `You connect a learner's concepts into a knowledge map spanning all of their courses. You get NEW concepts and EXISTING ones. Propose relationships that involve at least one NEW concept.

Types:
- prereq: "from" must be understood before "to" (a genuine dependency).
- related: the same underlying idea in different contexts, or one is an instance of the other.
- contrast: easily confused; worth telling apart.
- application: one is used to accomplish or implement the other.

Match on meaning, never on shared words alone (a C "pointer" and a UI mouse "pointer" are unrelated).
why: one sentence that would genuinely help the learner see the connection.
confidence: 0–1, how sure you are the relation is real and useful. Omit anything below 0.4.
Prefer a few high-value links to many weak ones: at most 2 per new concept, and none if nothing meaningful exists.`;

ipcMain.handle("ai:link", async (_e, { fresh, existing }) => {
  const fmt = (c) => `${c.id} | ${c.course} | ${c.name}: ${c.summary}`;
  const prompt = `NEW concepts:
${fresh.map(fmt).join("\n")}

EXISTING concepts:
${existing.map(fmt).join("\n") || "(none)"}`;
  return structured({ tier: "deep", system: LINK_SYSTEM, prompt, schema: LINK_SCHEMA, maxTokens: 8000 });
});

// ── 5. Teach-back ────────────────────────────────────────────────────────────
const TEACH_SCHEMA = obj({
  concepts: {
    type: "array",
    items: obj({
      id: str(),
      status: { type: "string", enum: ["covered", "partial", "missing", "wrong"] },
      note: str("What's missing or wrong, briefly; empty if covered"),
    }),
  },
  errors: strList("Clear factual errors in the explanation"),
  summary: str("2–3 sentences: the strongest part and the most important gap"),
});

const TEACH_SYSTEM = `The learner is explaining a topic from memory, as if teaching it to someone. Evaluate their explanation against the concepts listed.

For every concept give a status:
- covered: its essential points are stated correctly
- partial: touched on, but an essential point is missing or vague
- missing: not addressed
- wrong: states something incorrect about it
Grade meaning, not wording. Don't penalize informal style, order, or brevity when the ideas are right. Only list errors that are clearly wrong, not simplifications.`;

ipcMain.handle("ai:teachback", async (_e, { title, concepts, text }) => {
  const list = concepts.map((c) => `<concept id="${c.id}">
${c.name}
${c.points.map((p) => `- ${p}`).join("\n")}
</concept>`).join("\n");
  const prompt = `Topic: ${title}

${list}

<answer>
${escapeTag(text)}
</answer>`;
  return structured({ tier: "deep", system: TEACH_SYSTEM, prompt, schema: TEACH_SCHEMA, maxTokens: 4000 });
});

ipcMain.handle("ai:status", () => ({ hasKey: Boolean(store.get(API_KEY) || process.env.ANTHROPIC_API_KEY) }));

// ── PDF import ───────────────────────────────────────────────────────────────
const pdfError = (err) => ({ ok: false, error: /password/i.test(err?.message) ? "That PDF is password-protected." : "Couldn't read that PDF." });
ipcMain.handle("pdf:outline", async (_e, data) => {
  try { return { ok: true, ...(await pdf.outline(data)) }; } catch (err) { return pdfError(err); }
});
ipcMain.handle("pdf:text", async (_e, { data, from, to }) => {
  try { return { ok: true, ...(await pdf.pageText(data, from, to)) }; } catch (err) { return pdfError(err); }
});

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  const iconPath = path.join(__dirname, "build", "study-app-icon.ico");
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#FBFAF7",
    autoHideMenuBar: true,
    ...(fs.existsSync(iconPath) && { icon: iconPath }),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  // Open external links in the browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, "dist", "index.html"));
  } else {
    win.loadURL("http://localhost:5173");
  }
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
