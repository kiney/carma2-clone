# C2 external camera evidence

Status: reconstruction in progress for REN-05. Pure camera modules and contact
state are implemented; the application still uses its previous chase camera.
No vehicle model scale change is indicated by the asset audit.

Evidence sources: rec2 is a map, not the final specification. The addresses below
were checked against the installed read-only HW executable whose SHA-256 is
recorded in the physics notes. This independently expressed implementation does
not incorporate reference-project source code.

| Function / region                                                      | Evidence and implementation                                                                                                                                                                                |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GeneralisedPositionExternalCamera `0x410c60`                           | COM framing, default Float32 zoom 0.2, distance `sqrt(zoom)+4/6.9`, height increment `zoom²+0.3`; rational height filter. `src/camera/chase.ts`.                                                           |
| SwingCamera `0x411980`                                                 | Native angle quantization, low-speed wheel lever, angular tracking, reverse history and collision mode; numerical tests.                                                                                   |
| PointCameraAtCar `0x411fc0`                                            | Aim inclination uses quantized FOV/5. No generic forward target offset or speed-dependent camera distance.                                                                                                 |
| AllocateCamera `0x47e2f0`, GENERAL load `0x486ffc–0x487012`            | Original FOV becomes BRender angle 10112 (55.546875°); authored near planes are doubled to 0.06 and 0.02. `settings.ts`.                                                                                   |
| CollideCamera2 `0x4122b0`                                              | World segment extends 1.25 times the proposed COM distance; face-plane correction and own-shape ray clearance use three near planes. `world-clearance.ts` and `own-shape.ts`; runtime integration pending. |
| `0x412f67 → 0x4133fa`                                                  | Own-car clearance is unconditional, even without nearby world faces. Public reconstruction incorrectly nests it under the face count.                                                                      |
| `0x413567`                                                             | Only negative/start-inside shape hits repeat clearance; positive boundary hits move to boundary plus clearance and stop.                                                                                   |
| `0x412d9f–0x412e23`, `0x41319b–0x413236`                               | Bounds have separate min/max; second-plane correction uses the orthogonalized second normal, not the first. Parallel-face substitution reduces the working count to two.                                   |
| CollideCameraWithOtherCars `0x413580`                                  | Installed function is empty. Other vehicles should not obstruct the camera.                                                                                                                                |
| PrepareCars `0x4163d7–0x4163f9`, APTCPostCollision `0x416162–0x416191` | Camera collision flag accumulates accepted solver contacts across the entire frame. Zero impulse is not an exclusion. `contact-frame.ts` and simulation aggregation.                                       |
| PHIL tail `0x4b689b–0x4b68ff`                                          | Previous final-step contacts carry over only when the preceding physics tick exceeds frame end by more than zero and at most 40 ms. Public reconstruction's 0.4-second limit is wrong.                     |
| Ray filtering `0x45d52b–0x45d533`                                      | Ordinary camera rays conditionally exclude material prefixes `!`, `>` and `?`; two-sided/always-visible flags affect backface eligibility.                                                                 |

Nearby-face picking is separately verified at `FindFacesInBox 0x4b5570`,
`ActorBoxPick 0x45fdc0` and `ModelPickBox 0x460490`. It clips triangles
against six box planes and accepts at least three retained vertices, including
boundary contact. It does not filter pling materials. Nearby normal flipping
uses only TWO_SIDED (0x1000), while ray visibility accepts 0x1800. The original
actor/material-group order before the six-face cap remains to be integrated;
current physics cell order is not proof of that ordering.

## Remaining integration work

- Wire GENERAL projection, COM pose, angular/wheel state, original zoom controls
  and accepted contact flags into the rendering loop.
- Load each track's Yon multiplier and preserve sky rendering with the shorter
  original scene far plane.
- Adapt world queries to original face selection/filtering; handle flagged
  camera-blocking noncars. Native positive noncar hits update the chosen fraction
  (`0x4125dd–0x4125ec`), omitted in rec2. Native local normals and start-inside
  stale output require careful handling, not an invented stable fraction.
- Validate original Eagle and Bigdump, obstacles, reverse movement, camera
  changes and recovery in Chromium after integration.

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

Playwright/Chromium baseline uses the existing production camera: 65° FOV,
near 0.035, far 1800, aspect 1.6. On New City, Eagle camera distance to visual
bounds center is about 1.681 model units. Bigdump is about 1.916 and its sampled
bounds extend beyond the frame; screenshots show foreground clipping. Original
geometry remains unchanged. Console, network and WebGL errors were empty.
The baseline report and screenshots are under ignored `artifacts/`. This is
baseline evidence, not verification of the reconstructed camera in gameplay.
