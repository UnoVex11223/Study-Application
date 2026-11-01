// The title bar: the Tenax mark, and the search box that opens the command
// palette. It's where you drag the window; the system draws its own buttons
// over the right end (on a Mac, traffic lights at the left).
import Icon from "../ui/Icon.jsx";
import { Logo } from "../ui/display.jsx";
import { cx } from "../ui/cx.js";

export default function TitleBar({ onSearch }) {
  const mac = window.tenax?.window?.platform === "darwin";
  return (
    <header className={cx("titlebar", mac && "mac")}>
      <div className="titlebar-brand"><Logo/>tenax</div>
      <button className="titlebar-search" onClick={onSearch}>
        <Icon name="search"/><span className="grow">Search</span><kbd className="kbd">{mac ? "⌘" : "Ctrl"} K</kbd>
      </button>
    </header>
  );
}
