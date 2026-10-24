# Crash earnings: verified selection and live integration

Evidence: read-only installed HW, hashes in the physics notes; rec2 is a symbol
map. Installed `DoCrashEarnings` is0x440550. The browser implements base waste
and damage awards, component redistribution and the offline pair selector below
in the ordered damage dispatcher. Native row grouping and non-car ownership
are integrated. Regular AI crash reactions are connected before redistribution
and accumulator cleanup. Primitive generation and contact-vector precision
remain physics-provider limitations; police/network AI reactions remain separate
AI scope. Verified reward arithmetic does not establish complete physical
crash equivalence.

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
which does not change pair selection. Damage awards are bound as described
below; stunt consumers and the shared earned-credit multiplier are documented
in [pedestrian and stunt award evidence](c2-pedestrian-awards-re.md).

## Wasted-car arithmetic and conversion boundaries

Installed `0x440e99` loads victim softness as Float32. It divides double `.7`
(`0x588c08`) by that field and spills the ratio as double at `0x440ea8`.
The helper `0x512ef0` multiplies that double by itself. `0x440eb6` multiplies
the square by the signed integer GENERAL skill value; the next instructions
subtract double`−50` (`0x588c10`) and multiply by double`.01` (`0x588c18`).
Maintain that association:

```text
q = double(.7) / F32(softness)
units = nativeIntegerLow32(((q*q)*base + 50)*double(.01))
credits = I32(units*100)
```

`__ftol0x575190` selects truncation, converts through signed64 and returns its
low signed DWORD. Invalid signed64 conversions yield low DWORD0. The LEA/shift
sequence `0x440ece–0x440ed4` wraps multiplication by100 as signed32. The
existing shared converter and `Math.imul` now implement this boundary. Ordinary
finite/nonnegative-base and finite/positive-softness browser validation remains;
no extra positivity clamp or rejection is added after Float32 storage. Extreme
positive JS softness that stores as zero/infinity follows the native arithmetic
and conversion result. Fractional/non-int32 GENERAL tables are not native inputs.

The original startup selects PC53/CW027f; see the full startup chain in
[award precision evidence](c2-pedestrian-awards-re.md). A private bounded 32-bit
probe mapped the read-only original PE into anonymous memory, called its actual
FP initializer, then executed `0x440e99` through `0x440ed4`, returning before
EarnCredits. All 91 captures matched the corrected consumer: 18 installed
softness values across all three skill bases; five synthetic storage-boundary
values across all skills; seven small/extreme stored values across all skills;
and INT_MAX base. No original file was modified. Committed tests keep only
scalar inputs and numeric outcomes; the original image remains private.
The independent optional probe and driver are redistributable tooling, with
generated reports confined to ignored `artifacts/`; see the reproduction command
in [race rules](c2-race-rules-re.md).

The installed header audit found 122 drivable records (52 Stock, 70 Advanced;
README, dashboard and auxiliary TXT files excluded). All three skill payouts
remain unchanged for these cars, and ordinary/3× earnings use the same shared
outlet. Synthetic softness `1.8073922282301278`, base 1000 exposed the old
200-versus-native100 defect. The original-data tests skip when the installation
is absent.

## Component redistribution and damage awards

Installed0x440ce5–440d68 runs after the crash-reaction callback, before the
local-human award guard. For each increasing victim component:
`current=min(99,trunc(last+2*(current-last)))`; sum resulting `current-last`.
For each increasing attacker component:
`current=max(0,trunc(last+.1*(current-last)))`. Decreases and equalities are
untouched. This changes functional damage, not just credits. Original
`RecordLastDamage` copies all twelve current levels into their baselines every
outer frame (0x43f8ef–f8); unpaid damage does not carry between outer frames.
Full repair zeroes both arrays. Native reaction observes the raw components
and accumulator before redistribution.

Initial component programs call CheckDamage0x43f620 before physical crush.
Wasting is persistent even if attacker attenuation then lowers its levels.
The additional post-redistribution check0x440df1 is past the human guard:
ordinary AI selections redistribute but do not immediately check wasting.
The live adapter preserves this distinction until a later native damage-check
boundary, including eligible filtered mine increments whose small finishing
increment is discarded. Wasting/completion dispatch precedes ordinary awards.

Damage award equations at0x440fd2–4410e4 use the original GENERAL tables:
`damage=trunc(componentDelta*(double(.7)/F32(softness)))`;
`rawCredits=100*trunc((F32(creditsRate)*F32(damage)*min(multiplier,8)+F32(50))*F32(.01))`;
`seconds=min(5*trunc((F32(secondsRate)*F32(damage)+2.5)*.2),90)`.
Damage credit `.01` is Float32 at `0x588c28`, unlike the waste branch's double
`.01`. The double time constants are `−2.5` at `0x588c30` and `.2` at
`0x588c38`. Tests preserve this distinction for all three original skill rates
and multipliers 1/2/4/8. For Easy delta 10, multiplier 1, the credit subtotal 200
times Float32`.01` is below 2 and awards 100, not 200. Live intermediates follow
PC53 arithmetic; the damage helper's existing malformed/out-of-range input
rejections remain browser policy, rather than emulating arbitrary corrupted
component records.
Credits are capped at2000 before EarnCredits. A knackered victim gets no
additional damage award. A nonknackered zero-credit path skips both time and
baseline advancement; otherwise the victim baseline advances within the frame.
Immunity bypasses the damage-award branch.

The pair multiplier starts1. Original normalized A/B front sectors, both
pre-speeds strictly above F32(.001), and their stored direction dot strictly
below F32(-.7) set2 (0x4411d1–441224). Victim **body-local** omega exceeding
4/6/4 on X/Y/Z doubles it again (0x440f19–4d), without changing awarded time.
Direction is a persistent Float32 cache: above the clamped speed epsilon,
normalize full world velocity with a live length/reciprocal; otherwise retain
the previous hemisphere along current actor K. The viewed-car override uses
the starting velocity of the last40ms substep, copied by APTCPreCollision
0x4158b0, and live interpolation at0x4167c1–4168d8. The browser binds both
cache paths and snapshots direction before the next outer frame.

The loaded rolling-credit/time tables have no direct references beyond their
load sites in the checked installed executable; do not invent a standalone
rolling reward from those tables. Cunning-stunt consumers remain separate.
Global earned-credit multiplication belongs to Drink Driving action48:
SetPissed0x4df040 stores integer parameter0, ResetPissed0x4df120 stores0.
EarnCredits2 at0x44b960 applies signed wrapping IMUL when nonzero; zero means
identity. Completion and remaining-time payouts add directly, bypassing this
global. Action48's control reversal/intoxication and live earned-credit outlet
are integrated; their evidence and finite signed arithmetic tests are in
[pedestrian awards](c2-pedestrian-awards-re.md).

Tests cover numerical component baselines, attenuation, persistent wasting,
local omega on a rolled car, thresholds, caps and callback order. Production
Chromium's W-driven original green Eagle/Diablo head-on and oblique cases
produce localized crush, component changes, normal damage credits/time and
reverse escape with no fatal console/network/WebGL errors. Chrome DevTools
MCP is unavailable in this session; the repository's actual Chromium harness
provides the runtime evidence, not a claim that MCP was exercised.

## Regular opponent crash reactions

Verified installed setter `0x4aec90` receives the selected attacker/victim at
`0x440cc5`, before accumulator cleanup. `applyNativeCrashReaction` reconstructs
the regular driver6/local-human8 branches independently. The simulation's
`onCrashAttribution` outlet calls the live opponent fleet before component
redistribution and accepted-pair cleanup; police/network branches are explicitly
unsupported in this adapter.

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
