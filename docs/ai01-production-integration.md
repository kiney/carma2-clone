# AI-01: regular opponent startup and crash reactions

## Outcome

Regular opponents already used source-informed objective selection, personalities,
visibility, pursuit, escape, repair and collision attribution. The crash adapter
matches the inspected original code; this task adds real-contact integration
coverage instead of inventing different response thresholds. Concrete engine
corrections concern the startup random stream, missing ranking draws and the
ordering of instance initialization versus personality quotas.

## Native startup evidence

Binary identities are recorded in [the HW/SW audit](ped11-topology-re.md).
Original files remain read-only. rec2 supplies names/layouts; installed code
resolves chronology and fields.

| Operation | HW | SW | Verified behavior |
|---|---|---|---|
| SelectOpponents | `5036b0` | `4fe800` | Explicit IDs retain duplicate/player eligibility and ranking `-(slot+1)` with no draws. |
| ChooseOpponent | `5037d0` | `4fe920` | Ascending eligible catalog IDs, authored tier escalation/fallback, inclusive candidate draw even for one candidate. |
| Random-slot ranking | `5037a0` | `4fe8f0` | A second inclusive0..99 draw follows each random choice and populates tOpp_spec+8. |
| IRandomBetween | `512f00` | `50dd00` | Quantize rand15, signed32 multiply, truncate towards zero after division by32768, wrapping final addition. |
| InitOpponents | `4adaf0` | `4a94a0` | Every regular instance draws repair interval then visibility delay before either personality quota pass. |

HW initialization draw sites are `4adcbc` and `4add11`; the per-instance loop
finishes at `4ade76`, before quota draws `4ae017`/`4ae08c`. Five instances from
CRT seed1 consume ten repair/visibility samples followed by four quota samples,
yielding personalities `[2,1,2,2,0]`. Eleven consume30 draws and yield
`[2,2,2,2,2,2,1,1,0,0,0]`. GENERAL repair bounds120/240 retain the original60000
multiplier despite their misleading seconds labels. Later repair rerolls use the
same signed32 bound arithmetic, including wide custom inputs.

## Browser ownership

`main.ts` now supplies `sharedNativeRandom.random` for native roster selection.
The ID-only API also consumes full candidate/ranking chronology. Selected ranks
are retained on live rivals as `selectionRanking`, without silently applying an
unverified grid reorder.

`planNativeOpponentInitialization` reserves every repair/visibility value, then
the quota personalities, synchronously before opponent asset awaits. The native
fleet consumes those values at publication without drawing again. Repair and
visibility timestamps use the current publication game clock; the first objective
frame is preserved. The ordinary `fleet.add` path without reservations still
initializes normally. Invalid reservations fail before fleet registration and
zero values are valid data.

Reservation is a browser integration extension: other game systems may keep
using the shared stream while assets stage, but cannot alter the reserved AI
values. Failed/superseded loads consume their reservations; there is no global
rewind that would undo another system's work. Existing private staging, live-grid
validation, synchronous publication and disposal remain authoritative.

This is **not whole-launch CRT parity**. Installed DoGame calls SelectOpponents
at `503ad5` and `503af9`; SortOpponents `4e2950` uses ranking comparator `4e2930`
and a player grid draw at `4e2994`. Native loading has intervening consumers.
The browser still uses its supported request-order grid. The separate
AI-06 / TASK-136 owns that launch/grid investigation; it must preserve safe
starts rather than adding guessed discarded draws.

## Crash-to-decision evidence

The existing production chain is retained:

`real contacts -> solved impulses -> both receiver damage paths -> attribution`
`-> fleet reaction with live victim accumulator -> cleanup -> next AI frame`

HW `4aecbe..4aecf9` derives severity as
`trunc(min(100,sqrt(F32(victimAccumulator)*300000)))`. Below5 exits before facts;
`4aed76..4aede3` writes contact pointers/times, recent grudge, big-bang and
severity>=80 scary-bang. Weak scary victims clear forces and retain the maximum
unsigned stun deadline `now+1000+30*severity` (`4aeec5..4aeeee`). Human hits raise
shared catalog grudge; AI hits on humans reduce it unless pursuing any target.
AI-to-AI hits do not invent catalog grudge or human-retaliation pursuit.

Selection runs before the stun gate. A surviving weak opponent may choose
RunAway immediately while actual following waits until strict stun expiry.
Scary flee requires strength<5, player distance<10 and its source probability;
there is no generic component-health flee rule. Permanent knackered/freewheel
handling has earlier priority. Big-bang retaliation requires a local-human
hitter; last-we-hit can independently select player pursuit. Facts are consumed
once on the next AI update. AI/raw collision clocks remain distinct.

Five original-Eagle solver fixtures cover mild human contact, strong retaliation,
weak surviving scary-impact flee, AI hitting player and AI-to-AI contact. They
use normal dynamics/damage, not injected impulses or written accumulators.
Each measured case reaches attribution in three physical ticks; observed
severities are29/78/86/34 (AI-to-AI separately checked). Stun equality and
resumption, source grudge formulas, pointers and fact cleanup are asserted.

`npm run test:ai-reactions` runs two Chromium cases on authored THE BRUISE
BROTHERS:12 real catalog51 regular copcars with strength5, original Eagle player.
Controlled initial poses isolate a pair100 native units above the track while
retaining the world, gravity and other population. Real contacts drive the normal
outlets; no accumulator, invulnerability, personality or catalog edits manufacture
the response. Both strong-human-hit and AI-hit-player select pursuit on the next
fleet frame. This is controlled contact coverage, not a naturally driven replay.

The delayed-load startup test uses native CRT seed4, preserving the original
Bigdump/Newhawk regression. It checks20 roster draws,20 initialization draws and
8 quota draws in that order;17 unrelated shared draws during staging leave the
reserved IDs/rankings/repair/visibility/personalities unchanged. All eleven cars
publish supported and undamaged with no partial fleet visible during loading.


## Final validation (2026-10-30)

- Production build and TypeScript pass. Full suite:3748 tests,3742 passed,
  six optional skips, no failures. Asset-free CI copy:3679 tests,3240 passed,
  439 asset-dependent skips, no failures.
- Five real-solver contact conformance cases pass; two Chromium contact cases
  reach attribution in three physical ticks, measured severity100 and71, and
  select player pursuit with surviving victims. No console/request/WebGL errors.
- The held-model Bigdump/Newhawk startup fixture passes with complete native
  IDs/rankings/personality/deadline expectations and no partial publication.
  Stock/Advanced/Snow native-AI movement, physical/remote transitions and
  freeze/thaw regressions pass.
- Hardware Chrome DevTools independently runs the strong-contact fixture:
  severity100, threshold43, victim survives, next frame pursues the player,
  source facts consumed, GL error0. A fresh USS LEWINSKY race advances53 frames
  under real W input, with12 registered finite rivals and no fleet/console/GL
  errors. Backend AMD radeonsi at2072x1436; screenshot inspected. These short
  functional checks are not a performance benchmark.
- Ranking/quantization and reserved-initialization tests fail against the old
  missing APIs/ownership. The wide-repair arithmetic regression also fails with
  the baseline class (1704852704 versus native2430527296) and passes unchanged
  with the corrected signed32 calculation. Existing crash formulas needed no
  replacement. Original data and captures remain untracked/read-only.
