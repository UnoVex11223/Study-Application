# AeroFlash — How It Works

AeroFlash is a desktop study app (Electron + React) for keeping what you learn in long-term memory across many subjects at once. You add material a chapter at a time; it pulls out the concepts worth remembering, writes questions you answer from memory, and schedules a short daily session sized to the time you have.

This file doubles as context you can paste into another AI when preparing material for the app.

---

## The daily loop

1. **Today** shows one session: a number of questions and an estimated time. It never asks for more than your daily budget (20 minutes by default, set in Settings).
2. You answer each question by **typing from memory**. There is no multiple choice.
3. Your answer is graded against the question's **key points** (see Grading), you see what you missed, and you rate how well you knew it (Again / Hard / Good / Easy, with a suggested rating preselected — press Enter to accept).
4. The scheduler (FSRS) decides when each question comes back.

### How the day stays manageable

- **Time budget.** Everything due is ranked by how close it is to being forgotten, weighted by importance (core > supporting > detail) and by how many other concepts build on it. Questions are added in that order until the budget is full. Anything that doesn't fit waits for a later day, most urgent first.
- **One question per concept per day.** Concepts have several questions (recall, explain, apply…); only one of them appears on a given day.
- **New material only when there's room.** New concepts are added only if reviews fit, capped per day (6 by default), and paused automatically if reviews were deferred today or if the coming week is already heavy.
- **Load balancing.** When a review is scheduled days out, it lands on the least-busy day in its window, so future days stay even.
- **Course status.** Each course is *Active* (reviews + new concepts), *Maintaining* (reviews only) or *Paused* (left out). Taking on more subjects means setting older ones to Maintaining, not drowning in reviews.
- **Study day** starts at 4am by default, so late-night sessions count toward the day you started.

"Study 5 more minutes" is offered after a session if there's more waiting, but coming back tomorrow does more for memory.

---

## Structure

```
Course (a book, class or subject)
└── Section (a chapter or part of one)
    └── Concept (one idea worth remembering; core / supporting / detail)
        └── Questions (recall, explain, distinguish, apply, connect)
```

Concepts are connected by **prerequisites** ("B builds on A", a DAG with cycle checks) and by **cross-course links** (related / easily confused / used together). Each link carries a one-sentence explanation. Low-confidence links show as dashed "unconfirmed" and never block anything.

New concepts are introduced from the **knowledge frontier**: a concept becomes eligible once its prerequisites have been started. Several active courses advance in parallel (round-robin).

## Question types

| Type | What you do | How it's checked |
|---|---|---|
| Recall | Produce a term or fact | Accepted answers (typo-tolerant), otherwise key points |
| Explain | Say what it is and why it matters | Key points |
| Distinguish | Tell it apart from a similar idea | Key points |
| Apply | Solve a new example, predict output, fix code | Key points (result + reasoning) |
| Connect | Explain how ideas work together | Key points |

## Question quality

Only questions worth years of repetitions get in. Every candidate question passes three filters:

1. **Rules** (no AI): drops questions that contain their own answer, yes/no questions, anything that refers to "the text", "this chapter" or a figure (it won't make sense later), recall answers that are really sentences, questions with no gradable key points, and near-duplicates.
2. **Independent review**: a separate Claude pass scores each question 1–5 on *worth remembering*, *clear on its own*, *needs real recall*, *gradable* and *accurate*. A question is kept only if it scores 4 or 5 on all five. Fixable questions are rewritten by the reviewer (and re-scored); the rest are dropped with a reason.
3. **Caps**: at most 3 questions for a core concept, 2 for a supporting one, 1 for a detail — the best-scoring, covering different question types first.

Before anything is saved you see a **Review questions** step: what passed (with its score), what was filtered out and why, and you can untick or rescue any question. Concepts left with no good question aren't added.

After import, quality keeps being enforced:
- **Report question** (the flag on every question in a session) takes it out of your sessions immediately.
- A question you miss **5 times**, or whose grading you overrule **twice**, is pulled automatically — that pattern usually means the question, not you, is the problem.
- Pulled questions wait on the Progress page (and in the concept panel), where you can **rewrite with Claude** (the new version passes the same rule checks), restore, or delete.
- Questions you write yourself get the same rule checks as advice while you type.

## Grading

Every question carries a small rubric written when the question is created: **key points** a correct answer must contain, plus common **misconceptions** that make an answer wrong.

- Recall answers that match an accepted answer are marked correct instantly.
- Otherwise the answer is graded by Claude against the rubric, on meaning, not wording. All key points and no misconception → correct; some points → partly there; otherwise not yet.
- If the grader can't tell, it asks one short follow-up question.
- Without an API key (or if grading fails) you check your answer yourself against the same key points.
- Hints and "I don't know" are recorded as help: a helped answer never counts toward mastery and caps the rating at Hard.
- "I was right" lets you overrule a grade; overrides are recorded.

If you miss a question whose prerequisite is shaky, the session adds a quick **foundation check** on that prerequisite. Missed questions come back later in the same session.

## Mastery (three separate numbers)

- **Started** (coverage): share of a course's concepts you've begun.
- **Mastered**: a concept is mastered when your last two study days with it both ended in a correct unaided answer, and — if it has an application-type question — you've answered one correctly. Course and section percentages count **core** concepts only.
- **Recall chance now**: FSRS's estimate of remembering it today.

Progress also shows success by question type (so you can see "strong recall, weak application"), answers recalled after a week or more, weak spots, and recurring misconceptions.

## Teach back

Pick a section and explain it from memory as if teaching it. Each concept is marked covered, partly, not mentioned, or incorrect. Covered concepts that were due count as reviewed; missed ones are brought forward to your next session. (If you turn on "show concept names", it's practice only.)

---

## Adding material

**Course → Add material**:

1. Paste text, drop `.md`/`.txt` notes, or drop the **book's PDF** and pick a chapter from its table of contents (page numbers are kept so each concept can cite its page).
2. Claude splits it into sections and concepts and rates each concept's importance from real signals (definitions, worked examples, warnings, things later ideas depend on) — not word frequency. Anecdotes, boilerplate and navigation are dropped. Details start unticked; untick anything you don't want.
3. Claude writes candidate questions with rubrics, an independent review scores them, and you confirm what passed (see Question quality). New concepts are then linked to your other courses in the background.

Question writing starts in the background as soon as the concepts are found, so most of it is done while you look the list over. Concepts are handled in groups of up to four, several groups at a time; ticking an extra concept only writes that one, and going back to the concept list doesn't redo finished work.

If text lost something in copying (a figure, a garbled equation), you're told instead of getting a question built on missing information.

You can also write questions yourself (Course → Add a question) with key points, accepted answers, misconceptions and a hint.

### Preparing material with another AI

The extractor handles raw chapters well; the most useful prep is simply splitting a book by chapter and adding each one as you finish it. If you do pre-process, keep: definitions, explanations with the "why", worked examples (code included, with a sentence on what it demonstrates), explicit comparisons, and common mistakes. Drop exercises' instructions, cross-references and chapter intros.

---

## Data & privacy

Everything lives locally in one file on your machine (electron-store). Settings → Export backup / Restore from backup. AI calls go directly from the app's background process to the Anthropic API with your key; the key is never readable by the UI.

This version starts from an empty library. The first time it runs, anything saved by earlier versions (old flashcards and anything converted from them) is written to a `backup-before-clean-start-<date>.json` file in the app's data folder and then removed from the app. Settings and the API key are kept.

## For developers

```
electron.cjs      main process: storage bridge, Claude calls (structured outputs), PDF IPC
pdf-text.cjs      PDF outline + page text (pdf.js)
src/lib/          pure logic, unit-tested: fsrs, planner, mastery, graph, grade, quality, model, ai
src/state/        reducer (pure, tested) + store (persistence)
src/views/        Today, Session/TaskView, Courses, Course, ConceptPanel, FixQuestion, AddMaterial, KnowledgeMap, Progress, TeachBack, Settings
tests/            node --test (logic, quality gate, reducer, main-process IPC with a stubbed API)
```

`npm test`, `npm run lint`, `npm run build`, `npm run electron` (dev), `npm run dist` (package).
