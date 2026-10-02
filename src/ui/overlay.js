// 3D voxel interface rendered in its own scene on top of the world:
//  - the regulator LEVER (bottom right) with notched quadrant + speed dial
//  - the CONSOLE (bottom left): draggable mini sun on a day/night arc,
//    compass, and chunky camera buttons
import {
  Scene, OrthographicCamera, Group, Mesh, DirectionalLight, AmbientLight, Raycaster, Vector2, Vector3,
  PlaneGeometry, MeshBasicMaterial, MeshLambertMaterial, Color, MathUtils,
} from 'three';
import { BoxBuilder } from '../util/voxel.js';
import { arcAngle, hoursFromArc } from '../lighting/daycycle.js';

const WOOD = 0x8a5a36, WOOD_D = 0x6b4329, WOOD_L = 0xa8744a, IRON = 0x3a3d40, IRON_L = 0x55595d;
const BRASS = 0xd6aa52, BRASS_D = 0xa8803a, CREAM = 0xf2e6c8, RED = 0xc0392b, INK = 0x4a2e1c;

const uiMat = new MeshLambertMaterial({ vertexColors: true, toneMapped: false });
const glowMat = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
const hitMat = new MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 });

function meshOf(bb, mat = uiMat) { return new Mesh(bb.geometry(), mat); }
function hitBox(w, h, d = 40) {
  const m = new Mesh(new PlaneGeometry(w, h), hitMat);
  m.position.z = d;
  return m;
}
// Framed panel plate: wood board in an iron frame with brass rivets.
function plate(bb, w, h, d = 14) {
  bb.box(-w / 2, -h / 2, -d, w / 2, h / 2, 0, IRON);
  bb.box(-w / 2 + 6, -h / 2 + 6, -d, w / 2 - 6, h / 2 - 6, 3, WOOD);
  for (let y = -h / 2 + 6; y < h / 2 - 6; y += 18) bb.box(-w / 2 + 6, y, 3, w / 2 - 6, y + 1.5, 3.5, WOOD_D);
  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    bb.box(x * (w / 2 - 12) - 4, y * (h / 2 - 12) - 4, 3, x * (w / 2 - 12) + 4, y * (h / 2 - 12) + 4, 7, BRASS);
  }
}

// Icons drawn with chunky pixels on the button face.
const ICONS = {
  rotL: ['..####..', '.#....#.', '#......#', '#.......', '#...#...', '.#..##..', '..#####.', '....##..'].reverse(),
  rotR: ['..####..', '.#....#.', '#......#', '.......#', '...#...#', '..##..#.', '.#####..', '..##....'].reverse(),
  zoomIn: ['...##...', '...##...', '...##...', '########', '########', '...##...', '...##...', '...##...'],
  zoomOut: ['........', '........', '........', '########', '########', '........', '........', '........'],
  lamp: ['..####..', '.#....#.', '#......#', '#......#', '.#....#.', '..####..', '...##...', '..####..'].reverse(),
  eye: ['........', '..####..', '.#....#.', '#..##..#', '#..##..#', '.#....#.', '..####..', '........'],
  whistle: ['...##...', '...##...', '..####..', '..#..#..', '..####..', '..#..#..', '..####..', '.######.'].reverse(),
  sound: ['...#.....', '..##..#..', '####...#.', '####.#.#.', '####.#.#.', '####...#.', '..##..#..', '...#.....'].reverse(),
  mute: ['...#.....', '..##.....', '####.#.#.', '####..#..', '####..#..', '####.#.#.', '..##.....', '...#.....'].reverse(),
};

function button(icon, size = 58, top = CREAM, side = WOOD) {
  const g = new Group();
  const base = new BoxBuilder();
  base.box(-size / 2 - 4, -size / 2 - 4, -10, size / 2 + 4, size / 2 + 4, 0, IRON);
  g.add(meshOf(base));
  const cap = new Group();
  const bb = new BoxBuilder();
  bb.box(-size / 2, -size / 2, 0, size / 2, size / 2, 16, { pz: top, px: side, nx: side, top: side, bottom: WOOD_D, nz: side });
  bb.box(-size / 2 + 3, size / 2 - 5, 16, size / 2 - 3, size / 2 - 2, 17, 0xffffff);
  const rows = ICONS[icon];
  const px = (size * 0.62) / rows[0].length;
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c !== '#') return;
    const X = -px * rows[0].length / 2 + x * px, Y = -px * rows.length / 2 + y * px;
    bb.box(X, Y, 16, X + px * 0.92, Y + px * 0.92, 21, INK);
  }));
  cap.add(meshOf(bb));
  g.add(cap);
  const hit = hitBox(size + 8, size + 8);
  g.add(hit);
  g.userData = { cap, hit, pressed: 0, hover: 0 };
  return g;
}

export class Overlay {
  constructor(renderer, { onLever, onTime, onWhistle, onNotch, onCab, onLamp }) {
    this.renderer = renderer;
    this.scene = new Scene();
    this.camera = new OrthographicCamera(0, 1, 1, 0, 1, 2000);
    this.camera.position.z = 800; // rays must start in front of every control
    this.cb = { onLever, onTime, onWhistle, onNotch, onCab, onLamp };
    const key = new DirectionalLight(0xffffff, 2.1);
    key.position.set(-0.5, 0.8, 1);
    this.scene.add(key, new AmbientLight(0xffffff, 1.05));
    this.ray = new Raycaster();
    this.ptr = new Vector2();
    this.lever = 0;
    this.leverVis = 0;
    this.speedFrac = 0;
    this.hours = 9;
    this.drag = null;
    this.muted = false;
    this._buildLever();
    this._buildConsole();
    this._bind(renderer.domElement);
    this.resize();
  }

  // ------------------------------------------------------------- lever --
  // Lever value: -0.5 (full reverse) .. 0 (STOP) .. 1 (FULL ahead).
  angOf(v) { return this.ang0 - v * this.angK; }

  _buildLever() {
    const g = (this.leverGroup = new Group());
    const W = 160, H = 270;
    const bb = new BoxBuilder();
    // plain panel: iron frame around a wooden board
    bb.box(-W / 2, -H / 2, -12, W / 2, H / 2, 0, IRON);
    bb.box(-W / 2 + 5, -H / 2 + 5, -12, W / 2 - 5, H / 2 - 5, 3, WOOD);
    this.pivot = new Vector3(44, -55, 0);
    this.armLen = 80;
    this.ang0 = MathUtils.degToRad(15);
    this.angK = MathUtils.degToRad(60);
    this.vMin = -0.5;
    const P = this.pivot;
    // the quadrant slot
    const aTop = this.angOf(this.vMin) + 0.06, aBot = this.angOf(1) - 0.06;
    for (let i = 0; i <= 22; i++) {
      const a = aBot + (i / 22) * (aTop - aBot);
      const x = P.x - Math.cos(a) * 70, y = P.y + Math.sin(a) * 70;
      bb.box(x - 6, y - 6, 3, x + 6, y + 6, 6, 0x2a2c2e);
    }
    // detent ticks: blue reverse, red stop, then forward
    this.notches = [-0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
    const cols = [0x4a7fc0, 0x6f9bd0, RED, 0xe08a3a, 0xf2c64b, 0x9ccf4a, 0x4caf50];
    this.notches.forEach((v, i) => {
      const a = this.angOf(v);
      const x = P.x - Math.cos(a) * 82, y = P.y + Math.sin(a) * 82;
      bb.box(x - 4, y - 4, 3, x + 4, y + 4, 9, cols[i]);
    });
    bb.box(P.x - 11, P.y - 11, 3, P.x + 11, P.y + 11, 14, IRON_L);
    g.add(meshOf(bb));

    // the arm: a plain bar with a round red knob
    const arm = (this.arm = new Group());
    arm.position.copy(P);
    const ab = new BoxBuilder();
    const L = this.armLen;
    ab.box(-L, -5, 12, 6, 5, 20, 0x9aa0a5);
    const k = -L - 12;
    ab.box(k - 11, -11, 8, k + 11, 11, 30, RED);
    ab.box(k - 14, -7, 11, k + 14, 7, 27, RED);
    ab.box(k - 7, -14, 11, k + 7, 14, 27, RED);
    ab.box(k - 6, 3, 30, k, 8, 32, 0xff9a8a);
    arm.add(meshOf(ab));
    const armHit = new Mesh(new PlaneGeometry(L + 40, 44), hitMat);
    armHit.position.set(-(L + 40) / 2 + 6, 0, 40);
    arm.add(armHit);
    g.add(arm);
    this.armHit = armHit;

    // small, simple speed dial
    const dial = new BoxBuilder();
    const D = new Vector3(48, 100, 0);
    this.dialCenter = D;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const x = D.x + Math.cos(a) * 22, y = D.y + Math.sin(a) * 22;
      dial.box(x - 4, y - 4, 3, x + 4, y + 4, 9, BRASS);
    }
    dial.box(D.x - 18, D.y - 13, 3, D.x + 18, D.y + 13, 8, CREAM);
    dial.box(D.x - 13, D.y - 18, 3, D.x + 13, D.y + 18, 8, CREAM);
    g.add(meshOf(dial));
    const needle = (this.needle = new Group());
    needle.position.set(D.x, D.y, 9);
    const nb = new BoxBuilder();
    nb.box(-1.5, -1.5, 0, 14, 1.5, 2, RED);
    nb.box(-3, -3, 0, 3, 3, 3, IRON);
    needle.add(meshOf(nb));
    g.add(needle);

    // three small buttons: whistle, headlamp, cab view
    this.whistleBtn = button('whistle', 28, 0xf6d98a, BRASS_D);
    this.lampBtn = button('lamp', 28);
    this.cabBtn = button('eye', 28);
    [this.whistleBtn, this.lampBtn, this.cabBtn].forEach((b, i) => {
      b.position.set(-56 + i * 34, 104, 4);
      g.add(b);
    });

    this.leverSize = { W, H };
    this.scene.add(g);
  }

  // ----------------------------------------------------------- console --
  _buildConsole() {
    const g = (this.consoleGroup = new Group());
    const W = 220, H = 220;
    const bb = new BoxBuilder();
    plate(bb, W, H);
    // the day dial: sky above the horizon, night ground below
    this.arcC = new Vector3(0, -2, 0);
    this.arcR = 76;
    const C = this.arcC;
    bb.box(-W / 2 + 12, C.y, 3, W / 2 - 12, H / 2 - 12, 4, 0x2a3a52);
    bb.box(-W / 2 + 12, -H / 2 + 12, 3, W / 2 - 12, C.y, 4, 0x1d2a22);
    for (let i = 0; i < 56; i++) {
      const a = (i / 56) * Math.PI * 2;
      const x = C.x + Math.cos(a) * this.arcR, y = C.y + Math.sin(a) * this.arcR;
      bb.box(x - 3, y - 3, 4, x + 3, y + 3, 8, Math.sin(a) > 0.01 ? 0xf6d98a : 0x6a7ab8);
    }
    // voxel hills along the horizon
    bb.box(-W / 2 + 12, C.y - 4, 4, W / 2 - 12, C.y + 2, 12, 0x4f8a33);
    const hills = [[-70, 12, 14], [-40, 22, 18], [0, 14, 16], [36, 24, 18], [72, 12, 14]];
    for (const [hx, hh, hw] of hills) {
      for (let s = 0; s < hh; s += 6) bb.box(hx - hw + s * 0.7, C.y + 2 + s, 6, hx + hw - s * 0.7, C.y + 8 + s, 12, s > hh - 8 ? 0xf2f6fa : 0x5f9a3c);
    }
    // E / W markers just under the horizon
    const mark = (x, letter) => {
      const rows = letter === 'E' ? ['###', '#..', '##.', '#..', '###'] : ['#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'];
      rows.forEach((r, y) => [...r].forEach((c, xx) => {
        if (c === '#') bb.box(x + xx * 3.4, C.y - 12 - y * 3.4, 12, x + xx * 3.4 + 3, C.y - 9 - y * 3.4, 15, CREAM);
      }));
    };
    mark(-W / 2 + 18, 'E');
    mark(W / 2 - 35, 'W');
    // time plaque in the night half of the dial
    this.plateY = C.y - 34;
    bb.box(-40, this.plateY - 13, 10, 40, this.plateY + 13, 16, IRON);
    bb.box(-36, this.plateY - 9, 16, 36, this.plateY + 9, 17, 0x1a1c1e);
    g.add(meshOf(bb));

    // mini sun (draggable) and moon
    const sun = (this.sun = new Group());
    const sb = new BoxBuilder();
    sb.box(-11, -11, 0, 11, 11, 16, 0xffd24a);
    sb.box(-8, -8, 16, 8, 8, 19, 0xfff1a0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = i % 2 ? 16 : 19;
      sb.box(Math.cos(a) * r - 3, Math.sin(a) * r - 3, 2, Math.cos(a) * r + 3, Math.sin(a) * r + 3, 11, 0xffb52e);
    }
    this.sunMesh = new Mesh(sb.geometry(), glowMat);
    sun.add(this.sunMesh);
    const mb = new BoxBuilder();
    mb.box(-11, -11, 0, 11, 11, 14, 0xe8ecf6);
    mb.box(-2, -8, 14, 11, 8, 17, 0x8a96b8);
    mb.box(-7, 3, 14, -2, 7, 16, 0xc9d0e2);
    this.moonMesh = new Mesh(mb.geometry(), glowMat);
    sun.add(this.moonMesh);
    const sh = hitBox(54, 54, 30);
    sun.add(sh);
    this.sunHit = sh;
    sun.position.z = 14;
    g.add(sun);
    const arcHit = new Mesh(new PlaneGeometry(W, H), hitMat);
    arcHit.position.set(0, 0, 20);
    g.add(arcHit);
    this.arcHit = arcHit;

    // compass (needle points to world north relative to the view)
    const comp = (this.compass = new Group());
    comp.position.set(W / 2 - 22, H / 2 - 22, 10);
    const cbb = new BoxBuilder();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      cbb.box(Math.cos(a) * 12 - 2.5, Math.sin(a) * 12 - 2.5, 0, Math.cos(a) * 12 + 2.5, Math.sin(a) * 12 + 2.5, 6, BRASS);
    }
    cbb.box(-9, -9, -2, 9, 9, 2, CREAM);
    g.add((this.compassRing = meshOf(cbb)));
    this.compassRing.position.copy(comp.position);
    const nbb = new BoxBuilder();
    nbb.box(-2, 0, 2, 2, 10, 6, RED);
    nbb.box(-2, -10, 2, 2, 0, 6, 0x2f3a4a);
    nbb.box(-2, -2, 6, 2, 2, 8, BRASS_D);
    comp.add(meshOf(nbb));
    g.add(comp);

    this.btns = {};
    this.consoleSize = { W, H };
    this.scene.add(g);
  }

  // ------------------------------------------------------------ layout --
  resize() {
    const w = innerWidth, h = innerHeight;
    this.W = w; this.H = h;
    this.camera.left = 0; this.camera.right = w; this.camera.top = h; this.camera.bottom = 0;
    this.camera.updateProjectionMatrix();
    // kept small and discreet so the landscape stays the focus
    const u = MathUtils.clamp(Math.min(w / 1150, h / 760), 0.5, 1.25) * 0.66;
    this.u = u;
    const m = 14;
    const L = this.leverGroup, Cg = this.consoleGroup;
    L.scale.setScalar(u);
    Cg.scale.setScalar(u);
    L.position.set(w - m - (this.leverSize.W / 2) * u - 6 * u, m + (this.leverSize.H / 2) * u + 4 * u, 0);
    Cg.position.set(m + (this.consoleSize.W / 2) * u + 6 * u, m + (this.consoleSize.H / 2) * u + 4 * u, 0);
    // a slight tilt gives the blocks visible depth
    L.rotation.set(-0.22, -0.26, 0);
    Cg.rotation.set(-0.22, 0.26, 0);
  }

  // Screen-space anchor points for HTML labels (CSS px from top-left).
  anchors() {
    const proj = (obj, v) => {
      const p = v.clone().applyMatrix4(obj.matrixWorld);
      return { x: p.x, y: this.H - p.y };
    };
    this.scene.updateMatrixWorld();
    const L = this.leverGroup, Cg = this.consoleGroup, P = this.pivot;
    const lab = (v) => {
      const a = this.angOf(v), r = 106;
      return proj(L, new Vector3(P.x - Math.cos(a) * r, P.y + Math.sin(a) * r, 14));
    };
    return {
      stop: lab(0), full: lab(1), rev: lab(-0.4),
      speed: proj(L, new Vector3(this.dialCenter.x - 6, this.dialCenter.y - 36, 14)),
      time: proj(Cg, new Vector3(0, this.plateY, 17)),
      u: this.u,
    };
  }

  // Screen positions of the interactive parts (used by automated tests).
  debugPoints() {
    this.scene.updateMatrixWorld();
    const sp = (obj, v = new Vector3()) => { const p = v.applyMatrix4(obj.matrixWorld); return { x: p.x, y: this.H - p.y }; };
    const knob = sp(this.arm, new Vector3(-this.armLen - 12, 0, 30));
    const out = { knob, sun: sp(this.sun, new Vector3(0, 0, 20)) };
    for (const [k, b] of Object.entries(this.btns)) out[k] = sp(b, new Vector3(0, 0, 20));
    out.whistle = sp(this.whistleBtn, new Vector3(0, 0, 20));
    out.cab = sp(this.cabBtn, new Vector3(0, 0, 20));
    out.lamp = sp(this.lampBtn, new Vector3(0, 0, 20));
    out.arc = (hours) => null;
    return out;
  }

  // ----------------------------------------------------------- input --
  _pick(e, objs) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ptr, this.camera);
    this.scene.updateMatrixWorld();
    return this.ray.intersectObjects(objs, false)[0] || null;
  }

  _localOn(e, group, z = 0) {
    // intersect pointer ray with the group's plane at local z
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ptr, this.camera);
    group.updateMatrixWorld();
    const inv = group.matrixWorld.clone().invert();
    const o = this.ray.ray.origin.clone().applyMatrix4(inv);
    const d = this.ray.ray.direction.clone().transformDirection(inv);
    const t = (z - o.z) / d.z;
    return o.addScaledVector(d, t);
  }

  _bind(dom) {
    const buttons = () => [
      this.whistleBtn.userData.hit, this.lampBtn.userData.hit, this.cabBtn.userData.hit,
    ];
    const plates = () => [this.leverGroup.children[0], this.consoleGroup.children[0]];
    const findBtn = (hit) => {
      if (this.whistleBtn.userData.hit === hit) return ['whistle', this.whistleBtn];
      if (this.cabBtn.userData.hit === hit) return ['cab', this.cabBtn];
      if (this.lampBtn.userData.hit === hit) return ['lamp', this.lampBtn];
      return null;
    };
    addEventListener('pointerdown', (e) => {
      if (e.target !== dom) return;
      const hit = this._pick(e, [this.armHit, this.sunHit, ...buttons(), this.arcHit, ...plates(), this.leverGroup.children[0]]);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      const o = hit.object;
      if (o === this.armHit || (o === this.leverGroup.children[0] && this._nearQuadrant(e))) {
        this.drag = { kind: 'lever', id: e.pointerId };
        this._dragLever(e);
      } else if (o === this.sunHit || o === this.arcHit) {
        this.drag = { kind: 'sun', id: e.pointerId };
        this._dragSun(e);
      } else {
        const fb = findBtn(o);
        if (fb) {
          const [k, b] = fb;
          b.userData.pressed = 1;
          this.drag = { kind: 'button', key: k, btn: b, id: e.pointerId, t0: performance.now() };
          if (k === 'whistle') this.cb.onWhistle(true);
          if (k === 'cab') this.cabOn = this.cb.onCab();
          if (k === 'lamp') this.lampOn = this.cb.onLamp();
        } else this.drag = { kind: 'plate', id: e.pointerId };
      }
    }, { capture: true });
    addEventListener('pointermove', (e) => {
      if (!this.drag) {
        const hit = this._pick(e, [this.armHit, this.sunHit, ...buttons()]);
        dom.style.cursor = hit ? 'grab' : '';
        return;
      }
      if (e.pointerId !== this.drag.id) return;
      if (this.drag.kind === 'lever') this._dragLever(e);
      if (this.drag.kind === 'sun') this._dragSun(e);
      dom.style.cursor = 'grabbing';
    });
    const up = (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      if (this.drag.kind === 'button') {
        const k = this.drag.key, b = this.drag.btn;
        b.userData.pressed = 0;
        if (k === 'whistle') this.cb.onWhistle(false);
      }
      this.drag = null;
      dom.style.cursor = '';
    };
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  }

  _nearQuadrant(e) {
    const p = this._localOn(e, this.leverGroup, 14);
    const d = Math.hypot(p.x - this.pivot.x, p.y - this.pivot.y);
    return d > 45 && d < 120 && p.x < this.pivot.x;
  }

  _dragLever(e) {
    const p = this._localOn(e, this.leverGroup, 14);
    const P = this.pivot;
    const a = Math.atan2(p.y - P.y, -(p.x - P.x));
    let v = MathUtils.clamp((this.ang0 - a) / this.angK, this.vMin, 1);
    for (const n of this.notches) if (Math.abs(v - n) < 0.035) v = n;
    this.setLever(v, true);
  }

  setLever(v, fromUser = false) {
    v = MathUtils.clamp(v, this.vMin, 1);
    const prev = this.lever;
    for (const n of this.notches) {
      if ((prev < n && v >= n) || (prev > n && v <= n)) this.cb.onNotch?.(n);
    }
    this.lever = v;
    if (fromUser) this.cb.onLever(v);
  }

  _dragSun(e) {
    const p = this._localOn(e, this.consoleGroup, 24);
    this.cb.onTime(hoursFromArc(Math.atan2(p.y - this.arcC.y, p.x - this.arcC.x)));
  }

  // -------------------------------------------------------------- frame --
  update(dt, { hours, speedFrac, cameraYaw, night }) {
    this.hours = hours;
    // lever arm eases toward the set value (feels mechanical)
    this.leverVis += (this.lever - this.leverVis) * (1 - Math.exp(-dt * 14));
    const a = this.angOf(this.leverVis);
    this.arm.rotation.z = -a;
    // needle
    this.speedFrac += (speedFrac - this.speedFrac) * (1 - Math.exp(-dt * 6));
    this.needle.rotation.z = MathUtils.degToRad(210 - Math.abs(this.speedFrac) * 240);
    // sun on its arc
    const th = arcAngle(hours);
    this.sun.position.set(this.arcC.x + Math.cos(th) * this.arcR, this.arcC.y + Math.sin(th) * this.arcR, 14);
    const up = MathUtils.smoothstep(Math.sin(th), -0.12, 0.08);
    this.sunMesh.scale.setScalar(Math.max(0.001, up));
    this.moonMesh.scale.setScalar(Math.max(0.001, 1 - up));
    const sc = this.drag?.kind === 'sun' ? 1.15 : 1;
    this.sun.scale.setScalar(sc + 0.04 * Math.sin(performance.now() * 0.004));
    // compass: north (-z) relative to the camera's view
    this.compass.rotation.z = cameraYaw;
    // buttons
    const btnList = [this.whistleBtn, this.lampBtn, this.cabBtn];
    this.cabBtn.userData.latched = this.cabOn;
    this.lampBtn.userData.latched = this.lampOn;
    for (const b of btnList) {
      const ud = b.userData;
      ud.depth = (ud.depth ?? 0) + ((ud.pressed ? -9 : ud.latched ? -6 : 0) - (ud.depth ?? 0)) * (1 - Math.exp(-dt * 30));
      ud.cap.position.z = ud.depth;
    }
  }

  render() {
    const r = this.renderer;
    const ac = r.autoClear;
    r.autoClear = false;
    r.clearDepth();
    const tm = r.toneMapping;
    r.render(this.scene, this.camera);
    r.toneMapping = tm;
    r.autoClear = ac;
  }
}
