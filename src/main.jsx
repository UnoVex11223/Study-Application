import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Type: Atkinson Hyperlegible Next for everything you read and operate,
// Shippori Mincho for titles, names and the big numbers, Geist Mono for code.
import "@fontsource-variable/atkinson-hyperlegible-next/wght.css";
import "@fontsource-variable/atkinson-hyperlegible-next/wght-italic.css";
import "@fontsource/shippori-mincho/latin-500.css";
import "@fontsource/shippori-mincho/latin-ext-500.css";
import "@fontsource/shippori-mincho/latin-700.css";
import "@fontsource/shippori-mincho/latin-ext-700.css";
import "@fontsource-variable/geist-mono";
import App from "./App.jsx";
import "./styles.css";

// Files dropped anywhere but a drop zone do nothing (instead of opening in the window).
for (const type of ["dragover", "drop"]) window.addEventListener(type, (e) => { if (!e.defaultPrevented) e.preventDefault(); });

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App/>
  </StrictMode>,
);
