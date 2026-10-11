# Current native track MODEL resources

`src/native-track-resources.ts` connects parsed DAT/MAT identity to current native
MODEL tables, migration, cached-face preparation and emission. These resources
remain separate from immutable source DAT tables and Three render geometries.
They are not a complete native track loader or full BRender render preparation.

## Identity and migration

The caller supplies actual loaded MAT objects or explicit NULL/unresolved lookup
results. Raw face material zero remains NULL, rather than acquiring the renderer's
fallback. Source vertices, UVs, pivot and raw face records are independently copied.
Track preparation flags use installed `AddSmoothModels`, `(flags | 0x80) & 0xfdfe`.
Absent UV tables initialize to zero: the installed `BrMemAllocate` at `526c00`
zeros the requested allocation through `BrMemSet` at `53e6c0`; the BRender vertex
reader writes positions separately from the optional mapping chunk. This does not
justify inventing arbitrary partially missing or non-finite XYZ/UV data.

A resource's identity survives `migrateNativeTrackResource`. Remaining faces keep
original source provenance with compacted raw MODEL indices. A generated blendy
resource has a new identity and zero pivot, while its faces retain source MODEL
and DAT face indices. Host registration, original spawning, ACT attachment,
reserve/reallocation and full render preparation remain ordered host actions;
returning an action is not its execution. See [migration evidence](c2-native-track-models-re.md).
The vertex payload adapter here represents only the XYZ/UV fields needed by these
cached-face consumers; it does not claim to reconstruct unused color/normal bytes.

Migration invalidates cached preparation before invoking callbacks, including
failure after partial source effects. Every other host mutation of current tables
must call `invalidateNativeTrackResource`. Repreparation clears any old cache
before resolving prerequisites. Public mutable state is an explicit owner contract,
not automatic detection of arbitrary external writes.

## Cached-face preparation and emission

`prepareNativeTrackResource` uses the installed CRT face permutation, raw positions
and the verified plane kernel. Its groups retain actual MAT identities; face records
separate group/within-group ordinal, compacted native MODEL index and original DAT
index. Prepared positions are copied once. `emitNativeTrackPreparedFace` subtracts
the current MODEL pivot and uses the same verified emission arithmetic as
`emitNativePreparedIndexedFace`; it never indexes a stale render geometry with a
new compacted MODEL index. A NULL group MAT falls back to explicit inherited MAT,
including actual NULL. Unknown inherited material is required only for that branch.

NULL and a single distinct non-NULL MAT have a complete provable relative ordering.
Models with multiple non-NULL identities require an actual pointer/order provider.
Supplied keys must preserve NULL zero and exact MAT equality in both directions;
this validation does not prove the provider's external ordering claim. No material
name/index or render appearance is substituted for native heap order.

This preparation is sufficient to supply cached geometric face records. It does
not implement BRender registry insertion, smoothing/normal welding, render vertex
preparation, non-updateable edge allocation or reserve fulfillment. Non-updateable
models remain unresolved. Finite query admission, actor mutation and capacity
selection are separate owners.

## Raw MODEL bounds and radius

Installed `BrModelUpdate` at `51effe..51f0de` consumes **all raw vertices**, including
vertices no longer referenced by remaining faces. Bounds start with vertex0 and
compare raw coordinates without pivot subtraction. Radius accumulates live
`Y² + Z² + X²`, compares against the retained Float32 maximum and stores only a new
maximum; `BrFloatSqrt` at `53eb20` supplies the final stored radius. The custom-bounds
flag `0x400` skips those updates. `nativeTrackRawBounds` consequently rejects a
missing custom/empty-MODEL retained bound owner instead of deriving an invented box.

## Validation and remaining integration

Seven focused tests cover identity/copy ownership, installed equal-key permutation,
migration/pivot/provenance, genuine NULL inheritance, malformed pointer-equality
partitions, failed preparation/partial callback invalidation, and raw bounds/radius.
Stock and Advanced Newcity each load 273 MODEL definitions and 195 MAT identities:
89 models have a provable NULL/single-MAT order and 184 require multi-MAT ordering.
These are library counts, not selected column or accepted query counts. Original
installation tests skip when absent; proprietary fixtures are not committed.

The production population still uses its prior ground/collision adapter. Complete
native column loading, noncar/powerup mutations, all ordered face prefixes and
normal pedestrian lifecycle integration remain open under WLD-03/PED-03.
