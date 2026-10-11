// Covers from Open Library (free, no key): search by title and author, or by
// ISBN, then download the chosen cover. Runs in the main process (no CORS, and
// the page never talks to the network itself). `fetch` is passed in so the
// tests can stub it.

const SEARCH = "https://openlibrary.org/search.json";
const COVERS = "https://covers.openlibrary.org/b";
const UA = "Tenax (desktop study app; github.com/UnoVex11223/Study-Application)";
const MAX = 8;

/** The ISBN in a string (10 or 13 characters, hyphens and spaces allowed), or null. */
function isbnOf(s) {
  const t = String(s || "").replace(/[\s-]/g, "").toUpperCase();
  return /^(\d{9}[\dX]|\d{13})$/.test(t) ? t : null;
}

/** The search URL for a title (or ISBN) and an optional author. */
function searchUrl({ title = "", author = "" } = {}) {
  const isbn = isbnOf(title);
  const q = new URLSearchParams();
  if (isbn) q.set("isbn", isbn);
  else {
    q.set("title", String(title).trim().slice(0, 200));
    if (String(author).trim()) q.set("author", String(author).trim().slice(0, 120));
  }
  q.set("fields", "key,title,author_name,cover_i,first_publish_year,edition_count");
  q.set("limit", "20");
  return `${SEARCH}?${q}`;
}

/**
 * Covers worth offering from a search result: books that have one, the most
 * printed editions first (that's usually the cover people know), at most 8,
 * no two the same picture.
 */
function candidates(json, { isbn = null } = {}) {
  const docs = Array.isArray(json?.docs) ? json.docs : [];
  const seen = new Set();
  const out = [];
  if (isbn) out.push({ id: `isbn:${isbn}`, title: docs[0]?.title || "", author: docs[0]?.author_name?.[0] || "", year: docs[0]?.first_publish_year || null, thumb: `${COVERS}/isbn/${isbn}-M.jpg?default=false` });
  for (const d of [...docs].sort((a, b) => (b.edition_count || 0) - (a.edition_count || 0))) {
    if (!Number.isInteger(d.cover_i) || d.cover_i <= 0 || seen.has(d.cover_i)) continue;
    seen.add(d.cover_i);
    out.push({ id: `id:${d.cover_i}`, title: d.title || "", author: d.author_name?.[0] || "", year: d.first_publish_year || null, thumb: `${COVERS}/id/${d.cover_i}-M.jpg` });
    if (out.length >= MAX) break;
  }
  return out;
}

/** The large image's URL for a candidate id ("id:123" or "isbn:978…"), or null if it isn't one of ours. */
function coverUrl(id) {
  const m = /^(id|isbn):([\dX]{1,13})$/i.exec(String(id || ""));
  return m ? `${COVERS}/${m[1].toLowerCase()}/${m[2]}-L.jpg?default=false` : null;
}

async function search(fetchFn, query) {
  try {
    const res = await fetchFn(searchUrl(query), { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return { ok: false, error: `Open Library answered ${res.status}` };
    return { ok: true, covers: candidates(await res.json(), { isbn: isbnOf(query?.title) }) };
  } catch (err) {
    return { ok: false, error: err?.name === "TimeoutError" ? "Open Library didn't answer in time" : "Couldn't reach Open Library" };
  }
}

/** Download a cover as a data URL (the page shrinks it before saving). */
async function download(fetchFn, id) {
  const url = coverUrl(id);
  if (!url) return { ok: false, error: "Not a cover from the search" };
  try {
    const res = await fetchFn(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return { ok: false, error: res.status === 404 ? "That cover isn't available" : `Open Library answered ${res.status}` };
    const type = res.headers.get("content-type") || "image/jpeg";
    if (!/^image\//.test(type)) return { ok: false, error: "That isn't an image" };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) return { ok: false, error: "That image is too large" };
    return { ok: true, dataUrl: `data:${type};base64,${buf.toString("base64")}` };
  } catch (err) {
    return { ok: false, error: err?.name === "TimeoutError" ? "Open Library didn't answer in time" : "Couldn't download the cover" };
  }
}

module.exports = { isbnOf, searchUrl, candidates, coverUrl, search, download };
