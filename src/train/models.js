// Voxel models for the locomotive, tender and coaches.
// Local space: +x forward, +y up (y = 0 is the rail head), +z to the right.
import { Group, Mesh } from 'three';
import { BoxBuilder } from '../util/voxel.js';
import { voxelMaterial, glowMaterial } from '../world/materials.js';

export const C = {
  green: 0x2d5b3d, greenDark: 0x214632, greenLight: 0x3b7350, black: 0x242424, blackSoft: 0x313131,
  red: 0x8c2f28, redDark: 0x6f2520, brass: 0xd0a650, copper: 0xb8743c, steel: 0x666b70,
  steelLight: 0x9aa0a5, cream: 0xeee3c8, maroon: 0x76292a, roof: 0x55585d, roofLight: 0x6a6d72,
  wood: 0x7a5233, coal: 0x1c1c1e, skin: 0xe8b48f, overall: 0x35507a, cap: 0x23314a,
};

const bodyMat = voxelMaterial({ cell: 0.25, edge: 0.07, jitter: 0.03, strata: 0, local: true });
const metalMat = voxelMaterial({ cell: 0.25, edge: 0.05, jitter: 0.02, strata: 0, local: true, standard: true, metalness: 0.35, roughness: 0.45 });
export const windowGlow = glowMaterial(0x30404a, 0xffc372, 1.6);
export const lampGlow = glowMaterial(0xfff1c9, 0xffd890, 6.0);
export const fireGlow = glowMaterial(0x7a2a10, 0xff7a2a, 2.5);
lampGlow.userData.glow.min = 0.35;

function mesh(bb, mat) {
  const m = new Mesh(bb.geometry(), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Voxel cylinder along x: layered rectangles approximating a circle.
function cylX(bb, x0, x1, cy, r, color, cz = 0) {
  const layers = [[1, 0.42], [0.88, 0.7], [0.7, 0.88], [0.42, 1]];
  for (const [hz, hy] of layers) bb.box(x0, cy - hy * r, cz - hz * r, x1, cy + hy * r, cz + hz * r, color);
}
// Voxel disc in the x/y plane, thickness along z.
function discZ(bb, cx, cy, r, z0, z1, color) {
  const layers = [[1, 0.4], [0.9, 0.68], [0.68, 0.9], [0.4, 1]];
  for (const [hx, hy] of layers) bb.box(cx - hx * r, cy - hy * r, z0, cx + hx * r, cy + hy * r, z1, color);
}

// A wheel as its own mesh so it can spin. Built centred at origin, face +z.
const wheelCache = new Map();
export function makeWheel(r, kind = 'driver') {
  const key = r + kind;
  let geo = wheelCache.get(key);
  if (!geo) {
    const bb = new BoxBuilder();
    const t = 0.16;
    // steel tyre ring
    const segs = 14;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      bb.push().rotateZ(a);
      bb.box(r - 0.11, -((Math.PI * r) / segs) - 0.02, -t / 2, r, (Math.PI * r) / segs + 0.02, t / 2, C.blackSoft);
      bb.pop();
    }
    // flange (inner, slightly bigger)
    discZ(bb, 0, 0, r * 0.93, -t / 2, -t / 2 + 0.04, C.steel);
    const centre = kind === 'driver' ? C.red : kind === 'coach' ? C.redDark : C.red;
    // spokes
    const spokes = kind === 'driver' ? 10 : 8;
    for (let i = 0; i < spokes; i++) {
      bb.push().rotateZ((i / spokes) * Math.PI * 2);
      bb.box(0, -0.035, -t / 2 + 0.03, r - 0.1, 0.035, t / 2 - 0.02, centre);
      bb.pop();
    }
    // rim inside tyre
    for (let i = 0; i < segs; i++) {
      bb.push().rotateZ((i / segs) * Math.PI * 2 + 0.1);
      bb.box(r - 0.17, -((Math.PI * r) / segs), -t / 2 + 0.02, r - 0.1, (Math.PI * r) / segs, t / 2 - 0.01, centre);
      bb.pop();
    }
    // hub
    discZ(bb, 0, 0, r * 0.26, -t / 2, t / 2 + 0.03, centre);
    bb.box(-0.06, -0.06, t / 2, 0.06, 0.06, t / 2 + 0.07, C.brass);
    if (kind === 'driver') {
      // counterweight (opposite the crank)
      bb.push().rotateZ(Math.PI);
      bb.box(r * 0.3, -r * 0.33, -t / 2 + 0.02, r * 0.82, r * 0.33, t / 2 + 0.01, C.redDark);
      bb.pop();
      // crank boss + pin at +x
      bb.box(0.16, -0.08, t / 2 - 0.01, 0.34, 0.08, t / 2 + 0.06, C.red);
      bb.box(0.22, -0.035, t / 2, 0.3, 0.035, t / 2 + 0.12, C.steelLight);
    }
    geo = bb.geometry();
    wheelCache.set(key, geo);
  }
  const m = new Mesh(geo, metalMat);
  m.castShadow = true;
  return m;
}

function addWheelPair(group, wheels, x, r, kind, zc = 0.78, phase = 0) {
  for (const side of [-1, 1]) {
    const w = makeWheel(r, kind);
    w.position.set(x, r, side * zc);
    if (side < 0) w.rotation.y = Math.PI; // face outwards
    w.userData = { r, side, phase: side > 0 ? phase : phase + Math.PI / 2 };
    group.add(w);
    wheels.push(w);
  }
  // axle
}

function buffers(bb, x, dir) {
  for (const z of [-0.8, 0.8]) {
    bb.box(Math.min(x, x + dir * 0.25), 0.78, z - 0.08, Math.max(x, x + dir * 0.25), 0.92, z + 0.08, C.steel);
    const x2 = x + dir * 0.25;
    bb.box(Math.min(x2, x2 + dir * 0.08), 0.62, z - 0.22, Math.max(x2, x2 + dir * 0.08), 1.08, z + 0.22, C.blackSoft);
  }
  bb.box(Math.min(x, x + dir * 0.3), 0.8, -0.06, Math.max(x, x + dir * 0.3), 0.9, 0.06, C.steel);
}

export function buildLocomotive() {
  const g = new Group();
  g.name = 'locomotive';
  const bb = new BoxBuilder(), mb = new BoxBuilder(), wb = new BoxBuilder(), lb = new BoxBuilder(), fb = new BoxBuilder();
  // ---- frames, running board, buffer beams
  bb.box(-2.7, 0.35, -0.62, 3.25, 0.95, -0.5, C.red);
  bb.box(-2.7, 0.35, 0.5, 3.25, 0.95, 0.62, C.red);
  bb.box(-2.75, 0.95, -1.2, 3.25, 1.12, 1.2, C.blackSoft);
  bb.box(-2.75, 0.78, -1.22, 3.25, 0.98, -1.12, C.red);
  bb.box(-2.75, 0.78, 1.12, 3.25, 0.98, 1.22, C.red);
  bb.box(3.25, 0.55, -1.22, 3.45, 1.12, 1.22, C.red);
  bb.box(-2.9, 0.55, -1.22, -2.75, 1.12, 1.22, C.red);
  buffers(mb, 3.45, 1);
  // front steps
  for (const z of [-1, 1]) bb.box(3.0, 0.45, z * 1.0 - 0.15, 3.25, 0.52, z * 1.0 + 0.15, C.black);
  // ---- boiler
  cylX(bb, -0.75, 2.55, 1.78, 0.7, C.green);
  for (const x of [0.05, 0.95, 1.85]) cylX(mb, x, x + 0.08, 1.78, 0.735, C.brass);
  // smokebox + door
  cylX(bb, 2.55, 3.2, 1.78, 0.76, C.black);
  cylX(bb, 3.2, 3.27, 1.78, 0.62, C.blackSoft);
  mb.box(3.27, 1.7, -0.16, 3.33, 1.86, 0.16, C.brass);
  mb.box(3.27, 1.3, -0.04, 3.31, 2.26, 0.04, C.steel);
  // headlamp (top front of smokebox)
  bb.box(2.95, 2.5, -0.2, 3.32, 2.92, 0.2, C.black);
  bb.box(2.95, 2.92, -0.12, 3.25, 2.98, 0.12, C.blackSoft);
  lb.box(3.32, 2.56, -0.14, 3.37, 2.86, 0.14, 0xffffff);
  mb.box(3.32, 2.5, -0.2, 3.38, 2.56, 0.2, C.brass);
  // chimney
  bb.box(2.62, 2.42, -0.27, 3.14, 2.62, 0.27, C.black);
  bb.box(2.7, 2.6, -0.19, 3.06, 3.2, 0.19, C.black);
  mb.box(2.6, 3.2, -0.27, 3.16, 3.4, 0.27, C.copper);
  bb.box(2.72, 3.36, -0.15, 3.04, 3.41, 0.15, 0x0d0d0d);
  // domes, sandbox, safety valves
  mb.box(0.85, 2.38, -0.31, 1.37, 2.82, 0.31, C.brass);
  mb.box(0.93, 2.82, -0.22, 1.29, 2.94, 0.22, C.brass);
  bb.box(1.8, 2.38, -0.25, 2.18, 2.68, 0.25, C.green);
  bb.box(1.85, 2.68, -0.18, 2.13, 2.76, 0.18, C.greenDark);
  mb.box(-0.58, 2.38, -0.12, -0.36, 2.78, 0.12, C.brass);
  // handrails along the boiler
  for (const z of [-0.8, 0.8]) mb.box(-0.8, 2.08, z - 0.025, 3.1, 2.13, z + 0.025, C.brass);
  // firebox
  bb.box(-1.2, 1.12, -0.72, -0.75, 2.42, 0.72, C.green);
  // ---- cab
  const cx0 = -2.75, cx1 = -0.95, cy0 = 1.12, cy1 = 3.02;
  bb.box(-1.12, cy0, -1.15, cx1, cy1, 1.15, C.green, {});
  // spectacle windows on the front plate
  for (const z of [-0.68, 0.68]) wb.box(-0.97, 2.32, z - 0.2, -0.93, 2.74, z + 0.2, 0xffffff);
  for (const sd of [-1, 1]) {
    const za = sd > 0 ? 1.03 : -1.17, zb = sd > 0 ? 1.17 : -1.03;
    bb.box(cx0, cy0, za, cx1, 2.08, zb, C.green);
    bb.box(-1.4, 2.08, za, cx1, 2.78, zb, C.green);
    bb.box(cx0, 2.08, za, -2.35, 2.78, zb, C.green);
    bb.box(cx0, 2.78, za, cx1, cy1, zb, C.green);
    // lining + number plate
    mb.box(cx0 + 0.05, 2.06, sd > 0 ? 1.17 : -1.19, cx1 - 0.05, 2.1, sd > 0 ? 1.19 : -1.17, C.brass);
    mb.box(-2.2, 1.45, sd > 0 ? 1.17 : -1.2, -1.5, 1.8, sd > 0 ? 1.2 : -1.17, C.brass);
    bb.box(-2.05, 1.53, sd > 0 ? 1.2 : -1.21, -1.65, 1.72, sd > 0 ? 1.21 : -1.2, C.red);
  }
  // rear: low wall only (open to the tender)
  bb.box(cx0, cy0, -1.17, cx0 + 0.12, 1.9, 1.17, C.green);
  for (const z of [-1.1, 1.0]) bb.box(cx0, 1.9, z, cx0 + 0.12, cy1, z + 0.1, C.green);
  // roof (two layers, black)
  bb.box(-2.92, cy1, -1.3, -0.82, cy1 + 0.13, 1.3, C.black);
  bb.box(-2.8, cy1 + 0.13, -1.0, -0.94, cy1 + 0.22, 1.0, C.blackSoft);
  mb.box(-0.98, cy1 + 0.13, -0.05, -0.88, cy1 + 0.45, 0.05, C.brass); // whistle
  mb.box(-1.0, cy1 + 0.4, -0.08, -0.86, cy1 + 0.5, 0.08, C.brass);
  // cab interior: backhead, fire, driver
  bb.box(-1.25, cy0, -0.75, -1.12, 2.5, 0.75, C.blackSoft);
  fb.box(-1.29, 1.35, -0.26, -1.24, 1.72, 0.26, 0xffffff);
  mb.box(-1.3, 2.0, -0.4, -1.25, 2.3, -0.1, C.brass); // gauge
  bb.box(-2.4, 1.12, 0.35, -1.85, 1.95, 0.85, C.overall); // driver body
  bb.box(-2.32, 1.95, 0.42, -1.92, 2.32, 0.78, C.skin); // head
  bb.box(-2.36, 2.32, 0.4, -1.86, 2.44, 0.8, C.cap);
  bb.box(-1.9, 2.36, 0.4, -1.8, 2.4, 0.8, C.cap);
  bb.box(-2.3, 1.12, -0.85, -1.85, 1.85, -0.35, C.overall); // fireman
  bb.box(-2.24, 1.85, -0.78, -1.9, 2.18, -0.42, C.skin);
  bb.box(-2.28, 2.18, -0.8, -1.86, 2.28, -0.4, 0x5a3b28);
  // ---- cylinders, slide bars, steam pipes
  for (const sd of [-1, 1]) {
    const z0 = sd * 0.9, z1 = sd * 1.32;
    bb.box(1.95, 0.5, Math.min(z0, z1), 2.95, 1.08, Math.max(z0, z1), C.green);
    mb.box(1.9, 0.56, Math.min(z0, z1) + 0.04, 1.96, 1.02, Math.max(z0, z1) - 0.04, C.brass);
    mb.box(2.94, 0.56, Math.min(z0, z1) + 0.04, 3.0, 1.02, Math.max(z0, z1) - 0.04, C.brass);
    const zs = sd * 1.12;
    mb.box(0.55, 0.92, zs - 0.04, 1.95, 0.98, zs + 0.04, C.steelLight);
    mb.box(0.55, 0.64, zs - 0.04, 1.95, 0.7, zs + 0.04, C.steelLight);
    bb.box(2.6, 1.05, Math.min(sd * 0.82, sd * 1.0), 2.8, 1.6, Math.max(sd * 0.82, sd * 1.0), C.black);
    // sand pipes / splashers over drivers
    for (const x of [-1.85, -0.35]) bb.box(x - 0.72, 1.12, Math.min(sd * 0.68, sd * 0.92), x + 0.72, 1.32, Math.max(sd * 0.68, sd * 0.92), C.green);
  }
  g.add(mesh(bb, bodyMat), mesh(mb, metalMat));
  const wmesh = new Mesh(wb.geometry(), windowGlow);
  const lmesh = new Mesh(lb.geometry(), lampGlow);
  const fmesh = new Mesh(fb.geometry(), fireGlow);
  g.add(wmesh, lmesh, fmesh);

  // ---- wheels + rods
  const wheels = [];
  addWheelPair(g, wheels, -1.85, 0.62, 'driver');
  addWheelPair(g, wheels, -0.35, 0.62, 'driver');
  addWheelPair(g, wheels, 2.45, 0.38, 'pony');
  const rods = [];
  for (const side of [-1, 1]) {
    const rb = new BoxBuilder();
    rb.box(-0.88, -0.06, -0.035, 0.88, 0.06, 0.035, C.steelLight);
    rb.box(-0.95, -0.09, -0.04, -0.75, 0.09, 0.04, C.steel);
    rb.box(0.75, -0.09, -0.04, 0.95, 0.09, 0.04, C.steel);
    const coupling = new Mesh(rb.geometry(), metalMat);
    coupling.castShadow = true;
    const cb = new BoxBuilder();
    const L = 2.05;
    cb.box(0, -0.055, -0.035, L, 0.055, 0.035, C.steelLight);
    cb.box(-0.1, -0.1, -0.045, 0.12, 0.1, 0.045, C.steel);
    cb.box(L - 0.14, -0.08, -0.045, L + 0.08, 0.08, 0.045, C.steel);
    const connecting = new Mesh(cb.geometry(), metalMat);
    connecting.castShadow = true;
    const xb = new BoxBuilder();
    xb.box(-0.14, -0.13, -0.05, 0.14, 0.13, 0.05, C.steel); // crosshead
    xb.box(0.14, -0.03, -0.03, 0.9, 0.03, 0.03, C.steelLight); // piston rod
    const crosshead = new Mesh(xb.geometry(), metalMat);
    g.add(coupling, connecting, crosshead);
    rods.push({ side, coupling, connecting, crosshead, L });
  }
  // headlamp mount point & chimney top in local coords
  g.userData = {
    wheels, rods, length: 6.7, front: 3.78, rear: -2.95, pivots: [2.45, -1.85],
    chimney: [2.88, 3.45, 0], lamp: [3.4, 2.71, 0], cylinders: [[2.45, 0.6, 1.15], [2.45, 0.6, -1.15]],
    whistle: [-0.93, 3.55, 0], valve: [-0.47, 2.8, 0],
  };
  return g;
}

// Animate rods given crank angle of the driving wheels.
export function updateRods(loco, theta) {
  const rc = 0.26, yd = 0.62, xr = -1.85, xf = -0.35;
  const yc = 0.8; // cylinder axis
  for (const rd of loco.userData.rods) {
    const ph = theta + (rd.side > 0 ? 0 : Math.PI / 2);
    // crank pin in wheel-local x/y (wheel rotates about z; left side mirrored)
    const ca = Math.cos(ph), sa = Math.sin(ph);
    const cx = rc * ca, cy = rc * sa;
    const z = rd.side * 0.98;
    rd.coupling.position.set((xr + xf) / 2 + cx, yd + cy, z);
    // connecting rod: from crosshead (on cylinder axis) to the front crank pin
    const px = xf + cx, py = yd + cy;
    const dy = yc - py;
    const xh = px + Math.sqrt(rd.L * rd.L - dy * dy);
    const ang = Math.atan2(yc - py, xh - px);
    rd.connecting.position.set(px, py, rd.side * 1.06);
    rd.connecting.rotation.set(0, 0, ang);
    rd.crosshead.position.set(xh, yc, rd.side * 1.1);
  }
}

export function buildTender() {
  const g = new Group();
  g.name = 'tender';
  const bb = new BoxBuilder(), mb = new BoxBuilder();
  bb.box(-2.0, 0.4, -0.95, 2.0, 1.0, 0.95, C.red);
  bb.box(-2.1, 0.55, -1.2, -1.95, 1.05, 1.2, C.red);
  bb.box(1.95, 0.55, -1.2, 2.1, 1.05, 1.2, C.red);
  buffers(mb, -2.1, -1);
  bb.box(-1.95, 1.0, -1.15, 1.95, 2.15, 1.15, C.green);
  bb.box(-2.0, 2.1, -1.2, 2.0, 2.22, 1.2, C.greenDark);
  for (const sd of [-1, 1]) {
    mb.box(-1.8, 1.25, sd > 0 ? 1.15 : -1.17, 1.8, 1.29, sd > 0 ? 1.17 : -1.15, C.brass);
    mb.box(-1.8, 1.9, sd > 0 ? 1.15 : -1.17, 1.8, 1.94, sd > 0 ? 1.17 : -1.15, C.brass);
    mb.box(-1.8, 1.29, sd > 0 ? 1.15 : -1.17, -1.76, 1.9, sd > 0 ? 1.17 : -1.15, C.brass);
    mb.box(1.76, 1.29, sd > 0 ? 1.15 : -1.17, 1.8, 1.9, sd > 0 ? 1.17 : -1.15, C.brass);
  }
  // coal heap (stepped) at the front, water tank behind
  bb.box(0.1, 2.22, -1.0, 1.95, 2.5, 1.0, C.coal);
  bb.box(0.4, 2.5, -0.8, 1.75, 2.72, 0.8, C.coal);
  bb.box(0.8, 2.72, -0.5, 1.5, 2.85, 0.45, 0x2a2a2c);
  bb.box(1.9, 2.22, -1.2, 2.0, 2.65, 1.2, C.greenDark);
  bb.box(-1.4, 2.22, -0.35, -0.8, 2.42, 0.35, C.black);
  mb.box(-1.35, 2.42, -0.3, -0.85, 2.48, 0.3, C.brass);
  bb.box(-1.9, 2.22, 0.6, -1.0, 2.5, 1.05, C.wood); // toolbox
  g.add(mesh(bb, bodyMat), mesh(mb, metalMat));
  const wheels = [];
  for (const x of [-1.25, 0, 1.25]) addWheelPair(g, wheels, x, 0.42, 'pony');
  g.userData = { wheels, front: 2.1, rear: -2.35, pivots: [1.25, -1.25] };
  return g;
}

export function buildCoach(variant = 0) {
  const g = new Group();
  g.name = 'coach';
  const bb = new BoxBuilder(), mb = new BoxBuilder(), wb = new BoxBuilder();
  const body = variant ? 0x2f5a46 : C.maroon;
  const x0 = -3.2, x1 = 3.2;
  // underframe + truss
  bb.box(-3.75, 0.78, -1.05, 3.75, 1.0, 1.05, C.black);
  for (const z of [-0.7, 0.7]) bb.box(-1.6, 0.5, z - 0.04, 1.6, 0.58, z + 0.04, C.steel);
  bb.box(-0.4, 0.5, -0.8, 0.4, 0.78, 0.8, C.blackSoft);
  // body
  bb.box(x0, 1.0, -1.12, x1, 1.78, 1.12, body);
  bb.box(x0, 1.78, -1.1, x1, 2.62, 1.1, C.cream);
  mb.box(x0, 1.76, -1.135, x1, 1.81, 1.135, C.brass);
  // windows
  const nWin = 6;
  for (let i = 0; i < nWin; i++) {
    const xc = x0 + 0.55 + (i * (x1 - x0 - 1.1)) / (nWin - 1);
    for (const sd of [-1, 1]) {
      wb.box(xc - 0.3, 1.88, sd > 0 ? 1.1 : -1.12, xc + 0.3, 2.38, sd > 0 ? 1.12 : -1.1, 0xffffff);
      // passengers silhouettes in some windows
      const h = Math.sin(i * 12.9 + sd * 7.7 + variant * 3.1) * 0.5 + 0.5;
      if (h > 0.45) {
        const col = [0x3a2a20, 0x6a4a2a, 0x2a2a35, 0xb08a5a][Math.floor(h * 10) % 4];
        bb.box(xc - 0.1 + (h - 0.5) * 0.2, 1.88, sd > 0 ? 1.105 : -1.125, xc + 0.12 + (h - 0.5) * 0.2, 2.02, sd > 0 ? 1.125 : -1.105, 0x5b4a6a);
        bb.box(xc - 0.06 + (h - 0.5) * 0.2, 2.02, sd > 0 ? 1.106 : -1.126, xc + 0.08 + (h - 0.5) * 0.2, 2.2, sd > 0 ? 1.126 : -1.106, col);
      }
    }
  }
  // end walls with doors
  for (const ex of [x0, x1]) {
    const d = ex > 0 ? 1 : -1;
    bb.box(Math.min(ex, ex + d * 0.06), 1.0, -0.38, Math.max(ex, ex + d * 0.06), 2.45, 0.38, C.wood);
    wb.box(Math.min(ex + d * 0.06, ex + d * 0.08), 1.9, -0.22, Math.max(ex + d * 0.06, ex + d * 0.08), 2.3, 0.22, 0xffffff);
  }
  // balconies with railings
  for (const d of [-1, 1]) {
    const bx0 = d > 0 ? x1 : -3.75, bx1 = d > 0 ? 3.75 : x0;
    bb.box(bx0, 0.95, -1.05, bx1, 1.05, 1.05, C.wood);
    for (const z of [-1.0, 1.0]) {
      mb.box(bx0, 1.05, z - 0.03, bx1, 1.08, z + 0.03, C.black);
      mb.box(bx0, 1.85, z - 0.03, bx1, 1.9, z + 0.03, C.black);
      mb.box(d > 0 ? 3.68 : -3.74, 1.05, z - 0.03, d > 0 ? 3.74 : -3.68, 1.9, z + 0.03, C.black);
    }
    mb.box(d > 0 ? 3.68 : -3.74, 1.85, -1.0, d > 0 ? 3.74 : -3.68, 1.9, -0.4, C.black);
    mb.box(d > 0 ? 3.68 : -3.74, 1.85, 0.4, d > 0 ? 3.74 : -3.68, 1.9, 1.0, C.black);
    // roof posts
    for (const z of [-1.0, 1.0]) mb.box(d > 0 ? 3.66 : -3.72, 1.9, z - 0.03, d > 0 ? 3.72 : -3.66, 2.62, z + 0.03, C.black);
  }
  buffers(mb, 3.75, 1);
  buffers(mb, -3.75, -1);
  // roof
  bb.box(-3.82, 2.62, -1.22, 3.82, 2.78, 1.22, C.roof);
  bb.box(-3.75, 2.78, -0.98, 3.75, 2.92, 0.98, C.roofLight);
  bb.box(-3.6, 2.92, -0.6, 3.6, 3.0, 0.6, C.roof);
  for (const x of [-2.2, 0, 2.2]) bb.box(x - 0.15, 3.0, -0.15, x + 0.15, 3.14, 0.15, C.blackSoft);
  g.add(mesh(bb, bodyMat), mesh(mb, metalMat));
  g.add(new Mesh(wb.geometry(), windowGlow));
  // bogies
  const wheels = [];
  for (const bx of [-2.45, 2.45]) {
    const bg = new BoxBuilder();
    bg.box(bx - 0.85, 0.32, -0.98, bx + 0.85, 0.62, -0.86, C.blackSoft);
    bg.box(bx - 0.85, 0.32, 0.86, bx + 0.85, 0.62, 0.98, C.blackSoft);
    bg.box(bx - 0.2, 0.55, -0.95, bx + 0.2, 0.78, 0.95, C.black);
    for (const sd of [-1, 1]) bg.box(bx - 0.3, 0.38, sd * 0.99 - 0.05, bx + 0.3, 0.56, sd * 0.99 + 0.05, C.steel);
    g.add(mesh(bg, metalMat));
    for (const ox of [-0.52, 0.52]) addWheelPair(g, wheels, bx + ox, 0.33, 'coach', 0.76);
  }
  g.userData = { wheels, front: 3.85, rear: -3.85, pivots: [2.45, -2.45] };
  return g;
}
