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
