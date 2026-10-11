# C2 surface effects reconstruction

## Executive Summary

Original track material modifiers drive tyre friction, dust/smoke and persistent
tyre marks. Installed instructions establish the per-wheel force producer,
contact filtering, geometry and 100-section mark pool. Original skid materials
retain their fractional PIX transparency. The smoke allocator and renderer are
covered in [smoke evidence](c2-smoke-columns-re.md). The world-contact spark
allocator/renderer is reconstructed in [spark evidence](c2-sparks-re.md);
world/car collision dispatch and the shared car/car allocator are integrated.
Parsed sparkiness alone does not authorize an effect.

## Data and evidence

`src/physics/surfaces.ts` parses wall friction, tyre friction, downforce,
bumpiness, tyre sound, crash sound, scrape sound, sparkiness, smoke type and
skid material. The first material character relative to '/' selects a modifier.
Wheel hits retain the actual face; volume overrides select force/material
parameters without replacing that physical face.

Installed HW SHA-256 is
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
Addresses below are absolute VAs. rec2 supplies symbol and structure maps;
installed instructions take precedence. Implementation is independent.

## Skid marks

`SkidMark` is at `0x4ea200`, continuation/creation at `0x4e9c90`, and
`StretchMark` at `0x4ea030`. Force step `0x4168e0` clears `new_skidding`
(car+0x159c), runs the per-wheel request sites and calls SkidMark for four
wheels at `0x41702c`. Caller `0x415a36` supplies `0.04`: this runs at each
**40 ms physics force step**, independently of graphical frame frequency.

Helper `0x41bd60` rejects missing face data, nested pixelmap type byte `0x12`
(**RGBA4444**, not depth32), and a 12-character material identifier with '|'
at offset 5. It sets a wheel bit and stores its position/normal. Metric wheel
coordinates subtract X offset `odd ? +0.1725 : -0.1725` and suspension
displacement in Y, divide by `6.9`, transform through the current force-step
car pose and project onto the actual face plane. Volume overrides choose the
skid material; eligibility and projection still use the physical face.

Installed constants establish minimum spacing/width `f32(0.05)`, normal
continuity `f32(0.997)` and plane tolerance `f32(0.01)`. Sections may extend
while their **row-zero length** is at most `0.5`, rather than rec2's squared
length comparison. Tiny sections use scale `(0.001,1,0.001)`, also differing
from rec2's uniform scale. Direction/material changes create separate sections.
The 100-section circular pool persists until reuse or track reset, without
fading. Outer-frame `SkidsPerFrame` restores stored world translations.

`SkidMarkSystem` retains four-wheel history for every car. Oil independently
requests `OILSMEAR.MAT` when suspension permits; wheel oil decreases by the
accepted sample's travelled distance, including a continuity failure. Production
no longer consumes that distance a second time in the oil ground adapter.
The current force-step provider retains exact faces, original modifiers and
wheel requests rather than reconstructing marks from speed or chassis yaw.

`SkidMaterialLibrary` reads original MAT/PIX through the local asset service.
Stock SKIDMARK, DESKID and SNOWSKID maximum alpha values are respectively
238, 119 and 51; treating them as cutout textures loses their appearance.
Textures are borrowed from the asset cache. A small browser depth offset avoids
coplanar flicker without changing section coordinates; this is a rendering
extension. Numerical tests cover state, ring reuse, slope/UV transforms, oil,
filtering and material ownership; an installation test checks actual pixels.

## Continuous smoke

FinishCars checks suspension displacement, material smoke type and movement
state. Its wheel-point velocity includes angular motion; original dust palette
rotation and per-wheel 200–400 ms source timers produce puffs. This is an
**outer-frame** effect, unlike the 40 ms skid producer. Installed smoke pool,
source columns, flame textures, puffs and native renderer equations are now
implemented; see [smoke evidence](c2-smoke-columns-re.md) for exact addresses,
verified differences from rec2 and remaining limitations.

## Sparks and remaining scope

Installed dispatcher `0x41d773–0x41d7d4` selects sparkiness by the contact-face
material prefix and calls world allocator `0x4f7af0` after native group/type/
velocity/driver gates. Its mutable point velocity, separately scaled force,
attached second batch and render-frame pool are documented in
[spark evidence](c2-sparks-re.md). Car/car allocator `0x4f8020` and shrapnel
`0x4f8590` use their distinct native paths and share the original spark ring
and CRT stream; see [car/car sparks](c2-car-sparks-re.md) and
[shrapnel](c2-shrapnel-re.md). Do not replace those with generic impact
particles or claim complete source random-stream coverage. Independent smoke
and tyre-mark consumers do not establish complete effect parity.

### Resolved force-driven skid requests

All eight WheelForces marker calls now map to final tyre demand/capacity inputs.
For each axle D=hypot(longitudinal,lateral)/2 and capacities C0/C1 are the
post-material/grip/oil/traction values. Inputs and reduction R are Float32.
Both-over requires D>C0 AND D>C1; its live ratio is
((D+D−C0)−C1)/f32(C0+C1). At ratio>=20 for the current local car, or>=60 for
other cars, each wheel independently requires capacity>double0.1. The ratio
spill to Float32 does not replace its live value in the threshold comparison.
The current-car pointer is verified at0x75914c (gProgram_state base0x7590a0,
current_car offset0xac), not merely driver8.

In a single-over branch, the initial allocation is f32(R\*Cfirst), followed by
live residual=(D−allocation)+D and its Float32 spill. Only if live residual is
strictly above Csecond and Csecond>double0.1 does it compute
(storedResidual−Csecond)/Csecond. That ratio also stays live for the threshold.
Only the second wheel can request a mark; the initially over-capacity wheel
does not. For ordinary nonnegative capacities/reduction the single-over ratio
cannot reach20, but the original branches and stores are retained rather than
replacing them with axle-wide saturation. Equality with a capacity is not
initial saturation, whereas equality with the ratio threshold requests a mark.

Rear both calls0x41ad35/0x41ad55 map wheels0/1; rear left/right cascades
0x41ae4e/0x41af15 map1/0. Front both0x41b1ca/0x41b1eb map2/3; front
right/left cascades0x41b2eb/0x41b3b6 map2/3. Stack+0x28 demand,+0x24/+0x18
capacities,+0x20 stored sum,+0x10 spilled ratio establish these meanings.

`src/physics/tyre-skid.ts` implements the recovered request equations, including
ULP boundary fixtures. WheelForces emits per-wheel MotionDebug.skidRequests;
VehicleSimulation binds explicit local-current-car identity in the shared
motion context. Tyre force allocation and velocity integration are unchanged.
The production force-step callback now applies native contact/material filtering,
oil's independent request and persistent section rendering. Smoke has its
separate native consumer. DMG-03 remains partial while other native spark/shrapnel producers and
complete source random-consumer chronology are incomplete.
