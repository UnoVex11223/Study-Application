# AeroFlash — How It Works

AeroFlash is a desktop flashcard app (Electron + React) built around one idea: **learning should be scheduled by memory science, not by feel.** You dump in notes, it turns them into flashcards, and it tells you exactly which cards to review and when — using the same spaced-repetition algorithm behind modern Anki (FSRS).

This document exists so you can paste it into another AI (ChatGPT, etc.) as context when asking it to prepare notes, summaries, or study material for you — so it understands what format and structure will actually work well inside the app.

---

## The core loop

1. **Create a Topic** (e.g. "Pointers", "Chapter 6 — Structs") — a container for related cards.
2. **Add cards** to it — manually, as cloze deletions, or by feeding notes to AI generation.
3. Hit **Review Now** for a written recall session across due topics, with up to 12 questions. Due cards come before new cards. The global new-card allowance still applies.
4. Write a short answer before seeing the reference. The grader checks every essential point, accepting equivalent wording and reasoning. A clear miss is **Not yet**; an uncertain or unavailable assessment stays **Ungraded**. Literal cloze matches can be checked offline.
5. Read the feedback and choose **Save & continue**. Correct unaided scheduled recall uses Good (or Hard if it took effort); a miss uses Again. Hinted, ungraded, self-checked and early practice do not extend review intervals. There is no speed bonus or endless retry loop.
6. Return after a gap. Insights separates written recall, explanation, application and comparison outcomes. These observations are not a whole-subject mastery score.

The first submitted answer and its feedback are saved before confirmation. Leaving before confirmation keeps an unfinished attempt without changing its schedule. A grader retry uses the same locked answer. Dispute an AI grade to leave it ungraded without a penalty.

---

## Card types

- **Basic** — a question ("front") and answer ("back"), plus 3 wrong-answer options used in multiple-choice quiz mode.
- **Cloze** — a sentence with one key term blanked out, written as `The mitochondria is the {{c1::powerhouse}} of the cell.` Shown as a fill-in-the-blank. Best for definitions, exact terms, and numeric facts.

Both types are scheduled by the same spaced-repetition system and can appear in the same Review session.

## Study modes

- **Review** — a bounded daily written-recall session, using the flow above.
- **Practice recall** — the same writing workspace within a topic, prioritizing due and new questions. Early practice is recorded separately and does not extend the schedule.
- **Flip Cards** — front/back practice with self-ratings and its existing scheduling behavior.
- **Quiz** — multiple choice with its existing right/wrong scheduling behavior. Recognition is not counted as unaided written recall.
- **Simulate** — the existing 20-question timed multiple-choice exam mode.

## Assessment and feedback

New generated cards carry one to four essential points. Older cards use their existing reference answer as a single criterion. AI assessment requires one check per criterion, a reason, and an exact student quote for present or contradicted points. Missing criteria, fabricated quotes, ambiguous references and API errors abstain. Matching words alone never awards credit. An answer must satisfy every essential point and contain no material error to be marked correct.

AI assessment is fallible. The **Dispute this grade** control leaves the attempt ungraded. Optional self-checks stay separate. Without AI, only literal cloze matches have an automatic positive check; free explanations stay ungraded. Source passages can be expanded after answering.

## Visual theme

The app uses one Frutiger Aero theme: blue/aqua gradients, translucent glass panels, glossy pill buttons, rounded inputs, soft background orbs and Nunito typography. Shared design values live in `src/aero-theme.css`; shared component styling lives in `src/styles.css`. Workspace and recall styles should use these shared values, including for feedback and dialogs, rather than introduce independent palettes. Narrow windows retain section outlines and practice controls. Reduced-motion settings apply throughout the app.

## Insights dashboard

- Day streak, activity today, cards due now, and the historical share rated Good/Easy (all modes)
- Unaided scheduled written outcomes by recall / explain / apply / compare, over the last 30 days
- Separate counts for practice/ungraded attempts and attempts at least a day after prior recorded feedback
- The last five written answers, including original text and saved feedback
- An activity heatmap and seven-day due forecast
- Scheduling maturity by topic: cards in review with estimated stability of 21+ days, explicitly not subject mastery
- Repeatedly missed cards, flagged for inspection and possible rewriting

## Gamification

XP and rank levels reward practice. Written recall earns XP only for saved, correctly recalled scheduled answers (Good or Hard), with no session-completion bonus. Assisted, early, disputed and ungraded written attempts earn no recall XP. Existing optional modes retain their historical XP behavior. XP is not a mastery measure.

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

Topics, cards, answer history, XP, streaks, and your API key are persisted **locally**, in a single file on your machine (`electron-store`, a local JSON config file). Nothing syncs to a server. AI features (card generation, typed-answer grading) call the Anthropic API directly from the app's background process using your own API key, which you set once in Settings; the key never touches the app's UI code or leaves your machine except for that direct API call. For grading, the question, reference answer, essential points, source quote and submitted answer are sent to Anthropic. Without a key, generation is unavailable and written explanations stay ungraded; exact cloze matches still work locally. There is no keyword-grading fallback. The review log keeps up to 5,000 raw entries, including written answers and feedback, plus cumulative daily activity. The oldest raw entries age out as new ones are added.

There's a "Reset All Progress" option in Settings that wipes topics/cards/XP/history in one confirmed action while leaving your API key untouched.
