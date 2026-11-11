# Hoops Ladder

Basketball training with a leveling system, for every level. Android app built with
[Capacitor](https://capacitorjs.com) around the Hoops Ladder web app.

- `www/` – the web app (generated from the prototype by `tools/import_prototype.mjs`)
- `android/` – the native Android project
- `.github/workflows/android.yml` – builds a debug APK on every push, and once the signing secrets are set, a signed release bundle plus a signed APK published as a GitHub Release for [Obtainium](docs/LEARNING.md#step-13-automatic-updates-on-your-phone-with-obtainium)
- `film/sets/` – the film study sets, one JSON file each, built into `www/index.html` by `tools/build_film.mjs`
- `site/` – the website and privacy policy, published to https://loyeleye.github.io/hoops-ladder/ by `.github/workflows/pages.yml`
- `store/` – Google Play listing text, icon, feature graphic, screenshots and answers for the App content forms
- [`docs/LEARNING.md`](docs/LEARNING.md) – how it's all built, step by step

## Quick start

```bash
npm ci
npx cap sync android
npx cap open android   # then press Run in Android Studio
```
