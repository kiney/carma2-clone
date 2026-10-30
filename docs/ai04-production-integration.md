# AI-04: integrated opponent struggle and recovery

AI-04 completes the existing native struggle path's fleet integration. It does
not replace C2's unusual count-zero behavior with a browser timeout, change
vehicle collision response, or promise that an opponent can escape every
obstruction in view. Original assets remain read-only; no third-party code was
copied.

## Verified behavior and corrected boundaries

Installed HW evidence uses SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
The PE metadata and paired SW identity are recorded in
[the binary audit](ped11-topology-re.md). Existing reconstruction and direct
installed-code checks support the following ownership:

| Boundary                  | Evidence                                                                                                                                                                         | Browser implementation                                                                                                                                                                                                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Physical stuck detection  | `ProcessFollowPath`, HW `0x4afc6e–0x4afd99`; [timing evidence](c2-ai-paths-re.md#struggle-timing-and-failure)                                                                    | Existing movement/pursuit, speed, section, count and mass gates retained. No initialization-frame reverse.                                                                                                                                                                                                                       |
| Count-zero struggle       | HW `0x4afa33–0x4afb14`                                                                                                                                                           | `750*count-750` is zero-extended Uint32 before the timing arithmetic. Count zero normally cannot finish its internal reverse/brake cycle in a short session.                                                                                                                                                                     |
| Outer interruption        | `ProcessThisOpponent`, HW `0x4aa32f–0x4aa34c`, `0x4aa5d8–0x4aa5f9`                                                                                                               | Cheating after strictly more than three seconds out of range and strict objective deadline expiry interrupt the physical follower. Deadline equality does not restart it.                                                                                                                                                        |
| Give-up/restart forces    | [physical follower ordering](c2-ai-paths-re.md#physical-follower-state-and-ordering)                                                                                             | **Corrected:** synchronize actual car-owned acceleration/brake into the shared follower immediately before objective RUN. Borrowed-time result2 preserves current forces, including same-frame countdown braking; struggle-count result2 still clears them. Local CompleteRace restart does not invent a new objective deadline. |
| RunAway route eligibility | Shared `TopUpRandomRoute`, HW `0x4a921f–0x4a922c` tests opponent flag `0x20` before excluding section type2. rec2 supplies the call map, not its unimplemented top-up algorithm. | **Corrected:** START, refill and result2 restart pass current opponent cheating mode rather than hardcoded false. Physical mode still excludes type2.                                                                                                                                                                            |
| Per-attempt reset         | `RematerialiseOpponent`, HW `0x4a8b0b` stores car `+0x12c4=1`                                                                                                                    | **Corrected:** every real simulation placement reset enables traction control. Damage remains untouched.                                                                                                                                                                                                                         |
| Exhausted placement       | HW `0x4a8e75–0x4a8ef2`; nearest-safe relocation reads cached direction at `0x4a8fd3–0x4a8fd9`                                                                                    | **Corrected:** exactly24 reset/test attempts. Restore saved actor/state pose and publish its pose epoch, without a25th per-attempt reset. Keep the last aligned cached direction for relocation. Clear dynamics and disable physics as before.                                                                                   |
| Fallen-world recovery     | Selector `ChooseNewObjective`, HW `0x4acc10`; [fallen-world evidence](c2-ai-cheating-re.md)                                                                                      | Existing strict500ms check, safe relocation, GetNear start and nearest-placement callbacks retained. Permanent component damage and pre-placement orientation survive relocation.                                                                                                                                                |

The force-cache defect was an adapter ownership error: a previous AI frame's
cached acceleration could overwrite subsequent simulation/placement commands
when Follow gave up without writing forces. The exhausted-placement defect
similarly conflated actor restoration with the much wider native reset. The
previous AI-02 test expected25 resets; its expectation is corrected to24 against
the installed branch, rather than retained as a behavioral specification.

## Tests and interpretation

`tests/ai04-recovery.test.mjs` uses the actual fleet, selector, lifecycle,
objective and physical follower. Real initial motion followed by stationary
frames reaches count-zero struggle. It covers strict deadline equality/+1,
cheating equality/+1, failed placement-return retry, successful return and
physical resumption, plus fallen-world relocation/GetNear callback ownership.
Callbacks isolate physical placement in these headless state-machine tests;
they do not claim collision-based placement coverage.

`tests/ai04-force-ownership.test.mjs` reproduces two stale-force failures before
the fix. A late borrowed-recovery record is injected explicitly because the
normal count-zero record cannot finish in a short test. No follower return is
mocked: give-up, restart and final force application are real.

`tests/ai04-run-away-modes.test.mjs` covers physical/cheating START, refill and
restart. START/refill use real Follow. Restart is an explicitly injected raw
status2 coordinator boundary: a stable cheaty Follow emits0/1, so the test does
not assert that status2 naturally occurs while cheating.

`tests/ai04-rematerialization.test.mjs` uses the real
`VehicleSimulation.rematerializePose` and crash direction cache, isolating
activity/obstruction boundaries. It proves24 attempts, retained last-attempt
direction despite a meaningfully tilted saved pose, synchronized restored
actor pose, and traction reset before every test. These tests and the force
regressions were observed failing before changing the engine. The RunAway
physical cases passed while its three cheating cases failed; all now pass
without changing their expectations.

`npm run test:ai-recovery` builds and runs original Stock Newcity1 and Advanced
Carrier2 cars/roads through the production bundle. The paused controlled-clock
fixture checks a reachable struggle, deadline restart, actual borrowed-result
force preservation, physics-off remote traversal, real authored-road/ground/
collision rematerialization and return to physical processing. It records
WebGL backend, drawing buffer, transitions, console/network failures and
screenshots in ignored `artifacts/`. SwiftShader runs check correctness, not
hardware performance. The same self-contained fixture can run via DevTools.

## Deliberate limits

- The native routine returns1 even when exhausted fallback leaves physics off.
  Callers retain that polarity; they must not equate it with successful physical
  placement. A callback-return0 retry is tested independently and is not claimed
  to be the ordinary production wrapper's exhausted return.
- Successful Follow rematerialization clears forces and returns that frame;
  it does not erase a retained physical struggle or start a fresh objective.
- The4096-visit safe-relocation bound remains a documented browser robustness
  policy. Closed components report exhaustion rather than fake an escape.
- Authored safe browser grid starts remain intact. Historical original grid
  ranking and whole race-launch RNG chronology are separately AI-06.
- This work adds no proximity-triggered magic teleport, repair, impulse or
  guaranteed short escape time for nearby obstructed cars.

## Validation results (2026-10-30)

- Production build/TypeScript passes in the isolated candidate and integrated
  root checkout.
- All14 new numerical recovery cases pass. Existing placement adapter cases
  also pass with the corrected native24-reset expectation.
- Original-installation complete suite:3,755 pass,6 optional skips and one
  intermittent Vite HMR-shutdown timeout. The unchanged server suite passes8/8
  immediately in isolation. This timeout is already recorded in
  [PERF-25 validation](perf25-world-joint-phase.md); it is not an AI assertion
  failure. The first sandboxed run also lacked loopback socket permission and
  is not counted as an application regression.
- Asset-free CI checkout:3,254 pass,439 original-dependent skips,0 failures.
- Original Stock/Advanced recovery production browser:2/2 pass; console,
  failed requests, HTTP failures and WebGL error collections empty.
- Existing native AI Stock/Advanced/Snow browser checks and both original
  real-contact crash-reaction cases pass without reported errors.
- Chrome DevTools runs the same recovery scenario on hardware ANGLE AMD
  Radeon/radeonsi gfx1150,2072x1436 drawing buffer, WebGL error0. A separate
  fresh-load keyboard drive advances647 frames and12.04 model units, with all
  five rival poses finite and no console/WebGL errors. This is a correctness
  smoke check, not an FPS benchmark or proof of every possible obstruction.

Ignored reports and screenshots were retained in the isolated candidate's
`artifacts/`. The validation tab/server were closed afterward; other browser
scenes were not reloaded.
