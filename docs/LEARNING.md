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

Before any track will take a build, the listing and the **App content** forms (steps 8 to 10) must be
filled in.

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

Still to come: native plugins (volume-button logging, lock-screen controls, voice commands, storage that
Android won't clear).
