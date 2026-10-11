# Native resource admission and lookup

The installed C2 algorithm separates storage admission from global registry
lookup. MAT admission rejects an exact identifier duplicate and keeps the first
resource in that storage. Lookup folds ASCII case and visits the newest accepted
registration first. Consequently `Grass6` and `grass6` are distinct admitted
resources, while either literal lookup selects the newest matching resource.
Extensions remain part of identifiers; `name`, `name.MAT` and `name.ACT` are not
interchangeable registry keys.

## Evidence

Installed HW SHA256:
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
Original files were read only. rec2 `common/world.c`, `common/loading.c`,
`common/init.c`, `core/v1db/regsupt.c` and registry routines supplied the symbol
map; installed addresses below take precedence over shifted rec2 annotations.
No reference implementation or proprietary fixture was copied.

| Installed address            | Verified operation                                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `501d80`                     | `AddMaterials`: load a complete MAT file, glorify its returned batch, then admit records in file order                                       |
| `523c40`, called at `501da1` | `BrMaterialLoadMany` completes before admission or duplicate frees                                                                           |
| `501dc8`                     | Batch `GlorifyMaterial(517d50)` precedes admission                                                                                           |
| `501e1a..501e45`             | Inlined MAT identifier comparison is byte-exact, case-sensitive `strcmp`; NULL identifiers are not compared                                  |
| `501e63..501e7d`             | Append accepted MAT to its storage; initialize material property entry to zero                                                               |
| `501e8d..501e90`             | Register an accepted MAT through `BrMaterialAdd(51e490)`                                                                                     |
| `501ea3..501ec4`             | Duplicate policy: optional fatal error via `gDisallow_duplicates`; otherwise `BrMaterialFree(51e8e0)`                                        |
| `500fe0`                     | `AddModelToStorage`: exact-name rejection only when storage flags bit1 is set; otherwise append every MODEL                                  |
| `51e390`, `51e4e0`           | `BrModelFind`, `BrMaterialFind`, respectively                                                                                                |
| `529190`, `529300`, `528ea0` | Registry insertion prepends; lookup traverses newest first using ASCII case folding, `*`/`?` patterns and slash pattern termination          |
| `4b4a20`                     | `PFForEveryFile`: first matching mounted TWT supplies increasing raw entry-table order; this branch returns without loose-directory fallback |
| `51bde0`                     | Unmounted directory enumeration uses Windows FindFirst/FindNext, not an alphabetical-sort contract                                           |

Capacity failure precedes duplicate detection. Normal return codes are zero for
capacity exhaustion, one for duplicate and two for admitted. The current adapter
implements ordinary supported admission, not native fixed storage capacity or
the optional duplicate-fatal mode.

The rules are not track-only. Installed `LoadCarMaterials(4f64d0)` invokes
`PFForEveryFile(4b4a20)` with material callback `502740`, which calls the same
`AddMaterials(501d80)` at `502784`. Initial ordinary car, opponent, drone,
pedestrian and track storage setup calls `InitialiseStorageSpace(500af0)` with
flags zero (`47e101..47e188`). Thus ordinary MODEL admission retains repeated
identifiers for these stores too. A caller explicitly setting storage bit1 must
retain the alternate rejection policy. Native opponent storage spans multiple
car loads; admission scope is that storage, not automatically one car directory.

## Current binding

`src/native-resource-registry.ts` retains admitted resource identities in
insertion order and performs newest-first native name matching. `Assets.scene`
in `src/content.ts` records each MAT episode with path, record index and accepted
status; it allocates the entire parsed file in `NativeResourceArena` before
freeing rejected records. Every DAT record is retained in `sourceModelStorage`,
including repeated names. `findSourceMaterial` and `findSourceModel` are the
native lookup outlets. Compatibility name maps still normalize extensions and
case; native consumers must use the lookup outlets and actual objects instead.

`sourceModelGeometries` preserves MODEL-to-geometry ownership.
`sourceActorObjects` preserves initial authored ACT-to-live-object ownership;
extra ACT loads receive separate crosswalks while borrowing that scene's
resources. Raw DAT material references resolve through accepted MAT identities,
not rejected records or the compatibility maps.

`server/assets.mjs` exposes archive-table or host-directory enumeration metadata.
`Assets.files` uses those indices within a directory despite the presentation
manifest being sorted. Loose overrides retain a mounted entry's position. Extra
loose files remain a supported host mod policy; original mounted enumeration
does not append these files. Linux host-directory enumeration is not claimed to
reproduce Windows enumeration.

In both Stock and Advanced Newcity, first admitted `advert2`, `advert3` and
`cinema01` materials have flags `0x1001`; later exact duplicates have `0x21`
and are rejected. Replacing the first resource with the later record loses the
native two-sided flag. Airport's case-distinct `Grass6`/`grass6` exemplifies why
lowercase admission is wrong. Repeated MODEL episodes include Newcity
`&petpump.act` and Airport `&barrier_gate.act`; they remain separate storage
resources even though newest-first lookup returns only one match.

## Limits of this binding

The arena's addresses are live owned host byte offsets, not recovered Windows
heap addresses. Whole-file MAT allocation/free ordering is retained, but
pixelmap, identifier-child and other resource allocations, native default
resource allocations and complete ACT allocation chronology are not reproduced.
Opaque host MAT records do not claim native field serialization. These gaps can
change pointer-sorted prepared-group order and finite collector prefixes; see
[resource arena](c2-native-resource-arena-re.md).

The Assets-owned global MAT/MODEL registries now retain registrations across
scene loads, with exact admission scoped to explicit shared storage keys.
Startup REG material/model resources are now admitted from their actual files
into persistent storage. Installed `DRLoadMaterials(0x48f020)` clears LIGHT and
uses direct `BrMaterialAddMany`, bypassing track storage duplicate rejection;
`DRLoadModels(0x48f080)` whitens ordinary vertex RGB, overwrites flags with
UPDATEABLE and registers the real three common powerup MODELs. This includes the
`&70POWERUP1.ACT` fallback missing from Junknet's race DATs. Startup resources
remain live after race storage teardown. Each MODEL's captured MAT-index table
is exposed as `sourceModelMaterialBindings`: it records load-time lookup
pointers/NULLs, so subsequent global registrations cannot silently rebind faces.
Opponent loads can share their storage. Race teardown removes scene-owned
registrations and frees arena/GPU resources; generated default-track and black
materials remain persistent. See [material rendering](c2-native-material-render-re.md)
for shading/fog, source identity preservation and the two clone ownership modes.
The extra car master-actor material and later identifier-prefix mutation remain
separate loader behavior. Pixelmap and shade-table registries still use the
existing host lookup adapter; this is not complete global BRender ownership for
every resource class.

Initial authored ACT ownership feeds the production `prepareNativeWorldScene`
load owner and `WorldCollision.collectFaces` prepared-face query. See the
[production collector](c2-wld-production-collector-re.md) for load callbacks,
model preparation and the remaining host-allocation/address limitations.
Generated default-track and black MATs are explicit persistent identities in the
shared arena. Changing-powerup global MODEL copies additionally lease the exact
borrowed MAT identities through `Assets.retainNativeMaterial`: storage lookup is
still removed, but leased arena/render/texture resources remain live. This host
policy deliberately avoids the original's possible stale pointers and heap
address reuse; see [material ownership](c2-native-material-render-re.md). Native NULL material slots retain inheritance; a renderer helper
cannot replace those identities in the physics collector.

Installed `FopRead_MATERIAL_INDEX(0x522a40)` stores the exact return from
`BrMaterialFind(0x51e4e0)` at `0x522a9b`, including NULL. `FopRead_FACE_MATERIAL`
copies the selected table entry at `0x522e18..1f`; ACT material loading stores
the same lookup return at `0x52316e`. An authoritative completed registry lookup
returning no resource is therefore a resolved native NULL, not a missing
provider. Missing provider callbacks remain separate failures.

Advanced Desert's literal `!/75WATER` MAT is admitted in `DESERT_mission.mat`,
but a lookup with that literal returns NULL: slash dispatch in
`BrNamePatternMatch(0x528ea0)` reaches `0x528f0c`, which requires the candidate's
current character to be NUL. The candidate still contains `/75WATER`. The model
`15 8` has a nonzero raw DAT index for this name; renderer binding now retains
that raw index while applying native NULL/actor/default inheritance. It does
not normalize the slash or fabricate a replacement MAT. The Advanced Desert
DAT inventory has exactly this one failed named lookup.

Generated black is identified as `Simple`, rather than the input selector
`M14.MAT`, and has the actual closest palette index/range zero. Installed
`0x47e062` (default track) and `0x488d7c` (black Simple) both call
`BrMaterialAdd(0x51e490)`; these are genuine global entries, separate from the
startup SIMPMAT file's `M14.MAT` identity. See
[material ownership](c2-native-material-render-re.md) for retained texture and
geometry teardown checks.
