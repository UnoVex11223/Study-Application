import { useEffect, useRef, useState } from "react";
import { useApp, GRADS } from "./context.js";

// Downscale to a reasonable cover size and re-encode as JPEG so the
// stored data URL stays small.
function processImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That doesn't look like an image file."));
      img.onload = () => {
        const MAX_W = 960;
        const scale = Math.min(1, MAX_W / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function TopicModal({ topic, onSave, onClose }) {
  const editing = Boolean(topic);
  const [name, setName] = useState(topic?.name || "");
  const [image, setImage] = useState(topic?.image || null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleFile = async (file) => {
    if (!file) return;
    try {
      setImage(await processImage(file));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  };

  const submit = () => {
    const n = name.trim();
    if (!n) return setError("Give it a name.");
    onSave({ ...(topic || {}), name: n, image });
  };

  return (
    <div className="ov">
      <div className="ov-backdrop" onClick={onClose}/>
      <div className="modal-box fu">
        <div className="modal-title">{editing ? "Edit topic" : "New topic"}</div>

        <div className="field">
          <span className="lbl">NAME</span>
          <input className="inp" value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submit()} autoFocus/>
        </div>

        <div className="field">
          <span className="lbl">COVER IMAGE</span>
          {image ? (
            <div className="cover-preview">
              <img src={image} alt="Cover preview"/>
              <button className="cover-remove" onClick={() => setImage(null)}>✕ Remove</button>
            </div>
          ) : (
            <div
              className={`dropzone${dragOver ? " over" : ""}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
            >
              <div className="dz-title">🖼 Drop an image here, or click to browse</div>
              <div className="dz-sub">Optional — a glossy gradient is used if you skip it</div>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
            onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ""; }}/>
        </div>

        {error && <div className="err">{error}</div>}

        <div className="modal-btns">
          <button className="ab gh md" onClick={onClose}>Cancel</button>
          <button className="ab gr md" onClick={submit}>{editing ? "Save changes" : "Create topic"}</button>
        </div>
      </div>
    </div>
  );
}

export default function TopicsTab() {
  const { topics, updateTopics, goTopic, deleteConfId, setDeleteConfId } = useApp();
  const [modal, setModal] = useState(null); // null | { topic: null } (add) | { topic } (edit)

  const saveTopic = (draft) => {
    if (draft.id) {
      updateTopics(p => p.map(t => t.id === draft.id ? { ...t, name: draft.name, image: draft.image } : t));
    } else {
      updateTopics(p => [...p, { id: Date.now(), name: draft.name, image: draft.image, gi: p.length % GRADS.length, cards: [] }]);
    }
    setModal(null);
  };
  const deleteTopic = (id) => { updateTopics(p => p.filter(t => t.id !== id)); setDeleteConfId(null); };

  return (
    <div className="tgrid">
      {topics.map(t => (
        <div key={t.id} className="tcard" onClick={() => { if (deleteConfId === t.id) return; goTopic(t.id); }}>
          <div className="tcard-cover">
            {t.image ? (
              <img src={t.image} alt={t.name} draggable={false}/>
            ) : (
              <div className="tcard-cover-fallback" style={{ background: GRADS[t.gi] }}>🗂</div>
            )}
            <div className="tcard-acts" onClick={e => e.stopPropagation()}>
              <button className="tcard-act" title="Edit" onClick={() => { setDeleteConfId(null); setModal({ topic: t }); }}>✎</button>
              <button className="tcard-act" title="Delete topic" onClick={() => setDeleteConfId(t.id)}>🗑</button>
            </div>
          </div>
          <div className="tcard-body">
            <div className="tcard-n">{t.name}</div>
            <div className="tcard-c">{t.cards.length} card{t.cards.length !== 1 ? "s" : ""}</div>
          </div>
          {deleteConfId === t.id && (
            <div className="del-ov" onClick={e => e.stopPropagation()}>
              <div style={{ color: "#fff", fontWeight: 800, fontSize: 14, textAlign: "center" }}>Delete "{t.name}"?</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="ab sm rd" onClick={() => deleteTopic(t.id)}>Delete</button>
                <button className="ab gh sm" onClick={() => setDeleteConfId(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      ))}
      <button className="addcard" onClick={() => setModal({ topic: null })}>
        <span className="addcard-plus">＋</span>
        <span className="addcard-txt">New Topic</span>
        <span className="addcard-sub">Cover image &amp; flashcards</span>
      </button>
      {modal && <TopicModal topic={modal.topic} onSave={saveTopic} onClose={() => setModal(null)}/>}
    </div>
  );
}
