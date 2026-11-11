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
     logged) → the step before, when adding a coach's drills one at a time → the tab you were on before → leave the
     app from Today. */
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
      // Coach session mode (step 27) sits over the player and the tabs: back steps out of its current screen.
      if (window.sesBack && window.sesBack()) return true;
      const film = document.querySelector(".fsq");
      if (film) { if (!press(film, '[data-fq="ecancel"]') && !press(film, '[data-fq="end"]') && !press(film, '[data-fq="close"]')) closeFS(); return true; }
      if (CO.view) { closeVid(); return true; }
      if (CO.rec) { closeRec(); return true; }
      if (CMP) { closeCmp(); return true; }
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
      // Adding drills one at a time on the Coach tab: back goes to the step before.
      if (state.tab === "coach" && CO.mode === "step" && CO.wiz && CO.wiz.step > 0) { wzGo(CO.wiz.step - 1); return true; }
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
      top.appendChild(b);
      const h = pEl.querySelector(".bt-hint");
      if (on && h) h.insertAdjacentHTML("beforeend", `<br>Say “pause”, “go”, “lost it”, “faster”, “slower” or “skip”.`);
    };
    startPlayer = function () {
      origStartPlayer.apply(this, arguments);
      if (P && S.settings.pvoice && who !== "play") vStart("play").then(() => drawPlayer()).catch(() => { S.settings.pvoice = false; persist() });
    };
    closePlayer = function () { if (who === "play") vStop(); origClosePlayer.apply(this, arguments) };

    // Coach session (beta, off by default): "my turn", "again" and "done" while a propped recording runs. The page
    // calls hoopsSesVoice.start(cb) / stop() (sesVmStart in www/index.html) and decides what each phrase does.
    // The drill player's own voice pauses meanwhile and comes back afterward. The WebView is recording at the same
    // time, and some phones give the recognizer silence while it does: then nothing is heard and taps still work.
    let sesCb = null, sesResume = null;
    window.hoopsSesVoice = {
      start(cb) {
        if (!sesResume) sesResume = hooks.voicePause();
        vStop();
        sesCb = cb; who = "ses"; fired = false;
        return Voice.start({ words: ["my turn", "again", "one more", "done"] }).then(() => true, e => {
          if (who === "ses") who = null;
          sesCb = null;
          throw e;
        });
      },
      stop() {
        sesCb = null;
        if (who === "ses") vStop();
        const r = sesResume; sesResume = null;
        if (r) r();
      },
    };
    Voice.addListener("heard", e => { if (e && who === "ses" && sesCb) try { sesCb(e.text || "", e.alts || [], !!e.final) } catch (x) {} });
  }

  /* ---------- 3b. Coach session transcripts ----------
     Voice notes and the coach's clips become text after they're saved. The page decodes the recording to 16 kHz
     mono PCM and calls hoopsTx.run(); the native HoopsTranscribe plugin (android/.../voice/) feeds it to the
     phone's on-device recognizer (Android 13+), so the audio never leaves the phone. Without the plugin, or on an
     older phone, ok() is false and notes stay audio only. See docs/LEARNING.md, step 27. */
  const Tx = Plug.HoopsTranscribe;
  if (Tx) {
    window.hoopsTx = {
      ok: () => Tx.available().then(r => !!(r && r.ok), () => false),
      run: (pcm, o) => Tx.transcribe({ pcm, rate: 16000, lang: "en-US", ask: !!(o && o.ask) }),
    };
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
      knee: m => (/shallow/.test(m.text) ? "Use your legs." : "Not so deep."),
      // from behind (left/right alignment)
      bElbow: m => (m.val.startsWith("-") ? "Ball over the elbow." : "Elbow in, under the ball."),
      bLine: m => (m.val.startsWith("-") ? "Don't cross your face." : "Ball by your shooting eye."),
      bGuide: () => "Guide hand just balances.",
      bSway: () => "Straight up, land where you took off.",
      bStance: () => "Feet about shoulder width."
    };
    const ORDER = ["drift", "bSway", "seq", "tilt", "bElbow", "bLine", "bGuide", "tempo", "ext", "hold", "knee", "bStance"];
    const behind = () => fcView() === "behind";
    const filmTip = () => behind() ? "Film from behind you, on the line to the rim, whole body in frame." : "Film from the side, shooting arm toward the phone, whole body in frame.";
    // From behind, the shooting arm is the one with the higher wrist (the pose model can swap left and right on a back view).
    const armOf = lm => { if (!behind()) return SIDE[S.settings.hand || "R"]; const a = lm[15].v > .3 ? lm[15].y : 1e9, b = lm[16].v > .3 ? lm[16].y : 1e9; return b <= a ? { sh: 12, el: 14, wr: 16 } : { sh: 11, el: 13, wr: 15 }; };
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
.livefc .lf-kb{position:absolute;left:12px;top:12px;font-size:12.5px;font-weight:600;background:rgba(5,8,15,.72);border-radius:999px;padding:3px 10px;z-index:2}.livefc .lf-kb:empty{display:none}
.livefc .lf-place{position:absolute;left:12px;right:12px;bottom:12px;background:rgba(5,8,15,.88);border-radius:14px;padding:12px 14px;font-size:14px;z-index:3}
.livefc .lf-place b{font-family:var(--display);font-size:18px;text-transform:uppercase}
.livefc .lf-place ul{margin:8px 0 10px;padding-left:18px}.livefc .lf-place li{margin:4px 0}
.livefc .lf-seg{display:flex;gap:6px;margin-top:8px}.livefc .lf-seg button{flex:1;border-radius:999px;border:1px solid #2A3858;background:#1C2844;color:#F2F5FA;padding:7px 8px;font:inherit;font-weight:600}
.livefc .lf-seg button[aria-pressed="true"]{background:#F2F5FA;color:#05080F}
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
      // Cues: spoken, a buzz (one for a clean shot, two for a fix: for a loud gym), or off
      const b = L.el.querySelector("[data-lf=talk]"); b.setAttribute("aria-pressed", L.talk !== "off"); b.textContent = "Cues: " + { say: "Voice", buzz: "Buzz", off: "Off" }[L.talk];
    }
    // Before the first shot: where to put the phone, over the live picture so you can line it up. Ready starts counting.
    function drawPlace() {
      const box = L && L.el.querySelector(".lf-place");
      if (!box) return;
      if (L.ready) { box.hidden = true; box.innerHTML = ""; return; }
      const B = behind();
      box.hidden = false;
      box.innerHTML = `<b>Place the phone</b>
        <div class="lf-seg"><button data-lf="view" data-v="behind" aria-pressed="${B}">Behind you</button><button data-lf="view" data-v="side" aria-pressed="${!B}">From the side</button></div>
        <ul>${B
          ? "<li>Behind you, on the straight line from you to the rim. That shows left and right: your elbow, the ball's line, your guide hand.</li><li>About 10 to 15 ft back, at waist height. At a Shoot360, prop it at the back of your lane, out of the way of the machine's passes and the net.</li>"
          : "<li>Level with where you shoot, off to your shooting-hand side, so your shooting arm faces the phone. That shows balance, timing, set point and arc.</li><li>About 10 to 15 ft away, at waist height, out of the way of the ball and the rebound.</li>"}
        <li>Your whole body in the picture, feet included, with room above your hands at the release. Check the skeleton sits on you, then tap Ready.</li></ul>
        <button class="btn pri" data-lf="ready" style="width:100%">Ready</button>`;
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
        <button class="btn sec small" data-lf="keep" aria-pressed="${buKeepOn()}">Keep video</button><button class="btn sec small" data-lf="talk">Cues</button><button class="btn sec small" data-lf="flip">Flip</button><button class="btn sec small" data-lf="close">Done</button></div>
        <div class="lf-stage"><video playsinline muted autoplay></video><canvas></canvas><div class="lf-msg" role="status">Starting the camera…</div><div class="lf-cue" aria-live="polite"></div><div class="lf-kb"></div><div class="lf-place"></div></div>
        <div class="lf-shot"><span>${filmTip()} Shoot when you're ready.</span></div>`;
      document.body.appendChild(el);
      L = { el, video: el.querySelector("video"), cv: el.querySelector("canvas"), stream: null, face: "environment", talk: S.settings.lfCue || "say",
            ready: false, buf: [], shots: [], up: 0, cool: 0, armed: true, lastT: 0, noBody: 0, raf: 0, pl: null, busy: false };
      L.video.setAttribute("playsinline", "");
      el.addEventListener("click", e => {
        const b = e.target.closest("[data-lf]");
        if (!b || !L) return;
        if (b.dataset.lf === "close") closeLive();
        else if (b.dataset.lf === "talk") { L.talk = { say: "buzz", buzz: "off", off: "say" }[L.talk] || "say"; S.settings.lfCue = L.talk; persist(); drawTop(); }
        else if (b.dataset.lf === "keep") buLiveKeep(L);
        else if (b.dataset.lf === "ready") { L.ready = true; drawPlace(); }
        else if (b.dataset.lf === "view") { S.settings.fcView = b.dataset.v; persist(); L.buf = []; L.up = 0; if (K && !K.burst.shots.length) K.burst.view = fcView(); drawPlace(); }
        else if (b.dataset.lf === "flip") { L.face = L.face === "environment" ? "user" : "environment"; startCam(); }
      });
      lockOn();
      drawTop();
      drawPlace();
      try { L.pl = await loadLivePose(); } catch (e) { msg("The pose model couldn't load on this phone."); return; }
      if (!L) return;
      startCam();
    }

    async function startCam() {
      if (!L) return;
      buLivePause(); // the shot recorders stop before the old camera does
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
      buLiveCam(L); // Keep video: record only the shots (section 4b)
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
      if (L.ready) track(lm, t); // shots count once the phone is placed (Ready)
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
      const s = armOf(lm), hot = new Set([s.sh, s.el, s.wr]);
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
      const B = behind(), side = SIDE[S.settings.hand || "R"];
      const body = B ? lm && lm[11].v > .3 && lm[12].v > .3 && (lm[15].v > .3 || lm[16].v > .3) && (lm[27].v > .3 || lm[28].v > .3)
                     : lm && lm[0].v > .3 && lm[side.wr].v > .3 && (lm[side.an].v > .3 || lm[side.an === 28 ? 27 : 28].v > .3);
      if (!body) {
        L.noBody = L.noBody || t;
        if (t - L.noBody > 1.5) msg("Step back until your whole body, feet included, is in frame. " + (B ? "Film from behind, on the line to the rim." : "Film from the side."));
        return;
      }
      // From behind the nose is hidden, so "above the head" is measured from the shoulders (the head is about 0.6 shoulder widths above them).
      const s = B ? armOf(lm) : side;
      const shY = B ? (lm[11].y + lm[12].y) / 2 : lm[s.sh].y, headY = B ? shY - .6 * Math.abs(lm[11].x - lm[12].x) : lm[0].y;
      L.noBody = 0;
      msg("");
      // After a shot, wait for the ball to come back down (wrist below the shoulder) before looking for the next
      // one, so a long follow-through or a wave doesn't count twice.
      // (for 0.3 s, so one jumpy pose frame doesn't count)
      if (!L.armed) { if (lm[s.wr].y > shY) { L.downAt = L.downAt || t; if (t - L.downAt > .3) L.armed = true; } else L.downAt = 0; }
      if (t < L.cool || !L.armed) return;
      const above = lm[s.wr].y < headY, down = lm[s.wr].y > shY;
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
      if (res.view === "behind" ? res.vals.dip < 1.5 : res.vals.knee > 165 || res.vals.ext < 120) return;
      L.shots.push(res);
      { const [cw, ch] = size(); buLiveShot(res, frames, t0, upAt, endAt, cw, ch); }
      drawTop();
      showShot(res);
      const worst = ORDER.map(k => res.M.find(m => m.k === k && m.st === "fix")).find(Boolean);
      const cue = worst ? CUES[worst.k](worst) : "Good shot.";
      const cel = L.el.querySelector(".lf-cue");
      cel.textContent = cue;
      cel.style.color = worst ? "#FF8A75" : "#7BE0A8";
      if (L.talk === "say") say(cue);
      else if (L.talk === "buzz") try { navigator.vibrate?.(worst ? [60, 80, 60] : 40); } catch (e) {}
    }

    function closeLive() {
      if (!L) return;
      const shots = L.shots;
      buLiveEnd().then(id => { if (id) burstOpen(id); }); // stops the shot recorders before the camera closes
      cancelAnimationFrame(L.raf);
      if (L.stream) L.stream.getTracks().forEach(t => t.stop());
      L.el.remove();
      L = null;
      lockOff();
      if (!shots.length) return;
      // Save one form entry for the session: the median of each number, and each check's most common status.
      const vals = {}, M = [];
      for (const k of Object.keys(shots[0].vals)) { const xs = shots.map(r => r.vals[k]).filter(x => x != null); vals[k] = xs.length ? med(xs) : null; }
      for (const m of shots[0].M) {
        const n = {};
        for (const r of shots) { const x = r.M.find(y => y.k === m.k); if (x) n[x.st] = (n[x.st] || 0) + 1; }
        M.push({ k: m.k, st: Object.keys(n).sort((a, b) => n[b] - n[a])[0] });
      }
      saveForm({ vals, M, view: shots[0].view });
      render();
    }
  }

  /* ---------- 4b. Shot bursts: each shot's own video, from a run of shots ----------
     At a Shoot360 (or any rapid run of shots) the live form check finds each shot. With Keep video on, it also keeps
     that shot's few seconds of video, and nothing else: two MediaRecorders on the camera stream take turns, each
     restarting every 10 s, so any shot of 5 s or less falls wholly inside one of them. A 10 s piece is written to
     the video store only if a shot lies in it, so walking, waiting for the machine and rebounding never reach
     storage. No sound, 1 Mbps. A long clip picked on the Form tab is read the same way: every shot is found, and
     each one is re-recorded on its own (a canvas copy played at normal speed) so only the shots are kept.
     The viewer shows Shot 1..N with each shot's numbers and skeleton, star, keep and compare lined up at the release.
     Video for shots with no star, Keep or send is deleted 14 days after filming; the numbers stay.
     Data: S.bursts (numbers only, see burstFind) and video records tagged `burst` in hoopsLadder.videos. Pose frames
     for a shot are at blobs[shotId+":pf"]. See docs/LEARNING.md, step 28. */
  const BURST_ACTIONS = []; // {id, label, run(burst, shots)}: extra buttons on the viewer's bottom bar
  const BU = { KEEP_DAYS: 14, MAX: 40, SEG: 10, ONE_SEG: 20, BPS: 1000000, PRE: 2, POST: .6, CLIP_MIN: 12, CLIP_MAX: 180, FPS: 10 };
  const buList = () => (Array.isArray(S.bursts) ? S.bursts : (S.bursts = []));
  function burstFind(id) { const burst = buList().find(b => b.id === id); return burst ? { burst } : null; }
  const BUU = {}; // blob URLs by video id
  async function burstShotUrl(shot) {
    if (!shot || !shot.v) return "";
    if (BUU[shot.v]) return BUU[shot.v];
    try { const b = await vtx("readonly", (m, bl) => rq(bl.get(shot.v))); if (b) return (BUU[shot.v] = URL.createObjectURL(b)); } catch (e) {}
    return "";
  }
  async function burstShotFrames(shot) {
    if (!shot) return null;
    try { return (await vtx("readonly", (m, bl) => rq(bl.get(shot.id + ":pf")))) || null; } catch (e) { return null; }
  }
  // native.js runs inside its own function, so the page (Send to coach) reaches these through window
  Object.assign(window, { burstFind, burstShotUrl, burstShotFrames, BURST_ACTIONS });
  if (typeof sendShots === "function") BURST_ACTIONS.push({ id: "send", label: "Send to coach…", run: (b, shots) => sendShots(b, shots) });
  const buSesUses = v => { try { return typeof sesUsesVid === "function" && !!sesUsesVid(v); } catch (e) { return false; } };

  async function buStore(bid, blob, secs) {
    const id = uid("v");
    const meta = { id, t: Date.now(), dur: Math.round(secs || 0), size: blob.size, type: blob.type || "video/mp4", burst: bid, ses: null, name: "", item: null, drill: null };
    await vtx("readwrite", (m, bl) => { m.put(meta); bl.put(blob, id); });
    try { if (navigator.storage?.persist && !(await navigator.storage.persisted?.())) await navigator.storage.persist(); } catch (e) {}
    BUU[id] = URL.createObjectURL(blob);
    return id;
  }
  const buPf = (shotId, pf) => vtx("readwrite", (m, bl) => { bl.put(pf, shotId + ":pf"); }).catch(() => {});
  // drop video ids no shot (and no coach session) still points at, and the pose frames of the given shots
  async function buDrop(vids, shotIds) {
    const used = new Set();
    for (const b of buList()) for (const s of b.shots) if (s.v) used.add(s.v);
    const gone = [...new Set(vids)].filter(v => v && !used.has(v) && !buSesUses(v));
    try { await vtx("readwrite", (m, bl) => { for (const v of gone) { m.delete(v); bl.delete(v); } for (const s of shotIds || []) bl.delete(s + ":pf"); }); } catch (e) {}
    for (const v of gone) if (BUU[v]) { URL.revokeObjectURL(BUU[v]); delete BUU[v]; }
    return gone.length;
  }
  const rnd = (x, k) => Math.round(x * k) / k;
  const pack = lm => (lm ? lm.map(p => [rnd(p.x, 10), rnd(p.y, 10), rnd(p.v, 100)]) : null);
  const unpack = f => (f ? f.map(p => ({ x: p[0], y: p[1], v: p[2] })) : null);
  // one shot's record, from compute()'s result. `T` turns a frame index into video seconds.
  function buShot(n, res) {
    return { id: uid("sh"), n, v: null, a: 0, b: 0, r: 0, at: null, vals: res.vals, st: Object.fromEntries(res.M.map(m => [m.k, m.st])),
             m: res.M.map(m => ({ k: m.k, l: m.label.replace(/ \(.*\)/, ""), v: m.val, st: m.st })), star: false, keep: false };
  }
  const worstOf = shot => (shot.m.some(m => m.st === "fix") ? "fix" : shot.m.some(m => m.st === "watch") ? "watch" : "good");
  function buSaveForm(results) { // one form history entry for a burst, like the live form check: medians and the commonest status
    if (!results.length) return;
    const vals = {}, M = [];
    for (const k of Object.keys(results[0].vals)) { const xs = results.map(r => r.vals[k]).filter(x => x != null); vals[k] = xs.length ? med(xs) : null; }
    for (const m of results[0].M) {
      const n = {};
      for (const r of results) { const x = r.M.find(y => y.k === m.k); if (x) n[x.st] = (n[x.st] || 0) + 1; }
      M.push({ k: m.k, st: Object.keys(n).sort((a, b) => n[b] - n[a])[0] });
    }
    saveForm({ vals, M, view: results[0].view });
  }

  /* -- two staggered recorders on one stream; onSeg({blob, t0, t1}) for each finished piece (performance seconds) -- */
  function buRing(stream, onSeg) {
    const W = { recs: [], one: false, tick: 0, ok: true };
    const now = () => performance.now() / 1000;
    function rec() {
      const type = pickMime();
      let mr;
      try { mr = new MediaRecorder(stream, Object.assign({ videoBitsPerSecond: BU.BPS }, type ? { mimeType: type } : {})); }
      catch (e) { try { mr = new MediaRecorder(stream); } catch (e2) { return null; } }
      const r = { mr, chunks: [], t0: now() };
      mr.ondataavailable = e => { if (e.data && e.data.size) r.chunks.push(e.data); };
      mr.onstart = () => { r.t0 = now(); };
      try { mr.start(1000); } catch (e) { return null; }
      W.recs.push(r);
      return r;
    }
    function finish(r) {
      W.recs.splice(W.recs.indexOf(r), 1);
      const t1 = now();
      return new Promise(res => {
        r.mr.onstop = () => { const c = r.chunks; r.chunks = []; res(c.length ? { blob: new Blob(c, { type: c[0].type || r.mr.mimeType || "video/mp4" }), t0: r.t0, t1, last: W.ending } : null); };
        try { if (r.mr.state === "inactive") r.mr.onstop(); else r.mr.stop(); } catch (e) { res(null); }
      }).then(seg => (seg ? onSeg(seg) : null));
    }
    if (typeof MediaRecorder === "undefined" || !rec()) { W.ok = false; return W; }
    W.tick = setInterval(() => {
      const life = W.one ? BU.ONE_SEG : BU.SEG;
      for (const r of W.recs.slice()) if (now() - r.t0 >= life) { finish(r); rec(); }
      if (W.recs.length === 1 && !W.one && now() - W.recs[0].t0 >= BU.SEG / 2 && !rec()) W.one = true; // one recorder at a time: 20 s pieces
      if (!W.recs.length) rec();
    }, 250);
    W.end = () => { clearInterval(W.tick); W.ending = true; return Promise.all(W.recs.slice().map(finish)); };
    return W;
  }

  /* -- live form check side (called from section 4) -- */
  let K = null; // the live burst: {burst, ring, pend, results, chain, bytes, el}
  const buKeepOn = () => S.settings.lfKeep !== false;
  function buLiveLine() {
    if (!K || !K.el) return;
    const el = K.el.querySelector(".lf-kb");
    if (!el) return;
    const n = K.burst.shots.length;
    el.textContent = !buKeepOn() ? "" : K.noRec ? "No video on this phone, numbers only" : K.full ? "Storage full, numbers only" : K.bytes ? `Video · ${fmtMB(K.bytes)} kept` : "Video · keeping shots only";
  }
  // (re)start the recorders on the live check's stream; buLivePause() first when the stream is about to change
  function buLiveCam(L) {
    if (!K) K = { burst: { id: uid("b"), t: Date.now(), view: fcView(), hand: S.settings.hand || "R", src: "live", shots: [] }, pend: [], results: [], chain: Promise.resolve(), bytes: 0, ends: [] };
    K.el = L.el;
    buLivePause();
    if (buKeepOn() && L.stream && !K.full) {
      const k = K, W = buRing(L.stream, seg => { k.chain = k.chain.then(() => buSeg(k, seg)); });
      if (W.ok) K.ring = W; else K.noRec = true;
    }
    buLiveLine();
  }
  function buLivePause() { if (K && K.ring) { const W = K.ring; K.ring = null; K.ends.push(W.end()); } }
  function buLiveKeep(L) {
    S.settings.lfKeep = !buKeepOn();
    persist();
    const b = L.el.querySelector("[data-lf=keep]");
    if (b) b.setAttribute("aria-pressed", buKeepOn());
    if (buKeepOn()) buLiveCam(L); else { buLivePause(); buLiveLine(); }
  }
  // a shot found by the live check: frames are compute()'s 10 fps frames from t0 (performance seconds)
  function buLiveShot(res, frames, t0, upAt, endAt, cw, ch) {
    if (!K) return;
    K.results.push(res);
    const B = K.burst, shot = buShot(B.shots.length + 1, res);
    if (!buList().includes(B)) { buList().push(B); S.bursts = buList().slice(-30); }
    B.shots.push(shot);
    persist();
    // dense 10 fps frames from t0 (compute's frames can skip a missing one)
    const f = [];
    for (const fr of frames) f[Math.round(fr.t * BU.FPS)] = pack(fr.lm);
    for (let i = 0; i < f.length; i++) if (f[i] === undefined) f[i] = null;
    const at = { p: t0 + frames[res.p].t, sp: t0 + frames[res.sp].t, r: t0 + frames[res.r].t };
    if (K.ring && B.shots.filter(s => s.v || K.pend.some(p => p.shot === s)).length < BU.MAX)
      K.pend.push({ shot, w0: upAt - BU.PRE, w1: endAt + BU.POST, at, pf: { fps: BU.FPS, t0, cw, ch, f } });
    else buPf(shot.id, { fps: BU.FPS, t0: 0, cw, ch, f });
    buLiveLine();
  }
  async function buSeg(K, seg) {
    // the last piece (Done) also takes a shot whose follow-through it cut short, as long as the release is in it
    const mine = K.pend.filter(p => p.w0 >= seg.t0 - .05 && (p.w1 <= seg.t1 + .05 || (seg.last && p.at.r < seg.t1 - .1)));
    if (mine.length) {
      try {
        const id = await buStore(K.burst.id, seg.blob, seg.t1 - seg.t0);
        K.bytes += seg.blob.size;
        for (const p of mine) {
          const s = p.shot, o = seg.t0;
          Object.assign(s, { v: id, a: rnd(Math.max(0, p.w0 - o), 100), b: rnd(Math.min(p.w1, seg.t1) - o, 100), r: rnd(p.at.r - o, 100),
                             at: { p: rnd(p.at.p - o, 100), sp: rnd(p.at.sp - o, 100), r: rnd(p.at.r - o, 100) } });
          await buPf(s.id, Object.assign({}, p.pf, { t0: rnd(p.pf.t0 - o, 1000) }));
        }
        persist();
      } catch (e) { if (e && e.name === "QuotaExceededError") { K.full = true; toast("Phone storage is full", "Shot videos stopped. The numbers keep going."); } }
      K.pend = K.pend.filter(p => !mine.includes(p));
    }
    // (a shot no piece covers keeps waiting; Done gives it its numbers only)
    if (K.full && K.ring) { const W = K.ring; K.ring = null; K.ends.push(W.end()); }
    buLiveLine();
  }
  // Done on the live check: stop the recorders, keep what's covered, then open the burst. Resolves to its id or null.
  async function buLiveEnd() {
    if (!K) return null;
    const k = K;
    buLivePause(); // stops the recorders now, before the camera closes
    await Promise.all(k.ends);
    await k.chain;
    for (const p of k.pend) await buPf(p.shot.id, Object.assign({}, p.pf, { t0: 0 }));
    k.pend = [];
    K = null;
    persist();
    if (k.burst.shots.length) { await loadVids(); return k.burst.id; }
    return null;
  }

  /* -- a long clip from the gallery: find every shot, keep each one as its own short video -- */
  // Same shot rules as the live check (section 4): the wrist above the head starts a shot, back below the shoulder
  // (or 1.8 s) ends it, 0.8 s before the next, and the hand must come down for 0.3 s first.
  function buFind(frames, view, hand) {
    const B = view === "behind", side = SIDE[hand];
    const out = [];
    let up = 0, cool = 0, armed = true, downAt = 0;
    for (const { t, lm } of frames) {
      if (!lm) continue;
      const body = B ? lm[11].v > .3 && lm[12].v > .3 && (lm[15].v > .3 || lm[16].v > .3) && (lm[27].v > .3 || lm[28].v > .3)
                     : lm[0].v > .3 && lm[side.wr].v > .3 && (lm[side.an].v > .3 || lm[side.an === 28 ? 27 : 28].v > .3);
      if (!body) continue;
      const wr = B ? ((lm[16].v > .3 ? lm[16].y : 1e9) <= (lm[15].v > .3 ? lm[15].y : 1e9) ? 16 : 15) : side.wr;
      const shY = B ? (lm[11].y + lm[12].y) / 2 : lm[side.sh].y, headY = B ? shY - .6 * Math.abs(lm[11].x - lm[12].x) : lm[0].y;
      if (!armed) { if (lm[wr].y > shY) { downAt = downAt || t; if (t - downAt > .3) armed = true; } else downAt = 0; }
      if (t < cool || !armed) continue;
      const above = lm[wr].y < headY, down = lm[wr].y > shY;
      if (above && !up) up = t;
      if (up && ((down && t - up > .25) || t - up > 1.8)) { out.push({ up, end: t }); up = 0; armed = false; downAt = 0; cool = t + .8; }
    }
    return out;
  }
  const buOnce = (el, ev, ms) => new Promise(res => { const f = () => { clearTimeout(tm); el.removeEventListener(ev, f); res(true); }; const tm = setTimeout(() => { el.removeEventListener(ev, f); res(false); }, ms); el.addEventListener(ev, f); });
  async function buSeekTo(v, t) { if (Math.abs(v.currentTime - t) < 1e-3) return; const p = buOnce(v, "seeked", 2000); v.currentTime = t; await p; }
  // re-record v from w0 to w1 at normal speed through a canvas, with no sound
  async function buCut(v, w0, w1) {
    const c = document.createElement("canvas"), sc = Math.min(1, 720 / Math.min(v.videoWidth, v.videoHeight));
    c.width = Math.round(v.videoWidth * sc / 2) * 2; c.height = Math.round(v.videoHeight * sc / 2) * 2;
    const g = c.getContext("2d");
    if (!c.captureStream || typeof MediaRecorder === "undefined") return null;
    await buSeekTo(v, w0);
    g.drawImage(v, 0, 0, c.width, c.height);
    const stream = c.captureStream(30), type = pickMime();
    let mr;
    try { mr = new MediaRecorder(stream, Object.assign({ videoBitsPerSecond: BU.BPS }, type ? { mimeType: type } : {})); } catch (e) { try { mr = new MediaRecorder(stream); } catch (e2) { return null; } }
    const chunks = [];
    mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise(res => { mr.onstop = res; });
    mr.start(500);
    v.playbackRate = 1;
    try { await v.play(); } catch (e) { mr.stop(); stream.getTracks().forEach(x => x.stop()); return null; }
    await new Promise(res => {
      const lim = setTimeout(res, (w1 - w0) * 1000 + 3000);
      const step = () => { g.drawImage(v, 0, 0, c.width, c.height); if (v.currentTime >= w1 || v.ended) { clearTimeout(lim); res(); } else requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
    v.pause();
    mr.stop();
    await stopped;
    stream.getTracks().forEach(x => x.stop());
    return chunks.length ? new Blob(chunks, { type: chunks[0].type || mr.mimeType || "video/mp4" }) : null;
  }
  let BC = null; // the clip being read
  async function buFromClip(file, dur) {
    if (BC) return;
    const el = document.createElement("div");
    el.className = "livefc buv";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Finding your shots");
    el.innerHTML = `<div class="lf-top"><div class="lf-title">Shot burst</div><button class="btn sec small" data-bc="cancel">Cancel</button></div>
      <div class="bu-wait"><b>Finding your shots</b><p class="bu-prog" role="status">Loading the pose model…</p><p class="bu-sub">Keep the app open. Only the shots are kept, each as its own short video.</p></div>`;
    document.body.appendChild(el);
    BC = { el, stop: false };
    el.addEventListener("click", e => { if (e.target.closest("[data-bc=cancel]") && BC) BC.stop = true; });
    const prog = t => { const p = el.querySelector(".bu-prog"); if (p) p.textContent = t; };
    lockOn();
    const url = URL.createObjectURL(file), v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    const done = id => { lockOff(); URL.revokeObjectURL(url); v.removeAttribute("src"); v.load(); el.remove(); BC = null; render(); if (id) burstOpen(id); };
    let pl = null;
    try { pl = await loadPose(); } catch (e) {}
    if (!pl) { toast("Couldn't load the pose model", "Shot bursts need it to find your shots."); return done(null); }
    await buOnce(v, "loadeddata", 8000);
    if (!v.videoWidth) { toast("Couldn't open that video", "Try a clip filmed with your camera app."); return done(null); }
    const sc = 480 / Math.max(v.videoWidth, v.videoHeight), cw = Math.round(v.videoWidth * sc), ch = Math.round(v.videoHeight * sc);
    const work = document.createElement("canvas"); work.width = cw; work.height = ch;
    const wg = work.getContext("2d");
    const end = Math.min(dur, BU.CLIP_MAX), n = Math.floor(end * BU.FPS), frames = [];
    for (let i = 0; i < n; i++) {
      if (BC.stop) return done(null);
      const t = i / BU.FPS;
      await buSeekTo(v, Math.min(t + .001, dur - .01));
      wg.drawImage(v, 0, 0, cw, ch);
      let lm = null;
      try { const r = pl.detect(work); lm = r.landmarks && r.landmarks[0]; } catch (e) {}
      frames.push({ t, lm: lm ? lm.map(p => ({ x: p.x * cw, y: p.y * ch, v: p.visibility ?? 1 })) : null });
      if (i % 10 === 0) prog(`Reading ${fmtDur(t) || "0:00"} of ${fmtDur(end)}${dur > end ? ` (the first ${fmtDur(end)} only)` : ""}`);
    }
    const view = fcView(), hand = S.settings.hand || "R", B = { id: uid("b"), t: Date.now(), view, hand, src: "clip", shots: [] }, results = [], keep = [];
    for (const s of buFind(frames, view, hand)) {
      const t0 = s.up - 2.5, fr = frames.filter(f => f.t >= t0 - 1e-6 && f.t <= s.end + 1e-6).map(f => ({ t: f.t - t0, lm: f.lm }));
      let res = null;
      try { res = compute(fr, BU.FPS); } catch (e) {}
      if (!res || !res.ok) continue;
      if (res.view === "behind" ? res.vals.dip < 1.5 : res.vals.knee > 165 || res.vals.ext < 120) continue;
      const shot = buShot(B.shots.length + 1, res);
      B.shots.push(shot); results.push(res);
      keep.push({ shot, w0: Math.max(0, s.up - BU.PRE), w1: Math.min(dur, s.end + BU.POST), t0, fr, at: { p: t0 + fr[res.p].t, sp: t0 + fr[res.sp].t, r: t0 + fr[res.r].t } });
    }
    if (!B.shots.length) { toast("No shots found", view === "behind" ? "Film from behind you with your whole body, feet included, in frame." : "Film from the side with your whole body, feet included, in frame."); return done(null); }
    buList().push(B); S.bursts = buList().slice(-30);
    persist();
    let cut = 0;
    for (const k of keep) {
      if (BC.stop) break;
      prog(`Keeping shot ${k.shot.n} of ${B.shots.length}`);
      const f = [];
      for (const x of k.fr) f[Math.round(x.t * BU.FPS)] = pack(x.lm);
      for (let i = 0; i < f.length; i++) if (f[i] === undefined) f[i] = null;
      let blob = null;
      if (cut < BU.MAX) try { blob = await buCut(v, k.w0, k.w1); } catch (e) {}
      if (blob) {
        try {
          const o = k.w0, s = k.shot;
          s.v = await buStore(B.id, blob, k.w1 - k.w0);
          Object.assign(s, { a: 0, b: rnd(k.w1 - o, 100), r: rnd(k.at.r - o, 100), at: { p: rnd(k.at.p - o, 100), sp: rnd(k.at.sp - o, 100), r: rnd(k.at.r - o, 100) } });
          cut++;
        } catch (e) { if (e && e.name === "QuotaExceededError") { toast("Phone storage is full", "The rest of the shots keep their numbers only."); cut = BU.MAX; } }
      }
      await buPf(k.shot.id, { fps: BU.FPS, t0: rnd(k.t0 - k.w0, 1000), cw, ch, f });
    }
    persist();
    buSaveForm(results);
    await loadVids();
    done(B.id);
  }
  const origAnalyze = analyze;
  analyze = async function (file) {
    let d = 0;
    try { d = await vidDur(file); } catch (e) {}
    if (d > BU.CLIP_MIN) return buFromClip(file, d);
    return origAnalyze.apply(this, arguments);
  };

  /* -- the burst viewer -- */
  const bst = document.createElement("style");
  bst.textContent = `
.buv .bu-wait{flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:24px}
.buv .bu-wait b{font-family:var(--display);font-size:24px;text-transform:uppercase}.buv .bu-wait p{margin:8px 0 0}.buv .bu-sub{opacity:.7;font-size:14px}
.buv .bu-panes{position:relative;flex:1;min-height:0;display:flex;gap:6px;padding:0 8px}
.buv .bu-pane{position:relative;flex:1;min-width:0;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000;border-radius:10px}
.buv .bu-pane video,.buv .bu-pane canvas{position:absolute}
.buv .bu-tag{position:absolute;left:8px;top:8px;font-size:12.5px;font-weight:700;background:rgba(5,8,15,.75);border-radius:999px;padding:3px 9px;z-index:2}
.buv .bu-none{opacity:.75;font-size:14px;padding:16px;text-align:center}
.buv .bu-row{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;padding:8px 12px 0}
.buv .bu-strip{display:flex;gap:6px;overflow-x:auto;padding:10px 12px 4px;scrollbar-width:none}
.buv .bu-chip{flex:none;min-width:44px;height:44px;border-radius:12px;border:2px solid transparent;background:#1C2844;color:#F2F5FA;font-weight:700;font-size:15px;position:relative}
.buv .bu-chip.fix{background:#7a2318}.buv .bu-chip.watch{background:#5a3f06}.buv .bu-chip.good{background:#145c3c}
.buv .bu-chip.nov{opacity:.45}.buv .bu-chip[aria-current="true"]{border-color:#F2F5FA}.buv .bu-chip.sel{outline:3px solid #F07A35;outline-offset:1px}
.buv .bu-chip .st{position:absolute;right:2px;top:0;font-size:11px;color:#FFD34D}
.buv .bu-m{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;padding:6px 12px 0}
.buv .bu-m span{font-size:12.5px;border-radius:999px;padding:4px 10px;background:#1C2844}
.buv .bu-m span.fix{background:#C13C2A}.buv .bu-m span.watch{background:#6b4a05}.buv .bu-m span.good{background:#1E8657}
.buv .bu-note{font-size:12.5px;opacity:.72;text-align:center;padding:6px 16px 0;margin:0}
.buv .bu-bar{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;padding:8px 12px 14px}
.bu-list{display:flex;flex-direction:column;gap:6px;margin:8px 0}
.bu-item{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:1px solid var(--line,#ddd);border-radius:12px;padding:10px 12px;background:var(--card,#fff);color:inherit;font:inherit}
.bu-item b{flex:1}.bu-item .muted{font-size:13px}`;
  document.head.appendChild(bst);

  let BV = null; // the open viewer: {bid, i, sel:Set, cmp, rate, el, raf}
  const buDay = t => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  function burstOpen(id, i) {
    const f = burstFind(id);
    if (!f) return;
    if (BV) burstClose();
    const el = document.createElement("div");
    el.className = "livefc buv";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Shot burst");
    document.body.appendChild(el);
    BV = { bid: id, i: i || 0, sel: new Set(), cmp: null, pick: false, rate: .5, el, raf: 0, pf: {}, urls: {} };
    el.addEventListener("click", buClick);
    el.addEventListener("pointerdown", buPress);
    buDraw();
  }
  function burstClose() {
    if (!BV) return;
    cancelAnimationFrame(BV.raf);
    BV.el.querySelectorAll("video").forEach(v => { v.pause(); v.removeAttribute("src"); v.load(); });
    BV.el.remove();
    BV = null;
    if (state.tab === "form") render();
  }
  const buCur = () => { const f = BV && burstFind(BV.bid); return f ? f.burst : null; };
  function buDraw() {
    const B = buCur();
    if (!B) return burstClose();
    const S0 = B.shots, cur = S0[BV.i] || S0[0], other = BV.cmp != null ? S0[BV.cmp] : null;
    const exp = B.t + BU.KEEP_DAYS * 864e5, kept = s => s.star || s.keep || s.sent;
    const unkept = S0.filter(s => s.v && !kept(s)).length;
    const shots = BV.sel.size ? S0.filter(s => BV.sel.has(s.id)) : [cur];
    BV.el.innerHTML = `<div class="lf-top"><div class="lf-title">Shot ${cur.n} <span style="opacity:.7">of ${S0.length} · ${esc(buDay(B.t))}</span></div>
      <button class="btn sec small" data-bv="close">Done</button></div>
      <div class="bu-panes">${pane(cur, other ? `Shot ${cur.n}` : "")}${other ? pane(other, `Shot ${other.n}`) : ""}</div>
      <div class="bu-m">${cur.m.map(m => `<span class="${m.st}">${esc(m.l)} · ${esc(m.v)}</span>`).join("")}</div>
      <div class="bu-row">${[[1, "1×"], [.5, "½×"], [.25, "¼×"]].map(([r, l]) => `<button class="btn sec small" data-bv="rate:${r}" aria-pressed="${BV.rate === r}">${l}</button>`).join("")}
        ${cur.at ? `<button class="btn sec small" data-bv="jump:p">Dip</button><button class="btn sec small" data-bv="jump:sp">Set point</button><button class="btn sec small" data-bv="jump:r">Release</button>` : ""}<button class="btn sec small" data-bv="play">Pause</button></div>
      <div class="bu-strip" role="listbox" aria-label="Shots">${S0.map((s, j) => `<button class="bu-chip ${worstOf(s)}${s.v ? "" : " nov"}${BV.sel.has(s.id) ? " sel" : ""}" data-bv="shot:${j}" aria-current="${j === BV.i}" aria-label="Shot ${s.n}${s.star ? ", starred" : ""}${s.v ? "" : ", no video"}">${s.n}${s.star ? '<span class="st">★</span>' : ""}</button>`).join("")}</div>
      ${BV.pick ? `<p class="bu-note"><b>Tap the shot to compare with.</b> They play lined up at the release.</p>`
        : BV.sel.size ? `<p class="bu-note">${BV.sel.size} selected · <button class="linkbtn" data-bv="selclear" style="color:inherit">Clear</button></p>`
        : `<p class="bu-note">${unkept && Date.now() < exp ? `Video for shots with no ★ or Keep is deleted on ${esc(buDay(exp))}. ` : ""}Hold a shot to select several.</p>`}
      <div class="bu-bar"><button class="btn sec small" data-bv="star" aria-pressed="${!!cur.star}">${cur.star ? "★ Starred" : "☆ Star"}</button>
        ${cur.v ? `<button class="btn sec small" data-bv="keep" aria-pressed="${!!cur.keep}">${cur.keep ? "Kept" : "Keep"}</button>` : ""}
        ${S0.length > 1 ? `<button class="btn sec small" data-bv="cmp" aria-pressed="${other != null || BV.pick}">${other ? "Single" : "Compare"}</button>` : ""}
        ${cur.v ? `<button class="btn sec small" data-bv="del">${BV.delAsk ? "Tap again to delete" : "Delete video"}</button>` : ""}
        ${BURST_ACTIONS.map(a => `<button class="btn sec small" data-bv="act:${esc(a.id)}">${esc(a.label)}</button>`).join("")}</div>`;
    BV.shots = shots;
    buLoad(cur, other);
  }
  function pane(s, tag) {
    return `<div class="bu-pane" data-shot="${s.id}">${tag ? `<span class="bu-tag">${esc(tag)}</span>` : ""}${s.v ? `<video playsinline muted loop=""></video><canvas></canvas>` : `<div class="bu-none">No video for shot ${s.n}. ${s.gone ? "It was deleted after 14 days." : "Only its numbers were kept."}</div>`}</div>`;
  }
  async function buLoad(cur, other) {
    const my = BV;
    cancelAnimationFrame(my.raf);
    const P = [];
    for (const s of [cur, other].filter(Boolean)) {
      const box = my.el.querySelector(`.bu-pane[data-shot="${s.id}"]`), v = box && box.querySelector("video");
      if (!v) continue;
      const url = await burstShotUrl(s);
      if (BV !== my) return;
      if (!url) { box.innerHTML = `<div class="bu-none">Couldn't open shot ${s.n}'s video.</div>`; continue; }
      if (!(s.id in my.pf)) my.pf[s.id] = await burstShotFrames(s);
      if (BV !== my) return;
      v.src = url;
      v.playbackRate = my.rate;
      P.push({ s, v, cv: box.querySelector("canvas"), box, pf: my.pf[s.id] });
    }
    my.P = P;
    for (const p of P) { if (p.v.readyState < 1) await buOnce(p.v, "loadedmetadata", 4000); try { p.v.currentTime = p.s.a; } catch (e) {} }
    if (BV !== my) return;
    for (const p of P) { p.v.playbackRate = my.rate; p.v.play().catch(() => {}); }
    my.playing = true;
    const tick = () => {
      if (BV !== my) return;
      my.raf = requestAnimationFrame(tick);
      const m = P[0];
      if (!m) return;
      if (m.v.currentTime >= m.s.b - .02 || m.v.currentTime < m.s.a - .3) { m.v.currentTime = m.s.a; }
      if (P[1]) { // the other shot follows, lined up at the release
        const want = Math.max(P[1].s.a, Math.min(P[1].s.b, P[1].s.r + (m.v.currentTime - m.s.r)));
        if (Math.abs(P[1].v.currentTime - want) > .08) P[1].v.currentTime = want;
        if (P[1].v.paused !== m.v.paused) { if (m.v.paused) P[1].v.pause(); else P[1].v.play().catch(() => {}); }
      }
      for (const p of P) buSkel(p, B0(p));
    };
    const B0 = p => p.v.currentTime;
    tick();
  }
  function buSkel(p, t) {
    const { v, cv, box, pf } = p;
    if (!v.videoWidth) return;
    const k = Math.min(box.clientWidth / v.videoWidth, box.clientHeight / v.videoHeight), w = Math.round(v.videoWidth * k), h = Math.round(v.videoHeight * k);
    if (v.style.width !== w + "px") { v.style.width = cv.style.width = w + "px"; v.style.height = cv.style.height = h + "px"; }
    if (!pf || !pf.f) return;
    if (cv.width !== pf.cw) { cv.width = pf.cw; cv.height = pf.ch; }
    const c = cv.getContext("2d");
    c.clearRect(0, 0, cv.width, cv.height);
    const i = Math.round((t - pf.t0) * pf.fps), lm = i >= 0 && i < pf.f.length ? unpack(pf.f[i]) : null;
    if (!lm) return;
    const B = buCur(), s = B && B.view !== "behind" ? SIDE[B.hand || "R"] : null, hot = new Set(s ? [s.sh, s.el, s.wr] : []);
    c.lineCap = "round";
    for (const [a, b] of BONES) {
      const A = lm[a], Z = lm[b];
      if (!A || !Z || A.v < .3 || Z.v < .3) continue;
      const on = hot.has(a) && hot.has(b);
      c.strokeStyle = on ? "#F07A35" : "rgba(255,255,255,.85)"; c.lineWidth = on ? 4 : 2.5;
      c.beginPath(); c.moveTo(A.x, A.y); c.lineTo(Z.x, Z.y); c.stroke();
    }
  }
  function buPress(e) {
    const b = e.target.closest("[data-bv^='shot:']");
    if (!b || !BV) return;
    clearTimeout(BV.hold);
    BV.held = false;
    const up = () => { clearTimeout(BV && BV.hold); b.removeEventListener("pointerup", up); b.removeEventListener("pointerleave", up); };
    b.addEventListener("pointerup", up); b.addEventListener("pointerleave", up);
    BV.hold = setTimeout(() => {
      if (!BV) return;
      BV.held = true;
      const s = buCur().shots[+b.dataset.bv.slice(5)];
      if (BV.sel.has(s.id)) BV.sel.delete(s.id); else BV.sel.add(s.id);
      try { navigator.vibrate?.(15); } catch (er) {}
      buDraw();
    }, 500);
  }
  async function buClick(e) {
    const b = e.target.closest("[data-bv]");
    if (!b || !BV) return;
    const [k, x] = b.dataset.bv.split(/:(.*)/), B = buCur(), cur = B.shots[BV.i];
    if (k !== "del") BV.delAsk = false;
    if (k === "close") return burstClose();
    if (k === "shot") {
      if (BV.held) { BV.held = false; return; }
      const j = +x;
      if (BV.sel.size) { const s = B.shots[j]; if (BV.sel.has(s.id)) BV.sel.delete(s.id); else BV.sel.add(s.id); return buDraw(); }
      if (BV.pick) { BV.pick = false; if (j !== BV.i) BV.cmp = j; return buDraw(); }
      BV.i = j;
      if (BV.cmp === j) BV.cmp = null;
      return buDraw();
    }
    if (k === "rate") { BV.rate = +x; (BV.P || []).forEach(p => (p.v.playbackRate = BV.rate)); BV.el.querySelectorAll("[data-bv^='rate:']").forEach(y => y.setAttribute("aria-pressed", y.dataset.bv === b.dataset.bv)); return; }
    if (k === "play") { const m = BV.P && BV.P[0]; if (!m) return; if (m.v.paused) m.v.play().catch(() => {}); else m.v.pause(); b.textContent = m.v.paused ? "Play" : "Pause"; return; }
    if (k === "jump") { const m = BV.P && BV.P[0]; if (!m || !cur.at) return; m.v.pause(); m.v.currentTime = cur.at[x]; const pb = BV.el.querySelector("[data-bv=play]"); if (pb) pb.textContent = "Play"; return; }
    if (k === "selclear") { BV.sel.clear(); return buDraw(); }
    if (k === "star") { cur.star = !cur.star; persist(); return buDraw(); }
    if (k === "keep") { cur.keep = !cur.keep; persist(); return buDraw(); }
    if (k === "cmp") {
      if (BV.cmp != null || BV.pick) { BV.cmp = null; BV.pick = false; return buDraw(); }
      const star = B.shots.findIndex((s, j) => s.star && s.v && j !== BV.i);
      if (star >= 0) BV.cmp = star; else BV.pick = true;
      return buDraw();
    }
    if (k === "del") {
      if (!BV.delAsk) { BV.delAsk = true; b.textContent = "Tap again to delete"; return; }
      BV.delAsk = false;
      const v = cur.v;
      cur.v = null; cur.star = false; cur.keep = false;
      persist();
      await buDrop([v], []);
      await loadVids();
      return buDraw();
    }
    if (k === "act") { const a = BURST_ACTIONS.find(y => y.id === x); if (a) try { await a.run(B, BV.sel.size ? B.shots.filter(s => BV.sel.has(s.id)) : [cur]); } catch (er) {} return BV && buDraw(); }
  }

  /* -- cleanup: unkept shot video goes 14 days after filming; burst videos no shot points at go too -- */
  async function buSweep() {
    const now = Date.now(), vids = [], ids = [];
    for (const B of buList()) {
      if (now - B.t < BU.KEEP_DAYS * 864e5) continue;
      for (const s of B.shots) if (s.v && !s.star && !s.keep && !s.sent && !buSesUses(s.v)) { vids.push(s.v); ids.push(s.id); s.v = null; s.gone = 1; }
    }
    let n = 0;
    if (vids.length) { persist(); n += await buDrop(vids, ids); }
    try { // orphans: a burst video older than an hour that no shot points at (the app closed mid-burst)
      const metas = await vtx("readonly", m => rq(m.getAll()));
      const orph = metas.filter(m => m.burst && now - m.t > 36e5).map(m => m.id);
      if (orph.length) n += await buDrop(orph, []);
    } catch (e) {}
    if (n && CO.vidsLoaded) loadVids();
  }
  setTimeout(buSweep, 5000);

  /* -- Form tab: the Shot bursts fold, with storage and Free up space -- */
  let BF = { free: false, ask: null };
  const buSizes = () => { const m = {}; for (const v of CO.vids) if (v.burst) m[v.id] = v.size || 0; return m; };
  function buBytes(B, sz) { const seen = new Set(); let n = 0; for (const s of B.shots) if (s.v && !seen.has(s.v)) { seen.add(s.v); n += sz[s.v] || 0; } return n; }
  function buSection() {
    const L = buList().slice().reverse(), sz = buSizes(), tot = Object.values(sz).reduce((a, b) => a + b, 0);
    const row = B => {
      const n = B.shots.length, st = B.shots.filter(s => s.star).length, mb = buBytes(B, sz);
      return BF.free
        ? `<div class="bu-item"><b>${esc(buDay(B.t))} · ${n} shot${n > 1 ? "s" : ""}</b><span class="muted">${mb ? fmtMB(mb) : "no video"}</span>${mb ? `<button class="btn sec small" data-buf="del:${B.id}">${BF.ask === B.id ? "Tap again" : "Delete videos"}</button>` : ""}</div>`
        : `<button class="bu-item" data-buf="open:${B.id}"><b>${esc(buDay(B.t))} · ${n} shot${n > 1 ? "s" : ""}${st ? ` · ★${st}` : ""}</b><span class="muted">${B.src === "clip" ? "From a clip" : B.view === "behind" ? "From behind" : "From the side"}${mb ? " · " + fmtMB(mb) : ""}</span></button>`;
    };
    const list = BF.free ? L.slice().sort((a, b) => buBytes(b, sz) - buBytes(a, sz)) : L.slice(0, 10);
    const body = `<p class="small" style="margin:0">Turn on <b>Keep video</b> in Live form check and each shot keeps its own few seconds of video, with its numbers. Only the shots are saved, never the time in between. A clip longer than ${BU.CLIP_MIN} s picked above is split into its shots the same way.</p>
      <p class="small muted" style="margin:6px 0 0">At a Shoot360, prop the phone behind you in the lane and pick Camera: From behind.</p>
      ${list.length ? `<div class="bu-list">${list.map(row).join("")}</div>` : ""}
      ${tot ? `<p class="small muted" style="margin:0">Shot videos use ${fmtMB(tot)}${CO.usage ? ` of the ${fmtMB(CO.usage)} the app uses on this phone` : ""}. Video for shots with no ★ or Keep is deleted 14 days after filming. The numbers stay.</p>
      <button class="btn sec small" data-buf="free" style="margin-top:6px">${BF.free ? "Done" : "Free up space"}</button>` : ""}`;
    return `<section>${fold("bursts", "Shot bursts", L.length ? `${L.length} burst${L.length > 1 ? "s" : ""}${tot ? " · " + fmtMB(tot) : ""}` : "None yet", body, false)}</section>`;
  }
  {
    const prevViewForm = viewForm;
    viewForm = function () { return prevViewForm.apply(this, arguments).replace('<section id="cliplib">', buSection() + '<section id="cliplib">'); };
  }
  document.addEventListener("click", async e => {
    const b = e.target.closest && e.target.closest("[data-buf]");
    if (!b) return;
    e.preventDefault();
    const [k, id] = b.dataset.buf.split(":");
    if (k === "open") return burstOpen(id);
    if (k === "free") { BF.free = !BF.free; BF.ask = null; return render(); }
    if (k === "del") {
      if (BF.ask !== id) { BF.ask = id; return render(); }
      BF.ask = null;
      const f = burstFind(id);
      if (!f) return;
      const vids = [], ids = [];
      for (const s of f.burst.shots) if (s.v && !buSesUses(s.v)) { vids.push(s.v); ids.push(s.id); s.v = null; s.star = false; s.keep = false; }
      persist();
      const n = await buDrop(vids, []);
      await loadVids();
      toast("Videos deleted", n ? "The shots' numbers are still there." : "Nothing to delete.");
    }
  });

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

  /* ---------- 7. Music controls: back / play-pause / skip for the music app that's playing ----------
     Shown only while another app (Spotify, YouTube Music...) has music loaded, and only after the player turns on
     notification access for Hoops Ladder (Android's rule for seeing other apps' music). The art panel picked controls
     built into the screens, never floating (reviews in the project's hoops-app/reviews/music-controls/):
     - Drill timer and rep logger: a full-width row under the top buttons. It sits inside a 10 px guard, and every
       touch that starts in the guard stays there, so a press never pauses the timer, logs a miss, a miss direction
       or closes a set. Once it has shown during a drill it keeps its space until the screen closes, so nothing jumps.
     - Tabs: a mini-player docked on the tab bar; the page gets extra bottom padding so it never covers Up Next.
     - Paused music keeps its controls (that's when you want play). They go when the music app's session ends.
     - White controls, no orange: orange is the drill's own colour. No moving parts.
     When music is playing but access is off, the tab bar slot offers the setup instead (Not now = 14 days).
     See docs/LEARNING.md, step 19. */
  const Music = Plug.HoopsMusic;
  if (Music) {
    const SNOOZE = "hoopsMusicAskAfter";
    const IC = {
      prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
      next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
      pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
      play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    };
    const css = document.createElement("style");
    css.textContent = `
      .mz-guard{position:relative;z-index:1;padding:10px;margin:0 -10px -10px;touch-action:none}
      .mz-guard.gone{visibility:hidden}
      .mz-dock{display:flex;align-items:center;gap:6px;height:60px;padding:0 6px 0 16px;border-radius:30px;background:#1E2A47;
        box-shadow:inset 0 0 0 1px rgba(233,238,247,.14);color:#E9EEF7}
      .mz-txt{flex:1;min-width:0}
      .mz-t{font:700 15px/1.15 var(--display,'Saira Condensed'),sans-serif;letter-spacing:.02em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .mz-s{font:500 12px/1.3 var(--body,Barlow),sans-serif;color:#9AA6BF;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .mz-b{flex:none;width:52px;height:52px;border-radius:26px;border:0;padding:0;display:grid;place-items:center;background:transparent;color:#E9EEF7}
      .mz-b.sm{width:44px;height:44px}
      .mz-b svg{width:22px;height:22px;fill:currentColor}
      .mz-b.pp{width:48px;height:48px;background:#E9EEF7;color:#12203A;margin:0 2px}
      .mz-b:active{transform:scale(.92);background:rgba(233,238,247,.16)}
      .mz-b.pp:active{background:#C9D2E3}
      .mz-mini{position:fixed;left:8px;right:8px;z-index:6;display:none}
      .mz-mini .mz-dock{border-radius:16px;background:#12203A;box-shadow:0 6px 18px rgba(0,0,0,.28),inset 0 0 0 1px rgba(233,238,247,.14)}
      body.mz-on .mz-mini{display:block}
      body.mz-on main{padding-bottom:184px}
      .mz-ask{font:600 14px/1.25 var(--body,Barlow),sans-serif;flex:1;min-width:0}
      .mz-ask small{display:block;font-weight:500;font-size:12px;color:#9AA6BF}
      .mz-go{flex:none;height:40px;padding:0 16px;border-radius:20px;border:0;background:#E9EEF7;color:#12203A;font:700 14px var(--body,Barlow),sans-serif}
    `;
    document.head.appendChild(css);

    let cur = { on: false }, access = false, asking = false, gone = null, lastSkip = 0;
    const guard = document.createElement("div");
    guard.className = "mz-guard"; guard.setAttribute("data-music", "");
    const mini = document.createElement("div");
    mini.className = "mz-mini"; mini.setAttribute("data-music", "");
    document.body.appendChild(mini);

    // Every touch that starts on the music controls ends there: the timer and logger never see it.
    for (const el of [guard, mini])
      for (const t of ["pointerdown", "pointermove", "pointerup", "pointercancel", "click", "contextmenu", "touchstart", "touchend"])
        el.addEventListener(t, e => {
          e.stopPropagation();
          if (t === "contextmenu") e.preventDefault();
          if (t !== "click") return;
          const b = e.target.closest("button");
          if (b) press(b.dataset.mz);
        });

    function press(k) {
      try { navigator.vibrate?.(15); } catch (e) {}
      if (k === "ask") { Music.openAccess().catch(() => {}); return; }
      if (k === "later") {
        try { localStorage.setItem(SNOOZE, String(Date.now() + 14 * 864e5)); } catch (e) {}
        asking = false; paint(); return;
      }
      if (k === "next" || k === "prev") {
        if (Date.now() - lastSkip < 600) return; // a double tap is one skip
        lastSkip = Date.now();
      }
      if (k === "pp") { k = cur.playing ? "pause" : "play"; cur.playing = !cur.playing; paint(); }
      Music.control({ action: k }).catch(() => {});
    }

    function dock() {
      const sub = cur.playing ? [cur.artist, cur.app].filter(Boolean).join(" · ") : `Paused${cur.app ? " · " + cur.app : ""}`;
      return `<div class="mz-dock" role="group" aria-label="Music controls">
        <div class="mz-txt"><div class="mz-t">${esc(cur.title || cur.app || "Music")}</div><div class="mz-s">${esc(sub)}</div></div>
        <button class="mz-b sm" data-mz="prev" aria-label="Previous song">${IC.prev}</button>
        <button class="mz-b pp" data-mz="pp" aria-label="${cur.playing ? "Pause music" : "Play music"}">${cur.playing ? IC.pause : IC.play}</button>
        <button class="mz-b" data-mz="next" aria-label="Next song">${IC.next}</button></div>`;
    }
    function askDock() {
      return `<div class="mz-dock" role="group" aria-label="Music controls setup">
        <div class="mz-ask">Control your music from here<small>Turn on notification access for Hoops Ladder</small></div>
        <button class="mz-go" data-mz="ask">Set up</button>
        <button class="mz-b sm" data-mz="later" aria-label="Not now"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z"/></svg></button></div>`;
    }

    // Puts the row under a drill screen's top buttons. Called after every redraw of the timer and logger.
    function place(host) {
      if (!host) return;
      const top = host.querySelector(":scope > .bt-top");
      if (!top) { if (guard.parentNode === host) guard.remove(); return; }
      if (cur.on && access) host._mz = true;
      if (!host._mz) { if (guard.parentNode) guard.remove(); return; }
      guard.classList.toggle("gone", !(cur.on && access));
      if (top.nextSibling !== guard) top.after(guard);
    }

    function paint() {
      const show = cur.on && access;
      if (show) { guard.innerHTML = dock(); mini.innerHTML = dock(); }
      else if (asking) mini.innerHTML = askDock();
      const tabs = document.querySelector(".tabs");
      mini.style.bottom = ((tabs ? tabs.offsetHeight : 64) + 8) + "px";
      document.body.classList.toggle("mz-on", show || asking);
      place(typeof pEl !== "undefined" ? pEl : null);
      place(typeof bigEl !== "undefined" ? bigEl : null);
    }

    Music.addListener("music", e => {
      access = !!e.access;
      if (access) asking = false;
      const next = { on: !!e.on, playing: !!e.playing, title: e.title || "", artist: e.artist || "", app: e.app || "" };
      clearTimeout(gone);
      if (!next.on && cur.on) { gone = setTimeout(() => { cur = next; paint(); }, 2000); return; } // a 2 s grace between apps
      cur = next; paint();
    });

    // Without access, offer the setup on the tabs when something is actually playing.
    function check() {
      if (document.hidden) return;
      Music.state().then(s => {
        access = !!s.access;
        if (access) { Music.watch().catch(() => {}); return; }
        let after = 0;
        try { after = +localStorage.getItem(SNOOZE) || 0; } catch (e) {}
        const want = !!s.playingSomewhere && Date.now() > after;
        if (want !== asking) { asking = want; paint(); }
      }).catch(() => {});
    }
    Music.watch().catch(() => {});
    check();
    setInterval(() => { if (!access) check(); }, 5000);
    document.addEventListener("visibilitychange", check);

    const origDrawPlayer = drawPlayer, origDrawBig = drawBig;
    drawPlayer = function () { origDrawPlayer.apply(this, arguments); if (typeof pEl !== "undefined" && pEl) place(pEl); };
    drawBig = function () { origDrawBig.apply(this, arguments); if (typeof bigEl !== "undefined" && bigEl) place(bigEl); };
  }

  /* ---------- 9. Share › Hoops Ladder: links and videos come back to the page ----------
     On the Coach tab, "Find it on YouTube" opens the YouTube app. The player picks a video and shares it to Hoops
     Ladder; the native HoopsShare plugin (android/.../share/) hands the link and the video's title to the page's
     coShared(), which adds it to the drill being added or edited. A share that started the app waits in take().
     During a coach session the share sheet also shows "Session · <coach>" (a sharing shortcut the page turns on and
     off through hoopsSesShare). A share through it arrives with target "session" and goes to sesShared(), never
     to a take-home drill. Shared videos arrive as a file the plugin copied into the app's cache. They're read back
     here as a Blob and always go to sesShared(), which asks Coach or Me and puts them in the session or, with none
     running, sends them where the owner chose (asked the first time: My videos, or a new coach session).
     It sits before section 8 because that one stops early on a phone without the HoopsRemote plugin.
     See docs/LEARNING.md, steps 20 and 27. */
  {
    const Share = Plug.HoopsShare;
    if (Share) {
      const toBlob = async s => {
        if (!s.file) return null;
        try { const r = await fetch(window.Capacitor.convertFileSrc(s.file)); return r.ok ? await r.blob() : null; } catch (e) { return null; }
      };
      const got = async s => {
        if (!s) return;
        const video = !!(s.file || s.error === "video");
        if ((s.target === "session" || video) && typeof window.sesShared === "function") {
          const blob = await toBlob(s);
          let took = false;
          try { took = !!window.sesShared({ text: s.text || "", subject: s.subject || "", blob, mime: s.mime || (blob && blob.type) || "", name: s.name || "", target: s.target || "", failed: s.error === "video" && !blob }); } catch (e) {}
          if (took || video) return;
        }
        if (s.text) { try { coShared(s.text, s.subject || ""); } catch (e) {} }
      };
      Share.addListener("shared", got);
      Share.take().then(r => got(r && r.share)).catch(() => {});
      /* the page turns the session's share target on when a coach session starts, and off when it ends */
      window.hoopsSesShare = (on, name) => {
        try { return (on ? Share.sessionStart({ name: name || "" }) : Share.sessionEnd()).catch(() => {}); } catch (e) {}
      };
    }
  }

  /* ---------- 8. Hands-free logging: volume buttons, earbuds and lock-screen buttons ----------
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
      .replace("Earbuds: click = miss, double-click = make, triple-click = undo",
               "Volume buttons or earbuds: press = miss, double-press = make, triple-press = undo, even with the screen locked");
    if (on) Remote.update(info()).catch(() => {});
  };
})();
