# C2 opponent path evidence

Current integration: [AI-04 recovery completion](ai04-production-integration.md)
records the live fleet checks and corrected force/placement-cache ownership.
Earlier pending-dispatch statements below describe historical reconstruction
stages; AI-01/AI-02/AI-04 now supply those live integrations.

Scope: native section metadata, projected routes, nearest-section selection and physical path following. The installed local `carma2_HW.exe` is the specification; `madebr/rec2` supplies symbols and structure names. The executable's provenance and hashes are recorded in the existing reverse-engineering notes. No executable or original asset was modified.

## Status and addresses

The current `RoadNavigator` is a temporary undirected graph and steering heuristic. Metadata parsing and pure projected-route helpers do not complete AI-02: native straight grouping, corner construction, speed-obstruction constraints and objective-specific transitions must reach the live controller.

Installed addresses below differ from several rec2 annotations:

| Function                    | Installed HW            | Evidence                                                           |
| --------------------------- | ----------------------- | ------------------------------------------------------------------ |
| FindNearestGeneralSection   | `0x4a8070`              | Binary verified, including inlined weighted selection              |
| TopUpRandomRoute            | `0x4a9160`              | Binary verified; rec2 stub                                         |
| CalcRaceRoute               | `0x4aabc0`              | Binary verified; reconstructed rec2 has reverse-direction error    |
| Shift / Add projected route | `0x4aaea0` / `0x4aaef0` | Standalone binary boolean returns and capacity verified            |
| GetNextSection              | `0x4ae7d0`              | Binary verified, including suspicious section-type indexing        |
| GetSectionStart / Finish    | `0x4ae930` / `0x4ae9e0` | Binary verified                                                    |
| GetSectionWidth             | `0x4aea80`              | Binary verified                                                    |
| GetSectionMin / MaxSpeed    | `0x4aeaf0` / `0x4aeb90` | Binary verified                                                    |
| ProcessFollowPath           | `0x4af700`              | Binary verified selected steering and force branches               |
| GetStraight                 | `0x4b1170`              | Binary verified; rec2 stub                                         |
| CalcCorners                 | `0x4b1300`              | Binary equations, iteration and Float32 stores verified; rec2 stub |
| SetMaxSpeedFromSOCs         | `0x4b1650`              | Binary traversal/braking equations verified; rec2 stub             |
| CalcSOCs                    | `0x4b1850`              | Binary constraint traversal and speed caps verified; rec2 stub     |

## Authored sections and route storage

Native path sections occupy 20 bytes: two node IDs (`u16`, offsets 0/2), endpoint minimum speeds (`u8`, 4/5), endpoint maximum speeds (`u8`, 6/7), width (`float`, 8), 3D length (`float`, 12), type (`u8`, 16) and one-way flag (`u8`, 17). `LoadInOppoPaths` reconstructs the eight authored values as `node0,node1,min0,max0,min1,max1,width,typeCode`. Type codes at least 1000 set one-way and subtract 1000 before the byte cast. Types are normal 0, race path 1 and cheat-only 2. Width is loaded without a scale conversion.

Each node stores the first eight incident section IDs in authored section order. Both endpoint occurrences are inserted, so a self-loop contributes twice. Additional incidences are ignored after a diagnostic. This behavior is reconstructed in rec2's implemented loader.

An opponent's projected route has capacity 12. Count is at opponent offset `0x7c`; entries start at `0x80`, stride 4, with signed section ID at 0 and direction byte at 2. Direction 1 travels node0 to node1; direction 0 travels node1 to node0.

Append refuses a full route without mutation; otherwise it appends and returns success. Shift refuses `places >= count` without clearing; otherwise it subtracts places and shifts entries. The installed inlined shift at `0x4a90fc–0x4a9132` confirms this refusal and count update. Rec2 also reconstructs the boolean returns and copying of unused storage slots. Clear sets count to zero. Negative shifts and empty random-route seeds are invalid native inputs; bounds-checked browser APIs should reject them.

### Random top-up

At `0x4a917b–0x4a9193`, a negative requested addition means fill to 12; a positive addition uses `min(count + addition, 12)`. Zero calls `PDEnterDebugger`. The helper requires an existing last route entry.

For each addition, obtain the last entry's finish node and scan its incident sections in authored order. Exclude the previous section, one-way sections whose node1 equals the finish node, and type 2 unless the opponent is cheating. Select uniformly when there are at least two candidates; a single candidate consumes no random number (`0x4a9258–0x4a9284`). The chosen direction is `finishNode != selected.node1 ? 1 : 0`. Consequently, a bidirectional self-loop selects direction 0 and a one-way self-loop is excluded. With no eligible candidate, reverse the previous entry, even if it is one-way.

### Race route and initialization

An empty complete-race route seeds the nearest section with direction 1, independent of heading. Subsequent priority tiers are forward race-path sections, forward other sections, then eligible reverse sections. A forward entry uses direction 1. A reverse entry uses direction 0, verified at `0x4aae3e–0x4aae48`; rec2 incorrectly appends direction 1 here. Candidate selection uses the authored incident scan and native random selection. Unlike random top-up, each nonempty race-route tier always consumes one `IRandomBetween(0,count-1)` call even when count is 1 (`0x4aadad`, `0x4aadea`, `0x4aae24`). If no candidate exists, reverse the previous section until a race-path section has been found; after one has been found, mark route calculation finished instead. This builder does not explicitly filter cheat-only type 2.

Complete-race objective processing is inlined in the `0x4aa6a0` dispatcher. Starting, or restarting after follow-path result 2 (given up), clears route count, builds the race route and starts following with ignore-end/never-struggle/pursuit all zero. `CalcRaceRoute` resets found/finished flags only when it sees an empty route. During a run:

- If follow section is strictly greater than 20000, shift by `section-20000`, then set follow section to 20000 regardless of the shift's boolean result (`0x4aa6d0–0x4aa6f4`).
- Replenish only when count is at most 10 and finished-calculating is false (`0x4aa6f6–0x4aa706`). Count 11 does not replenish. Ordinary shifts/replenishment retain found/finished flags.
- Follow result1 calls `NewObjective(GetNearPlayer=4)` at `0x4aa745`, then falls through with EDI still1 to inline `ObjectiveComplete` at `0x4aa75a–0x4aa798`. That completion sets the new-objective flag and decrements the **new current GetNearPlayer population**, after GetNear START has run. Preserve synchronous ordering: a deferred completion of the old CompleteRace objective is different behavior.
- Follow result2 rebuilds/restarts the same route/follower at `0x4aa7d9` without `NewObjective`, deadline changes or deadline RNG. Apply returned car forces first: borrowed-time give-up preserves them, while struggle give-up explicitly zeros them. Restart resets made-it/timing/PID but preserves desired speed, packed struggle count and original persistent escape state.
- Result0 (OK) returns without completing the objective (`0x4aa74d–0x4aa74f`), correcting rec2's misleading default `ObjectiveComplete` branch. Follower movement still accumulates the opponent-ever-moved flag; a local restart must not erase it.
- **Empty-route undefined-state boundary:** `0x4aa728` loads EDI from `[esp+0xc]`, the first uninitialized local DWORD after the dispatcher allocates0x11c bytes and saves three registers. CompleteRace never writes it. Other dispatcher branches reuse this local as vector scratch; its value cannot be recovered from the caller's saved EDI. The branch starts GetNear, then dispatches this raw status: zero returns,2 clears/rebuilds the race route and starts the shared follower again under the new GetNear objective, all other values complete GetNear. A deterministic adapter must require explicit raw-status provenance or label a chosen robustness deviation; it must not claim an inferred constant is verified C2 behavior. DIE returns without clearing forces, changing timers or calling follower DIE.

Run-away initialization differs: choose the nearest section and seed direction 0 when the cached vehicle travel direction dotted with the section direction is negative, otherwise 1, then random-top-up to capacity. There is no universal route initialization rule independent of the native objective.

`GetNextSection` returns -1 at the end of the projected route. Its non-cheating type-2 check indexes global section metadata using the next projected _slot_, rather than the entry's actual section ID (`0x4ae7f1–0x4ae802`); both installed code and rec2 expose this suspicious indexing. The route-count guard precedes this type check, and cheating skips it. Any intentional browser correction must be documented instead of presented as native behavior.

AI-06 defines one browser robustness boundary for that lookup: if the next slot
is outside authored metadata, return -1 for this traversal. Do not substitute the
route entry's section ID or invent metadata. The existing-slot type-2 quirk,
cheating bypass and twelve-entry backing route remain unchanged. The native
value beyond authored metadata has not been reconstructed; this boundary is not
claimed as original C2 behavior.

The original Stock `quarrynet` track has two nodes and one authored section, yet
GetNearPlayer legitimately fills twelve route slots by alternating direction on
that section. A captured Green Eagle playtest reached this path with BUZZ at
fleet time 21638 ms. The previous browser exception repeated every RAF before
physics and rendering; 1,000 buffered uncaught errors confirmed the visible
freeze. Synthetic and original-installation tests cover straight grouping,
corner/SOC queries, physical following and GetNearPlayer over this graph.
The focused production check is
`npm run build && node tests/browser-short-opponent-path.mjs`; it forces the
native objective at the current fleet clock, then exercises ordinary frames.
See [the freeze evidence](ai-short-path-freeze.md) for provenance and limitations.

## Nearest authored section

The installed helper evaluates sections in authored order. Let `a=finish-start` and `p=position-start`; multiply the Y components of both by 2 for selection distance. Track the nearest endpoint and the nearest interior projection separately using strict improvements, preserving the earlier section on ties.

Endpoints are tested finish first, then start. For weighted squared length at least `float32(0.0001)`, compute `t=dot(p,a)/dot(a,a)` and admit inclusive `0 <= t <= 1`. A projection wins when its weighted squared distance is no greater than the nearest endpoint distance. Return the original, unweighted 3D intersection and the original normalized section direction; the returned distance is the original 3D distance. Direction normalization is unconditional at `0x4a8490–0x4a84d1`, independent of the projection threshold; a browser zero-vector guard is an explicit extension. The binary uses the actual selected endpoint node, correcting rec2's erroneous section-number indexing. Selection applies no heading penalty, width offset, type filter or one-way filter.

## Straight grouping and speed fields

Native horizontal geometry uses `(worldZ, worldX)` vectors. `GetStraight` starts with the current entry's endpoints and width. For incoming vector `u=currentFinish-fixedStart`, outgoing vector `v=nextFinish-currentFinish` and total `u+v`, stop if `dot(u,u+v)<0`; otherwise merge only when `abs(cross(u,u+v))/length(u+v) < float32(0.1)`. It does not query the next entry's start, so discontinuous projected routes should be rejected by a browser boundary check instead of silently changing this arithmetic. A merge extends the finish point and takes the minimum section width. Repeat until a non-merge or route end. The return value is the first unmerged next entry, or -1. There is no fixed four-node horizon or generic look-ahead distance. Degenerate total vectors need a documented browser guard.

Minimum and maximum speed bytes describe endpoint limits. For a projected entry and `towardsFinish`, use endpoint index `direction == towardsFinish ? 1 : 0`. They are not two independent travel-direction limits. The installed max-speed consumer loads the integer directly at `0x4b1715` and compares it with metric desired speed; the SOC braking pass below confirms metres/second without an mph conversion. A minimum-speed getter exists, but no calls were found in these normal physical-following/SOC consumers.

The installed inlined `NearestSectionInStraight` projects longitudinal distance `dot(finish-start,position-start)/length(finish-start)` (`0x4b0f8e–0x4b0ffd`), correcting rec2's erroneous squared-length denominator. A temporary x87-block evaluator gives 5 for a 10-unit straight queried at its midpoint, rather than the source's fraction 0.5. Start cumulative length at zero and current at the first/current path slot. If next(current) equals the first unmerged slot, including -1, return current without adding its length. Otherwise form the sum of the prior stored cumulative value and the current entry's horizontal length. Store this sum Float32 for the next iteration (`0x4b104c`, FST), but compare the current unrounded live sum with projected distance (`0x4b1050`). Advance only when strictly less; equality retains current. A query behind the straight returns its first entry; beyond the group returns its last merged entry, never the first unmerged entry (`0x4b0fff–0x4b1065`).

## Verified path steering corrections

`ProcessFollowPath` uses metric horizontal speed `6.9 * hypot(modelVelocityX, modelVelocityZ)` for steering; its horizontal velocity vector is also multiplied by 6.9 (`0x4afded–0x4afdff`). The earlier acceleration/struggle speed uses the full 3D velocity length. The installed inlined curvature slew uses `maxDelta=float32(dtMs*0.0005)`, then stores the approached car curvature as Float32 (`0x4b053b–0x4b05a2`). The double constant at `0x589628` is exactly 0.0005: rec2's `dtMs*5/1000` reconstruction is ten times too fast. The requested curvature remains unrounded in x87 registers until this slew. Native maximum speed-dependent curvature is `maxCurve` below speed 12.5, otherwise `maxCurve * 12.5 / speed`.

For a straight, let `d=finish-start`, `r=position-start`, `L=length(d)` and `q=dot(r,d)/L`. The installed lateral/error calculation at `0x4aff90–0x4affec` is deliberately piecewise:

- `q <= 0`: retain q.
- `q > L`: use `q-L`.
- `0 < q <= L`: use `cross(r,d)/(width*L)`.

Rec2 instead reconstructs a cross product followed by length-based normalization, which does not match the binary. Heading error is `cross(d,velocity)/(speed*L)` with the native zero guards.

For a corner, error is `(distance(position,center)-radius)/cornerWidth`. Heading error is `dot(velocity,position-center)/(radius*speed)` (`0x4b00b3–0x4b00cf`), correcting rec2's misplaced multiplication. Base curvature is `1/(6.9*radius)` with handedness-dependent signs.

The lane branch tests `abs(error) <= 1` (`0x4b0100`), correcting rec2's omitted absolute value. It reduces desired speed above 6 by `(6-desired)*abs(headingError)`, stores that desired speed as Float32 (`0x4b0342`), and requests `baseCurvature + speedLimitedCurvature*(error*float32(0.1)-headingError)`, clamped to the car's maximum curvature. Base curvature uses the Float32 6.9 constant (`0x4b00df`), while input horizontal velocity scaling uses double 6.9. Error terms remain x87 register values until consumed; rounding every operation would be inaccurate. Outside that branch it requests desired speed 6, and below speed 12 steers toward the clamped nearest straight point. The moving-away escape state can reverse curvature after strictly more than 5000 ms.

The reduction has no lower clamp. Corner heading magnitude can exceed one while lane error remains within one, so a finite negative desired speed is a valid stored result and reaches the native acceleration controller as a braking request. For example radius 10, width 2, radial distance 11 and outward radial velocity give lane error 0.5 and heading magnitude 1.1; desired 80 reduces to approximately -1.4. Browser validation must not reject this native state.

Native corner entry uses `dtMs*speed*0.0005 > 6.9*(distanceToStraightFinish-tangentReach)`. The path controller's existing mass-scaled acceleration/braking equations are documented in the powerup/AI force notes; replacing native geometric outputs with throttle is not equivalent.

Nearest-in-straight selection affects the SOC starting entry only (`0x4b1065–0x4b107f`). It does not update persistent follow section as the car passes an intermediate authored segment. Persistent physical progression copies the stored corner section to follow section when leaving corner state (`0x4afe62–0x4afe76`). Complete-race shifting/replenishment consumes that updated section on the next outer objective run.

## Corner construction, speed constraints and integration boundary

`CalcCorners` constructs up to four 28-byte corner records: center at 0/4, radius at 8, tangent reach at 12, handedness at 16, following section at 20 and integer speed at 24. The section field is the virtual projected section ID `20000+slot`, stored directly from the current iteration's input (`0x4b134c`); it is not an authored global section index. An explicit browser `sectionSlot` is the correct representation after removing that virtual-ID bias. Width/start/finish getters resolve actual authored sections through the projected list. Corner speed is a signed 32-bit integer after truncation; authored endpoint speed bounds remain bytes. Its installed normal construction has now been reconstructed independently from the x87 operations:

Initialize its iteration section to the first straight's first unmerged section, previous start to the first straight's start, and previous width to that straight's minimum width. Each iteration calls `GetStraight` on its section, obtains the next straight's start (junction), finish and minimum width, and stores that iteration's section ID in the corner. After construction, previous start becomes the junction, previous width becomes this next straight's minimum width, and iteration section becomes the returned next unmerged section. Stop at -1 or four corners.

- Let `A=previousStraightStart-junction`, `B=nextStraightFinish-junction`, `C=dot(A,B)/(|A||B|)` and `S=cross(B,A)/(|A||B|)`. Positive S selects left; set `s=abs(S)`.
- For `s >= 0.001`, let `h=s/(C+1)` and `K=previousWidth+C*nextWidth`.
- Uncapped tangent reach is `T=K/s+h*nextWidth+sqrt(nextWidth*(h*h*nextWidth+2*K/(C+1)-nextWidth))` (`0x4b1478–0x4b14e5`).
- If `9*T*T` exceeds either adjacent straight's squared length, cap T to that straight's length times the installed float constant `1/3` (`0x4b14ed–0x4b153c`). Set radius `R=h*T`.
- Center is `junction+(B*T+perp(B)*R)/|B|` for left, or `junction+(B*T-perp(B)*R)/|B|` for right; `perp(B)=(-By,Bx)` (`0x4b1547–0x4b15cc`).
- An exactly zero squared-length straight or `s<float32(0.001)` takes the fallback: center=junction, `R=min(previousWidth,nextWidth)`, `T=float32(float32(0.7)*R)`, one random handedness call in the inclusive range 0/1. Normal construction consumes no RNG. The normalization magnitude guard uses `<=2^-22`; at or below it the normalized pair becomes cosine 1, sine 0 and therefore takes the fallback. Widths remain raw, with no positivity clamp observed. Corner construction leaves the speed field untouched.

For perpendicular 30-unit straights with both widths 1, this gives `T=R=2+sqrt(2)` without a length cap. A temporary independent evaluator of the installed x87 blocks confirmed normalized sine/cosine `(1,0)`, extended tangent reach `3.414213562373095`, stored Float32 radius `3.4142136573791504`, and left-turn center `(-3.4142136573791504,3.4142136573791504)` relative to a zero junction with outgoing vector `(0,30)`. Ten-unit straights cap both to approximately `10/3`. These are source-derived numerical expectations, not generic circular-road assumptions.

### Corner Float32 storage boundaries

The normalized cosine, signed sine and half-angle ratio remain x87 register values. Incoming/outgoing component differences and squared lengths are stored Float32 before later consumers. Important stores in the normal construction are:

- Store `K/s` as Float32 at `0x4b14b3`; the final reach sum adds this stored value at `0x4b14e5`. The square-root scratch store at `0x4b14dd` does not replace its live register value in the sum.
- Store initial reach T as Float32 at `0x4b14f9`. The first length cap compares the original unrounded `9*T*T`; the second cap uses the stored/capped Float32 reach. Each cap stores its result Float32.
- Compute extended radius as `h*storedReach` at `0x4b153f`, store radius Float32 at `0x4b1542` and retain the extended radius on the x87 stack.
- The first center numerator uses the extended radius; the second uses the stored Float32 radius. Both use stored reach. Store both numerators Float32 (`0x4b1566/0x4b1574` for left, `0x4b158e/0x4b15a4` for right), then divide by the square root of the stored outgoing squared length, add junction coordinates, and store the final center Float32 (`0x4b15c9/0x4b15cc`).

With zero junction and widths `float32(0.7),float32(1.3)`, independently evaluated installed blocks produce:

| Backward incoming A | Outgoing B | Stored reach       | Stored radius     | Stored center                           |
| ------------------- | ---------- | ------------------ | ----------------- | --------------------------------------- |
| (-31,3)             | (11,29)    | 3.6443369388580322 | 4.770451545715332 | (-3.1678807735443115,5.099306583404541) |
| (-40,3)             | (11,35)    | 3.5889830589294434 | 4.524764537811279 | (-3.2405245304107666,4.780511856079102) |

These cases expose one-ULP differences hidden by perpendicular or simple 3-4-5 cases when a browser implementation rounds only its final outputs.

`CalcSOCs` builds up to ten ordered constraints. Each 8-byte record has bit 0 set for a section constraint (virtual section ID at 4), or bit 0 clear for a corner constraint (corner-array index at 4). Its initial current section is the supplied `pNext_section`: normal following supplies `NearestSectionInStraight`'s result, while an already-cornering pass supplies the first newly constructed corner's following section. It is not unconditionally slot zero. For each corner:

1. While current is not -1, differs from the corner's following section, and constraint count is below ten, measure horizontal distance from the following section's start to current finish. If this distance is at most tangent reach, stop without appending or advancing. Otherwise append a section constraint, then advance through `GetNextSection`.
2. Append a corner constraint. Set its integer speed to `trunc(sqrt(radius*float32(6.9)*float32(7.5)*float32(1.96)))` (`0x4b1936–0x4b1952`).
3. Starting from the current entry left by step 1, cap corner speed by every entry's authored maximum speed towards its finish and advance until current equals the following section. Do not forcibly jump to that section.
4. Continue advancing/capping while the distance from that following section's start to the current finish is strictly less than tangent reach. Equality does not enter this overlap pass.

Zero corners produces zero constraints. If section constraints fill capacity, do not append or fill the pending corner speed. If appending a corner itself fills capacity, still finish that corner's speed/cap loops before stopping; later corners remain untouched. No minimum-speed getter calls occur in this pass. Malformed route bounds/end states need explicit browser guards rather than reproducing undefined native reads.

`SetMaxSpeedFromSOCs` uses metric speed directly. Its initial model-unit traversal horizon is `H=(speed*speed/16+dtMs*speed/1000)/6.9`. Initialize cumulative distance to zero, previous target to the car's horizontal position and previous-was-corner to false. Walk constraint target points: section finish or corner following-section start. A previous corner subtracts its tangent reach before the next leg; the current corner also subtracts its own reach before adding this leg's horizontal length. Clamp negative cumulative distance to zero, then update the previous target and corner flag. For target speed u, lower desired speed to `min(desired,u)` only when `cumulativeDistance*6.9 < (speed*speed-u*u)/16+dtMs*speed/1000`, strictly (`0x4b180f–0x4b1825`). Continue only while cumulative distance is less than H, checked before either per-leg subtraction. These source constants account for braking anticipation; generic turn-angle speed reduction is not equivalent.

For numerical conformance, the installed pass first stores speed squared Float32 (`0x4b167b`). It uses Float32 constants `0.0625`, `-0.001` and reciprocal `0.14492753148078918` to form horizon, then stores horizon Float32 (`0x4b16bd`). Thus the mathematical `/1000` and `/6.9` notation above does not imply double arithmetic. It stores each updated cumulative distance Float32 (`0x4b179b`) before zero clamp and braking comparison. The latter multiplies by Float32 6.9 (`0x4b1801`).

The smallest coherent implementation sequence is verified metadata/storage/nearest selection, exact straight grouping, complete corner/SOC reconstruction, then objective-specific route transitions and live native curvature/speed output into the existing force controller. Path acquisition, struggle/recovery and pursuit remain separate objective behavior boundaries. The installed end-of-path result 1 return at `0x4b0e13` belongs to the cheaty-following branch. The normal physical-following branch does not implement generic endpoint-arrival completion; it returns OK, advances through corner state, and can give up/restart through its struggle state. An added physical arrival-distance rule would be a browser behavior change, not verified C2 behavior.

## Physical follower state and ordering

The following is verified from installed HW `ProcessFollowPath`, not merely rec2's reconstructed local-variable names. Follow data includes struggle start `+0xbc`, last struggle finish `+0xc0`, escape timer `+0xc4`, borrowed-time start `+0xc8`, acceleration/error histories `+0xcc/+0xd0`, desired speed `+0xd4`, current/first/last-struggle sections `+0xe8/+0xea/+0xec`, packed flags `+0xf0`, escape flip `+0xf4`, corner center `+0xfc/+0x100`, radius/reach/width `+0x104/+0x108/+0x10c` and corner section `+0x110`. Packed flags contain an eight-bit struggle count and bits 8/9/10/11/12 for moved-on-task/made-it/cheating/cornering/left.

Start (`0x4b0e6b–0x4b0f55`) copies GetFirstSection into current and first sections, clears moved-on-task, struggle timer, acceleration/error histories, cheating and cornering; sets last-struggle-finish and borrowed start to now, last-struggle-section to -1 and made-it true. It does **not** clear desired speed, escape timer/flip or struggle count. If the opponent is neither cheating nor already physical (opponent flags `+0xb0 & 0x28`), it invokes rematerialisation with current model-velocity magnitude. Start returns OK without running normal geometry/PID.

Desired speed initially zero is supported by original PE storage, rather than an inferred reset: opponent array `0x75adc0` lies in the zero-fill tail of `.data` (VA `0x58e000`, virtual size `0x210d64`, raw size `0xe7200`; array offset `0x1ccdc0`). Installed InitOpponents `0x4adaf0`, whose opponent initialization loop is `0x4adc53–0x4ade76`, also leaves desired speed untouched. Preserve it across follow starts and reused race slots; zero belongs to first process instantiation.

Normal physical runs execute in this order:

1. Check borrowed time before changing forces (`0x4af785–0x4af988`). Unless ignore-end is enabled, when made-it is false and `now > borrowed+1000` but `now < borrowed+10000`, test distance to the infinite 3D current-section line. Projection is not clamped to its endpoints. Distance at most section width sets made-it true. Strictly after `borrowed+10000`, still-false made-it returns given-up (2) without zeroing forces.
2. Set the car acceleration key and compute full 3D metric speed. Load model velocity Float32, sum squares without intermediate length storage, take the live square root, multiply by double 6.9, then store speed Float32 (`0x4af9a2–0x4af9db`). The moved flags compare the live pre-store result strictly above Float32 0.2.
3. Process an existing struggle, or start a new struggle under the conditions below. An existing struggle can return before geometry/PID. A newly started one continues geometry/PID this frame.
4. Obtain current straight, construct/update corner state and constraints, compute lane/heading errors, and request curvature. Horizontal metric velocity components are stored Float32; horizontal speed stores the square root of each live scaled component times its stored component (`0x4afe07–0x4afe29`). Steering/SOC use this stored horizontal speed, whereas the force controller uses the earlier stored **3D** speed.
5. Run damage/category acceleration control and store the approached curvature. Normal physical following returns OK (0).

Borrowed recovery stores all three line-component differences Float32 (`0x4af7ed/0x4af815/0x4af843`), relative X/Y Float32 (`0x4af860/0x4af87e`) while relative Z remains live, and final perpendicular distance Float32 (`0x4af91a`) before the inclusive width comparison. The retry geometry is disabled by ignore-end; the later ten-second failure check is independent of ignore-end (`0x4af93f–0x4af976`). The final distance store can change a boundary result: on the Z-axis line, position `(1,float32(0.0001),5)` and width 1 produces stored distance 1 and succeeds, whereas an unrounded double comparison would fail.

With no active corner, calculate corners and constraints using nearest-in-straight solely as the SOC starting section. Entry requires `dtMs*horizontalSpeed*float32(0.0005) > float32(6.9)*(distanceToStraightFinish-firstReach)` (`0x4b10b9–0x4b10e5`). Entry copies first center/radius/reach/handedness/section and its authored width, and sets cornering; it neither initializes desired speed nor runs SOC braking that frame. Otherwise initialize desired speed to 80 and apply SOC braking.

While cornering, distance squared strictly greater than stored reach squared exits (`0x4afe33–0x4afe9a`): clear cornering, copy corner section to current section, and recompute straight for a projected section. Exit also retains desired speed and skips SOC braking that frame. At equality or below, reconstruct corners, build constraints starting at the first corner's section, initialize desired speed to min(80, first corner integer speed), and apply SOC braking. Native distance component differences are stored Float32 before the entry/exit square operations (`0x4afe1b/0x4afe1f`). All branches then continue into lane steering, which can itself reduce or replace desired speed.

### Outside-lane state and mixed stores

At `abs(error)>1`, set desired speed 6 and requested curvature zero. Only horizontal speed strictly below 12 evaluates escape geometry (`0x4b011d–0x4b02ef`); at or above 12, preserve timer/flip. In native horizontal `(worldZ,worldX)` coordinates, form `d=finish-start`, `r=position-start`, and project `t=dot(d,r)/dot(d,d)`. Clamp to the segment, then let delta be r minus this projected offset. Request `-cross(metricVelocity,delta)/(speed*length(delta))*speedLimitedMaxCurve`; if speed or delta length is zero, retain the unnormalized cross product instead.

Storage is deliberately mixed: d.y is Float32 (`0x4b016c`) while d.x remains live; both r components are Float32 (`0x4b0172/0x4b0180`). Store t Float32 (`0x4b019c`), but its lower-bound test uses live t; the upper-bound test uses stored t. Projected components and delta.x remain live. Delta.y stores Float32 (`0x4b01fc`), and delta length is `float32(sqrt(delta.x²+liveDelta.y*storedDelta.y))` (`0x4b0223`). The cross and moving-away dot use live delta.x and stored delta.y. Use the previously computed stored horizontal speed, rather than recomputing a differently rounded length from its stored vector.

Only when `dot(delta,metricVelocity)>0` does the escape state act. If timer is zero, set timer=now and flip=false. Otherwise, strictly after 5000 ms reset timer=now and toggle flip. Apply the sign reversal only inside this moving-away branch. Approaching while outside preserves timer and flip without applying it; returning inside resets timer alone. A guard for a zero-length authored segment is a browser bounds extension: native divides by its squared length.

### Struggle timing and failure

A new struggle requires not-never-struggle, stored 3D speed at most Float32 0.2 (or Float32 `2/30` when ignore-end is true), `now > lastFinished+2000`, and pursuit or moved-on-task (`0x4afc6e–0x4afd99`). Set struggle start=now before inspecting count. Ignore-end or a different current section sets last-struggle-section=current and count=0. Otherwise count at least three zeros both forces and returns given-up (2); lower count increments. Do not reverse on this initialization frame.

For an existing struggle, let `N=zeroExtendedUint32(750*count-750)`. The installed code builds N in integer registers and loads a zero-high-word QWORD (`0x4afa33–0x4afa5b`): count zero means 4294966546, **not** signed -750. This differs materially from rec2's simple floating expression. Stop only when `now > N + signed32(struggleStart+2750) + 30*mass`; the start term uses FIADD DWORD (`0x4afa75`). Otherwise brake only when `now > N + zeroExtendedUint32(struggleStart+2000) + 15*mass` (`0x4afae4–0x4afb14`). Before that threshold write accForce=Float32(-6*mass), brakeForce=0; after it write accForce=0, brakeForce=Float32(15*mass). Slew curvature towards zero and return OK before PID, preserving its histories.

On stop, clear made-it, set borrowed start=now, clear struggle timer, set lastFinished=now and zero both forces (`0x4afaa3–0x4afadf`), then continue ordinary geometry/PID the same frame. In normal short sessions a count-zero struggle's unsigned N prevents these stop/brake thresholds from being reached; an external objective/cheating transition may still end it. Replacing this with an intuitive three-second reverse would not match this C2 binary.

### Direct-force Float32 boundaries

Installed `0x4b03bd–0x4b0525` uses Float32 category factor, desired speed, damage constants and mass. Capacity starts at max(factor,1), loses `(engineDamage-50)*float32(0.0125)` for 51–97 or Float32 0.6 for 98, and `(transmissionDamage-50)*float32(0.00625)` for 51–97 or Float32 0.3 for 98; either damage at least 99 sets capacity zero. Multiply by 12 and store maximum acceleration Float32 (`0x4b049e`). Error is the live desired*factor minus stored 3D speed. Store error Float32 (`0x4b048c`) but retain its live value for derivative subtraction. Candidate acceleration is `((liveError-previousError)*1000/dtMs)\*float32(0.1) + storedError + previousAcceleration`, in that addition order; contracting the derivative coefficient to 100 loses the original constant/storage semantics. Clamp against stored maximum, save acceleration/error histories Float32 (`0x4b04f0/0x4b04f6`), and multiply the live clamped acceleration by mass before storing force Float32 (`0x4b050f/0x4b051f`).

## Objective and cheating interruptions of physical struggles

A count-zero struggle is not evidence for adding an invented short unstuck timeout. Two verified outer transitions can interrupt it before its unsigned internal threshold:

- Installed `ProcessThisOpponent` is `0x4aa310` (rec2 annotation `0x4aa570`). Unless map view equals 2 and show-opponents is enabled, it enables cheating strictly when `now > uint32(lastInView+3000)` (`0x4aa32f–0x4aa34c`). Equality/within the interval disables existing cheating (`0x4aa53d–0x4aa56c`). For regular opponents, entering cheating sets opponent flag bit `0x20`; it does not switch their physics off. The next follower call detects the mode transition before its physical struggle branch and executes cheaty following. Cop physics switching is a separate branch; installed C2's normal cop loader is a no-op.
- The same outer function forces objective selection when new-objective flag bit 0 is set **or** `now > objectiveDeadline` (`0x4aa5d8–0x4aa5f9`). The deadline condition is missing from rec2's ProcessThisOpponent reconstruction. Comparison is unsigned JA, with equality retaining the existing objective; additions wrap Uint32 and there is no modular elapsed-time comparator here. NewObjective sets a 20–60-second deadline for ordinary objectives. Thus even nearby regular complete-race opponents periodically restart/change objectives and reset follower struggle state, subject to the selector's frozen/knackered early returns.

The misleading `lastInView` field is refreshed by actor-origin proximity rather than renderer visibility. Installed `CalcOpponentConspicuousnessWithAViewToCheatingLikeFuck`, `0x4a92f0`, computes 3D opponent/player displacement and stores player distance; when its live length is strictly below `gIn_view_distance`, it stores now at opponent `+0x68` (`0x4a9366–0x4a937f`). InitOpponents sets this distance to `max(cameraYon+10,45)` model units (`0x4adbe4–0x4adc18`). Player line-of-sight acquisition for pursuit is a different mechanism.

The standalone `src/ai/proximity.ts` now ports these proximity/mode predicates. An independent installed-code audit confirms Float32 actor coordinates, stored X/Y differences before squaring, live Z difference squared before its store, and a live square-root comparison against the stored threshold (`0x4a92f9–0x4a937f`). The public distance is Float32, but comparing that rounded distance would misclassify a narrow boundary: numerical tests cover live distances on both sides of 45 whose stored distance equals 45. The helper also preserves the unsigned wrapped deadline and map suppression. Live cheating traversal/rematerialisation is still pending.

### NewObjective and forced selection

Installed NewObjective is `0x4aab10`; rec2's annotation is `0x4aad70`. It calls the old objective's die command if old type is nonzero, stores new type at `+4`, start time at `+0x70`, and `deadline=uint32(now+IRandomBetween(20,60)*1000)` at `+0x74`. Pursuit adds 90000 modulo Uint32 (`0x4aab35–0x4aab66`). It updates objective population counters, stores the pursuit target at `+0x114` for type 2, and calls the new start command. Choosing the same type still performs die/start and consumes deadline RNG; it is not an idempotent setter.

Verified objective values relevant here are none 0, complete race 1, pursue-and-hit 2, run away 3, get near player 4, levitate 5, knackered/freewheel 6, frozen 7, wait 8 and return to start 9. `ChooseNewObjective` installed `0x4acc10` runs before the current objective's normal run. It first handles knackered status, periodic fallen-off-world recovery (strict next-check expiry, reset now+500, then teleport/GetNear), and freeze/thaw, so these override forced ordinary selection.

For a regular opponent when forced choice reaches its final branch (`0x4ad4da–0x4ad69a`):

1. If it has ever moved (opponent bit `0x100`), personality `+0xb4` equal to 1 selects CompleteRace, 2 selects GetNearPlayer, and 3 selects PursuePlayer. Otherwise choose GetNearPlayer with percentage `trunc(storedPlayerDistance)-15`, else CompleteRace. Both outcomes call NewObjective, including an unchanged type.
2. If it has not moved, pursue-from-start bit `0x10` selects PursuePlayer and raises grudge to `trunc(min(100,max(grudge,20)+20+40*nastiness))`; otherwise select CompleteRace. Pursue-from-start is cleared for normal racers at initialization and set for the challenger if present, rather than inferred from model strength.

InitOpponents sets grudge 10 and stores nastiness Float32 as `(authoredRaceNastiness - ((opponentStrength-1)*(-.25) + skill*(-.5))) * double(1/3) * gOpponent_nastyness_frigger` (`0x4addab–0x4addf3`). The negative double coefficients are subtracted, giving positive contributions. The destination is opponent **+0x0c**: ESI points to opponent+0x5c, and the final instruction writes `[esi-0x50]`. The signed strength decrement occurs before integer-to-floating conversion. Race and global multiplier are Float32 inputs; only the final opponent value is stored Float32.

The independently verified personality loop (`0x4adf79–0x4ae0ea`) clears regular instance slots. Race nastiness at least Float32 10 assigns type 3 to every slot without RNG. Otherwise it assigns type 2 to `trunc(double(.6)*N)` instances, then type 1 to `trunc(double(.2)*N)` instances. Each quota draws an inclusive integer: type-2 draw i uses `[0,N-1-i]`, type-1 draw i uses `[0,N-quota2-1-i]`. Starting at that raw instance slot, scan forward over occupied slots and wrap at N. This is not uniform rank selection among free slots; duplicate catalog IDs remain separate instances. Constants at `0x5895d8/e0` are doubles .6/.2. `src/ai/personality.ts` preserves this ordering and consumes one 15-bit draw per assignment.

Installed LoadRaces (`0x48c4c9–0x48c4ff`) reads scalar nastiness and replaces authored values **at or below 2^-22**, including small positive values. Interpolation is `first + (last-first)*(raceIndex/(raceCount-1))`, using Float32 endpoint inputs and a final Float32 store. The scalar parser previously truncated fractions; it now preserves them. The resolver declines a single-race denominator-zero interpolation rather than propagating native NaN. Runtime opponent decisions still need to consume these recovered personality/nastiness fields.

Pursuit can also preempt this final forced-choice branch after the first frame: fresh player sighting, collision/grudge, or scary-bang conditions run first. For regular fresh sighting, if pursuing population is below skill+3, chance is `trunc(grudge-20+30*nastiness)`, else zero; a verified head-on test adds 50 before the percentage call (`0x4ad2eb–0x4ad42e`). Selection raises grudge by the general increment `trunc(40*nastiness+10)` with min/max 20/100 and starts pursuit. The complete pursuit/get-near routing, visibility geometry and cheating/rematerialisation consumer remain separate unresolved objective scope; a forced-choice scaffold does not constitute their implementation.

### Visibility and objective lifecycle adapters

`src/ai/visibility.ts` independently implements installed regular visibility
`0x4ad880`: only a strict expired deadline clears in-view and draws the next
4000–4900 ms check before testing stored distance <50. The ray starts at player
origin plus Float32 .15 in Y, and its direction uses rival minus player with
another .15 Y bias. Stored fraction >1 sets in-view and clears acknowledgment;
fraction 1 is blocked. An unsuccessful check preserves acknowledgment.

Head-on classifier `0x4ad338–0x4ad423` retains live position differences,
normalization and dot products. Length at most 2^-22 chooses (1,0,0).
Rival dot order is (Y+X)+Z, player order (X+Y)+Z, with strict opposing tests
against Float32(cos(double .5235668420791626)), or .866041362285614.
Tests distinguish this value from the trail's different cosine, normalized
Float32 rounding from live comparison, and timer/distance/fraction boundaries.

`src/ai/objective-lifecycle.ts` implements the installed outer order, with
callbacks for engine-owned mode, repair and objective dispatch. NewObjective
does old DIE, stores new type/start, draws/stores deadline, then writes the
pursuit target and increments the new category before synchronous START.
Non-pursuit transitions preserve the stale target. It does not decrement the
old category. ObjectiveComplete sets new-required and decrements the current
category. MungeOpponents recounts unfinished regular rivals each frame
(`0x4a9f3a–0x4a9f96`), so signed within-frame counter drift is intentional.

ProcessThisOpponent runs mode change, repair and selector even while stopped
or stunned. After synchronous selection it clears new-required, applies
Float32(10\*stored mass) braking for countdown or race finish, then runs only
if unfinished, movement enabled, race unfinished and now strictly after stun.
Countdown alone does not suppress RUN. Cheating cached-position copy is last.
These adapters and their tests do not yet replace live RoadNavigator; world
rays, impact flags, shared target/trail caches and physical-mode side effects
still require runtime binding.

### Run-away objective

The independently implemented `src/ai/run-away-state.ts` follows installed
objective3 dispatch `0x4aa80a`. START draws its own inclusive30–90-second stop
deadline after NewObjective has drawn the ordinary objective deadline; clears
the shared projected route; finds the nearest authored section; and seeds
direction0 only when the live (Z+X)+Y dot of stored cached car direction and
stored section direction is negative. Zero selects1. Random top-up fills12,
then shared Follow START runs with all three options false (`0x4aa908–0x4aa9b0`).

RUN at stop-deadline equality still follows. Strict expiry calls
ObjectiveComplete before route shifting, refill or following. Positive consumed
prefixes shift and reset the cursor unconditionally; unlike CompleteRace,
count11 refills. Follower result2 reseeds/top-ups/restarts without redrawing the
stop deadline or NewObjective. Result1 alone does not complete RunAway. DIE is
a no-op. Tests cover RNG order, stored direction sign boundaries, shared cursor
and refill, deadline equality, preserved forces/deadlines and bounds errors.

### Installed RNG semantics

`IRandomBetween`, installed `0x512f00`, consumes one 15-bit CRT random result r and returns `A+trunc(r*(B-A+1)/32768)` for the nonnegative ranges used here. Deadline range 20–60 is inclusive, and equal endpoints still consume RNG. NewObjective always makes this call. `PercentageChance`, installed `0x512f30`, returns false without consuming RNG only when p equals zero. Otherwise it consumes r and compares `floor(r*100/32768) < p` as signed integers. Its draw range is 0–99, unlike rec2's `IRandomBetween(0,100)` reconstruction. Negative p still consumes and returns false; p at least 100 still consumes and returns true. Browser random callbacks can map r as `floor(random()*32768)` for finite random values in [0,1).

## GetNearPlayer acquisition and bounded route search

`ProcessGetNearPlayer` is installed `0x4ac630`; rec2 maps it as a stub at `0x4ac890`. The newcommon symbol list supplies names for `NewCalcGetNearPlayerRoute` (`0x4ac780`) and `SearchForSection` (`0x4abf20`), but no implementation. The following findings come from independently inspecting the installed instructions.

Start invokes route acquisition towards the current player with force=1, then follower start with pursuit/ignore-end/never-struggle all zero (`0x4ac73e–0x4ac76d`). It does not explicitly clear the existing projected route. Run first shifts any consumed virtual prefix when follow section is greater than 20000 and resets current section to 20000. At projected count at most ten, invoke acquisition force=0, then follower run with all flags zero. Follower result 2 immediately starts PursuePlayer; result 1 reacquires with force=1 and restarts the follower; result 0 simply returns (`0x4ac68f–0x4ac772`). No distance-to-player arrival completion was found in this objective. The cop-only run branch checks its distance-from-start field strictly above 75 and switches to ReturnToStart; it is outside the regular-opponent population scope.

### Target cache and seeding

Acquisition immediately returns when projected count is at least twelve. The target car owns nearest-section cache signed16 `+0x155c` and next refresh Uint32 `+0x1540`. Refresh when cached section is negative or `now > deadline`; equality retains cache. Refresh deadline is `uint32(now+1000+IRandomBetween(-100,100))`, consuming one 15-bit draw, then use FindNearestGeneralSection with NULL car and target actor origin (`0x4ac7a4–0x4ac801`). A negative result invokes the native fatal-error path. Opponent signed16 `+0x78` records the target section used by the last acquisition.

An empty projected route forces reseeding. Otherwise force=0 with unchanged target section skips the own-nearest/reseed branch and proceeds to extension. Forced acquisition or a changed target section queries the opponent's nearest authored section/intersection (`0x4ac845–0x4ac864`). Fresh seeding uses that section and direction 1 when `dot(intersection-opponentActorPosition,actorMatrixRow2)>=0`, otherwise 0 (`0x4ac9f3–0x4aca55`). It does not use the returned normalized path direction or cached travel direction for this choice.

The installed reuse/reseed branch contains verified quirks which must not be silently replaced by a conventional route lookup:

- At `0x4ac894` the loop compares own nearest-section ID with zero, and `0x4ac897` stores that ID into the route entry. For a nonzero ID with a nonempty route it therefore selects slot zero immediately, retaining the old direction; for ID zero it overwrites all valid entry IDs before taking fresh-seed handling. This is an actual store, not a disassembler rendering of a comparison.
- Its initial lookahead endpoint lookup indexes the global section array using the selected **slot**, rather than that entry's section ID (`0x4ac917–0x4ac928`).
- After appending a successful search result, the target comparison reads the entry at new count, i.e. the next unused/stale slot (`0x4acb16–0x4acb25`), rather than count-1. Persistent twelve-entry backing storage matters for exact emulation; a compact valid-entry list cannot reproduce a stale-slot decision without retaining that storage explicitly.

There is no capacity guard before that target read. When the capped append makes count twelve, the address is opponent `+0xb0`, the adjacent flags word; it compares its low signed16 bits with target section. The later capacity guard is `0x4acb9f–0x4acba2`. A matching flags value can still consume the strength-below-5 detour-request RNG 1..2 before TopUp notices the full route. Emulating this safely requires the caller's packed flag word, rather than inventing a thirteenth zero route slot.

The positive lookahead distance is `(100-modelVelocityLengthSquared)*float32(-0.0625)*double(0.14492753623188406)` (`0x4ac8b7–0x4ac905`), equivalent to `(modelVelocityLengthSquared-100)/16/6.9`. It advances selected projected entries by subtracting the first endpoint distance and subsequent authored section lengths, then shifts the retained suffix. Initial distance is from the opponent's nearest intersection to the selected endpoint, rather than from its actor position. The quoted slot/global-index quirk affects that first endpoint. An independent installed-code audit now resolves its stores: model-velocity components load Float32, the square sum and lookahead remain live (`0x4ac8b7–0x4ac905`); the first endpoint distance uses live X/Y differences multiplied by their Float32 stored copies and live Z squared (`0x4ac93a–0x4ac975`). Subsequent lengths load the stored authored Float32 values; the remaining-distance subtraction stays live. Tests cover both retaining slot zero through the global-slot quirk and consuming multiple lengths to retain a later reversed suffix.

### SearchForSection ordered specification

This is bounded depth-first search with authored incident order, rather than breadth-first search or full shortest-path optimization. Work/output entries are four bytes, signed16 section plus direction byte. Initialize work[0] from the last existing projected entry, output count zero, depth 1 and accumulated distance zero. At each top-level search, clear the per-node visited bitset, initialize best distance to Float32 FLT_MAX and improving-result count zero (`0x4abf4f–0x4abfae`). The seed section's length is excluded from cost, and seed itself is not tested as a target.

1. If depth is at least ten, return false. Otherwise resolve the finish node of work[depth-1], mark that node visited once before its incident loop, and visit its authored first-eight section list in order.
2. Candidate direction is 1 when current node differs from candidate.node1, otherwise 0. Compute candidate finish node from this direction. Reject already visited finish nodes, backward traversal of one-way sections (`currentNode==node1`), and type 2 while opponent cheating flag is false (`0x4ac0a4–0x4ac155`). There is no separate previous-section rejection; an initial bidirectional reversal is allowed because the seed's start node has not been marked. A self-loop selects direction 0 and is rejected by the current-node visited mark.
3. Store candidate at work[depth]. New cost is Float32 of previous stored cost plus candidate's stored authored 3D length (`0x4ac176–0x4ac193`). When candidate section equals target and new cost is strictly below best, copy work[0..depth] to output, set output count=depth+1 and best=new cost, and increment improving-result count.
4. On the **second** improving result, return true immediately without clearing this node's visited mark (`0x4ac240–0x4ac276`); ancestors propagate true without clearing theirs. On the first improvement, clear this node's mark and return false immediately (`0x4ac279–0x4ac2c4`); do not continue this node's remaining incidents. Its caller resumes that caller's siblings.
5. Otherwise recurse only when depth<9, with depth+1 and the new stored cost. This includes a target candidate which did not improve best. A true child result propagates immediately; after ordinary incident exhaustion clear this node's mark and return false. Thus a retained result contains at most ten entries including seed. Success-path residual marks are erased by the next top-level initialization.

There is no RNG in SearchForSection. It can stop before finding the globally shortest route. Section length derivation is verified separately in LoadInOppoPaths: each node1-node0 component stores Float32 (`0x4a9698/0x4a96b3/0x4a96ce`), square/sum/square-root those stored components, then store length Float32 at section `+0xc` (`0x4a96f0`). This is raw 3D model distance, without world/metric scaling.

Acquisition appends returned entries excluding seed, limited by remaining twelve-entry capacity (`0x4acae6–0x4acb13`). It may search again from the new last entry while capacity remains. If search returns no extension (output count at most one), top up random route by four sections for strength below 5 or two for strength at least 5, and stop further search that call (`0x4acb5d–0x4acb97`). A successful append whose next-unused-slot target comparison happens to match target tops up one or two random sections for strength below 5 (one inclusive 1..2 RNG), or one for strength at least 5. Those top-ups reuse native directed/type filtering and their own candidate RNG. Acquisition finally records target section at opponent `+0x78`.

These primitives are sufficient to specify the ordinary fresh-seed/search path independently. The standalone `src/ai/target-acquisition.ts` now composes cache refresh, reseeding, bounded DFS, explicit packed-flags reads, detours and fallback with numerical tests. Fresh-seed dot uses live displacement differences and `(dx*row2.x + dz*row2.z) + dy*row2.y`, verified at `0x4ac9f3–0x4aca55`; a cancellation fixture distinguishes this from generic Vector3.dot. ACT row2 is the world backward row of the master actor, not a COM or local-velocity direction. Live objective integration and cheaty/pursuit consumers remain explicit implementation boundaries; replacing them with undirected shortest routing would not complete native parity.

Implementation checkpoint: `src/ai/target-search.ts` ports the bounded authored-order DFS, with strict Float32 costs, early returns and resetting of residual visited marks. Numerical tests cover the second-improvement stop, depth capacity, seed reversal, incidence limits, one-way/type restrictions and ties; optional local-installation tests validate connected directed results on Stock Newcity1 and Advanced AcidReign. `NativeProjectedRoute` now retains all twelve native backing records when cleared or shifted. These components are not yet the live opponent dispatcher.

`src/ai/get-near-state.ts` now composes regular physical GetNear start/run/result handling over the caller-shared route, follower and acquisition records. Factor-zero calls preserve route/cache state; external cursor advancement is synchronized before prefix shifting. A native result2 requests pursuit; explicit result1 notification forces acquisition/restart, including when reported by an external cheaty follower. No geometric physical-arrival heuristic is added. Seven numerical scenarios cover this coordination.

Nonphysical movement, its strict endpoint comparisons and Float32 stores are ported separately in `src/ai/cheaty-path.ts`; mode switching and materialisation still belong to the pending live dispatcher. See [cheaty movement evidence](c2-ai-cheating-re.md) and [pursuit/trail evidence](c2-ai-pursuit-re.md). Direct pursuit prediction and ordered reverse/brake deadlines now have standalone numerical tests in `src/ai/pursuit-motion.ts`, including preserved curvature and deadlines straddling Uint32 wrap. These additions do not yet replace live RoadNavigator or establish AI-01/AI-02 completion.

### Complete-race physical coordination status

`src/ai/complete-race-state.ts` composes a caller-owned shared race-route backing
and physical follower. Tests exercise native three-false follow options,
prefix shifting/refill, freeze without route advancement, persistent ever-moved,
borrowed give-up preserving forces, struggle give-up clearing them, local
restart and synchronous GetNear/ObjectiveComplete hook mutation. Explicit
native result1 is supplied externally; no physical-arrival heuristic is added.
An empty route requires an explicit unsigned raw status, preserving the
installed undefined-local boundary instead of asserting an invented constant.
DIE is a no-op. The outer native objective/mode adapter still must connect this
coordinator to live cars; the existing RoadNavigator has not been declared
source-faithful or replaced merely by adding this component.

### Regular-rival decision priority

Installed `ChooseNewObjective4acc10` now has an independent state adapter in
`src/ai/decision.ts`. Ordered branches are detected freewheel/knackered,
strict500ms out-of-world check, new knackered/stolen transition, thaw/freeze,
scary bang,20s RunAway suppression of later reactions, big-bang hitter,
player we hit, raised grudge, fresh sighting, then forced selection. First-frame
suppresses reactive branches only. Freeze saves **current pursuit AND target
is current player**, correcting rec2's OR. The scary probability is
trunc((pursue?100:60)−50\*nastiness), only when distance<10 and strength<5.

General grudge increment is trunc(10+40*nastiness); hit/sighting updates cap
max(20,grudge)+increment at100 then store unsigned byte. Raised-grudge handling
requires grudge>20 and uses grudge+increment without the minimum20. Last-hitter
and last-we-hit predicates require nonnull local-human driver8 and avoid an
identical existing pursuit target. The latter selects current player, whereas
big-bang selects the actual hitter. During an existing pursuit of current player,
grudge/sighting branches are skipped. Sighting acknowledges before probability;
population<skill+3 grants trunc(grudge−20+30*nastiness), otherwise0. The head-on
bonus adds50 independently of that population gate. A failed probability falls
through rather than clearing acknowledgement.

`0x575190` performs FISTP QWORD and returns its low DWORD, not an Int32 saturating
cast. Signed64 invalid conversion has low DWORD0. The adapter retains exact
Float32-times-integer products and offsets until conversion (including low bits
lost by ordinary JavaScript doubles at large finite inputs). Forced distance
fallback at `0x4ad550–0x4ad55f` likewise converts the stored distance, then
subtracts15 with signed32 wrap. Boundary tests cover2^31,2^32 and signed64
limits, byte grudge, strict/wrapped deadlines and RNG consumption.

The adapter returns transition requests; synchronous old-DIE/new-START,
objective deadline RNG, population accounting, real impact flags, cached
head-on directions, visibility, repair and physical/nonphysical movement remain
outer-runtime responsibilities. It does not manufacture those observations or
claim to replace the live RoadNavigator yet. The installed special car+0x80
flag0x300 objective9 branch is outside this regular-rival adapter's scope.
