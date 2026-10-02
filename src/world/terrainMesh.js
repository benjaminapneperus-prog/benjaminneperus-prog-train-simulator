// Chunked voxel terrain mesher.
// - only exposed faces are emitted (tops + sides facing lower neighbours)
// - flat runs of identical, un-occluded tops are greedy-merged into big quads
// - classic per-corner voxel ambient occlusion is baked into vertex colours
// - side faces are split into material bands (cap / soil / rock)
import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute, Mesh, Group, MeshStandardMaterial } from 'three';
import { shared } from './materials.js';
import { V, NX, NZ, WORLD, M, PALETTE, SIDE } from './terrain.js';
import { lin } from '../util/voxel.js';
import { voxelMaterial } from './materials.js';

const CH = 40; // columns per chunk side
const AO = [1, 0.84, 0.72, 0.62];

function sideBands(mat) {
  // returns [capColor, soilColor, deepColor, capDepth, soilDepth]
  switch (mat) {
    case M.SNOW: case M.SNOW_SHADE: case M.PATH_SNOW:
      return [SIDE.snowCap, SIDE.rockWarm, SIDE.rock, 1, 1];
    case M.SNOW_ROCK:
      return [SIDE.snowCap, SIDE.rock, SIDE.rock, 1, 0];
    case M.ROCK: return [SIDE.rock, SIDE.rock, SIDE.rockDark, 1, 2];
    case M.ROCK_DARK: return [SIDE.rockDark, SIDE.rockDark, SIDE.rock, 1, 2];
    case M.GRASS: case M.GRASS_DARK: case M.MEADOW: case M.GARDEN:
      return [SIDE.grassEdge, SIDE.soil, SIDE.rockWarm, 1, 2];
    case M.ALPINE_GRASS: return [0x7c8456, SIDE.soilDark, SIDE.rock, 1, 1];
    case M.SAND: case M.RIVERBED: return [SIDE.sand, SIDE.soil, SIDE.rockWarm, 1, 1];
    case M.ICE: return [SIDE.ice, SIDE.rock, SIDE.rock, 1, 1];
    case M.PATH: case M.FIELD: case M.PLAZA: return [SIDE.soil, SIDE.soilDark, SIDE.rockWarm, 1, 2];
    default: return [SIDE.soil, SIDE.soilDark, SIDE.rock, 1, 2];
  }
}

export function buildTerrainMesh(T) {
  const group = new Group();
  group.name = 'terrain';
  const mat = voxelMaterial({ cell: V, edge: 0.13, jitter: 0.1, strata: 0.08 });
  const H = (i, j) => (i < 0 || j < 0 || i >= NX || j >= NZ ? 0 : T.h[j * NX + i]);
  let totalQuads = 0;

  for (let cj = 0; cj < NZ; cj += CH) {
    for (let ci = 0; ci < NX; ci += CH) {
      const pos = [], nor = [], col = [], idx = [];
      const quad = (p, n, c) => {
        const b = pos.length / 3;
        for (let q = 0; q < 4; q++) {
          pos.push(p[q][0], p[q][1], p[q][2]);
          nor.push(n[0], n[1], n[2]);
          col.push(c[q][0], c[q][1], c[q][2]);
        }
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
        totalQuads++;
      };
      const w = Math.min(CH, NX - ci), d = Math.min(CH, NZ - cj);
      // ---- tops (greedy for un-occluded cells)
      const used = new Uint8Array(w * d);
      const aoOf = (i, j) => {
        const h = H(i, j);
        const res = [];
        // corners in order (x0,z1) (x1,z1) (x1,z0) (x0,z0) -> matching quad winding
        for (const [dx, dz] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
          const s1 = H(i + dx, j) > h ? 1 : 0, s2 = H(i, j + dz) > h ? 1 : 0, c = H(i + dx, j + dz) > h ? 1 : 0;
          res.push(s1 && s2 ? 3 : s1 + s2 + c);
        }
        return res;
      };
      for (let lj = 0; lj < d; lj++) {
        for (let li = 0; li < w; li++) {
          if (used[lj * w + li]) continue;
          const i = ci + li, j = cj + lj, k = j * NX + i;
          const h = T.h[k], m = T.mat[k];
          const ao = aoOf(i, j);
          const flat = ao[0] + ao[1] + ao[2] + ao[3] === 0;
          let ww = 1, dd = 1;
          if (flat) {
            const same = (a, b) => {
              if (a >= w || b >= d || used[b * w + a]) return false;
              const kk = (cj + b) * NX + ci + a;
              if (T.h[kk] !== h || T.mat[kk] !== m) return false;
              const q = aoOf(ci + a, cj + b);
              return q[0] + q[1] + q[2] + q[3] === 0;
            };
            while (same(li + ww, lj) && ww < 16) ww++;
            let ok = true;
            while (ok && dd < 16) {
              for (let a = li; a < li + ww; a++) if (!same(a, lj + dd)) { ok = false; break; }
              if (ok) dd++;
            }
          }
          for (let b = lj; b < lj + dd; b++) for (let a = li; a < li + ww; a++) used[b * w + a] = 1;
          const x0 = WORLD.x0 + i * V, z0 = WORLD.z0 + j * V, y = h * V;
          const x1 = x0 + ww * V, z1 = z0 + dd * V;
          const c = lin(PALETTE[m]);
          const cs = ao.map((a) => [c[0] * AO[a], c[1] * AO[a], c[2] * AO[a]]);
          quad([[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]], [0, 1, 0], cs);
        }
      }
      // ---- sides
      for (let lj = 0; lj < d; lj++) {
        for (let li = 0; li < w; li++) {
          const i = ci + li, j = cj + lj, k = j * NX + i;
          const h = T.h[k];
          const [cap, soil, deep, capD, soilD] = sideBands(T.mat[k]);
          const x0 = WORLD.x0 + i * V, z0 = WORLD.z0 + j * V, x1 = x0 + V, z1 = z0 + V;
          const dirs = [
            [1, 0, [1, 0, 0], (y0, y1) => [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]],
            [-1, 0, [-1, 0, 0], (y0, y1) => [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
            [0, 1, [0, 0, 1], (y0, y1) => [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
            [0, -1, [0, 0, -1], (y0, y1) => [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
          ];
          for (const [dx, dz, n, verts] of dirs) {
            const outside = i + dx < 0 || j + dz < 0 || i + dx >= NX || j + dz >= NZ;
            const hn = outside ? -4 : H(i + dx, j + dz);
            if (hn >= h) continue;
            const drop = h - hn;
            // Small steps keep the cap colour so snowfields and meadows read as
            // continuous masses; only real cliffs expose soil and rock.
            const snowy = cap === SIDE.snowCap;
            const cd = drop <= (snowy ? 3 : 2) ? drop : capD;
            const bands = [
              [h - cd, h, cap],
              [h - cd - soilD, h - cd, soil],
              [hn, h - cd - soilD, deep],
            ];
            for (const [b0, b1, hex] of bands) {
              const lo = Math.max(b0, hn), hi = Math.min(b1, h);
              if (hi <= lo) continue;
              const c = lin(hex);
              const bottomAO = lo === hn ? 0.8 : 1;
              const cb = [c[0] * bottomAO, c[1] * bottomAO, c[2] * bottomAO];
              quad(verts(lo * V, hi * V), n, [cb, cb, c, c]);
            }
          }
        }
      }
      if (!pos.length) continue;
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
      g.setAttribute('color', new Float32BufferAttribute(col, 3));
      g.setIndex(new Uint32BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      const mesh = new Mesh(g, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }
  group.userData.quads = totalQuads;
  return group;
}

// Water: flat surfaces per column plus little cascade faces where the river
// steps down a voxel — gives charming miniature waterfalls.
export function buildWaterMesh(T) {
  const pos = [], nor = [], col = [], idx = [];
  const deep = lin(0x2f7fae), foam = lin(0xd8eef5);
  const W = (i, j) => (i < 0 || j < 0 || i >= NX || j >= NZ ? -1 : T.water[j * NX + i]);
  const quad = (p, n, c) => {
    const b = pos.length / 3;
    for (let q = 0; q < 4; q++) { pos.push(...p[q]); nor.push(...n); col.push(...c[q]); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const w = W(i, j);
    if (w < 0) continue;
    const x0 = WORLD.x0 + i * V, z0 = WORLD.z0 + j * V, x1 = x0 + V, z1 = z0 + V;
    quad([[x0, w, z1], [x1, w, z1], [x1, w, z0], [x0, w, z0]], [0, 1, 0], [deep, deep, deep, deep]);
    const sides = [
      [1, 0, [1, 0, 0], (a, b) => [[x1, a, z1], [x1, a, z0], [x1, b, z0], [x1, b, z1]]],
      [-1, 0, [-1, 0, 0], (a, b) => [[x0, a, z0], [x0, a, z1], [x0, b, z1], [x0, b, z0]]],
      [0, 1, [0, 0, 1], (a, b) => [[x0, a, z1], [x1, a, z1], [x1, b, z1], [x0, b, z1]]],
      [0, -1, [0, 0, -1], (a, b) => [[x1, a, z0], [x0, a, z0], [x0, b, z0], [x1, b, z0]]],
    ];
    for (const [dx, dz, n, f] of sides) {
      const wn = W(i + dx, j + dz);
      if (wn >= 0 && wn < w - 0.1) quad(f(wn, w), n, [foam, foam, deep, deep]);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setIndex(new Uint32BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  const mat = new MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.84, roughness: 0.12, metalness: 0.05 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nuniform float uTime;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float rip = sin(vWP.x * 1.3 + uTime * 1.7) * 0.5 + sin(vWP.z * 1.7 - uTime * 1.3 + vWP.x * 0.4) * 0.5;
        normal = normalize(normal + vec3(rip * 0.06, 0.0, cos(vWP.x * 0.9 - uTime) * 0.06));`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sp = fract(sin(dot(floor(vWP.xz * 1.2 + vec2(uTime * 0.6, uTime * 0.2)), vec2(12.9, 78.2))) * 43758.5);
        diffuseColor.rgb += step(0.985, sp) * 0.25;`);
  };
  const mesh = new Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  return mesh;
}

// Low plains beyond the edge of the diorama, so wide views fade into haze
// instead of ending in a void. Sits just below every terrain column.
export function buildOuterLand() {
  const S = 5200, seg = 80;
  const pos = [], nor = [], col = [], idx = [];
  const snow = lin(0xe6ecf3), grass = lin(0x6a9440), forest = lin(0x4f7a34);
  for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) {
    const x = -S / 2 + (i / seg) * S, z = -S / 2 + (j / seg) * S;
    pos.push(x, 1.4, z);
    nor.push(0, 1, 0);
    const t = Math.min(1, Math.max(0, (z + 120) / 220)); // 0 north .. 1 south
    const f = (Math.sin(x * 0.004) * Math.cos(z * 0.005) + 1) / 2;
    const g = [grass[0] + (forest[0] - grass[0]) * f, grass[1] + (forest[1] - grass[1]) * f, grass[2] + (forest[2] - grass[2]) * f];
    col.push(snow[0] + (g[0] - snow[0]) * t, snow[1] + (g[1] - snow[1]) * t, snow[2] + (g[2] - snow[2]) * t);
  }
  for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setIndex(new Uint32BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  const mesh = new Mesh(g, voxelMaterial({ cell: 8, edge: 0, jitter: 0.08, strata: 0 }));
  mesh.receiveShadow = true;
  mesh.name = 'outer-land';
  return mesh;
}
