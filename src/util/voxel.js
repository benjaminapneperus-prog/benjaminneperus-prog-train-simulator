// Merged voxel/box geometry builder. Models (trains, houses, bridges, trees)
// are authored as boxes and merged into a single vertex-coloured
// BufferGeometry per material, so each model is one draw call.
import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute, Color, Matrix4, Vector3 } from 'three';

const _c = new Color();
const cache = new Map();
export function lin(hex) {
  let v = cache.get(hex);
  if (!v) {
    _c.setHex(hex); // sRGB -> linear working space
    v = [_c.r, _c.g, _c.b];
    cache.set(hex, v);
  }
  return v;
}

// face order: +x, -x, +y, -y, +z, -z
const FACES = [
  { n: [1, 0, 0], v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

export class BoxBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.idx = [];
    this.loc = [];
    this.m = new Matrix4();
    this.nm = new Matrix4();
    this.stack = [];
    this._v = new Vector3();
    this._n = new Vector3();
  }

  get vertexCount() { return this.pos.length / 3; }

  push() { this.stack.push(this.m.clone()); return this; }
  pop() { this.m.copy(this.stack.pop()); return this; }
  translate(x, y, z) { this.m.multiply(new Matrix4().makeTranslation(x, y, z)); return this; }
  rotateY(a) { this.m.multiply(new Matrix4().makeRotationY(a)); return this; }
  rotateX(a) { this.m.multiply(new Matrix4().makeRotationX(a)); return this; }
  rotateZ(a) { this.m.multiply(new Matrix4().makeRotationZ(a)); return this; }
  scale(s) { this.m.multiply(new Matrix4().makeScale(s, s, s)); return this; }
  setMatrix(m) { this.m.copy(m); return this; }

  // Axis-aligned (in local space) box from min to max corner.
  // color: hex | { top, side, bottom, px, nx, pz, nz } ; opts.skip: array of face indices
  // opts.shade: per-face multiplier for fake AO on the bottom vertices
  box(x0, y0, z0, x1, y1, z1, color, opts = {}) {
    const sx = x1 - x0, sy = y1 - y0, sz = z1 - z0;
    if (sx <= 0 || sy <= 0 || sz <= 0) return this;
    const skip = opts.skip;
    const bottomShade = opts.ao ?? 1;
    for (let f = 0; f < 6; f++) {
      if (skip && skip.includes(f)) continue;
      if (opts.noBottom && f === 3) continue;
      const face = FACES[f];
      let hex;
      if (typeof color === 'number') hex = color;
      else {
        const keys = ['px', 'nx', 'top', 'bottom', 'pz', 'nz'];
        hex = color[keys[f]] ?? (f === 2 ? color.top : f === 3 ? color.bottom ?? color.side : color.side) ?? color.top;
      }
      const c = lin(hex);
      const base = this.pos.length / 3;
      this._n.set(face.n[0], face.n[1], face.n[2]).transformDirection(this.m);
      for (let q = 0; q < 4; q++) {
        const [a, b, d] = face.v[q];
        this._v.set(x0 + a * sx, y0 + b * sy, z0 + d * sz).applyMatrix4(this.m);
        this.pos.push(this._v.x, this._v.y, this._v.z);
        this.nor.push(this._n.x, this._n.y, this._n.z);
        this.loc.push(x0 + a * sx, y0 + b * sy, z0 + d * sz, f >> 1);
        const k = b === 0 && f !== 2 && f !== 3 ? bottomShade : 1;
        this.col.push(c[0] * k, c[1] * k, c[2] * k);
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return this;
  }

  // Box centred at (cx, cy, cz) with size (w, h, d).
  cbox(cx, cy, cz, w, h, d, color, opts) {
    return this.box(cx - w / 2, cy - h / 2, cz - d / 2, cx + w / 2, cy + h / 2, cz + d / 2, color, opts);
  }

  // Box standing on y0.
  block(cx, y0, cz, w, h, d, color, opts) {
    return this.box(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, color, opts);
  }

  // Raw quad (world/local positions), used for terrain-like custom surfaces.
  quad(p0, p1, p2, p3, n, c0, c1 = c0, c2 = c0, c3 = c0) {
    const base = this.pos.length / 3;
    const ax = Math.abs(n[0]) > 0.5 ? 0 : Math.abs(n[1]) > 0.5 ? 1 : 2;
    for (const p of [p0, p1, p2, p3]) {
      this._v.set(p[0], p[1], p[2]).applyMatrix4(this.m);
      this.pos.push(this._v.x, this._v.y, this._v.z);
      this.loc.push(p[0], p[1], p[2], ax);
    }
    this._n.set(n[0], n[1], n[2]).transformDirection(this.m);
    for (let q = 0; q < 4; q++) this.nor.push(this._n.x, this._n.y, this._n.z);
    for (const c of [c0, c1, c2, c3]) this.col.push(c[0], c[1], c[2]);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return this;
  }

  merge(other) {
    const base = this.pos.length / 3;
    this.pos.push(...other.pos);
    this.nor.push(...other.nor);
    this.col.push(...other.col);
    this.loc.push(...other.loc);
    for (const i of other.idx) this.idx.push(i + base);
    return this;
  }

  geometry() {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('vloc', new Float32BufferAttribute(this.loc, 4));
    g.setIndex(new Uint32BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
