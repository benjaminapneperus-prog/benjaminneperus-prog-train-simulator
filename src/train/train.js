// The train: one locomotive, its tender and two coaches, all riding the
// same spline. Each vehicle is placed on the chord between its two pivot
// points (bogies / axles), so the consist bends naturally through curves.
import { Group, Vector3, Matrix4, SpotLight, Object3D, PointLight } from 'three';
import { buildLocomotive, buildTender, buildCoach, updateRods } from './models.js';

export const VMAX = 15; // world units per second at full regulator
export const KMH = 3.6 * 1.25; // display scale (units/s -> "km/h")

const UP = new Vector3(0, 1, 0);

export class Train {
  constructor(route) {
    this.route = route;
    this.group = new Group();
    this.group.name = 'train';
    this.loco = buildLocomotive();
    this.tender = buildTender();
    this.coaches = [buildCoach(0), buildCoach(0)];
    this.vehicles = [this.loco, this.tender, ...this.coaches];
    for (const v of this.vehicles) {
      v.matrixAutoUpdate = false;
      this.group.add(v);
    }
    // Offsets of each vehicle's origin behind the loco origin (couplers touching).
    this.offsets = [0];
    for (let i = 1; i < this.vehicles.length; i++) {
      const prev = this.vehicles[i - 1].userData, cur = this.vehicles[i].userData;
      this.offsets.push(this.offsets[i - 1] - (-prev.rear + cur.front + 0.18));
    }
    this.length = -this.offsets[this.offsets.length - 1] + this.loco.userData.front - this.vehicles.at(-1).userData.rear;

    // headlamp
    const lamp = new SpotLight(0xffd9a0, 0, 70, 0.42, 0.55, 1.2);
    const [lx, ly, lz] = this.loco.userData.lamp;
    lamp.position.set(lx, ly, lz);
    const tgt = new Object3D();
    tgt.position.set(lx + 20, ly - 3.5, lz);
    this.loco.add(lamp, tgt);
    lamp.target = tgt;
    this.headlamp = lamp;
    // warm firebox glow
    this.fireLight = new PointLight(0xff8a3a, 0, 6, 1.6);
    this.fireLight.position.set(-1.6, 1.9, 0);
    this.loco.add(this.fireLight);

    this.s = 0; // arc position of the loco origin
    this.v = 0;
    this.acc = 0;
    this.lever = 0; // -0.5 = full reverse (lever right up) .. 0 = STOP .. 1 = FULL (lever down)
    this.lampOn = false;
    this.braking = false;
    this.leverSmoothed = 0;
    this.theta = 0; // driver crank angle
    this.distance = 0;
    this._m = new Matrix4();
    this._a = new Vector3(); this._b = new Vector3(); this._c = new Vector3();
    this._t = new Vector3(); this._r = new Vector3(); this._u = new Vector3();
    this._f = { p: new Vector3(), t: new Vector3(), r: new Vector3(), u: new Vector3() };
    this.place();
  }

  get speed() { return this.v; }
  // Reverse is gentler: the lever's two reverse notches give up to 80% of VMAX backwards.
  get targetSpeed() { return this.lever >= 0 ? this.lever * VMAX : this.lever * VMAX * 0.8; }

  update(dt) {
    const route = this.route;
    // Gradient resistance (weighty but gentle).
    const grade = (route.height(this.s + 3) - route.height(this.s - 3)) / 6;
    const target = this.targetSpeed;
    const v = this.v;
    const diff = target - v;
    let a;
    this.braking = false;
    if (Math.abs(diff) < 0.05) a = diff * 2;
    else if (v !== 0 && (Math.sign(v) !== Math.sign(target) || Math.abs(v) > Math.abs(target))) {
      // brakes: firmer when the lever is at STOP, soft at the very end
      let b = target === 0 ? 2.1 : 1.5;
      if (target === 0 && Math.abs(v) < 1.2) b = 1.4;
      a = -Math.sign(v) * b;
      this.braking = true;
    } else {
      // steam builds up: stronger pull at low speed (either direction)
      a = Math.sign(diff) * 1.25 * (1 - (Math.abs(v) / VMAX) * 0.55);
    }
    a -= grade * 2.4;
    // smooth jerk
    this.acc += (a - this.acc) * Math.min(1, dt * 2.6);
    const prev = this.v;
    this.v = Math.max(-VMAX * 1.08, Math.min(VMAX * 1.08, this.v + this.acc * dt));
    // brakes bring the train to rest; they never push it the other way
    if (this.braking && prev !== 0 && Math.sign(this.v) !== Math.sign(prev)) { this.v = 0; this.acc = 0; }
    // parking brake at STOP
    if (target === 0 && Math.abs(this.v) < 0.3) { this.v = 0; this.acc = 0; }
    const ds = this.v * dt;
    this.s = route.wrap(this.s + ds);
    this.distance += ds;
    this.theta -= ds / 0.62;
    this.place();
    // animate wheels
    for (const veh of this.vehicles) {
      for (const w of veh.userData.wheels) {
        const r = w.userData.r;
        const ang = (this.theta * 0.62) / r;
        w.rotation.z = w.userData.side > 0 ? ang : Math.PI / 2 - ang;
      }
    }
    updateRods(this.loco, this.theta);
  }

  // Position every vehicle along the spline.
  place() {
    const route = this.route;
    for (let i = 0; i < this.vehicles.length; i++) {
      const veh = this.vehicles[i];
      const s = this.s + this.offsets[i];
      const [pf, pr] = veh.userData.pivots;
      const A = route.point(s + pf, this._a);
      const B = route.point(s + pr, this._b);
      const t = this._t.subVectors(A, B);
      const len = t.length();
      t.divideScalar(len);
      // origin lies on the chord, (−pr) from the rear pivot
      const P = this._c.copy(B).addScaledVector(t, -pr * (len / (pf - pr)));
      route.frame(s, this._f);
      const r = this._r.crossVectors(t, this._f.u).normalize();
      const u = this._u.crossVectors(r, t).normalize();
      this._m.makeBasis(t, u, r).setPosition(P);
      veh.matrix.copy(this._m);
      veh.matrixWorldNeedsUpdate = true;
    }
  }

  // World-space helper points.
  worldPoint(veh, local, out = new Vector3()) {
    return out.set(local[0], local[1], local[2]).applyMatrix4(veh.matrix);
  }

  heading(out = new Vector3()) {
    return out.set(1, 0, 0).transformDirection(this.loco.matrix);
  }
}
