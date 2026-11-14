# CBCT Implant Planner — Dr. Sobti's Dental Care

Read first: docs/CBCT_Planner_FirstBuild_Spec.md, then docs/CBCT_Planner_Addendum_OwnEngine.md. Background: Build_Plan and Feature_Catalogue.

## What we are building
Offline Android app (APK) for tablets and phones: full-mouth CBCT viewer plus complete prosthetically driven implant planning, guide design (STL export) and PDF plan. Doctor-facing and patient-facing; simple enough for staff. Open system: any implant system via editable JSON libraries.

## Hard rules
1. All code is ours. No third-party runtime libraries (no three.js, Cornerstone, dicom-parser, pdf libs). Allowed: platform APIs (WebGL2, Workers, WASM, IndexedDB, Android SDK, java.util.zip, ContentResolver). Dev tools (TypeScript, bundler, test runner) are fine because they ship no code.
2. Fully local. No INTERNET permission. No analytics. No cloud.
3. Never load a full volume. Stream, downsample to a working tier, reload full-res only for an ROI (spec section 2). Memory cap 35% of device RAM. Step down a tier instead of crashing.
4. Heavy work in workers. UI thread only draws and handles touch. Target: 60 fps scroll, 30 fps 3D.
5. Planning aid only. Show the notice. Clinician approval step before guide export. Safety overrides need a recorded reason.
6. Patient data: never commit scans or identifiers. Strip identifiers from exports unless chosen.
7. White-label from day one: logo, colours, clinic name, tagline and report letterhead come from one config pack (brand/tokens.json). No hard-coded clinic strings in components.
8. Coordinates: DICOM LPS millimetres, one world frame. Meshes in mm. Document every transform.
9. Every session ends runnable on the clinic tablet (Redmi/Xiaomi Pad class, Android 16) with tests passing. Commit small. Write a short NOTES.md per session.

## Design
Layouts: Option E (Porcelain Guided wizard) is default; Option D grid is Expert; Option F full-screen focus view. Colours and logo from brand/tokens.json. Touch targets at least 48 px. Light theme for guided mode, navy for expert and focus.
Design canvas (read only): https://claude.ai/artifact/NcG1gxwZaDFNYReDNWi7ts

## Test case (local, not in git)
Full-mouth CBCT: 667 axial slices, 688x688, 0.15 mm, 16-bit unsigned, Explicit VR Little Endian, rescale intercept -1000, one zip. IOS: restoration_upper.obj and restoration_lower.obj (mm, textured, .mtl missing). Clinical task: missing teeth in quadrant 4, implants, crown-down plan, guide.

## Stack
TypeScript web core (WebGL2 + workers), Capacitor Android shell, own Kotlin plugin for streaming zip and file access. Tests with fixtures synthesised in code plus the local real case.
