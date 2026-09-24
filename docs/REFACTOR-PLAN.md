# AeroFlash refactor — staged delivery

## Working agreement

Implement one reviewable chunk, verify it, commit it to the repository, and stop. Continue only after Isaac asks for the next chunk. Preserve existing cards, review history, and schedules. A bounded study set must not be represented as complete subject mastery.

The learning goal is durable unaided recall, clear explanation, and application across a wide range of subjects. The app should reduce organization work and avoid accumulating an overwhelming number of repetitive questions.

## Chunk 1 — manageable content and section workspace

Implemented in this branch:

- A shared content policy enforced in code, including per-import, per-section, and total topic ceilings.
- Default Balanced limits: 12 new questions per import, 4 per source section, 24 total in a topic's core set. Essentials: 8 / 2 / 16. Broader: 18 / 6 / 36. These are adjustable product defaults, not scientifically established optimal quantities or definitions of mastery.
- One generated question per normalized concept, question fingerprint deduplication, source quote checks, and selection that favors breadth before adding more questions to the same section. Selection rotates between files and samples across long sources so earlier text cannot occupy every slot.
- Retained Markdown hierarchy, automatic section assignment, and a section outline showing material without selected questions. Plain text without headings remains one section; inferring missing structure is a later extraction improvement.
- A bounded draft persisted after each processed segment. Nothing enters the review queue until the user adds the set. Cancellation ignores late responses; errors preserve completed suggestions as an explicitly partial import.
- Additive `contentProfile`, `learningGoal`, `sections`, and `contentDraft` topic metadata. Generated cards retain `concept`, `skill`, `priority`, `why`, `rubric`, `sectionId`, and source provenance. Existing card and scheduling objects are preserved.
- A redesigned import workspace and topic view, responsive layouts, keyboard-accessible controls, searchable questions, and collapsible source sections.

Import limits apply across chunks and files. Reimporting the same sections cannot evade their existing question counts or the topic cap. Manually authored cards remain an explicit user choice and count toward the available automatic topic capacity. Previously larger decks are never truncated.

Supported sources remain `.md`, `.markdown`, and `.txt`. Import a current chapter or a few sections, not an entire library. Each import is limited to 180,000 characters and 48 source segments. Source text is sent to Anthropic using the user's existing API configuration.

## Chunk 2 — written recall and explicit assessment

Implemented on `codex/aeroflash-02-recall`, building on chunk 1:

- Written answers are now the default daily review and topic practice experience, with no answer timer. Sessions contain at most 12 unique questions, due before new before optional early practice. Previously attempted cards rotate behind others at the same priority. Failed cards are scheduled for a later session; they never create an endless in-session queue.
- Shared assessment contract in `assessment-engine.mjs`, packaged with Electron. Every essential point receives a status, a reason and, for present or contradicted points, an exact quote from the student's answer. All points must be met and no material error may remain for a correct result. Missing and contradicted points produce **Not yet**. Missing criteria, invented quotes, malformed output, ambiguous references, refusal, outages and timeouts produce **Ungraded**. The old keyword fallback is removed.
- The rubric and reference appear after the first answer. Older cards use their existing reference as a single essential criterion. Case-sensitive literal cloze matches can pass locally when no additional rubric requirement exists; mismatches need semantic grading and are not automatically wrong.
- Correct scheduled unaided recall uses Good; an optional effort checkbox uses Hard. Incomplete or incorrect recall uses Again. Speed never earns Easy. An explicit “I don't know” is a self-reported miss. AI decisions can be disputed before saving, leaving the attempt ungraded without a scheduling penalty.
- Writing cues, practice before a card is due, attempts inside the daily new-card limit's exclusion, repeats within one minute of recorded feedback, and ungraded or self-checked answers do not extend the schedule or earn recall XP. There is no written-session completion bonus. The one-minute replay guard and 12-question ceiling are product policies, not claims about optimal learning intervals. Delayed mastery rules remain in chunk 3.
- First answers are saved before grading. Feedback is also saved before confirmation; leaving early keeps a pending entry without changing the schedule. Only **Save & continue** commits the review outcome. One retry can regrade the locked original answer. Duplicate completion and stale or deleted question checks prevent duplicate scheduling changes.
- Additive versioned `attempt` metadata lives in the existing bounded 5,000-entry review log: question/reference/rubric snapshot, original answer, skill, assistance, timing, grading evidence, dispute, optional self-check and scheduling decision. Existing cards, schedules and old entries are preserved. As before, the oldest raw entries eventually age out; daily activity totals remain.
- A new sage/dark recall workspace includes legible writing space, point-by-point feedback, source passage disclosure, clear keyboard controls, a bounded-session summary, narrow-screen layouts and reduced-motion behavior. Insights separates unaided recall/explain/apply/compare outcomes from practice and shows the last five written answers. Legacy mixed-mode ratings are labeled Good/Easy, and the old topic “mastery” bar is relabeled scheduling maturity.

The AI still makes semantic judgments and can be wrong. Structural evidence validation is not proof of semantic correctness. The user can challenge a grade, and the app explicitly abstains when it cannot reliably assess the answer. Flip-card, multiple-choice and simulation behavior remains available with its historical scheduling behavior; those modes do not become new unaided written evidence.

## Next chunks — not implemented yet

3. **Curriculum and progress:** stable concept identities across phrasing, improved concept extraction and importance evaluation, inferred structure for unstructured material, course/subsection hierarchy, delayed mastery criteria, and explainable progress denominators. Question variants should not create new permanent obligations for every phrasing.
4. **Graphs and adaptive guidance:** source-supported prerequisite DAGs, separately typed related-concept links, cycle validation, uncertainty handling, targeted prerequisite checks, and a navigable cross-course map.
5. **Teaching and efficiency:** optional spoken/written teach-back, session time budgets, review-load controls, and conservative credit for component skills actually demonstrated. Evaluate delayed performance before using implicit credit to remove scheduled reviews.

UI improvements continue alongside each functional chunk. A broader home-dashboard redesign remains for later stages.

## Verification for chunk 1

- Unit tests cover heading hierarchy, code fences, chunking, duplicate imports, provenance, all three budget profiles, breadth across sources, preservation of old schedules, final acceptance limits, cancellation and partial failure.
- Run `npm test`, `npm run lint`, and `npm run build`.
- Renderer interaction checks were prepared with a mocked Electron store and generation API, but could not run: the local browser executable was unavailable and the cloud browser policy blocks local previews. Visual layout, interactive renderer behavior and responsive layouts still need desktop verification.
- Real model output quality is not established by mocked API tests. No paid generation calls or packaged Windows desktop run are part of this validation. Source quote matching checks provenance, not the semantic correctness or importance of an answer.

## Acceptance before expanding scope

The first chapter-sized import should produce a useful small set, transparently show coverage gaps, survive interruption, and leave existing study data intact.

## Verification for chunk 2

- 39 tests pass across extraction, assessment and recall state. Grading fixtures exercise paraphrase-shaped evidence, essential omissions, contradictions, additional errors, abstention, invalid and invented evidence, exact cloze matching, bounded inputs, outages and late API results. Scheduling tests cover Good/Hard/Again, assistance and dispute exclusion, immutable first answers, feedback persistence, idempotence, old storage preservation, stale cards, session limits and separate skill/delay counts. Ungraded practice adds activity without reducing the historical positive-rating statistic.
- `npm run lint`, `npm run build`, `node --check electron.cjs` and `git diff --check` pass.
- These are contract and state-transition tests; they do not establish real model grading accuracy. No paid AI call or packaged Windows run was made.
- Local previews are blocked by the available browser policy. Visual inspection and real renderer interaction checks remain unverified; no workaround was used.
- Desktop acceptance: try a clear definition, a valid paraphrase, a keyword-only answer, a negated definition, an incomplete answer and an unfamiliar-domain answer. Check one offline cloze match, an unavailable-key explanation, a disputed result, a hint, and leaving during grading. Confirm that only saved scheduled unaided attempts update review timing and that the session ends after its original bounded set.

Pause after this commit. Continue with curriculum/progress only when Isaac asks.
