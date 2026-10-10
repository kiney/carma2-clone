# Carmageddon II Browser Engine

## Executive Summary

This independent browser engine uses assets from a local Carmageddon II installation to render original cars, tracks, and textured pedestrians. Source-based vehicle motion, collision impulses, persistent crush, component damage, detachable parts, water, oil, noncars, lifts, world destruction, mines and recovery have numerical and Chromium checks. Original pedestrian populations, threat reactions, blood assets and WASTED lettering/sound are integrated. Game assets are read from the installation and are not included here. Remaining compatibility gaps and editable priorities are in [TODO.md](TODO.md).

## Original vs. browser engine

Technical comparison of car geometry, body deformation and city rendering: both scenes show the same four car models and textured fire escapes. The engine scene is arranged and paused, with Eagle deformation produced by its damage system and an independently implemented HUD.

<table>
  <tr>
    <th>Original Carmageddon II</th>
    <th>Browser engine</th>
  </tr>
  <tr>
    <td><img src="https://gaming-cdn.com/images/products/16521/screenshot/carmageddon-2-carpocalypse-now-pc-gioco-steam-wallpaper-1.jpg?v=1712048231" width="600" alt="Original Carmageddon II: a damaged red Eagle, blue Coupe de Grace, yellow Buzzmobile and pink Slam Sedan beside city buildings"></td>
    <td><img src="artifacts/readme-comparison/engine-city-comparison.png" width="600" alt="Browser engine: the same four car models arranged on a city street, with damaged Eagle bodywork, textured fire escapes and the independent browser HUD"></td>
  </tr>
</table>

Original screenshot: [Instant Gaming](https://www.instant-gaming.com/de/16521-kaufen-carmageddon-2-carpocalypse-now-pc-steam/) (author uncredited). Game: Stainless Games; IP: THQ Nordic. Game imagery is excluded from the MIT license.

## Tech stack

- **Frontend:** TypeScript with plain HTML/CSS.
- **Rendering:** Three.js with WebGL2.
- **Audio:** Web Audio API playing original WAV assets.
- **Physics:** Custom C2 reconstruction covering vehicle motion, collision impulses, persistent crush, component damage and detachable parts.
- **Assets:** Custom parsers for original C2 files and TWT archives, with UTIF for TIFF textures; game data stays in the local installation.
- **Server and build:** Node.js and Vite, with a local asset server.
- **Tests:** Node's test runner with `tsx`, plus Playwright and Chromium for browser checks.

The engine runs directly in the browser. See [architecture notes](docs/architecture.md) for more detail.

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
| Enter                 | Skip bonus payout / restart after a race    |

Vehicle mechanics and WAM data drive suspension, tyres, steering, gears, mass/inertia, localized dents, structural bending and body splitting. Twelve component damage units affect handling; detached parts have their own rigid state and joints. Held repair restores eligible bodywork and charges repaired component levels; split bodywork requires the full-repair pickup or reloading; wasting and its countdown persist until reloading. The ordinary physics equations are independently reconstructed from the local C2 executable; see [the evidence notes](docs/c2-physics-re.md).

Recovery keeps twenty complete safe poses, using the original suspension, grip, upright and gravity checks. It restores rotation and drive state without repairing damage. Damage-triggered wasting plays the configured original explosion sound and scrolls the original font lettering; a player-caused rival wreck also shows the source reward message. See [WASTED evidence](docs/c2-wasted-re.md).

Pedestrian populations follow original race surface densities, with the native 2000-person limit. Personality/movement data drives walking, panic, running, threat prediction, turns and obstacle/floor avoidance. Original blood cloud textures, giblet models, slicks and smears are visible. Pedestrian collision/corpse motion and skeletal animation still have separate limitations: root displacement currently uses authored per-frame averages, and limbs animate procedurally. See [pedestrian evidence](docs/c2-pedestrians-re.md).

The engine also includes graph-following opponents, checkpoint/lap races, engine, impact, native pickup, checkpoint, final-lap, completion and time-expiry sounds, and original credit, repair, time, weighted random, engine and grip pickups, plus invulnerability, granite protection, damage magnification, free repairs and permanent armour/power/offense upgrades. Actions 34/35 provide charged mine/mortar and oil abilities. Mines use the GENERAL mass and timed source lifecycle; mine sphere contacts are still approximated with a sampled hull, and explosions have no radial damage. Water and oil use reconstructed source formulas. Original Gravity, Pinball, Wall Climber, soft/hard suspension and grounded timed Bounce use reconstructed native consumers and authored parameters; `npm run test:motion-powerups` checks Eagle3/Buggy suspension, real wall contacts, car/mine gravity, bounce and world/car-car Pinball behavior. Unsupported powerup effects show an explicit notification when collected. Race catalog exclusions and no-time flags follow installed C2 behavior. Smash missions use authored runtime-variable targets; Smash-and-Ped combines selected pedestrian kills with smash events in the same signed counter. Remaining award, population and world-script gaps are documented in [race rules evidence](docs/c2-race-rules-re.md) and [TODO.md](TODO.md).

Ordinary checkpoint credits, pedestrian base rewards/combos and waste rewards use original tables. Completion selects the authored victory-reason bonus and converts remaining time after the native finish delay; Enter skips the payout while retaining its full total. Special pedestrian score classifications and parts of opponent attribution remain open under RAC-04.

The reconstructed frame clock supplies gameplay timing independently of render
FPS. Physics retains native 40 ms steps, a five-step frame budget, absolute
frame-window resynchronization and pose interpolation. Ordinary effect deadlines
and finish-payout presentation use game timestamps; timer/countdown subtraction
uses the native frame period. See [timebase evidence](docs/c2-timebase-re.md);
`npm run test:timebase` exercises real keyboard driving, active stalls and
pause/resume in Chromium.

## Debug mode

Enable **Debug mode** in the race menu, or click the always-visible **DEBUG · OFF** button while driving. The panel lets you freeze the race countdown (physics, opponents and timed powerups continue), add an editable amount of credits or 60 seconds, grant original powerups, refill all weapon/oil abilities, fully repair, recover for free, and restart. Optional invulnerability and free held/automatic repairs are available. F and Tab use/select granted abilities normally.

Debug mode is off on page load and stays selected across race changes within that session. Turning it off removes timer, immunity and free-repair overrides; granted credits, charges, upgrades and timed pickup effects remain. Unsupported original powerups are labelled and disabled in the list. Repair does not undo wasting: restart a wasted/finished race. Debug tools also work from the pause menu; adding time does not revive an already finished race.

## Tests

Run `npm test` for parsers, assets and deterministic motion/contact/crush/component/structural/repair conformance, wheel rays, terrain contours, recovery history, pedestrian population/reactions/blood and WASTED tests. The real-installation tests skip when `carma2_orig` is absent. `npm run test:browser` builds the production app and runs installed Chromium when available: stock/Advanced driving and race completion, mine pickup/impact/repair, oil grip, water, Carrier lift, Airport door destruction, real-key Snow Way Out recovery, pedestrian reactions/blood and original WASTED drawing/audio dispatch. It also checks visible debug controls, timer freezing while driving, grants, ability use, repair/recovery, input isolation, disabling overrides and restarting; run `npm run test:debug` for that check alone. It additionally checks uneven-ground start grids with Eagle, Buggy and Bigdump, car-pair penetration, persistent crash deformation and real-key reverse escape on DUNE BUGGERED; run `npm run test:spawn-pairs` for that check alone. Original world pickup, actual checkpoint crossing, debug grants, ability use and expiry also have an event-audio regression; run `npm run test:event-audio` alone. Pickup/race voice selection follows the [audio evidence](docs/c2-event-audio-re.md). Player engine pitch and volume use motion RPM, special-volume indices and engine powerup state, following [verified native equations](docs/c2-engine-audio-re.md); `npm run test:engine-audio` checks stationary playback, those transforms and real keyboard driving. Screenshots and reports are saved under ignored test artifacts. `npm run test:crashes` records original-car plane/pair scenarios in ignored `artifacts/crash-conformance.json`. `npm run test:car-damage` sweeps original-stock impact/repair cases and saves an ignored diagnostic report. Small generated fixtures do not require game assets.

`npm run test:race-awards` checks original mission completion, deferred payout and Enter skip, Stock/Advanced pedestrian tables and combos, attributed rival rewards, and final-goal reward suppression in Chromium.

## Asset and license notes

Use an installation you are entitled to use. Assets are read from that directory at runtime and are not copied into this repository or included in its license. Independently written project code is MIT licensed; see [LICENSE](LICENSE). The runtime depends on Three.js (MIT), UTIF (MIT), and UTIF's dependency pako (MIT and Zlib). UTIF also embeds a PDF.js/jpgjs JPEG decoder (Apache-2.0). Their copyright notices and license texts are included in [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt).

Every production build includes `LICENSE.txt` and `THIRD_PARTY_LICENSES.txt` at the root of `dist/`. Keep both files with distributed builds. Update the third-party notices when upgrading bundled dependencies.

Format research consulted rec2, dethrace, OpenC1, and ToxicRagers. No source code from those projects is included or used as a runtime dependency. Their licenses do not apply to this independent implementation, and this project's license grants no rights to Carmageddon II game data.
