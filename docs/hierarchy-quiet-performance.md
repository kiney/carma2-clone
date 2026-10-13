# Native hierarchy quiet ownership (PERF-17)

## Result and scope

Cars, attached/free vehicle pieces, split secondaries and supported jointed
NONCARs now have production quiet providers. They share complete physical-tree
and geometry-contact-ring ownership with the existing pedestrian/free-prop
providers. Native energy, gravity-response, corner and world-joint upright gates
replace missing-provider perpetual activity. No low-speed timer, visibility
sleep, piece TTL or rigid-body-library sleep threshold was added.

A dormant piece remains in PHIL, rendering and opposite-body discovery. It skips
free forces and independent world-response collection; fixed prediction and
certified stationary geometry remain cheap. A real hit wakes its hierarchy
before solving, preserves momentum and resumes force work next tick. Source
car wheel queries still run asleep, grounded support wakes the prior contact
ring, and grounded postprocessing keeps the car hierarchy awake. Detached
pieces stay independent. Driver2/3 pieces are never driver4 scenery reclaim.

Preparation snapshots each new owner once, including late admission, without a
second force pass. Physical moments inflated by50 are restored before physical
partition replacement or repair. Actual deferred-friction queue flags and local
velocity cache feed the quiet tests. Unknown providers block whole-group sleep
but cannot block a grounded/reset/repair wake. See the
[verified formulas, addresses and explicit deviations](c2-hierarchy-quiet-re.md).

Ordinary detached parts and pulled scenery receive the exact original initial
gravity-only hint; sleeping scenery retains its hint. A separately documented
**split startup correction** prevents a new private secondary from immediately
quieting in midair before its first force step. It changes only the initial
quiet hint, adds no impulse, and is replaced by the secondary's own real force
packet next tick. Native pooled physical-memory aliasing remains unimplemented.
Tumble and unknown custom/affine eligibility are not certified automatic sleepers.

## Observed work and correctness

The user's pre-edit paused Timber census was33 bodies: seven cars, fifteen
pieces, eleven admitted props (six already dormant), plus466 retained scenery
ACTs. Small velocity alone did not establish eligibility; several low-linear
speed pieces still had meaningful angular motion. No exact replay of that
crushed geometry or preceding frame is claimed.

Bounded original Eagle3/Cerby fixtures reserve/release real WAM parts and place
one free hood over original finite Timber road. Initial placement is controlled;
quiet state, forces, mass, hulls and thresholds are not fabricated. Both reach
natural eligible sleep at tick3. The original attached bumper follows its
anchors and remains awake with the grounded owner. Original jointed scenery
`&24p0028` also reaches eligible sleep with its joint, ACT and PHIL retained.

| Observed free-piece work                      | Eagle3 | Cerby |
| --------------------------------------------- | -----: | ----: |
| Force calls in two retained sleeping ticks    |      0 |     0 |
| Own world-contact method calls in those ticks |      0 |     0 |
| Force calls on the first tick after impact    |      1 |     1 |
| Own world-contact method calls after impact   |      2 |     2 |

Method counts do not count every trajectory-guard dispatch or hull probe.
Opposite-body discovery remains active. Nine actual40ms steps per car verify
sleep/retention, pre-lambda wake, positive accepted impulses, subsequent force
work and repair cleanup. Eagle's **attached bumper** hits the hood first;
Cerby's root hits its hood. The initially suspected wheel-reaction route is not
claimed by these captures; numerical integration separately tests wheel wake.

A fresh original Eagle airborne split uses only three real ticks. Its secondary
preserves mass, COM and partition moments, gains no initial velocity, rejects
premature quiet at the gravity-response gate, then falls0.00227244 model units
with Vy=-0.056811 on its first real free-force tick. That tick replaces the
creation hint; repair removes its PHIL/body/provider and restores the car.
Porker2/Eagle numerical startup fixtures additionally cover Vy0 and-.005.

The final headless suite passes2910 tests; subsequent focused review assertions
also pass. Production build passes. Four original core crash scenarios preserve
component damage, crush, wastage and repair, with GL0/clean console/network.
The core harness labels its controlled initial roll (~31mph) plus actual W input
and waits for damage delta, rather than mistaking first attribution for damage.
Its `--core-only` path excludes the old180/240-step split-search scenarios.
The extended run exposed the startup defect before correction; it was not
repeated as a prolonged workstation run. The focused original split fixture is
its bounded replacement for this ticket, not proof of every SPAM admission path.
Existing four Stock/Advanced city/Carrier free-prop quiet/reclaim/repull cases
also pass with complete coverage. Screenshots were inspected; generated reports
and original-asset screenshots remain ignored.

## Short comparison and limits

Source-only baseline `bced7ae`, Stock Timber, seed0x50455246, original Eagle plus
seven deliberately fast-rotating pieces. The moving fixture has14 initial/16
final bodies and466 retained props in both versions; it is **not** a resting
wreck benchmark. Two manual ticks, one whole40ms update, then a250ms CPU-only
window. Initial state, resulting state and fractions match exactly in this
sample. Pair candidates496, world-guard calls128, pair rows32 and world rows6
also match. Extra native quiet work has no sleeping population to remove here.

Hardware browser creation timed out before page navigation; it produced no
hardware measurements. A final asynchronous DevTools keyboard probe also did
not return; it is recorded as a tool/transport failure, not an application
failure. DevTools successfully read the paused user state and loaded diagnostic
Timber earlier. Independent reproducible Chromium harnesses supplied final
runtime validation.

The successful fallback is **SwiftShader**, Vulkan1.3, buffer2098x1466. Drawing
was suppressed for CPU attribution. These are not rendered/hardware FPS:

| CPU sample (ms)               |  Baseline |       New |
| ----------------------------- | --------: | --------: |
| Traced first manual tick      |     110.5 |      98.1 |
| Untraced second manual tick   |      40.5 |      43.6 |
| Whole single40ms update       |      46.8 |      21.7 |
| Four-tick window median / max | 22.1/22.2 | 20.2/47.3 |
| Whole-update window max       |      22.8 |      48.7 |

Adverse samples are retained. The new window includes an update with two ticks;
no-physics updates are not tick timings. This tiny shared-workstation comparison
establishes neither a general speedup nor disappearance of historical <=4FPS
tails. The direct resting-work reduction above is verified. PERF-01 remains
open; PERF-18 separately owns dormant presentation and scenery submission.

## Reproduction and playtest focus

```sh
npm test
npm run test:hierarchy-quiet
node tests/browser-crash-matrix.mjs --core-only
node tests/browser-noncar-quiet.mjs
```

Before the next risky checkpoint, playtest dense Timber wreckage, hit long-resting
pieces again, inspect attached panels, repair and recover damaged/overturned
cars. Persistent pieces must reactivate and stay physical; rapidly rotating
clusters must remain active. Report new hanging, disappearing or nonreactive
pieces separately from perceived FPS. No visibility or resolution policy changed.
