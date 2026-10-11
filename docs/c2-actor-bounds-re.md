# Authored ACT bounds records

## Evidence and implemented scope

`parseAct` now retains authored BRender bounds as `ActNode.bounds = { min, max }`, with two three-number tuples in actor-local coordinates. It consumes the standalone BOUNDS resource and its separate ACTOR_BOUNDS attachment marker. It does not derive mesh bounds, apply the actor transform, or synthesize an authored record for an actor without these chunks. The scene retains copied `c2ActorBounds` alongside local MODEL/MAT bindings and exposes the source ACT roots. Native subtree query admission remains separate integration work.

This is an independent implementation of the observed format. The original installation was read only; no reference implementation or original asset contents were copied into the repository.

Installed `carma2_HW.exe` SHA-256: `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`; PE32 i386, image base `0x400000`, entry point `0x577eb0`. The BRender addresses in the available rec2 annotations are shifted relative to this executable; the installed addresses below were checked directly.

| Item                | Installed evidence                                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| BOUNDS reader       | `0x5232e0`: allocates `0x18` bytes, reads the bounds descriptor, then pushes resource type `0x13` (DF_BOUNDS), count 1                  |
| Bounds descriptor   | `0x662558`: two fields, size 24; field table `0x662538` has vector3 type `0x14` at offsets 0 and 12                                     |
| ACTOR_BOUNDS reader | `0x523200`: pops DF_BOUNDS via `0x529680`, requires DF_ACTOR type 4 via `0x5296f0`, assigns the pointer to actor `type_data` at `+0x5c` |
| Resource push       | `0x529630`                                                                                                                              |
| Format map          | rec2 `src/brender/core/v1db/v1dbfile.c`, `br_bounds3_FM`, `FopRead_BOUNDS`, `FopRead_ACTOR_BOUNDS`; `chunkids.h`                        |

## Binary schema and attachment

ACT is a BRender type-1 file. Chunk headers and scalar data are big endian, as in the existing reader.

- `0x32` BOUNDS: 24 bytes, float32 `min.x, min.y, min.z, max.x, max.y, max.z`.
- `0x29` ACTOR_BOUNDS: empty payload. Attaches the pending bounds to the current actor.
- `0x23` ACTOR supplies the actor type, render style and NUL-terminated identifier. The bounds record is separate from those fields and from transforms.

The native typed stack requires BOUNDS immediately above ACTOR when the marker pops the resource. An unconsumed bounds resource cannot be crossed by another actor, a child/end marker, an actor property, or another typed resource. The parser rejects these orders rather than accidentally attaching the record to a different actor. Unknown isolated extensions do not change the supported resource stack. A pending transform also cannot be crossed by bounds attachment. Repeated complete bounds/marker pairs on one actor replace the previous attachment, as the native pointer assignment does.

Native enum values are BOUNDS = 5 and BOUNDS_CORRECT = 6. The native attachment reader itself does **not** check the actor enum; the parser likewise preserves an explicit bounds record on any actor type. All 19,354 authored bounds found in the inspected installation target type 5. Consumers must apply the actual actor-type semantics rather than treating any parsed attachment as a physical hull.

The parser additionally rejects nonfinite components, reversed axes, nonempty attachment markers, wrong bounds payload lengths, truncation and incomplete pending resources. These are bounds-safety checks, not claims that the native loader performed equivalent semantic validation. Zero-extent boxes are valid. The original inspected records are finite, ordered, and use exact payload lengths 24/0.

Native actor allocation can allocate default type_data for a bounds actor. An omitted authored bounds record stays `undefined` in this metadata API, so absence is distinguishable from an explicitly authored all-zero box.

## Read-only data audit and validation

The installed asset index contains 2,109 ACT paths. The new parser successfully reads 2,106 and retains 19,354 bounds records. The three unchanged pre-existing parser failures were also checked with the checkpoint parser: Stock/Advanced `ACTORS/PROG.ACT` have no BRender header, and Advanced `CARS/DIGGA/DIGGA.ACT` fails the existing bounded reader at byte 2656. This change introduces no additional failure in that audit.

`tests/actor-bounds.test.mjs` includes synthetic resource-order, actor-type, nesting, local-transform, replacement, degenerate, size, truncation, nonfinite and reversed-axis cases. Optional original tests compare every preserved tuple against independently read chunk floats, without storing original fixtures:

| Track      | Stock records | Advanced records |
| ---------- | ------------: | ---------------: |
| New City 1 |           211 |              211 |
| Airport 1  |           162 |              162 |
| Carrier 1  |            35 |               35 |

Focused bounds tests: 10/10 pass, no skips with this installation. Existing format tests: 12/12 pass. TypeScript checking passes. No production bundle was rebuilt.

For scene integration, propagate a copied `bounds` value alongside the ACT type and identifier, retaining local coordinates. Native ActorBoxPick subtree gating must transform its query into the bounds actor's coordinate frame and use the authored min/max; a rendered mesh's aggregate Box3 cannot replace this authored admission bound. The caller's type-5/type-6 and traversal behavior is outside this parser change.
