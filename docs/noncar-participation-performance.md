# Static ACT and local NONCAR participation (PERF-16)

## Result

Loaded scenery remains a retained, renderable ACT catalog, with ordinary static
triangle, wheel and camera coverage. Only successfully admitted NONCAR owners
enter body discovery, hierarchy prediction, force/commit loops and dynamic
camera-shape queries. The fresh Timber census is 466 retained props, zero active
props and seven registered cars instead of 473 ordinary physics bodies.

An oriented native `ActorBoxPick` query can pull an ACT, omit its static subtree
and insert its prepared physical candidate in the same collection. Local
response's mutation barrier revisits the new roster before solving; a zero
normal lambda does not prevent geometry wake. Earlier force-phase queries do
not inherit the collision traversal's cascade enable. The enable uses captured
pre-contact source velocity, rather than a response-mutated velocity.

All promotion outlets share `admitNonCar`: native collection, wheel reactions,
driven-on motors, numbered follow-up smash, delayed movement and connotation
debris. Registration and preparation do not run another force/gravity step.
Ordinary physics wake is distinct from translation-motor trigger counters.

## Native evidence and resource ownership

The installed HW executable remains read-only. Its recorded SHA256 and PE
metadata, functions and formulas are in [wake/pull](c2-noncar-wake-pull-re.md)
and [reclaim](c2-noncar-slot-reclaim-re.md). Relevant verified installed addresses:

- `ActorBoxPick` `0x45fdc0`: two oriented OWN-MODEL bounds tests, then pull;
  a successful owner suppresses static subtree emission at `0x46034d`.
- `DoPullActorFromWorld` `0x41ff40`: one dedicated owner per mechanics type,
  then the first free of forty **global** extras. Initialize ec=1 and clear
  V/omega before `PHILAddActiveObject` `0x4b6080`.
- `PrepareObject` `0x4b9510`/`InternalPrepareObject` `0x4b9780`: snapshots and
  candidate preparation, independent of applying another NONCAR force step.
  Reduced-list insertion `0x4b9767` is independent of positive contact lambda.
- Missing mechanics/physical capacity writes identifier byte1='x' at
  `0x420007`. Ordinary static MODEL faces remain; automatic retry is disabled.
- `CheckForDeAttachmentOfNonCars` `0x4203e0`: after `FinishCars` `0x416520`,
  once per outer frame. Its shared BSS clock advances only with active NONCARs;
  one pass at >=1000ms discards excess, without race-load/dispose reset.

PHIL's separate hundred-header table is not the forty-extra physical pool.
The original pull does not check header-allocation failure. The browser
**deliberately** rolls back physical occupancy and preserves retryable static
coverage on header failure; it does not falsely apply native sticky-x semantics
or return a physical owner with no registration.

The shared slot kernel owns occupancy, not actual native body-memory aliasing.
Browser bodies retain private identities. Reclaim releases a physical slot and
header without freeing the ACT, borrowed geometry/materials or retained ACT
capacity. Driver2/3 detached/split car pieces are never reclaimed as driver4
NONCARs. Unsupported quiet hierarchies remain active for PERF-17; no arbitrary
speed cutoff, timer, visibility or distance heuristic was added.

Reclaim reads the ACT's OWN original DAT MODEL bounds, including unused vertices,
and other awake owners' retained GetFacesNearObject bounds/inverses, even when
those cache references are no longer valid for reading faces. Current physics
AABBs are not substitutes. Missing awake-cache or MODEL providers retain owners.
Provider collection runs only when the source one-second clock is due, rather
than scanning MODEL vertices every rendered frame.

Return restores native column/root/additional membership and static spatial
coverage at the current pose. The additional-parent sentinel is captured before
pull reparenting. Full Three/native parent-frame rebasing preserves world pose;
this is an explicit browser coordinate bridge. Ownership changes invalidate
borrowed face-cache references conservatively to avoid static/body duplicates.
Packed native traversal and finite face capacity are retained.

Connotation clones resolve exact original ACT local MODEL/MAT registry identities,
including authoritative NULL/inherited materials; render names or compacted
material-group indices do not stand in for resource identities. Clones remain
collidable after returning outside the Three track root. Clone-local index
records avoid a whole-track rebuild on every spawn. Failed clone cleanup removes
only copied ACT/index ownership and leaves borrowed resources intact. A missing
external provider is diagnosed and blocks that clone's reclaim; physical motion
is retained. Private physical-memory aliasing and unsupported jointed-template
initialization remain explicit compatibility gaps.

## Short hardware comparison

Source baseline `8224cb2`, Stock/Advanced Timber, deterministic fixture seed
`0x50455246`, original Eagle plus seven detached parts and identical initial
car/part mechanics and poses. Original scenery inventory stays 466 in both
checkouts; the initial active physics rosters intentionally differ. Source-only
baseline in `/tmp`, shared installed npm dependencies, original assets served
read-only through `CARMA2_ROOT`; no proprietary copies.

AMD ANGLE/radeonsi gfx1150, OpenGL4.6, drawing buffer2101x1466. Two manual ticks,
one inclusive whole40ms update, then a bounded250ms CPU-only normal-frame
window. Drawing is suppressed for attribution. These shared-workstation samples
are **not** rendered FPS or a replay of the user's exact preceding crash.
Cold/adverse observations are retained.

| Work/CPU                                    | Stock baseline |    Stock new | Advanced baseline |     Advanced new |
| ------------------------------------------- | -------------: | -----------: | ----------------: | ---------------: |
| Initial active bodies                       |            480 |           14 |               484 |               18 |
| Bodies after fixture                        |            480 |           16 |               484 |               21 |
| First / second manual tick (ms)             |  292.9 / 150.0 | 126.4 / 62.9 |       92.0 / 81.2 | **115.6** / 49.4 |
| Whole40ms update CPU (ms)                   |           83.5 |         21.1 |              34.3 |             27.9 |
| Body candidates across all pair collections |          14880 |          496 |             16940 |              735 |
| World-guard dispatches                      |            590 |          128 |               598 |              137 |
| Final refined world-guard dispatches        |            480 |           16 |               484 |               21 |
| Pair contact rows                           |             32 |           32 |                32 |               32 |
| World contact rows                          |              6 |            6 |                 6 |                6 |

Advanced's first cold tick regresses; keep that observation. Its short foreground
window whole-update maximum falls50.2→27.8ms, with10/12 updates respectively;
updates without physics must not be presented as tick times. The first Stock
baseline window ran in a background tab and contains no frame samples, so it
provides **no** valid normal-frame comparison. Static world collections and
actual moving-body sweeps do not fall by the 466-object roster ratio: source
activation adds real scenery interactions. PERF-01 remains open; no steady60FPS
or elimination of every historical <=4FPS tail is claimed.

Ignored evidence: `artifacts/perf16-*-hardware.json`, the pre-edit paused census
`perf16-user-before.json`, and original-asset browser reports/screenshots.

Reproduce a short serial source-checkout comparison with current and baseline
loopback servers; do not run parallel stress captures:

```sh
node tools/profile-guard-kernel.mjs --url http://localhost:5194 --baseline http://localhost:5195 --hardware --samples 2 --root data --allow-participation-changes --output artifacts/perf16-stock-comparison.json
node tools/profile-guard-kernel.mjs --url http://localhost:5194 --baseline http://localhost:5195 --hardware --samples 2 --root adv_data --allow-participation-changes --output artifacts/perf16-advanced-comparison.json
```

The participation flag compares initial car/part state and retained NONCAR count,
while separately reporting full-roster equality and changing collision outcomes.
It is not full native behavioral conformance. Default profiling checks retain
historical full-initial-state requirements.

## Validation and playtest focus

Bounds, shared occupancy, physical/PHIL exhaustion, sticky failures, zero-lambda
wake, actual-step admission, retained static return, additional-parent capture,
shared outer-frame clock and lazy MODEL providers have deterministic tests.
Original Stock/Advanced Newcity and Carrier approach/repull fixtures preserve
ACT/MODEL identity and receive real coupled collision impulses. Those four
fixtures deliberately set existing quiet state for reclaim and **do not prove
natural settling**. Original connotation-debris regression also passes all four
tracks, including untouched authored launch motion, fire and resource cleanup.
The quiet browser test now observes physics/reclaim boundaries: a render-frame
poll can miss sleep followed by header release within the same outer frame.
It preserves authored launch snapshots, then explicitly places an original
free body in a controlled moderate-speed drop over clear original road. It
changes initial pose/velocity/spin, never quiet flags, forces, mass or hulls.
All four Stock/Advanced cases reach actual eligible sleep and receive positive
car/body impulse with nonzero velocity on registered wake or static repull.
City's former placement at the original station ledge remains unsuitable as
proof of velocity exchange; its missing coverage is not silently declared fixed.

The four-car crash matrix, including permanent crush, wastage, repair, split and
jointed parts, also passes. Its synthetic45-unit/s severe collision now asserts
real accepted pair contact/proximity at impact plus finite in-world end poses,
rather than assuming cars remain within10 units after the crash. Other damage,
repair, split and attachment assertions remain. Stock/Advanced smash follow-up
checks preserve original powerup dispatch and Carrier mission completion.
Hardware DevTools verifies keyboard driving and an original Timber tree impact,
with physical activation, accepted impulses, engine damage and GL/console0.
The full headless suite passes2869 tests; final focused admission/quiet checks
also pass after the native ec-initialization and explicit-slot checks.

Use `npm run build`, `npm test`, `npm run test:noncar-participation`,
`npm run test:noncar-debris` and `npm run test:noncar-quiet`. SwiftShader browser
checks establish correctness, not hardware performance. Reclaim observations
must distinguish an actual eligible quiet transition from below-world-Y recovery
and from a released header; a render-frame-only poll can miss an intermediate
physics state.

User playtest before PERF-17: drive into barriers, signs, trees and loose props;
leave them behind and revisit; crash amid loose debris; drive over moving/lifting
scenery; repair/recover. Look for missing obstacles, one-frame pass-through,
objects that stop colliding after settling, scenery freezes and new deep stalls.
