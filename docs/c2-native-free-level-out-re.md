# Native free-body surface levelling

## Evidence and scope

Installed HW executable SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`, PE32
image base `400000`, entry `577eb0`. `madebr/rec2` names
`LevelOutOnSurface` in `src/carma2/common/physics.c` but leaves it a stub;
its annotated address `4b6fb0` differs from installed `4b6d50`.
This independent implementation derives from the installed instructions and
numerical probes, without copied reference implementation or binary bytes.

`src/physics/native-free-level-out.ts` supplies the previously explicit ACT/
water-plane provider in [free forces](c2-native-free-forces-re.md). It accepts
native12 ACT matrix34, BODY inertia and retained world water-plane normal,
and returns a BODY angular-velocity increment. It changes no registration,
header, ec, volume, pose, joint or supplied vector.

## Owner gate and coordinates

The generic force traversal invokes `4b6d50` at `4b6724–4b6726`, after gravity,
primary drag and conditional entry/exit drag. Eligibility is header volume
bit8, nonzero header levelOut scalar, nonnull selected special volume with
viscosity strictly greater than double2, and stored depth strictly less than
double1. The enclosing active header2/ec0 gate still applies. These gates
belong to the existing free-force helper, not to this leaf.

The ACT is the actual `Object+00` pointer. Matrix basis starts at `ACT+2c`:
X at `2c/30/34`, Y at `38/3c/40`, Z at `44/48/4c`. Native12 represents these
three world basis vectors followed by translation. They correspond to Three
matrix columns, not row-major flattening of a Three Matrix4. Translation is
unused. Preserve full scale/shear; neither normalization, quaternion-only
reconstruction nor a matrix inverse occurs in the installed function.

The normal is retained `Object+244/+248/+24c`, not special-volume boundary
normal, gravity direction or a current ground ray. The water-face cache
callback `414930` stores a qualifying face normal and negates it only when
Y is negative: the cached plane therefore points up. See
[water-cache ownership](c2-water-face-cache-re.md). This function does not
negate or normalize that normal again; it also ignores water distance+250.

## Exact axis, ordering and arithmetic

Let `f` be a Float32 store, `I` BODY moments at `Object+08/+0c/+10`, `n` the
stored normal, and `A0/A1/A2` the stored ACT basis. Axis selection
`4b6d56–4b6dac` is:

- X if `Ix>Iy && Ix>Iz`.
- Otherwise Y if `Iy>Iz && Iy>Ix`.
- Otherwise Z, including an X/Y tie that exceeds Z and all three equal.

Set `a=-Aselected`, storing its components as Float32 at `4b6dc9–4b6dd3`.
Evaluate live `dot=(nx*ax+ny*ay)+nz*az`; spill `f(dot)` but compare the **live**
dot with DOUBLE[589780]=−.99 (`4b6e03–4b6e12`). Return without changing omega
unless `dot>−.99`. Testing the spilled dot changes near-threshold results.

For the remaining branch, use `c=n×a` and the following ordered equations.
Names ending in `S` are explicit scratch Float32 stores; all other arithmetic
remains live until its stated store:

```text
x = ny*az - nz*ay
y = nz*ax - nx*az
z = nx*ay - ny*ax
yS = f(y), zS = f(z)
yyS = f(y*yS), zzS = f(z*zS)
q = f(dot) + 1, qS = f(q)
X = x * (q / sqrt((x*x + zzS) + yyS))
XS = f(X), xxS = f(X*XS)
Y = yS * (qS / sqrt((zzS + yyS) + xxS))
YS = f(Y)
Z = zS * (qS / sqrt((Y*YS + zzS) + xxS))
ZS = f(Z)
```

This is intentionally **sequential normalization** (`4b6eb4–4b6f16`): the
second denominator uses corrected X, and the third uses corrected X/Y.
Do not replace it with one normalized cross vector. X uses its live cross
and live q; Y/Z use their earlier stored crosses and stored q. The third
denominator keeps `Y*YS` live. Float32[589778]=−1 supplies axis negation and
the subtraction that produces `dot+1`. There is no additional spring
coefficient, dt, mass, inertia division, levelOut multiplier, depth scaling
or damping of existing omega inside this leaf.

World increment is `(XS,YS,ZS)`. `BrMatrix34TApplyV532cd0`, called at `4b6f1c`,
produces `bodyDelta_i=f((Ai.x*XS+Ai.y*YS)+Ai.z*ZS)`. The full ACT **transpose**
is used even for a nonorthogonal basis. Finally `4b6f21–4b6f3f` stores each
`Object+74/+78/+7c=f(oldBODYomega_i+bodyDelta_i)`.

## Installed singularity and adapter contract

Exactly parallel `a` and `n` with live dot greater than −.99 gives a zero
cross magnitude; the installed divisions produce NaNs and all three BODY
omega components become NaN. The opposite aligned case with dot=−1 returns
early. This was replayed against the original function, not inferred from
algebra alone. There is no installed epsilon, fallback axis or finite zero
torque branch. The helper returns status `singular` and actual NaN deltas;
it does not silently fabricate a finite increment. The current force helper
rejects nonfinite callback output before committing the live packet. A host
must explicitly retain that diagnostic policy or deliberately choose a
documented safety deviation; ordinary nonsingular water needs no unknown
provider after passing the actual ACT/plane inputs.

Integration: in `applyNativeFreeForces40`'s `levelOut` callback, call
`nativeFreeLevelOutDelta({inertia:packet.inertia,actorMatrix:actualNative12,
waterPlaneNormal:retainedPlaneNormal})` and return `bodyDelta`. Do not add
omega in the callback: the force helper owns the final Float32 additions.
An ordinary skipped dot gate returns zero delta, preserving existing omega.
Source type5 uses this generic operation, not intact-character movement or
halt callbacks; retained joint2 remains a separate later constraint stage.

## Validation and limits

An isolated freestanding32-bit numerical harness mapped installed sections
read-only and called `4b6d50` with synthetic source objects/ACTs. At x87
53-bit precision (`CW=027f`), the TypeScript helper plus final Float32 omega
addition matched all **1,008** native probes: 1,000 deterministic finite
randomized moment/normal/full nonorthogonal basis inputs and eight targeted
axis/tie/dot/singular cases, with zero component mismatches. Derived numeric
probes are safe test fixtures; no executable or original geometry is copied.
The mapper/capture remain in `/tmp`, outside source and production bundles.

Focused tests cover live-versus-spilled dot threshold, strict axis ties,
sequential normalization, full shear transpose, translation independence,
provider validation, singular reporting and the generic viscosity/depth/
header gate order. Read-only Stock/Advanced Blokebl, Bandsman and twolf heads
verify actual FORM/MODEL inertia: SPHERE collision geometry does **not** mean
equal moments. The two authored human heads choose Y (upright positive-Y
plane skips), while the dog head chooses X (upright plane adds BODY +Z).
Missing original installation skips those six tests cleanly.

JavaScript double arithmetic does not emulate all possible x87 extended
precision/control-word settings; the verified probes use the stated 53-bit
setting. General hierarchy/joint forces and source volume selection remain
owned elsewhere. No guessed articulated constraint or safety torque is added.
