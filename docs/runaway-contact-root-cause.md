# Runaway collision energy: reproduced cause and native solver comparison

## Conclusions (2026-10-29)

There is now a small, redistributable reproduction of a causal mechanism for
extreme crash energy. It uses one generated box and one nearly horizontal
triangle, ordinary initial motion, and production contact generation. Neither
a complex track nor damaged/proprietary geometry is necessary.

Two individually benign contact packets become destructive when combined:
native full-tick chord contacts and the browser's additional angular guard can
describe different portions of one curved trajectory. They are merged as
simultaneous constraints at OLD coordinates. Near-dependent opposing rows then
receive positive velocity demands. Our regularized Gaussian solver returns
enormous multipliers without checking active physical residuals or reporting
numerical failure.

The original HW numerical routine, executed in an isolated bounded oracle,
does **not** return those enormous multipliers for the same packet. It removes
dependent rows repeatedly and returns failure status `-1` with a small partial
result. This establishes a numerical compatibility gap as well as a contact
admission problem. It does not reconstruct FAIR's unrecorded first impact.

The research checkpoint changed no production physics. The subsequent
test-driven correction is described below; passing the numerical oracle alone
does not establish that every historical playtest stall has the same cause.

## Test-driven engine correction

The regression contract was reviewed, run red and frozen in `f76c807` before
engine edits: 14 tests, 10 passing and four expected failures. The unchanged
contract now passes. See [the frozen hashes and results](perf24-tdd.md).

- `world-contact-admission.ts` admits sampled encounters chronologically before
  separating normal directions. Nearby opposed events on one finite plane
  patch cannot represent simultaneous support at the same OLD feature. The
  sampled path takes precedence over a conflicting full-tick chord locally;
  chord/sample fractions are deliberately never compared as equivalent times.
  Independent walls, perpendicular floor/wall constraints and opposed contacts
  at separated levers remain. This is a **native-informed browser adaptation**,
  using the native reducer's `.0045` squared-distance rule with authored
  feature/plane provenance, not verified original temporal-manifold behavior.
- The full coherent sampled encounter set remains available for chord rejection
  even when response reduction removes a redundant row. Independent review
  caught and verified overlapping-hull and nearby-parallel-plane cases where
  using only reduced response rows would reintroduce the contradiction.
  Final safe-prefix commitment still considers **all** trajectory crossings.
- `normal-solver.ts` replaces diagonal regularization and unchecked projected
  fallback with an independently expressed Givens RQ active-set solve. It uses
  the verified native dependence ratio `100000`, unilateral activation and
  negative-multiplier thresholds, protected signed rows, finite partial output
  and explicit numerical failure. Active physical residuals are checked before
  impulses are admitted. Matrix/RHS coefficients, including the original
  unsigned impact bias, are unchanged.
- Numerical failures now reach the existing local response owner's separate
  three-report budget. They are distinct from geometry callback rejection and
  the ordinary successful-response limit. A finite accepted partial result is
  still processed, matching the inspected native caller's behavior.

Solver deviations are explicit: double precision; full factor rebuilds;
independent negative-row selection with visited-set preference; a bounded
50-transition path instead of reproducing native conditional continuation;
and failure for an unsolvable protected block. Exactly identical unilateral
rows **and columns** with exactly equal demands are aggregated and their total
load distributed uniformly. This preserves the browser's previous symmetric
loading without compliance or tiny artificial impulses; signed rows and
unequal demands stay distinct. It is a compatibility adaptation, not a claim
about native impulse distribution between redundant rows.

There is no new speed, angular-velocity, energy or damage cap, and no
car/track-specific branch. The raw reproduced packet matches the original
routine's small finite partial response. Valid near-dependent wedges can still
produce large forces in the original mathematics; temporal admission remains
an independent requirement rather than treating RQ as a universal energy cap.

## Procedural reproduction

Run from the repository root, with no original installation required:

```sh
node --import tsx tools/reproduce-runaway-contact.mjs
# Optional: one full production tick, including local response retries.
node --import tsx tools/reproduce-runaway-contact.mjs --full-step
```

The report is written to ignored `artifacts/runaway-contact-analysis.json`.
The fixture is a uniform box of mass 0.05, bounds `[-.05,0,-.055]` to
`[.055,.307,.055]`, COM `[.0025,.1535,0]`, velocity `[-3,0,1]` and angular
velocity `[0,0,20]`. The triangle spans 20 actor units with slope `1e-6`.
The timestep is 0.04s. The OLD recovery flag is false in the full-tick case,
representing an ordinary existing owner rather than initial placement recovery.
Only a minute OLD-side discrepancy is needed; exact-flat examples also exist
with the independently inspected original prop hull.

The default controls use zero friction and no damage callback, repair, mass
change, opponents or prior extreme velocity. Thus those mechanisms are not
necessary for the demonstrated first energy jump.

| Same initial state, energy 0.337728        | Rows | Resulting kinetic energy | Interpretation                                                                      |
| ----------------------------------------- | ---- | ------------------------ | ----------------------------------------------------------------------------------- |
| Native chord emitter alone                | 1    | 0.345883                 | Resting RHS, small source bias work.                                                |
| Angular guard alone                       | 1    | 0.321081                 | Dissipative response.                                                               |
| Production native + angular merge         | 2    | 1,429,039.106            | Browser speed 2844.17, spin approximately 74,771 rad/s.                                |
| Original solver on that merged matrix/RHS | 2    | 0.338047                 | Derived by applying its returned partial multipliers to the same body; status `-1`. |

Energy here is in simulation mass × actor-unit² / s², not joules. The
original-solver energy is a calculation from its returned multipliers, not an
execution of the complete original game's callbacks or contact admission.

The merged multipliers are approximately
`[16171750231.59977,16171750089.391357]`. The original returns
`[0.0003020222357008606,0]`. The browser's active physical residuals are about
`[-.53545166,-.53547625]`, far from satisfying the demands it reports solved.

One full production tick reproduces the problem too: its first accepted
response changes the velocity to roughly `[-3.003,-3176.827,1]` and angular
velocity to `[-19714.97,.0907,-81154.47]`. Thirteen accepted response rounds
produce a final linear speed above ten million actor units/s. A short local
run took 213ms; this is not a hardware FPS benchmark or the historical FAIR
replay. It demonstrates how subsequent retries amplify the initial defect.

## How the incompatible rows arise

`simulation.ts` computes ordinary source contacts, then collects angular guard
contacts. `sweepWorldTrajectory` walks many successive poses, brings each hit
point back to OLD coordinates, groups hits independently by normal direction
and returns the combined groups. The merge drops almost-identical directions,
but retains opposite directions.

During rotation, a low vertex can initially move down and later arc back up.
The native chord and the angular segments can therefore select opposite sides
of the **same finite plane**. In the box reproduction:

| Emitter       | OLD point                | Normal                       | Initial signed point speed `Jv` |
| ------------- | ------------------------ | ---------------------------- | ------------------------------- |
| Native chord  | `[-.05,0,-.055]`         | approximately `[-1e-6,-1,0]` | `+1.05`, separating             |
| Angular guard | `[-.05,.00243293,-.055]` | approximately `[+1e-6,+1,0]` | `-1.05`, closing                |

These represent different temporal observations, not two independent
simultaneous walls. Their nearly identical mass-weighted Jacobians oppose one
another. Keeping a floor and an independent wall is necessary; indiscriminately
keeping every normal encountered anywhere along a future arc is not equivalent.
Any repair must preserve genuine corner constraints and collision coverage.

Relevant code: [world rows/merge](../src/physics/simulation.ts),
[normal solver and RHS](../src/physics/contact.ts),
[local response scheduling](../src/physics/local-response.ts).

## Why numerical regularization creates enormous impulses

For contact Jacobian `J` and positive mass matrix `M`, physical response uses
`K = J M⁻¹ Jᵀ`. The ordinary C2 impact branch demands
`b = .01 + 1.001 max(0, -Jv)` for all rows when any row closes fast enough.
This clipping and packet-wide branch selection are **verified native behavior**.
Changing them to a generic signed, inelastic solver would change C2 handling.

If two constraints are exact opposites, increasing both multipliers equally
cannot change the body's motion, yet both positive demands cannot be satisfied.
Near dependence gives an almost-canceling stress mode. The browser instead
solves `(K + δI) λ = b`, with `δ = maxDiagonal(K) × 1e-12`, then applies the
unregularized physical response `K λ`. A very large `λ` can therefore satisfy
the modified matrix while failing the real constraints. Small geometric
differences turn large opposing multipliers into enormous net motion. Damage
also consumes the individual positive multipliers, even when forces cancel.

`solveNormals` validates inactive slack but not active physical residuals before
returning. Its 2000-pass projected fallback likewise has no equivalent native
failure result. Adjusting the regularization, bias or damping coefficients
would move the failure region rather than repair this incompatibility.

## Verified native evidence and oracle

The target is the installed HW SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`,
PE32/i386 base `0x400000`, image size `0x39f000`.

| Native address                                | Verified behavior                                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `4bb4ed–4bb52a`, packet branch `4bb53f`        | Negative closing speed clipped to zero; `.01 + 1.001*c`; one packet-wide impact branch.        |
| Solver `4c3900–4c45e7`, callers`4bb860/4bbb3a` | RQ active-set normal solve; not our dense Gaussian elimination.                                |
| `4c3937–4c397b`                               | Single-row diagonal at most `.0001` returns zero multiplier.                                    |
| `4c3ad2–4c3b0d`                               | Detect dependence through the last lower-triangular R row versus `abs(lastDiagonal × 100000)`. |
| `4c3b13–4c3d6e`                               | Choose a removable prior row using Q coefficients and visited-set avoidance; remove/rebuild.   |
| `4c4198–4c4392`                               | Reactivate inactive constraints through normalized residual selection; threshold `-.001`.       |
| `4c43cb–4c43e2`                               | Iteration-overflow path reports and returns `-1`.                                               |

The merged reproduction takes 25 dependence removals and 51 loop-head visits,
returns through the normal return trap, and executes 24,917 instructions in the
oracle. Eight analytical controls validate the ABI, well-conditioned solutions,
small diagonal, opposite rows and reporting. The native/rest and guard controls
match browser multipliers within approximately `5e-11` and `2e-9` respectively.

Important limits:

- This is the ordinary unilateral, zero-protected-prefix path. Joint-prefixed
  and cached block-factor cases are not validated by this oracle.
- RQ dependence handling is not a universal energy bound. In a separate
  biased-wedge test with distinct Float32 matrix coefficients, a dependence
  parameter `1e-6` is rejected, but `1e-5` can return multipliers around 50,379.
  Correct contact admission remains necessary even after porting the solver.
- The native final residual-correction tail is **not** reliable evidence of
  corrected returned impulses: a controlled case executes the correction and
  changes scratch values while leaving the already-scattered output unchanged.
  This supersedes the earlier unverified interpretation of that tail.
- Solver failure is not an immediate native whole-step abort: the first caller
  increments the existing failure-report counter and continues processing;
  the second conditional caller does not check its return. Preserve the native
  report budget separately from successful impact retries.

Optional exact numerical comparison:

```sh
python3 -m venv /tmp/carma-native-oracle-env
/tmp/carma-native-oracle-env/bin/pip install -r tools/native-oracle-requirements.txt
/tmp/carma-native-oracle-env/bin/python tools/native-normal-oracle.py \
  --validate --input artifacts/runaway-contact-analysis.json
```

The tool authenticates the local executable before parsing it, maps its bytes
only in an isolated numerical oracle, and permits at most two seconds/500,000
instructions per call within an allowlisted math region. It never launches
Windows or the game process. Outputs stay ignored; no executable bytes are
stored in the repository or browser bundle. Unicorn/pefile are pinned optional
research dependencies, not runtime engine dependencies. See their
[license distinction](https://github.com/unicorn-engine/unicorn/blob/2.1.4/COPYING)
and the tool header; no third-party engine code was copied into our runtime.

## Relation to the FPS collapse and implementation direction

Once invalid impulses produce extreme spin/displacement, the additional guards
can sample 128 angular poses, each involving up to 400 integration microsteps.
Native predictive face queries grow with the motion and can wrap the 300-face
ring, running collection callbacks twice. Local response retries and five
catch-up ticks multiply this work. This agrees with the measured FAIR/bumper
world-contact and guard costs; resolution or visible polygon count does not
explain this episode.

Repair should address coherent contact admission, the original dependence/failure
semantics, and bounded pathological trajectory/query work. Escaped-wreck
containment remains a backstop, not a cure for a first jump occurring inside
the track. First-event recording must survive reload and include every owner.

An alternate-force audit identified possible suspension-history transients
after structural changes; their native contract still needs verification.
They are not needed for this reproduction. Likewise friction-frame hypotheses
are separate and do not explain away this normal-contact failure.

Confidence: reproduced contact/solver mechanism **high**; original numerical
comparison **verified for the tested routine/cases**; attribution of FAIR's
historical first impulse **unproven**.
