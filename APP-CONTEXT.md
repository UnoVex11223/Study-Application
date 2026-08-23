# AeroFlash — How It Works

AeroFlash is a desktop flashcard app (Electron + React) built around one idea: **learning should be scheduled by memory science, not by feel.** You dump in notes, it turns them into flashcards, and it tells you exactly which cards to review and when — using the same spaced-repetition algorithm behind modern Anki (FSRS).

This document exists so you can paste it into another AI (ChatGPT, etc.) as context when asking it to prepare notes, summaries, or study material for you — so it understands what format and structure will actually work well inside the app.

---

## The core loop

1. **Create a Topic** (e.g. "Pointers", "Chapter 6 — Structs") — a container for related cards.
2. **Add cards** to it — manually, as cloze deletions, or by feeding notes to AI generation.
3. Every day, hit **"Review Now"** on the home screen. It pulls together every card that's due *across all your topics* (not just one), mixed randomly — this interleaving is deliberate and improves retention versus studying one topic at a time.
4. For each card, you reveal the answer, then rate how well you knew it: **Again / Hard / Good / Easy**. That rating feeds the scheduler, which decides exactly when you'll see that card next — seconds from now if you got it wrong, weeks or months from now if you know it cold.
5. Over time the app builds a picture of what you've actually mastered vs. what keeps slipping (the Insights tab).

There's no "studying a deck front to back" — the app decides what you need to see today based on your own memory curve for each individual card.

---

## Card types

- **Basic** — a question ("front") and answer ("back"), plus 3 wrong-answer options used in multiple-choice quiz mode.
- **Cloze** — a sentence with one key term blanked out, written as `The mitochondria is the {{c1::powerhouse}} of the cell.` Shown as a fill-in-the-blank. Best for definitions, exact terms, and numeric facts.

Both types are scheduled by the same spaced-repetition system and can appear in the same Review session.

## Study modes

- **Review** — the main daily due-card queue described above. Rate Again/Hard/Good/Easy; this is what drives the scheduling.
- **Flip Cards** — simple front/back flashcard flipping through a topic, also feeds ratings into the scheduler.
- **Quiz** — multiple choice, using each card's 3 wrong answers as distractors. Right = scheduled further out, wrong = scheduled to repeat soon.
- **Type Mode** — you type the answer from memory instead of picking it. An AI grades your free-text answer for substance (not exact wording), tells you what you got right/missed, and suggests a rating — you can accept or override it. Falls back to a simple keyword-overlap check if no AI key is configured.
- **Simulate** — a 20-question, 25-minute timed test pulling from every topic at once, like a mock exam. No going back once you've answered. Score breakdown by topic at the end.

## Insights dashboard

- Day streak, reviews today, cards due now, 30-day retention rate
- A GitHub-style activity heatmap of review history
- A 7-day forecast of how many cards will come due each day
- Per-topic mastery percentage (cards scheduled 3+ weeks out = "mastered")
- **Leeches** — cards you keep forgetting (4+ failed reviews), flagged as candidates to rewrite because a card that's failed repeatedly is usually poorly worded, not genuinely hard

## Gamification

XP and rank levels (Newcomer → Transcendent, 20 ranks) reward consistent reviewing — small XP per card rated, streak bonuses, and a bonus for clearing your whole due queue in one sitting. This is a motivation layer sitting on top of the real mechanic (spaced repetition); it doesn't affect scheduling.

---

## How AI card generation works (the part that matters for note-prep)

In a topic, "Add Cards → From Notes (AI)" accepts pasted text and/or uploaded `.md`/`.txt` files. Long input is automatically split into ~12,000-character chunks on paragraph boundaries and processed sequentially, so very large files don't fail outright — but the app has no idea where your natural chapter/topic boundaries are, so a hand-organized input still produces better, more focused cards than one giant dump.

The generation prompt is specifically instructed to:

**Extract:**
- Key definitions and vocabulary
- Distinctions between similar/confusable concepts
- Scenario-based "which should you use?" questions
- Facts that are commonly mixed up
- Comparisons between types/modes/options

**Ignore:**
- Markdown structure, headers, wikilinks
- Tips/callouts/reminders (study aids, not testable facts)
- Code examples, *unless* the code is the only place a concept is explained
- Navigation/"related notes" sections
- Vague statements that would never be tested

**Output:** a mix of basic cards (~3/4) and cloze cards (~1/4), each basic card auto-generated with 3 plausible wrong answers for quiz mode.

### Implication for preparing notes with another AI

Because code blocks are mostly skipped, source material that's heavy on code (like a programming book) needs deliberate prose translation — for each significant code example, describe **what it does** and **the specific gotcha/behavior it demonstrates** in plain language, so that becomes extractable. Also: since the app can't detect chapter boundaries, pre-splitting source material by chapter/topic and feeding each section into its own AeroFlash Topic produces meaningfully better, more relevant flashcards than one massive unstructured file.

Ideal input to this pipeline is clean, structured prose organized as: definitions → core concept explanations (with the "vs. similar concept" contrast made explicit) → plain-language description of any code/example behavior → explicit comparisons → common mistakes. No exercises, no chapter-intro fluff, no cross-references.

---

## Data & privacy

Everything — topics, cards, review history, XP, streaks, and your API key — is stored **locally only**, in a single file on your machine (`electron-store`, a local JSON config file). Nothing syncs to a server. AI features (card generation, typed-answer grading) call the Anthropic API directly from the app's background process using your own API key, which you set once in Settings; the key never touches the app's UI code or leaves your machine except for that direct API call. Without a key, everything still works except AI generation and AI grading (grading falls back to a basic keyword match).

There's a "Reset All Progress" option in Settings that wipes topics/cards/XP/history in one confirmed action while leaving your API key untouched.
