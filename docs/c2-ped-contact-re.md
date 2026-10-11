# C2 pedestrian contact kernels

## Evidence and confidence

Installed HW SHA-256 `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
PE32 image base `0x400000`, entry RVA `0x177eb0`, linker 5.10,
timestamp 1998-10-18 20:13:36. Section VA/file offsets:
text `0x401000/0x400`, rdata `0x588000/0x186c00`, data `0x58e000/0x18c800`.
Original executable/assets were read only. rec2 supplies the symbol/structure
map; its callback stubs are not behavioral evidence. The implementation is
independent and contains no original fixtures or reference code.

| Routine                           | Installed VA            | Confidence                                      |
| --------------------------------- | ----------------------- | ----------------------------------------------- |
| ProcessForcesCallback             | `0x41c1d0`              | Installed; rec2 stub                            |
| Active ped dispatcher             | `0x41d901–0x41da16`     | Installed                                       |
| Active ped contact helper         | `0x4d20e0–0x4d26e5`     | Installed; unmapped in rec2                     |
| Common damage/HP helper           | `0x4cd3f0–0x4cd61e`     | Installed; unmapped in rec2                     |
| CBPassiveCollision                | `0x4cd9b0`              | Installed; rec2 annotation `0x4cdc00` is a stub |
| CBActiveHalted                    | `0x4d0de0` → `0x4d0df0` | Installed; rec2 stub                            |
| CBMovedByPhysics                  | `0x4d26f0–0x4d29ee`     | Installed; rec2 stub                            |
| CBMoveCompleted                   | `0x4cbcc0`              | Installed; rec2 stub                            |
| SetCharacterMoveAR                | `0x4d1a20`              | Installed; rec2 stub                            |
| PHILDoPhysics                     | `0x4b63d0`              | Installed + reconstructed rec2                  |
| PHILActivatePassive               | `0x4b6f50`              | Installed; rec2 stub                            |
| ChangedObjectsCallbacks           | `0x4b6980`              | Installed; rec2 stub                            |
| Passive/active bridges            | `0x4162d0`, `0x416290`  | Installed; rec2 APTC stubs                      |
| Character activation/halt bridges | `0x40b620`, `0x409400`  | Installed                                       |
| SetCharacterPhysicsLevel          | `0x409570`              | Installed; rec2 stub/signature differs          |
| MakeCharacterCollideworthy2       | `0x408c30`              | Installed; rec2 stub                            |
| Ped callback table/global         | `0x65c2e8`, `0x67521c`  | Installed table and InitBoner `0x403ed0`        |

## Structures and providers

Character: personality pointer `+0`, simple slot signed byte `+5`, selected
move slot signed byte `+7`, physics flags `+0x14`, matrix `+0x8c`, world
velocity `+0xd8/+0xdc/+0xe0`, ped owner `+0xe4`. Ped: signed-byte HP `+4`,
impact count word `+6`, flags word `+8`, process cache pointer `+0xc`, action
`+0x10`. Personality: form `+0x28`, bounds `+0x34`, mass `+0x4c`, COM `+0x54`.
Rigid: mass `+4`, inertia `+8/+0xc/+0x10`, COM `+0x14`, world V `+0x68`,
transform `+0x8c`, contact-face range `+0x174/+0x176`, rigid type byte `+0x238`,
owner `+0x23c`, special volume `+0x258`.

ReadForm is reconstructed by rec2: every positive bone mass is read in kg and
divided by 1000, accumulated into the simple body's mass. Simple pool slots
have stride8, body pointer `+4`, and use box collision shapes. Personality
bounds and COM are remapped by the root bone's original remap before use.
Installed `0x408ef0–0x408f16` passes personality bounds/COM and rendered root
actor into body initialization `0x4085f0`. Simple box inertia is
`M*(otherSide1²+otherSide2²)*f32(1/12)` (`0x408b27–0x408bdc`), with authored
COM overriding the box center. Root actor and body COM positions must remain
distinct. Rigid type2 is the simple ped; types3/4 are articulated bones.
The maximum simple/render/articulated pool counts come from the form.

Settings parser uses the first twelve non-comment records from
`data/PEDS/settings.txt`: records8/9 sever damage/chance, 10 maximum survivable
initial impact, 11 HP damage per force. Local original values are40,10,8,250.
Installed globals are `0x6928c4`, `0x69a29c`, `0x692b24`, `0x69a2b0`.
Exploding, brittle and immortal globals are `0x742950`, `0x742984`, `0x7429b0`.
The special owned type32 multiplier compares body mass exactly with Float32
global `0x703d14`; its provider remains explicit, without a guessed default.

## Phase and arithmetic

Passive activation happens during collision processing:
PHILActivatePassive `0x4b6f50` → callback `0x4162d0` → character helper
`0x40b620` → table callback `0x4cd9b0`. The character helper copies character
world V into the simple body before the callback. The other rigid remains
EDX through PHIL/APTC and is pushed for the ped callback. This damage is
evaluated on activation, before solving/application changes those velocities.

Active damage is inside ProcessForcesCallback at the existing solved-lambda
barrier, before normal impulse application. The dispatcher requires grouped
total lambda strictly above Float320.0005, a ped owner and rigid type2..4;
it excludes another owned type2..4. It passes the **first selected row's
lambda**, not the sum, plus that row's face pointer and per-ped aggregate
force transformed by the ped rigid basis. Force is not scaled by6.9 here.
Primary and secondary branches are `0x41d991` and `0x41da16` respectively.
Do not run either contact producer from a visual-frame proximity test.

After all40ms iterations and body interpolation, ChangedObjectsCallbacks
`0x4b6980` dispatches halt/moved callbacks once per outer physics update.
The callback table's first four pointers are passive, halted, moved, move
completed; animation completion is called at `0x409e93` when the source move
reaches its final frame and character completion flag is set.

Passive requires ped.flags bit0x40. It increments the word impact count,
resets process-cache halt counter `+0x19` and direction interpolation `+0x6c`.
Let `D = other.M*other.V - personality.M*character.V` (omit other term for
world/null). X keeps its product live; the negative character Y/Z products
spill to Float32 before addition. `q = D.x²+D.y²+D.z²` stays live. An owned
special type32 of matching mass multiplies q by10. Raw damage is
`trunc(f32(q/maxInitialImpact*100))`; exploding peds instead use
`5*severDamage`. The dead helper move is91 for q<10, otherwise92.
The alive helper move is90, action5. Immediately after the helper, a dead
passive ped is switched again to move94/action6. Moves91/92 therefore must
not be used as the surviving passive reaction. Collision filters become
A=0x20000/B=0x40000, except rigid type5 sets both to0x40000.

Active helper exits in replay. It multiplies first-row lambda by10, spilling
to Float32, if ped body V.y<double−1.7 or the owned special type32 matches.
This multiplier occurs once when both tests qualify. Raw damage is
`trunc(lambda*damagePerForce*(other?1:1.5))`; exploding instead uses
`boneCount*severDamage`. Integer zero returns before the common HP tail,
contact flags, blood and other metadata. Negative inputs are not silently
clamped. Alive helper move is−1 (retain current move); dead helper move94.

Common damage rescales the integer input using
`trunc(rawDamage*(double0.068/f32(simpleBody.M))²)` (`0x4cd411–0x4cd427`).
Nonhumanoid exploding/brittle forms get minimum100. This has a meaningful
boundary: raw100 at body M=f32(0.068) becomes99; raw101 becomes100. Original
HP subtraction stores a signed byte, without saturation. Missing head or
damage>=100 sets HP0. Any removed bone on a nonhumanoid form sets HP0 and
effective damage0. Immortal raises a resulting HP<=0 to1. Already dead
peds skip this HP tail and receive no helper move change.

Severing occurs **before** this HP tail (`0x4cd464–0x4cd4fe`), depends on gore
level>=2, nonnull other, immortality, damage budget, chance and bone state,
and consumes CRT draws. Kernel metadata exposes the required outlet; it does
not consume guessed draws or pretend that severing was performed. Supply
post-sever removed-bone/head state to resolve final health authoritatively.

For nonzero raw active damage, effective lambda>=double0.01 sets flags bit4
for another rigid, or bit2 for a world face whose normal.y<double0.707.
Once accumulated flags2+4 are both present and bit8 is clear, native selects
move96/action5 and sets bit8. Float32(0.01) is slightly below the double gate;
Float32(−1.7) is slightly below its double threshold. Tests cover these cases.

## Fall and get-up evidence, not yet implemented here

Move completion maps90/91/92→97/action5; 96/97→93 when alive or94 when dead.
Moves80..85 complete to normal walking unless source powerup state chooses
the alternate move30. CBActiveHalted selects the cached contact normal with
greatest positive Y, or an explicit face override. Upright alive test is
character matrix up.y>double0.93. Otherwise it chooses the largest inertia
axis, negates that actor axis, and compares its dot with the selected contact
normal. `normal.y!=0 && abs(dot)<double0.706` enters the extra settling branch;
the cache permits fewer than3 attempts alive, fewer than2 dead. It invokes
source helper `0x417fd0`, whose full friction behavior is outside this kernel.
The ordinary lying/get-up branch chooses move80 if dot>0,81 otherwise, using
form authored lying axes `+0x4e/+0x4f`, and action4. A fixed two-second fall
timer is not a substitute for these conditions.

Moved callback synchronizes rigid actor pose/V back to the character.
For moves93/94/97 and nonzero body speed, frame period is
`clamp(trunc(FRand(0.6,1.4)*25/speed),20,150)`; a source low-gravity volume
multiplies this integer period by1.5 and truncates. Zero speed passes0.
It calls SetCharacterMoveAR with move−1 and the new period; it does not itself
decide get-up. This source RNG must run at the outer moved-callback phase.

## Implemented bounds and remaining providers

`src/physics/ped-contact.ts` implements settings, passive/active HP arithmetic,
eligibility, collision filters and active contact flags. It returns copied
Float32 force components, not a new gameplay impulse. Inputs are finite and
bounds-checked; invalid int32 conversion throws rather than fabricating a
collision. JS doubles approximate live x87 intermediates; exact x87 extended
precision tie cases remain unverified. Float32 memory stores are explicit.

Essential integration providers still needed: bounded original form simple
box/COM/remap and pool ownership; actual shared collision rows and activation
events; first-row lambda/source face; pre-impulse V; physical pose/contacts;
severing/dismemberment outlet and shared CRT; blood/giblet outlet
`0x4ccda0`; source scoring/noise ownership; halt/friction/recache/get-up state;
articulated bone shapes/joints and transfer from simple physics.
The existing renderer can continue while the simple contact body is added.
Neither this module nor passing kernel tests completes PED-03.
