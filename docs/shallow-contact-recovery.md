# PHY-16: shallow bodywork contact stalled a whole pile

## Diagnosis

The captured Timber pile contains seven original cars, a loose Eagle bumper,
Mach13's hinged door and an anchored world prop. Mach13 and the bumper overlap
by `0.000389350918` model units (about 2.69 mm). Both prior-recovery flags are
false, but the native geometric overlap predicate is true and ordinary type-5
contacts produce positive impulses. The additional browser trajectory guard
rejects their post-response movement. Dependency coupling propagates that tiny
permitted time to the player, Porker2 and the door. This is not a render pose
mismatch, sleeping car or failed repair.

This is the flagless, shallow-contact variant of the PHY-13 guard trap, separate
from PHY-14 parent suppression and PHY-15 perceived delayed debris contacts.

## Native evidence and implementation

The installed HW binary was rehashed against `c2-physics-re.md` and inspected
read-only. Existing rec2 maps locate functions; the following control flow was
verified from the original binary. Addresses are installed HW virtual addresses.

| Address             | Relevant behavior                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `0x427b37–0x427b50` | Prior flag `0x100` selects recovery versus ordinary CCD.                                                                            |
| `0x427e07–0x427f1d` | Ordinary point/hull and edge/edge collection has no monotone SAT-depth test.                                                        |
| `0x461939–0x46194c` | Clipping returns `-1` for an already-inside starting vertex.                                                                        |
| `0x4284e4–0x428512` | Ordinary CCD handles that result by marking the vertex `0xff` and setting next-tick `0x200` flags without requiring prior recovery. |
| `0x42868b–0x4286b2` | Accepted ordinary features emit type-5 rows.                                                                                        |
| `0x428997–0x4289a3` | Edge processing skips already-inside endpoints.                                                                                     |
| `0x4bbe7a–0x4bbef5` | Response restores saved poses and reintegrates 0.04 seconds without a monotone-overlap movement veto.                               |
| `0x4bafb8–0x4bafc8` | Zero aggregate rows retain the existing candidate.                                                                                  |

Prior recovery selects an emitter; it does not authorize movement. Requiring an
accepted-row certificate would also be wrong: native old-inside geometry can
legitimately have zero rows.

`pair-guard.ts` now admits an OLD hull cell when its solid SAT depth exceeds the
existing `1e-6` threshold and `nativeHullRecoveryOverlap` qualifies its geometry,
independently of the prior flag. The actual collector still uses the flag to
select its emitter. No impulse, damping, owner immunity, force, friction, hull
scale or dependency algorithm changes.

Admission remains per hull cell and captured phase. Initially clear sibling
hulls, other bodies, world contacts, masks, joints and unequal-prefix
revalidation retain their checks. A later phase starting clear rearms collision
protection. The historical counter `recoveryHullAdmissions` now includes
qualified flagless OLD overlaps.

This is a **native-informed browser integration policy**, not a claim that C2
contained this guard. An admitted cell may deepen or clear/reenter within that
phase, as already permitted by PHY-13. Other cells remain independently guarded.

## Reproduction and validation

`npm run test:shallow-contact` reconstructs the ignored capture in the production
browser simulation with original Timber, configurations, hulls, normal forces,
world collection, local response/retries and WAM parts. It runs three steps each
for forward, reverse and bumper-removal control. It skips cleanly without the
private capture, original assets or Chromium.

| Player displacement from initial pose, model units |      Tick 1 |      Tick 2 |      Tick 3 |
| -------------------------------------------------- | ----------: | ----------: | ----------: |
| Before, forward                                    | 0.000000549 | 0.000001166 | 0.000001886 |
| Before, bumper removed                             |    0.048623 |    0.054532 |    0.065457 |
| Fixed, bumper retained                             |    0.048623 |    0.054532 |    0.065457 |

Reverse produces the same release. First fixed commit admits one old hull cell;
all ten bodies receive fraction 1. Positive Mach13/bumper type-5 impulses remain.
The bumper survives, both joint anchors remain coincident, and repair restores
player part/actor/component state without removing Mach13's door. Repaired-part
cleanup occurs on the next tick, covered by the existing overlap regression.

The fixture restores captured post-tick physics, not preceding application
history. Render dents, RNG state, quiet caches and WAM timers were not captured.
Known bumper/door phases are reconstructed from ancestry. NPC inputs are retained
but bounded direct steps omit outer-frame AI dispatch. These limitations apply
equally to before/after/control. Baseline raw commitment fractions were not
recorded; do not infer historical frame fractions from this reconstruction.

Portable numerical tests cover flagless inward movement, tolerance touching,
later reentry, independent sibling hulls and third-body walls. The optional
captured kernel uses 0.04 seconds and checks player ID 0 separately from Mach13
ID 3. Original Eagle3/Cerby Chromium tests cover separation, renewed positive
type-5 contact, repair and road support.

Final checks: production build succeeds; all 2,948 headless tests pass. The
production four-car Stock/Advanced crash matrix and original grid/pair escape
browser regressions also pass, without console, asset-request or WebGL errors.
Crash/repair screenshots were inspected. An independent physics/binary review
found no remaining blockers. Historical guard oracles remain unchanged; tests
explicitly distinguish the intended OLD-overlap divergence from clear-entry
collision/cache equivalence.

Chrome DevTools MCP is unavailable in this session. The reproducible Chromium
harness uses SwiftShader at 1280 × 800: functional evidence, not hardware FPS.
Ignored reports include `phy16-world-baseline.json`, `phy16-world-fixed.json` and
`phy16-local-baseline.json`. Original data and captures remain outside Git.

Playtest: crash damaged cars into loose parts; drive/reverse away without repair;
separate and collide again; repair/recover. Watch for new tunnelling or lasting
interlocks. A physically constrained car, especially with one load-bearing
wheel, may still legitimately have little traction.
