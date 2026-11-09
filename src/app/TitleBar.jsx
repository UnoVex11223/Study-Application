// The title bar: the Tenax mark at the left and Settings at the right. It's
// where you drag the window; the system draws its own buttons over the right
// end (on a Mac, traffic lights at the left), and Settings sits just inside
// them (styles/shell.css). Ctrl+K still opens the command palette.
import Icon from "../ui/Icon.jsx";
import { Logo } from "../ui/display.jsx";
import { cx } from "../ui/cx.js";

/** onSettings: opens Settings (left out while the library can't load). settingsOn: Settings is the page showing. */
export default function TitleBar({ onSettings, settingsOn = false }) {
  const mac = window.tenax?.window?.platform === "darwin";
  return (
    <header className={cx("titlebar", mac && "mac")}>
      <div className="titlebar-brand"><Logo/>tenax</div>
      {onSettings && (
        <button className={cx("btn btn-icon btn-quiet titlebar-settings", settingsOn && "on")} onClick={onSettings}
          aria-label="Settings" title="Settings" aria-current={settingsOn ? "page" : undefined}>
          <Icon name="settings"/>
        </button>
      )}
    </header>
  );
}
