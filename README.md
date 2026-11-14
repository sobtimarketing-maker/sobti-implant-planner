# Implant Planner (offline, Android tablet)

Open-system, prosthetically driven implant planning and surgical-guide design for Android tablets. Fully offline, no third-party runtime code. Spec and build order: `CLAUDE.md` and `docs/`.

> Planning aid only. All measurements, implant positions and guides must be verified clinically before treatment. Guide-design software is a regulated medical device in most markets (CDSCO, FDA, CE): get regulatory advice before giving it to other clinics.

## Status
Session 1 of 10 is done: case intake, CBCT loading and the three-view viewer. See `NOTES.md`.

## Install on the tablet
1. On GitHub open **Actions → Test and build APK**, pick the latest green run, download **implant-planner-debug-apk** (a zip holding `app-debug.apk`).
2. Copy `app-debug.apk` to the tablet, tap it, allow "Install unknown apps" for your file manager once.
3. Copy the CBCT zip to the tablet (USB or SD card). In the app: New case → fill in → Open CBCT → pick the zip.

## Develop
```bash
npm install
npm run dev        # http://localhost:5173 in Chrome
npm test           # unit tests; CASE_ZIP=/path/to/cbct.zip npm test adds the real-case test
npm run typecheck
npm run build && npx cap sync android && (cd android && ./gradlew assembleDebug)   # needs JDK 21 + Android SDK
```
End-to-end check in headless Chromium (needs Playwright installed on the dev machine):
`npm run build && CASE_ZIP=/path/to/cbct.zip SHOTS=./shots npm run test:e2e`

Patient data never goes in git: keep scans in `data/` (ignored).
