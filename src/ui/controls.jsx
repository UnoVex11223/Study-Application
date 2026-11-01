// Form controls used across pages.

import { cx } from "./cx.js";

/**
 * A row of options with one chosen (theme, course status, question type…).
 * `options` is a list of [value, label] pairs, optionally [value, label, tooltip].
 */
export function Segmented({ options, value, onChange, label, size }) {
  return (
    <div className={cx("seg", size)} role="group" aria-label={label}>
      {options.map(([v, text, title]) => (
        <button key={String(v)} type="button" aria-pressed={v === value} title={title} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

/**
 * A labelled control: the label (with an optional value at the right, like a
 * slider's number), the control itself, and help text under it. Give
 * `htmlFor` when the control is a single input, so clicking the label focuses it.
 */
export function Field({ label, htmlFor, value, help, children }) {
  const Label = htmlFor ? "label" : "span";
  return (
    <div className="field">
      {label && (
        <Label className="field-label" htmlFor={htmlFor}>
          <span>{label}</span>
          {value != null && <span className="field-value num">{value}</span>}
        </Label>
      )}
      {children}
      {help && <span className="help">{help}</span>}
    </div>
  );
}

/** Asks in place before something that can't be undone: "Delete this?  [Cancel] [Delete]". */
export function Confirm({ action = "Delete", onConfirm, onCancel, children }) {
  return (
    <div className="confirm" role="alert">
      <span className="confirm-text">{children}</span>
      <button className="btn btn-sm btn-quiet" onClick={onCancel}>Cancel</button>
      <button className="btn btn-sm btn-danger" onClick={onConfirm}>{action}</button>
    </div>
  );
}
