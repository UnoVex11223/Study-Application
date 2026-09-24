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

// The content budget and source contracts are shared with the renderer.
ipcMain.handle("ai:generateCards", async (_event, input) => {
  const client = getClient();
  if (!client) return { ok: false, error: "No API key set — add one in Settings." };
  try {
    const { CARDS_SCHEMA, GENERATE_SYSTEM, generationPayload } = await import("./content-engine.mjs");
    const payload = generationPayload(input);
    const message = await client.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      system: GENERATE_SYSTEM,
      output_config: { format: { type: "json_schema", schema: CARDS_SCHEMA } },
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    }).finalMessage();
    if (message.stop_reason === "refusal") return { ok: false, error: "The model declined this content — try different notes." };
    if (message.stop_reason === "max_tokens") return { ok: false, error: "The response was incomplete. Try a smaller section." };
    const text = message.content.find(b => b.type === "text")?.text ?? "";
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.cards)) throw new Error("Invalid generation response. Please try again.");
    return { ok: true, data: parsed.cards.slice(0, payload.count) };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
});

// Structured assessment shares validation rules with the renderer.
ipcMain.handle("ai:gradeAnswer", async (_event, input) => {
  const client = getClient();
  if (!client) return { ok: false, error: "Add your Anthropic API key in Settings to grade written explanations." };
  try {
    const { GRADE_SCHEMA, GRADE_SYSTEM, assessmentPayload, validateAssessment } = await import("./assessment-engine.mjs");
    const payload = assessmentPayload(input);
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: GRADE_SYSTEM,
      output_config: { format: { type: "json_schema", schema: GRADE_SCHEMA } },
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    }, { timeout: 45000, maxRetries: 0 });
    if (message.stop_reason === "refusal") return { ok: false, error: "The grader declined this answer. It remains ungraded." };
    if (message.stop_reason !== "end_turn") return { ok: false, error: "The grading response was incomplete. Your schedule is unchanged." };
    const text = message.content.find(block => block.type === "text")?.text ?? "";
    const parsed = JSON.parse(text);
    const validated = validateAssessment(parsed, payload);
    if (validated.method === "ungraded") return { ok: false, error: validated.feedback };
    return { ok: true, data: parsed };
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
