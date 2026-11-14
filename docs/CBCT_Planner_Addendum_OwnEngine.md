# Addendum — Own Engine, Locked Design

Supersedes any earlier mention of Cornerstone3D, three.js, dicom-parser or other third-party runtime libraries in the Build Plan.

## 1. Design decision (locked)
- Default UI: **Option E, Porcelain Guided** — ivory, royal blue, navy, champagne gold; 6-step stepper (Load scan, Orientation, Arch and nerve, Add scans, Plan implant, Report); one hero view; 3 thumbnails; guide card with steppers.
- Expert toggle: **Option D grid** — pano, 3D, cross-section, axial, plus a right panel for size, safety and bone.
- Focus view: **Option F** — tap any thumbnail for a full-screen view with glass panels.
- Logo: original artwork, unchanged, top-right. Needs the file supplied by Dr. Sobti. Tagline "IMPLANTS · IMAGING · SMILE DESIGN" in the footer.
- Tokens: Royal #1A4EA2, Navy #0E2A57, Champagne #D5BC7C, Warm Gold #EFB05C, Bright Gold #FBAE49, Ivory #F7F4EC. Fonts: Inter plus Cormorant Garamond headings, bundled locally (no CDN, offline).

## 2. Rule: zero third-party runtime code
Only platform APIs are used: WebGL2, WebAssembly, Web Workers, IndexedDB, File API, Android WebView. Capacitor is the thin APK shell only (build tooling, not clinical logic). Dev-time tools (TypeScript, bundler, test runner) are allowed because they ship no code into the app.

## 3. Modules we write ourselves
| Module | Scope | Notes |
|---|---|---|
| dicom/parser | Part-10 reader, explicit and implicit VR, little/big endian, multi-frame, enhanced CT | Stream-parse, never load the whole file into one string |
| dicom/codecs | Uncompressed first; then RLE; then JPEG-LS and JPEG-lossless; JPEG2000 last | Phase codecs. Most CBCT exports are uncompressed |
| volume | Series sort by IPP/IOP, spacing, gantry-tilt check, LPS matrix, HU rescale | Memory budget, auto-downsample, hi-res ROI reload |
| render/mpr | CPU oblique MPR, slab MIP, window/level | Typed arrays in a worker |
| render/vr | WebGL2 raymarch, R16F 3D texture, transfer function presets (bone, soft, teeth) | Adaptive step, interactive low-res then refine |
| render/pano | Curved reformat along the arch spline, thickness-adjustable | |
| mesh | STL (binary and ASCII), OBJ plus MTL and texture (face scan), normals, BVH | Own decimation (quadric) |
| register | Landmark Horn, then trimmed ICP, CBCT-to-STL; KD tree or grid NN | Visual check overlay and residual in mm |
| segment | Threshold plus region grow for teeth, bone, sinus; canal tracing by user points plus snap-to-low-density | Manual-first. Own AI is a later, optional phase |
| implant | Open geometry (cervical Ø, apical Ø, length, platform, taper), crown-down alignment, safety engine | Green at or above 2 mm, amber 1–2, red below 1 |
| io/zip | Inflate and deflate (own), to read ZIP-packed exports and write case bundles | |
| io/pdf | Own minimal PDF writer: text, images, vector lines | For the report |
| store | Versioned plan schema, journaled autosave in IndexedDB, crash recovery | |
| ui | Own component set, tokens above, 48 px touch targets | |

## 4. Honest trade-offs
- Compressed DICOM (JPEG2000 and similar) is the biggest own-code cost. Ship uncompressed, RLE and JPEG-lossless first, and add the rest only if the clinic's CBCT exports need it.
- Own PDF writer is basic: no fancy typography. Good enough for a clean plan report.
- Own AI segmentation is out of scope for v1. Manual and semi-automatic tools only.
- Real fidelity (the "looks like exoplan" test) depends on the volume renderer and transfer functions, tuned on real clinic CBCTs. Needed from Dr. Sobti: 3–5 anonymised CBCT series (small field and full-face), 2–3 STL pairs, one face scan.

## 5. Build order (Claude Code sessions)
1. Repo, CLAUDE.md, tokens, app shell, worker harness, test fixtures.
2. DICOM parse plus uncompressed volume, memory budget.
3. MPR views plus window/level, touch navigation.
4. WebGL2 VR plus transfer functions.
5. Arch spline, pano, cross-sections.
6. Nerve, sinus and pathology marking.
7. STL/OBJ import, face scan, registration.
8. Implant model plus crown-down plus safety engine.
9. Wizard UI (Option E), then Expert (D), then Focus (F).
10. Report (own PDF), case bundle export, autosave and crash recovery.
11. Performance pass on a mid-range tablet, then APK signing.

## 6. Guardrails
- Planning aid only. Not a drilling or surgical instruction. Clinician verifies.
- Fully local. No INTERNET permission in the manifest.
- Regulatory: if it is ever distributed or sold, check medical-device software rules (CDSCO in India, FDA/CE elsewhere) before release.

## 7. Open items
- Original logo file
- Target tablet model and Android version
- Sample CBCT and STL cases
- Brand implant libraries: later, as optional data packs
