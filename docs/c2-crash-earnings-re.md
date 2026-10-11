# Crash earnings: verified selection and live integration

Evidence: read-only installed HW, hashes in the physics notes; rec2 is a symbol
map. Installed `DoCrashEarnings` is0x440550. The browser implements base waste awards and the offline pair selector below
in the ordered damage dispatcher. Native row grouping and non-car ownership
are integrated. Remaining primitive/vector precision, AI reaction binding and
secondary reward branches are still RAC-04/AI-01 work;
this does not establish complete crash-earnings conformance.

## Snapshot and contact records

Installed `RecordLastDamage`0x43f8e0 (rec2 annotation0x43f9f0) runs once before
outer-frame physics, at0x41640e in ApplyPhysicsToCars0x416360, before
PHILDoPhysics0x4b63d0. Internal steps are40ms, at most five. Do not reset these
records for each internal contact or fixed step.

| Car offset    | Meaning                                           | Verified writer   |
| ------------- | ------------------------------------------------- | ----------------- |
| 0x6f4         | First car-contact face; reset7                    | 0x43f91b,0x43fca1 |
| 0x13e0        | Unclamped normalized contact Z, for raw faces0..3 | 0x43fcad          |
| 0x133c        | Accumulated squared scaled damage vector          | 0x41e0ff          |
| 0x13a4        | Pre-physics horizontal speed /1000                | 0x43f930          |
| 0x13c0        | Pre-physics local linear velocity XYZ             | 0x43f97a–988      |
| 0x13ec,0x13e4 | Last attacker pointer and time                    | 0x440efc          |
| 0x13f0,0x13e8 | Previous selected attacker pointer and time       | 0x440f10          |

Snapshot also copies prior knackered0x1d8, transform0x1374, direction0x13a8 and
world velocity0x13b4. Record first qualifying car-contact face, even when damage
is zero. World contacts do not assign that face. Nearest-face ties match existing
selectDamageFace: Z before X before Y, positive faces win axis ties.
For bounds min/max, `u=(localPoint-min)/(max-min)`, without clamping.

The callback builds an impulse-weighted mean of local contact offsets and adds
local COM (0x41d254–2f4). Browser inverse-transformed world contacts are already
model-origin coordinates; adding COM again would be wrong. A's DamageSystems
runs0x41d3f1, then B's0x41d421, then pair selection0x41d438. Both records must
exist before selecting a pair.

The live dispatcher uses the installed greedy grouping at0x41cc11–41d24e:
first unconsumed row, matching unordered body pair, maximum four rows. Same
orientation requires a normal dot product strictly greater than F32(.707107);
reversed orientation requires strictly less than its negative. Same-orientation
products add X+Y then Z; reversed products add Z+X then Y, without intermediate
Float32 stores. Each lambda and each running lambda sum is stored as Float32.
Only groups strictly above F32(.02) invoke damage/earnings (0x41d39c–3ab).
Closing speed is not an eligibility gate. Zero-lambda rows still occupy slots;
browser invalidated type9 solves are excluded. The native solver also tags zero
lambda as9, but leaves those primitives in the callback list. This is an explicit
adapter distinction. Native solver primitive generation and weighted-vector
store precision are not yet completely reproduced; the browser retains its
.005 per-axis contact-point deduplication.

The first row retains A/B orientation; reversed rows keep their receiver signs.
Both receivers are damaged before `onImpactPair`, native selection and the next
group. Accepted selection clears accumulators immediately rather than deferring
cleanup to the end of all pairs. Numerical tests cover four-row partitioning,
orthogonal normals, reversed pairs, zero closing speed and the strict threshold.

Damage accumulation is `sum(dot(D,D))` after local scaling and factor0.2 but
before human protection and crush factors. Invulnerable receivers skip it.
Browser scaleImpactVectors.damage is already protected; expose its earlier
vector rather than use closing speed, component increments or raw impulse.

The new `NativeCrashRecord` is bound to the simulation's outer-frame entry
and exit, retaining the snapshot across40ms substeps. The persistent unsigned
speed cache is `F32(sqrt(vx²+vz²)*F32(.001))`, with no square-root rounding
before multiplication (`0x416599–0x4165d1`). If the old cache is strictly below
F32(.0001) and the new stored value strictly above it, the cache is clamped to
F32(.0001) for that frame (`0x4165fe–0x41660e`). Snapshotting copies that prior
completed-frame cache rather than recomputing the current signed driving speed.
Local velocity keeps collision velocity units, without the .001 conversion.

For first raw faces4/5, the field called normalizedContactZ actually receives
F32(contactX−boundsMinX) from scratch storage; the selector ignores it for those
faces. For0..3 it is normalized Z. All first faces write it at `0x43fcad`.
The squared damage magnitude has its own Float32 store before accumulation:
`m=F32((liveDx*F32(liveDx)+liveDy*F32(liveDy))+liveDz*F32(liveDz))`, then
`accumulator=F32(old+m)` (`0x41e0bd–0x41e0ff`). Protection/crush do not enter
that sum; immunity bypasses it. `scaleImpactVectors.accumulatedDamage` now
exposes the earlier vector. The live selector now runs after both receivers, clears accepted-pair
accumulators through getter-backed views, and sets wasting ownership from the
selected victim/attacker rather than any directly touching human car.
Accepted pair cleanup resets accumulators0x441115/123. A separate component
routine0x441310 adds0.5; its semantics still need interpretation.

## Offline pair selection

Processing rejects a previously knackered member. With two cars, at least one
accumulator must exceed approximately0.00005. Raw sectors0..3 remap to front4
when contact Z<0.25, back5 when Z>0.75, otherwise keep the raw sector.

Dominant local velocity chooses X only if strictly larger in absolute value
than Y and Z (negative=left2, positive=right3). Y must strictly dominate X and
Z (negative=bottom1, positive=top0). Otherwise use Z (negative=front4,
positive=back5). Ties therefore fall toward Z.

For drivers>=7, driving eligibility is:

`Z!=0 && ((gear>0) XOR (Z>0)) && (accelBit || joystickAccel>32768)`.

Candidate attacker requires matching impact/velocity sectors,
`preSpeed*5>other.preSpeed` and `preSpeed>0.0005`. Human drivers also require
the driving predicate; AI6 bypasses it. Prefer qualifying A, except qualifying
local human B8 wins a tie. Early attribution stores require a matching sector
and driving predicate, without this speed-ratio test. A's human branch does not
fall through to B when A fails.

If no human pair is accepted, try B.previousAttacker==A and age<750ms, then
A.previousAttacker==B and age<750ms. With null B, A's previous attacker can
supply that fallback. Accepted local-human pairs always refresh last attacker,
but fallback does not refresh the previous-pair timestamp;750ms cannot extend
indefinitely. Rec2's misleading field name is not evidence of victim ownership.

History age is signed Int32(PDGetTotalTime−storedTimestamp), not an unsigned
deadline. The PD clock call is `0x440586`; AI reactions instead use the frame
clock. For null B, the5000ms check precedes pointer presence unconditionally:
an expired last timestamp rejects even a null last pointer. A fresh null/AI
last pointer then undergoes the750ms previous-pointer fallback, which may
replace it with null. Fresh human/network last pointers skip that fallback.
Every fresh ordinary path clears the accumulator; expiration and earlier
knackered/low-damage rejection preserve it.

Null-other last-attacker continuation has a separate strict5000ms window and
can refresh accepted last-attacker time. Ordinary offline AI selections fail
driver8 guard0x440dce and skip stores; preserve prior human attribution. AI
mines and free parts have separate explicit ownership stores and can overwrite.

Final reward requires new wasting, local-human attacker and no prior award;
final-goal completion occurs before ordinary EarnCredits/AddTime. Front/front
speeds>0.001 and direction dot<-0.7 set a separate head-on multiplier0x4411e1,
which does not change pair selection. Damage/rolling award branches remain
additional RAC-04 work.

## Regular opponent crash reactions

Verified installed setter `0x4aec90` receives the selected attacker/victim at
`0x440cc5`, before accumulator cleanup. `applyNativeCrashReaction` reconstructs
the regular driver6/local-human8 branches independently. It is tested but not
yet connected to the live opponent controller; police/network branches are
explicitly unsupported in this adapter.

Severity is integer truncation of `min(100,sqrt(F32(victimAccumulator)*300000))`.
Values below5 leave contact facts unchanged. Otherwise both contact timestamps,
attacker's last-hit pointer and victim's last-hitter/recent-grudge flag update.
Big-bang and severity>=80 scary-bang flags accumulate until their frame owner
clears them. Severity/10, truncated, is the regular grudge increment.

Human-to-AI hits increase the shared opponent-catalog grudge, capped at100 with
a byte store. AI-to-human hits reduce it by twice the increment except while
the attacker is pursuing any target. Matching pursuit targets refresh the
last-attributed-hit timer at opponent offset0x120. AI-to-AI hits perform no
regular grudge write and resolve the attacker before the victim. Catalog state
must be shared by duplicate instances; it is not private per spawned rival.

A victim with a sticky scary-bang flag and catalog strength<5 has acceleration,
brake and curvature cleared in that order. Its stun deadline becomes the
unsigned maximum of the old deadline and `U32(nowFrame+1000+30*severity)`.
The AI frame timestamp differs from the PD clock used for crash history ages.

Installed initialization `0x4adb93–0x4adbf6` derives the big-bang threshold from
the race catalog index/count and skill, not the race's authored navigation speed:
`rank=trunc((101-99*(1-index/count))*(-.1))`,
`threshold=trunc(70-I32(10*skill-3*rank)*F32(nastinessMultiplier))`.
The multiplier global begins at1. Tests cover threshold equality, sticky flags,
shared catalog writes, pursuit target matching and unsigned deadline wrap.

## Live clock and ownership bridge

Installed `PDGetTotalTime` at0x51ca50 reads the raw performance counter
(QPC call0x51ca64); rec2 platform/win32 describes the counter delta and
timeGetTime fallback. It is distinct from pause-adjusted `GetTotalTime`.
The browser bridge uses an injectable UInt32 platform clock backed by
`performance.now()`, without subtracting pause or race epoch. Tests advance
that clock independently from the physics cursor.

World-AI scaling uses signed `I32(nowPD-history.lastMs)>5000`, while null-other
selection rejects at equality5000. The scaling timestamp and last-attacker
history are the same native car field0x13e4. Raw human touching only updates
a separate repair timer0x1548; it must not refresh attribution before damage.
The former unconditional touching-human update has been removed.

Gear and acceleration intent are current fields, not RecordLastDamage
snapshots:0x135c,0x12d0 bit0x40000 and0x12dc. Browser keyboard input explicitly
supplies W/Up intent independently of synthesized throttle/reverse; there is
currently no joystick adapter. Mine ownership writes the same history clock;
mine lifecycle timing remains a separate subsystem.

The native owner pointer0xc8 is independent of attachment/repair ownership.
DamageCar0x41ded0 updates both object slots at0x41deea–41df16 before driver,
distance or immunity gates: replace a slot if null or its body's driver>5.
Thus cars keep the latest counterpart, while a noncar keeps its first owner,
even when that owner is another noncar. Qualifying noncar/noncar groups also
perform these writes before their driver<=5 damage return. Activated world
props are driver4 (0x42001c), initialized with null owner (0x42015b).
Static world geometry supplies null OTHER (0x41d5c3) and updates neither slot.

Free parts/splits are drivers2/3 with their original car owner initialized
(0x42f2e5); driver1 semi-detached parts are excluded from earnings normalization.
After both receiver damage calls,0x44061b–44069a normalizes drivers2/3/4: a
nonnull owner with driver>5, different from the receiving car, sets its last
attacker and raw PD timestamp. This store precedes the selector's knackered
and magnitude rejection. The body then supplies null OTHER to ordinary
selection. A WeakMap implements these slots without changing attachment state,
repair ownership or debris dynamics; mine ownership remains its separate path.
