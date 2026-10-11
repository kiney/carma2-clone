# Detached pedestrian bone body initialization

Evidence is the read-only installed `carma2_HW.exe`, SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`,
PE32 image base `400000`, entry `577eb0`. rec2's
`src/carma2/common/pedestrn.c` maps `SetUpCharacterForm 404f60`; its
allocation switch has a fallthrough that the installed binary does not have.
The implementation is independent, with no copied reference code or asset data.

## Ownership and call order

Sever `40b8ff–40b937` selects the existing body from the FORM boned slot and
the current render bone ACT from the render slot. It reads **that ACT's current
MODEL** (`ACT+18`) and its MODEL bounds (`MODEL+34`). It calls `4085f0` with
the character in ECX and that existing body in EDX. The nine stack arguments
are ACT, MODEL bounds, NULL COM override, selector3, extra1, register1,
subindex0, NULL line endpoint A, NULL line endpoint B.

`4085f0` copies the ACT's own `+2c` matrix to body `+8c`, updates the existing
shape, bounds and inertia through `4087b0`, stores the character at `+23c`,
and writes type `selector+2` at `+238`. The detached selector therefore gives
type5. It sets ec/ed1, zeros world V `+68`, BODY omega `+74`, auxiliary omega
`+1c0` and solver local V `+1a8`, writes subindex0 `+190`, world friction1
`+60`, and clears current/previous volume pointers `+258/+25c`.

FORM setup `4059f7–405a8e` allocates each body once per boned slot, assigns its
per-bone mass, and allocates its authored shape. Mass comes from kg/1000; the
runtime receives the parser's retained Float32 tonnes. The initializer does
not replace this with the personality's whole-character mass. It is not a full
body memset: the new adapter requires explicit retained collision flags and
object friction from the body-slot owner.

Immediate PHIL add `4b6050` occurs before properties and collision fill.
Nonzero add return gives initializer return0 at `408702`; the body preparation
has already happened, but no property calls or filters follow. Normal PHIL add
`4b5b77–4b5ba1` gives state1 and sets passive body flag20. Header allocation,
the bounded100 shared capacity, and FORM boned-slot reservation belong to the
host. This adapter does not create another unbounded allocator.

On success, the exact property call order is:

| Property |    Detached value | Installed effect                               |
| -------- | ----------------: | ---------------------------------------------- |
| 0        |                 1 | Header gravity scalar                          |
| 3        |                 0 | Clears body flag40; world faces permitted      |
| 4        |                 1 | Sets body flag8; self-sentinel suppression     |
| 5        |                 1 | Sets body flag10; joint-constraint suppression |
| 7        |                 1 | Header flag8 and water-plane D10000            |
| 8        | `Float32[74299c]` | Header level-out scalar                        |
| 6        |                 1 | Header flag4, detached-selector extra property |

Property3 is `(extra==0)` at `408718–40872a`. Sever supplies extra1, unlike
the intact type2 simple-body path; copying that simple body's all-three
suppressions would be wrong. Setter `4b6150` independently updates these flags.
The source type5 fill callback `4cc860–4cc879` then writes filters A40000 and
B50000. It does not install the type2 pedestrian contact/halt callback policy.

Successful registration returns to sever. The owner first marks the missing
bone bit, then `40b961–40b97d` unlinks parent/children and clears link188.
Only when character physics bit4 is set does `40b983–40ba53` activate the leaf:
ec0, raw world V from the supplied vector or character `+d8`, BODY omega from
the already drawn/supplied sever spin, PHIL activate `4b5e30`, ed1, gravity1,
properties3/4/5 zero. Immediate PHIL activation `4b5ec3–4b5ee3` makes header
state2, clears passive body flag20 and header flag2 for this zero activation
argument. There is no further random draw or factor6.9 in this initializer.
The engine stores world angular velocity, so the adapter retains source BODY
omega and separately rotates it through the source ACT orientation.

## Shape, bounds and mass equations

FORM dispatch table `4067b8` maps BOX to `405a40`, LINE to `405a4f`, SPHERE to
`405a78`, and POLYHEDRON/POLYGON/NONE to `405a87` (NULL shape). rec2's missing
break would incorrectly turn those NULL shapes into LINE. Unsupported/null
shape or zero mass inputs fail explicitly in the adapter.

For each axis, `d = Float32(MODEL.max - MODEL.min)`. Sever passes both endpoint
pointers NULL and a NULL COM override.

- BOX (tag0, `408b1b`) copies the current MODEL bounds. No margin is added.
  The adapter builds its exact eight corners/six planes, allowing planar bounds.
- LINE (tag2, `4088e0–4089cd`) chooses the first strict maximum dimension,
  starting from -1. Its endpoints span MODEL min/max on that axis. Other axes
  use `Float32((min+max)*.5)`. It is a two-vertex, one-edge wire, without any
  fabricated thickness or surrounding box hull.
- SPHERE (tag4, `40881e–40887f`) has
  `r = Float32((dy+dx+dz)*Float32(1/6))` and
  `center[i] = Float32(min[i] + d[i]*.5)`.
  `4c5dc7–4c5e18` fills bounds `Float32(center ± r)` and radius-squared
  `Float32(r*r)`. Actual BIPED1/BIPEDF heads are4kg SPHERE; DOG1 head is2kg
  SPHERE. These descriptors must reach native sphere contact dispatch.

**All these shape types use the current MODEL dimensions for their inertia,**
not sphere solid-body moments or the resulting wire/sphere bounding box.
Source `408b67–408bdc`, constant `588390 = Float32(.025)`, spills `dy²` and
`dx²` to Float32 but leaves the other products in x87:

```text
sx = Float32(dx*dx); sy = Float32(dy*dy); C = Float32(.025)
Ix = Float32(M*(dz*dz + sy)*C)
Iy = Float32(M*(dz*dz + sx)*C)
Iz = Float32(M*(dy*dy + sx)*C)
COM[i] = Float32(min[i] + d[i]*.5)
```

The COM calculation is `408be3–408c15`, using constant `588388=-.5` with a
reverse subtraction. Bounds/radius update `4c5e50` uses the shape's bounds
relative to the MODEL origin, not distance from COM. Its min-square remains
extended while its max-square is spilled to Float32; radius uses the square
root before the final Float32 stores. The adapter validates overflow and
singular inertia rather than producing a nonfinite solver body.

## Adapter contract and remaining integration

`src/physics/ped-bone-body.ts` exposes:

- `createNativePedBoneBody`: validates actual ACT/current MODEL snapshot,
  prepared bounds and FORM shape/mass, preserving the actor and model identities.
  It prepares source fields without changing the living scene actor.
- `registerNativePedBoneBody`: asks `supportsShape` first, invokes the host's
  immediate PHIL registration, then commits ordered properties and fill masks.
  A BOX-only collision host cannot quietly register a SPHERE/LINE body.
- `commitNativePedBoneBody`: runs after the sever owner's missing-mask mutation.
  Required `unlink` and `activate` callbacks own external links/header lists.
  It commits the active tail only for a nonnull request activation.

The body has `kind="pedestrian-bone"`, type5, and a discriminated `shape`.
Only BOX produces collision hulls. Sphere/wire collision dispatch, generic
type5 completion/contact callbacks, FORM slot lifetime/reclaim, boned joints
and shared PHIL object/header ownership remain host responsibilities. The
standalone quaternion adapter rejects scaled/sheared/mirrored ACT bases;
native copies a full matrix, so accepting such a basis requires a full-matrix
rigid provider rather than silently discarding it. The production integration
must obtain model bounds from remapped **all source MODEL vertices**, including
unused vertices, with no visual ACT child composition or root/profile fallback.
This module does not add a particle substitute, TTL, type2 damage callback,
generic intact-body gravity preparation, or an independent bone pool.

`tests/ped-bone-body.test.mjs` covers preparation, x87 spill equations, line-axis
ties, sphere-vs-box distinction, registration failure/order, passive/active
flags, raw V/local omega conversion and inactive-character detach. Optional
read-only Stock/Advanced Blokebl, Bandsman and twolf tests use the actual FORM
and remapped current MODEL head/limb bounds; they skip without an installation.
