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

## How AI card generation works

The **From your reading** workspace accepts pasted text and `.md`, `.markdown`, or `.txt` files. Markdown headings define source sections; headings inside fenced code are preserved as code. Long sections are split into requests of at most 12,000 characters, without creating extra section budgets. Source names and heading ancestry are retained automatically.

Three content depths control the maximum workload:

| Depth | New questions per import | Questions per section | Total questions in a topic |
| --- | ---: | ---: | ---: |
| Essentials | 8 | 2 | 16 |
| Balanced (default) | 12 | 4 | 24 |
| Broader | 18 | 6 | 36 |

These are ceilings, not quotas. Existing questions count toward capacity. Earlier decks above the limits remain intact. Manual additions are still available. A topic's core set is a selective collection, not a claim to cover or master an entire subject.

The generator prioritizes central definitions, mechanisms, useful methods, important distinctions and consequential misconceptions. It uses explicit objectives, examples and exercises as relevance signals, and avoids trivia and guesses about exam frequency. A learning focus can be supplied, but is optional.

Each suggestion has a concept, recall/explain/apply/distinguish skill, core/supporting priority, reason for inclusion, reference answer, essential points and a matching source passage. One question per normalized concept is selected. Deterministic filtering excludes unsupported quotes, malformed responses, duplicate concepts and matching question fingerprints. It does not guarantee semantic correctness or catch every paraphrase duplicate.

Selection favors coverage across sections and files before more questions from one section. The same budgets apply to the entire import, not to each API request. The section outline explicitly shows sections without a selected question. Import up to 180,000 characters and 48 source segments at a time.

The bounded draft is saved after each completed segment, and survives leaving the screen or restarting. Interrupted imports are labeled partial. Questions enter the study queue only when **Add questions** is clicked; the final transaction rechecks current limits. Individual suggestions can be omitted. Generated cards are basic cards, with optional distractors for the existing quiz mode. Manually authored cloze cards remain supported.

### Preparing useful source notes

Preserve real headings, definitions, explanations, worked examples, relevant code and important distinctions. Do not create lots of repetitive detail solely to produce more cards. Unstructured text without headings currently remains one section. Broader course structure, concept graphs and evidence-based mastery tracking are planned in later chunks; see `docs/REFACTOR-PLAN.md`.

---

## Data & privacy

Everything — topics, cards, review history, XP, streaks, and your API key — is stored **locally only**, in a single file on your machine (`electron-store`, a local JSON config file). Nothing syncs to a server. AI features (card generation, typed-answer grading) call the Anthropic API directly from the app's background process using your own API key, which you set once in Settings; the key never touches the app's UI code or leaves your machine except for that direct API call. Without a key, everything still works except AI generation and AI grading (grading falls back to a basic keyword match).

There's a "Reset All Progress" option in Settings that wipes topics/cards/XP/history in one confirmed action while leaving your API key untouched.
