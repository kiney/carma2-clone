# C2 world texture/decal queue integration

## Evidence

Verified from the installed read-only `carma2_HW.exe`: SHA-256 `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`, PE32 image base `0x400000`, entry point `0x577eb0`, timestamp October 18, 1998. `madebr/rec2` supplies structure/symbol hints; its `SmashEnvironment` annotation is stale for this executable. No reference implementation was copied.

Installed world dispatcher `0x4f0ec0` calls texture/decal preparation `0x4f1660` at `0x4f14fd`. Preparation initializes its impulse cap to `-1` (`0x4f16d9`) and separately requires impulse at least `0.1` (`0x4f1738–0x4f174a`). New runtime tiles copy the authored spec (`0x4f2859–0x4f2860`), optionally copy the level array (`0x4f2875–0x4f28ad`), clone the material (`0x4f28b0–0x4f28e6`), prepare geometry or a decal actor, and link through authored spec `+0x2d8` (`0x4f2a29–0x4f2a35`). These operations precede shared enqueue `0x4f2a98`.

The queue receives runtime texture state at `runtimeSpec+0x14`. Relative offsets are material `+0x44`, level count `+0x48`, reached tier `+0x4c`, and level array `+0x50`. Runtime state identity is the dedup key: sharing the original authored spec across all its tiles would incorrectly combine their tiers. Decal queues its generated overlay actor; texturechange queues the source actor. The actor model gate does not test visibility.

Only an accepted insertion or strictly higher pending upgrade returns a selected level pointer. Capacity twenty is rejected before dedup (`0x4ee03f`); equal/lower duplicates also return null (`0x4ee0b5`). World code accepts a cap only from a nonnull return whose level collision type at `+0x2c0` is passthrough or edges, then copies its threshold at `+0x10` (`0x4f2abb–0x4f2ace`). Rejection leaves cap `-1`. Successful preparation writes the immediate geometry/restart output even when enqueue returned null (`0x4f2ad5–0x4f2adc`). Source edge-flag preparation follows this write; final texture, tier, material collision identifier and connotations execute at flush, as detailed in [the shared queue note](c2-smash-queue-re.md).

World enqueue's model/effect flag is `mode != decal` (`0x4f2a65–0x4f2a6c`). Texturechange suppresses activations, follow-up effects, powerups and awards; decal permits them. Sound, shrapnel, explosions, slicks, variables and completion remain eligible.

## Browser integration

`WorldDestruction.configureSmashQueue` accepts the same `NativeSmashQueue<WamSmashQueueContext>` used by WAM. Preparation immediately creates a stable tier-zero `Patch` and private material/geometry. Queue getters read the patch's live tier and the authored live level count including intact tier; context captures the first contact's point, velocity and matrix values. Pending upgrades change only the target tier. Ignored requests return no cap. Existing remove, replacemodel and nochange branches remain direct.

Queued execution applies the final map and tier before callbacks, then repeats final-tier connotations according to crossed-tier flags. Effects use the flush clock. Replacing a live actor's model while pending does not restore the old prepared geometry. Standalone callers retain synchronous behavior through a local queue flushed before `handleContact` returns.

`onConnotations` receives an optional third `suppressActivationsAndAwards` boolean; downstream effect dispatchers must honor it. The built-in activation outlet suppresses texturechange activations itself. Direct connotations pass false. Physics callers remain responsible for supplying the appropriate velocity units; queueing copies the supplied vector rather than reconstructing native physics state.

## Limits and validation

Browser patch ownership remains per mesh, source triangle pair and UV bounds. Native decal reuse instead searches the authored linked list and compares four generated corner XYZ positions with strict tolerance `0.01` (`0x4f2793–0x4f281c`, double at `0x589fc8`); exact coincident cross-actor decal reuse is unimplemented. Existing face-edge reconstruction, texture transform randomization and effect class support are not expanded by this integration. Final collision modes continue to be written at tier commit. Missing local pixelmaps reject preparation without consuming random draws, an explicit browser loading safeguard.

`tests/world-smash-queue.test.mjs` covers mixed car/world capacity, upgrade and duplicate cap behavior, preparation before random/effect execution, first vector/matrix snapshots, per-record live clocks, final-payload repetition, live count/tier/model gates, model replacement, decal activation eligibility and direct nochange dispatch. Existing `world-destruction.test.mjs` passes, including original-installation geometry/UV tests when installed assets are available.
