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

## Session 3b (2026-11-14): double tap to enlarge, out-of-scan notice
Dr's request from the tablet: double-tap a view to bring it into the big viewer.
- `src/ui/doubleTap.ts`: own double-tap detector from pointer taps (350 ms, 40 px). WebView touch with `touch-action: none` does not fire `dblclick` reliably, so both view classes use this instead.
- Guided layout: tap or double-tap a thumbnail makes it the big view (tap already did). Double-tap on the big view still resets zoom.
- Expert grid: double-tap a view to fill the grid with it, double-tap again to go back to four.
- Step 3: double-tap the panoramic or cross-section to fill the big area with it; again to show both. The cross-section holds a single tap back 300 ms (`deferTap`) so a double tap never adds a nerve point or outlines a tooth.
- A view whose slice has no scan data (for example the sagittal when the point is outside the round scan area) now says "Outside the scan" instead of staying black.

## Session 4 (2026-11-14): 3D view, whole-tooth outlines
Dr's feedback on Session 3: tooth outlining should be optional and needs to be better.

3D (`src/render/vr/`, `src/ui/view3d.ts`, `src/ui/scene3d.ts`)
- Own WebGL2 engine, one context for the app on a hidden canvas; each 3D view renders there and copies the picture to its own 2D canvas, so the volume goes to the GPU once (8-bit 3D texture, 16 HU per step, about 40 MB for the test case; uploaded in slabs).
- Pass 1: surfaces (teeth from surface nets, nerve tubes, point marker) into a framebuffer with a depth texture. Pass 2: ray march per pixel, front-to-back, early stop at 97%, stops at the surface depth, empty 8³ blocks skipped (block max grown by one block), gradient shading when still. While turning: half resolution, bigger steps, no shading; sharpens 180 ms after release.
- Looks: Bone, Teeth, Skin (`presets.ts` control points), plus "Outlines only" (surfaces without the scan). Cuts relative to the point: hide above, hide below, cut front. Directions: Front, Right, Left, Top, Below, Centre on point.
- Touch: drag turns, pinch zooms, two fingers move, tap puts the point on the first visible spot (CPU ray through the working volume with the same look), double tap resets (or enlarges in the expert grid). Small views fold the options into "3D options".
- Where: Orientation (fourth thumbnail, can be the big view), Expert grid (fourth cell, replaces the placeholder), Arch and nerve (fourth thumbnail; big 3D shows teeth and nerves, tap moves the cross-section there).
- WebGL context loss is handled (re-uploads on the next render). Tests: maths, cut planes, tables, meshes; e2e takes 3D screenshots in headless Chromium (SwiftShader).

Tooth outline (`core/segment/toothGrow.ts`)
- Tested threshold-following of roots on the clinic scan: root dentin and bone are too close in density (it stops at the neck or runs into bone). Now: crown by 3D grow on a lightly smoothed box, on an eroded mask (0.3 mm) grown back, limited to 6.5 mm around the tap, each slice filled to its convex outline. Root: tapered from the neck outline to the root tip; tip defaults to a typical root length by tooth type (upper roots up, lower down, from the FDI number); "Set root tip" lets the user tap the real tip. Masks are cropped before saving.
- Marked optional in the panel; the tooth picker suggests the neighbours of the planned sites in turn. Warning when the crown reaches the size limit (may touch the next tooth).
- Limit: multi-rooted molars get one tapered root (good enough for distance checks and 3D, not anatomically exact).

Next: Session 5: import the intraoral scans (OBJ/STL) and merge them with the CBCT by landmark points.

## Session 5: mouth scans and line-up with the CBCT

Built (step 4 "Add scans", `src/ui/screens/scans.ts`)
- Load upper and lower scans (OBJ or STL, any size). `workers/mesh.worker.ts` parses (`core/mesh/obj.ts` streaming, `stl.ts` binary/ASCII with vertex merge), decimates for display (`decimate.ts`, vertex clustering to ~40K faces) and the app saves both copies in IndexedDB (`meshes` store, DB v2). Real lower scan: 303K faces read, reduced and saved in ~1 s.
- Implant jaw choice (lower/upper). Before line-up: scan alone (left) and CBCT with the other jaw cut away (right, "CBCT cut level" slider). Tap 3 or more matching points; coloured pairs, undo, clear.
- Line-up: Horn quaternion fit (`core/register/rigid.ts`), scan mm → world LPS mm, stored as column-major 4×4 in `case.scans.m`. Per-point mm shown; a point over 1.5 mm is flagged.
- Fine-tune (`core/register/icp.ts`): trimmed ICP, point-to-plane (normals from neighbour spread, 6×6 solve) with point-to-point fallback. Source: scan vertices within 10 mm of the tapped points. Target: CBCT tooth surface (iso 800 HU next to ≥1500 HU) within 12 mm of the CT points, and only on the implant jaw's side of the biting level (so opposing teeth cannot pull it). Refused when surface RMS > 0.5 mm, < 200 inliers or a point ends > 5 mm away; a move of more than 1 mm average from the taps is applied but reported, with Undo.
- Checks: hero 3D or axial/coronal/sagittal slice with the scan cut outline (pink implant jaw, cyan other); fit colour map (green ≤ 0.3 mm, red ≥ 1 mm); doctor-only nudge 0.1 mm / 0.1°.
- On the real case (e2e approximate taps, 0.8 mm mean): fine-tune gives 0.21 mm surface RMS in about 1 s; crowns fully green.

Tried and dropped
- Automatic global line-up without points: 472 s and matched the wrong jaw. Points stay the method.
- Point-to-point ICP alone: stalls about 1 mm off on smooth surfaces (unit test shows it); point-to-plane fixes it.

Next (Session 6): crown library and occlusion on the lined-up scans.

## Session 6: crown design (crown-down)

Built (step 5 "Design crowns", `src/ui/screens/crowns.ts`; core in `src/core/crown/crown.ts`)
- New step between "Add scans" and "Plan implant". Needs the lined-up scan of the implant jaw.
- Tap the mesial contact point, then the distal one (on the neighbouring tooth, or on the ridge for a free end). Teeth for the gap come from the planned sites in that quadrant (else guessed from the gap length); split by typical tooth widths. More than one tooth = bridge.
- Crowns are our own parametric shapes per tooth kind (molar, premolar, canine, incisor): superellipse side wall with cervical narrowing and height of contour, occlusal cap with cusps, grooves, fossa and marginal ridges. Closed, outward-facing meshes (unit test checks signed volume) so they can feed the guide and STL steps.
- Frame per span: m along the contact line, o = occlusal axis of the jaw scan (thinnest axis of the arch, towards the opposing scan, kept within 35° of up/down), b = o × m; buccal side from the scan centroid. World = origin + x·m + y·b + z·o.
- Seat: ray down from above the contact line onto the jaw scan (gum), 0.3 mm under it. Height: raised or lowered until the highest cusp meets the opposing scan at the chosen bite gap. "Grinding to bite" pushes any point that would go into the opposing teeth back to the bite gap; the panel warns when more than 0.4 mm is ground (little room).
- Bite colours per vertex: red touching, yellow to green within 1 mm, ivory clear. Views: cheek, bite (opposing hidden), tongue.
- Fine-tune per crown: width, cheek-tongue size, height, turn (2°), shift cheek/tongue and front/back (0.2 mm), bite (0.05 mm, firmer or lighter), refit, first tooth number and number of teeth in the gap, redo points, remove.
- Stored in `case.prosthetic.spans` (world mm; unit origins kept so later steps work without the scans loaded).
- Real case: 46-47 bridge placed on the right lower ridge, meets the upper teeth with point contacts.

Next (Session 7): implants under the crowns, with nerve and neighbour distance checks.
