# How Tenax is built

A guide for working on the code. [APP-CONTEXT.md](APP-CONTEXT.md) explains what the app *does*; this file explains where that lives and how to change it.

## The big picture

Tenax is an Electron app: a Node.js **main process** that owns the disk, the network and the window, and a React **renderer** (the interface) that talks to it through a narrow bridge.

```
electron.cjs  ──IPC──  preload.cjs  ──window.tenax──  src/  (React)
 storage, Claude API,     the only door between         everything you see
 PDFs, backups, sync      the two (no Node in the UI)
```

The interface never touches files or the API key directly. It asks through `window.tenax.*` (see `preload.cjs` for the full list), and the main process answers. In a plain browser, where there's no bridge, `src/lib/persist.js` falls back to `localStorage`, which is handy for trying the interface on its own.

## Where things live

```
electron.cjs          the main process: the window, IPC handlers, Claude calls, backups, sync uploads, updates
preload.cjs           the bridge: everything the interface can ask for (window.tenax)
db.cjs                the library on disk: a SQLite database (tenax.db)
sync-folder.cjs       the sync folder: this computer's files in, the other computers' out
covers.cjs, code-runner.cjs, pdf-text.cjs, ai-usage.cjs    cover search, running code tests, reading PDFs, what AI calls cost
src/
  main.jsx            entry: loads the fonts and styles, renders <App/>
  App.jsx             providers + the shell: which page shows, the study session, the palette
  app/                the frame around every page
    routes.jsx          which page shows for each route, and which sidebar item is lit
    TitleBar.jsx        the Tenax mark and the Settings gear
    Sidebar.jsx         the pages, their counts, background work
    Palette.jsx         Ctrl+K search and commands
    StorageNotice.jsx   says when saving fails or the library was restored, and the can't-open screen
    theme.js            light/dark theme, and the window buttons' colours
  views/              one folder per part of the app
    today/              Today, the questions-to-fix panel
    courses/            the course list and its rows (Notes lists areas with them too), a course page, its banners, Teach it back
    concepts/           shared by courses and notes: the concept panel, question forms, the outline
    material/           adding material, a new course from a paste, importing a book
    session/            a study session: the question, grading feedback, Go deeper, the summary
    notes/              Notes: capture, process, the areas notes made (and regrouping them), deleting notes
    shelf/              the shelf: books, spines, the year, a book's panel, the form, recalls
    map/                the knowledge map (3D engine in sky3d.js, flat fallback in FlatMap.jsx)
    progress/           Progress
    settings/           Settings
  ui/                 building blocks with no knowledge of Tenax's data
    layout.jsx          Page, PageHeader, Section, EmptyState
    controls.jsx        Segmented, Field, Confirm
    overlays.jsx        Drawer, Modal, ConfirmDialog, Menu, MenuItem, PointerMenu
    display.jsx         Bar, Spark, Figures, Notice, StatusDot, Stars, Logo, Spinner…
    Icon.jsx, Markdown.jsx, Diagram.jsx, Cover.jsx, motion.js, sound.js, hooks.js, nav.js, cx.js
  state/              the data and everything that changes it
    store.jsx           holds the state, saves it, gives components act()
    reducer.js          every change, as a pure function (unit-tested)
    sync.jsx, bookImport.jsx, background.jsx   long-running work
  lib/                the logic, as plain JavaScript (no React, unit-tested in tests/)
    model.js            the data model: courses → sections → concepts → questions
    planner.js          what to ask today
    ladder.js           a concept's questions as steps: which to ask, introductions, the terms drill
    diagram.js          diagrams: checking a spec, simulating circuits, laying out the drawing
    fsrs.js             when each concept comes back
    persist.js          loading the library, and saving what changed (through window.tenax.db)
    delta.js            what changed between two versions of the library
    sync.js             merging another computer's copy, record by record
    mastery.js, grade.js, quality.js, ai.js, shelf.js, format.js, …
  styles/             all CSS, one file per part (see "The design system")
tests/                node --test, for lib/, the reducer and the main process
```

Three rules keep this tidy:

1. **`lib/` knows nothing about React or the screen.** It takes state and returns answers. That's why it can be tested without a browser, and why the planner or the scheduler can change without touching a page.
2. **`ui/` knows nothing about Tenax.** A `Modal` doesn't know what a course is. Anything that does belongs in `views/`.
3. **A part of the app keeps its files together.** Everything about the shelf is in `views/shelf/` and `styles/shelf.css`.

## How data flows

```
 component ──act("course/update", { id, patch })──▶ reducer ──▶ new state ──▶ saved (persist.js)
     ▲                                                                          │
     └──────────────── useStore() gives the new state ◀─────────────────────────┘
```

- **Reading:** `const { state } = useStore();` Lookups go through `index(state)` from `lib/model.js` (cached per state), so `ix.course[id]` or `ix.conceptsBySection[id]` are instant.
- **Changing:** `act(type, payload)`. Every action is a `case` in `state/reducer.js`. The reducer never mutates; it returns a new state, and it stamps changed records so sync can merge computers.
- **Computing:** anything derived (today's plan, mastery, a course's numbers) is a function in `lib/` called with the state. Don't store what you can compute.
- **Navigating:** `const nav = useNav();` then `nav.go("course", { courseId })`, `nav.startSession({ tasks, mode })`, and `nav.now` (a clock that ticks once a minute). Routes are listed in `app/routes.jsx`.

## Saving and syncing

```
 new state ──▶ persist.js ──diffLibrary(saved, new)──▶ db:apply ──▶ db.cjs ──▶ tenax.db
                                                                      │
          electron.cjs, when you leave the app: changesSince(last upload) ──▶ sync-folder.cjs ──▶ cloud drive
```

- **Only what changed is saved.** The reducer never edits a record in place, so `lib/delta.js` finds what an action touched by identity (`before !== after`) without comparing contents. The flip side: a reducer case that rebuilds a record it didn't change makes it look edited, so return the same object when nothing changed.
- **`lib/persist.js`** saves a quarter of a second after the last change, one save at a time. A failed save is retried with everything since the last good one and reported through `onSaveStatus` (shown by `app/StorageNotice.jsx`). Actions that swap the whole library (`replace`, `reset`; `REPLACES` in `state/store.jsx`) are saved by replacing it.
- **`db.cjs`** keeps one row per record (`records`: kind, id, updated_at, rev, the record as JSON), reviews in `attempts` (append-only), deletions in `tombstones` and everything else (settings, per-day extras) in `meta`. Each write is a transaction with its own revision number, which is how `changesSince` knows what the sync folder hasn't seen yet.
- **`sync-folder.cjs`** writes numbered change files and, about once a day, a full copy that replaces them; reading another computer's files, it takes its full copy and then its change files in order, and waits for a missing one rather than skipping it. Merging is `lib/sync.js` (`mergeStates`), dispatched as `sync/merge` by `state/sync.jsx`.
- **A new kind of record** (like `shelf`) goes in `RECORD_COLLECTIONS` in `lib/model.js`: saving, diffing, merging and the reducer's sync stamps all read that list, and `db.cjs` stores any list of records as rows.

## How a page is built

Every page has the same shape, so they all line up:

```jsx
import { Page, PageHeader, Section } from "../../ui/layout.jsx";

export default function Example() {
  return (
    <Page width="narrow">                      {/* "wide" (default), "narrow", or "full" (the map) */}
      <PageHeader title="Example" back={{ label: "Courses", onClick: () => nav.go("courses") }}
        actions={<button className="btn btn-primary"><Icon name="plus"/>Add</button>}/>
      <Notice>Something worth knowing.</Notice>
      <Section title="Things" count={3} actions={<button className="btn btn-sm btn-quiet">More</button>}>
        <div className="list">…</div>
      </Section>
    </Page>
  );
}
```

`Page` spaces its parts evenly (32px apart), so components don't need margins of their own, and every page's title starts at the same place. Inside a part, lay things out with `.row` (a line) and `.stack` (one above another), with `.gap-1` … `.gap-8` for the space between.

## The design system

All visual decisions live in **`src/styles/tokens.css`**. Components use those names, never raw values, so changing a token changes it everywhere. **`src/styles/system.css`** is imported last and applies the shared rules on top of each page's styles: type weights, hairline borders on buttons, inputs and panels, the title bar and the session. The palette is neutral; `--accent` is the text colour, and the only hues are `--good`, `--warn`, `--bad` and the course colours `--k0`…`--k7` (used on the knowledge map).

| | Tokens | Use |
|---|---|---|
| Colour | `--bg` `--surface` `--surface-2` `--inset` `--ink` `--ink-2` `--ink-3` `--select` `--accent` `--link` `--good` `--warn` `--bad`, course pigments `--k0`…`--k7` | Each is written once as `light-dark(light, dark)`. |
| Type | `--text-xs` 12, `--text-sm` 13, `--text-md` 14, `--text-lg` 15; `--title-sm` 17, `--title-md` 21, `--title-lg` 26 | One family (Inter) for everything; `--serif` is an alias of `--sans`. Geist Mono (`--mono`) for code. |
| Space | `--space-1` 4 … `--space-16` 64 | Everything sits on a 4px grid. |
| Shape | `--radius-xs` 4 … `--radius-xl` 16 | Small things get small corners, dialogs the largest. |
| Controls | `--control-sm` 28, `--control-md` 36, `--control-lg` 44 | Buttons, inputs, selects and segmented controls share these, so they line up in a row. |

Buttons are `btn` plus a variant: `btn-primary` (the one thing to do next, at most one per area), `btn-quiet` (secondary), `btn-danger`; sizes `btn-sm` and `btn-lg`; `btn-icon` for square icon-only buttons. Icons size themselves to the button, so leave out `size` unless an icon stands alone.

Inline `style={{…}}` is only for values computed at runtime, passed as CSS variables (`style={{ "--c": courseInk(color) }}`, `"--i": index` for staggered animations). Fixed spacing and sizes belong in CSS.

## Common changes

**Change a colour, size or spacing everywhere:** edit `src/styles/tokens.css`.

**Add a page:**
1. Create `src/views/<part>/<Name>.jsx` using `Page` and `PageHeader`.
2. Add a `case` for it in `app/routes.jsx` (and a sidebar entry in `app/Sidebar.jsx` if it needs one).
3. Put its styles in `src/styles/<part>.css` and add an `@import` in `src/styles/index.css`.

**Add a setting:** add its default to `DEFAULT_SETTINGS` in `lib/model.js`, then a `<Field>` in `views/settings/Settings.jsx` that calls `set({ yourSetting: value })`.

**Add something the data can do:** add a `case "thing/verb":` to `state/reducer.js` (return a new state, don't mutate), call it with `act("thing/verb", { … })`, and add a test in `tests/`.

**Add an icon:** add a path to `PATHS` in `ui/Icon.jsx` (24×24 grid, stroked), then `<Icon name="yours"/>`.

**Say a count or a date:** use `lib/format.js` (`plural(3, "question")` → "3 questions", `pct(0.73)` → "73%", `shortDate(ts)` → "Oct 31") so every page reads the same.

## Checking your work

```bash
npm test          # logic, reducer, main process
npm run lint      # catches unused code and React mistakes
npm run build     # the production bundle
npm run electron  # the app, with hot reload
```

Run all three before pushing. Pushing a new `version` in `package.json` to `main` publishes a release (see README), so work on a branch and merge when it's ready.

## Why it's shaped this way

These follow *The Pragmatic Programmer*:

- **One place for each fact (DRY).** A colour, a font size, how a count is worded, how a confirmation looks: each is defined once (`tokens.css`, `lib/format.js`, `ui/`) and used everywhere.
- **Parts that don't depend on each other (orthogonality).** `lib/` doesn't know about the screen and `ui/` doesn't know about the data, so either can change without breaking the other.
- **Easy to change.** Tokens, shared components and one folder per feature mean most changes touch one file.
- **No broken windows.** Lint and tests run before every release; fix a warning when you see it rather than letting them pile up.
