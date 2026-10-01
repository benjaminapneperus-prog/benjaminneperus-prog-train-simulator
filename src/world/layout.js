// Hand-placed layout of the two settlements and their stations.
// Pads flatten the terrain under buildings and squares; paths are painted
// into the terrain's top material.
import { getRoute } from './route.js';
import { M } from './materialIds.js';

const route = getRoute();

// Point at lateral offset from the line (lat < 0 = left of travel).
function beside(s, lat) {
  const p = route.point(s), r = route.right(s);
  return { x: p.x + r.x * lat, z: p.z + r.z * lat, y: p.y, yaw: Math.atan2(-route.tangent(s).z, route.tangent(s).x) };
}

const [FROST, MEADOW] = route.stations;
const fMid = (FROST.s0 + FROST.s1) / 2;
const mMid = (MEADOW.s0 + MEADOW.s1) / 2;

// Station details (platform on the left of travel at both stations).
export const STATIONS = [FROST, MEADOW].map((st, i) => {
  const mid = (st.s0 + st.s1) / 2;
  const b = beside(mid, -11.5);
  return {
    ...st,
    mid,
    platform: { s0: st.s0 + 6, s1: st.s1 - 6, lat0: -2.05, lat1: -7.2, top: st.y + 0.85 },
    building: { ...b, kind: i === 0 ? 'station_alpine' : 'station_rural' },
    // where the front of the locomotive should come to rest
    stopS: st.s1 - 7,
  };
});

const fb = STATIONS[0].building, mb = STATIONS[1].building;

export const BUILDINGS = [
  // ---- Frostpeak (alpine village on terraces above the northern valley)
  { kind: 'chalet', x: -250, z: -180, yaw: 0.1, w: 8, d: 7, y: 36, floors: 2, wall: 0xd9cfc0, timber: 0x6b4630 },
  { kind: 'chalet', x: -232, z: -182, yaw: -0.05, w: 7, d: 6, y: 36, floors: 2, wall: 0xe6dccd, timber: 0x7a5236 },
  { kind: 'chalet', x: -170, z: -180, yaw: 0.15, w: 8, d: 7, y: 36, floors: 2, wall: 0xd6c7b0, timber: 0x5e3d2a },
  { kind: 'chalet', x: -242, z: -199, yaw: 0.2, w: 7, d: 6, y: 34, floors: 1, wall: 0xe1d6c4, timber: 0x6e4a33 },
  { kind: 'chalet', x: -220, z: -201, yaw: -0.1, w: 9, d: 7, y: 34, floors: 2, wall: 0xcfc3b0, timber: 0x5a3b28 },
  { kind: 'chalet', x: -198, z: -198, yaw: 0.05, w: 7, d: 6, y: 34, floors: 1, wall: 0xe8decf, timber: 0x76503a },
  { kind: 'chalet', x: -178, z: -200, yaw: -0.2, w: 8, d: 6, y: 34, floors: 2, wall: 0xd8ccb8, timber: 0x6b4630 },
  { kind: 'chalet', x: -230, z: -217, yaw: 0.12, w: 7, d: 6, y: 32, floors: 1, wall: 0xe3d8c6, timber: 0x6e4a33 },
  { kind: 'chalet', x: -205, z: -218, yaw: -0.08, w: 8, d: 7, y: 32, floors: 2, wall: 0xd2c5b1, timber: 0x5e3d2a },
  { kind: 'chapel', x: -150, z: -198, yaw: Math.PI / 2 + 0.1, w: 7, d: 11, y: 36 },
  { kind: 'chalet', x: -214, z: -130, yaw: Math.PI, w: 7, d: 6, y: 40, floors: 2, wall: 0xe0d4c2, timber: 0x6b4630 },
  { kind: 'chalet', x: -178, z: -131, yaw: Math.PI + 0.1, w: 8, d: 6, y: 42, floors: 1, wall: 0xd9cdb9, timber: 0x76503a },
  { ...fb, kind: 'station_alpine', w: 11, d: 6.5, y: STATIONS[0].y + 0.15 },

  // ---- Meadowbrook (rural village south of the line)
  { ...mb, kind: 'station_rural', w: 11, d: 6.5, y: STATIONS[1].y + 0.15 },
  { kind: 'postoffice', x: -116, z: 236, yaw: Math.PI, w: 9, d: 7, y: 12 },
  { kind: 'cottage', x: -168, z: 224, yaw: Math.PI, w: 7, d: 6, y: 12, wall: 0xf1d58a, roof: 0xa8432f },
  { kind: 'cottage', x: -152, z: 230, yaw: Math.PI + 0.08, w: 6, d: 6, y: 12, wall: 0xf3efe6, roof: 0x8a4a2e },
  { kind: 'cottage', x: -96, z: 226, yaw: Math.PI - 0.1, w: 7, d: 6, y: 12, wall: 0xe9a98a, roof: 0x9b3a2b },
  { kind: 'cottage', x: -160, z: 252, yaw: Math.PI / 2, w: 7, d: 6, y: 14, wall: 0xa9cbe0, roof: 0xb04a32 },
  { kind: 'cottage', x: -138, z: 256, yaw: 0, w: 8, d: 6, y: 14, wall: 0xf2c6a0, roof: 0x7d4a2e },
  { kind: 'cottage', x: -112, z: 258, yaw: -0.15, w: 6, d: 6, y: 14, wall: 0xf6e7b6, roof: 0xa8432f },
  { kind: 'cottage', x: -90, z: 248, yaw: -Math.PI / 2, w: 7, d: 6, y: 14, wall: 0xd7e4c4, roof: 0x8a3f2c },
  { kind: 'cottage', x: -180, z: 244, yaw: Math.PI / 2 + 0.1, w: 6, d: 6, y: 12, wall: 0xf0b8b0, roof: 0x7d4a2e },
  { kind: 'barn', x: -58, z: 236, yaw: 0.3, w: 10, d: 8, y: 12 },
  { kind: 'windmill', x: -226, z: 236, yaw: 0.6, w: 6, d: 6, y: 16 },
];

// Frostpeak pads form terraces stepping down toward the valley.
export const LAYOUT = {
  pads: [
    // station shelf
    { x: (FROST.from[0] + FROST.to[0]) / 2, z: -160, hw: 48, hd: 13, y: 36, feather: 14 },
    // each alpine house gets its own small pad on the natural slope
    ...BUILDINGS.filter((b) => b.kind === 'chalet' || b.kind === 'chapel').map((b) => ({
      x: b.x, z: b.z, hw: Math.max(b.w, b.d) / 2 + 1.6, hd: Math.max(b.w, b.d) / 2 + 1.6, y: 'auto', feather: 5,
    })),
    // Meadowbrook
    { x: (MEADOW.from[0] + MEADOW.to[0]) / 2, z: 210, hw: 48, hd: 12, y: 12, feather: 8 },
    { x: -130, z: 232, hw: 58, hd: 14, y: 12, feather: 8 },
    { x: -126, z: 254, hw: 46, hd: 9, y: 14, feather: 8 },
    { x: -58, z: 236, hw: 9, hd: 8, y: 12, feather: 8 },
    { x: -226, z: 236, hw: 6, hd: 6, y: 16, feather: 10 },
  ],
  paths: [
    // Frostpeak: snow-packed lanes
    { mat: M.PATH_SNOW, w: 2.2, pts: [[-196, -165], [-200, -176], [-206, -188], [-210, -199], [-214, -210]] },
    { mat: M.PATH_SNOW, w: 1.8, pts: [[-256, -189], [-230, -190], [-200, -189], [-170, -190], [-150, -190]] },
    { mat: M.PATH_SNOW, w: 1.6, pts: [[-240, -208], [-220, -209], [-200, -208]] },
    { mat: M.PATH_SNOW, w: 2.6, pts: [[-226, -164], [-166, -164]] },
    // Meadowbrook: earth lanes and a little square
    { mat: M.PLAZA, w: 6, pts: [[-150, 214], [-118, 214]] },
    { mat: M.PATH, w: 2.4, pts: [[-134, 216], [-134, 240], [-130, 270]] },
    { mat: M.PATH, w: 2.2, pts: [[-190, 240], [-160, 241], [-134, 240], [-100, 238], [-60, 244]] },
    { mat: M.PATH, w: 1.6, pts: [[-100, 238], [-96, 252], [-90, 262]] },
    { mat: M.PATH, w: 1.6, pts: [[-160, 241], [-196, 236], [-226, 236]] },
  ],
  // circles kept free of trees
  clear: [
    { x: -200, z: -185, r: 72 }, { x: -195, z: -132, r: 30 },
    { x: -128, z: 238, r: 74 }, { x: -60, z: 236, r: 22 }, { x: -226, z: 236, r: 18 },
  ],
  // farmland patches near Meadowbrook
  fields: [
    { x: -70, z: 270, hw: 18, hd: 10, rot: 0.3 },
    { x: -200, z: 268, hw: 16, hd: 9, rot: -0.2 },
    { x: -40, z: 218, hw: 10, hd: 8, rot: 0.6 },
  ],
};
