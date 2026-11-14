import { describe, expect, it } from 'vitest';
import { existsSync, openAsBlob } from 'node:fs';
import { parseDicom, T } from '../../src/core/dicom/parser';
import { isZip, listEntries, readEntry } from '../../src/core/io/zip';
import { assembleSeries, readSliceHeader } from '../../src/core/volume/series';
import { VolumeBuilder } from '../../src/core/volume/builder';
import { chooseFactor, tierForRam, workingBytes } from '../../src/core/volume/budget';
import { voxelToWorld, worldToVoxel } from '../../src/core/volume/volume';
import { extractSlice, pixelToVoxel, voxelToPixel, WindowLut } from '../../src/render/mpr';
import { loadCbct } from '../../src/workers/loader';
import { age, migrateCase, newCase, toothName } from '../../src/core/case/model';
import { makeDicom, makeZip, phantomSlices } from '../fixtures';

const ramp = (x: number, y: number) => x + 10 * y;

describe('DICOM parser', () => {
  for (const ts of ['explicit', 'implicit', 'bigendian'] as const) {
    it(`reads ${ts} VR`, () => {
      const ds = parseDicom(makeDicom({ rows: 4, cols: 5, z: 1.5, pixel: ramp, transferSyntax: ts }));
      expect(ds.number(T.Rows)).toBe(4);
      expect(ds.number(T.Columns)).toBe(5);
      expect(ds.numbers(T.ImagePositionPatient)).toEqual([-10, -20, 1.5]);
      expect(ds.number(T.RescaleIntercept)).toBe(-1000);
      expect(ds.string(T.PatientName)).toBe('Doe^Jane');
      const px = ds.elements.get(T.PixelData)!;
      expect(px.length).toBe(40);
      expect(ds.truncated).toBe(false);
    });
  }
  it('ignores tags nested in undefined-length sequences', () => {
    const ds = parseDicom(makeDicom({ rows: 4, cols: 5, z: 0, pixel: ramp, extraSequence: true }));
    expect(ds.number(T.Rows)).toBe(4);
  });
  it('flags a header-only prefix as truncated', () => {
    const full = makeDicom({ rows: 64, cols: 64, z: 0, pixel: ramp });
    const ds = parseDicom(full.subarray(0, 200), { stopAtPixelData: true });
    expect(ds.truncated).toBe(true);
  });
  it('parses files without a preamble', () => {
    const ds = parseDicom(makeDicom({ rows: 2, cols: 2, z: 0, pixel: ramp, withPreamble: false }));
    expect(ds.number(T.Columns)).toBe(2);
  });
});

describe('ZIP reader', () => {
  for (const deflate of [true, false]) {
    it(`reads ${deflate ? 'deflated' : 'stored'} entries, whole and prefix`, async () => {
      const a = new Uint8Array(5000).map((_, i) => i % 251);
      const zip = await makeZip([{ name: 'dir/a.bin', data: a }, { name: 'b.txt', data: new TextEncoder().encode('hello') }], deflate);
      expect(await isZip(zip)).toBe(true);
      const entries = await listEntries(zip);
      expect(entries.map((e) => e.name)).toEqual(['dir/a.bin', 'b.txt']);
      expect(await readEntry(zip, entries[0])).toEqual(a);
      expect(await readEntry(zip, entries[0], 100)).toEqual(a.subarray(0, 100));
    });
  }
});

describe('series and volume', () => {
  it('sorts shuffled slices by position and derives spacing', () => {
    const files = phantomSlices(10, 8, 0.4);
    const headers = files.map((f, i) => readSliceHeader(parseDicom(f), i)!).reverse();
    const [s] = assembleSeries(headers);
    expect(s.slices.map((x) => x.ipp[2])).toEqual(s.slices.map((x) => x.ipp[2]).slice().sort((a, b) => a - b));
    expect(s.spacing[2]).toBeCloseTo(0.4);
    expect(s.warnings).toEqual([]);
  });

  it('box-averages into the working volume with correct HU and geometry', () => {
    const files = Array.from({ length: 4 }, (_, k) => makeDicom({ rows: 4, cols: 4, z: k, spacing: 1, pixel: (x, y) => 1000 + x + 4 * y + 16 * k }));
    const headers = files.map((f, i) => readSliceHeader(parseDicom(f), i)!);
    const [s] = assembleSeries(headers);
    const b = new VolumeBuilder(s, 2);
    for (const h of s.slices) {
      const ds = parseDicom(files[h.source]);
      const px = ds.elements.get(T.PixelData)!;
      b.addSlice(h, files[h.source].subarray(px.offset, px.offset + px.length));
    }
    const v = b.finish();
    expect(v.dims).toEqual([2, 2, 2]);
    expect(v.spacing).toEqual([2, 2, 2]);
    // Mean of block (x0..1, y0..1, k0..1) = 1000 + 0.5 + 2 + 8 - 1000 = 10.5 -> 11 (rounded)
    expect(v.data[0]).toBe(11);
    // Voxel centre of the first block sits half a source voxel in.
    expect(v.origin).toEqual([-9.5, -19.5, 0.5]);
    const w = voxelToWorld(v, 1, 1, 1);
    expect(worldToVoxel(v, w).map((x) => +x.toFixed(6))).toEqual([1, 1, 1]);
  });
});

describe('budget', () => {
  it('maps RAM to tiers and fits the cap', () => {
    expect(tierForRam(12)).toBe('H');
    expect(tierForRam(6)).toBe('M');
    expect(tierForRam(4)).toBe('L');
    const dims: [number, number, number] = [688, 688, 667];
    expect(chooseFactor('H', dims, 0.15, 12)).toBe(2);
    expect(chooseFactor('M', dims, 0.15, 6)).toBe(3);
    expect(chooseFactor('L', dims, 0.15, 4)).toBe(4);
    // A 2 GB device steps down further instead of crashing.
    const f = chooseFactor('H', dims, 0.15, 2);
    expect(workingBytes(dims, f) * 2 + 160 * 1024 ** 2).toBeLessThan(2 * 1024 ** 3 * 0.35);
  });
});

describe('MPR', () => {
  it('extracts slices and maps pixels back to voxels', async () => {
    const files = phantomSlices(12, 16, 0.5);
    const blob = await makeZip(files.map((d, i) => ({ name: `s/${i}.dcm`, data: d })));
    const r = await loadCbct([new File([blob], 'p.zip')], { tier: 'H', ramGb: 16 });
    const v = r.volume;
    expect(v.factor).toBe(1);
    for (const kind of ['axial', 'coronal', 'sagittal'] as const) {
      const c: [number, number, number] = [3, 5, 7];
      const idx = kind === 'axial' ? 7 : kind === 'coronal' ? 5 : 3;
      const img = extractSlice(v, kind, idx);
      const [x, y] = voxelToPixel(v, kind, c);
      expect(pixelToVoxel(v, kind, idx, x, y)).toEqual(c);
      expect(img.data[y * img.w + x]).toBe(v.data[c[0] + v.dims[0] * (c[1] + v.dims[1] * c[2])]);
    }
    const lut = new WindowLut();
    lut.set(0, 100);
    const out = new Uint32Array(3);
    lut.apply(new Int16Array([-1000, 0, 1000]), out);
    expect(out[0] & 0xff).toBe(0);
    expect(out[2] & 0xff).toBe(255);
  });
});

describe('loader', () => {
  it('opens a zipped phantom series end to end', async () => {
    const files = phantomSlices(16, 32, 0.5);
    const blob = await makeZip([{ name: 'DICOMDIR', data: new Uint8Array(400) }, ...files.map((d, i) => ({ name: `case/${i}.dcm`, data: d }))]);
    const r = await loadCbct([new File([blob], 'case.zip')], { tier: 'L', ramGb: 4 });
    expect(r.sliceCount).toBe(16);
    expect(r.volume.factor).toBe(1); // 0.5 mm already near the 0.6 mm target
    const v = r.volume;
    const centre = v.data[(v.dims[0] >> 1) + v.dims[0] * ((v.dims[1] >> 1) + v.dims[1] * (v.dims[2] >> 1))];
    expect(centre).toBe(1000);
    expect(v.data[0]).toBe(-1000);
    expect(r.meta.patientName).toBe('Doe Jane');
  });

  it('opens loose .dcm files', async () => {
    const files = phantomSlices(12, 16, 0.5).map((d, i) => new File([d], `${i}.dcm`));
    const r = await loadCbct(files, { tier: 'H', ramGb: 8 });
    expect(r.sliceCount).toBe(12);
  });

  const REAL = process.env.CASE_ZIP;
  it.skipIf(!REAL || !existsSync(REAL))('opens the real test case at tier H', async () => {
    const blob = await openAsBlob(REAL!);
    const r = await loadCbct([new File([blob], 'case.zip')], { tier: 'H', ramGb: 12 });
    expect(r.sliceCount).toBe(667);
    expect(r.volume.dims).toEqual([344, 344, 334]);
    expect(r.volume.spacing[0]).toBeCloseTo(0.3);
  }, 300000);
});

describe('case model', () => {
  it('creates, migrates and describes cases', () => {
    const c = newCase();
    const old = { ...c, patient: { name: 'X' } } as unknown;
    const m = migrateCase(old);
    expect(m.patient.medical.smoker).toBe(false);
    expect(m.patient.name).toBe('X');
    expect(toothName(46)).toBe('lower right first molar');
    expect(age('1980-06-15', new Date('2026-11-14'))).toBe(46);
  });
});
