// Teach, then test: before a concept's first question, its lesson (what it
// is, the terms it introduces, one worked example, a diagram when a picture
// helps), then its first steps, one after another.

import Markdown from "../../ui/Markdown.jsx";
import Diagram from "../../ui/Diagram.jsx";
import { useKey, isTyping } from "../../ui/hooks.js";

export default function LessonCard({ concept, onStart }) {
  const lesson = concept.lesson || {};
  useKey((e) => {
    if (e.key === "Enter" && !isTyping(e) && e.target?.tagName !== "BUTTON") { e.preventDefault(); onStart(); }
  }, [onStart]);
  return (
    <div className="task enter">
      <article className="q-card lesson">
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
        {lesson.example && <div className="lesson-example"><Markdown>{lesson.example}</Markdown></div>}
        {lesson.diagram && <Diagram spec={lesson.diagram}/>}
      </article>
      <div className="row">
        <button className="btn btn-primary" onClick={onStart} autoFocus>Start<span className="kbd">↵</span></button>
      </div>
    </div>
  );
}
