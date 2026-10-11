# C2 collision shrapnel

## Evidence and address map

Verified from the read-only original installed HW executable, SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
Its PE32 base is `0x400000`, entry RVA `0x177eb0`, linker 5.10,
timestamp 1998-10-18 20:13:36. rec2 supplies a reconstructed initializer,
update and transform; the creator is a stub. This independent implementation
uses installed instructions as its specification and copies no reference code.

| Routine                                 | Installed VA           |
| --------------------------------------- | ---------------------- |
| CreateShrapnelShower2                   | `0x4f8590`             |
| World/general wrappers                  | `0x4f88e0`, `0x4f8900` |
| LoadInShrapnel                          | `0x4f8920`             |
| ResetShrapnel                           | `0x4f8540`             |
| Initializer, embedded in LoadInKevStuff | `0x4fda31–0x4fdb42`    |
| MungeShrapnel entry                     | `0x4f9520`             |
| Ordinary fragment update within entry   | `0x4f99da–0x4f9c00`    |
| DrMatrix34Rotate                        | `0x4f9c10`             |
| FastScalarSinAngle / CosAngle           | `0x511160`, `0x5111f0` |

Pool base `0x6a7810`, 30 records of 44 bytes, cursor `0x6a8c10`,
mask `0x6a8c14`. Fields are actor pointer `+0`, velocity `+4`, sync
duration `+16`, unsigned age/sentinel `+20`, shears `+24/+28` and axis
`+32`. Circular allocation overwrites active records. Reset hides/removes
active actors and clears only the mask, preserving cursor and record data.

## Original providers and initialization

`LoadInShrapnel` loads `data/MODELS/FRAG4.DAT` and `FRAG5.DAT`, scaling
their model vertices by Float32 `0.5`. Slots alternate these two models.
The global fallback material is `GetSimpleMaterial("M14.MAT",4)`, stored at
`0x6b5a20`; actors initially search `DEBRIS.MAT`. Ordinary creation selects
the fallback or the cars' original ordered material arrays (`car+0x6c`
count, pointers starting `car+0x84`). No browser-created triangle substitutes
for original FRAG geometry. Missing providers are diagnosed, while simulation
and verified RNG consumption remain active.

Initialization consumes exactly five CRT draws per slot: shear1 then shear2
uniform `[-2,2)`, followed by axis Z, Y, X uniform `[-1,1)`. Normalize the
stored vector if its live length is greater than Float32 `2^-22`; otherwise
use `(1,0,0)`. Shears and axis persist on reuse. The constructor reproduces
these 150 draws once; root must place initialization in the shared startup
order, after material/model providers exist. Reset does not rerandomize.

## Creator, material selection and RNG

`CreateShrapnelShower2` receives world position in ECX, world velocity in
EDX, and stack arguments normal pointer, force length, car A, car B,
explicit material count and optional material array. World sparks supply the
same car twice and zeros for the last two arguments. It rejects force length
strictly below 10 before consuming RNG (`0x4f8590–0x4f85a8`).

Let `N` be the supplied unit normal and `V` supplied velocity. Lift starts
at Float32 `0.7` for an explicit material array, otherwise Float32 `0.3`;
subtract `V.y` when `V.y<0`. Base velocity is
`f32(V + (0,lift,0) - N*(N.y*lift))`. Count is
`min(20,12*trunc(forceLength*f32(0.1)))`, with truncation **before**
multiplication by twelve (`0x4f85fb–0x4f8637`). Scatter amplitude is
`f32((forceLength+20)*f32(3)*f32(0.005))`, and Y lower bound is
`f32(double(0.3)-baseVelocity.y)`.

Each slot draws scatter in Z, Y, X order: Z/X uniform `[-amplitude,amplitude)`,
Y uniform `[yLower,amplitude)`. Reversed bounds are retained as source
arithmetic. Project scatter tangent to `N`, then add base velocity and store
Float32. Store source world translation, sync from `0x748784`, and age zero.
Allocation does not replace the previous actor's rotation; next update does.

An explicit material array adds one integer draw selecting 0..count-1.
Without it, draw integer 0..2: zero selects the global fallback. Nonzero
adds integer 0..1 (one chooses car A, zero car B), followed by integer
0..that-car-material-count-1. Ordinary creation therefore uses four or six
CRT draws per slot, depending on selection. Missing browser car-material
providers still consume the verified draw, but do not invent a material.
The source `SparkSystem` outlet supplies the same quantized CRT sampler;
`spawnFromSpark` uses it, preserving draw order across both allocators.

## Update, transform and lifetime

MungeShrapnel runs once per game frame before normal scene rendering,
after its smoke-column/splash updates. An active age of `0xffffffff` removes
the actor and clears its bit immediately. Otherwise, move by velocity times
sync duration or frame period times Float32 `0.001`. Nonzero sync is cleared
and **does not advance age**; ordinary frames add frame period to unsigned
age. Gravity subtracts `framePeriod*10*f32(0.00014492753623188405)` from
world velocity Y. Then rotate/shear the actor, preserving translation,
and multiply velocity by
`max(f32(0.1),1-length(v)*f32(1/1.4)*framePeriod*f32(0.001))`.
There is no per-frame random perturbation or bounce/contact simulation.

Rotation uses `(age*182)&0xffff`, converting that BRender angle into
truncated integer degrees by multiplying by double `360/65536`. Thus age
40 uses 39 degrees, rather than directly rotating by 40. Sine/cosine use a
six-decimal integer-degree quarter-wave table. The implementation generates
that table from the sine equation; all 91 generated Float32 values were
compared with the original installed table at `0x65fe68` and matched.
Rodrigues rotation uses the stored axis; BRender pre-shear-X corresponds to
Three `rotation * shear`, with shear Y/Z from local X. Native transforms do
not scale fragment geometry again during updates.

Only age **strictly above** 1000 writes the `-1` sentinel after updating;
the fragment remains visible that frame and is removed on the next update.
Equality 1000 remains alive. Sync can delay this age clock without delaying
movement. Reset preserves insertion cursor, initialized axis/shears and matrices.

## Implemented runtime and remaining integration

`src/shrapnel.ts` exposes `spawn`, the spark-outlet adapter `spawnFromSpark`,
`update(timeMs,framePeriodMs)`, `group`, `stats`, `snapshot`, `clear` and
`dispose`. It owns two cloned half-scale geometries and a private empty
material; original provider materials are borrowed. Tests cover source
numerical velocity, initialization/draw order, threshold/count boundaries,
material branches, spark-stream continuation, ring overwrite, sync/age,
rotation/shear, finite inputs and missing providers. No proprietary fixtures
or original asset files are committed.

Confidence is high for installed allocation, normal projection, material/RNG
selection, timing and transforms. Exact JavaScript versus x87 live precision
at all spill boundaries is not claimed. Complete source startup RNG chronology
and replay remain gaps. Production
loads original FRAG4/FRAG5 once, registers ordered car-file shrapnel colours
through the native 32-colour cache, and binds both collision allocators. Smoke
columns advance before fragments; puffs render after the shared spark ring.
Authored abstract connotations use [their separate wrapper](c2-abstract-shrapnel-re.md)
and the same fragment pool. Chromium checks original Eagle3, Buggy and Newhawk
car/car crashes; modern material lighting remains a documented renderer
adaptation. Type-one noncar and detached body collision packets now feed
this producer independently of ordinary car damage receivers; owner flags
and material lookup do not inherit the parent car. Authored abstract world
and WAM connotations are also connected. Ghost/noncar connotation debris
and complete startup/shared-CRT consumer chronology remain separate work.
