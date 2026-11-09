// Teach, then test: before a concept's first question, its lesson (what it
// is, the terms it introduces, one worked example, a diagram when a picture
// helps), then its first steps, one after another. Laid out with room to
// breathe: the name, what it is, then Terms and Example as their own blocks.

import Markdown from "../../ui/Markdown.jsx";
import Diagram from "../../ui/Diagram.jsx";
import { useKey, isTyping } from "../../ui/hooks.js";

export default function LessonCard({ concept, onStart }) {
  const lesson = concept.lesson || {};
  useKey((e) => {
    if (e.key === "Enter" && !isTyping(e) && e.target?.tagName !== "BUTTON") { e.preventDefault(); onStart(); }
  }, [onStart]);
  return (
    <div className="task enter lesson-view">
      <article className="lesson">
        <header className="lesson-head">
          <div className="lesson-kicker">New</div>
          <h2 className="lesson-title">{concept.name}</h2>
          {concept.summary && <div className="lesson-summary"><Markdown>{concept.summary}</Markdown></div>}
        </header>
        {lesson.terms?.length > 0 && (
          <section className="lesson-block">
            <h3 className="lesson-caption">Terms</h3>
            <dl className="lesson-terms">
              {lesson.terms.map(t => (
                <div key={t.term} className="lesson-term">
                  <dt>{t.term}</dt>
                  <dd><Markdown>{t.definition}</Markdown></dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {lesson.example && (
          <section className="lesson-block">
            <h3 className="lesson-caption">Example</h3>
            <div className="lesson-example"><Markdown>{lesson.example}</Markdown></div>
          </section>
        )}
        {lesson.diagram && <Diagram spec={lesson.diagram}/>}
      </article>
      <div className="lesson-actions">
        <button className="btn btn-primary btn-lg lesson-start" onClick={onStart} autoFocus>Start</button>
      </div>
    </div>
  );
}
