# C2 contact damage and ordinary pedestrian severing

## Evidence and scope

Verified by static inspection of the read-only installed `carma2_HW.exe`,
SHA256 `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
PE32 base400000, entry RVA177eb0, linker5.10 and timestamp1998-10-18
20:13:36 are recorded in the related pedestrian notes. Installed instructions
in `/tmp/c2-hw-smash-disasm.txt` and selected `objdump -s` reads were checked.
`/tmp/carma-rec2/src/carma2/common/pedestrn.c` and
`include/rec2_types.h` provide the symbol/structure map; many collision and
character-physics functions are stubs, and several annotated addresses differ
from this installation. No C1 severing implementation was used.

This is an executable branch map for **ordinary contact severing of a rendered
simple humanoid**. It accompanies [contact damage](c2-ped-contact-re.md),
[simple body construction](c2-ped-simple-body-re.md),
[halt](c2-ped-halt-re.md) and [body runtime](c2-ped-body-runtime-re.md).
`src/physics/ped-sever.ts` now implements the ordinary humanoid/brittle
selection, reservation, registration, mask and common-tail contract. Twenty-four
numerical/data tests cover its source equations and failure ordering; three
contact-tail tests cover the upstream callback seam. `ped-contact.ts` accepts
an optional complete damage-tail owner before applying HP. Original displayed
pedestrians are not connected to these model/body providers yet. Exploding,
nonhumanoid and articulated outlets remain explicit provider requirements.

A no-bone-selected native result is complete
and must proceed to HP handling. A missing implementation/provider is a
different result and must remain explicit.

## Installed entry points

| Address                      | Role                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `4cd9b0`, call at `4cdb1f`   | Passive callback and its common-damage call                                             |
| `4d20e0`, call at `4d21a9`   | Active contact helper and its common-damage call                                        |
| `4cd3f0–4cd61e`              | Normalize damage, attempt severing, then HP/reaction/kill tail                          |
| `4cd480–4cd4fc`              | Repeated sever-budget/chance/random-bone loop                                           |
| `4cd790–4cd99d`              | Descendant-first sever wrapper; stump counter and replay/actor effects                  |
| `40b860–40ba6e`              | Allocate/register/detach one bone body; return1 success,0 failure                       |
| `4085f0–40879e`              | Set up bone object from current actor/model bounds; PHIL registration and fill callback |
| `4cc860`                     | Installed `CBFillInObject`: type5 filters A40000/B50000                                 |
| `4b6050`, `4b5ae0`           | PHIL registration wrapper and registration/deferred queue                               |
| `4b5e30`                     | PHIL activation; mutations can be queued while resolving physics                        |
| `4c89a0`                     | Replay pipe record for bone severing, including old/new boned slot                      |
| `51d620`                     | BRender actor-add operation                                                             |
| `512f30`, `512f00`, `513030` | PercentageChance, inclusive integer range, symmetric float range                        |
| `575f80`, global `671ff0`    | Shared CRT rand and persistent state                                                    |
| `4ccc20`                     | KillPedestrian: dead models, gore, count and death dispatch                             |
| `4ccf10`, `4cd010`           | Once-only count/race handling and HP0/action6/death-time/score handling                 |

The installed callback table at `65c2e8` independently confirms the passive,
halt, moved, completion and fill addresses. Its fifth pointer is `4cc860`.

## Damage inputs and sever eligibility

Both calls supply `ECX=ped`, `EDX=raw integer damage`, followed by stack
arguments `(aliveMove, deadMove, otherObject)`. Passive supplies alive90 and
dead91/92 according to its momentum-squared test. Active supplies alive-1 and
dead94. The common helper receives **neither contact-force vector nor face
normal**. Those active inputs remain for later blood, scrape and contact-flag
branches. There is no contact-direction bone selection in this outlet.

Normalization precedes severing: retain integer `D=trunc(raw*(double .068 /
selectedSimpleBodyMass)^2)`, with the documented nonhumanoid brittle/exploding
minimum100. `EBX` retains D for HP; a separate Float32 remaining budget starts
at D. Spending the severing budget never subtracts from HP damage.

`4cd464–4cd47e` skips all sever calls/draws if any of these holds:

- `otherObject == null` (world contact, even an exploding pedestrian);
- immortal-ped mode is nonzero;
- gore level is less than2.

No living-HP check precedes this gate: an already dead corpse can sever.
`otherObject` need only be nonnull; this gate does not require a car/type1 or
an owner. Callback eligibility, active raw-zero early exit and passive flag40
eligibility occur in the callers, as documented separately.

Stock `data/PEDS/settings.txt` GENERAL records8/9 are sever threshold40 and
chance10 percent (installed globals `6928c4` and `69a29c`). Brittle changes the
per-attempt threshold to5 at `4cd48a`. Exploding bypasses chance but does not
change this threshold unless brittle is also set. Exploding raw damage is
5*GENERAL threshold for passive and boneCount*GENERAL threshold for active,
before mass normalization. The fixed successful-count gate is5, separate from
these data values.

## Exact budget, draw and recursion order

The following finite-input pseudocode exposes the source order. `f32` denotes
a spill; comparisons use the live subtract result before that spill is
reloaded. For stock damage sizes, these integral subtractions are exact.

```text
remaining = f32(D)
newlyDetached = 0
if other != null && !immortal && gore >= 2:
    loop:
        threshold = brittle ? 5 : GENERAL.severDamage
        difference = remaining - threshold
        remaining = f32(difference)       // 4cd4a6: fst, not fstp
        if difference < 0: break
        if newlyDetached >= 5: break
        if !exploding && !brittle:
            if !PercentageChance(GENERAL.severChance): continue
        index = IRandomBetween(1, form.boneCount - 1)
        newlyDetached += severSubtree(ped, index)
if newlyDetached > 4:
    ped.cache.flags2e |= 2
continueCommonHpTail(D, postSeverCharacterMask)

severSubtree(ped, selected):
    count = 0
    for child in ascending FORM index order:
        if FORM[child].signedParent == selected && !(character.mask & bit(child)):
            count += severSubtree(ped, child)
    ped.cache.stumpCounter[selected] = lowByte(dismemberSpurtCount)
    count += severOneBone(character, selected, optionalV, optionalOmega)
    if severOneBone succeeded:
        pipe old/new boned slot and bone index
        conditionally add the same source bone actor to universe
    return count
```

`4cd7be` reads signed parent byte `FORM.bones[child]+28`; record stride is34
hex. This is the FORM parent relation, not ACT traversal order or model name.
Children already marked missing are skipped, but the selected bone is not
filtered before recursion. A repeated selected parent can therefore still
visit a previously unsuccessful child. `severOneBone` checks the selected
mask and returns0 if already detached. Stump byte `cache+23+index` is reset
**before** this check, even on a repeat or allocation failure. Its installed
global `692ae4` comes from the third stump-settings integer: stock100 total
parts; preceding records are5 lumps at a time and100ms period.

Consequences required for a port:

- Equality with threshold allows an attempt; D39 makes none, D40 makes one.
  D79 makes one, D80 makes two, D99 makes two. Original 68kg simple mass is
  Float32 .06800000369548798; raw100 normalizes99, raw101 normalizes100.
- Failed percentage, repeated bone, no free boned slot and registration failure
  spend the threshold. Do not retry until success, select only from remaining
  bones, refund budget, or stop when a head is removed.
- The gate uses the **number successfully detached in this call**, not attempts
  or total historical mask bits. A subtree can take count4 to6. The source
  checks the gate on the next loop iteration, after another budget subtraction.
  It does not clamp subtree output to five parts.
- Root index0 is never randomly selected. Uniform integer selection is over
  1..boneCount-1; head index is data, not a special random case.
- Child recursion itself draws no chance or random bone. Each eligible one-bone
  operation may draw spin values as described below.

`PercentageChance(p)` returns false without a CRT call when p=0; otherwise
one shared draw r15 gives `floor(r15*100/32768) < p`. Chance10 succeeds for
r=0..3276, fails at3277. `IRandomBetween(1,n-1)` consumes exactly one shared
draw and returns `1+floor(r15*(n-1)/32768)`. For ten-bone humans, endpoints
r0/r32767 select1/9. `575f80` updates shared unsigned state as
`state = state*214013+2531011 mod 2^32`, then returns `(state>>16)&32767`.
Do not create separate per-ped or per-part generators.

## Successful one-bone operation and failure boundaries

At `40b870`, bit lookup uses the verified 32-entry powers-of-two table
`58e2d8` (1 through80000000), and tests character DWORD `+0c`. This is the
detached/missing bone mask; `+10` is a distinct vanished-part mask. FORM counts
beyond32 require a diagnostic, not a guessed wide mask.

For an ordinary simple character, signed boned slot `character+6` is negative.
`40b88a–40b8b4` scans `form.maxBoned` slot records in ascending order, stride8,
for the first occupied byte0. It returns0 with **no spin draws** if all are
occupied. Otherwise it stores the slot index in character+6 and marks the
slot occupied1. Stock BIPED1 and BIPEDF each have ten boned slots; their other
capacities are30 simple,30 render,30 stored dismembered. A later failure does
not undo this reservation in this helper. An existing nonnegative boned slot
is reused, without allocation draws or a free-slot scan.

Ordinary `4cd922–4cd92e` passes null V and null omega to `40b860`.
After reservation, but **before** object setup/registration, three calls to
`513030` choose angular X,Y,Z in [-1,1). The constant at58a288 is the verified
Float32 `-1/32768`; the symmetric helper returns `-a + 2*a*r15/32768`.
For a=1 the values at r0,16384,32767 are -1,0,.99993896484375. All three are
Float32 spills. A repeated missing bone exits before reservation/spin draws;
an object-registration failure occurs after these three draws. These are
source random spins, not an invented impact-dependent spin.

`4085f0` receives the selected **current rendered bone actor**, that actor's
current model bounds at model+34, and the preallocated body pointer
`form.bonedPhysics[slot].objects[index]`. It copies the actor's native12 matrix
to body+8c, sets body.actor and owner character, clears V/omega/aux vectors,
sets body type5, and calls PHIL registration with the source flags. Its fill
callback sets filters A40000/B50000. The normal simple body initially has
A10000/B50000 and after a processed passive callback A20000/B40000; both are
excluded from these detached bodies by the established pair-mask rule. Other
type5 parts are also excluded. Do not reuse the intact body's contact/halt
callbacks for type5 or ignore these masks.

The bodies and shapes are authored and preallocated from FORM: use each bone's
own kg-to-tonne mass, collision kind and its model after the bone's general
axis remap. The setup helper recomputes shape geometry/inertia from current
model bounds; it is not a new generic box of the simple body's total mass.
For BOX construction, the native .025 inertia factor and source safe COM/radius
rules apply; SPHERE and other geometry branches need their respective source
construction. This audit traces the setup entry, not a new independent audit
of every articulated collision shape's inertia equations.

If setup/PHIL registration returns failure, `40b94b` returns0 before mask
mutation. PHIL's installed normal registration capacity is100 object records;
`4b5ae0` returns1 when full,2 for already registered,0 for successful/new
registration. `4b6050` forces the immediate registration path while inside the
solver; the subsequent activation can use PHIL's deferred mutation queue.
Missing runtime capacity handling must not be silently treated as native
success.

After setup succeeds, `40b953–40b97d` ORs the selected mask, removes the
body's parent joint link (parent+224=0, body+228=0 when present), clears its
children link body+224 and joint/link field body+188. If character physics bit4
is set (ordinary activated/active contact), the helper:

1. Chooses supplied V or, for ordinary null V, character world V at+d8. It
   copies V into the part and propagates to remaining physics children.
2. Clears part ec and copies the three random/supplied angular components to
   part+74/78/7c, propagating to remaining physics children.
3. Calls PHIL activation with null optional vectors and arg0, leaves ed=1,
   sets gravity property0 to double1, and clears properties3/4/5.

This character velocity is whatever its source owner currently stores; it is
not substituted by car V, the contact aggregate, solver lambda or an added
normal impulse. The helper does not subtract severed mass from the retained
simple body's mass or inertia. If character bit4 is clear, setup/mask success
still returns1 but this activation/velocity-copy tail is skipped.

After each successful recursive one-bone call, `4c89a0` records the selected
bone and the old/new signed boned slot. The same actor (not a cloned mesh) is
added to universe at `4cd981` only if it has no actor parent, and either index0
or its selected mask bit is set. Root0 is only relevant to other callers; the
contact loop excludes it. ACT root children may be present in a different
order: associate by personality FORM-bone model, not child position. Full
render-set ownership/freezing and vanished/stored-part recycling remain owner
providers.

## Original humanoid model/body inventory

Read-only FORM and personality/TWT/ACT parsing confirms these two ordinary
personalities. BIPED1 and BIPEDF share the indices/parents/masses below;
BIPED1 joints are FALSE, whereas BIPEDF uses BALLNSOCKET/HINGE. The parent
relation remains relevant with FALSE joints. The actual body outlet is
`form.bonedPhysics[character.bonedSlot].objects[index]`, with the same indexed
render actor from `form.actorSets[character.renderSlot].actors[index]`.

| Index / bit | FORM bone / parent | kg / collision | Blokebl current model | Bandsman current model | Detached order on selection |
| ----------- | ------------------ | -------------- | --------------------- | ---------------------- | --------------------------- |
| 0 / 1       | Bip01 Spine / -1   | 20 / BOX       | MANBBL.ACT            | MANBDC.ACT             | Never chosen by contact     |
| 1 / 2       | Bip01 Head / 0     | 4 / SPHERE     | CHEBL.DAT             | HEDC.DAT               | 1                           |
| 2 / 4       | Bip01 L Leg / 0    | 8 / BOX        | LTOPLBL.DAT           | LTOPLDC.DAT            | 3,2                         |
| 3 / 8       | Bip01 L Leg1 / 2   | 7 / BOX        | LBOTLBL.DAT           | LBOTLDC.DAT            | 3                           |
| 4 / 10      | Bip01 R Leg / 0    | 8 / BOX        | RTOPLBL.DAT           | RTOPLDC.DAT            | 5,4                         |
| 5 / 20      | Bip01 R Leg1 / 4   | 7 / BOX        | RBOTLBL.DAT           | RBOTLDC.DAT            | 5                           |
| 6 / 40      | Bip01 L Arm1 / 0   | 4 / BOX        | LTOPABL.DAT           | LTOPADC.DAT            | 7,6                         |
| 7 / 80      | Bip01 L Arm2 / 6   | 4 / BOX        | LBOTABL.DAT           | LBOTADC.DAT            | 7                           |
| 8 / 100     | Bip01 R Arm1 / 0   | 3 / BOX        | RTOPABL.DAT           | RTOPADC.DAT            | 9,8                         |
| 9 / 200     | Bip01 R Arm2 / 8   | 3 / BOX        | RBOTABL.DAT           | RBOTADC.DAT            | 9                           |

Bits in this table are hexadecimal. A selected upper leg/arm produces two
separate one-bone outlets/bodies, not one combined subtree mesh/body. Ordinary
model poses and parent vectors are remapped per bone; do not apply a universal
Y-major orientation. Blokebl's containing ACT is BLOKEBL.act (with head pose
ACTs BLOKEBLA/BLOKEBLB); Bandsman's is FLIGHTMEC2.act (head pose ACTs
FLIGHTMEC2B/FLIGHTMEC2C). Container ACT filenames are not bone identifiers:
MANBBL.ACT/MANBDC.ACT are the authored spine model identifiers inside them.
Other personalities must supply their own model map; these examples are
metadata evidence, not fixtures or hard-coded gameplay choices.

## HP, head models and caller continuation

At `4cd4fe`, always continue with the original normalized integer D and the
post-sever character mask, including when no percentage succeeded, a repeated
choice returned0, or native allocation failed. The common sever function does
not write HP, stop on head removal, or install an animated head sequence.

For initially living HP, `4cd538–4cd597` performs the existing HP rules:
nonhumanoid with any removed bone sets HP0 and effective D0; a missing FORM
head bit or D>=100 sets HP0; otherwise subtract D using signed-byte behavior;
immortal would restore HP1 but has already suppressed this sever outlet.
Ordinary humanoid FORM head index1 makes mask bit2 fatal even if D is only40.
Limb loss alone does not make a humanoid automatically dead.

The living survivor invokes the provided alive move if nonnegative, noise4,
and returns0. For a new death, the helper invokes its supplied dead move,
noise1, then **KillPedestrian `4ccc20`**, returning1. This is required even if
the severed body has already been dispatched. Already dead HP bypasses new
HP/reaction/kill: D>2 invokes noise5; otherwise just return1. Do not repeat
Kill or award scoring for this corpse-sever branch.

Kill performs the source dead-model branch when gore>0 and applicable volume
gates permit it: all bone actors change to pose0 in model set1, then the FORM
head actor changes to pose2 in model set1 (`4ccca8–4ccd38`). This also changes
the already detached head actor; do not invent a separate severed-head model.
For Blokebl head pose2 is CHEBLB.DAT, for Bandsman HEDCB.DAT; dead model-set1
models are source clones produced by personality loading, not merely the
same alive model pointer. `4ccd44` clears cache head-sequence pointer+1c.
Normal living head animation (sequence65d050 first pose1) belongs to later
completion/halt handling, not contact severing itself. Head sequence is not
an eligibility flag for random removal.

Kill subsequently calls `4ccf10` (ped flag100 makes count/race handling
once-only), then `4cd010` (HP0, action6, death time; attribution/award branches).
Its blood/giblet call occurs before this count/death tail and can consume
additional CRT draws. A severing-only kernel therefore must relinquish the
shared CRT to the actual kill/effect providers in order, rather than reporting
HP0 as the complete kill operation.

The passive caller resumes at `4cdb24` regardless of common return value. It
does its alive/dead impact noise, overrides a dead character's move to94 with
action6, writes the contacted simple body's filters A20000/B40000 (type5
A40000/B40000), emits its existing status/replay record and remaining car
outlets. Its impact serial increment and halt/interpolation resets precede
common damage and must occur only once, not again on provider resumption.
The active caller resumes at `4d21ae`, performs its special player-car branch,
contact/pinning flags at `4d2285`, then blood/scrape outlets. World contact has
no sever call but still runs HP, flags and effects; active raw integer0 exits
before the common helper. The active helper does not add the passive impact
serial increment merely because a bone severed.

`SetPedMove 4cba70` still uses the source move/substitution provider after
severing. Missing lower legs mask8/20 select different FSM columns, and
drunk/dancing/panic modes have priority over those columns. Hard-coding the
requested move without this owner can mis-handle later recovery. The installed
FSM base is65c360; dispatch indexes65c364 for its first replacement column.

## Bounded implementation contract and remaining gaps

An ordinary provider needs normalized D, other-null status, gore/immortal/
brittle/exploding globals, GENERAL threshold/chance, FORM bone count/parents/
head index/masses/collision kinds/remaps, character missing and vanished masks,
render and boned slot state, actual native bone actor poses/current models,
character world V and physics bit4, cache stump counters/flags, shared CRT,
and truthful pool/PHIL registration results. Emit ordered reservation,
per-bone object setup, mask/link mutation, activation, replay and actor effects;
return actual newlyDetached count and post-mask. HP/kill/caller continuation
must use that result exactly once. Selected-but-failed is a resolved native
outcome; missing actor/shape/slot/PHIL implementation is an unresolved provider.

Verified alternate branches, requiring explicit support rather than ordinary
fallback:

- Exploding `4cd81e–4cd8b0` draws three translation components with ranges
  symmetric3,0..3,symmetric3, adds character V, then three symmetric20 spin
  components, all before invoking one-bone allocation. Already missing or
  pool-full selections still consumed those six wrapper draws. A newly
  allocated low-level body receives supplied omega and therefore draws no
  additional ordinary spins. Brittle alone uses the ordinary spin path.
- Existing articulated slots/joints enter the link-removal and recursive
  propagation path. Full joint ownership, intact-to-articulated conversion,
  original model-derived SPHERE/other inertia, and PHIL queue ordering must be
  implemented/checked before claiming that runtime branch.
- Model morphing/head size, mutant speed, special volumes, replay playback,
  invisible/non-renderable characters, stored/vanished-part caches and pool
  reclamation are not solved by the contact selection loop. Null per-bone
  body slots (authored mass0) are not justified as generic bodies.
- Full native Kill/score attribution, giblet/blood factories and stump
  continuation share CRT state beyond this outlet. Their random effects must
  remain explicit providers; omitting draws changes future sever choices.

Validation for this note was static call/branch/data inspection plus read-only
parsing of BIPED1, BIPEDF and two independent humanoid personality/TWT/ACT
sets. A temporary numerical audit passed original subtree orders/head mask,
threshold/chance endpoints, spin endpoints and the CRT seed1 sequence
41,18467,6334. Prettier check passed. No browser behavior, production build or
new runtime fidelity is claimed.
