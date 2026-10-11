# Native track shared-edge flags

`src/native-track-edge-flags.ts` independently ports the installed track-loading
edge pass. It returns new flags/representative arrays and an explicit MODEL
update request; authored DAT records remain unchanged. rec2 `common/world.c`,
`MungeTrackModel`, supplies the symbol map, not copied implementation code.

## Installed evidence

Read-only HW: PE32 i386, image base `0x400000`, entry `0x577eb0`, SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
The inspected executable inlines this pass inside LoadTrack at
`0x505050..0x505502`, before ACT loading, smash/ped specs and ExtractColumns.
No separately callable MungeTrackModel entry was assumed.

- `505061..5050a2`: allocate zeroed `(nvertices+1)` DWORD representatives and
  `nfaces*3` DWORD corner IDs. Original allocation zero-fill is implemented by
  the memory wrapper at `526c1a..23`.
- `5050c8..505163`: ascending one-based representative construction. The outer
  loop **includes the final vertex**, unlike rec2's reconstructed `<nvertices`.
- `505180..5051be`: map each original face corner through `representative[index+1]`.
- `5051c0..5054dc`: increasing earlier face `i`, later face `j>i`, earlier edge
  `l=0..2`, later edge `m=0..2`.
- `5052be`: set later face `j` edge bit `1<<m` on every matched shared edge.
- `5053ee..505426`: stored signed-volume and raw MAT TWO_SIDED gates.
- `505452..50545c`: conditionally set **earlier face `i`** bit `1<<l`; rec2's
  second write to face `j` differs from the installed executable.
- `5054f5..505502`: OR MODEL flags with `0x80`, then call `BrModelUpdate(model,0x80)`.

An independent private 32-bit mapper executes those installed instructions on
private model buffers after calling native CRT initializer `5798e0`. Only service,
allocation/free and model-update outlets are captured/replaced; the original
representative construction, edge loops, geometry arithmetic and gates execute.
All **494 packets match**, including complete representative and face-flag
arrays: 450 generated mixed-scale/duplicate/winding/material cases, 14 signed
threshold cases, and 30 original Stock/Advanced Newcity1, Carrier_mission and
Airport1 MODELs. Probe/input/output files stay under `/tmp/c2-track-edges-*`;
original assets/executable were never changed and no proprietary fixture is
committed.

## Welding and exact arithmetic

For each unassigned one-based `i`, assign its own ID and compare every later
original vertex `j`, including already assigned vertices. On strict distance
acceptance, overwrite `representative[j]=i`. Assigned `i` values are skipped.
This is neither transitive clustering nor an unconditional first-match rule:
a later independent representative may overwrite an earlier assignment.
UVs, smoothing, normals and materials do not affect this pass.

Let `f` be Float32 storage and `x,y,z` the live differences of stored source
positions. The installed weld comparison is:

```text
((x*f(x) + y*f(y)) + z*z) < f(1e-8)
```

X/Y temporary stores are at `505102/108`; Z remains live. The squared result
is not stored Float32 before comparison. Arithmetic follows the original
initialized PC53 path documented in [passive Stillify evidence](c2-ped-passive-stillify-re.md).

An edge matches when its two representative IDs equal the other edge's IDs
in either order. The later edge supplies endpoints `a,b`, later opposite `c`,
and earlier opposite `e`, all read from original positions using those IDs.
With live `x,y,z=b-a`, compute:

```text
bx=f(c.x-a.x); by=f(c.y-a.y); bz=c.z-a.z
cx=f(by*z - bz*y)
cy=f(bz*x - bx*z)
cz=f(bx*y - by*x)
d=f((cx*(e.x-c.x) + cy*f(e.y-c.y)) + cz*f(e.z-c.z))
```

The cross product is `(c-a) cross (b-a)`; its sign matters. Each cross component
and final `d` store Float32. Mark the earlier edge iff:

```text
d < double(.0001)
&& (neither raw MAT has TWO_SIDED/0x1000 || d >= double(-.0001))
```

NULL MAT means no TWO_SIDED flag; ACT inheritance is not consulted. Flags such
as ALWAYS_VISIBLE/0x800 do not substitute for TWO_SIDED. Literal thresholds
are doubles at `58a1b8/58a1c0`, not Float32 `.0001`: both `f(.0001)` and
`f(-.0001)` fall inside the accepted two-sided interval. Existing authored
flag bits remain set; the pass only ORs edge bits.

## Integration and limits

`prepareNativeTrackEdgeFlags({positions,faces,modelFlags})` returns
`faceFlags`, one-based `vertexRepresentatives`, `modelFlags|0x80`, and
`updateMask=0x80`. Raw face `material` requires an actual parsed/generated MAT
object or explicit NULL. The host applies the output to its mutable MODEL and
invalidates/reprepares it before emission. Returning this result does not perform
BRender registration/preparation. Run the pass before source face migration and
preserve raw `sourceFace.flags` as authored provenance separately.

Current production `WorldCollision` consumes `sourceFaceFlags` or raw source
flags, and only permutes edge bits when mirroring render triangles. Batching
retains this array; there is no equivalent shared-edge pass elsewhere. The
production scene adapter now maps per-MODEL results into actual render-triangle
order before noncar/destruction/batching mutations. `WorldSourceTriangle` retains
the current byte separately from immutable authored DAT flags, and prepared-face
emission consumes it. The adapter normalizes load-time MODEL flags before this
pass; no migrated/prepared face identity is inferred from DAT provenance.

Inputs require finite stored Float32 positions, valid uint16 vertex/face counts,
uint16 MODEL flags, uint8 face flags, valid corners and explicit uint32 MAT flags.
Finite coordinates producing a nonfinite cross/volume are rejected explicitly;
unsafe native NaN branch behavior is not approximated. Runtime work remains
quadratic in vertices/faces, matching source iteration. Largest representative
capture has 2,150 vertices and 1,264 faces; warm measured JS executions were
approximately 3–36ms per tested model, with first-use/JIT variance. The production bundle builds; Chromium verifies live flags and driving/race
regression across Stock Newcity/Quarry and Advanced AcidReign. The broader crash
matrix exposed an intermittent Porker2 hull-horizon abort tracked as PHY-11,
which requires an independent source/numerical audit rather than being hidden.

A separate complete Stock-library timing pass resolved every raw MAT and
processed Newcity1's 274 MODELs in185ms, Carrier_mission's94 in106ms, and
Airport1's235 in213ms. The largest individual pass in that run took52ms;
the run included concurrent focused tests/typechecking, so these are observed
load costs rather than benchmark guarantees.

Focused tests cover immutability, final-vertex initialization, overwrite/nontransitive
welding, both winding orders, asymmetric writes, signed volume, raw material
gates, double thresholds, temporary store arithmetic, unsafe inputs and six
original MODEL capture checks. Original tests skip cleanly without installation.

Validation: **14/14 focused tests pass**, including all six original tests with
no skips; TypeScript and focused formatting checks pass. Existing runtime,
source assets and the production bundle were not edited by this task.
