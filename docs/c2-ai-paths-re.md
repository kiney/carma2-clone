# C2 opponent path evidence

Scope: native section metadata, projected routes, nearest-section selection and physical path following. The installed local `carma2_HW.exe` is the specification; `madebr/rec2` supplies symbols and structure names. The executable's provenance and hashes are recorded in the existing reverse-engineering notes. No executable or original asset was modified.

## Status and addresses

The current `RoadNavigator` is a temporary undirected graph and steering heuristic. Metadata parsing and pure projected-route helpers do not complete AI-02: native straight grouping, corner construction, speed-obstruction constraints and objective-specific transitions must reach the live controller.

Installed addresses below differ from several rec2 annotations:

| Function | Installed HW | Evidence |
| --- | --- | --- |
| FindNearestGeneralSection | `0x4a8070` | Binary verified, including inlined weighted selection |
| TopUpRandomRoute | `0x4a9160` | Binary verified; rec2 stub |
| CalcRaceRoute | `0x4aabc0` | Binary verified; reconstructed rec2 has reverse-direction error |
| Shift / Add projected route | `0x4aaea0` / `0x4aaef0` | Standalone binary boolean returns and capacity verified |
| GetNextSection | `0x4ae7d0` | Binary verified, including suspicious section-type indexing |
| GetSectionStart / Finish | `0x4ae930` / `0x4ae9e0` | Binary verified |
| GetSectionWidth | `0x4aea80` | Binary verified |
| GetSectionMin / MaxSpeed | `0x4aeaf0` / `0x4aeb90` | Binary verified |
| ProcessFollowPath | `0x4af700` | Binary verified selected steering and force branches |
| GetStraight | `0x4b1170` | Binary verified; rec2 stub |
| CalcCorners | `0x4b1300` | Binary equations, iteration and Float32 stores verified; rec2 stub |
| SetMaxSpeedFromSOCs | `0x4b1650` | Binary traversal/braking equations verified; rec2 stub |
| CalcSOCs | `0x4b1850` | Binary constraint traversal and speed caps verified; rec2 stub |

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
- Empty route or follow result 1 (end) requests the get-near-player objective. Result 2 rebuilds/restarts. Result 0 (OK) returns without completing the objective (`0x4aa74d–0x4aa74f`), correcting rec2's misleading default `ObjectiveComplete` branch.

Run-away initialization differs: choose the nearest section and seed direction 0 when the cached vehicle travel direction dotted with the section direction is negative, otherwise 1, then random-top-up to capacity. There is no universal route initialization rule independent of the native objective.

`GetNextSection` returns -1 at the end of the projected route. Its non-cheating type-2 check indexes global section metadata using the next projected *slot*, rather than the entry's actual section ID (`0x4ae7f1–0x4ae802`); both installed code and rec2 expose this suspicious indexing. The route-count guard precedes this type check, and cheating skips it. Any intentional browser correction must be documented instead of presented as native behavior.

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

| Backward incoming A | Outgoing B | Stored reach | Stored radius | Stored center |
| --- | --- | --- | --- | --- |
| (-31,3) | (11,29) | 3.6443369388580322 | 4.770451545715332 | (-3.1678807735443115,5.099306583404541) |
| (-40,3) | (11,35) | 3.5889830589294434 | 4.524764537811279 | (-3.2405245304107666,4.780511856079102) |

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

Installed `0x4b03bd–0x4b0525` uses Float32 category factor, desired speed, damage constants and mass. Capacity starts at max(factor,1), loses `(engineDamage-50)*float32(0.0125)` for 51–97 or Float32 0.6 for 98, and `(transmissionDamage-50)*float32(0.00625)` for 51–97 or Float32 0.3 for 98; either damage at least 99 sets capacity zero. Multiply by 12 and store maximum acceleration Float32 (`0x4b049e`). Error is the live desired*factor minus stored 3D speed. Store error Float32 (`0x4b048c`) but retain its live value for derivative subtraction. Candidate acceleration is `previousAcceleration + storedError + ((liveError-previousError)*float32(1000)/dtMs)*float32(0.1)`; contracting the derivative coefficient to 100 loses the original constant/storage semantics. Clamp against stored maximum, save acceleration/error histories Float32 (`0x4b04f0/0x4b04f6`), and multiply the live clamped acceleration by mass before storing force Float32 (`0x4b050f/0x4b051f`).
