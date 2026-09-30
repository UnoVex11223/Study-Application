// Reading: books you read for their own sake. A shelf of covers, a few notes
// per book in your own words, and now and then a quick recall: say what you
// remember, then compare with your notes (see lib/reading.js).

import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../state/store.jsx";
import { useNav } from "../ui/nav.js";
import { Bar, Drawer, Modal, Spinner } from "../ui/ui.jsx";
import Icon from "../ui/Icon.jsx";
import { makeBook, dueBooks, readingStats, recallWhen, hasNotes, READING_STATUS, RECALL_RATINGS } from "../lib/reading.js";
import { shrinkImage } from "../lib/image.js";

const initials = (t) => String(t || "?").split(/\s+/).filter(w => /^[\p{L}\p{N}]/u.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";
const monthYear = (ts) => new Date(ts).toLocaleDateString(undefined, { month: "short", year: "numeric" });
const byNewest = (key) => (a, b) => (b[key] || b.createdAt || 0) - (a[key] || a.createdAt || 0);

function Stars({ value, onChange, size = 15 }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <span className={`stars${onChange ? " editable" : ""}`} onMouseLeave={() => setHover(0)} role={onChange ? "radiogroup" : "img"} aria-label={`${value || 0} of 5 stars`}>
      {[1, 2, 3, 4, 5].map(n => (
        <svg key={n} width={size} height={size} viewBox="0 0 24 24" aria-hidden={!onChange}
          role={onChange ? "radio" : undefined} aria-checked={onChange ? value === n : undefined}
          onMouseEnter={() => onChange && setHover(n)} onClick={() => onChange?.(value === n ? 0 : n)}>
          <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
            fill={n <= shown ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        </svg>
      ))}
    </span>
  );
}

function Cover({ book, small }) {
  return (
    <div className={`book-cover${small ? " small" : ""}`}>
      {book.cover ? <img src={book.cover} alt="" draggable={false}/> : <div className="book-blank"><span>{initials(book.title)}</span></div>}
    </div>
  );
}

export default function Reading({ recall: startRecall = false }) {
  const { state } = useStore();
  const nav = useNav();
  const now = nav.now;
  const books = state.reading;
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [recallQueue, setRecallQueue] = useState(() => (startRecall ? dueBooks(state.reading, Date.now()).map(b => b.id) : null));

  const due = dueBooks(books, now);
  const stats = readingStats(books, now);
  const reading = books.filter(b => b.status === "reading").sort(byNewest("startedAt"));
  const finished = books.filter(b => b.status === "finished").sort(byNewest("finishedAt"));
  const want = books.filter(b => b.status === "want").sort(byNewest("createdAt"));
  const open = books.find(b => b.id === openId) || null;

  const card = (b) => (
    <button key={b.id} className="book-card" onClick={() => setOpenId(b.id)}>
      <Cover book={b}/>
      <div className="book-title">{b.title}</div>
      {b.author && <div className="book-author">{b.author}</div>}
      <div className="book-meta">
        {b.status === "reading" && b.totalPages > 0 && (
          <>
            <Bar value={Math.min(1, (b.currentPage || 0) / b.totalPages)} thin/>
            <span>p. {b.currentPage || 0} / {b.totalPages}</span>
          </>
        )}
        {b.status === "finished" && (
          <span className="row" style={{ gap: 8 }}>{b.rating > 0 && <Stars value={b.rating} size={12}/>}{b.finishedAt && <span>{monthYear(b.finishedAt)}</span>}</span>
        )}
        {due.some(d => d.id === b.id) && <span className="tag">Recall due</span>}
      </div>
    </button>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Reading</h1></div>
        <div className="row">
          {due.length > 0 && (
            <button className="btn btn-primary" onClick={() => setRecallQueue(due.map(b => b.id))}>
              <Icon name="play" size={12}/>Recall {due.length} book{due.length === 1 ? "" : "s"}
            </button>
          )}
          <button className={`btn${due.length ? "" : " btn-primary"}`} onClick={() => setAdding(true)}><Icon name="plus" size={16}/>Add a book</button>
        </div>
      </div>

      {books.length === 0 ? (
        <div className="panel empty">
          <h3>No books yet</h3>
          <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={16}/>Add a book</button>
        </div>
      ) : (
        <>
          <div className="stats" style={{ marginBottom: 28 }}>
            <div className="stat"><div className="stat-value">{stats.reading}</div><div className="stat-label">reading now</div></div>
            <div className="stat"><div className="stat-value">{stats.finishedThisYear}</div><div className="stat-label">finished this year</div></div>
            <div className="stat"><div className="stat-value">{stats.finished}</div><div className="stat-label">finished in all</div></div>
            <div className="stat"><div className="stat-value">{stats.due}</div><div className="stat-label">to recall</div></div>
          </div>

          {reading.length > 0 && (
            <section className="book-section">
              <h2 className="h">Reading now</h2>
              <div className="book-grid">{reading.map(card)}</div>
            </section>
          )}
          {finished.length > 0 && (
            <section className="book-section">
              <h2 className="h">Finished</h2>
              <div className="book-grid">{finished.map(card)}</div>
            </section>
          )}
          {want.length > 0 && (
            <section className="book-section">
              <h2 className="h">Want to read</h2>
              <div className="book-grid">{want.map(card)}</div>
            </section>
          )}
        </>
      )}

      {open && <BookPanel key={open.id} book={open} now={now} onClose={() => setOpenId(null)} onRecall={() => setRecallQueue([open.id])}/>}
      {adding && <BookForm onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); setOpenId(id); }}/>}
      {recallQueue && <RecallSession queue={recallQueue} onClose={() => setRecallQueue(null)}/>}
    </div>
  );
}

/** Notes save as you type (after a short pause) and when the panel closes. */
function useDraft(book, act) {
  const [draft, setDraft] = useState({ about: book.about || "", thoughts: book.thoughts || "", ideas: book.ideas || "" });
  const pending = useRef(null);
  const timer = useRef(0);
  const id = book.id;
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (pending.current) { act("reading/update", { id, patch: pending.current }); pending.current = null; }
  }, [act, id]);
  useEffect(() => flush, [flush]);
  const change = (field, value) => {
    setDraft(d => ({ ...d, [field]: value }));
    pending.current = { ...(pending.current || {}), [field]: value };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  };
  return [draft, change];
}

function BookPanel({ book, now, onClose, onRecall }) {
  const { act } = useStore();
  const [draft, change] = useDraft(book, act);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const patch = (p) => act("reading/update", { id: book.id, patch: p });

  return (
    <Drawer onClose={onClose} title={book.title} subtitle={book.author || undefined}
      actions={<button className="btn btn-sm btn-quiet" onClick={() => setEditing(true)}><Icon name="edit" size={14}/>Edit</button>}>
      <div className="book-panel-top">
        <Cover book={book} small/>
        <div className="stack" style={{ gap: 12, minWidth: 0 }}>
          <div className="seg" role="group" aria-label="Status">
            {Object.entries(READING_STATUS).map(([k, v]) => (
              <button key={k} className={book.status === k ? "on" : ""} onClick={() => patch({ status: k })}>{v.label}</button>
            ))}
          </div>
          {book.status === "finished" && <Stars value={book.rating || 0} onChange={(n) => patch({ rating: n })} size={18}/>}
          {book.status === "reading" && (
            <div className="row" style={{ gap: 8 }}>
              <input className="input" type="number" min="0" style={{ width: 90 }} aria-label="Current page" value={book.currentPage || ""}
                onChange={e => patch({ currentPage: Math.max(0, parseInt(e.target.value, 10) || 0) })}/>
              <span className="muted small">of</span>
              <input className="input" type="number" min="0" style={{ width: 90 }} aria-label="Total pages" value={book.totalPages || ""}
                onChange={e => patch({ totalPages: Math.max(0, parseInt(e.target.value, 10) || 0) })}/>
              <span className="muted small">pages</span>
            </div>
          )}
          <div className="book-dates">
            {book.startedAt && <span>Started {new Date(book.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>}
            {book.finishedAt && <span>Finished {new Date(book.finishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>}
          </div>
        </div>
      </div>

      <div className="stack" style={{ gap: 16 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="rb-about">What it's about</label>
          <textarea id="rb-about" className="textarea" style={{ minHeight: 80 }} value={draft.about} onChange={e => change("about", e.target.value)}/>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="rb-thoughts">What I thought</label>
          <textarea id="rb-thoughts" className="textarea" style={{ minHeight: 80 }} value={draft.thoughts} onChange={e => change("thoughts", e.target.value)}/>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="rb-ideas">Ideas worth keeping</label>
          <textarea id="rb-ideas" className="textarea" style={{ minHeight: 80 }} value={draft.ideas} onChange={e => change("ideas", e.target.value)}/>
        </div>
      </div>

      {hasNotes({ ...book, ...draft }) && (
        <div className="book-recall-row">
          <span className="grow small">
            {book.recall
              ? <>Next recall {recallWhen(book.recall, now)}{book.recall.count ? <span className="muted"> · recalled {book.recall.count} time{book.recall.count === 1 ? "" : "s"}</span> : null}</>
              : "First recall in 3 days"}
          </span>
          <button className="btn btn-sm" onClick={onRecall}><Icon name="play" size={11}/>Recall now</button>
        </div>
      )}

      <div>
        {!confirm
          ? <button className="btn btn-sm btn-quiet" onClick={() => setConfirm(true)}><Icon name="trash" size={14}/>Remove book</button>
          : (
            <div className="row" style={{ gap: 8 }}>
              <span className="small grow">Remove “{book.title}” and its notes?</span>
              <button className="btn btn-sm btn-quiet" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn btn-sm btn-danger" onClick={() => { act("reading/remove", { id: book.id }); onClose(); }}>Remove</button>
            </div>
          )}
      </div>

      {editing && <BookForm book={book} onClose={() => setEditing(false)} onSaved={() => setEditing(false)}/>}
    </Drawer>
  );
}

function BookForm({ book, onClose, onSaved }) {
  const { act } = useStore();
  const [title, setTitle] = useState(book?.title || "");
  const [author, setAuthor] = useState(book?.author || "");
  const [cover, setCover] = useState(book?.cover || null);
  const [status, setStatus] = useState(book?.status || "reading");
  const [totalPages, setTotalPages] = useState(book?.totalPages || "");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  const takeFile = async (file) => {
    if (!file) return;
    setBusy(true);
    try { setCover(await shrinkImage(file, { maxW: 360 })); setError(""); } catch (err) { setError(err.message); }
    setBusy(false);
  };
  const save = () => {
    if (!title.trim()) return setError("Give it a title.");
    const fields = { title: title.trim(), author: author.trim(), cover, status, totalPages: Math.max(0, parseInt(totalPages, 10) || 0) };
    if (book) { act("reading/update", { id: book.id, patch: fields }); onSaved(book.id); return; }
    const created = makeBook({ ...fields, startedAt: status === "reading" ? Date.now() : null, finishedAt: status === "finished" ? Date.now() : null });
    act("reading/add", { book: created });
    onSaved(created.id);
  };

  return (
    <Modal title={book ? "Edit book" : "Add a book"} onClose={onClose}
      footer={<>
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{book ? "Save changes" : "Add book"}</button>
      </>}>
      <div className="book-form">
        <div className="book-form-cover">
          {cover ? (
            <div className="stack" style={{ gap: 8 }}>
              <img src={cover} alt="Cover"/>
              <button type="button" className="btn btn-sm" onClick={() => setCover(null)}><Icon name="x" size={14}/>Remove</button>
            </div>
          ) : (
            <button type="button" className={`dropzone book-drop-cover${over ? " over" : ""}`} onClick={() => fileRef.current?.click()} aria-label="Add a cover image"
              onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); takeFile(e.dataTransfer.files?.[0]); }}>
              {busy ? <Spinner/> : <Icon name="upload" size={18}/>}
              <span>Cover</span>
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { takeFile(e.target.files?.[0]); e.target.value = ""; }}/>
        </div>
        <div>
          <div className="field">
            <label htmlFor="rb-title">Title</label>
            <input id="rb-title" className="input" value={title} autoFocus onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === "Enter" && save()}/>
          </div>
          <div className="field">
            <label htmlFor="rb-author">Author</label>
            <input id="rb-author" className="input" value={author} onChange={e => setAuthor(e.target.value)} onKeyDown={e => e.key === "Enter" && save()}/>
          </div>
          <div className="field">
            <span className="label">Status</span>
            <div className="seg" style={{ alignSelf: "flex-start" }}>
              {Object.entries(READING_STATUS).map(([k, v]) => (
                <button key={k} type="button" className={status === k ? "on" : ""} onClick={() => setStatus(k)}>{v.label}</button>
              ))}
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="rb-pages">Pages</label>
            <input id="rb-pages" className="input" type="number" min="0" style={{ width: 120 }} value={totalPages} onChange={e => setTotalPages(e.target.value)}/>
          </div>
        </div>
      </div>
      {error && <p className="small" style={{ color: "var(--bad)", marginTop: 12 }}>{error}</p>}
    </Modal>
  );
}

/** One book at a time: say what you remember, then compare with your notes and say how it went. */
function RecallSession({ queue, onClose }) {
  const { state, act } = useStore();
  const [at, setAt] = useState(0);
  const [text, setText] = useState("");
  const [shown, setShown] = useState(false);
  const [keep, setKeep] = useState(false);
  const [done, setDone] = useState(0);
  const book = state.reading.find(b => b.id === queue[at]);

  const rate = (rating) => {
    act("reading/recall", { id: book.id, rating, note: keep ? text : "" });
    setDone(n => n + 1);
    setAt(i => i + 1);
    setText(""); setShown(false); setKeep(false);
  };

  if (!book) {
    return (
      <Modal title="Recall" onClose={onClose} width={620}
        footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
        <p style={{ margin: 0 }}>{done ? `${done} book${done === 1 ? "" : "s"} recalled.` : "Nothing to recall right now."}</p>
      </Modal>
    );
  }

  return (
    <Modal title="Recall" onClose={onClose} width={620}>
      <div className="recall-head">
        <Cover book={book} small/>
        <div style={{ minWidth: 0 }}>
          <div className="muted small">{at + 1} of {queue.length}</div>
          <div className="recall-title">{book.title}</div>
          {book.author && <div className="muted">{book.author}</div>}
        </div>
      </div>
      <div className="field">
        <label htmlFor="rc-text">What do you remember?</label>
        <textarea id="rc-text" className="textarea" style={{ minHeight: 110 }} value={text} autoFocus
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !shown) { e.preventDefault(); setShown(true); } }}/>
      </div>
      {!shown ? (
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-primary" onClick={() => setShown(true)}>Show my notes</button>
        </div>
      ) : (
        <>
          <div className="recall-notes">
            {book.about?.trim() && <div><div className="label">What it's about</div><p>{book.about}</p></div>}
            {book.thoughts?.trim() && <div><div className="label">What I thought</div><p>{book.thoughts}</p></div>}
            {book.ideas?.trim() && <div><div className="label">Ideas worth keeping</div><p>{book.ideas}</p></div>}
          </div>
          {text.trim() && (
            <label className="row small" style={{ gap: 8, margin: "14px 0 4px", cursor: "pointer" }}>
              <input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)}/>Add what I wrote to my notes
            </label>
          )}
          <div className="recall-ratings">
            {RECALL_RATINGS.map(r => (
              <button key={r.rating} className="btn" onClick={() => rate(r.rating)}>{r.label}</button>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
