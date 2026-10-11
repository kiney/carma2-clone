# Installed pedestrian proximity scanner

`src/ped-native-proximity.ts` independently implements the deterministic
`RescanPedProximity` cache writer at installed HW `4cf860..4d0dd6`. It does not
replace normal pedestrian AI or collect scene faces. `rec2/pedestrn.c` names the
function but leaves it unimplemented; its annotated address `4cfab0` differs
from this installation. Binary identity is recorded in the pedestrian notes:
HW SHA-256 `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
Original installation files were read only. No reference implementation code
was copied.

## Contract and actual ownership

`rescanNativePedProximity(input)` borrows the canonical process record's
`storage:Uint8Array` and actual `faceCache:{faces,selectedFace}`. The released
`NativePedProcessCachePool` record already provides this storage; no parallel
per-ped proximity state is allocated. Inputs also supply the current native root
translation, character direction, optional explicit scan direction, authored
personality `bb.max.x`, loaded cosine threshold, action and suicidal state,
and actual MAT identities in the race exclusion specification.

Faces supply packed world vertices, mutable packed `normal` and `constant`
(cached D), actual nullable MAT identity/flags, signed group and unsigned face
indices. `readIndexedFace` must resolve the actual ACT's local MODEL identity
and its raw/prepared three indices. An installed out-of-range face/group check
is represented by `kind:"invalid-face"`, which skips the face. Missing identity
or storage is a distinct `provider-required` result. Read providers must not
mutate the process, face storage, ACT or MODEL during a call.

`readPreparedGroupVertices` is needed only for an excluded floor which passes
the finite strip checks. It returns indexed **MODEL-local prepared vertices**,
without applying the ACT/world matrix. The normal wall path needs no such
provider. Material comparisons use actual object identity, including explicit
NULL; material names and renderer fallback materials are not substitutes.

The result returns `status`, `requiredProviders`, scalar `distance`, actual
`mutatedFaces`, and a diagnostic view of current process fields.
`readNativePedProximityState` reads the same storage. Missing providers are
checked in a transient decision pass before any live store; when all providers
exist, only the source-addressed fields and actual borrowed face records are
committed. Atomic failure is a host boundary, not a native failure behavior.

| Process offset | Installed writer                                                           |
| -------------- | -------------------------------------------------------------------------- |
| `00/04/08`     | Selected cached face normal, verbatim (`4cf896..4cf8b2`)                   |
| `0c/10/14`     | Normalized explicit direction or character+c0 direction (`4cf9cf..4cf9f0`) |
| byte `18`      | Initially `&0xf4`; later OR1/2/8 (`4cfa24..4cfa2e`)                        |
| `30/34/38`     | Accepted obstacle velocity cleared to zero                                 |
| `3c/40/44`     | Accepted wall/edge intersection position                                   |
| `a4/a8/ac`     | Accepted obstacle normal, or an edge candidate before the20 gate           |
| `bc`           | Accepted distance squared, stored Float32                                  |

Byte+18 is separate from gameplay/cache WORD+2e and DWORD+c4. Unspecified
recycled fields remain intact. No-hit scans retain old velocity, obstacle
position/normal and squared distance. NULL list or NULL selected-face pointer
returns10000 **before any store** (`4cf87f..4cf890`). A zero-count list still
writes floor/direction/flag mask before returning10000.

## Verified decision algorithm

1. Normalize the selected direction with strict length `>2^-22`; otherwise
   use `[1,0,0]`. Store components Float32. Explicit and character branches
   retain their installed sum association. Flat XZ normalization uses a spilled
   Float32 length and has no epsilon/zero fallback. A vertical scan direction
   therefore retains the native NaN flat-direction path.
2. Process cached records in array order, stride80. `normal.y>cosMaxSlope`
   classifies a floor; equality classifies a wall (`4cfa87..4cfa9d`).
   Suicidal state (`74294c`) skips floors. A floor is considered only if its
   actual MAT matches an exclusion, and running permits the authored entry.
   The aggregate all-permitted-running flag skips floor processing outright.
   Walls matching any exception MAT are skipped. There is no additional raw
   face80/non-solid filter inside this scanner.
3. Walls compute `t=F32(((D-Px*Nx)-Py*Ny-Pz*Nz)/den)` with
   `den=(dir.x*Nx+dir.y*Ny)+dir.z*Nz`. Strict `abs(den)<double.001`
   substitutes20; equality divides. Reject negative `t`, `t>20`, or `t>best`.
   Equal distances remain eligible, so a later accepted wall can own output.
4. Lazily create the five scan planes once. Lateral direction is normalized
   `SafeCross403f90(globalY,dir)`, **not floor-normal cross direction**. The
   installed SafeCross checks all three components against
   `F32(2.384185791015625e-6)` and its fixed-Y fallback is `[0,0,-1]`.
   Strip half-width is authored `bb.max.x*double1.3`. Forward and two lateral
   planes each require at least one cached triangle vertex on their inclusive
   admitted side. X/Y shifted coordinates remain live, Z is spilled Float32;
   packed plane D is stored Float32.
5. Predicate `5150e0` admits when
   `((Ny*Py+Nz*Pz)+Nx*Px-D) * ((Ny*Ny+Nz*Nz)+Nx*Nx) >= 0`.
   It uses no epsilon; a zero normal passes for finite inputs. Per-call scratch
   holds16 `(MODEL identity,group)` keys, each with512 vertex WORD outcodes
   (`4cffb6..4d0027`). Shared MODEL/group vertex indices reuse the first
   computed world-vertex result even across different ACTs. A17th key or
   index>=512 calculates directly without cache. Plane tests short-circuit in
   A/B/C order.
6. Wall facing uses packed normal dot direction. A back-facing MAT with
   flag1000 negates the **borrowed record normal and D in place**
   (`4d0939..4d0974`), then uses the front-facing path. NULL MAT on this
   dereferenced branch is explicit missing storage. One-sided back faces OR1
   only if any vertex passes the upper plane through the root; front/two-sided
   faces OR2 if any vertex passes the selected floor plane. The final commit
   tests the **whole accumulated byte+18**, so retained bit4/high bits can
   commit a wall even when its vertical plane rejected all vertices
   (`4d0cdd..4d0ce2`). Flags accumulate across records.
7. Accepted walls store distance squared, zero velocity, `P+dir*t`, and packed
   obstacle normal (`4d0ce8..4d0d88`). The Y product is spilled before addition;
   X/Z products remain live until their result stores.
8. Excluded floors resolve prepared local edge vertices (`4d0520..4d054a`).
   All three edge numerators reuse the A/B determinant. With each directed
   edge `(dx,dz)`, denominator is `dz*flat.x-dx*flat.z`; division requires
   strict `abs(den)>double.0001`. Negative/parallel candidates use F32_MAX,
   not Infinity. The first candidate remains live until selection; other
   candidates are stored Float32. Strict pairwise comparisons select the third
   edge on first/second ties. A candidate must be strictly nearer than best.
   Best and `(dx,0,-dz)` are stored **before** testing `best<=20`.
   Only within20 are distance squared, zero velocity, the flat intersection,
   normalized edge normal and OR8 committed (`4d06ef..4d08ef`).

### Unchecked negative prepared group

Index lookup handles `g<0` using the raw MODEL face table (`4cff35..4cff51`),
but the later excluded-floor branch unconditionally indexes
`MODEL.prepared.groups[g].vertices` (`4d0534..4d053e`). No raw-vertex or cached
world-vertex fallback exists. A safe synthetic allocation before the group
array proved that g=-1 consumes that preceding storage. The current updateable
track collector emits g=-1, so a finite excluded floor may reach this installed
unchecked access. The kernel returns
`source-proximity-unchecked-negative-prepared-group-storage`; it does not
fabricate group0 or permit an arbitrary JS provider to hide native invalid
memory. Actual positive-group preparation remains a required source owner.

## Source caller boundary

The entire installed function calls only GetCharacterMatrixPtr407a90,
SafeCross403f90 and repeated5150e0. It contains no CRT draw, move selection,
scare/head callback, object scan or physics activation. The grounding hook can
call this kernel when its verified rescan effect occurs and let the raw process
stores expose the new retained floor/direction. It must pass the actual slot
records so subsequent grounding/queries see two-sided record mutation.

Ordinary Munge callers remain separate: after supported SetPosition and
SetPedXZDirection, rescan is triggered by recache/direction change when no
smooth turn is active; moving animations then execute smooth-turn+rescan or
RandomWander, followed by PedScanForObjects and conditional avoidance.
RandomWander and avoidance own their own CRT draws and whole-process snapshots.
This module implements none of those owners and must not be presented as a
complete normal-population AI replacement. The older `ped-proximity.ts`
THREE-based scanner differs in masking, axis, packed D, pointer matching,
outcode aliases and face mutation; it is not used by this kernel.

## Validation and limits

- Twelve installed synthetic calls verified early returns, flag retention,
  front/back walls, signed-zero two-sided mutation, retainedbit4 commit,
  MODEL-local versus cached-world edges, suicidal gate and negative-group access.
- Another1000 invented seeded calls compared23000 state/Float32 fields bitwise,
  including signed zero, with **zero differences**.220 calls returned a nearer
  candidate:92 floors and128 walls. Safe input seed and captured output digest
  are in tests; binaries, mapping harnesses and detailed reports remain in `/tmp`.
- Focused tests cover strict thresholds, nearest ties, bounds/identity errors,
  16/512 scratch limits, atomic missing providers, canonical100-record storage,
  and actual Stock/Advanced Blokebl/Bandsman/twolf authored widths. Original
  tests skip cleanly without an installation.

Live expressions use JavaScript double with installed Float32 spills. These
captures establish tested conformance, not exhaustive emulation of x87 extended
precision under adversarial overflow/cancellation. Native material/order,
MODEL prepared-group ownership and scene collection remain caller inputs.
The canonical grounding interoperability test publishes the actual85-slot
borrowed list before calling this kernel, verifies writes to the100-record
process pool and in-place two-sided cached wall mutation, then releases only
face ownership while preserving retained vectors. Original authored face
records remain unchanged. Proximity BYTE+18 and unrelated DWORD+c4 are tested
separately. TypeScript and the production build pass; the normal scene
population still uses the legacy movement owner, so this is not a production
population replacement.
