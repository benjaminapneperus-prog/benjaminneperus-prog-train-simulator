// Railway engineering: arched stone viaducts and masonry ledges (retaining
// walls) generated from the support classification along the spline.
import { Mesh, Group, Matrix4, Vector3 } from 'three';
import { BoxBuilder } from '../util/voxel.js';
import { voxelMaterial } from './materials.js';
import { hash2, clamp } from '../util/noise.js';

const STONE = [0x9b958c, 0x8f897f, 0xa59e93, 0x878177, 0x958d82];
const STONE_COLD = [0x989a9c, 0x8c8e91, 0xa2a4a6, 0x85878a, 0x939496];
const COPING = 0xbdb6aa;
const SNOW = 0xeef3f8;
const DECK_TOP = -0.8; // relative to rail head
const DECK_THICK = 1.0;
const HALF_W = 2.55;

export function buildStructures(route, terrain) {
  const bb = new BoxBuilder();
  const runs = findRuns(route, terrain);
  const piers = [];
  for (const run of runs) {
    if (run.type === 2) buildViaduct(bb, route, terrain, run, piers);
    else buildLedge(bb, route, terrain, run);
  }
  const mat = voxelMaterial({ cell: [0.9, 0.45, 0.9], local: true, brick: true, edge: 0.2, jitter: 0.14, strata: 0 });
  const mesh = new Mesh(bb.geometry(), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const g = new Group();
  g.name = 'structures';
  g.add(mesh);
  g.userData.runs = runs;
  return g;
}

function findRuns(route, terrain) {
  const N = route.N, sup = terrain.support;
  let start = 0;
  while (start < N && sup[start] !== 0) start++; // begin on ground to avoid wrap issues
  const runs = [];
  let cur = null;
  for (let q = 0; q <= N; q++) {
    const i = (start + q) % N;
    const t = q === N ? 0 : sup[i];
    if (cur && t !== cur.type) {
      cur.s1 = (start + q) * route.ds;
      runs.push(cur);
      cur = null;
    }
    if (!cur && t !== 0) cur = { type: t, s0: (start + q) * route.ds };
  }
  return runs;
}

// Horizontal frame at s with local x running along the arc (x = s - origin)
const _f = { p: new Vector3(), t: new Vector3(), r: new Vector3(), u: new Vector3() };
function segMatrix(route, s, xOrigin) {
  route.frame(s, _f);
  const t = new Vector3(_f.t.x, 0, _f.t.z).normalize();
  const r = new Vector3(-t.z, 0, t.x);
  const m = new Matrix4().makeBasis(t, new Vector3(0, 1, 0), r);
  m.setPosition(_f.p.x, _f.p.y, _f.p.z);
  if (xOrigin !== undefined) m.multiply(new Matrix4().makeTranslation(-xOrigin, 0, 0));
  return { m, p: _f.p.clone(), t, r };
}

function groundUnder(terrain, p, t, r, halfLen, halfWid) {
  let m = Infinity;
  for (const a of [-halfLen, 0, halfLen]) for (const b of [-halfWid, 0, halfWid]) {
    m = Math.min(m, terrain.topAt(p.x + t.x * a + r.x * b, p.z + t.z * a + r.z * b));
  }
  return m;
}

const isCold = (route, s) => route.height(s) > 34 || route.Z[Math.round(route.wrap(s) / route.ds) % route.N] < -40;
const stone = (route, s, k) => (isCold(route, s) ? STONE_COLD : STONE)[Math.floor(hash2(Math.floor(s * 3), k, 11) * 5)];

function deckAndParapets(bb, route, s0, s1, sides = [-1, 1]) {
  const step = 1.2;
  const n = Math.max(1, Math.round((s1 - s0) / step));
  const st = (s1 - s0) / n;
  for (let i = 0; i < n; i++) {
    const s = s0 + (i + 0.5) * st;
    const { m } = segMatrix(route, s, s);
    bb.setMatrix(m);
    const x0 = s - st / 2 - 0.06, x1 = s + st / 2 + 0.06;
    const col = stone(route, s, 1);
    bb.box(x0, DECK_TOP - DECK_THICK, -HALF_W, x1, DECK_TOP, HALF_W, col);
    // cornice band
    bb.box(x0, DECK_TOP - 0.35, -HALF_W - 0.18, x1, DECK_TOP, HALF_W + 0.18, COPING, { ao: 0.85 });
    for (const sd of sides) {
      const za = sd * (HALF_W - 0.4), zb = sd * (HALF_W + 0.12);
      bb.box(x0, DECK_TOP, Math.min(za, zb), x1, DECK_TOP + 0.75, Math.max(za, zb), stone(route, s, 2 + sd));
      bb.box(x0, DECK_TOP + 0.75, Math.min(za, zb) - 0.05, x1, DECK_TOP + 0.92, Math.max(za, zb) + 0.05, isCold(route, s) ? SNOW : COPING);
    }
  }
}

function buildViaduct(bb, route, terrain, run, piers) {
  const L = run.s1 - run.s0;
  // How tall is it? Decide span length accordingly.
  let maxH = 0;
  for (let s = run.s0; s < run.s1; s += 2) {
    const { p, t, r } = segMatrix(route, s);
    maxH = Math.max(maxH, p.y + DECK_TOP - groundUnder(terrain, p, t, r, 0, 2));
  }
  const span0 = maxH > 18 ? 12.5 : maxH > 8 ? 10 : 8;
  const n = Math.max(1, Math.round(L / span0));
  const sp = L / n;
  deckAndParapets(bb, route, run.s0, run.s1);

  const pierW = clamp(1.6 + maxH * 0.035, 1.6, 2.6);
  for (let k = 0; k <= n; k++) {
    const s = run.s0 + k * sp;
    const abut = k === 0 || k === n;
    const { m, p, t, r } = segMatrix(route, s);
    const top = DECK_TOP - DECK_THICK + 0.05;
    const g = groundUnder(terrain, p, t, r, 1.5, 3) - p.y - 1.5;
    if (g >= top) continue;
    bb.setMatrix(m);
    const len = abut ? 3.4 : pierW;
    const hw = abut ? HALF_W + 0.5 : HALF_W - 0.1;
    // Tiered pier, widening downwards.
    const tiers = Math.max(1, Math.ceil((top - g) / 7));
    for (let q = 0; q < tiers; q++) {
      const y1 = top - q * 7, y0 = Math.max(g, y1 - 7);
      const grow = q * 0.28;
      bb.box(-len / 2 - grow, y0, -hw - grow, len / 2 + grow, y1, hw + grow, stone(route, s, 20 + q), { ao: 0.82 });
      if (q > 0) bb.box(-len / 2 - grow - 0.12, y1 - 0.3, -hw - grow - 0.12, len / 2 + grow + 0.12, y1, hw + grow + 0.12, COPING);
    }
    if (!abut) {
      // footing
      bb.box(-len / 2 - tiers * 0.28 - 0.4, g - 0.5, -hw - tiers * 0.28 - 0.4, len / 2 + tiers * 0.28 + 0.4, g + 1.2, hw + tiers * 0.28 + 0.4, 0x7a746b);
      piers.push(p.clone());
    }
  }

  // Arches between piers: stepped voxel intrados with spandrel walls.
  for (let k = 0; k < n; k++) {
    const sa = run.s0 + k * sp + (k === 0 ? 1.7 : pierW / 2);
    const sb = run.s0 + (k + 1) * sp - (k + 1 === n ? 1.7 : pierW / 2);
    const clear = sb - sa;
    if (clear <= 0.5) continue;
    const mid = (sa + sb) / 2;
    const { p, t, r } = segMatrix(route, mid);
    const groundMid = groundUnder(terrain, p, t, r, clear / 2, 2) - p.y;
    const deckBottom = DECK_TOP - DECK_THICK;
    const avail = deckBottom - 0.7 - groundMid;
    const rise = clamp(Math.min(clear / 2, avail - 0.5), 0.6, clear / 2);
    const spring = deckBottom - 0.7 - rise;
    const slices = Math.max(4, Math.round(clear / 0.45));
    const w = clear / slices;
    for (let i = 0; i < slices; i++) {
      const s = sa + (i + 0.5) * w;
      const u = ((i + 0.5) / slices) * 2 - 1;
      const yArch = spring + rise * Math.sqrt(Math.max(0, 1 - u * u));
      const { m } = segMatrix(route, s, s);
      bb.setMatrix(m);
      const x0 = s - w / 2 - 0.03, x1 = s + w / 2 + 0.03;
      bb.box(x0, yArch, -HALF_W + 0.05, x1, deckBottom + 0.02, HALF_W - 0.05, stone(route, s, 40));
      // voussoir ring on both faces
      bb.box(x0, yArch, -HALF_W - 0.02, x1, yArch + 0.55, -HALF_W + 0.1, COPING, { ao: 0.9 });
      bb.box(x0, yArch, HALF_W - 0.1, x1, yArch + 0.55, HALF_W + 0.02, COPING, { ao: 0.9 });
      // fill below springing to ground for very low arches (none if open)
      if (spring > groundMid + 0.2 && Math.abs(u) > 0.985) {
        bb.box(x0, groundMid - 1, -HALF_W + 0.05, x1, spring, HALF_W - 0.05, stone(route, s, 41));
      }
    }
  }
}

function buildLedge(bb, route, terrain, run) {
  const L = run.s1 - run.s0;
  const step = 1.2;
  const n = Math.max(1, Math.round(L / step));
  const st = L / n;
  // Which side drops away?
  const mid = segMatrix(route, (run.s0 + run.s1) / 2);
  const gl = terrain.topAt(mid.p.x - mid.r.x * 8, mid.p.z - mid.r.z * 8);
  const gr = terrain.topAt(mid.p.x + mid.r.x * 8, mid.p.z + mid.r.z * 8);
  const out = gl < gr ? -1 : 1;
  deckAndParapets(bb, route, run.s0, run.s1, [out]);
  let nextButtress = run.s0 + 3;
  for (let i = 0; i < n; i++) {
    const s = run.s0 + (i + 0.5) * st;
    const { m, p, t, r } = segMatrix(route, s, s);
    const g = groundUnder(terrain, p, t, r, st / 2, HALF_W) - p.y - 1.2;
    const top = DECK_TOP - DECK_THICK + 0.02;
    if (g >= top) continue;
    bb.setMatrix(m);
    const x0 = s - st / 2 - 0.06, x1 = s + st / 2 + 0.06;
    // battered wall: slightly wider at the foot on the valley side
    const h = top - g;
    const tiers = Math.max(1, Math.ceil(h / 5));
    for (let q = 0; q < tiers; q++) {
      const y1 = top - q * 5, y0 = Math.max(g, y1 - 5);
      const grow = q * 0.22;
      const zIn = -out * HALF_W, zOut = out * (HALF_W + grow);
      bb.box(x0, y0, Math.min(zIn, zOut), x1, y1, Math.max(zIn, zOut), stone(route, s, 30 + q));
    }
    if (s >= nextButtress && h > 3) {
      nextButtress = s + 7.5;
      const zb0 = out * (HALF_W + tiers * 0.22), zb1 = out * (HALF_W + tiers * 0.22 + 0.7);
      bb.box(s - 0.7, g, Math.min(zb0, zb1), s + 0.7, top - 0.9, Math.max(zb0, zb1), stone(route, s, 50), { ao: 0.8 });
      const zc0 = out * (HALF_W + tiers * 0.22), zc1 = out * (HALF_W + tiers * 0.22 + 0.35);
      bb.box(s - 0.7, top - 0.9, Math.min(zc0, zc1), s + 0.7, top - 0.4, Math.max(zc0, zc1), COPING);
    }
  }
}
