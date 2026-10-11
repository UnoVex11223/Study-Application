# Tenax — How It Works

Tenax is a desktop study app (Electron + React) for keeping what you learn in long-term memory across many subjects at once. You add material a chapter at a time; it pulls out the concepts worth remembering, writes questions you answer from memory, and schedules a short daily session sized to the time you have.

This file doubles as context you can paste into another AI when preparing material for the app.

---

## The daily loop

1. **Today** shows one session: a number of questions, an estimated time and which courses they come from, with a button to start it. It never asks for more than your daily budget (20 minutes by default, set in Settings). Under it are only the things waiting on you, one line each: questions to fix, notes to process, books to recall.
2. You answer each question by **typing from memory**. There is no multiple choice.
3. Your answer is graded against the question's **key points** (see Grading), you see what you missed, and you rate how well you knew it (Again / Hard / Good / Easy, with a suggested rating preselected — press Enter to accept).
4. The scheduler (FSRS) decides when each **concept** comes back. Memory is scheduled per concept, not per question: a concept's questions (recall, explain, apply…) take turns at its reviews, so extra questions add variety without adding review time.

### How the day stays manageable

- **Time budget.** Everything due is ranked by how close it is to being forgotten, weighted by importance (core > supporting > detail) and by how many other concepts build on it. Questions are added in that order until the budget is full. Anything that doesn't fit waits for a later day, most urgent first.
- **One question per review.** When a concept is due, one of its questions is asked: a new concept starts with its most basic question, a question you just missed comes back while you relearn it, and otherwise the question asked longest ago goes next. Your answer reschedules the whole concept.
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
3. **Caps**: up to 2 questions for a core concept (one to know the idea, recall or explain, and one to use it, apply or distinguish, when both pass) and 1 for a supporting or detail concept, the best-scoring first. A typical section ends up with about one and a half questions per concept. A core concept's two questions take turns at its reviews, which keeps you from memorizing one prompt's wording.

Before anything is saved you see a **Review questions** step: what passed (with its score), what was filtered out and why, and you can untick or rescue any question. Concepts left with no good question aren't added.

After import, quality keeps being enforced:
- **Report question** (the flag on every question in a session) takes it out of your sessions immediately.
- A question you miss on **5 different days**, or whose grading you overrule **twice**, is pulled automatically — that pattern usually means the question, not you, is the problem.
- Pulled questions wait in **Questions to fix** (a line on Today opens it, as does "Fix reported questions" in search; each concept's panel lists its own), where you can **rewrite with Claude** (the new version passes the same rule checks), restore, or delete.
- Questions you write yourself get the same rule checks as advice while you type.
- **More questions** (on a course's Sections header, or inside a chapter) tops up concepts that have fewer than their target: Claude sees the questions a concept already has and writes ones that come at the idea from another side, through the same review and caps. What passes is added automatically.

## What the AI costs, and how it's kept down

- Heavy work (finding concepts, writing and reviewing questions, linking, notes) uses Claude Opus; grading uses Claude Sonnet, which is fast and a fraction of the price.
- System prompts are cached, so the instructions repeated across an import or a study session are billed at a tenth after the first call. The long lists sent with linking and notes (concepts you already know) are cached too.
- The reviewer only writes out revisions for questions it actually revises, not empty fields for every question.
- Linking only compares new concepts with your *other* courses (within a course, prerequisites come from extraction), and is skipped when there's nothing else to link to.
- Notes send the concepts most likely to match with their summaries and the rest by name only.
- Book imports use the Batch API at half price (see Importing a whole book).

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
- **Recall chance now**: FSRS's estimate of remembering the concept today.

**Progress** keeps to three things: four figures (day streak, answers this week and the time they took, the share of answers recalled after a week or more, and how many started concepts are mastered), **Next two weeks** (the review time each day is expected to take, against your daily budget, today highlighted) and **Activity** (a year of study days, one square per day, darker for more answers). How each course is going is on its own page.

## Teach back

Pick a section and explain it from memory as if teaching it. Each concept is marked covered, partly, not mentioned, or incorrect. Covered concepts that were due count as reviewed; missed ones are brought forward to your next session. (If you turn on "show concept names", it's practice only.)

---

## Adding material

**Course → Add material**:

1. Paste text, drop `.md`/`.txt` notes, or drop the **book's PDF** and pick a chapter from its table of contents (page numbers are kept so each concept can cite its page).
2. Claude splits it into sections and concepts and rates each concept's importance from real signals (definitions, worked examples, warnings, things later ideas depend on) — not word frequency. Anecdotes, boilerplate and navigation are dropped. Concepts are kept broad: closely related facts (syntax, rules, pitfalls of one idea) are one concept, so a dense chapter gives roughly 12–25. Details start unticked; untick anything you don't want.
3. Claude writes candidate questions with rubrics, an independent review scores them, and you confirm what passed (see Question quality). New concepts are then linked to your other courses in the background.

Question writing starts in the background as soon as the concepts are found, so most of it is done while you look the list over. Concepts are handled in groups of up to four, several groups at a time; ticking an extra concept only writes that one, and going back to the concept list doesn't redo finished work.

If text lost something in copying (a figure, a garbled equation), you're told instead of getting a question built on missing information.

You can also write questions yourself (Course → Add a question) with key points, accepted answers, misconceptions and a hint.

### Importing a whole book

**Courses → Import a book** takes the book's PDF and does every chapter at once:

1. Chapters are found from the PDF's table of contents (chapters inside "Part" entries are picked out; preface, index, appendices and similar are unticked). A PDF without one lets you type each chapter's start page.
2. Tick the chapters you've already read. Everything else is **locked**.
3. The import runs in the background, in reading order. Each chapter's concepts are extracted knowing the earlier chapters', so later chapters point back at earlier ideas as prerequisites (the book's map) instead of recreating them. Question writing for up to two chapters runs alongside, and chapters appear on the course page as they finish. Closing the app pauses the import; it picks up where it left off (a chapter that was mid-way starts over). Two API failures in a row pause it with the error shown.
4. **Mark as read** on a chapter unlocks it. A locked chapter never comes up in sessions, doesn't count in course totals, and its prerequisites don't hold back chapters you've read out of order. Unlocking doesn't dump the chapter on you: its concepts join the queue and are introduced a few a day like any other new material.

Cost: by default (Settings → Book imports: **Half price**) question writing and review go through Anthropic's Batch API: the same models and prompts at half the price, with each chapter usually taking a few extra minutes (occasionally up to an hour). Roughly 1.5–2.5 cents per page that way (about $6–10 for a 400-page book), or 2–4 cents at full speed. An import that's closed mid-batch picks the same batch back up; anything a batch can't handle is redone live.

### Notes

**Notes** (in the sidebar, or Ctrl+Shift+N from anywhere) is for what you pick up outside a course: projects, documentation, work.

- **Capture** a note in the box (with an optional project or topic), or **upload** .md/.txt files; each bullet or paragraph becomes a note, with its heading as context. Keep one running notes file per project and upload it whenever you've added to it: notes you've added before are recognized and skipped.
- **Process** the inbox: Claude checks each note against everything you study and decides:
  - *new idea* → a concept in the Notes space, filed under a topic ("SQLite", "Git"…), linked to related concepts from your courses on the map;
  - *the same idea as a concept you already have* → extra questions on that concept (built from your note), no new concept;
  - *skip* → to-dos, project-specific details, anything that looks like a secret, or too vague to recover an idea — with the reason, and **Keep anyway**.
  Terse notes are completed so they stand alone and marked *filled in by Claude — check it*; a note that's wrong is corrected and says so.
- **Review** before saving, like adding material.

Notes are reviewed and introduced like everything else, but they're their own space: they never add concepts to a course, so course totals aren't stretched by things outside the material.

### Shelf

The Shelf page stands every book, textbook and course you're working through on shelves, as books: the cover, with page edges, a spine and a thickness that follows its length (pages, or about 30 pages per chapter or module). Books you read are drawn a little smaller than textbooks and courses. Under each book are its title, its author (or, for a Tenax course, how much is mastered) and how far along you are. The tabs across the top are All, **Reading** (books you read for their own sake), **Textbooks**, **Courses**, In progress and Finished, each with how many it holds; **Recall** in the header shows how many recalls are due.

Clicking a Tenax course's book flies it off the shelf into the course page's header, where it lands as the cover beside the course's name. Books are set down on the shelf one after another when the page opens or you switch tabs. Pointing at one lifts it toward you and tilts it with the pointer, the rest of the shelf dims a little, and the shelf's edge catches the light under the pointer; the **⋯** on the book has Edit and Hide (a Tenax course) or Remove. Logging a chapter with **+** swings the cover open for a moment. A book due for a recall has a bookmark sticking out of the top, and a book you want to read but haven't started has a faded cover. With reduced motion turned on in the system, none of it moves.

- **Reading**: a book's author, pages read out of the total, a status (reading, finished, want to read), dates and, once finished, a star rating.
- **Textbooks and courses**: your Tenax courses are on the shelf automatically (an imported book as a textbook, a course you built as a course; either can be changed in Edit). Anything else, like a video course or a textbook you aren't studying in Tenax, you add yourself and count with + and − (they appear when you point at the book); it's in progress or finished. These cards show the cover and progress only, with no description.

**Add to shelf** asks which kind it is (Book, Textbook or Course), starting with the tab you're on. Something you added yourself can be changed to another kind in Edit.

**Covers.** In Add or Edit, **Find a cover** looks the title (and author, if there is one) up on Open Library and shows up to eight covers from the editions it finds, most-printed first; pick one and it's downloaded and saved like any picture. Typing an ISBN as the title finds that exact edition. You can also choose an image, or drop one onto the cover. The search runs only when you click the button, and sends Open Library just the title and author.

**Spines.** The two buttons at the right end of the tabs switch between covers and **spines**: the books standing spine-out, packed close like a real bookcase, each spine coloured from its cover's left edge (or its cloth), as thick as the book is long, with the title running down it in the serif and, for a book you read, the author's last name at the foot. Books you read stand a little shorter than textbooks. A bookmark at the top means a recall is due. Click a spine to open it, right-click for Edit, Hide or Remove. Tenax remembers which view you used.

**Year on the shelf.** The year button in the header (or "2026 on your shelf" in search) shows what you finished that year: how many books, pages read, textbooks and courses finished and your average rating, the finished books stacked into a pile that lands one book at a time, and the months they fall in. Earlier years are a click away once you've finished something in them. It counts anything on the shelf marked finished, by the date you finished it.

Covers are scaled down to 560px JPEGs (tens of KB) before they're saved, so they don't bloat your library or the sync folder. On the shelf (and in the book panel, recall and edit form) they're shaped as book covers:

- A plain margin around the picture, like the paper around a scanned cover or a page background around a screenshot, is cropped off when it runs along two or more sides in the same colour and ends at a clear edge. A single band on one side is left alone, since it's usually part of the design.
- A picture that's roughly book-shaped fills the cover. Anything else, like a course banner or a square thumbnail, sits on the cover as a plate over a blurred copy of itself instead of being cropped to a sliver.
- A book without a picture gets a plain cloth cover with its title and author, in one of a few muted colours (always the same one for a title).

For a Tenax course, progress is the number of chapters read in Tenax (chapters of an imported book count once you mark them read) or the number you log yourself, whichever is higher, so chapters you read before you started using Tenax count too. An imported book knows how many chapters it has. A course you build a chapter at a time doesn't, so it shows "3 chapters done" with a Set total link rather than calling itself finished just because you've caught up. Hiding a course only takes it off the shelf (Hidden from the shelf at the bottom brings it back); deleting a course keeps its shelf card with the progress it had.

When books were split into reading and textbooks, anything linked to a Tenax course or brought over from AeroShelf became a textbook, and books from the old Reading tab, or with an author, rating or notes, became reading.

**Notes, ratings and recall (Reading only).** Clicking a book opens three short notes in your own words: **What it's about**, **What I thought** and **Ideas worth keeping**; they save as you type. They aren't shown on the card, so they don't give the answer away before a recall. Textbooks and courses have none of this: the ones in Tenax have real questions instead.

Once a book has notes, Tenax asks you to recall it now and then: you write (or just think through) what you remember, then **Show my notes** and say how it went: *Forgot most of it*, *Fuzzy*, *Remembered it* or *Easy*. The first recall is 3 days after your notes; after that the gap grows with how well you remembered (remembered: about 2.5× the last gap, at least a week; easy: 3.5×, at least two weeks; fuzzy: a little longer; forgot: two days), up to a year. Anything you wrote during a recall can be added to the notes, dated, so your thoughts build up over time. Due recalls show as a count on Shelf in the sidebar, a **Recall** button on the Shelf page and a line on Today; they're extra practice, separate from the daily session and its time budget, and use no AI.

### Preparing material with another AI

The extractor handles raw chapters well; the most useful prep is simply splitting a book by chapter and adding each one as you finish it. If you do pre-process, keep: definitions, explanations with the "why", worked examples (code included, with a sentence on what it demonstrates), explicit comparisons, and common mistakes. Drop exercises' instructions, cross-references and chapter intros.

---

## Knowledge map

A sky of solar systems, in 3D. Each book or course is a sun (tinted with the course's colour, a little bigger the more it holds) with its name beneath it; its chapters are orbits on a slightly tilted plane (the first chapter innermost, fainter for chapters you haven't read) and its concepts are planets going round them, sized by importance. Inner orbits turn faster, and the whole sky keeps turning slowly.

Planets are real spheres lit by their own sun: a day side, a night side, faint bands of cloud and a bright rim of atmosphere where the light grazes the edge, so they wax and wane as they go round and as you turn the camera. Their colour is the course's, varied a little from planet to planet. A mastered planet glows; one you're learning is lit; a slipping one is amber and pulses; one you haven't started is a dark world with only its rim catching the light; one in a chapter you haven't read is a small grey moon. Core concepts carry a ring of fine bands, which appears as you get closer. Suns, mastered planets and the streams between books bloom like a long exposure. Close to a sun its glare draws in and its surface shows, boiling, instead of washing out the view.

- **Memory fog.** A planet you're starting to forget (its recall chance below about 90%) loses its colour, dims and sits in a pale haze, more the lower the chance, so what needs a review stands out at a glance. A review clears it.
- **Learning path.** With a concept open, **Learning path** draws everything it builds on as a constellation: a fine gold line from each step to the next, a circle round each step and its number in reading order (foundations first), with the rest of the sky dimmed. The camera frames the path beside the panel.
- **Time-lapse.** Replays your sky from your first day to today in about 16 seconds: planets appear the day you started them and change colour as you learn, master and let them slip, with the date beneath. Pause it, or drag the slider to any day.

Links between books are one soft stream of light between their suns, brighter the more links there are, with motes of light drifting along it. A planet's own links appear as arcs when you point at or open it, with its linked planets' names. In a single course, all of its links are shown faintly while you're looking at the whole system. Names come in as you get closer: book names always, the planet you're pointing at always, core concepts' names next, then the rest, without overlapping.

Behind it all is a painted Milky Way with thousands of twinkling stars.

**Moving around:** drag to move across the sky, scroll to zoom (towards the pointer), and right-drag (or Shift-drag) to turn it; the buttons zoom and fit everything back in view. Pointing at a planet brings the sky to a stop so it's easy to click; clicking grows the planet into its panel beside the map and glides the camera so the planet sits in the part the panel leaves free (you can keep clicking other planets); clicking a sun or a book's name flies to its system. Pick a single course to see just its system, or switch it to **Prerequisites** for the left-to-right chart of what builds on what. With reduced motion turned on in the system, the sky stands still and the camera jumps instead of gliding.

Drawn with three.js (WebGL 2), which loads the first time you open the map. Planets are one instanced mesh with their own shader, so hundreds of them cost one draw call. On a computer that can't do WebGL 2 the map falls back to the flat sky from earlier versions (no fog, time-lapse or paths there). The layout is in `src/lib/orbits.js`, what a day of the time-lapse looks like in `src/lib/timelapse.js`, and learning paths in `src/lib/graph.js` (all pure and unit-tested); the 3D engine is `src/ui/sky3d.js`.

## Look and feel

- **Title bar.** The window has no frame of its own: the bar at the top holds the Tenax mark and a search box, and is where you drag the window. The system's minimise, maximise and close buttons sit at its right end (traffic lights at the left on a Mac), coloured to match the theme.
- **Search and commands (Ctrl+K, or click the search box).** Type to find any course, chapter, concept, book on the shelf or note in your inbox, or run an action: start today's session, recall books, capture a note, create a course, import a book, add to the shelf, switch theme, turn sounds on or off, sync now. Every word you type has to match, as a whole word part or as the first letters of words ("ptf" finds "Pointers to functions"); the group with the best match comes first. Arrow keys move, Enter opens, Escape closes. A concept opens its panel on its course page, a chapter opens on its course page, a book opens its notes on the shelf.
- **Motion.** One set of timings and curves throughout. Pages crossfade and the new one rises into place; the highlight in the sidebar slides to the page you picked; a book flies from the shelf into its course; a planet on the map grows into its concept panel; a study session slides up over everything and back down when it ends; panels and dialogs slide or fade out when you close them. With reduced motion turned on in the system, everything changes at once.
- **Type.** Page titles, book and concept names and the big numbers are set in Newsreader, a serif made for reading; everything else is Geist, with Geist Mono for labels and small numbers.
- **Numbers.** On a course, Progress and Teach back, the key numbers sit in a row between thin lines rather than in boxes, some with a small sparkline: concepts mastered and started over the last 30 days, answers per day and days studied over the last two weeks. A sparkline only appears once there's something to show.
- **Themes.** Settings → Appearance: Black, Paper (a warm off-white with a faint grain, like a printed page) or Match system. The knowledge map is always night.
- **Sounds.** Off unless you turn them on (Settings → Sounds, or from search). A soft tick when an answer comes back right, a paper rustle when you log a chapter on the shelf, and a low chime when a session ends. They're made as they play, so there are no sound files.

## Data & privacy

Everything lives locally in one file on your machine, and a copy is saved automatically once a day in a `backups` folder next to it (the last 14 are kept; Settings → Your data → Open folder). The API key is encrypted with your user account (Windows DPAPI / macOS Keychain) and isn't included in backups. The data file is `config.json` in `%APPDATA%\aeroflash` on a computer that ran earlier versions (kept so nothing moves when the app is renamed) and in `%APPDATA%\Tenax` on a fresh install. Settings → Export backup / Restore from backup. AI calls go directly from the app's background process to the Anthropic API with your key; the key is never readable by the UI. **Find a cover** on the shelf sends the title and author you typed to Open Library, only when you click it.

Data saved before per-concept scheduling is converted on first load: each concept takes the schedule of whichever of its questions you reviewed most recently.

### Using Tenax on several computers

Settings → Sync across computers. Pick a folder your cloud drive already syncs (one click for OneDrive; Dropbox or Google Drive via "Choose a folder…") and do the same on each computer. There's no server and no account: each computer keeps working on its own local copy, also writes it as `tenax-<computer>-<id>.json.gz` into that folder when you leave the app (switch windows, minimize, close, lock or sleep) and at most every 5 minutes while you keep studying, so the cloud drive gets a handful of uploads a day rather than one per answer, and reads the other computers' files on start-up, every 3 minutes and whenever the window gets focus. Each computer only ever writes its own file, so the cloud drive never has to resolve a conflict.

Merging works record by record: for every course, chapter, concept, question, link, note, import and shelf item, the most recently edited version wins; a deletion wins over edits made before it; review history is combined from all computers; settings come from whichever computer changed them last. Restoring a backup counts as an edit, so it carries over to the other computers instead of being undone by them; resetting deletes everywhere (both warnings say so when sync is on). A copy written by a newer version of Tenax is skipped (Settings says which computer to update) rather than merged by code that doesn't understand it.

Size: one compressed file per computer, overwritten each time (it doesn't grow with each sync). Under 1 KB per question once compressed, so about 10–15 MB for a library the size of 20 books; review history is capped at the last 30,000 reviews.

Not synced: the API key (enter it once per computer) and book PDFs. A book import runs on the computer that has the PDF; the others show its progress and get each chapter as it's saved. If two computers are used offline at the same time, both sets of reviews are kept; if the same concept was reviewed on both, the later review's schedule wins.

### Installing

Installers are on GitHub Releases (`Tenax-Setup-<version>.exe`, per-user, no admin rights). The app isn't code-signed, so Windows SmartScreen asks the first time: More info → Run anyway. Installed copies check for a new release every few hours, download it in the background and install it when the app closes (Settings shows "Restart now" once one is ready), which keeps every computer on the same version. To publish a release: bump `version` in package.json and push (to main or the working branch). `.github/workflows/release.yml` sees there's no release for that version yet, runs the tests, builds the installer on Windows and publishes it as `v<version>` on that commit.

This version starts from an empty library. The first time it runs, anything saved by earlier versions (old flashcards and anything converted from them) is written to a `backup-before-clean-start-<date>.json` file in the app's data folder and then removed from the app. Settings and the API key are kept.

## For developers

```
electron.cjs      main process: storage bridge, Claude calls (structured outputs), PDF IPC, backups, updates, title bar
covers.cjs        cover search and download from Open Library (main process, tested with a stubbed fetch)
sync-folder.cjs   sync folder: this computer's file in, the others' files out
pdf-text.cjs      PDF outline + page text (pdf.js)
src/lib/          pure logic, unit-tested: fsrs, planner, mastery, graph (incl. learning paths), orbits (map layout), timelapse, grade, quality, model, ai, book, bookRunner, batchWriter, notes, shelf (incl. the year), cover (shaping covers, spine colours), recall, sync (merging), search and commands (the palette), history (sparklines)
src/state/        reducer (pure, tested; stamps edits for sync), store (persistence), sync (pulls and merges), bookImport (keeps book imports running), background (question top-ups)
src/views/        Today, FixPanel, Session/TaskView, Courses, Course, ConceptPanel, FixQuestion, AddMaterial, ImportBook, Notes, Shelf, ShelfViews (spines, year), KnowledgeMap (picks SkyMap, the 3D map, or FlatMap), Progress, TeachBack, Settings
src/ui/           motion (timings, view transitions), sound, Palette (Ctrl+K), Cover, sky3d (the 3D map engine), webgl, sky (the flat map's pictures), ui (shared pieces)
tests/            node --test (logic, quality gate, reducer, main-process IPC with a stubbed API)
```

`npm test`, `npm run lint`, `npm run build`, `npm run electron` (dev), `npm run dist` (Windows installer in `release/`, not published).
