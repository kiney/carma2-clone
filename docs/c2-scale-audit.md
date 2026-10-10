# Vehicle scale, camera and uneven-ground spawn audit

## Executive Summary

The new screenshots warranted reopening the broad claim that vehicle scale had been fully checked. No global car-versus-world geometric scale error was found: the browser applies original ACT/DAT transforms, all 52 stock car actor hierarchies have unit basis lengths, and the green Eagle's actual browser dimensions match its visible source geometry. Human pedestrian template heights are about 1.95–2.02 metres, versus the Eagle's 1.746 metres, using the original 6.9-metre unit conversion.

A substantial camera discrepancy is confirmed. The browser uses a wider vertical field of view and a farther/higher chase camera than the original defaults. Correcting camera framing is justified by evidence; enlarging vehicle geometry is not. Exact original animated-pedestrian poses and a matched original-game screenshot have not been verified.

The baseline audit below measured initial road penetration in three DUNE BUGGERED opponents. PHY-09 and AI-05 were subsequently fixed; the dated follow-up at the end records implementation and browser validation. The camera discrepancy remains open under REN-05.

## Geometry and unit evidence

Audit date: 2026-10-08. Original assets were read without alteration. Independent recursive ACT/DAT measurements respect inherited render style: actors with effective style 1 do not contribute visible geometry. The existing `tests/support/original-car.mjs` helper does not filter that style and therefore overstates the green Eagle's length as 0.81668 rather than the production-visible 0.80683. That adapter is useful for physics tests, but its complete AABB is not sufficient evidence for visible size.

| Visible original model | Width × height × length, game units | Converted dimensions, metres |
| ---------------------- | ----------------------------------- | ---------------------------- |
| Eagle3 / green Eagle   | 0.38340 × 0.25300 × 0.80683         | 2.645 × 1.746 × 5.567        |
| Buggy                  | 0.47231 × 0.26204 × 0.74335         | 3.259 × 1.808 × 5.129        |
| Ford pickup            | 0.41649 × 0.30947 × 0.81031         | 2.874 × 2.135 × 5.591        |
| Volvo                  | 0.60052 × 0.63272 × 1.20067         | 4.144 × 4.366 × 8.285        |
| Semi2                  | 0.60372 × 0.69549 × 1.56645         | 4.166 × 4.799 × 10.809       |
| Bigdump                | 1.21208 × 1.13699 × 2.04817         | 8.363 × 7.845 × 14.132       |

- **Original data:** green Eagle root `EAGLENEG.ACT`, Eagle3 root `EAGLENEW.ACT` and Desert2 world root `PP01 16 16 1.000 834` have identity transforms. All inspected stock car root/child basis lengths are 1. Runtime player/rival wrapper scales are also `(1,1,1)`.
- **Reconstructed by rec2:** `LoadCar` attaches loaded ACT to an identity master actor; its wheel recentering translates actors and vertices reciprocally without changing model size. No car-specific relative scale was found. `WORLD_SCALE=6.9` is the motion/mechanics unit boundary, not a visual car multiplier.
- **Matrix convention:** `content.ts` places BRender row basis vectors into Three.js columns. This agrees with `BrMatrix34ApplyP`: `x' = x*m00 + y*m10 + z*m20 + m30`, and corresponding Y/Z equations. Car and track loading use this same path.
- **Physics consistency:** Eagle's authored hull is approximately `0.400 × 0.200 × 0.780`; its visible bounds above are close without a uniform factor difference. Other original models have legitimate hull/bodywork differences and overhangs. A collision hull need not enclose every visual attachment.
- **Pedestrians:** original Blokebl/Bismanbm ACT template heights are `0.2831391`; Bandsman `0.29211`; Attend2 `0.284824`. Native `ReadPersonality → RemapModelAxis → RemapVector` permutes/signs axes without resizing. `ReadMove` normalizes bone matrices, and race reset sets pedestrian, average and head scale to 1. Browser template clones retain original scale. This checks baseline dimensions, not full native skeletal animation fidelity.

Chrome DevTools measurement in stock `data/RACES/desert2/desert2.txt`, with `data/CARS/eaglegreen/EAGLEGREEN.TXT`, returned player-local visible dimensions `(0.383397613, 0.253003232, 0.806826387)`, matching the independent source calculation. Eagle3, Buggy, Bugtoo5 and Cerby rivals had unit wrapper scales and their own distinct original dimensions. The first Desert2 pedestrian was the original `twolf` animal, height `0.203732`; it is not a human-size reference. The scene contained 925 pedestrians/animals.

## Confirmed camera mismatch

Original `DATA/GENERAL.TXT` configures camera angle `55.55`. BRender's perspective matrix has `M00=cot(FOV/2)/aspect` and `M11=cot(FOV/2)`, so this is vertical FOV, the same convention as Three.js. The browser hardcodes 65 degrees and does not read this camera field.

| Camera property        | Original default evidence                                    | Browser implementation                                                   |
| ---------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Vertical FOV           | GENERAL: 55.55°                                              | 65°                                                                      |
| Default zoom           | `gCamera_zoom = 0.2`                                         | No source zoom state                                                     |
| Chase distance         | `sqrt(zoom) + 4/6.9 = 1.026924`                              | Eagle minimum 1.55; bounds-based enlargement for large cars              |
| Vertical increment     | `zoom² + 0.3 = 0.34`, relative to source camera position/COM | At least 0.8 above car origin                                            |
| Aim                    | Source COM and additional FOV/5 inclination                  | At least 0.18 above origin, plus 0.65 forward                            |
| Speed/framing behavior | Native camera logic                                          | Extra distance up to 0.8 and browser smoothing/obstruction approximation |

**Verified from the installed HW executable:** SHA256 `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`, PE32 image base `0x400000`, entry RVA `0x177eb0`, timestamp 1998-10-18.

- `GeneralisedPositionExternalCamera`, VA `0x410c60`: `0x41111d–0x41112d` loads zoom at `0x654bf8`, takes its square root and adds `4/6.9` through constant `-0.579710126` at `0x5884f8`.
- `0x41174a–0x41177d` calculates zoom squared plus 0.3, using constant `-0.300000012` at `0x588514`.
- `PointCameraAtCar`, VA `0x411fc0`, uses the COM target and FOV-based inclination; multiplication by 0.2 appears at `0x411fd7–0x411fe7`.
- Installed `AllocateCamera` is at `0x47e2f0`, with the FOV global `0x74b4f4` read at `0x47e31e`. Some rec2 init/loading annotated addresses differ for this executable; those annotations must not be mistaken for installed addresses.

Wider FOV alone reduces projected size to about 82.7% at the same depth. Combining only focal length and the distance ratio gives about 54.8% of the original-default estimate. **This is an indicative projection calculation, not an original-versus-browser screenshot measurement**: height, pitch, target point, depth and obstacles affect the result. Keep camera conformance open under REN-05 rather than claiming an exact visual match.

## Uneven-ground opponent placement

At the audited baseline, `main.ts::loadRivals` offsets rivals by fixed X/Z displacements from the player, sets each origin Y using one `collision.height` sample, and immediately creates the body with the player's heading. It does not fit four wheel supports, orient the body to the terrain, validate the whole hull or reserve a clear grid position. The closest path node is used by the navigator, not as a validated spawn pose.

In Chromium, paused at simulation time 0, the following maximum vertical hull-vertex penetrations were measured against local upward-facing road triangles:

| Rival   | Initial origin XYZ      | Maximum road penetration, game units |
| ------- | ----------------------- | ------------------------------------ |
| Eagle3  | -56.22, 4.34419, -47.61 | 0.035314                             |
| Buggy   | -54.62, 4.56944, -47.61 | 0.046435                             |
| Bugtoo5 | -56.22, 4.70592, -46.61 | 0.038025                             |
| Cerby   | -54.62, 4.33680, -46.61 | 0                                    |

These correspond to about 24–32 cm for the first three cars. None was knackered at this paused measurement. An initial-placement test should check the full body and wheel support, then run AI and physics long enough to verify that cars stay alive and can drive. Include an even-road control and differently sized cars. Player placement uses a related single-height sample and should be checked with the same placement logic.

Car-pair contacts and overlap recovery already exist, so the interlocking report is not evidence that car-car collision is absent. PHY-09 should reproduce the reported front/side/oblique trap with ordinary and crushed hulls plus physical attachments, recording contacts, transforms and damage. Passing earlier numerical impulse tests does not close this new report.

## Reference and scope

The inspected rec2 checkout is commit `249f6be9925b7632295b74a47e3d4b07857b1649`; relevant files are `src/carma2/common/car.c`, `loading.c`, `init.c`, `pedestrn.c`, and BRender's transform/perspective implementation. It is reference material, not a vendored dependency. Runtime measurements used Chrome DevTools MCP and read-only original assets; the transient screenshot is `/tmp/c2-dune-scale-spawn-audit.png`.

No vehicle enlargement, camera change or collision fix was made during this audit. The task here was to reconcile the reported bugs and investigate scale. The established evidence now points to camera fidelity, not a guessed geometry multiplier.

## PHY-09 / AI-05 fix follow-up, 2026-10-08

`placeCarAtStart` now fits original four-wheel anchors to finite local road support, preserves horizontal heading, checks the complete authored hulls against terrain and reserved cars/noncars, and searches nearby when necessary. It seeds actual wheel lengths, predicted poses and recovery history. Player and rivals use the same path; rival offsets rotate with the original grid heading and do not follow a player who drives away during asynchronous loading. No model scale or chase camera was changed.

The production Chromium regression loads DUNE with green Eagle, Buggy and Bigdump, plus NEW CITY with Eagle3. All five cars in every grid start with zero measured road/car penetration and four supported wheels. All four opponents in every case move and remain alive after four seconds of normal AI/physics. The original initial-penetration measurements above are retained as historical evidence.

The pair fix corrects native local-bounds centers and independently verifies final integration and joint projection against authored solid hulls. DUNE head-on and oblique crashes still cause persistent local deformation/component damage, remain SAT-disjoint, and release under the actual reverse key. Numerical regressions include yaw/pitch, pre-existing overlaps, wall-adjacent crushed bodies, different world fractions and complete rotation arcs. Details and limits are in [physics evidence](c2-physics-re.md). `npm run test:spawn-pairs` reproduces the dedicated browser checks; screenshots/reports remain in ignored `artifacts/`.

## Native-camera integration follow-up, 2026-10-11

The camera mismatch table above records the historical baseline. The live chase
now uses GENERAL's quantized 55.546875° FOV, doubled general/cockpit hithers,
track Yon factor and original COM/zoom/reversal formulas. Eagle's original 0.2
zoom gives about 1.027 units of proposed chase distance and a 0.34 height
increment. No geometry scale correction was made.

New City Chromium measurements at 1280×800 show Eagle sampled bounds about
412×334 pixels with all 184 corners in frame, versus the historical 179×194.
Bigdump exposed an async stale-COM reset bug; correcting that alone still left
its rear filling the view at 0.2. A bounded startup framing extension now selects
a fitting initial zoom for large cars, retaining native pose formulas and zoom
controls. This extension is explicitly distinct from original behavior; see
[camera evidence](c2-camera-re.md) for confidence and remaining query limitations.
