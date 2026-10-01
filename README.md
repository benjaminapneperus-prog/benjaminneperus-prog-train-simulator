# Frostpeak Loop — a little voxel railway

A cozy, playable 3D voxel steam-train journey around a long snow-covered
mountain. Drive a small green locomotive and two coaches around one closed
railway loop: up onto a high mountainside line carried on stone ledges and
viaducts, around the eastern nose on a great curved viaduct, down a
horseshoe into warm pine forests, through the rural village of Meadowbrook
and back up the western shoulder to the alpine village of Frostpeak.

Built with [three.js](https://threejs.org) and [Vite](https://vite.dev).
No external art or audio assets: every model, texture-like detail and sound
is generated in code.

## Run it

```bash
npm install
npm run dev        # open the printed local URL
npm run build      # static build in dist/ (relative paths, host anywhere)
npm run preview
```

## How to play

| Control | Action |
| --- | --- |
| **Lever** (bottom right) | drag **down** to open the regulator and gather speed; drag **up** to brake and stop. Detents click at STOP · ¼ · ½ · ¾ · FULL |
| **Mini sun** (bottom left) | drag it along its arc to set the time of day, from sunrise in the east through midday, golden hour and sunset to night; below the horizon it becomes the moon |
| **Camera buttons** | rotate left / right around the train, zoom in / out (tap for a step, hold to keep going) |
| Mouse / touch | drag on the world to orbit, wheel to zoom |
| Keyboard | `S`/`↓` lever down · `W`/`↑` lever up · `Q`/`E` rotate · `+`/`-` zoom · `H`/`Space` whistle · `[` `]` time of day |

Stop the locomotive beside the red **STOP** board at either station for a
little reward. There is no score to chase — the point is the ride.

## How it is built

- **One authoritative spline.** `src/world/route.js` defines the loop as a
  closed centripetal Catmull–Rom curve, resampled by arc length, with a
  smoothed elevation profile (≤ 7 % grade), level station tracks and gentle
  cant in curves. Rails, sleepers, ballast, bridge alignment, platforms,
  train position/orientation and coach placement all read from it.
- **Designed terrain.** `src/world/terrain.js` authors an elongated
  knife-edge ridge with named summits, terraced snow benches and rock bands,
  gullies on the north flank, rim hills, a river with voxel cascades and a
  frozen lake. The railway corridor is then cut and filled, and land rises to
  carry the line except where viaducts leap gullies, rivers and the eastern
  nose. Supports are classified along the line into earthworks, masonry
  ledges (retaining walls) and arched viaducts.
- **Efficient voxels.** Terrain is a 2-unit voxel grid meshed in chunks:
  only exposed faces, greedy-merged flat tops, baked per-corner ambient
  occlusion and banded side colours. A shared voxel shader adds per-voxel
  colour jitter, soft voxel edges and rock strata, so merged faces still read
  as individual blocks. Trees, rocks, grass, sleepers and snow drifts are
  instanced; buildings, bridges and the train are merged box geometry.
- **Time of day.** `src/lighting/daycycle.js` keeps a single time state and
  derives sun/moon direction, shadow frustum, light colour and intensity,
  hemisphere ambient, sky shader (square voxel sun and moon, stars), fog,
  exposure and the glow of windows, lamps and the headlamp from it. The UI
  sun's position on its arc maps to the same angle used for the real light.
- **Train.** `src/train/` builds the locomotive, tender and coaches from
  boxes, spins every wheel from distance travelled, animates coupling and
  connecting rods, and places each vehicle on the chord between its bogies
  so the consist bends naturally through curves. Speed eases toward the
  lever's setting with gentle gradient resistance.
- **Atmosphere.** Steam puffs synchronised with the driving wheels, drain
  cock jets when starting, safety-valve feathering at stations, chimney
  smoke in the villages, snowfall on the alpine side, drifting voxel clouds
  and birds, and procedural WebAudio for chuffs, rail joints, whistle, hiss
  and brakes.

## Hosting

The build uses relative paths, so `dist/` can be served from any static host.
`.github/workflows/pages.yml` builds and deploys to GitHub Pages on pushes to
`main` (enable Pages with "GitHub Actions" as the source in the repository
settings).
