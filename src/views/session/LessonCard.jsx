// Teach, then test: before a concept's first question, its lesson — what it
// is, the terms it introduces and one worked example (with a diagram when a
// picture helps). Then its first steps, one after another.

import Markdown from "../../ui/Markdown.jsx";
import Diagram from "../../ui/Diagram.jsx";
import { CourseDot } from "../../ui/display.jsx";
import { useKey, isTyping } from "../../ui/hooks.js";
import { plural } from "../../lib/format.js";

export default function LessonCard({ concept, course, section, steps, onStart }) {
  const lesson = concept.lesson || {};
  useKey((e) => {
    if (e.key === "Enter" && !isTyping(e) && e.target?.tagName !== "BUTTON") { e.preventDefault(); onStart(); }
  }, [onStart]);
  return (
    <div className="task enter">
      <div className="session-kind">
        <span>New concept</span>
        {concept.importance === "core" && <span className="tag sky">Core</span>}
      </div>
      <article className="q-card lesson">
        <div className="q-head">
          <CourseDot color={course?.color}/>
          <span className="grow ell">{course?.name}{section ? ` / ${section.title}` : ""}</span>
        </div>
        <h2 className="lesson-title">{concept.name}</h2>
        {concept.summary && <div className="lesson-summary"><Markdown>{concept.summary}</Markdown></div>}
        {lesson.terms?.length > 0 && (
          <dl className="lesson-terms">
            {lesson.terms.map(t => (
              <div key={t.term} className="lesson-term">
                <dt>{t.term}</dt>
                <dd><Markdown>{t.definition}</Markdown></dd>
              </div>
            ))}
          </dl>
        )}
        {lesson.example && (
          <div className="stack gap-2">
            <div className="caption">Worked example</div>
            <div className="lesson-example"><Markdown>{lesson.example}</Markdown></div>
          </div>
        )}
        {lesson.diagram && <Diagram spec={lesson.diagram}/>}
      </article>
      <div className="row">
        <button className="btn btn-primary" onClick={onStart} autoFocus>First question<span className="kbd">↵</span></button>
        {steps > 1 && <span className="muted small">{plural(steps, "step")} on its ladder, simplest first</span>}
      </div>
    </div>
  );
}
