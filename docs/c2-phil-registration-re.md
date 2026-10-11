# PHIL registration ownership and shared capacity

Verified from the read-only installed `carma2_HW.exe`, SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`,
PE32 image base400000, entry577eb0. rec2 is a symbol and structure map;
several physics/opponent annotations are shifted relative to this executable.
This note contains no copied implementation or proprietary binary dump.

## Integration conclusion

**Ordinary active car roots share the same100 PHIL headers as pulled noncars,
promoted detached car parts, deployed mines, processed intact pedestrians,
articulated pedestrian roots and individually severed bones.** A hierarchy
child does not automatically consume another header. A render actor, body
allocation, sleeping body or entry in the engine's generic contact array does
not by itself establish registration ownership.

Use one persistent registrar keyed by native rigid-object identity. Register
at the actual source add boundary, retaining ownership while active or passive;
release at the source remove boundary. Do not build a pedestrian-only100-header
pool or count every collider/hull/joint descendant as a registered root.
The existing `NativePedBodyPool` registrar interface can call this owner, but
the registrar must also receive the other participating source lifecycles.

## Registry, returns and list insertion

| Installed address  | Operation                                                |
| ------------------ | -------------------------------------------------------- |
| `4b5a60`           | PHIL initialization                                      |
| `4b5ac0`           | PHIL disable flag becomes1                               |
| `4b5ad0`           | Free count =100 minus registered count                   |
| `4b5ae0`           | Generic add; normal registration or pending-add mutation |
| `4b5c40`           | Generic removal/cancellation or pending removal          |
| `4b5d70`, `4b5d90` | First/next registered object access                      |
| `4b5db0`           | Header state lookup                                      |
| `4b5e30`           | Activate an existing registration                        |
| `4b5f40`           | Replace a passive object's matrix                        |
| `4b5fb0`           | Generic add-active wrapper                               |
| `4b6050`           | Immediate add wrapper used by pedestrian initialization  |
| `4b6080`           | Immediate add-active wrapper used by pull/detachment     |
| `4b6150`, `4b62d0` | Set/get header and body properties                       |
| `4b63d0`           | PHIL outer physics window and mutation flush             |

Normal headers are `690ae8..691448` (end exclusive), stride24 bytes, exactly100.
Global registered count is690a70; root list is748790. `4b5ae0` scans increasing
header index, remembers the **first** empty header, but continues scanning to
detect an identical existing body. Returns are0 success,1 full,2 duplicate.
Duplicate detection therefore wins even when no free header exists.

On success, `4b5b77–4b5ba1` clears that24-byte header, writes its body pointer,
state1, the body's header pointer+240 and indicator+239=1, and ORs passive flag20
into body flags+19c. It increments the count. Empty-list insertion gives a new
head. Otherwise `4b5bbb–4b5bf1` inserts **after the current head**, updating
next+220 and previous+22c. This is not append-to-tail order. When doing-physics
748798 is set, `4b5c0d` calls PrepareObject4b9510 immediately, which may sort and
append the object to the current reduced collection. List ordering after this
preparation cannot be inferred solely from initial header insertion.

PHIL initialization clears normal header body pointers and all global counts,
the root list, munging/doing-physics/override flags and retained physics tick;
time-sync starts1 and disabled flag65bb74 starts0. The free-count getter simply
subtracts the registered count; it does not reserve entries for a particular
class or include uncommitted pending adds.

Disabled PHIL (`65bb74!=0`) causes add/remove/activation wrappers to return0
without their normal ownership mutation. An engine adapter must expose that
phase explicitly; interpreting this as a freshly allocated header is wrong.
The displayed production pool needs normal enabled registration, not replay
success without an owner.

## Actual participants and release boundaries

| Participant                                     | Installed registration evidence                                                                                                                               | Release / ownership boundary                                                                                                                                                                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Player, active opponents/cops/network cars      | Active-car rebuild`4a7820`; player add`4a78f5`, network/AI add`4a7991`/`4a7ae3`, helper`4a7c40` adds through`4b5fb0`                                          | Rebuild remembers currently registered type1 owners with driver>5, preserves those still wanted, then helper`4a7c90` removes leftovers at`4a7ca3` and clears contact ring+1d8. Rebuild selection owns physics activation, not camera mesh visibility.                                                       |
| Authored attached car/noncar hierarchy children | Generic add registers only its body argument and does not recurse children; physical child-link operations are separate                                       | No independent header solely because the child exists. A promoted independent root must execute its explicit add.                                                                                                                                                                                           |
| Pulled generic noncar/world prop                | `DoPullActorFromWorld 41ff40`, successful tail`42031b–420322`, immediate active-add`4b6080`                                                                   | Sleep/reclaim returns retained ACT to world and clears ACT.type_data; remove`42076e`. Its physical body slot/ACT resources are separate capacities. Pull does not inspect active-add's return at420327: do not claim successful header allocation from ACT pull alone.                                      |
| Promoted split/detached car part                | Explicit noncar-wrapper promotions add`42efbb`, fully detached promotion`42f4e5`, another detached-geometry promotion`4334b2`, all via`4b6080`                | Reattachment/repair removes the independent wrapper at`434096`, clears its active-noncar entry/ACT linkage, then rebuilds the original hierarchy. Additional disposal removals exist; do not retain a header merely because the detached render mesh remains.                                               |
| Deployed mine                                   | `InitMineShit` creates20 reusable sphere objects, type40, but does not register all20; actual deployed-mine tail`4dd2db` calls`4b5fb0`                        | Explosion removes at`4dd95e`, before delayed1600ms mine cleanup, explosion rendering and hiding. An available unused mine resource has no header.                                                                                                                                                           |
| Intact processed pedestrian                     | Current stable root ACT/current MODEL initialization`4085f0`, immediate add`4086f9→4b6050`; ordinary simple acquisition`408f16`                               | `CharacterNoLongerCollideworthy 409090` removes simple body`4090c1`, separately clears owner+23c/contact ring+1d8 and frees the same FORM slot. Accepted halt merely makes the existing registration passive; it does not free the header. Render release`408400` invokes collision release outside replay. |
| Full articulated pedestrian hierarchy           | Boned acquisition starts`408c30`; first-registration variable starts1 at`408d0d`, first shape-bearing bone calls`408e1f`, then clears the variable at`408e28` | Only the first shape-bearing root obtains a header; other type3/4 bodies remain descendants. Boned release finds the corresponding root and removes at`4091a7`. Counting every FORM bone here would overcharge the100 pool.                                                                                 |
| Individually severed bone                       | Sever`40b8ff–40b937` supplies register1 and selector3 (type5) to`4085f0`; each successful independent sever consumes one header                               | Successful missing-mask mutation follows registration. Simple-character removed-part release checks state, marks active parts vanished, and removes each at`40913b`, clears their owner/contact ring, then frees the boned slot. Reloaded surviving removed parts can reinitialize/add at`408fda`.          |
| Physics-processing drones                       | `44fe5c` and`451c49` use generic add`4b5ae0` before source properties; only processing bodies, not every loaded drone                                         | Stop-processing/disposal remove callsites include`45025b`/`451d88`; source form/resource disposal is separate. Their type10 roots compete with the same registry.                                                                                                                                           |
| Physical mutant-tail powerup object roots       | Verified generic add-active calls`4dfee3` and`4e032d` on the retained object69ef98; type20 resources, joint descendants distinct                              | Matching cancellation/removal calls`4e010d`/`4e0521`. Do not count each render link as another root.                                                                                                                                                                                                        |

The table identifies actual add/remove outlets; it does not claim that every
generic engine object currently has a complete equivalent native lifecycle.
Ghost/render shards, oil actors, sparks and smoke actors are not registered
merely for being visible. Noncar connotation debris becomes a participant only
through the actual pull path, not through the shared render-fragment pool.

## Immediate wrappers and mutation phases

Generic pending-add is selected only when **munging**748788 is nonzero and
immediate override690a74 is zero. This differs from doing-physics748798:
being inside an impulse callback does not alone mean registration is deferred.

`4b6050` sets override1 while munging, calls generic add, then clears override.
`4b6080` does the same around generic add-active. Consequently pedestrian
simple/bone acquisition and noncar/detached-part pull use immediate normal
registration even in this phase. The source header can fail immediately from
full/duplicate state. Generic add-active`4b5fb0` preserves add's nonzero result
and otherwise activates the new/pending header. Immediate active-add can also
return3 for absent header or4 for an incompatible passive-matrix replacement;
it is not the boolean convention of initializer4085f0 (1 success,0 failure).

Within each PHIL40ms step, `4b677b–4b679a` sets munging1 for the generic object
update4ba450 and then clears it. The source post-step callback is called at
`4b67a0–4b67a7`. The flush then processes pending adds in increasing record
order (`4b67a9–4b6845`) **before** pending removals (`4b684b–4b6871`), before
advancing the retained physics tick40ms. Added objects may receive a captured
passive matrix, optional V/omega, active state and copied scalar properties.
Copied flags exclude bit2, matching the zero activation argument.

The pending add layout is100 bytes: body0, properties4/8/c/10/14, captured
V18, omega24, matrix30, flags60. Body indicator+239 becomes2 and its +240
points at that pending record. Only fields explicitly written by the add are
set there (body, state1, capture flags0); it is not a full pending-record memset.

**Literal storage alias, not extra capacity:** rec2's `tPHIL_queued_objects`
is a union of25 pending records and a prefix pending record plus padding and
100 normal headers. Installed pending base690a80 and normal base690ae8 differ
by0x68, confirming the overlap. Removal pointer storage starts690a7c, immediately
before that union; rec2 declares a one-entry removal array. Binary pending-add
and pending-removal paths show no capacity guard before incrementing their
counters691450/69144c. Multiple pending records can overlap normal-header
storage. The effects of rare larger mutation episodes have not been exercised
here; no safe independent25+100 allocation is proved by this layout.

Direct writes to these counters found in this binary are initialization and
increments; the inspected step flush does not explicitly reset them. An
indirect/global clearing path is not established by this audit. Do not silently
invent a per-outer-frame reset or reproduce unchecked memory writes. A bounds-
safe port should retain explicit mutation phase/capture ordering and diagnose
unsupported overflow/alias episodes while keeping normal100 ownership exact.
The immediate production pedestrian wrapper does not require that ambiguous
pending-add branch.

## Removal and retained pooled defaults

Removal`4b5c40` first distinguishes a pending registration (indicator2): it
nulls the pending record body, clears body header pointer and indicator, and
returns0. For normal registration during munging without override, it queues
the body pointer and returns0; the count/header remain owned until flush.

Immediate normal removal scans for the registered body and validates its
header pointer. Absent registration returns3. Success nulls the normal header
body, clears body header pointer, decrements count and unlinks the root list.
It updates the successor's previous link; predecessor lookup scans registered
headers for the body whose next points at the removed body. It does **not**
recurse children, free the body/shape/ACT, clear normal indicator1, flags+19c,
owner+23c, contact ring, V, omega or FORM slot occupancy. Those actions require
their source owner outlet. Registering a different body in the vacated header
clears the24-byte header anew.

Fresh FORM body defaults are verified, not guesses: installed
`BrMemAllocate 526c00` calls the configured allocator then
`memset(block,0,size)` at`526c18–526c23`. Thus a fresh simple/boned body has
object friction+64=0 and collision flags+19c=0. `SetUpCharacterForm 4059f7`
assigns per-bone mass/shape and simple-body total mass/BOX separately.
`4085f0` sets world friction+60=1 but does not rewrite object friction+64 or
clear all collision flags. **Reacquisition must retain the old pooled fields**
until the specified initializer/property operations change them. In particular,
removal alone does not restore the fresh-zero flag state.

For the shared registrar integration, keep header status/capacity, FORM slot
ownership, PHIL active/passive state and ec do-nothing state separate. Complete
deferred removal before allowing that body slot to change owner, preserve
actual root identities through model changes, and expose disabled/replay or
unsupported mutation episodes instead of accepting an unowned fake header.

Related notes: [pedestrian pools](c2-ped-body-pool-re.md),
[detached bone initialization](c2-ped-bone-body-re.md),
[noncar pull/wake](c2-noncar-wake-pull-re.md),
[noncar reclaim](c2-noncar-slot-reclaim-re.md).

## Browser ownership bridge

`VehicleSimulation.phil` now owns one normal100 registry shared by admitted
cars, intact native pedestrian bodies, detached bone/car roots, deployed mines
and promoted noncars. Loaded static scenery and attached visual pieces do not
reserve headers. Removing a mine on explosion precedes its delayed actor/body
cleanup. Car reactivation and repair/reattachment reuse the normal admission and
release paths. Persistent `rigidFlags` represent Object+19c; per-step contact
flags Object+1dc are separate and cannot overwrite them.

Production Chromium checks on the checked bundle confirmed a Carrier player
and eight rivals used nine headers, all 93 initially static noncars had none,
and a physical contact promoted `&98l0341.ACT` into one header. Mine deployment
added one header, explosion removed it while the delayed body was still retained,
and seven detached car roots had distinct headers. Headless capacity checks also
prove that a failed additional mine admission does not erase an existing mine,
and a full registry rejects a car before changing the active car array.

This is actual shared ownership, not the complete native PHIL traversal. Generic
simulation arrays still determine collision enumeration; deferred munging/flush,
PrepareObject during physics, full hierarchy collection and some noncar promotion
chronology remain explicit integration gaps. The displayed pedestrian population
has not yet migrated to the native FORM/body host. Do not infer that those source
episode requirements are complete from passing capacity or lifecycle checks.
