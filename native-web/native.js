/* App-only additions to the Hoops Ladder page. In a normal browser it does nothing.

   Why a separate file: www/index.html is generated from the prototype, so edits there get overwritten on every
   import. tools/import_prototype.mjs pastes this file in at the end of the page's main (()=>{ ... })(); block,
   where it can see the page's own names (S, R, persist, openBig, ...) and wrap a few functions without editing
   the prototype. See docs/LEARNING.md, step 8. */
(() => {
  const Cap = window.Capacitor;
  if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return;
  const Plug = Cap.Plugins || {};

  /* ---------- 1. Progress storage that Android won't clear (@capacitor/preferences) ----------
     Capacitor recommends Preferences over localStorage because the system can clear a WebView's storage to free
     space (mostly an iOS problem, but it keeps the iPhone version easy later). Preferences are a normal app file.
     The page still writes localStorage too, and Preferences wins when the app starts. */
  const Prefs = Plug.Preferences;
  if (Prefs) {
    let loaded = false, dirty = false;
    const save = () => Prefs.set({ key: LS, value: JSON.stringify(S) }).catch(() => {});
    const origPersist = persist;
    persist = function () {
      origPersist.apply(this, arguments);
      if (loaded) save(); else dirty = true;
    };
    Prefs.get({ key: LS }).then(r => {
      loaded = true;
      // Something was saved before the stored copy arrived: keep the newer in-memory progress.
      if (dirty || !r || !r.value) { if (dirty || S.sessions.length || S.xp.s || S.xp.h || S.xp.f) save(); return; }
      try {
        S = normalize(JSON.parse(r.value));
        try { localStorage.setItem(LS, r.value); } catch (e) {}
        if (!R) render(); else renderPlate();
      } catch (e) {}
    }).catch(() => { loaded = true; });
  }

  /* ---------- 2. Hands-free logging: volume buttons, earbuds and lock-screen buttons ----------
     The native HoopsRemote plugin (android/.../remote/) decodes presses into the page's own signals:
     "a" (one press), "b" (two presses or a hold), "u" (three presses). sig() already knows what each means. */
  const Remote = Plug.HoopsRemote;
  if (!Remote) return;
  const NATIVE_EAR = { pause() {} }; // stands in for the web version's silent audio loop, so the hints mention the buttons
  let on = false, opening = false;

  const mode = () => (R && R.mode === "sets" ? "sets" : "shots");
  function info() {
    if (!R) return { mode: mode(), title: "Hoops Ladder", text: "" };
    const d = R.d;
    if (R.mode === "sets") {
      const s = setSpec();
      return s
        ? { mode: "sets", title: s.label || d.name, text: `Set ${(R.setNo || 0) + 1} · ${R.sm || 0} missed · Total ${R.m}/${R.a}` }
        : { mode: "sets", title: d.name, text: `Finished · ${R.m}/${R.a}` };
    }
    const p = pct(R.m, R.a);
    return { mode: "shots", title: bigLabel() || d.name, text: `${R.m}/${R.a}${p == null ? "" : ` · ${p}%`}` };
  }

  Remote.addListener("signal", e => { if (e && e.k) sig(e.k); });

  const origOpen = openBig, origClose = closeBig, origDraw = drawBig, origTop = bigTop;
  openBig = function () {
    opening = true;
    try { origOpen.apply(this, arguments); } finally { opening = false; }
    if (!bigEl) return;
    media = NATIVE_EAR;
    if (!on) { on = true; Remote.start(info()).catch(() => {}); }
    drawBig();
  };
  closeBig = function () {
    origClose.apply(this, arguments);
    if (on && !opening) { on = false; Remote.stop().catch(() => {}); }
  };
  // The buttons are always on in the app, so the web version's "Earbuds" toggle goes.
  bigTop = function () {
    return origTop.apply(this, arguments).replace(/<button[^>]*data-b="ear"[^>]*>Earbuds<\/button>/, "");
  };
  drawBig = function () {
    origDraw.apply(this, arguments);
    if (!bigEl || !R) return;
    const h = bigEl.querySelector(".bt-hint");
    if (h) h.innerHTML = h.innerHTML
      .replace(", click your earbuds", ", press a volume button or click your earbuds")
      .replace(", double-click", ", double-press")
      .replace("Triple-click: undo.", "Triple-press: undo. The buttons work with the screen locked too.")
      .replace("Earbuds: click = make, double-click = miss, triple-click = undo",
               "Volume buttons or earbuds: press = make, double-press = miss, triple-press = undo, even with the screen locked");
    if (on) Remote.update(info()).catch(() => {});
  };
})();
