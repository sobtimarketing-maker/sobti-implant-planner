# First Test Build — Spec (Lower Right / Quadrant 4, Prosthetically Driven)

Read with: Build Plan, Feature Catalogue, Own-Engine Addendum. This file is the workflow spec for the first build and the tablet configuration. Coded in Claude Code.

## 1. What the test scan told us (real data, checked)
| Item | Value | Consequence |
|---|---|---|
| Scanner | iRYS ELF3D, CT, 90 kV | Parser must tolerate vendor quirks |
| Files | 667 single-frame DICOMs, one Axial series (one zip, about 326 MB) | Series assembly from a zip |
| Matrix | 688 × 688 × 667 voxels, isotropic 0.15 mm (about 103 mm cube) | Full-mouth, high resolution |
| Pixel data | 16-bit unsigned, uncompressed, Explicit VR Little Endian | No codec needed for v0.1 |
| Raw size | about 631 MB as 16-bit | Cannot be held whole on a 4–6 GB device |
| HU | slope 1, intercept -1000 | Standard rescale |
| Orientation | IOP [1 0 0 0 1 0], z stepped 0.15 mm | Standard axial LPS |
| Content | Both arches, mandible and maxilla; metal restoration streaks present | Registration must be robust to artifacts |

The file name of the zip carries patient name and date of birth. Anonymise test data. Never commit scans to git (`.gitignore` the data folder). The app strips identifiers from exports unless the doctor chooses to include them.

### 1b. The intraoral scans supplied (same case)
| Item | Upper | Lower |
|---|---|---|
| File | restoration_upper.obj (50 MB) | restoration_lower.obj (40 MB) |
| Mesh | 194,064 vertices, 385,277 faces | 153,407 vertices, 303,200 faces |
| Extent (mm) | 72.3 × 62.7 × 24.3 | 77.0 × 65.9 × 28.0 |
| Units | millimetres | millimetres |
| Position | z from -5 to +19 | z from -20 to +8 |
Findings that shape the build:
- The two arches share one coordinate frame, and their z ranges overlap (-5 to +8 mm). So they are already in the IOS bite relationship. Register one arch (the treating arch, lower) to the CBCT; the opposing arch (upper) follows it unchanged.
- OBJ with a texture (`usemtl _texture`) and a referenced `.mtl`. The .mtl and texture image files were not included, so the meshes load as plain geometry. The importer must handle a missing .mtl or texture without failing, and use the texture when it is present (vertex colour or UV).
- 150K–200K vertices each: fine on a tablet, but the OBJ parser must stream the text (about 90 MB together) and build typed arrays in a worker. Make a decimated copy (about 40K faces) for interactive display and keep the full mesh for guide geometry and export.
- The scan frame is not the CBCT frame. Landmark registration is required (step 3).
- You said STL; these are OBJ. Both formats stay supported.

## 2. Memory strategy (the key to "not heavy")
Never load the full volume. Stream and reduce.
1. Read slices straight from the zip on disk (native reader, see section 8). Parse the header, convert, and average 2×2×2 blocks into a working volume as they arrive.
2. Working volume tiers (uint16, then uploaded as a 3D texture):
   - Tier H (12 GB or more): 0.30 mm, 344×344×334, about 79 MB
   - Tier M (6–8 GB): 0.45 mm, 229×229×222, about 23 MB
   - Tier L (4 GB, phones): 0.60 mm, 172×172×167, about 10 MB
3. Full resolution only in a region of interest around the implant site (for example 50×50×40 mm at 0.15 mm = 333×333×267, about 59 MB), re-read from disk when you open a site. Cross-sections, measurements and registration all use this ROI.
4. 3D view: raymarch on the working volume with an empty-space skip grid. Low quality while moving, sharpen on stop.
5. Keep in memory: one working volume, one ROI, meshes. Everything else lives in IndexedDB or files and is loaded on demand. Hard cap: 35% of reported device RAM; check before each allocation and step down a tier instead of crashing.
6. Everything heavy runs in workers. The UI thread only draws and handles touch.

## 3. The 8-step workflow, as modules and screens
Wizard (default for staff and patients) shows these as the six steps of Option E. Expert mode shows the same data in the Option D grid.

**Step 1 — Case, patient, plan summary.** Add patient (name, age, sex, ID, phone, notes), then the plan: tooth numbers (FDI), treatment per site (implant, crown, bridge, graft), implant system preference, notes. Open the CBCT zip or folder. Everything is saved in one case file (versioned JSON plus meshes plus thumbnails) and goes into the PDF.

**Step 2 — Anatomy marking in 3D.**
- Nerve: tap points along the mandibular canal on the panoramic and cross-sections. The app fits a smooth tube (spline), with a radius set per point and snap-to-low-density assist. Mental foramen and anterior loop marker.
- Adjacent teeth: outline each tooth by threshold plus region grow from a seed, producing a 3D surface (own marching cubes). The user can trim.
- Other structures: lingual plate and submandibular fossa (undercut), mandibular cortex, and for upper cases the sinus floor.
- Each structure has its own colour, a visibility toggle and a safety margin (section 5). All are true 3D surfaces, shown in all views.

**Step 3 — Merge CBCT with STL/OBJ (treating arch IOS).**
- Import STL (binary and ASCII) or OBJ. Opposing arch is imported too and rides in the IOS bite relationship with the treating arch.
- Method: landmark pairs. The user taps 3–6 matching points that are visible on both the CBCT surface (extracted tooth crowns) and the STL, for example cusp tips and incisal edges on stable teeth, away from the missing-tooth area. The app computes a rigid fit (Horn), shows the error per point in mm, then offers refinement (trimmed ICP on the chosen teeth only).
- Accuracy tools: residual per point, a colour deviation map, a split-screen slice with the STL outline over the CBCT, and a "nudge" control (move or rotate by 0.1 mm / 0.1°). Metal artifact regions can be excluded by painting.
- Opposing arch moves with the treating arch. Face scan is deferred.

**Step 4 — Prosthetic planning on the STL (crown-down).**
- The user selects the missing tooth sites on the STL, and the app proposes a crown from a parametric tooth library (width, height, cusp form) sized to the gap.
- Occlusion: distance map between crown and opposing STL; contact points and clearance shown; the crown is auto-adjusted to maintain clearance and contact, with the numbers visible.
- Manual crown design: move, rotate, scale, and sculpt handles (buccolingual width, mesiodistal width, height, cusp height, contact points, emergence profile). Undo and redo throughout.
- The implant is then placed from the crown: axis through the crown's occlusal centre, adjustable.

**Step 5 — Implant placement with guideline checks.** See section 5.

**Step 6 — Guide design on the STL.** See section 6.

**Step 7 — Multiple implants together.** Select several implants, move them as a group, and plan one guide with a common insertion axis (section 6).

**Step 8 — Approve and export.** A checklist gate (all safety checks, guide checks, seating, undercut report). Output: guide STL and a PDF treatment plan. PDF content: patient and case details, planned teeth, anatomy screenshots, cross-section per implant with distances, implant table (system, Ø top, Ø tip, length, depth, angle), crown details, occlusion view, guide specification (sleeve, offset, rods, windows), insertion axis, warnings and overrides, clinician sign-off block, and the "planning aid, verify clinically" notice.

## 4. Open implant system (no brand locked in)
Implant library = JSON files the user can add to or edit in-app:
`{ maker, system, name, platform_diameter, cervical_diameter, apical_diameter, length, taper, thread_depth, collar_height, sleeve_profile {inner_diameter, outer_diameter, height, offset_default}, drill_key, notes }`
Also: fully manual implants (type the three numbers), optional STL import of an implant model, and import or export of library packs. Cervical Ø, apical Ø and length are always editable. Drill and sleeve sets are likewise open. Brand data packs are optional add-ons and never required.

## 5. Safety distances (all editable by the doctor; defaults from commonly taught guidelines)
| Check | Default | Alert |
|---|---|---|
| Implant to mandibular canal | at least 2.0 mm | amber 1.0–2.0, red below 1.0 (error, blocks approval without an override and a recorded reason) |
| Implant to mental foramen (and anterior loop) | at least 2.0 mm (plan 4–5 mm anterior to foramen) | same colours |
| Implant to adjacent tooth root | at least 1.5 mm | same |
| Implant to implant (edge to edge) | at least 3.0 mm | same |
| Buccal and lingual bone thickness | at least 1.5 mm (2.0 mm preferred) | same |
| Lingual plate perforation / submandibular fossa | no perforation of the cortex | red |
| Crestal depth and angulation vs crown axis | shown; amber when axis off crown by more than 15° (guide: prosthetic axis) | amber |
| Sinus floor (upper cases) | at least 1.0 mm unless a lift is planned | same |
| Bone density at tip and body (HU) | shown | info |
Distances are measured in 3D from the implant surface including the drill length and a configurable safety offset at the tip (default plus 0.5 mm for the drill). Errors appear live as you move the implant, in the cross-section, the panoramic and the 3D view. All thresholds live in a single settings file so they can be changed by clinic.

## 6. Custom guide design (on the STL, not the DICOM)
Inputs: registered treating-arch STL, planned implants, sleeve set.
1. **Support area:** the user marks the guide extent on the STL (teeth plus soft tissue), by painting or with a curve. Default: 2 to 3 teeth either side of the site, extended across the arch if the guide needs more stability.
2. **Shell:** offset the marked region outward to a set thickness (default 2.5 mm) with an inner clearance (default 0.10 mm, adjustable) so it seats without binding.
3. **Guide holes:** per implant pick sleeve (from the sleeve set), hole diameter = sleeve outer Ø + clearance (selectable), and the offset factors: sleeve height above the platform, gap between sleeve and tissue, and depth stop. All are numeric fields with presets. The bore follows the implant axis.
4. **Support rods (two-point attachment):** add rods or bars from the guide to anchor points on remote teeth or a second site. Choose points on the STL, rod diameter, and path. Rods are checked so they do not collide with soft tissue, teeth or the sleeve.
5. **Inspection windows:** add holes (circles or slots) to see seating on teeth and tissue. Position and size are selectable.
6. **Insertion axis and undercuts:** with multiple implants, the app searches a cone of directions and picks the path of insertion with the least undercut on the teeth surfaces under the guide, then shows the undercut map in colours. The user can change the direction manually. Where an undercut blocks the path, the app offers to block out or relieve (fill the undercut in the inner surface) and warns if sleeves converge so a common path is impossible.
7. **Geometry method:** signed-distance field (SDF) on a 0.1–0.2 mm grid over the guide region (offset, subtract bores, union rods, subtract windows), then marching cubes to make a clean watertight mesh. This is robust and light on a tablet, and avoids a heavy mesh-boolean library.
8. **Checks before export:** wall thickness at least 1.5 mm, minimum material around each sleeve, rod and window clearances, seating undercut report, watertight check, and the printing orientation hint. Pass or fail list shown.
9. **Export:** the guide STL (millimetres, binary) plus the plan PDF. The guide always exports in the STL coordinate system, so it matches the scan used by the printer.

## 7. Modes
- **Staff mode (default):** the six-step wizard, large buttons, auto-suggestions (crown, implant size, guide), safety banners in plain language. Hides library editing and thresholds.
- **Doctor mode:** all manual tools, thresholds, libraries, override with reason, guide parameters.
- **Patient view:** one tap hides numbers and warnings and shows a clean 3D smile and implant animation with plain-language text. Patient view never shows other patients' data.

## 8. Platform notes
- Capacitor Android shell, web core in TypeScript with WebGL2, workers and WASM only where needed.
- A small Kotlin plugin of our own reads the case folder or zip through Android platform APIs (ContentResolver, java.util.zip), so the app can stream slice by slice without a library and without whole-file loads.
- No INTERNET permission. Files exported through the Android share sheet (guide STL and PDF).
- Device check at first launch: RAM, GPU, WebGL2 limits (3D texture size, float texture support). Pick the tier. If WebGL2 float textures are missing, fall back to 8-bit.
- Android System WebView must be a recent version (Chrome 110 or later equivalent). The app checks it and shows a clear message if too old.

## 9. Tablet configuration
| | Minimum (works, lighter tier) | Recommended (smooth, full tier) |
|---|---|---|
| Android | 10 | 13 or later |
| RAM | 6 GB | 8–12 GB |
| Chip | Snapdragon 7-series or Dimensity 8000-class | Snapdragon 8s Gen 3/4 or similar flagship |
| GPU | Adreno 6xx or Mali-G610, WebGL2 | Adreno 7xx/8xx |
| Storage | 64 GB with 20 GB free | 256 GB UFS (each full-mouth case is about 0.6 GB raw) |
| Screen | 10 inch or larger, 1920×1200 | 11 inch, about 2.1K or higher |
| Input | touch | touch plus stylus (optional) |
| Other | Wi-Fi not needed; USB-C or microSD for file transfer | |
Your tablet (reported by the maker as Snapdragon 8s Gen 4, 12 GB, Android 16) is in the recommended tier. Phones: 6 GB RAM or more, 6.5 inch or larger, are supported in a lighter, single-view layout.

## 10. Performance budgets (measured on your tablet, first build)
- Open the full-mouth case to first image: 15 s or less (stream and downsample); afterwards, instant resume from the cached working volume.
- Slice scroll: 60 fps. Oblique MPR drag: 30 fps or higher. 3D rotate: 30 fps or higher at the working tier.
- Cross-section update while moving the implant: under 100 ms.
- Registration (landmarks plus ICP on region): under 5 s.
- Guide generation: under 20 s for one site, under 45 s for multi-implant.
- Memory: peak under 35% of device RAM. No crashes on a 4 GB test (tier L).
- Autosave every change within 1 s, restore after a forced kill.

## 11. Build order for the first test build
Session 1 — Repo, tokens (from the Brand board), logo, app shell, case database, device tiering, zip stream reader (Kotlin plugin), DICOM header parser, slice sorter, working volume builder. Test with the supplied scan.
Session 2 — MPR (axial, coronal, sagittal), window/level, scrolling, ROI reload, measurement ruler.
Session 3 — Arch curve, panoramic, cross-sections, nerve tracing, tooth outlining (marching cubes).
Session 4 — WebGL2 volume and surface 3D view, transfer functions.
Session 5 — STL and OBJ import, landmark merge, ICP, deviation map.
Session 6 — Parametric crown library, occlusion map, manual crown tools.
Session 7 — Implant model, library, crown-down placement, safety engine, live alerts.
Session 8 — Guide design (SDF), sleeves, rods, windows, undercut and insertion axis, checks, STL export.
Session 9 — PDF writer and treatment-plan report, case bundle export.
Session 10 — Wizard UI (Option E), Expert (D), Patient view, polish, performance pass, APK build and install on the clinic tablet.

## 12. Honest risks
- Own marching cubes, SDF guide geometry and a parametric crown library are real engineering. Order above is built so each session ends with something you can test.
- Metal artifact in this scan will test registration and surface extraction. The landmark method plus an exclusion paint tool is the answer.
- A printed guide is a surgical device. Test accuracy on a print of a known model before any patient use, and keep the clinician sign-off step. For other doctors and sale, regulatory advice is needed first.
