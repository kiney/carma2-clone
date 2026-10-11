# Owned BRender resource arena

`src/native-resource-arena.ts` implements the installed resource wrapper around an
explicit browser host allocator. Material ordering uses actual live byte offsets
of owned records, not names, DAT slots or ordinal counters. The comparator and
unstable prepared-face permutation remain the recovered native algorithms.

The browser allocator uses increasing first-fit free regions, coalesces adjacent
freed regions and grows its private backing array. This is an intentional host
policy. It is not a reconstruction of Windows `HeapAlloc`, and its finite
collector prefixes are not claimed to match a particular Windows process load.
No canonical cross-installation material rank is specified by the inspected C2
allocator wrapper. See [allocator audit](c2-native-material-pointer-order-re.md).

## Installed evidence

Installed HW SHA256:
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
Original files were read only. rec2 supplies names/structures; these addresses
were verified in the installed image. Implementation is independent; no reference
code or proprietary fixture was copied.

| Installed address | Verified behavior                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `5275f0..527609`  | `BrAllocatorSet` replaces `fw.mem` at `79cdcc`, returning the previous allocator; NULL chooses the default             |
| `526c00..526c2a`  | `BrMemAllocate` forwards size/type to that allocator and zeroes returned bytes                                         |
| `526d00..526dfe`  | `BrResAllocate` size rounding, class/allocator alignment, resource header, parent attachment and returned user address |
| `529080`          | Initialize simple child-list head to NULL                                                                              |
| `529090`          | Prepend a resource node; `prev` points to the previous NEXT field                                                      |
| `529100`          | Remove resource node, repair next/prev-field pointers and clear its links                                              |
| `526e30..526ee6`  | `BrResInternalFree`: FREE marker, optional callback, children, parent unlink, magic invalidation, allocator free       |
| `526ef0`          | `BrResFreeNoCallback`: disables the requested resource callback, not its descendants' callbacks                        |
| `51e880..51e8d4`  | Allocate material class8, size156; copy source default material and optionally duplicate identifier                    |
| `66344c`          | Material class descriptor has alignment0, hence effective alignment4                                                   |

The class-specific free callback must be supplied explicitly for generic classes.
The source material class descriptor has no free callback. The module defaults
only that known class8 descriptor; other classes without a provider are rejected.
No physical-header or MODEL/ACT class registration is implied by this arena.

## Byte layout and arithmetic

The installed resource header has 24 bytes:

| Header offset    | Stored value                                                      |
| ---------------- | ----------------------------------------------------------------- |
| `0`              | Next sibling resource header address                              |
| `4`              | Address of preceding NEXT field, or parent's child-head field     |
| `8`              | First child resource header address                               |
| `12`, `13`, `14` | Rounded size in four-byte units, low/middle/high byte             |
| `15`             | Resource class byte; `127` during native release                  |
| `16`             | Own resource-header address                                       |
| `20`             | Live magic `0xdeadbeef`; invalidated to `1` before allocator free |

The first four arena bytes are reserved, preserving native NULL address zero.
Header and payload integers use little-endian storage. With the host allocator's
four-byte alignment and effective class alignment `C`:

```text
roundedSize    = roundUp(payloadSize + 24, 4)
alignmentPad   = (~(4 - 1)) & (C - 1)
allocationSize = roundedSize + alignmentPad
userAddress    = roundUp(headerAddress + 24, C)
```

Nonpositive class alignment selects four; a positive alignment must be a power of
two. MAT allocation is therefore `156 + 24 = 180` bytes with its user address at
header address plus24. The module rejects uint32 address overflow and sizes that
would truncate the native three-byte size encoding. It does not reproduce unsafe
native integer wrap or malformed resource-class alignments.

The material payload is deliberately opaque. Callers can supply owned native
record bytes; remaining bytes are zero. The module does not encode guessed MAT
field offsets, default-material values, texture pointers or registry links from
parsed JavaScript properties. Actual parsed MAT object identity is bound to this
allocated record separately. Allocation alone is not a claim that the complete
native `BrMaterialAllocate` default-copy/identifier child allocations occurred.

## Ownership, lifetime and safety

`allocate({size, classId, parent, payload})` returns an immutable handle carrying
the live user address, requested size, class, allocation ID and per-header-offset
generation. The ID/generation only validate ownership; they are never face-sort
keys. Handles are checked by actual arena-owned identity, so a copied or foreign
handle is rejected. Reusing a block retains its address but increments generation;
old handles never become valid again.

`read`, `write` and `snapshot` enforce requested payload bounds independently of
alignment slack. Reads and snapshots copy bytes. No API exposes a backing view;
growth copies the arena and preserves every address without leaving callers with
stale borrowed arrays. No compaction or address relocation is implemented.

Child attachment prepends. `reparent(handle, parentOrNULL)` relinks actual header
bytes and rejects cycles. Recursive free follows source chronology:

1. Mark the resource FREE127, then invoke its callback with original class and
   rounded allocation size.
2. Remove each child head before recursively releasing that child. Children are
   visited newest first. A recursive child's callback therefore sees cleared
   sibling links; directly freeing an attached child calls its callback before its
   own parent unlink, matching the separate native path.
3. Unlink from parent, clear magic pointer, write magic1, and release the block to
   the host free list. Parentless resources are independently owned roots.

`free(handle,{callbacks:false})` suppresses only the requested root's callback;
descendant callbacks still run. Callback payload/header diagnostics are copies.
Callbacks must be synchronous and must not mutate the arena. Callback exceptions
leave an explicit interrupted/freeing resource, retain its occupied bytes and
invalidate its handle; there is no silent retry, reuse or fabricated rollback.
Production MAT resources have a NULL class callback, so this interruption path is
only relevant to explicitly supplied generic class callbacks.

`borrow(handle)` creates an explicit address-lifetime lease. Releasing a tree with
any borrowed descendant fails before callbacks or state changes. The host must
retain/release these leases around MODEL/face references; generating a key snapshot
does not automatically acquire lifetime ownership. This guard is a browser safety
policy in addition to the native wrapper, not an original BRender reference count.

## Material/preparation adapter

```ts
const arena = new NativeResourceArena();
arena.allocateMaterial(actualMatIdentity, { parent: optionalResourceRoot });
const order = arena.materialOrder(resource.current.faces);
const prepared = prepareNativeTrackResource(resource, order);
```

`allocateMaterial` allocates class8/156 bytes and binds actual object identity.
`bindMaterial` can bind an existing class8/156-byte record. Repeating the identical
binding is idempotent; duplicate live identity or a record already bound to a
different identity is rejected. Material names are not compared. An explicit NULL
face resolves to address0. Missing and freed material identities produce explicit
provider requirements instead of substitute ranks. A freed identity requires an
explicit `unbindMaterial` before entering a new resource episode.

`materialOrder` returns `kind: "host-resource-addresses"` with one live address per
current face. Its evidence names the host allocation policy. It feeds the existing
prepared-face algorithm directly; it is not labeled `verified-pointer-order` or
captured Windows ordering. Face bindings and MODEL revision still require normal
preparation invalidation. Registry admission, duplicate-MAT selection/free, generic
resource callbacks, actual source loading chronology and scene-root disposal are
host responsibilities. There is one shared arena for all supplied resource
classes; the helper does not partition a separate MAT-only heap.

## Validation and remaining limits

Focused tests exercise exact header/list bytes, alignment padding, growth with
retained addresses, detached snapshots, capacity failures, stale generations,
first-fit/coalescing reuse, parent/child callback chronology, no-callback roots,
borrowed-tree preflight, missing/freed identities and direct prepared-face use.
Optional original-installation tests use five multi-material Newcity models in
each Stock/Advanced root, retaining actual parsed MAT identities and asserting
their owned class8 records. No original assets or heap/prepared geometry are stored
in test fixtures.

Original Windows prepared-order capture remains useful for comparing finite
76/300-face prefixes across allocation policies. Its absence is not an obstacle to
running the recovered comparator with the port's declared live resource allocator.
Full original process heap emulation and full MAT/native-resource initialization
are not claimed. No production bundle or shared-runtime integration was changed.
