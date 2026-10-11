# C2 WAM smash connotations

## Evidence and scope

The original installed `carma2_HW.exe` is authoritative. `madebr/rec2` is used as a symbol and structure map; no reference implementation was copied. The parser and regression fixtures are independently authored. Original WAM files are read externally through the existing asset store and are never committed.

Reconstructed by rec2: `common/crush.c:446`, `LoadSmashableLevels`, reads sounds, shrapnel, explosions, slicks, delayed activation boxes, follow-up smash side effects, extension/room fields, awards and variable changes before the pixelmap list. `LoadCarCrushSmashDataEntries` at source line 517 calls that reader with `pIs_texture_change=0`. WAM therefore shares the world connotation grammar, but does not carry the world texture-change collision-type line. `readSmashConnotations` in `src/world-smash.ts` now accepts a bounded structural reader and is reused by `parseWam`; each `WamSmashLevel` retains the complete `SmashConnotations` value.

Verified from bounded installed HW disassembly:

| Address                            | Behavior                                                                                                                                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0x431d70`, call at `0x43200f`     | Crush texture damage submits a smashable through `0x4edfd0` to `0x4ee010`, before the detachment path at `0x432055`. Effects belong to texture damage tier advancement, not exclusively to physical part detachment. |
| `0x4ee010`                         | Selects the highest reached threshold, deduplicates the authored smashable and retains its highest queued target. Native shared queue capacity is 20.                                                                |
| `0x4ecd20`, `0x4ed020`             | Deferred flush applies the final target texture.                                                                                                                                                                     |
| `0x4ece71–0x4ecf13`                | Iterates crossed tiers. A crossed tier with `flags & 1` is skipped when `target - old != 1`. Each permitted iteration invokes `DoConnotations` with the **final target tier's payload**.                             |
| `0x4ed200`, `0x4ed243–0x4ed253`    | `DoConnotations` chooses **one** sound randomly from the authored alternatives and submits positional playback through `0x456520`. Multiple alternatives do not mean simultaneous playback.                          |
| `0x4ed27b`, `0x4ed299`             | Dispatches delayed activation (`0x4ed5d0`) and follow-up smash (`0x4ed950`).                                                                                                                                         |
| `0x4ed376`, `0x4ed509`, `0x4ed54d` | Dispatches shrapnel (`0x4eb660`), visibility-gated explosion (`0x4eaa70`, visibility `0x4e5aa0`) and spill (`0x4a6a20`).                                                                                             |
| `0x4ed575`, `0x4ed5c3`             | Applies variable changes (`0x4e71d0`, special 9999 through `0x4e71f0`) before the mission-goal completion path.                                                                                                      |

Locality/ownership conditions for room and follow-up side effects are not fully reconstructed. Dispatch addresses establish native outlets, not complete parity of their runtime implementations.

## Implemented event boundary

`DamageSystem.onWamSmash` receives one `WamSmashEvent` per permitted repetition. Its `connotations` is always the final target payload. `oldLevel` and `targetLevel` are reached-tier counts; `repetition` is zero based and `repetitions` is the total permitted count. The event includes the authored `smash`, its `part`, bound `actor`, car-root `bodyActor`, affected `mesh`, `timeMs`, and independent `localPoint`/`localDirection` vectors in car-root model coordinates.

The reached-tier state is keyed by the authored `WamSmash`, independently of pixelmap availability and material/LOD identity. Shared LOD meshes emit one repetition set. Repeated impacts at an already reached tier emit no additional events. Missing textures do not suppress effects. Full repair clears reached-tier state; principal part repair clears the repaired part's entries. Repair itself does not execute connotations.

The simulation gathers the highest target for each authored smashable in the shared twenty-entry WAM/world queue. Capacity is tested before deduplication; an overflowing repeat cannot upgrade an existing entry. The first impact context is retained and the live reached tier is read at flush. Linked textures reach the final tier before its permitted effect repetitions. Overflow entries remain eligible for a later impact. Explicit standalone damage tools use a local queue and immediate flush.

`VehicleSimulation` initializes the shared queue per outer frame, flushes it at wheel/environment and world/noncar barriers before early collision exits, and retains WAM requests from deferred crush until the final game-clock barrier. Main dispatch runs this after ordinary effects and before glass-fragment update. The separate fifty-entry powerup queue and exact structural-bend/flap/detachment phase ordering remain open. Runtime effect handlers are separate integration work: retaining metadata and emitting a typed event does not by itself implement all shrapnel/ghost/noncar geometry, slick material binding, room effects, follow-up smashes or awards. See [queue evidence](c2-smash-queue-re.md) and [deferred crush](c2-crush-queue-re.md).

## External stock inventory

All 52 WAMs in the observed original installation parse successfully. Their connotations contain sounds and shard shrapnel; no ghost parts, noncar/abstract shrapnel, explosions, slicks, activation boxes, follow-up side effects, room effects, awards or variable changes occur in this observed stock inventory. This is an asset observation, not a restriction on supported grammar.

| Car    | Damage levels | Sound entries | Shard entries |
| ------ | ------------: | ------------: | ------------: |
| Eagle3 |            10 |            10 |             7 |
| Copcar |            16 |            16 |            10 |
| VLAD3  |             3 |             3 |             3 |

## Deterministic validation

`tests/wam-effects.test.mjs` uses redistributable synthetic WAM/world data to check the complete shared grammar, record alignment, bounded counts, truncation and integer activation delays. Runtime cases cover below-threshold impacts, final-target repetition, crossed-tier flag suppression, missing textures, repeated-impact idempotence, repair rearming, shared LOD deduplication and queue capacity/overflow. The optional external inventory case reads all available WAMs and checks the three stock metadata counts when those cars are present; it skips when the installation or WAM inventory is absent.

Run `node --import tsx tests/wam-effects.test.mjs`. The observed installation passes 8 tests, including 52 external WAMs. No original asset fixtures are stored in the repository.

## Integrated browser outlets

The live WAM event binding selects one authored sound, queues activation boxes, applies variable changes and dispatches explosions through the existing world outlets. `DoConnotations` draws integer pitch `0xe000..0x12000` at `0x4ed227` before the alternative draw at `0x4ed244`; playback now uses that fixed-point rate, including both draws for a single sound. Source positional attenuation remains open. Shards use the current physical root and ACT/model-local hierarchy; stale interpolated render transforms do not determine their world placement. Material lookup is scoped to each original car, with independently owned identity UV state and shared texture images. Starting-step model velocity is captured before40ms forces/contacts and converted to Float32 metric units by the verified enqueue formula. The WAM source-link limits are 50 vertices/50 faces, independently of the later 200-fragment pool.

`tests/browser-wam-effects.mjs` tests original Eagle3/Copcar/VLAD3 tier advancement, no same-tier replay and repair rearming. A driven Eagle crash observes actual WAM sounds and shards. Separate explicitly scripted paused fixtures check visible triangle geometry, current-physics placement despite a stale root transform, movement and expiry. The native queue and unsupported connotation classes above remain open; these outlets do not imply full connotation parity.
