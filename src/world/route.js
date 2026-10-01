// The railway: one closed 3D spline that is the single source of truth for
// rails, sleepers, bridges, stations and the train itself.
//
// World axes: +x = east, +z = south, +y = up. The loop runs clockwise when
// seen from above with north at the top: east along the high northern
// (alpine) flank, around the eastern nose of the mountain, west through the
// low southern forest and back north around the western shoulder.
import { CatmullRomCurve3, Vector3 } from 'three';
import { clamp } from '../util/noise.js';

// [x, z, y] — y is the design elevation of the rail head.
const CONTROL = [
  // Frostpeak (alpine) station — level platform heading east
  [-232, -150, 38],
  [-196, -152, 38],
  [-160, -151, 38],
  // Leaving the village, start of the climb along the north flank
  [-124, -143, 39],
  [-90, -133, 40.5],
  [-58, -126, 42],
  // High mountainside: ledges, gullies and viaducts
  [-26, -119, 43.5],
  [10, -116, 45],
  [46, -109, 46.5],
  [86, -112, 48],
  [122, -104, 49.5],
  [160, -98, 50.5],
  [196, -92, 51.5],
  [228, -76, 52], // summit of the line
  // Rounding the eastern nose on the great curved viaduct
  [254, -50, 51],
  [270, -16, 49.5],
  [272, 20, 47.5],
  [260, 52, 45.5],
  // Horseshoe around the south-eastern knoll
  [276, 86, 43.5],
  [296, 118, 41.5],
  [292, 156, 39.5],
  [262, 176, 37.5],
  [228, 164, 35.5],
  [204, 136, 33],
  [172, 120, 30.5],
  // Winding forest section
  [140, 132, 28],
  [112, 160, 25.5],
  [82, 172, 23],
  [58, 154, 21],
  [38, 134, 19.5],
  [12, 128, 18],
  [-10, 144, 16.5],
  [-22, 170, 15],
  [-40, 192, 14],
  [-66, 202, 13.5],
  // Meadowbrook (rural) station — level platform heading west
  [-98, 200, 13],
  [-134, 199, 13],
  [-170, 197, 13],
  // Open countryside and the long return climb around the west shoulder
  [-206, 190, 13.5],
  [-236, 172, 15],
  [-254, 144, 17],
  [-262, 112, 19],
  [-284, 82, 21],
  [-312, 58, 23],
  [-328, 22, 25.5],
  [-324, -16, 28],
  [-306, -52, 30.5],
  [-296, -88, 33],
  [-278, -122, 35.5],
  [-256, -142, 37.5],
];

export const STATION_DEFS = [
  {
    id: 'frostpeak',
    name: 'Frostpeak',
    region: 'alpine',
    from: [-232, -150],
    to: [-160, -151],
  },
  {
    id: 'meadowbrook',
    name: 'Meadowbrook',
    region: 'rural',
    from: [-98, 200],
    to: [-170, 197],
  },
];

// Engineering zones: where the line is carried on arched viaducts or on
// masonry ledges built against the mountainside.
export const ZONE_DEFS = [
  { type: 'ledge', from: [-64, -127], to: [244, -60] },
  { type: 'viaduct', from: [-52, -123], to: [-6, -117] }, // west gully
  { type: 'viaduct', from: [62, -110], to: [112, -108] }, // middle gully
  { type: 'viaduct', from: [174, -96], to: [212, -88] }, // east gully
  { type: 'viaduct', from: [246, -58], to: [271, 28] }, // great curved viaduct
  { type: 'viaduct', from: [32, 132], to: [2, 133] }, // river bridge
  { type: 'viaduct', from: [-326, 40], to: [-327, 6] }, // west ravine
];

const DS = 0.5;
const UP = new Vector3(0, 1, 0); // resample spacing (world units)

class Route {
  constructor() {
    const pts = CONTROL.map(([x, z]) => new Vector3(x, 0, z));
    const curve = new CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    const n = CONTROL.length;

    // Dense 2D sampling with arc length.
    const M = 24000;
    const tx = new Float64Array(M + 1), tz = new Float64Array(M + 1), tl = new Float64Array(M + 1);
    const v = new Vector3();
    for (let i = 0; i <= M; i++) {
      curve.getPoint(i / M, v);
      tx[i] = v.x; tz[i] = v.z;
      tl[i] = i === 0 ? 0 : tl[i - 1] + Math.hypot(tx[i] - tx[i - 1], tz[i] - tz[i - 1]);
    }
    const L = tl[M];
    this.length = L;

    // Arc position of each control point (control point i is at t = i/n).
    const ctrlS = CONTROL.map((_, i) => tl[Math.round((i / n) * M)]);

    // Uniform resample.
    const N = Math.ceil(L / DS);
    this.N = N;
    this.ds = L / N;
    const X = new Float32Array(N), Z = new Float32Array(N), Y = new Float32Array(N);
    let j = 0;
    for (let i = 0; i < N; i++) {
      const s = i * this.ds;
      while (j < M - 1 && tl[j + 1] < s) j++;
      const f = (s - tl[j]) / Math.max(1e-9, tl[j + 1] - tl[j]);
      X[i] = tx[j] + (tx[j + 1] - tx[j]) * f;
      Z[i] = tz[j] + (tz[j + 1] - tz[j]) * f;
    }

    // Elevation: piecewise linear through the design heights, then smoothed
    // (circularly) into gentle vertical curves. Station stretches are forced
    // perfectly level.
    let k = 0;
    for (let i = 0; i < N; i++) {
      const s = i * this.ds;
      while (k < n - 1 && ctrlS[k + 1] <= s) k++;
      const s0 = ctrlS[k], s1 = k + 1 < n ? ctrlS[k + 1] : L;
      const y0 = CONTROL[k][2], y1 = CONTROL[(k + 1) % n][2];
      Y[i] = y0 + (y1 - y0) * ((s - s0) / (s1 - s0));
    }

    this.X = X; this.Z = Z; this.Y = Y;
    this._tangents();
    // Spatial hash of samples for fast nearest queries.
    this.cell = 16;
    this.grid = new Map();
    for (let i = 0; i < N; i++) {
      const key = this._key(Math.floor(X[i] / this.cell), Math.floor(Z[i] / this.cell));
      let arr = this.grid.get(key);
      if (!arr) this.grid.set(key, (arr = []));
      arr.push(i);
    }

    this.stations = STATION_DEFS.map((d) => {
      const a = this.project(d.from[0], d.from[1]).s;
      const b = this.project(d.to[0], d.to[1]).s;
      const y = this.Y[Math.round(a / this.ds) % N];
      return { ...d, s0: a, s1: b, y };
    });

    const levelMask = (i) => {
      const s = i * this.ds;
      for (const st of this.stations) if (this.inRange(s, st.s0 - 4, st.s1 + 4)) return st.y;
      return null;
    };
    const win = Math.round(36 / this.ds);
    for (let pass = 0; pass < 3; pass++) {
      const src = Float32Array.from(Y);
      let acc = 0;
      for (let i = -win; i <= win; i++) acc += src[(i + N) % N];
      for (let i = 0; i < N; i++) {
        const lv = levelMask(i);
        Y[i] = lv !== null ? lv : acc / (2 * win + 1);
        acc += src[(i + win + 1) % N] - src[(i - win + N) % N];
      }
    }

    this._tangents();

    // Zones per sample (0 none, 1 ledge, 2 viaduct) and a smooth weight that
    // says how strongly terrain should rise to support the line.
    this.zone = new Uint8Array(N);
    this.zones = ZONE_DEFS.map((z) => ({
      ...z,
      s0: this.project(z.from[0], z.from[1]).s,
      s1: this.project(z.to[0], z.to[1]).s,
    }));
    for (const zd of this.zones) {
      const code = zd.type === 'viaduct' ? 2 : 1;
      for (let i = 0; i < N; i++) {
        if (this.inRange(i * this.ds, zd.s0, zd.s1)) this.zone[i] = Math.max(this.zone[i], code);
      }
    }
    this.raiseW = new Float32Array(N);
    const fw = Math.round(10 / this.ds);
    for (let i = 0; i < N; i++) {
      let acc = 0, cnt = 0;
      for (let o = -fw; o <= fw; o++) { acc += this.zone[(i + o + N) % N] === 2 ? 0 : 1; cnt++; }
      this.raiseW[i] = acc / cnt;
    }

    const TX = this.TX, TZ = this.TZ;
    const K = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 6 + N) % N, b = (i + 6) % N;
      const ha = Math.atan2(TZ[a], TX[a]), hb = Math.atan2(TZ[b], TX[b]);
      let dh = hb - ha;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      K[i] = dh / (12 * this.ds);
    }
    const BANK = new Float32Array(N);
    const bw = Math.round(14 / this.ds);
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let o = -bw; o <= bw; o += 2) acc += K[(i + o + N) % N];
      acc /= bw + 1;
      // Lean into the curve (positive curvature = turning right in x/z).
      BANK[i] = clamp(acc * 2.6, -0.07, 0.07);
    }
    this.K = K; this.BANK = BANK;
  }

  _tangents() {
    const { N, X, Y, Z } = this;
    const TX = new Float32Array(N), TY = new Float32Array(N), TZ = new Float32Array(N);
    const h = 4;
    for (let i = 0; i < N; i++) {
      const a = (i - h + N) % N, b = (i + h) % N;
      const dx = X[b] - X[a], dy = Y[b] - Y[a], dz = Z[b] - Z[a];
      const l = Math.hypot(dx, dy, dz);
      TX[i] = dx / l; TY[i] = dy / l; TZ[i] = dz / l;
    }
    this.TX = TX; this.TY = TY; this.TZ = TZ;
  }

  _key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }

  wrap(s) { const L = this.length; return ((s % L) + L) % L; }

  inRange(s, a, b) {
    s = this.wrap(s); a = this.wrap(a); b = this.wrap(b);
    return a <= b ? s >= a && s <= b : s >= a || s <= b;
  }

  // Signed forward distance from a to b along the loop, in (-L/2, L/2].
  delta(a, b) {
    const L = this.length;
    let d = this.wrap(b - a);
    if (d > L / 2) d -= L;
    return d;
  }

  _interp(arr, s) {
    const f = this.wrap(s) / this.ds;
    const i = Math.floor(f), t = f - i;
    const a = arr[i % this.N], b = arr[(i + 1) % this.N];
    return a + (b - a) * t;
  }

  height(s) { return this._interp(this.Y, s); }
  bank(s) { return this._interp(this.BANK, s); }
  curvature(s) { return this._interp(this.K, s); }

  // Fills `out` with {x,y,z} of the rail-centre line at arc length s.
  point(s, out = new Vector3()) {
    return out.set(this._interp(this.X, s), this._interp(this.Y, s), this._interp(this.Z, s));
  }

  tangent(s, out = new Vector3()) {
    return out.set(this._interp(this.TX, s), this._interp(this.TY, s), this._interp(this.TZ, s)).normalize();
  }

  // Horizontal right-hand vector (perpendicular to travel, in x/z).
  right(s, out = new Vector3()) {
    const tx = this._interp(this.TX, s), tz = this._interp(this.TZ, s);
    const l = Math.hypot(tx, tz);
    return out.set(-tz / l, 0, tx / l);
  }

  // Full moving frame at s: position, tangent, right and up (with cant).
  frame(s, out) {
    out = out || { p: new Vector3(), t: new Vector3(), r: new Vector3(), u: new Vector3() };
    this.point(s, out.p);
    this.tangent(s, out.t);
    out.r.crossVectors(out.t, UP).normalize();
    out.u.crossVectors(out.r, out.t).normalize();
    const b = this.bank(s), c = Math.cos(b), sn = Math.sin(b);
    const rx = out.r.x, ry = out.r.y, rz = out.r.z;
    out.r.set(rx * c - out.u.x * sn, ry * c - out.u.y * sn, rz * c - out.u.z * sn);
    out.u.set(out.u.x * c + rx * sn, out.u.y * c + ry * sn, out.u.z * c + rz * sn);
    return out;
  }

  // Nearest point on the loop to (x, z). Returns { s, d, side } where side is
  // +1 if the point lies to the right of the direction of travel.
  project(x, z, maxR = 64) {
    const c = this.cell, cx = Math.floor(x / c), cz = Math.floor(z / c);
    const r = Math.ceil(maxR / c);
    let best = -1, bd = Infinity;
    for (let gx = cx - r; gx <= cx + r; gx++) {
      for (let gz = cz - r; gz <= cz + r; gz++) {
        const arr = this.grid.get(this._key(gx, gz));
        if (!arr) continue;
        for (const i of arr) {
          const d = (this.X[i] - x) ** 2 + (this.Z[i] - z) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    if (best < 0) {
      for (let i = 0; i < this.N; i++) {
        const d = (this.X[i] - x) ** 2 + (this.Z[i] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    // Refine on the two adjacent segments.
    let bs = best * this.ds, bdist = Math.sqrt(bd);
    for (const o of [-1, 0]) {
      const i0 = (best + o + this.N) % this.N, i1 = (i0 + 1) % this.N;
      const ax = this.X[i0], az = this.Z[i0], bx = this.X[i1], bz = this.Z[i1];
      const vx = bx - ax, vz = bz - az;
      const t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
      const px = ax + vx * t, pz = az + vz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < bdist) { bdist = d; bs = (i0 + t) * this.ds; }
    }
    const tx = this._interp(this.TX, bs), tz = this._interp(this.TZ, bs);
    const px = this._interp(this.X, bs), pz = this._interp(this.Z, bs);
    const side = (x - px) * -tz + (z - pz) * tx >= 0 ? 1 : -1;
    return { s: this.wrap(bs), d: bdist, side };
  }

  stationAt(s, margin = 0) {
    for (const st of this.stations) if (this.inRange(s, st.s0 - margin, st.s1 + margin)) return st;
    return null;
  }
}

let _route = null;
export function getRoute() {
  if (!_route) _route = new Route();
  return _route;
}
