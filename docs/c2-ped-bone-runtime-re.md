# Detached pedestrian bone runtime

The browser now admits actual prepared type5 BOX/SPHERE bodies through the shared
`VehicleSimulation.phil` registrar and contact solver. Analytical SPHERE bounds,
finite world and pair contacts, independent old torque points, final trajectory
guards, native free-leaf forces, quiet evaluation, callback-bit-dependent passive
transition and manual ACT rendering are implemented. Registration and sleeping
remain independent; neither silence nor age releases a part. FORM source shapes
and in-place preparation retain physical resource identity, flags, friction and
joint2 across owners. Pure allocation/pool/solver tests cover these boundaries.

These paths are prerequisites for the ordinary visible pedestrian population,
which still uses the previous sweep/corpse adapter. Detached LINE integration,
retained joint2 constraints and the full native sorted/deferred collision owner
remain explicit gaps; no polygon/sphere stand-in is used for a missing LINE path.
The final safety guards are engine stability extensions using original contact
features, not claims that the installed executable contained these extra guards.

The moving-world contact adapter retains cached candidate poses and separate old
torque points for body and surface owner. Its kinematic target response is a
documented engine extension of the verified sphere primitives. A full simulation
test exercises a rising finite floor and a registered type5 sphere.

Chromium Stock testing found a finite transformed contact normal with Y
`1.0000001192092896`, one Float32 ULP above 1. The impact-group input validator
now permits the contact adapters' bounded rigid-basis tolerance, preserving the
raw normal and all grouping dot products; it does not normalize or clamp contact
inputs. The exact captured normal is retained in an independent regression test.

`NativePedRuntime` now provides a concrete FORM/personality/ACT/simple-body/bone
owner over the real simulation registrar. Its tests exercise original Stock and
Advanced resources, finite shared admission, stable slot reuse, pre-impulse HP
callbacks, sever launch and passive release. Physical advancement updates the
retained native12 bone pose; interpolation cannot become its authoritative pose.
Ordinary displayed population integration still requires the character gameplay,
grounding, active move, halt and bounded stored-part outlets.

`npm run test:ped-bones` runs a Chromium diagnostic with real Eagle keyboard
contacts against original Blokebl HEAD SPHERE and Spine BOX bodies in both data
trees. It checks contact types, live movement, header release, requests and WebGL.
This is explicitly a controlled solver fixture, not evidence of ordinary visible
pedestrian dismemberment. Chrome DevTools MCP is unavailable in this runtime;
the reproducible Playwright Chromium harness is the recorded fallback.

The bounded browser run exposed an Advanced HEAD falling through road2 after
an Eagle impact. Its source3/8 contacts and actual sphere center were captured;
this was not merely an actor-origin or camera-placement error. Two additional
commit-guard defects are corrected: sphere inward motion follows its analytical
support envelope (center minus normal times radius), not a rotating old material
point, and each angular sample retains a cloned previous pose because the
integrator reuses its candidate objects. The old alias erased all later sweeps
in a14-sample tick. Original source contact selection and OLD solver torque
points are unchanged. The revised harness drives by simulated time/travel and
requires real HEAD and BOX Eagle rows; successful Stock/Advanced repetitions
kept the sampled center-to-road distance above the original radius and had no
fatal console, request or WebGL errors. The failing capture remains in ignored
artifacts for comparison. A separate bounded Float32 shell recovery now runs
only in the final trajectory guard; it preserves the installed strict contact
kernel and OLD torque point. See [sphere support](c2-sphere-support-re.md).
Its thirteen numerical regressions pass, including the integrated commit
fraction. The subsequent Stock/Advanced browser run passed both real Eagle
HEAD/BOX contact gates, support samples and PHIL removal, with no reported
JavaScript, network or WebGL errors. A later
Stock diagnostic missed the HEAD contact coverage gate without a floor failure;
that uncovered scenario is retained separately from successful earlier runs.

## Current contact receipt and passive prelude

The owner now receives each actual dispatch, not a retained activation guess.
Passive receipts contain the current other body and contact. Active receipts
contain the first source row, other body, total/first lambda and group force.
The world receipt explicitly has no other body, so attribution cannot silently
reuse a prior car. These snapshots are supplied before each damage callback.

Installed `4cd9e9..4cda0b` increments the impact WORD, resets cache halt/
interpolation state and calls attribution before momentum/common damage. The
numeric contact primitive exposes that prelude before its common tail. The
simulation commits the wrapped WORD to the actual rigid body, and the runtime
commits the same WORD to the character before the gameplay owner callback.
The ordinary result does not increment it again. Active dispatch skips the
passive prelude. Deterministic tests check chronology, wrap and current car-to-
world dispatch identity. The complete population gameplay owner remains a
separate integration step; these receipts alone do not implement native Kill.

## Evidence and scope

This note records the read-only installed HW executable, SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`, PE32
image base `400000`, entry `577eb0`. Addresses below were checked in installed
instructions. `madebr/rec2`'s `src/carma2/common/physics.c`, `car.c` and
`pedestrn.c` provide names/layouts; many relevant functions remain stubs and
their annotated addresses differ. No reference code or proprietary data is
copied here. This is an integration contract, not a claim that all generic
PHIL movement, volume or articulated constraints are implemented.

Initialization is covered by [bone bodies](c2-ped-bone-body-re.md), allocation
by [the character pools](c2-ped-body-pool-re.md), and shared normal100 headers
by [PHIL registration](c2-phil-registration-re.md). The intact type2 runtime
must not be used as a type5 callback policy.

## Type and callback dispatch

Sever initialization supplies selector3 to `4085f0`, making rigid type5 and
retaining the character at `Object+23c`. That owner pointer does **not** imply
intact-character callback eligibility.

| Installed dispatcher               | Pedestrian eligibility                      | Detached type5 result                                  |
| ---------------------------------- | ------------------------------------------- | ------------------------------------------------------ |
| Passive activation `4162d0–416312` | Nonnull owner, type2..4                     | Default return1; no `40b620` and no passive damage     |
| Halt `416290–4162cc`               | Nonnull owner, type2..4                     | Default return1; no `409400`/get-up/character settling |
| Moved `416320–41635a`              | Nonnull owner, **type2 only**               | No character moved callback                            |
| Active contact `41d991` / `41da16` | Nonnull owner, type2..4, grouped force gate | No intact pedestrian active-damage callback            |

Type16 drone branches are separate. These dispatchers do not select the
noncar reclaim/moved policy for type5 either. The stable detached ACT is
advanced by generic physics; its motion is not written back into the parent
character's root pose or character V.

The character vtable at `65c2e8` has passive `4cd9b0`, halt `4d0de0`, moved
`4d26f0`, completion `4cbcc0`, fill `4cc860`. It is reached through the above
eligibility wrappers. Completion is an **animation** outlet: `409e7e–409e93`
checks and clears character byte9 bit2 before calling vtable+0c. It is not
a generic rigid movement-completed callback. Detached type5 motion therefore
does not drive the parent's move90/91/92 completion/get-up machine.

The type5 fill `4cc860–4cc879` initializes exclusion filters A40000/B50000.
Generic pair eligibility uses `(A.a & B.b) | (B.a & A.b)` and rigid flag4,
with hierarchy/self/group guards. Do not convert these exclusions into
membership masks or restore intact type2 masks after a fragment sleeps.

## Header state, quiet and halt history

Initial registration is passive state1. Initializer properties give drag0,
gravity1, header volume bit8 and level-out scalar `Float32[74299c]`, with
header bit4 also enabled. The active sever tail executes only when character
physics bit4 is set. It clears ec, copies raw world V and BODY omega, enables
PHIL state2 and clears suppressions3/4/5. No additional RNG or conversion6.9
is introduced by this tail.

The activation argument is significant:

- `40b983–40ba53` calls `4b5e30` with final argument0: header callback bit2
  is cleared.
- Intact `CharacterMakeActive` pushes1 at `40b6d1`, calls at `40b6d9`;
  explicit physics level5 pushes1 at `40968a`, calls at `409692`.
- A later generic passive-contact activation `4b6f50` calls `4b5e30` with
  final argument1 at `4b6f89–4b6f91` (or `4b6f99–4b6fa1`). Type5's default
  passive callback returns1, so type5 is not permanently exempt from bit2.

`PHILMakeObjectActive` itself changes state/header flags and optional vectors,
but **does not clear ec**. Geometry wake or the character/sever caller owns
that distinct mutation. Keep actual header history rather than deriving bit2
from rigid type.

`ChangedObjectsCallbacks 4b6980` runs once after the outer frame's40ms steps
and interpolation. For state2/ec0 it invokes moved; type5 dispatch is a no-op.
For state2/ec1 it invokes halt **only when header bit2 is set**
(`4b69d7–4b69e3`). Without bit2 it keeps state2/ec1 and its normal PHIL header.
With bit2, type5's default halt1 accepts state1/passive flag20; it still keeps
the same body/header/FORM slot. Neither branch frees, fades or removes it.

Header bit4 has a distinct meaning: awake changed objects record their ACT
matrix through replay function `4c8a70` (`4b6a47–4b6a62`). It is not a gravity,
level-out or animation-completion flag.

Quiet is generic `4ba7a0`, with no type5 timer. Post-contact flags precede the
leaf and whole-ring eligibility passes (`4ba688–4ba764`). Qualifying leaves
zero world V, BODY omega and auxiliary omega. Whole ring/hierarchy acceptance
sets ec1 and clears retained quiet bytes; header state is unchanged. Its exact
linear/angular/gravity/corner tests are documented in
[the lifecycle note](c2-ped-physics-lifecycle-re.md). The existing independent
quiet kernels can serve an actual free type5 leaf with its own shape bounds,
COM, moments, cached velocity/omega and gravity packet. A mixed ring cannot
sleep partially; retained joint2 and children require the actual hierarchy.

## Per40ms generic preparation and forces

The force pass `4b6538–4b6558` requires ec0, nonnull PHIL header and state2.
There is no special type5 force callback. Passive state1 is marked f0=2
recursively (`4b673a–4b6767`); state2/ec1 skips this force pass. The independent
ec/header distinction must survive engine sleep and registration adapters.

When header bit8 is set, retain old depth `+254` and volume `+258`, optionally
run `TestAutoSpecialVolume 4ff360` unless water-plane D `+250` is10000, then
`MungeSpecialVolume 4ff1a0`. Selection uses the physical object's `+80` point,
with previous-volume `+25c` fallback. Car-specific sound and fire clearing
inside `4ff1a0` explicitly require type1; they do not apply to the bone owner.
Required volume geometry, cached water plane/depth and source model bounds
remain actual providers, not parent personality/car volume substitutions.

Gravity is applied before `InternalPrepareObject`. The outer gate
`4b658f–4b65d0` runs when header gravity is nonzero, or when a volume exists
and header bit8 is enabled; zero header gravity uses fallback1 in the latter
case. `ProcessGravity 4b6c60` computes a vector with X/Z0 and the following Y,
stored Float32 before copying to `Object+54..5c` (`4c2780`) and adding to world
V (`4c26c0`):

```text
g = actual nonzero headerGravity, otherwise the gated fallback1
G = global Float32[74b348]
d = actual object Float32 depth+254
L = header Float32 levelOut+14

no selected volume:
    dy = f32(g * G * double(-0.05681159420289855))
selected volume, L != 0 and viscosity > double(2):
    dy = f32(((1 - volumeGravity) * d * L
              - g * G * double(1.4202898550724639)) * double(.04))
other selected-volume case:
    dy = f32(volumeGravity * d * g * G
              * double(-0.05681159420289855))
```

These are raw native world velocities, not metric V. No extra6.9 belongs in
gravity. Header drag0 skips ordinary air drag (`4b65d5–4b6629`), but selected
volume plus bit8 enables fallback drag1. Drag `4b6a80` starts
`k=f32(drag*double(.00002))`; selected volume multiplies by its viscosity and
depth, with another factor.5 when L!=0 and viscosity>2. Its linear decrement
uses `V * (k * |V| * 6.9 / M)`, with individual Float32 vector stores and
zero-crossing suppression in `515d70`. BODY angular drag is separate through
`4c2a40`, using the actual per-bone moments; generic car damping coefficients
are not an interchangeable provider.

Additional drag passes at `4b6636–4b66df` distinguish entering a fully immersed
viscous volume from leaving one, retaining the old depth/volume. Surface
levelling `4b6724→4b6d50` requires L!=0, selected viscosity>2 and depth<1.
It selects the strict greatest-moment ACT axis, with ties eventually falling
to Z, and uses the physical water-plane normal `+244..24c`. This research
does not claim a complete independent level-out/drag port; use the generic
source provider or expose the missing volume branch explicitly.

After forces, generic preparation `4b9780` resets contact flags/ring, snapshots
world V to `+1b4`, BODY omega to `+1cc`, creates solver-local V at `+1a8`, and
handles retained quiet moment scaling. This phase is shared by type5. Actual
BOX/LINE/SPHERE contact collection and physical face cache must use the bone's
current MODEL/shape, not the intact personality profile.

## Movement and retained joint fields

The sever unlink `40b961–40b97d` clears parent+228, child+224 and joint1+188.
It does **not** clear joint2+18c. Do not overwrite that retained field merely
because ordinary simple-personality fragments happen to have it NULL.

The free-leaf movement tail `4b74e3–4b7534` updates ACT translation
`p[i]=f32(p[i]+V[i]*dt)` and calls generic angular rotation `4c1990`.
Collision movement branches supply their actual dt; do not insert another
character root update or use an independently chosen particle timestep.
Outer interpolation `4c25e0` translates by raw V\*dt and rotates about COM
through auxiliary omega `4c2420`, then traverses children. The generic rotation
uses diagonal local moments, transported angular momentum, BRender angle
quantization and source angle-dependent substeps; ordinary quaternion Euler
integration remains a documented host approximation where used.

**Address correction:** `4c1680` after the quiet pass is angular constraint
limiting, not the position integrator. Its branches inspect joint1+188 and
joint2+18c (`4c1689`, `4c18a1`). It is a no-op when both are NULL; surviving
joint2 requires its source constraint branch. This refines the older lifecycle
note's phrase that awake bodies integrate through that address.

## Release, vanished bits and stored ACT poses

Removal is character scope/resource ownership, not noncar reclaim or quiet.
`CharacterNoLongerCollideworthy 409090` ordinary-simple branch removes its
simple header first. With a removed mask and nonnegative boned slot, it then
visits FORM indices1..boneCount-1 in increasing order for every removed bit:

1. Read the part PHIL state through `4b5db0` at `40911c`.
2. State2 sets that part's character vanished mask `+10` (`409126–409132`).
   This includes state2/ec1 fragments: ec alone does not preserve them.
3. Remove its PHIL header `40913b`, clear contact-ring pointer `+1d8` and
   owner `+23c` (`409140–409154`).
4. Set boned slot byte+6=-1, mark its FORM slot free, clear character physics
   flags+14 (`409164–40916c`). Allocated FORM bodies/shapes are retained.

`CharacterNoLongerRenderable 408400` calls this release before saving render
poses outside replay. It copies the current root to character stored pose+2c,
then finds the first free authored stored-dismembered record
(`408487–4084dc`). A record stores occupancy1 followed by48-byte ACT matrices;
each removed part's current ACT matrix is copied at `4084eb–408532`. No free
storage sets pointer+28=NULL. It removes all render bone ACTs using `4cba40`
and sets render slot+4=-1. It does not allocate a generic corpse replacement,
reattach removed limbs, invent a lifetime or delete shared MODEL resources.

On reacquisition `408f46–409019`, reuse/reserve the first available FORM boned
slot and visit indices1..N-1. Only removed **and not vanished** bits are
initialized/registered through `4085f0` at `408fda`; successful reinitialized
parts explicitly get zero world V and BODY omega (`408ff5–409004`). Failed
capacity/registration is tolerated by this loop. Reusing an old active launch
velocity or clearing vanished bits on visibility changes would be wrong.

## Runtime integration contract

- Share the normal100 registrar and retain each source FORM/body/ACT identity.
  Use actual per-bone shape, moments, COM, source bounds and generic volume
  providers. Do not enroll a separate unlimited fragment pool.
- Gate forces on actual header state2/ec0. Keep drag0 in dry air and preserve
  header bit8/level-out; do not borrow the intact type2 callback handlers.
- Reuse generic quiet only with the complete contact ring/hierarchy providers.
  Initial sever halt-bit2 is false; later activation can change it. Quiet never
  releases a slot, and default accepted halt also retains body/header.
- Synchronize the same stable bone ACT from generic physical motion. Do not
  mutate the parent character root, trigger animation completion or score a new
  pedestrian death from a detached bone contact.
- Release all associated type5 headers before making the boned FORM slot free.
  Preserve removed/vanished masks and stored ACT poses across offscreen scope.
  The source noncar driver4/ec reclaim pass has no ownership over these bodies.

No runtime files or tests were changed for this read-only audit. Remaining
host work includes exact generic drag/level-out, full-matrix angular movement,
surviving articulated joint2, source animation/render-slot storage and the
shared PHIL mutation phase. Analytical sphere/line contact ownership is a
separate collision provider, not a box approximation justified by this note.
