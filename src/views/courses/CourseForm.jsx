// Create or edit a course: its name and color.
import { useState } from "react";
import { Modal } from "../../ui/overlays.jsx";
import { Field } from "../../ui/controls.jsx";
import { COURSE_COLORS, courseInk } from "../../lib/model.js";

export default function CourseForm({ course, onSave, onClose }) {
  const [name, setName] = useState(course?.name ?? "");
  const [color, setColor] = useState(course?.color ?? null);
  const picked = color ?? course?.color;
  const save = () => { if (name.trim()) onSave({ name: name.trim(), ...(color ? { color } : {}) }); };
  return (
    <Modal title={course ? "Edit course" : "New course"} onClose={onClose}
      footer={<>
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={!name.trim()}>{course ? "Save changes" : "Create course"}</button>
      </>}>
      <Field label="Name" htmlFor="course-name">
        <input id="course-name" className="input" value={name} autoFocus onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && save()}/>
      </Field>
      <Field label="Color">
        <div className="swatches" role="group" aria-label="Color">
          {COURSE_COLORS.map((c, i) => (
            <button key={c} type="button" className="swatch" style={{ "--c": courseInk(c) }}
              aria-label={`Color ${i + 1}`} aria-pressed={picked === c} onClick={() => setColor(c)}/>
          ))}
        </div>
      </Field>
    </Modal>
  );
}
