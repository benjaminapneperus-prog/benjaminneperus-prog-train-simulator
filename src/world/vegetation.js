// Instanced voxel vegetation: a handful of handcrafted species placed with
// clustered density fields, clearings and size variation — never a uniform
// scatter of identical trees.
import { InstancedMesh, Group, Matrix4, Color, Vector3, Quaternion, Euler } from 'three';
import { BoxBuilder } from '../util/voxel.js';
import { voxelMaterial } from './materials.js';
import { V, NX, NZ, WORLD, M } from './terrain.js';
import { LAYOUT } from './layout.js';
import { fbm, hash2, mulberry32, smoothstep, valueNoise } from '../util/noise.js';

const mat = voxelMaterial({ cell: 0.5, local: true, edge: 0.07, jitter: 0.1, strata: 0 });

function fir(snow, h = 1, dark = 0x2c5642) {
  const bb = new BoxBuilder();
  bb.block(0, -0.5, 0, 0.7, 1.9 * h, 0.7, 0x5e4130, { noBottom: true });
  const tiers = [[4.0, 1.15], [3.3, 1.1], [2.6, 1.05], [1.9, 1.0], [1.2, 0.9], [0.6, 0.7]];
  let y = 1.2 * h;
  tiers.forEach(([w, th], i) => {
    const c = i % 2 ? dark : 0x325f48;
    bb.block(0, y, 0, w, th, w, c, { ao: 0.75, noBottom: i > 0 });
    if (snow) {
      bb.block(0, y + th - 0.01, 0, w * 0.82, 0.26, w * 0.82, 0xf1f5fa, { noBottom: true });
      if (w > 2) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) bb.block(dx * w * 0.42, y + th - 0.3, dz * w * 0.42, 0.5, 0.32, 0.5, 0xf1f5fa);
    }
    y += th * 0.78;
  });
  if (snow) bb.block(0, y, 0, 0.4, 0.3, 0.4, 0xf6f8fb);
  return bb.geometry();
}

function spruce(snow) {
  const bb = new BoxBuilder();
  bb.block(0, -0.5, 0, 0.6, 2.2, 0.6, 0x553b2b);
  const tiers = [3.0, 2.7, 2.35, 2.0, 1.7, 1.35, 1.0, 0.6];
  let y = 1.4;
  tiers.forEach((w, i) => {
    bb.block(0, y, 0, w, 1.0, w, i % 2 ? 0x264c3c : 0x2d5845, { ao: 0.78, noBottom: i > 0 });
    if (snow && i % 2 === 0) bb.block(0, y + 0.99, 0, w * 0.7, 0.2, w * 0.7, 0xeef3f8, { noBottom: true });
    y += 0.92;
  });
  bb.block(0, y, 0, 0.3, 0.6, 0.3, 0x2d5845);
  if (snow) bb.block(0, y + 0.55, 0, 0.32, 0.2, 0.32, 0xf3f6fa);
  return bb.geometry();
}

function pine(tall = false) {
  const bb = new BoxBuilder();
  const th = tall ? 7.5 : 5.2;
  bb.block(0, -0.5, 0, 0.75, th + 0.5, 0.75, 0x6e4a2e);
  bb.block(0.5, th * 0.55, 0, 1.1, 0.3, 0.3, 0x6e4a2e);
  const g1 = 0x3f6d2c, g2 = 0x4c7d33, g3 = 0x5a8c39;
  bb.block(0, th - 0.6, 0, 3.6, 1.5, 3.6, g1, { ao: 0.75 });
  bb.block(0, th + 0.8, 0, 2.8, 1.4, 2.8, g2);
  bb.block(0, th + 2.1, 0, 1.6, 1.1, 1.6, g3);
  bb.block(1.6, th - 0.2, 0.4, 1.6, 1.0, 1.6, g2);
  bb.block(-1.4, th + 0.3, -0.6, 1.5, 1.0, 1.5, g1);
  bb.block(0.3, th - 1.6, -1.2, 1.4, 0.9, 1.3, g1);
  if (tall) bb.block(-0.9, th - 2.6, 0.9, 1.3, 0.8, 1.3, g2);
  return bb.geometry();
}

function broadleaf(c1 = 0x6a9d3a, c2 = 0x7cb046) {
  const bb = new BoxBuilder();
  bb.block(0, -0.5, 0, 0.7, 3.4, 0.7, 0x6b4a30);
  bb.block(0.6, 2.0, 0, 1.2, 0.35, 0.35, 0x6b4a30);
  bb.block(0, 2.6, 0, 4.0, 2.2, 4.0, c1, { ao: 0.75 });
  bb.block(0, 4.6, 0, 3.0, 1.2, 3.0, c2);
  bb.block(1.6, 3.2, 1.0, 1.8, 1.6, 1.8, c2);
  bb.block(-1.5, 3.0, -0.8, 1.6, 1.6, 2.0, c1);
  return bb.geometry();
}

function bush(c = 0x4f8a33) {
  const bb = new BoxBuilder();
  bb.block(0, -0.3, 0, 1.8, 1.2, 1.6, c, { ao: 0.8 });
  bb.block(0.4, 0.7, 0.1, 1.0, 0.5, 1.0, 0x5f9a3c);
  return bb.geometry();
}

function rock(snow) {
  const bb = new BoxBuilder();
  bb.block(0, -0.6, 0, 2.2, 1.6, 1.8, 0x8a8783, { ao: 0.8 });
  bb.block(0.5, 0.8, 0.2, 1.2, 0.6, 1.1, 0x96938e);
  bb.block(-0.9, -0.6, 0.6, 1.0, 0.9, 1.0, 0x7d7a76);
  if (snow) { bb.block(0, 1.0, 0, 1.9, 0.25, 1.5, 0xf0f4f9); bb.block(0.5, 1.4, 0.2, 1.0, 0.2, 0.9, 0xf0f4f9); }
  return bb.geometry();
}

function tuft() {
  const bb = new BoxBuilder();
  bb.block(0, 0, 0, 0.18, 0.5, 0.18, 0x5d9a35, { noBottom: true });
  bb.block(0.22, 0, 0.1, 0.16, 0.36, 0.16, 0x6aa83c, { noBottom: true });
  bb.block(-0.18, 0, 0.16, 0.16, 0.42, 0.16, 0x4f8a2e, { noBottom: true });
  return bb.geometry();
}

function flower() {
  const bb = new BoxBuilder();
  bb.block(0, 0, 0, 0.08, 0.4, 0.08, 0x4f8a2e);
  bb.block(0, 0.4, 0, 0.26, 0.18, 0.26, 0xffffff);
  bb.block(0.35, 0, 0.2, 0.08, 0.3, 0.08, 0x4f8a2e);
  bb.block(0.35, 0.3, 0.2, 0.22, 0.16, 0.22, 0xffffff);
  return bb.geometry();
}

export function buildVegetation(T, route) {
  const species = {
    firSnow: { geo: fir(true), items: [], cast: true },
    firSnowB: { geo: fir(true, 1.2, 0x2a4f3f), items: [], cast: true },
    fir: { geo: fir(false, 1, 0x2f5a3e), items: [], cast: true },
    spruceSnow: { geo: spruce(true), items: [], cast: true },
    spruce: { geo: spruce(false), items: [], cast: true },
    pine: { geo: pine(false), items: [], cast: true },
    pineTall: { geo: pine(true), items: [], cast: true },
    broad: { geo: broadleaf(), items: [], cast: true },
    broadAutumn: { geo: broadleaf(0xc98a34, 0xdba54a), items: [], cast: true },
    bush: { geo: bush(), items: [], cast: true },
    rock: { geo: rock(false), items: [], cast: true },
    rockSnow: { geo: rock(true), items: [], cast: true },
    tuft: { geo: tuft(), items: [], cast: false },
    flower: { geo: flower(), items: [], cast: false },
  };
  const rnd = mulberry32(1234);
  const clear = LAYOUT.clear || [];
  const inClear = (x, z, m = 0) => clear.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + m) ** 2);

  // forest section of the line: denser, closer woods
  const forestPts = [];
  for (let s = 880; s < 1190; s += 10) { const p = route.point(s); forestPts.push([p.x, p.z]); }
  const nearForestLine = (x, z) => {
    let m = Infinity;
    for (const [px, pz] of forestPts) m = Math.min(m, (x - px) ** 2 + (z - pz) ** 2);
    return Math.sqrt(m);
  };

  const add = (sp, x, y, z, scale, tint = 1, yaw = rnd() * Math.PI * 2) => {
    species[sp].items.push({ x, y, z, scale, tint, yaw });
  };

  // Trees on a jittered grid with clustered densities.
  const cell = 4.5;
  for (let gz = WORLD.z0 + 2; gz < WORLD.z1 - 2; gz += cell) {
    for (let gx = WORLD.x0 + 2; gx < WORLD.x1 - 2; gx += cell) {
      const x = gx + (rnd() - 0.5) * cell * 0.9, z = gz + (rnd() - 0.5) * cell * 0.9;
      const [i, j] = T.colOf(x, z);
      if (!T.inside(i, j)) continue;
      const k = j * NX + i;
      const top = T.h[k] * V;
      const m = T.mat[k];
      if (T.water[k] >= 0 || T.ice[k]) continue;
      if (m === M.PATH || m === M.PATH_SNOW || m === M.PLAZA || m === M.FIELD || m === M.GARDEN || m === M.GRAVEL || m === M.SAND) continue;
      const d = T.td[k];
      let steep = 0;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = Math.min(NX - 1, Math.max(0, i + a)), jj = Math.min(NZ - 1, Math.max(0, j + b));
        steep = Math.max(steep, Math.abs(T.h[k] - T.h[jj * NX + ii]));
      }
      const n = T.north[k];
      const cold = n > 0.5 || top > 48;
      if (inClear(x, z)) continue;
      const fl = nearForestLine(x, z);
      const minD = fl < 40 ? 5.5 : 7.5;
      if (d < minD) continue;
      if (steep > (cold ? 2 : 1)) continue;

      // density field
      const big = fbm(x * 0.009 + 11, z * 0.009 - 4, 3, 71);
      const small = valueNoise(x * 0.05, z * 0.05, 72);
      let dens;
      if (cold) {
        const alt = top;
        dens = smoothstep(-0.25, 0.25, big) * 0.75 + small * 0.12;
        dens *= smoothstep(98, 60, alt); // treeline
        if (alt > 30 && alt < 70) dens += 0.12;
      } else {
        dens = smoothstep(-0.15, 0.3, big) * 0.65 + small * 0.15;
        if (fl < 70) dens = Math.max(dens, 0.95 * smoothstep(70, 25, fl) * (0.55 + 0.45 * smoothstep(-0.5, 0.2, small + big)));
        dens *= smoothstep(80, 55, top);
      }
      // gentle clearings
      if (valueNoise(x * 0.022, z * 0.022, 73) > 0.45) dens *= 0.15;
      if (rnd() > dens) continue;

      const cx = WORLD.x0 + (i + 0.5) * V + (rnd() - 0.5) * 0.8;
      const cz = WORLD.z0 + (j + 0.5) * V + (rnd() - 0.5) * 0.8;
      const sizeVar = 0.7 + rnd() * 0.55 + smoothstep(0.2, 0.6, big) * 0.25;
      const tint = 0.85 + rnd() * 0.25;
      if (cold) {
        const snowy = n > 0.5 || top > 60;
        const r = rnd();
        if (snowy) add(r < 0.45 ? 'firSnow' : r < 0.75 ? 'spruceSnow' : 'firSnowB', cx, top, cz, sizeVar, tint);
        else add(r < 0.5 ? 'fir' : 'spruce', cx, top, cz, sizeVar, tint);
      } else {
        const r = rnd();
        const villageNear = Math.hypot(x + 130, z - 238) < 140;
        if (villageNear && r < 0.35) add(rnd() < 0.18 ? 'broadAutumn' : 'broad', cx, top, cz, sizeVar * 0.95, tint);
        else if (top > 40 && r < 0.6) add('fir', cx, top, cz, sizeVar, tint);
        else add(r < 0.55 ? 'pine' : r < 0.85 ? 'pineTall' : 'spruce', cx, top, cz, sizeVar * (fl < 50 ? 1.1 : 1), tint);
      }
    }
  }

  // Shrubs, rocks, grass and flowers.
  for (let q = 0; q < 26000; q++) {
    const x = WORLD.x0 + 6 + rnd() * (WORLD.x1 - WORLD.x0 - 12), z = WORLD.z0 + 6 + rnd() * (WORLD.z1 - WORLD.z0 - 12);
    const [i, j] = T.colOf(x, z);
    const k = j * NX + i;
    if (T.water[k] >= 0 || T.ice[k] || T.td[k] < 4.5) continue;
    const m = T.mat[k];
    const top = T.h[k] * V;
    const green = m === M.GRASS || m === M.GRASS_DARK || m === M.MEADOW;
    const r = rnd();
    if (green) {
      if (r < 0.05 && !inClear(x, z, -10)) add('bush', x, top, z, 0.6 + rnd() * 0.7, 0.85 + rnd() * 0.3);
      else if (r < 0.06) add('rock', x, top, z, 0.4 + rnd() * 0.6, 0.9 + rnd() * 0.2);
      else if (r < 0.5) add('tuft', x, top, z, 0.7 + rnd() * 0.8, 0.8 + rnd() * 0.4);
      else if (m === M.MEADOW && r < 0.75) add('flower', x, top, z, 0.8 + rnd() * 0.5, 1);
    } else if (m === M.SNOW || m === M.SNOW_SHADE || m === M.SNOW_ROCK) {
      if (r < 0.025) add('rockSnow', x, top, z, 0.6 + rnd() * 1.1, 0.9 + rnd() * 0.2);
    } else if (m === M.ROCK || m === M.ROCK_DARK || m === M.ALPINE_GRASS) {
      if (r < 0.04) add(top > 50 ? 'rockSnow' : 'rock', x, top, z, 0.6 + rnd() * 1.0, 0.9 + rnd() * 0.2);
    }
  }

  const group = new Group();
  group.name = 'vegetation';
  const m4 = new Matrix4(), q4 = new Quaternion(), e = new Euler(), sc = new Vector3(), pos = new Vector3(), col = new Color();
  const flowerCols = [0xf4e04d, 0xffffff, 0xe85d75, 0x9b7be0, 0xf29a3a];
  const occ = [];
  // Tile the world so instanced batches can be frustum- and shadow-culled.
  const TILE = 160;
  for (const [name, sp] of Object.entries(species)) {
    if (!sp.items.length) continue;
    const tiles = new Map();
    sp.items.forEach((it, idx) => {
      it.idx = idx;
      const key = Math.floor((it.x - WORLD.x0) / TILE) + ',' + Math.floor((it.z - WORLD.z0) / TILE);
      let arr = tiles.get(key);
      if (!arr) tiles.set(key, (arr = []));
      arr.push(it);
      const H = { firSnow: 8, firSnowB: 9, fir: 8, spruceSnow: 9.5, spruce: 9.5, pine: 8.6, pineTall: 11.2, broad: 6.6, broadAutumn: 6.6 }[name];
      if (H && it.scale > 0.6) occ.push({ ...it, H: H * it.scale });
    });
    for (const items of tiles.values()) {
      const im = new InstancedMesh(sp.geo, mat, items.length);
      items.forEach((it, n) => {
        e.set(0, it.yaw, 0);
        q4.setFromEuler(e);
        m4.compose(pos.set(it.x, it.y, it.z), q4, sc.set(it.scale, it.scale * (0.92 + hash2(it.idx, 3, 9) * 0.2), it.scale));
        im.setMatrixAt(n, m4);
        if (name === 'flower') col.setHex(flowerCols[it.idx % flowerCols.length]);
        else col.setRGB(it.tint, it.tint * (0.97 + hash2(it.idx, 1, 2) * 0.06), it.tint * 0.96);
        im.setColorAt(n, col);
      });
      im.castShadow = sp.cast;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      im.computeBoundingBox?.();
      group.add(im);
    }
  }
  // Feed tall trees into the camera occupancy grid (so it rises over forests).
  for (const it of occ) {
    const [i, j] = T.colOf(it.x, it.z);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      if (!T.inside(i + a, j + b)) continue;
      const k = (j + b) * NX + i + a;
      T.occ[k] = Math.max(T.occ[k], it.y + it.H * 0.6); // camera may brush the canopy
    }
  }
  group.userData.counts = Object.fromEntries(Object.entries(species).map(([k, v]) => [k, v.items.length]));
  return group;
}
