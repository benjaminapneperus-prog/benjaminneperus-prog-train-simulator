// Ambient life: drifting voxel clouds and small flocks of birds.
import { Group, Mesh, InstancedMesh, MeshLambertMaterial, Matrix4, Quaternion, Euler, Vector3, Color, BoxGeometry } from 'three';
import { BoxBuilder } from '../util/voxel.js';
import { mulberry32 } from '../util/noise.js';

export function buildAmbient() {
  const group = new Group();
  group.name = 'ambient';
  const rnd = mulberry32(99);

  // --- clouds
  const cloudMat = new MeshLambertMaterial({ vertexColors: true, emissive: new Color(0x8090b0), emissiveIntensity: 0.25, transparent: true, opacity: 0.94 });
  const clouds = [];
  for (let i = 0; i < 16; i++) {
    const bb = new BoxBuilder();
    const n = 3 + Math.floor(rnd() * 5);
    const S = 7 + rnd() * 6;
    for (let k = 0; k < n; k++) {
      const w = S * (1.4 + rnd() * 1.6), d = S * (1 + rnd() * 1.2), h = S * (0.5 + rnd() * 0.5);
      const x = (k - n / 2) * S * 0.9 + rnd() * S, z = (rnd() - 0.5) * S * 1.5, y = rnd() * S * 0.4;
      bb.box(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2, { top: 0xffffff, side: 0xe9eef6, bottom: 0xc9d2e2 });
      if (rnd() < 0.6) bb.box(x - w / 4, y + h, z - d / 4, x + w / 4, y + h + S * 0.4, z + d / 4, 0xffffff);
    }
    const m = new Mesh(bb.geometry(), cloudMat);
    m.position.set(-500 + rnd() * 1000, 165 + rnd() * 70, -420 + rnd() * 840);
    m.castShadow = true;
    m.userData.speed = 1.2 + rnd() * 1.4;
    group.add(m);
    clouds.push(m);
  }

  // --- birds
  const birdMat = new MeshLambertMaterial({ color: 0x3a3a44 });
  const body = new BoxGeometry(0.5, 0.22, 0.22);
  const wing = new BoxGeometry(0.28, 0.06, 0.8);
  wing.translate(0, 0, 0.4);
  const flocks = [
    { c: new Vector3(-150, 70, -250), r: 40, n: 6 }, { c: new Vector3(40, 50, 230), r: 55, n: 7 },
    { c: new Vector3(180, 95, -150), r: 35, n: 5 }, { c: new Vector3(-280, 40, 160), r: 45, n: 6 },
  ];
  const total = flocks.reduce((a, f) => a + f.n, 0);
  const bodies = new InstancedMesh(body, birdMat, total);
  const wl = new InstancedMesh(wing, birdMat, total), wr = new InstancedMesh(wing, birdMat, total);
  group.add(bodies, wl, wr);
  const birds = [];
  for (const f of flocks) for (let i = 0; i < f.n; i++) birds.push({ f, ph: rnd() * Math.PI * 2, off: new Vector3((rnd() - 0.5) * 8, (rnd() - 0.5) * 4, (rnd() - 0.5) * 8), sp: 0.25 + rnd() * 0.08, flap: rnd() * 10 });

  const m4 = new Matrix4(), q = new Quaternion(), e = new Euler(), p = new Vector3(), s = new Vector3(1, 1, 1), qw = new Quaternion(), m5 = new Matrix4();
  const tint = new Color();
  return {
    group,
    update(dt, camera, day) {
      for (const c of clouds) {
        c.position.x += c.userData.speed * dt;
        if (c.position.x > 560) c.position.x = -560;
      }
      // clouds take on the sky's mood
      tint.copy(day.skyUniforms.uZenith.value).lerp(new Color(1, 1, 1), 0.5);
      cloudMat.emissive.copy(tint).multiplyScalar(0.55);
      cloudMat.emissiveIntensity = 0.15 + day.night * 0.25;
      birds.forEach((b, i) => {
        b.ph += dt * b.sp;
        b.flap += dt * (9 + (i % 3));
        const f = b.f;
        p.set(f.c.x + Math.cos(b.ph) * f.r, f.c.y + Math.sin(b.ph * 2) * 3, f.c.z + Math.sin(b.ph) * f.r).add(b.off);
        e.set(0, -b.ph - Math.PI / 2, 0);
        q.setFromEuler(e);
        m4.compose(p, q, s);
        bodies.setMatrixAt(i, m4);
        const a = Math.sin(b.flap) * 0.7;
        for (const [mesh, sign] of [[wl, 1], [wr, -1]]) {
          qw.setFromEuler(e.set(sign * a, 0, 0));
          m5.compose(new Vector3(0, 0.05, 0), qw, new Vector3(1, 1, sign));
          mesh.setMatrixAt(i, m4.clone().multiply(m5));
        }
      });
      bodies.instanceMatrix.needsUpdate = wl.instanceMatrix.needsUpdate = wr.instanceMatrix.needsUpdate = true;
      const vis = day.night < 0.6;
      bodies.visible = wl.visible = wr.visible = vis;
    },
  };
}
