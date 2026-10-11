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

The current scene registry is scoped to one scene, rather than the complete
native global BRender registry and persistent shared storage lifetimes. Native
car material shading updates, the extra master-actor material, and later
identifier-prefix mutation are separate loader behavior; this admission change
does not implement them. Native batch Glorify mutations are also not implied by
parsing a MAT or allocating its host record.

Initial authored ACT ownership is available, but returning storage/crosswalks
does not execute every native load callback, prepare MODEL resources, or install
the original prepared-face physics collector. Generated default-track MAT and
black MAT identities, their allocation/lifetime, and actual callback owners must
remain explicit when integrating that collector. The generic renderer fallback
is a separate material and cannot stand in for these native resources.
