# Session notes

## Session 1 (2026-11-14): shell, case intake, CBCT load and view
Built
- Own ZIP reader (`src/core/io/zip.ts`): central directory + per-entry reads via `Blob.slice`, inflate through the platform `DecompressionStream`. ZIP64 aware. Never reads the whole file.
- Own DICOM Part-10 parser (`src/core/dicom/parser.ts`): explicit/implicit VR, LE/BE, undefined-length sequences, header-only prefix parsing.
- Series assembly and streaming volume builder (`src/core/volume/`): pass 1 reads only headers (16 KB prefix per slice), sorts along the slice normal; pass 2 streams pixels in order into an f×f×f box-average. Only one output plane + a few source slices are in memory besides the result.
- Tiering (`budget.ts`): H 0.30 mm / M 0.45 / L 0.60; steps coarser if the working volume would exceed 35 % of RAM. Doctor mode can override.
- Case model v1 with migration, IndexedDB store, debounced autosave, working-volume cache for instant reopen.
- UI (own components, tokens from `brand/tokens.json`): case list, Staff/Doctor/Patient modes, 6-step stepper (Option E), intake (patient, medical flags, FDI chart with per-tooth treatment, prosthesis/retention/implant system/guide type), Orientation step with hero view + 3 thumbnails (Option E) or Expert 2×2 grid (Option D, navy). Tap = crosshair, drag = scroll or brightness, pinch = zoom, double-tap = reset, brightness presets + auto window.
- Capacitor Android shell with INTERNET permission removed, largeHeap, minSdk 29 (Android 10). GitHub Actions builds the debug APK and fails if INTERNET appears.

Measured on the real test case (cloud Chromium, 4 cores)
- 667 slices, 688×688 @ 0.15 mm → tier H working volume 344×344×334 @ 0.30 mm (79 MB). Open to first image 6.9–7.5 s; reopen from cache under 1 s. Node peak RSS 255 MB for the load.
- Anatomy and orientation checked visually (R/L, A/P, S/I correct; quadrant 4 edentulous area visible).

Coordinates
- Volume voxel (i,j,k) → LPS mm: origin + i·sx·rowDir + j·sy·colDir + k·sz·normal (`volume.ts`). Origin of a downsampled volume is shifted (f−1)/2 source voxels to the block centre.
- MPR display assumes axial acquisition (IOP ≈ [1 0 0 0 1 0]); oblique MPR comes in Session 2/3.

Not done / to check on the tablet
- Kotlin streaming plugin: not written. The WebView `File`/`Blob.slice` path already streams without a full load; revisit only if the tablet shows memory or speed problems with the 326 MB zip.
- Untested on the real tablet: file picker with a 326 MB zip, WebView memory, touch gestures.
- Compressed DICOM (JPEG/JPEG2000/RLE) shows a clear "not supported yet" message.

Next: Session 2: oblique MPR, full-resolution ROI reload, measurement ruler.

## Session 2 (2026-11-14): oblique MPR, full-detail region, ruler
Device test of Session 1 (Dr, clinic tablet): worked through Orientation. Fixed: Quality dropdown unreadable in navy theme, content under the Android status bar (Capacitor `adjustMarginsForEdgeToEdge: auto` + safe-area padding), header wrapping at 1280 px.

Built
- `src/render/oblique.ts`: plane sampler over several volumes (finest first), trilinear when idle, nearest + half resolution while dragging. Shared orthonormal frame (ex, ey, ez) defines the three planes; Tilt rotates the frame about the touched view's normal, and a per-view spin keeps that view's own image upright while the other lines rotate. Orientation letters follow the plane's dominant LPS axis.
- Full detail (spec section 2 ROI): the loader worker stays alive per case and `loadRoi` crops a 40 mm cube at source resolution (0.15 mm, about 18 MB) from the zip around the cursor. Real case: 2.5–2.9 s. Views draw the region inside the working volume automatically. After reopening a case from cache the file must be opened again for this (no persistent file handle in WebView).
- Tools: Scroll / Brightness / Tilt / Measure. Measurements stored in the case (world LPS mm), shown in views whose plane holds both ends (±0.75 mm), listed with jump-to and delete. Hidden in Patient view.
- Case schema: `measurements`, `view.point/frame/spin` (Session 1 voxel cursor dropped on migrate).

Tests: 20 unit (oblique vs axis-aligned equality, trilinear, frame drift, ROI agreement and edge clamp) + e2e on the real case (open 7.4 s, detail 2.5 s, measure, tilt, reopen).

Next: Session 3: arch curve, panoramic, cross-sections, nerve tracing, tooth outlining.

## Session 3 (2026-11-14): arch, panoramic, cross-sections, nerve, teeth
Device test of Session 2 (Dr): all good.

Built (step 3 "Arch and nerve", `src/ui/screens/anatomy.ts`)
- Arch: tap points on an axial slice at a chosen level (drag to move, undo, clear), or "Suggest arch at this level" (`core/anatomy/arch.ts`: rays from behind the jaw, middle of the first bone run). Centripetal Catmull-Rom, resampled at the working voxel size (`core/geometry/curve.ts`).
- Panoramic (`render/pano.ts`): mean slab 5/10/15/20 mm along buccal normals, nearest sampling on the working volume (about 100 ms). Arch always runs patient right → left; normal flipped to point away from the arch centroid.
- Cross-sections: 40 × 50 mm, perpendicular to the arch, buccal on the left; uses the 0.15 mm detail box when it covers the spot. Thumbnails at −2 / +2 mm.
- Nerve (`core/anatomy/nerve.ts`): right/left canals, points inserted where they lengthen the path least, radius 1.0/1.2/1.5 mm, tap snaps to the darkest 3×3 spot within 1.5 mm when clearly darker (>80 HU), mental foramen marker. Tube shown on pano, axial and as a circle where it crosses each cross-section. `distanceToNerve` ready for the Session 7 safety engine.
- Teeth (`core/segment/`): tap inside a tooth → seed snaps to the brightest spot within 1 mm → 6-connected region grow above the outline level in a 14 × 14 × 30 mm box on the finest volume. Default level = 90th percentile of voxels > 300 HU (1900 HU on the test case). Warning above 1300 mm³ (leak). Masks stored bit-packed in the case. Surface by own naive surface nets (closed mesh, verified in tests) instead of marching cubes: no tables, lighter; used for 3D in Session 4.

Known limits
- Tooth outlining at the working level catches enamel and coronal dentin; roots usually need a lower level plus full detail. Fine-tune per tooth with the level slider and "redo".
- Sinus marking (upper cases) not built yet; not needed for this lower-right case. Add with the upper workflow.

Tests: 30 unit + e2e on the real case (suggested arch 9 points / 129 mm, 3 nerve points, foramen, tooth 415 mm³).

Next: Session 4: WebGL2 3D view (volume + surfaces: teeth, nerve, later implants).
