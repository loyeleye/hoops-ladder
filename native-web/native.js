/* App-only additions to the Hoops Ladder page. In a normal browser it does nothing.

   Why a separate file: www/index.html is generated from the prototype, so edits there get overwritten on every
   import. tools/import_prototype.mjs pastes this file in at the end of the page's main (()=>{ ... })(); block,
   where it can see the page's own names (S, R, persist, openBig, ...) and wrap a few functions without editing
   the prototype. See docs/LEARNING.md, step 11. */
(() => {
  const Cap = window.Capacitor;
  if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return;
  const Plug = Cap.Plugins || {};
  const hooks = {}; // small links between the sections below (e.g. pausing voice while the mic measures the dribble)

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

  /* ---------- Back button: close what's open, then go back a tab, and only then leave the app ----------
     Android's back button (or back swipe) used to close the app from any screen, because the page is one web page
     and Capacitor doesn't handle back on its own. MainActivity now asks hoopsBack() first on every back press, and
     only lets Android leave the app when it returns false. Topmost first, each press does what that screen's own
     close button does:
     demo clip → training video / recorder → "Show the move" → drill timer (End, which goes to the rating screen) →
     rep logger (Exit) → "Discard this drill?" (Keep going) → drill sheet (close, which asks first if anything's
     logged) → the tab you were on before → leave the app from Today. */
  {
    const tabs = []; // tabs visited before the current one, oldest first
    let cur = state.tab, popping = false;
    // Runs after the page's own hashchange handler (route), so state.tab is already the new tab.
    window.addEventListener("hashchange", () => {
      if (state.tab !== cur) {
        if (!popping) { tabs.push(cur); if (tabs.length > 30) tabs.shift(); }
        cur = state.tab;
      }
      popping = false;
    });
    const press = (root, sel) => { const b = root && root.querySelector(sel); if (b) b.click(); return !!b; };
    window.hoopsBack = function () {
      const clip = document.querySelector(".ytsheet");
      if (clip) { if (!press(clip, '[data-yt="close"]')) clip.remove(); return true; }
      if (CO.view) { closeVid(); return true; }
      if (CO.rec) { closeRec(); return true; }
      if (seeEl) { if (!press(seeEl, '[data-s="resume"]')) closeSee(); return true; }
      if (pEl && P) {
        // The rating screen has its own Save and Discard, so back stays put rather than throwing the workout away.
        if (P.stage !== "rate" && !press(pEl, '[data-p="end"]')) closePlayer();
        return true;
      }
      if (bigEl) { if (!press(bigEl, '[data-b="exit"]')) { closeBig(); lockOff(); drawDock(); } return true; }
      if (R) {
        if (R.confirm) { R.confirm = false; drawDock(); } else closeRunner();
        return true;
      }
      const prev = tabs.length ? tabs.pop() : state.tab !== "today" ? "today" : null;
      if (prev && prev !== state.tab) { popping = true; location.hash = "#" + prev; return true; }
      return false;
    };
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
    // Lets another feature borrow the mic for a moment. Returns a function that turns voice back on.
    hooks.voicePause = () => {
      const was = who;
      if (!was) return () => {};
      vStop();
      return () => { if (!who && (was === "log" ? bigEl && voice : P)) vStart(was).then(() => { if (P) drawPlayer(); }).catch(() => {}); };
    };

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

  /* ---------- 4. Live form check from the camera ----------
     The web version only analyzes clips filmed with the camera app. In the app, "Live form check" on the Form tab
     opens the camera and runs the same pose model on every frame. Each time it sees a shot (shooting wrist goes
     above the head, then the follow-through ends) it runs the page's own compute() on the last few seconds, so the
     numbers match a clip check: Line Test drift, dip, ball-leads timing, set point, extension, follow-through hold,
     tempo and a stop on the way up. It says one short cue for the biggest problem on that shot, and closing saves
     the session's typical numbers to your form history. See docs/LEARNING.md, step 16. */
  {
    const FPS = 10;                 // compute() expects evenly spaced frames; live frames are resampled to this
    const CUES = {
      drift: m => (m.val.startsWith("-") ? "Stay on the line. You fell back." : "Stay on the line. You drifted forward."),
      seq: () => "Ball first, then legs.",
      tilt: m => (m.val.startsWith("-") ? "Keep it in front of your head." : "Elbow under the ball."),
      ext: () => "Reach for the rim.",
      hold: () => "Hold the follow-through.",
      tempo: m => (/stops/.test(m.text) ? "One speed up. No stop." : "Shorter, quicker motion."),
      knee: m => (/shallow/.test(m.text) ? "Use your legs." : "Not so deep.")
    };
    const ORDER = ["drift", "seq", "tilt", "tempo", "ext", "hold", "knee"];
    let L = null; // the open live session

    const st = document.createElement("style");
    st.textContent = `
.livefc{position:fixed;inset:0;z-index:80;background:#05080F;color:#F2F5FA;display:flex;flex-direction:column;
  padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)}
.livefc .lf-top{display:flex;align-items:center;gap:8px;padding:10px 16px}
.livefc .lf-title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--display);font-weight:700;font-size:18px;text-transform:uppercase;letter-spacing:.03em}
.livefc .lf-stage{position:relative;flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden}
.livefc video,.livefc canvas{position:absolute;max-width:100%;max-height:100%}
.livefc .lf-msg{position:absolute;left:16px;right:16px;top:12px;text-align:center;font-size:15px;font-weight:600;background:rgba(5,8,15,.72);border-radius:12px;padding:8px 12px}
.livefc .lf-msg:empty{display:none}
.livefc .lf-cue{position:absolute;left:16px;right:16px;bottom:12px;text-align:center;font-family:var(--display);font-weight:800;font-size:26px;text-transform:uppercase;text-shadow:0 2px 8px #000}
.livefc .lf-shot{padding:10px 16px 16px;display:flex;flex-wrap:wrap;gap:6px;justify-content:center;min-height:64px}
.livefc .lf-shot span{font-size:12.5px;border-radius:999px;padding:4px 10px;background:#1C2844}
.livefc .lf-shot span.fix{background:#C13C2A}.livefc .lf-shot span.watch{background:#6b4a05}.livefc .lf-shot span.good{background:#1E8657}
.livefc .btn.sec{background:#1C2844;border-color:#2A3858;color:#F2F5FA}
.livefc .btn.sec[aria-pressed="true"]{background:#F2F5FA;color:#05080F}`;
    document.head.appendChild(st);

    let liveP = null; // pose landmarker in VIDEO mode, made once
    function loadLivePose() {
      if (!liveP) {
        liveP = (async () => {
          const base = document.baseURI;
          const v = await import(new URL("vision_bundle.mjs", base).href);
          const fs = await v.FilesetResolver.forVisionTasks(new URL("wasm", base).href);
          const buf = new Uint8Array(await (await fetch(new URL("pose_landmarker_lite.task", base).href)).arrayBuffer());
          return v.PoseLandmarker.createFromOptions(fs, { baseOptions: { modelAssetBuffer: buf, delegate: "CPU" }, runningMode: "VIDEO", numPoses: 1 });
        })();
        liveP.catch(() => { liveP = null; });
      }
      return liveP;
    }

    // Form tab: add the live button under "Record or choose a clip".
    const origViewForm = viewForm;
    viewForm = function () {
      return origViewForm.apply(this, arguments).replace('<input type="file" id="fcFile"',
        '<button class="btn sec" data-livefc style="width:100%;margin-top:8px">Live form check (camera)</button><input type="file" id="fcFile"');
    };
    document.addEventListener("click", e => { if (e.target.closest && e.target.closest("[data-livefc]")) { e.preventDefault(); openLive(); } });

    function msg(t) { const el = L && L.el.querySelector(".lf-msg"); if (el && el.textContent !== t) el.textContent = t; }
    function drawTop() {
      if (!L) return;
      L.el.querySelector(".lf-n").textContent = L.shots.length ? `· ${L.shots.length}` : "";
      const b = L.el.querySelector("[data-lf=talk]"); b.setAttribute("aria-pressed", L.talk);
    }
    function showShot(res) {
      const box = L.el.querySelector(".lf-shot");
      box.innerHTML = res.M.map(m => `<span class="${m.st}">${esc(m.label.replace(/ \(.*\)/, ""))} · ${esc(m.val)}</span>`).join("");
    }

    async function openLive() {
      if (L) return;
      const el = document.createElement("div");
      el.className = "livefc";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-label", "Live form check");
      el.innerHTML = `<div class="lf-top"><div class="lf-title">Live <span class="lf-n" style="opacity:.7"></span></div>
        <button class="btn sec small" data-lf="talk" aria-pressed="true">Cues</button><button class="btn sec small" data-lf="flip">Flip</button><button class="btn sec small" data-lf="close">Done</button></div>
        <div class="lf-stage"><video playsinline muted autoplay></video><canvas></canvas><div class="lf-msg" role="status">Starting the camera…</div><div class="lf-cue" aria-live="polite"></div></div>
        <div class="lf-shot"><span>Film from the side, shooting arm toward the phone, whole body in frame. Shoot when you're ready.</span></div>`;
      document.body.appendChild(el);
      L = { el, video: el.querySelector("video"), cv: el.querySelector("canvas"), stream: null, face: "environment", talk: true,
            buf: [], shots: [], up: 0, cool: 0, armed: true, lastT: 0, noBody: 0, raf: 0, pl: null, busy: false };
      L.video.setAttribute("playsinline", "");
      el.addEventListener("click", e => {
        const b = e.target.closest("[data-lf]");
        if (!b || !L) return;
        if (b.dataset.lf === "close") closeLive();
        else if (b.dataset.lf === "talk") { L.talk = !L.talk; drawTop(); }
        else if (b.dataset.lf === "flip") { L.face = L.face === "environment" ? "user" : "environment"; startCam(); }
      });
      lockOn();
      drawTop();
      try { L.pl = await loadLivePose(); } catch (e) { msg("The pose model couldn't load on this phone."); return; }
      if (!L) return;
      startCam();
    }

    async function startCam() {
      if (!L) return;
      if (L.stream) L.stream.getTracks().forEach(t => t.stop());
      cancelAnimationFrame(L.raf);
      msg("Starting the camera…");
      try {
        L.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: L.face, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
      } catch (e) {
        msg("Couldn't open the camera. Allow the camera for Hoops Ladder in your phone's settings, then try again.");
        return;
      }
      if (!L) { return; }
      L.video.srcObject = L.stream;
      L.video.style.transform = L.cv.style.transform = L.face === "user" ? "scaleX(-1)" : "";
      try { await L.video.play(); } catch (e) {}
      L.buf = []; L.up = 0;
      msg("");
      L.raf = requestAnimationFrame(loop);
    }

    function size() {
      const v = L.video, sc = 480 / Math.max(v.videoWidth || 1, v.videoHeight || 1);
      return [Math.round(v.videoWidth * sc), Math.round(v.videoHeight * sc)];
    }

    function loop() {
      if (!L) return;
      L.raf = requestAnimationFrame(loop);
      const v = L.video, now = performance.now();
      if (!v.videoWidth || v.readyState < 2 || now - L.lastT < 1000 / 15) return;
      L.lastT = now;
      // Same 480 px working size as the clip check, so compute()'s thresholds mean the same thing.
      const [cw, ch] = size();
      let r = null;
      try { r = L.pl.detectForVideo(v, now); } catch (e) { return; }
      const raw = r && r.landmarks && r.landmarks[0];
      const lm = raw ? raw.map(p => ({ x: p.x * cw, y: p.y * ch, v: p.visibility ?? 1 })) : null;
      const t = now / 1000;
      L.buf.push({ t, lm });
      while (L.buf.length && L.buf[0].t < t - 5) L.buf.shift();
      draw(lm, cw, ch);
      track(lm, t);
    }

    function draw(lm, cw, ch) {
      const cv = L.cv, v = L.video, box = L.el.querySelector(".lf-stage");
      const k = Math.min(box.clientWidth / cw, box.clientHeight / ch);
      cv.width = cw; cv.height = ch;
      cv.style.width = v.style.width = Math.round(cw * k) + "px";
      cv.style.height = v.style.height = Math.round(ch * k) + "px";
      const c = cv.getContext("2d");
      c.clearRect(0, 0, cw, ch);
      if (!lm) return;
      const s = SIDE[S.settings.hand || "R"], hot = new Set([s.sh, s.el, s.wr]);
      c.lineCap = "round";
      for (const [a, b] of BONES) {
        const A = lm[a], B = lm[b];
        if (A.v < .3 || B.v < .3) continue;
        c.strokeStyle = hot.has(a) && hot.has(b) ? "#F07A35" : "rgba(255,255,255,.85)";
        c.lineWidth = hot.has(a) && hot.has(b) ? 5 : 3;
        c.beginPath(); c.moveTo(A.x, A.y); c.lineTo(B.x, B.y); c.stroke();
      }
    }

    // Shot finder: the shooting wrist above the nose starts a shot; it's over when the wrist drops back below the
    // shoulder (follow-through done) or 1.8 s later. Then compute() runs on the 3.5 s before, resampled to 10 fps.
    function track(lm, t) {
      const s = SIDE[S.settings.hand || "R"];
      const body = lm && lm[0].v > .3 && lm[s.wr].v > .3 && (lm[s.an].v > .3 || lm[s.an === 28 ? 27 : 28].v > .3);
      if (!body) {
        L.noBody = L.noBody || t;
        if (t - L.noBody > 1.5) msg("Step back until your whole body, feet included, is in frame. Film from the side.");
        return;
      }
      L.noBody = 0;
      msg("");
      // After a shot, wait for the ball to come back down (wrist below the shoulder) before looking for the next
      // one, so a long follow-through or a wave doesn't count twice.
      // (for 0.3 s, so one jumpy pose frame doesn't count)
      if (!L.armed) { if (lm[s.wr].y > lm[s.sh].y) { L.downAt = L.downAt || t; if (t - L.downAt > .3) L.armed = true; } else L.downAt = 0; }
      if (t < L.cool || !L.armed) return;
      const above = lm[s.wr].y < lm[0].y, down = lm[s.wr].y > lm[s.sh].y;
      if (above && !L.up) L.up = t;
      // Over when the hand comes back below the shoulder. (Below the nose isn't enough: a set point at forehead
      // height, or one jumpy frame, would cut the shot off before the release.)
      if (L.up && ((down && t - L.up > .25) || t - L.up > 1.8)) {
        const start = L.up;
        L.up = 0;
        L.armed = false;
        L.downAt = 0;
        L.cool = t + .8;
        analyzeShot(start, t);
      }
    }

    function analyzeShot(upAt, endAt) {
      const t0 = upAt - 2.5, frames = [];
      const src = L.buf.filter(f => f.t >= t0 - .1 && f.t <= endAt + .05);
      if (src.length < 8) return;
      for (let x = t0; x <= endAt; x += 1 / FPS) {
        let best = null;
        for (const f of src) if (!best || Math.abs(f.t - x) < Math.abs(best.t - x)) best = f;
        if (best && Math.abs(best.t - x) < .2) frames.push({ t: x - t0, lm: best.lm });
      }
      let res;
      try { res = compute(frames, FPS); } catch (e) { return; }
      if (!res || !res.ok) return;
      // A hand raised without a dip and a long arm (a wave, a catch, fixing a sleeve) isn't a shot.
      if (res.vals.knee > 165 || res.vals.ext < 120) return;
      L.shots.push(res);
      drawTop();
      showShot(res);
      const worst = ORDER.map(k => res.M.find(m => m.k === k && m.st === "fix")).find(Boolean);
      const cue = worst ? CUES[worst.k](worst) : "Good shot.";
      const cel = L.el.querySelector(".lf-cue");
      cel.textContent = cue;
      cel.style.color = worst ? "#FF8A75" : "#7BE0A8";
      if (L.talk) say(cue);
    }

    function closeLive() {
      if (!L) return;
      const shots = L.shots;
      cancelAnimationFrame(L.raf);
      if (L.stream) L.stream.getTracks().forEach(t => t.stop());
      L.el.remove();
      L = null;
      lockOff();
      if (!shots.length) return;
      // Save one form entry for the session: the median of each number, and each check's most common status.
      const vals = {}, M = [];
      for (const k of Object.keys(shots[0].vals)) vals[k] = med(shots.map(r => r.vals[k]));
      for (const m of shots[0].M) {
        const n = {};
        for (const r of shots) { const x = r.M.find(y => y.k === m.k); if (x) n[x.st] = (n[x.st] || 0) + 1; }
        M.push({ k: m.k, st: Object.keys(n).sort((a, b) => n[b] - n[a])[0] });
      }
      saveForm({ vals, M });
      render();
    }
  }

  /* ---------- 5. Match the beat to the player's real dribble ----------
     On a part with a beat, "Match my dribble" listens with the mic for 8 seconds while the player dribbles at their
     own pace, finds each bounce (a low thud), and offers that speed as the beat, with how steady it sounded.
     Best with the phone on the floor near the player, so their ball is the loudest. Tap tempo stays as the slider.
     See docs/LEARNING.md, step 17. */
  {
    const SECS = 8;
    let M = null; // the running measurement

    const origDraw = drawPlayer;
    drawPlayer = function () {
      origDraw.apply(this, arguments);
      if (!pEl || !P || P.stage !== "work") return;
      const cur = phasesOf(P.items[P.i])[P.pi], box = pEl.querySelector(".pbeat");
      if (!box || !cur || !cur[3]) return;
      const d = document.createElement("div");
      d.className = "pdemo pmatch";
      d.style.margin = "8px 0 0";
      if (M && M.result) {
        const r = M.result;
        d.innerHTML = r.bpm
          ? `<div class="pmeta">You: <b>${r.bpm} per min</b> · ${r.conf}</div><div class="row" style="justify-content:center;gap:6px"><button class="clip" data-pm="use">Use it</button><button class="clip" data-pm="again">Again</button><button class="clip" data-pm="cancel">Cancel</button></div>`
          : `<div class="pmeta">${esc(r.why)}</div><div class="row" style="justify-content:center;gap:6px"><button class="clip" data-pm="again">Try again</button><button class="clip" data-pm="cancel">Cancel</button></div>`;
      } else if (M) {
        d.innerHTML = `<div class="pmeta" id="pmLive">Dribble at your own speed… ${Math.ceil(M.left)} s</div>`;
      } else {
        d.innerHTML = `<button class="clip" data-pm="start">Match my dribble</button>`;
      }
      d.addEventListener("click", e => {
        e.stopPropagation(); // taps here shouldn't pause or count a lost ball
        const b = e.target.closest("[data-pm]");
        if (!b) return;
        const k = b.dataset.pm;
        if (k === "start" || k === "again") startMatch();
        else if (k === "cancel") { endMatch(); drawPlayer(); }
        else if (k === "use") {
          const base = cur[3] / (S.settings.beat || 1);
          const m = Math.max(BEAT_MIN, Math.min(BEAT_MAX, Math.round(M.result.bpm / base / .05) * .05));
          endMatch();
          setBeat(m, true);
          drawPlayer();
          if (m === BEAT_MIN || m === BEAT_MAX) toast("Beat set", `The closest the beat goes is ${beatName(m)}.`);
        }
      });
      box.after(d);
    };
    const origClose = closePlayer;
    closePlayer = function () { endMatch(); origClose.apply(this, arguments); };

    function endMatch() {
      if (!M) return;
      clearInterval(M.timer);
      cancelAnimationFrame(M.raf);
      try { M.stream && M.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
      try { M.ctx && M.ctx.close(); } catch (e) {}
      const resume = M.resume;
      M = null;
      if (resume) resume();
    }

    async function startMatch() {
      endMatch();
      if (P.running) togglePlay(); // no beat ticks while we listen
      try { speechSynthesis.cancel(); } catch (e) {}
      M = { left: SECS, onsets: [], resume: hooks.voicePause ? hooks.voicePause() : null };
      const mine = M;
      drawPlayer();
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      } catch (e) {
        if (M !== mine) return;
        M.result = { why: "Couldn't use the mic. Allow the microphone for Hoops Ladder in your phone's settings." };
        return drawPlayer();
      }
      if (M !== mine) { stream.getTracks().forEach(t => t.stop()); return; }
      M.stream = stream;
      const ctx = M.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 220; // a bounce is mostly a low thud
      const an = ctx.createAnalyser(); an.fftSize = 512;
      src.connect(lp); lp.connect(an);
      const buf = new Float32Array(an.fftSize), hist = [];
      let last = 0, prev = 0;
      const t0 = performance.now();
      const tick = () => {
        if (M !== mine) return;
        M.raf = requestAnimationFrame(tick);
        an.getFloatTimeDomainData(buf);
        let e = 0; for (let i = 0; i < buf.length; i++) e += buf[i] * buf[i];
        e = Math.sqrt(e / buf.length);
        const now = (performance.now() - t0) / 1000;
        hist.push(e); if (hist.length > 90) hist.shift();
        const floor = [...hist].sort((a, b) => a - b)[Math.floor(hist.length * .5)] || 0;
        // A bounce: a jump well above the recent level, at least 0.18 s after the last one (max ~330 per min).
        if (e > Math.max(floor * 3, 0.004) && e > prev * 1.3 && now - last > .18) { M.onsets.push(now); last = now; }
        prev = e;
      };
      M.raf = requestAnimationFrame(tick);
      M.timer = setInterval(() => {
        if (M !== mine) return;
        M.left -= .25;
        const el = document.getElementById("pmLive");
        const r = rate(M.onsets);
        if (el) el.textContent = `Dribble at your own speed… ${Math.ceil(M.left)} s${r.bpm ? ` · hearing ${r.bpm} per min` : ""}`;
        if (M.left <= 0) {
          clearInterval(M.timer); cancelAnimationFrame(M.raf);
          try { stream.getTracks().forEach(t => t.stop()); ctx.close(); } catch (e) {}
          M.stream = null; M.ctx = null;
          M.result = r.bpm ? r : { why: "Couldn't hear a steady bounce. Put the phone on the floor close to you and try again." };
          if (r.bpm) say(`${r.bpm} per minute`);
          drawPlayer();
        }
      }, 250);
    }

    // Speed from the bounces: median gap (ignores a missed or doubled bounce), steadiness from how much gaps vary.
    function rate(on) {
      const gaps = [];
      for (let i = 1; i < on.length; i++) gaps.push(on[i] - on[i - 1]);
      if (gaps.length < 6) return { bpm: 0 };
      const g = med(gaps);
      const near = gaps.filter(x => Math.abs(x - g) < g * .35);
      if (near.length < gaps.length * .6) return { bpm: 0 };
      const mean = near.reduce((a, b) => a + b, 0) / near.length;
      const cv = Math.sqrt(near.reduce((a, b) => a + (b - mean) * (b - mean), 0) / near.length) / mean;
      return { bpm: Math.round(60 / mean), conf: cv < .08 ? "steady, high confidence" : cv < .16 ? "fairly steady" : "uneven, low confidence" };
    }
  }

  /* ---------- 6. Music from another app keeps playing, and dips while the app talks ----------
     Start a playlist in Spotify, YouTube Music or any music app, then open Hoops Ladder. The page never asks for
     full audio focus, so the music isn't paused. Every spoken cue goes through speechSynthesis.speak(), so wrapping
     it here covers them all: the native HoopsAudio plugin (android/.../audio/) asks Android to duck other apps, and
     once the app has been quiet for a second the music comes back up. Beeps are too short to duck.
     See docs/LEARNING.md, step 18. */
  const Duck = Plug.HoopsAudio;
  if (Duck && window.speechSynthesis) {
    const synth = window.speechSynthesis, origSpeak = synth.speak.bind(synth);
    const QUIET_POLLS = 4, POLL_MS = 250; // a second of silence before the music comes back, so a countdown doesn't pump it
    let ducked = false, quiet = 0, polls = 0, timer = null;
    const down = () => Duck.duck().catch(() => {});
    function up() {
      clearInterval(timer); timer = null;
      if (ducked) { ducked = false; Duck.unduck().catch(() => {}); }
    }
    synth.speak = function (u) {
      if (!ducked) { ducked = true; down(); }
      quiet = 0;
      if (!timer) timer = setInterval(() => {
        if (synth.speaking || synth.pending) {
          quiet = 0;
          if (++polls % 16 === 0) down(); // a long cue: tell the plugin we're still talking (it lets go after 10 s)
          return;
        }
        if (++quiet >= QUIET_POLLS) up();
      }, POLL_MS);
      return origSpeak(u);
    };
  }

  /* ---------- 7. Hands-free logging: volume buttons, earbuds and lock-screen buttons ----------
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
