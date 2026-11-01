// What you need to know about your library on disk, in the corner: changes
// that couldn't be saved (Tenax keeps trying), or a damaged library file that
// was replaced by its newest backup. And the screen shown if the library
// can't be opened at all.

import { useStore } from "../state/store.jsx";
import { Notice } from "../ui/display.jsx";
import { longDate } from "../lib/format.js";

export function StorageNotice() {
  const { storage, dismissRecovered } = useStore();
  if (storage.saveError) {
    return (
      <div className="storage-notice" role="alert">
        <Notice tone="bad" icon="alert">
          <strong>Your latest changes aren't saved yet.</strong> Tenax keeps trying; keep it open until this goes away. ({storage.saveError})
        </Notice>
      </div>
    );
  }
  const r = storage.recovered;
  if (!r) return null;
  return (
    <div className="storage-notice" role="status">
      <Notice tone="warn" icon="alert">
        <div className="stack gap-2">
          <span>
            {r.backup
              ? `Your library file was damaged, so Tenax restored the backup from ${longDate(`${r.backup}T12:00:00`)}.`
              : "Your library file was damaged and there was no backup to restore, so Tenax started a new one."}
            {" "}The damaged file was kept in the data folder as {r.damagedFile}.
          </span>
          <div><button className="btn btn-sm" onClick={dismissRecovered}>OK</button></div>
        </div>
      </Notice>
    </div>
  );
}

/** Instead of the app, when the library can't be opened. */
export function LoadError({ message, onRetry }) {
  return (
    <div className="load-error">
      <div className="panel panel-pad stack gap-4">
        <h1 className="page-title">Tenax couldn't open your library</h1>
        <p className="muted">{message}</p>
        <p className="small muted">Nothing has been changed or lost. Your daily backups are in the data folder, under backups.</p>
        <div><button className="btn btn-primary" onClick={onRetry}>Try again</button></div>
      </div>
    </div>
  );
}
