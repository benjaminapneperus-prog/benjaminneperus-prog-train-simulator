// Voxel heightfield for the whole diorama.
//
// The world is a grid of square voxel columns (V world units wide/tall).
// Natural terrain is authored from a few deliberate large shapes (an
// elongated ridge, named peaks, gullies, rim hills, a river and a lake);
// the railway corridor is then carved / filled so the line sits believably
// in the landscape. Everything downstream (meshing, trees, buildings, camera
// collision) reads from this one data model.
import { getRoute } from './route.js';
import { fbm, ridged, valueNoise, hash2, clamp, lerp, smoothstep } from '../util/noise.js';
import { LAYOUT } from './layout.js';

export const V = 2;
export const WORLD = { x0: -400, x1: 400, z0: -320, z1: 320 };
export const NX = (WORLD.x1 - WORLD.x0) / V;
export const NZ = (WORLD.z1 - WORLD.z0) / V;

export { M } from './materialIds.js';
import { M } from './materialIds.js';

// sRGB colours for top faces and the side bands below them
export const PALETTE = {
  [M.SNOW]: 0xf2f6fb, [M.SNOW_SHADE]: 0xe3ebf4, [M.ROCK]: 0x8b8a8c, [M.ROCK_DARK]: 0x6f6a6a,
  [M.EARTH]: 0x7d5a3a, [M.GRASS]: 0x6e9b3c, [M.GRASS_DARK]: 0x5a8834, [M.MEADOW]: 0x8fba4e,
  [M.GRAVEL]: 0x9c958a, [M.SAND]: 0xc9b78d, [M.ICE]: 0xbfe0ee, [M.PATH_SNOW]: 0xd6d4cf,
  [M.PATH]: 0xb39468, [M.FIELD]: 0xa98552, [M.ALPINE_GRASS]: 0x8c9a62, [M.RIVERBED]: 0x8f8a74,
  [M.GARDEN]: 0x7ead48, [M.PLAZA]: 0xa49c8f, [M.SNOW_ROCK]: 0xdde4ec,
};

export const SIDE = {
  snowCap: 0xe8eef6, rock: 0x878384, rockWarm: 0x93877a, rockDark: 0x6a6565,
  soil: 0x7a5636, soilDark: 0x5f432c, grassEdge: 0x5f8a35, sand: 0xb8a57c, ice: 0xa9cfe0,
};

// ---------------------------------------------------------------- shapes --

export function ridgeZ(x) {
  return -20 + 14 * Math.sin(x * 0.0105 + 0.7) + 5 * Math.sin(x * 0.029 + 1.9);
}

// Summits along the crest (gaussian bumps in crest height along x).
const PEAKS = [
  { x: 24, h: 62, rx: 46 }, // Frostpeak summit
  { x: -96, h: 40, rx: 40 },
  { x: 126, h: 34, rx: 38 },
  { x: -190, h: 18, rx: 36 },
  { x: 206, h: 12, rx: 30 },
  { x: -40, h: 10, rx: 18 },
  { x: 72, h: 14, rx: 20 },
];

// Gullies cut down the north flank — the railway leaps these on viaducts.
const GULLIES = [
  { x: -24, w: 22, depth: 30 },
  { x: 92, w: 26, depth: 34 },
  { x: 196, w: 18, depth: 22 },
];

// Rounded hills that give the line something to wind around and hide behind.
const HILLS = [
  { x: 268, z: 120, h: 34, r: 46 }, // horseshoe knoll
  { x: -205, z: -186, h: 15, r: 70 }, // Frostpeak village shoulder
  { x: -150, z: -196, h: 12, r: 30 },
  { x: 80, z: 124, h: 12, r: 28 },
  { x: 44, z: 196, h: 13, r: 30 },
  { x: 128, z: 214, h: 18, r: 44 },
  { x: -64, z: 150, h: 14, r: 36 },
  { x: 182, z: 176, h: 10, r: 26 },
  { x: -238, z: 108, h: 18, r: 32 },
  { x: -282, z: 222, h: 16, r: 44 },
  { x: -360, z: 120, h: 18, r: 50 },
  { x: 330, z: 40, h: 24, r: 60 },
  { x: 150, z: -176, h: 14, r: 34 },
  { x: -60, z: -196, h: 10, r: 34 },
];

const RAVINES = [
  { pts: [[-270, 36], [-300, 30], [-328, 22], [-352, 26], [-390, 18]], w: 16, depth: 14 },
];

export const RIVER = [
  [44, 56], [36, 84], [26, 110], [20, 132], [16, 152], [8, 176], [-8, 204], [-26, 234],
  [-34, 262], [-30, 292], [-36, 330],
];

export const LAKE = { x: 46, z: -236, rx: 62, rz: 30, level: 18 };
export const POND = { x: -196, z: 248, rx: 16, rz: 11, level: 12 };

function smax(a, b, k) {
  const h = clamp(0.5 + (0.5 * (a - b)) / k, 0, 1);
  return lerp(b, a, h) + k * h * (1 - h);
}

// 0 on the warm south side, 1 on the cold north side.
export function northness(x, z) {
  const d = z - ridgeZ(x) + 14 * valueNoise(x * 0.012, 3.1);
  return smoothstep(70, -50, d);
}

function terrace(h, step, sharp) {
  const t = h / step, fl = Math.floor(t);
  return (fl + smoothstep(1 - sharp, 1, t - fl)) * step;
}

function mountain(x, z) {
  const d = z - ridgeZ(x);
  // Elongated ridge with a knife-edge crest: broad base, slim upper body.
  const along = clamp(1 - Math.pow(Math.abs(x) / 310, 2.4), 0, 1);
  let crest = 78 * along;
  for (const p of PEAKS) crest += p.h * Math.exp(-(((x - p.x) / p.rx) ** 2));
  crest += 6 * valueNoise(x * 0.03, 1.7);
  const w = (d < 0 ? 235 : 175) * (0.75 + 0.25 * along);
  const t = clamp(Math.abs(d) / w, 0, 1);
  let body = crest * Math.pow(1 - Math.pow(t, 0.72), 1.9);
  // Spur ridges running down the flanks.
  const spur = Math.sin(x * 0.045 + Math.sin(x * 0.013) * 2 + (d < 0 ? 0 : 1.7));
  body *= 1 + 0.1 * spur * Math.sin(Math.PI * clamp(t * 1.4, 0, 1));
  // Undulating flanks so contour terraces wander instead of running in rows.
  body += fbm(x * 0.022, z * 0.022, 2, 13) * 6 * smoothstep(4, 20, body) * smoothstep(90, 40, body);
  // Craggy large-scale rock structure, stronger high up.
  const crag = ridged(x * 0.016, z * 0.016, 3, 7) - 0.45;
  body += crag * 12 * smoothstep(30, 100, body);
  // Terraces: snow benches separated by rock bands, irregular in height.
  const tz = smoothstep(26, 60, body);
  if (tz > 0) {
    const off = valueNoise(x * 0.015, z * 0.015, 77) * 7;
    body = lerp(body, terrace(body + off, 11, 0.32) - off, tz * 0.85);
  }
  // Gullies on the north flank.
  if (d < -30) {
    for (const g of GULLIES) {
      const gx = x - g.x - (d + 60) * 0.12;
      const k = clamp(1 - Math.abs(gx) / g.w, 0, 1);
      if (k > 0) {
        const lengthMask = smoothstep(-34, -70, d) * smoothstep(-200, -130, d);
        body -= g.depth * k * k * (3 - 2 * k) * lengthMask;
      }
    }
  }
  return Math.max(0, body);
}

function base(x, z) {
  const n = northness(x, z);
  const roll = fbm(x * 0.006, z * 0.006, 3, 11) * 5 + fbm(x * 0.025, z * 0.025, 2, 5) * 1.0;
  let b = lerp(9, 20, n) + roll;
  // Rim hills frame the diorama.
  const ex = Math.min(x - WORLD.x0, WORLD.x1 - x), ez = Math.min(z - WORLD.z0, WORLD.z1 - z);
  const e = Math.min(ex, ez);
  const rimH = lerp(30, 78, smoothstep(120, -200, z)) + 26 * ridged(x * 0.012, z * 0.012, 3, 9);
  b += rimH * Math.pow(smoothstep(110, 0, e), 1.3);
  for (const hl of HILLS) {
    const r = Math.hypot(x - hl.x, z - hl.z) / hl.r;
    if (r < 1) b += hl.h * (0.5 + 0.5 * Math.cos(Math.PI * r)) * (1 + 0.15 * valueNoise(x * 0.06, z * 0.06));
  }
  for (const rv of RAVINES) {
    const { d } = distToPolyline(x, z, rv.pts);
    if (d < rv.w) b -= rv.depth * Math.pow(1 - d / rv.w, 1.5);
  }
  return b;
}

function distToPolyline(x, z, pts) {
  let best = Infinity, bt = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const vx = bx - ax, vz = bz - az;
    const t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
    const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
    if (d < best) { best = d; bt = i + t; }
  }
  return { d: best, t: bt };
}

export function natural(x, z) {
  const m = mountain(x, z);
  const h = base(x, z) + m;
  // Broad lowland tiers (meadow benches) rather than endless contour steps.
  const off = valueNoise(x * 0.01, z * 0.01, 41) * 3;
  const tl = smoothstep(60, 5, m);
  return lerp(h, terrace(h + off, 4, 0.4) - off, tl * 0.9);
}

// ------------------------------------------------------------- the model --

export class Terrain {
  constructor() {
    const route = (this.route = getRoute());
    const N = NX * NZ;
    this.nat = new Float32Array(N);
    this.H = new Float32Array(N); // continuous shaped height
    this.h = new Int16Array(N); // voxel column height (in voxels)
    this.mat = new Uint8Array(N);
    this.water = new Float32Array(N).fill(-1); // water surface y, -1 = none
    this.td = new Float32Array(N).fill(1e9); // distance to rail centre line
    this.tside = new Int8Array(N); // which side of the line (+1 = right of travel)
    this.ts = new Float32Array(N); // nearest arc length
    this.north = new Float32Array(N);
    this.pathMask = new Uint8Array(N);
    this.occ = new Float32Array(N); // extra occupancy height (buildings) for camera

    // Natural terrain
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const x = WORLD.x0 + (i + 0.5) * V, z = WORLD.z0 + (j + 0.5) * V;
        const k = j * NX + i;
        this.nat[k] = natural(x, z);
        this.north[k] = northness(x, z);
      }
    }
    this._carveWater();
    this._rasterTrack();
    this._supportTerrain();
    this._classifySupports();
    this._shape();
    this._materials();
  }

  idx(i, j) { return j * NX + i; }
  colOf(x, z) {
    return [Math.floor((x - WORLD.x0) / V), Math.floor((z - WORLD.z0) / V)];
  }
  inside(i, j) { return i >= 0 && j >= 0 && i < NX && j < NZ; }

  naturalAt(x, z) {
    const [i, j] = this.colOf(x, z);
    if (!this.inside(i, j)) return natural(x, z);
    return this.nat[this.idx(i, j)];
  }

  // Voxel top surface at (x,z).
  topAt(x, z) {
    const [i, j] = this.colOf(x, z);
    if (!this.inside(i, j)) return 0;
    return this.h[this.idx(i, j)] * V;
  }

  // Bilinear smooth surface (for camera), including building occupancy.
  surfaceAt(x, z) {
    const fx = (x - WORLD.x0) / V - 0.5, fz = (z - WORLD.z0) / V - 0.5;
    const i = Math.floor(fx), j = Math.floor(fz);
    let m = -Infinity;
    for (let a = 0; a <= 1; a++) for (let b = 0; b <= 1; b++) {
      const ii = clamp(i + a, 0, NX - 1), jj = clamp(j + b, 0, NZ - 1);
      const k = this.idx(ii, jj);
      m = Math.max(m, this.h[k] * V, this.occ[k], this.water[k]);
    }
    return m;
  }

  _carveWater() {
    // River: monotonic water level downstream; carve a bed.
    const pts = RIVER;
    const lens = [0];
    for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = lens[lens.length - 1];
    const steps = Math.ceil(total / 2);
    const lvl = new Float32Array(steps + 1);
    let cur = Infinity;
    for (let s = 0; s <= steps; s++) {
      const p = this._riverPoint(s * 2, pts, lens);
      cur = Math.min(cur, natural(p[0], p[1]) - 1.2);
      lvl[s] = cur;
    }
    this.riverLevel = (t) => {
      // t = polyline param → arc
      const i = Math.floor(t), f = t - i;
      const a = lens[Math.min(i, lens.length - 1)], b = lens[Math.min(i + 1, lens.length - 1)];
      const s = clamp((a + (b - a) * f) / 2, 0, steps);
      return lvl[Math.round(s)];
    };
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const x = WORLD.x0 + (i + 0.5) * V, z = WORLD.z0 + (j + 0.5) * V;
        const k = j * NX + i;
        const { d, t } = distToPolyline(x, z, pts);
        const width = 4.2 + t * 0.55 + 1.5 * valueNoise(t * 1.7, 4.4);
        if (d < width + 10) {
          const wl = Math.floor(this.riverLevel(t) / V) * V + V * 0.5;
          if (d < width) {
            this.nat[k] = Math.min(this.nat[k], wl - 1.5 - (1 - d / width) * 1.5);
            this.water[k] = wl;
          } else {
            const bank = wl + 0.5 + (d - width) * 0.9;
            this.nat[k] = Math.min(this.nat[k], bank);
          }
        }
        for (const lake of [LAKE, POND]) {
          const r = Math.hypot((x - lake.x) / lake.rx, (z - lake.z) / lake.rz) + 0.12 * valueNoise(x * 0.05, z * 0.05);
          if (r < 1) {
            this.nat[k] = Math.min(this.nat[k], lake.level - 1.5 - 3 * (1 - r));
            this.water[k] = lake.level;
          } else if (r < 1.8) {
            this.nat[k] = lerp(lake.level + 0.5, this.nat[k], smoothstep(1, 1.8, r));
          }
        }
      }
    }
  }

  // Let the land rise to carry the line (as if the railway had been laid
  // along natural shelves), except where viaducts leap gullies and rivers.
  _supportTerrain() {
    const r = this.route;
    // Which side of the line is uphill (per sample, smoothed).
    const up = new Float32Array(r.N);
    for (let n = 0; n < r.N; n++) {
      const rx = -r.TZ[n], rz = r.TX[n], l = Math.hypot(rx, rz);
      up[n] = Math.sign(natural(r.X[n] + (rx / l) * 14, r.Z[n] + (rz / l) * 14) - natural(r.X[n] - (rx / l) * 14, r.Z[n] - (rz / l) * 14));
    }
    this.uphill = up;
    // Along the ledge zones carve a proper escarpment: a cliff rising on the
    // mountain side and a drop to the valley on the other.
    for (let k = 0; k < NX * NZ; k++) {
      const d = this.td[k];
      if (d > 60) continue;
      const n = Math.round(this.ts[k] / r.ds) % r.N;
      if (r.zone[n] !== 1) continue;
      const w = r.raiseW[n];
      if (this.tside[k] === up[n]) this.nat[k] += 9 * smoothstep(5, 16, d) * smoothstep(60, 30, d);
      else this.nat[k] -= 9 * w * smoothstep(3, 14, d) * smoothstep(60, 34, d);
    }
    for (let k = 0; k < NX * NZ; k++) {
      const d = this.td[k];
      if (d > 70) continue;
      const n = Math.round(this.ts[k] / r.ds) % r.N;
      const w = r.raiseW[n];
      if (w <= 0 || this.water[k] >= 0) continue;
      const bed = r.Y[n] - 0.7;
      const i = k % NX, j = (k / NX) | 0;
      const x = WORLD.x0 + (i + 0.5) * V, z = WORLD.z0 + (j + 0.5) * V;
      const e = Math.max(0, d - 4.4);
      let hs;
      if (r.zone[n] === 1) hs = this.tside[k] === this.uphill[n] ? bed : bed - 3.2 - e * 1.6;
      else hs = bed - 1.0 - e * (0.42 + 0.18 * valueNoise(x * 0.03, z * 0.03));
      if (hs > this.nat[k]) this.nat[k] = lerp(this.nat[k], hs, w);
    }
  }

  _riverPoint(s, pts, lens) {
    let i = 0;
    while (i < lens.length - 2 && lens[i + 1] < s) i++;
    const f = clamp((s - lens[i]) / (lens[i + 1] - lens[i]), 0, 1);
    return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
  }

  // Decide, along the line, where the track rides on earth, on masonry
  // ledges (retaining walls) or on arched viaducts.
  _classifySupports() {
    const r = this.route;
    const N = r.N;
    const sup = new Uint8Array(N); // 0 ground, 1 wall, 2 bridge
    const gap = new Float32Array(N);
    const alp = new Float32Array(N);
    const tmp = { x: 0, z: 0 };
    for (let i = 0; i < N; i++) {
      const x = r.X[i], z = r.Z[i];
      const rx = -r.TZ[i], rz = r.TX[i];
      const l = Math.hypot(rx, rz);
      let m = Infinity, wet = false;
      for (const o of r.zone[i] === 1 ? [-6, 0, 6] : [-2.5, 0, 2.5]) {
        const px = x + (rx / l) * o, pz = z + (rz / l) * o;
        m = Math.min(m, this.naturalAt(px, pz));
        const [ci, cj] = this.colOf(px, pz);
        if (this.inside(ci, cj) && this.water[this.idx(ci, cj)] >= 0) wet = true;
      }
      gap[i] = r.Y[i] - 0.7 - m;
      alp[i] = northness(x, z);
      const st = r.stationAt(i * r.ds, 10);
      const zone = r.zone[i];
      if (st) sup[i] = 0;
      else if (wet || (zone === 2 && gap[i] > 1.5)) sup[i] = 2;
      else if (zone === 1) sup[i] = gap[i] > 1.0 ? 1 : 0;
      else sup[i] = gap[i] > 8 ? 2 : gap[i] > 3.5 && alp[i] > 0.5 ? 1 : 0;
    }
    const runs = (type, extend, mergeGap, minLen) => {
      const ds = r.ds;
      // dilate
      const out = new Uint8Array(N);
      const e = Math.round(extend / ds);
      for (let i = 0; i < N; i++) if (sup[i] === type) for (let o = -e; o <= e; o++) out[(i + o + N) % N] = 1;
      // close small gaps
      const g = Math.round(mergeGap / ds);
      for (let i = 0; i < N; i++) {
        if (out[i] && !out[(i + 1) % N]) {
          let k = 1;
          while (k <= g && !out[(i + k) % N]) k++;
          if (k <= g) for (let q = 1; q < k; q++) out[(i + q) % N] = 1;
        }
      }
      // remove short
      const ml = Math.round(minLen / ds);
      let start = -1;
      for (let i = 0; i < N * 2; i++) {
        const v = out[i % N];
        if (v && start < 0) start = i;
        if (!v && start >= 0) {
          if (i - start < ml) for (let q = start; q < i; q++) out[q % N] = 0;
          start = -1;
        }
      }
      return out;
    };
    const bridge = runs(2, 6, 18, 14);
    const wall = runs(1, 3, 12, 8);
    this.support = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (r.stationAt(i * r.ds, 6)) continue;
      this.support[i] = bridge[i] ? 2 : wall[i] ? 1 : 0;
    }
    this.gap = gap;
    this.alpineAlong = alp;
  }

  _rasterTrack() {
    const r = this.route;
    const R = 46;
    for (let n = 0; n < r.N; n++) {
      const x = r.X[n], z = r.Z[n];
      const [ci, cj] = this.colOf(x, z);
      const rc = Math.ceil(R / V);
      for (let j = cj - rc; j <= cj + rc; j++) {
        if (j < 0 || j >= NZ) continue;
        for (let i = ci - rc; i <= ci + rc; i++) {
          if (i < 0 || i >= NX) continue;
          const k = j * NX + i;
          const px = WORLD.x0 + (i + 0.5) * V, pz = WORLD.z0 + (j + 0.5) * V;
          const d = Math.hypot(px - x, pz - z);
          if (d < this.td[k]) {
            this.td[k] = d; this.ts[k] = n * r.ds;
            this.tside[k] = (px - x) * -r.TZ[n] + (pz - z) * r.TX[n] >= 0 ? 1 : -1;
          }
        }
      }
    }
  }

  supportAt(s) {
    const r = this.route;
    return this.support[Math.round(r.wrap(s) / r.ds) % r.N];
  }

  _shape() {
    const r = this.route;
    const pads = LAYOUT.pads || [];
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const k = j * NX + i;
        const x = WORLD.x0 + (i + 0.5) * V, z = WORLD.z0 + (j + 0.5) * V;
        let H = this.nat[k];

        // Flat pads for buildings, platforms & village squares.
        for (const p of pads) {
          const dx = Math.abs(x - p.x) - p.hw, dz = Math.abs(z - p.z) - p.hd;
          let dd;
          if (p.rot) {
            const c = Math.cos(p.rot), s = Math.sin(p.rot);
            const lx = (x - p.x) * c - (z - p.z) * s, lz = (x - p.x) * s + (z - p.z) * c;
            dd = Math.max(Math.abs(lx) - p.hw, Math.abs(lz) - p.hd);
          } else dd = Math.max(dx, dz);
          const f = p.feather ?? 6;
          if (dd < f) {
            const t = dd <= 0 ? 1 : 1 - smoothstep(0, f, dd);
            H = lerp(H, p.y, t);
          }
        }

        // Railway corridor.
        const d = this.td[k];
        if (d < 46) {
          const s = this.ts[k];
          const bed = r.height(s) - 0.7;
          const sup = this.supportAt(s);
          const alpine = this.north[k] > 0.5 || bed > 36;
          const w0 = 3.4;
          const rockCut = alpine ? 2.4 : 1.1;
          if (d < w0) {
            if (sup === 0) H = bed;
            else H = Math.min(H, bed - (sup === 2 ? 2.5 : 0.2));
          } else {
            const e = d - w0;
            if (H > bed) {
              // cut: shoulder then a slope (steep rock cliffs high up)
              const shoulder = alpine ? 1.2 : 2.0;
              H = Math.min(H, bed + Math.max(0, e - shoulder) * rockCut + (e > shoulder ? 1 : 0));
            } else if (sup === 0) {
              H = Math.max(H, bed - e * 0.85);
            } else if (sup === 1) {
              H = Math.max(H, bed - 0.5 - e * 3.0);
            }
          }
        }
        this.H[k] = H;
        let hv = Math.floor(H / V + 0.5);
        if (d < 3.4 && hv * V > r.height(this.ts[k]) - 0.7) hv = Math.floor((r.height(this.ts[k]) - 0.7) / V);
        this.h[k] = Math.max(1, hv);
      }
    }
    // Water level must sit above the bed it covers; northern water is frozen.
    this.ice = new Uint8Array(NX * NZ);
    for (let k = 0; k < NX * NZ; k++) {
      if (this.water[k] < 0) continue;
      if (this.h[k] * V >= this.water[k]) { this.water[k] = -1; continue; }
      if (this.north[k] > 0.5) {
        this.h[k] = Math.round(this.water[k] / V);
        this.water[k] = -1;
        this.ice[k] = 1;
      }
    }
  }

  _materials() {
    const r = this.route;
    const paths = LAYOUT.paths || [];
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const k = j * NX + i;
        const x = WORLD.x0 + (i + 0.5) * V, z = WORLD.z0 + (j + 0.5) * V;
        const h = this.h[k];
        const top = h * V;
        let steep = 0;
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = clamp(i + a, 0, NX - 1), jj = clamp(j + b, 0, NZ - 1);
          steep = Math.max(steep, h - this.h[jj * NX + ii]);
        }
        const n = this.north[k];
        const nz = fbm(x * 0.04, z * 0.04, 2, 21);
        const snowLine = lerp(82, 22, n) + nz * 10;
        const snowy = top > snowLine;
        let m;
        if (this.ice[k]) m = M.ICE;
        else if (this.water[k] >= 0) m = M.RIVERBED;
        else if (snowy) {
          if (steep >= 6 && nz > 0.2) m = M.ROCK;
          else m = nz > 0.3 ? M.SNOW_SHADE : M.SNOW;
        } else if (steep >= 4) {
          m = top > 60 ? M.ROCK_DARK : M.ROCK;
        } else if (n > 0.55) {
          // cold but below snow line: alpine meadow
          m = steep >= 2 ? M.ROCK : M.ALPINE_GRASS;
        } else {
          const meadow = fbm(x * 0.02 + 40, z * 0.02, 3, 31);
          m = meadow > 0.22 ? M.MEADOW : meadow < -0.25 ? M.GRASS_DARK : M.GRASS;
          if (top > 70) m = steep >= 2 ? M.ROCK : M.ALPINE_GRASS;
        }
        // Near water: sandy banks
        if (this.water[k] < 0 && n < 0.5) {
          for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ii = clamp(i + a, 0, NX - 1), jj = clamp(j + b, 0, NZ - 1);
            if (this.water[jj * NX + ii] >= 0) { m = M.SAND; break; }
          }
        }
        // Track shoulder
        if (this.td[k] < 4.6 && this.supportAt(this.ts[k]) === 0) {
          m = snowy || n > 0.5 ? M.PATH_SNOW : M.GRAVEL;
        }
        this.mat[k] = m;
      }
    }
    // Painted paths / plazas from the layout.
    for (const p of paths) this._paintPath(p);
    for (const f of LAYOUT.fields || []) {
      const c = Math.cos(f.rot), sn = Math.sin(f.rot);
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
        const x = WORLD.x0 + (i + 0.5) * V, z = WORLD.z0 + (j + 0.5) * V;
        const lx = (x - f.x) * c - (z - f.z) * sn, lz = (x - f.x) * sn + (z - f.z) * c;
        if (Math.abs(lx) < f.hw && Math.abs(lz) < f.hd) {
          const k = j * NX + i;
          if (this.water[k] < 0 && this.td[k] > 5) this.mat[k] = Math.floor(lz / 2.2) % 2 === 0 ? M.FIELD : M.GARDEN;
        }
      }
    }
  }

  _paintPath(p) {
    const pts = p.pts, w = p.w ?? 2.5;
    for (let q = 0; q < pts.length - 1; q++) {
      const [ax, az] = pts[q], [bx, bz] = pts[q + 1];
      const len = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s <= len; s += 0.8) {
        const x = ax + ((bx - ax) * s) / len, z = az + ((bz - az) * s) / len;
        const wob = w + 0.6 * valueNoise(x * 0.2, z * 0.2);
        for (let oz = -wob; oz <= wob; oz += 1) for (let ox = -wob; ox <= wob; ox += 1) {
          if (ox * ox + oz * oz > wob * wob) continue;
          const [i, j] = this.colOf(x + ox, z + oz);
          if (!this.inside(i, j)) continue;
          const k = this.idx(i, j);
          if (this.water[k] >= 0 || this.td[k] < 3.6) continue;
          this.mat[k] = p.mat;
        }
      }
    }
  }
}

let _terrain = null;
export function getTerrain() {
  if (!_terrain) _terrain = new Terrain();
  return _terrain;
}
