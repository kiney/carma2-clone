# Carmageddon II Browser Engine

## Executive Summary

This independent browser engine uses assets from a local Carmageddon II installation to render original cars, tracks, and textured pedestrians. Source-based vehicle motion, collision impulses, persistent crush, component damage, detachable parts, water, oil, noncars, lifts, world destruction, mines and recovery have numerical and Chromium checks. Original pedestrian populations, threat reactions, blood assets and WASTED lettering/sound are integrated. Game assets are read from the installation and are not included here. Remaining compatibility gaps and editable priorities are in [TODO.md](TODO.md).

## Run it

Use Node.js 20 or newer and a modern browser with WebGL support:

```sh
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). By default, the development server reads `./carma2_orig`. Set `CARMA2_ROOT` to use another local installation:

```sh
CARMA2_ROOT=/path/to/carmageddon2 npm run dev
```

For a production build, run `npm run build` and then `npm start`. The production server serves the built app and local assets on `127.0.0.1:5173`; set `PORT` to change the port.

## Drive

Choose a race and car, then select **Load Race**. The browser menus and HUD are independent implementations; the rendered game world uses original game assets.

| Key                   | Action                                      |
| --------------------- | ------------------------------------------- |
| W / Up                | Accelerate                                  |
| S / Down              | Reverse                                     |
| A / Left, D / Right   | Steer                                       |
| Shift                 | Brake                                       |
| Space                 | Handbrake                                   |
| R                     | Return to a saved safe pose for 250 credits |
| Hold E / double tap E | Repair / automatic repair using credits     |
| Tab                   | Select a charged ability                    |
| F                     | Use the selected ability                    |
| C                     | Cycle chase, cockpit, and overhead cameras  |
| M                     | Show or hide the minimap                    |
| Escape                | Pause or return to the menu                 |
| Enter                 | Restart after a race                        |

Vehicle mechanics and WAM data drive suspension, tyres, steering, gears, mass/inertia, localized dents, structural bending and body splitting. Twelve component damage units affect handling; detached parts have their own rigid state and joints. Held repair restores eligible bodywork and charges repaired component levels; split bodywork requires the full-repair pickup or reloading; wasting and its countdown persist until reloading. The ordinary physics equations are independently reconstructed from the local C2 executable; see [the evidence notes](docs/c2-physics-re.md).

Recovery keeps twenty complete safe poses, using the original suspension, grip, upright and gravity checks. It restores rotation and drive state without repairing damage. Damage-triggered wasting plays the configured original explosion sound and scrolls the original font lettering; a player-caused rival wreck also shows the source reward message. See [WASTED evidence](docs/c2-wasted-re.md).

Pedestrian populations follow original race surface densities, with the native 2000-person limit. Personality/movement data drives walking, panic, running, threat prediction, turns and obstacle/floor avoidance. Original blood cloud textures, giblet models, slicks and smears are visible. Pedestrian collision/corpse motion and skeletal animation still have separate limitations: root displacement currently uses authored per-frame averages, and limbs animate procedurally. See [pedestrian evidence](docs/c2-pedestrians-re.md).

The engine also includes graph-following opponents, checkpoint/lap races, engine, impact, and checkpoint sounds, and original credit, repair, time, weighted random, engine and grip pickups, plus invulnerability, granite protection, damage magnification, free repairs and permanent armour/power/offense upgrades. Actions 34/35 provide charged mine/mortar and oil abilities. Mines use the GENERAL mass and timed source lifecycle; mine sphere contacts are still approximated with a sampled hull, and explosions have no radial damage. Water and oil use reconstructed source formulas. Unsupported powerup effects show an explicit notification when collected. Race objectives are approximations; unsupported smash missions are labelled free driving.

## Tests

Run `npm test` for parsers, assets and deterministic motion/contact/crush/component/structural/repair conformance, wheel rays, terrain contours, recovery history, pedestrian population/reactions/blood and WASTED tests. The real-installation tests skip when `carma2_orig` is absent. `npm run test:browser` builds the production app and runs installed Chromium when available: stock/Advanced driving and race completion, mine pickup/impact/repair, oil grip, water, Carrier lift, Airport door destruction, real-key Snow Way Out recovery, pedestrian reactions/blood and original WASTED drawing/audio dispatch. Screenshots and reports are saved under ignored test artifacts. `npm run test:crashes` records original-car plane/pair scenarios in ignored `artifacts/crash-conformance.json`. `npm run test:car-damage` sweeps original-stock impact/repair cases and saves an ignored diagnostic report. Small generated fixtures do not require game assets.

## Asset and license notes

Use an installation you are entitled to use. Assets are read from that directory at runtime and are not copied into this repository or included in its license. Independently written project code is MIT licensed; see [LICENSE](LICENSE). The runtime depends on Three.js (MIT) and UTIF (MIT); see the package metadata and lockfile for dependency details.

Format research consulted rec2, dethrace, OpenC1, and ToxicRagers. No source code from those projects is included or used as a runtime dependency. Their licenses do not apply to this independent implementation, and this project's license grants no rights to Carmageddon II game data.
