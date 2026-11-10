/* App-only additions to the Hoops Ladder page. In a normal browser it does nothing.

   Why a separate file: www/index.html is generated from the prototype, so edits there get overwritten on every
   import. tools/import_prototype.mjs pastes this file in at the end of the page's main (()=>{ ... })(); block,
   where it can see the page's own names (S, R, persist, openBig, ...) and wrap a few functions without editing
   the prototype. See docs/LEARNING.md, step 11. */
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

  /* ---------- 2. Demo clips play inside the app ----------
     The web version can only link each drill part to the right moment of its YouTube source. In the app, a tap on
     any YouTube link opens a player sheet instead: the demo clip plays from its start, loops back at its end, and
     can slow down to half speed. It uses YouTube's own embedded player (privacy-enhanced youtube-nocookie.com
     host), so the video still streams from YouTube and needs a connection. Mirroring isn't offered: YouTube's
     terms don't allow changing how its player shows a video, so that waits for our own recordings.
     See docs/LEARNING.md, step 14. */
  {
    const YT_HOST = "https://www.youtube-nocookie.com";
    // Demo chips only carry the start time (&t=), so add each clip's end time as data-end.
    const origClipLinks = clipLinks;
    clipLinks = function (d, pi, cc) {
      const html = origClipLinks.apply(this, arguments);
      const c = cc || (CLIPS[d.id] || [])[pi];
      if (!html || !c) return html;
      let k = 0;
      return html.replace(/data-clip>/g, m => (c[k] ? `data-clip data-end="${+c[k++][2] || 0}">` : m));
    };

    // Reads a YouTube link: video id and start second, or null for anything else.
    function ytParse(href) {
      let u; try { u = new URL(href); } catch (e) { return null; }
      const h = u.hostname.replace(/^(www|m|music)\./, "");
      let id = "";
      if (h === "youtu.be") id = u.pathname.slice(1).split("/")[0];
      else if (/(^|\.)youtube(-nocookie)?\.com$/.test(h)) {
        const p = u.pathname.split("/").filter(Boolean);
        id = p[0] === "watch" ? u.searchParams.get("v") || "" : /^(shorts|embed|live|v)$/.test(p[0]) ? p[1] || "" : "";
      }
      if (!/^[\w-]{11}$/.test(id)) return null;
      const t = String(u.searchParams.get("t") || u.searchParams.get("start") || "");
      const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
      const start = m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
      return { id, start, url: href };
    }

    let api = null; // Promise of window.YT, loaded the first time a clip opens
    function loadApi() {
      if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
      if (api) return api;
      api = new Promise((ok, fail) => {
        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => { if (prev) try { prev(); } catch (e) {} ok(window.YT); };
        const s = document.createElement("script");
        s.src = "https://www.youtube.com/iframe_api";
        s.onerror = () => { api = null; s.remove(); fail(new Error("offline")); };
        document.head.appendChild(s);
        setTimeout(() => { if (!(window.YT && window.YT.Player)) { api = null; fail(new Error("timeout")); } }, 12000);
      });
      return api;
    }

    const st = document.createElement("style");
    st.textContent = `
.ytsheet{position:fixed;inset:0;z-index:80;background:#05080F;color:#F2F5FA;display:flex;flex-direction:column;
  padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)}
.ytsheet .yt-top{display:flex;align-items:center;gap:10px;padding:10px 16px}
.ytsheet .yt-title{flex:1;min-width:0;font-family:var(--display);font-weight:700;font-size:18px;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ytsheet .yt-stage{flex:1;display:flex;align-items:center;justify-content:center;min-height:0}
.ytsheet .yt-box{position:relative;width:100%;max-height:100%;aspect-ratio:16/9;background:#000}
.ytsheet .yt-box iframe,.ytsheet .yt-box>div{position:absolute;inset:0;width:100%;height:100%;border:0}
.ytsheet .yt-msg{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;text-align:center;font-size:15px;color:#C9D2E3}
.ytsheet .yt-ctl{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:center;padding:14px 16px 18px}
.ytsheet .seg{background:#1C2844;border-color:#2A3858}.ytsheet .seg button{color:#9AA6BF}
.ytsheet .seg button[aria-pressed="true"]{background:#F2F5FA;color:#05080F}
.ytsheet .btn.sec{background:#1C2844;border-color:#2A3858;color:#F2F5FA}
.ytsheet a.btn{text-decoration:none;display:inline-flex;align-items:center}
.ytsheet .yt-note{width:100%;text-align:center;font-size:13px;color:#9AA6BF}`;
    document.head.appendChild(st);

    let V = null; // the open clip: {el, player, id, a, b, label, url, loop, rate, timer}
    const fmtS = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
    function ctl() {
      if (!V) return "";
      const rates = [[0.5, "½×"], [0.75, "¾×"], [1, "1×"]];
      return `${V.b ? `<div class="seg" role="group" aria-label="Loop"><button data-yt="loop" aria-pressed="${V.loop}">Loop</button></div>` : ""}
        <div class="seg" role="group" aria-label="Speed">${rates.map(([r, l]) => `<button data-yt="rate:${r}" aria-pressed="${V.rate === r}">${l}</button>`).join("")}</div>
        <button class="btn sec small" data-yt="again">From the top</button>
        <a class="btn sec small" href="${esc(V.url)}" target="_blank" rel="noopener" data-ext>YouTube app</a>
        <div class="yt-note">${V.b ? `Clip ${fmtS(V.a)} to ${fmtS(V.b)}${V.loop ? ", looping" : ""}` : `From ${fmtS(V.a)}`}</div>`;
    }
    function drawCtl() { const c = V && V.el.querySelector(".yt-ctl"); if (c) c.innerHTML = ctl(); }
    function msg(text) {
      const box = V && V.el.querySelector(".yt-box");
      if (box) box.innerHTML = `<div class="yt-msg"><div>${esc(text)}</div><a class="btn sec small" href="${esc(V.url)}" target="_blank" rel="noopener" data-ext>Open in YouTube</a></div>`;
    }
    function closeClip() {
      if (!V) return;
      clearInterval(V.timer);
      try { V.player && V.player.destroy(); } catch (e) {}
      V.el.remove(); V = null;
    }
    function openClip(c, end, label) {
      closeClip();
      const el = document.createElement("div");
      el.className = "ytsheet";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-label", "Demo clip");
      V = { el, player: null, id: c.id, a: c.start, b: end > c.start ? end : 0, label, url: c.url, loop: end > c.start, rate: 1, timer: 0 };
      el.innerHTML = `<div class="yt-top"><div class="yt-title">${esc(label || "Demo")}</div><button class="btn sec small" data-yt="close">Close</button></div>
        <div class="yt-stage"><div class="yt-box"><div class="yt-msg">Loading the clip…</div></div></div><div class="yt-ctl">${ctl()}</div>`;
      el.addEventListener("click", e => {
        const b = e.target.closest("[data-yt]");
        if (!b || !V) return;
        const k = b.dataset.yt, p = V.player;
        if (k === "close") return closeClip();
        if (k === "loop") V.loop = !V.loop;
        else if (k.startsWith("rate:")) { V.rate = +k.slice(5); try { p && p.setPlaybackRate(V.rate); } catch (x) {} }
        else if (k === "again") { try { p && (p.seekTo(V.a, true), p.playVideo()); } catch (x) {} }
        drawCtl();
      });
      document.body.appendChild(el);
      const mine = V;
      loadApi().then(YT => {
        if (V !== mine) return;
        const host = document.createElement("div");
        const box = el.querySelector(".yt-box");
        box.innerHTML = ""; box.appendChild(host);
        // end is left out on purpose: the timer below loops at the clip's end, and with Loop off the video plays on.
        mine.player = new YT.Player(host, {
          host: YT_HOST, videoId: mine.id, width: "100%", height: "100%",
          playerVars: { start: mine.a, autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, origin: location.origin },
          events: {
            onReady: e => { try { e.target.setPlaybackRate(mine.rate); e.target.playVideo(); } catch (x) {} },
            onStateChange: e => { if (e.data === YT.PlayerState.ENDED && mine.loop && mine.b) { e.target.seekTo(mine.a, true); e.target.playVideo(); } },
            onError: e => { if (V === mine) msg(e && (e.data === 101 || e.data === 150) ? "The video's owner doesn't allow it to play inside other apps." : "This clip won't play here right now."); }
          }
        });
        mine.timer = setInterval(() => {
          const p = mine.player;
          if (!mine.loop || !mine.b || !p || !p.getCurrentTime) return;
          try { if (p.getCurrentTime() >= mine.b) { p.seekTo(mine.a, true); p.playVideo(); } } catch (x) {}
        }, 200);
      }).catch(() => { if (V === mine) msg("Demo clips stream from YouTube, so they need a connection. The animations work offline."); });
    }

    // Capture phase, so the drill player's own handler still runs afterwards and pauses the timer.
    document.addEventListener("click", e => {
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a || a.hasAttribute("data-ext")) return;
      const c = ytParse(a.href);
      if (!c) return;
      e.preventDefault();
      // Title: the chip's own label ("Forward", "Back"...), with the drill's name in front.
      let label = (a.textContent || "").replace(/^\s*▶\s*/, "").replace(/\s*·\s*\d+s\s*$/, "").trim();
      if (label === "Demo" || label.startsWith("YouTube")) label = "";
      let drill = "";
      try {
        if (pEl && pEl.contains(a) && P && P.items) drill = (P.items[P.stage === "rest" ? P.i + 1 : P.i] || {}).name || "";
        else if (a.closest(".sheet")) drill = (document.getElementById("sheetTitle") || {}).textContent || "";
      } catch (x) {}
      openClip(c, +a.dataset.end || 0, [drill, label].filter(Boolean).join(" · ") || "Demo");
    }, true);
  }

  /* ---------- 3. Voice: commands during drills and in the rep logger ----------
     Android's WebView has no speech recognition, so the web version's Voice button stays hidden in the app. The
     native HoopsVoice plugin (android/.../voice/) listens on the phone instead, on-device when it can, and only
     acts on a short list of words.
     - Rep logger: the page's own Voice button and word list (voiceCmd: "miss", "done", "eight", "undo", "short"...).
     - Drill player: a Voice button on the timer screen: "pause", "go", "lost it", "faster", "slower", "skip".
     Words the app says itself (tips, "Paused", "Go") are ignored while it's talking. See docs/LEARNING.md, step 15. */
  const Voice = Plug.HoopsVoice;
  if (Voice) {
    const WORDS = ["pause", "go", "resume", "lost it", "faster", "slower", "skip", "miss", "done", "undo", "make", "short", "long", "left", "right"];
    let who = null;        // "log" or "play": which screen is listening
    let fired = false;     // a command already ran for the phrase being spoken
    const LOG_VOICE = { abort() {} }; // stands in for the web recognizer in the page's `voice` variable
    const talking = () => performance.now() < talkUntil + 300 || (window.speechSynthesis && speechSynthesis.speaking);

    function vStart(w) {
      who = w; fired = false;
      return Voice.start({ words: WORDS }).catch(e => {
        who = null;
        const denied = e && /denied|not allowed/i.test(String(e.code || e.message || e));
        toast(denied ? "Mic not allowed" : "Voice isn't available", denied
          ? "Allow the microphone for Hoops Ladder in your phone's settings to use voice."
          : "This phone has no speech recognizer. Use the buttons, earbuds or tap.");
        throw e;
      });
    }
    function vStop() { if (!who) return; who = null; Voice.stop().catch(() => {}); }

    // Drill player words. Only what makes sense right now does anything.
    function playCmd(text) {
      if (!P || P.stage === "rate") return false;
      const t = " " + text.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ") + " ";
      const d = P.items[P.i], cur = P.stage === "work" && phasesOf(d)[P.pi];
      if (/ (lost it|lost|dropped it|dropped) /.test(t)) {
        if (P.stage === "work" && P.running && !P.cd && !d.body && !isRestPart()) { lostIt(); return true }
        return false;
      }
      if (/ (pause|stop|wait|hold on|hold up|time out|timeout) /.test(t)) { if (P.running) { togglePlay(); return true } return false }
      if (/ (go|resume|start|play|ready|got it) /.test(t)) { if (!P.running) { togglePlay(); return true } return false }
      if (/ (faster|speed up|slower|slow down) /.test(t)) {
        if (!(cur && cur[3])) return false;
        const m = Math.max(BEAT_MIN, Math.min(BEAT_MAX, (S.settings.beat || 1) + (/ (faster|speed up) /.test(t) ? .1 : -.1)));
        setBeat(m, true); drawPlayer(); return true;
      }
      if (/ skip /.test(t)) { advance(); return true }
      return false;
    }
    function logCmd(text, alts) {
      if (!R || !bigEl) return false;
      for (const x of [text].concat(alts || [])) {
        let k = voiceCmd(x);
        if (!k) continue;
        if (k === "a_miss") k = R.mode === "sets" ? "a" : "miss";
        if (k === "make" && R.mode === "sets") return false;
        if (k === "b" && R.mode !== "sets") return false;
        sig(k); return true;
      }
      return false;
    }

    Voice.addListener("heard", e => {
      if (!e || !who) return;
      if (talking()) { if (e.final) fired = false; return }
      if (who === "play") {
        // Act on the first words for speed ("lost it" mid-dribble), once per phrase.
        if (!fired && playCmd(e.text)) fired = true;
      } else if (e.final) logCmd(e.text, e.alts); // counts matter here, so wait for the whole phrase
      if (e.final) fired = false;
    });
    Voice.addListener("state", e => {
      if (e && e.error === "denied") { who = null; voice = null; if (bigEl) drawBig(); if (P) drawPlayer(); toast("Mic not allowed", "Allow the microphone for Hoops Ladder in your phone's settings to use voice.") }
    });

    // Rep logger: the page shows its Voice button when micOK is true and calls startVoice / stopVoice.
    micOK = true;
    startVoice = function () {
      vStop();
      voice = LOG_VOICE;
      vStart("log").then(() => say(R && R.mode === "sets" ? "Voice on. Say miss, done, or the number you made." : "Voice on. Say make or miss."))
        .catch(() => { voice = null; if (bigEl) drawBig() });
    };
    stopVoice = function () { if (!voice) return; voice = null; if (who === "log") vStop() };

    // Drill player: a Voice button beside Pause / Skip / End. It stays on for later drills until turned off.
    const origDrawPlayer = drawPlayer, origClosePlayer = closePlayer, origStartPlayer = startPlayer;
    drawPlayer = function () {
      origDrawPlayer.apply(this, arguments);
      if (!pEl || !P || P.stage === "rate") return;
      const top = pEl.querySelector(".bt-top");
      if (!top) return;
      const on = who === "play";
      const b = document.createElement("button");
      b.className = "btn sec small" + (on ? " mic" : "");
      b.setAttribute("aria-pressed", on);
      b.textContent = on ? "Voice on" : "Voice";
      b.onclick = e => {
        e.stopPropagation();
        if (who === "play") { vStop(); S.settings.pvoice = false; persist(); drawPlayer() }
        else vStart("play").then(() => { S.settings.pvoice = true; persist(); drawPlayer(); say("Voice on.") }).catch(() => drawPlayer());
      };
      top.insertBefore(b, top.lastElementChild);
      const h = pEl.querySelector(".bt-hint");
      if (on && h) h.insertAdjacentHTML("beforeend", `<br>Say “pause”, “go”, “lost it”, “faster”, “slower” or “skip”.`);
    };
    startPlayer = function () {
      origStartPlayer.apply(this, arguments);
      if (P && S.settings.pvoice && who !== "play") vStart("play").then(() => drawPlayer()).catch(() => { S.settings.pvoice = false; persist() });
    };
    closePlayer = function () { if (who === "play") vStop(); origClosePlayer.apply(this, arguments) };
  }

  /* ---------- 4. Hands-free logging: volume buttons, earbuds and lock-screen buttons ----------
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
