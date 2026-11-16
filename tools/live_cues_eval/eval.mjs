// usage: node eval.mjs <pose.json> [ball.json] [calls.json]
// Feeds a clip's pose (from pose_clip.py) and ball finds (ball_clip.py) through the app's own live-cue code
// (the lccore block of native-web/native.js) as one Eyes-Up Signals round, and prints the round's totals, the card's
// percentages and every glance down (start and end time) so they can be checked by eye against the video.
// calls.json (optional): the Move Check Recorder's call file; any array of {t, name} (or {time, call}) is used for
// the current call's name, so behind calls skip the checks they skip in the app.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const src = fs.readFileSync(fileURLToPath(new URL("../../native-web/native.js", import.meta.url)), "utf8");
const core = src.slice(src.indexOf("// BEGIN lccore"), src.indexOf("// END lccore"));
const { LC, lcNew, lcStep, lcPart, lcCheck, lcBall, lcMed, lcFrame } = new Function(core + "; return { LC, lcNew, lcStep, lcPart, lcCheck, lcBall, lcMed, lcFrame };")();
const [poseF, ballF, callF] = process.argv.slice(2);
const pose = JSON.parse(fs.readFileSync(poseF, "utf8"));
const balls = ballF && fs.existsSync(ballF) ? JSON.parse(fs.readFileSync(ballF, "utf8")) : [];
let calls = [];
if (callF && fs.existsSync(callF)) {
  const j = JSON.parse(fs.readFileSync(callF, "utf8"));
  const arr = Array.isArray(j) ? j : j.calls || j.events || Object.values(j).find(Array.isArray) || [];
  // Move Check Recorder files: {calls: [{t, text, meaning}]}; Signals rounds have the symbol in text, the words in meaning
  calls = arr.map(c => ({ t: +(c.t ?? c.time ?? c.at ?? c.s ?? 0), name: String(c.name ?? c.call ?? c.label ?? [c.text, c.meaning].filter(Boolean).join(" ")) })).filter(c => c.name).sort((a, b) => a.t - b.t);
}
const C = lcNew();
// the app calibrates eyes up in the setup check, looking at the phone; here: the first 2 s of the clip
const cal = [];
const glances = [], ts = [], lost = [];
let bi = 0, wasDown = null;
for (const fr of pose.fr) {
  if (!fr.lm) continue;
  const lm = fr.lm.map(([x, y, v]) => ({ x, y, visibility: v }));
  const call = calls.filter(c => c.t <= fr.t).pop();
  const part = lcPart("h_r_signal", call ? call.name : "", 0);
  if (fr.t < 2) { const Cc = lcNew(); lcStep(Cc, lm, fr.t, pose.ar, null); if (Cc.fr[0] && Cc.fr[0].hd != null) cal.push(Cc.fr[0].hd); continue; }
  if (C.base == null && cal.length >= 12) C.base = lcMed(cal);
  if (C.partT0 == null) C.partT0 = fr.t;
  const before = C.stats.pr[0] ? C.stats.pr[0].gl : 0;
  lcStep(C, lm, fr.t, pose.ar, part);
  while (bi < balls.length && balls[bi].t <= fr.t) { lcBall(C, balls[bi], pose.ar); bi++; }
  lcCheck(C, fr.t, part);
  const ff = lcFrame(lm, pose.ar); if (ff && ff.ts != null) ts.push(ff.ts);
  if (C.lost && (!lost.length || lost[lost.length - 1] !== C.lostAt)) { C.lostAt = C.lostAt || fr.t; if (lost[lost.length - 1] !== C.lostAt) lost.push(C.lostAt); }
  if (!C.lost) C.lostAt = null;
  const R = C.stats.pr[0];
  if (R && R.gl > before) glances.push({ t0: C.dn.t0, counted: fr.t });
  if (C.dn && glances.length && glances[glances.length - 1].t0 === C.dn.t0) glances[glances.length - 1].t1 = C.dn.t1;
}
const R = C.stats.pr[0] || {};
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length * p)].toFixed(2); };
const pc = (a, b) => (b ? Math.round(100 * a / b) : null);
console.log(JSON.stringify({
  clip: poseF, base: C.base, calibrated: cal.length >= 12,
  eyesUp: pc(R.up, R.nu), glances: R.gl, sittingLow: pc(R.low, R.nl), wide: pc(R.wide, R.nw), feetMoved: R.feet,
  offArmUp: pc(R.arm, R.na), belowWaist: R.nh ? 100 - pc(R.hi, R.nh) : null,
  bounceNearHand: pc(R.near, R.nb), bounceNearBall: pc(R.nearb, R.nbb), crossesOutsideKnees: pc(R.wx, R.nx), crosses: R.nx,
  dribbles: R.drib, perMin: R.sec ? Math.round(R.drib * 60 / R.sec) : null, lostBalls: R.nball >= 20 ? R.lost : null, ballFindsUsed: R.nball,
  thighOverShin: ts.length ? { p25: q(ts, .25), median: q(ts, .5), p75: q(ts, .75) } : null, lostTimes: lost,
  glanceTimes: glances.map(g => [g.t0, g.t1])
}));
