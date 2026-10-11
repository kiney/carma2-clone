# C2 prepared cached-face emission

`src/physics/prepared-face.ts` independently implements the installed cached-record emission stage of `ModelPickBox`. It consumes retained original indexed MODEL metadata and returns a face compatible with the native pedestrian grounding and `CheckSingleFace` helpers. It does not perform query admission, material inheritance, actor traversal, prepared group sorting or capacity selection.

## Evidence and scope

The installed HW executable and its recorded PE identity/hashes are described in `c2-physics-re.md`. The relevant installed function starts at **460490**; the rec2 annotation `45ff90` is a useful symbol map but is not this installation's entry address. The emitted record has material pointer at `+00`, three vertices at `+04/+10/+1c`, normal at `+34`, raw face flags at `+40`, plane D at `+44`, actor at `+48` and prepared/original group/face identifiers at `+4c/+4e`.

Installed evidence:

| Operation                     | Address              | Behavior                                                                                         |
| ----------------------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| Accepted-face emission starts | 460ce3               | Emits original prepared vertices, rather than the clipped admission polygon.                     |
| Transform prepared vertices   | 460d29/460d44/460d62 | Calls `BrMatrix34ApplyP` at 532ae0.                                                              |
| Transform prepared normal     | 460d6e–460d9d        | Copies the stored prepared normal and calls `BrMatrix34ApplyV` at 532b60; does not renormalize.  |
| NULL transform                | 460daa–460e83        | Copies prepared vertices and normal unchanged.                                                   |
| Resolve material              | 460e88–460e9f        | Uses the native prepared-group resource or inherited material, including genuine NULL.           |
| NULL D                        | 460eac–460eb3        | Copies the prepared face's stored D.                                                             |
| Non-NULL D                    | 460eb5–460edb        | Recomputes from the emitted stored normal and emitted vertex0, then stores Float32.              |
| Updateable model flags        | 460ee1–460f1b        | With model bit80, uses `face_user` original index and copies the entire original face flag byte. |
| Other model flags             | 460f84–460fc9        | Sets flags1/2/4 when the corresponding actual prepared edge identifier is zero.                  |

`CopyVertex` at **5202a0–5202e8** subtracts MODEL pivot from each original indexed position with a Float32 result. `CopyFace` at **52041d–520441** copies the prepared plane unchanged. Plane preparation occurs on the original indexed vertices before pivot subtraction; see `c2-prepared-plane-re.md`. This is why the emitter must retain the supplied D for NULL `pMat`, even for a nonzero pivot.

## Exact arithmetic

Let `f` mean Float32 storage. Native matrices contain three basis rows followed by translation, each a triplet. Inputs are stored Float32. For axis `i`, point emission is:

```text
P[i] = f(((z * M[6+i] + y * M[3+i]) + x * M[i]) + M[9+i])
N[i] = f((nz * M[6+i] + ny * M[3+i]) + nx * M[i])
D    = f((N.z * P0.z + N.y * P0.y) + N.x * P0.x)
```

Products and sums remain live between the indicated final stores. `ApplyV` neither adds translation nor adds an extra zero; an extra `+0` would change negative zero. No inverse transpose, normalization, extra intermediate Float32 multiplication or render matrix conversion occurs here. Explicit identity and native NULL consequently can differ in D: an exact negative unit plane is clamped during preparation, while its original pre-clamp D survives only the NULL branch.

## Host contract

`emitNativePreparedFace({source, pMat, material, preparedEdges?})` returns `{kind: "emitted", face}` or `{kind: "unresolved", reason}`. Invalid supplied finite/shape/index/flag values throw explicit errors. Missing required source knowledge stays unresolved.

The collector supplies:

- `WorldSourceTriangle` retaining original face index/indices, immutable source indexed positions, MODEL pivot, prepared plane and effective preparation flags. Track preparation is the verified `AddSmoothModels` setting `(rawFlags | 0x80) & 0xfdfe`, rather than raw DAT flags.
- Explicit native `pMat`: NULL or the actual twelve Float32 components. The helper does not infer a matrix from a Three object or silently treat NULL as identity.
- Explicit material state: `{kind: "null"}`, `{kind: "present", identifier, flags}`, or `{kind: "unresolved", reason}`. A present native material can have a NULL identifier; that is still distinct from a NULL material pointer. Render fallback names/materials are never read.
- For a non80 synthetic/non-track preparation branch, the actual three uint16 prepared edge identifiers. Original raw bits are not guessed as substitutes.

The returned face retains `source` identity, original face index, effective model flags, material presence, vertices, unnormalized stored normal, stored D and raw flags. Genuine NULL omits `materialFlags`; present flags zero remains explicit zero. This preserves the existing single-face side/material gates. The native record's UV pointers are not reproduced because these query helpers do not consume them.

Original native resource pointer order, linked ACT traversal order and the admission/capacity prefix remain separate prerequisites. This emitter does not turn current render grouping, render material fallback or Three traversal order into proof of those native orders.

## Current MODEL tables after face migration

`emitNativePreparedIndexedFace` uses the same emission kernel with explicit current
indexed positions, face indices, pivot, prepared plane, effective MODEL flags and
raw face flags. It returns only the geometric/material cached record. The collector
retains native group/compacted face indices and original DAT provenance separately;
this helper neither invents indices nor fabricates a `WorldSourceTriangle`.

This matters after `MungeFaces`: remaining faces are compacted, while selected faces
move to a distinct zero-pivot blendy MODEL and remapped vertex table. Using the old
DAT pivot or indexing the old geometry with a compacted destination index can
produce incorrect contact points. Four additional tests cover this distinction,
actual `CheckSingleFace` intersections, NULL/identity plane handling, invalid input
and Stock/Advanced source MODEL tables. Synthetic eligibility fixtures are labeled;
they do not claim authored smash bindings or population initialization. Native actor
traversal and prepared material-pointer order remain separate prerequisites.

## Validation

A private 32-bit harness mapped the original HW executable read-only into process-local memory, initialized native CRT floating-point mode through **5798e0**, and called installed **460490** against one-face synthetic prepared models. The installation remained unchanged; harnesses and generated binary captures stayed under `/tmp`.

**1,200 synthetic faces / 18,000 emitted components and status values matched exactly**, including NULL and identity matrices, arbitrary scaled/sheared basis rows, translated points, nonzero pivot-adjusted vertices, stored oblique planes and both flag branches. The probe supplied a wide admitting query box; it validates emission arithmetic, not reconstruction of actor/material ordering or the earlier admission gates. Original vertex-minus-pivot storage is established independently by `CopyVertex` static evidence and numerical unit checks.

Eight focused tests cover NULL-versus-identity D, pivot and signed-zero retention, native basis/normal transforms, a captured sheared numerical fixture, full raw byte flags, actual prepared-edge requirements, NULL/present material side gates, missing metadata, malformed values and retained Stock/Advanced Newcity indexed track snapshots. Original installation tests skip cleanly when assets are absent. No proprietary assets, dumps or generated caches are committed.
