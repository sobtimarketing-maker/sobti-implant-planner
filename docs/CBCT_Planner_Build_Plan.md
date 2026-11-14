# CBCT Implant Planner (Android APK + Tablet) — Complete Build Plan

Owner/sole approver: Dr. Pushkar Sobti. Working name: **PLANNER** (rename later).
Workflow: **Claude Design (UI/UX) → Claude Code (build) → Android Studio (APK) → clinic testing.**
Kept fully separate from DentFrame (no shared code, brand or backend).

---

## 0. One-paragraph definition

An offline, on-device CBCT DICOM viewer and prosthetically-driven implant planner for Android tablets/phones (APK). Loads anything from a small CBCT segment to a full-mouth/full-face scan, lets the user scroll/pan/zoom MPR + 3D, trace nerve/sinus/pathology, import treating-arch and opposing-arch IOS (STL/OBJ) and a face scan (OBJ), superimpose them on the CBCT, add missing teeth, and plan implants with open generic geometry. No cloud, no upload, patient data never leaves the device.

## 1. Hard requirements (from you)

| # | Requirement | Acceptance test |
|---|---|---|
| R1 | DICOM CBCT viewer on phone/tab | Opens a 400×400×300 study, first image < 5 s, scroll 60 fps |
| R2 | Pan / zoom / scroll / window-level | One-finger scroll slices, two-finger pan/zoom, long-press W/L |
| R3 | View teeth, sinus, nerves, pathology; mark them | Nerve (L/R), sinus (L/R), pathology tools persist in saved plan |
| R4 | Small segment to full-mouth/full-face file | Auto memory budgeting; 512³ loads without crash on 6 GB device |
| R5 | 100% local/offline | Airplane-mode test passes; no network permission in manifest |
| R6 | Smooth, no lag/hiccups | Interaction p95 frame ≤ 20 ms on target tablet (see §9) |
| R7 | Import arch STL/OBJ + face scan (OBJ with texture) | Textured face renders; STL/OBJ up to 1M triangles |
| R8 | Match (superimpose) CBCT ↔ STL | Landmark + ICP; contour overlay on slices; RMS error shown |
| R9 | Add missing tooth/teeth (virtual) | FDI-numbered library, multi-tooth, move/rotate/scale |
| R10 | Basic → "Exoplan-level" implant planning | Phased: v1 core, v2 advanced (see roadmap) |

### Design principles already decided (carry into every prompt)
1. **Prosthetically driven (crown-down)**: plan the tooth first; implant serves the crown; screw-access channel projected up the implant axis; abutment angle correction.
2. **Open geometry only**: implant defined by **cervical diameter, apical diameter, length** (+ abutment angle). No manufacturer libraries now (system libraries = later update).
3. **CBCT + IOS flow**: CBCT taken with anterior bite fork, IOS taken in occlusion. So: (a) superimpose **treating arch** onto CBCT, (b) opposing arch comes in **in the IOS-recorded bite** (same IOS frame, rides along automatically).
4. **Measurement/planning aid, not an autopilot**: reports numbers for the clinician; never issues drilling instructions. Disclaimer on every export.
5. **Users**: Doctor, TC, front desk (chairside with patient). Role-light UI; patient-education mode (hide measurements, show 3D + teeth).
6. Sole decision-maker: every plan/export is created for the doctor to approve; no auto-sharing.

---

## 2. Platform decision

**Recommended: Web-tech core in a Capacitor Android shell (WebView, WebGL2).**
- One codebase → Android APK + iPad/Chrome PWA + desktop browser.
- Claude Code is strongest in TypeScript; fastest path to a testable product.
- Risk: WebView WebGL2 memory/perf on low-end tablets. Mitigation in §9; fallback = Phase-3 native renderer (Kotlin + Vulkan/OpenGL ES 3.0) behind the same data model.

Alternatives considered (not chosen now): Flutter + native FFI (slower to first value), Kotlin/Compose + C++ NDK (best perf, 3–4× effort), Unity (heavy, poor DICOM tooling).

**Minimum target device**: Android 10+, 6 GB RAM, Snapdragon 7-series/Exynos 2200-class or better, 10" tablet. Recommended: Galaxy Tab S9 / S8 class. Phones supported but planning UI is tablet-first.

---

## 3. Tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript (strict) |
| Build | Vite + esbuild; Capacitor 6 for Android |
| UI | React + Zustand (state) + CSS modules; touch-first components |
| 3D / meshes | three.js (WebGL2); custom raymarch shader for volume |
| DICOM parse | `dicom-parser` + own series assembler; wasm codecs (`@cornerstonejs/codec-*` or `jpeg-lossless`, `openjpeg`) for compressed transfer syntaxes |
| Heavy compute | Web Workers + SharedArrayBuffer where available (needs COOP/COEP; Capacitor can set headers via local server) |
| Storage | IndexedDB (cases/plans) + Capacitor Filesystem (volume cache, exports) |
| Mesh I/O | three STL/OBJ/MTL loaders (+ own fast binary-STL path) |
| Math | gl-matrix; own Horn/ICP/Jacobi eigen |
| Tests | Vitest (unit), Playwright + headless Chrome (WebGL via SwiftShader) for visual/regression, on-device manual checklist |
| Export | PNG snapshots, PDF plan report (jsPDF), JSON plan, STL of implants/crowns |

---

## 4. Architecture

```
src/
  core/
    dicom/        loader.ts  series.ts  transferSyntax.ts  codecs/
    volume/       Volume.ts  budget.ts  downsample.ts  histogram.ts  sampler.ts
    geometry/     plane.ts  curve.ts (arch spline)  mesh.ts  meshPlane.ts (contours)
    registration/ horn.ts  icp.ts  surfacePoints.ts  grid.ts
    planning/     implant.ts  tooth.ts  nerve.ts  annotations.ts  safety.ts  plan.ts (schema+migrate)
    io/           meshImport.ts  objTextured.ts  exportPdf.ts  exportStl.ts  db.ts
  render/
    mpr/          MprView.ts (CPU/GPU slicer)  pano.ts  crossSection.ts
    vr/           VolumeRaycaster.ts  shaders/  presets.ts
    scene/        Scene3D.ts  gizmos.ts
  workers/        dicom.worker.ts  icp.worker.ts  pano.worker.ts
  ui/             screens/  components/  gestures/
  app/            store.ts  routes.ts  theme.ts
android/          Capacitor project
tests/            unit/  e2e/  fixtures/ (synthetic phantom generator)
```

### Coordinate system (decide once, never change)
- World = **DICOM LPS, millimetres**. x→patient left, y→posterior, z→superior.
- three.js display group rotated −90° about X (LPS → Y-up).
- All planning objects store LPS mm. All matrices are 4×4 LPS→LPS.
- Radiological display: patient right on screen left.

### Volume handling (the performance heart)
- Parse slices, sort by `ImagePositionPatient` projected on slice normal, apply rescale slope/intercept → `Int16Array` HU.
- Handle: single-frame stacks, multi-frame, non-uniform spacing (warn/resample), gantry tilt (warn), missing rescale tags, unsigned 16-bit with odd offsets, big-endian.
- **Memory budget** (`budget.ts`): query `MAX_3D_TEXTURE_SIZE`, `navigator.deviceMemory`; if voxels > budget (default ~120 M on 6 GB) → stride-2 downsample on load (or user crop box first). Keep full-res on disk cache and offer "high-res ROI around implant site" reload (crop box at native resolution) — this is how a full-face scan stays smooth while the implant site stays sharp.
- GPU texture: R16F (half) 3D texture; LUT int16→half conversion in a worker.
- Mip/brick pyramid (v2) for empty-space skipping in raymarch.

### Rendering
- **MPR (axial/coronal/sagittal)**: axis-aligned fast path = typed-array row copy + W/L LUT → `ImageData` (or GPU slab shader). Oblique/pano/cross-section = generic sampler (plane origin + u,v basis; trilinear when idle, nearest while interacting).
- **Panoramic**: curve from arch spline on axial; thickness slab (mean/MIP) 5–20 mm; cross-sections perpendicular to curve every 1 mm.
- **3D volume render**: GPU raymarch, presets (bone, teeth/enamel, soft tissue, sinus air), adaptive step count (fewer while rotating), early ray termination, optional clip planes.
- **Meshes** (IOS, face, implants, crowns, nerve tubes): three.js. In 2D views, mesh∩plane contour lines (so IOS outline shows on CBCT slices → visual verification of superimposition).

---

## 5. Feature spec (screen by screen — feed this to Claude Design)

### 5.1 Home / Cases
- Open study (folder / zip / multiple files), recent cases (local), demo phantom case, settings.
- Case card: patient label (editable, optional), date, volume size, plan status.

### 5.2 Import wizard
1. Select CBCT folder/zip → progress with slice count, voxel size, FOV shown.
2. Auto-orientation check (shows A/P, L/R labels; flip/rotate buttons).
3. Memory-budget notice: "Loaded at full / half resolution" + optional crop box.
4. Optional: add treating arch (STL/OBJ), opposing arch (STL/OBJ), face scan (OBJ+MTL+JPG).

### 5.3 Main workspace (tablet landscape)
- Layout: 2×2 (Axial, Coronal, Sagittal, 3D). Tap a view to maximize. Layouts: 1-up, 2-up, 2×2, Pano+Cross-section, Implant view.
- Phone: single view + bottom view switcher.
- Left rail (tool modes): Navigate · Window · Measure · Arch/Pano · Nerve · Sinus · Pathology · Teeth · Implant · Scans/Register · Export.
- Right sheet (context): properties of the selected object (numeric fields + nudge buttons ±0.1/0.5/1 mm, ±1/5°).
- Always-visible: HU at cursor, mm scale bar, orientation letters, slice position.

### 5.4 Gestures (touch-first, stylus supported)
| Gesture | Action |
|---|---|
| 1-finger drag | Scroll slices (Navigate) or move/draw (active tool) |
| 2-finger drag | Pan |
| Pinch | Zoom (anchored at pinch center) |
| 2-finger twist (3D / oblique) | Rotate |
| Long-press + drag | Window/Level |
| Double-tap | Reset view / recentre crosshair |
| 3D: 1-finger orbit, 2-finger pan, pinch zoom | Standard |
| Crosshair drag | Sync all views |

### 5.5 Panoramic & nerve tracing
- Draw arch on axial (tap points → smoothing spline, editable).
- Pano + live cross-section strip with slider; cross-section thumbnails ±.
- Nerve tool: tap canal centre on cross-sections or pano → 3D centreline (Catmull-Rom), diameter per node (default 2.0 mm), L/R colour. Assisted-snap (v2): auto-find canal centre as local low-density tube from last point.
- Mental foramen marker, incisive canal marker.

### 5.6 Sinus & pathology
- Sinus: closed outline per slice (any plane) → interpolated surface; auto-measure **residual bone height** under sinus floor at implant site; sinus lift volume estimate (v2).
- Pathology: sphere/ellipsoid/freehand polygon, label, colour, volume estimate, distance to nearest implant/nerve.
- Threshold-region-grow segmentation for cyst/lesion (v2).

### 5.7 Teeth (virtual / missing)
- FDI library 11–48 (parametric crown shapes, editable mesio-distal width, height).
- Add single or multiple (e.g., "add 14–16" fills span along arch curve).
- Align to occlusal plane (from IOS opposing arch if present, else from marked points).
- Show wax-up crown ghost in all views; screw-access channel line.

### 5.8 Implant planning
- Implant = **cervical Ø, apical Ø, length**, optional abutment angle. Quick pick presets (3.3/3.75/4.2/5.0 × 8/10/11.5/13 mm) but fully editable; no brand names in v1.
- Place by tap in axial/cross-section; drag body to move, drag apex handle to angulate; numeric nudges.
- **Crown-down mode**: select tooth → "Align implant to crown axis"; show emergence/abutment angle correction.
- Views: auto "implant-axis" panels — mesio-distal long-axis, bucco-lingual long-axis, perpendicular cross-section slider along implant.
- Orbit 360° around implant (3D + rotating cross-section by angle slider).
- Live readouts: bone width BL & MD at crest and 3 mm / 6 mm; bone height; implant-to-nerve distance (surface to canal wall); implant-to-adjacent-root distance; implant-to-sinus floor; implant-to-implant distance; bone HU histogram along implant (D1–D4 style estimate with CBCT-HU caveat).
- Safety bands: ≥2 mm green, 1–2 mm amber, <1 mm red (configurable).
- Parallelism check across multiple implants; abutment angle total.

### 5.9 Scans & superimposition
- Treating-arch IOS, opposing-arch IOS (linked group), face scan (own transform).
- **Step 1 – Landmark**: 3–4 point pairs (CBCT 3D pick on tooth cusps/incisal edges ↔ same points on IOS) → Horn closed-form rigid.
- **Step 2 – ICP refine**: IOS vertices (trimmed 20 %) → CBCT enamel/dentin surface points (threshold slider; metal-artifact mask). Report RMS & % inliers.
- **Step 3 – Verify**: IOS contours overlaid on axial/coronal/sagittal; opacity slider; manual nudge (6-DoF) + undo.
- Opposing arch rides along (same IOS frame); if separate frame, 3-point bite alignment tool.
- Face scan: landmark (nasion, alare ×2, cheilion ×2, tragus optional) → ICP against CBCT skin surface; texture preserved.
- Smile preview: toggle face scan with crowns in 3D (patient education).

### 5.10 Measure
Distance, angle, bone width (BL/MD), HU probe, area (ROI), volume (v2). Saved as annotations.

### 5.11 Export
- Screenshots (per view / composite), plan PDF (patient label, images, implant table, safety distances, disclaimer), JSON plan (versioned), STL of implants+crowns, **surgical-guide export = OUT of scope** (decided earlier).
- Share only via explicit user action (Android share sheet).

---

## 6. Data model (versioned JSON)

```ts
Plan {
  schema: 1; id; created; modified;
  study: { uid; seriesUid; dims; spacing; origin; hash };   // volume itself not embedded
  arch?: { points: Vec3[]; slab: number };
  nerves: { side:'L'|'R'; nodes:{p:Vec3; r:number}[] }[];
  sinus:  { side:'L'|'R'; contours:{plane; pts:Vec2[]}[] }[];
  pathology: { id; kind; p:Vec3; size:Vec3; label; note }[];
  teeth:  { fdi:number; T:Mat4; width; height; depth; implantId? }[];
  implants:{ id; site:number; platform:Vec3; axis:Vec3; mdDir:Vec3;
             cervicalD; apicalD; length; abutmentAngle; status }[];
  scans:  { role:'treating'|'opposing'|'face'; file; T:Mat4; rms?; visible; opacity }[];
  measurements: ...; view: { layout; wl; presets };
}
```
- Auto-save every change (IndexedDB); explicit "Save snapshot" versions; schema migrations from day 1.
- Study hash check on reopen: warn if volume differs from plan.

---

## 7. Algorithms to implement (explicit, so Claude Code doesn't improvise)

1. **Series assembly**: group by SeriesInstanceUID; sort by projection of IPP onto normal (IOP row×col); detect spacing mismatch; Rescale Slope/Intercept; PixelRepresentation; window defaults from histogram P0.5–P99.5 if tags missing.
2. **Downsample**: box filter by 2 on Int16 (worker), preserve spacing update.
3. **Oblique slicer**: plane (O,u,v), size WxH, pixel mm; trilinear; clamp/background = −1000.
4. **Pano**: arc-length parametrise spline at 0.1–0.2 mm; for each s, sample along z and slab ±t along normal; combine (mean/MIP).
5. **Mesh∩plane contour**: per-vertex signed distance, edge intersection, chain optional.
6. **Horn absolute orientation**: centroid, 3×3 covariance → 4×4 N matrix → largest eigenvector (Jacobi) → quaternion → R, t.
7. **ICP**: grid-hash NN on CBCT surface points; point-to-point then point-to-plane; trimmed 20 %; max 50 its; converge on ΔRMS < 1e-4 mm.
8. **CBCT surface points**: voxels > T with ≥1 of 6 neighbours < T; stride; restrict to ROI around IOS after Step 1; exclude metal (HU > saturation) clusters.
9. **Safety distance**: implant frustum (sampled surface points) vs nerve tube (centreline + r) → min surface-to-surface distance.
10. **Raymarch pick**: CPU ray through volume in LPS to place 3D landmarks on the volume render.
11. **Crown-down alignment**: implant axis := crown long axis through screw-access point; allow cap on max angulation (flag if apex leaves cortical bone).

---

## 8. Phases & deliverables

| Phase | Scope | Exit criteria |
|---|---|---|
| **P0 Design** (Claude Design) | Screens §5, component library, gestures spec, dark clinical theme | Approved prototype by Dr. Sobti |
| **P1 Viewer** (2–3 wk) | Loader, budgeting, MPR ×3, W/L, gestures, 3D VR, demo phantom, APK build | R1, R2, R4, R5, R6 pass on target tablet |
| **P2 Anatomy** (2 wk) | Arch, pano, cross-sections, nerve/sinus/pathology, measure, save/load | R3 pass; plan survives restart |
| **P3 Implant core** (2–3 wk) | Implant model, placement/drag/angle, axis views, readouts, safety, teeth library, crown-down | Place 3 implants + 3 teeth in < 5 min |
| **P4 Scans & registration** (3 wk) | STL/OBJ, face OBJ+texture, landmark+ICP, contour verify, opposing arch | R7, R8; RMS < 0.3 mm on phantom, visual pass on 5 real cases |
| **P5 Polish & report** (2 wk) | PDF, patient-education mode, perf tuning, crash hardening, field test | 20 real cases, zero data-loss bugs |
| **P6 Advanced (Exoplan-ish)** | Auto nerve snap, sinus lift volume, bone-density map, implant library import, parallelism tools, brick-pyramid VR, native renderer fallback | per-feature |
| **P7 SaaS prep** | Licensing, anonymised telemetry (opt-in), update channel, iPad build | later |

Time is indicative for one dev + Claude Code, part-time review by you.

---

## 9. Performance budget & tests

| Metric | Target |
|---|---|
| Load 400×400×300 (≈48 M vox) | ≤ 5 s first view, ≤ 12 s fully ready |
| Load 512³ full-face | Auto half-res, ≤ 15 s, no OOM on 6 GB |
| MPR scroll | 60 fps (≤ 16 ms) |
| Oblique/pano regeneration | ≤ 60 ms interacting, ≤ 250 ms full quality |
| 3D VR rotate | ≥ 30 fps interacting, quality refine on idle |
| ICP (10 k pts × 50 its) | ≤ 3 s in worker |
| Peak JS heap | ≤ 1.2 GB; GPU texture ≤ 256 MB |
| App cold start | ≤ 3 s |

Techniques: workers for parse/downsample/ICP/pano; `OffscreenCanvas`; no allocations in frame loop; typed arrays only; adaptive quality while interacting; dirty-flag rendering (render only on change); texture upload in slabs to avoid jank; `requestVideoFrameCallback`-free simple RAF loop.

**Test assets (generate first, in repo):**
- Synthetic phantom: jaw bone, arch of teeth (high density), mandibular canal, sinus voids, optional metal implant; saved as DICOM series (uncompressed, multi-frame, JPEG-lossless variant) + matching IOS STL + face OBJ.
- Real anonymised CBCTs from your clinic (Planmeca / Carestream / Sirona / others) — one per vendor, small / medium / full-face.
- Regression: golden screenshots per view; registration ground-truth (known transform recovered within 0.1 mm / 0.1°).

---

## 10. Android APK pipeline

**Important:** the APK cannot be built in the Claude web sandbox used here (Google/Maven/Gradle hosts are blocked). Build on your PC/Mac or in a Claude Code environment with internet.

Prereqs: JDK 17, Android Studio (SDK 34+, build-tools), Node 20+.

```bash
npm create vite@latest planner -- --template react-ts
cd planner && npm i three zustand dicom-parser gl-matrix jspdf
npm i @capacitor/core @capacitor/cli @capacitor/android @capacitor/filesystem @capacitor/share
npx cap init Planner com.drsobti.planner --web-dir=dist
npm run build && npx cap add android && npx cap sync
npx cap open android            # Android Studio → Build > Build APK(s)
# or CLI:
cd android && ./gradlew assembleDebug      # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease                  # sign with your keystore
```
Manifest: **no INTERNET permission** (proves offline); `largeHeap="true"`; `hardwareAccelerated="true"`; READ_MEDIA/Storage Access Framework for picking folders (use SAF picker, not broad storage permission).
Install: enable "install unknown apps", `adb install app-debug.apk`, or share APK file to tablet.
Fallback without Android toolchain: host `dist/` once, open in Chrome on the tablet → "Install app" (creates a WebAPK; works offline via service worker).

---

## 11. Claude Design brief (paste into Claude Design)

> Design a tablet-landscape (primary) and phone (secondary) clinical imaging app: "CBCT implant planner". Dark, low-glare UI (near-black #0B0F14 background, restrained teal accent), image-first: ≥ 80 % of screen is imaging. Large touch targets (≥ 48 px), stylus-friendly, one-handed reachable controls. Screens: (1) Cases home; (2) Import wizard with progress and orientation check; (3) Main workspace with 2×2 views (axial, coronal, sagittal, 3D), left tool rail (Navigate, Window, Measure, Arch/Pano, Nerve, Sinus, Pathology, Teeth, Implant, Scans, Export), right context sheet with numeric fields and nudge buttons; (4) Panoramic + cross-section strip with slider; (5) Implant view: MD long-axis, BL long-axis, perpendicular cross-section, readout card with colour-coded safety distances; (6) Teeth library sheet (FDI chart, multi-select); (7) Scans & superimposition wizard (landmark pair picking side-by-side, ICP result card with RMS, overlay-opacity slider); (8) Export sheet; (9) Patient-education mode (clean 3D + teeth + face, no numbers). Provide component specs for: view cell (with orientation letters, scale bar, HU readout), tool rail, nudge control, safety badge, gesture hint overlay, progress toasts. Include states: empty, loading, error (unsupported transfer syntax, memory reduced), and a persistent disclaimer footer. Brand: Dr. Sobti's Dental Care compatible but product name neutral.

## 12. Claude Code kickoff

Create `CLAUDE.md` in repo root:

```
Project: offline CBCT implant planner (TS, React, three.js, Capacitor Android).
Rules: LPS mm world coords; strict TS; no network calls; no allocations in render loops;
heavy work in workers; every module has Vitest tests; commit small; never change coordinate conventions.
Geometry: implants = cervicalD, apicalD, length only (no vendor libs). Prosthetically driven (crown-down).
Registration: Horn + trimmed ICP; opposing arch shares IOS frame.
Safety copy: planning aid, not a drilling instruction system; disclaimer on exports.
Perf budget: see PLAN §9; fail PRs that regress it.
```

Then run, in order (one prompt each, review between):
1. "Scaffold repo per §4, Vite+React+Capacitor, CI script, and the synthetic phantom generator (§9)."
2. "Implement DICOM loader + budget + Volume per §4/§7.1–2 with tests against the phantom."
3. "Implement MPR views + gestures (§5.4) + W/L; 60 fps benchmark harness."
4. "Implement 3D VR raymarch with presets and adaptive quality."
5. "Implement arch/pano/cross-section (§7.3–4), nerve/sinus/pathology/measure (§5.5–5.6, 5.10), plan save/load (§6)."
6. "Implement implants, teeth, crown-down, readouts, safety (§5.7–5.8, §7.9, 7.11)."
7. "Implement mesh import, contours, Horn+ICP, face scan, verification UI (§5.9, §7.5–8)."
8. "PDF/exports, patient-education mode, perf pass, APK release build (§10)."

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| WebView memory/perf on weak tablets | Budget + half-res + ROI hi-res reload; native renderer fallback (P6) |
| Compressed DICOM variants (JPEG-LS/2000) | Wasm codecs; clear error + "re-export uncompressed" guidance |
| CBCT HU unreliable (vendor scaling) | Density shown as relative grey value + calibrated option; never absolute bone-quality claims |
| Metal artefacts break ICP | Metal mask, landmark-first, manual nudge, RMS/inlier warnings |
| Anterior-fork CBCT limits arch overlap | Warn when overlap < threshold; require ≥ 3 well-spread landmarks |
| Gantry tilt / non-uniform spacing | Detect + resample or warn |
| **Regulatory**: planning software can be a medical device (India CDSCO, CE/MDR, FDA SaMD) | Pre-SaaS: use clinic-internal, validated against known cases, keep "aid, no drilling instructions" framing, document validation; get regulatory advice before selling |
| Data protection | No network; local encrypted storage option (Android Keystore); patient label optional; DPDP/GDPR-friendly by design |
| Scope creep to "Exoplan-complete" | Hold P1–P5 as v1; P6 only after real-case validation |

## 14. Definition of done (v1)

- APK installs on target tablet, works in airplane mode.
- Loads 5 real vendor CBCTs (small → full-face) without crash; interaction within §9 budget.
- Plan 3 implants + 3 virtual teeth, nerve + sinus marked, IOS (treating + opposing) and face scan superimposed with RMS shown, PDF exported — all in one session.
- Plan reopens identically after app restart.
- Dr. Sobti signs off on 20 real planning cases vs current workflow.

## 15. What I need from you to start Phase 0/1

1. Target tablet model(s) and Android version.
2. 3–5 anonymised sample CBCT folders (different scanners, small + full-face) and matching IOS STLs + one face OBJ.
3. Approval of the tech choice in §2 (Capacitor web-core) vs native.
4. Decision on app name and whether the APK is internal-only (v1) or to be distributed.
