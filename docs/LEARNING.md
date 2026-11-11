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
three presses = undo** (shot by shot it's one press = miss, two = make: one press always means something went wrong). A web page can't use the phone's
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

## Step 21. Left/right, depth and arc

Shoot360 splits every shot into three parts: **left/right** (alignment), **depth** (short or long) and **arc**. The
app already let you tag a miss Short, Long, Left or Right. This step gives each part its own drill, coaching and
camera check.

**Three drills** (Drills → Shooting). Each one works on one part and says where to put the phone for it (`cam` on
the drill: `behind` for left/right, `side` for depth and arc):

- **Rim Line Shots** (left/right): 10 shots each from 5 ft, the free throw line and the top of the key, all on the
  line straight out from the rim, with the phone behind you.
- **Depth Calls**: the phone calls an aim point before each shot (just over the front rim, the middle, the back of
  the rim). Same form, new target.
- **Arc Calls**: the phone calls low, normal or high arc.

Calls drills now save makes and short/long misses by call (`it.cb`), shown in the drill summary and in **Arc and
depth** on the Progress tab, with a ★ on the call that goes in most often.

**Swish.** In Buttons and Shot-by-shot logging you can mark a make as a swish (the Swish button, "That was a swish"
after a make on the shot-by-shot screen, or say "swish"). Progress shows what share of makes were swishes, since a
swish means depth and arc were both right. Sets mode can't tell makes apart, so it doesn't count there.

**Left or right, by hand.** Miss advice used to treat left and right as one "side" miss. It now uses your shooting
hand (the Form tab's Right-handed / Left-handed switch): misses to the guide-hand side (left for a right-hander)
point to elbow flare or the ball crossing your face, and Rim Line Shots; misses to the shooting-hand side point to a
pushing guide hand, and Guide Hand Slides.

**Fix after three.** When three tagged misses in a row share a direction, the logger says and shows one fix ("Three
short. Legs under the ball, up and over the rim."). It waits for three more tagged misses before saying another.

**Form check from behind.** The Form tab has a **Camera** switch: From the side (balance, timing, set point, arc) or
From behind (left/right). The behind check (`computeBehind`) measures:

| Check | How | Good |
|---|---|---|
| Elbow under the ball | forearm angle from vertical at the set point; + = elbow flared out | within 10° |
| Ball line at release | wrist sideways from the shooting shoulder, in shoulder widths; + = outside the shoulder | −60% to +15% |
| Guide hand at release | guide wrist moving toward the ball from set point to just after release | under 12% |
| Side-to-side balance | hips moving sideways from the dip to the release, in % of height | within 3% |
| Stance width | feet apart at the dip, in shoulder widths | 0.7 to 1.6 |

From behind the face is hidden and the pose model can mix up left and right, so the shooting arm is simply the one
whose wrist gets highest, and "toward the shooting hand" is measured from the guide shoulder to the shooting
shoulder in the picture. That makes it work for either hand and with the phone's selfie camera. Live form check uses
the same switch: from behind, a shot starts when a wrist goes above the head (estimated from the shoulders), and a
dip of under 1.5% of your height means it wasn't a shot.

**Arc distance.** Measure arc used to assume every shot was a 22 ft three. Pick where you shot from (8, 14, 17 or
22 ft) and the entry angle is worked out for that distance: tan(entry) = tan(launch) − 2h/d, with the release
h = 2 ft below the rim.

**Next.** Ball tracking will plug into these drills one part at a time: Rim Line Shots reads left/right from the
phone behind you, Depth Calls reads where the ball lands past the front of the rim, and Arc Calls reads the entry
angle, each from the camera position that drill already asks for.

## Step 22. Warm-up and cool-down routines

Every recommended workout already started with the 4-minute Body Warm-Up and ended with the 3-minute Cool-Down
Stretch. Now there's a choice of each, and any of them can be run on its own, like before a game.

| Routine | Kind | Length | For |
|---|---|---|---|
| Body Warm-Up | warm-up | 4 min | Most days (the default) |
| Full Dynamic Warm-Up | warm-up | 8 min | Long sessions, cold gyms, stiff days: high knees, butt kicks, carioca, world's greatest stretch |
| Easy Start Warm-Up | warm-up | 7 min | Stiff knees, ankles or hips, or coming back from time off: starts on the spot, no hops or fast runs |
| Club Warm-Up | warm-up | 7 min | The Never Too Late adult club's warm-up: three laps building to full speed, skips, hip CARs, lunges, leg raises to the ball, carioca, butt kicks, jump skips |
| Club Warm-Up + Floor Work | warm-up | 10 min | The same club warm-up on days with the other coach, then plank, wall sit, push-ups, burpees and ball twists |
| Pre-Game Warm-Up | warm-up | 9 min | With a ball before a game: dynamic moves, handles, form shots, layups, mid-range, two sprints |
| Cool-Down Stretch | cool-down | 3 min | Most days (the default) |
| Full Cool-Down | cool-down | 8 min | After a hard session or a game: legs, hips, lower back and shoulders |

**Picking yours.** On the Today tab the warm-up and cool-down rows now have the ⇄ button. It opens *Pick your
warm-up* (or cool-down); the one you pick goes into every recommended workout until you change it
(`S.settings.rt = {warm, cool}`). Longer routines take their minutes out of the workout like any other drill.

**Drills → Body.** A fourth tab lists every routine, marks the one your workouts use, and opens any of them to run
on its own. The workout builder lists them in their own *Warm-up and cool-down* group, and with *Keep Cold 3s and
the warm-up first* on, any warm-up stays first and any cool-down stays last.

**Switch sides.** Halfway through a part that says *each leg*, *each side*, *each foot* or *each arm*, the timer
beeps and says "Switch sides". Halfway through *both directions* or *one way, then the other* it says "Other way".

**How it's built.** A routine is an ordinary timer drill with `body: true` and `rt: "warm"` or `rt: "cool"`, so the
player, XP and history work as before. `rtPick(k)` returns your pick (or the default), `FIXED` covers every routine
so the recommender never swaps them out, and `slotOf()` puts them in the *Body warm-up* and *Cool-down* slots.
Adding a routine (like a club's own warm-up) is one more entry in `DRILLS` with `rt` set.

## Step 23. Workouts that work like playlists

Saved workouts already lived behind **Plan · Change** on the Today tab. This step brings them out front and makes
them play through like a playlist.

| Where | What you get |
|---|---|
| Today, under *Today's workout* | A row of workout cards you can swipe: **Recommended**, each of your workouts, then **All workouts**. The one that's on says *▶ Playing*. One tap switches, even halfway through a session |
| All workouts | Your workouts with **Edit** and **Duplicate**, the stay-on switch, and **Starter workouts** to add or play |
| Any drill, under its steps | **Save to a workout**: tick the workouts it belongs in, or start a new one with it |
| Today, while you train | A progress bar (*3 of 7 done · about 12 of 37 min*), and **⋯** on each drill of your own workout: skip it today, take it out, or edit the workout |
| After you log a drill | The toast says what's up next with a **Start** button, so you go straight to the next drill (or the next run of timed drills) |

**Switching keeps your work.** Done is still "logged today", so a drill you've done shows ✓ in any workout that has
it. Drills you did that aren't in the new workout are listed under it as *Also done today*.

**Stay on until I switch.** Off (the default), a workout you pick is for today and tomorrow goes back to
Recommended, like before. On, it stays on day after day. `planRoll()` runs before each render and moves a
stay-on pick to the new day, clearing that day's skips and add-ins.

**Starter workouts** (`STARTERS`): Quick 30, Full gym day (about 80 min, with the full warm-up and the longer
stretch, and it says to keep the next day light),
Shooting day, Finishing day, Handles with no hoop, and a Game-day tune-up with no jumping. Adding one copies it into
My workouts so it can be changed; the copy remembers which starter it came from, so the starter leaves the list.

**Order rules still hold.** `wOrder()` is the builder's rule in one place: Cold 3s and the warm-up first, the
cool-down last, and finishing or jump work brings in your picked warm-up (step 22). Starters that use the plain
Body Warm-Up and Cool-Down Stretch get your picked routines instead when you add them. Saving a drill to a workout from the drill uses it too.

**Not here on purpose.** No streaks and no "workouts in a row": long days come with a note to go light the next
day, and the 250-shot warning in the builder stays.

**Data.** `S.rec.plan` gains `skip` (drill ids skipped today) and `stay`; `S.rec.stay` is the switch;
workouts may carry `from` (the starter id). Older saves load as they are.

## Step 24. Animations and demo links for every warm-up and cool-down

**What changed.** Every routine on the Body tab now opens to *The parts*: one row per move with an animated
figure, a one-line how-to, and (for the less familiar moves) ▶ links that jump to a short YouTube demo at the
right moment. The same animation shows in the player under *Show the move* while that part's timer runs.

**One move, many routines.** The animations live in a shared moves library inside the vector engine (`BV`):
`jog`, `highknee`, `carioca`, `wgs` (world's greatest stretch), `hipcar`, `frank` (leg raise to the ball),
`jumpskip`, `plank`, `wallsit`, `pushup`, `burpee`, `balltwist`, `fig4`, `child` and about 30 more. Each entry is
an animation plus its note. A routine lists one move per part in a new field, `mv`:

```js
{id:"b_club", ..., phases:[["Lap at half speed",60], ...], mv:["jog","lap","sprint","skip","hipcar", ...]}
```

so adding a routine reuses the moves without drawing anything new. `mv` must have one key per phase.

**Demo links.** `MCLIP` maps a move to its demo clips (`[videoId, start, end, label]`), and any routine with `mv`
gets its clip links from it. Moves that are obvious from the animation (walking, jogging, squats) have none. The
clips were picked by their titles and channels, so swap any that turn out to be poor.

**Lying and kneeling poses.** The figure used to stand its lowest foot on the floor, which sank planks, bridges
and stretches into the ground. `solve()` now finds the lowest point of the whole body (feet, knees, hips, head,
elbows, hands) and puts that on the floor, and an animation can draw a ball that follows the hands
(`ball:(t,pose)=>({x,y})`).

## Step 25. Film a rep and compare it with the demo

Every drill with a demo animation now has a **Film a rep** card in its sheet. **Compare** opens a full-screen view
with the demo on the left and your clip on the right.

**Getting the clip.** *Record a rep* opens the camera inside the app (`getUserMedia` + `MediaRecorder`, the same
web APIs as the Coach recorder in step 7, no sound). It counts down 5 or 10 seconds with a beep each second so you
can put the phone down and get to your spot, then records 6 or 10 seconds and stops by itself. Both choices are
saved in settings (`cmpDelay`, `cmpLen`). *Pick a clip* takes a video you already filmed. Where the page can't open
the camera (a Claude-hosted page), that button is the only one and the phone's own picker offers the camera.

**Watching them together.** *Play both* starts your clip and the demo from the top at the same time. ½× and ¼×
slow both down: the video through `playbackRate`, the demo by advancing its animation clock more slowly (the demo
animations are drawn from a time value, so any speed works; the older GIF demos play at their own speed). ◀ ▶ step
your clip a tenth of a second at a time, *Mirror me* flips it for selfie-camera clips, and the step chips switch
which part of the demo loops. Your clip is painted into a canvas every frame so the skeleton can be drawn on top
in exactly the right place.

**Notes from the pose model.** The clip is read the same way as a form check: 10 frames a second, each scaled to
480 px, through the `PoseLandmarker` in `IMAGE` mode. Then the notes depend on the drill's skill:

| Skill | Checks | How |
|---|---|---|
| Shooting | The form check's own numbers, from the drill's camera angle (`CHECK_VIEW`, else the drill's `cam`) | `computeSide` or `computeBehind`. The drill's own checks (`CHECKS`) come first, then the worst of the rest, three at most |
| Handling | Low stance, Eyes up, Stay level | Bent knees: knee angle 155° or less, or the thigh showing 90% or less of the shin's height (bent knees shorten the thigh from the front and the side). Eyes down: the nose drops more than 45% of the way from the ears to the shoulders. Level: how far the hips move from their median height, as a share of your height |
| Finishing | Knee drive, Reach at the top, Soft landing | The top of the jump is where the hips are highest (it needs a rise of 4% of your height). Knee drive: the higher knee there, as an angle from hanging straight down. Reach: the higher hand above the head with the arm 150° or straighter. Landing: knees bend in the 0.6 s after the hips come back down |

Each note has **See it in your clip**, which pauses and jumps your clip to the frame the number came from (the
dip, set point or release for shots, the most upright frame for stance, the top of the jump for knee drive).
Warm-up drills get the side-by-side but no notes yet.

**Checked on real clips.** Ladi's 13 side-on shooting clips gave shooting notes on 11, the same two misses as the Form tab (too far away, feet out of frame).
They were also run through the handling and finishing checks to make sure nothing breaks on real footage, but
there are no handling or finishing clips yet, so those thresholds are a first guess to tune.

**Privacy.** The clip lives in memory and is gone when you close the screen. *Keep clip* saves it with your
training videos (step 7), named after the drill, so it shows in My videos on the Form tab. Android's back button
closes the compare screen first.

## Step 26. Film study: make the read on real film

Film study is on the **Coach** tab. Each set is a run of moments from YouTube breakdowns by NBA, pro or college
players, or a few vetted coaching channels (Thinking Basketball, Hoop Intellect, BBallBreakdown, The Film Room,
Coach Frikki, Basketball Scoring Coach). The presenter's read is the right answer. When two sources read the same
clip differently, the higher level wins and NBA players have the final say.

**How a moment plays.** The video plays **muted with captions off** from the scene's start and pauses on the frame
of the read. The narration and captions often say the answer right at that moment, which is why they're off. Then
the moment's court diagram and the question ease in under the paused player. After you pick, *Hear … explain it*
rewinds to the scene's start (or to `from`, when the explanation comes first) and plays with sound to `end`, so the
presenter is never cut off mid-sentence.

**YouTube's rules shape the screen.** Nothing may be drawn over the embedded player (the Required Minimum
Functionality's "Overlays and frames"), and the app may not capture or keep frames (Developer Policies III.E.1).
So the paused player stays on top, untouched, and the labels live in our own diagram underneath. The player is
YouTube's IFrame API on the privacy-enhanced youtube-nocookie.com host, at least 200 px tall. Pausing, seeking and
muting all go through the API. A muted embed turns YouTube's auto-captions on, so the app switches them off with
`setOption("captions", "track", {})` when the player is ready, when the captions module loads (`onApiChange`) and
every 0.4 s as a backstop. The replay leaves them off; the player's CC button turns them on. The pause is a
50 ms timer on `getCurrentTime()`, so it lands within about a frame or two.

**Levels.** *Basics* plays the moments tagged `B`, labels the players who matter and makes their vision cones glow
(fading from invisible to about 45% and back). Everyone else is faded. *Intermediate* plays every moment, draws
every cone the same and labels only you, because spotting who matters is part of the read. Titles and questions
never name the cue or the answer, and the choices are shuffled every time.

**The diagram.** A half court at 10 px a foot (a 500 × 400 `viewBox`, basket at the top). Each player is a dot with
a cone toward where they're looking (`face`), drawn as a radial gradient. Moments without a built-in diagram show a
*Who's who* list instead. After answering, **Place the players** opens an editor under the paused frame: tap to add
teammates or defenders, drag to move, tap a player and drag the white dot to turn their cone, and mark key players.
Saved diagrams go in `S.film.dia` (on the phone and in your account). **Flag this moment** saves a note when a pause,
answer or diagram is off. *Copy your diagrams and flags* on the Coach tab puts both on the clipboard as JSON, ready
to build into the sets.

**Where the sets live.** One JSON file per set in `film/sets/` (`s1.json`, `s2.json`, …). Each moment has a video
source, `start`, `pause`, `end` (and optional `from`) in seconds, a level, a neutral title and question, 2 to 4
choices with one `ok`, the answer, the presenter's words, a `cast` list that starts with YOU, and an optional
`court`. Moments are `checked` once a person has confirmed the pause against the video; a set with none checked
shows a *Draft* tag. To add or change a set, edit its JSON and run:

```bash
node tools/build_film.mjs           # checks every set, then writes them into www/index.html
node tools/build_film.mjs --check   # checks only, and fails if www/index.html is out of date
```

**What's kept.** Each finished run (set, level, how many you read right) in `S.film.runs`, your level choice, and any
diagrams and flags. No XP: film study is study, not a workout, so it doesn't touch your levels or the session
calendar.

## Step 27. Coach sessions: film the coach, then your try

For practice with a coach. **Coach tab › Start coach session** (or **Coach** in the workout player) opens a separate,
dark, full-screen mode built for the court. A back arrow returns to the app and leaves the session running. A pill
above the tab bar, *Back to session*, stays on every tab until the session ends. The storyboard and the reasons behind
each screen are in the project files (`hoops-app/coach-session/coach_session_storyboard.html`).

**Setup.** Two questions, both remembered: the coach's name, and whether the phone is propped up or someone is holding
it. The first time with a coach, Start stays off until you tap *They said yes*: ask before you film someone. The answer
is kept per coach in `S.coach.ok`.

**Topics and pieces.** A session (`S.coach.sess`) is a list of topics. Each topic keeps its pieces in the order they
happened: `c` the coach on camera, `m` your tries (numbered), `t` voice notes, and `l` links. A topic can also hold
`hw`, the id of the take-home drill made from it. *Film coach* starts a new topic when the current one already has a
try. *Film me*, *Talk* and *Link* add to the current topic. Tapping a topic's name makes it current. The camera opens
only when you film, so there's no live preview on the board.

**Recording.** The camera is `getUserMedia` + `MediaRecorder` at 2.5 Mbps with sound, like the Coach recorder in
step 7. A recording stops at 5 minutes (about 19 MB).
- *Propped*: a 3-second count with a beep each second, so walking away doesn't end up in the clip. Then one
  recording per turn. *My turn* and *Again* drop markers, and recording keeps going. A coach demo and your tries can
  share one file, and each piece is a part of it (`v` the file, `a` to `b` in seconds).
- *Handheld*: one clip per tap, with a single stop button.

**Replay and compare.** *Done* opens the replay on your try by itself, looping only its own part at ½×. *Compare*
puts another piece (the coach first) on the left. *Line up* pauses both and gives each a scrubber. Move them to the
same moment, tap *Lock*, and from then on the left follows the right with the same offset. Links open in the in-app
YouTube player (step 14), looping the part you marked.

**Voice notes.** *Talk* records audio only (`MediaRecorder`, Opus where the phone has it). *Feedback* on a replay
attaches the note to that try. Notes are kept as audio.

**Transcripts.** After a voice note or a coach clip is saved, the app turns it into text on the phone, never live.
The page decodes the recording to 16 kHz mono PCM (`OfflineAudioContext.decodeAudioData`, `sesPcm`) and sends it
to the `HoopsTranscribe` plugin (`android/.../voice/HoopsTranscribePlugin.java`). That writes it to a temporary
file and gives the file to Android's on-device recognizer (`createOnDeviceSpeechRecognizer` with
`EXTRA_AUDIO_SOURCE`, Android 13+) in a segmented session, so pauses don't cut it short. Nothing is sent to a
server, and the temporary file is deleted straight away.
- The text is kept on the piece as `tx`. It shows under the note or clip on the board and in the replay, and gives
  a *Suggested* name at wrap-up (a basketball term from the coach's words, like "Follow-through", or the first
  words). The drill's name and a link's title are suggested too.
- One at a time, and only once filming or talking stops. A failure shows *Try again* (`txs: "fail"`, or `"lang"`
  while the phone fetches its English speech pack). Older phones and the browser keep audio only and show nothing.
- Up to 3 minutes of each piece is transcribed.

**Spoken marks (beta).** In setup, *Say "my turn"* (off by default, `S.coach.sesVoice`) listens during a propped
recording: "my turn" marks your try, "again" or "one more" marks another, and "done" stops and opens the replay.
The recording screen has a *Voice on/off · beta* button to switch it mid-session. In the app it borrows the live
`HoopsVoice` listener from step 15 (`hoopsSesVoice` in native.js); in a browser it uses the page's speech
recognition. The camera's own recording holds the mic at the same time, and some phones give the recognizer
silence while it does: then nothing is heard, and taps keep working.

**Links and shared videos.** While a session runs, the app pushes an Android sharing shortcut, *Session · Mo*, that
shows in the share sheet. Ending the session removes it. A link shared through it goes to the session's *Add a link*
screen and never to a take-home drill. The plain *Hoops Ladder* target still works as in step 20. Videos can be
shared in too (`video/*`): the plugin copies the file into the app's cache, the page reads it back as a Blob, and it
asks *Coach or Me*: Coach starts a new topic when the current one already has a try, and Me becomes the topic's next
numbered try. Several shares wait in line and are asked one at a time. With no session running, the first shared video
asks where shared videos should go (My videos, or start a coach session with it) and remembers the answer in
`S.settings.shareTo`. Change it on the Coach tab's session card (*Videos shared in with no session running*).
- `HoopsSharePlugin.sessionStart/sessionEnd` push and remove the shortcut. `res/xml/shortcuts.xml` declares the
  share target.
- A share through the shortcut carries `target: "session"`.
- The share target only shows on Android 10 and later.

**Best and latest.** In each topic the highest-numbered try is marked *Latest* once there are two, and *Best try* (★)
is your pick: one per topic, set from the star on the replay (or the dock when there's nothing to compare). Both marks
show on the board and in the compare picker. Nothing is deleted because of them.

**Importing past clips** (storyboard frame 21). *Import past clips* on the Coach tab's session card picks several
videos (`<input type=file multiple accept=video/*>`). Each clip's time comes from the MP4's own creation time (the
`mvhd` box), else a date in the file name (`VID_20240428_173912`), else the file's date. More than 3 minutes between
clips starts a new topic. The first clip of a topic with more than one is guessed as Coach, the rest Me, and each can be
switched. Each topic goes to a past session it falls within, else a new session shared with topics less than 2 hours
apart on the same day, and that can be changed (another new session, any past session, or left out). Clips are kept
with the same `sesStore` as filmed ones. New sessions wait under *Finish setting up …* so the topics get named.

**Homework and wrap-up.** *Homework* adds the topic to the take-home list straight away, with the goal chips from One
at a time and the topic's links. The take-home row gets a *Session clips* button that opens the topic. *End* opens the
wrap-up: name each topic, switch on the ones to add to take-home, and Save for a flat 15 XP per session. *Later* keeps
everything and leaves *Finish setting up …* on the Coach tab. A session left alone for 2 hours ends itself the same way.

**Storage and privacy.** Clips and notes go in the same IndexedDB store as My videos, tagged with `ses`, so My videos
leaves them out. Nothing is uploaded. *Delete session* on a past session removes its clips and notes. Take-home
drills made from it stay.

**Not built yet** (from the storyboard): Rewind (keeping the last 30 seconds while propped), trimming setup and
the end of a clip with the pose model, finding the handoff between two people in one clip, importing past clips,
drawing on a frame, and the in-session quick test.
