// Renders the Google Play store art from the app itself, so it can be redone whenever the app changes.
//   - store/graphics/icon-512.png           Play Store icon (512 x 512)
//   - store/graphics/feature-graphic.png    Play feature graphic (1024 x 500)
//   - store/screenshots/phone-*.png         phone screenshots with captions (1080 x 1920)
//   - android/app/src/main/res/mipmap-*/    launcher icons (legacy, round and adaptive foreground)
// It serves www/ locally, opens it in headless Chromium at phone size with made-up demo progress,
// takes the screenshots, and draws the rest from store/art/icon.svg.
// Needs Playwright with Chromium:  npm i --no-save playwright && npx playwright install chromium
// Usage: node tools/make_store_art.mjs        See docs/LEARNING.md, step 8.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const www = path.join(root, "www");
const out = (...p) => path.join(root, ...p);
const iconSvg = fs.readFileSync(out("store/art/icon.svg"), "utf8");

// ---- a tiny static server for www/ (the page uses ES modules and fetch, which need http://, not file://)
const types = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".gif": "image/gif", ".wasm": "application/wasm", ".png": "image/png" };
const shots = new Map(); // name -> PNG buffer, served at /shot/<name>.png for the caption pages
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (url.startsWith("/shot/")) { res.writeHead(200, { "content-type": "image/png" }); return res.end(shots.get(path.basename(url, ".png"))); }
  let p = path.join(www, url);
  if (p.endsWith("/")) p += "index.html";
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
    res.end(d);
  });
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
// The caption pages are blank pages, so the app's fonts need absolute URLs.
const fontsCss = fs.readFileSync(path.join(www, "fonts/fonts.css"), "utf8").replace(/url\(/g, `url(${base}/fonts/`);

// ---- demo progress: about three weeks of practice, invented for the screenshots only
function demo() {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const sessions = [];
  for (let back = 20; back >= 0; back--) {
    if (![0, 2, 4].includes(back % 7)) continue;
    const d = new Date();
    d.setDate(d.getDate() - back);
    const spots = {};
    for (const [k, b] of Object.entries({ lc: 0.36, lw: 0.3, top: 0.33, rw: 0.26, rc: 0.38 })) spots[k] = [Math.round(10 * (b + rnd() * 0.12 - 0.06 + (20 - back) / 100)), 10];
    const m = Object.values(spots).reduce((s, v) => s + v[0], 0);
    sessions.push({ d: d.toISOString().slice(0, 10), items: [
      { id: "s_line", t: d.getTime(), xp: 30 },
      { id: "s_5spot", t: d.getTime(), xp: 60, m, a: 50, g: 35, spots },
      { id: "s_ft", t: d.getTime(), xp: 30, m: 14 + Math.round(rnd() * 4), a: 20 },
    ] });
  }
  return { v: 1, xp: { s: 1420, h: 880, f: 640 }, sessions, settings: { mins: 30, partner: false, heavy: false, hand: "R", input: "sets", inV: 2 }, forms: [] };
}

const browser = await chromium.launch();

// ---- 1. raw app screens at 360 x 740 CSS px, 3x = 1080 x 2220
async function appShots(scheme) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 3, colorScheme: scheme });
  await ctx.addInitScript((s) => { try { localStorage.setItem("hoopsLadder.v1", s); } catch (e) {} }, JSON.stringify(demo()));
  const pg = await ctx.newPage();
  await pg.goto(base + "/");
  await pg.waitForTimeout(1500);
  for (const t of ["today", "drills", "form", "progress"]) {
    await pg.click(`[data-tab="${t}"]`);
    await pg.waitForTimeout(800);
    shots.set(`${scheme}_${t}`, await pg.screenshot());
  }
  await pg.click('[data-tab="drills"]');
  await pg.locator("text=Roll-Up Drill").first().click();
  await pg.waitForTimeout(1500);
  shots.set(`${scheme}_runner`, await pg.screenshot());
  await ctx.close();
}
await appShots("light");
await appShots("dark");

// ---- 2. captioned store screenshots, 1080 x 1920 (9:16)
const captions = [
  ["light_today", "A workout for today", "Pick 20, 30 or 45 minutes and get a session built for your level."],
  ["light_runner", "Drills, step by step", "Animated steps, a demo, and one cue at a time."],
  ["light_drills", "Climb the ladder", "Hit your goal twice to unlock the next, harder drills."],
  ["light_progress", "Find your hot spots", "Your 3-point map by spot, over 30 days or all time."],
  ["dark_form", "Check your shooting form", "Pose tracking runs on your phone. Your clips never leave it."],
];
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
await page.goto(base + "/fonts/fonts.css"); // gives the caption pages the local server's origin, so fonts and shots load
// Fonts download only once text uses them, so wait for both families before each screenshot.
const fontsReady = () => page.evaluate(async () => { await document.fonts.load('800 40px "Saira Condensed"'); await document.fonts.load('400 40px "Barlow"'); await document.fonts.ready; });
const frame = (shot, title, sub) => `<!doctype html><style>${fontsCss}
  body{margin:0;width:1080px;height:1920px;background:#12203A;color:#F4F6FA;font-family:Barlow;overflow:hidden;position:relative}
  h1{font-family:"Saira Condensed";font-weight:800;font-size:104px;line-height:1;margin:0;text-transform:uppercase;letter-spacing:.5px}
  h1 span{color:#F07A35}
  p{font-size:44px;line-height:1.3;margin:28px 0 0;color:#C5CEDF}
  .cap{padding:110px 90px 0}
  .phone{position:absolute;left:130px;top:560px;width:820px;height:1600px;border-radius:64px;background:#000;padding:18px;box-sizing:border-box;box-shadow:0 30px 80px rgba(0,0,0,.45)}
  .phone img{width:100%;border-radius:48px;display:block}
</style><div class="cap"><h1>${title.replace(/(\S+)$/, "<span>$1</span>")}</h1><p>${sub}</p></div>
<div class="phone"><img src="${base}/shot/${shot}.png"></div>`;
let i = 1;
for (const [shot, title, sub] of captions) {
  await page.setContent(frame(shot, title, sub), { waitUntil: "networkidle" });
  await fontsReady();
  await page.screenshot({ path: out(`store/screenshots/phone-${i++}.png`) });
}

// ---- 3. Play icon, 512 x 512 (Play adds the rounded corners and shadow)
await page.setViewportSize({ width: 512, height: 512 });
await page.setContent(`<style>body{margin:0}svg{display:block;width:512px;height:512px}</style>${iconSvg}`);
await page.screenshot({ path: out("store/graphics/icon-512.png") });

// ---- 4. feature graphic, 1024 x 500
await page.setViewportSize({ width: 1024, height: 500 });
await page.setContent(`<!doctype html><style>${fontsCss}
  body{margin:0;width:1024px;height:500px;background:#12203A;color:#F4F6FA;font-family:Barlow;overflow:hidden;position:relative}
  svg{position:absolute;left:70px;top:110px;width:280px;height:280px}
  .t{position:absolute;left:400px;top:120px;width:560px}
  h1{font-family:"Saira Condensed";font-weight:800;font-size:120px;line-height:.95;margin:0;letter-spacing:1px}
  h1 span{color:#F07A35}
  p{font-size:36px;line-height:1.25;margin:22px 0 0;color:#C5CEDF}
</style>${iconSvg.replace('<rect id="bg"', '<rect id="bg" opacity="0"')}
<div class="t"><h1>HOOPS <span>LADDER</span></h1><p>Basketball training that levels up with you.</p></div>`, { waitUntil: "networkidle" });
await fontsReady();
await page.screenshot({ path: out("store/graphics/feature-graphic.png") });

// ---- 5. Android launcher icons
// Legacy (Android 7 and older): the whole icon in a rounded square or a circle.
// Adaptive (Android 8+): a transparent foreground over the navy background color. Launchers mask it to
// their own shape and only the middle 66 of 108 dp is always visible, so the mark is scaled into that circle.
const mark = iconSvg.match(/<g id="mark">[\s\S]*<\/g>\s*<\/svg>/)[0].replace(/<\/svg>$/, "");
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
async function png(size, svg, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: file, omitBackground: true });
}
for (const [d, k] of Object.entries(dens)) {
  const dir = out("android/app/src/main/res", `mipmap-${d}`);
  await png(48 * k, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#12203A"/><g transform="translate(256 256) scale(.86) translate(-256 -256)">${mark}</g></svg>`, path.join(dir, "ic_launcher.png"));
  await png(48 * k, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle cx="256" cy="256" r="256" fill="#12203A"/><g transform="translate(256 256) scale(.86) translate(-256 -256)">${mark}</g></svg>`, path.join(dir, "ic_launcher_round.png"));
  // ring outer radius is 211 of 512; the safe circle is 33/108 of the width, so scale = (33/108*512)/211 ≈ 0.74
  await png(108 * k, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><g transform="translate(256 256) scale(.74) translate(-256 -256)">${mark}</g></svg>`, path.join(dir, "ic_launcher_foreground.png"));
}

await browser.close();
server.close();
console.log("Store art written to store/ and launcher icons to android/app/src/main/res/mipmap-*");
