# Native ModelPickBox admission and ordered emission

`src/native-model-pick.ts` independently composes the installed model-space
admission stages and cached-record emission. It accepts an actual current
`NativeTrackModelResource` and the query already rebased by `ActorBoxPick`.
It consumes the resource's complete prepared group/face order before selecting
an admitted capacity prefix. It neither reconstructs ordering from render
materials nor prepares or sorts resources during a query.

## Evidence

The original HW executable is read-only. SHA-256 is
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`;
PE base `400000`, entry `577eb0`, timestamp 1998-10-18 20:13:36 UTC.
The rec2 `finteray.c` annotation names ModelPickBox at `45ff90`; its corresponding
installed function starts at **460490**. The installed instructions and private
numerical captures take precedence over reconstructed C spill assumptions.

| Installed address            | Operation                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `460490..4604c2`             | Load the prepared pointer; capacity zero returns before dereferencing prepared geometry.                 |
| `4604c8..460531`             | Ascending prepared group and group-face enumeration.                                                     |
| `460532..460567`             | Live packed-normal dot against prepared vertex0 minus query center, followed by strict radius rejection. |
| `46056d..460713`             | Strict all-three-vertices outside tests: X minimum/maximum, Y minimum/maximum, Z minimum/maximum.        |
| `460715..4607dc`             | Store each vertex-minus-query-translation component as Float32.                                          |
| `4607e3`, `4607fe`, `460819` | Apply query basis transpose with `BrMatrix34TApplyV(532cd0)`.                                            |
| `46083c..460ce8`             | Six finite clipping passes; each pass requires at least three retained vertices.                         |
| `460d29..460edb`             | Emit original uncut triangle, packed normal, selected material and NULL/non-NULL transform D.            |
| `460eec`, `460f04..460f1b`   | Updateable branch: signed16 record g/f storage; unsigned face-user indexing; full raw byte flags.        |
| `460f23..460f7e`             | Borrow map pointers from the current raw MODEL vertices through the current raw face indices.            |
| `46100b..46101d`             | Write gPling_face only when selected material identifier begins with literal `!`.                        |
| `461023..461043`             | Advance record and consume capacity only after accepted emission; return remaining capacity.             |

Preparation stores each indexed prepared vertex as `f32(rawPosition − pivot)`.
Packed plane preparation uses raw indexed positions, and CopyFace retains its
normal/D without applying the pivot to D. The model's ordinary bounds/radius
also use raw vertices, including unused vertices, rather than prepared positions.
See [prepared plane](c2-prepared-plane-re.md),
[prepared emission](c2-prepared-face-re.md), and
[actor admission](c2-native-actor-pick-re.md).

## Arithmetic and boundary behavior

Inputs are stored Float32. Native CRT initialization `5798e0` selects nearest
53-bit x87 precision (`CW027f`), so unspilled operations use double precision.
Let `f` denote a Float32 store, `v` a prepared vertex, `n` the retained packed
normal, `C/R` the actual query center/radius and `M` its actual twelve components:

```text
reject if abs((n.y*(v.y−C.y) + n.z*(v.z−C.z)) + n.x*(v.x−C.x)) > R
reject if all three vertices are strictly outside any real-bound plane
q = f(v − M.translation), independently per coordinate
local[i] = f((q.y*M[3*i+1] + q.z*M[3*i+2]) + q.x*M[3*i])
```

The first differences, products and sum have **no Float32 spill**. Stored D is
not part of this admission test. For example, `v.x=1`, `n.x=1`,
`C.x=−2^-24`, `R=1` rejects: the live distance exceeds 1, although prematurely
rounding the difference would produce exactly 1. Equality at either radius or
an AABB plane passes those early gates. There is no radius renormalization,
normal normalization or added tolerance.

The transpose transform is not a general scaled/sheared matrix inverse. It
uses the supplied native query basis exactly. The verified
`nativeModelPickFaceInBox` then clips in X minimum/maximum, Y minimum/maximum,
Z minimum/maximum order. Crossing is strict previous-to-current; retention is
inclusive. Degenerate triangles are not rejected by a newly invented area
threshold. See [finite clipping](c2-model-pick-box-re.md).

An accepted row contains the original three prepared vertices, not its temporary
clipped polygon. NULL `pMat` copies stored plane D; a non-NULL identity matrix
still follows the transformed dot-derived D branch. In particular, a nonzero
MODEL pivot can make their D values differ while their emitted vertices agree.
No extra raw80 or material80 rejection exists in ModelPickBox; downstream
single-face/grounding consumers retain their own source gates.

## Provider and ownership contract

`emitNativeModelPickBox(resource, input, options?)` consumes
`NativeActorPickEmissionInput`: stable actual ACT/MODEL identities, actual
inherited MAT identity or NULL, source query, explicit NULL/non-NULL `pMat`,
capacity and existing output offset. Success returns:

- `rows`: ordered `NativeModelPickFace` records compatible with grounding and
  single-face kernels, including actual ACT/MAT identity, native/current face
  ownership and retained original DAT provenance.
- `remainingCapacity`: the supplied capacity minus admitted emitted records.
- `groupSpans`: nonempty prepared group spans with absolute record starts.
- `plingFace`: last admitted literal-`!` material row, or NULL meaning **no
  global write**, preserving an earlier gPling_face value.

The updateable track branch sets `nativeGroup=-1` and stores `nativeFace` as
signed16 bits. `nativeFaceIndex` remains the unsigned current raw face owner;
installed `460f0b` masks it to uint16 before raw-table indexing. `map` borrows the
three current raw vertex UV arrays, rather than copying or inventing prepared
render UVs. The raw face flag byte and every material flag are retained intact.
A prepared NULL-material group inherits the actual supplied MAT only at emission;
that does not merge or reorder it with an own-material group.

`createNativeModelPickEmitter(resolveModel, options?)` is the direct
`pickNativeActorBox` emitModel adapter. MODEL lookup must resolve the actual
resource identity, not another geometry with a similar name. Optional
`resolveMaterial` supplies parsed metadata for an otherwise opaque inherited
MAT identity. If a literal-`!` row is admitted, `writePlingFace` must write the
host's actual retained global state. The adapter writes the final row once per
resolved model call; the pure result performs no host write. Absence of a bang
row does not call the sink or clear prior state.

For actor model bounds, the host unwraps
`nativeTrackRawBounds(resource).value.bounds`; that helper returns both bounds
and radius. Query center/radius generation, source column collection, linked
ACT traversal, rebase and global capacities remain the collector's ownership.
Capacity zero requires no MODEL lookup, query geometry or prepared-data access.
The parent ACT traversal may still continue and call later models with zero
capacity, as the source does.

Missing current preparation/revision, actual MODEL/MAT metadata, literal-`!`
state ownership, or admitted non-updateable edge/model ownership returns an
explicit required-provider result. No geometry/material fallback is used.
Malformed finite/index/capacity values throw, including finite JavaScript inputs
that overflow during Float32 storage. Host mutations must invalidate the shared
resource before a new query; stale prepared faces are rejected. Unresolved
results from a model do not commit that model's temporary output rows.

## Remaining boundaries

Track preparation's bit80 branch is supported. The non80 branch still needs
actual prepared edge identifiers, group/face indices and prepared map storage;
it is not replaced by copied raw flags or guessed boundary edges. Complete
multi-material order requires actual unsigned MAT pointer keys or independently
verified allocation ordinals. The [owned resource arena](c2-native-resource-arena-re.md)
can now provide live byte addresses under an explicit host allocator policy;
this is separate from original Windows load-episode captures. A material name or render first-seen order is not
such evidence. One real material identity plus NULL has proven ordering; missing
multi-key ordering remains an explicit preparation dependency.

This module does not implement BrModelUpdate smoothing/welding, source actor
loading, face migration, original Windows allocation addresses, cache ownership
or actual production collector wiring. Those inputs remain in the released
resource/actor helpers and the collector host. It does implement the complete
finite admission and updateable cached-record step for supplied valid prepared
track resources.

## Validation

A private 32-bit harness calls the whole installed **460490**, initializes
native CRT floating-point mode and supplies invented one-face prepared models.
**4,000 cases, 2,070 admitted rows and 39,190 compared Float32 status/record
components matched exactly with zero differences.** Cases include all early
admission paths, halfULP radius rejection, oblique query bases, finite clipping,
NULL/identity/translated/scaled/sheared output transforms, arbitrary supplied
packed planes and full raw flag bytes. The retained safe oblique fixture is
invented numeric data, not an original asset extract. Private inputs, mappings
and binary outputs remain under `/tmp`; original files were unchanged.

Eighteen headless tests cover capacity prefix/order, nullable-group inheritance,
UV/resource identity, spans/absolute offsets, strict and inclusive boundaries,
finite AABB false positives, degenerate triangles, pivot and D distinctions,
transpose arithmetic, captured emitted values, explicit providers, pling state,
ACT traversal after exhaustion and bounded errors. Read-only Stock and Advanced
Newcity tests each load 273 DAT models and 195 actual MAT resources: 89 resources
have proven preparation order, producing 566 admitted prefix records; the other
184 correctly require multi-material pointer order. This is original table
validation, not proof of a complete migrated production scene or Windows heap
order. Original-installation tests skip cleanly when absent. TypeScript and
owned-file formatting checks pass; no production build was run by this worker.
