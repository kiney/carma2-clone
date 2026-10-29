# PHY-21: retryable scenery activation capacity

## Live evidence

In the paused Newcity1 playtest at game time 251791 ms, the stop sign originally
named `&20s0078.ACT` had become `&x0s0078`. Its parsed type-20 mechanics specify
0.065358 tonnes, no world joint and no snap threshold. It had no PHIL header or
physical slot, and remained static immediately ahead of Eagle. Of 606 retained
props, 549 had the same failed-pull marker, although no NONCAR physical slots
were currently occupied. This proves persistent failed admission, not authored
immovability. It does **not** identify the historical first failing query.

A separate fresh original-data browser approach admitted this exact sign and
moved it over five actor units. Therefore neither its mechanics nor its normal
load binding is unconditionally broken. An oversized speculative query remains
a possible amplifier, not an established cause of the earlier live episode.

## Source behavior and explicit browser adaptation

The installed `DoPullActorFromWorld` writes identifier byte 1 to `x` on physical
slot exhaustion or missing mechanics. Later automatic collection skips that
actor even after slots become free. See the verified addresses and equations in
[native wake/pull evidence](c2-noncar-wake-pull-re.md). PHIL header exhaustion was
already a separate retryable browser adaptation.

The browser now also treats physical slot exhaustion as backpressure: return no
physical owner, retain the numeric actor identity, and continue emitting static
MODEL faces. No body is falsely registered, no extra slot is allocated, and no
collision coefficient changes. The existing dedicated-per-type plus 40 global
extra pool and 100-header PHIL table remain bounded.

Successful normal reclaim releases slots and invalidates all retained face
caches. The next ordinary local collection can therefore promote a waiting ACT,
even when its querying body has not moved. A cache hit while capacity is still
full does not repeat allocations. Recollections perform the existing bounded
40-entry scan and do not request a response restart on failure.

This is deliberately different from native permanent failure on exhaustion.
Missing mechanics still writes the source `x` marker; this change neither
fabricates a collision shape nor retries unresolved definitions. Historical
capacity and missing-mechanics attempt counts are exposed separately through
`simulation.nonCarAdmissionFailures` and `nonCarCensus()` for future diagnosis;
there is no unbounded event log or per-frame catalog scan.

## Validation

Headless regressions cover full physical capacity with static collision
coverage, successful retry after release, actual once-per-second reclaim
invalidating a waiting face cache, no repeated allocation on cache hits,
unchanged missing-mechanics permanent failure, and PHIL rollback/quiet/repull.

`npm run test:noncar-capacity` uses original Stock and Advanced Newcity1 and the
exact reported sign. A controlled quiet admission setup fills its dedicated
slot and all 40 extras. Its failed activation must retain both Three and native
numeric identities and static faces. Controlled production reclaim effects
release capacity; real W-key driving then performs ordinary contact-driven
admission and displaces the sign. The test does not pre-admit the target after
release. Software-rendered correctness results are distinct from hardware
performance measurements. Generated reports and screenshots remain ignored.

Existing live scenes execute their previously loaded JavaScript. A one-time
compatibility adapter may restore a failed actor only after validating its
retained mechanics and original numeric identifier, and keep capacity failures
retryable. Such repair changes no pose, velocity or damage. New races naturally
load fresh actors and use the permanent source fix. This does not claim recovery
of the exact historical reason for every old marker.
