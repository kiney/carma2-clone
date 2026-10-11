# C2 smoke columns, fire animation and surface puffs

## Evidence and address map

Verified from the read-only installed `carma2_HW.exe`, SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
PE32 image base is `0x400000`, entry RVA `0x177eb0`, linker 5.10,
timestamp 1998-10-18 20:13:36. `.text` VA/file offset is
`0x401000/0x400`; `.rdata` is `0x588000/0x186c00`; `.data` is
`0x58e000/0x18c800`. rec2 supplies names and structure hypotheses, with
independent installed disassembly taking precedence. No reference code is reused.

| Routine                 | Installed VA | rec2 annotation |
| ----------------------- | ------------ | --------------- |
| GenerateContinuousSmoke | `0x4fa340`   | `0x4fa5b0`      |
| RenderSmoke             | `0x4fa6a0`   | `0x4fa910`      |
| CreatePuffOfSmoke       | `0x4fb0c0`   | `0x4fb330`      |
| CreateSmokeColumn2      | `0x4fb3c0`   | `0x4fb630`      |
| MungeSmokeColumn        | `0x4fb7d0`   | `0x4fba40`      |
| FlameAnimate            | `0x4fbb60`   | `0x4fbdd0`      |
| DoSmokeColumn           | `0x4fbe70`   | `0x4fc0e0`      |
| InitFlame               | `0x4fc130`   | `0x4fc3a0`      |

Installed columns start at `0x6a7d38`, ten records of 124 bytes; active mask
is `0x6a8c2c`, insertion cursor `0x6a8c30`. Puffs start at `0x6a7370`,
25 records of 44 bytes; active mask is `0x6a8c20`, cursor `0x6a8c24`.
The hardware smoke render records start at `0x6a6e80`, stride 36,
with pointer list `0x6a6df0` and count `0x6a8bfc` (35 entries according
to rec2's reconstructed allocation). Creation is gated by smoke-enabled
global `0x65ec58`.

## Column allocation and napalm attachment

Verified signature:
`CreateSmokeColumn2(mode, actor, car, rigidObject, colour, vertexIndex, lifetimeMs)`.
Both pools use a circular insertion cursor and overwrite its slot, even if
that slot is active. There is no first-free search or full-pool failure.
Replacing an active fire column records its old replay state and removes
its fire actor if the new column is non-fire. New colour zero adds the
column's fire actor to the universe when necessary.

Column offsets are: mode `+0`, car `+4`, rigid object `+8`, actor `+12`,
emission accumulator `+16`, remaining lifetime `+20`, emission count `+24`,
colour `+28`, whiteness state `+32`, flame parent `+36`, three frame
counters `+40`, world source position `+52`, three signed width scales
`+64`, three height scales `+76`, three X offsets `+88`, three Z offsets
`+100`, smudge timer `+112`, source vertex `+116`, upright state `+120`.
Creation stores the supplied references (falling back to `car.rigidObject`
when the object argument is null), accumulator zero, supplied lifetime,
smudge timer 1000, supplied vertex, upright 1 and frame counters 100.
It does **not** initialize emission count or whiteness state; these persist
when a slot is reused.

Napalm impact's installed call at `0x4ceaa0–0x4cead7` supplies mode 2,
character actor, null car, character simple rigid object, colour 0,
a random vertex in the first prepared model group, and lifetime 25000.
The caller passes group `nvertices` directly as the integer random upper
bound; the indexing boundary should be guarded in a browser implementation.
The pedestrian burn/death deadline is separately 15000 ms and does not
shorten this 25-second smoke/fire column.

`DoSmokeColumn` mode other than 1 reads the **current** first prepared
group's position array, stride 32, at the stored vertex index. It applies
the supplied actor's full transform to that local position, then subtracts
0.03 from world Y. Thus moving/animated geometry moves the source; a
center-of-pedestrian particle emitter is an approximation. The returned
local position also supplies the angular-velocity emission calculation.
Mode 1 reads a car model vertex plus its principal-model actor translation,
then uses the car master actor transform. Its upright state has hysteresis:
actor matrix `[1][1] > 0.1` sets upright, `< -0.1` clears it. The inverted
car source-Y adjustment and special Eagle tail path require their own car
integration; they are not needed for mode-2 napalm.

## Lifetime and smoke emission

Verified `MungeSmokeColumn` update order:

1. If remaining lifetime is less than `dtMs`, clear the active bit and
   remove the flame parent for colour 0. Equality performs one last update
   with remaining lifetime zero; expiration occurs on the following update.
2. Subtract `dtMs`, update the live source vertex, animate colour-0 flames,
   then advance the emission accumulator.
3. Add `dtMs` to the accumulator. If it exceeds 200, subtract **dtMs**
   (not 200), increment the emission count, and emit exactly one puff.

That accumulator behavior is verified at `0x4fb969–0x4fb985` and means
emission on every update after the initial warmup, for a fixed frame period.
Do not replace it with an assumed five-puffs-per-second timer.
Emission X/Z adds independent uniform `[-0.03,0.03)` offsets; source Y
adds 0.05 for fire. The whiteness transition (`0x4fb9d1–0x4fba03`) is:
when bit 1 is set and random integer 0..3 is zero, keep only bit 0;
otherwise set the state to 2 if its previous value is at least 1, or -1.
Strength and decay both equal `(isPositive(whiteness)+1)/2`, scaled by
remaining lifetime/4000 when lifetime is below 4000. Puff type is colour+16.

For a rigid object, the emission input velocity is the actor-transformed
cross product `omega × localSource`, plus `6.9 * rigidWorldVelocity`, plus
`2.8985507246` in Y. Without a rigid object it is `(0,2.8985507,0)`.
`CreatePuffOfSmoke` subsequently rescales this input as described below.
The installed velocity-Y addition is at `0x4fbaf9` and uses a **negative**
double at `0x58a0f0`; rec2's reconstruction omitted it.

## Puff initialization and evolution

Creation rejects a source more than 25 actor units from the current camera
reference (`distanceSquared > 625`) unless it lies within that distance of
the alternate camera. It uses the next circular slot only after passing
this gate. It stores frame synchronization time from `0x748784`, source
position, strength capped above at 1, supplied decay, type and replay flag 1.

Verified initialization in actor coordinates:

```text
velocity = inputVelocity / 6.9
velocity.y += 1 / 6.9
radius = 0.1 when (type & 15) == 7, otherwise 0.05
position.y += 0.04 when (type & 15) != 7
position.y += 0.04 unconditionally
```

The position increments come from subtracting the negative float at
`0x58a0d8`. The Y velocity increment subtracts the negative double at
`0x58a0d0`. Fire/smoke puffs therefore start 0.08 above the supplied source;
type 7 glow puffs start 0.04 above it.

`RenderSmoke` first moves all positive-strength puffs with
`position += velocity * (timeSync || dtMs)/1000`, clearing `timeSync`.
It then draws and ages each active puff. The native isolated-puff check
does not compare positions: `0x4fabef–0x4fac08` compares zero with the
squared sum of the two radii. Any later active puff of positive summed
radius marks both non-lonely, regardless of distance. Unmarked strength
is halved before rendering. Type 7 is always marked non-lonely. This is
a verified original quirk, not an intended spatial-overlap algorithm.

```text
aspect = 1 + (radius - 0.05) * 2
type & 16: draw circular puff with radius/aspect
otherwise: draw width radius, height radius/aspect
radius = min(0.3, radius + dtMs/1000 * strength * 0.5)
strength -= dtMs/1000 * decay
if strength <= 0: deactivate
otherwise: velocity *= max(0.5, 1 - dtMs*0.002)
if abs(velocity.y) < 0.43478259 and (type & 15) < 7:
  velocity.y = 0.43478259 if velocity.y >= 0
  otherwise velocity.y += 0.43478259
```

Rendering uses the puff's actual strength; rec2's reference to a render
record's strength is a reconstruction error. The hardware material alpha
is `strength*150/256` (fixed opacity token), vertex tint is shade table
`type&15`, the sprite texture is `SMOKE.PIX`, and records sort by camera Z.
These visual details are reconstructed in rec2's `InitSmokeStuff` and
`RenderRecordedSmokeCircles`; the puff draw-strength load is independently
verified at `0x4fac76` and `0x4fad1e`.

## Three flames and native texture frames

Each fire column has three independent flame sprites. The parent rotates
about Y toward camera orientation and translates to the world source.
Normal update increments each frame counter once per call, independent of
`dtMs`. A counter reaching 20 resets to random integer -5..-1, hides that
sprite and refreshes its parameters:

```text
signedWidthScale = randomSign * uniform(1,1.5) * 0.003
heightScale = uniform(0.5,1) * 0.003
offsetX = uniform(-0.03,0.03)
offsetZ = uniform(-0.03,0)
```

At frame zero, visibility starts only if remaining lifetime exceeds
`30*dtMs` and the car is absent or its rigid world speed squared is below
`11.59420289855` (`0x58a100`). Otherwise the counter resets to -5.
Visible frames 0..19 select the corresponding native pixelmap, size the
unit bottom-anchored quad by frame width/height times the refreshed scale,
and apply X/Z offsets. Width sign mirrors texture orientation. Mode-2
napalm has no car and therefore passes the speed gate. Frame counters
initialized at 100 immediately enter the random negative startup delay.
Replay has a separate frame-increment path; it is outside this integration.

Original fixed frame dimensions at installed `0x65ec60`:
`(20,25), (24,32), (24,34), (28,44), (28,49), (32,53), (28,61),
(28,69), (24,61), (28,64), (24,70), (20,65), (20,64), (20,74),
(28,55), (24,62), (28,47), (20,51), (20,45), (20,45)`.
Loose installed assets are `data/COMMON/flames/PIX16/FLM01.PIX` through
`FLM20.PIX`, with TIFF alternatives in `data/COMMON/flames/tiffrgb/` and
PIX8 alternatives. The loader's logical `FLAMES.PIX` name resolves that
sequence; no such monolithic file is required in this installation.
Smoke is `data/PIXELMAP/PIX16/SMOKE.PIX`; an additional eight-image
`data/COMMON/smoke/sm00000.TIF` sequence exists but is not selected by
the verified `RenderSmoke` puff path.

## Surface dust

Installed `GenerateContinuousSmoke` matches rec2's reconstructed main
equations but confirms the positive-X bound branch, correcting its repeated
negative-X test. Each wheel has its own timer at car `+0x1284`: if timer
exceeds `dtMs`, subtract time and return; otherwise add random integer
200..400 minus `dtMs`, clamp below at zero, and attempt emission.

Wheel contact velocity is `vcs = 6.9*velocityCarSpace + omega × wheelPos`.
No puff is emitted below `dot(vcs,vcs) = 25`. Strength is
`min(1,length(vcs)/25)`. Local wheel point is `wheelPos/6.9` with suspension
distance/6.9 subtracted from Y. For X and Z, select the opposite bounding
face for the velocity sign and compute `(bound-point)/velocity`; a zero
component uses -1000. Take the larger of the two values and add that
multiple of `vcs` to the wheel point, then transform point and velocity
through the car master actor. This projects the emitter toward the car's
trailing bounding edge, rather than leaving it directly below the wheel.

Puff strength is the value above, decay is twice strength, and type is
`8 + wrapped(dustRotate + materialModifier.smokeType - 2)`.
The only installed caller at `0x416701–0x41678d` requires car driver >5,
wheel suspension distance strictly below its axle suspension height,
surface smoke type >=2, and rigid `disable_move_rotate == 0`.
Modulo wrapping here only subtracts values above the dust-table
count; negative smoke types are not handled in this routine. Original
Skid-track/spark behavior remains separate work. All coordinate formulas above retain native actor Y and
the 6.9 conversion; an integration must apply its existing coordinate
mapping exactly once.

## Confidence and limits

Allocation, napalm call arguments, mode-2 live attachment, lifetime/order,
emission timing, puff equations, flame frame/reset gates and surface
numerical kernels are verified from this installed binary. Tint/model/UV
initialization details are reconstructed by rec2 unless explicitly marked
verified. Native replay, Eagle-specific attachment, upside-down car height,
smudge visuals and animation-driven pedestrian prepared-vertex deformation
are not completed by this note.
This is implementation evidence, not a claim that browser rendering or
pedestrian animation already matches the original.

## Independent implementation and validation

`src/smoke.ts` implements the bounded 10-column/25-puff circular pools,
live source-vertex attachment, native frame counters, source numerical
equations, 10 source glows, lazy original textures and 35 simultaneous
smoke/glow render objects. `SmokeSystem.group` is attached to the scene;
`spawnColumn` accepts an optional live actor-local prepared-vertex sampler.
The default sampler maps original source indices through Three's face-corner
geometry and diagnoses unavailable vertices. `spawnSurfaceSmoke` implements
the verified caller gates, independent wheel timers and surface kernel.
Dust RGB values (shade indices 8..15) must be supplied through `shadeColours`
from the original race table; absent colours are diagnosed and hidden.

Column emission uses a 1 ms initial physics sync duration, matching the
native column update's `gPHIL_mechanics_time_sync = 1`. Explicit puffs may
supply their actual physics-to-render synchronization duration. The field
is not an absolute birth timestamp: installed physics `0x4b64f9` stores
frame end minus physics time and `0x4b6885–0x4b688f` reduces it by 40 ms.

Glow rendering preserves the native temporal CRT reseed for the production
shared stream: save one `rand()` sample, seed from the frame clock, draw
aspects and seed back to the saved sample. Puff rendering similarly seeds
back to one saved sample. Injected numerical RNGs use an isolated native
clock stream for glow aspects because a bare callback has no seed operation.
Native replay, exact camera yaw lookup quantization, Eagle attachment and
car smudge rendering remain outside this module. Mode-1 inverted sources
require an explicit rigid-height callback and otherwise diagnose the gap.

`tests/smoke.test.mjs` validates circular overwrite, equality expiration,
live geometry transforms, the accumulator and non-lonely quirks, puff sync
and float equations, flame call-based frames/speed gates, surface projection
and timer gates, and original texture lifecycle without proprietary fixtures.

The live race now loads original SMOKE/FLM textures and race dust RGB tables.
FinishCars supplies each wheel's authored smoke type, actual suspension,
body-axis velocity/omega and transformed bounds once per outer frame. Napalm
contact starts the separate 25-second mode-2 source on a live pedestrian mesh;
burn damage retains its independent 15-second deadline. Wet cancellation,
inactive-burning disappearance and reset stop the associated emitter. Inactive
burn scoring follows its source path without OneLessPed objective increments.
Launch/contact sounds 3701/3702 dispatch normally; positional audio remains
AUD-03. The native inclusive vertex draw is preserved, with its one-past-end
result explicitly clamped to the last valid vertex for browser memory safety.
First material-group candidates resolve the geometry index before original
vertex deduplication. Exact BRender prepared vertex ordering remains ANI-01.

Chromium's controlled F-key napalm scenario verifies burn/source clocks, live
columns, puffs, all three flame sprites and original textures. Its screenshot
shows the flame and persistent smoke attached to the original pedestrian.
Generated screenshots/reports remain in ignored `artifacts/`.
