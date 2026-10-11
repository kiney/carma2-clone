# Installed BRender prepared face ordering

`src/native-face-order.ts` independently reproduces the installed face-pointer
sort and contiguous material groups. It requires caller-supplied unsigned material
pointers or **verified pointer-order ordinals**; names, DAT material indices, MAT
file order and render first-occurrence order do not prove those keys. Unavailable
keys produce explicit unresolved metadata. This module does not prepare vertices,
normals, edges, actors, columns or collision records.

## Identity and evidence

Installed HW SHA256:
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
The original installation was strictly read only. `madebr/rec2` supplies symbols
and structure maps; several of its BRender, CRT and collector address annotations
differ from this image. The following addresses were checked in installed code.
No reference implementation was copied.

| Installed address | Role                                                             |
| ----------------- | ---------------------------------------------------------------- |
| `51ef90`          | `BrModelUpdate`                                                  |
| `51f481..51fa6b`  | Inlined `PrepareGroups` work within full preparation             |
| `51f53d..51f589`  | Initialize face-pointer list in original model face order        |
| `51f599..51f5a2`  | Sort face pointers, element size four, comparator `51fe80`       |
| `51fe80..51fe9e`  | `FacesCompare`: unsigned material pointers at `br_face+8`        |
| `527a50..527a6c`  | `BrQsort` wrapper calls CRT `575aa0`                             |
| `575aa0..575c40`  | Quicksort partition and bounded pending-range stack              |
| `575c50..575ca8`  | Short selection sort for at most eight elements                  |
| `575cb0..575cdb`  | Element byte swap                                                |
| `51f7c8..51f88a`  | Contiguous material groups and ordered face copying              |
| `5203c0..52046b`  | `CopyFace`, including original index into group `face_user`      |
| `4b5570`          | `FindFacesInBox` column collection                               |
| `45fdc0`          | `ActorBoxPick` actor recursion                                   |
| `460490..4610c9`  | `ModelPickBox` prepared-group/face traversal and record emission |

## Preparation key and permutation

The initial list contains pointers to `model.faces[0..nfaces-1]`. The comparator
compares only `face.material` as an **unsigned 32-bit pointer**, returning zero
for equal pointers. It has no identifier, smoothing, flags, original vertex or
original face index tie breaker. NULL is zero and forms the first group. Distinct
material objects with equal names remain distinct groups. Collector fallback to
the actor/model material for a NULL face group does not change the preparation key.

Sorting is unstable. Its equal-key permutation depends on the full model's key
sequence and face count. Sorting each material's face list separately, a stable
JavaScript sort, or adding an original-index secondary key is incorrect.

Independent index-based pseudocode for the installed CRT behavior:

```text
order = [0, 1, ..., originalFaceCount-1]
pending = [(0, originalFaceCount-1)]
while pending is nonempty:
  (lo, hi) = pop(pending)
  while hi > lo:
    count = hi-lo+1
    if count <= 8:
      for last = hi down to lo+1:
        greatest = lo
        for scan = lo+1 through last:
          if key(order[scan]) > key(order[greatest]): greatest = scan
        swap(order[greatest], order[last])
      break
    swap(order[lo], order[lo+floor(count/2)])
    pivot = key(order[lo]); left = lo; right = hi+1
    repeat:
      increment left, then continue while left <= hi and key(order[left]) <= pivot
      decrement right, then continue while right > lo and key(order[right]) >= pivot
      if right < left: break
      swap(order[left], order[right])
    swap(order[lo], order[right])
    leftRange = [lo, right-1]; rightRange = [left, hi]
    omit the equal-key middle between these ranges
    push the larger range if it contains at least two elements
    continue immediately with the smaller range
    equal range sizes: push left, continue right
```

All-equal four faces yield `[1,2,3,0]`; eight yield `[1,2,3,4,5,6,7,0]`.
Nine instead yield `[4,1,2,3,0,5,6,7,8]`. For 300 all-equal faces, original face
150 becomes the first prepared face. These shifts affect capacity-limited prefixes
even when a model has only one material.

`PrepareGroups` copies the sorted list in order, starts a new group only when the
material pointer changes, and writes `face_user = original model face index`.
Vertex welding and edge preparation do not reorder that face list. Original model
index means the face array **at this preparation**, including any preceding game
edits, rather than an unconditional original DAT index. Copy-only model updates
reuse prepared mappings; a full reprepare may require a new permutation.

rec2 `DRModelUpdateAndKevificateMaterials` additionally writes each prepared
group's collision material from `model.faces[group.face_user[0]].material` after
the BRender update. This group material assignment does not define another sort.

## Material pointer order is still a host dependency

The DAT material-name index resolves through `BrMaterialFind`; face-material
records store those registry pointers, not their file indices. rec2 loader
`FopRead_MATERIAL_INDEX` initializes slot zero NULL, then resolves names; its
`FopRead_FACE_MATERIAL` assigns those pointers to original model faces.

Installed allocation chain:

- `BrMaterialAllocate`, `51e880`, requests a 156-byte material resource from
  `BrResAllocate`, `526d00`.
- That resource allocator uses `BrMemAllocate`, `526c00`, through its installed
  allocator callback. `InstallDRMemCalls`, `44cfd0`, installs table `592620`.
- Table callback `44ceb0` uses `GetProcessHeap` (IAT `588158`) and `HeapAlloc`
  (IAT `588098`); free callback `44cf80` uses `HeapFree` (IAT `588114`). This is
  stronger evidence than rec2's reconstructed `DRStdlibAllocate` using `malloc`.

Neither this allocation path nor file load order proves monotonically increasing
resource addresses after intervening allocation/free activity. Pointer ordering
can depend on the process heap and runtime history. A supplied ordinal is valid
only if its equality and relative ordering match those actual material pointers;
ordinal zero must preserve NULL. An evidence string records caller provenance,
but the pure helper cannot verify that external claim. No current production
material-rank provider is claimed here.

## Collector prefix before capacity

Installed `FindFacesInBox`, `4b5570..4b5701`, expands the addressed column rectangle
by one within track bounds, visits **X outer, Z inner**, and then additional actors.
`ActorBoxPick` handles an actor's model before eligible children, walking linked
siblings through `next`. Native ACT child-add `523240` calls `BrActorAdd` `51d620`,
which invokes `BrSimpleAddHead` `529090`: file sibling attachment prepends. The
current parser's append-order child array therefore requires matching reverse
attachment/relink history before claiming native actor order.

`ModelPickBox` visits groups ascending, faces ascending within each group, and
appends only faces passing its bounds/clipping tests. It decreases remaining
capacity immediately after each accepted record and stops at zero. The face
helper must permute the complete original model before filtering or applying
76/300 limits. For updateable models the emitted record identifies the original
face through `face_user`; otherwise it identifies prepared group/face positions.
Exact clipping, packed normals, edge flags and dynamic traversal remain separate
requirements; this helper does not make the current collector source-equivalent.

## Validation and next deterministic check

A private 32-bit harness invoked installed `BrQsort` and `FacesCompare` with
invented material keys and face records. An independent reconstruction and the
production TypeScript helper each matched **300/300 complete permutations**.
Sizes cover 1..400, including the 8/9 branch, 76/300 spans, all equal, repeated,
NULL, sorted/reverse and seeded mixed keys. Four compact safe captured fixtures
are retained in tests; no original model or executable bytes are stored.

Focused tests: 12 passed, including captured sequences, unsigned high-bit keys,
group spans, metadata failures, nonmutation and the complete uint16 face count.
TypeScript passed. No renderer/world integration or production build occurred.

Next check: capture actual material pointer ranks and prepared `face_user` lists
from a fixed original track load into ignored artifacts; compare complete model
permutations. Then compare finite accepted `(column, actor, group, face)` prefixes
for bounded queries just below/at/above 76 and 300 records. This separates the
verified permutation from still-unresolved material heap order, ACT relinks and
collector clipping. Single-material models can already have exact face ordering
without recovering relative order between different non-NULL materials.
