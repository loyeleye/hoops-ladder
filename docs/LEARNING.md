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
| `UPLOAD_KEYSTORE_BASE64` | output of `base64 -w0 upload.jks` (macOS: `base64 -i upload.jks`) |
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

Still to come: the privacy policy, store listing and app icon. Volume-button logging, lock-screen controls and
safer storage are steps 8 and 9.

## Step 8. Hands-free logging: volume buttons, earbuds and the lock screen

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

Plugins from npm (like Preferences in step 9) are registered by `npx cap sync`. A plugin that lives inside the
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

## Step 9. Saving progress where the system won't clear it

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
