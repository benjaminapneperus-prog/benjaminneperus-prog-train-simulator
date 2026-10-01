// The two settlements: Frostpeak (alpine) and Meadowbrook (rural), their
// stations and platforms, plus lamps, benches, fences and static people.
// Everything is built from deliberate voxel blocks and merged per material.
import { Group, Mesh, Matrix4, Vector3, InstancedMesh, PlaneGeometry, MeshBasicMaterial, CanvasTexture, AdditiveBlending, Color, DoubleSide } from 'three';
import { BoxBuilder } from '../util/voxel.js';
import { voxelMaterial, glowMaterial } from './materials.js';
import { BUILDINGS, STATIONS, LAYOUT } from './layout.js';
import { eachPixel, textWidth } from '../util/pixelfont.js';
import { mulberry32 } from '../util/noise.js';
import { NX, V } from './terrain.js';

const SNOW = 0xf2f6fa, SNOW_SIDE = 0xe2e9f1;
const STONE = 0x8e877d, STONE_L = 0xa59d91, DARKWOOD = 0x5a3b28, WOOD = 0x7d5638, WOOD_L = 0x9c7048;
const WHITE = 0xf3efe6, IRON = 0x2e3232;

const mainMat = voxelMaterial({ cell: 0.5, local: true, edge: 0.09, jitter: 0.06, strata: 0 });
export const houseWindowGlow = glowMaterial(0x2c3a46, 0xffbe6a, 1.7);
const darkWindow = voxelMaterial({ cell: 0.5, local: true, edge: 0, jitter: 0, strata: 0 });
export const streetLampGlow = glowMaterial(0xfff0cf, 0xffcf7a, 4.5);

// A set of builders that share one transform.
class Kit {
  constructor() {
    this.main = new BoxBuilder();
    this.win = new BoxBuilder();
    this.dark = new BoxBuilder();
    this.lamp = new BoxBuilder();
    this.all = [this.main, this.win, this.dark, this.lamp];
    this.m = new Matrix4();
    this.stack = [];
  }
  _apply() { for (const b of this.all) b.setMatrix(this.m); }
  push() { this.stack.push(this.m.clone()); return this; }
  pop() { this.m.copy(this.stack.pop()); this._apply(); return this; }
  set(x, y, z, yaw = 0) { this.m.makeRotationY(yaw).setPosition(x, y, z); this._apply(); return this; }
  translate(x, y, z) { this.m.multiply(new Matrix4().makeTranslation(x, y, z)); this._apply(); return this; }
  rotateY(a) { this.m.multiply(new Matrix4().makeRotationY(a)); this._apply(); return this; }
  world(x, y, z) { return new Vector3(x, y, z).applyMatrix4(this.m); }
}

const rnd = mulberry32(77);

// ---------------------------------------------------------------- pieces --

// Build on each of the four walls of a w×d box: fn(kit, halfSpan, planeDist, sideIndex)
function eachWall(kit, w, d, fn, which = [0, 1, 2, 3]) {
  const walls = [[0, w / 2, d / 2], [Math.PI, w / 2, d / 2], [Math.PI / 2, d / 2, w / 2], [-Math.PI / 2, d / 2, w / 2]];
  for (const i of which) {
    const [a, half, plane] = walls[i];
    kit.push().rotateY(a);
    fn(kit, half, plane, i);
    kit.pop();
  }
}

// Window on the +z plane at `plane`, centred at u, bottom at y.
function windowAt(kit, u, y, plane, { w = 0.9, h = 1.0, lit = true, frame = WHITE, shutter = null, flowers = null }) {
  (lit ? kit.win : kit.dark).box(u - w / 2, y, plane - 0.02, u + w / 2, y + h, plane + 0.05, lit ? 0xffffff : 0x34424e);
  const m = kit.main;
  m.box(u - w / 2 - 0.1, y - 0.1, plane, u + w / 2 + 0.1, y, plane + 0.1, frame);
  m.box(u - w / 2 - 0.1, y + h, plane, u + w / 2 + 0.1, y + h + 0.1, plane + 0.1, frame);
  m.box(u - w / 2 - 0.1, y, plane, u - w / 2, y + h, plane + 0.1, frame);
  m.box(u + w / 2, y, plane, u + w / 2 + 0.1, y + h, plane + 0.1, frame);
  m.box(u - 0.04, y, plane + 0.02, u + 0.04, y + h, plane + 0.08, frame);
  if (shutter) {
    m.box(u - w / 2 - 0.5, y - 0.05, plane, u - w / 2 - 0.1, y + h + 0.05, plane + 0.08, shutter);
    m.box(u + w / 2 + 0.1, y - 0.05, plane, u + w / 2 + 0.5, y + h + 0.05, plane + 0.08, shutter);
  }
  if (flowers) {
    m.box(u - w / 2 - 0.05, y - 0.35, plane, u + w / 2 + 0.05, y - 0.1, plane + 0.35, WOOD);
    for (let i = 0; i < 4; i++) {
      const fx = u - w / 2 + 0.12 + i * ((w - 0.24) / 3);
      m.box(fx - 0.09, y - 0.1, plane + 0.08, fx + 0.09, y + 0.08, plane + 0.27, i % 2 ? flowers : 0x4f8a2e);
    }
  }
}

function door(kit, u, plane, color = WOOD, w = 1.1, h = 2.0) {
  kit.main.box(u - w / 2 - 0.12, 0, plane, u + w / 2 + 0.12, h + 0.12, plane + 0.08, WHITE);
  kit.main.box(u - w / 2, 0, plane + 0.04, u + w / 2, h, plane + 0.1, color);
  kit.main.box(u + w / 2 - 0.25, h * 0.48, plane + 0.1, u + w / 2 - 0.15, h * 0.55, plane + 0.15, 0xd0a650);
}

// Stepped gable roof, ridge along local x.
function gableRoof(kit, w, d, yEave, { ov = 0.7, ovx = 0.5, step = 0.45, top = SNOW, side = DARKWOOD, gable = WOOD, run = 0.62 }) {
  let half = d / 2 + ov;
  let y = yEave;
  let k = 0;
  while (half > 0.25) {
    kit.main.box(-w / 2 - ovx, y, -half, w / 2 + ovx, y + step, half, { top, side, bottom: side });
    // gable infill (inside the roof, visible beneath the overhang)
    const gh = Math.min(d / 2, half - ov * 0.6);
    if (gh > 0.1 && k > 0) kit.main.box(-w / 2, y - step, -gh, w / 2, y, gh, gable);
    half -= run;
    y += step;
    k++;
  }
  kit.main.box(-w / 2 - ovx - 0.05, y, -0.3, w / 2 + ovx + 0.05, y + 0.18, 0.3, top);
  return y;
}

function chimney(kit, x, z, yBase, yTop, out, color = STONE) {
  kit.main.box(x - 0.45, yBase, z - 0.45, x + 0.45, yTop, z + 0.45, color);
  kit.main.box(x - 0.55, yTop, z - 0.55, x + 0.55, yTop + 0.25, z + 0.55, 0x4a4a4a);
  out.push(kit.world(x, yTop + 0.3, z));
}

function voxelText(kit, text, cx, y0, plane, px, color, glow = false) {
  const wpx = textWidth(text) * px;
  const b = glow ? kit.lamp : kit.main;
  eachPixel(text, (x, y) => {
    const u = cx - wpx / 2 + x * px;
    const yy = y0 + (6 - y) * px;
    b.box(u, yy, plane, u + px * 0.95, yy + px * 0.95, plane + px * 0.6, color);
  });
  return wpx;
}

function signBoard(kit, text, cx, y0, plane, px = 0.14, board = 0x26472f, letters = 0xf4ead0) {
  const wpx = textWidth(text) * px;
  kit.main.box(cx - wpx / 2 - 0.35, y0 - 0.3, plane, cx + wpx / 2 + 0.35, y0 + 7 * px + 0.3, plane + 0.12, board);
  kit.main.box(cx - wpx / 2 - 0.45, y0 - 0.4, plane - 0.02, cx + wpx / 2 + 0.45, y0 + 7 * px + 0.4, plane + 0.06, 0xd0a650);
  voxelText(kit, text, cx, y0, plane + 0.12, px, letters);
}

function lampPost(kit, x, z, y, out, { h = 3.2, color = IRON, double = false } = {}) {
  kit.push().translate(x, y, z);
  kit.main.box(-0.25, 0, -0.25, 0.25, 0.4, 0.25, color);
  kit.main.box(-0.09, 0.4, -0.09, 0.09, h, 0.09, color);
  const heads = double ? [-0.7, 0.7] : [0];
  for (const ox of heads) {
    if (double) kit.main.box(Math.min(0, ox), h - 0.1, -0.05, Math.max(0, ox), h, 0.05, color);
    kit.main.box(ox - 0.26, h, -0.26, ox + 0.26, h + 0.08, 0.26, color);
    kit.lamp.box(ox - 0.2, h + 0.08, -0.2, ox + 0.2, h + 0.5, 0.2, 0xffffff);
    kit.main.box(ox - 0.3, h + 0.5, -0.3, ox + 0.3, h + 0.62, 0.3, color);
    kit.main.box(ox - 0.12, h + 0.62, -0.12, ox + 0.12, h + 0.75, 0.12, color);
    out.push({ p: kit.world(ox, h + 0.3, 0), ground: kit.world(ox, 0.06, 0) });
  }
  kit.pop();
}

function bench(kit, x, z, y, yaw) {
  kit.push().translate(x, y, z).rotateY(yaw);
  for (const u of [-0.8, 0.8]) kit.main.box(u - 0.08, 0, -0.25, u + 0.08, 0.45, 0.25, IRON);
  kit.main.box(-1.0, 0.45, -0.28, 1.0, 0.55, 0.28, WOOD_L);
  kit.main.box(-1.0, 0.55, -0.3, 1.0, 1.05, -0.2, WOOD);
  kit.pop();
}

const SKIN = [0xf0c19b, 0xd9a07a, 0xb07850, 0xf5d0b0];
function person(kit, x, z, y, yaw, o = {}) {
  const s = o.scale ?? 1;
  kit.push().translate(x, y, z).rotateY(yaw);
  const m = kit.main;
  const coat = o.coat ?? 0x8a3a3a, pants = o.pants ?? 0x2f3540, skin = o.skin ?? SKIN[Math.floor(rnd() * 4)];
  const L = (a, b, c, d, e, f, col) => m.box(a * s, b * s, c * s, d * s, e * s, f * s, col);
  if (o.sit) {
    L(-0.22, 0.45, -0.05, -0.04, 0.6, 0.45, pants); L(0.04, 0.45, -0.05, 0.22, 0.6, 0.45, pants);
    L(-0.22, 0, 0.3, -0.04, 0.45, 0.45, pants); L(0.04, 0, 0.3, 0.22, 0.45, 0.45, pants);
    L(-0.27, 0.55, -0.2, 0.27, 1.15, 0.12, coat);
    L(-0.17, 1.15, -0.17, 0.17, 1.5, 0.17, skin);
  } else {
    L(-0.22, 0, -0.1, -0.03, 0.72, 0.1, pants); L(0.03, 0, -0.1, 0.22, 0.72, 0.1, pants);
    L(-0.26, 0.72, -0.16, 0.26, 1.38, 0.16, coat);
    if (o.long) L(-0.28, 0.4, -0.18, 0.28, 0.8, 0.18, coat);
    L(-0.38, 0.78, -0.08, -0.26, 1.34, 0.08, coat);
    if (o.wave) L(0.26, 1.2, -0.08, 0.38, 1.8, 0.08, coat); else L(0.26, 0.78, -0.08, 0.38, 1.34, 0.08, coat);
    if (o.scarf) L(-0.22, 1.28, -0.18, 0.22, 1.4, 0.18, o.scarf);
    L(-0.17, 1.38, -0.17, 0.17, 1.72, 0.17, skin);
    L(-0.06, 1.5, 0.17, -0.02, 1.56, 0.19, 0x222222); L(0.02, 1.5, 0.17, 0.06, 1.56, 0.19, 0x222222);
  }
  const hy = o.sit ? 1.5 : 1.72;
  if (o.hat === 'beanie') { L(-0.19, hy - 0.08, -0.19, 0.19, hy + 0.12, 0.19, o.hatColor ?? 0xc0392b); L(-0.06, hy + 0.12, -0.06, 0.06, hy + 0.2, 0.06, WHITE); }
  else if (o.hat === 'cap') { L(-0.19, hy - 0.04, -0.19, 0.19, hy + 0.08, 0.19, o.hatColor ?? 0x2b3a5a); L(-0.15, hy - 0.04, 0.15, 0.15, hy + 0.02, 0.32, o.hatColor ?? 0x2b3a5a); }
  else if (o.hat === 'straw') { L(-0.32, hy - 0.02, -0.32, 0.32, hy + 0.04, 0.32, 0xe0c070); L(-0.18, hy + 0.04, -0.18, 0.18, hy + 0.18, 0.18, 0xe0c070); }
  else if (o.hat === 'top') { L(-0.24, hy - 0.02, -0.24, 0.24, hy + 0.03, 0.24, 0x222222); L(-0.16, hy + 0.03, -0.16, 0.16, hy + 0.36, 0.16, 0x222222); }
  else L(-0.18, hy - 0.06, -0.18, 0.18, hy + 0.06, 0.18, o.hair ?? 0x4a3020);
  if (o.bag) L(0.3, 0.7, -0.15, 0.48, 1.05, 0.15, o.bag);
  kit.pop();
}

function fence(kit, pts, y, { color = WHITE, picket = true, gap = 1.4 } = {}) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const yaw = Math.atan2(-(bz - az), bx - ax);
    kit.push().translate(ax, typeof y === 'function' ? y(ax, az) : y, az).rotateY(yaw);
    const n = Math.max(1, Math.round(len / gap));
    for (let k = 0; k <= n; k++) {
      const u = (k / n) * len;
      kit.main.box(u - 0.08, 0, -0.08, u + 0.08, picket ? 1.0 : 1.15, 0.08, color);
      if (picket) kit.main.box(u - 0.04, 1.0, -0.04, u + 0.04, 1.12, 0.04, color);
    }
    kit.main.box(0, 0.35, -0.04, len, 0.45, 0.04, color);
    kit.main.box(0, 0.75, -0.04, len, 0.85, 0.04, color);
    kit.pop();
  }
}

// ------------------------------------------------------------- buildings --

function chalet(kit, b, out) {
  const { w, d } = b, floors = b.floors ?? 2;
  const m = kit.main;
  const H1 = 2.6, H2 = floors > 1 ? 2.3 : 0;
  m.box(-w / 2 - 0.15, -0.6, -d / 2 - 0.15, w / 2 + 0.15, 0.9, d / 2 + 0.15, STONE, { ao: 0.8 });
  m.box(-w / 2, 0.9, -d / 2, w / 2, H1, d / 2, b.wall);
  if (H2) {
    m.box(-w / 2 - 0.1, H1, -d / 2 - 0.1, w / 2 + 0.1, H1 + H2, d / 2 + 0.1, b.timber);
    // horizontal plank lines
    for (let y = H1 + 0.55; y < H1 + H2; y += 0.55) m.box(-w / 2 - 0.12, y, -d / 2 - 0.12, w / 2 + 0.12, y + 0.06, d / 2 + 0.12, DARKWOOD);
  }
  const eave = H1 + H2;
  eachWall(kit, w, d, (k, half, plane, i) => {
    const front = i === 0;
    const n = Math.max(1, Math.floor((half * 2) / 2.4));
    for (let q = 0; q < n; q++) {
      const u = -half + (half * 2 * (q + 0.5)) / n;
      if (front && Math.abs(u) < 1 && n % 2 === 1) continue;
      windowAt(k, u, 1.2, plane, { lit: rnd() < 0.8, shutter: b.shutter ?? 0x3d6b46, frame: WHITE });
      if (H2) windowAt(k, u, H1 + 0.6, plane + 0.1, { lit: rnd() < 0.6, shutter: b.shutter ?? 0x3d6b46, flowers: front ? 0xd94a4a : null, frame: 0xead9b8 });
    }
    if (front) {
      door(k, n % 2 === 1 ? 0 : 0.0, plane, DARKWOOD);
      // lantern beside the door
      k.main.box(0.85, 2.1, plane, 1.15, 2.2, plane + 0.35, IRON);
      k.lamp.box(0.88, 1.8, plane + 0.1, 1.12, 2.1, plane + 0.34, 0xffffff);
      out.lamps.push({ p: k.world(1.0, 1.95, plane + 0.4), ground: k.world(1.0, 0.06, plane + 1.2), small: true });
      if (H2) {
        // balcony
        m.box(-half + 0.3, H1 - 0.1, plane + 0.1, half - 0.3, H1 + 0.05, plane + 0.9, WOOD);
        for (let u = -half + 0.4; u <= half - 0.35; u += 0.45) m.box(u - 0.06, H1 + 0.05, plane + 0.8, u + 0.06, H1 + 0.85, plane + 0.9, WOOD_L);
        m.box(-half + 0.3, H1 + 0.85, plane + 0.78, half - 0.3, H1 + 0.98, plane + 0.92, WOOD);
        m.box(-half + 0.3, H1 + 0.98, plane + 0.8, half - 0.3, H1 + 1.1, plane + 0.92, SNOW);
      }
    }
  });
  const ridge = gableRoof(kit, w, d, eave, { ov: 0.9, ovx: 0.7, step: 0.4, run: 0.75, top: SNOW, side: 0x4b3222, gable: b.timber });
  chimney(kit, w * 0.25, -d * 0.18, eave, ridge + 0.5, out.chimneys);
  // snow drifts and woodpile
  m.box(-w / 2 - 0.6, -0.2, -d / 2 - 0.4, -w / 2 + 0.6, 0.35, d / 2 + 0.4, SNOW);
  m.box(w / 2 + 0.15, 0, -d / 2 + 0.5, w / 2 + 0.9, 1.3, -d / 2 + 2.6, 0x8a5a36);
  for (let y = 0.2; y < 1.3; y += 0.4) m.box(w / 2 + 0.88, y, -d / 2 + 0.6, w / 2 + 0.94, y + 0.25, -d / 2 + 2.5, 0xc79a62);
  m.box(w / 2 + 0.1, 1.3, -d / 2 + 0.4, w / 2 + 1.0, 1.45, -d / 2 + 2.7, SNOW);
  return ridge;
}

function chapel(kit, b, out) {
  const { w, d } = b;
  const m = kit.main;
  m.box(-w / 2 - 0.2, -0.6, -d / 2 - 0.2, w / 2 + 0.2, 0.6, d / 2 + 0.2, STONE);
  m.box(-w / 2, 0.6, -d / 2, w / 2, 4.6, d / 2, 0xf1ece2);
  eachWall(kit, w, d, (k, half, plane, i) => {
    if (i < 2) return;
    for (let u = -half + 2; u <= half - 2; u += 2.6) {
      windowAt(k, u, 1.8, plane, { w: 0.8, h: 1.8, lit: true, frame: STONE_L });
      k.win.box(u - 0.25, 3.6, plane - 0.02, u + 0.25, 3.8, plane + 0.05, 0xffffff);
    }
  });
  // roof: ridge along local z (rotate)
  kit.push().rotateY(Math.PI / 2);
  gableRoof(kit, d, w, 4.6, { ov: 0.6, ovx: 0.4, step: 0.5, run: 0.55, top: SNOW, side: 0x5a5f66, gable: 0xf1ece2 });
  kit.pop();
  // bell tower at the front (+z)
  const tz = d / 2 - 1.2;
  m.box(-1.5, 0.6, tz - 1.5, 1.5, 8.6, tz + 1.5, 0xf4efe6);
  m.box(-1.6, 8.6, tz - 1.6, 1.6, 8.9, tz + 1.6, STONE_L);
  for (const [a, bq] of [[0, 1], [Math.PI, 1], [Math.PI / 2, 1], [-Math.PI / 2, 1]]) {
    kit.push().translate(0, 0, tz).rotateY(a);
    kit.dark.box(-0.45, 6.8, 1.5, 0.45, 8.0, 1.56, 0x2a2a2e);
    kit.main.box(-0.75, 5.2, 1.5, 0.75, 5.95, 1.6, 0xf8f8f8); // clock face
    kit.main.box(-0.05, 5.5, 1.6, 0.05, 5.9, 1.65, 0x222222);
    kit.main.box(-0.05, 5.52, 1.6, 0.3, 5.6, 1.65, 0x222222);
    kit.pop();
  }
  // spire (stepped)
  let s = 1.5, y = 8.9;
  while (s > 0.15) { m.box(-s, y, tz - s, s, y + 0.6, tz + s, { top: SNOW, side: 0x5a5f66 }); s -= 0.28; y += 0.6; }
  m.box(-0.05, y, tz - 0.05, 0.05, y + 1.2, tz + 0.05, 0xd0a650);
  m.box(-0.35, y + 0.7, tz - 0.05, 0.35, y + 0.8, tz + 0.05, 0xd0a650);
  door(kit, 0, d / 2, DARKWOOD, 1.3, 2.4);
  return y + 1.2;
}

function cottage(kit, b, out) {
  const { w, d } = b;
  const m = kit.main;
  m.box(-w / 2 - 0.1, -0.6, -d / 2 - 0.1, w / 2 + 0.1, 0.4, d / 2 + 0.1, STONE);
  m.box(-w / 2, 0.4, -d / 2, w / 2, 3.2, d / 2, b.wall);
  // corner posts
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) m.box(x * w / 2 - 0.12, 0.4, z * d / 2 - 0.12, x * w / 2 + 0.12, 3.2, z * d / 2 + 0.12, WHITE);
  eachWall(kit, w, d, (k, half, plane, i) => {
    const n = Math.max(1, Math.floor((half * 2) / 2.2));
    for (let q = 0; q < n; q++) {
      const u = -half + (half * 2 * (q + 0.5)) / n;
      if (i === 0 && Math.abs(u) < 1.0) continue;
      windowAt(k, u, 1.3, plane, { lit: rnd() < 0.75, frame: WHITE, flowers: i === 0 ? [0xe85d75, 0xf4e04d, 0x9b7be0][q % 3] : null, shutter: i === 0 ? b.shutter ?? 0x4a7a9a : null });
    }
    if (i === 0) {
      door(k, 0, plane, b.door ?? 0x3d6b46);
      k.main.box(-0.9, 2.45, plane, 0.9, 2.6, plane + 0.7, b.roof);
      k.lamp.box(1.0, 2.0, plane + 0.05, 1.25, 2.35, plane + 0.3, 0xffffff);
      out.lamps.push({ p: k.world(1.1, 2.2, plane + 0.4), ground: k.world(1.1, 0.06, plane + 1.2), small: true });
    }
  });
  const ridge = gableRoof(kit, w, d, 3.2, { ov: 0.6, ovx: 0.45, step: 0.42, run: 0.5, top: b.roof, side: new Color(b.roof).multiplyScalar(0.7).getHex(), gable: b.wall });
  chimney(kit, -w * 0.28, 0.4, 3.2, ridge + 0.4, out.chimneys, 0x9b5a45);
  return ridge;
}

function postOffice(kit, b, out) {
  const { w, d } = b;
  const m = kit.main;
  const YEL = 0xf2c64b, BLUE = 0x2f5d9c;
  m.box(-w / 2 - 0.1, -0.6, -d / 2 - 0.1, w / 2 + 0.1, 0.5, d / 2 + 0.1, STONE_L);
  m.box(-w / 2, 0.5, -d / 2, w / 2, 5.6, d / 2, YEL);
  m.box(-w / 2 - 0.08, 2.9, -d / 2 - 0.08, w / 2 + 0.08, 3.1, d / 2 + 0.08, BLUE);
  m.box(-w / 2 - 0.1, 5.6, -d / 2 - 0.1, w / 2 + 0.1, 5.9, d / 2 + 0.1, WHITE);
  eachWall(kit, w, d, (k, half, plane, i) => {
    const n = Math.max(1, Math.floor((half * 2) / 2.2));
    for (let q = 0; q < n; q++) {
      const u = -half + (half * 2 * (q + 0.5)) / n;
      if (i === 0 && Math.abs(u) < 1.4) continue;
      windowAt(k, u, 1.2, plane, { w: 1.0, h: 1.3, lit: true, frame: WHITE, shutter: BLUE });
      windowAt(k, u, 3.7, plane, { w: 0.9, h: 1.1, lit: rnd() < 0.7, frame: WHITE, shutter: BLUE });
    }
    if (i === 0) {
      door(k, 0, plane, BLUE, 1.5, 2.3);
      signBoard(k, 'POST', 0, 3.75, plane + 0.05, 0.17, BLUE, 0xffe28a);
      // post horn emblem
      k.main.box(-0.4, 2.45, plane + 0.08, 0.4, 2.7, plane + 0.2, 0xffd34a);
      k.main.box(0.25, 2.3, plane + 0.08, 0.5, 2.85, plane + 0.2, 0xffd34a);
      k.main.box(-0.55, 2.5, plane + 0.08, -0.4, 2.65, plane + 0.2, 0xffd34a);
      // red post box and parcels
      k.main.box(2.6, 0, plane + 0.8, 3.2, 1.3, plane + 1.4, 0xc0392b);
      k.main.box(2.55, 1.3, plane + 0.75, 3.25, 1.45, plane + 1.45, 0xa02f22);
      k.main.box(2.75, 0.95, plane + 1.4, 3.05, 1.02, plane + 1.43, 0x222222);
      k.main.box(-3.4, 0, plane + 0.6, -2.7, 0.55, plane + 1.2, 0xb08a5a);
      k.main.box(-3.25, 0.55, plane + 0.7, -2.85, 0.85, plane + 1.05, 0xc9a36a);
      k.lamp.box(-1.25, 2.1, plane + 0.05, -1.0, 2.45, plane + 0.3, 0xffffff);
      out.lamps.push({ p: k.world(-1.1, 2.3, plane + 0.4), ground: k.world(-1.1, 0.06, plane + 1.4), small: true });
    }
  });
  // hip roof (stepped in both directions)
  let hx = w / 2 + 0.5, hz = d / 2 + 0.5, y = 5.9;
  while (hx > 0.6 && hz > 0.6) {
    m.box(-hx, y, -hz, hx, y + 0.4, hz, { top: 0x8c3a2a, side: 0x6e2c20 });
    hx -= 0.5; hz -= 0.5; y += 0.4;
  }
  m.box(-hx, y, -0.2, hx, y + 0.2, 0.2, 0x6e2c20);
  chimney(kit, w * 0.3, -d * 0.2, 5.9, y + 0.6, out.chimneys, 0x9b5a45);
  // flag pole
  m.box(-w / 2 - 0.9, 0, d / 2 + 0.4, -w / 2 - 0.75, 7.5, d / 2 + 0.55, WHITE);
  m.box(-w / 2 - 0.75, 6.4, d / 2 + 0.47, -w / 2 + 0.85, 7.3, d / 2 + 0.5, 0xc0392b);
  m.box(-w / 2 - 0.75, 6.75, d / 2 + 0.46, -w / 2 + 0.85, 6.95, d / 2 + 0.51, 0xffffff);
  return y;
}

function barn(kit, b, out) {
  const { w, d } = b;
  const m = kit.main, RED = 0xa8382c;
  m.box(-w / 2, -0.6, -d / 2, w / 2, 4.2, d / 2, RED);
  for (let x = -w / 2; x <= w / 2; x += 1.25) m.box(x - 0.05, 0, d / 2, x + 0.05, 4.2, d / 2 + 0.06, 0x8a2e24);
  m.box(-1.6, 0, d / 2 + 0.02, 1.6, 3.3, d / 2 + 0.12, 0x7a2a22);
  m.box(-1.6, 0, d / 2 + 0.12, 1.6, 0.15, d / 2 + 0.18, WHITE);
  m.box(-0.08, 0, d / 2 + 0.12, 0.08, 3.3, d / 2 + 0.18, WHITE);
  m.box(-1.6, 3.2, d / 2 + 0.12, 1.6, 3.35, d / 2 + 0.18, WHITE);
  const ridge = gableRoof(kit, w, d, 4.2, { ov: 0.5, ovx: 0.3, step: 0.5, run: 0.5, top: 0x5a5a5e, side: 0x444448, gable: RED });
  for (let i = 0; i < 4; i++) m.box(w / 2 + 0.6 + (i % 2) * 1.3, 0 + Math.floor(i / 2) * 1.0, d / 2 - 1.2, w / 2 + 1.8 + (i % 2) * 1.3, 1.0 + Math.floor(i / 2) * 1.0, d / 2 + 0.2, 0xe2c25a);
  return ridge;
}

function windmill(kit, b, out) {
  const m = kit.main;
  m.box(-3, -0.6, -3, 3, 0.4, 3, STONE);
  let s = 2.6, y = 0.4;
  for (let i = 0; i < 6; i++) { m.box(-s, y, -s, s, y + 1.6, s, i % 2 ? 0xf2ede2 : 0xe9e2d4); s -= 0.25; y += 1.6; }
  door(kit, 0, 2.6, DARKWOOD, 1.1, 2.0);
  windowAt(kit, 0, 4.6, 2.1, { w: 0.7, h: 0.8, lit: true });
  const capY = y;
  m.box(-1.8, capY, -2.0, 1.8, capY + 0.6, 2.0, 0x6b4a30);
  m.box(-1.4, capY + 0.6, -1.6, 1.4, capY + 1.2, 1.6, 0x7a5636);
  m.box(-0.9, capY + 1.2, -1.0, 0.9, capY + 1.7, 1.0, 0x6b4a30);
  out.mill = { pos: kit.world(0, capY + 0.6, 2.2), yaw: b.yaw };
  return capY + 1.7;
}

function station(kit, b, out, st, alpine) {
  const { w, d } = b;
  const m = kit.main;
  const wall = alpine ? 0xcfc6b8 : 0xc96b4a, trim = alpine ? DARKWOOD : WHITE;
  m.box(-w / 2 - 0.15, -2.8, -d / 2 - 0.15, w / 2 + 0.15, 0.7, d / 2 + 0.15, STONE);
  m.box(-w / 2, 0.7, -d / 2, w / 2, 3.6, d / 2, alpine ? STONE_L : wall);
  if (!alpine) for (let y = 1.0; y < 3.6; y += 0.5) m.box(-w / 2 - 0.02, y, -d / 2 - 0.02, w / 2 + 0.02, y + 0.04, d / 2 + 0.02, 0xb85d40);
  const upper = alpine ? 2.4 : 0;
  if (alpine) {
    m.box(-w / 2 - 0.1, 3.6, -d / 2 - 0.1, w / 2 + 0.1, 3.6 + upper, d / 2 + 0.1, 0x7a5236);
    for (let y = 4.1; y < 3.6 + upper; y += 0.55) m.box(-w / 2 - 0.12, y, -d / 2 - 0.12, w / 2 + 0.12, y + 0.06, d / 2 + 0.12, DARKWOOD);
  }
  const eave = 3.6 + upper;
  eachWall(kit, w, d, (k, half, plane, i) => {
    const n = Math.max(1, Math.floor((half * 2) / 2.2));
    for (let q = 0; q < n; q++) {
      const u = -half + (half * 2 * (q + 0.5)) / n;
      if (i === 0 && Math.abs(u) < 1.2) continue;
      windowAt(k, u, 1.3, plane, { w: 1.0, h: 1.4, lit: true, frame: trim, shutter: alpine ? 0x3d6b46 : null });
      if (alpine) windowAt(k, u, 4.2, plane + 0.1, { lit: rnd() < 0.7, frame: 0xead9b8, flowers: i === 0 ? 0xd94a4a : null, shutter: 0x3d6b46 });
    }
    if (i === 0) {
      door(k, 0, plane, alpine ? DARKWOOD : 0x2f5d3c, 1.4, 2.4);
      // clock above the door
      k.main.box(-0.55, 2.7, plane, 0.55, 3.45, plane + 0.18, IRON);
      k.main.box(-0.42, 2.8, plane + 0.18, 0.42, 3.35, plane + 0.22, 0xfaf6ea);
      k.main.box(-0.03, 3.05, plane + 0.22, 0.03, 3.3, plane + 0.25, 0x111111);
      k.main.box(-0.03, 3.05, plane + 0.22, 0.2, 3.1, plane + 0.25, 0x111111);
    }
  });
  const ridge = gableRoof(kit, w, d, eave, {
    ov: 1.0, ovx: 0.8, step: 0.4, run: alpine ? 0.8 : 0.6,
    top: alpine ? SNOW : 0x9b3a2b, side: alpine ? 0x4b3222 : 0x7a2c20, gable: alpine ? 0x7a5236 : wall,
  });
  chimney(kit, -w * 0.3, -0.5, eave, ridge + 0.4, out.chimneys, alpine ? STONE : 0x9b5a45);
  // name board on the roof edge facing the track
  signBoard(kit, st.name.toUpperCase(), 0, eave - 1.15, d / 2 + 0.12, 0.14, alpine ? 0x26472f : 0x2b4a6b);

  // canopy over the platform: from the building front to near the edge
  const cz0 = d / 2, cz1 = 11.5 - 2.6;
  const cy = 3.5;
  for (let x = -w / 2 - 1.5; x <= w / 2 + 1.5 + 0.01; x += (w + 3) / 3) {
    m.box(x - 0.14, 0.7, cz1 - 0.6, x + 0.14, cy, cz1 - 0.32, alpine ? DARKWOOD : 0x2f5d3c);
    m.box(x - 0.1, cy - 0.7, cz1 - 1.5, x + 0.1, cy - 0.5, cz1 - 0.4, alpine ? DARKWOOD : 0x2f5d3c);
  }
  m.box(-w / 2 - 2.0, cy, cz0, w / 2 + 2.0, cy + 0.25, cz1, alpine ? WOOD : 0x3c6e4b);
  m.box(-w / 2 - 2.0, cy + 0.25, cz0, w / 2 + 2.0, cy + 0.45, cz1, alpine ? SNOW : 0x9b3a2b);
  // valance with teeth
  for (let x = -w / 2 - 2.0; x < w / 2 + 2.0; x += 0.4) {
    m.box(x, cy - 0.3, cz1 - 0.08, x + 0.3, cy, cz1, alpine ? DARKWOOD : (Math.round(x * 2.5) % 2 ? WHITE : 0xc0392b));
  }
  // lamps hanging under the canopy
  for (const x of [-w / 4, w / 4]) {
    m.box(x - 0.04, cy - 0.6, cz1 - 1.6, x + 0.04, cy, cz1 - 1.5, IRON);
    kit.lamp.box(x - 0.2, cy - 1.0, cz1 - 1.75, x + 0.2, cy - 0.6, cz1 - 1.35, 0xffffff);
    out.lamps.push({ p: kit.world(x, cy - 0.8, cz1 - 1.55), ground: kit.world(x, 0.82, cz1 - 1.55) });
  }
  // benches, luggage, skis or flower tubs
  bench(kit, -w / 2 + 1.2, d / 2 + 1.2, 0.7, 0);
  bench(kit, w / 2 - 1.2, d / 2 + 1.2, 0.7, 0);
  if (alpine) {
    for (let i = 0; i < 3; i++) m.box(w / 2 + 0.2 + i * 0.25, 0.7, d / 2 - 1.2, w / 2 + 0.3 + i * 0.25, 2.5, d / 2 - 1.1, [0xc0392b, 0x2f5d9c, 0xf2c64b][i]);
    m.box(-w / 2 - 1.6, 0.7, d / 2 + 0.6, -w / 2 - 0.4, 0.95, d / 2 + 1.0, 0xa83a2a); // sled
    m.box(-w / 2 - 1.7, 0.7, d / 2 + 0.55, -w / 2 - 1.5, 1.05, d / 2 + 1.05, 0x7a2a20);
  } else {
    for (const x of [-w / 2 - 0.9, w / 2 + 0.9]) {
      m.box(x - 0.4, 0.7, d / 2 + 0.2, x + 0.4, 1.3, d / 2 + 1.0, WOOD);
      for (let q = 0; q < 4; q++) m.box(x - 0.3 + (q % 2) * 0.35, 1.3, d / 2 + 0.3 + Math.floor(q / 2) * 0.35, x - 0.05 + (q % 2) * 0.35, 1.6, d / 2 + 0.55 + Math.floor(q / 2) * 0.35, [0xe85d75, 0xf4e04d, 0xffffff, 0x9b7be0][q]);
    }
    m.box(w / 2 - 3.2, 0.7, d / 2 + 0.3, w / 2 - 2.6, 1.6, d / 2 + 0.9, 0x9aa0a5); // milk churns
    m.box(w / 2 - 2.5, 0.7, d / 2 + 0.3, w / 2 - 1.9, 1.6, d / 2 + 0.9, 0x9aa0a5);
  }
  return ridge;
}

// --------------------------------------------------------------- platforms

function platform(kit, route, st, alpine, out) {
  const P = st.platform;
  const top = P.top;
  const step = 1.0;
  for (let s = P.s0; s < P.s1; s += step) {
    const sm = s + step / 2;
    const p = route.point(sm), t = route.tangent(sm);
    const yaw = Math.atan2(-t.z, t.x);
    kit.set(p.x, 0, p.z, yaw);
    // local z: +z = right of travel; platform is on the left (negative lat)
    const z0 = P.lat1, z1 = P.lat0;
    const ground = st.y - 3.5;
    kit.main.box(-step / 2 - 0.02, ground, z0, step / 2 + 0.02, top - 0.15, z1 - 0.35, alpine ? STONE : 0x9c8f80);
    kit.main.box(-step / 2 - 0.02, top - 0.15, z0, step / 2 + 0.02, top, z1 - 0.4, alpine ? (Math.floor(s) % 3 ? SNOW : 0xdfe6ee) : (Math.floor(s) % 2 ? 0xb5aa9a : 0xa99d8c));
    // edge coping (white safety line)
    kit.main.box(-step / 2 - 0.02, top - 0.3, z1 - 0.4, step / 2 + 0.02, top + 0.02, z1, alpine ? 0xc9c3b8 : 0xd8d0c0);
    kit.main.box(-step / 2 - 0.02, top + 0.02, z1 - 0.38, step / 2 + 0.02, top + 0.04, z1 - 0.26, 0xf4e04d);
    kit.main.box(-step / 2 - 0.02, ground, z1 - 0.4, step / 2 + 0.02, top - 0.3, z1 - 0.05, 0x77706a);
  }
  // ramps at both ends
  for (const [s, dir] of [[P.s0, -1], [P.s1, 1]]) {
    const p = route.point(s), t = route.tangent(s);
    kit.set(p.x, 0, p.z, Math.atan2(-t.z, t.x));
    for (let i = 0; i < 4; i++) {
      const x0 = dir > 0 ? i * 0.8 : -(i + 1) * 0.8, x1 = x0 + 0.8;
      kit.main.box(x0, st.y - 3.5, P.lat1, x1, top - 0.22 * (i + 1), P.lat0 - 0.4, alpine ? STONE : 0x9c8f80);
    }
  }
  // platform lamps + name boards + stop board
  const lampEvery = 12;
  for (let s = P.s0 + 4; s < P.s1 - 2; s += lampEvery) {
    const p = route.point(s), r = route.right(s);
    lampPost(kit, p.x + r.x * (P.lat1 + 0.9), p.z + r.z * (P.lat1 + 0.9), top, out.lamps, { color: alpine ? 0x2a3a30 : 0x2f5d3c });
  }
  for (const s of [P.s0 + 2, P.s1 - 2]) {
    const p = route.point(s), t = route.tangent(s), r = route.right(s);
    kit.set(p.x + r.x * (P.lat1 + 2.2), top, p.z + r.z * (P.lat1 + 2.2), Math.atan2(-t.z, t.x));
    for (const x of [-1.6, 1.6]) kit.main.box(x - 0.08, 0, -0.08, x + 0.08, 2.6, 0.08, IRON);
    // double-sided board
    const name = st.name.toUpperCase();
    signBoard(kit, name, 0, 1.7, 0.08, 0.1, alpine ? 0x26472f : 0x2b4a6b);
    kit.push().rotateY(Math.PI);
    signBoard(kit, name, 0, 1.7, 0.08, 0.1, alpine ? 0x26472f : 0x2b4a6b);
    kit.pop();
  }
  // STOP marker where the locomotive should halt
  {
    const s = st.stopS + 1.5;
    const p = route.point(s), t = route.tangent(s), r = route.right(s);
    kit.set(p.x + r.x * (P.lat0 - 0.9), top, p.z + r.z * (P.lat0 - 0.9), Math.atan2(-t.z, t.x) + Math.PI / 2);
    kit.main.box(-0.07, 0, -0.07, 0.07, 1.8, 0.07, IRON);
    kit.main.box(-0.55, 1.8, -0.06, 0.55, 2.5, 0.06, 0xc0392b);
    voxelText(kit, 'STOP', 0, 1.93, 0.06, 0.07, 0xffffff);
    kit.push().rotateY(Math.PI);
    voxelText(kit, 'STOP', 0, 1.93, 0.06, 0.07, 0xffffff);
    kit.pop();
  }
}

// ------------------------------------------------------------------ main --

export function buildSettlements(T, route) {
  const kit = new Kit();
  const out = { chimneys: [], lamps: [], mill: null };
  const group = new Group();
  group.name = 'settlements';

  for (const b of BUILDINGS) {
    if (b.kind === 'chalet' || b.kind === 'chapel') b.y = T.topAt(b.x, b.z);
    kit.set(b.x, b.y, b.z, b.yaw);
    let topY;
    if (b.kind === 'chalet') topY = chalet(kit, b, out);
    else if (b.kind === 'chapel') topY = chapel(kit, b, out);
    else if (b.kind === 'cottage') topY = cottage(kit, b, out);
    else if (b.kind === 'postoffice') topY = postOffice(kit, b, out);
    else if (b.kind === 'barn') topY = barn(kit, b, out);
    else if (b.kind === 'windmill') topY = windmill(kit, b, out);
    else if (b.kind === 'station_alpine') topY = station(kit, b, out, STATIONS[0], true);
    else if (b.kind === 'station_rural') topY = station(kit, b, out, STATIONS[1], false);
    // camera occupancy over the footprint
    const r = Math.hypot(b.w, b.d) / 2 + 1;
    const [ci, cj] = T.colOf(b.x, b.z);
    const rc = Math.ceil(r / V);
    for (let j = cj - rc; j <= cj + rc; j++) for (let i = ci - rc; i <= ci + rc; i++) {
      if (!T.inside(i, j)) continue;
      const k = j * NX + i;
      T.occ[k] = Math.max(T.occ[k], b.y + (topY ?? 6) + 1);
    }
  }
  platform(kit, route, STATIONS[0], true, out);
  platform(kit, route, STATIONS[1], false, out);

  // ---- village streets: lamps, benches, fences, people
  const yAt = (x, z) => T.topAt(x, z);
  const lampSpots = [
    [-206, -172], [-186, -188], [-236, -189], [-160, -190], [-216, -208], [-252, -166], [-150, -164],
    [-142, 216], [-126, 216], [-134, 230], [-150, 242], [-118, 240], [-100, 242], [-134, 252], [-166, 238],
  ];
  for (const [x, z] of lampSpots) lampPost(kit, x, z, yAt(x, z), out.lamps, { color: z < 0 ? 0x2a3a30 : 0x2f3a3a, h: 3.0 });
  bench(kit, -128, 222, yAt(-128, 222), Math.PI);
  bench(kit, -200, -186, yAt(-200, -186), 0);
  // garden fences in Meadowbrook
  fence(kit, [[-172, 220], [-176, 218], [-176, 212], [-160, 212], [-160, 218]], yAt);
  fence(kit, [[-100, 222], [-104, 220], [-104, 214], [-88, 214], [-88, 222]], yAt);
  fence(kit, [[-166, 258], [-166, 264], [-154, 264], [-154, 258]], yAt);
  fence(kit, [[-118, 264], [-118, 268], [-104, 268], [-104, 263]], yAt);
  fence(kit, [[-66, 228], [-50, 222], [-46, 232], [-50, 246], [-66, 248]], yAt, { color: 0x8a6a48, picket: false, gap: 2.2 });
  fence(kit, [[-90, 262], [-60, 262], [-52, 262]], yAt, { color: 0x8a6a48, picket: false, gap: 2.2 });
  // rustic snow fences at Frostpeak
  fence(kit, [[-262, -186], [-262, -205], [-252, -222]], yAt, { color: 0x6b4a33, picket: false, gap: 2.0 });
  fence(kit, [[-170, -210], [-150, -212], [-136, -206]], yAt, { color: 0x6b4a33, picket: false, gap: 2.0 });
  // vegetable rows in a couple of gardens
  for (let q = 0; q < 4; q++) for (let u = 0; u < 6; u++) {
    const x = -174 + u * 2.3, z = 214 + q * 1.3;
    kit.set(x, yAt(x, z), z, 0);
    kit.main.box(-0.4, 0, -0.3, 0.4, 0.45, 0.3, q % 2 ? 0x5f9a3c : 0x7cb046);
  }

  const P1 = STATIONS[0], P2 = STATIONS[1];
  const onPlat = (st, s, lat) => {
    const p = route.point(s), r = route.right(s);
    return [p.x + r.x * lat, p.z + r.z * lat, st.platform.top];
  };
  const faceTrack = (s) => { const t = route.tangent(s); return Math.atan2(-t.z, t.x) + Math.PI / 2; };
  // Frostpeak people (winter clothes)
  const winter = [
    { coat: 0xb33a3a, hat: 'beanie', hatColor: 0xf2f2f2, scarf: 0xf4e04d, long: true },
    { coat: 0x2f5d9c, hat: 'beanie', hatColor: 0xc0392b, scarf: 0xffffff },
    { coat: 0x4a6b3a, hat: 'cap', hatColor: 0x3a2a20, long: true, bag: 0x8a5a36 },
    { coat: 0x7a4a8a, hat: 'beanie', hatColor: 0xf4e04d, scale: 0.7, wave: true },
  ];
  [[P1.s0 + 22, -5.0], [P1.s0 + 24, -4.6], [P1.s0 + 40, -5.5], [P1.s0 + 41.2, -5.2]].forEach(([s, lat], i) => {
    const [x, z, y] = onPlat(P1, s, lat);
    person(kit, x, z, y, faceTrack(s) + (i % 2 ? 0.4 : -0.3), winter[i]);
  });
  person(kit, -204, -190, yAt(-204, -190), 0.6, { coat: 0x8a3a3a, hat: 'beanie', hatColor: 0x2f5d9c, scarf: 0xffffff, long: true });
  person(kit, -202, -190.8, yAt(-202, -190.8), -2.2, { coat: 0x3a5a7a, hat: 'beanie', hatColor: 0xc0392b, scale: 0.65 });
  // a snowman by the chapel
  kit.set(-158, yAt(-158, -186), -186, 0.5);
  kit.main.box(-0.7, 0, -0.7, 0.7, 1.2, 0.7, SNOW); kit.main.box(-0.5, 1.2, -0.5, 0.5, 2.0, 0.5, SNOW); kit.main.box(-0.35, 2.0, -0.35, 0.35, 2.6, 0.35, SNOW);
  kit.main.box(-0.06, 2.25, 0.35, 0.06, 2.35, 0.65, 0xf28a2a); kit.main.box(-0.38, 1.95, -0.38, 0.38, 2.08, 0.38, 0xc0392b);
  kit.main.box(-0.2, 2.6, -0.2, 0.2, 2.95, 0.2, 0x222222); kit.main.box(-0.3, 2.6, -0.3, 0.3, 2.65, 0.3, 0x222222);
  // Meadowbrook people
  const rural = [
    { coat: 0xd98c3a, hat: 'straw', pants: 0x3a4a6a },
    { coat: 0x5a8ac6, hair: 0x8a5a2a, pants: 0x4a3a2a, long: true },
    { coat: 0x3a3a3a, hat: 'top', long: true, bag: 0x6a4a2a },
    { coat: 0xe85d75, hair: 0xd9b26a, scale: 0.7, wave: true },
    { coat: 0x2f5d9c, hat: 'cap', hatColor: 0x2f5d9c, bag: 0x8a5a36 }, // postman
  ];
  [[P2.s0 + 20, -5.2], [P2.s0 + 21.4, -4.8], [P2.s0 + 36, -5.6], [P2.s0 + 37, -5.0]].forEach(([s, lat], i) => {
    const [x, z, y] = onPlat(P2, s, lat);
    person(kit, x, z, y, faceTrack(s) + (i % 2 ? 0.5 : -0.2), rural[i]);
  });
  person(kit, -112, 240.5, yAt(-112, 240.5), Math.PI + 0.4, rural[4]);
  person(kit, -121, 240, yAt(-121, 240), 0.3, { coat: 0x7a9a4a, hair: 0x3a2a1a, long: true });
  person(kit, -128, 222.6, yAt(-128, 222.6) + 0.0, Math.PI, { coat: 0xa04a6a, hair: 0x6a4a2a, sit: true });
  person(kit, -70, 268, yAt(-70, 268), 1.2, { coat: 0x6a8a3a, hat: 'straw', pants: 0x5a4a3a });
  person(kit, -190, 242, yAt(-190, 242), -1.0, { coat: 0xf4e04d, hair: 0x2a1a10, scale: 0.65 });
  person(kit, -188.6, 243.2, yAt(-188.6, 243.2), 2.0, { coat: 0x2f9c7a, hair: 0x8a5a2a, scale: 0.6, wave: true });
  person(kit, -150, 245, yAt(-150, 245), 2.6, { coat: 0x9b5a3a, hat: 'cap', hatColor: 0x4a3a2a });

  const addMesh = (bb, mat, cast = true) => {
    if (!bb.vertexCount) return;
    const mm = new Mesh(bb.geometry(), mat);
    mm.castShadow = cast;
    mm.receiveShadow = true;
    group.add(mm);
  };
  addMesh(kit.main, mainMat);
  addMesh(kit.win, houseWindowGlow, false);
  addMesh(kit.dark, darkWindow, false);
  addMesh(kit.lamp, streetLampGlow, false);

  // Windmill sails (animated)
  if (out.mill) {
    const sb = new BoxBuilder();
    sb.box(-0.25, -0.25, 0, 0.25, 0.25, 0.6, DARKWOOD);
    for (let a = 0; a < 4; a++) {
      sb.push().rotateZ((a * Math.PI) / 2);
      sb.box(0.2, -0.1, 0.2, 6.2, 0.1, 0.4, WOOD);
      sb.box(1.4, 0.1, 0.25, 6.0, 1.3, 0.32, 0xf3ecd8);
      for (let u = 1.4; u <= 6.0; u += 1.15) sb.box(u, 0.1, 0.22, u + 0.08, 1.35, 0.36, WOOD);
      sb.pop();
    }
    const sails = new Mesh(sb.geometry(), mainMat);
    sails.castShadow = true;
    sails.position.copy(out.mill.pos);
    sails.rotation.y = out.mill.yaw;
    sails.rotation.order = 'YXZ';
    group.add(sails);
    out.sails = sails;
  }

  // Warm light pools on the ground beneath lamps (night only).
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g2 = cv.getContext('2d');
  const grad = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,200,120,1)');
  grad.addColorStop(0.5, 'rgba(255,170,90,0.35)');
  grad.addColorStop(1, 'rgba(255,150,80,0)');
  g2.fillStyle = grad;
  g2.fillRect(0, 0, 64, 64);
  const poolMat = new MeshBasicMaterial({ map: new CanvasTexture(cv), transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0, color: 0xffffff });
  const pg = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const pools = new InstancedMesh(pg, poolMat, out.lamps.length);
  const pm = new Matrix4();
  out.lamps.forEach((l, i) => {
    const s = l.small ? 3.2 : 6.5;
    pm.makeScale(s, 1, s).setPosition(l.ground.x, l.ground.y + 0.04, l.ground.z);
    pools.setMatrixAt(i, pm);
  });
  pools.renderOrder = 3;
  group.add(pools);
  out.poolMat = poolMat;

  group.userData = out;
  return group;
}
