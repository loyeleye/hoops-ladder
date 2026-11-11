// Builds the film study sets (film/sets/*.json) into www/index.html, between the FILM_SETS:BEGIN and FILM_SETS:END markers.
// Usage: node tools/build_film.mjs          (checks every set, then writes)
//        node tools/build_film.mjs --check  (checks only, and fails if www/index.html is out of date)
// See docs/LEARNING.md, step 26.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dir = path.join(root, "film", "sets");
const page = path.join(root, "www", "index.html");
const files = fs.readdirSync(dir).filter(f => /^s\d+\.json$/.test(f)).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));

const errors = [];
const ids = new Set();
const num = v => typeof v === "number" && Number.isFinite(v);
const pt = (v, w = 500, h = 400) => Array.isArray(v) && v.length === 2 && num(v[0]) && num(v[1]) && v[0] >= 0 && v[0] <= w && v[1] >= 0 && v[1] <= h;
const sets = files.map(f => {
  const s = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const bad = msg => errors.push(`${f}: ${msg}`);
  if (s.id !== f.replace(".json", "")) bad(`id "${s.id}" doesn't match the file name`);
  if (!s.name || !s.blurb) bad("needs a name and a blurb");
  for (const [k, v] of Object.entries(s.src || {})) if (!/^[\w-]{11}$/.test(v.v || "") || !v.t || !v.who) bad(`source ${k} needs v (an 11-character video id), t and who`);
  if (!Array.isArray(s.m) || !s.m.length) bad("has no moments");
  for (const m of s.m || []) {
    const at = msg => bad(`${m.id}: ${msg}`);
    if (ids.has(m.id)) at("duplicate id"); ids.add(m.id);
    if (!(s.src || {})[m.src]) at(`unknown source "${m.src}"`);
    if (!(num(m.start) && num(m.pause) && num(m.end) && m.start <= m.pause && m.pause < m.end)) at("needs start <= pause < end, in seconds");
    if (m.from != null && !(num(m.from) && m.from <= m.start)) at("from has to be at or before start");
    if (!["B", "I"].includes(m.lv)) at('lv is "B" or "I"');
    if (!m.title || !m.q || !m.ans) at("needs a title, a question (q) and an answer (ans)");
    const ch = m.choices || [];
    if (ch.length < 2 || ch.length > 4 || ch.filter(c => c.ok).length !== 1 || ch.some(c => !c.t)) at("needs 2 to 4 choices with exactly one ok");
    if (!Array.isArray(m.cast) || !String(m.cast[0] || "").startsWith("YOU")) at("cast starts with YOU");
    if (m.court) {
      const ps = m.court.players || [];
      if (ps.filter(p => p.you).length !== 1) at("court needs exactly one player with you: true");
      for (const p of ps) if (!["off", "def"].includes(p.k) || !pt([p.x, p.y]) || (p.face && !pt(p.face)) || (p.mv && !pt(p.mv)) || (p.from && !pt(p.from))) at("court player out of bounds or missing k");
    }
  }
  return s;
});
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }

const html = fs.readFileSync(page, "utf8");
const re = /\/\* FILM_SETS:BEGIN \*\/[\s\S]*?\/\* FILM_SETS:END \*\//;
if (!re.test(html)) { console.error("www/index.html has no FILM_SETS markers"); process.exit(1); }
// "<" is escaped so no text in a set can ever close the page's <script> tag.
const block = `/* FILM_SETS:BEGIN */const FILM_SETS=${JSON.stringify(sets).replace(/</g, "\\u003c")};/* FILM_SETS:END */`;
const out = html.replace(re, () => block);
const n = sets.reduce((a, s) => a + s.m.length, 0);
if (process.argv.includes("--check")) {
  if (out !== html) { console.error("www/index.html is out of date: run node tools/build_film.mjs"); process.exit(1); }
  console.log(`${sets.length} sets, ${n} moments: all good`);
} else {
  fs.writeFileSync(page, out);
  console.log(`Built ${sets.length} sets, ${n} moments into www/index.html`);
}
