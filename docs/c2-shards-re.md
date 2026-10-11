# C2 authored shard geometry and movement

## Evidence

Independently reconstructed from the installed read-only `carma2_HW.exe`, image base `0x400000`, SHA-256 `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`. `madebr/rec2` supplies names and structure hints only; no reference code is copied. Native disassembly resolves several inaccurate addresses and equations in the reconstructed reference.

| Installed HW address                | Verified behavior                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `0x4eeaf0`                          | Actual shrapnel reader. Reference `ReadShrapnelSpec` address `0x4eed70` is stale for this executable.                           |
| `0x4eebe6`                          | Authored spin multiplied by float `0.1` at `0x589f68`.                                                                          |
| `0x4eec56`, `0x4eec65`              | Lifetime seconds multiplied by double `1000` at `0x589f70`, then converted to integer milliseconds.                             |
| `0x4ef108–0x4ef188`                 | Shard scalar, integer and material read in that order. Material flags become `0x1000` (two sided), with identity map transform. |
| `0x4eb660`, shard branch `0x4eb721` | Shard dispatch uses the current smashable geometry and transform, then calls `0x4ec0e0`.                                        |
| `0x4ec0e0–0x4ec99e`                 | Geometry subdivision, transform, triangle creation and lifetime setup.                                                          |
| `0x4eade0`                          | Allocates from the 200-entry glass-fragment pool at `0x6b5a80`, record stride `0x38`. Shards request priority `3`.              |
| `0x4eaef0`                          | Initial fragment velocity and angular velocity.                                                                                 |
| `0x4efcb0`                          | Actual movement and visibility function; reference `DoFragMovement` address and vertical-velocity equation are inaccurate.      |
| `0x4efed0`                          | Pool update, first-frame movement suppression and group cleanup.                                                                |
| `0x4c8620`                          | Replay/session serialization of event `0x1e`; this is not a renderer.                                                           |

The glass-fragment pool is distinct from the 30-entry sparks/debris pool in `spark.c` and its replay chunk `11`.

## Geometry

The two authored values following shard lifetime have the following verified meanings:

- **Scalar:** a threshold compared directly with squared edge lengths in the current local model geometry. It is neither a shard count nor triangle area. All three edges strictly below the threshold stop subdivision. Equality still subdivides.
- **Integer:** only bit zero is used here. Zero places each fragment at its own transformed triangle centroid plus independent signed `0.015` model-unit jitter. One places every fragment at the mean of the complete transformed refined vertex cloud plus signed `0.04` jitter. Other bits do not select counts.

The creator initially copies indexed 40-byte BRender vertices and six-byte triangle index tuples. Vertex positions and the two UV coordinates are interpolated; source geometry is unchanged. For each current face:

1. Select the vertex opposite the shortest edge, with two possible permutations of the other vertices. Native permutation tables at `0x65ea50`, `0x65ea68`, `0x65ea80` are `(0,1,2)/(0,2,1)`, `(1,0,2)/(1,2,0)`, `(2,0,1)/(2,1,0)`.
2. Let that vertex be `O`, and the others `A`, `B`. Independently choose `u,v` uniformly in `[0.2,0.8)` using the 15-bit native random distribution. Add `X=O+u(A-O)` and `Y=O+v(B-O)`, applying the same interpolation to UVs.
3. Replace the current face's `A,B` indices with `X,Y`; append faces `(A,X,Y)` and `(A,B,Y)`.
4. Repeat at most four times on the current face. Newly appended faces are subsequently processed in the same outer loop.

The splitting loop requires both face and vertex counts below `199` before adding two. Counts may therefore finish at `199` or `200`. A single two-sided, textured three-vertex model is rendered per final triangle. Its vertices are centered around its triangle centroid; rotation starts as identity. All points have already been transformed into scene world space. The authored low-bit placement can intentionally gather originally separated triangles into a common cloud.

The source caller supplies material-eligible vertex/face lists. Installed WAM linking at `0x4f5560` calls `0x4f5270` with capacities of **50 unique model vertices and 50 faces** (`0x4f55b7`, `0x4f55bf`). The browser WAM binding supplies those separate initial limits; refinement still permits 200. `ShardRuntime` deduplicates smoothing-split render vertices through their original model indices and retains the first occurrence's live position/UV. Generic callers retain bounded 200-entry defaults. It reports `sourceTruncated` and rejects malformed indices/mappings or nonfinite coordinates. Fixed native face/material links established at asset load remain separate integration work.

## Initial movement

Let `s` be the sum of transformed triangle bounding-box extents. The native size factor is `f=(0.2-s)*5` when `s<0.1`, otherwise `f=0.5`. Let `R(a,b)` be an independent uniform sample using a 15-bit draw divided by `32768`, and `S(m)=R(-m,m)`.

For each component `i`, begin with:

`velocity[i] = f * (impacteeVelocity[i] * authoredFactor + S(randomVelocityMax))`.

Add `R(0,randomUpVelocityMax)` to Y. Normalize the triangle face normal, falling back to positive X below native epsilon `2^-22`; add an independent `normal[i]*R(0,randomNormalVelocityMax)` to each component. The shard path passes two null target/source endpoints, so its authored towards-speed pair is unused.

The spin axis initially consists of three independent `R(0,1)` components. Normalize it, with the same positive-X fallback. Each component is then independently multiplied by `S(authoredSpin*0.1*f)`. This is not a single signed scalar sampled for the whole axis. Spin is radians per second.

The impactee vector is captured at enqueue from the saved starting-step velocity at collision+0x1b4, multiplied componentwise by double6.9 (installed0x4ee010, copy0x4ee1e7–0x4ee244; constant0x589f60). The saved vector is copied before forces/contacts by0x4b97d9/0x4b9823–43. The shard runtime consumes this metric vector; the binding must not substitute post-impact velocity. The delayed noncar activation vector has a different context and must not be reused as an already converted shard vector. Exact enqueue ownership/flag eligibility remains part of shared-queue integration.

## Lifetime and update

The native record stores actor/model pointers, maximum end time at `+8`, start at `+0xc`, randomly selected visible cutoff at `+0x10`, last movement time at `+0x14`, group ID at `+0x18`, velocity at `+0x1c`, spin at `+0x28`, first-movement flag at `+0x34`, and priority at `+0x35`.

Visible lifetime is an inclusive integer draw between the converted minimum and maximum milliseconds. The pool remains reserved until the authored maximum. Visibility switches off at the random cutoff; there is no fade. Native expired group cleanup removes every active record bearing the same group ID. The allocator uses an unused entry first, then permits replacement only when the lowest active priority is strictly below the requested priority. Equal-priority shards therefore stop creating when the shared pool is full.

The previous-time global at `0x6a6650` starts at zero. While it is zero, the updater skips the entire pool, including expiry and visibility, and writes the current timestamp. Clearing fragments does not reset this global. A new fragment also skips movement on its first valid processed update. The unsigned current timestamp is widened before subtracting the signed previous timestamp, then stored as float32 milliseconds (`0x4efefb–0x4eff16`). Seconds are `F32(elapsedMs * F32(0.001))`, using `0x589f7c`. This delta can be negative when the native predicted game clock regresses after a stall; there is no monotonicity rejection or zero clamp.

An active fragment requires `now >= start && now < end` outside replay. Failure of either bound removes its entire group, including siblings whose own bounds are still valid (`0x4effda–0x4f0004`). A valid fragment recomputes visibility from `now < visibleUntil`; a backward clock can make it visible again. With signed seconds `dt` and float32 gravity multiplier `g`:

`position += (vx*dt, vy*dt - 4.9*g*dt*dt, vz*dt) / 6.9`

`vy -= 9.8*g*dt`

Installed double constants are `0x589f80=4.9`, `0x589f88=-1/6.9` (used with subtraction instructions), `0x589f90=9.8`. Actor translation components and vertical velocity are stored as float32. The reconstructed reference incorrectly decrements vertical velocity with a missing `9.8` and an extra world-scale division.

Rotate about normalized spin by `|spin|*dt` when its absolute value reaches `0.0001`. The source converts radians to integer BRender angles using `65536/(2*pi)` at `0x589fa0`. The clone preserves that truncation and applies rotation around the world-space axis while retaining the fragment position. There is no native ground collision, bounce, drag or repair recollection in this update path.

## Implementation and limits

`src/smash-shards.ts` owns generated triangle geometries and cloned two-sided material state, clones texture transform state while sharing the source images, and leaves source geometry and materials untouched. `clear()` removes the transient geometry; `dispose()` also releases owned material clones. Positions and UVs are emitted as float32 buffers; JavaScript intermediate calculations are not bit-identical x87 arithmetic. Native replay reverse-time behavior and random-seed save/restore are outside this live runtime. Production supplies the shared MSVC random stream; tests may inject a bounded deterministic source. Complete original random-consumer coverage is not established.

The implemented pool holds shards only. Native blood/gib/ghost fragments can share the 200-entry pool with other priorities; sharing those future effects requires a unified allocator. Current stock WAM evidence contains authored shards, so same-priority capacity behavior is implemented directly.

Native loading explicitly resets the BRender material map transform to identity. The runtime resets its independently owned texture clones to identity and leaves original material/texture state untouched. Per-car material lookup prevents same-name glass maps from aliasing across the fleet. Source callbacks must supply the current physical/model transform and the intended eligible material slots. A scene root with a nonidentity world transform requires converting the supplied world-space matrix into that root's local frame before invocation.

## Validation

`node --import tsx tests/smash-shards.test.mjs` checks squared-edge geometry, area and UV preservation, low-bit placement, authored movement and spin scaling, native gravity and quantized rotation, material selection and ownership, lifetime/pool exhaustion, invalid inputs, linked source bounds and independent component random samples. Clock regressions require signed movement and rotation, whole-group removal before birth, visibility restoration and the zero initialization sentinel. Production WAM checks exercise actual original-car impacts and repair; the native-AI harness also exercises ordinary driving through stalls. Module tests alone do not establish that game events bind to the correct source surface.
