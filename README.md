# Hoops Ladder

Basketball training with a leveling system, for every level. Android app built with
[Capacitor](https://capacitorjs.com) around the Hoops Ladder web app.

- `www/` – the web app (generated from the prototype by `tools/import_prototype.mjs`)
- `android/` – the native Android project
- `.github/workflows/android.yml` – builds a debug APK on every push, and a signed release bundle once the signing secrets are set
- [`docs/LEARNING.md`](docs/LEARNING.md) – how it's all built, step by step

## Quick start

```bash
npm ci
npx cap sync android
npx cap open android   # then press Run in Android Studio
```
