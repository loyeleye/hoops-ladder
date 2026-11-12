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
      // The setup check before recording (step 31) sits over every camera screen: back cancels a countdown, then closes it.
      if (window.scBack && window.scBack()) return true;
      if (window.sesBack && window.sesBack()) return true;
      // Shot bursts (step 29): the viewer steps out of compare or a selection, then closes; reading a clip cancels;
      // the live form check does what Done does (saves and opens the shots it kept).
      if (window.burstBack && window.burstBack()) return true;
      if (window.liveBack && window.liveBack()) return true;
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

    // The setup check before recording (step 31) listens for "go" the same way, then gives the mic back.
    let lsCb = null, lsResume = null;
    hooks.listen = (words, cb) => {
      if (!lsResume) lsResume = hooks.voicePause();
      vStop();
      lsCb = cb; who = "ls"; fired = false;
      const p = Voice.start({ words }).then(() => true, e => { if (who === "ls") who = null; lsCb = null; throw e; });
      return { p, stop() { lsCb = null; if (who === "ls") vStop(); const r = lsResume; lsResume = null; if (r) r(); } };
    };
    Voice.addListener("heard", e => { if (e && who === "ls" && lsCb && !talking()) try { lsCb(e.text || "", e.alts || [], !!e.final) } catch (x) {} });
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
    const filmTip = () => behind() ? (S.settings.fcFront ? "Film from straight in front of you, whole body in frame." : "Film from behind you, on the line to the rim, whole body in frame.") : "Film from the side, shooting arm toward the phone, whole body in frame.";
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
.livefc .lf-place{position:absolute;left:12px;right:12px;bottom:12px;max-height:72%;overflow-y:auto;overscroll-behavior:contain;background:rgba(5,8,15,.88);border-radius:14px;padding:12px 14px;font-size:14px;z-index:3}
.livefc .lf-place [data-lf="ready"]{position:sticky;bottom:0;box-shadow:0 -8px 14px rgba(5,8,15,.9)}
.livefc .lf-court{display:block;width:auto;max-width:100%;max-height:150px;margin:8px auto 0}.livefc .lf-side{max-height:70px}
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
    // The phone's spot on a half court (the film study court, 10 px a foot, basket at the top), with you at the top of
    // the key facing the rim, and the camera's view as the film study's glowing cone.
    function placeSvg(kind) {
      const you = [250, 250], hand = S.settings.hand === "L" ? -1 : 1;
      const low = S.settings.lfLow, d = low ? 175 : 140; // on the floor: farther back, so your hands at the release stay in
      const cam = kind === "front" ? [250, 84] : kind === "side" ? [250 + hand * d, 250] : [250, Math.min(395, 250 + d)];
      const a = Math.atan2(you[1] - cam[1], you[0] - cam[0]), h = .42, Rr = Math.hypot(you[0] - cam[0], you[1] - cam[1]) + 70;
      const x1 = cam[0] + Math.cos(a - h) * Rr, y1 = cam[1] + Math.sin(a - h) * Rr, x2 = cam[0] + Math.cos(a + h) * Rr, y2 = cam[1] + Math.sin(a + h) * Rr;
      const deg = a * 180 / Math.PI + 90; // you face the rim (up): the wedge on your circle points that way
      return `<svg class="fsc in lf-court" viewBox="0 0 500 400" role="img" aria-label="Half court: you at the top of the key facing the rim, the phone ${kind === "front" ? "under the basket facing you" : kind === "side" ? "level with you on your shooting-hand side" : "behind you, on the line to the rim"}, and what it sees.">
        <defs><radialGradient id="lfcam" gradientUnits="userSpaceOnUse" cx="${cam[0]}" cy="${cam[1]}" r="${Rr}"><stop offset="0" style="stop-color:var(--read);stop-opacity:1"/><stop offset=".75" style="stop-color:var(--read);stop-opacity:.5"/><stop offset="1" style="stop-color:var(--read);stop-opacity:0"/></radialGradient></defs>
        <rect class="paint" x="170" y="0" width="160" height="190"/><path class="ln" d="M190 190 A60 60 0 0 0 310 190"/><path class="ln" d="M30 0 L30 141.5 A237.5 237.5 0 0 0 470 141.5 L470 0"/>
        <path class="ln" d="M210 52 A40 40 0 0 0 290 52"/><line class="ln" x1="220" y1="40" x2="280" y2="40" style="stroke-width:4"/><circle class="ln" cx="250" cy="52" r="7.5"/><rect class="ln" x="1.5" y="1.5" width="497" height="397" rx="2"/>
        <g class="glow" style="animation:none;opacity:.55"><path d="M${cam[0]} ${cam[1]} L${x1} ${y1} A${Rr} ${Rr} 0 0 1 ${x2} ${y2} Z" fill="url(#lfcam)"/></g>
        <path d="M${cam[0]} ${cam[1]} L${x1} ${y1} M${cam[0]} ${cam[1]} L${x2} ${y2}" style="stroke:var(--read);stroke-width:2;stroke-dasharray:5 4;opacity:.8" fill="none"/>
        <circle cx="${you[0]}" cy="${you[1]}" r="19" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-dasharray="4 3"/>
        <path d="M${you[0] - 9} ${you[1] - 8} L${you[0]} ${you[1] - 27} L${you[0] + 9} ${you[1] - 8} Z" style="fill:var(--accent);stroke:var(--surface);stroke-width:2;stroke-linejoin:round"/><circle class="off" cx="${you[0]}" cy="${you[1]}" r="12"/>
        <g transform="translate(${cam[0]} ${cam[1]}) rotate(${deg})"><rect x="-9" y="-14" width="18" height="28" rx="4" style="fill:var(--ink);stroke:var(--surface);stroke-width:2"/><circle cx="0" cy="-8" r="3" style="fill:var(--read)"/></g>
        <rect class="tagbg" x="${Math.max(6, Math.min(424, cam[0] - 35))}" y="${kind === "front" ? cam[1] + 20 : kind === "side" ? cam[1] + 22 : cam[1] - 52}" width="70" height="22" rx="11"/><text class="tagtx" x="${Math.max(6, Math.min(424, cam[0] - 35)) + 35}" y="${(kind === "front" ? cam[1] + 20 : kind === "side" ? cam[1] + 22 : cam[1] - 52) + 15.5}" text-anchor="middle">PHONE</text>
        <rect class="tagbg o" x="${you[0] - 22}" y="${you[1] + 24}" width="44" height="22" rx="11"/><text class="tagtx o" x="${you[0]}" y="${you[1] + 39.5}" text-anchor="middle">YOU</text></svg>`;
    }
    // Side view: how high the phone sits and what it sees of you, raised (tripod, chair, ledge) or on the floor.
    function heightSvg() {
      const low = !!S.settings.lfLow, gy = 118, px = 330, ft = 12.5, cam = [low ? 92 : 122, low ? gy - 6 : gy - 3.2 * ft];
      const mid = [px, gy - 3.4 * ft], a = Math.atan2(mid[1] - cam[1], mid[0] - cam[0]), h = .5, Rr = Math.hypot(mid[0] - cam[0], mid[1] - cam[1]) + 60;
      const x1 = cam[0] + Math.cos(a - h) * Rr, y1 = cam[1] + Math.sin(a - h) * Rr, x2 = cam[0] + Math.cos(a + h) * Rr, y2 = cam[1] + Math.sin(a + h) * Rr;
      const head = gy - 5.6 * ft, hip = gy - 3 * ft, sh = gy - 4.6 * ft, deg = a * 180 / Math.PI;
      const stand = low ? "" : `<path d="M${cam[0]} ${cam[1] + 8} L${cam[0] - 12} ${gy} M${cam[0]} ${cam[1] + 8} L${cam[0] + 12} ${gy} M${cam[0]} ${cam[1] + 8} L${cam[0]} ${gy}" style="stroke:var(--wood-line);stroke-width:3;stroke-linecap:round" fill="none"/>`;
      return `<svg class="fsc in lf-court lf-side" viewBox="0 0 500 140" role="img" aria-label="Side view: the phone ${low ? "on the floor, tilted up" : "raised to about waist height and level"}, aimed at your middle, with your whole body and your hands at the release inside its view.">
        <defs><radialGradient id="lfcam2" gradientUnits="userSpaceOnUse" cx="${cam[0]}" cy="${cam[1]}" r="${Rr}"><stop offset="0" style="stop-color:var(--read);stop-opacity:1"/><stop offset=".75" style="stop-color:var(--read);stop-opacity:.5"/><stop offset="1" style="stop-color:var(--read);stop-opacity:0"/></radialGradient>
        <clipPath id="lfcl"><rect x="0" y="0" width="500" height="${gy}"/></clipPath></defs>
        <rect x="1.5" y="1.5" width="497" height="137" rx="2" class="ln"/><line class="ln" x1="0" y1="${gy}" x2="500" y2="${gy}"/>
        <g clip-path="url(#lfcl)"><path d="M${cam[0]} ${cam[1]} L${x1} ${y1} A${Rr} ${Rr} 0 0 1 ${x2} ${y2} Z" fill="url(#lfcam2)" opacity=".55"/>
        <path d="M${cam[0]} ${cam[1]} L${x1} ${y1} M${cam[0]} ${cam[1]} L${x2} ${y2}" style="stroke:var(--read);stroke-width:2;stroke-dasharray:5 4;opacity:.8" fill="none"/></g>
        ${stand}
        <g style="stroke:var(--accent);stroke-width:5;stroke-linecap:round;fill:none"><path d="M${px} ${sh} L${px} ${hip} M${px} ${hip} L${px - 7} ${gy - 1.6 * ft} L${px - 3} ${gy - 2} M${px} ${hip} L${px + 7} ${gy - 1.6 * ft} L${px + 4} ${gy - 2} M${px} ${sh + 3} L${px + 9} ${head - 2} L${px + 7} ${head - 22}"/></g>
        <circle cx="${px}" cy="${head + 6}" r="8" style="fill:var(--accent)"/><circle class="ball" cx="${px + 7}" cy="${head - 30}" r="7"/>
        <g transform="translate(${cam[0]} ${cam[1]}) rotate(${deg})"><rect x="-4" y="-11" width="8" height="22" rx="2" style="fill:var(--ink);stroke:var(--surface);stroke-width:1.5"/></g>
        <text class="edge" x="${(cam[0] + px) / 2}" y="${gy + 15}" text-anchor="middle">${low ? "15 TO 20 FT" : "10 TO 15 FT"}</text>
        <text class="edge" x="${cam[0]}" y="${low ? gy - 20 : cam[1] - 16}" text-anchor="middle">${low ? "TILT UP" : "WAIST HIGH"}</text></svg>`;
    }
    function drawPlace() {
      const box = L && L.el.querySelector(".lf-place");
      if (!box) return;
      if (L.ready) { box.hidden = true; box.innerHTML = ""; return; }
      // In front (under a Shoot360 machine) uses the behind checks: they're measured from your own shoulders, so a
      // straight-on view from the front reads the same, mirrored. An angled view doesn't, so the tips say straight on.
      const B = behind(), F = B && !!S.settings.fcFront;
      box.hidden = false;
      box.innerHTML = `<b>Place the phone</b>
        <div class="lf-seg"><button data-lf="view" data-v="behind" aria-pressed="${B && !F}">Behind</button><button data-lf="view" data-v="front" aria-pressed="${F}">In front</button><button data-lf="view" data-v="side" aria-pressed="${!B}">Side</button></div>
        ${placeSvg(F ? "front" : B ? "behind" : "side")}
        <div class="lf-seg"><button data-lf="height" data-v="up" aria-pressed="${!S.settings.lfLow}">Raised</button><button data-lf="height" data-v="low" aria-pressed="${!!S.settings.lfLow}">On the floor</button></div>
        ${heightSvg()}
        <ul>${S.settings.lfLow
          ? "<li>On the floor, lean it back a little so it looks up at you, and move it farther away, 15 to 20 ft, so your hands at the release stay in the picture. Keep it clear of rolling balls.</li>"
          : "<li>Raised on a tripod, chair or ledge, about waist height, held level (not tilted).</li>"}${F
          ? "<li>Straight in front of you, facing you, on the line from the rim to where you shoot, for example under the basket. Not off to an angle: that throws off the elbow and ball-line numbers.</li><li>That shows left and right, like from behind: your elbow, the ball's line, your guide hand. Keep it out of the way of passes and rebounds.</li>"
          : B
          ? "<li>Behind you, on the straight line from you to the rim. That shows left and right: your elbow, the ball's line, your guide hand.</li><li>On the line, 10 to 15 ft back (farther on the floor). At a Shoot360, prop it at the back of your lane, out of the way of the machine's passes and the net.</li>"
          : "<li>Level with where you shoot, off to your shooting-hand side, so your shooting arm faces the phone. That shows balance, timing, set point and arc.</li><li>10 to 15 ft away (farther on the floor), out of the way of the ball and the rebound.</li>"}
        <li>Your whole body in the picture, feet included, with room above your hands at the release. Then tap Check my spot: it tells you where to stand, turns green when you're set, and starts on "go" or a tap after a short countdown.</li></ul>
        <button class="btn pri" data-lf="ready" style="width:100%">Check my spot</button>`;
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
        else if (b.dataset.lf === "height") { S.settings.lfLow = b.dataset.v === "low"; persist(); if (K && !K.burst.shots.length) K.burst.low = !!S.settings.lfLow; drawPlace(); }
        else if (b.dataset.lf === "ready") liveCheck();
        else if (b.dataset.lf === "view") { const v = b.dataset.v; S.settings.fcView = v === "front" ? "behind" : v; S.settings.fcFront = v === "front"; persist(); L.buf = []; L.up = 0;
          if (K && !K.burst.shots.length) { K.burst.view = fcView(); K.burst.front = !!S.settings.fcFront && fcView() === "behind"; }
          if (!L.shots.length) L.el.querySelector(".lf-shot").innerHTML = `<span>${filmTip()} Shoot when you're ready.</span>`; drawPlace(); }
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
      L.raw = raw || null; // the setup check reads these (4c)
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
        if (t - L.noBody > 1.5) msg("Step back until your whole body, feet included, is in frame. " + (B ? (S.settings.fcFront ? "Film from straight in front." : "Film from behind, on the line to the rim.") : "Film from the side."));
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

    /* ---------- 4c. Setup check: where to stand, a green light, then "go" and a countdown ----------
       Before a recording starts (live form check, Film this rep, the move clip recorder, a training video), a
       full-screen check runs the same pose model on the camera picture and tells you, on screen and out loud, where
       to move: farther from the phone, closer, or to the middle. Shooting leaves room above your hands for the
       release. Once you've been in a good spot for most of a second the picture's edge flashes green, the phone
       chimes and buzzes, and it says you're set. Then say "go" (with voice on) or tap Go, and recording starts after
       a 3, 5 or 10 s countdown. "Start anyway" skips the check, for when the tracker can't see you well. The live
       form check passes its own pose landmarks in, so the model never runs twice on a frame. See docs/LEARNING.md,
       step 31. */
    let SC = null; // the open setup check
    const scStyle = document.createElement("style");
    scStyle.textContent = `
.scx{position:fixed;inset:0;z-index:120;background:#05080F;color:#F2F5FA;display:flex;flex-direction:column;
  padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)}
.scx .sc-top{display:flex;align-items:center;gap:8px;padding:10px 16px}
.scx .sc-title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--display);font-weight:700;font-size:18px;text-transform:uppercase;letter-spacing:.03em}
.scx .sc-title span{opacity:.7}
.scx .btn.sec{background:#1C2844;border-color:#2A3858;color:#F2F5FA}
.scx .sc-stage{position:relative;flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:8px}
.scx .sc-frame{position:relative;border-radius:12px;overflow:hidden}
.scx .sc-frame::after{content:"";position:absolute;inset:0;border-radius:12px;border:6px solid #2A3858;pointer-events:none;transition:background .2s,border-color .2s}
.scx .sc-frame video,.scx .sc-frame canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:fill}
.scx .sc-frame.mir video,.scx .sc-frame.mir canvas{transform:scaleX(-1)}
.scx.fix .sc-frame::after{border:12px solid #FFC23D;background:rgba(255,194,61,.16)}
.scx.hold .sc-frame::after{border:12px solid rgba(43,209,126,.55);background:rgba(43,209,126,.1)}
.scx.ok .sc-frame::after{border:16px solid #2BD17E;background:rgba(43,209,126,.24);animation:scflash .35s steps(1,end) 3}
@keyframes scflash{0%{opacity:1}50%{opacity:.25}100%{opacity:1}}
.scx .sc-hold{position:absolute;left:0;bottom:0;height:12px;width:0;background:#2BD17E;z-index:1}
.scx .sc-msg{position:absolute;left:16px;right:16px;top:16px;text-align:center;background:rgba(5,8,15,.8);border-radius:14px;padding:10px 12px;transition:background .25s}
.scx .sc-msg b{display:block;font-family:var(--display);font-weight:800;font-size:clamp(38px,11vw,52px);line-height:1;text-transform:uppercase;letter-spacing:.02em}
.scx .sc-msg span{display:block;font-size:16px;font-weight:600;margin-top:4px}.scx .sc-msg span:empty{display:none}
.scx.fix .sc-msg b{color:#FFC23D}
.scx.ok .sc-msg{background:#1E8657}
.scx.count .sc-frame::after{animation:none}
.scx .sc-big{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;font-family:var(--display);font-weight:800;font-size:min(62vw,270px);line-height:1;color:#2BD17E;-webkit-text-stroke:6px #05080F;paint-order:stroke fill;text-shadow:0 0 50px rgba(5,8,15,.8)}
.scx .sc-big.pop{animation:scpop .3s ease-out}
@keyframes scpop{0%{transform:scale(1.5);opacity:.4}100%{transform:scale(1);opacity:1}}
.scx .sc-big:empty{display:none}
.scx .sc-low{padding:10px 16px 16px;display:flex;flex-direction:column;gap:10px}
.scx .sc-row{display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap}
.scx .sc-seg{display:flex;gap:4px}.scx .sc-seg button,.scx .sc-chip{min-height:44px;min-width:52px;border-radius:999px;border:1px solid #2A3858;background:#1C2844;color:#F2F5FA;padding:8px 14px;font:inherit;font-size:15px;font-weight:600}
.scx .sc-seg button[aria-pressed="true"],.scx .sc-chip[aria-pressed="true"]{background:#F2F5FA;color:#05080F}
.scx .sc-go{width:100%;font-size:20px;padding:14px}
.scx.ok:not(.count) .sc-go{background:#2BD17E;border-color:#2BD17E;color:#05080F}
.scx .sc-go.wait{opacity:.45}
.scx .sc-go.stop{background:transparent;border:2px solid #FF5A46;color:#FF8A7A}
.scx .sc-note{text-align:center;font-size:13.5px;opacity:.8;margin:0}
.scx .linkbtn{color:#F2F5FA;align-self:center}`;
    document.head.appendChild(scStyle);

    // Where you are in the picture, from the pose landmarks (0 to 1 across and down). "shot" also wants room above
    // your head for your hands at the release; "body" only wants all of you in, head to feet.
    function scJudge(lm, kind, loose, view, ar) {
      if (!lm || lm.length < 33) return { k: "none" };
      const V = i => (lm[i].visibility ?? 1) > .5 && lm[i].x > -.05 && lm[i].x < 1.05;
      const sh = [11, 12].filter(V), hp = [23, 24].filter(V);
      if (!sh.length || !hp.length) return { k: "none" };
      const avg = (ids, f) => ids.reduce((s, i) => s + lm[i][f], 0) / ids.length;
      const shY = avg(sh, "y"), hipY = avg(hp, "y"), hipX = avg(hp, "x");
      const torso = Math.max(.03, hipY - shY);
      // Top of the head: about 0.6 of a torso above the shoulders (the nose is hidden from behind).
      let top = shY - .62 * torso;
      if (V(0)) top = Math.min(top, lm[0].y - .3 * torso);
      const ft = [27, 28, 29, 30, 31, 32].filter(V); // ankles, heels, toes
      const feet = ft.length ? Math.max(...ft.map(i => lm[i].y)) : null;
      const bottom = feet != null ? feet : hipY + 1.6 * torso, H = bottom - top;
      const xs = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].filter(V).map(i => lm[i].x);
      const box = { x0: Math.min(...xs) - .04, x1: Math.max(...xs) + .04, top, bottom, H, hipX };
      // Once you're set the edges loosen, so a jittery landmark at 20 ft doesn't flick you back to amber.
      const e = loose ? .02 : 0;
      if (feet == null || feet > .955 + e * 1.5) return { k: "feet", box };
      if (top < .015 - e) return { k: "head", box };
      // A jump shot's release: standing reach plus the jump and the ball, about half a body height above your head.
      if (kind === "shot" && top - (.5 - e * 2) * H < 0) return { k: "room", box };
      if (H < (kind === "shot" ? .2 : .22) - e) return { k: "far", box };
      if (hipX < .22 - e * 3 || hipX > .78 + e * 3) return { k: "mid", box, dir: hipX < .5 ? 1 : -1 };
      // Side view: shoulders square to the phone throw off the elbow and follow-through numbers.
      if (view === "side" && sh.length === 2 && Math.abs(lm[11].x - lm[12].x) * ar > (.38 + e * 5) * torso) return { k: "turn", box };
      return { k: "ok", box };
    }
    // [on screen, under it, said out loud]
    const SC_MSG = {
      none: ["Step into the picture", "Stand where the phone can see all of you.", "Step into the picture."],
      feet: ["Farther from the phone", "Your feet are cut off.", "Move farther from the phone. Your feet are cut off."],
      head: ["Farther from the phone", "Your head is cut off.", "Move farther from the phone. Your head is cut off."],
      room: ["Farther from the phone", "Leave room above your hands for the release.", "Move a little farther from the phone, so your hands stay in at the release."],
      far: ["Closer to the phone", "You're small in the picture, so the tracking gets shaky.", "Come a few steps closer to the phone."],
      turn: ["Turn sideways", "Shooting arm toward the phone.", "Turn sideways, with your shooting arm toward the phone."],
      mid: ["Slide to the middle", "Follow the arrow to the middle of the picture.", "Slide over to the middle of the picture."],
      hold: ["Hold there", "", ""],
      nopose: ["Get in the picture", "The body tracker didn't load on this phone, so check the picture yourself.", ""]
    };
    // Countdown: your pick, else 5 s with voice (you're already on your spot) or 10 s to walk back after a tap.
    const scCd = o => { const v = +S.settings[o.cdKey] || (scVoiceOn() ? 5 : 10); return o.cdOpts.includes(v) ? v : o.cdOpts[o.cdOpts.length - 1]; };
    const scVoiceOn = () => !!hooks.listen && S.settings.scVoice !== false;

    // o: { stream, mirror, kind: "shot" | "body", view?, title, getLm?, cdKey?, cdOpts?, now?, onGo, onClose? }
    function setupCheck(o) {
      scClose();
      o = Object.assign({ kind: "body", cdKey: "scCd", cdOpts: [3, 5, 10] }, o);
      const el = document.createElement("div");
      el.className = "scx";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-label", "Get set");
      el.innerHTML = `<div class="sc-top"><div class="sc-title">Get set <span>· ${esc(o.title || "")}</span></div><button class="btn sec small" data-sc="close">Back</button></div>
        <div class="sc-stage"><div class="sc-frame${o.mirror ? " mir" : ""}"><video playsinline muted autoplay></video><canvas></canvas><div class="sc-hold"></div></div>
          <div class="sc-msg" role="status" aria-live="polite"><b></b><span></span></div><div class="sc-big num" aria-live="assertive"></div></div>
        <div class="sc-low"></div>`;
      document.body.appendChild(el);
      const s = SC = { o, el, video: el.querySelector("video"), cv: el.querySelector("canvas"), frame: el.querySelector(".sc-frame"),
        state: "check", ready: false, okAt: 0, badAt: 0, setAt: 0, tapped: false, j: { k: "none" }, key: "", keyAt: 0, saidAt: 0, saidKey: "", lastT: 0, raf: 0,
        pl: null, noPose: false, n: 0, timer: 0, ls: null, voice: false };
      s.video.setAttribute("playsinline", "");
      s.video.srcObject = o.stream;
      s.video.play().catch(() => {});
      el.addEventListener("click", e => {
        const b = e.target.closest("[data-sc]");
        if (!b || SC !== s) return;
        const a = b.dataset.sc;
        if (a === "close") { scClose(); if (o.onClose) o.onClose(); }
        else if (a === "go") { if (s.ready || s.noPose) { s.tapped = true; scCount(s); } }
        else if (a === "anyway") { s.tapped = true; scCount(s); }
        else if (a === "now") scDone(s, true);
        else if (a === "cancel") scStop(s);
        else if (a.startsWith("cd:")) { S.settings[o.cdKey] = +a.slice(3); persist(); scLow(s); }
        else if (a === "voice") { S.settings.scVoice = !scVoiceOn(); persist(); scListen(s); scLow(s); }
      });
      if (!o.getLm) loadLivePose().then(pl => { if (SC === s) s.pl = pl; }).catch(() => { if (SC === s) { s.noPose = true; scLow(s); } });
      scListen(s);
      scLow(s);
      s.raf = requestAnimationFrame(() => scTick(s));
      return s;
    }

    // "go" while you're set (or "go anyway" any time) starts the countdown; "stop" or "wait" during it cancels.
    function scListen(s) {
      if (s.ls) { s.ls.stop(); s.ls = null; }
      s.voice = false;
      if (!scVoiceOn() || SC !== s || s.state === "done") return;
      const ls = s.ls = hooks.listen(["go", "go anyway", "start anyway", "ready", "start", "stop", "wait", "cancel"], (text, alts, fin) => {
        if (SC !== s || s.ls !== ls) return;
        for (const x of [text].concat(alts || [])) {
          const t = " " + String(x || "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ") + " ";
          if (s.state === "count" && / (stop|wait|cancel|hold on) /.test(t)) { scStop(s); return; }
          if (s.state !== "check") return;
          if (!fin) return; // whole phrases only, so a stray syllable (or the phone's own voice) doesn't start it
          if (/ (go anyway|start anyway) /.test(t) || ((s.ready || s.noPose) && / (go|let s go|start|ready|record) /.test(t))) { scCount(s); return; }
          if (fin && / go /.test(t) && Date.now() - s.saidAt > 2500) { s.saidAt = Date.now(); say("Not set yet. " + SC_MSG[s.j.k === "ok" ? "hold" : s.j.k][2] + ' Or say "go anyway".'); return; }
        }
      });
      ls.p.then(() => { if (SC === s && s.ls === ls) { s.voice = true; scLow(s); } }, () => { if (s.ls === ls) s.ls = null; if (SC === s) scLow(s); });
    }

    function scLow(s) {
      const o = s.o, low = s.el.querySelector(".sc-low"), cd = scCd(o);
      if (s.state === "count") {
        low.innerHTML = `<p class="sc-note">${s.tapped ? "Walk back to your spot. " : ""}Recording starts at zero.${s.voice ? ' Say "stop" to cancel.' : ""}</p><button class="btn sec sc-go stop" data-sc="cancel">Cancel</button>`;
        return;
      }
      const set = s.ready || s.noPose;
      low.innerHTML = `<div class="sc-row"><span class="small">Countdown</span><div class="sc-seg" role="group" aria-label="Countdown before recording">${o.cdOpts.map(v => `<button data-sc="cd:${v}" aria-pressed="${v === cd}">${v} s</button>`).join("")}</div>
          ${hooks.listen ? `<button class="sc-chip" data-sc="voice" aria-pressed="${scVoiceOn()}">${scVoiceOn() ? (s.voice ? "Voice on" : "Voice…") : "Voice off"}</button>` : ""}</div>
        <button class="btn ${set ? "pri" : "sec wait"} sc-go" data-sc="go" ${set ? "" : 'aria-disabled="true"'}>Go</button>
        <p class="sc-note">${set ? (s.voice ? `Say "go" or tap Go. Recording starts after ${cd} s.` : `Tap Go, then walk back. Recording starts after ${cd} s.`) : s.voice ? 'When the picture turns green, say "go".' : "When the picture turns green, tap Go."}</p>
        <div class="sc-row"><button class="linkbtn small" data-sc="anyway" ${set ? 'style="visibility:hidden" tabindex="-1"' : ""}>Start anyway</button>${o.now ? `<button class="linkbtn small" data-sc="now">Someone's filming me: record now</button>` : ""}</div>`;
    }

    function scSetReady(s, on) {
      s.ready = on;
      s.el.classList.toggle("ok", on);
      if (on) {
        beep(880, 110); setTimeout(() => beep(1320, 170), 130);
        try { navigator.vibrate?.([70, 60, 70]); } catch (e) {}
        s.setAt = performance.now();
        say(s.voice ? "You're set. Say go when ready." : "You're set. Tap go, then walk back.");
      }
      scLow(s);
    }

    function scTick(s) {
      if (SC !== s) return;
      s.raf = requestAnimationFrame(() => scTick(s));
      const v = s.video, now = performance.now();
      if (!v.videoWidth || now - s.lastT < (s.ready ? 200 : 90)) return; // slower once set: a cooler phone, steadier beeps
      s.lastT = now;
      // Fit the picture in the stage; the canvas sits exactly on it.
      const st = s.el.querySelector(".sc-stage"), k = Math.min((st.clientWidth - 16) / v.videoWidth, (st.clientHeight - 16) / v.videoHeight);
      const w = Math.round(v.videoWidth * k), h = Math.round(v.videoHeight * k);
      if (s.frame.style.width !== w + "px") { s.frame.style.width = w + "px"; s.frame.style.height = h + "px"; }
      if (s.state !== "check") return;
      let lm = null;
      if (s.o.getLm) lm = s.o.getLm();
      else if (s.pl && v.readyState >= 2) { try { const r = s.pl.detectForVideo(v, now); lm = r && r.landmarks && r.landmarks[0]; } catch (e) {} }
      const j = s.j = lm ? scJudge(lm, s.o.kind, s.ready || s.okAt > 0, s.o.view, v.videoWidth / v.videoHeight) : { k: "none" };
      // Green after 0.8 s in a good spot. It stays green for 15 s even if you walk up to tap Go, then needs you back.
      if (j.k === "ok") { s.badAt = 0; s.setAt = s.ready ? now : s.setAt; s.okAt = s.okAt || now; if (!s.ready && now - s.okAt > 800) scSetReady(s, true); }
      else { s.badAt = s.badAt || now; if (now - s.badAt > 300) s.okAt = 0; if (s.ready && now - s.setAt > 15000) scSetReady(s, false); }
      const hb = s.el.querySelector(".sc-hold"), hw = !s.ready && s.okAt ? Math.min(100, (now - s.okAt) / 8) + "%" : "0";
      if (hb.style.width !== hw) hb.style.width = hw;
      // Words on screen now; said out loud once the same problem has lasted a second, and not too often.
      const key = s.ready ? "ready" : s.noPose && !s.o.getLm ? "nopose" : s.okAt ? "hold" : j.k;
      if (key !== s.key) { s.key = key; s.keyAt = now; }
      const m = key === "ready" ? ["You're set", s.voice ? 'Say "go" or tap Go' : "Tap Go"] : SC_MSG[key];
      const bb = s.el.querySelector(".sc-msg b"), ss = s.el.querySelector(".sc-msg span");
      if (bb.textContent !== m[0]) bb.textContent = m[0];
      if (ss.textContent !== m[1]) ss.textContent = m[1];
      s.el.classList.toggle("fix", !s.ready && key !== "none" && key !== "nopose" && key !== "hold");
      s.el.classList.toggle("hold", key === "hold");
      if (!s.ready && m[2] && now - s.keyAt > 1100 && (s.saidKey !== key || now - s.saidAt > 4500) && now - s.saidAt > 3500 && !(window.speechSynthesis && speechSynthesis.speaking)) {
        s.saidKey = key; s.saidAt = now; say(m[2]);
      }
      scDraw(s, j, w, h);
    }

    // The zone to stand in (corner marks), a box around you (amber to fix, green when set) and an arrow to the middle.
    function scDraw(s, j, w, h) {
      const cv = s.cv, dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const c = cv.getContext("2d");
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, h);
      const ok = s.ready, col = ok || s.okAt ? "#2BD17E" : "#FFC23D";
      // corner marks of the zone
      const zx0 = .2 * w, zx1 = .8 * w, zy0 = .03 * h, zy1 = .965 * h, L = Math.min(w, h) * .08;
      c.strokeStyle = ok ? "#2BD17E" : "#F2F5FA"; c.lineWidth = 6; c.lineCap = "round";
      c.beginPath();
      for (const [x, y, dx, dy] of [[zx0, zy0, 1, 1], [zx1, zy0, -1, 1], [zx0, zy1, 1, -1], [zx1, zy1, -1, -1]]) { c.moveTo(x + dx * L, y); c.lineTo(x, y); c.lineTo(x, y + dy * L); }
      c.stroke();
      if (s.o.kind === "shot") { // the release room above your head
        c.setLineDash([6, 6]); c.strokeStyle = "rgba(242,245,250,.35)"; c.lineWidth = 2;
        c.beginPath(); c.moveTo(zx0, zy0 + .02 * h); c.lineTo(zx1, zy0 + .02 * h); c.stroke(); c.setLineDash([]);
      }
      const b = j.box;
      if (!b) return;
      const x0 = Math.max(2, b.x0 * w), x1 = Math.min(w - 2, b.x1 * w), y0 = Math.max(2, b.top * h), y1 = Math.min(h - 2, b.bottom * h);
      c.strokeStyle = col; c.lineWidth = ok ? 5 : 3;
      c.beginPath(); c.roundRect ? c.roundRect(x0, y0, x1 - x0, y1 - y0, 12) : c.rect(x0, y0, x1 - x0, y1 - y0); c.stroke();
      if (s.o.kind === "shot" && !ok) { // where your hands go at the release
        const ry = (b.top - .5 * b.H) * h;
        c.setLineDash([5, 6]); c.beginPath(); c.moveTo(x0, Math.max(2, ry)); c.lineTo(x1, Math.max(2, ry)); c.stroke(); c.setLineDash([]);
      }
      // red edge where you're cut off
      c.fillStyle = "rgba(255,90,70,.75)";
      if (j.k === "feet") c.fillRect(0, h - 8, w, 8);
      if (j.k === "head" || j.k === "room") c.fillRect(0, 0, w, 8);
      if (j.k === "mid") { // arrow toward the middle, drawn in the picture's own direction (the frame mirrors it with the video)
        const ax = b.hipX * w, ay = (b.top + b.bottom) / 2 * h, d = j.dir, tx = ax + d * w * .22;
        c.strokeStyle = c.fillStyle = "#FFC23D"; c.lineWidth = 14;
        c.beginPath(); c.moveTo(ax + d * 30, ay); c.lineTo(tx, ay); c.stroke();
        c.beginPath(); c.moveTo(tx + d * 34, ay); c.lineTo(tx - d * 6, ay - 32); c.lineTo(tx - d * 6, ay + 32); c.closePath(); c.fill();
      }
    }

    function scCount(s) {
      if (SC !== s || s.state !== "check") return;
      s.state = "count";
      s.n = scCd(s.o);
      s.el.classList.remove("fix", "hold");
      s.el.classList.add("count", "ok");
      s.el.querySelector(".sc-hold").style.width = "0";
      const bb = s.el.querySelector(".sc-msg b"), ss = s.el.querySelector(".sc-msg span");
      ss.textContent = "";
      if (s.tapped) say("Walk back to your spot.");
      const big = s.el.querySelector(".sc-big");
      const clr = () => { const c = s.cv.getContext("2d"); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, s.cv.width, s.cv.height); };
      clr();
      const step = () => {
        if (SC !== s || s.state !== "count") return;
        if (s.n <= 0) { scDone(s, false); return; }
        big.textContent = s.n; bb.textContent = "Recording in " + s.n;
        big.classList.remove("pop"); void big.offsetWidth; big.classList.add("pop");
        beep(s.n <= 3 ? 780 : 660, 100);
        if (s.n <= 3) setTimeout(() => { if (SC === s) say(String(s.n + 1)); }, 120);
        s.n--;
        s.timer = setTimeout(step, 1000);
      };
      scLow(s);
      step();
    }
    function scStop(s) {
      if (SC !== s || s.state !== "count") return;
      clearTimeout(s.timer);
      s.state = "check";
      s.el.classList.remove("count");
      s.el.querySelector(".sc-big").textContent = "";
      s.okAt = 0; s.key = ""; s.tapped = false;
      s.el.classList.toggle("ok", s.ready);
      say("Stopped.");
      scLow(s);
    }
    function scDone(s, now) {
      if (SC !== s) return;
      s.state = "done";
      if (!now) { beep(1046, 450); say("Recording."); }
      try { navigator.vibrate?.(120); } catch (e) {}
      const go = s.o.onGo;
      scClose();
      go();
    }
    function scClose() {
      const s = SC;
      if (!s) return;
      SC = null;
      cancelAnimationFrame(s.raf);
      clearTimeout(s.timer);
      if (s.ls) { s.ls.stop(); s.ls = null; }
      s.video.srcObject = null;
      s.el.remove();
    }
    window.scBack = () => { if (!SC) return false; const s = SC; if (s.state === "count") scStop(s); else { scClose(); if (s.o.onClose) s.o.onClose(); } return true; };

    // Live form check: "Check my spot" under Place the phone runs the check with the live loop's own landmarks.
    function liveCheck() {
      if (!L) return;
      if (!L.stream) { L.ready = true; drawPlace(); return; }
      const me = L;
      setupCheck({ stream: L.stream, mirror: L.face === "user", kind: "shot", view: behind() ? "behind" : "side", title: "Live form check", getLm: () => (L === me ? L.raw : null),
        onGo: () => { if (L !== me) return; L.ready = true; L.buf = []; L.up = 0; drawPlace(); say("Go. Shoot when you're ready."); } });
    }

    // Film this rep: the check replaces the old plain countdown, then records as before.
    const origCmpGo = cmpGo;
    cmpGo = function () {
      const C = CMP;
      if (!C || !C.stream || C.state !== "cam") return origCmpGo.apply(this, arguments);
      setupCheck({ stream: C.stream, mirror: CO.facing === "user", kind: C.d && C.d.skill === "s" ? "shot" : "body", title: C.d ? C.d.name : "Film this rep",
        cdKey: "cmpDelay", cdOpts: [5, 10], onGo: () => { if (CMP === C && C.stream && C.state === "cam") cmpRec(); } });
    };
    // The move clip recorder: check first, then its own takes.
    const origCrRun = crRun;
    crRun = function () {
      const C = CR;
      if (!C || !C.stream || C.state !== "idle") return origCrRun.apply(this, arguments);
      setupCheck({ stream: C.stream, mirror: crFace === "user", kind: "body", title: C.m.n, onGo: () => { if (CR === C) origCrRun(); } });
    };
    // A training video: check first, unless someone else is filming.
    const origRecGo = recGo;
    recGo = function () {
      const R2 = CO.rec;
      if (!R2 || !R2.stream || (R2.mr && R2.mr.state === "recording")) return origRecGo.apply(this, arguments);
      setupCheck({ stream: R2.stream, mirror: CO.facing === "user", kind: "body", title: "Training video", now: true, onGo: () => { if (CO.rec === R2) origRecGo(); } });
    };

    window.liveBack = () => { if (!L) return false; closeLive(); return true; };
    function closeLive() {
      if (!L) return;
      scClose();
      const shots = L.shots;
      buLiveEnd().then(id => { if (id) burstOpen(id, 0, true); }); // stops the shot recorders before the camera closes
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
    if (!K) K = { burst: { id: uid("b"), t: Date.now(), view: fcView(), hand: S.settings.hand || "R", src: "live", front: !!S.settings.fcFront && fcView() === "behind", shots: [] }, pend: [], results: [], chain: Promise.resolve(), bytes: 0, ends: [] };
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
    el.innerHTML = `<div class="lf-top"><div class="lf-title">Finding your shots</div><button class="btn sec small" data-bc="cancel">Cancel</button></div>
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
    if (!pl) { toast("Couldn't load the pose model", "It finds your shots in the clip."); return done(null); }
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
`;
  document.head.appendChild(bst);

  let BV = null; // the open viewer: {bid, i, sel:Set, cmp, rate, el, raf}
  const buDay = t => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  function burstOpen(id, i, fresh) {
    const f = burstFind(id);
    if (!f) return;
    if (BV) burstClose();
    const el = document.createElement("div");
    el.className = "livefc buv";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Shot viewer");
    document.body.appendChild(el);
    BV = { bid: id, i: i || 0, fresh: !!fresh, sel: new Set(), cmp: null, pick: false, rate: .5, el, raf: 0, pf: {}, urls: {} };
    el.addEventListener("click", buClick);
    el.addEventListener("pointerdown", buPress);
    el.addEventListener("pointerdown", buSwipe);
    buDraw();
  }
  window.burstOpen = burstOpen;
  window.burstBack = () => {
    if (BC) { BC.stop = true; return true; }
    if (!BV) return BL ? blBack() : false;
    if (BV.pick || BV.cmp != null) { BV.pick = false; BV.cmp = null; buDraw(); return true; }
    if (BV.sel.size) { BV.sel.clear(); buDraw(); return true; }
    burstClose();
    return true;
  };
  function burstClose() {
    if (!BV) return;
    cancelAnimationFrame(BV.raf);
    BV.el.querySelectorAll("video").forEach(v => { v.pause(); v.removeAttribute("src"); v.load(); });
    BV.el.remove();
    BV = null;
    if (BL) return blDraw();
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
    const oldStrip = BV.el.querySelector(".bu-strip"), sx = oldStrip ? oldStrip.scrollLeft : null;
    const pkey = [cur, other].map(s => s ? s.id + "/" + (s.v || "") : "").join("|"), oldPanes = BV.pkey === pkey ? BV.el.querySelector(".bu-panes") : null;
    if (oldPanes) oldPanes.remove();
    const nSel = BV.sel.size, selS = S0.filter(s => BV.sel.has(s.id)), allStar = nSel && selS.every(s => s.star), selV = selS.filter(s => s.v), allKeep = selV.length && selV.every(s => s.keep);
    BV.el.innerHTML = `<div class="lf-top"><div class="lf-title">Shot ${cur.n} <span style="opacity:.7">of ${S0.length} · ${esc(buDay(B.t))}</span></div>
      ${S0.length > 1 ? `<button class="btn sec small bv-lib" data-bv="lib">${BLI.grid}All shots</button>` : ""}<button class="btn sec small" data-bv="close">Done</button></div>
      <div class="bu-panes" data-swipe="1">${pane(cur, other ? `Shot ${cur.n}` : "")}${other ? pane(other, `Shot ${other.n}`) : ""}</div>
      <div class="bu-m">${cur.m.map(m => `<span class="${m.st}">${buGlyph(m.st)}${esc(m.l)} · ${esc(m.v)}</span>`).join("")}</div>
      <div class="bu-row">${[[1, "1×"], [.5, "½×"], [.25, "¼×"]].map(([r, l]) => `<button class="btn sec small" data-bv="rate:${r}" aria-pressed="${BV.rate === r}">${l}</button>`).join("")}
        ${cur.at ? `<button class="btn sec small" data-bv="jump:p">Dip</button><button class="btn sec small" data-bv="jump:sp">Set point</button><button class="btn sec small" data-bv="jump:r">Release</button>` : ""}<button class="btn sec small" data-bv="play">Pause</button></div>
      <div class="bu-strip" role="listbox" aria-label="Shots">${S0.map((s, j) => `<button class="bu-chip ${worstOf(s)}${s.v ? "" : " nov"}${BV.sel.has(s.id) ? " sel" : ""}" data-bv="shot:${j}" aria-current="${j === BV.i}" aria-label="Shot ${s.n}${s.star ? ", starred" : ""}${s.v ? "" : ", no video"}">${s.n}${s.star ? '<span class="st">★</span>' : ""}</button>`).join("")}</div>
      ${BV.pick ? `<p class="bu-note"><b>Tap the shot to compare with.</b> They play lined up at the release.</p>`
        : nSel ? `<p class="bu-note"><b>${nSel} selected.</b> Tap shots to add or remove them. <button class="linkbtn" data-bv="selclear" style="color:inherit">Clear</button></p>`
        : BV.fresh && S0.length > 1 ? `<div class="bu-fresh"><span><b>${S0.length} shots saved.</b> Pick the ones to keep.</span><button class="btn pri small" data-bv="lib">${BLI.grid}Review in shot library</button></div>`
        : `<p class="bu-note">${unkept && Date.now() < exp ? `Video for shots with no ★ or Keep is deleted on ${esc(buDay(exp))}. ` : ""}Swipe the video for the next shot. Hold a shot to select several.</p>`}
      <div class="bu-bar">${nSel ? `<button class="btn sec small" data-bv="sstar" aria-pressed="${!!allStar}">${allStar ? `★ Unstar ${nSel}` : `☆ Star ${nSel}`}</button>
        ${selV.length ? `<button class="btn sec small" data-bv="skeep" aria-pressed="${!!allKeep}">${allKeep ? `Unkeep ${selV.length}` : `Keep ${selV.length}`}</button>` : ""}
        ${selV.length ? `<button class="btn sec small" data-bv="sdel">${BV.delAsk ? "Tap again to delete" : `Delete ${selV.length} video${selV.length > 1 ? "s" : ""}`}</button>` : ""}`
        : `<button class="btn sec small" data-bv="star" aria-pressed="${!!cur.star}">${cur.star ? "★ Starred" : "☆ Star"}</button>
        ${cur.v ? `<button class="btn sec small" data-bv="keep" aria-pressed="${!!cur.keep}">${cur.keep ? "Kept" : "Keep"}</button>` : ""}
        ${S0.length > 1 ? `<button class="btn sec small" data-bv="cmp" aria-pressed="${other != null || BV.pick}">${other ? "Single" : "Compare"}</button>` : ""}
        ${S0.length > 1 ? `<button class="btn sec small" data-bv="selstart">Select</button>` : ""}
        ${cur.v ? `<button class="btn sec small" data-bv="del">${BV.delAsk ? "Tap again to delete" : "Delete video"}</button>` : ""}`}
        ${BURST_ACTIONS.map(a => `<button class="btn sec small" data-bv="act:${esc(a.id)}">${esc(a.label)}</button>`).join("")}</div>`;
    BV.shots = shots;
    const strip = BV.el.querySelector(".bu-strip");
    if (strip && sx != null) strip.scrollLeft = sx;
    if (strip && BV.shown !== BV.i) { // bring the shot on screen into view, without moving the strip when only the selection changed
      const c = strip.querySelector(`[data-bv="shot:${BV.i}"]`);
      if (c) { const a = strip.getBoundingClientRect(), r = c.getBoundingClientRect(); if (r.left < a.left + 12 || r.right > a.right - 12) strip.scrollLeft += r.left - a.left - (a.width - r.width) / 2; }
    }
    BV.shown = BV.i;
    if (oldPanes) { BV.el.querySelector(".bu-panes").replaceWith(oldPanes); return; }
    BV.pkey = pkey;
    buLoad(cur, other);
  }
  function buSwipe(e) { // swipe the video left or right for the next or previous shot
    if (!BV || !e.target.closest("[data-swipe]") || BV.sel.size || BV.pick) return;
    const x0 = e.clientX, y0 = e.clientY, el = BV.el;
    const up = ev => {
      el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
      if (!BV || ev.type !== "pointerup") return;
      const dx = ev.clientX - x0, dy = ev.clientY - y0, n = buCur().shots.length;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const j = BV.i + (dx < 0 ? 1 : -1);
      if (j < 0 || j >= n) return;
      BV.i = j; if (BV.cmp === j) BV.cmp = null; buDraw();
    };
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
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
    if (k !== "del" && k !== "sdel") BV.delAsk = false;
    if (k === "close") return burstClose();
    if (k === "lib") { const id = BV.bid, i = BV.i, under = BL && BL.bid === id; burstClose(); return under ? undefined : burstLib(id, i); }
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
    if (k === "selstart") { BV.sel.add(cur.id); BV.cmp = null; BV.pick = false; return buDraw(); }
    if (k === "sstar" || k === "skeep") {
      const sel = B.shots.filter(s => BV.sel.has(s.id) && (k === "sstar" || s.v));
      if (k === "sstar") { const on = !sel.every(s => s.star); sel.forEach(s => { s.star = on; if (on) s.keep = true; }); }
      else { const on = !sel.every(s => s.keep); sel.forEach(s => (s.keep = on)); }
      persist(); return buDraw();
    }
    if (k === "sdel") {
      if (!BV.delAsk) { BV.delAsk = true; b.textContent = "Tap again to delete"; return; }
      BV.delAsk = false;
      const sel = B.shots.filter(s => BV.sel.has(s.id) && s.v), vids = sel.map(s => s.v);
      sel.forEach(s => { s.v = null; s.star = false; s.keep = false; });
      BV.sel.clear(); persist();
      await buDrop(vids, []);
      await loadVids();
      return BV && buDraw();
    }
    if (k === "star") { cur.star = !cur.star; if (cur.star) cur.keep = true; persist(); return buDraw(); } // a star always keeps the shot too
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

  /* -- the shot library: every shot of a burst in a grid, to pick what to keep, send to a coach or delete --
     Each tile shows the focus cue (the cue with the most Fix grades, or the one picked) in colour and shape, so a
     whole session reads at a glance and shots compare on the same thing. Filters: ★, Kept, Make/Miss and grade on
     the focus cue; sort by shot order or worst/best on it. Select several (Select, or hold a tile) to Keep, ★, Send to
     coach or Delete video. Deleting asks first, with counts, never touches kept shots, and can be undone for a few
     seconds. Quick pick plays one shot at a time: Skip, ★ or Keep (or swipe the video), and an optional Make/Miss.
     ★ always keeps the shot too. Thumbnails are made once from each shot's video at the release, cropped to the
     shooter, and stay at blobs[shotId+":th"] after the video goes. See docs/LEARNING.md, step 30. */
  function buGlyph(st) {
    return `<svg class="bl-gl ${st}" viewBox="0 0 12 12" aria-hidden="true">${st === "fix" ? '<rect x="1" y="1" width="10" height="10" rx="2"/>' : st === "watch" ? '<path d="M6 .8 11.4 10.8H.6Z"/>' : '<circle cx="6" cy="6" r="5.2"/>'}</svg>`;
  }
  const BLI = {
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.8-4.9 4.6 1.3 6.5L12 17.2l-5.9 3.2 1.3-6.5L2.5 9.3l6.6-.8z"/></svg>',
    keep: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2.5h12a1 1 0 0 1 1 1v18l-7-4.6-7 4.6v-18a1 1 0 0 1 1-1z"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    gone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h12v10H3zM15 10l5-3v10l-5-3M2 3l20 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  const blst = document.createElement("style");
  blst.textContent = `
.buv .bv-lib{display:flex;align-items:center;gap:6px;white-space:nowrap;min-height:44px}.buv .bv-lib svg{width:18px;height:18px;fill:currentColor}
.buv .bu-fresh{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:6px 12px 0;padding:10px 12px;border-radius:12px;background:#162038;border:1px solid #2A3858;font-size:14px}.buv .bu-fresh span{flex:1;min-width:150px}
.buv .bu-fresh .btn{display:flex;align-items:center;gap:6px;min-height:44px;white-space:nowrap}.buv .bu-fresh .btn svg{width:18px;height:18px;fill:currentColor}
.bul.bl-in{animation:blIn 260ms cubic-bezier(.2,.8,.2,1)}.bul.bl-out{animation:blOut 200ms cubic-bezier(.4,0,1,1) forwards;pointer-events:none}
@keyframes blIn{from{transform:translateX(100%)}to{transform:none}}@keyframes blOut{from{transform:none}to{transform:translateX(100%)}}
@keyframes blFadeIn{from{opacity:0}to{opacity:1}}@keyframes blFadeOut{from{opacity:1}to{opacity:0}}
@media (prefers-reduced-motion:reduce){.bul.bl-in{animation:blFadeIn 120ms linear}.bul.bl-out{animation:blFadeOut 120ms linear forwards}}
.bl-t.here{box-shadow:0 0 0 3px #F07A35}
.bul{gap:0}.bul .lf-top{justify-content:flex-start}.bul .lf-top .lf-title{flex:1;min-width:0}
.bl-ib{flex:none;width:44px;height:44px;border-radius:12px;border:1px solid #2A3858;background:#1C2844;color:#F2F5FA;display:flex;align-items:center;justify-content:center;padding:0}
.bl-ib svg{width:22px;height:22px;fill:currentColor}
.bl-sub{display:block;font-family:var(--body,inherit);font-size:13px;font-weight:500;text-transform:none;letter-spacing:0;opacity:.72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bl-chips{display:flex;gap:6px;overflow-x:auto;padding:4px 12px;scrollbar-width:none;-webkit-mask-image:linear-gradient(90deg,#000 85%,transparent);mask-image:linear-gradient(90deg,#000 85%,transparent)}
.bl-chip{flex:none;min-height:40px;padding:0 14px;border-radius:999px;border:1px solid #2A3858;background:#1C2844;color:#F2F5FA;font:600 14px var(--body,inherit);display:flex;align-items:center;gap:6px}
.bl-chip[aria-pressed="true"]{background:#F2F5FA;color:#05080F;border-color:#F2F5FA}.bl-chip svg{width:15px;height:15px;fill:currentColor}.bl-chip .c{opacity:.7}
.bl-chip.st svg{fill:#FFD34D}.bl-chip.st[aria-pressed="true"] svg{fill:#9a6a00}
.bl-row{display:flex;gap:6px;padding:4px 12px;align-items:center}
.bl-sel{flex:1;min-width:0;min-height:40px;border-radius:10px;border:1px solid #2A3858;background:#1C2844;color:#F2F5FA;font:600 14px var(--body,inherit);padding:0 8px}
.bl-gb{display:flex;gap:4px;padding:4px 12px}
.bl-gb button{min-width:0;min-height:40px;border-radius:10px;border:1px solid #2A3858;background:#111a2c;color:#F2F5FA;font:700 14px var(--body,inherit);display:flex;align-items:center;justify-content:center;gap:6px;padding:0 6px;white-space:nowrap;overflow:hidden}
.bl-gb button.fix{border-bottom:4px solid #E0533F}.bl-gb button.watch{border-bottom:4px solid #E8A317}.bl-gb button.good{border-bottom:4px solid #2FB377}
.bl-gb button[aria-pressed="true"]{background:#F2F5FA;color:#05080F}
.bl-gl{width:12px;height:12px;flex:none}.bl-gl.fix{fill:#E0533F}.bl-gl.watch{fill:#E8A317}.bl-gl.good{fill:#2FB377}
.bl-note{font-size:13px;opacity:.8;padding:4px 16px 6px;margin:0}.bl-note .linkbtn{color:#F07A35;font-weight:700;opacity:1;min-height:32px}
.bl-grid{flex:1;min-height:0;overflow-y:auto;display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:2px 12px 12px;align-content:start;grid-auto-rows:max-content}
.bl-t{position:relative;display:block;padding:0;border:0;border-radius:10px;overflow:hidden;background:#111a2c;color:#F2F5FA;text-align:left;font:inherit}
.bl-t::after{content:"";position:absolute;inset:0;border-radius:10px;border:1px solid #2A3858;pointer-events:none}
.bl-t.sel::after{border:3px solid #F07A35}
.bl-t .th{display:block;aspect-ratio:3/3.4;background:#141c2e;position:relative}
.bl-t .th img{width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity .15s}.bl-t .th img.on{opacity:1}
.bl-t .th::before{content:"";position:absolute;inset:0 0 auto;height:40px;background:linear-gradient(rgba(5,8,15,.6),transparent);z-index:1}
.bl-t.nov .th img{opacity:.35;filter:grayscale(1)}
.bl-t .gone{position:absolute;inset:auto 0 8px;display:flex;flex-direction:column;align-items:center;gap:2px;font-size:11.5px;font-weight:600;color:#AEB8CC;z-index:1}.bl-t .gone svg{width:22px;height:22px}
.bl-t .no{position:absolute;left:5px;top:5px;z-index:2;display:flex;align-items:center;gap:4px;min-width:26px;height:24px;padding:0 6px;border-radius:7px;font:700 16px var(--display);justify-content:center}
.bl-t.fix .no{background:#7A2318}.bl-t.watch .no{background:#5A3F06}.bl-t.good .no{background:#145C3C}
.bl-t .no i{width:14px;height:14px;border-radius:50%;border:1.5px solid rgba(242,245,250,.75);display:block}
.bl-t.sel .no{background:#F07A35;color:#1A0C03}.bl-t.sel .no i{border:0;background:none}.bl-t .no svg{width:14px;height:14px}
.bl-t .mk{position:absolute;right:5px;top:5px;z-index:2;display:flex;gap:3px}.bl-t .mk svg{width:20px;height:20px;filter:drop-shadow(0 1px 2px #000)}
.bl-t .mk .pk{font:800 10px var(--body,inherit);text-transform:uppercase;background:#F2F5FA;color:#05080F;border-radius:6px;padding:2px 5px;align-self:center}.bl-t .mk .s{fill:#FFD34D}.bl-t .mk .k{fill:#F2F5FA}
.bl-t .mm{position:absolute;right:5px;bottom:34px;z-index:2;font:800 12px var(--body,inherit);border-radius:6px;padding:1px 6px;background:rgba(5,8,15,.8)}
.bl-t .mm.y{color:#7FE0AE}.bl-t .mm.n{color:#FF9A8A}
.bl-t .bl-cue{display:flex;align-items:center;gap:6px;padding:6px 7px;font:600 12.5px var(--body,inherit);color:#D6DDEA;white-space:nowrap;overflow:hidden}
.bl-empty{grid-column:1/-1;text-align:center;opacity:.8;padding:36px 12px;font-size:14px}
.bl-bar{display:flex;gap:6px;padding:10px 12px calc(14px + env(safe-area-inset-bottom,0px));border-top:1px solid #1C2844;background:#070b14}
.bl-bar .btn{flex:1;min-width:0;min-height:48px;white-space:nowrap;display:flex;align-items:center;justify-content:center;gap:6px;padding:10px 8px}
.bl-bar .btn svg{width:18px;height:18px;fill:currentColor;flex:none}.bl-bar .btn.st svg{fill:#FFD34D}
.bl-bar .btn.danger{flex:0 0 52px;background:transparent;border:1px solid #6E2A22;color:#FF8A78}
.bl-bar .btn.pri,.bl-bar .btn:not(.sec){background:#F07A35;color:#1A0C03;border:0}
.bl-snack{position:absolute;left:12px;right:12px;bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:5;display:flex;align-items:center;gap:10px;background:#F2F5FA;color:#05080F;border-radius:12px;padding:6px 6px 6px 14px;font-weight:600;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.4)}
.bl-snack span{flex:1}.bl-snack button{min-height:40px;border:0;background:none;color:#B4470F;font:700 15px var(--display);text-transform:uppercase;padding:0 12px}
.bl-ask{position:absolute;inset:0;z-index:6;background:rgba(5,8,15,.6);display:flex;align-items:flex-end}
.bl-ask>div{width:100%;background:#0E1526;border-top:1px solid #2A3858;border-radius:18px 18px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom,0px))}
.bl-ask b{font-family:var(--display);font-size:22px;text-transform:uppercase;display:block}.bl-ask p{margin:8px 0 14px;font-size:14.5px;opacity:.85}
.bl-ask .bl-bar{border:0;background:none;padding:0}
.bl-ask .btn.danger{flex:1;background:#C13C2A;color:#fff;border:0}
.qp-card{position:relative;flex:1;min-height:0;margin:2px 12px 0;border-radius:14px;overflow:hidden;background:#000;display:flex;align-items:center;justify-content:center;touch-action:pan-y;will-change:transform}
.qp-card video,.qp-card canvas{position:absolute}
.qp-card .qp-no{position:absolute;left:10px;top:10px;z-index:2;font:700 20px var(--display);border-radius:8px;padding:2px 10px}
.qp-card .qp-no.fix{background:#7A2318}.qp-card .qp-no.watch{background:#5A3F06}.qp-card .qp-no.good{background:#145C3C}
.qp-card .qp-rate{position:absolute;right:10px;top:10px;z-index:2;min-height:36px;border-radius:999px;border:0;background:rgba(5,8,15,.75);color:#F2F5FA;font-weight:700;padding:0 12px}
.qp-stamp{position:absolute;top:40%;z-index:3;font:700 34px var(--display);text-transform:uppercase;border:4px solid;border-radius:12px;padding:2px 14px;opacity:0;pointer-events:none}
.qp-stamp.k{left:18px;color:#F07A35;transform:rotate(-12deg)}.qp-stamp.s{right:18px;color:#AEB8CC;transform:rotate(12deg)}
.qp-mm{display:flex;align-items:center;gap:6px;justify-content:center;padding:8px 12px 0;font-size:13.5px}
.qp-mm .bl-chip{min-height:40px}
.qp-act{display:flex;gap:8px;padding:8px 12px 0}.qp-act .btn{flex:1;min-height:60px;font-size:20px;display:flex;align-items:center;justify-content:center;gap:6px}
.qp-act .btn.st{flex:.6;background:#1C2844;border:1px solid #FFD34D;color:#FFD34D}.qp-act .btn.st svg{width:26px;height:26px;fill:#FFD34D}
.qp-act .btn.st[aria-pressed="true"]{background:#FFD34D;color:#1A0C03}.qp-act .btn.st[aria-pressed="true"] svg{fill:#1A0C03}
.qp-end{flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:24px;gap:8px}
.qp-end b{font-family:var(--display);font-size:28px;text-transform:uppercase}
.bul .bu-m{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;padding:6px 12px 0}.bul .bu-m span{font-size:12.5px;border-radius:999px;padding:4px 10px;background:#1C2844}
.bul .bu-m span.fix{background:#C13C2A}.bul .bu-m span.watch{background:#6b4a05}.bul .bu-m span.good{background:#17704A}.bul .bu-none{opacity:.8;font-size:14px;padding:16px;text-align:center}
.bul .bu-m span .bl-gl,.buv .bu-m span .bl-gl{margin-right:5px;vertical-align:-1px}.buv .bu-m span.good{background:#17704A}
.bu-m span .bl-gl.fix,.bu-m span .bl-gl.watch,.bu-m span .bl-gl.good{fill:#fff}
@media (prefers-reduced-motion:reduce){.bl-t .th img{transition:none}.qp-card{transition:none!important}}`;
  document.head.appendChild(blst);

  let BL = null; // the open library: {bid, el, mode:"grid"|"pick", f, g, sort, cue, sel:Set, selOn, from, qi, q, hist, pend, snack, ask, rate}
  const blKept = s => !!(s.keep || s.star || s.sent);
  const blCur = () => { const f = BL && burstFind(BL.bid); return f ? f.burst : null; };
  const blRM = (typeof matchMedia === "function") && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function burstLib(id, from) {
    if (!burstFind(id)) return;
    if (BL) blClose();
    const el = document.createElement("div");
    el.className = "livefc bul";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Shot library");
    el.classList.add("bl-in");
    el.addEventListener("animationend", () => el.classList.remove("bl-in"), { once: true });
    document.body.appendChild(el);
    BL = { bid: id, el, mode: "grid", f: "all", g: null, sort: "n", cue: null, sel: new Set(), selOn: false, from: from == null ? null : from, qi: 0, q: [], hist: [], pend: null, snack: null, ask: null, rate: .5 };
    el.addEventListener("click", blClick);
    el.addEventListener("change", blChange);
    el.addEventListener("input", e => { if (BL && BL.pk && e.target.dataset.bl === "pkq") { BL.pk.q = e.target.value; const n = BL.el.querySelector("[data-bl='pknext']"); if (n) n.disabled = !BL.pk.q.trim(); } });
    el.addEventListener("pointerdown", blPress);
    blDraw();
    if (from != null) requestAnimationFrame(() => { const t = BL && BL.el.querySelector(`[data-shot-n="${from}"]`); if (t) t.scrollIntoView({ block: "center" }); });
  }
  window.burstLib = burstLib;
  function blClose(reopen) {
    if (!BL) return;
    const my = BL;
    blFlush(my);
    blStopQ(my);
    if (my.io) my.io.disconnect();
    // slides back out to the right (a fade with reduced motion); whatever is under it is already drawn
    const gone = my.el;
    gone.classList.remove("bl-in"); gone.classList.add("bl-out");
    gone.addEventListener("animationend", () => gone.remove(), { once: true });
    setTimeout(() => gone.remove(), 320);
    BL = null;
    if (reopen && my.from != null) return burstOpen(my.bid, my.from);
    if (state.tab === "form") render();
  }
  function blBack() {
    if (!BL) return false;
    if (BL.ask || BL.pk) { BL.ask = null; BL.pk = null; blDraw(); return true; }
    if (BL.mode === "pick") { blStopQ(BL); BL.mode = "grid"; BL.snack = null; blDraw(); return true; }
    if (BL.selOn) { BL.selOn = false; BL.sel.clear(); blDraw(); return true; }
    blClose(true);
    return true;
  }
  // the focus cue: the one picked, else the cue graded Fix most often in this burst
  const blCue = B => buFocus(B, BL.cue);
  const blSt = (s, k) => (s.st && s.st[k]) || (s.m.find(m => m.k === k) || {}).st || null;
  const RK = { fix: 2, watch: 1, good: 0 };
  /* -- coach pack (a switch in the Form tab's Shot bursts fold, off by default) --
     For each burst: up to 5 shots on the focus cue (best, typical, worst, and a typical early and late one), kept
     past the 14-day cleanup so a matched set survives, and a Coach pack sheet in the library that sends them with
     your question and a short session summary. Space for information: about 5 shots' video per session. */
  const packOn = () => !!(S.settings && S.settings.coachPack);
  function buFocus(B, want) {
    const ks = [];
    for (const s of B.shots) for (const m of s.m) if (!ks.includes(m.k)) ks.push(m.k);
    want = want || B.cue; // the focus picked in the library sticks to the burst
    if (want && ks.includes(want)) return want;
    let best = ks[0], n = -1;
    for (const k of ks) { const c = B.shots.filter(s => s.st && s.st[k] === "fix").length * 2 + B.shots.filter(s => s.st && s.st[k] === "watch").length; if (c > n) { n = c; best = k; } }
    return best;
  }
  function buScore(B, cue) { // higher is worse: grade first, then distance from the good shots' median
    const good = B.shots.filter(s => blSt(s, cue) === "good").map(s => s.vals && s.vals[cue]).filter(x => typeof x === "number");
    const mid = good.length ? med(good) : 0;
    return s => { const st = blSt(s, cue); if (!st) return -1; const x = s.vals && s.vals[cue]; return RK[st] * 1e6 + (typeof x === "number" ? Math.min(999999, Math.abs(x - mid) * 1000) : 0); };
  }
  function buPack(B, cue) {
    cue = cue || buFocus(B);
    const sc = buScore(B, cue), V = B.shots.filter(s => s.v && sc(s) >= 0);
    if (!V.length) return [];
    const by = V.slice().sort((a, b) => sc(a) - sc(b) || a.n - b.n), mid = sc(by[Math.floor(by.length / 2)]);
    const near = L => L.slice().sort((a, b) => Math.abs(sc(a) - mid) - Math.abs(sc(b) - mid) || a.n - b.n)[0];
    const q = Math.max(1, Math.round(V.length / 4)), byN = V.slice().sort((a, b) => a.n - b.n);
    const out = [], add = (role, s) => { if (s && !out.some(x => x.s === s)) out.push({ role, s }); };
    add("Best", by[0]); add("Typical", by[Math.floor(by.length / 2)]); add("Worst", by[by.length - 1]);
    if (V.length >= 8) { add("Early", near(byN.slice(0, q))); add("Late", near(byN.slice(-q))); }
    return out;
  }
  function buPackSummary(B, cue) {
    const S0 = B.shots, lab = ((S0.find(s => s.m.some(m => m.k === cue)) || { m: [] }).m.find(m => m.k === cue) || {}).l || cue;
    const q = Math.max(1, Math.round(S0.length / 4)), fixIn = L => L.filter(s => blSt(s, cue) === "fix").length;
    const tg = S0.filter(s => s.mk === 0 || s.mk === 1), mk = tg.filter(s => s.mk === 1).length;
    const where = B.src === "clip" ? "from a clip" : B.view === "behind" ? (B.front ? "filmed from the front" : "filmed from behind") : "filmed from the side";
    return [`Session ${buDay(B.t)}: ${S0.length} shots, ${where}.`,
      `Focus: ${lab}. Fix on ${fixIn(S0)} of ${S0.length}${S0.length >= 8 ? `; ${fixIn(S0.slice(0, q))} of the first ${q}, ${fixIn(S0.slice(-q))} of the last ${q}` : ""}.`,
      tg.length ? `Makes tagged: ${mk} of ${tg.length} (${Math.round(mk / tg.length * 100)}%).` : ""].filter(Boolean).join("\n");
  }
  async function buPackSend(B, cue, picks, question) {
    await sendShots(B, picks.map(p => p.s));
    try { // label each clip by its role and put the question and summary in the note
      if (typeof SND === "undefined" || !SND) return;
      for (const x of SND.segs) { const p = picks.find(y => y.s === x.ref); if (p) x.label = `${p.role} · Shot ${p.s.n}`; }
      SND.note = [question.trim(), "", buPackSummary(B, cue), "", "The clip has a title card for each shot (best, typical, worst, early, late)."].join("\n"); // no shot times, so unpicking a clip can't leave them stale
      SND.edited = true;
      sndDraw();
    } catch (e) {}
  }
  function blList(B, cue, noGrade) {
    let L = B.shots.slice();
    const f = BL.f;
    if (f === "star") L = L.filter(s => s.star);
    else if (f === "kept") L = L.filter(blKept);
    else if (f === "make") L = L.filter(s => s.mk === 1);
    else if (f === "miss") L = L.filter(s => s.mk === 0);
    if (BL.g && !noGrade) L = L.filter(s => blSt(s, cue) === BL.g);
    if (BL.sort !== "n") {
      const score = buScore(B, cue);
      L.sort((a, b) => (BL.sort === "worst" ? score(b) - score(a) : (score(a) < 0) - (score(b) < 0) || score(a) - score(b)) || a.n - b.n);
    }
    return L;
  }
  function blTile(s, cue, PK) {
    const st = blSt(s, cue) || worstOf(s), m = s.m.find(x => x.k === cue), sel = BL.sel.has(s.id);
    const lab = `Shot ${s.n}${s.star ? ", starred" : ""}${s.keep || s.sent ? ", kept" : ""}${s.mk === 1 ? ", make" : s.mk === 0 ? ", miss" : ""}, ${st}${m ? ": " + m.l + " " + m.v : ""}${s.v ? "" : ", no video"}${BL.selOn ? (sel ? ", selected" : ", not selected") : ""}`;
    return `<button class="bl-t ${st}${s.v ? "" : " nov"}${sel ? " sel" : ""}${BL.from != null && s.n - 1 === BL.from ? " here" : ""}" data-bl="t:${s.id}" data-shot-n="${s.n - 1}" aria-label="${esc(lab)}"${BL.selOn ? ` aria-pressed="${sel}"` : ""}>
      <span class="th"><img data-th="${s.id}" alt="">${s.v ? "" : `<span class="gone">${BLI.gone}${s.gone ? "Video deleted" : "No video"}</span>`}</span>
      <span class="no">${BL.selOn ? (sel ? BLI.check : "<i></i>") : ""}${s.n}</span>
      <span class="mk">${s.star ? BLI.star.replace("<svg", '<svg class="s"') : ""}${s.keep || s.sent ? BLI.keep.replace("<svg", '<svg class="k"') : ""}${PK && PK.has(s.id) && !s.keep && !s.star && !s.sent ? '<span class="pk">Pack</span>' : ""}</span>
      ${s.mk === 1 ? '<span class="mm y">Make</span>' : s.mk === 0 ? '<span class="mm n">Miss</span>' : ""}
      <span class="bl-cue">${buGlyph(st)}${esc(m ? m.v : "No reading")}</span></button>`;
  }
  function blDraw() {
    const B = blCur();
    if (!B) return blClose();
    if (BL.mode === "pick") return qpDraw(B);
    const g0 = BL.el.querySelector(".bl-grid"), sy = g0 ? g0.scrollTop : null;
    const S0 = B.shots, cue = blCue(B), list = blList(B, cue), cues = [];
    for (const s of S0) for (const m of s.m) if (!cues.find(c => c.k === m.k)) cues.push(m);
    const base = blList(B, cue, true), gc = { fix: 0, watch: 0, good: 0 };
    for (const s of base) { const st = blSt(s, cue); if (st) gc[st]++; }
    const nStar = S0.filter(s => s.star).length, nKept = S0.filter(blKept).length, nMk = S0.filter(s => s.mk === 1).length, nMs = S0.filter(s => s.mk === 0).length;
    const sz = buSizes(), mb = buBytes(B, sz), exp = B.t + BU.KEEP_DAYS * 864e5;
    const PK = packOn() ? new Set(buPack(B, cue).map(p => p.s.id)) : null;
    const unk = S0.filter(s => s.v && !blKept(s) && !(PK && PK.has(s.id))), unkB = buBytes({ shots: unk }, sz);
    const sel = S0.filter(s => BL.sel.has(s.id)), nSel = sel.length;
    const chip = (f, lab, n, cls) => `<button class="bl-chip${cls ? " " + cls : ""}" data-bl="f:${f}" aria-pressed="${BL.f === f}">${lab}${n != null ? ` <span class="c">${n}</span>` : ""}</button>`;
    const top = BL.selOn
      ? `<div class="lf-top"><button class="bl-ib" data-bl="back" aria-label="Stop selecting">${BLI.back}</button><div class="lf-title">${nSel} selected<span class="bl-sub">Tap shots to add or remove them</span></div></div>`
      : `<div class="lf-top"><button class="bl-ib" data-bl="back" aria-label="Back">${BLI.back}</button><div class="lf-title">Shot library<span class="bl-sub">${esc(buDay(B.t))} · ${S0.length} shot${S0.length > 1 ? "s" : ""}${mb ? " · " + fmtMB(mb) : ""}</span></div></div>`;
    const note = BL.selOn
      ? `<p class="bl-note"><button class="linkbtn" data-bl="all">Select all ${list.length} shown</button>${nSel ? ` · <button class="linkbtn" data-bl="none">Clear</button>` : ""}${nSel && sel.some(s => !list.includes(s)) ? ` · ${sel.filter(s => !list.includes(s)).length} not shown` : ""}</p>`
      : unk.length && Date.now() < exp ? `<p class="bl-note">${unk.length} unkept video${unk.length > 1 ? "s" : ""} delete on ${esc(buDay(exp))}. ★ or Keep the ones you want.${PK && PK.size ? ` Coach pack keeps ${PK.size}.` : ""} ${unkB ? `<button class="linkbtn" data-bl="free">Free ${fmtMB(unkB)} now</button>` : ""}</p>`
      : `<p class="bl-note">Tap a shot to watch it. Hold one to select several.</p>`;
    const allStar = nSel && sel.every(s => s.star), sendN = sel.filter(s => s.v).length;
    const bar = BL.selOn
      ? `<div class="bl-bar"><button class="btn pri small" data-bl="keep"${nSel ? "" : " disabled"}>${BLI.keep}${nSel && sel.every(s => s.keep || s.star) ? `Unkeep ${nSel}` : `Keep ${sel.filter(s => !s.keep && !s.star).length}`}</button>
          <button class="btn sec small st" data-bl="star"${nSel ? "" : " disabled"} aria-pressed="${!!allStar}">${BLI.star}${allStar ? "Unstar" : "Star"}</button>
          ${typeof sendShots === "function" ? `<button class="btn sec small" data-bl="send"${sendN ? "" : " disabled"}>Coach${sendN ? " · " + sendN : ""}</button>` : ""}
          <button class="btn sec small danger" data-bl="del" aria-label="Delete video"${nSel ? "" : " disabled"}>${BLI.trash}</button></div>`
      : `<div class="bl-bar"><button class="btn sec small" data-bl="select">Select</button>${packOn() && typeof sendShots === "function" && PK && PK.size ? `<button class="btn sec small" data-bl="pack">Coach pack</button>` : ""}<button class="btn pri small" data-bl="pick">Quick pick ▸</button></div>`;
    BL.el.innerHTML = `${top}
      <div class="bl-chips">${chip("all", "All", S0.length)}${chip("star", BLI.star + "Starred", nStar, "st")}${chip("kept", BLI.keep + "Kept", nKept)}${nMk || nMs ? chip("make", "Make", nMk) + chip("miss", "Miss", nMs) : ""}</div>
      <div class="bl-row"><select class="bl-sel" data-bl="cue" aria-label="Focus cue">${cues.map(c => `<option value="${esc(c.k)}"${c.k === cue ? " selected" : ""}>Focus: ${esc(c.l)}</option>`).join("")}</select>
        <select class="bl-sel" data-bl="sort" aria-label="Sort" style="flex:0 0 auto">${[["n", "Shot order"], ["worst", "Worst first"], ["best", "Best first"]].map(([v, l]) => `<option value="${v}"${BL.sort === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="bl-gb" role="group" aria-label="Grade on the focus cue">${["fix", "watch", "good"].map(st => `<button class="${st}" data-bl="g:${st}" aria-pressed="${BL.g === st}" style="flex:${Math.max(gc[st], 1) + base.length * .12}">${buGlyph(st)}${st === "fix" ? "Fix" : st === "watch" ? "Watch" : "Good"} ${gc[st]}</button>`).join("")}</div>
      ${note}
      <div class="bl-grid" role="list">${list.length ? list.map(s => blTile(s, cue, PK)).join("") : `<div class="bl-empty">${BL.f === "kept" ? "No kept shots yet. Quick pick goes through them one at a time." : BL.f === "star" ? "No starred shots yet." : BL.g === "fix" ? "No Fix shots on this cue. Nice work." : "No shots match."}</div>`}</div>
      ${bar}
      ${BL.snack ? `<div class="bl-snack" role="status"><span>${esc(BL.snack)}</span><button data-bl="undo">Undo</button></div>` : ""}
      ${BL.pk ? (() => { const P = buPack(B, cue); return `<div class="bl-ask" data-bl="pkbg"><div role="dialog" aria-label="Coach pack"><b>Coach pack</b><p>${P.map(p => `${p.role}: shot ${p.s.n} (${esc((p.s.m.find(m => m.k === cue) || {}).v || "")})`).join(" · ")}</p><p style="white-space:pre-line;font-size:13px;opacity:.75;margin-top:-6px">${esc(buPackSummary(B, cue))}</p><label class="bl-sub" for="blPkQ" style="opacity:.9;margin-bottom:6px">What do you want your coach to look at?</label><textarea id="blPkQ" class="bl-sel" data-bl="pkq" rows="3" style="width:100%;padding:8px;min-height:80px;margin-bottom:12px" placeholder="e.g. My elbow drifts out late in sessions. Legs or set point?">${esc(BL.pk.q)}</textarea><div class="bl-bar"><button class="btn sec small" data-bl="pkno">Cancel</button><button class="btn pri small" data-bl="pknext"${BL.pk.q.trim() ? "" : " disabled"}>Next: send</button></div></div></div>`; })() : ""}
      ${BL.ask ? `<div class="bl-ask" data-bl="askbg"><div role="alertdialog" aria-label="${esc(BL.ask.t)}"><b>${esc(BL.ask.t)}</b><p>${esc(BL.ask.p)}</p><div class="bl-bar"><button class="btn sec small" data-bl="askno">Cancel</button><button class="btn small danger" data-bl="askyes">Delete video</button></div></div></div>` : ""}`;
    const g = BL.el.querySelector(".bl-grid");
    if (g && sy != null) g.scrollTop = sy;
    blThumbs();
  }

  /* thumbnails: one hidden video, one shot at a time, nearest the screen first */
  const TH = {};
  let thQ = [], thBusy = false, thVid = null;
  function blThumbs() {
    if (!BL) return;
    if (BL.io) BL.io.disconnect();
    const B = blCur(), by = {};
    for (const s of B.shots) by[s.id] = s;
    const io = BL.io = new IntersectionObserver(es => {
      for (const e of es) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        const s = by[e.target.dataset.th];
        if (s) thWant(s, e.target);
      }
    }, { root: BL.el.querySelector(".bl-grid"), rootMargin: "300px 0px" });
    BL.el.querySelectorAll("img[data-th]").forEach(img => { const u = TH[img.dataset.th]; if (u) { img.src = u; img.classList.add("on"); } else io.observe(img); });
  }
  function thWant(s, img) {
    if (TH[s.id]) { img.src = TH[s.id]; img.classList.add("on"); return; }
    thQ.push([s, img]);
    thRun();
  }
  async function thRun() {
    if (thBusy) return;
    thBusy = true;
    while (thQ.length && BL && BL.mode === "grid") {
      const [s, img] = thQ.pop();
      if (!img.isConnected && !TH[s.id]) continue;
      if (!TH[s.id]) {
        try {
          let b = await vtx("readonly", (m, bl) => rq(bl.get(s.id + ":th")));
          if (!b && s.v) { b = await thMake(s); if (b) await vtx("readwrite", (m, bl) => { bl.put(b, s.id + ":th"); }).catch(() => {}); }
          if (b && !TH[s.id]) TH[s.id] = URL.createObjectURL(b);
        } catch (e) {}
      }
      const live = TH[s.id] && BL && BL.el.querySelector(`img[data-th="${s.id}"]`);
      if (live) { live.onload = () => live.classList.add("on"); live.src = TH[s.id]; }
    }
    thBusy = false;
  }
  async function thMake(s) {
    const url = await burstShotUrl(s);
    if (!url) return null;
    const v = thVid || (thVid = Object.assign(document.createElement("video"), { muted: true, playsInline: true, preload: "auto" }));
    v.src = url;
    if (v.readyState < 2) await buOnce(v, "loadeddata", 3000);
    const t = Math.max(s.a || 0, Math.min(s.r || 0, (s.b || 1) - .05));
    await buSeekTo(v, t);
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw) return null;
    const W = 180, H = 204, c = document.createElement("canvas");
    c.width = W; c.height = H;
    let ch = vh, cw = ch * W / H;
    if (cw > vw) { cw = vw; ch = cw * H / W; }
    let cx = (vw - cw) / 2, cy = (vh - ch) / 2, lm = null, k = 1;
    const pf = await burstShotFrames(s);
    if (pf && pf.f && pf.cw) {
      k = vw / pf.cw;
      const i = Math.round((t - pf.t0) * pf.fps);
      for (let d = 0; d < 4 && !lm; d++) lm = unpack(pf.f[i - d] || null) || unpack(pf.f[i + d] || null);
      const P = lm ? lm.filter(p => p && p.v > .3) : [];
      if (P.length > 4) { // crop to the shooter, with room around
        const xs = P.map(p => p.x * k), ys = P.map(p => p.y * k);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        ch = Math.min(vh, Math.max((y1 - y0) * 1.3, (x1 - x0) * 1.3 * H / W, vh * .3)); cw = ch * W / H;
        if (cw > vw) { cw = vw; ch = cw * H / W; }
        cx = Math.max(0, Math.min(vw - cw, (x0 + x1) / 2 - cw / 2)); cy = Math.max(0, Math.min(vh - ch, (y0 + y1) / 2 - ch / 2));
      }
    }
    const g = c.getContext("2d");
    g.drawImage(v, cx, cy, cw, ch, 0, 0, W, H);
    if (lm) {
      g.lineCap = "round"; g.lineWidth = 2; g.strokeStyle = "rgba(255,255,255,.8)";
      const X = p => (p.x * k - cx) * W / cw, Y = p => (p.y * k - cy) * H / ch;
      for (const [a, b] of BONES) { const A = lm[a], Z = lm[b]; if (!A || !Z || A.v < .3 || Z.v < .3) continue; g.beginPath(); g.moveTo(X(A), Y(A)); g.lineTo(X(Z), Y(Z)); g.stroke(); }
    }
    return new Promise(r => c.toBlob(r, "image/jpeg", .72));
  }

  /* hold a tile to start selecting */
  function blPress(e) {
    const t = e.target.closest("[data-bl^='t:']");
    if (t && BL && BL.mode === "grid") {
      clearTimeout(BL.hold);
      BL.held = false;
      const up = () => { clearTimeout(BL && BL.hold); t.removeEventListener("pointerup", up); t.removeEventListener("pointerleave", up); t.removeEventListener("pointercancel", up); };
      t.addEventListener("pointerup", up); t.addEventListener("pointerleave", up); t.addEventListener("pointercancel", up);
      BL.hold = setTimeout(() => {
        if (!BL) return;
        BL.held = true;
        const id = t.dataset.bl.slice(2);
        if (!BL.selOn) { BL.selOn = true; BL.sel.clear(); }
        if (BL.sel.has(id)) BL.sel.delete(id); else BL.sel.add(id);
        try { navigator.vibrate?.(15); } catch (er) {}
        blDraw();
      }, 500);
      return;
    }
    if (BL && BL.mode === "pick" && e.target.closest(".qp-card")) qpDrag(e);
  }
  function blChange(e) {
    const s = e.target.closest("[data-bl]");
    if (!s || !BL || (s.dataset.bl !== "cue" && s.dataset.bl !== "sort")) return;
    if (s.dataset.bl === "cue") { BL.cue = s.value; BL.g = null; const B = blCur(); if (B) { B.cue = s.value; persist(); } }
    if (s.dataset.bl === "sort") BL.sort = s.value;
    const g = BL.el.querySelector(".bl-grid");
    if (g) g.scrollTop = 0;
    blDraw();
  }
  // soft delete: the videos go when the Undo note closes (or the library does)
  function blSoftDel(B, shots, what) {
    if (BL.pend) blFlush(BL);
    const P = shots.map(s => [s, s.v]);
    for (const s of shots) { s.v = null; s.gone = 1; }
    persist();
    BL.sel.clear(); BL.selOn = false;
    BL.pend = { P, timer: setTimeout(() => blFlush(BL && BL.pend && BL.pend.P === P ? BL : null), 6000) };
    BL.snack = what;
    blDraw();
  }
  function blFlush(my) {
    const p = my && my.pend;
    if (!p) return;
    clearTimeout(p.timer);
    my.pend = null; my.snack = null;
    buDrop(p.P.map(x => x[1]), []).then(() => loadVids());
    if (BL === my) blDraw();
  }
  async function blClick(e) {
    const b = e.target.closest("[data-bl]");
    if (!b || !BL || b.tagName === "SELECT") return;
    const [k, x] = b.dataset.bl.split(/:(.*)/), B = blCur();
    if (!B) return;
    if (BL.mode === "pick") return qpClick(k, x, B, b);
    const sel = () => B.shots.filter(s => BL.sel.has(s.id));
    if (k === "back") return blBack();
    if (k === "t") {
      if (BL.held) { BL.held = false; return; }
      if (BL.selOn) { if (BL.sel.has(x)) BL.sel.delete(x); else BL.sel.add(x); return blDraw(); }
      const j = B.shots.findIndex(s => s.id === x);
      BL.from = null;
      blFlush(BL);
      return burstOpen(B.id, j);
    }
    if (k === "f") { BL.f = BL.f === x && x !== "all" ? "all" : x; return blDraw(); }
    if (k === "g") { BL.g = BL.g === x ? null : x; return blDraw(); }
    if (k === "select") { BL.selOn = true; return blDraw(); }
    if (k === "all") { for (const s of blList(B, blCue(B))) BL.sel.add(s.id); return blDraw(); }
    if (k === "none") { BL.sel.clear(); return blDraw(); }
    if (k === "keep") {
      const S = sel(), on = !S.every(s => s.keep || s.star);
      for (const s of S) { s.keep = on; if (!on) s.star = false; } // unkeeping a starred shot unstars it: a star always keeps
      persist(); BL.snack = null; return blDraw();
    }
    if (k === "star") {
      const S = sel(), on = !S.every(s => s.star);
      for (const s of S) { s.star = on; if (on) s.keep = true; }
      persist(); return blDraw();
    }
    if (k === "send") { const S = sel().filter(s => s.v); if (S.length) { try { await sendShots(B, S); } catch (er) {} } return BL && blDraw(); }
    if (k === "del") {
      const S = sel().filter(s => s.v), T = S.filter(s => !s.keep && !s.star), kept = S.length - T.length;
      if (!T.length) { toast("Nothing deleted", kept ? "Every selected shot is kept. Unkeep them first." : "These shots have no video."); return; }
      BL.ask = { t: `Delete video for ${T.length} shot${T.length > 1 ? "s" : ""}?`, p: `${kept ? `${kept} kept shot${kept > 1 ? "s" : ""} won't be touched. ` : ""}Their numbers and form readings stay. You can undo for a few seconds.`, shots: T };
      return blDraw();
    }
    if (k === "free") {
      const PK = packOn() ? new Set(buPack(B).map(p => p.s.id)) : null, T = B.shots.filter(s => s.v && !blKept(s) && !(PK && PK.has(s.id))), nk = B.shots.filter(s => s.v && blKept(s)).length;
      if (!T.length) return;
      BL.ask = { t: `Free ${fmtMB(buBytes({ shots: T }, buSizes()))} now?`, p: `This deletes the video of the ${T.length} shot${T.length > 1 ? "s" : ""} with no ★ or Keep.${nk ? ` Your ${nk} kept shot${nk > 1 ? "s" : ""} stay.` : ""} Their numbers and form readings stay. You can undo for a few seconds.`, shots: T };
      return blDraw();
    }
    if (k === "askno" || (k === "askbg" && e.target === b)) { BL.ask = null; return blDraw(); }
    if (k === "pack") { BL.pk = { q: "" }; blDraw(); const t = BL.el.querySelector("#blPkQ"); if (t) t.focus(); return; }
    if (k === "pkno" || (k === "pkbg" && e.target === b)) { BL.pk = null; return blDraw(); }
    if (k === "pknext") { const q = BL.pk.q, cue = blCue(B), P = buPack(B, cue); BL.pk = null; blDraw(); if (P.length) await buPackSend(B, cue, P, q); return BL && blDraw(); }
    if (k === "askyes") { const T = BL.ask.shots; BL.ask = null; return blSoftDel(B, T, `Video deleted for ${T.length} shot${T.length > 1 ? "s" : ""}`); }
    if (k === "undo") {
      const p = BL.pend;
      if (p) { clearTimeout(p.timer); for (const [s, v] of p.P) { s.v = v; delete s.gone; } persist(); BL.pend = null; }
      BL.snack = null; return blDraw();
    }
    if (k === "pick") { BL.mode = "pick"; BL.q = blList(B, blCue(B)).map(s => s.id); BL.qi = 0; BL.hist = []; BL.snack = null; blFlush(BL); return blDraw(); }
  }

  /* -- Quick pick: one shot at a time -- */
  function blStopQ(my) {
    if (!my) return;
    cancelAnimationFrame(my.raf);
    const v = my.el.querySelector(".qp-card video");
    if (v) { v.pause(); v.removeAttribute("src"); v.load(); }
  }
  function qpDraw(B) {
    blStopQ(BL);
    const ids = BL.q.filter(id => B.shots.some(s => s.id === id)), N = ids.length, cue = blCue(B);
    const nKept = B.shots.filter(blKept).length;
    const last = BL.hist[BL.hist.length - 1];
    const undo = last ? `<button class="btn sec small" data-bl="qundo">↶ Undo ${last.act} #${last.n}</button>` : `<button class="btn sec small" data-bl="qundo" disabled>↶ Undo</button>`;
    const order = `<select class="bl-sel" data-bl="qord" aria-label="Order" style="flex:0 0 auto;min-height:48px"><option value="n"${BL.sort === "n" ? " selected" : ""}>In order</option><option value="worst"${BL.sort === "worst" ? " selected" : ""}>Worst first</option><option value="best"${BL.sort === "best" ? " selected" : ""}>Best first</option></select>`;
    if (BL.qi >= N) {
      const exp = B.t + BU.KEEP_DAYS * 864e5, unk = B.shots.filter(s => s.v && !blKept(s)).length;
      BL.el.innerHTML = `<div class="lf-top"><button class="bl-ib" data-bl="qback" aria-label="Back to the library">${BLI.back}</button><div class="lf-title">Quick pick</div></div>
        <div class="qp-end"><b>That's all ${N}</b><p>${nKept} kept.${unk && Date.now() < exp ? ` The other ${unk} videos delete on ${esc(buDay(exp))}; their numbers stay.` : ""}</p></div>
        <div class="bl-bar">${undo}<button class="btn pri small" data-bl="qback">Back to library</button></div>`;
      return;
    }
    const s = B.shots.find(y => y.id === ids[BL.qi]), st = blSt(s, cue) || worstOf(s);
    const ms = s.m.slice().sort((a, b) => (b.k === cue) - (a.k === cue));
    BL.el.innerHTML = `<div class="lf-top"><button class="bl-ib" data-bl="qback" aria-label="Back to the library">${BLI.back}</button><div class="lf-title">Shot ${s.n} <span style="opacity:.7">· ${BL.qi + 1} of ${N}</span><span class="bl-sub">${nKept} kept${s.star ? " · ★ starred" : s.keep ? " · kept" : ""}</span></div>${order}</div>
      <div class="qp-card" data-swipe="1"><span class="qp-no ${st}">${s.n}</span><button class="qp-rate" data-bl="qrate">${BL.rate === 1 ? "1×" : BL.rate === .5 ? "½×" : "¼×"}</button>
        ${s.v ? `<video playsinline muted loop=""></video><canvas></canvas>` : `<div class="bu-none">${BLI.gone.replace("<svg", '<svg style="width:36px;height:36px;display:block;margin:0 auto 6px"')}${s.gone ? "This shot's video was deleted." : "No video for this shot."} Its numbers are below.</div>`}
        <span class="qp-stamp k">Keep</span><span class="qp-stamp s">Skip</span></div>
      <div class="bu-m" style="padding-top:8px">${ms.map(m => `<span class="${m.st}">${buGlyph(m.st)}${esc(m.l)} · ${esc(m.v)}</span>`).join("")}</div>
      <div class="qp-mm"><span style="opacity:.75">Did it go in?</span><button class="bl-chip" data-bl="mk:1" aria-pressed="${s.mk === 1}">✓ Make</button><button class="bl-chip" data-bl="mk:0" aria-pressed="${s.mk === 0}">✗ Miss</button></div>
      <div class="qp-act"><button class="btn sec" data-bl="qskip">✕ Skip</button><button class="btn st" data-bl="qstar" aria-pressed="${!!s.star}" aria-label="Star">${BLI.star}</button><button class="btn pri" data-bl="qkeep">Keep ✓</button></div>
      <div class="bl-bar" style="border:0">${undo}</div>
      ${BL.snack ? `<div class="bl-snack" role="status" style="bottom:calc(150px + env(safe-area-inset-bottom,0px))"><span>${esc(BL.snack)}</span><button data-bl="qundo">Undo</button></div>` : ""}`;
    BL.qs = s;
    if (s.v) qpPlay(s);
    clearTimeout(BL.snT);
    if (BL.snack) BL.snT = setTimeout(() => { if (BL && BL.snack) { BL.snack = null; const n = BL.el.querySelector(".bl-snack"); if (n) n.remove(); } }, 2500);
  }
  async function qpPlay(s) {
    const my = BL, box = my.el.querySelector(".qp-card"), v = box && box.querySelector("video");
    if (!v) return;
    const url = await burstShotUrl(s), pf = await burstShotFrames(s);
    if (BL !== my || my.qs !== s || !v.isConnected) return;
    if (!url) { box.querySelector("canvas").remove(); v.remove(); return; }
    v.src = url;
    if (v.readyState < 1) await buOnce(v, "loadedmetadata", 4000);
    if (BL !== my || my.qs !== s) return;
    try { v.currentTime = s.a || 0; } catch (e) {}
    v.playbackRate = my.rate;
    v.play().catch(() => {});
    const p = { s, v, cv: box.querySelector("canvas"), box, pf };
    const tick = () => {
      if (BL !== my || my.qs !== s || !v.isConnected) return;
      my.raf = requestAnimationFrame(tick);
      if (v.currentTime >= s.b - .02 || v.currentTime < s.a - .3) v.currentTime = s.a;
      buSkel(p, v.currentTime);
    };
    tick();
  }
  function qpDo(act) {
    const B = blCur(), s = BL.qs;
    if (!B || !s) return;
    BL.hist.push({ id: s.id, n: s.n, act: act === "keep" ? "keep" : act === "star" ? "star" : "skip", was: { keep: s.keep, star: s.star }, qi: BL.qi });
    if (act === "keep") s.keep = true;
    if (act === "star") { s.star = true; s.keep = true; }
    persist();
    try { if (act !== "skip") navigator.vibrate?.(12); } catch (e) {}
    BL.snack = act === "skip" ? null : `${act === "star" ? "Starred" : "Kept"} #${s.n}`;
    const card = BL.el.querySelector(".qp-card");
    BL.qi++;
    if (card && !blRM) {
      const dir = act === "skip" ? -1 : 1;
      card.style.transition = "transform .18s cubic-bezier(.4,0,.2,1), opacity .18s";
      card.style.transform = `translateX(${dir * 120}%) rotate(${dir * 8}deg)`;
      card.style.opacity = "0";
      setTimeout(() => BL && BL.mode === "pick" && blDraw(), 170);
    } else blDraw();
  }
  function qpClick(k, x, B, b) {
    const s = BL.qs;
    if (k === "qback") { blStopQ(BL); BL.mode = "grid"; BL.snack = null; return blDraw(); }
    if (k === "qskip") return qpDo("skip");
    if (k === "qkeep") return qpDo("keep");
    if (k === "qstar") { if (s && s.star) { s.star = false; persist(); return blDraw(); } return qpDo("star"); }
    if (k === "mk" && s) { const m = +x; s.mk = s.mk === m ? undefined : m; if (s.mk === undefined) delete s.mk; persist(); b.parentNode.querySelectorAll(".bl-chip").forEach(c => c.setAttribute("aria-pressed", c === b && s.mk === m)); return; }
    if (k === "qrate") { BL.rate = BL.rate === .5 ? .25 : BL.rate === .25 ? 1 : .5; const v = BL.el.querySelector(".qp-card video"); if (v) v.playbackRate = BL.rate; b.textContent = BL.rate === 1 ? "1×" : BL.rate === .5 ? "½×" : "¼×"; return; }
    if (k === "qundo") {
      const h = BL.hist.pop();
      if (!h) return;
      const t = B.shots.find(y => y.id === h.id);
      if (t) { t.keep = h.was.keep; t.star = h.was.star; persist(); }
      BL.qi = h.qi; BL.snack = null;
      return blDraw();
    }
  }
  // the order picker in Quick pick re-sorts what's left, from the current shot on
  document.addEventListener("change", e => {
    if (!BL || BL.mode !== "pick" || !e.target.matches || !e.target.matches("[data-bl='qord']")) return;
    e.stopPropagation();
    const B = blCur(), done = BL.q.slice(0, BL.qi);
    BL.sort = e.target.value;
    BL.q = done.concat(blList(B, blCue(B)).map(s => s.id).filter(id => !done.includes(id)));
    blDraw();
  }, true);
  // swipe the video right to keep, left to skip; not from the screen edges, which Android keeps for Back
  function qpDrag(e) {
    const card = e.target.closest(".qp-card");
    if (!card || e.target.closest("button") || e.clientX < 28 || e.clientX > innerWidth - 28) return;
    const x0 = e.clientX, y0 = e.clientY, W = card.clientWidth, K = card.querySelector(".qp-stamp.k"), Sk = card.querySelector(".qp-stamp.s");
    let dx = 0, lock = null, buzz = false;
    try { card.setPointerCapture(e.pointerId); } catch (er) {}
    const mv = ev => {
      dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      if (!lock && Math.hypot(dx, dy) > 10) lock = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (lock !== "x") return;
      card.style.transition = "none";
      card.style.transform = blRM ? "" : `translateX(${dx}px) rotate(${Math.max(-8, Math.min(8, dx / 20))}deg)`;
      const f = Math.min(1, Math.abs(dx) / (W * .3));
      if (K) K.style.opacity = dx > 0 ? f : 0;
      if (Sk) Sk.style.opacity = dx < 0 ? f : 0;
      if (f >= 1 && !buzz) { buzz = true; try { navigator.vibrate?.(8); } catch (er) {} }
      if (f < 1) buzz = false;
    };
    const up = ev => {
      card.removeEventListener("pointermove", mv); card.removeEventListener("pointerup", up); card.removeEventListener("pointercancel", up);
      if (lock === "x" && ev.type === "pointerup" && Math.abs(dx) >= W * .3) { BL.held = true; return qpDo(dx > 0 ? "keep" : "skip"); }
      card.style.transition = blRM ? "none" : "transform .24s cubic-bezier(.2,.9,.3,1.2)";
      card.style.transform = "";
      if (K) K.style.opacity = 0;
      if (Sk) Sk.style.opacity = 0;
    };
    card.addEventListener("pointermove", mv); card.addEventListener("pointerup", up); card.addEventListener("pointercancel", up);
  }

  /* -- cleanup: unkept shot video goes 14 days after filming; burst videos no shot points at go too -- */
  async function buSweep() {
    const now = Date.now(), vids = [], ids = [];
    for (const B of buList()) {
      if (now - B.t < BU.KEEP_DAYS * 864e5) continue;
      const pk = packOn() ? new Set(buPack(B).map(p => p.s.id)) : null; // the coach pack's shots stay
      for (const s of B.shots) if (s.v && !s.star && !s.keep && !s.sent && !(pk && pk.has(s.id)) && !buSesUses(s.v)) { vids.push(s.v); ids.push(s.id); s.v = null; s.gone = 1; }
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
  // the fold's rows use only theme tokens (surface-2, line, ink, muted), so they read in light and dark alike
  const bfst = document.createElement("style");
  // light theme: dark text on the orange accent (white on #E2601A is 3.5:1, too low for button labels; this is 5.4:1, as in dark)
  bfst.textContent = `:root{--accent-ink:#1A0C03}
.bf-feat{display:flex;flex-direction:column;gap:10px;margin:2px 0 12px;padding:14px;border-radius:14px;background:var(--surface-2);border:1px solid var(--line);color:var(--ink)}
.bf-feat .bf-top{display:flex;gap:12px;align-items:center}
.bf-th{flex:none;width:56px;height:64px;border-radius:10px;overflow:hidden;background:var(--bg);border:1px solid var(--line);position:relative;display:flex;align-items:center;justify-content:center;color:var(--muted)}
.bf-th img{width:100%;height:100%;object-fit:cover;display:block;position:absolute;inset:0}.bf-th svg{width:24px;height:24px;fill:currentColor}
.bf-th b{position:absolute;right:3px;bottom:3px;z-index:1;font:700 12px var(--display);background:rgba(5,8,15,.8);color:#F2F5FA;border-radius:6px;padding:0 5px}
.bf-tx{flex:1;min-width:0}.bf-tx b{display:block;font:700 19px/1.15 var(--display);text-transform:uppercase}.bf-tx span{display:block;font-size:13.5px;color:var(--muted);margin-top:2px}
.bf-gb{display:flex;height:10px;border-radius:5px;overflow:hidden;gap:2px}.bf-gb i{display:block}.bf-gb .fix{background:#E0533F}.bf-gb .watch{background:#E8A317}.bf-gb .good{background:#2FB377}
.bf-gl{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:13px;color:var(--ink)}.bf-gl span{display:flex;align-items:center;gap:5px}
.bf-feat .btn{width:100%;display:flex;align-items:center;justify-content:center;gap:8px}.bf-feat .btn svg{width:18px;height:18px;fill:currentColor}
.bf-lab{font:700 14px var(--display);text-transform:uppercase;letter-spacing:.03em;color:var(--muted);margin:14px 0 6px}
.bf-row{display:flex;align-items:center;gap:12px;width:100%;min-height:72px;padding:8px 10px;margin:0 0 6px;border-radius:14px;border:1px solid var(--line);background:var(--surface-2);color:var(--ink);font:inherit;text-align:left}
.bf-row .bf-th{width:48px;height:54px}.bf-row .bf-tx b{font-size:17px}
.bf-row>svg.chev{flex:none;width:20px;height:20px;color:var(--muted)}
.bf-row:active,.bf-feat .btn:active,.bf-sw:active{transform:scale(.98)}
.bf-row:focus-visible,.bf-sw:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.bf-sw{display:flex;align-items:center;gap:12px;width:100%;min-height:64px;padding:10px 12px;margin:12px 0 0;border-radius:14px;border:1px solid var(--line);background:var(--surface-2);color:var(--ink);font:inherit;text-align:left}
.bf-sw[aria-checked="true"]{border:2px solid var(--accent);padding:9px 11px}
.bf-sw .bf-tx b{font:600 16px/1.25 var(--body,inherit);text-transform:none}.bf-sw .bf-tx span{font-size:13px}
.bf-sw .k{flex:none;width:48px;height:30px;border-radius:15px;background:#7A869E;position:relative}
.bf-sw .k::after{content:"";position:absolute;left:4px;top:4px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:left .18s}
.bf-sw[aria-checked="true"] .k{background:var(--accent)}.bf-sw[aria-checked="true"] .k::after{left:22px}
.bf-how{margin-top:12px;border-top:1px solid var(--line);padding-top:6px}.bf-how summary{min-height:44px;display:flex;align-items:center;font-weight:600;cursor:pointer;color:var(--ink)}
.bf-how p{font-size:14px;margin:4px 0 8px;color:var(--muted)}
.bf-how summary{justify-content:space-between;list-style:none}.bf-how summary::-webkit-details-marker{display:none}.bf-how summary::after{content:"";width:9px;height:9px;border:solid var(--muted);border-width:0 2.4px 2.4px 0;transform:rotate(45deg);margin-right:6px}.bf-how[open] summary::after{transform:rotate(-135deg)}
@media (prefers-reduced-motion:reduce){.bf-sw .k::after{transition:none}.bf-row:active,.bf-feat .btn:active,.bf-sw:active{transform:none}}`;
  document.head.appendChild(bfst);
  const BFCHEV = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const buWhere = B => B.src === "clip" ? "From a clip" : B.view === "behind" ? (B.front ? "From the front" : "From behind") : "From the side";
  const buThumbShot = B => B.shots.find(s => s.star) || B.shots.find(s => s.keep) || B.shots[0];
  function buSection() {
    const L = buList().slice().sort((a, b) => b.t - a.t), sz = buSizes(), tot = Object.values(sz).reduce((a, b) => a + b, 0);
    const th = B => { const s = buThumbShot(B); return `<span class="bf-th" aria-hidden="true">${BLI.grid}${s ? `<img data-fth="${s.id}" alt="" hidden>` : ""}<b>${B.shots.length}</b></span>`; };
    const days = B => Math.ceil((B.t + BU.KEEP_DAYS * 864e5 - Date.now()) / 864e5);
    const feat = B => {
      const n = B.shots.length, cue = buFocus(B), gc = { fix: 0, watch: 0, good: 0 };
      for (const s of B.shots) { const st = blSt(s, cue); if (st) gc[st]++; }
      const lab = (B.shots.flatMap(s => s.m).find(m => m.k === cue) || {}).l || "";
      const kept = B.shots.filter(blKept).length, st = B.shots.filter(s => s.star).length, d = days(B), unk = B.shots.filter(s => s.v && !blKept(s)).length;
      const g = gc.fix + gc.watch + gc.good;
      return `<div class="bf-feat"><div class="bf-top">${th(B)}<div class="bf-tx"><b>${esc(buDay(B.t))} · ${n} shot${n > 1 ? "s" : ""}</b><span>${esc(buWhere(B))}${lab ? ` · Focus: ${esc(lab)}` : ""}</span></div></div>
        ${g ? `<div class="bf-gb" aria-hidden="true">${["fix", "watch", "good"].map(k => gc[k] ? `<i class="${k}" style="flex:${gc[k]}"></i>` : "").join("")}</div>
        <div class="bf-gl">${["fix", "watch", "good"].map(k => `<span>${buGlyph(k)}${k === "fix" ? "Fix" : k === "watch" ? "Watch" : "Good"} ${gc[k]}</span>`).join("")}</div>` : ""}
        <div class="bf-gl" style="color:var(--muted)"><span>${kept} kept${st ? ` · ★ ${st}` : ""}</span>${unk && d > 0 ? `<span style="${d <= 3 ? "color:var(--accent);font-weight:700" : ""}">${unk} video${unk > 1 ? "s" : ""} clear in ${d} day${d > 1 ? "s" : ""}</span>` : ""}</div>
        <button class="btn pri" data-buf="open:${B.id}">${BLI.grid}Review shots</button></div>`;
    };
    const row = B => {
      const n = B.shots.length, st = B.shots.filter(s => s.star).length, kept = B.shots.filter(blKept).length, mb = buBytes(B, sz);
      return BF.free
        ? `<div class="bf-row">${th(B)}<div class="bf-tx"><b>${esc(buDay(B.t))} · ${n} shot${n > 1 ? "s" : ""}</b><span>${mb ? fmtMB(mb) : "No video"}</span></div>${mb ? `<button class="btn sec small" data-buf="del:${B.id}">${BF.ask === B.id ? "Tap again" : "Delete videos"}</button>` : ""}</div>`
        : `<button class="bf-row" data-buf="open:${B.id}" aria-label="Open the shot library for ${esc(buDay(B.t))}, ${n} shots">${th(B)}<div class="bf-tx"><b>${esc(buDay(B.t))} · ${n} shot${n > 1 ? "s" : ""}</b><span>${esc(buWhere(B))}${kept ? ` · ${kept} kept` : ""}${st ? ` · ★${st}` : ""}${mb ? " · " + fmtMB(mb) : ""}</span></div>${BFCHEV}</button>`;
    };
    const list = BF.free ? L.slice().sort((a, b) => buBytes(b, sz) - buBytes(a, sz)) : L.slice(1, 10);
    const per = L.length ? Math.round(tot / Math.max(1, L.reduce((a, B) => a + B.shots.filter(s => s.v).length, 0)) * 5) : 0;
    const body = `${L.length && !BF.free ? feat(L[0]) : ""}
      ${!L.length ? `<p class="small" style="margin:0 0 4px">Turn on <b>Keep video</b> in Live form check and each shot keeps its own few seconds of video, so you can review the session here.</p>` : ""}
      ${list.length ? `<div class="bf-lab">${BF.free ? "Sessions by size" : "Earlier sessions"}</div>${list.map(row).join("")}` : ""}
      ${tot ? `<p class="small muted" style="margin:12px 0 0">Shot videos use ${fmtMB(tot)}${CO.usage ? ` of the ${fmtMB(CO.usage)} the app uses on this phone` : ""}. Video for shots with no ★ or Keep clears 14 days after filming. The numbers stay.</p>
      <button class="btn sec small" data-buf="free" style="margin-top:8px">${BF.free ? "Done" : "Free up space"}</button>` : ""}
      <button class="bf-sw" role="switch" data-buf="pack" aria-checked="${packOn()}"><div class="bf-tx"><b>Coach pack</b><span>Keep 5 clips from every session for your coach, even after the other videos clear.</span><span style="color:var(--ink);font-weight:600">${packOn() ? `On${per ? ` · about ${fmtMB(per)} a session` : ""}` : "Off · videos clear after 14 days"}</span></div><span class="k" aria-hidden="true"></span></button>
      <details class="bf-how"><summary>How your sessions work</summary>
        <p>Turn on <b>Keep video</b> in Live form check and each shot keeps its own few seconds of video, with its numbers. Only the shots are saved, never the time in between. A clip longer than ${BU.CLIP_MIN} s picked above is split into its shots the same way.</p>
        <p>At a Shoot360, prop the phone behind you in the lane, or straight in front of you under the basket. Live form check asks where before you start.</p>
        <p>Coach pack picks, on your focus cue: your best, a typical and your worst shot, plus a typical early and late one.</p></details>`;
    setTimeout(buFormThumbs, 0);
    return `<section>${fold("bursts", "Your sessions", L.length ? `${L.length} session${L.length > 1 ? "s" : ""}${tot ? " · " + fmtMB(tot) : ""}` : "None yet", body, !!L.length)}</section>`;
  }
  async function buFormThumbs() {
    for (const img of document.querySelectorAll("img[data-fth]")) {
      const id = img.dataset.fth;
      try {
        if (!TH[id]) { const b = await vtx("readonly", (m, bl) => rq(bl.get(id + ":th"))); if (b) TH[id] = URL.createObjectURL(b); }
        if (TH[id] && img.isConnected) { img.src = TH[id]; img.hidden = false; }
      } catch (e) {}
    }
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
    if (k === "open") return burstLib(id);
    if (k === "free") { BF.free = !BF.free; BF.ask = null; return render(); }
    if (k === "pack") { S.settings.coachPack = !packOn(); persist(); return render(); }
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
