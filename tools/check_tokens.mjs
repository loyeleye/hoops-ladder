// Fails if www/index.html uses a CSS custom property (var(--name)) that nothing defines.
// An undefined token silently falls back, and a fallback colour doesn't follow the theme: that is how
// the Form tab's session rows came out white with white text in dark mode (var(--card,#fff); there is no --card).
// Usage: node tools/check_tokens.mjs   (CI runs it on every build; docs/LEARNING.md, step 31)
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const file = path.join(root, "www", "index.html");
const html = fs.readFileSync(file, "utf8");

// Tokens that are optional on purpose: each has a fixed fallback that is meant to look the same in both themes.
const OPTIONAL = new Set([
  "--fv-rim", "--fv-board", // film diagrams: optional rim and backboard colours (see the comment above the diagram code)
  "--plate",                // the session recap card: always a dark plate with light text
]);

const defined = new Set();
for (const m of html.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
for (const m of html.matchAll(/setProperty\(\s*["'`](--[\w-]+)/g)) defined.add(m[1]);
for (const m of html.matchAll(/["'](--[\w-]+)["']\s*:/g)) defined.add(m[1]); // style objects like {"--fv-skin": ...}

const bad = new Map();
const lines = html.split("\n");
lines.forEach((line, i) => {
  for (const m of line.matchAll(/var\(\s*(--[\w-]+)(\$\{)?/g)) {
    const name = m[1];
    if (m[2]) continue; // built in a template string, e.g. var(--fv-${k})
    if (defined.has(name) || OPTIONAL.has(name)) continue;
    if (!bad.has(name)) bad.set(name, []);
    bad.get(name).push(i + 1);
  }
});

if (bad.size) {
  console.error("Undefined CSS tokens in www/index.html (use a theme token such as --surface-2, --ink, --line, --accent):");
  for (const [name, at] of bad) console.error(`  ${name}  line ${at.slice(0, 5).join(", ")}${at.length > 5 ? ", ..." : ""}`);
  process.exit(1);
}
console.log(`CSS tokens OK: ${defined.size} defined, none used without a definition.`);
