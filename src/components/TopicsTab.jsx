import { useRef, useState } from "react";
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

export default function TopicsTab() {
  const { topics, updateTopics, goTopic, deleteConfId, setDeleteConfId } = useApp();
  const [showAddTopic, setShowAddTopic] = useState(false);
  const [newTopicName, setNewTopicName] = useState("");
  const fileRef = useRef(null);
  const uploadIdRef = useRef(null);

  const addTopic = () => {
    if (!newTopicName.trim()) return;
    const id = Date.now();
    updateTopics(p => [...p, { id, name: newTopicName.trim(), gi: p.length % GRADS.length, cards: [] }]);
    setNewTopicName(""); setShowAddTopic(false); goTopic(id);
  };
  const deleteTopic = (id) => { updateTopics(p => p.filter(t => t.id !== id)); setDeleteConfId(null); };

  const pickImage = (tid) => { uploadIdRef.current = tid; fileRef.current?.click(); };
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const tid = uploadIdRef.current;
    if (!file || tid == null) return;
    try {
      const image = await processImage(file);
      updateTopics(p => p.map(t => t.id === tid ? { ...t, image } : t));
    } catch { /* not an image — ignore */ }
  };
  const removeImage = (tid) => updateTopics(p => p.map(t => t.id === tid ? { ...t, image: null } : t));

  return (
    <div className="tgrid">
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onFile}/>
      {topics.map(t => {
        return (
          <div key={t.id} className="tcard" onClick={() => { if (deleteConfId === t.id) return; goTopic(t.id); }}>
            <div className="tcard-cover">
              {t.image ? (
                <img src={t.image} alt={t.name} draggable={false}/>
              ) : (
                <div className="tcard-cover-fallback" style={{ background: GRADS[t.gi] }}>🗂</div>
              )}
              <div className="tcard-acts" onClick={e => e.stopPropagation()}>
                <button className="tcard-act" title={t.image ? "Replace image" : "Add image"} onClick={() => { setDeleteConfId(null); pickImage(t.id); }}>🖼</button>
                {t.image && <button className="tcard-act" title="Remove image" onClick={() => removeImage(t.id)}>✕</button>}
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
        );
      })}
      {showAddTopic ? (
        <div className="glass" style={{ padding: 20, borderRadius: 24 }}>
          <input className="inp" placeholder="Topic name…" value={newTopicName} onChange={e => setNewTopicName(e.target.value)} onKeyDown={e => e.key === "Enter" && addTopic()} autoFocus style={{ marginBottom: 10 }}/>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button className="ab aq sm" onClick={addTopic}>Create</button>
            <button className="ab gh sm" onClick={() => { setShowAddTopic(false); setNewTopicName(""); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="addcard" onClick={() => setShowAddTopic(true)}>
          <span style={{ color: "#fff", fontSize: 30, fontWeight: 300 }}>+</span>
          <span style={{ color: "rgba(255,255,255,.8)", fontSize: 14, fontWeight: 700 }}>New Topic</span>
        </div>
      )}
    </div>
  );
}
