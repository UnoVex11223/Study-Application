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

## Next chunks — not implemented yet

2. **Reliable retrieval and grading:** unaided answers as the primary review flow, source-based essential-point assessment, deterministic checks where appropriate, explicit abstention, hint tracking, and separate recall/explanation/application evidence. Audit the current grading fallback and speed-based ratings first.
3. **Curriculum and progress:** stable concept identities across phrasing, improved concept extraction and importance evaluation, inferred structure for unstructured material, course/subsection hierarchy, delayed mastery criteria, and explainable progress denominators. Question variants should not create new permanent obligations for every phrasing.
4. **Graphs and adaptive guidance:** source-supported prerequisite DAGs, separately typed related-concept links, cycle validation, uncertainty handling, targeted prerequisite checks, and a navigable cross-course map.
5. **Teaching and efficiency:** optional spoken/written teach-back, session time budgets, review-load controls, and conservative credit for component skills actually demonstrated. Evaluate delayed performance before using implicit credit to remove scheduled reviews.

UI improvements continue alongside each functional chunk. The home dashboard and assessment screens have not been redesigned in chunk 1.

## Verification for chunk 1

- Unit tests cover heading hierarchy, code fences, chunking, duplicate imports, provenance, all three budget profiles, breadth across sources, preservation of old schedules, final acceptance limits, cancellation and partial failure.
- Run `npm test`, `npm run lint`, and `npm run build`.
- Renderer interaction checks were prepared with a mocked Electron store and generation API, but could not run: the local browser executable was unavailable and the cloud browser policy blocks local previews. Visual layout, interactive renderer behavior and responsive layouts still need desktop verification.
- Real model output quality is not established by mocked API tests. No paid generation calls or packaged Windows desktop run are part of this validation. Source quote matching checks provenance, not the semantic correctness or importance of an answer.

## Acceptance before expanding scope

The first chapter-sized import should produce a useful small set, transparently show coverage gaps, survive interruption, and leave existing study data intact. Review this chunk before proceeding to the grading work.
