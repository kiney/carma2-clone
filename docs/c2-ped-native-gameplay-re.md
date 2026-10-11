# C2 ordinary native pedestrian gameplay owner

## Scope and evidence

`src/ped-native-gameplay.ts` connects the released contact/sever/HP, actual
FORM/PHIL resource host, source move transition and halt/completion kernels.
It owns gameplay state and ordered continuations. It does not produce a second
physical launch, allocate a generic corpse, or derive damage from visual proximity.
Production population wiring remains the owning pedestrian system's task.

Installed HW SHA256 is
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`;
PE metadata appears in [contact evidence](c2-ped-contact-re.md). Small ranges in
`/tmp/c2-hw-current-disassembly.asm`, `/tmp/c2-ped-kill.asm`,
`/tmp/c2-ped-moved.asm` and `/tmp/c2-ped-halted.asm` were checked directly.
rec2 `src/carma2/common/pedestrn.c` supplies names, not implementations for its
stubbed callbacks. No original assets, binary excerpts or reference code are
included in the implementation or fixtures.

## Source ordering

| Installed address                   | Owning phase                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `4b6f50 → 4162d0 → 40b620 → 4cd9b0` | Actual emitted geometry activates a passive simple body, copying character V without an added kick.                                         |
| `4cd9e9–4cda0b`                     | Increment impact WORD, clear cache retry `+19` and interpolation timestamp `+6c`, then `4cdc60` contact attribution before momentum/damage. |
| `4cd3f0–4cd61e`                     | Normalize integer damage, sever first, then signed-byte HP/reaction/noise/Kill.                                                             |
| `4cd599–4cd5c6`                     | Living tail: requested alive move when nonnegative, noise4.                                                                                 |
| `4cd5d7–4cd60d`                     | New death: requested dead move, noise1, then Kill.                                                                                          |
| `4cd50a–4cd535`                     | Already dead: damage>2 invokes noise5; no repeated reaction or Kill.                                                                        |
| `4ccca8–4ccd7f`                     | Gore/volume-permitted dead set1 pose0, head pose2, clear head sequence, then DoGiblets with literal `.4f` and ped.pos.                      |
| `4ccd84–4ccd8f`                     | OneLessPed first, then death/score dispatch.                                                                                                |
| `4ccf10–4ccf29`                     | Ped flag `0x100` is the actual once-only count gate.                                                                                        |
| `4cd010–4cd058`                     | HP0/action6 and current GetTotalTime death timestamp before score eligibility/classification.                                               |
| `4cdb24–4cdbbf`                     | Passive extra noise; dead move94/action6 override before filters/status outlets.                                                            |
| `4d21ae–4d26e5`                     | Active caller continuation after common tail: player-car branch, contact/pinning flags and blood/scrape metadata.                           |
| `4d26f0–4d29ee`                     | Outer moved position/V synchronization, settling, period and special-volume continuation.                                                   |
| `409400 → 4d0df0`                   | Outer halt wrapper derives O using the current BON root and clears character active bit before recovery.                                    |
| `409e2c → 4cbcc0`                   | Actual positive animation completion gate clears its bit before gameplay callback.                                                          |

Passive extra noise uses retained momentum squared, not a later velocity:
dead `q>200f` selects2, otherwise1; alive `q>66f` selects1, otherwise0.
The installed constants at `589a90/589a94` are Float32 200/66. This q is
captured before severing and effect callbacks. The source kernel's incremented
WORD is committed by simulation/runtime before the owner prelude; this owner
never increments it again.

Active caller `4d210c` invokes the same attribution writer before its force/
damage gates, including contacts whose damage later truncates to zero. The
gameplay owner now supplies that distinct active prelude; it does not reset the
passive impact WORD, cache retry count or direction-interpolation time. Replay
skips this writer. Tests check both phases independently and preserve the
attribution store even when a later effect provider is unavailable.

Kill skips model changes/giblets when internal gore is nonpositive or the
actual special-volume gravity is below1 (`4ccc8b`). Count and score still run.
The selected native volume pointer `Object+258` is the browser cache's
`specialVolume.volume`, not the allocated cache itself. The automatic candidate
at `Object+25c` and immersion depth at `Object+254` do not enter this check.
An empty cache or an automatic candidate that has not been selected means NULL;
a selected volume supplies its raw Float32 `+88` gravity multiplier. The default
owner now reads this state directly, fixing dry-body provider failures after the
simulation allocates an empty cache. Explicit providers retain the same contract.
No V/omega is synthesized at Kill. The actual sever body already has its
source launch/spin from the resource host. Corpse contacts do not repeat Kill;
count uses the real flag, not a separate timer or score-owner heuristic.

Moved93/94/97 periods use Float32 raw body speed, one shared CRT draw in
`[.6f,1.4f)`, `trunc(random*25/speed)` clamped20..150, then integer
low-gravity multiplication1.5. Zero speed uses0 without this draw. Simulation
already owns ordinary gain1.39/minimum.1 settling, so this hook does not repeat it.
The later low-gravity omega/buoyancy branch requires its actual provider.
It additionally requires HP strictly positive (`4d28dc..4d28ec`); dead corpses
still receive the period adjustment but do not enter that living continuation.
Regression cases cover empty/automatic/selected caches, depth independence,
ordinary dead-model/giblet/count/score transitions and the living/corpse gate.

## Callable integration

Outer grounding/AI owners can call `gameplay.requestMove(context,request)`
through their actual `beforePose` context. This shares contact/recovery FSM
substitution, authored speed handling and active/inactive transition providers;
it does not advance BON or fabricate a launch. Current character/ACT/body
identity is checked. Missing authored moves or substitution providers are
explicit results. A changed active move retains physical V/omega and clears its
animation timestamp to zero according to `40a26a..27c`; the next animation visit
stamps it before advancing. The grounding bridge uses this seam for falling.

```ts
const gameplay = new NativePedGameplay<PedOwner>({
  settings: parsedContactSettings,
  readGlobals,
  nextCrtInteger: () => sharedNativeRandom.nextInteger(),
  attributeContact,
  onNoise,
  onKillGiblets,
  onOneLessPed,
  onScoreDeath,
  onContactEffects,
  // Optional exact source recovery/volume providers follow below.
});
const runtime = new NativePedRuntime<PedOwner>(simulation, {
  levelOut: sourceLevelOut,
  hooks: {
    ...gameplay.hooks,
    // Retain the actual stored-part/joint/resource hooks where applicable.
  },
});
gameplay.bindRuntime(runtime);
runtime.registerPersonality(name, assets, { deadModels });
runtime.enroll({
  owner,
  personality: name,
  rootPose,
  moveId,
  direction,
  groundNormal,
  timeMs,
  flags,
});
gameplay.enroll(owner, { action, cache });
```

`cache` explicitly retains retry count, interpolation timestamp, source stump
bytes, process flags `+2e`, killer `+c0`, driver and napalm timestamp. Character
HP/flags/missing masks and physical V remain canonical in the runtime/body.
The cache's award fields are independent of the latest contact. The actual
`4cdc60` attribution owner must update them before passive Damage; no UUID or
latest-hitter fallback is performed. Effects return void on completion or an
array of explicit unresolved provider identifiers.

`contactProvider(context, dispatch)` creates a new one-shot sever/common tail
for each actual contact. It uses actual runtime reserve/read/register/commit
methods, stable current bone ACT/MODELs and shared PHIL admission. A selected
bone whose source registration fails is a resolved outcome; missing actor,
model, joint or effect providers is not. Death outlets/model tables are
preflighted before sever RNG and HP mutation. Additional missing/failed move
or effect results remain explicit if discovered after native mutation started;
a partially invoked common tail is not replayed to resume it.

`onContactEffects` receives the actual retained dispatch and completed result
once. It owns remaining native car/status/player-contact/blood/scrape effects;
it must not repeat HP, reaction, Kill, passive noise or add a launch. Native
pinning96/action5 is selected by this owner from the kernel's final pinning
result. The active kernel must retain Kill's changed pedestrian flags before
its continuation; the owner updates the shared packet state accordingly.

`readHaltInput` must supply the actual ordered physics-face normals, current
root ACT basis, current-animation-derived character O, body mass/moments,
remapped bounds, FORM lying axes/head state, volume/gore/global state and clock.
No positive face normal means an explicit provider failure, not an invented
up vector. `onRecoveryEffect` must implement the emitted status, forced ground
recache, direction, head sequence, proximity/object scan, corpse slick and
selected-cache release in order. A pointer-identity reseed cannot be silently
replaced by a browser identifier. `readVolumeGravity` is required when an
actual volume exists; absent volume is explicitly null.

Halt clears the character active bit before selecting some retained-root93/94
reactions. The installed recovery core is now supplied by default through
`createNativePedRecoveryMoveCallback`; `setRecoveryMove` can replace it with
another explicit source owner. It derives the retained root from the physical
body without flipping the character active bit. Inactive boned characters also
keep their actual PHIL ownership during a rejected halt retry. Ordinary
active transitions use `createNativeActivePedMoveCallback`; ordinary passive
moves use runtime selection. Inactive `id=-1` is the verified period-only path:
it retains root, V/omega, move, completion and queued state.

The instance already performs source completion gating/clamping/bit clearing.
The gameplay completion hook applies the existing completion mapping exactly
once:90–92→97;96/97→93 alive or94 dead;80–85→41 running normally,30 under
blind/valium. The completion kernel receives the known dispatched boundary,
not a second timer. Source selected-cache release remains an explicit effect.

`release(owner)` is valid only after the actual FORM/PHIL/render resources have
been released. The module never frees the same body/ACT behind the host.

## Remaining boundaries and validation

Missing-leg mask `0x28`/powerup SetPedMove substitutions require `planMove` (or
the narrower legacy `resolveMove`); the planner applies the locally loaded
original FSM table, fallback, action, cached-run-speed and speed-factor rules.
It must not use identity under those conditions. An
attempt that could sever these legs requires that provider before RNG.
Exploding/nonhumanoid/articulated severing, retained joint2, replay,
nonordinary move completion, full active blood/scrape and low-gravity moved
continuations remain explicit. `onOneLessPed`/`onScoreDeath` own race missions,
shared awards/combo/earned-credit consumers and feedback, using the cache and
source event clock. The existing estimated PedestrianSystem kill/launch method
must not be used unchanged as this native tail.

Focused tests execute actual subtests with `node --import tsx`, including real
FORM/PHIL activation, ordered prelude/common/caller effects, literal `.4f` Kill,
real head sever body registration, no repeated corpse death, zero active input,
provider preflight, raw-speed moved periods, halt and actual one-shot BON
completion. Stock and Advanced Blokebl/Bandsman share real BIPED1 resources,
independent gameplay caches and prepared dead models; original tests skip when
installation data is absent. Numerical fixtures are redistributable synthetic
inputs. Browser population integration and completion of PED-03 are not claimed.

The scan-order regression preserves a later action/move chosen by the actual
object-scan outlet after halt starts running; committing an earlier kernel
snapshot must not erase that selection. Focused gameplay, contact, recovery,
head, volume, shared-slick and Stillify tests are part of `npm test`. The reviewed
integration passed all2,432 tests and the production build on2026-10-11.

### Signed animation browser validation

The live Stock/Advanced native gameplay harness now processes ordinary signed
animation-clock corrections without `native-reverse-replay-provider`. Keyboard
Eagle contact commits persistent HP0, death/count/scoring and dead-model state
in both installations. The separate controlled sever fixture admits an actual
independent head PHIL body; this is not a keyboard-sever claim. No JavaScript,
HTTP/request or WebGL errors were observed. Native moved/halt callbacks retain
the BON clock and derive O from the current authored frame. Ordinary contacted corpses now quiet into PHILstate1, receive passive
V/Stillify/head processing and release their actual render/body allocation when
the controlled native camera origin passes the authored distance gate. Real RAF
and application timestamps continue; no future event time or manually cleared
scope bit forces release. Both Stock and Advanced cases retain no unsupported
outlet diagnostics. This controlled camera input is separate from main chase
camera ownership.

`createNativePedRecoveryEffects` and its pure preflight connect actual shared
`OilRuntime`/registered slick materials, narrow face-cache release and explicit
status recording. The halt kernel owns chance and once-bit order; allocation
owns the next size/growth CRT draws. Stock queued an original GIBSLICK corpse
spill into the existing32-slot pool after the300ms delay. Advanced legitimately
failed the source chance in that run. Tests verify retained MODEL bounds and
stable/reused ACT lifetime, source friction/settings and nonreactivating status
recording. See [slick settings](c2-ped-slick-settings-re.md),
[slick resources](c2-ped-slick-materials-re.md),
[passive Stillify](c2-ped-passive-stillify-re.md) and
[water reset](c2-ped-quiet-volume-re.md).

The normal population still uses `PedestrianSystem`. Its native bounded process
cache, actual grounding collector, living recovery and articulated/gib/replay
effect owners remain separate integration work. No missing effect is accepted
through a blanket no-op; explicitly disabled recording means no replay recorder
is active, rather than a physical-status change.
