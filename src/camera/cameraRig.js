// Smooth third-person orbit camera around the moving train.
// Yaw is relative to the train's (smoothed) heading so the view gently
// swings through curves; the rig lifts itself over terrain and buildings
// instead of clipping through them.
import { Vector3, MathUtils } from 'three';

const TAU = Math.PI * 2;
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class CameraRig {
  constructor(camera, train, terrain, dom) {
    this.camera = camera;
    this.train = train;
    this.terrain = terrain;
    this.yaw = 0.62; // + = camera swings to the train's left
    this.yawTarget = this.yaw;
    this.pitch = 0.34;
    this.pitchTarget = this.pitch;
    this.dist = 27;
    this.distTarget = this.dist;
    this.minDist = 8;
    this.maxDist = 340; // far enough to take in the whole mountain and loop
    this.heading = null;
    this.focus = new Vector3();
    this.lift = 0;
    this.hold = { rot: 0, zoom: 0 };
    this._v = new Vector3();
    this._h = new Vector3();
    this._p = new Vector3();
    if (dom) this._bindPointer(dom);
  }

  rotate(dir) { this.yawTarget += dir * (Math.PI / 7); }
  zoom(dir) { this.distTarget = MathUtils.clamp(this.distTarget * (dir > 0 ? 0.78 : 1.28), this.minDist, this.maxDist); }
  setHold(kind, dir) { this.hold[kind] = dir; }

  _bindPointer(dom) {
    let drag = null;
    dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (e.defaultPrevented) return;
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      this.yawTarget -= dx * 0.006;
      this.pitchTarget = MathUtils.clamp(this.pitchTarget + dy * 0.004, 0.08, 1.15);
    });
    addEventListener('pointerup', () => (drag = null));
    addEventListener('pointercancel', () => (drag = null));
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.distTarget = MathUtils.clamp(this.distTarget * Math.exp(e.deltaY * 0.0012), this.minDist, this.maxDist);
    }, { passive: false });
  }

  snap() {
    this.heading = null;
    this.update(0, true);
  }

  update(dt, snap = false) {
    const train = this.train, T = this.terrain;
    if (this.hold.rot) this.yawTarget += this.hold.rot * dt * 1.4;
    if (this.hold.zoom) this.distTarget = MathUtils.clamp(this.distTarget * Math.exp(-this.hold.zoom * dt * 1.3), this.minDist, this.maxDist);

    const k = (rate) => (snap ? 1 : 1 - Math.exp(-rate * dt));
    this.yaw += (this.yawTarget - this.yaw) * k(5);
    this.pitch += (this.pitchTarget - this.pitch) * k(5);
    this.dist += (this.distTarget - this.dist) * k(5);

    // Smoothed heading of the locomotive (in x/z).
    const hv = train.heading(this._h);
    const h = Math.atan2(hv.z, hv.x);
    if (this.heading === null) this.heading = h;
    this.heading += wrapAngle(h - this.heading) * k(1.6);

    // Focus a little ahead of the loco, between engine and first coach when far.
    const loco = train.loco;
    const ahead = MathUtils.lerp(-2.5, 6, MathUtils.clamp((this.dist - 10) / 50, 0, 1));
    const fp = train.worldPoint(loco, [ahead, 1.8, 0], this._p);
    if (snap) this.focus.copy(fp);
    else this.focus.lerp(fp, k(8));

    // Camera position on the orbit sphere.
    const ang = this.heading + Math.PI + this.yaw; // behind the train, then yaw offset
    const pitch = this.pitch + MathUtils.clamp((14 - this.dist) * 0.02, 0, 0.18) + 0.32 * MathUtils.smoothstep(this.dist, 90, 300);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cam = this._v.set(
      this.focus.x + Math.cos(ang) * cp * this.dist,
      this.focus.y + sp * this.dist,
      this.focus.z + Math.sin(ang) * cp * this.dist
    );

    // Terrain / building avoidance: lift the camera so the line of sight
    // from focus to camera stays above the ground.
    let need = cam.y;
    const F = this.focus;
    for (let i = 3; i <= 12; i++) {
      const f = i / 12;
      const x = F.x + (cam.x - F.x) * f, z = F.z + (cam.z - F.z) * f;
      const g = T.surfaceAt(x, z) + (f > 0.95 ? 2.2 : 1.4);
      const req = F.y + (g - F.y) / f;
      if (req > need) need = req;
    }
    const lift = need - cam.y;
    this.lift += (lift - this.lift) * (snap ? 1 : lift > this.lift ? k(12) : k(2.5));
    cam.y += Math.max(0, this.lift);
    this.camera.position.copy(cam);
    this.camera.lookAt(F);
  }
}
