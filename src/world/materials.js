// Shared materials. The voxel material adds per-voxel colour jitter, soft
// voxel edge lines and rock strata in the fragment shader, so large merged
// faces still read as individual handcrafted voxels.
import { MeshLambertMaterial, MeshStandardMaterial, Color, Vector3 } from 'three';

export const shared = {
  uTime: { value: 0 },
  uNight: { value: 0 }, // 0 day .. 1 night (drives artificial light)
};

export function voxelMaterial({ cell = 2, edge = 0.1, jitter = 0.09, strata = 0.07, standard = false, local = false, brick = false, ...rest } = {}) {
  const Mat = standard ? MeshStandardMaterial : MeshLambertMaterial;
  const m = new Mat({ vertexColors: true, ...rest });
  m.onBeforeCompile = (sh) => {
    const c = Array.isArray(cell) ? cell : [cell, cell, cell];
    sh.uniforms.uCell = { value: new Vector3(c[0], c[1], c[2]) };
    sh.uniforms.uEdge = { value: edge };
    sh.uniforms.uJitter = { value: jitter };
    sh.uniforms.uStrata = { value: strata };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNor;
        ${local ? 'attribute vec4 vloc; varying vec4 vLoc;' : ''}`)
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        #ifdef USE_INSTANCING
          vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vWNor = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #else
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWNor = normalize(mat3(modelMatrix) * objectNormal);
        #endif
        ${local ? 'vLoc = vloc;' : ''}`
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNor;
        uniform vec3 uCell;
        uniform float uEdge, uJitter, uStrata;
        ${local ? 'varying vec4 vLoc;' : ''}
        float vhash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          ${local
            ? `vec3 an = vec3(vLoc.w < 0.5 ? 1.0 : 0.0, abs(vLoc.w - 1.0) < 0.5 ? 1.0 : 0.0, vLoc.w > 1.5 ? 1.0 : 0.0);
               vec3 wp = vLoc.xyz;`
            : `vec3 an = abs(vWNor);
               vec3 wp = vWPos - vWNor * 0.02;`}
          vec3 g = wp / uCell;
          ${local ? 'g *= 1.0 - an;' : ''}
          ${brick ? 'g.x += 0.5 * mod(floor(g.y), 2.0); g.z += 0.5 * mod(floor(g.y), 2.0);' : ''}
          vec3 cellId = floor(g);
          float h = vhash(cellId);
          diffuseColor.rgb *= 1.0 - uJitter * 0.5 + uJitter * h;
          vec3 f = fract(g);
          vec3 e = min(f, 1.0 - f);
          float ed = an.y > 0.6 ? min(e.x, e.z) : (an.x > 0.6 ? min(e.y, e.z) : min(e.x, e.y));
          float fw = fwidth(ed);
          float line = (1.0 - smoothstep(0.015, 0.015 + fw * 1.5, ed)) * (1.0 - smoothstep(0.04, 0.2, fw));
          diffuseColor.rgb *= 1.0 - uEdge * line;
          if (an.y < 0.6) {
            float band = vhash(vec3(0.0, cellId.y, 0.0));
            diffuseColor.rgb *= 1.0 - uStrata + uStrata * 1.6 * band;
          } else {
            // tops catch a touch more light at the voxel rim (bevel feel)
            diffuseColor.rgb *= 1.0 + 0.05 * (1.0 - smoothstep(0.0, 0.08 + fw, ed)) * (1.0 - smoothstep(0.04, 0.2, fw));
          }
        }`
      );
  };
  m.customProgramCacheKey = () => `voxel-${standard}-${cell}-${edge}-${jitter}-${strata}-${local}-${brick}`;
  return m;
}

// Glass that glows warmly at night (windows, lamps).
export function glowMaterial(dayHex, nightHex, strength = 1.0) {
  const m = new MeshLambertMaterial({ color: new Color(dayHex), emissive: new Color(nightHex), emissiveIntensity: 0 });
  m.userData.glow = { strength, day: new Color(dayHex), night: new Color(nightHex) };
  glowMaterials.push(m);
  return m;
}
export const glowMaterials = [];

export function updateGlow(night) {
  for (const m of glowMaterials) {
    const g = m.userData.glow;
    m.emissiveIntensity = night * g.strength * (m.userData.flicker ?? 1);
    m.color.copy(g.day).lerp(g.night, night * 0.5).multiplyScalar(1 - night * 0.6);
  }
}
