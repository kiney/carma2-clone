# Generic free-leaf40ms forces

Evidence: installed read-only HW executable SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`,
PE32 base400000, entry577eb0. rec2 `common/physics.c` supplies names but its
ProcessGravity/ProcessDrag implementations remain stubs and addresses differ.
The independent implementation is `src/physics/native-free-forces.ts`; no
original data or reference code is copied. This module implements a **force
pass**, not generic contacts, movement, volume selection or articulated joints.

## Actual fields and phase

`applyNativeFreeForces40` takes a mutable Float32 packet: normal PHIL header
state, object ec/do-nothing, header flags, gravity+10, drag+0c, levelOut+14,
actual mass/moments, raw world V+68, BODY omega+74 and retained gravity vector
Object+54. Only state2/ec0 receives forces (`4b6538–4b6558`). State1 proposes
the separate generic passive f0=2 marking. Sleep and registration are distinct.

Header bit8 requests the actual volume update before forces: preserve old
volume/depth, conditionally TestAutoSpecialVolume4ff360, then
MungeSpecialVolume4ff1a0. The caller supplies both numerical snapshots and
volume identities as `volumeStep`; unknown must not become dry air. The source
selection uses the physical object's+80 and its retained plane/depth/pointers,
not the parent character personality, render position or a car's volume.
See [bone runtime](c2-ped-bone-runtime-re.md) for release/callback ownership.

## Numerical equations

Gravity outer gate `4b658f–4b65d0` selects actual nonzero header gravity,
otherwise fallback1 only for enabled nonnull volume. A skipped gravity pass
preserves Object+54. `nativeFreeGravity40` implements `4b6c60`; each Y result
spills once to Float32 and is added to raw world V with another Float32 store:

```text
dry: dy = f32(g * G * double(-.05681159420289855))
volume, L!=0, viscosity>double(2):
    dy = f32(((1-volumeGravity)*depth*L
              - g*G*double(1.4202898550724639))*double(.04))
other volume: dy = f32(volumeGravity*depth*g*G
                       *double(-.05681159420289855))
```

X/Z of the source gravity packet are0. Global G and all object/volume/header
scalars are Float32; live source products use x87 precision, represented by
JavaScript double here. The dry gravity conversion already includes6.9.

Drag outer gate `4b65d5–4b6629` selects actual nonzero drag, otherwise fallback1
only for enabled nonnull volume. Drag0 dry has **no** linear or angular air
damping. `applyNativeFreeDrag40` implements `4b6a80` with:

```text
k = f32(selectedDrag * double(.00002))
if selectedVolume:
    k = f32(depth * viscosity * k * (L!=0 && viscosity>2 ? double(.5) : 1))
linearFactor = k * |worldV| * double(6.9) / mass
deltaV[i] = f32(worldV[i] * linearFactor)
newV[i] = f32(worldV[i] - deltaV[i])
torque[i] = f32(BODYomega[i] * |BODYomega| * k)
```

`515d70` zeros each linear component when its stored old/new product is<=0.
Angular decrement `4c2a40` uses **Float32[5898d0]=.02100399136543274**
(`f32(1/47.61)`), not.04. X/Z scaled torque remains live before dividing by
its moment; Y stores `f32(torqueY*C)` first at `4c2a8d`. New angular
components spill Float32. Crossing tests use stored X/Z and live Y; a<=0
product zeros that component. The tests retain a literal packet where the
Y intermediate store changes the output by one Float32 bit.

Following primary drag, header bit8 permits exactly one additional ordered
pass (`4b6636–4b66df`):

- Entry: current viscosity>2, current depth==1 and not(previous viscosity>2
  with previous depth>=1). Apply source entry scalar Float32[65bb78]=1.
- Otherwise exit: current volume is absent or viscosity<=2, and previous
  viscosity>2. Apply source exit scalar Float32[65bb7c]=1.

These extra passes use the **current** volume/depth and updated V/omega.
Leaving water for dry air therefore still applies one dry drag1. They are not
an accumulated multiplier or a test for changed volume identity alone.

## Explicit remaining providers

Surface levelling `4b6724→4b6d50` requires enabled volume, L!=0, viscosity>2
and depth<1. It needs actual ACT basis and physical water-plane normal+244.
The independent helper exposes a required `levelOut` callback returning the
source BODY-omega delta, invoked after all gravity/drag passes. Without it,
the full force pass returns `provider-required` and leaves the live packet
unchanged. The gravity/drag leaf exports remain available independently.
No invented spring, upright axis or generic torque is substituted.

`retainedJoint2` explicitly states absent/present/unknown. The result marks
whether the later generic constraint stage needs a provider; it never clears
Object+18c, solves a joint during the force pass or treats a present joint as
an intact-ped halt callback. The caller owns full hierarchy force propagation.
Complete here means the requested **free-leaf forces** completed, not that
the entire PHIL step or existing articulated hierarchy is source-complete.

All mutations commit together after numerical/provider validation; nonfinite
or singular drag inputs fail explicitly. The helper does not mutate header
state, ec, flags, matrices, registration, quiet counters or volume ownership.
There is no dt argument: these coefficients belong to source40ms physics.

Tests cover dry/no-damping, passive/sleep, retained gravity, zero globals,
fallback scalars and strict viscosity/depth edges, clamp/Float32 equations,
ordered entry/exit passes, missing-provider atomicity and read-only actual
Stock/Advanced Blokebl, Bandsman and twolf head mass/MODEL moments. No original
fixtures are committed.

## Current simulation integration

`VehicleSimulation` now uses this pass for actual registered type2/simple and
type5/detached bone bodies. Header values are read from the shared live PHIL
registry. Each body supplies its own cached water plane, current bounds and
before/after special-volume snapshots. Dry motion receives no generic air
damping. Surface levelling uses `nativeFreeLevelOutDelta` with the physical
rotation basis and cached plane; see [level-out](c2-native-free-level-out-re.md).

The installed parallel-axis level-out singularity is an explicit stability
deviation: the host retains gravity/drag, omits that nonfinite torque and records
`native-level-out-singularity-suppressed`. The pure source helper still returns
the original nonfinite result for conformance tests. A retained joint2 remains
an unresolved later constraint stage and is never discarded by this force pass.
This does not claim that ordinary displayed pedestrians have all native owners.
