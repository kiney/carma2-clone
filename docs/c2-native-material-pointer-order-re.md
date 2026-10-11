# Native material pointer order: allocator audit

The installed allocation path does **not** supply a canonical material rank from
MAT names, DAT indices, file order or resource attachment order. `FacesCompare`
uses actual live addresses supplied by the current BRender host allocator. A port
can run that recovered comparator using its own real resource allocations; it
must distinguish this from reproducing a particular Windows process's order.
The [owned resource arena](c2-native-resource-arena-re.md) supplies such live
addresses with explicit `host-resource-addresses` provenance. Original-process
captures remain useful for finite-prefix comparison, not a prerequisite for
implementing the portable comparator. This audit adds no name/index rank heuristic.

## Evidence and scope

Installed HW SHA256:
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
The executable and original assets were read only. Addresses below were checked
in that installed PE32 image; rec2 supplies symbol/structure maps and has shifted
addresses for several of these functions. No reference code was copied and no
original material/prepared-model capture is claimed.

The exact unsigned pointer comparator and unstable CRT face permutation are
already documented in [prepared face order](c2-prepared-face-order-re.md). In
particular `FacesCompare` at `51fe80` compares `face.material` at face offset `8`,
with NULL first and equal pointers equal. Registry identifiers do not participate.

## Actual material allocation

| Installed address | Verified operation                                                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `51e880..51e8d4`  | `BrMaterialAllocate`: resource class `8`, requested size `0x9c`; copies the default material, clears stored state, optionally allocates its identifier as a child resource |
| `66344c`          | Material resource-class record: class `8`, alignment `0`, identifier string at `663544`                                                                                    |
| `526d00..526dfe`  | `BrResAllocate`: resource header, alignment, parent linkage and returned user pointer                                                                                      |
| `526c00`          | `BrMemAllocate`: delegates to installed allocator callback                                                                                                                 |
| `44cfc0`          | Installed allocator alignment callback returns `4`                                                                                                                         |
| `44cfd0`          | `InstallDRMemCalls` installs allocator table `592620` through `5275f0`                                                                                                     |
| `44ceb0..44cf7d`  | Allocation callback calls `GetProcessHeap` then `HeapAlloc` with flags `0` and the requested size                                                                          |
| `44cf80..44cfa9`  | Free callback calls `GetProcessHeap` then `HeapFree` with flags `0`                                                                                                        |
| `51e8e0`          | `BrMaterialFree` delegates to `BrResFree` at `526e00`                                                                                                                      |

For this ordinary material class, resource allocation uses alignment `4` and:

```text
rounded allocation = (156 + 27) & ~3 = 180 bytes
user material pointer = (raw heap pointer + 23 + 4) & ~3
                      = raw heap pointer + 24
```

The raw heap pointer is returned unchanged from the allocation callback at
`44cf28`. Its large-allocation page-touch branch reads/writes inside the returned
block; it does not implement a material arena, rank table or address counter.
Class/type is used for alignment and failure diagnostics, not a separate material
heap. The resource header's child list is prepended through `BrSimpleAddHead`
at `526dd1`; this orders ownership links, not allocated addresses.

Thus the resource wrapper preserves the heap's relative material address order.
It does not establish that order. The inspected game wrapper contains no
monotonic-allocation guarantee. Recovering one from its invocation sequence would
also require the actual process heap implementation, initial state and complete
intervening allocation/free history; none is encoded in the installed MAT files.

## Loading and registry identity

Installed loader entries differ from rec2 annotations:

| Installed address  | Symbol / relevant behavior                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `5027a0..5027c8`   | `LoadAllMaterialsInDirectory`: installs storage/shading callback globals, invokes directory enumeration, then restores undefined shading |
| `502740..502791`   | `LoadIfItsAMaterial`: uppercases only its extension-test buffer, then invokes `AddMaterials` with the original path                      |
| `501d80..501f09`   | `AddMaterials`: loads up to `500` materials, glorifies the complete loaded list, then stores/adds or rejects/frees each material         |
| `500f20..500fd2`   | `AddMaterialToStorage`: capacity check and exact identifier equality against previously retained storage materials                       |
| `523c40`           | `BrMaterialLoadMany`                                                                                                                     |
| `522fb0`, `522ff0` | Old/current material chunk readers allocate `BrMaterialAllocate(NULL)` before reading material fields and child resources                |
| `4b4a20..4b4acc`   | `PFForEveryFile`: mounted TWAT file-header order, otherwise platform directory enumeration                                               |
| `51bde0..51bebb`   | `PDForEveryFile`: callback in `FindFirstFileA`/`FindNextFileA` return order, without a game-side sort                                    |

The duplicate branch at `501ec1..501ec9` frees the newly loaded material through
`51e8e0`, unless duplicates are configured fatal. Existing registry/storage
identity survives. Successfully added materials go through `BrMaterialAdd`
at `51e490`, which also updates/prepares the material. Names and associated
resources allocate separately, and duplicates free resources during loading.
Consequently even a recovered file sequence is not a material pointer ranking.

DAT material bindings are registry lookups:

- `FopRead_MATERIAL_INDEX`, installed `522a40..522ac1`, allocates a temporary
  `(count + 1)` pointer table, stores NULL at slot zero and resolves every name
  through `BrMaterialFind` at `51e4e0`.
- `FopRead_FACE_MATERIAL`, `522d90..522e4b`, writes those resolved pointers into
  raw `br_face.material`, with an invalid serialized index producing NULL. It then
  frees the temporary table at `522e39..522e3a`.

Neither retained face records nor source DAT material slots preserve a heap rank.
Matching an actual loaded material identity is necessary but is not sufficient to
infer its relative native address. A later material replacement/full MODEL
preparation needs the identities and order belonging to that preparation episode.

## Concrete integration path

Keep `NativeFaceMaterialOrder`'s current explicit provenance contract. NULL and at
most one distinct non-NULL identity already need no relative heap ordering.
For multiple identities, the port can bind actual current MAT objects to owned
class8 resources and use their live addresses. `BrAllocatorSet` at installed
`5275f0..527609` replaces `fw.mem` at `79cdcc` and returns the old allocator;
therefore the resource algorithm deliberately permits different host policies.
The arena uses first-fit/coalescing, not Windows heap emulation. Lifecycle,
borrows and MODEL revision invalidation remain required host integration.

To compare against the original process's exact finite collector prefix, use one
of these additional evidence providers:

1. Capture each original retained material pointer and identity immediately before
   the relevant full MODEL preparation. Convert distinct nonzero unsigned pointers
   to ascending positive ordinals, preserve NULL as zero, and supply one key per
   current raw face. Record executable hash, load episode, resource identities and
   current MODEL revision. Absolute addresses are unnecessary for the consumer.
2. Capture the prepared MODEL's ordered groups and `face_user` mappings directly.
   This avoids reconstructing allocator history but needs a separate explicit
   prepared-data provider with the same resource/revision checks. A captured
   face list must describe post-migration/post-mutation faces, not unconditional
   original DAT face indices.

Keep captures in ignored artifacts or `/tmp`; do not commit proprietary prepared
geometry. A private PE probe with an injected Linux arena can verify BRender
preparation under invented pointers, as existing comparator tests do. It cannot
establish the original Windows process's material ranks. Replacing `HeapAlloc`
with a monotonic arena would be an explicitly different allocation policy.

Lexical names, MAT/DAT order, first rendered
occurrence, JavaScript identity counters and reversed resource lists remain
unsupported ranking substitutes. Owned byte addresses close the portable
comparator's key-provider requirement; they do not establish Windows-process
prefix parity. Production collector topology, current prepared MODEL resources
and mutation callback ownership still require separate integration.

## Validation

Focused static checks covered the allocation/return/free chain, installed material
class data, loader enumeration, duplicate free and DAT registry-binding paths.
The associated arena tests cover owned resource bytes, lifecycle and multi-MAT
Stock/Advanced models. No Windows-process material capture or original-asset
write occurred. See the arena note for the explicitly scoped implementation.
