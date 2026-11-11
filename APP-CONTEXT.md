# Tenax — How It Works

Tenax is a desktop study app (Electron + React) for keeping what you learn in long-term memory across many subjects at once. You add material a chapter at a time; it pulls out the concepts worth remembering, writes questions you answer from memory, and gives you the same number of questions every day.

This file doubles as context you can paste into another AI when preparing material for the app.

---

## The daily loop

1. **Today** shows one session: the same number of questions every day (20 by default, Settings → Questions per day), as a row of marks, one per question, filled in as you answer them. Under it are the courses they come from (with how many from each); the date heads the page, centred, and under the courses is one button, **Begin session** (Continue session once you've answered some). Below: the **mastery test** when one is due. Nothing else: no counts to read, no time estimates, no reminders. Notes to process and books to recall show as counts in the sidebar.
2. You answer each question by **typing from memory**. There is no multiple choice. A new concept is taught first: its **lesson** (marked New: its name, what it is, its terms as a ruled list, one worked example in a soft panel, a diagram when a picture helps, then Start), then its first questions one after another (see Ladders).
3. Your answer is graded against the question's **key points** (see Grading) and the result appears in line under your answer: one row with a small status icon and word (Correct, Almost, Not quite; never colour alone) and the XP it earned on the left and one **Next** button (Enter) on the right; when you missed, the right answer follows under a hairline, centred, with the overrule link centred under it. Tenax grades the answer itself, so it schedules the review from the grade (right is a good review, right but slow or partly right a hard one, wrong a miss): no rating buttons, since rating yourself tends to be generous. A quiet link overrules a grade you disagree with. The screen stays bare: no progress bar, the question centred in large type, an answer field below it with no hint about the answer's form, then Check centred under the field with a quiet I don't know beneath it; a flag for reporting the question shows when you point at it.
4. The scheduler (FSRS-6, the current version of the algorithm behind Anki's scheduler) decides when each **concept** comes back. Memory is scheduled per concept, not per question: a concept's questions are the steps of its ladder, and each review asks one of them, so extra steps add depth without adding review time. Same-day answers count too: getting a new concept right twice in its first session, or missing one again while you relearn it, changes how soon it comes back. Schedules from earlier versions carry over unchanged.

### How the day stays manageable

- **The same number every day.** Questions you answer in today's sessions count toward the day; practice, teach back and a missed question asked again in the same session don't.
- **What can't wait comes first.** Same-day relearning, then every review that's starting to slip (its recall chance is 5 points or more under your memory target), most urgent first: how close it is to being forgotten, weighted by importance (core > supporting > detail) and by how many other concepts build on it.
- **An even mix (Settings → Daily mix: Even, the default).** The rest of the day is dealt out one question at a time to whichever course has had the fewest so far, so every course you're studying shows up every day instead of the one with the most material filling it. A course takes its turn with its next due review, or, once all of its due reviews are in, with a new concept. A review that's due but still well remembered can wait a day or two for the mix: recall fades slowly around the due date, so a short wait costs very little, and once it starts to slip it's in the step above. A course with less to ask gives its turns to the others. With **By what's due** the day goes to the most urgent reviews anywhere first, then new concepts in turn. Today says how many reviews are waiting and why.
- **The rest of the day is filled.** Once everything due is in and new concepts have had their room (see below), reviews coming up soonest (in the next two weeks) are brought forward, courses taking turns again (a course with nothing in the next two weeks offers what it's been longest since you saw), so the day still has its full number and the days ahead get lighter. Only when there's nothing left to ask is the day shorter, and Today says so.
- **Easily confused ideas, back to back.** Two concepts linked as "easily confused" (say, a C pointer and Hack's A register) are asked one right after the other when both are in a session, and when the day is being filled, the partner of a concept already in it comes first. Contrasting two similar ideas side by side is when mixing helps memory most (Brunmair & Richter's 2019 meta-analysis of interleaving: the benefit is largest for similar categories presented in immediate succession).
- **One question per review, up the ladder.** When a concept is due, one of its steps is asked: a new concept starts on its lowest step, a question you just missed comes back while you relearn it, and otherwise the lowest step you haven't answered right yet (so you climb a step a review, and a missed step is asked again next time). Once every step is climbed, the steps take turns, the one asked longest ago first, so the vocabulary comes back too. Your answer reschedules the whole concept.
- **New material only when there's room.** New concepts are capped per day (6 by default), shared between your Active courses, and paused automatically if a slipping review was left for tomorrow or if the coming week (counting reviews that waited today) already has close to your daily number of reviews each day.
- **Load balancing.** When a review is scheduled days out, it lands on the least-busy day in its window, so future days stay even.
- **Course status.** Each course is *Active* (reviews + new concepts), *Maintaining* (reviews only) or *Paused* (left out). Taking on more subjects means setting older ones to Maintaining, not drowning in reviews.
- **Study day** starts at 4am by default, so late-night sessions count toward the day you started.

Once the day's questions are done, **5 more** is offered if there's anything worth asking, but coming back tomorrow does more for memory.

---

## Structure

```
Course (a book, class or subject)
└── Section (a chapter or part of one)
    └── Concept (one idea worth remembering; core / supporting / detail), with a lesson
        └── Questions: a ladder of steps (term, fact, use, twist, combine)
```

Concepts are connected by **prerequisites** ("B builds on A", a DAG with cycle checks) and by **cross-course links** (related / easily confused / used together). Each link carries a one-sentence explanation. Low-confidence links show as dashed "unconfirmed" and never block anything.

New concepts are introduced from the **knowledge frontier**: a concept becomes eligible once its prerequisites have been started. Several active courses advance in parallel (round-robin).

## Ladders

A concept's questions are a **ladder**: small steps, simplest first, each testing one piece of knowledge and adding one thing to the step below, the way a tutor breaks an idea down (and the way Math Academy builds a topic from small knowledge points).

| Step | What it asks | Typical question |
|---|---|---|
| 1 Term | The vocabulary: produce the term from its meaning, or say what a term means in one sentence | "Which keyword declares a variable that's defined in another file?" |
| 2 Fact | One rule, property or behaviour | "How many times may an external variable be defined in a whole program?" |
| 3 Use | A small new problem with exactly one right answer | "`a.c` has `int count = 0;`. What line must `b.c` have before using `count`?" |
| 4 Twist | An edge case, a pitfall, or the difference from a look-alike | "Two files both contain `int count = 0;` at file scope. What happens at link time?" |
| 5 Combine | This idea with one it builds on | A small problem that needs both |

A core concept gets steps 1–4 (and 5 when there's a natural combination), a supporting one 1–3, a detail 1–2; a step that would be forced or trivial is left out.

- **One answer target.** Every step asks for exactly one thing, and says what form the answer takes ("one word", "a number", "what it prints", "one line of code"), shown under the question. "…, and why?" is two questions: the why goes in the model answer, which you read after answering. Steps 1–4 have a single key point.
- **Teach, then test.** Before a concept's first question you see its lesson: its summary, the terms it introduces with a one-line definition each, one worked example and, when it helps, a diagram. Then its first steps are asked one after another (up to three), stopping at the first miss. Those extra steps don't count toward the day's number.
- **Climbing.** Each review asks the lowest step whose last answer wasn't right without help (see "One question per review"). A concept's panel shows its ladder with each climbed step ticked; the session summary lists the steps you climbed.
- **Terms drill** (not offered on the course page for now; practice happens on Today): the first step of every concept you've started, rapid-fire, the ones you're shakiest on first. A term, value or line of code is checked as you press Enter. It's practice: it counts as a review of each concept but not toward the day's number. A course's **Terms** section lists every term its lessons introduce, A to Z.
- **The subject, not the book.** Questions are about ideas you'd use, on fresh examples, never about the internals of the book's own sample programs.

### Diagrams

A question or a lesson can carry a diagram when a picture is the clearest way to pose it. Claude doesn't draw: it writes a small description, and Tenax checks it and draws it in the app's colours (light or dark). Four kinds:

- **Logic circuits**: gates (AND, OR, NOT, NAND, NOR, XOR, XNOR, MUX) wired from named inputs to outputs, with the inputs' values shown and the output asked about drawn as "?". The circuit is **simulated**, so a question whose answer disagrees with its circuit is rejected before you ever see it. Wires that skip a column run in their own lane, never behind a gate.
- **Memory**: variables, arrays, structs and list nodes as boxes of cells, with arrows for pointers (side by side for linked lists).
- **Bits**: a binary word with bit numbers and labelled fields (an instruction format, say), "?" for the bits to work out.
- **Trees**: binary trees keep left and right apart (a search tree after some insertions, a parse tree).

The grader and Go deeper are given the diagram's description, since they can't see the drawing. A fresh version of a question with a diagram gets a new diagram, never the old one. Small tables (truth tables) can also be written right into a question or lesson.

## Question types

Each step is one of these kinds:

| Type | What you do | How it's checked |
|---|---|---|
| Recall | Produce a term, fact or value | Accepted answers (instantly), otherwise key points |
| Define | Say what a term means, in one sentence | Key point |
| Explain | Say how or why, in a sentence or two | Key points |
| Distinguish | Tell it apart from a similar idea | Key points |
| Apply | Solve a new example, predict output, write a line of code | Accepted answers when there's one exact result, otherwise key points |
| Connect | Use ideas together | Key points |

## Question quality

Only questions worth years of repetitions get in. Every candidate question passes three filters:

1. **Rules** (no AI): drops questions that contain their own answer, yes/no questions, anything that refers to "the text", "this chapter" or a figure from the book (it won't make sense later), recall answers that are really sentences, questions with no gradable key points, and near-duplicates. Ladder questions also must ask for one thing (no "…, and why?", no "the two steps…", no second question mark outside code, and one key point on steps 1–3), and a diagram must be one Tenax can draw, whose circuit agrees with the answer; a question can only say "shown below" when it has a diagram.
2. **Independent review**: a separate Claude pass scores each question 1–5 on *worth remembering*, *clear on its own*, *one thing at a time*, *needs real recall*, *gradable* and *accurate*, works code and circuits out itself, and checks each concept's ladder as a whole (simplest first, one new thing per step, no two steps testing the same thing). The vocabulary of an important idea counts as important. A question is kept only if it scores 4 or 5 on everything. Fixable questions are rewritten by the reviewer (most often: two questions cut down to one) and re-scored; the rest are dropped with a reason.
3. **The ladder**: the best-scoring question at each step, lowest step first, up to 5 steps for a core concept, 3 for a supporting one and 2 for a detail.

Before anything is saved you see a **Review questions** step: what passed (with its step and score), what was filtered out and why, and you can untick or rescue any question. Concepts left with no good question aren't added.

**Rebuild as ladders** turned questions written before ladders into ladders (Claude wrote each concept's whole ladder, keeping a current question with its history where it was already one clear step). Every course has been rebuilt and new material always comes as ladders, so it's no longer offered; a rebuild that was mid-batch when you updated still finishes.

After import, quality keeps being enforced:
- **Report question** (the flag on every question in a session) takes it out of your sessions immediately.
- A question you miss on **5 different days**, or whose grading you overrule **twice**, is pulled automatically — that pattern usually means the question, not you, is the problem.
- Pulled questions wait in **Questions to fix** ("Fix reported questions" in search opens it; each concept's panel lists its own), where you can **rewrite with Claude** (the new version passes the same rule checks), restore, or delete.
- Questions you write yourself get the same rule checks as advice while you type.
- **More questions** (on a course's Sections header, or inside a chapter) tops up concepts that have fewer steps than their ladder allows: Claude sees the questions a concept already has (and their steps) and writes the missing steps, through the same review and ladder. What passes is added automatically, with a lesson for a concept that had none.

## What the AI costs, and how it's kept down

- Heavy work (finding concepts, writing and reviewing questions, linking, notes, writing tests for code questions) uses Claude Opus; grading, Go deeper and fresh versions use Claude Sonnet, which is fast and a fraction of the price. Reviewing and rewriting questions run at high effort (more thinking), since that's where question quality is decided.
- **Question writing** (Settings → AI and cost) trades care for cost: **Thorough** (Opus thinking more, the default), **Standard** (Opus at its usual effort) or **Economy** (Sonnet writes, at half Opus's price per token). The reviewer is the same at every level, so every question passes the same gate. Output is what costs most (Opus charges five times as much for what it writes as for what it reads), so the writer is told to write one question per step and keep every field short, and leaves out misconceptions on exact-answer steps, where grading never uses them.
- **What it has cost** (Settings → AI and cost): every call's token counts are noted in `ai-usage.jsonl` in the data folder (90 days kept), and Settings shows the last 30 days by activity (writing questions, reviewing them, grading…) and how much of the input came from the prompt cache. Worked out at list prices; the Anthropic Console bill is the exact figure.
- System prompts are cached, so the instructions repeated across an import or a study session are billed at a tenth after the first call. The long lists sent with linking and notes (concepts you already know) are cached too.
- The reviewer only writes out revisions for questions it actually revises, not empty fields for every question.
- Linking only compares new concepts with your *other* courses (within a course, prerequisites come from extraction), and is skipped when there's nothing else to link to.
- Notes send the concepts most likely to match with their summaries and the rest by name only.
- Book imports and rebuilds use the Batch API at half price (see Importing a whole book, and Rebuild as ladders). Grading answers costs less with ladders too: a term, value or line of code that matches its accepted answers is marked without calling Claude at all.

## Grading

Every question carries a small rubric written when the question is created: **key points** a correct answer must contain, plus common **misconceptions** that make an answer wrong.

- An answer that matches an accepted answer (a term, a value, what a snippet prints, a line of code) is marked correct instantly. Words allow a small typo; code and output must match character for character, apart from spacing and a trailing semicolon, so `*(ip++)` never passes for `(*ip)++`. When every accepted answer is a number and yours is a different number, it's marked wrong instantly. A question with accepted answers has a smaller answer box, and Enter checks it.
- Otherwise the answer is graded by Claude against the rubric, on meaning, not wording. All key points and no misconception → correct; some points → partly there; otherwise not yet.
- If the grader can't tell, it asks one short follow-up question.
- Without an API key (or if grading fails) you check your answer yourself against the same key points.
- "I don't know" is recorded as help: a helped answer never counts toward mastery and caps the rating at Hard.
- "I was right" lets you overrule a grade; overrides are recorded.

If you miss a question whose prerequisite is shaky, the session adds a quick **foundation check** on that prerequisite. Missed questions come back later in the same session.

## Mastery (three separate numbers)

- **Started** (coverage): share of a course's concepts you've begun.
- **Mastered**: a concept is mastered when you've proven it in a **mastery test** (below) and haven't missed it since. Course and section percentages count **core** concepts only.
- **Recall chance now**: FSRS's estimate of remembering the concept today.

### The mastery test

A concept is **ready** to be proven when your last two study days with it both ended in a correct unaided answer, it has been right on at least two days, any application-type question it has has been answered right, and the first of those answers is at least a week old (it has held). Once a week, when at least **20** concepts are ready, Today offers a **Mastery test**: 20 questions, one per concept (the ones ready longest), each the hardest step of its ladder that can be marked without running code, in mixed order. Nothing to lean on: no lesson, no fresh wording, no report flag, and no feedback until the end. Answers are marked in the background while you go on (exactly against accepted answers where there are some, otherwise by Claude, with no follow-up questions). At the end you see your score, which concepts are now mastered, and for each miss the question, your answer and the model answer. A right answer masters the concept and counts as a good review; partly right counts as a hard one and anything else as a miss, and those go back into your reviews until they're ready again. If you've taken a test, Today says when the next one opens once enough is ready.

Mastered concepts still come back for reviews, further and further apart (months, eventually): memory fades without retrieval, and an occasional check is cheap. Missing one takes away the mastered mark until it passes a later test.

### XP and ranks

Every answer earns XP: 10 for right without help, 5 for partly right, and 50 for each concept proven in a mastery test. It's worked out from your answers, so it covers everything since you started and syncs with them. A right answer shows "+10 XP" beside the verdict, and a session's summary shows your rank as one line with the XP you just earned (a new rank named in gold, with its own sound).

XP buys **ranks** on a plain ladder: Novice, Apprentice, Scholar, Expert, Master and Sage, each in three tiers (Novice I, II, III, then Apprentice I, …). Sage has no last tier (after Sage III comes Sage IV, and so on), so there is always a next rank. Rank r starts at 100·r² XP, so each takes a little longer than the last: Apprentice I at 900, Scholar I at 3,600, Expert I at 8,100, Master I at 14,400, Sage I at 22,500. The **Ranks** page shows only your rank, in the middle of the page inside a thin ring that fills toward the next one, with how much XP that is; a session's summary says the XP you earned and your rank in one line ("Now …" in gold, with its own sound, when it's a new one).

**Progress** shows one figure, how many days in a row you've studied (it counts today once you've answered something and yesterday until then), and under it the last six months of study days, one square per day, darker for more answers. How each course is going is on its own page.

## Training harder

A handful of things push practice past plain recall. Most of them work in the background; what you see is one toggle, a "Go deeper" link and, on a miss, an optional row of reasons.

- **Implicit review.** A right, unaided answer (Good or Easy) on a concept also partly reviews the concepts it builds on (its confirmed prerequisites), the way Math Academy's "fractional implicit repetition" does. Each prerequisite's memory moves part of the way towards what a real review would give, more when it was close to due and almost nothing when it was reviewed recently; its due date only ever moves later, it isn't logged as an answer, and it happens at most once a day. So practising advanced ideas keeps the basics under them warm without asking them separately. The session summary lists what was reviewed along the way.
- **"I'm sure."** Ctrl+Shift+Enter checks an answer as one you're sure of (there's no button, to keep the screen bare). A miss you were sure about comes back a little sooner in the session: correcting a mistake you were confident about is when the correction sticks best (the hypercorrection effect).
- **Pace.** Tenax times how long you take to answer (before grading). Once it has eight right answers of a kind, a right answer that took more than twice your usual time (and at least 30 seconds more) is marked **Slow** and Hard is suggested instead of Good: it isn't fluent yet. Before that, a generous allowance per question type is used.
- **A wrong belief** the grader finds in an answer makes Again the suggested rating, even when part of the answer was right.
- **Go deeper** (interviewer-style follow-ups) is no longer shown on the answer screen, to keep it bare.
- **Fresh versions** (Settings → Fresh versions, on by default). An apply or distinguish question you've answered before comes back with a new example (new values, a new snippet, a different pair, a new circuit), so you practise the idea rather than recall the old answer. It keeps the original's step and the form of its answer. Versions are written a few questions ahead by the faster model and go through the same rule checks as any question; if one isn't ready in time, or fails the checks, the stored question is asked. A missed fresh version comes back unchanged in the same session. The flag on a fresh version offers **Use the original question** instead of reporting it.
- **Pretests.** (Not offered on the course page for now.) A section none of whose concepts you've started could be pretested: up to five of its core ideas, one basic question each, before you study it. Trying first makes the material stick better afterwards.
- **Workload forecast.** While a course is Maintaining or Paused, its page says what Active would mean: about how many new concepts a day (its share of your daily cap) and how many of your daily questions it would take within a month, if you get most of them right.

### Code questions

A question can carry **tests** (Edit question → Add tests), in Python, C or JavaScript. Your answer and the tests are written to one file and run on your computer; the question is right when the program exits cleanly (a failing assert exits otherwise). The tests decide the verdict instead of the key points, and you see the output: the failing assert, a traceback or the compiler's errors.

- **Write tests with Claude** drafts tests from the question and model answer, then runs them against the model answer; only tests the model answer passes should be relied on (Check against the model answer does the same for tests you write).
- Python runs with whichever of `python3`, `python` or `py` is installed; C builds with `gcc`, `clang` or `cc`, or with `gcc` inside WSL on Windows when there's no compiler on Windows itself; JavaScript runs on Tenax's own Node.js. Every run is limited to 10 seconds, in a fresh temporary folder that's removed afterwards.
- If the language isn't installed on a computer, the answer is graded against the key points instead and you're told why.
- Code answers are typed in a monospace box where Tab indents. A code question never gets a fresh version.

## Teach back

(Not offered on the course page for now.) Pick a section and explain it from memory as if teaching it. Each concept is marked covered, partly, not mentioned, or incorrect. Covered concepts that were due count as reviewed; missed ones are brought forward to your next session. (If you turn on "show concept names", it's practice only.)

---

## Adding material

**Course → Add material**:

1. Paste text, drop `.md`/`.txt` notes, or drop the **book's PDF** and pick a chapter from its table of contents (page numbers are kept so each concept can cite its page).
2. Claude splits it into sections and concepts and rates each concept's importance from real signals (definitions, worked examples, warnings, things later ideas depend on) — not word frequency. Anecdotes, boilerplate and navigation are dropped. Concepts are kept broad: closely related facts (syntax, rules, pitfalls of one idea) are one concept, so a dense chapter gives roughly 12–25. Details start unticked; untick anything you don't want.
3. Claude writes candidate questions with rubrics, an independent review scores them, and you confirm what passed (see Question quality). New concepts are then linked to your other courses in the background.

Question writing starts in the background as soon as the concepts are found, so most of it is done while you look the list over. Concepts are handled in groups of up to four, several groups at a time; ticking an extra concept only writes that one, and going back to the concept list doesn't redo finished work.

If text lost something in copying (a figure, a garbled equation), you're told instead of getting a question built on missing information.

You can also write questions yourself (Course → Add a question) with key points, accepted answers, misconceptions and a hint.

### New course from a paste

**Courses → Import course** starts from your notes: a guide, a set of notes, a transcript (pasted, or dropped `.md`/`.txt` files). One paste can make several courses. Drop a book's PDF there instead and it goes to the book import below.

1. **Sort into courses.** Claude reads the paste (as numbered lines, long ones cut short, so even a long guide is one cheap call) and sorts it into courses and chapters. A course is one subject: fields people study on their own (databases, security and identity, a framework or language like React or Python, data engineering) get their own course when the paste gives them a chapter or more, while foundations covered on the way (how processes, networks or HTTP work, in a web guide) stay in the main subject's course. Material for a course you already have goes into it. The paste's own headings are the chapter boundaries; self-check questions stay with their chapter; a table of contents, "how to use this guide" and the like are left out.
2. **Look it over.** Rename a course, untick a chapter. Naming a course like one you have (or like another in the list) merges them. The page shows a rough time and cost.
3. **Create.** The new courses appear at once and the rest runs in the background exactly like a book import (below): one import, in the paste's order, so a later chapter in any of the courses builds on earlier ones as prerequisites instead of repeating them; question writing goes through half-price batches by default. A pasted chapter has no pages and nothing to mark as read: it's unlocked, and its concepts are introduced a few a day like any new material.

Notes are much denser than book pages: about one concept per 250–500 characters (a 10,000-character guide gave 26 concepts and about $1.60 of questions at full price, November 2026). The estimate works from that.

### Importing a whole book

**A book's PDF** (dropped on Import course) does every chapter at once:

1. Chapters are found from the PDF's table of contents (chapters inside "Part" entries are picked out; preface, index, appendices and similar are unticked). A PDF without one lets you type each chapter's start page.
2. Tick the chapters you've already read. Everything else is **locked**.
3. The import runs in the background, in reading order. Each chapter's concepts are extracted knowing the earlier chapters', so later chapters point back at earlier ideas as prerequisites (the book's map) instead of recreating them. Question writing for up to two chapters runs alongside, and chapters appear on the course page as they finish. Closing the app pauses the import; it picks up where it left off (a chapter that was mid-way starts over). Two API failures in a row pause it with the error shown.
4. **Mark as read** on a chapter unlocks it. A locked chapter never comes up in sessions, doesn't count in course totals, and its prerequisites don't hold back chapters you've read out of order. Unlocking doesn't dump the chapter on you: its concepts join the queue and are introduced a few a day like any other new material.

Cost: by default (Settings → Book imports and rebuilds: **Half price**) question writing and review go through Anthropic's Batch API: the same models and prompts at half the price, with each chapter usually taking a few extra minutes (occasionally up to an hour). Since ladders (about twice as many, shorter questions plus a lesson per concept, written at higher effort) the estimate is roughly 2–4 cents per page that way (about $8–16 for a 400-page book), or 3.5–7 cents at full speed; it was 1.5–2.5 and 2–4 cents before, and the new figures are an estimate, not yet a measurement. An import that's closed mid-batch picks the same batch back up; anything a batch can't handle is redone live.

### Notes

**Notes** (in the sidebar, or Ctrl+Shift+N from anywhere) is for what you pick up outside a course: projects, documentation, work.

- **Capture** a note in the box (with an optional project or topic), or **upload** .md/.txt files (the button beside it, or drop them on the box); each bullet or paragraph becomes a note, with its heading as context. Keep one running notes file per project and upload it whenever you've added to it: notes you've added before are recognized and skipped.
- **Process** the inbox: Claude checks each note against everything you study and decides:
  - *new idea* → a concept filed under an **area** (a broad field, the size of a university course: "Web development", "Security", "Databases"…) and a topic within it, the size of a chapter ("Authentication", "REST APIs"…), linked to related concepts from your courses on the map. A handful of areas is meant to hold everything, so a tool or technique is a topic, never an area of its own;
  - *something you already study* (in any course, or from an earlier note in the same batch) → left out; a note with nothing new is skipped and says what already covers it;
  - *skip* → to-dos, project-specific details, anything that looks like a secret, or too vague to recover an idea — with the reason, and **Keep anyway** (which also brings in an idea you already have).
  Terse notes are completed so they stand alone and marked *filled in by Claude — check it*; a note that's wrong is corrected and says so.
- **Review** before saving, like adding material. An idea that starts a new area is marked *New area*.
- **Delete** a note with the bin at the end of its row: the concepts made from it go too, with their questions and review history, and an area left empty is removed (you're asked first). **Clear skipped notes** removes every skipped note at once.

Each area is a course of its own, made the first time a note needs it: its own row on Today, its own page, its own system on the map. Areas are listed on Notes and on Courses (marked *From your notes*), and can be paused, practised, added to or deleted like any course. A book or course you added yourself is never changed by a note.

**Regroup** (beside Areas) has Claude put your topics into a few broad areas, for when they've spread too thin. A narrow area joining a broad one usually becomes one of its topics ("Git › Branching" and "Git › Rebasing" become the topic "Git" in "Software engineering"), topics on the same subject merge, and an area left empty is removed. An area keeps its course when it's renamed, so its colour stays, and concepts keep their review history wherever they move.

Libraries from earlier versions, which kept every note in one "Notes" course, are split on first start: each of its topics becomes an area, with its concepts and their review history. Those areas are as narrow as the old topics were, so **Regroup** once afterwards.

### Shelf

The Shelf page stands every book, textbook and course you're working through on shelves, as books: the cover, with page edges, a spine and a thickness that follows its length (pages, or about 30 pages per chapter or module), standing on a plank. They face you, turned just enough to show the edge of their pages. Every book is drawn the same size, so the shelf reads as even rows (the spine view keeps a real bookcase's mix of heights). The title is on the cover, so under each book is only how far along you are. **Shelf** is centred at the top in large type, with the tabs centred under it: **Textbooks**, **Reading** (books you read for their own sake) and **Courses**; the shelf opens on the first one with something in it. When recalls are due, a small **Recall** button under the title says how many.

Clicking a Tenax course's book flies it off the shelf into the course page's header, where it lands as the cover beside the course's name. Books are set down on the shelf one after another when the page opens or you switch tabs. Pointing at one lifts it and turns it toward you, and the rest of the shelf quietens a little; the **⋯** on the book has Edit and Hide (a Tenax course) or Remove. Logging a chapter with **+** swings the cover open for a moment. A book due for a recall has a ribbon bookmark hanging out of the top, and a book you want to read but haven't started has a faded cover. With reduced motion turned on in the system, none of it moves.

- **Reading**: a book's author, pages read out of the total, a status (reading, finished, want to read), dates and, once finished, a star rating.
- **Textbooks and courses**: your Tenax courses are on the shelf automatically (an imported book as a textbook, a course you built as a course; either can be changed in Edit). Anything else, like a video course or a textbook you aren't studying in Tenax, you add yourself and count with + and − (they appear when you point at the book); it's in progress or finished. These cards show the cover and progress only, with no description.

The first place on every tab is an empty one with a **+**: it adds a book of that tab's kind (the form still lets you pick another). Something you added yourself can be changed to another kind in Edit.

**Covers.** In Add or Edit, **Find a cover** looks the title (and author, if there is one) up on Open Library and shows up to eight covers from the editions it finds, most-printed first; pick one and it's downloaded and saved like any picture. Typing an ISBN as the title finds that exact edition. You can also choose an image, or drop one onto the cover. The search runs only when you click the button, and sends Open Library just the title and author.

**Covers only.** The shelf shows covers; the spine view and the year button are hidden for now (the year still opens from search: "2026 on your shelf").

**Year on the shelf.** "2026 on your shelf" in search shows what you finished that year: how many books, pages read, textbooks and courses finished and your average rating, the finished books stacked into a pile, and the months they fall in.

Covers are scaled down to 560px JPEGs (tens of KB) before they're saved, so they don't bloat your library or the sync folder. On the shelf (and in the book panel, recall and edit form) they're shaped as book covers:

- A plain margin around the picture, like the paper around a scanned cover or a page background around a screenshot, is cropped off when it runs along two or more sides in the same colour and ends at a clear edge. A single band on one side is left alone, since it's usually part of the design.
- Every picture fills the whole front. One of another shape (a square photo, a course banner, a tall poster) is made 2:3 one of two ways:
  - **extended**, when the sides it's short of are plain (a background colour or a soft gradient, as on most covers): those edges are carried on outward, so the whole picture shows, title and all;
  - **cut**, when they're busy: cut where the picture has the most detail (lettering, faces), not just its middle. In Add or Edit, drag the picture (or use the arrow keys) to choose what shows.
  Covers are saved the way they're shown, already 2:3. Pictures added before this change are fixed the same way wherever they're shown, and saved that way the next time you edit them.
- A book without a picture gets a plain cloth cover with its title and author, in one of the palette's deep tones or its paper white (always the same one for a title). A long title is set smaller so all of it fits.

For a Tenax course, progress is the number of chapters read in Tenax (chapters of an imported book count once you mark them read) or the number you log yourself, whichever is higher, so chapters you read before you started using Tenax count too. An imported book knows how many chapters it has. A course you build a chapter at a time doesn't, so it shows "3 chapters done" with a Set total link rather than calling itself finished just because you've caught up. Hiding a course only takes it off the shelf (Hidden from the shelf at the bottom brings it back); deleting a course keeps its shelf card with the progress it had.

When books were split into reading and textbooks, anything linked to a Tenax course or brought over from AeroShelf became a textbook, and books from the old Reading tab, or with an author, rating or notes, became reading.

**Notes, ratings and recall (Reading only).** Clicking a book opens three short notes in your own words: **What it's about**, **What I thought** and **Ideas worth keeping**; they save as you type. They aren't shown on the card, so they don't give the answer away before a recall. Textbooks and courses have none of this: the ones in Tenax have real questions instead.

Once a book has notes, Tenax asks you to recall it now and then: you write (or just think through) what you remember, then **Show my notes** and say how it went: *Forgot most of it*, *Fuzzy*, *Remembered it* or *Easy*. The first recall is 3 days after your notes; after that the gap grows with how well you remembered (remembered: about 2.5× the last gap, at least a week; easy: 3.5×, at least two weeks; fuzzy: a little longer; forgot: two days), up to a year. Anything you wrote during a recall can be added to the notes, dated, so your thoughts build up over time. Due recalls show as a count on Shelf in the sidebar, a **Recall** button on the Shelf page and a line on Today; they're extra practice, separate from the daily session and its questions, and use no AI.

### Preparing material with another AI

The extractor handles raw chapters well; the most useful prep is simply splitting a book by chapter and adding each one as you finish it. If you do pre-process, keep: definitions, explanations with the "why", worked examples (code included, with a sentence on what it demonstrates), explicit comparisons, and common mistakes. Drop exercises' instructions, cross-references and chapter intros.

---

## Knowledge map

A sky of solar systems in 3D, drawn like a real orrery. Each book or course is a star (near-white, leaning a little toward the course's colour, a little bigger the more it holds) with its name beneath it; its chapters are hairline orbits on a slightly tilted plane (the first chapter innermost, fainter for chapters you haven't read) and its concepts are planets going round them, sized by importance. Inner orbits turn faster.

Everything is flat, like the rest of the app: no glow, no stars, no lighting. A book's sun is a flat disc in its course's colour; a concept's planet is a flat disc whose colour says how well you know it: full colour mastered, softer while you're learning it, grey not started, small and dark in a chapter you haven't read. Slipping isn't shown for now.

- **No memory fog for now.** Planets you're starting to forget look like the ones you're learning.

Links between books are one thin line between their systems, with how many links it stands for. A planet's own links appear as arcs when you point at or open it, with its linked planets' names, and a thin ring marks the planet you're pointing at. Names come in as you get closer: book names always, the planet you're pointing at always (in full), core concepts' names next, then the rest, without overlapping.

Behind it all is the app's own dark ink, nothing else. The flat map on computers without WebGL 2 is drawn the same flat way. Around it there is only the title and the legend (Mastered, Learning, Not started), centred along the bottom: no buttons.

**Moving around:** drag to move across the sky, scroll to zoom (towards the pointer), and right-drag (or Shift-drag) to turn it. The map is for looking: pointing at a planet brings the sky to a stop and lights up it and its links, but planets can't be clicked (a concept's details are on its course page; **Show on map** there lights it up here). Clicking a sun or a book's name flies to its system. Pick a single course to see just its system, or switch it to **Prerequisites** for the left-to-right chart of what builds on what. With reduced motion turned on in the system, the sky stands still and the camera jumps instead of gliding.

Drawn with three.js (WebGL 2), which loads the first time you open the map. Planets are one instanced mesh with their own shader, so hundreds of them cost one draw call. On a computer that can't do WebGL 2 the map falls back to the flat sky from earlier versions (no fog, time-lapse or paths there). The layout is in `src/lib/orbits.js`, what a day of the time-lapse looks like in `src/lib/timelapse.js`, and learning paths in `src/lib/graph.js` (all pure and unit-tested); the 3D engine is `src/ui/sky3d.js`.

## Look and feel

- **Title bar.** The window has no frame of its own: the bar at the top holds the Tenax mark at the left and a gear for **Settings** at the right, and is where you drag the window. The system's minimise, maximise and close buttons sit at its right end (traffic lights at the left on a Mac), coloured to match the theme.
- **Search and commands (Ctrl+K).** Nothing on screen; the shortcut opens it. Type to find any course, chapter, concept, book on the shelf or note in your inbox, or run an action: start today's session, recall books, capture a note, create a course, import a book, add to the shelf, switch theme, turn sounds on or off, sync now. Every word you type has to match, as a whole word part or as the first letters of words ("ptf" finds "Pointers to functions"); the group with the best match comes first. Arrow keys move, Enter opens, Escape closes. A concept opens its panel on its course page, a chapter opens on its course page, a book opens its notes on the shelf.
- **Motion.** One set of timings and curves throughout. Pages crossfade and the new one rises into place; the highlight in the sidebar slides to the page you picked; a book flies from the shelf into its course; a study session slides up over everything and back down when it ends; panels and dialogs slide or fade out when you close them. With reduced motion turned on in the system, everything changes at once.
- **Style.** One system on every page, in the spirit of Linear and Vercel: neutral greys, hairline borders instead of heavy fills, two corner radii (8px for controls, 12px for panels) and one spacing scale on a 4px grid. The title bar, sidebar and page share one background; a hairline under the title bar and one beside the sidebar tell the parts apart. Each page's content sits on the same kind of card (panel colour, hairline, 16px corners): the day's session on Today, the list of courses, the activity grid, the settings groups, the answer field and the result. Top-level pages (Today, Courses, Notes, Progress, Knowledge map, Shelf, Settings) have their title centred in large type, with the page's one action centred under it. There is no brand colour: the one thing to do next (Start, Continue, Check) is a button in the text colour itself, light on dark or dark on light. The only hues mean something: green for right, amber for almost, red for wrong, and each course's own colour on the knowledge map. Books without a cover are bound in one of a few deep, muted bookcloths.
- **Type.** One family, Inter, for everything, with its optical sizes so titles and small labels are each drawn for their size; weight and size do the work a second typeface used to. Geist Mono only for code. One scale throughout: 12, 13, 14 and 15px for the interface and reading, and 17, 21 and 26px for names, questions and page titles.
- **Numbers.** Kept to a minimum: a course and the course list show how much is mastered and nothing else; Progress shows three figures and its activity grid; a session ends with one line (how many right, how many steps climbed) and your rank; XP shows beside a right answer; buttons carry no keyboard hints (Enter and Ctrl+Enter still work).
- **Layout.** As little as possible on every screen; anything less used is under a ⋯ menu. Every page has the same header (a way back when there is one, the title, its actions at the right); The sidebar is one compact list: the pages you study with, then the ones you look back on, then the Shelf; Settings is the gear in the title bar. Settings sits in the middle of the window as a list of group names; clicking one opens its controls (one group open at a time), with no explanations under them. The Courses page has one button, **Import course**. A course is laid out on one centre line: the way back and its ⋯ at the top, then its name, its book and whether it's Active, Maintaining or Paused, then its chapters across the page, each with how much is mastered; its ⋯ menu holds only the status, Edit course and Delete course (which asks first, saying what would be lost, with Cancel focused). Practice happens on Today. A chapter opens to its concepts; its own ⋯ menu can lock it until read (a book's chapter) or remove it. The list of courses shows each course's name and how much is mastered.
- **Themes.** Settings → Look and sound: Dark (near-black greys), Light (white with grey chrome) or Match system. The knowledge map is always night.
- **Sounds.** Off unless you turn them on (Settings → Sounds, or from search). Answers sound like a plucked string (a koto, more or less), always in the same pentatonic scale: two notes rising for a right answer, one low muted note that sinks a little for a miss (noted, not scolded), a run up the scale over a soft bell when a mastery test masters something, and three notes up with a high shimmer for a new level. A paper rustle when you log a chapter on the shelf, and a low chime when a session ends. They're synthesised as they play (Karplus–Strong), so there are no sound files.

## Data & privacy

Everything lives locally on your machine, in a SQLite database (`tenax.db`), and a copy is saved automatically once a day in a `backups` folder next to it (the last 14 are kept; Settings → Your data → Open folder). The data folder is `%APPDATA%\aeroflash` on a computer that ran earlier versions (kept so nothing moves when the app is renamed) and `%APPDATA%\Tenax` on a fresh install; `config.json` there only holds small settings (the encrypted API key, the sync folder). The API key is encrypted with your user account (Windows DPAPI / macOS Keychain) and isn't included in backups. Settings → Export backup / Restore from backup. AI calls go directly from the app's background process to the Anthropic API with your key; the key is never readable by the UI. **Find a cover** on the shelf sends the title and author you typed to Open Library, only when you click it.

- **Each change is saved on its own.** Answering a question writes that review and that concept, not the whole library, a quarter of a second after the change. Each save is a transaction, so a crash or power cut leaves the last saved version, never half of one.
- **Nothing is lost quietly.** If a save fails (a full disk, a folder that's become read-only), the change is kept and tried again, with everything since the last good save, and a notice in the corner says so until it works. The last save as the window closes waits until it's written.
- **A damaged file is recovered.** If `tenax.db` can't be read, it's set aside as `tenax-damaged-<date>.db` (never deleted), the newest readable daily backup is restored, and the app says which day it came from.
- **The whole review history is kept.** The app works with your most recent 30,000 reviews; older ones stay in the database and in the daily backups.
- **One copy at a time.** Opening Tenax while it's already running brings the open window forward instead of starting a second copy that could write over the first.

The first time this version runs, it moves the library out of `config.json` (where earlier versions kept it, rewriting the whole file after every answer) into the database, and keeps the old copy as `backup-before-database-<date>.json`. If an earlier version writes there again later, what it changed is merged in on the next start rather than lost.

Data saved before per-concept scheduling is converted on first load: each concept takes the schedule of whichever of its questions you reviewed most recently.

### Using Tenax on several computers

Settings → Sync across computers. Pick a folder your cloud drive already syncs (one click for OneDrive; Dropbox or Google Drive via "Choose a folder…") and do the same on each computer. There's no server and no account: each computer keeps working on its own local library and writes what changed into that folder when you leave the app (switch windows, minimize, close, lock or sleep) and at most every 5 minutes while you keep studying, so the cloud drive gets a handful of small uploads a day rather than one per answer. What it writes is a numbered file of just the changes since the last one (`tenax-<computer>-<id>.<number>.changes.json.gz`, a few KB after a session), and about once a day (or after 40 of those, or 2 MB of them) a full copy (`tenax-<computer>-<id>.json.gz`) that replaces them. It reads the other computers' files on start-up, every 3 minutes and whenever the window gets focus: each one's full copy, then its change files in order. A change file the cloud drive hasn't finished bringing down yet is waited for, never skipped, so changes always arrive in the order they were made. Each computer only ever writes its own files, so the cloud drive never has to resolve a conflict.

The full copy is in the same format earlier versions write, so a computer that hasn't updated yet still syncs: it reads the others' full copies (so it can be up to about a day behind them) and they read its copy as before.

Merging works record by record: for every course, chapter, concept, question, link, note, import and shelf item, the most recently edited version wins; a deletion wins over edits made before it; review history is combined from all computers; settings come from whichever computer changed them last. Restoring a backup counts as an edit, so it carries over to the other computers instead of being undone by them; resetting deletes everywhere (both warnings say so when sync is on). A copy written by a newer version of Tenax is skipped (Settings says which computer to update) rather than merged by code that doesn't understand it.

Size: one full copy per computer, replaced about once a day (it doesn't grow with each sync), plus the change files since. Under 1 KB per question once compressed, so about 10–15 MB for a library the size of 20 books; the copy carries the most recent 30,000 reviews.

Not synced: the API key (enter it once per computer) and book PDFs (and pasted guides being imported). A book import runs on the computer that has the PDF; the others show its progress and get each chapter as it's saved. If two computers are used offline at the same time, both sets of reviews are kept; if the same concept was reviewed on both, the later review's schedule wins.

### Installing

Installers are on GitHub Releases (`Tenax-Setup-<version>.exe`, per-user, no admin rights). The app isn't code-signed, so Windows SmartScreen asks the first time: More info → Run anyway. Installed copies check for a new release every few hours, download it in the background and install it when the app closes (Settings shows "Restart now" once one is ready), which keeps every computer on the same version. To publish a release: bump `version` in package.json and push (to main or the working branch). `.github/workflows/release.yml` sees there's no release for that version yet, runs the tests, builds the installer on Windows and publishes it as `v<version>` on that commit.

This version starts from an empty library. The first time it runs, anything saved by earlier versions (old flashcards and anything converted from them) is written to a `backup-before-clean-start-<date>.json` file in the app's data folder and then removed from the app. Settings and the API key are kept.

## For developers

[ARCHITECTURE.md](ARCHITECTURE.md) is the guide to the code: how the pieces fit, how data flows, how a page is built, the design tokens, and recipes for common changes. In short:

```
electron.cjs      main process: the library's IPC, Claude calls (structured outputs), PDF IPC, backups, sync uploads, updates, title bar
db.cjs            the library on disk: SQLite (tenax.db), saved a change at a time, recovered from a backup if damaged
ai-usage.cjs      what each AI call cost: a small log in the data folder, summed for Settings
code-runner.cjs   runs a code question's tests against an answer (Python, C, JavaScript; time-limited, temporary folder)
covers.cjs        cover search and download from Open Library (main process, tested with a stubbed fetch)
sync-folder.cjs   sync folder: this computer's full copy and change files in, the others' out (in order)
pdf-text.cjs      PDF outline + page text (pdf.js)
src/lib/          pure logic, unit-tested: fsrs, planner, ladder (steps, introductions, terms drill, glossary), diagram (checking, simulating and laying out diagrams), training (implicit review, pace, pretests, forecast), code, mastery, graph (incl. learning paths), orbits (map layout), timelapse, grade, quality, model, ai, book, bookRunner, batchWriter, notes, shelf (incl. the year), cover (shaping covers, spine colours), recall, sync (merging), delta (what changed, so only that is saved), search and commands (the palette), history (sparklines), format (counts, percentages, dates)
src/state/        reducer (pure, tested; stamps edits for sync), store (holds the library, reports how saving is going), sync (pulls and merges), bookImport (keeps book and paste imports running), background (question top-ups)
src/app/          the frame: routes (which page for which route), title bar, sidebar, the Ctrl+K palette, the theme
src/views/        one folder per part: today, courses (incl. Teach back), concepts (concept panel, question forms, the outline), material (adding material, importing a book), session, notes, shelf (books, spines, the year, recalls), map (SkyMap, the 3D map with its engine sky3d.js, or FlatMap), progress, settings
src/ui/           shared building blocks: layout (Page, PageHeader, Section), controls, overlays (drawer, modal, menu), display (bars, figures, notices), Icon, Markdown, Cover, motion, sound
src/styles/       tokens.css (every colour, size and spacing), then one file per part
tests/            node --test (logic, quality gate, reducer, main-process IPC with a stubbed API)
```

`npm test`, `npm run lint`, `npm run build`, `npm run electron` (dev), `npm run dist` (Windows installer in `release/`, not published).
