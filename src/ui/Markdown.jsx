// Minimal, safe markdown for prompts and answers: paragraphs, lists, fenced
// code, inline code, bold/italic, and KaTeX math ($…$ and $$…$$).
// Renders React elements — never raw HTML from content (KaTeX output only).

import katex from "katex";
import "katex/dist/katex.min.css";

function TeX({ tex, display }) {
  const html = katex.renderToString(tex, { throwOnError: false, displayMode: display, output: "html" });
  return display
    ? <div dangerouslySetInnerHTML={{ __html: html }}/>
    : <span dangerouslySetInnerHTML={{ __html: html }}/>;
}

// Inline tokens: `code`, $math$ (no space after the opening $ or before the
// closing one, and not followed by a digit — so "$5 and $10" stays text),
// **bold**, *italic* / _italic_.
const INLINE_SRC = /(`[^`]+`)|(\$(?!\s)(?:\\\$|[^$\n])+?(?<!\s)\$(?!\d))|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)/.source;

function inline(text, keyBase = "") {
  const out = [];
  let last = 0, m, n = 0;
  const src = String(text);
  const re = new RegExp(INLINE_SRC, "g"); // fresh per call: inline() recurses for bold/italic
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(src.slice(last, m.index).replace(/\\\$/g, "$"));
    const k = `${keyBase}-${n++}`;
    if (m[1]) out.push(<code key={k}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<TeX key={k} tex={m[2].slice(1, -1)}/>);
    else if (m[3]) out.push(<strong key={k}>{inline(m[3].slice(2, -2), k)}</strong>);
    else if (m[4]) out.push(<em key={k}>{inline(m[4].slice(1, -1), k)}</em>);
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push(src.slice(last).replace(/\\\$/g, "$"));
  return out;
}

function withBreaks(text, key) {
  const lines = text.split("\n");
  return lines.flatMap((line, i) => (i ? [<br key={`${key}-br${i}`}/>, ...inline(line, `${key}-${i}`)] : inline(line, `${key}-${i}`)));
}

function parseBlocks(src) {
  const lines = String(src || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push({ type: "code", lang: fence[1], text: body.join("\n") });
      continue;
    }
    if (/^\s*\$\$/.test(line)) {
      const body = [line.replace(/^\s*\$\$/, "")];
      let closed = /\$\$\s*$/.test(body[0]) && body[0].trim() !== "";
      if (closed) body[0] = body[0].replace(/\$\$\s*$/, "");
      i++;
      while (!closed && i < lines.length) {
        const l = lines[i++];
        if (/\$\$\s*$/.test(l)) { body.push(l.replace(/\$\$\s*$/, "")); closed = true; } else body.push(l);
      }
      blocks.push({ type: "math", text: body.join("\n").trim() });
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
      blocks.push({ type: ordered ? "ol" : "ul", items });
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para = [lines[i++].replace(/^#{1,6}\s+/, "")];
    while (i < lines.length && lines[i].trim() && !/^\s*```/.test(lines[i]) && !/^\s*\$\$/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
      para.push(lines[i++].replace(/^#{1,6}\s+/, ""));
    }
    blocks.push({ type: "p", text: para.join("\n") });
  }
  return blocks;
}

export default function Markdown({ children, className = "" }) {
  const blocks = parseBlocks(children);
  return (
    <div className={`md ${className}`}>
      {blocks.map((b, i) => {
        if (b.type === "code") return <pre key={i}><code>{b.text}</code></pre>;
        if (b.type === "math") return <TeX key={i} tex={b.text} display/>;
        if (b.type === "ul") return <ul key={i}>{b.items.map((t, j) => <li key={j}>{inline(t, `${i}-${j}`)}</li>)}</ul>;
        if (b.type === "ol") return <ol key={i}>{b.items.map((t, j) => <li key={j}>{inline(t, `${i}-${j}`)}</li>)}</ol>;
        return <p key={i}>{withBreaks(b.text, `${i}`)}</p>;
      })}
    </div>
  );
}
