import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Type: one family, Inter, for everything (with its optical sizes, so titles
// and small labels are each drawn for their size), and Geist Mono for code.
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/inter/opsz-italic.css";
import "@fontsource-variable/geist-mono";
import App from "./App.jsx";
import "./styles/index.css";

// Files dropped anywhere but a drop zone do nothing (instead of opening in the window).
for (const type of ["dragover", "drop"]) window.addEventListener(type, (e) => { if (!e.defaultPrevented) e.preventDefault(); });

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App/>
  </StrictMode>,
);
