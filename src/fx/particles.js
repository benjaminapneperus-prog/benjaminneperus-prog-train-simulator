// Soft billboard particles for steam & smoke, plus falling snow.
import {
  BufferGeometry, BufferAttribute, Points, ShaderMaterial, Color, Vector3, UniformsLib, UniformsUtils, NormalBlending,
} from 'three';

const VS = `
attribute float aSize;
attribute float aAlpha;
attribute float aShade;
attribute float aSeed;
varying float vAlpha;
varying float vShade;
varying float vSeed;
uniform float uScale;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.5, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  vAlpha = aAlpha; vShade = aShade; vSeed = aSeed;
  #include <fog_vertex>
}`;
const FS = `
varying float vAlpha;
varying float vShade;
varying float vSeed;
uniform vec3 uLit;
uniform vec3 uShadow;
#include <fog_pars_fragment>
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  // lumpy cloud edge
  float a = atan(p.y, p.x);
  float edge = 0.42 + 0.06 * sin(a * 3.0 + vSeed * 6.28) + 0.04 * sin(a * 5.0 - vSeed * 3.1);
  float m = smoothstep(edge, edge - 0.22, d);
  if (m * vAlpha < 0.01) discard;
  // light from the top-left, shade toward bottom-right
  float l = clamp(0.65 - p.y * 0.9 - p.x * 0.3, 0.0, 1.0);
  vec3 col = mix(uShadow, uLit, l) * vShade;
  gl_FragColor = vec4(col, m * vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class ParticleSystem {
  constructor(capacity = 900) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.s0 = new Float32Array(capacity);
    this.s1 = new Float32Array(capacity);
    this.peak = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.shade = new Float32Array(capacity);
    this.seed = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) this.seed[i] = Math.random();
    const g = (this.geo = new BufferGeometry());
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('aSize', new BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1));
    g.setAttribute('aShade', new BufferAttribute(this.shade, 1));
    g.setAttribute('aSeed', new BufferAttribute(this.seed, 1));
    this.uniforms = UniformsUtils.merge([UniformsLib.fog, {
      uScale: { value: 600 }, uLit: { value: new Color(1, 1, 1) }, uShadow: { value: new Color(0.6, 0.65, 0.75) },
    }]);
    this.mat = new ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, fog: true, blending: NormalBlending,
    });
    this.points = new Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.next = 0;
  }

  emit(p, v, { life = 3, s0 = 1, s1 = 5, alpha = 0.7, shade = 1, drag = 0.6 } = {}) {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.life[i] = life; this.maxLife[i] = life;
    this.s0[i] = s0; this.s1[i] = s1; this.peak[i] = alpha; this.shade[i] = shade; this.drag[i] = drag;
  }

  update(dt, wind) {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const k = Math.exp(-this.drag[i] * dt);
      const j = i * 3;
      this.vel[j] = this.vel[j] * k + wind.x * dt * 0.6;
      this.vel[j + 1] = this.vel[j + 1] * k + 0.25 * dt;
      this.vel[j + 2] = this.vel[j + 2] * k + wind.z * dt * 0.6;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(t);
      this.alpha[i] = this.peak[i] * Math.min(1, t * 8) * (1 - t) * (1 - t);
    }
    const g = this.geo;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    g.attributes.aShade.needsUpdate = true;
  }

  setLight(lit, shadow) {
    this.uniforms.uLit.value.copy(lit);
    this.uniforms.uShadow.value.copy(shadow);
  }
}

const SNOW_VS = `
attribute float aSeed;
uniform float uTime;
uniform vec3 uCenter;
uniform float uScale;
varying float vA;
#include <fog_pars_vertex>
void main() {
  vec3 box = vec3(90.0, 50.0, 90.0);
  vec3 p = position;
  p.y -= uTime * (1.4 + aSeed * 1.2);
  p.x += sin(uTime * 0.7 + aSeed * 40.0) * 1.2;
  p.z += cos(uTime * 0.5 + aSeed * 23.0) * 1.2;
  p = mod(p - uCenter + box * 0.5, box) - box * 0.5 + uCenter;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = min(7.0, (0.18 + aSeed * 0.2) * uScale / max(0.5, -mvPosition.z));
  gl_Position = projectionMatrix * mvPosition;
  vA = smoothstep(80.0, 20.0, -mvPosition.z) * smoothstep(2.0, 7.0, -mvPosition.z);
  #include <fog_vertex>
}`;
const SNOW_FS = `
uniform float uAmount;
uniform vec3 uColor;
varying float vA;
#include <fog_pars_fragment>
void main() {
  vec2 p = abs(gl_PointCoord - 0.5);
  if (max(p.x, p.y) > 0.42) discard;
  gl_FragColor = vec4(uColor, uAmount * vA * 0.9);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class Snowfall {
  constructor(count = 2600) {
    const pos = new Float32Array(count * 3), seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random() * 90; pos[i * 3 + 1] = Math.random() * 50; pos[i * 3 + 2] = Math.random() * 90;
      seed[i] = Math.random();
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new BufferAttribute(seed, 1));
    this.uniforms = UniformsUtils.merge([UniformsLib.fog, {
      uTime: { value: 0 }, uCenter: { value: new Vector3() }, uScale: { value: 600 }, uAmount: { value: 0 }, uColor: { value: new Color(1, 1, 1) },
    }]);
    this.points = new Points(g, new ShaderMaterial({ uniforms: this.uniforms, vertexShader: SNOW_VS, fragmentShader: SNOW_FS, transparent: true, depthWrite: false, fog: true }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }
  update(dt, center, amount, color) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uCenter.value.copy(center);
    this.uniforms.uAmount.value += (amount - this.uniforms.uAmount.value) * Math.min(1, dt * 0.8);
    this.uniforms.uColor.value.copy(color);
    this.points.visible = this.uniforms.uAmount.value > 0.01;
  }
}
