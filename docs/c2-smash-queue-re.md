# C2 shared smash queue

## Evidence and ownership

Verified from the installed read-only `carma2_HW.exe`, image base `0x400000`, SHA-256 `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`. `madebr/rec2` supplies symbol and structure hints only; this module is independently written and contains no copied reference implementation or original asset data.

Installed `InitSmashQueue` is `0x4ecd10`, `FlushSmashQueue` is `0x4ecd20`; reference annotations `0x4ecfa0` and `0x4ecfb0` are stale for this executable. The pending count is at `0x6a691c`, backing records at `0x6a2d28`, with twenty records of `0x88` bytes. Initialization and completed flush reset only the count.

`src/smash-queue.ts` implements record identity, capacity, first-event retention, live-state gates, insertion order, dynamic appends, final-target clamping and flush clock sampling. The consuming engine owns threshold selection, texture changes, authored tier flags, all effects, model rebuilding and the separate powerup queue. Caller context must copy vectors and other captured values before enqueue; source actor/model and authored spec identity remain references.

## Enqueue

Installed enqueue `0x4ee010` receives car and physics context in ECX/EDX. It rejects already exhausted authored specs (`currentTier >= levelCount-1` at `0x4ee02b–0x4ee030`), then rejects count twenty (`0x4ee036–0x4ee03f`), then actors without models (`0x4ee045–0x4ee04c`). Capacity is checked **before deduplication**, so a full queue also rejects a higher tier for an existing key.

The native routine searches authored tiers backwards above the current tier, selecting the highest threshold satisfied by the supplied magnitude; equality qualifies. It does not accumulate magnitudes. The generic module accepts that already selected target. Below capacity, deduplication compares authored spec pointer identity (`0x4ee0a1`). A strictly higher pending target changes **only** record `+0x38` (`0x4ee0b2–0x4ee0cc`), retaining every first-event context field. An equal or lower candidate is ignored. Enqueue consumes no random values and does not advance the authored current tier.

| Record offset       | Installed meaning                                                 |
| ------------------- | ----------------------------------------------------------------- |
| `+00`, `+04`, `+08` | Car, physics context and actor references                         |
| `+0c`               | Not initialized by enqueue                                        |
| `+10`               | Authored smash spec reference and dedup key                       |
| `+14`               | Captured three-float starting car velocity multiplied by `6.9`    |
| `+20`               | Copied optional vector, or the global zero vector                 |
| `+2c`               | Copied mandatory vector                                           |
| `+38`               | Selected target tier                                              |
| `+3c`, `+44`, `+48` | Caller integer, model/effect flag, auxiliary reference            |
| `+40`               | Captured transform present                                        |
| `+4c`, `+7c`        | Optional captured twelve-float matrix and three-float translation |

Velocity eligibility requires a physics context, its owner at `+0x23c`, and type byte `+0x238 == 1`. Instructions `0x4ee200/0x4ee206/0x4ee20c`, `0x4ee212/0x4ee218/0x4ee21e`, and `0x4ee224/0x4ee22a/0x4ee230` load starting velocity `+0x1b4/+0x1b8/+0x1bc`, multiply by double `6.9` at `0x589f60`, and store F32 XYZ. Failed eligibility zeros the vector at `0x4ee238–0x4ee244`. Physics preparation saves this velocity from `+0x68/+0x6c/+0x70` at `0x4b9831/0x4b983a/0x4b9843`. World activation paths can use different units; conversion belongs to this specific captured velocity branch.

## Flush and effects

The first pass visits insertion order and rereads the count after each record (`0x4ecf5b`), so effects may enqueue further records for the same flush. Already visited records still occupy capacity and participate in dedup. The live actor model is tested first (`0x4ecd4d–0x4ecd52`). Native `GetTotalTime` at `0x514610` is sampled per record at `0x4ecdc8`, followed by the live authored tier/count check. There is no queued timestamp, lifetime or expiry. Group identity is authored spec pointer XOR that sampled time (`0x4ecdf8–0x4ecdfa`). Geometry and actor-to-root transform are resolved at execution, rather than copied geometry being stored in queue records.

Native execution clamps a target beyond the live level count to its final tier. It applies the **final target texture first** through `0x4ed020` at `0x4ece1c`, writing current tier at `0x4ed0be`. It then walks crossed tiers from old+1 to final target. A crossed tier with flags bit zero set is skipped when final-minus-old is greater than one (`0x4ece75–0x4ece85`). Every permitted iteration uses the **final target connotations**, whose pointer is computed once at `0x4ece39`, rather than the crossed tier's connotations. This ordering and repetition are the consumer's responsibility; dispatch includes the old live tier and clamped final target.

Texture alternative selection consumes a native random draw even for one map (`0x4ed075`); authored flip-U, flip-V and rotation draws follow. `DoConnotations` at `0x4ed200` runs sound first, then noncar activations/follow-up effects/optional powerup, shrapnel, awards, explosions, slick, runtime variable changes and mission completion. The caller flag stored at record `+0x44` suppresses activations/follow-up/powerup and awards when nonzero, while sound, shrapnel, explosions, slick and variables still execute. Sound draws pitch before its alternative selection (`0x4ed227`, `0x4ed244`). Skipped crossed-tier iterations consume no connotation random draws.

After effects, native changes the material identifier's first character according to final collision type: `0 => X`, `1 => >`, `2 => ?` (`0x4ecf19–0x4ecf54`). A second pass rebuilds flagged models through `0x515980`. Its later same-model comparison clears the **current** record's flag (`0x4ecfb1`), rather than the later record's flag; consequently this native quirk does not suppress later repeated model rebuilds. The generic module leaves this pass to the engine.

`FlushSmashQueue(0)` also drains the separate powerup queue and clears its count; argument one skips powerups. Both finally clear the smash count (`0x4ed011`). The generic consumer handles successful execution only. Exceptions propagate with pending count retained; recursive flush and initialization during flush throw meaningful errors. These are explicit browser robustness behavior, since the original has no exception recovery contract.

## Call paths and required integration barriers

Car WAM crushing calls `0x4edfd0` at `0x43200f`; that wrapper disables captured-transform mode and forwards to `0x4ee010` at `0x4edfff`. World texture/decal processing calls the same enqueue at `0x4f2a98`. Other world branches call connotations directly: `SmashEnvironment` at `0x4f147d`, and world object mutation at `0x4f4e98`. They must retain direct execution.

Verified barriers are:

- Frame initialization calls `InitSmashQueue` at `0x49290a`.
- Wheel forces flush with argument one at `0x419af2`, immediately after its environment smash call at `0x419add`.
- `ProcessForcesCallback` flushes with argument one at `0x41cb88`, after the world/noncar contact loop and before car-pair crush collection.
- Main-loop `ApplyPhysicsToCars` (`0x416360`) is called at `0x492c0c`; `CrushBendFlapRend` (`0x4360c0`) follows at `0x492d16`.
- Delayed effects (`0x4ec9f0`) run at `0x493752`, ordinary shrapnel update at `0x49375d`, final argument-zero flush at `0x49378b`, and glass-fragment update at `0x493790`.
- Another world trigger path flushes with argument zero at `0x4f6052` immediately after environment smash `0x4f6049`.

One per-impact queue or one deferred queue spanning all outer physics contacts changes capacity and effect ordering. Integration must use these barriers. This module alone does not establish that its caller reaches them correctly.

## Validation

`node --import tsx tests/smash-queue.test.mjs` covers full-capacity duplicate rejection, authored object identity, first context/getter retention, live model/tier changes, per-record clocks, dynamic appends, texture-before-final-payload consumer ordering, initialization, clock boundaries and reentrancy/error recovery. The module does not independently implement or test effect renderer behavior.
