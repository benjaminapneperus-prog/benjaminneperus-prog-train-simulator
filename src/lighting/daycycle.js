// Time of day: ONE state (hours) from which everything is interpolated —
// sun & moon direction, shadow frustum, light colours and intensities, sky,
// fog, ambient light, exposure and the glow of artificial lights.
import {
  Color, Vector3, DirectionalLight, HemisphereLight, Mesh, SphereGeometry, ShaderMaterial, BackSide, Fog,
  MathUtils, AmbientLight,
} from 'three';
import { smoothstep, clamp } from '../util/noise.js';

export const T_MIN = 4.5, T_MAX = 23.5;
const SUNRISE = 5.75, SUNSET = 19.25;
const TILT = MathUtils.degToRad(26); // sun arc leans south (+z)

// Keyframes against sun elevation (radians). Evening keys warmer than morning.
const key = (arr) => arr.map(([e, hex]) => [e, new Color(hex)]);
const SUN_COL = key([[-0.1, 0xff4a20], [0.0, 0xff5a28], [0.07, 0xff8a40], [0.18, 0xffb466], [0.32, 0xffd59e], [0.55, 0xfff0dc], [1.3, 0xfff8f0]]);
const SUN_COL_MORNING = key([[-0.1, 0xff7a5a], [0.0, 0xff8a60], [0.06, 0xffa070], [0.16, 0xffcf98], [0.32, 0xffead0], [0.6, 0xfff5ea], [1.3, 0xfff8f0]]);
const ZENITH = key([[-0.4, 0x060b1e], [-0.18, 0x0d1736], [-0.06, 0x1f2c5e], [0.02, 0x3a5596], [0.14, 0x4a7cc6], [0.4, 0x3f7fd4], [1.3, 0x3a7ad2]]);
const HORIZON = key([[-0.4, 0x0e1630], [-0.18, 0x1c2547], [-0.07, 0x5a4a74], [0.0, 0xf08a5c], [0.05, 0xf6a676], [0.14, 0xf2d2b0], [0.3, 0xc6def0], [1.3, 0xb8d8f2]]);
const HORIZON_MORNING = key([[-0.4, 0x0e1630], [-0.18, 0x1c2547], [-0.07, 0x6a5a86], [0.0, 0xf3a08a], [0.05, 0xf6b898], [0.14, 0xeed8c2], [0.3, 0xc8e0f2], [1.3, 0xb8d8f2]]);
const HEMI_SKY = key([[-0.4, 0x4a64b0], [-0.12, 0x4a5c9c], [0.0, 0x8a7fae], [0.1, 0xb3b5d4], [0.3, 0xc4daf6], [1.3, 0xcfe2ff]]);
const HEMI_GND = key([[-0.4, 0x22263a], [0.0, 0x4a3a34], [0.2, 0x7a6a56], [1.3, 0x8a7a62]]);

function sample(keys, e, out) {
  if (e <= keys[0][0]) return out.copy(keys[0][1]);
  for (let i = 0; i < keys.length - 1; i++) {
    const [e0, c0] = keys[i], [e1, c1] = keys[i + 1];
    if (e <= e1) return out.copy(c0).lerp(c1, smoothstep(e0, e1, e));
  }
  return out.copy(keys[keys.length - 1][1]);
}
function sampleNum(keys, e) {
  if (e <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [e0, v0] = keys[i], [e1, v1] = keys[i + 1];
    if (e <= e1) return v0 + (v1 - v0) * smoothstep(e0, e1, e);
  }
  return keys[keys.length - 1][1];
}

// Arc angle used both by the 3D sun and by the UI mini-sun.
export function arcAngle(hours) {
  return Math.PI * (1 - (hours - SUNRISE) / (SUNSET - SUNRISE));
}
export function hoursFromArc(theta) {
  return SUNRISE + (1 - theta / Math.PI) * (SUNSET - SUNRISE);
}

export function sunDirection(hours, out = new Vector3()) {
  const th = arcAngle(hours);
  // east = +x at sunrise, south-leaning arc, west = -x at sunset
  return out.set(Math.cos(th), Math.sin(th) * Math.cos(TILT), Math.sin(th) * Math.sin(TILT)).normalize();
}

export function formatTime(hours) {
  let h = Math.floor(hours), m = Math.floor((hours - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const SKY_VS = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
}`;
const SKY_FS = `
uniform vec3 uZenith, uHorizon, uSunCol, uSunDir, uMoonDir, uGround;
uniform float uSunVis, uMoonVis, uStars, uTime;
varying vec3 vDir;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
// square "voxel" disc around a direction
float squareDisc(vec3 d, vec3 c, float size, out vec2 uv) {
  vec3 up = abs(c.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 r = normalize(cross(up, c));
  vec3 u = cross(c, r);
  float fd = dot(d, c);
  if (fd <= 0.0) { uv = vec2(9.0); return 0.0; }
  vec3 p = d / fd;
  uv = vec2(dot(p, r), dot(p, u)) / size;
  return step(max(abs(uv.x), abs(uv.y)), 1.0);
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float t = pow(smoothstep(-0.02, 0.55, h), 0.55);
  vec3 col = mix(uHorizon, uZenith, t);
  // warm glow around the sun near the horizon
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunCol * (pow(sd, 6.0) * 0.32 + pow(sd, 48.0) * 0.45) * uSunVis;
  // below the horizon fade to a hazy ground tone
  col = mix(col, uGround, smoothstep(0.0, -0.25, h));
  // stars (square pixels), twinkling
  if (uStars > 0.0 && h > 0.0) {
    vec3 g = floor(d * 260.0);
    float s = hash(g);
    float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 60.0);
    col += vec3(0.85, 0.9, 1.0) * step(0.9965, s) * uStars * tw * smoothstep(0.0, 0.25, h);
  }
  // voxel sun
  vec2 uv;
  float sun = squareDisc(d, uSunDir, 0.035, uv);
  float rim = step(0.72, max(abs(uv.x), abs(uv.y)));
  col = mix(col, uSunCol * mix(5.0, 3.2, rim), sun * uSunVis);
  // voxel moon with crescent shading
  vec2 mv;
  float moon = squareDisc(d, uMoonDir, 0.028, mv);
  float shade = step(0.25, mv.x) * step(-0.75, mv.y) * step(mv.y, 0.75);
  vec3 mc = mix(vec3(1.0, 0.98, 0.9) * 2.2, vec3(0.32, 0.36, 0.5), shade * 0.8);
  col = mix(col, mc, moon * uMoonVis);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class DayCycle {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.hours = 9.0;
    this.sunDir = new Vector3();
    this.moonDir = new Vector3();
    this.lightDir = new Vector3();
    this.night = 0;

    this.light = new DirectionalLight(0xffffff, 2);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(4096, 4096);
    this.light.shadow.bias = -0.00025;
    this.light.shadow.normalBias = 0.35;
    this.light.shadow.radius = 2;
    scene.add(this.light, this.light.target);
    this.hemi = new HemisphereLight(0xcfe2ff, 0x8a7a62, 1.2);
    scene.add(this.hemi);
    this.ambient = new AmbientLight(0x6070a0, 0);
    scene.add(this.ambient);

    this.skyUniforms = {
      uZenith: { value: new Color() }, uHorizon: { value: new Color() }, uSunCol: { value: new Color() },
      uSunDir: { value: new Vector3() }, uMoonDir: { value: new Vector3() }, uGround: { value: new Color() },
      uSunVis: { value: 1 }, uMoonVis: { value: 0 }, uStars: { value: 0 }, uTime: { value: 0 },
    };
    this.sky = new Mesh(
      new SphereGeometry(1500, 48, 24),
      new ShaderMaterial({ uniforms: this.skyUniforms, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: BackSide, depthWrite: false, fog: false })
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);
    scene.fog = new Fog(0xb8d8f2, 180, 950);

    this._c = new Color();
    this._c2 = new Color();
    this.shadowRadius = 170;
  }

  setHours(h) { this.hours = clamp(h, T_MIN, T_MAX); }

  update(dt, camera, focus) {
    const h = this.hours;
    const sun = sunDirection(h, this.sunDir);
    const e = Math.asin(sun.y);
    const morning = h < 12.5 ? 1 : 0;
    const mBlend = smoothstep(13.5, 11, h); // 1 in the morning
    // moon: roughly opposite, riding high in the south-east at night
    const th = arcAngle(h) + Math.PI * 0.92;
    this.moonDir.set(Math.cos(th), Math.abs(Math.sin(th)) * 0.85 + 0.25, 0.45).normalize();

    const sunW = smoothstep(-0.07, 0.05, e);
    const moonW = smoothstep(0.0, -0.16, e);
    this.night = smoothstep(0.1, -0.1, e);

    // --- key light (sun by day, moon by night)
    const useSun = sunW >= moonW;
    this.lightDir.copy(useSun ? sun : this.moonDir);
    sample(SUN_COL, e, this._c);
    sample(SUN_COL_MORNING, e, this._c2);
    this._c.lerp(this._c2, mBlend);
    const sunI = sampleNum([[-0.07, 0], [0.0, 0.5], [0.06, 1.5], [0.2, 2.4], [0.5, 2.9], [1.3, 3.0]], e);
    if (useSun) {
      this.light.color.copy(this._c);
      this.light.intensity = sunI * sunW;
    } else {
      this.light.color.setHex(0x9fb4ff);
      this.light.intensity = 0.95 * moonW;
    }

    // --- ambient
    sample(HEMI_SKY, e, this.hemi.color);
    sample(HEMI_GND, e, this.hemi.groundColor);
    this.hemi.intensity = sampleNum([[-0.4, 1.05], [-0.1, 0.95], [0.0, 0.9], [0.15, 1.15], [0.5, 1.35], [1.3, 1.4]], e);

    // --- sky & fog
    const U = this.skyUniforms;
    sample(ZENITH, e, U.uZenith.value);
    sample(HORIZON, e, this._c2);
    sample(HORIZON_MORNING, e, U.uHorizon.value);
    U.uHorizon.value.lerp(this._c2, 1 - mBlend);
    U.uSunCol.value.copy(this._c).multiplyScalar(1.0);
    U.uSunDir.value.copy(sun);
    U.uMoonDir.value.copy(this.moonDir);
    U.uSunVis.value = smoothstep(-0.12, 0.0, e);
    U.uMoonVis.value = smoothstep(0.05, -0.12, e);
    U.uStars.value = smoothstep(-0.02, -0.22, e);
    U.uTime.value += dt;
    U.uGround.value.copy(U.uHorizon.value).multiplyScalar(0.75);
    this.sky.position.copy(camera.position);

    // Fog: horizon colour seen toward the camera's view, a little haze at dawn.
    const fog = this.scene.fog;
    fog.color.copy(U.uHorizon.value).lerp(U.uZenith.value, 0.12);
    const haze = smoothstep(0.35, 0.0, Math.abs(e)) * (0.6 + 0.4 * morning);
    fog.near = MathUtils.lerp(200, 90, haze) * MathUtils.lerp(1, 0.8, this.night);
    fog.far = MathUtils.lerp(1000, 700, haze) * MathUtils.lerp(1, 0.75, this.night);

    // Exposure: keep the night readable.
    this.renderer.toneMappingExposure = MathUtils.lerp(1.0, 1.35, this.night) + 0.08 * haze;

    // --- shadow frustum around the focus (texel-snapped)
    const L = this.light, R = this.shadowRadius;
    const cam = L.shadow.camera;
    cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R;
    cam.near = 1; cam.far = 1600;
    cam.updateProjectionMatrix();
    const texel = (2 * R) / L.shadow.mapSize.x;
    // snap the centre in light space
    const c = focus.clone();
    const ld = this.lightDir;
    const up = Math.abs(ld.y) > 0.99 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const lr = new Vector3().crossVectors(up, ld).normalize();
    const lu = new Vector3().crossVectors(ld, lr);
    const a = Math.round(c.dot(lr) / texel) * texel, b = Math.round(c.dot(lu) / texel) * texel, d = c.dot(ld);
    c.copy(lr).multiplyScalar(a).addScaledVector(lu, b).addScaledVector(ld, d);
    L.target.position.copy(c);
    L.position.copy(c).addScaledVector(ld, 800);
    L.target.updateMatrixWorld();
  }
}
