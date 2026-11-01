/** Joins the class names that are set: cx("btn", on && "on", size) → "btn on sm". */
export const cx = (...names) => names.filter(Boolean).join(" ");
