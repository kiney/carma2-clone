# C2 external camera evidence

Status: native chase/projection and contact state are integrated for REN-05.
Numerical and production Chromium checks cover the original Eagle and Bigdump.
Cadence, large-vehicle and orbit-control checks pass on the production bundle
with the integrated native AI force consumer.
No vehicle model scale change is indicated by the asset audit.

Evidence sources: rec2 is a map, not the final specification. The addresses below
were checked against the installed read-only HW executable whose SHA-256 is
recorded in the physics notes. This independently expressed implementation does
not incorporate reference-project source code.

| Function / region                                                      | Evidence and implementation                                                                                                                                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GeneralisedPositionExternalCamera `0x410c60`                           | COM framing, default Float32 zoom 0.2, distance `sqrt(zoom)+4/6.9`, height increment `zoom²+0.3`; rational height filter. `src/camera/chase.ts`.                                                              |
| SwingCamera `0x411980`                                                 | Native angle quantization, low-speed wheel lever, angular tracking, reverse history and collision mode; numerical tests.                                                                                      |
| PointCameraAtCar `0x411fc0`                                            | Aim inclination uses quantized FOV/5. No generic forward target offset or speed-dependent camera distance.                                                                                                    |
| AllocateCamera `0x47e2f0`, GENERAL load `0x486ffc–0x487012`            | Original FOV becomes BRender angle 10112 (55.546875°); authored near planes are doubled to 0.06 and 0.02. `settings.ts`.                                                                                      |
| CollideCamera2 `0x4122b0`                                              | World segment extends 1.25 times the proposed COM distance; face-plane correction and own-shape ray clearance use three near planes. `world-clearance.ts` and `own-shape.ts`; integrated into the live chase. |
| `0x412f67 → 0x4133fa`                                                  | Own-car clearance is unconditional, even without nearby world faces. Public reconstruction incorrectly nests it under the face count.                                                                         |
| `0x413567`                                                             | Only negative/start-inside shape hits repeat clearance; positive boundary hits move to boundary plus clearance and stop.                                                                                      |
| `0x412d9f–0x412e23`, `0x41319b–0x413236`                               | Bounds have separate min/max; second-plane correction uses the orthogonalized second normal, not the first. Parallel-face substitution reduces the working count to two.                                      |
| CollideCameraWithOtherCars `0x413580`                                  | Installed function is empty. Other vehicles should not obstruct the camera.                                                                                                                                   |
| PrepareCars `0x4163d7–0x4163f9`, APTCPostCollision `0x416162–0x416191` | Camera collision flag accumulates accepted solver contacts across the entire frame. Zero impulse is not an exclusion. `contact-frame.ts` and simulation aggregation.                                          |
| PHIL tail `0x4b689b–0x4b68ff`                                          | Previous final-step contacts carry over only when the preceding physics tick exceeds frame end by more than zero and at most 40 ms. Public reconstruction's 0.4-second limit is wrong.                        |
| Ray filtering `0x45d52b–0x45d533`                                      | Ordinary camera rays conditionally exclude material prefixes `!`, `>` and `?`; two-sided/always-visible flags affect backface eligibility.                                                                    |

Nearby-face picking is separately verified at `FindFacesInBox 0x4b5570`,
`ActorBoxPick 0x45fdc0` and `ModelPickBox 0x460490`. It clips triangles
against six box planes and accepts at least three retained vertices, including
boundary contact. It does not filter pling materials. Nearby normal flipping
uses only TWO_SIDED (0x1000), while ray visibility accepts 0x1800. The original
actor/material-group order before the six-face cap remains to be integrated;
current physics cell order is not proof of that ordering.

## Runtime integration and explicit deviations

- GENERAL projection, COM pose, angular/wheel state, original zoom controls
  and accepted contact flags are wired into the rendering loop.
- Track Yon factors are applied to the original scene far plane; a separate
  sky-only pass preserves the original sky texture beyond that plane.
- World queries use true 3D triangles, six-plane nearby clipping and original
  material filters. Flagged camera-blocking noncars are queried. Prepared native
  actor/material-group candidate order remains REN-04; cell order is an explicit
  deviation before the six-face cap. `noncar-ray.ts` now implements the verified positive
  second-probe path: native hits update the chosen fraction
  (`0x4125dd–0x4125ec`), omitted in rec2, and retain local inward normals.
  A second probe starting inside a box/sphere can consume uninitialized or stale
  native outputs; the deterministic browser helper preserves the collision flag
  but declines placement from that undefined result. This is an explicit
  deviation, not a verified native inside fraction.
- Production Chromium checks real driving, reverse, wall contacts, zoom keys,
  camera modes, sky and paused debug recovery. Cadence assertions, orbit/reset controls and
  bounded startup framing also pass in the production Chromium harness.

ShapeRayCast is installed at `0x461c40` (the public reconstruction is a stub
with a different annotation). Its dispatcher uses only the supplied head shape;
it does not traverse the `next` field. Both external-camera and own-car callers
pass that head pointer. The camera helper therefore ignores successor hulls,
while ordinary body collision still uses all authored shapes.

Track camera distance is read from the ordered footer: after splash assets,
LoadRaceInfo reads the Yon multiplier and then the terminal track filename.
`track-settings.ts` retains native Float32 values without inventing a clamp.
All 51 Stock and 73 Advanced race-track footers audited have multiplier 1.0.
A runtime perspective camera still needs a valid far/near relation; malformed
custom factors must produce an explicit compatibility error, not silent scaling.

## Browser baseline

The historical Playwright/Chromium baseline used the preceding camera: 65° FOV,
near 0.035, far 1800, aspect 1.6. On New City, Eagle camera distance to visual
bounds center is about 1.681 model units. Bigdump is about 1.916 and its sampled
bounds extend beyond the frame; screenshots show foreground clipping. Original
geometry remains unchanged. Console, network and WebGL errors were empty.
The baseline report and screenshots are under ignored `artifacts/`. This is
baseline evidence, not verification of the reconstructed camera in gameplay.

## Large-car startup framing and browser cadence

The installed camera zoom is a global Float32 initialized to 0.2 at 0x654bf8.
Its writes are camera controls and save/restore; no per-car automatic zoom was
found. InitialiseExternalCamera at 0x413590 resets COM height, not zoom.
The countdown camera adds temporary height, but does not provide persistent
large-car framing. Original Bigdump clipping has not been observed by running
the Windows game; it is inferred from verified formulas and original geometry.

The browser initially reproduced an async integration defect: while loading
Bigdump, RAFs consumed the reset for the previous Eagle. Moving reset to final
body publication corrected the elevation, but the native 0.2 pose still left
Bigdump's rear filling the view. `startup-zoom.ts` is therefore an explicit
browser extension: retain 0.2 when original visual bounds fit, otherwise select
the first fitting zoom up to native maximum 2. Own-head-shape clearance and the
authored hither participate in that projection. It runs once per car load,
resets the initial zoom for that selection, does not change model scale, and
leaves normal +/- controls and all subsequent native pose equations active.

Native UpdateCamera runs once per gameplay loop. Chase update is stateful even
with dt=0: repeated RAF-only calls can change reversal and swing history. Main
therefore advances it only for an accepted GameFrame or explicit reset.
Additional RAFs recompute read-only aim from the displayed COM and retain the
published camera position. Reset retains the current travel direction, using
normalized velocity above the native speed floor; new cars seed their forward
direction. Paused recovery requests a fresh reset without advancing game time.

## Manual controls and exact vehicle-travel quirks

Normal DoCameraControls is inlined in `0x410c60`. Zoom applies farther before
closer, with the original Float32 `dtMs*5/10000` step and limits .1/2. Orbit
uses Float32 `.05*dtMs` degrees and dynamic angle factor65536/360, with sign
reversed for reverse viewing. Installed consumers `0x410f67–0x411004` reset yaw
and latch reset when both orbit keys are held; only releasing both clears it.
Browser keys are `[`/`]`; +/- controls zoom. Outer held-key `manualMove` differs
from SwingCamera's internal yaw-change test and is passed independently.
MoveWithWheels' folded thresholds are literal `180/45/135*182`, verified at
`0x41119e–0x4111bb`; do not replace these with dynamic degree conversions.

FinishCars is installed at `0x416520` (rec2 annotation416500 differs). It uses
the interpolated actor orientation and first-motion speed floor, independently
of camera mode. At low speed the native speedometer dot uses an untransformed
local +/-Z temporary (`0x4166ca–0x416741`); above the floor it uses world forward.
The browser travel helper and numerical rotated-car test preserve this quirk.

Runtime checks use production Chromium through Playwright because Chrome
DevTools MCP tools are not exposed in this session. Screenshots were inspected
visually, and console/request/WebGL errors are collected. Software WebGL checks
do not establish hardware-driver performance coverage (QUA-05).

## Own-shape clearance bound after crush

Installed ShapeRayCast (`0x461810–0x46194c`) clips stored planes, including
planes whose auxiliary polygon is incomplete after crush. It does not bound
the ray by the retained vertex radius. The browser guard now derives its
repeat budget from the first positive outward plane exit, preserving the
native inside stepping and positive-boundary stop. A ray without a finite
exit still reports an explicit error. Numerical tests include original
Buggy structural bending and a synthetic plane/vertex mismatch regression.
Earlier Chromium crashes intermittently hit the former vertex-radius guard;
no failing hull snapshot was captured. Three subsequent full crash runs
passed before this correction, so the intermittent failure's exact cause
remains unverified. The browser harness now captures the hull and camera
state if it recurs.
