# Native active pedestrian move transitions

The implementation in `src/physics/ped-active-move.ts` independently ports the
ordinary, non-morph active-body path. It does not toggle active state to reuse
the passive direction/move selector. Original resources and the executable
remain read-only; no reference implementation code is copied.

## Evidence

Installed `carma2_HW.exe` SHA256:
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
PE32 image base `0x400000`, entry `0x577eb0`. The rec2 map is
`/tmp/carma-rec2/src/carma2/common/pedestrn.c`; its SetCharacterMoveAR address
is shifted and its body is a stub. Installed code resolves the differences.

| Installed address   | Role                                                               |
| ------------------- | ------------------------------------------------------------------ |
| `0x4d1a20–0x4d1b29` | SetCharacterMoveAR replay guard, call, replay recording            |
| `0x40a050–0x40a724` | Actual SetCharacterMove lookup, period, reset, pose                |
| `0x40a730`          | Direction setter; active/non-replay early return at `0x40a74b–75a` |
| `0x40a638–0x40a6bc` | Retained-root orientation and mode3 pose                           |
| `0x5324f0`          | BRender LP inverse used by retained-root mode                      |
| `0x531c60`          | Native row-basis matrix product                                    |
| `0x407b20`          | Bone posing and transient halted-bit clear                         |
| `0x40c620/0x40c630` | Enable/disable retained-root global `0x675ad4`                     |

Ten numerical calls to the installed SetCharacterMove were captured in an
isolated 32-bit PE mapper. The mapper reads the executable and only mutates its
in-memory copy. Probes cover retained-root on/off and period-only, same, forced,
new and missing IDs. Outputs match the committed numerical assertions.
Twenty additional installed calls use actual prepared BON frame0 roots from
Stock and Advanced Blokebl/Bandsman90/94/96/97 and twolf30/40. All 500 output
components (root12, orientation12, return1 per probe) match exactly. The
temporary harness/results remain under `/tmp`, not in the source bundle.

## Ordered transition

1. AR skips the entire operation when replay global `0x6751b4` is nonzero and
   mutation global `0x7429a4` is zero. It otherwise calls the core and records
   either a period-only event (`id=-1`) or a complete move event. AR does not
   itself advance the animation or replace its timestamp with the event time.
2. A nonnegative ID is searched in FORM order after removing bit`0x40000000`.
   Missing ID returns2 before period/callback changes. Ordinary primary
   selection writes character+7, clears queued index+8 to−1, and sets/clears
   callback byte+9 bit`0x2` from the completion argument. This happens even
   when selecting the same move. ID−1 does not change these fields.
3. Nonnegative pSpeed is the absolute period. Negative pSpeed computes
   `-NEW_SELECTED_MOVE.frametime * pSpeed`, truncates toward zero, then stores
   the low signed16 bits at character+1e. Installed `0x40a17e–19f` reads the
   already selected index. The reconstructed rec2 original-move lookup is
   incorrect; a33ms→77ms transition at speed−2 produces154ms, not66ms.
4. Same ID without restart bit, ID−1, or the separately queued branch returns1
   without posing. Frame, fraction and last timestamp remain unchanged.
   A changed or forced primary move resets frame+1c, fraction+18 and timestamp
   +24 to **zero** at `0x40a26a–27c`, clears queued+8, and cancels old morph
   ownership. The next animation visit stamps timestamp0 without advancing.
5. Retained-root mode computes `O = LPInverse(newMove.frames[0].root) * ACTroot`
   and clears O.translation. LP inverse uses the basis transpose; it is not
   inverse character+8c, inverse the old move, a direction/yaw-only matrix,
   or an arbitrary numerical inverse of a sheared ACT. Matrix stores are F32.
   The current complete physical ACT basis and origin remain unchanged.
   Then it poses mode3 with translation disabled.
6. Ordinary mode keeps the current O and poses mode0. `0x407caf–cbe` prevents
   root reconstruction whenever character+14 bit`0x4` is set. Eligible intact
   children can still be posed through the new move's angle bytes and O.
   There is one source exception: a newly selected grounded personality move
   calls FindYVerticallyBelow2 before this guard and writes rootY to groundY
   plus that move's clearance. The helper requires both the exact ground
   provider and explicit ACT-root writer; it does not silently snap physics.

The retained movement basis character+5c and heading/up anchors+ c0/+cc are
not replaced by SetMove. Active SetCharacterDirection is a no-op outside
replay. Physical V, omega, COM, shape, quiet state and PHIL membership are not
changed by this ordinary transition.

## Caller-owned retained-root and halted chronology

Retained-root mode is **not** implicitly enabled by the AR wrapper.
Active completion enables it at `0x4cbce6–cf2`, before selecting the next move,
and disables it at `0x4cbfaf`. Damage/contact transition branches bracket their
move/model changes with `0x4d1058/0x4d1162` and `0x4d1294/0x4d13ac`.
The host must pass `options.retainRoot:true` in these actual source call scopes.

Character callback byte+9 bit`0x1` is the transient halted marker, distinct
from completion bit`0x2` and all physical header/Object flags. Bone posing
clears bit`0x1` at `0x407b51–61`. Same/period-only selections never invoke that
clear. Fully boned active characters without temporary matrices return at
`0x407b38–4b` before the clear or any ACT writes. `callbackState` explicitly
retains this byte and queued index across calls; no unconditional frame reset
or substitute PHIL flag is used. See [halt](c2-ped-halt-re.md) and
[root/bone poses](c2-ped-root-pose-re.md).

## Integration contract and limits

`setNativeActivePedMove` accepts the actual instance, current native12 physical
ACT root, ID, uint32 event time, options, optional raw pSpeed and callback byte.
Its result distinguishes native0/1/2 from missing providers and replay skip.
`createNativeActivePedMoveCallback` directly implements
`NativePedRuntimeHooks.activeSetMove`, derives root from the current body,
requires actual PHIL header state2, and preserves all body physics fields.

The runtime owner must preserve heading/up anchors after an active ignored
direction request, attach completion callbacks before the frame can complete,
and own grounding writes. Replay mutation/direction/basis assertion, morphing,
reverse playback, queued secondary moves and mutant-angle RNG remain explicit
provider requirements, not approximate branches. The helper does not claim
to implement the damage reaction FSM or gameplay completion selection.

Original DOG1 does not author90/96/97. Its91/94 motions spell FORM bone
`Bone_N02` as `Bone_NO2`;93 additionally spells root`Bone_01` as `Bone01`.
Installed matching remains exact and has no aliases. BrMemAllocate`0x526c00`
zero-fills frames and angle arrays through BrMemSet at`0x526c1a–23`;
unmatched records retain zero storage. The generic helpers keep strict defaults,
while native instance and active callback preparation explicitly opt into
`missingRoot:"native-zero"` and `missingBones:"native-zero"`. The original
motion names/matrices stay immutable. Move93 retains a zero animation root;
active retained-root mode computes zero O and degenerates child animation
bases, while the physical root/V/omega remain unchanged. Substituting the
exporter's first bone, an identity matrix, or an O/0 alias would diverge.

Validation:9 active-move tests plus3 dog regression tests, covering original
Stock/Advanced dog91/93/94 and humans90/94/96/97, strict generic validation,
borrowed-data immutability and unchanged body root/V/omega. The follow-up native
zero-record fix changes the four released pose-preparation/transition modules;
no test runner, original file or production build is modified by this task.
