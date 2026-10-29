# PED-09: native physical state, awards and blood consumers

## Normal contact and award ownership

Original population PHIL contacts retain the existing source attribution,
sever/HP and OneLess owners. Normal Kill commits population/objective counts
before scoring; it does not repeat body launch or death. The score event now
includes actual current world V and preparation `Object+1b4` starting V.
Killer geometry comes from the actual cached killer, current raw driver and
physical origin/COM/orientation. `Object+1a8` comes from the retained native
preparation/solver cache, rather than rotating a later world velocity again.
Missing fields remain absent and are reported through normal diagnostics.
The existing reward classifier, combo, credit/time and HUD consumers are reused.

Ordinary Kill's height0 is a verified literal at `4ccd8f`, not a missing floor
calculation. Other callers provide their distinct source height explicitly.
`ScoreForKilledPedestrian4cd026..4cd055` itself stores HP0, action6 and death
time before checking cache/killer eligibility. The scope-score adapter preserves
those stores without invoking FullKill's MODEL/giblet/count effects.

## Native effects in their owning phases

- FullKill dispatches the original force.4/start-size1 packet.
- Applied active contacts dispatch their own packet, including corpse contacts:
  force is Float32 `effectiveLambda*(double(.068)/Float32(simpleMass))²`,
  point is the actual contact, and optional other-object V comes from that
  physical object. Passive contact has no extra direct blood packet.
- Post-pose runs existing head animation first, then source MakeEmBleed.
  Stump counters, signed/unsigned timing, actual removed/vanished masks,
  current bone matrices/remapped attachments and real detached velocities
  produce ordered spurts. The mutant timestamp is shared, not per pedestrian.
- World corpse contacts accumulate the original process-cache smear batch.
  Late `finishEffects()` runs after physics, shared shards and skid updates.
  It consumes each processed owner once per actual outer visit, including
  equal millisecond timestamps, using the same100-section pool as tyre marks.
  Actual registered PEDSMEAR MAT/PIX16 is distinct from corpse GIBSMEAR/oil.
- Existing dead-model/head changes, source noises and accepted-halt corpse
  slicks retain their actual MODEL, audio and shared OilRuntime owners.

Native impact/spurt fragments share the existing200 slots with WAM/ghost
fragments, with priorities2/1, native CRT seed/restore, source placement,
movement, MODEL scaling and lifetimes. Original settings and selected
Stock/Advanced assets drive these paths. See [packet/cache equations](ped09-blood-phases-re.md),
[fragment consumers](ped09-giblet-source-re.md) and [floor picker](ped09-native-floor-re.md).

Pointer-based packet seeds use the actual existing Wasm pedestrian record
address and a bounded Wasm physical-object record address. The latter mirrors
known source V/local-V/mass/type fields under a documented browser allocator
policy. Neither is a hash/actor ID or a claim of Windows heap address parity.
No original executable or derived proprietary cache enters the bundle.

## Off-scope source callers

Installed `4d5369..4d54c5` distinguishes resource scope from ordinary Kill:

1. An active, nonvanished character sets80, releases actual PHIL/ACT ownership,
   invokes OneLess, then scores if living using Float32
   `pedY-FindYVerticallyBelow(ped.pos)`.
2. Positive inactive burning state scores a living target first, stops its
   actual smoke owner, clears the burning field, then vanishes/counts unless
   already vanished. It has no immortal, expiry or selected-volume gate.
3. Negative pending napalm state only cleans its actual resource. Unknown
   resource ownership is rejected before flags, release, cache consumption or
   effects. A failed cleanup never silently clears the source field.

Actual native napalm reservations now populate signed cache `+98` with
`-(slot+1)`. Release validates the live bolt/target and clears only its matching
negative reservation, preserving a positive ignition deadline. Cleanup follows
the actual owner rather than reproducing the original zero-before-reread slot
selection bug; see [installed evidence and ownership deviation](c2-combat-ped-runtime-re.md).

The source score stores HP0, preventing a second score when the fall and
positive-burning continuations meet. The inactive-burning score-before-count
order is an original exception to normal Kill's count-before-score sequence.
Scope callbacks retain actual cache/motion inputs across release, and deferred
release commits only after actual headers/ACT/slots are free. Race teardown
and failed initial admission never run gameplay release callbacks.

The actual native ACT/MODEL floor picker replaces the older convenience height
query for this caller. It preserves three-by-three column order, affine
transforms, prepared faces/material filters, source local-MODEL-Y behavior and
the original negative Float32-MAX no-hit sentinel. Missing metadata is explicit.

This corrects the former resource-only browser fixture's assumption that every
active corpse reappears. Normal Munge permanently vanishes an active off-scope
owner. An intact passive owner can still release/reacquire resources; removed
part matrices obey their separate bounded FORM/vanished rules from PED-08.

## Explicit boundaries

Full articulated/nonhumanoid/exploding body providers remain PED-11. Tail/drone
attribution requires its actual owners; it never defaults to the player.
Replay/status/model recording is explicitly disabled under RAC-09. Source
undefined zero-vector placement or missing binary/model resources remain named
diagnostics, not fabricated directions, drivers, floor normals or assets.
Float32 spills and source branch order are retained; pathological affine/x87
edge cases are not presented as exhaustive bit identity.

Derived native MODELs, materials, textures, fragments and marks have explicit
owners. Reset/disposal clears only owned blood fragments before freeing their
derived resources, preserves shared WAM state and removes all race references.
PHIL removal also releases the physical-object mirror record, zeroes its slot
and permits bounded reuse without relocating live records. Derived fragment
bounds are recomputed after source MODEL scaling.

## Production validation

The bounded Chromium awards/effects fixture checks actual Stock and Advanced
car contacts, raw driver8, retained current/starting/solver motion, native
Wasm record fields, count-before-score, one payment and no repeated corpse
payment. Both original resource trees emit impact/spurt fragments through
the shared pool without JavaScript, request, provider or WebGL errors.

A separate fresh Stock owner falls through genuine grounding into PHIL2,
move72/action3, then leaves scope before landing. Its actual ACT/PHIL release
precedes one count and one environment score. In one recorded visit, the returned floor was
`-1.4568079710006714`, yielding Float32 height `1.1474132537841797`.
No killer is invented, credits remain unchanged and no FullKill/giblet effect
is emitted. A repeated visit adds no event. The stock/Advanced ordinary
contact/resource-scope regression also passes.

DevTools MCP was unavailable in the final session; the reproducible Chromium
harness supplied page/console/request/WebGL inspection instead. Rendering
checks using SwiftShader are functional evidence, not hardware performance
measurements. Local captures and reports remain ignored in `artifacts/`.

Final validation: full suite **3670 passed, 6 optional cases skipped, 0 failed**;
TypeScript and production build passed. Separate Stock/Advanced ordinary and
severed-population browser checks passed, including bounded physical parts and
race teardown. Existing combat-powerup browser checks passed. Final awards,
native blood and real scope-fall checks passed in visible Chromium at1280×800,
with no console/request/WebGL errors. The final derived-geometry bounds change
also passed the21 focused blood/fragment checks.
