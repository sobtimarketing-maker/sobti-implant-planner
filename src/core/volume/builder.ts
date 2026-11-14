// Streaming working-volume builder. Slices are fed in sorted order; each is
// box-averaged into an accumulator plane, so only one output plane plus one
// source slice is ever held besides the result (never the full volume).
import { SliceHeader, Series } from './series';
import { Volume, Vec3 } from './volume';

export class VolumeBuilder {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly data: Int16Array;
  private acc: Float32Array;
  private cnt: Uint16Array;
  private slicesInPlane = 0;
  private k = 0;
  private colIdx: Uint32Array; // source column -> output column

  constructor(private series: Series, readonly f: number) {
    this.nx = Math.ceil(series.cols / f);
    this.ny = Math.ceil(series.rows / f);
    this.nz = Math.ceil(series.slices.length / f);
    this.data = new Int16Array(this.nx * this.ny * this.nz);
    this.acc = new Float32Array(this.nx * this.ny);
    this.cnt = new Uint16Array(this.nx * this.ny);
    this.colIdx = new Uint32Array(series.cols);
    for (let x = 0; x < series.cols; x++) this.colIdx[x] = (x / f) | 0;
  }

  /** Add the next slice (in sorted order). `pixels` is the raw PixelData bytes. */
  addSlice(h: SliceHeader, pixels: Uint8Array): void {
    const { rows, cols } = h;
    const n = rows * cols;
    const f = this.f, nx = this.nx;
    const acc = this.acc, cnt = this.cnt, colIdx = this.colIdx;
    const slope = h.slope, icpt = h.intercept;
    const bytesPer = h.bitsAllocated >> 3;
    if (pixels.length < n * bytesPer) throw new Error('Pixel data shorter than expected');
    let src: ArrayLike<number>;
    if (bytesPer === 2) {
      const aligned = (pixels.byteOffset & 1) === 0 ? pixels : pixels.slice();
      const swap = !h.littleEndian;
      if (swap) {
        const tmp = new Uint8Array(n * 2);
        for (let i = 0; i < n * 2; i += 2) { tmp[i] = aligned[i + 1]; tmp[i + 1] = aligned[i]; }
        src = h.pixelRepresentation ? new Int16Array(tmp.buffer) : new Uint16Array(tmp.buffer);
      } else {
        src = h.pixelRepresentation
          ? new Int16Array(aligned.buffer, aligned.byteOffset, n)
          : new Uint16Array(aligned.buffer, aligned.byteOffset, n);
      }
    } else if (bytesPer === 1) {
      src = h.pixelRepresentation ? new Int8Array(pixels.buffer, pixels.byteOffset, n) : pixels;
    } else {
      throw new Error(`BitsAllocated ${h.bitsAllocated} not supported`);
    }
    for (let y = 0; y < rows; y++) {
      const rowOut = ((y / f) | 0) * nx;
      const rowIn = y * cols;
      for (let x = 0; x < cols; x++) {
        const o = rowOut + colIdx[x];
        acc[o] += src[rowIn + x] * slope + icpt;
        cnt[o]++;
      }
    }
    this.slicesInPlane++;
    if (this.slicesInPlane === f) this.flush();
  }

  private flush(): void {
    if (this.slicesInPlane === 0) return;
    const base = this.k * this.nx * this.ny;
    const acc = this.acc, cnt = this.cnt, out = this.data;
    for (let i = 0; i < acc.length; i++) {
      const v = cnt[i] ? acc[i] / cnt[i] : -1000;
      out[base + i] = v < -32768 ? -32768 : v > 32767 ? 32767 : Math.round(v);
    }
    acc.fill(0);
    cnt.fill(0);
    this.slicesInPlane = 0;
    this.k++;
  }

  finish(): Volume {
    this.flush();
    const s = this.series, f = this.f;
    // The centre of an f-block sits (f-1)/2 source voxels in from the first voxel.
    const shift = (f - 1) / 2;
    const o = s.origin;
    const off = (d: Vec3, mm: number) => [d[0] * mm, d[1] * mm, d[2] * mm];
    const a = off(s.rowDir, shift * s.spacing[0]);
    const b = off(s.colDir, shift * s.spacing[1]);
    const c = off(s.normal, shift * s.spacing[2]);
    return {
      dims: [this.nx, this.ny, this.nz],
      spacing: [s.spacing[0] * f, s.spacing[1] * f, s.spacing[2] * f],
      origin: [o[0] + a[0] + b[0] + c[0], o[1] + a[1] + b[1] + c[1], o[2] + a[2] + b[2] + c[2]],
      rowDir: s.rowDir, colDir: s.colDir, normal: s.normal,
      factor: f,
      sourceDims: [s.cols, s.rows, s.slices.length],
      sourceSpacing: s.spacing,
      data: this.data,
    };
  }
}
