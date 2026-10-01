// Rails, sleepers and ballast — all generated from the route spline.
import {
  BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute, Mesh, Group, InstancedMesh,
  BoxGeometry, MeshStandardMaterial, MeshLambertMaterial, Matrix4, Color, Vector3,
} from 'three';
import { lin } from '../util/voxel.js';
import { voxelMaterial } from './materials.js';
import { hash2 } from '../util/noise.js';

export const GAUGE = 1.5;
const RAIL_W = 0.14, RAIL_H = 0.2;
const SLEEPER_TOP = -RAIL_H;
const STEP = 1.0;

export function buildTrack(route, terrain) {
  const group = new Group();
  group.name = 'track';
  const N = Math.ceil(route.length / STEP);
  const ds = route.length / N;
  const frames = [];
  for (let i = 0; i <= N; i++) frames.push(route.frame(i * ds));

  // --- strip extrusion helper: profile = [[lateral, vertical, colorHex], ...]
  const extrude = (profile, closedSides, filter) => {
    const pos = [], nor = [], col = [], idx = [];
    const P = profile.length;
    const tmp = new Vector3();
    for (let i = 0; i <= N; i++) {
      const f = frames[i];
      for (let k = 0; k < P; k++) {
        const [lx, ly] = profile[k];
        tmp.copy(f.p).addScaledVector(f.r, lx).addScaledVector(f.u, ly);
        pos.push(tmp.x, tmp.y, tmp.z);
        // Normals: perpendicular to the profile segment.
        const a = profile[Math.max(0, k - 1)], b = profile[Math.min(P - 1, k + 1)];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const nl = Math.hypot(dx, dy) || 1;
        const nx = -dy / nl, ny = dx / nl;
        tmp.copy(f.r).multiplyScalar(nx).addScaledVector(f.u, ny).normalize();
        nor.push(tmp.x, tmp.y, tmp.z);
        const c = lin(typeof profile[k][2] === 'function' ? profile[k][2](i * ds) : profile[k][2]);
        col.push(c[0], c[1], c[2]);
      }
    }
    for (let i = 0; i < N; i++) {
      if (filter && !filter(i * ds)) continue;
      for (let k = 0; k < P - 1; k++) {
        const a = i * P + k, b = (i + 1) * P + k;
        idx.push(a, b + 1, b, a, a + 1, b + 1);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.setIndex(new Uint32BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    return g;
  };

  // --- ballast bed (with a skirt on earthworks so it never floats)
  const alpineAt = (s) => {
    const n = Math.round(route.wrap(s) / route.ds) % route.N;
    return terrain.alpineAlong[n] > 0.5 || route.Y[n] > 34;
  };
  const ballastCol = (s) => (alpineAt(s) ? 0xb9b6b0 : 0x8f8679);
  const shoulderCol = (s) => (alpineAt(s) ? 0xe4e8ee : 0x7d7466);
  const ballastProfile = [
    [-2.35, -3.2, shoulderCol], [-2.35, -0.78, shoulderCol], [-1.65, -0.36, ballastCol],
    [1.65, -0.36, ballastCol], [2.35, -0.78, shoulderCol], [2.35, -3.2, shoulderCol],
  ];
  const onGround = (s) => terrain.supportAt(s) === 0;
  const ballastG = extrude(ballastProfile.slice(1, 5), false, null);
  const skirtL = extrude(ballastProfile.slice(0, 2), false, onGround);
  const skirtR = extrude(ballastProfile.slice(4, 6), false, onGround);
  const ballastMat = voxelMaterial({ cell: 0.32, edge: 0, jitter: 0.45, strata: 0 });
  for (const g of [ballastG, skirtL, skirtR]) {
    const m = new Mesh(g, ballastMat);
    m.receiveShadow = true;
    group.add(m);
  }

  // --- rails (polished head, rusty web)
  const railMat = new MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.42 });
  for (const side of [-1, 1]) {
    const c = side * (GAUGE / 2);
    const prof = [
      [c - RAIL_W * 0.75, SLEEPER_TOP, 0x5a3f31], [c - RAIL_W / 2, -0.06, 0x6b4c3a], [c - RAIL_W / 2, 0, 0xd2d4d6],
      [c + RAIL_W / 2, 0, 0xd2d4d6], [c + RAIL_W / 2, -0.06, 0x6b4c3a], [c + RAIL_W * 0.75, SLEEPER_TOP, 0x5a3f31],
    ];
    const m = new Mesh(extrude(prof), railMat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }

  // --- sleepers (instanced)
  const spacing = 0.82;
  const count = Math.floor(route.length / spacing);
  const sg = new BoxGeometry(2.5, 0.16, 0.42);
  sg.translate(0, SLEEPER_TOP - 0.08, 0);
  const sleeperMat = new MeshLambertMaterial({ color: 0xffffff });
  const sleepers = new InstancedMesh(sg, sleeperMat, count);
  const m4 = new Matrix4(), col = new Color();
  const fr = { p: new Vector3(), t: new Vector3(), r: new Vector3(), u: new Vector3() };
  const snowSpots = [];
  for (let i = 0; i < count; i++) {
    const s = i * spacing;
    route.frame(s, fr);
    m4.makeBasis(fr.r, fr.u, fr.t.clone().negate()).setPosition(fr.p);
    // sleepers are laid across the track: local x = right
    sleepers.setMatrixAt(i, m4);
    const h = hash2(i, 7, 3);
    col.setHex(h < 0.33 ? 0x5b3d2a : h < 0.66 ? 0x684732 : 0x553a29);
    if (alpineAt(s) && hash2(i, 9, 1) > 0.55) col.setHex(0xe9eef4);
    sleepers.setColorAt(i, col);
    if (alpineAt(s) && hash2(i, 3, 5) > 0.6) snowSpots.push(s);
  }
  sleepers.castShadow = false;
  sleepers.receiveShadow = true;
  group.add(sleepers);

  // --- drifts of snow on the alpine stretches (between and beside the rails)
  const dg = new BoxGeometry(1, 1, 1);
  dg.translate(0, 0.5, 0);
  const drifts = new InstancedMesh(dg, new MeshLambertMaterial({ color: 0xf3f6fa }), snowSpots.length * 2);
  let di = 0;
  const sc = new Vector3(), q = new Matrix4();
  for (const s of snowSpots) {
    route.frame(s, fr);
    for (const lat of [hash2(s * 10, 1, 2) > 0.5 ? -1.95 : 1.95, (hash2(s * 10, 4, 4) - 0.5) * 0.9]) {
      const w = 0.5 + hash2(s * 10, lat * 10, 6) * 0.7, l = 0.6 + hash2(s * 13, 2, 7) * 1.2;
      const hgt = Math.abs(lat) > 1 ? 0.25 + hash2(s, 9, 9) * 0.25 : 0.1;
      const p = fr.p.clone().addScaledVector(fr.r, lat).addScaledVector(fr.u, Math.abs(lat) > 1 ? -0.6 : -0.32);
      q.makeBasis(fr.r, fr.u, fr.t.clone().negate()).scale(sc.set(w, hgt, l)).setPosition(p);
      drifts.setMatrixAt(di++, q);
    }
  }
  drifts.count = di;
  drifts.receiveShadow = true;
  group.add(drifts);

  return group;
}
