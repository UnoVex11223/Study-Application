import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import App from "./App.jsx";
import "./styles.css";

// Files dropped anywhere but a drop zone do nothing (instead of opening in the window).
for (const type of ["dragover", "drop"]) window.addEventListener(type, (e) => { if (!e.defaultPrevented) e.preventDefault(); });

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App/>
  </StrictMode>,
);
