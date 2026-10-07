# Carmageddon II Browser Engine

## Executive Summary

This independent browser engine uses assets from a local Carmageddon II installation to render original cars, tracks, and textured pedestrians, with reconstructed ordinary-road vehicle dynamics, collision impulses, persistent crush, component damage and physical vehicle parts. It supports stock and Advanced content, but it does not reproduce every original game system or campaign behavior. Game assets are read from the installation and are not included here.

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

| Key                   | Action                                     |
| --------------------- | ------------------------------------------ |
| W / Up                | Accelerate                                 |
| S / Down              | Reverse                                    |
| A / Left, D / Right   | Steer                                      |
| Shift                 | Brake                                      |
| Space                 | Handbrake                                  |
| R                     | Recover to the track for 250 credits       |
| Hold E / double tap E | Repair / automatic repair using credits    |
| C                     | Cycle chase, cockpit, and overhead cameras |
| M                     | Show or hide the minimap                   |
| Escape                | Pause or return to the menu                |
| Enter                 | Restart after a race                       |

Vehicle mechanics and WAM data drive suspension, tyres, steering, gears, mass/inertia, localized dents, structural bending and body splitting. Twelve component damage units affect handling; detached parts have their own rigid state and joints. Held repair restores eligible bodywork and charges repaired component levels; split bodywork requires the full-repair pickup or reloading; wasting and its countdown persist until reloading. The ordinary physics equations are independently reconstructed from the local C2 executable; see [the evidence notes](docs/c2-physics-re.md).

The engine also includes graph-following opponents, checkpoint/lap races, textured pedestrians with simple behavior, engine, impact, and checkpoint sounds, and original credit, repair, time, weighted random, engine and grip pickups, plus invulnerability, granite protection, damage magnification, free repairs and permanent armour/power/offense upgrades. Unsupported powerup effects show an explicit notification when collected. Race objectives are approximations; unsupported smash missions are labelled free driving.

## Tests

Run `npm test` for parsers, assets and deterministic motion/contact/crush/component/structural/repair conformance tests. The real-installation tests skip when `carma2_orig` is absent. `npm run test:browser` builds the production app and runs an installed Chromium smoke test when available; it exercises driving and checkpoints on stock and Advanced content and saves screenshots under ignored test artifacts. `npm run test:crashes` records 15 deterministic original-car plane/pair scenarios, including transforms, mass/COM/inertia, impulses, velocities, damage, deformation and part states in ignored `artifacts/crash-conformance.json`. `npm run test:car-damage` sweeps312 original-stock impact/repair cases and saves an ignored diagnostic report. Small generated fixtures do not require game assets.

## Asset and license notes

Use an installation you are entitled to use. Assets are read from that directory at runtime and are not copied into this repository or included in its license. Independently written project code is MIT licensed; see [LICENSE](LICENSE). The runtime depends on Three.js (MIT) and UTIF (MIT); see the package metadata and lockfile for dependency details.

Format research consulted rec2, dethrace, OpenC1, and ToxicRagers. No source code from those projects is included or used as a runtime dependency. Their licenses do not apply to this independent implementation, and this project's license grants no rights to Carmageddon II game data.
