// PDF helpers for the main process: read a book's table of contents and pull
// the text of a page range, with page markers so extracted concepts can cite
// where they came from.

let pdfjsPromise = null;
const loadPdfjs = () => (pdfjsPromise ||= import("pdfjs-dist/legacy/build/pdf.mjs"));

async function open(data) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(data).slice(), // copy: pdf.js may detach the buffer
    isEvalSupported: false, useSystemFonts: true, verbosity: 0 });
  const doc = await task.promise;
  doc.close = () => task.destroy();
  return doc;
}

async function resolvePage(doc, dest) {
  try {
    const d = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(d) || !d[0]) return null;
    return (typeof d[0] === "number" ? d[0] : await doc.getPageIndex(d[0])) + 1;
  } catch { return null; }
}

/** Flattened outline, two levels deep: [{ title, page, depth, end }] with end = page before the next entry at the same or higher level. */
async function outline(data) {
  const doc = await open(data);
  const flat = [];
  const walk = async (items, depth) => {
    for (const it of items || []) {
      const page = await resolvePage(doc, it.dest);
      if (page) flat.push({ title: String(it.title || "").trim(), page, depth });
      if (depth < 1) await walk(it.items, depth + 1);
    }
  };
  await walk(await doc.getOutline(), 0);
  flat.sort((a, b) => a.page - b.page || a.depth - b.depth);
  for (let i = 0; i < flat.length; i++) {
    const next = flat.slice(i + 1).find(o => o.depth <= flat[i].depth && o.page > flat[i].page);
    flat[i].end = next ? next.page - 1 : doc.numPages;
  }
  const pages = doc.numPages;
  const meta = await doc.getMetadata().catch(() => null);
  const title = String(meta?.info?.Title || "").trim();
  await doc.close();
  return { pages, outline: flat, title };
}

/** Text of pages [from, to] (1-based, inclusive) with "[Page n]" markers. */
async function pageText(data, from, to) {
  const doc = await open(data);
  const first = Math.max(1, from | 0), last = Math.min(doc.numPages, to | 0 || doc.numPages);
  const parts = [];
  for (let n = first; n <= last; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    let line = "", lines = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      line += item.str;
      if (item.hasEOL) { lines.push(line); line = ""; }
    }
    if (line) lines.push(line);
    const text = lines.map(l => l.replace(/\s+$/g, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
    parts.push(`[Page ${n}]\n${text}`);
    page.cleanup();
  }
  const pages = doc.numPages;
  await doc.close();
  return { pages, from: first, to: last, text: parts.join("\n\n") };
}

module.exports = { outline, pageText };
