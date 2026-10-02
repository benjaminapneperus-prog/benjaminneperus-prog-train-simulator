import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { getTerrain } from './world/terrain.js';
import { buildTerrainMesh, buildWaterMesh, buildOuterLand } from './world/terrainMesh.js';
import { buildTrack } from './world/trackMesh.js';
import { buildStructures } from './world/structures.js';
import { shared, updateGlow } from './world/materials.js';
import { buildVegetation } from './world/vegetation.js';
import { buildSettlements } from './world/villages.js';
import { STATIONS } from './world/layout.js';
import { Train, VMAX, KMH } from './train/train.js';
import { CameraRig } from './camera/cameraRig.js';
import { DayCycle, formatTime } from './lighting/daycycle.js';
import { Overlay } from './ui/overlay.js';
import { Hud } from './ui/hud.js';
import { TrainAudio } from './audio/audio.js';
import { ParticleSystem, Snowfall } from './fx/particles.js';
import { buildAmbient } from './fx/ambient.js';

const params = new URLSearchParams(location.search);
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const LOW = params.has('lowfx');
const MAX_PR = LOW ? 0.6 : Math.min(devicePixelRatio, 1.75);
let pixelRatio = MAX_PR;
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.3, 3200);

// ------------------------------------------------------------------ world
const T = getTerrain();
const route = T.route;
scene.add(buildTerrainMesh(T));
scene.add(buildWaterMesh(T));
scene.add(buildOuterLand());
scene.add(buildTrack(route, T));
scene.add(buildStructures(route, T));
const towns = buildSettlements(T, route);
scene.add(towns);
scene.add(buildVegetation(T, route));
const ambient = buildAmbient(T);
scene.add(ambient.group);

// ------------------------------------------------- train, camera, lighting
const train = new Train(route);
scene.add(train.group);
const rig = new CameraRig(camera, train, T, renderer.domElement);
const day = new DayCycle(scene, renderer);
day.setHours(parseFloat(params.get('t') || '8.5'));
// start at Frostpeak, loco at the stop board
train.s = route.wrap(STATIONS[0].stopS - train.loco.userData.front);
train.place();
rig.snap();

const steam = new ParticleSystem(1100);
scene.add(steam.points);
const snow = new Snowfall();
scene.add(snow.points);
const audio = new TrainAudio();
let soundAnnounced = false;
audio.onStart = () => { if (!soundAnnounced && !audio.muted) { soundAnnounced = true; hud.banner('Sound on <em>♪</em>', 2.5); } };
const hud = new Hud();

// ---------------------------------------------------------- post-process
const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.32, 0.55, 0.9);
if (!LOW) composer.addPass(bloom);
if (LOW) day.light.shadow.mapSize.set(1024, 1024);
composer.addPass(new OutputPass());

// --------------------------------------------------------------- controls
const overlay = new Overlay(renderer, {
  onLever: (v) => { train.lever = v; hud.hideHint(); },
  onNotch: () => audio.notch(),
  onTime: (h) => day.setHours(h),
  onWhistle: (on) => { whistling = on; audio.whistle(on); },
  onCab: () => toggleCab(),
});
function toggleCab() {
  const on = rig.toggleCab();
  overlay.cabOn = on;
  hud.banner(on ? 'Cab-roof view' : 'Outside view', 2);
  return on;
}
// One in-game day lasts four real minutes; dragging the sun sets the clock
// and the day carries on from there.
const DAY_SECONDS = 240;
let autoTime = !params.has('t');
let whistling = false;
let whistlePuff = 0;
const keys = {};
addEventListener('keydown', (e) => {
  if (keys[e.code]) return;
  keys[e.code] = true;
  if (e.code === 'KeyQ' || e.code === 'ArrowLeft') { rig.rotate(1); rig.setHold('rot', 1); }
  if (e.code === 'KeyE' || e.code === 'ArrowRight') { rig.rotate(-1); rig.setHold('rot', -1); }
  if (e.code === 'Equal' || e.code === 'NumpadAdd') { rig.zoom(1); rig.setHold('zoom', 1); }
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') { rig.zoom(-1); rig.setHold('zoom', -1); }
  if (e.code === 'KeyH' || e.code === 'Space') { whistling = true; audio.whistle(true); e.preventDefault(); }
  if (e.code === 'KeyV') toggleCab();
  if (e.code === 'KeyP') { autoTime = !autoTime; hud.banner(autoTime ? 'Time is running' : 'Time paused', 2); }
  if (e.code === 'KeyN') { audio.setMuted(!audio.muted); hud.banner(audio.muted ? 'Sound off' : 'Sound on <em>♪</em>', 2); }
  if (e.code === 'KeyM') hud.banner(audio.toggleMusic() ? 'Music on <em>♪</em>' : 'Music off', 2);
  if (e.code === 'BracketLeft') day.setHours(day.hours - 0.25);
  if (e.code === 'BracketRight') day.setHours(day.hours + 0.25);
});
addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (['KeyQ', 'KeyE', 'ArrowLeft', 'ArrowRight'].includes(e.code)) rig.setHold('rot', 0);
  if (['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract'].includes(e.code)) rig.setHold('zoom', 0);
  if (e.code === 'KeyH' || e.code === 'Space') { whistling = false; audio.whistle(false); }
});

// ------------------------------------------------- journey & station logic
const MOMENTS = [
  { at: [-30, -121], text: 'Climbing onto the <em>high line</em>' },
  { at: [254, -50], text: 'The <em>Great Curved Viaduct</em>' },
  { at: [276, 86], text: 'Down the <em>Horseshoe</em>' },
  { at: [112, 160], text: 'Into the <em>Whispering Pines</em>' },
  { at: [-262, 112], text: 'Up the <em>western shoulder</em>' },
].map((m) => ({ ...m, s: route.project(m.at[0], m.at[1]).s }));
const stationState = STATIONS.map((_, i) => ({ announced: i === 0, arrived: i === 0 }));
let lastS = train.s;
let stoppedFor = 0;

function frontS() { return route.wrap(train.s + train.loco.userData.front); }

function journey(dt) {
  const fs = frontS();
  // moments
  for (const m of MOMENTS) {
    const before = route.delta(lastS, m.s), after = route.delta(train.s, m.s);
    if (before > 0 && after <= 0 && train.v > 0.5) hud.banner(m.text, 3.5);
  }
  STATIONS.forEach((st, i) => {
    const ss = stationState[i];
    const ahead = route.delta(fs, st.stopS);
    if (!ss.announced && ahead > 40 && ahead < 190 && train.v > 3) {
      ss.announced = true;
      hud.banner(`${st.name} station ahead — ease the lever <em>up</em>`, 5);
    }
    const onPlatform = route.inRange(fs, st.platform.s0 + train.length * 0.6, st.platform.s1 + 6);
    if (!ss.arrived && train.v === 0 && onPlatform && train.lever === 0) {
      ss.arrived = true;
      const err = Math.abs(route.delta(st.stopS, fs));
      let msg;
      if (err < 2.5) { msg = `Perfect stop at ${st.name}! <em>★★★</em>`; audio.chime(); }
      else if (err < 7) msg = `Welcome to ${st.name} <em>★★</em>`;
      else msg = `Welcome to ${st.name} <em>★</em>`;
      hud.banner(msg, 5);
    }
    if (ss.arrived && !ss.tooted && train.v > 0.3) { ss.tooted = true; audio.toot(0.6); whistlePuff = 0.6; }
    if (ss.arrived && train.v > 2 && !onPlatform) {
      ss.tooted = false;
      ss.arrived = false;
      ss.announced = false;
      const next = STATIONS[(i + 1) % STATIONS.length];
      hud.banner(`Next stop: <em>${next.name}</em>`, 4);
    }
    if (ahead < 0 && ahead > -60) ss.announced = ss.announced; // keep
    if (ahead > 200) ss.announced = false;
  });
  lastS = train.s;
}

// ------------------------------------------------------- steam & smoke fx
const tmpV = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpH = new THREE.Vector3();
let lastChuffPhase = 0;
let idleT = 0, chimT = 0, drainT = 0;
const joints = 9.2;
const axleOffsets = [];
train.vehicles.forEach((v, i) => {
  for (const p of v.userData.pivots) axleOffsets.push(train.offsets[i] + p);
});
const lastJoint = axleOffsets.map((o) => Math.floor((train.s + o) / joints));
const wind = new THREE.Vector3(0.6, 0, 0.3);

function fx(dt) {
  const loco = train.loco;
  const heading = train.heading(tmpH);
  const chim = train.worldPoint(loco, loco.userData.chimney, tmpP);
  const sp = train.v / VMAX;
  const working = train.v < train.targetSpeed - 0.3 || (train.lever > 0 && train.v > 0.5);
  // chuffs: four per revolution of the drivers
  const phase = Math.floor(-train.theta / (Math.PI / 2));
  if (phase !== lastChuffPhase && train.v > 0.05) {
    lastChuffPhase = phase;
    const strength = working ? 0.45 + 0.55 * Math.min(1, train.lever + (1 - sp) * 0.3) : 0.18;
    tmpV.copy(heading).multiplyScalar(train.v * 0.25).add({ x: (Math.random() - 0.5) * 1.2, y: 5 + strength * 5, z: (Math.random() - 0.5) * 1.2 });
    steam.emit(chim, tmpV, { life: 2.2 + strength * 1.8, s0: 0.8, s1: 3.2 + strength * 2.6, alpha: 0.5 + strength * 0.3, shade: working ? 0.82 : 0.96, drag: 0.9 });
    if (strength > 0.4) {
      tmpV.y *= 0.7;
      steam.emit(chim, tmpV, { life: 3.0, s0: 1.0, s1: 4.6, alpha: 0.3, shade: 0.75, drag: 0.7 });
    }
    audio.chuff(working ? strength : 0.12);
  }
  // idle wisps from the chimney
  idleT -= dt;
  if (idleT <= 0) {
    idleT = train.v < 0.5 ? 0.35 : 0.6;
    tmpV.set((Math.random() - 0.5) * 0.4, 1.8 + Math.random(), (Math.random() - 0.5) * 0.4).addScaledVector(heading, train.v * 0.2);
    steam.emit(chim, tmpV, { life: 3.2, s0: 0.6, s1: 3.5, alpha: 0.3, shade: 0.9, drag: 0.5 });
  }
  // drain cocks: white jets from the cylinders when starting away
  drainT -= dt;
  if (train.lever > 0 && train.v < 3.5 && drainT <= 0) {
    drainT = 0.05;
    for (const c of loco.userData.cylinders) {
      const p = train.worldPoint(loco, c, new THREE.Vector3());
      const side = new THREE.Vector3(0, 0, Math.sign(c[2])).transformDirection(loco.matrix);
      tmpV.copy(side).multiplyScalar(3 + Math.random() * 2).add({ x: (Math.random() - 0.5), y: 0.4 + Math.random() * 0.6, z: (Math.random() - 0.5) }).addScaledVector(heading, 1.5);
      steam.emit(p, tmpV, { life: 1.2, s0: 0.5, s1: 2.6, alpha: 0.65, shade: 1.08, drag: 2.0 });
    }
  }
  // safety valve feathering while standing in a station
  if (train.v === 0) stoppedFor += dt; else stoppedFor = 0;
  if (stoppedFor > 4 && Math.random() < dt * 2.5) {
    const p = train.worldPoint(loco, loco.userData.valve, new THREE.Vector3());
    steam.emit(p, { x: 0, y: 5, z: 0 }, { life: 1.6, s0: 0.4, s1: 2.2, alpha: 0.6, shade: 1.1, drag: 1.2 });
  }
  // whistle steam
  whistlePuff = Math.max(0, whistlePuff - dt);
  if (whistling || whistlePuff > 0) {
    const p = train.worldPoint(loco, loco.userData.whistle, new THREE.Vector3());
    steam.emit(p, tmpV.set(0, 4, 0).addScaledVector(heading, train.v * 0.3), { life: 1.2, s0: 0.3, s1: 2.0, alpha: 0.7, shade: 1.1, drag: 1.5 });
  }
  // village chimneys
  chimT -= dt;
  if (chimT <= 0) {
    chimT = 0.12;
    const list = towns.userData.chimneys;
    const c = list[Math.floor(Math.random() * list.length)];
    if (c && c.distanceToSquared(camera.position) < 300 * 300) {
      steam.emit(c, { x: 0.2, y: 1.6, z: 0.1 }, { life: 6, s0: 0.6, s1: 4.5, alpha: 0.32, shade: 0.8, drag: 0.4 });
    }
  }
  steam.update(dt, wind);

  // rail joints → di-dum di-dum
  axleOffsets.forEach((o, i) => {
    const j = Math.floor((train.s + o) / joints);
    if (j !== lastJoint[i]) {
      lastJoint[i] = j;
      if (train.v > 0.3) audio.railClick(Math.min(1, 0.3 + sp), 0);
    }
  });
}

// ------------------------------------------------------------------ loop
let last = performance.now();
const sunCol = new THREE.Color(), shCol = new THREE.Color();
function step(dt) {
  if (keys.KeyS || keys.ArrowDown) { overlay.setLever(overlay.lever + dt * 0.55); train.lever = overlay.lever; hud.hideHint(); }
  if (keys.KeyW || keys.ArrowUp) { overlay.setLever(overlay.lever - dt * 0.55); train.lever = overlay.lever; }
  shared.uTime.value += dt;
  if (autoTime && overlay.drag?.kind !== 'sun') day.setHours(day.hours + (dt * 24) / DAY_SECONDS);
  train.update(dt);
  rig.update(dt);
  day.update(dt, camera, rig.focus, rig.dist);
  updateGlow(day.night);
  // bloom only for lamps/windows: very high threshold by day so sunlit snow never glows
  bloom.threshold = THREE.MathUtils.lerp(4.5, 1.9, day.night);
  bloom.strength = THREE.MathUtils.lerp(0.1, 0.45, day.night);
  towns.userData.poolMat.opacity = day.night * 0.8;
  if (towns.userData.sails) towns.userData.sails.rotation.z += dt * 0.45;
  train.headlamp.intensity = 600 * Math.max(0.04, day.night);
  train.fireLight.intensity = (1.5 + 2.5 * day.night) * (0.75 + 0.25 * Math.sin(shared.uTime.value * 13) * Math.sin(shared.uTime.value * 7.1));
  // particle lighting follows the sun
  sunCol.copy(day.light.color).multiplyScalar(Math.min(1.1, 0.35 + day.light.intensity * 0.28));
  shCol.copy(day.hemi.color).multiplyScalar(0.45 + day.hemi.intensity * 0.25);
  sunCol.add(shCol.clone().multiplyScalar(0.4));
  steam.setLight(sunCol, shCol);
  journey(dt);
  fx(dt);
  const [ci, cj] = T.colOf(rig.focus.x, rig.focus.z);
  const north = T.inside(ci, cj) ? T.north[T.idx(ci, cj)] : 0;
  const alpine = Math.max(north, THREE.MathUtils.smoothstep(rig.focus.y, 55, 70));
  snow.update(dt, camera.position, alpine * 0.9, shCol.clone().lerp(new THREE.Color(1, 1, 1), 0.6));
  ambient.update(dt, camera, day);
  audio.update(dt, { speed: train.v, vmax: VMAX, braking: train.acc < -0.8, idleSteam: train.v < 0.5 ? 1 : 0.3, alpine, night: day.night });
  // UI
  const fwd = camera.getWorldDirection(tmpV);
  const camYaw = -(-Math.PI / 2 - Math.atan2(fwd.z, fwd.x));
  overlay.update(dt, { hours: day.hours, speedFrac: train.v / VMAX, cameraYaw: camYaw, night: day.night });
  hud.set(train.v * KMH, formatTime(day.hours));
}
function render() {
  composer.render();
  overlay.render();
}
// Adaptive resolution keeps slower GPUs smooth.
let ema = 1 / 60, adaptT = 0;
function adapt(raw) {
  ema += (raw - ema) * 0.05;
  adaptT += raw;
  if (adaptT < 2.5 || LOW) return;
  adaptT = 0;
  let next = pixelRatio;
  if (ema > 1 / 36 && pixelRatio > 0.7) next = Math.max(0.7, pixelRatio - 0.15);
  else if (ema < 1 / 57 && pixelRatio < MAX_PR) next = Math.min(MAX_PR, pixelRatio + 0.1);
  if (next !== pixelRatio) { pixelRatio = next; renderer.setPixelRatio(pixelRatio); layout(); }
}
function frame(now) {
  const raw = (now - last) / 1000;
  const dt = Math.min(0.05, raw);
  last = now;
  adapt(raw);
  step(dt);
  render();
  requestAnimationFrame(frame);
}
function layout() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  overlay.resize();
  const ps = renderer.getPixelRatio() * innerHeight * 0.9;
  steam.uniforms.uScale.value = ps;
  snow.uniforms.uScale.value = ps;
  hud.layout(overlay.anchors());
}
addEventListener('resize', layout);
layout();
requestAnimationFrame(frame);

// Test / debug hooks (used by the automated play-through)
window.__game = {
  THREE, scene, camera, renderer, T, route, train, rig, day, overlay, hud, STATIONS, audio,
  ready: true,
  setTime: (h) => { autoTime = false; day.setHours(h); },
  setLever: (v) => { overlay.setLever(v, true); },
  teleport(s, opts = {}) { train.s = route.wrap(s); train.v = opts.v ?? 0; train.place(); lastS = train.s; rig.snap(); },
  simulate(seconds, dt = 1 / 30, draw = true) { for (let t = 0; t < seconds; t += dt) step(dt); if (draw) render(); },
  render,
  frontS,
  ui: () => { const d = overlay.debugPoints(); delete d.arc; return d; },
  state: () => ({ s: train.s, v: train.v, lever: train.lever, hours: day.hours, yaw: rig.yawTarget, dist: rig.distTarget, front: frontS(), banner: hud.el.bannerText.textContent }),
};
