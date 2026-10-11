# C2 pursuit and target trail evidence

This note records independent static verification of the installed C2 HW executable. `madebr/rec2` supplies names and structures; several annotated addresses and trail branches disagree with this executable. See [path evidence](c2-ai-paths-re.md) for projected routes, GetNear acquisition and the physical follower. No proprietary code is copied here.

## GetNear cache and fresh seed

Installed InitOpponents writes the current player's target-cache deadline (`car+0x1540`) to zero at `0x4adb70`, and signed16 cache section (`car+0x155c`) to -1 at `0x4adb76`. Every opponent's previous target section (`opponent+0x78`) becomes -1 at `0x4add39`. Installed LoadCar actually begins at `0x488e10`, rather than rec2's `0x488f70`: `rep stos` at `0x488e30` clears all 6500 car-spec bytes. Other loaded cars therefore initially have zero cache fields; their later explicit -1 initialization has not been established.

Fresh-seed direction at `0x4ac9f3–0x4aca55` uses live displacement differences, with no intermediate Float32 displacement store. Its dot-product order is `(dx*row2.x + dz*row2.z) + dy*row2.y`; nonnegative means direction 1. ACT row2 (`actor+0x44/+0x48/+0x4c`) is the world backward basis. It is not COM displacement, local velocity or the forward travel direction. Cancellation fixture: displacement `(2^35,-2^35,-2^-30)` and row2 `(.5,.5,f32(sqrt(.5)))` produce zero in native X/Z/Y order but a negative result in Three's X/Y/Z order.

High-speed acquisition (`0x4ac8b7–0x4ac99e`) retains the live model-velocity square sum, without square-root or intermediate speed store. Live lookahead is `(100-sumSquares)*f32(-.0625)*double(.14492753623188406)`. The initial endpoint intentionally uses the global section indexed by selected route SLOT and its stored direction. Relative to the nearest intersection, X/Y differences are kept live while also stored Float32 at `0x4ac953/959`; initial distance is `sqrt(liveX*storedX+liveY*storedY+liveZ²)`, without a final store. While distance is strictly below remaining lookahead and another slot exists, subtract distance, advance slot, and use the actual route section's stored Float32 length for subsequent distances.

## Pursuit dispatcher and state

Installed `ProcessPursueAndTwat` is `0x4aaf30`; rec2's `0x4ab190` annotation points inside this implementation. Fields relative to opponent: target car `+0x114`, next visibility check `+0x118`, backup start `+0x11c`, last successful twat `+0x120`, last visible `+0x124`, last away from target `+0x128`, direct start `+0x12c`, direct finish `+0x14c`, direct section `+0x16c`, and state byte `+0x180`.

START (`0x4ab5a2–641`) clears visibility/backup/twat timers and last-visible, sets last-away to now and state 0, and initializes direct-line metadata. It does not start the follower or clear its previous desired speed/forces. State 0 is classified on the next RUN, rather than dispatched as a normal driving state.

RUN first stores `max(playerDistance,3)` at `+0x178`; distance strictly above 3 refreshes last-away (`0x4aaf9e–dd`). Personality 3 bypasses the grudge guard. Otherwise catalog grudge below 15 completes the objective (`0x4aaff0–4ab090`). Existing reverse state 3 bypasses visibility classification.

For other states, reverse starts if now is strictly after last-twat+1000, strictly before last-twat+3000, and the target's live 3D model speed is below `f32(.043478261679410934)` (`0x4ab09d–135`). Otherwise reverse starts when all three conditions hold: now>last-away+7000, now>last-twat+7000, now>backup-start+10000 (`0x4ab64c–69d`). Deadline additions wrap unsigned32; comparisons use unsigned ordering, not modular elapsed subtraction.

## Visibility and transitions

Classification (`0x4ab6a2–963`) behaves as follows:

- Cheating: distance<30 and world-ray fraction>1 refresh last-visible; any failure explicitly clears last-visible.
- Physical: opponent flag `0x200` refreshes last-visible and sets next-check=now+900 immediately. Otherwise ray testing requires now>next-check and distance<35. A clear ray refreshes both fields; a blocked ray leaves both unchanged.
- The visibility ray uses target ACT origin with Y increased by `f32(.15)`, and own-minus-target direction with Y also increased by `f32(.15)`. Output vector components are stored Float32. The second Y adjustment therefore also affects the endpoint; preserve it rather than replacing this with equal-height endpoint offsets.
- If now<last-visible+3000, select state 2. A transition into state 2 calls follower START with pursuit=1, ignoreEnd=1, neverStruggle=0, then executes direct RUN.
- Otherwise fewer than two target trail nodes starts GetNear objective 4. An existing state 1 continues trail RUN. Entering state 1 finds the nearest GENERAL section using the target car as the non-null section selector, accepts section!=-1 and distance<=20, sets that current virtual section, and STARTs the follower with pursuit=1, ignoreEnd=0, neverStruggle=0.

Pursuit does not use the GetNear target cache at car+0x1540/+0x155c. It needs the target's shared trail storage.

## Virtual section accessors

Installed addresses differ from rec2 annotations:

| Consumer  | Installed  | Direct section 10000                  | Trail 15000+i                   |
| --------- | ---------- | ------------------------------------- | ------------------------------- |
| First     | `0x4ae7a0` | State 2 returns 10000                 | State 1 returns current section |
| Next      | `0x4ae7d0` | -1                                    | Advance iff i<nodeCount-2       |
| Start     | `0x4ae930` | opponent+0x12c                        | target trail node i             |
| Finish    | `0x4ae9e0` | opponent+0x14c                        | target trail node i+1           |
| Width     | `0x4aea80` | stored +0x174, initialized .5         | .5                              |
| Min speed | `0x4aeaf0` | +0x170+towardsFinish, initialized 0   | 0                               |
| Max speed | `0x4aeb90` | +0x172+towardsFinish, initialized 255 | 255                             |

10001 is the second dynamic NODE identifier, not a second segment. Non-pursuit First returns 20000. Projected section 20000+slot retains the independently verified global-slot cheat-only lookup quirk; a dynamic resolver must preserve this distinction.

## Direct prediction and reverse forces

Direct state 2 (`0x4ab202–375`) snapshots own ACT translation into the start node. Let D=targetPosition-ownPosition and R=targetModelVelocity-ownModelVelocity, using stored Float32 inputs but live differences. Their lengths use `sqrt(liveX*f32(X)+liveY*f32(Y)+liveZ²)`. Relative speed is also stored Float32 twice at `0x4ab2c2/c6`. Prediction time is zero if live relative speed<1; otherwise `liveDistance/storedRelativeSpeed*.5`. Each finish component is `f32(targetPosition+f32(targetVelocity*time))`. There is no 6.9 conversion. RUN uses pursuit=1, ignoreEnd=1, neverStruggle=(liveDistance<2), and ignores the follower result.

Reverse state 3 (`0x4ab152–201`) initially clears curvature/brake and applies `f32(-8*mass)`. Strictly after backup-start+2200 it clears acceleration and applies `f32(15*mass)`, retaining existing curvature. Strictly after backup-start+3000 it clears brake and returns state to 0, also retaining curvature. A late first RUN can enter braking without the earlier curvature-zeroing phase; the helper must therefore preserve the caller's curvature in those phases.

`src/ai/pursuit-motion.ts` implements these prediction and reverse primitives. Scoped review found prediction store ordering consistent; root corrected reverse curvature preservation. The existing JavaScript unsigned deadline expressions are valid because shift binds more tightly than relational comparison. Native checks the +3000 completion deadline only inside the +2200 braking branch; preserve that nesting across wrap. For example, start `0xfffff500`, now 500 still reverses because the +2200 deadline has not passed, although the wrapped +3000 deadline has independently passed.

## Trail following and outstanding lifecycle

State 1 (`0x4ab380–58c`) checks target `nodesShiftedThisFrame` at car+0x153a. If current section>15000, decrement it once. Otherwise reacquire the nearest target trail section, requiring section!=-1, distance<=20 and a clear ray from nearest intersection to own ACT. Success overwrites the current section and STARTs with pursuit=1, ignoreEnd=0, neverStruggle=0; failure selects GetNear 4. Then RUN with the same flags; either result 1 or 2 selects GetNear 4.

Shared trail recording and successful-twat attribution remain integration prerequisites. Installed successful-twat stores are `0x4aefda` and `0x4af1aa` within car-impact processing; their complete attacker/victim eligibility must be verified before wiring a generic collision event. The native lifecycle differs from rec2 in important details, documented below as verified rather than silently adopting the reconstruction.

### Installed trail lifecycle

`StartRecordingTrail` is installed `0x4aa230`, not rec2's `0x4aa490`. Recorder count at car+0x13f4 is initialized to 1 or incremented if already nonzero. Fresh start clears shifted/deviated flags, sets node count 2, next-record=now+500, and copies car travel direction to base heading. Both starting nodes copy ACT translation; node0 Z is increased by `f32(.2)` and stored Float32 (`0x4aa2b9–dd`). Trail capacity is 25 vectors, beginning car+0x13f8; base heading+0x1524, next-record+0x1530, count+0x1538, deviated+0x1539, shifted+0x153a.

Installed `MungeOpponents` begins `0x4a9bb0`, and contains the player trail recorder inline (`0x4a9c26–0x4a9f2e`), before opponent objective processing. Its population/path guards return if there are no opponents or cops, or no path nodes/sections. It initializes recording if recorder count is zero; otherwise clears shifted each outer opponent frame even when the deadline has not passed. Recording requires now strictly above next-record, then sets next-record=now+500. Heading dot is stored Float32 at `0x4a9c8c`, adding Z/Y products before X, then compared with native FastScalarCos(30) at `0x4a9c90`; below that marks deviation. Installed lookup `0x511000` reads the authored Float32 table value **0.8660249710083008** for 30 degrees (table address `0x65ffd0-30*4`), which differs from computing cosine at runtime. Distance from ACT to the penultimate node uses live X/Y times their Float32 spills and live Z squared, then stores the length Float32. Live length<`f32(.3)` returns before updating the last node.

With no deviation, visibility requires ALL three probes to be clear, short-circuiting on the first blocked probe: offset +.5 side ray, offset -.5 side ray, then center ray (`0x4a9df8–e43`). rec2's retry-on-blocked logic is incorrect. If all are clear, no new node is committed. If deviated or blocked, commit only when stored length>2 for clear/deviated, or >1.5 for blocked. Committing increments count below 25; at capacity, `memmove` copies 288 bytes (24 vectors) from node1 to node0 and marks shifted (`0x4a9e8b–a8`). rec2's 12-byte copy is incorrect. Commit clears deviation and snapshots base heading. Except the early short-distance/deadline returns, the trailing node is finally overwritten with current ACT position.

The installed side-offset helper `CalcNegativeXVector` at `0x401fe0` retains live differences `dx=finish.x-start.x`, `dz=finish.z-start.z`, without a Float32 displacement store. Its normalized direction is **(+dz,0,-dx)**, opposite rec2's declared cross-product sign. The length is `L=sqrt(dx*f32(dx)+dz²)`; the X-related spill is at `0x40201f`, while the Z square remains live. L is stored Float32 at `0x402049/04d`, but the threshold comparison uses live L. For L>`2^-22`, inverse=`double(1)/f32(L)` (`0x402070/074`), normalized components are stored Float32, and then multiplied by the requested Float32 length and stored again. Otherwise normalized direction is (+1,0,0), also scaled by the requested length (`0x40209e–d1`). Fixture: start zero, finish (1,0,3), requested length .5 gives offset X **0.47434163093566895**; dividing by live L instead gives 0.47434166073799133. Although opposite side-offset signs produce the same pair of rays, retaining the installed sign preserves their short-circuit query order.

Pursuit DIE is a verified no-op: commands other than START=0 and RUN=1 return through `0x4aaf49–0x4ab641`. `NewObjective` explicitly dispatches DIE=2 through `0x4aa6a0` at `0x4aab1d–24`, before replacing the objective. No C2 `StopRecordingTrail` symbol or recorder decrement was found: installed car+0x13f4 references establish Start increment and race-initialization zero stores, not per-pursuit stop/clear. Do not introduce a decrement or clear on pursuit exit based on an ancestral implementation. The player recorder starts globally in MungeOpponents; nonplayer recorder lifecycle and successful-twat impact attribution remain separate boundaries.

Trail-start constant was independently rechecked: `0x4aa2bf` subtracts VA `0x589528`, whose bytes `cd cc 4c be` encode Float32 -.2. The adjacent `0x589524` contains -.15 and belongs to visibility-ray offsets. Consequently the installed starting-node Z offset is +.2, not +.15.

### Geometry adapter boundary

An explicit projected/direct/trail view can expose local geometry cursors with a view-specific Next policy. The verified virtual accessors introduce no additional one-way/type flag tests for direct or trail sections. Preserve native external first/current/last-struggle IDs and convert stored corner IDs consistently; preserve the projected global-slot Next quirk only in the projected view. Direct endpoints refreshing and trail shifting do not independently restart the follower. Follower START occurs on the dispatcher state transitions described above; trail First uses the existing native current section, while direct First returns 10000. This representation does not require changing authored track metadata.

### Verified nearest-trail finalization quirks

Installed non-null `FindNearestGeneralSection` (`0x4a8070`) selects candidates using trail segments and Y-weight 2. Endpoint improvements and projection improvements are strict, and their saved scores are Float32. Projection parameter is stored Float32 before the inclusive [0,1] test. The projection wins a final score tie (`0x4a82f6–0x4a830d`).

The endpoint output indices are reversed: a finish-endpoint score winner stores node index i at `0x4a8186`, while a start-endpoint score winner stores i+1 at `0x4a81cb`. Non-null finalization copies that selected trail node (`0x4a8386–0x4a83dc`). This is not a direction/pointer interpretation: candidate finish and start positions are independently established by the weighted subtraction instructions, and the final node index directly addresses the target trail. Example: trail X=0→10, query X=11 selects the finish score but outputs node X=0, distance 11.

A winning projection recomputes live delta from the selected TRAIL segment (`0x4a8314–0x4a8347`), but finalization unconditionally adds the original GLOBAL section[i].node0 (`0x4a8438–0x4a848d`). X product remains live through base addition; Y/Z products are stored Float32 first. The returned intersection is `f32(globalBaseX+liveDX*t)`, `f32(globalBaseY+f32(liveDY*t))`, `f32(globalBaseZ+f32(liveDZ*t))`. Example: trail X=0→10, query X=5, global section0 start X=100 produces intersection X=105 and distance 100. Both quirks are verified from the installed binary and independently visible in rec2; treating target trails as ordinary nearest-polyline geometry is incorrect.

Final distance uses live actor-minus-stored-intersection differences, mixed X/Y products with their Float32 spills, live Z squared, then Float32 sqrt output at `0x4a851a`. Pursuit's <=20 acceptance compares this stored output (`0x4ab3f9` and `0x4ab919`). `src/ai/trail-nearest.ts` independently implements these branches and requires original global metadata for projection finalization; it does not silently fall back when that metadata is missing.

## Rematerialization boundary

Installed `RematerialiseOpponent` begins `0x4a8540`; rec2's `0x4a87a0` is a stub annotation. Already-physical opponent flag 8 returns 1 immediately (`0x4a8583–b1`). Otherwise the function saves the actor matrix, sets physics flag 8/render style 0, calls the physics activation helper `0x4c8dd0` with 1, and rebuilds active objects through `0x4a7820` before attempting placement.

Verified state updates (`0x4a8884–0x4a8bb4`): car direction becomes negative ACT row2. Ground-query translation temporarily uses Float32 stores of translation*double(6.9), followed by translation*double(1/6.9). Collision model velocity is negative ACT row2, normalized with <=`2^-22` fallback (+1,0,0), and scaled by `min(inputSpeed,10)`; this is an upper cap without a lower clamp. Angular velocity becomes zero, steering curvature becomes zero, actor matrix is copied into collision+0x8c and car+0x1c, and four wheel deflections at car+0x1264..0x1270 reset from car+0x1220. Car+0x135c/+0x1340 clear; car+0x12c4 becomes 1. Collision+0x178 is initialized to PHIL counter-2 and collision+0xec clears.

Velocity-normalizer precision differs from the trail side helper: negative ACT row2 is first stored Float32 to velocity, then `L=sqrt((vx²+vy²)+vz²)` remains live (`0x4a8971–9d`). X/Z spills rewrite the existing Float32 components; there is no L spill. Above `2^-22`, inverse is `double(1)/liveL` (`0x4a89ad`), and normalized components are stored Float32. Each component is then independently stored as `f32(normalizedComponent*min(f32(inputSpeed),10))`. Negative speed is retained. The world-query translation scale roundtrip affects placement, not velocity or the speed argument.

Placement calls installed `TestForCarInSensiblePlace` at `0x41fe70`, passing an output collision vector. Nonzero is success. Failed attempts restore the saved actor matrix before generating subsequent offsets (`0x4a8bc3–ce`). The attempt counter permits 24 failed placement tests before stopping generation. Ground alignment and retry offsets are verified below; an arbitrary occupancy guard or generic teleport cannot substitute for them.

The return value is especially important: on exhausted placement, the function clears forces, velocity and angular velocity, disables physics again, rebuilds the active list, invokes fallback `0x4a8f20`, and **still returns 1** (`0x4a8e75–0x4a8f01`). Successful placement calls ResetCarSpecialVolume `0x4ff2c0` and also returns 1 (`0x4a8f04–1b`). Thus return 1 alone does not establish successful physical placement; consumers must retain the actual physics state and fallback outcome.

### Installed ground alignment and retry sequence

Verified from installed HW `0x4a8540–0x4a8daf`; rec2 leaves this function stubbed. Yaw is `0x3ffc-trunc(atan2(ACT.row2.z, ACT.row2.x)*10430.378350470453)`. The operand order is established by FLD Z, FLD X, FPATAN (`0x4a8563–69`), rather than inferred from a C function signature. RotateY `0x531ea0` sets row0=(cos,0,-sin), row2=(sin,0,cos). Identity row2=(0,0,1) produces angle -4 wrapped to 65532, a four-unit native heading discrepancy, not a quarter turn.

Each placement attempt scales translation into metric query coordinates with Float32 stores of model translation\*double(6.9), resets the orientation to this fixed pure yaw and restores the metric translation. It queries wrapper `0x41e380` twice, with direction (0,-100,0): origin (Px,f32(Py+1),Pz), then (Px,f32(Py+100),Pz). The first query supplies fraction/normal at stack +0x1c/+0x38; the second supplies +0x14/+0x58.

When the second fraction <=1, the special branch (`0x4a8728–0x4a87a7`) uses direction (0,f32(-5.01),0). It stores working Y=f32(Py-100), then probes origin Y=f32(workingY+5). The loop never updates working Y: every retry repeats the same Py-95 origin. It repeats while returned fraction>1, up to 20 queries, increments the counter once after the loop, then replaces the second fraction by `f32(counter*f32(.05)-returnedFraction*f32(.05))`. Both .05 constants are Float32 0.05000000074505806. This repeated-origin behavior follows separate stack +0x24 working-Y and +0x2c pushed-origin stores; it is not a synthesized ascending scan.

If the resulting second fraction is strictly smaller than the first, its normal replaces the first normal and the chosen fraction becomes its negation. Otherwise the first fraction/normal remain. Only abs(chosenFraction)<=1 aligns the actor. Metric Y becomes `f32(Py-(chosenFraction*100-2))`. Pitch is `trunc(asin(dot(row2,normal))*10430.378350470453)` followed by PreRotateX `0x532da0`; roll then uses the UPDATED row0, `trunc(asin(dot(row0,normal))*-10430.378350470453)` followed by PreRotateZ `0x5331a0`. The asin helper `0x5759d0` retains a live argument (with a QWORD classification spill) and evaluates `atan2(x,sqrt((1+x)*(1-x)))`; it does not clamp or spill the argument to Float32. Query translation is scaled back through Float32 stores of double(1/6.9) before the velocity/reset/placement test.

A failed placement restores the complete SAVED actor matrix before generating its offset. There are 24 tests: the initial attempt and offsets k=0..22; old counter 23 stops generation. For k<=20, n=trunc(k/4), v=-saved row2. When k%4<2 use normalized v and radius n*f32(.5); otherwise use normalized cross(Y,v)=(v.z,0,-v.x) and radius n*f32(.1). Both normalizers compare LIVE length>2^-22 and use double(1)/LIVE length, with (+1,0,0) fallback. Their normalized components stay live through radius multiplication and saved-translation addition: only the final position is Float32. Odd k negates the complete offset. Thus k=0..3 duplicate the original position, 4/5 are forward ±.5 model units, 6/7 side ±.1 (negative/positive X for identity row2), 8/9 forward ±1, 10/11 side ±.2, and k=20 forward +2.5. k=21/22 instead set saved actor Y+2/Y+4 MODEL units. Every generated position re-enters the yaw/ground/reset/test sequence.

### Exhausted-placement fallback

Installed `TeleportOpponentToNearestSafeLocation` begins `0x4a8f20` (rec2 stub annotation `0x4a9180`). It finds the nearest GLOBAL section; a negative result returns immediately. Otherwise it clears last-in-view, forces, curvature, velocity/angular velocity and the reset fields, and disables physical state/render style if necessary. It seeds the projected route with the nearest section and direction determined by car.direction dot returned section direction (<0 chooses 1), then calls native TopUpRandomRoute `0x4a9160` with -1.

Starting at route slot1, it moves ACT translation to the AUTHORED endpoint node[entry.direction], recomputes player distance through `0x4a92f0`, and exits only when stored player distance is strictly greater than gIn_view_distance (`0x68fdf4`). At the logical route end it shifts the consumed prefix (slot-1), copying backing slots up to capacity12, refills with -1 and continues from slot0. The native loop has no additional attempt/time bound. The conspicuousness helper stores player-relative components and Float32 distance and updates last-in-view when live distance is strictly below the threshold. The threshold is max(cameraYon+10,45), initialized at `0x4adbe4–0x4adc12`. Fallback leaves physics disabled and does not perform another sensible-place test. Consequently exhausted rematerialization's return1 remains a request-success result, not proof of physical placement.

### Independent reset/ground helper implementation status

`src/ai/rematerialization.ts` implements the verified velocity reset and saved-matrix retry offsets; `src/ai/rematerialization-ground.ts` implements one attempt's metric scale roundtrip, yaw, two initial probes, repeated lower probe, chosen fraction/normal and ordered pitch/roll. Scoped binary review confirms their current branch order and Float32 stores. The lower probe counter is 1 for a first-query hit, 20 for a twentieth-query hit and 21 after twenty misses. World-ray fractions are stored Float32 at `0x45cfa5`; the miss sentinel initializes to 100 (`0x45cf74`). Wrapper `0x41e380` separately stores each metric origin/direction component multiplied by Float32 0.14492753148078918 before the model-coordinate query.

PreRotateX `0x532da0` and PreRotateZ `0x5331a0` build Float32 sin/cos matrices and call Mul `0x531c60` with rotation first and old matrix second. Radians use `(angle&65535)*double(9.587379924285257e-05)`. Pitch updates rows1/2 as `f32(c*r1+s*r2)`, `f32(-s*r1+c*r2)`; roll then updates rows0/1 as `f32(c*r0+s*r1)`, `f32(-s*r0+c*r1)`. Products and sums are live until component stores; translation is preserved. Pitch's live dot accumulation is (X+Z)+Y (`0x4a8818–0x4a882e`); roll's updated-row0 dot is (Z+Y)+X (`0x4a8851–0x4a8868`). Invalid asin is not clamped: native conversion helper `0x575190` truncates through FISTP QWORD and returns its low DWORD, which is zero for masked invalid conversion's INT64-indefinite result.

Precision limitation: the independent helpers use JavaScript binary64 arithmetic and Math trigonometry rather than x87 evaluation/FSIN/FCOS/FPATAN. Authored Float32 inputs, intermediate stores, constants and operation ordering are explicit; bit identity at every transcendental or retained-extended-precision boundary is not claimed. The helpers alone do not activate physics, run sensible-place collision tests, implement exhausted-placement fallback or complete runtime cheating/rematerialization integration.

### Sensible-place return polarity and successful volume reset

Independently verified from installed HW; rec2's `TestForObjectInSensiblePlace` remains a stub. `TestForCarInSensiblePlace` `0x41fe70` returns 1 immediately when not racing (`0x41fe79`). During racing it sets gTesting_car_for_sensible_place (`0x677c3c`) to1, forwards collision-info/list/output-vector/world-callbacks to `0x428fc0`, clears the testing flag and returns EAX unchanged (`0x41fe9d–a7`). There is no wrapper negation or boolean conversion.

The three placement cases at `0x428fc0` have these final public results:

| Case                                                 | Final result | Installed evidence                                                                                                                                                                                        |
| ---------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| World contact/obstruction from star query `0x422800` | 0            | Nonzero contact count writes the output direction, then XOR EAX,EAX at `0x4290cc` and returns `0x4290d8`.                                                                                                 |
| Eligible linked-body/shape overlap                   | 0            | Internal hit flag1 at `0x429155` branches into separation-vector output; normal exit XOR EAX,EAX at `0x429273`, degenerate fallback XOR EAX,EAX at `0x4292c4`, followed by returns `0x4292a5`/`0x4292d0`. |
| No world or eligible body obstruction                | -1           | OR EAX,-1 at `0x4292d6`, return `0x4292e0`.                                                                                                                                                               |

The internal body-hit flag1 must not be exposed as the public result: output-vector finalization clears it in both branches. RematerialiseOpponent tests public EAX against0 (`0x4a8bb9–bd`), accepting clear -1 (or the wrapper's nonracing1), and rejects both kinds of obstruction. The sensible-place flags affect collision-query setup and object creation/bounds preparation; the inspected wrapper/result path does not invert polarity.

The successful-placement call at `0x4a8f04–1b` is **ResetCarSpecialVolume** `0x4ff2c0`, not a generic body reset. It disables pling-material treatment (`0x45dad0`), casts from collision actor translation in direction(0,200,0), and re-enables it (`0x45dac0`). If fraction<100 and a nonempty material identifier begins with ! or #, it chooses the default water volume (`0x75f464`); otherwise the pointer is null. It writes collision.auto_special_volume+0x25c (`0x4ff341`) and water_depth_factor+0x254=Float32 1 (`0x4ff347`). No velocity, inertia, damage or general body reset occurs in this helper. rec2 maps the same behavior under its shifted annotation `0x4ff530`.

### Global nearest-section storage implementation

`findNearestPathSection` in `src/ai/path-geometry.ts` now independently implements installed NULL/global `FindNearestGeneralSection` `0x4a8070`, rather than ordinary double-precision vector projection. Actor/node inputs, weighted candidate components, endpoint/projection saved scores, projection parameter, intersection, normalized direction and final distance retain native Float32 stores. Strict candidate improvements compare a live score against the stored best score, so an apparent exact geometric endpoint tie can still replace the earlier candidate after the first score is rounded. Unlike the trail selector's swapped indices, GLOBAL finish/start endpoint winners correctly copy authored node1/node0 (`0x4a818a`, `0x4a81d0`). Projection ties win, and global finalization uses the selected section's own start node.

Direction uses the unweighted LIVE difference of stored authored nodes and live `sqrt(dx²+dy²+dz²)` reciprocal, then Float32 component stores (`0x4a8490–0x4a84d1`), with no normalizer threshold or initial delta store. An explicit robustness deviation returns zero direction for an authored zero-length section; the original divides by zero. Empty graphs return no result and unrepresentable Float32 candidates/results raise a bounded error. Other straight/endpoint helpers are unchanged. Scoped validation: all13 target-acquisition tests and all10 nearest/straight geometry tests pass. The nearest fixtures now distinguish live-score comparisons from stored best scores, include binary-exact endpoint ties, and bracket the projection cutoff with adjacent Float32 node lengths rather than unstored double inputs. TypeScript passes.

### Per-attempt reset and lifecycle order

Further installed-binary tracing of `RematerialiseOpponent4a8540` establishes
that yaw is computed once from the incoming row2 before the already-physical
shortcut. A nonphysical caller saves the entire original ACT matrix, sets
collision flag0x100 at+0x19c, render style0, pipes render-enable, sets opponent
physical bit8, and immediately rebuilds the active list **before** placement.
Each attempt replaces orientation with the saved yaw, applies ground alignment,
then resets velocity from that attempt's **aligned row2**. Retry displacement
instead uses the **saved original row2**, after restoring the whole matrix.
Using the retry heading for velocity loses the recovered slope response.

Before every sensible-place test, the binary zeros omega, curvature, gear and
revs; copies the aligned ACT matrix into collision.transform_matrix and
car.old_frame_mat; sets all four old wheel deflections to susp_height[0]; sets
traction_control1; writes box_face_ref=uint16(globalFaceNumber−2) and
collision.disable_move_rotate0. Per-attempt acceleration and brake forces are
**preserved**. The cached car direction is negative aligned row2. Cached car
pos is transformed from COM with an additional Float32 inverse-unit multiplier
both before and after actor translation is scaled back; this duplicate native
cache write must not be mistaken for an extra translation of the visible actor.

The test occurs at0x4a8bb4. A failed test restores the original full ACT matrix,
then reads/increments retry index: old index0 through22 generate the documented
retry pose, old index23 exits. Consequently the initial attempt plus23 retries
perform exactly24 tests. Every retry repeats the ground alignment using the
saved yaw. Success keeps the aligned/reset state, calls ResetCarSpecialVolume
and returns1. Exhaustion restores the original actor matrix, zeros car forces,
curvature/gear/revs and collision omega/velocity, clears physical bit8, sets
render style1, pipes render-disable, rebuilds the active list, invokes nearest
fallback and still returns1. Earlier cached wheel/matrix/traction reset writes
are not generally rolled back by this exhausted branch.

These lifecycle stores are verified evidence for the remaining live mode
adapter; the existing scalar/ground helpers do not yet perform this whole
sequence or resolve the engine's redundant native cached-coordinate fields.
