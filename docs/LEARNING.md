# How this app is built (and how to do it yourself)

This is a running guide to how the Hoops Ladder web prototype becomes an Android app on Google Play.
Each step says what was done, why, and the exact commands, so you can redo it on your own machine.
New steps get added as the app grows.

## What you need on your computer

| Tool | Why | Get it |
|---|---|---|
| Node.js 22 | Runs the Capacitor CLI and the import script | nodejs.org |
| Android Studio | Includes the Android SDK, an emulator, and a JDK | developer.android.com/studio |
| JDK 21 | Gradle (the Android build tool) runs on Java. Android Studio ships one | bundled |
| An Android phone with USB debugging on | Fastest way to try the camera and mic | Settings → About phone → tap Build number 7 times → Developer options → USB debugging |

Then, once:

```bash
git clone https://github.com/loyeleye/hoops-ladder && cd hoops-ladder
npm ci                 # installs exact versions from package-lock.json
npx cap sync android   # copies www/ into the Android project
npx cap open android   # opens Android Studio; press Run ▶ with your phone plugged in
```

---

## Step 1. Capacitor: a native shell around the web app

**The idea.** Capacitor generates a normal Android Studio project (`android/`). Its only screen,
`MainActivity`, is a full-screen **WebView**: Chrome's rendering engine without the browser UI.
Your HTML, JS, WASM and images ship *inside* the app under `android/app/src/main/assets/public/`
and are served from `https://localhost`. That address counts as a *secure context*, which is what
lets `getUserMedia()` (camera, mic) and WebAssembly work exactly like on a real website.

A **bridge** connects the two worlds: JavaScript can call Java/Kotlin code ("plugins"), and native
code can send events back to JavaScript. Anything the web can't do on its own (volume buttons,
lock-screen controls) goes through a plugin.

**What was run:**

```bash
npm init -y
npm i @capacitor/core @capacitor/android      # runtime pieces that ship in the app
npm i -D @capacitor/cli                        # the `cap` command, only used while building
npx cap add android                            # generates android/ from capacitor.config.json
```

`capacitor.config.json` holds the app's identity:

- `appId: com.ladioyeleye.hoopsladder`: the **application ID**. Google Play uses it as the app's
  permanent identity. It can never change after the first upload.
- `webDir: www`: the folder Capacitor copies into the app on every `npx cap sync`.
- `SystemBars.insetsHandling: native` with `viewport-fit=cover`: the page draws edge to edge,
  under the status bar and gesture bar. The CSS already pads itself with `env(safe-area-inset-*)`,
  and Capacitor makes sure those values are correct on older Android WebViews.

**What's committed and what isn't.** `android/` is committed, because you'll edit native files in it
(the manifest, `MainActivity`, Gradle). The copy of `www/` inside it
(`android/app/src/main/assets/public`) is *not* committed. `npx cap sync` regenerates it, and
`android/.gitignore` already excludes it.

## Step 2. Making the single-file prototype work offline

The prototype was built to run as a page hosted on claude.ai. Four things had to change for it to
run inside an app with no network. They're all done by one script, so the prototype can keep
evolving and be re-imported:

```bash
npm run import-prototype -- /path/to/hoops-app    # rebuilds www/ from scratch
```

[`tools/import_prototype.mjs`](../tools/import_prototype.mjs) does this:

1. **Document skeleton.** Claude pages add `<!doctype html>`, `<head>` and the viewport meta when
   they publish. A real app page needs its own. The script adds them, including
   `viewport-fit=cover` (see Step 1).
2. **Fonts.** Saira Condensed and Barlow were loaded from Google Fonts over the network. Now the
   `.woff2` files come from the `@fontsource` npm packages (SIL Open Font License, free to ship in
   an app), are copied into `www/fonts/`, and a generated `fonts.css` declares them with `@font-face`.
3. **Pose model.** MediaPipe's pose model was stored as base64 *text* (`pose_lite.b64.txt`, 7.3 MB)
   because Claude pages can only fetch text easily. The script decodes it back to the binary
   `pose_landmarker_lite.task` (5.8 MB). The page now fetches it as an `ArrayBuffer` and passes it to
   `PoseLandmarker.createFromOptions({ baseOptions: { modelAssetBuffer } })`. `FilesetResolver` still
   loads the WASM runtime from the local `wasm/` folder (two builds: with SIMD for modern phones,
   without SIMD as a fallback).
4. **Step GIFs.** The page loads drill images from `anim/`. The script copies only the GIFs the page
   actually references.

Each text patch must match **exactly once**, or the script stops with an error. That's deliberate:
if the prototype changes shape, you find out immediately instead of shipping a half-patched page.

**Features that only worked on claude.ai.** "Ask the coach" and cross-device sync use
`window.claude`, which only exists on Claude pages. The prototype already checks for it
(`if(!window.claude?.use)return`), so in the app the coach button stays hidden and progress is
saved on the phone only. Bringing either back needs a small server; that's a later decision.

**How it was checked.** `www/` was served locally and opened in headless Chromium at phone size.
No requests left `localhost`, all fonts loaded, and the pose model loaded and ran a detection.

## Step 3. Camera and mic permissions

Android needs two things before a WebView can use the camera or mic:

1. **Declared permissions** in `android/app/src/main/AndroidManifest.xml`:
   - `CAMERA`: live form analysis and recording clips.
   - `RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS`: voice commands and beat matching. Chromium's WebView
     needs both for audio capture.
   - `VIBRATE`: `navigator.vibrate()` silently does nothing in a WebView without it.
   - `uses-feature ... required="false"` for camera and mic, so Play still offers the app to devices
     without them.
2. **A runtime prompt.** Camera and mic are "dangerous" permissions, so the user must also approve
   them while the app runs. When the page calls `getUserMedia()`, the WebView asks its
   `WebChromeClient.onPermissionRequest()`. Capacitor's built-in `BridgeWebChromeClient` turns that
   into the standard Android "Allow Hoops Ladder to take pictures and record video?" dialog. No
   extra code is needed.

## Step 4. Building the app

Android apps are built by **Gradle**. `android/gradlew` is a wrapper script that downloads the right
Gradle version on first use.

```bash
cd android
./gradlew assembleDebug    # → app/build/outputs/apk/debug/app-debug.apk (install on any phone)
./gradlew bundleRelease    # → app/build/outputs/bundle/release/app-release.aab (for Google Play)
```

- An **APK** is an installable package. A **debug** APK is signed with a throwaway key that Android
  Studio generates, so you can sideload it, but Play won't accept it.
- An **AAB** (Android App Bundle) is what Play requires. Play splits it into small APKs per device.
- `versionCode` (an integer) must go up with every upload to Play. `versionName` is what users see.
  Both come from environment variables in `android/app/build.gradle`. CI sets them from the run number.
- `targetSdkVersion` is 36 (Android 16). Play requires new apps and updates to target a recent
  Android version and raises the bar every August, so check it each year.

## Step 5. Signing and the automatic build (GitHub Actions)

**Signing.** Every app on Play is signed. With **Play App Signing** (the default), Google keeps the
real *app signing key*, and you sign uploads with your own *upload key*. If you lose the upload key,
Google can reset it. You create the upload key once:

```bash
keytool -genkey -v -keystore upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

On Windows, `keytool` isn't on the path by default. Use Android Studio's copy,
`& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" ...`, or install a JDK with
`winget install EclipseAdoptium.Temurin.21.JDK` and reopen PowerShell.

Keep `upload.jks` and its password somewhere safe, like a password manager. Never commit them;
`.gitignore` blocks `*.jks` as a guard.

**CI.** [`.github/workflows/android.yml`](../.github/workflows/android.yml) runs on every push and
pull request:

1. Checks out the code, sets up Node 22, Java 21 and Gradle (with caching).
2. `npm ci` then `npx cap sync android`.
3. Builds the debug APK and attaches it to the run. Open the run under the repo's **Actions** tab
   → **Artifacts** to download it and install it on your phone.
4. If the signing secrets exist, builds a **signed release AAB** and attaches it too.

To turn on step 4, add these under **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `UPLOAD_KEYSTORE_BASE64` | output of `base64 -w0 upload.jks` (macOS: `base64 -i upload.jks`; Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\upload.jks")) \| Set-Clipboard`) |
| `UPLOAD_KEYSTORE_PASSWORD` | the keystore password |
| `UPLOAD_KEY_ALIAS` | `upload` |
| `UPLOAD_KEY_PASSWORD` | the key password (often the same as the keystore password) |

The workflow writes the keystore to a temp file only for that run, and Gradle reads the path and
passwords from environment variables (see `signingConfigs` in `android/app/build.gradle`).

## Step 6. Google Play tracks (coming up)

You'll move the same `.aab` through three tracks in the Play Console:

1. **Internal testing**: up to 100 testers, available within minutes, no review. Use it to check
   each build on real phones.
2. **Closed testing**: new personal developer accounts must have at least 12 testers opted in for
   14 days in a row before they can apply for production.
3. **Production**: the public listing, after Google's review.

Before any track will take a build, the listing and the **App content** forms (steps 8 to 10) must be
filled in.

## Step 7. The Coach tab: training videos, dictation, saving and sharing

The prototype gained a **Coach** tab: take-home drill lists from a trainer (typed or spoken, with
YouTube links) and personal training videos. Videos must stay on the phone, never on a server.
Three things a browser does for free had to be swapped for native plugins inside the app.

**What was run:**

```bash
npm i @capacitor/filesystem @capacitor/share @capacitor-community/speech-recognition   # all MIT licensed
npm run import-prototype -- /path/to/hoops-app    # pull in the new Coach tab (Step 2)
npx cap sync android                              # registers the plugins with Gradle
```

`cap sync` wrote the plugins into `android/capacitor.settings.gradle` and
`android/app/capacitor.build.gradle`. Those two files are generated, so never edit them by hand.

**Where the videos live.** Recordings go into IndexedDB (`hoopsLadder.videos`). That's the browser's
own database, kept inside the app's private storage. It's separate from the saved progress, so it is
never synced anywhere. Uninstalling the app deletes it, so the app offers **Save to phone**.

**1. Recording needs no plugin.** The page records with `getUserMedia()` and `MediaRecorder`, the same
web APIs as live form analysis. Camera and mic permissions are already in place (Step 3). If the
camera can't be opened, the page falls back to `<input type="file" accept="video/*" capture>`. That
opens the phone's own camera app, and Capacitor's WebView handles it too.

**2. Dictation needs a plugin.** Chrome on a phone has `webkitSpeechRecognition`, but Android's WebView
doesn't. `@capacitor-community/speech-recognition` calls Android's own speech recognizer instead. The
page checks for it in `window.Capacitor.Plugins.SpeechRecognition`, then:

- `requestPermissions()` shows the mic prompt.
- `start({ partialResults: true, popup: false })` listens without Google's popup.
- `partialResults` events give the words as they're heard.
- A `listeningState: stopped` event means Android ended the session after a pause. The page starts it
  again until the person taps Stop, so they can say a whole list.

The plugin's own manifest adds `RECORD_AUDIO` and a `<queries>` entry for
`android.speech.RecognitionService`. Since Android 11, an app can only see services it declares it
looks for. Gradle merges a plugin's manifest into the app's when it builds, so `AndroidManifest.xml`
didn't need editing.

**3. Saving and sharing need plugins.** A WebView ignores `<a download>` links, and it has no
`navigator.share()` for files. In the app:

- **Save to phone** writes the clip with `Filesystem.writeFile()` into `Documents/Hoops Ladder/`. If
  the phone refuses (Android 10 and older need a storage permission the app doesn't ask for), it
  opens the share sheet instead, so you can pick Files or Drive.
- **Send to coach** writes a copy into the app's cache folder and passes its `file://` address to
  `Share.share({ files: [uri] })`. Android's share sheet then lets you pick WhatsApp, Messages, Gmail
  and so on. Sharing a cache file to another app works through the `FileProvider` that's already in
  the manifest (`res/xml/file_paths.xml` allows the cache folder).

The bridge between JavaScript and Java passes text, not binary. So the clip is sent as base64, in
3 MB pieces (`writeFile` for the first, then `appendFile`), so a 5-minute video never becomes one
huge string in memory. Each piece is a multiple of 3 bytes, so the base64 pieces join without gaps.

**How the page tells where it's running.** `window.Capacitor.isNativePlatform()` is `true` only
inside the app. On claude.ai the same buttons use Claude's download prompt, and in a phone browser
they use a normal download link and the browser's share sheet. One page serves all three.

**How it was checked.** In headless Chromium with a fake camera, the page recorded clips, and the
plugins were stood in for by test doubles. A 7 MB clip was saved and shared in three pieces and came
back byte for byte. Dictated text landed in the drill box. The real plugins can only be tried on a
phone. With the debug APK from CI (Step 5), check these:

1. Coach → **Say them** asks for the mic, then types what you say.
2. **Record** asks for the camera, and the clip appears under My videos.
3. Open a clip → **Save to phone**, then look in the Files app under Documents › Hoops Ladder.
4. **Send to coach** opens the share sheet with the video attached.

## Step 8. A privacy policy, hosted on GitHub Pages

**Why.** Play requires a privacy policy URL for every app, and it matters more here because the app asks for the
camera and mic. It has to be a public web page (not a PDF or a Google Doc that needs sign-in) and it
has to match what the app really does. Reviewers compare it with the Data safety form.

**What it says.** [`site/privacy.html`](../site/privacy.html) is written from what the code actually does,
checked by searching `www/index.html` for anything that could send data:

```bash
grep -c "fetch(\|XMLHttpRequest\|WebSocket\|sendBeacon" www/index.html   # only fetch() is the local pose model
grep -n "localStorage" www/index.html                                     # progress is saved under "hoopsLadder.v1"
grep -n "window.claude" www/index.html                                    # sync and coach: hidden in the app
```

The page was also opened in headless Chromium with every request logged, and nothing left `localhost`.
The policy covers: what's stored on the phone, form checks (clips are read on-device, only the numbers
are kept), training videos (stored in the app, leaving only when you tap Save to phone or Send to coach),
the mic (video sound, plus voice commands and dictation through Android's speech recognizer, which is
Google's on most phones), the few outside links, Android backup, how to delete everything, and a promise
to update the page *before* releasing sync or an online coach.

**Hosting.** GitHub Pages serves static files from a repo for free, at
`https://<user>.github.io/<repo>/`. The site lives in `site/` and
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) publishes it whenever something in `site/`
changes on `main`:

1. `actions/upload-pages-artifact` packs `site/` into an archive.
2. `actions/deploy-pages` publishes it. It needs the `pages: write` and `id-token: write` permissions,
   which the workflow asks for.

**One-time setup (you do this once, in the browser):** repo **Settings → Pages → Build and deployment →
Source: GitHub Actions**. Then run the **Website** workflow from the **Actions** tab (or merge a change to
`site/`). The policy is then at https://loyeleye.github.io/hoops-ladder/privacy.html. Open it on your phone
to check, then paste that URL into Play Console.

## Step 9. Store listing, icon and screenshots

**Text.** [`store/listing.md`](../store/listing.md) has the app name (30 characters max), the short
description (80) and the full description (4,000), ready to paste. Everything in it is a feature the app
has today. Play rejects listings that promise features that aren't there, or that use other people's names
(real coaches, players, the NBA) to promote the app.

**Art.** One script renders all of it from the app itself, so it can be redone whenever the app changes:

```bash
npm i --no-save playwright && npx playwright install chromium   # once; not a project dependency
node tools/make_store_art.mjs
```

[`tools/make_store_art.mjs`](../tools/make_store_art.mjs):

1. Serves `www/` on a local port and opens it in headless Chromium at 360 × 740 CSS pixels with a
   `deviceScaleFactor` of 3, so screenshots come out 1080 × 2220, like a real phone.
2. Before the page loads, writes three weeks of **demo progress** into `localStorage`, so the screens show
   levels and a 3-point map instead of empty states.
3. Puts each screen inside a phone frame under a caption on a 1080 × 1920 canvas
   (`store/screenshots/phone-1..5.png`). Play wants 2 to 8 phone screenshots; 9:16 at 1080 px or more
   lets Play feature the app.
4. Draws the icon from [`store/art/icon.svg`](../store/art/icon.svg) (the ball inside the app's level ring)
   as the 512 × 512 Play icon and a 1024 × 500 feature graphic in `store/graphics/`.
5. Writes the **launcher icons** into `android/app/src/main/res/mipmap-*`, replacing Capacitor's default
   logo. Android has two kinds:
   - *Legacy* (Android 7 and older): `ic_launcher.png` and `ic_launcher_round.png`, the whole icon, at
     48 dp times each density (mdpi ×1 = 48 px up to xxxhdpi ×4 = 192 px).
   - *Adaptive* (Android 8+): `mipmap-anydpi-v26/ic_launcher.xml` stacks a background color
     (`values/ic_launcher_background.xml`, now the app's navy `#12203A`) under a transparent
     `ic_launcher_foreground.png` that's 108 dp square. Each launcher masks it to its own shape (circle,
     squircle, teardrop) and may move it for parallax, so only the middle 66 dp is guaranteed visible. The
     script scales the mark to fit inside that circle.

To change the icon, edit `store/art/icon.svg` and run the script again.

## Step 10. The App content forms

Under **Policy and programs → App content**, Play asks a set of questions about every app.
[`store/play_console_notes.md`](../store/play_console_notes.md) has the answer for each one and why:

- **Privacy policy**: the URL from step 8.
- **App access**: no login, everything is reachable.
- **Ads**: none.
- **Content rating**: the IARC questionnaire; all "No", which gives Everyone / PEGI 3.
- **Target audience**: 13 and up. Including under-13s brings in the Families policy and extra review.
- **Data safety**: "No data collected, no data shared". Data that's only processed on the phone doesn't
  count as collected. This answer has to change the day sync, the coach or crash reporting ships.
- **Health apps**: the fitness option; no Health Connect.

- **Foreground service permissions**: `mediaPlayback`, for logging reps with the volume buttons and the lock
  screen (step 11). Play asks for a sentence and a short video of it in use.

## Step 11. Hands-free logging: volume buttons, earbuds and the lock screen

**The problem.** Training alone, you can't keep walking back to the phone to tap. The web app already logs
quick-rep drills by the set, with a one-button map: **one press = miss, two presses (or a hold) = set done,
three presses = undo** (shot by shot it's one press = make, two = miss). A web page can't use the phone's
volume buttons or keep working with the screen locked, so this step adds a **custom native plugin**.

**The pieces** (all in `android/app/src/main/java/com/ladioyeleye/hoopsladder/remote/`):

| File | What it does |
|---|---|
| `HoopsRemotePlugin.java` | The plugin the page talks to: `start`, `update`, `stop`, and a `signal` event |
| `RemoteHub.java` | Where every button ends up. Only "armed" while the full-screen logger is open, so volume works normally everywhere else |
| `PressDecoder.java` | Turns presses into signals: waits 380 ms after a press to see if another follows, and treats a 600 ms hold as "set done" |
| `RepLoggerService.java` | A foreground service with a media session and the ongoing notification |
| `MainActivity.java` | `registerPlugin(...)` and `dispatchKeyEvent(...)` |

**How a button press travels.**

1. **Screen on, app in front.** Android hands every key to the activity first. `MainActivity.dispatchKeyEvent`
   gives volume and media keys to `RemoteHub`. Returning `true` means "handled", so the volume doesn't change.
2. **Screen locked.** The activity gets no keys, so `RepLoggerService` takes over. It owns a **MediaSession**,
   the same thing music apps use. Android sends earbud and Bluetooth media buttons to the active media session.
   The session also says its volume is controlled **remotely** (`setPlaybackToRemote`, the way a Chromecast
   works), so Android sends it the volume buttons too, even with the screen off, instead of changing the
   phone's volume. Each "volume up/down" request counts as one press.
3. **The notification and lock screen** show the drill, the set and the misses so far, with
   **Miss / Set done / Undo** buttons (**Make / Miss / Undo** shot by shot). Android 13 and newer build the
   lock-screen media card from the session's *custom actions*; older versions use the notification's actions.
   Both lead to the same `RemoteHub.emit(...)`.
4. The decoded signal goes to the page as a `signal` event. The page's existing `sig()` function does the rest.
   While the page can't be seen, the plugin also vibrates (two buzzes for a miss, one for set done, three for
   undo), so you can feel that it counted.

Decoding happens in Java, not in the page, because a page's timers slow down when the screen is off.

**Why a foreground service.** With the screen off, Android soon freezes apps that aren't doing anything
visible. A foreground service, which must show a notification, keeps the app running. Android 14 requires each
service to declare a **type**. This one is `mediaPlayback`, since it runs a media session and the app speaks
counts and beeps. Google Play asks you to explain each type in the Play Console (**App content → Foreground
service permissions**), usually with a short video. If Play rejects it, the fallback is the `specialUse` type
with a written reason.

**Permissions added to the manifest:** `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, and
`POST_NOTIFICATIONS`. On Android 13+ the app asks to show notifications the first time the logger opens. If you
say no, the volume buttons still work, but the notification and its lock-screen buttons stay hidden.

**Connecting it to the page without editing the prototype.** `www/index.html` is regenerated from the prototype,
so app-only code lives in [`native-web/native.js`](../native-web/native.js). The page's app code sits inside
one `(()=>{ ... })();` block, so its names (`S`, `R`, `openBig`, ...) are private to it. The import script pastes
`native.js` in just before that block's closing `})();`, where it can see those names. There it wraps four
functions: `openBig` (start the plugin), `closeBig` (stop it), `drawBig` (refresh the notification and reword the
hints) and `bigTop` (hide the web version's "Earbuds" toggle, since the buttons are always on in the app). In a
normal browser `Capacitor.isNativePlatform()` is false and the file does nothing.

**Calling a plugin from plain JavaScript.** Capacitor injects `window.Capacitor` into the WebView, and every
registered plugin appears under `Capacitor.Plugins`:

```js
const Remote = Capacitor.Plugins.HoopsRemote;
Remote.addListener("signal", e => sig(e.k));      // "a", "b" or "u"
await Remote.start({ mode: "sets", title: "Roll-Up Drill", text: "Set 1 · 0 missed" });
```

Plugins from npm (like Preferences in step 12) are registered by `npx cap sync`. A plugin that lives inside the
app must be registered by hand in `MainActivity.onCreate`, **before** `super.onCreate()`.

**Limits to know.**

- Hold to close a set only works with the screen on. With the screen locked Android reports volume presses with
  no "released" event, so use a double press there.
- Earbud buttons reach the app only while it's the last app that played sound. The app's beeps
  usually make that true; if another app played music since, start that set with a tap or the volume buttons.
- iPhone has no supported way to use the volume buttons. A $8 Bluetooth camera-shutter remote is the plan there.

**How it was checked.** `./gradlew assembleDebug lintDebug` builds with no lint issues. The page side was tested in
headless Chromium with a stand-in for the plugin: the logger starts it, signals log misses, undo and set done, the
notification text updates, and closing the logger stops it. It still needs a try on a real phone, with the screen
on and then locked.

## Step 12. Saving progress where the system won't clear it

The page saves your progress to `localStorage`. Capacitor recommends its
[Preferences plugin](https://capacitorjs.com/docs/apis/preferences) for anything you can't lose, because the
system can clear a WebView's storage to free space (mostly an iPhone problem, and the iPhone version will come
later). Preferences are stored in an ordinary app file (`SharedPreferences` on Android).

```bash
npm i @capacitor/preferences
npx cap sync android     # registers the plugin in the Android project
```

`native-web/native.js` wraps the page's `persist()` so every save also goes to Preferences. When the app starts,
the page loads `localStorage` straight away (so the first screen is instant), then reads Preferences and switches to
that copy if there is one. If you save something before Preferences answers, which takes a few milliseconds, the
newer in-memory progress wins. The first launch after this update copies existing progress into Preferences.

## Step 13. Automatic updates on your phone with Obtainium

[Obtainium](https://github.com/ImranR98/Obtainium) is an open-source Android app that watches a
GitHub repo's Releases and installs each new APK, so you get updates without Google Play.

**What CI does.** On every push to `main` (or a manual **Run workflow** on `main`), once the signing secrets from Step 5 exist,
[`android.yml`](../.github/workflows/android.yml) also builds a release APK signed with the upload
key and publishes it as a GitHub Release tagged `v0.1.<run number>` (matching the app's
`versionName`, so Obtainium reads the version correctly). Android only installs an update when it's
signed with the same key as the installed app. Debug APKs get a fresh random key on each CI
machine, which is why only the signed release APK is published.

**Set up the phone (once).**

1. Install Obtainium from its [GitHub Releases](https://github.com/ImranR98/Obtainium/releases) or
   F-Droid.
2. If you installed a debug APK from the Actions tab, uninstall it first: it has a different
   signature, so the release APK can't update it. This clears progress saved on the phone.
3. In Obtainium, tap **Add app**, paste `https://github.com/loyeleye/hoops-ladder`, then **Add**
   and **Install**. Or open `obtainium://add/https://github.com/loyeleye/hoops-ladder` on the phone.
4. Allow Obtainium to install apps when Android asks.
5. In Obtainium's **Settings**, turn on background update checks and pick how often to check.

**How automatic is it?** On Android 12 or newer, Obtainium installs updates in the background
without asking, as long as it installed the app itself (step 3) and the app targets a recent SDK
(ours targets 36). Some phones still show a prompt: Xiaomi/MIUI and a few others block silent
installs, and battery savers can delay the background check. On Android 11 or older, Obtainium
downloads the update and shows a notification you tap to install.

**Google Play later.** Play re-signs apps with Google's app signing key, so the Obtainium copy and
the Play copy have different signatures. Switching from one to the other means uninstalling first.
To keep both, give the Obtainium build its own `applicationId` (for example with a suffix).

## Step 14. Demo clips that play inside the app

The web version can't embed YouTube, so each drill part links to the right second of its source video and the
phone leaves the app. In the app, `native-web/native.js` catches a tap on any YouTube link (demo chips, drill
sources, links in your Coach lists) and opens a full-screen player sheet instead:

- **Starts at the clip's start and loops at its end.** The page's clip data (`CLIPS` and `STEP_CLIPS`) already
  has `[videoId, start, end, label]` for each part. The chips only carried the start (`&t=`), so `native.js`
  wraps `clipLinks()` to add a `data-end` attribute. Turn Loop off and the video plays on past the clip.
- **Half and three-quarter speed** through YouTube's own `setPlaybackRate`.
- **"YouTube app"** opens the full video outside the app, as before.
- **Offline**, the sheet says the clip needs a connection; the step animations still work.

**How it's built.** It uses YouTube's [IFrame Player API](https://developers.google.com/youtube/iframe_api_reference):
the first clip loads `https://www.youtube.com/iframe_api`, then each clip is a `YT.Player` on the
privacy-enhanced `youtube-nocookie.com` host. The loop is a 200 ms timer that seeks back to the start once
`getCurrentTime()` passes the end, so it also catches someone scrubbing past the end. A drill timer that's
running pauses when you open a clip, as it did for the old links.

**One Android change.** Capacitor sends any page load on another site out to the browser, which is right for the
app's own page but would break the YouTube iframe as it loads. `MainActivity` swaps in a `BridgeWebViewClient`
that lets loads *inside a frame* (`!request.isForMainFrame()`) stay put, and keeps the old behavior for the
page itself.

**Why no mirror button.** Mirroring would mean flipping the YouTube player with CSS, and YouTube's API terms
don't allow changing how the player shows a video. Mirror, frame-by-frame and offline playback wait for our own
recorded demos, which can ship inside the app as short MP4s.

**Privacy.** Playing a clip connects to YouTube, so the privacy policy (`site/privacy.html`) and the Data safety
notes (`store/play_console_notes.md`) say so. Nothing loads from YouTube until you open a clip.

## Step 15. Voice commands during drills and in the rep logger

Android's WebView has no `SpeechRecognition`, so the web version's Voice button was hidden in the app. Now the
app has its own small plugin, `HoopsVoice` (`android/.../voice/HoopsVoicePlugin.java`), and `native-web/native.js`
connects it to two screens:

| Screen | How to turn it on | Words |
|---|---|---|
| Drill timer (handling, body) | **Voice** button beside Pause / Skip / End. It stays on for later drills until you turn it off | "pause" (or "stop", "wait"), "go" (or "resume", "ready"), "lost it", "faster", "slower", "skip" |
| Rep logger (shooting, finishing) | The page's own **Voice** button | The web version's words: "miss", "done", the number made ("eight"), "undo", "short", "long left"... |

**How the plugin listens.** Android's `SpeechRecognizer` hears one phrase and stops, so the plugin starts it again
after every phrase or silence until the page calls `stop()`. It prefers the phone's **on-device** recognizer
(`createOnDeviceSpeechRecognizer`, Android 12+, when the English pack is downloaded), so audio stays on the phone,
and falls back to the regular recognizer with `EXTRA_PREFER_OFFLINE`. On Android 13+ it passes the command words as
`EXTRA_BIASING_STRINGS`, which helps short words like "miss" win over look-alikes. When the app goes to the
background or the screen locks it gives the mic back, and picks up again when you return.

**Fast but not jumpy.** The timer acts on *partial* results, so "lost it" lands mid-phrase, and only once per
phrase. The logger waits for the whole phrase, because there the count matters ("eight" vs. "eight... no, seven").

**Not hearing itself.** The app talks (tips, "Paused", the countdown's "Go"). Anything heard while it's speaking,
and for 0.3 s after, is ignored. Each word also only works when it makes sense: "go" does nothing while the clock
runs, "lost it" only counts during a dribbling part, "faster" only when there's a beat.

**Still to do.** A wake word ("Yo Ladder") and recording your own: try it in the gym first and see whether false
triggers happen. Listening with the screen locked needs a microphone foreground service, which Android 14 only
allows to start while the app is open.

The `<queries>` entry in `AndroidManifest.xml` lets Android 11+ show the app the phone's speech recognizer.

## Step 16. Live form check from the camera

The web version can only analyze a clip you filmed with the camera app, because Claude-hosted pages can't open
the camera. The app can, so the Form tab now has **Live form check (camera)**. Prop the phone up side-on, start
shooting, and after each shot the app says one short cue and shows the numbers.

**Same numbers as a clip check.** `native-web/native.js` doesn't have its own shot math. It keeps the last five
seconds of pose frames and, for each shot, hands the page's own `compute()` the 2.5 s before the shot plus the
follow-through, resampled to the 10 frames a second that `compute()` expects. So the Line Test drift, dip knee
angle, ball-leads timing, forearm at set point, arm extension, follow-through hold, tempo and stop-on-the-way-up
all mean exactly what they mean for a clip.

**Finding each shot.** A shot starts when the shooting wrist goes above the nose, and ends when it comes back
below the shoulder (the follow-through is over) or 1.8 s later. Ending at the nose cut shots short: a set point
at forehead height, or one jumpy pose frame, looked like the end. The next shot can start 0.8 s later at the
earliest, and only after the hand has come down. A raised hand with no dip or no long arm (knee angle over 165°,
arm under 120°) is a wave or a catch, not a shot, and is skipped.

**Checked on real clips.** Ladi's 13 phone clips (side-on from the floor, Pixel, 1 to 4 s) were played into the
live mode as a fake camera. 11 gave one shot each. The other two had the shooter too far away or the feet out of
frame, and got the "step back" message or nothing.

**The pose model in video mode.** The clip check uses MediaPipe's `PoseLandmarker` in `IMAGE` mode, one frame at a
time. Live uses a second landmarker in `VIDEO` mode (`detectForVideo`), which tracks between frames, so it's
steadier and faster. It runs at up to 15 frames a second on a 480 px copy of each frame, the same size the clip
check uses, so the thresholds match.

**Cues.** Only the biggest "Fix" on each shot is spoken, in this order: drift, ball-leads timing, set point, tempo,
extension, hold, dip. A clean shot gets "Good shot." Turn **Cues** off to read them instead. (They're spoken with
the phone's own voice, so voice commands from step 15 ignore them.)

**Saving.** When you tap Done, the session goes into your form history as one entry: the median of each number
across your shots, and each check's most common status. Like a clip check, it earns Shooting XP twice a day at most.

**Camera permission.** `getUserMedia()` asks Capacitor's WebView, which asks Android for the camera the first time,
the same way Coach recording does (step 7). Nothing is recorded or stored; only the numbers are.

**Next.** Ball tracking (make/miss, arc and entry angle, where the ball hits the glass) needs a ball detector on top
of the pose model. Takeoff foot and finishing hand for layups can come from the same pose frames.

## Step 17. Matching the beat to your real dribble

On any timer part with a beat (D2 Rep Count, volume drills), the player now has **Match my dribble** under the
beat slider. It pauses the beat, listens with the mic for 8 seconds while you dribble at your own pace, and offers
what it heard: "You: 120 per min · steady, high confidence", with **Use it**, **Again** or **Cancel**. Use it sets
the beat (rounded to the slider's 0.05 steps) and re-times the reps left, the same as moving the slider.

**How it hears a bounce.** `getUserMedia` with echo cancellation, noise suppression and auto gain off (they'd
smooth out the thuds), then a 220 Hz low-pass filter, because a bounce is mostly a low thud and squeaks and voices
are higher. Every animation frame it measures the loudness; a bounce is a jump to 3× the recent median and 1.3×
the previous frame, at least 0.18 s after the last bounce.

**From bounces to a speed.** The median gap between bounces gives the speed, so one missed or doubled bounce
doesn't throw it off. If fewer than 60% of the gaps are close to the median, it says it couldn't hear a steady
bounce. Steadiness comes from how much the gaps vary (coefficient of variation under 8% is "high confidence").

**Noisy gyms.** Put the phone on the floor close to you so your ball is the loudest. If voice commands (step 15)
are on, they pause while it listens, since Android lets only one thing use the mic.

**Not yet.** Counting real bounces during the whole set (instead of beat ticks), and treating a gap in the
bounces as a lost ball, need the mic to stay on during the set. That's the next step for this feature, along with
camera tracking of the dribbling hand to help in a noisy gym.

## Step 18. Your own music during drills

Start a playlist in Spotify, YouTube Music or any other music app, then open Hoops Ladder and run your drills. The
music keeps playing, and while the app talks ("Paused", the countdown, tips, "8 for 10") it dips and comes back up.

**How Android shares the speaker.** Apps ask for *audio focus* before they play. Asking for full focus
(`AUDIOFOCUS_GAIN`) tells a music app to pause. Asking for `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK` says "I'll talk for
a moment, keep playing quietly", which is what navigation apps do for directions. Since Android 8 the system turns
the music down by itself and back up when the focus is given back, so it works with every music app, no account or
SDK needed. (A podcast or audiobook app may pause instead, because talking over speech is hard to follow.)

**The pieces.** `HoopsAudio` (`android/.../audio/HoopsAudioPlugin.java`) has `duck()` and `unduck()`. In
`native-web/native.js` (section 6) every `speechSynthesis.speak()` calls `duck()`, and once nothing has been spoken
for a second it calls `unduck()`. The second of slack keeps a "3, 2, 1, Go" countdown from pumping the music up and
down. If the page never says it's done (it froze, or the app went to the background mid-cue), the plugin brings the
music back on its own after 10 seconds. Beeps aren't ducked; they're too short.

**Things to know in the gym.**
- While the rep logger is open, the volume and earbud buttons log reps (step 11), so change the music's volume in
  the music app, its notification, or the lock screen.
- Music from the phone's speaker makes voice commands (step 15) and **Match my dribble** (step 17) harder to hear.
  With earbuds it's much better. Some phones' speech recognizers also dip or pause music while they listen.

**Ideas for later.** Play / pause / skip buttons for whatever is playing, inside the app (any music app, but needs
the "notification access" permission to see other apps' media sessions). Or a Spotify integration to pick a
playlist from the app (Spotify's App Remote SDK: needs a Spotify developer app, their approval for more than 25
users, and the Spotify app on the phone). YouTube Music has no public API for this.

## Step 19. Music controls inside the app

Back, play/pause and skip for whatever is playing (Spotify, YouTube Music...), without leaving the drill. An art
panel picked the design from four mock styles (floating disc, top capsule, edge tab, built in); the reviews are in
the project's `hoops-app/reviews/music-controls/`.

| Where | What you see |
|---|---|
| Drill timer and rep logger | A full-width row under the top buttons: song, artist and app, then back, play/pause, skip |
| Tabs | The same controls in a mini-player above the tab bar |

**Turning it on.** Android only lets an app see other apps' music once you turn on **notification access** for
it. When something is playing and access is off, the tab bar shows *Control your music from here* with **Set up**
(opens the setting) and **×** (asks again in 14 days). Phones on Android 13+ block this setting for apps installed
outside the Play Store (like the Obtainium builds): if the switch is greyed out, open **Settings → Apps → Hoops
Ladder → ⋮ → Allow restricted settings**, then try again.

**How it works.** `MusicListenerService` (`android/.../music/`) is an empty `NotificationListenerService`: it
exists only because Android grants the access to one. With access on, `HoopsMusicPlugin` asks
`MediaSessionManager.getActiveSessions()` for the music apps, skips the app's own rep-logger session, follows the
one that's playing (or the most recent, so a paused song can be resumed), and sends its title, artist and state to
the page. Buttons call that session's `TransportControls`. Without access the plugin can still say whether
anything is playing (`AudioManager.isMusicActive()`), which is how the setup bar knows when to show.

**Never a logged miss.** The timer pauses on a tap anywhere and the logger logs a miss on a tap anywhere, so the
row sits inside a 10 px guard that keeps every touch starting there (taps, holds, swipes) to itself. Once the row
has shown during a drill it keeps its space until that screen closes, so the clock and number pad don't jump when
a song ends. Skips need 0.6 s between them, so a double tap is one skip.

**Looks.** White controls on navy, no orange (orange is the drill's own colour), and nothing animates. Paused
music keeps its controls, because that's when you want play; they go 2 s after the music app's session ends.

**Earbuds and volume buttons** still log reps while the logger is open (step 11), so the row is how you control
music there.

**Ideas for later** (from the panel): a smaller, dimmer row while you work that grows during rests, and the
real album art.

## Step 20. Adding a coach's drills one at a time, with videos from YouTube

**Add from your coach** on the Coach tab now has two ways in:

| Mode | What you do |
|---|---|
| All at once | The same as before: type, paste or say every drill, one per line |
| One at a time | Three short steps per drill: **1. Drill** (type or say its name, pick the skill), **2. Video** (find it on YouTube, paste a link, record a clip or attach one from the phone), **3. Goal** (Check off, Makes, Reps, In a row or Time, plus sets). **Save, add another** keeps the same list going |

**Picking a YouTube video.** *Find it on YouTube* opens the YouTube app, already searching for the drill's name.
Pick the video, tap **Share**, then **Hoops Ladder**: the app comes back with the video on that drill, labelled
with its title. It works the same from Chrome or any app that shares a link. A link shared while a drill on the
list is open for editing goes to that drill; with nothing open, it starts a new drill named after the video.

**How it works.** The manifest adds a second `intent-filter` to `MainActivity` for `ACTION_SEND` with
`text/plain`, which is what makes Hoops Ladder show up in Share menus. The activity is `singleTask`, so a share
while the app is open comes in through `onNewIntent()`. Capacitor's `BridgeActivity` also passes the intent that
started the app there, so one place handles both. `HoopsSharePlugin` (`android/.../share/`) sends the link and
its subject (YouTube puts the video's title there) to the page as a `shared` event, or keeps it for `take()` if
the page isn't listening yet. When Android rebuilds the app after closing it in the background it hands back the
old intent, so `onCreate()` drops a share it has already seen. In `native-web/native.js`, section 9 passes each
share to the page's `coShared()`.

**Nothing gets lost on the way.** The drill you're adding is saved on the phone (`localStorage`,
`hoopsLadder.coWiz`) on every change, so a trip to YouTube, or Android closing the app while you're there, picks up
where you left off. Clips recorded for it are tagged with the drill's id before it's saved, so they show up under
it afterwards. Back steps back through the three steps before it leaves the tab.

**Goals.** They use the same steppers and limits as custom goals on built-in drills (`GL_LIM`: makes and reps move
by 5, in a row by 1 from 2, time by 15 s). Each saved goal becomes the starting goal for the next drill. Any
drill on the list can change its goal from **Edit**, including ones added all at once, and the goal shows on the
list (*20 makes × 3 sets*).
