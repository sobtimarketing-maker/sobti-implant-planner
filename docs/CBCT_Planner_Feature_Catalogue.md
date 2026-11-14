# CBCT Implant Planner — Complete Feature Catalogue
Companion to `CBCT_Planner_Build_Plan.md`. Goal: match exoplan + Blue Sky Plan (BSP), then beat them on **simplicity, weight, stability and mobile-first use**.

Legend — **Tier**: T1 = v1 must-have · T2 = parity with exoplan/BSP · T3 = beyond them.
**Bench**: E = exoplan has it · B = Blue Sky Plan has it · O = other products (Romexis, coDiagnostiX, 3Shape, Carestream, i-CAT, DEXIS) · ★ = neither E nor B does it well (our edge).

---

## PART 1 — What exoplan and Blue Sky Plan actually do (research summary)

### exoplan (exocad, an Align Technology company)
- **Philosophy**: prosthetic-driven planning; **wizard mode** (guided, step by step) + **expert mode** (extra tools). Open architecture, STL in/out, in-house or outsourced production.
- **Modules**: exoplan (planning) · Guide Creator (surgical guide design) · DICOM Viewer module (fast CBCT loading) · DentalCAD integration (crown-down, immediate-load: original prosthesis scan auto-loads) · Smile Creator integration.
- **Data**: DICOM CT/CBCT; surface scans (STL); alignment tools to combine CBCT + surface scans with refinement; multiview alignment adjustment; safety warning if a CT alignment object is touched later.
- **Libraries**: implant libraries from manufacturers/local suppliers (brochure cites 780+ / 930+), surgical components (drills, sleeves, anchor pins, handles; 5,000+), prosthetic components (55,000+), daily updates via Library Manager; multi-library search; platform-switching and bone-density-based protocols.
- **Cases**: single, multiple, **edentulous**, **full-mouth rehab / both arches**, reverse planning (occlusion check), **dual-scan protocol** (patient with radiographic guide + guide alone), **anchor pins**, denture-based surgical + fixation guides, rapid pre-planning with patient present.
- **Tools**: measure distance/angle/gray values; screenshots with measured value; **auto panoramic-curve detection**; improved MD/BL cross-sections; angle between implants; **Instant Anatomic Morphing** teeth; 3D surface editor (crop, smooth, hole-close, gingiva-collapse after extraction); incognito mode (blur patient info).
- **Output**: planning report + **surgical protocol** (printable one-page, implants, sleeves, drill sequence), screenshot collections, STL export, 3D-printer presets. Licensing: modular, annual, no click fees.

### Blue Sky Plan (Blue Sky Bio)
- Free download, Mac + Windows, 8 languages, 90+ countries; per-case fee only for guide export.
- **Data**: any-scanner DICOM, extra DICOM sets, STL; **merge / overlay / align** DICOM + STL.
- **Planning**: virtual teeth (implant auto-positioned from tooth), **tangential 360° view**, **collision detection** (nerve / other implant, adjustable distance), implant duplication/alignment (paralleling), CAD abutments, tooth extraction toggle, better pano curve (drawn/edited) for **nerve identification**, implant library incl. compatible lines, **AI automatic implant placement** (v4.11), pins/TADs, planning **without CT**.
- **Segmentation**: automatic tooth segmentation, virtual tooth segmentation, automatic jaw segmentation, **airways** (BSP manual contents); maxilla auto-segmentation for TAD planning.
- **Tools**: distance / density / angle, surface cut, embossing, visual rendering, image basket, PDF/print reports (patient, practice, scanner, implant info), improved volume rendering.
- **Guides**: in-clinic and in-lab design; scan-appliance based or model-based; undercut removal; brush tool; export to STL; full-arch guides (v5); local lab collaboration; also dentures, splints, ortho models.

### Others worth copying (O)
- Romexis 7: **on-device AI** (no cloud), auto tooth + jaw segmentation, auto mandibular nerve, **Smart Fit** (auto CBCT↔IOS fit; STL/PLY full-arch), AI guide-area definition.
- DEXIS: AI tooth numbering, auto setup, focus-area ID, assisted nerve + airway tracing, partner file access.
- Carestream: auto arch mapping, auto nerve tracing, AI bone/teeth segmentation, matched models stored with patient.
- i-CAT Tx Studio: sinus graft simulation with graft volume, bitewings from 3D, airway with cross-section graph, TMJ explorer, virtual TADs.
- Academic comparison: bone-density tools exist in several systems but **CBCT grey values are not reliable** → show as relative, with caveat.
- Regulatory/clinical note: exoplan "created to provide dental labs, dentists, implant specialists and surgeons maximum flexibility"; wizard + expert is the proven ease-of-use pattern.

---

## PART 2 — Master feature list

### A. Case & data management
| ID | Feature | Tier | Bench |
|---|---|---|---|
| A1 | Local case library (thumbnail, label, date, status), search/sort | T1 | E B |
| A2 | Optional patient label only (no name required); incognito/blur mode | T1 | E |
| A3 | Auto-save + version snapshots + undo/redo (unlimited, per-object) | T1 | ★ |
| A4 | Crash-safe journal: reopen exactly where you were | T1 | ★ |
| A5 | Plan file (.plan) = JSON + meshes, versioned, forward-migrating | T1 | B(V2≠V3 failed) ★ |
| A6 | Import from folder, zip, multi-select, share-sheet "Open with", USB/OTG, SD | T1 | B |
| A7 | Export/import whole case bundle (encrypted, offline transfer phone↔tab↔PC) | T2 | ★ |
| A8 | Case templates (e.g., "single posterior implant", "All-on-4 lower") | T2 | ★ |
| A9 | Case compare (before/after, two CBCTs side by side) | T3 | O |
| A10 | Storage manager: size per case, clear cache, move to SD | T1 | ★ |
| A11 | Optional encrypted backup to chosen folder / Drive (user-initiated only) | T2 | ★ |
| A12 | Demo/practice case built-in (no patient data) | T1 | ★ |

### B. Import & volume engine
| ID | Feature | Tier | Bench |
|---|---|---|---|
| B1 | DICOM series (single-frame stacks, multi-frame, enhanced CT) | T1 | E B |
| B2 | Transfer syntaxes: uncompressed, JPEG baseline/lossless, JPEG2000, RLE, JPEG-LS | T1 | O |
| B3 | Vendor quirks table (Planmeca, Carestream, Sirona, NewTom, Vatech, Morita, Owandy, Cefla, Soredex, Orthophos, Gendex): spacing, rescale, orientation fixes | T1 | ★ |
| B4 | Non-DICOM CBCT inputs: vendor raw/NIfTI/NRRD, MHD (T2); DICOMDIR parse (T1) | T2 | O |
| B5 | Auto memory budget, adaptive downsample, **streamed loading** (never holds two copies) | T1 | ★ |
| B6 | Crop box on load; **hi-res ROI reload** around implant site | T1 | ★ |
| B7 | Orientation auto-detect + one-tap flip/rotate; gantry-tilt & uneven-spacing resample | T1 | ★ |
| B8 | Multiple series per case (e.g., scan with/without radiographic guide) | T2 | E B |
| B9 | Metal artefact reduction (post-filter) + beam-hardening/noise filters | T2 | O |
| B10 | Scan quality report (FOV, voxel, motion, truncation, metal) with plain-language advice | T2 | ★ |
| B11 | Progressive load: low-res preview in < 2 s, refine in background | T1 | ★ |

### C. Viewing
| ID | Feature | Tier | Bench |
|---|---|---|---|
| C1 | Axial / coronal / sagittal MPR; scroll, pan, zoom, rotate, sync crosshair | T1 | E B |
| C2 | Window/level presets (bone, sinus, soft, teeth) + auto + invert + colour LUTs | T1 | E B |
| C3 | 3D volume render with bone/teeth/soft-tissue/skin presets, clip planes, adaptive quality | T1 | E B |
| C4 | Panoramic (curved MPR), slab thickness mean/MIP, thickness slider | T1 | E B |
| C5 | Cross-sections along arch (MD/BL), 1 mm steps, thumbnails strip | T1 | E B |
| C6 | **Implant-centred views**: long-axis MD, long-axis BL, perpendicular slices, **360° tangential/orbit** | T1 | B E |
| C7 | Auto panoramic-curve detection; manual spline edit | T2 | E O |
| C8 | Layout presets (1-up, 2-up, 2×2, pano+cross, implant), saved per user | T1 | B |
| C9 | Link / unlink views; reset; fullscreen any view | T1 | – |
| C10 | MIP / MinIP / average slab in any plane | T2 | O |
| C11 | Synthetic X-rays: ceph, bitewing, PA, OPG from 3D | T3 | O |
| C12 | Hide/show layers: bone, teeth, soft tissue (threshold or segmented) | T2 | B |
| C13 | Dual-pane compare (two series / two time points) | T3 | O |
| C14 | Cine scroll / auto-rotate 3D for patient demos | T2 | ★ |
| C15 | Stylus hover readout (HU / mm) on tablet | T2 | ★ |

### D. Measure & analyse
| ID | Feature | Tier | Bench |
|---|---|---|---|
| D1 | Distance (point-to-point, in-plane and 3D), angle, 3-point angle | T1 | E B |
| D2 | HU / grey-value probe, ROI mean/SD, line profile | T1 | E B |
| D3 | Bone width/height at crest, +3, +6 mm (BL and MD) — one tap "bone metrics" | T1 | ★ |
| D4 | Area, volume (ROI/segmentation), curved-length along arch | T2 | O |
| D5 | Bone-density map along/around implant (relative D1–D4 estimate, with caveat) | T2 | O ★ |
| D6 | Saved measurements list, edit/delete, show on screenshots | T1 | E |
| D7 | Calibration check (known-size object) and "unreliable HU" warning | T2 | ★ |
| D8 | Cortical thickness measurement (buccal/lingual) | T2 | ★ |
| D9 | Ridge classification helper (Cawood-Howell style) from measurements | T3 | ★ |

### E. Anatomy marking & segmentation
| ID | Feature | Tier | Bench |
|---|---|---|---|
| E1 | Mandibular canal tracing (L/R) — manual on pano/cross-section, per-node diameter | T1 | B O |
| E2 | Mental foramen, incisive canal/loop, lingual foramen markers | T1 | ★ |
| E3 | Maxillary sinus outline + floor, residual bone height at site | T1 | O |
| E4 | Pathology markers (cyst, lesion, impacted tooth, root remnant): sphere/ellipsoid/freehand, label, volume | T1 | ★ |
| E5 | Adjacent tooth roots marking/auto-detect (for root proximity) | T2 | O |
| E6 | **On-device AI auto-segmentation**: mandible, maxilla, teeth (numbered FDI), canal, sinuses, airway | T2 | O (Romexis, BSP, Carestream) |
| E7 | Auto nerve canal tracing with manual correction | T2 | O |
| E8 | Threshold + region-grow segmentation, brush/erase, smoothing, fill holes | T2 | B |
| E9 | Export segmentations as STL | T2 | B |
| E10 | Nasopalatine canal, greater palatine foramen, pterygoid plate, zygomatic buttress, nasal floor landmarks | T3 | ★ |
| E11 | Airway analysis (volume, min cross-section graph) | T3 | B O |
| E12 | TMJ view (auto-oriented slices) | T3 | O |
| E13 | Impacted-tooth/root-to-nerve relation view | T3 | O |
| E14 | Periodontal bone-level view per tooth | T3 | ★ |
| E15 | Endodontic tools (apex/canal slicing, periapical lesion size) | T3 | ★ |

### F. Surface scans & registration
| ID | Feature | Tier | Bench |
|---|---|---|---|
| F1 | Import STL, PLY, OBJ (+MTL+texture), binary/ASCII; up to ~1–2 M triangles | T1 | E B |
| F2 | Roles: **treating arch**, **opposing arch** (rides along in IOS bite), face scan, denture/radiographic guide, wax-up | T1 | E ★ |
| F3 | Landmark registration (3–4 pairs, Horn) | T1 | E B |
| F4 | ICP refinement (trimmed, point-to-plane), RMS + inlier % report | T1 | E B |
| F5 | **Auto-fit (AI/feature-based) CBCT↔IOS with one tap** + manual fallback | T2 | O (Romexis Smart Fit) |
| F6 | Contour overlay of mesh on CBCT slices; multiview adjust; opacity | T1 | E |
| F7 | Warn if registration object is moved after planning (lock registration) | T1 | E |
| F8 | Face-scan registration to CBCT skin; texture preserved | T2 | O |
| F9 | Dual-scan protocol (radiographic guide scan + guide alone) | T2 | E |
| F10 | Mesh editor: crop, smooth, hole-fill, decimate, free-form, gingiva-collapse after extraction | T2 | E |
| F11 | Tooth segmentation on IOS mesh (virtual tooth separation) | T2 | B |
| F12 | Bite registration helper if opposing arch is in a different frame | T2 | ★ |
| F13 | Metal/streak masking before ICP; auto-exclude implants/restorations | T2 | ★ |
| F14 | Photogrammetry/clinical photo overlay on face scan for smile design | T3 | O |

### G. Prosthetic (crown-down) planning
| ID | Feature | Tier | Bench |
|---|---|---|---|
| G1 | Virtual teeth library (FDI), single or multiple, move/rotate/scale, width/height | T1 | B E |
| G2 | Prosthetic-driven: implant aligned to crown axis; screw-access channel; emergence profile | T1 | E B |
| G3 | Instant anatomic morphing as tooth is moved along arch | T2 | E |
| G4 | Occlusal plane / curve of Spee helper; opposing-arch clearance (interocclusal space) in mm | T1 | E ★ |
| G5 | Reverse planning for both arches; occlusion check | T2 | E |
| G6 | Virtual extraction + immediate placement simulation | T1 | B |
| G7 | Edentulous workflow: denture/wax-up scan as radiographic guide, anchor pins | T2 | E |
| G8 | Full-arch (All-on-X) planner: 4/5/6 implants, tilted posterior, arch-form template, bar/prosthesis volume check | T2 | E B ★ |
| G9 | Smile design preview with face scan (crown overlay, midline, smile line) | T2 | E (Smile Creator) |
| G10 | Hand-off: export wax-up/crowns/abutment positions to CAD (STL) | T2 | E |
| G11 | Gingival height & prosthetic space report (min/max for abutment + crown) | T2 | ★ |
| G12 | Pontic/bridge span design, cantilever length warning | T3 | O |

### H. Implant planning
| ID | Feature | Tier | Bench |
|---|---|---|---|
| H1 | Generic implant: **cervical Ø, apical Ø, length** (open geometry), colour, name | T1 | ★ (yours) |
| H2 | Place by tap; drag; apex-handle angulation; numeric nudges; undo | T1 | E B |
| H3 | Duplicate / align-to-other / mirror to contralateral side | T1 | B |
| H4 | Parallelism & inter-implant angle/distance readouts | T1 | E B |
| H5 | **Collision/safety engine**: nerve, foramen, sinus floor, roots, adjacent implants, cortical perforation; adjustable thresholds; traffic-light | T1 | B ★ |
| H6 | Abutment: generic straight/angled (angle in degrees), height; total correction angle | T1 | B E |
| H7 | Auto implant suggestion (size + position) from bone + crown (on-device) | T2 | B (AI) |
| H8 | Implant system library (brand-specific) import: JSON/STL packs, user-built library | T2 | E B |
| H9 | Immediate placement (extraction socket) helper: apical anchorage length, socket gap | T2 | ★ |
| H10 | Bone-density-based drilling protocol display | T3 | E |
| H11 | Zygomatic and pterygoid implant planning | T3 | ★ |
| H12 | Mini-screws / TAD / anchor pin placement | T2 | B E |
| H13 | Sinus lift simulation (lateral/crestal) with graft volume estimate | T2 | O |
| H14 | Ridge augmentation / block graft simulation with volume | T3 | ★ |
| H15 | Implant stability helper (insertion torque notes), thread-pitch parametric | T3 | ★ |
| H16 | Per-implant status (planned/placed/healed) for later follow-up overlay | T3 | ★ |
| H17 | Intra-operative RVG/OPG 2D verification mode (measurement aid, not drilling instructions) | T2 | ★ |
| H18 | 2D-only mode (OPG/RVG/photo) for no-CBCT clinics | T2 | ★ |
| H19 | Planning **without CT** on models/IOS only | T2 | B |
| H20 | Max-angulation & primary-stability warnings | T2 | ★ |

### I. Surgical guide (optional — previously marked OUT; decide)
| ID | Feature | Tier | Bench |
|---|---|---|---|
| I1 | Tooth/bone/mucosa-supported guide design from plan | T3 | E B |
| I2 | Sleeve library, offset/height, inspection windows, undercut removal | T3 | E B |
| I3 | Drill handle / key / sequence tables | T3 | E |
| I4 | Printer presets, STL export of guide + plan elements | T3 | E B |
| I5 | Full-arch guides, pins, fixation guide | T3 | E B |

### J. Reports & documentation
| ID | Feature | Tier | Bench |
|---|---|---|---|
| J1 | One-page planning report (images, implant table, safety distances, disclaimer) PDF | T1 | E B |
| J2 | Image basket / screenshot manager with measurements, comments, order | T1 | E B |
| J3 | Surgical protocol sheet (implants, sizes, depth/angle numbers, notes — measurement aid) | T2 | E |
| J4 | Informed-consent pack & treatment-options summary (editable text) | T2 | ★ |
| J5 | Cost estimate hand-off (export CSV/JSON of plan → quotation tool) | T3 | ★ |
| J6 | Multi-language reports (English, Hindi, others) | T2 | B(8 langs) |
| J7 | Clinic branding on reports (logo, colours) | T2 | ★ |
| J8 | Audit log of plan edits (who/when) | T3 | ★ |

### K. Patient communication
| ID | Feature | Tier | Bench |
|---|---|---|---|
| K1 | **Patient-education mode**: hides numbers, big 3D, teeth, face, smile preview | T1 | ★ |
| K2 | Auto fly-through video of plan (MP4/GIF), share to WhatsApp | T2 | ★ |
| K3 | Before/after smile slider | T2 | ★ |
| K4 | AR "see it in the mouth/face" preview (phone camera) | T3 | ★ |
| K5 | Simple-language labels toggle (e.g., "jaw nerve" vs "inferior alveolar nerve") | T1 | ★ |
| K6 | QR code to patient copy of plan images | T3 | ★ |

### L. AI assist (all **on-device**, no cloud)
| ID | Feature | Tier |
|---|---|---|
| L1 | Quantised ONNX/TFLite models via NNAPI/GPU delegate; model packs downloadable once | T2 |
| L2 | Tooth detection + FDI numbering | T2 |
| L3 | Nerve canal, sinus, jaw bone segmentation | T2 |
| L4 | Auto pano curve | T2 |
| L5 | Auto CBCT↔IOS fit | T2 |
| L6 | Auto implant proposal (size/position) with "why" explanation | T3 |
| L7 | Scan-quality / artefact detector | T3 |
| L8 | Plain-language case summary and risk flags (rule-based first, LLM optional later) | T3 |
| L9 | Human-in-loop always: AI output shown as editable proposal, never auto-accepted | T1 rule |

### M. Collaboration (offline-first)
| ID | Feature | Tier |
|---|---|---|
| M1 | Share plan bundle via Android share sheet / QR / local Wi-Fi (no server) | T2 |
| M2 | Lab/colleague view-only package (HTML viewer inside bundle) | T3 |
| M3 | Optional cloud sync with end-to-end encryption (SaaS phase) | T3 |
| M4 | Role presets: Doctor (all), TC (planning + education), Front desk (education + report) | T2 |
| M5 | Comments/annotations threads inside plan | T3 |

### N. UX — simple and understandable (exoplan's strongest idea, improved)
| ID | Feature | Tier |
|---|---|---|
| N1 | **Guided mode**: 6-step wizard — Load → Orient → Arch & Nerve → Scans → Plan (teeth→implants) → Report | T1 |
| N2 | **Expert mode**: every tool unlocked, customisable rail | T2 |
| N3 | One "next best action" button always visible | T1 |
| N4 | Progressive disclosure: advanced options in "More", never in the way | T1 |
| N5 | Touch-first: ≥ 48 px targets, bottom-reachable controls, stylus support, left/right-hand layout | T1 |
| N6 | Gesture cheat-sheet overlay + interactive 3-minute tutorial using demo case | T1 |
| N7 | Plain-language errors with a fix button ("scan is compressed → convert now") | T1 |
| N8 | Undo/redo + "Restore previous state" always reachable | T1 |
| N9 | Dark / light / outdoor high-contrast themes; colour-blind-safe safety colours | T1 |
| N10 | Voice notes attached to objects | T3 |
| N11 | Search-anything command bar (e.g., "add 46 implant") | T3 |
| N12 | Language packs (English, Hindi first) | T2 |

### O. Platform & distribution
| ID | Feature | Tier |
|---|---|---|
| O1 | Android APK (Capacitor), Android 10+ | T1 |
| O2 | Installable PWA fallback, works offline | T1 |
| O3 | iPad build (same code) | T2 |
| O4 | Windows/macOS via PWA or Electron/Tauri wrapper | T3 |
| O5 | Plan files interchangeable across all platforms | T1 |
| O6 | In-app update check (sideload/Play), signed releases | T2 |

---

## PART 3 — Where we can be *better* than exoplan / BSP

1. **Runs on a tablet/phone, offline, no PC** (both benchmarks are desktop-first).
2. **Open geometry from day 1** (cervical Ø / apical Ø / length) + optional brand packs later — no licence cost, no library lock-in.
3. **Chairside, patient-facing mode** with plain-language labels and a smile preview — built for TC/front desk, not only the surgeon.
4. **One-tap bone metrics + safety traffic light** at every site (BSP has collision detection; exoplan relies on measurement tools).
5. **Crash-proof by design** (see Part 4): journaled autosave, memory governor, worker isolation, graceful degradation.
6. **Hi-res ROI on a half-res full-face volume** — big scans stay smooth on weak hardware.
7. **Opposing arch from the IOS bite** handled natively (CBCT taken with bite fork, IOS in occlusion).
8. **On-device AI with human-in-the-loop**; nothing leaves the device.
9. **Interchangeable 2D (OPG/RVG) and 3D (CBCT) planning** in one app, upgrade path for clinics without CBCT.
10. **Price/licensing**: no per-case export fee (BSP charges for guide export; exoplan is modular annual).

---

## PART 4 — "Light, simple, never crashes" engineering spec

### Weight
- APK ≤ 60 MB (AI models as optional downloadable packs, 15–40 MB each).
- Cold start ≤ 3 s; idle RAM ≤ 250 MB; volume budget auto-tuned to device (`deviceMemory`, GL limits).
- No heavy UI framework bloat: React + Zustand, tree-shaken three.js, lazy-loaded modules (guide, AI, reports).

### Stability (zero-crash design)
| Risk | Defence |
|---|---|
| Out-of-memory on big CBCT | Memory governor: pre-flight estimate, streamed parse, auto half-res, refuse-with-advice instead of crash |
| WebGL context loss (Android backgrounding) | Handle `webglcontextlost/restored`; rebuild textures from cached volume; no data loss |
| Long tasks freeze UI | All parse/ICP/pano/AI in Web Workers; main thread budget 8 ms/frame; cancellable jobs with progress |
| App killed mid-edit | Append-only journal in IndexedDB; restore on next launch; snapshot every N edits |
| Corrupt/odd DICOM | Defensive parser, per-slice try/catch, skip + report bad slices, "partial load" mode |
| Mesh too large | Auto-decimate preview, keep original for export; triangle cap warning |
| Schema change breaks old plans | Versioned schema + migrations + golden-file tests (BSP V3 couldn't open V2 plans — we must) |
| Device throttling/heat | Adaptive quality + FPS governor, pause background work when interacting |
| Regression | CI: unit + golden screenshot + load-test matrix (small/medium/full-face × 5 vendors) + 30-min soak test + monkey/gesture fuzz test |
| Crashes in field | Local crash log (user can share); safe-mode launch (disables GPU VR/AI) |

### Smoothness
- Interaction budget: ≤ 16 ms MPR, ≥ 30 fps VR while moving; refine on idle.
- Dirty-flag rendering; typed arrays; no allocations in loops; texture slab uploads.
- Optional native renderer (Kotlin/Vulkan) if WebView cannot meet targets on mid-range devices.

### Easy to understand
- 6-step guided mode as default for new users; expert mode opt-in.
- Max 3 taps to place an implant; max 5 to produce a report.
- Every tool has an icon + label + one-line hint; interactive tutorial on demo case.
- Same interaction grammar everywhere: tap = select, drag = move, handle = rotate, long-press = options.

### Privacy, security, regulatory
- No INTERNET permission in v1 build; data stays on device; optional app lock (biometric) and encrypted storage (Android Keystore).
- Incognito mode for demos; anonymise export option.
- Planning aid framing: reports numbers, **never issues drilling instructions** (keeps regulatory class lower); disclaimer on every export; AI proposals editable and never auto-accepted.
- Pre-commercial: get regulatory advice (CDSCO India, CE/MDR, FDA) — exoplan itself is FDA-cleared; software that plans implants/guides is typically regulated.
- Validation plan: phantom ground truth, comparison against exoplan/BSP on the same 20 cases (position, angle, distances within tolerance), clinician sign-off log.

---

## PART 5 — Release mapping

| Release | Contents |
|---|---|
| **v1.0 (T1)** | A1–A6,A10,A12; B1–B3,B5–B7,B11; C1–C6,C8,C9; D1–D3,D6; E1–E4; F1–F4,F6,F7; G1,G2,G4,G6; H1–H6; J1,J2; K1,K5; L9; N1,N3–N9; O1,O2,O5 |
| **v2.0 (T2 parity)** | Auto pano/nerve/segmentation, auto-fit IOS, face scan, edentulous + All-on-X, sinus lift sim, brand library packs, reports/protocol, 2D mode, roles, languages, iPad |
| **v3.0 (T3 beyond)** | Zygomatic/pterygoid, AR, airway/TMJ/endo/perio, guide design (if you decide), cloud E2E sync, auto implant proposals with explanations |

## PART 6 — Decisions needed from you
1. **Surgical guide design (I1–I5)**: earlier you put it OUT. Keep out, or add as T3?
2. **Brand implant libraries**: stay generic until v2, or prioritise 2–3 brands you use (needs geometry data from manufacturers)?
3. **AI**: on-device only (recommended) — OK to budget for training/licensing segmentation models (own data vs open datasets)?
4. **Target hardware** and Android version (drives memory/AI tiers).
5. **Commercial intent** (clinic-only vs SaaS) — decides regulatory timing.

---

## Sources
- exoplan product page: https://exocad.com/our-products/exoplan
- exoplan brochure: https://bcontent.exocad.com/fileadmin/content/brochures/exocad_exoplan_brochure_en_screen.pdf
- exoplan 3.1 Rijeka what's new: https://bcontent.exocad.com/fileadmin/content/brochures/exocad_whats_new_exoplan_Rijeka_EN_Screen_DS.pdf
- exoplan 3.0 Galway features: https://exocad.com/our-products/exoplan-galway
- Blue Sky Plan features: https://blueskybio.com/pages/full-featured-treatment-planning-software-computer-guided-surgery
- Blue Sky Plan advantages: https://blueskybio.com/pages/blue-sky-plan-advantages
- BSP manual contents (segmentation, airway, guides): https://blueskybio.com/caffeine/uploads/files/documents/BS-LS-IFU-06-en-Att%20Ver%209.pdf
- BSP 4.11 AI implant placing: https://www.dentalproductsreport.com/view/blueskybio-adds-ai-powered-automatic-implant-placing-to-software
- Romexis 7 AI/Smart Fit: https://www.planmeca.com/dental-software/releases/releases-list/romexis-7-software-release-6.5.1
- DEXIS AI workflow: https://www.newswire.com/news/dexis-drives-dental-imaging-innovation-with-introduction-of-ai-powered-22240334
- Carestream CS 3D auto arch/nerve: https://www.carestreamdental.com/en-us/discover/clinical-software/imaging-software/cs-3d-imaging-software/whats-new/whats-new-v3.10.75
- i-CAT Tx Studio: https://www.dentalproductsreport.com/i-cat-debuts-new-release-3d-treatment-planning-software-aao
- Planning-system comparison (bone density reliability, registration): https://pmc.ncbi.nlm.nih.gov/articles/PMC7488021

_Note: the vendor pages describe features at a marketing level; exact behaviour should be verified hands-on with trial copies before claiming parity._
