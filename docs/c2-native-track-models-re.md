# Native track face migration

## Scope and evidence

`src/native-track-models.ts` independently implements the finite-data transform in installed `MungeFaces(0x40d530)`. It retains raw material identity, raw DAT provenance, compacted native face indices, first-match vertex records, and explicit source lifecycle requests. It does not perform BRender registration, preparation, ACT hierarchy changes, pedestrian spawning logic or resource allocation merely by returning records/actions.

The read-only executable is PE32 i386, base `0x400000`, entry `0x577eb0`, SHA-256 `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`. rec2 `src/carma2/common/brucetrk.c`, `world.c`, and BRender model/material support provided symbol maps; behavior was checked in this installed binary. Some rec2 BRender/game annotations are shifted; installed addresses below take precedence. No reference implementation or proprietary fixtures were copied into repository code/tests.

A private 32-bit mapper called the original function in private memory, with pedestrian spawning and model-update outlets captured/replaced. The actual installed material predicate and migration code ran. It compared complete remaining/generated 40-byte face records and generated vertex records against an independent expected transform. All **60 cases passed**: 52 original Stock/Advanced New City migrating models and eight synthetic signed-count/trigger/mode/deduplication cases. Probe tools and asset-derived input/output stay under `/tmp/c2-mungefaces-*`; the original executable/assets were never changed.

## Selection and mutation

`0x40d562..575` calls `SpawnPedsOnFace(0x4d2a80)` before selection on every original face. It then passes the **raw** face material pointer to `SmashFaceMustBeUpdateable(0x4f5210)`.

The predicate scans specs, stride `0x2e0`, accepting:

```text
triggerType == 0 && spec.material == rawFace.material
&& ((mode == 2 && signed levelCount > 0) || mode == 3 || mode == 4)
```

Material pointer is spec `+4`, trigger type `+8`, mode `+0xc`, texture level count `+0x5c`. Mode 2 is texture change, 3 remove, 4 replace model. There is no material-name comparison, ACT material inheritance or austerity gate inside this predicate. A genuine NULL pointer remains distinct from inherited/resolved rendering material; a NULL spec identity can match NULL exactly.

For a selected face, `0x40d5db..612` copies its complete 40-byte record to the generated face array in encounter order. Each corner then searches previous generated vertices ascending (`0x40d649..690`). Equality checks XYZ and UV only. The first match wins even if material, smoothing, normals or other payload fields differ. Otherwise the complete first vertex record is copied (`0x40d69b..6d3`). No actor transform, pivot conversion or material-space transform occurs.

The original face is removed by a 40-byte-stride `memmove` at `0x40d716`; count decreases and the loop index decreases before the next iteration. This preserves remaining-face order and visits the replacement face at the same current native index. The original vertex table and pivot remain unchanged.

`sourceFaceIndex` is raw DAT provenance. `nativeFaceIndex` is the final index within the remaining or generated raw MODEL face array. Prepared groups have their own face order/user mapping. These identities must not be conflated.

## Generated resource and update chronology

On the first selected face (`0x40d57d..5d7`):

- Allocate MODEL actor type 1; set render style 4/FACES. Identifier/material are NULL and the actor matrix is identity from normal actor allocation.
- Allocate a NULL-name model with storage for 2,000 vertices and 2,000 faces; reset both counts to zero and set flags `0x80/UPDATEABLE`.
- The new MODEL has a zero pivot and other fresh fields from zeroed allocation. Installed `BrModelAllocate(0x520e30)` has no nonzero pivot initializer; the memory allocator's zero-fill is visible at `0x526c1a..23`.

Native migration has no capacity check. The independent transform deliberately rejects an initially oversized migration **before gameplay outlets**. Selection runs again after each spawning callback, so callback-driven selection changes are honored; a newly oversized result fails before copying the next record, after any earlier outlets have already run. It does not split models or reproduce unchecked native writes. Remaining/original MODEL counts must fit uint16. XYZ/UV inputs must be finite values already stored as float32. Native unordered comparisons can behave differently for NaNs; those unsafe inputs are explicitly rejected.

After any migration (`0x40d789..7ac`), update the remaining original model once with `ALL=0x7fff` if it has faces. Otherwise clear the original actor's MODEL and set render style 1/NONE. No-change and initially empty models retain their actor MODEL/style.

The subsequent requests belong to `ProcessModelsCB(0x40cf10)`:

1. Enumerate/register noncars after the original MODEL mutation.
2. Attach the generated actor as the wrapper's first native child.
3. `BrModelAdd(0x51e340)` registers and immediately calls `BrModelUpdate(0x51ef90, ALL)`.
4. Use the resulting prepared UV face data to calculate extra storage at `0x4f5880`. Reallocate raw vertex/face arrays with those extra records without increasing model counts.
5. Call `DRModelUpdateAndKevificateMaterials(0x515980, ALL)` again. After preparation, each prepared group's material pointer is restored from `rawFaces[group.face_user[0]].material`.

The API emits these ordered requests. A host must actually execute them or retain a clear unsupported-provider diagnostic. Generated `flags=0x80` is not evidence that a prepared model exists.

## Caller selection and ACT/material ownership

Before migration, ProcessModelsCB recognizes a column using `%u%u` plus track dimension checks. It assigns `gDefault_track_material` to the original column ACT, creates an identity NONE wrapper, relinks the column beneath that wrapper, and clears `gMr_blendy`.

With a primary MODEL and austerity disabled, it processes that MODEL. Otherwise it selects only the first native-list child whose identifier does not start with `&`; it does not process every child. Native child insertion is prepend order. Generated actor insertion therefore places it before the original column ACT under the wrapper. The pure module takes the already-selected MODEL and does not guess this caller selection or mutate ACT hierarchy.

`gDefault_track_material` is constructed at `0x47e006..62`: inherited default flags 1/LIGHT, palette index 227/range 1, colour from palette entry 227, ambient 1, diffuse/specular 0. `gBlack_material` is a separate `GetSimpleMaterial("M14.MAT",4)` result at `0x4f8973..88`, stored at `0x6b5a20`. Fresh construction uses colour `0x212121`, ambient-only shading and flags 5/LIGHT|SMOOTH; the colour-based cache may reuse an already-created material. FindFacesInBox supplies black as traversal fallback. The generated actor is a sibling, so it does not inherit the original column actor's default-track material. The renderer's unresolved-MAT grey fallback is neither of these source materials.

## Reserve equation

`nativeTrackTextureReserve` requires prepared face UV triples after actual preparation. Installed `0x4f58d4..59f3` initializes minima to 10,000 and maxima to -10,000, accumulates each face's axis ranges, and computes:

```text
x = trunc(maxU - minU + double(0.9))
y = trunc(maxV - minV + double(0.9))
area = signed32(area + imul(x, y))
extraFaces = extraVertices = min(250, signed32(area + 50))
```

The literal at `0x589fe0` is double `-0.9` and is subtracted, not float32 `.9`. The source sentinel extrema are preserved even for UVs beyond ±10,000. There is no lower clamp after signed overflow; the helper retains that numeric result. A safe allocator must reject negative/unsafe sizes rather than reinterpret them as valid storage. Float-to-integer conversion outside the exact safe integer range is explicitly rejected.

## API and validation

`migrateNativeTrackModel(model, specs, providers)` requires actual MODEL identity, raw material identities, stored float32 XYZ/UV, face provenance, and payload-copy adapters. Payload is opaque retained data apart from the represented indices/material/XYZ/UV fields; a raw-record serializer must write the returned typed fields over those represented byte offsets. The adapters must copy all remaining fields without assuming generic defaults.

`spawnPedsOnFace` is required. Its visit exposes the original face, current compacted native index, current remaining face count, and a snapshot of the current native face table. Returning without a production spawning outlet is not native pedestrian enrollment; tests explicitly supply capture callbacks. The source MODEL identity stays stable throughout. Table lengths and face-record identities must remain stable, and copy adapters must copy payload without mutating source tables. Raw face material/spec fields can change in a spawning outlet: the predicate reads them live after that callback. The available reconstructed SpawnPedsOnFace reads face/model fields and updates pedestrian/population state and pedestrian-spec density remainder; it does not write the face material or track smash specs. The public callback chronology nevertheless does not rely on that invariant. Initial selection exists solely for capacity preflight and is not the emitted migration decision.

Focused tests cover predicate identity and strict signed thresholds, stable compaction/visits, zero-vs-signed-zero equality, UV seams, first payload preservation, actor/model flags/pivot, explicit lifecycle ordering, exact capacity boundaries, provider failures and reserve rounding/overflow. Optional original tests independently read Stock/Advanced DAT/ACT/specs and verify all **26 models / 126 migrated faces per dataset**, including every remaining/migrated source index and corner XYZUV correspondence. No source asset values are stored in committed fixtures.

Validation: 10/10 focused tests pass, including all 52 original migrating models without skips. The released module also matches all 60 installed capture cases byte-for-byte through the private adapter. TypeScript, focused formatting and diff checks pass. No production bundle was rebuilt.

## FindNonCarsCB: pre-query ACT/resource mutation

This section is verified from installed `FindNonCarsCB(0x40d1f0..40d52a)`, `SetSmashableModel(0x4f5a50..5c47)` and adjacent installed callers, using rec2 `common/brucetrk.c`, `loading.c` and `powerups.c` as symbol maps. The executable hash/PE identity above still applies. Sixteen private 32-bit captures execute the original function after native CRT/FPU initialization, with only debug printing replaced by a no-op. They cover the four Stock/Advanced canopy instances, synthetic scale boundaries, mixed-axis transforms and invalid IDs. Original files remain read-only; probe inputs/outputs stay in `/tmp`.

The callback executes these operations in order:

1. Call `SetSmashableModel` before inspecting the actor name. It uses the actor's **local MODEL pointer**, not an inherited MODEL. With a non-NULL model identifier, scan every track smash spec in original order (stride `0x2e0`). A spec matches only `trigger_type(+8)==1` and exact MODEL pointer equality at `+4`. A matching actor identifier must have at least four characters or native loading fails. Preserve its last four characters, overwrite the old suffix with eight spaces, then write `sprintf(name+5,"%c%02d",'|',zeroBasedSpecIndex)` and append the saved suffix. The first five characters survive for ordinary names; `%02d` is minimum width, not a two-byte packed value. Names shorter than 12 bytes get a new resource-owned identifier; longer names reuse the original buffer. Every match is processed, so the final matching spec wins. An installed capture with two matching specs yields `ABCDE|01.ACT`. The rec2 packed-`x`/index-plus-one interpretation does **not** describe this executable. MODEL/geometry/material/type_data/flags are unchanged here.
2. Each matching MODEL spec may also call `AddSmashableRaceTarget(0x497640, model, actor, -1)`: current race field `+0x1f0>=4` and unsigned WORD spec `+0x2ac` equals race `+0x1f4`, or nonzero net mode plus net-game `+0x74==2` and that WORD equals 1. This side effect requires actual race/net providers; the raw WORD offset is retained rather than assigned a guessed parsed semantic.
3. Any identifier starting with `&` requires a non-NULL **local MODEL** (`ACT+0x18`). Missing it reaches the fatal path (`0x40d216..22d`), even if a parent could supply a render MODEL.
4. A name beginning `&` whose second signed byte is ASCII `0..9` takes the noncar branch. Compute `id=1000*signedByte(name[4])+100*signedByte(name[5])+10*signedByte(name[6])+signedByte(name[7])-0xd050`. There is no four-digit validation. These bytes are read **after** the smash-name rewrite. An ID outside `[0,track.count_non_cars)` returns 1 immediately (`0x40d4ae`), without changing the matrix, list or type_data. Valid IDs run the transform operation below, write `track.non_car_list[id]=actor`, clear `ACT.type_data(+0x5c)` and return 0. They do not recurse into their children. This registration does not allocate physics, set a driver, mutate rigid flags or enroll PHIL.
5. Other names with byte 1 equal to Latin-1 `0xa3` run `SmoothificatePowerups(0x4f6690)` before calculating `powerupId=10*signedByte(name[2])+signedByte(name[3])-0x210`; no digit validation is present. IDs 66 through 85 call `SetSpinningPowerup(0x4df390, opacity=0)`. IDs 86 through 87 call `SetChangingPowerup(0x4df4e0)`. This branch does not require byte 0 to be `&`.
6. Every remaining path recurses with `BrActorEnum(0x51d510, actor, FindNonCarsCB, track)` and returns its result. The native enumerator walks the existing child head/next chain, saves the next sibling before calling the callback, and stops immediately on a nonzero result. Consequently an invalid noncar ID stops remaining siblings at every enclosing recursion level. A valid noncar only suppresses its own subtree.

### Noncar transform equations

At `0x40d279..482`, use the three stored ACT local basis rows, not MODEL vertices or inherited/world transforms. Let `rawN[i]=(x*x+y*y)+z*z` evaluated in the native x87 double environment, and `N[i]=f32(rawN[i])`. The constants at `0x5883c8` and `0x5883d8` are **double** `0.999` and `1.001`.

If `rawN[0]<double(0.999)` or `N[1]<double(0.999)` or `N[2]<double(0.999)`, replace local translation X with `f32(X+2000)` (`0x40d366..372`, subtraction of float `-2000`). Only the first comparison retains the unrounded sum. This difference is observable: a synthetic sum `0.9989999845939751`, stored as `0.9990000128746033`, shifts X when placed in row 0 but not row 1.

Independently, if **any stored** `N[i]>double(1.001)`, normalize **all three rows**:

```text
reciprocal[i] = f32(1 / sqrt(N[i]))
basis[i][j] = f32(basis[i][j] * reciprocal[i])
```

The sqrt/reciprocal calculation retains native double precision until the reciprocal store. This preserves row directions and shear; it is neither orthogonalization nor uniform maximum-scale removal. Both the undersize shift and normalization can run on the same ACT. MODEL positions, pivot, raw/prepared data and MODEL bounds remain unchanged. A zero row with another oversized row can produce native nonfinite values; a safe host must diagnose that input instead of choosing an invented axis.

Both original New City datasets contain `&07c0533.ACT` and `&07c0069.ACT`, local MODEL `&07canopy1.act`. Their row squared lengths are respectively float32 `2.0736005306243896` and `1.440000057220459`, corresponding to authored scales about 1.44 and 1.2. Installed captures normalize all rows, keep their translations and MODEL unchanged, clear type_data and register raw IDs 533/69. The transform must occur before creating world bounds/prepared traversal metadata for these actors; applying it only to a render clone leaves collision admission inconsistent.

### Powerup resource effects and subsequent compaction

`SmoothificatePowerups` only runs when `gNbPixelBits(0x74ac00)==16` and the actor has a local MODEL. It processes the local ACT material, then every non-NULL raw face material in face order; inherited material and pointer deduplication are absent. For each shared material, set `user(+0x94)=0x5ba0`, ambient/diffuse to 1, and `flags=(flags|LIGHT(1)|SMOOTH(4))&~PRELIT(2)`. Call `BrMaterialUpdate(0x5204b0,6)` if the old ambient is at most **double 0.9999** (`0x589ff0`), LIGHT/SMOOTH was absent, or PRELIT was present. Diffuse is assigned but is not independently part of this update gate. Shared-pointer mutations affect other ACTs using the same material.

Spinning setup pretranslates by local `(0,f32(0.1),0)` (`BrMatrix34PreTranslate`, `0x533400`); this translation follows basis row 1 rather than unconditionally adding world Y. It sets local MODEL flag `CUSTOM=0x20` and callback `RenderSpinningPowerup(0x4df470)`. Opacity zero skips its opacity-material branch. Changing setup obtains shared armor/power/offence models, duplicating registered `&68powerup1.ACT`, `&70powerup1.ACT`, `&69powerup1.ACT` MODEL resources as `PowArm`, `PowPow`, `PowOff`, with a source fallback through `POWRSHIT.TXT` if missing. Duplication copies MODEL/raw vertex/raw face state including bounds/pivot; registration/preparation is real work. It then performs the same local Y pretranslation, assigns the shared armor MODEL and installs `CUSTOM/RenderChangingPowerup(0x4dfc30)`. A host without these resource or callback providers must retain an explicit blocker; assigning the original MODEL alone is incomplete. Neither setup allocates a physical noncar.

After all model/noncar traversal, installed `ExtractColumns` inlines `AssertNonCars` at `0x40ce83..cef9`: scan raw registration slots in increasing ID order, count NULL slots, compact non-NULL actors, and write `sprintf(actor.identifier+4,"%04d",compactedIndex)` using literal `0x58e494`. The terminating NUL is written after those digits (byte 8 for indices below 10,000), truncating the original suffix. Subtract the NULL count from track count and globals `gCount_track_non_cars(0x677b00)` / `gMax_count_non_cars(0x79c46c)`. The initial extra capacity is 250 and survives this subtraction. Parent ACT nodes/model resources and existing bounds metadata remain allocated. Raw authored IDs and names must not be exposed as final native noncar IDs after this stage.

A production adapter therefore needs ordered mutable ACT nodes, local MODEL/resource identity, native child order, original material identities, smash/race bindings and explicit resource registration callbacks. Apply rename/scale/type_data/powerup changes in traversal order, propagate enum stops, then perform the separate compaction before building collision metadata. This research adds no runtime integration or PHIL admission claim.
