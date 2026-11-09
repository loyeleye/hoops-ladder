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

Still to come: the privacy policy, store listing, app icon, and native plugins (volume-button logging,
lock-screen controls, storage that Android won't clear).
