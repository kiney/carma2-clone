# C2 car-to-car sparks

## Evidence and scope

Verified by static inspection of the read-only installed HW executable,
SHA-256 `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
PE32 base `0x400000`, entry RVA `0x177eb0`, linker 5.10, timestamp
1998-10-18 20:13:36. Section VA/file offsets: text `0x401000/0x400`,
rdata `0x588000/0x186c00`, data `0x58e000/0x18c800`.
rec2 is the symbol/structure map; its spark creator is a stub. Implementation
is independent, with no reference code or original asset fixtures copied.

| Routine/provider          | Installed address   | Confidence                              |
| ------------------------- | ------------------- | --------------------------------------- |
| Car/car dispatcher branch | `0x41d376–0x41d5aa` | Installed instructions                  |
| CreateCarCarSparks        | `0x4f8020`          | Installed instructions                  |
| Shrapnel shower outlet    | `0x4f8590`          | Installed instructions; separate module |
| Spark renderer            | `0x4f71e0`          | Installed + rec2 reconstruction         |
| GetSimpleMaterial         | `0x488c70`          | Installed instructions/table            |
| LoadCarShrapnelMaterials  | `0x488da0`          | Installed instructions + rec2 parser    |
| Simple RGB table          | `0x655fc8`          | Installed 12-entry table                |
| Simple material cache     | `0x7496a0`          | Installed 32-slot cache                 |

## Qualified caller packet

The caller requires primary rigid type 1 and a valid owner car pointer,
grouped lambda strictly above Float32 `0.02`, and a secondary rigid type 1
with its owner car pointer (`0x41d376–0x41d3d1`). At least one body's
world linear velocity squared must exceed double `0.0009`
(`0x41d43d–0x41d4ab`). The packet uses the group primary/secondary order,
not an arbitrary player-first order.

The primary group force is the sum of each grouped primary local normal
times its solved lambda (`0x41d0c5–0x41d0fd`). The contact position is
the lambda-weighted primary local contact offset divided by total lambda,
then plus primary centre-of-mass offset (`0x41d254–0x41d2a3`). Transform
position with the primary rigid full transform at `+0x8c`; transform force
with its linear part, then multiply each stored component by double `6.9`
(`0x41d517–0x41d566`). Browser local contact points already relative to
the model origin do not need an additional centre-of-mass offset.

The velocity argument is **secondary rigid world linear velocity**, from
rigid `+0x68/+0x6c/+0x70` (`0x41d4b1–0x41d510`). X and Y are doubled,
spilled to Float32, multiplied by Float32 `0.5`, then spilled again. Z is
doubled and halved while live before its sole spill. There is no relative
velocity subtraction, angular point velocity, or velocity scaling by 6.9.
The downward-motion force doubling at `0x41d5e8–0x41d61c` belongs only
to the world branch, and does not apply here.

At `0x41d593`, ECX is mutable world position, EDX mutable secondary world
velocity, stack arguments raw world force, primary car, secondary car.
The allocator mutates all three vectors. Supply packet-owned copies;
do not overwrite gameplay impulses or rigid velocities. Browser dispatch
must run at the source pre-impulse barrier, before applying solved normal
and friction impulses, and preserve primary/secondary order.

## Allocation, attachment and random stream

Let `L = length(worldForce)` evaluated live, and `F = f32(L)`. If `L < 10`,
return before RNG or caller-vector mutation. Otherwise call shrapnel
`0x4f8590` with world position, world velocity, `f32(worldForce/L)`, stored
`F`, primary car, secondary car and two zeros (`0x4f80ae–0x4f80c6`).
This call happens **before** the spark eligibility gate and must share the
CRT stream with subsequent spark scatter.

Sparks qualify if either car has driver greater than 5 or flags `+0x100`
containing `0x200000` (SPARKY). Driver 8 is the local human per rec2's
driver enum; 6 is an opponent, 7 a network human. Owner attachment is
primary only if primary driver equals 8, otherwise secondary
(`0x4f8063–0x4f8077`). No material-dependent sparkiness is used here.

After eligibility, compute `D = f32(F*F)` and world tangent velocity
`Vt = f32(V - worldForce*dot(worldForce,V)/D)`. Inverse-transform Vt
using the **primary actor basis transpose**, even when secondary owns
the sparks (`0x4f8117–0x4f8185`). Subtract the chosen owner's actor
translation from position, then apply that owner's basis transpose.
Apply the owner's basis transpose to raw force as well, without
normalizing it. Store these local P/V/force values into caller objects
(`0x4f8190–0x4f81f8`). This mismatched-frame case is native behavior.

Count is `min(20, 3 - trunc(F*f32(-0.1)))`; there is no count RNG draw.
Each record draws Z then Y then X. Z/X bounds are `[-1,1)`, Y
`[f32(-0.2),1)`. Store the random vector R without normalization.
Scatter is `f32(R - localForce*dot(localForce,R)/D)` and record velocity
is `f32(scatter + localVt)`. Position is local P, stored normal is zero,
car is the selected owner, lifetime is 1000, colour byte zero.

Records use the **same** 32-slot, 64-byte ring at `0x6a8210` as world
sparks. Cursor `0x6a8c08` wraps after 31; live records are overwritten.
Mask is `0x6a8c0c`. Record sync duration comes from `0x748784`, which
the physics loop updates as `frameEndMs - current40msStepStartMs`
before each step, then resets to 1 after the physics loop. Render updates,
gravity, final expired draw and attached live actor transforms remain in
the shared spark renderer described in [world spark notes](c2-sparks-re.md).

## Original simple-material providers

`LoadCarShrapnelMaterials` reads the explicit count and then that many
configuration lines immediately after mechanics. It stores count at
car `+0x6c` and the resulting pointers at `+0x84 + 4*i` in authored order.
The installed loop does not cap the list to rec2's apparent three-element
array. Original configurations with four entries must retain four entries.
This list is separate from the car model's rendered materials. Each name
is resolved with `GetSimpleMaterial(name, driver>5 ? 2 : 1)`.

For an M name, `10*(name[1]-'0') + name[2]-'0'` selects the high byte of
the simple-colour table; the low 24 bits provide RGB. The `.MAT` suffix
does not cause file loading. Non-M names parse literal `r,g,b`. A cache
reuses an existing material by RGB alone, so later shading requests for
the same RGB do not change the first material's shading. New entries get
identifier `Simple`, nearest palette index, index range zero and the
requested GlorifyMaterial shading type.

| Name | RGB       | Name       | RGB       |
| ---- | --------- | ---------- | --------- |
| M00  | `#5d0303` | M02        | `#a56e04` |
| M03  | `#a9a905` | M08        | `#006868` |
| M13  | `#3c3626` | M14        | `#212121` |
| M21  | `#284c21` | M25        | `#00326a` |
| M26  | `#93491d` | M30        | `#c0bfc0` |
| M35  | `#141414` | terminator | zero word |

The shrapnel fallback `GetSimpleMaterial("M14.MAT",4)` is dark grey,
not black or palette index 4. Shading type 4 is AmbientOnly per rec2's
enum; the installed resolver forwards that argument unchanged to
GlorifyMaterial `0x517d50`. Shading types 1/2 are Default/Specular.
Detailed BRender-to-Three shading remains a renderer adaptation.

## Implementation and limits

[car-sparks.ts](../src/car-sparks.ts) is an independent producer with an
injected `allocateNative(record)` outlet. The caller supplies the shared
SparkSystem ring, original actors, drivers/SPARKY flags, native sync duration,
and shrapnel outlet. It consumes the shared native RNG by default. Missing
shrapnel providers produce a bounded diagnostic rather than hidden invented
RNG skips. No independent car-only pool or fabricated materials are created.

Eight numerical tests cover gates, pre-gate shrapnel RNG, driver/SPARKY
selection, the primary/secondary frame quirk, raw-force projection, count
cap, shared ring wrap, clocks and invalid inputs. Render behavior is covered
by the shared SparkSystem tests. Native Float32 field stores and major
intermediate stores are modeled; JavaScript double evaluation does not
emulate every x87 80-bit intermediate rounding. Actor inputs must supply
the native orthonormal rigid basis; transpose is deliberately not a general
scale/shear inverse. Production collision packets now retain native primary/
secondary order, use the strict grouped-lambda and either-body linear-motion
gates, and dispatch before solver velocity changes. Chromium car/car crashes
with original Eagle3, Buggy and Newhawk create shared sparks and original
fragments with zero WebGL errors. Type-one noncar/detached-owner packets now
retain independent weighted contacts, forces, own actors and native driver
values, even without an ordinary damage receiver. Three numerical production
resolver tests cover reversed prop groups, semi/free/split owners, SPARKY
world dispatch and suppression for unsupported secondary types. Detached
wrappers do not inherit their parent's SPARKY flag or shrapnel palette; native
zero-filled wrapper fields are retained. Visual checks for these additional
owner classes remain open.
