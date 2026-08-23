const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const Store = require("electron-store");
const Anthropic = require("@anthropic-ai/sdk");

const store = new Store();

// ── Store bridge ──────────────────────────────────────────────────────────────
ipcMain.handle("store-get", (_event, key) => store.get(key, null));
ipcMain.handle("store-set", (_event, key, val) => {
  if (val === null || val === undefined) store.delete(key);
  else store.set(key, val);
});

// ── AI (runs here so the API key never reaches the renderer) ─────────────────
const MODEL = "claude-opus-5";

function getClient() {
  const apiKey = store.get("af_api_key") || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "Invalid API key — check it in Settings.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited — wait a moment and try again.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the API — check your internet connection.";
  if (err instanceof Anthropic.APIError) return `API error: ${err.message}`;
  return err?.message || "Something went wrong.";
}

const CARDS_SCHEMA = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["basic", "cloze"] },
          front: { type: "string", description: "Question (basic cards). Empty string for cloze cards." },
          back: { type: "string", description: "Correct answer. For cloze cards, the blanked text." },
          text: { type: "string", description: "Cloze sentence with the answer wrapped as {{c1::answer}}. Empty string for basic cards." },
          wrong: { type: "array", items: { type: "string" }, description: "Exactly 3 plausible wrong answers for basic cards. Empty array for cloze cards." },
        },
        required: ["type", "front", "back", "text", "wrong"],
        additionalProperties: false,
      },
    },
  },
  required: ["cards"],
  additionalProperties: false,
};

const GENERATE_PROMPT = (notes) => `You are a flashcard generator for technical exams and knowledge retention. Extract the most testable, high-value knowledge from the notes below and turn it into flashcards.

FOCUS ON:
- Key definitions and vocabulary (e.g. "What is X?", "What does X stand for?")
- Distinctions between similar concepts (e.g. Type A vs Type B)
- Scenario-based questions where the student must pick the correct tool, method, or concept for a given situation
- Facts that are commonly confused or easy to get wrong on exams
- Comparisons between modes, types, or options listed in the notes

IGNORE:
- Markdown syntax, headers, and document structure
- Wikilinks like [[...]] — treat them as plain text only if the concept is important
- Exam tips, hints, and reminder callouts — these are study aids, not testable facts
- Code examples unless the code illustrates a critical concept not explained elsewhere
- Navigation sections and "Related Notes" links
- Vague or obvious statements that would never appear on an exam

CARD FORMATS — produce a mix:
- "basic": a question ("front"), the correct answer ("back"), and exactly 3 plausible wrong answers ("wrong") drawn from real alternatives in the same notes. Set "text" to "".
- "cloze": a single key sentence ("text") with exactly ONE critical term blanked using {{c1::term}} syntax. Set "back" to the blanked term, "front" to "", and "wrong" to []. Use cloze for definitions, numbers, and fill-in-the-blank facts. Aim for roughly 1 cloze per 3 basic cards.

QUESTION STYLE:
- Phrase basic questions as: "What is...", "Which type...", "What is the primary purpose of...", "A team needs to... Which should they use?", "What distinguishes X from Y?"
- Wrong answers must be plausible — real alternatives a student could genuinely confuse with the correct answer
- Each card tests exactly one concept

Generate 8-15 cards. Prioritize the concepts most likely to appear on a real exam.

Notes:
${notes}`;

ipcMain.handle("ai:generateCards", async (_event, noteText) => {
  const client = getClient();
  if (!client) return { ok: false, error: "No API key set — add one in Settings." };
  try {
    const message = await client.messages
      .stream({
        model: MODEL,
        max_tokens: 16000,
        output_config: { format: { type: "json_schema", schema: CARDS_SCHEMA } },
        messages: [{ role: "user", content: GENERATE_PROMPT(noteText) }],
      })
      .finalMessage();
    if (message.stop_reason === "refusal") return { ok: false, error: "The model declined this content — try different notes." };
    if (message.stop_reason === "max_tokens") return { ok: false, error: "Notes too large for one pass — try a smaller chunk." };
    const text = message.content.find((b) => b.type === "text")?.text ?? "";
    const parsed = JSON.parse(text);
    return { ok: true, data: parsed.cards ?? [] };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
});

const GRADE_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["correct", "partial", "incorrect"] },
    missing: { type: "array", items: { type: "string" }, description: "Key points the student's answer missed or got wrong. Empty if fully correct." },
    feedback: { type: "string", description: "One or two encouraging sentences of specific feedback." },
  },
  required: ["verdict", "missing", "feedback"],
  additionalProperties: false,
};

ipcMain.handle("ai:gradeAnswer", async (_event, { question, correctAnswer, userAnswer }) => {
  const client = getClient();
  if (!client) return { ok: false, error: "no-key" };
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      output_config: { format: { type: "json_schema", schema: GRADE_SCHEMA } },
      messages: [{
        role: "user",
        content: `You are grading a student's free-recall flashcard answer. Judge on substance, not wording — synonyms, paraphrases, and different orderings are fine. "correct" means all key concepts are present; "partial" means the core idea is there but something important is missing or slightly wrong; "incorrect" means the core idea is missing or wrong.

Question: ${question}
Model answer: ${correctAnswer}
Student's answer: ${userAnswer}`,
      }],
    });
    if (message.stop_reason === "refusal") return { ok: false, error: "refused" };
    const text = message.content.find((b) => b.type === "text")?.text ?? "";
    return { ok: true, data: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
});

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  const iconPath = path.join(__dirname, "build", "study-app-icon.ico");
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    ...(fs.existsSync(iconPath) && { icon: iconPath }),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, "dist", "index.html"));
  } else {
    win.loadURL("http://localhost:5173");
  }
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
