# PED-11: exceptional pedestrian physics

## Native topology and corrected scope

The installed HW/SW call graphs select ordinary simple mode0 and physical
levels0/5. They do not select a connected articulated ragdoll for normal
pedestrians. BIPEDF's authored joint data does not change that selection.
The dormant level2/6 branch neither constructs a physical tree nor establishes
its temporary matrix owner. Implementing a new ragdoll would add behavior.
See the [binary identity, callsites and dormant branch](ped11-topology-re.md).

The original task's active-BIPEDF assumption was corrected against this evidence.
The installed DOCTOR4 personality also lacks its ten MODEL resources; its only
authored population route is the unavailable Nuke track. This asset limitation
was already classified in the existing asset-selection notes. Raw FORM joint
records remain intact. Optional custom LINE/other shape dispatch remains PHY-05
and PHY-06, rather than a missing shape in the nine installed FORM files.

## Actual exceptional contact paths

Nonhumanoid characters use the same source random selection and child-first
sever traversal as ordinary humanoids. The former blanket provider refusal was
incorrect. Existing nonhumanoid minimum-damage and fatal-removed-member rules
remain in the common damage owner. Original ACT/MODEL, mass, BOX/SPHERE, bounded
FORM slots and PHIL headers continue to own every independent part.

Exploding contacts bypass the percentage roll even at chance0, while retaining
other-body, gore and immortality gates. Each visited node consumes its three
source translation draws and three BODY-spin draws before missing/pool checks.
Its world launch adds the then-current character V; it does not add a generic
explosion impulse. Ordinary nonexploding chronology remains separately tested.
See [selection, launch and joint evidence](ped11-sever-re.md).

Original powerup4/action3 now uses the existing grant/renew/cancel/expiry/reset
owner and feeds the actual global into normal pedestrian frames. Granting it
does not activate or push pedestrians. Timer freezing does not freeze the
effect's game-time expiry. Other unfinished pedestrian powerups remain PUP-09.
See [installed handler](ped11-explosive-powerup-re.md).

## Original memory semantics exposed by animals

The first real DOG1 collision uncovered a ten-counter browser assumption.
The source declares and initializes ten bytes, but indexes `cache+23+boneIndex`
for all FORM bones. DOG1 has16 bones. The adapter now exposes a bounded32-byte
view of the actual300-byte record while initialization still clears exactly ten
bytes. High indices alias flags and vector bytes exactly as the installed code;
no independent replacement array hides those aliases. A red/green regression
checks selective stores and both directions of aliasing. See
[process-cache evidence](c2-ped-process-cache-re.md).

High-index root-stump bleeding likewise reads beyond a nine-vector native table.
The original adjacent data includes relocated pointers and an identity matrix.
The actual selected local PE supplies this bounded read-only span, alongside the
existing FSM extraction. HW/SW pointer-derived Float32 values remain distinct.
Neither an executable nor extracted proprietary data enters the source or build.
Missing custom lookup indices are diagnosed, rather than given an invented axis.

## Joint and settling ownership

The retained joint2 angular-friction phase uses actual friction, diagonal moments
and BODY omega with verified Float32 stores and native53-bit arithmetic. A known
NONE0/count0 joint has no geometric rows and can retain this friction through
sever/release. Unknown or positive world-joint types/limits require their actual
geometry provider before admission; friction alone is not a complete joint.
Quiet orientation comes from the current body basis, not a fabricated joint
member. Sever still preserves joint2 and does not attach the dormant FORM joint1.
The friction call follows contact friction, leaf/whole-ring quiet and sleep. It
uses post-contact omega and changes next-tick velocity, never the committed pose.
Frozen scheduling tests check that phase and passive/sleeping exclusion.

Real car-only contacts exposed a separate settling integration bug: the native
helper reads the current shared face-ring slot at the body's start, without an
end/epoch/material check. Empty owned ranges still have a meaningful raw slot,
including the PE's known zero-filled initial record. The callback now reads that
slot after all collections, preserving later overwrites. It does not fabricate
a ground normal or suppress the car-contact gate. See
[raw-slot ownership and regressions](ped11-settling-face-re.md).
The halt callback separately receives the current raw `[start,end)` normals,
without material/epoch/contact filtering. Its strict positive-Y support selection
and existing source-undefined no-positive-floor handling remain unchanged.

## Validation and explicit boundaries

Numerical tests cover exploding RNG order/endpoints, repeats, pool exhaustion,
nonhumanoid damage, original DOG1/BIPEDF definitions, joint friction, joint
metadata admission, raw ring slots and physical settling, and selective process
cache initialization. Existing ordinary sever/repair/reset tests remain active.

`npm run test:ped-exceptional` exercises existing authored DOG1 owners in Stock
Junkyard and Advanced Junkyard2. It admits them through normal camera/process
notifications, grants the original explosive powerup and uses genuine car/PHIL
contacts. It never injects HP, missing masks or a sever call. Each case is bounded
to at most three candidates and60 physics frames. Reports and images stay ignored.

An existing original-undefined negative prepared-group proximity diagnostic can
already occur at admission on this terrain. The harness records it separately,
allows only that named pre-contact boundary, and requires no new contact or
physical-provider diagnostics. This does not claim complete prepared-heap parity.
Missing DOCTOR4/Nuke assets and optional custom shapes are not fabricated.

DevTools MCP is unavailable in this runtime. The reproducible Chromium harness
provides console/request/WebGL checks and rendered images. SwiftShader results
are functional validation, not hardware performance measurements.

## Final checks (2026-10-30)

- Production build and TypeScript check pass.
- Full original-installation suite: 3709 tests, 3703 passed, six optional skips,
  no failures. Asset-free CI copy: 3640 tests, 3209 passed, 431 asset-dependent
  skips, no failures. The installation was absent rather than renamed or modified.
- Serial Chromium checks pass: exceptional DOG1 normal/explosive contacts in both
  trees, ordinary living recovery, ordinary severed-part population ownership and
  combat powerups. The latter checks retain console/request/WebGL assertions.
- All four exceptional cases use nine physical frames and no new provider
  diagnostics. Explosive cases detach15 original parts each; normal Stock and
  Advanced cases detach3 and5. Once-only counting, original BOX/SPHERE resources,
  independent poses, actual launch packets, reset and timer-independent expiry
  are asserted. The one named pre-contact original-undefined proximity diagnostic
  remains explicitly separated from new failures.
- The old recovery harness initially failed because it let render timing choose
  the initial walk pose and candidate during asynchronous loading. It now pauses
  immediately after loading and performs three fixed ordinary population visits
  with shared CRT seed24 before the unchanged one-unit fall and strict living
  recovery assertions. The same harness passes on the unmodified baseline and
  twice on the candidate. Baseline/candidate initial matrices, launch velocities
  and final running41/HP results match exactly (Stock76, Advanced77).
- Read-only final review found no correctness issue in joint2 phase/metadata or
  shared-face lifetime. Rendered exceptional screenshots were inspected; outputs
  remain ignored under artifacts/. Browser backend was SwiftShader at1280x800,
  so these checks make no hardware-FPS claim. MCP was unavailable.
