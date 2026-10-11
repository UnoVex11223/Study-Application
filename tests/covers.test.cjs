// Covers from Open Library (covers.cjs): building the search, picking what to
// offer, and downloading, with fetch stubbed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const covers = require("../covers.cjs");

test("an ISBN is recognised with or without hyphens", () => {
  assert.equal(covers.isbnOf("978-0-13-110362-7"), "9780131103627");
  assert.equal(covers.isbnOf("0 13 110362 8"), "0131103628");
  assert.equal(covers.isbnOf("013110370x"), "013110370X");
  assert.equal(covers.isbnOf("The C Programming Language"), null);
  assert.equal(covers.isbnOf("12345"), null);
});

test("the search asks by title and author, or by ISBN", () => {
  const u = new URL(covers.searchUrl({ title: "Dune", author: "Frank Herbert" }));
  assert.equal(u.searchParams.get("title"), "Dune");
  assert.equal(u.searchParams.get("author"), "Frank Herbert");
  assert.match(u.searchParams.get("fields"), /cover_i/);
  const i = new URL(covers.searchUrl({ title: "978-0-13-110362-7", author: "ignored" }));
  assert.equal(i.searchParams.get("isbn"), "9780131103627");
  assert.equal(i.searchParams.get("title"), null);
});

test("covers on offer: ones that exist, most editions first, no repeats, at most 8", () => {
  const docs = [
    { title: "Dune Messiah", cover_i: 2, edition_count: 40, author_name: ["Frank Herbert"] },
    { title: "Dune", cover_i: 1, edition_count: 200, author_name: ["Frank Herbert"], first_publish_year: 1965 },
    { title: "No cover", edition_count: 999 },
    { title: "Dune (again)", cover_i: 1, edition_count: 10 },
    ...Array.from({ length: 12 }, (_, k) => ({ title: `Other ${k}`, cover_i: 100 + k, edition_count: 1 })),
  ];
  const out = covers.candidates({ docs });
  assert.equal(out.length, 8);
  assert.deepEqual(out.slice(0, 2).map(c => c.id), ["id:1", "id:2"]);
  assert.equal(out[0].year, 1965);
  assert.match(out[0].thumb, /covers\.openlibrary\.org\/b\/id\/1-M\.jpg$/);
  const byIsbn = covers.candidates({ docs: [{ title: "K&R", cover_i: 7 }] }, { isbn: "9780131103627" });
  assert.equal(byIsbn[0].id, "isbn:9780131103627");
  assert.deepEqual(covers.candidates(null), []);
});

test("only covers from the search can be downloaded", () => {
  assert.equal(covers.coverUrl("id:123"), "https://covers.openlibrary.org/b/id/123-L.jpg?default=false");
  assert.equal(covers.coverUrl("isbn:9780131103627"), "https://covers.openlibrary.org/b/isbn/9780131103627-L.jpg?default=false");
  assert.equal(covers.coverUrl("http://evil.example/x.jpg"), null);
  assert.equal(covers.coverUrl("id:../../etc"), null);
});

test("search and download go through fetch and report failures plainly", async () => {
  const seen = [];
  const ok = (body, type = "application/json") => ({
    ok: true, status: 200, headers: { get: () => type },
    json: async () => body, arrayBuffer: async () => new TextEncoder().encode("JPEGDATA").buffer,
  });
  const fetchFn = async (url, opts) => { seen.push({ url, ua: opts.headers["User-Agent"] }); return url.includes("search.json") ? ok({ docs: [{ title: "Dune", cover_i: 5 }] }) : ok(null, "image/jpeg"); };
  const s = await covers.search(fetchFn, { title: "Dune" });
  assert.equal(s.ok, true);
  assert.equal(s.covers[0].id, "id:5");
  const d = await covers.download(fetchFn, "id:5");
  assert.equal(d.ok, true);
  assert.equal(d.dataUrl, `data:image/jpeg;base64,${Buffer.from("JPEGDATA").toString("base64")}`);
  assert.ok(seen.every(r => /Tenax/.test(r.ua)), "says who's asking");

  const missing = await covers.download(async () => ({ ok: false, status: 404, headers: { get: () => "" } }), "id:5");
  assert.deepEqual(missing, { ok: false, error: "That cover isn't available" });
  const html = await covers.download(async () => ok(null, "text/html"), "id:5");
  assert.equal(html.ok, false);
  const down = await covers.search(async () => { throw new Error("offline"); }, { title: "Dune" });
  assert.deepEqual(down, { ok: false, error: "Couldn't reach Open Library" });
});
