# C2 intact simple pedestrian body runtime

## Evidence and scope

The intact simple body now enters `VehicleSimulation`'s existing hull contacts,
normal/friction solver, contact recollection and integration guards. This is an
engine integration; character animation, form slot allocation, render binding,
get-up and severing remain explicit owning-system providers.

Installed HW executable SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c` and PE
metadata are recorded in [the lifecycle note](c2-ped-physics-lifecycle-re.md).
The following addresses were checked directly in the installed disassembly;
`madebr/rec2` remains a symbol/layout map. No original assets, executable bytes
or reference code were copied into source fixtures.

The implementation uses authored remapped FORM/personality bounds, COM, total
mass and `.025` box moments, with a finite normalized twelve-value native ACT
root basis. It has rigid type2 and does not substitute a visual Y-major box.
Initial source HP is signed-byte100; flags start0. Allocation does not arm
pedestrian flags0x20/0x40: those require actual outer character update visits.

## Engine phase contract

`src/physics/ped-body.ts` separates passive/active header1/2, do-nothing `ec`,
world recovery `ed`, phase marker `f0`, the three suppressing properties,
exclusion masks, collision flags and retained quiet state. Activation copies
character world V, preserves existing omega, clears `ec` and properties3/4/5,
sets header2, world recovery and gravity1. It introduces no car kick or spin.

1. Active header2 bodies with `ec=0` receive the native Float32 gravity increment
   `f32(-.05681159420289855 * headerGravity * globalGravity)` each40ms. Header
   drag0 receives no generic car/free-body air drag. Passive headers receive
   no force/integration. Installed `0x4b674a` marks passive headers `f0=2`
   during this phase.
2. Preparation after forces and before solving snapshots world V and local
   omega, initializes mutable solver-local V, clears collision flags and
   resets contact groups. Retained quiet candidates temporarily use moments
   multiplied by50 (`0x4b9885–0x4b98c3`), restored by division50 before leaf
   evaluation (`0x4ba7bb–0x4ba7e8`). Host omega remains stored in world axes;
   explicit basis conversions supply native local omega to the kernels.
3. Real emitted hull contacts activate passive bodies before lambda solving.
   Passive damage follows activation, including when flag0x40 is clear: the
   damage kernel then returns ineligible without preventing physics activation.
   Contact masks reject every body narrow-phase collection, moving-world owner
   contact and both trajectory commit/projection guards. Their semantics are
   exclusions, `(A.a & B.b) | (B.a & A.b)`, not membership categories.
4. Geometry contacts join the contact graph independently of lambda. This
   matches installed `0x4bda86→0x4bdb70`; the ring merge occurs before the
   later solve and is not derived from the friction callback queue. World rows
   do not join unrelated bodies through a shared floor.
5. Existing geometry/damage restart processing runs first. An accepted
   pre-application solve invokes active pedestrian contact damage with greedy
   source row grouping, total lambda, first selected row lambda, pre-application
   pedestrian VY and the selected source face normal/force. Installed
   `0x4bbbf5/0x4bbc13` invokes the callbacks before normal application at
   `0x4bbc30`; active damage therefore runs here rather than after integration.
6. After the final accepted solves, normal rows produce collision flags through
   the independently verified queue kernel: nonzero signed lambda, excluding
   types9/11, first50 records, type14/world bit1 versus pair bit2. Rejected
   solves do not enter this queue. Solver-local V is reconstructed from the
   final world V using the unchanged pre-integration rigid basis. The native
   quiet leaf then zeros world V, local omega and auxiliary omega for eligible
   leaves. `0x4ba7eb` resolves nonzero phase markers from passive registration
   before evaluating quiet. Whole connected-group eligibility requests `ec`
   sleep before the existing movement/commit guards run.
7. Active moved/halt callbacks run once after the outer frame's physics steps,
   with that outer frame period. Direct standalone `step()` calls supply40ms.
   Final-substep flags replace earlier flags: if a body slept on an earlier
   substep, the final sleeping preparation can leave collision flags0. Ordinary
   moved processing runs the source angular settling helper from the physical
   root and first cached world face. A missing halt provider leaves the body
   asleep/active and reports a diagnostic; it never invents a two-second timer.
   Accepted halt restores passive registration, suppression properties and
   intact masks, clears volume state and copies final body V to character V.
   Rejected halt preserves active registration and permits further physics.

These steps reuse the engine's existing additional trajectory recollection and
commit safety guards. Their bounded extra solves are host safety behavior;
this integration does not claim to replace the complete original PHIL loop.
The native first50-row flag queue is implemented, while the shared existing
contact solver's friction application does not yet enforce that global queue
capacity. This is a distinct remaining generic-solver compatibility gap.

## Public ownership and providers

`createNativePedBody({actor, profile, rootPose, levelOut})` validates and creates
an intact root. `positionPassivePedBody(body, rootPose)` updates its explicit
walking pose; `activateNativePedBody(body, characterVelocity)` is the native
activation path. `nativePedRootPose(body)` exposes the physical BRender root
basis and origin. `VehicleSimulation.addPedBody/removePedBody` register and
release the same body; neither allocates/replaces the character-owned actor.
The character system must enforce its per-form pool and PHIL registration
capacity/lifetime and keep the passive character world V current.

The physical actor requires unit scale and a world-coordinate parent. The
visual wrapper, animation root basis and current character orientation are
separate character-system responsibilities; a render wrapper's matrix cannot
replace the native authored root pose.

| API                                             | Owning-system responsibility                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `body.characterVelocity`                        | Current native character world V, available before passive activation                                                    |
| `body.hitPoints`, `body.pedestrianFlags`        | Live signed-byte HP and source outer-update/contact flags                                                                |
| `body.contactProvider(body)`                    | Explicit GENERAL settings, FORM contact fields and powerup/gore/severing state; live body HP/flags override its snapshot |
| `body.onActivated(body, other)`                 | Character active-bit/reaction ownership after physics activation, before damage and solving                              |
| `body.onContactDamage(body, result, phase)`     | Native damage result, reaction/event/model ownership and unresolved outlets; phase is passive or active                  |
| `body.onMoved(body, framePeriodMs)`             | Write physical pose/V through current root-animation inverse and character orientation                                   |
| `body.onHalt(body, framePeriodMs)`              | Source halt decision; return true to accept passive registration, false to continue active physics                       |
| `body.worldFaceNormals`, `firstWorldFaceNormal` | Ordered actual cached physics-face normals for halt/settling; no invented floor normal                                   |
| `simulation.nativeQuietRingSleep(members)`      | Apply native ec to the complete external ring and return true to confirm ownership                                       |
| `simulation.nativeQuietRingState(body)`         | Native hierarchy-folded quiet state for existing non-pedestrian ring members, when available                             |
| `body.diagnostics`                              | Explicit missing/unsupported-provider identifiers                                                                        |

No contact provider means no fabricated damage settings or powerup state.
When the contact kernel reports an unresolved severing-before-HP outlet, or
an unresolved special-type32 mass, the runtime forwards the result/diagnostic
and retains HP/filter state instead of applying a hypothetical downstream HP
tail. Full installed gore2 therefore still requires a real severing provider.
An explicitly selected intact/no-sever scenario can supply its appropriate
source state and use the implemented common tail.

## Bounded gaps

Existing cars, props, detached hierarchies and mines do not expose the complete
native quiet `+0x1df` hierarchy contract. A pedestrian ring containing such a
member therefore has unknown member state0 and cannot sleep partially. The
runtime reports `mixed-contact-ring-quiet-provider-unavailable`; explicit
`nativeQuietRingState` and `nativeQuietRingSleep` providers can supply the
folded state and apply sleep to the complete generic ring later. Without both,
the runtime continues to block mixed-ring sleep; a getter alone cannot
authorize partial application.
Pedestrian-only intact rings use the leaf/group kernels directly. This choice
preserves existing car/prop physics instead of pretending their velocities
alone establish native sleep eligibility.

Special-volume forces/level-out, nonzero header drag, articulated joints,
severed bodies, powerup-specific move callbacks, native character pool/PHIL
capacity, root-animation inverse, source face-cache lifetime, scoring/gore and
full ordinary halt/get-up are not silently replaced with generic behavior.
Special-volume or nonzero drag requests produce diagnostic identifiers; volume
force processing is withheld when the required source provider is absent.

Explicit Float32 stores are preserved; JavaScript double still substitutes
for live x87 extended precision. The solver's existing velocity/impulse
arithmetic and source feature ordering retain their previously documented
precision/renderer limitations.

## Validation

`tests/ped-body-simulation.test.mjs` has seven passing engine/numerical checks:
original human `blokebl` mass `.06800000369548798` and dog `twolf` mass
`.04699999839067459`, authored moments and centered plane impulse; exact40ms
gravity/no drag; original Eagle hull contact activating a flag0x40-clear
passive body with copied character V and zero added omega; source world-contact
flags, quiet zeroing before commitment and one halt callback after a three-step
outer frame; exclusions in contact/commit guards; and whole emitted pair-ring
sleep with conservative rejection for an unknown external member. Original
installation tests read only and skip when absent. Nine existing pair-guard
checks and `npx tsc --noEmit` also pass. No production build or browser bridge
validation was performed by this engine-only task.
