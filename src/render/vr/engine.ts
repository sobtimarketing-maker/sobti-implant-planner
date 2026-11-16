// Own WebGL2 3D engine (Session 4): GPU ray marching of the working volume
// plus triangle surfaces (teeth, nerves, the point marker), all in world LPS
// millimetres.
//
// One WebGL context for the whole app, on a canvas that is never shown:
// every 3D view renders here and copies the picture onto its own 2D canvas,
// so the volume is uploaded to the GPU once however many 3D views are open.
//
// Pass 1 draws the surfaces into a framebuffer (colour + depth texture).
// Pass 2 marches a ray per pixel through the volume texture (8-bit, 16 HU per
// step), skips empty 8³ blocks, stops at the surface depth and lays the
// volume over the surface colour. Front-to-back compositing with early stop.
import type { Vec3, Volume } from '../../core/volume/volume';
import { HU_MIN, HU_SPAN, PresetId, firstVisible, transferTable } from './presets';
import { Mat4, invert, lookAt, multiply, perspective, transformPoint } from './mat4';

export interface SurfaceMesh { positions: Float32Array; indices: Uint32Array; colors?: Uint8Array }

export interface SceneSurface {
  key: string;                       // cache key: change it when the shape changes
  color: [number, number, number];   // 0..1
  mesh: () => SurfaceMesh;
  /** Place the mesh: offset (mm) and scale, for shared shapes like the point marker. */
  at?: [number, number, number, number];
  /** Rigid placement (column-major 4×4), e.g. a mouth scan's scan -> CBCT fit. */
  model?: ArrayLike<number>;
  /** Use the mesh's own vertex colours (e.g. a distance map) instead of color. */
  vertexColors?: boolean;
  /** Surface look: 'enamel' adds a key light, gloss and translucent edges (crowns). */
  material?: 'enamel';
}

export interface Camera { target: Vec3; yaw: number; pitch: number; dist: number; fov: number }

export type ClipMode = 'none' | 'lower' | 'upper' | 'front';

export interface RenderOpts {
  width: number; height: number;   // device pixels to render
  camera: Camera;
  preset: PresetId;
  clip: ClipMode;
  cursor: Vec3 | null;
  surfaces: SceneSurface[];
  fast: boolean;                   // interacting: bigger steps, no shading
  volume: boolean;                 // draw the volume (else surfaces only)
}

const IDENTITY4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const BG: [number, number, number] = [5 / 255, 11 / 255, 22 / 255];

export function cameraEye(c: Camera): { eye: Vec3; up: Vec3 } {
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
  // yaw 0, pitch 0: looking at the face from the front (eye anterior, -y in LPS).
  const dir: Vec3 = [sy * cp, -cy * cp, sp];
  const up: Vec3 = [-sy * sp, cy * sp, cp];
  return { eye: [c.target[0] + dir[0] * c.dist, c.target[1] + dir[1] * c.dist, c.target[2] + dir[2] * c.dist], up };
}

export function viewProj(c: Camera, aspect: number): Mat4 {
  const { eye, up } = cameraEye(c);
  return multiply(perspective(c.fov, aspect, Math.max(1, c.dist * 0.05), c.dist * 4), lookAt(eye, c.target, up));
}

export function clipPlane(mode: ClipMode, at: Vec3 | null): [number, number, number, number] | null {
  if (mode === 'none' || !at) return null;
  // Discard where n·p + d > 0.
  if (mode === 'lower') return [0, 0, 1, -at[2]];   // hide above the point
  if (mode === 'upper') return [0, 0, -1, at[2]];   // hide below the point
  return [0, -1, 0, at[1]];                         // hide anterior of the point
}

/** Matrix from texture coordinates [0,1]³ to world mm. */
export function texToWorld(v: Volume): Mat4 {
  const [nx, ny, nz] = v.dims, [sx, sy, sz] = v.spacing;
  const m = new Float32Array(16);
  const cols = [v.rowDir.map((x) => x * sx * nx), v.colDir.map((x) => x * sy * ny), v.normal.map((x) => x * sz * nz)];
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] = cols[c][r];
  // texture coordinate t maps to voxel t*n - 0.5
  for (let r = 0; r < 3; r++) m[12 + r] = v.origin[r] - 0.5 * (v.rowDir[r] * sx + v.colDir[r] * sy + v.normal[r] * sz);
  m[15] = 1;
  return m;
}

const VS_QUAD = `#version 300 es
in vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS_VOL = `#version 300 es
precision highp float; precision highp sampler3D; precision highp int;
uniform sampler3D uVol; uniform sampler3D uMacro; uniform sampler2D uTF;
uniform sampler2D uMeshColor; uniform sampler2D uMeshDepth;
uniform mat4 uInvVP; uniform mat4 uW2T; uniform mat3 uNrm;
uniform vec2 uSize; uniform float uStep; uniform float uLow; uniform vec3 uTexel;
uniform vec4 uClip; uniform int uClipOn; uniform int uShade; uniform int uVolOn; uniform vec3 uBg;
out vec4 outColor;
void main() {
  vec2 ndc = gl_FragCoord.xy / uSize * 2.0 - 1.0;
  vec4 a = uInvVP * vec4(ndc, -1.0, 1.0); a /= a.w;
  vec4 b = uInvVP * vec4(ndc, 1.0, 1.0); b /= b.w;
  vec3 ro = a.xyz, rd = normalize(b.xyz - a.xyz);
  ivec2 pc = ivec2(gl_FragCoord.xy);
  vec4 mc = texelFetch(uMeshColor, pc, 0);
  float md = texelFetch(uMeshDepth, pc, 0).r;
  float tMesh = 1e9;
  if (md < 1.0) { vec4 p = uInvVP * vec4(ndc, md * 2.0 - 1.0, 1.0); p /= p.w; tMesh = dot(p.xyz - ro, rd); }
  vec4 acc = vec4(0.0);
  if (uVolOn == 1) {
    vec3 to = (uW2T * vec4(ro, 1.0)).xyz;
    vec3 td = (uW2T * vec4(rd, 0.0)).xyz;
    vec3 inv = 1.0 / td;
    vec3 t0 = -to * inv, t1 = (1.0 - to) * inv;
    vec3 tmn = min(t0, t1), tmx = max(t0, t1);
    float tn = max(max(max(tmn.x, tmn.y), tmn.z), 0.0);
    float tf = min(min(min(tmx.x, tmx.y), tmx.z), tMesh);
    float t = tn + uStep * fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    for (int i = 0; i < 4096; i++) {
      if (t > tf || acc.a > 0.97) break;
      vec3 p = to + td * t;
      if (texture(uMacro, p).r < uLow) { t += uStep * 3.0; continue; }
      vec3 w = ro + rd * t;
      if (uClipOn == 1 && dot(uClip.xyz, w) + uClip.w > 0.0) { t += uStep; continue; }
      float v = texture(uVol, p).r;
      vec4 c = texture(uTF, vec2(v, 0.5));
      if (c.a > 0.003) {
        if (uShade == 1) {
          vec3 g = vec3(
            texture(uVol, p + vec3(uTexel.x, 0, 0)).r - texture(uVol, p - vec3(uTexel.x, 0, 0)).r,
            texture(uVol, p + vec3(0, uTexel.y, 0)).r - texture(uVol, p - vec3(0, uTexel.y, 0)).r,
            texture(uVol, p + vec3(0, 0, uTexel.z)).r - texture(uVol, p - vec3(0, 0, uTexel.z)).r);
          vec3 n = uNrm * g;
          float l = length(n);
          if (l > 1e-5) {
            n /= l;
            float d = abs(dot(n, rd));
            float spec = pow(d, 24.0) * 0.25;
            c.rgb = c.rgb * (0.32 + 0.68 * d) + spec;
          }
        }
        float al = 1.0 - pow(1.0 - c.a, uStep / 0.5);
        acc.rgb += (1.0 - acc.a) * al * c.rgb;
        acc.a += (1.0 - acc.a) * al;
      }
      t += uStep;
    }
  }
  vec3 under = mc.a > 0.0 ? mc.rgb : uBg;
  outColor = vec4(acc.rgb + (1.0 - acc.a) * under, 1.0);
}`;

const VS_MESH = `#version 300 es
in vec3 aPos; in vec3 aNrm; in vec3 aCol;
uniform mat4 uVP; uniform vec4 uAt; uniform mat4 uModel;
out vec3 vN; out vec3 vW; out vec3 vC;
void main() {
  vN = mat3(uModel) * aNrm; vC = aCol;
  vW = (uModel * vec4(aPos * uAt.w + uAt.xyz, 1.0)).xyz;
  gl_Position = uVP * vec4(vW, 1.0);
}`;

const FS_MESH = `#version 300 es
precision highp float;
in vec3 vN; in vec3 vW; in vec3 vC;
uniform vec3 uColor; uniform vec3 uEye; uniform vec4 uClip; uniform int uClipOn; uniform int uUseCol; uniform int uMat; uniform vec3 uLight;
out vec4 outColor;
void main() {
  if (uClipOn == 1 && dot(uClip.xyz, vW) + uClip.w > 0.0) discard;
  vec3 n = normalize(vN);
  vec3 v = normalize(uEye - vW);
  float d = abs(dot(n, v));
  vec3 base = uUseCol == 1 ? vC : uColor;
  if (uMat == 1) {
    // Enamel: soft wrapped key light (light passes into the tooth), sharp gloss,
    // bluish translucent rim, warm fill from the viewer.
    if (dot(n, v) < 0.0) n = -n;
    vec3 L = normalize(uLight);
    float wrap = max(0.0, (dot(n, L) + 0.4) / 1.4);
    float hv = max(0.0, dot(n, normalize(L + v)));
    float spec = pow(hv, 80.0) * 0.5 + pow(hv, 14.0) * 0.07;
    float fres = pow(1.0 - d, 3.0);
    vec3 col = base * (0.2 + 0.55 * wrap + 0.22 * d) + base * vec3(1.0, 0.9, 0.78) * 0.06 + spec + vec3(0.7, 0.78, 0.88) * fres * 0.2;
    outColor = vec4(col, 1.0);
    return;
  }
  outColor = vec4(base * (0.3 + 0.7 * d) + pow(d, 30.0) * 0.25, 1.0);
}`;

interface GpuMesh { vao: WebGLVertexArrayObject; buffers: WebGLBuffer[]; count: number }

export class Engine3D {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private lost = false;
  private volProg: WebGLProgram | null = null;
  private meshProg: WebGLProgram | null = null;
  private quad: WebGLVertexArrayObject | null = null;
  private volTex: WebGLTexture | null = null;
  private macroTex: WebGLTexture | null = null;
  private tfTex: WebGLTexture | null = null;
  private tfPreset: PresetId | null = null;
  private low = 0;
  private volume: Volume | null = null;
  private w2t: Mat4 | null = null;
  private nrm = new Float32Array(9);
  private fbo: WebGLFramebuffer | null = null;
  private fboColor: WebGLTexture | null = null;
  private fboDepth: WebGLTexture | null = null;
  private fboSize: [number, number] = [0, 0];
  private meshes = new Map<string, GpuMesh>();
  private uniforms = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  readonly tables = new Map<PresetId, Uint8Array>();
  /** Set when the GPU could not be used at all. */
  error = '';

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 2; this.canvas.height = 2;
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; this.dropGpu(); });
    this.canvas.addEventListener('webglcontextrestored', () => { this.lost = false; });
  }

  table(p: PresetId): Uint8Array { let t = this.tables.get(p); if (!t) { t = transferTable(p); this.tables.set(p, t); } return t; }

  /** The volume the engine shows (uploaded on the next render). */
  setVolume(v: Volume): void {
    if (this.volume === v) return;
    this.volume = v;
    const gl = this.gl;
    if (gl && this.volTex) { gl.deleteTexture(this.volTex); gl.deleteTexture(this.macroTex); }
    this.volTex = this.macroTex = null;
    this.w2t = null;
  }

  private dropGpu(): void {
    this.volProg = this.meshProg = null; this.quad = null;
    this.volTex = this.macroTex = this.tfTex = null; this.tfPreset = null;
    this.fbo = null; this.fboColor = this.fboDepth = null; this.fboSize = [0, 0];
    this.meshes.clear(); this.uniforms.clear();
  }

  private init(): WebGL2RenderingContext | null {
    if (this.lost) return null;
    if (!this.gl) {
      this.gl = this.canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
      if (!this.gl) { this.error = 'This device cannot show 3D (no WebGL2).'; return null; }
    }
    const gl = this.gl;
    if (gl.isContextLost()) return null;
    if (!this.volProg) {
      this.volProg = program(gl, VS_QUAD, FS_VOL);
      this.meshProg = program(gl, VS_MESH, FS_MESH);
      this.quad = gl.createVertexArray();
      gl.bindVertexArray(this.quad);
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(this.volProg, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
    return gl;
  }

  private u(p: WebGLProgram, name: string): WebGLUniformLocation | null {
    let m = this.uniforms.get(p);
    if (!m) { m = new Map(); this.uniforms.set(p, m); }
    if (!m.has(name)) m.set(name, this.gl!.getUniformLocation(p, name));
    return m.get(name)!;
  }

  private uploadVolume(gl: WebGL2RenderingContext, v: Volume): void {
    const [nx, ny, nz] = v.dims;
    const n = nx * ny * nz;
    const bytes = new Uint8Array(n);
    const k = 255 / HU_SPAN, d = v.data;
    for (let i = 0; i < n; i++) { const x = (d[i] - HU_MIN) * k; bytes[i] = x < 0 ? 0 : x > 255 ? 255 : x; }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.volTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, this.volTex);
    gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R8, nx, ny, nz);
    // Upload in slabs to keep each call small.
    const slab = Math.max(1, Math.floor((8 << 20) / (nx * ny)));
    for (let z = 0; z < nz; z += slab) {
      const h = Math.min(slab, nz - z);
      gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, z, nx, ny, h, gl.RED, gl.UNSIGNED_BYTE, bytes.subarray(z * nx * ny, (z + h) * nx * ny));
    }
    texParams(gl, gl.TEXTURE_3D, gl.LINEAR);
    // Empty-space blocks: max of each 8³ block and its neighbours.
    const B = 8, bx = Math.ceil(nx / B), by = Math.ceil(ny / B), bz = Math.ceil(nz / B);
    const mx = new Uint8Array(bx * by * bz);
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
      const row = (y + ny * z) * nx, bi = bx * (Math.floor(y / B) + by * Math.floor(z / B));
      for (let x = 0; x < nx; x++) { const val = bytes[row + x], q = bi + Math.floor(x / B); if (val > mx[q]) mx[q] = val; }
    }
    const grown = new Uint8Array(mx.length);
    for (let z = 0; z < bz; z++) for (let y = 0; y < by; y++) for (let x = 0; x < bx; x++) {
      let m = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy, Z = z + dz;
        if (X < 0 || Y < 0 || Z < 0 || X >= bx || Y >= by || Z >= bz) continue;
        const val = mx[X + bx * (Y + by * Z)]; if (val > m) m = val;
      }
      grown[x + bx * (y + by * z)] = m;
    }
    this.macroTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, this.macroTex);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, bx, by, bz, 0, gl.RED, gl.UNSIGNED_BYTE, grown);
    texParams(gl, gl.TEXTURE_3D, gl.NEAREST);
    // World <-> texture, and the gradient-to-world-normal matrix (inverse transpose).
    const t2w = texToWorld(v);
    this.w2t = invert(t2w);
    const w = this.w2t; // normal = (T2W linear)^-T * g = (W2T linear)^T * g
    this.nrm.set([w[0], w[4], w[8], w[1], w[5], w[9], w[2], w[6], w[10]]);
  }

  private ensureFbo(gl: WebGL2RenderingContext, w: number, h: number): void {
    if (this.fbo && this.fboSize[0] >= w && this.fboSize[1] >= h) return;
    const W = Math.max(w, this.fboSize[0]), H = Math.max(h, this.fboSize[1]);
    if (this.fbo) { gl.deleteFramebuffer(this.fbo); gl.deleteTexture(this.fboColor); gl.deleteTexture(this.fboDepth); }
    this.fboColor = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.fboColor);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H);
    texParams(gl, gl.TEXTURE_2D, gl.NEAREST);
    this.fboDepth = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.fboDepth);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, W, H);
    texParams(gl, gl.TEXTURE_2D, gl.NEAREST);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboColor, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.fboDepth, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.fboSize = [W, H];
  }

  private gpuMesh(gl: WebGL2RenderingContext, s: SceneSurface): GpuMesh | null {
    const hit = this.meshes.get(s.key);
    if (hit) return hit;
    const m = s.mesh();
    if (!m.indices.length) return null;
    const normals = vertexNormals(m);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const pb = gl.createBuffer()!, nb = gl.createBuffer()!, ib = gl.createBuffer()!;
    const prog = this.meshProg!;
    gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, m.positions, gl.STATIC_DRAW);
    let loc = gl.getAttribLocation(prog, 'aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
    loc = gl.getAttribLocation(prog, 'aNrm'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    const buffers = [pb, nb, ib];
    loc = gl.getAttribLocation(prog, 'aCol');
    if (m.colors && loc >= 0) {
      const cb = gl.createBuffer()!; buffers.push(cb);
      gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.bufferData(gl.ARRAY_BUFFER, m.colors, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.UNSIGNED_BYTE, true, 0, 0);
    } else if (loc >= 0) { gl.disableVertexAttribArray(loc); gl.vertexAttrib3f(loc, 0.8, 0.8, 0.8); }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const g = { vao, buffers, count: m.indices.length };
    this.meshes.set(s.key, g);
    return g;
  }

  meshKeys(): IterableIterator<string> { return this.meshes.keys(); }

  /** Free GPU meshes whose keys are no longer used. */
  keepMeshes(keys: Set<string>): void {
    const gl = this.gl;
    for (const [k, m] of this.meshes) {
      if (keys.has(k)) continue;
      if (gl) { gl.deleteVertexArray(m.vao); m.buffers.forEach((b) => gl.deleteBuffer(b)); }
      this.meshes.delete(k);
    }
  }

  /**
   * Render into the engine canvas. Returns the source rectangle to copy
   * from (canvas coordinates), or null if 3D is unavailable.
   */
  render(o: RenderOpts): { sx: number; sy: number; w: number; h: number } | null {
    const gl = this.init();
    const v = this.volume;
    if (!gl || !v) return null;
    const w = Math.max(1, Math.round(o.width)), h = Math.max(1, Math.round(o.height));
    if (this.canvas.width < w || this.canvas.height < h) {
      this.canvas.width = Math.max(this.canvas.width, w); this.canvas.height = Math.max(this.canvas.height, h);
    }
    if (!this.volTex) this.uploadVolume(gl, v);
    if (this.tfPreset !== o.preset || !this.tfTex) {
      const t = this.table(o.preset);
      if (!this.tfTex) this.tfTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tfTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, t);
      texParams(gl, gl.TEXTURE_2D, gl.LINEAR);
      this.tfPreset = o.preset;
      this.low = firstVisible(t) / 255;
    }
    this.ensureFbo(gl, w, h);
    const vp = viewProj(o.camera, w / h);
    const ivp = invert(vp);
    const { eye } = cameraEye(o.camera);
    const clip = clipPlane(o.clip, o.cursor);

    // Pass 1: surfaces.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, w, h);
    gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    const mp = this.meshProg!;
    gl.useProgram(mp);
    gl.uniformMatrix4fv(this.u(mp, 'uVP'), false, vp);
    gl.uniform3fv(this.u(mp, 'uEye'), eye);
    {
      const { up } = cameraEye(o.camera);
      const t = o.camera.target, vd = [eye[0] - t[0], eye[1] - t[1], eye[2] - t[2]], vl = Math.hypot(vd[0], vd[1], vd[2]) || 1;
      const f = [vd[0] / vl, vd[1] / vl, vd[2] / vl], r = [up[1] * f[2] - up[2] * f[1], up[2] * f[0] - up[0] * f[2], up[0] * f[1] - up[1] * f[0]];
      gl.uniform3fv(this.u(mp, 'uLight'), [f[0] * 0.75 + up[0] * 0.55 - r[0] * 0.35, f[1] * 0.75 + up[1] * 0.55 - r[1] * 0.35, f[2] * 0.75 + up[2] * 0.55 - r[2] * 0.35]);
    }
    gl.uniform1i(this.u(mp, 'uClipOn'), clip ? 1 : 0);
    gl.uniform4fv(this.u(mp, 'uClip'), clip ?? [0, 0, 0, 0]);
    for (const s of o.surfaces) {
      const g = this.gpuMesh(gl, s);
      if (!g) continue;
      gl.uniform3fv(this.u(mp, 'uColor'), s.color);
      gl.uniform4fv(this.u(mp, 'uAt'), s.at ?? [0, 0, 0, 1]);
      gl.uniformMatrix4fv(this.u(mp, 'uModel'), false, s.model ? Float32Array.from(s.model) : IDENTITY4);
      gl.uniform1i(this.u(mp, 'uUseCol'), s.vertexColors ? 1 : 0);
      gl.uniform1i(this.u(mp, 'uMat'), s.material === 'enamel' ? 1 : 0);
      gl.bindVertexArray(g.vao);
      gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);

    // Pass 2: volume over the surfaces, to the canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    const p = this.volProg!;
    gl.useProgram(p);
    const bind = (unit: number, target: number, tex: WebGLTexture | null, name: string) => {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, tex); gl.uniform1i(this.u(p, name), unit);
    };
    bind(0, gl.TEXTURE_3D, this.volTex, 'uVol');
    bind(1, gl.TEXTURE_3D, this.macroTex, 'uMacro');
    bind(2, gl.TEXTURE_2D, this.tfTex, 'uTF');
    bind(3, gl.TEXTURE_2D, this.fboColor, 'uMeshColor');
    bind(4, gl.TEXTURE_2D, this.fboDepth, 'uMeshDepth');
    gl.uniformMatrix4fv(this.u(p, 'uInvVP'), false, ivp);
    gl.uniformMatrix4fv(this.u(p, 'uW2T'), false, this.w2t!);
    gl.uniformMatrix3fv(this.u(p, 'uNrm'), false, this.nrm);
    gl.uniform2f(this.u(p, 'uSize'), w, h);
    const base = Math.min(...v.spacing);
    gl.uniform1f(this.u(p, 'uStep'), o.fast ? base * 1.6 : base * 0.75);
    gl.uniform1f(this.u(p, 'uLow'), this.low);
    gl.uniform3f(this.u(p, 'uTexel'), 1 / v.dims[0], 1 / v.dims[1], 1 / v.dims[2]);
    gl.uniform1i(this.u(p, 'uClipOn'), clip ? 1 : 0);
    gl.uniform4fv(this.u(p, 'uClip'), clip ?? [0, 0, 0, 0]);
    gl.uniform1i(this.u(p, 'uShade'), o.fast ? 0 : 1);
    gl.uniform1i(this.u(p, 'uVolOn'), o.volume ? 1 : 0);
    gl.uniform3fv(this.u(p, 'uBg'), BG);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.disable(gl.SCISSOR_TEST);
    return { sx: 0, sy: this.canvas.height - h, w, h };
  }

  /**
   * First visible point of the volume (or a surface) under a pixel, on the
   * CPU: march the same ray through the working volume.
   */
  pick(o: RenderOpts, x: number, y: number, surfaceHit?: (ro: Vec3, rd: Vec3) => number): Vec3 | null {
    const v = this.volume;
    if (!v) return null;
    const vp = viewProj(o.camera, o.width / o.height);
    const ivp = invert(vp);
    const nx = (x / o.width) * 2 - 1, ny = 1 - (y / o.height) * 2;
    const a = transformPoint(ivp, [nx, ny, -1]), b = transformPoint(ivp, [nx, ny, 1]);
    const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(...d); d[0] /= l; d[1] /= l; d[2] /= l;
    const clip = clipPlane(o.clip, o.cursor);
    const tSurf = surfaceHit ? surfaceHit(a, d) : Infinity;
    const table = this.table(o.preset);
    const step = Math.min(...v.spacing) * 0.5;
    const w2t = invert(texToWorld(v));
    let acc = 0;
    for (let t = 0; o.volume && t < l && t < tSurf; t += step) {
      const p: Vec3 = [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t];
      if (clip && clip[0] * p[0] + clip[1] * p[1] + clip[2] * p[2] + clip[3] > 0) continue;
      const tc = transformPoint(w2t, p);
      if (tc[0] < 0 || tc[1] < 0 || tc[2] < 0 || tc[0] > 1 || tc[1] > 1 || tc[2] > 1) continue;
      const i = Math.min(v.dims[0] - 1, Math.max(0, Math.round(tc[0] * v.dims[0] - 0.5)));
      const j = Math.min(v.dims[1] - 1, Math.max(0, Math.round(tc[1] * v.dims[1] - 0.5)));
      const k = Math.min(v.dims[2] - 1, Math.max(0, Math.round(tc[2] * v.dims[2] - 0.5)));
      const hu = v.data[i + v.dims[0] * (j + v.dims[1] * k)];
      const s = Math.max(0, Math.min(255, Math.round(((hu - HU_MIN) / HU_SPAN) * 255)));
      const al = table[s * 4 + 3] / 255;
      acc += (1 - acc) * (1 - Math.pow(1 - al, step / 0.5));
      if (acc > 0.5) return p;
    }
    if (tSurf < Infinity) return [a[0] + d[0] * tSurf, a[1] + d[1] * tSurf, a[2] + d[2] * tSurf];
    return null;
  }
}

let engine: Engine3D | null = null;
export function getEngine(): Engine3D { return (engine ??= new Engine3D()); }

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error('3D shader: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('3D program: ' + gl.getProgramInfoLog(p));
  return p;
}

function texParams(gl: WebGL2RenderingContext, target: number, filter: number): void {
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (target === gl.TEXTURE_3D) gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
}

export function vertexNormals(m: SurfaceMesh): Float32Array {
  const p = m.positions, ix = m.indices, n = new Float32Array(p.length);
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const q of [a, b, c]) { n[q] += nx; n[q + 1] += ny; n[q + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]);
    if (l < 1e-12) { n[i] = 0; n[i + 1] = 0; n[i + 2] = 1; continue; } // unused or degenerate vertex
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}
