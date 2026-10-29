# PED-08: ordinary severing and retained part ownership

## Implemented production path

The original population's existing native contact/sever kernels now drive
visible dismemberment at the installation's selected gore level. A selected
bone/subtree acquires a real preallocated FORM resource, current ACT/MODEL,
authored shape/mass/COM/moments, shared normal100 PHIL header and source
velocity/spin. Its ACT and native pose belong to that body; BON cannot overwrite
the detached mask. The intact simple collision profile remains the source FORM
profile, while detached bodies have their own current geometry. There is no
second estimated corpse launch or separate logical population identity.

Production previously used internal gore1 regardless of the original option.
`GoreLevel0` in the stock OPTIONS file maps to internal2 via source
`SetGoreLevel4d7030`; only that internal level permits sever selection. The
loader now reads the selected tree's OPTIONS, falling back to shared stock
OPTIONS when Advanced has none. Missing options retain native default1;
malformed options produce diagnostics. Explicit test/frame settings still use
the internal scale. No original file is changed.

## Retained poses and release chronology

`NativePedStoredPoses` owns a first-free, bounded table shared by personalities
using the same FORM. Capacity is actual `maxStoredDismembered`; a record has
`boneCount*48` bytes. The root matrix is unused and its first float marks
occupancy. Removed child matrices are stored at `index*48`.

- Installed `408487..408532` saves removed matrices after real PHIL removal.
  Exhaustion retains no stored-record link; it does not immediately mutate
  vanished masks or allocate another snapshot.
- Installed `408200`, specifically `40829a..408309`, restores those matrices
  during **render acquisition before simple PHIL registration**, then releases
  occupancy. No record sets vanishedMask to removedMask exactly. Failed simple
  admission stores the restored render state again before releasing its ACTs.
- The existing `409090` part-release path marks every removed part whose actual
  header is2 as vanished, even if ec sleeping. Reacquisition only registers
  removed/nonvanished parts; their V/omega initialize to zero. Source header2
  parts must not be revived merely because their stored matrices exist.
- Race teardown removes actual root/part headers before ACT release and clears
  stored-record ownership. Logical masks and census remain once-only.

The runtime provides this storage by default. Controlled external storage hooks
remain available, with restoration moved to the same early render phase.

## Source transition fixes exposed by severed figures

`ReadPersonality407325..407378` initializes a personality record for every FORM
move before default/personality overrides. Stock/Advanced IDs4/5/6 legitimately
have no authored override. They now retain scale1 and floating−1; the unused
floating offset is represented by zero, not claimed as a native initialization.
See [FSM/default evidence](c2-ped-move-fsm-re.md).

Corpse halt `4d185e..4d188b` and moved93/94/97 `4d2864..4d287b` call
SetCharacterMoveAR directly for period changes. They now bypass SetPedMove's
FSM, action, speed-factor and cached-run-speed writes. Frame/fraction/time and
completion/queue state stay with the retained animation. Genuine SetPedMove
missing-leg negative requests can separately read their bounded original
neighboring cells with provenance, as documented in the FSM note.

An airborne dead halt with no positive face is valid. `4d0ff0` uses live bestY0
to reject alignment retry; `4d13bc` enters the corpse branch without reading
the undefined normal/dot for80/81 selection. It no longer blocks offscreen
release. Living nonupright recovery without that normal remains an explicit
source-undefined boundary; no artificial world-up vector is supplied.

## Retained and exceptional topology

The ordinary supported stock parts have NULL retained joint2. A non-NULL joint2
requires its actual constraint provider; production now preflights the selected
bounded resources before CRT/reservation/PHIL/mask/HP mutations. Such a body is
not admitted as an unconstrained free fragment with only a warning.

Full articulated level2/6 conversion, temporary matrices, authored HINGE/
BALLNSOCKET constraints, nonhumanoid/exploding sever selection and LINE physics
remain explicit providers. No generic ragdoll or box substitute is presented as
reconstructed C2 behavior. Original-data audit found nine FORM files per tree:
90 massive BOX and9 SPHERE bones, no massive LINE. BIPED1 has10 bones,
maxBoned10/stored30 and FALSE child joints; BIPEDF has authored joints and is
selected by DOCTOR4; DOG1 has16 bones, stored15 and a nonhumanoid sever path.

## Validation

Deterministic tests cover bounded/shared first-free storage, exact masks and
Float32 matrices, zero/full capacity, pre-mutation input checks, failed PHIL
admission/restorage, passive removed-part reacquisition with zero V/omega,
retained-joint preflight, period-only FSM bypass and no-positive-face corpse
halt. Original HW/SW and Stock/Advanced tests cover loaded missing-leg cells and
default personality moves. Proprietary fixtures remain external/read-only.

`tests/browser-ped-sever-population.mjs` uses actual enrolled original figures,
controlled car/root placement and velocity, and genuine car/PHIL contacts. It
never injects HP, action, removed masks or a sever call. Reports/screenshots are
ignored; resource-scope time changes are labeled, not additional simulation.

The final serial Chromium run passes both trees with OPTIONS-derived gore2,
at most60 physics frames each: Stock detaches a BOX limb; Advanced detaches
the SPHERE head and BOX limbs. Actual part transforms diverge from the root,
source masses/ACT/MODEL agree, and repeated contacts do not relaunch or recount.
Scope release marks active parts vanished exactly, stores/restores their matrices
with zero measured error and returns occupancy0→1→0. Race reset leaves zero old
PHIL, scene ACT and stored-record owners. No provider, console, HTTP or WebGL
errors occur. Headless1280×800 uses SwiftShader; this is not a benchmark.

Chrome DevTools MCP independently verifies an ordinary stock figure detaching
four BOX parts from a genuine car collision, HP100→0/count once, scope release
and bounded storage reuse without diagnostics or console/WebGL errors. Hardware
backend is AMD radeonsi, buffer2081×1445. User's existing tabs stay paused.

The combined focused suite passes151 tests with one skip for absent Advanced
OPTIONS (production intentionally falls back to stock). TypeScript/production
build pass. Red-before regressions cover stored-pose admission and direct-period
FSM bypass; the source corpse no-face branch has a numerical regression.
