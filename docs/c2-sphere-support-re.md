# Finite sphere support commit guard

`src/physics/sphere-support.ts` provides a **trajectory-commit safety extension**,
not recovered native contact response. It must run only in the final sphere
trajectory guard; ordinary world contacts, impulse rows, damage and PHIL flags
retain the installed sphere kernel. This does not recover deep penetration.

## Installed evidence

Executable identity and the 1,800 mathematical captures are recorded in
[c2-sphere-contact-re.md](c2-sphere-contact-re.md). The original installation was
read only throughout this work. `madebr/rec2` identifies the function names;
installed HW disassembly supplies the following branch evidence:

- `422ca7..422d6a` visits the object's ordered cached faces and passes transformed
  OLD/candidate sphere centers directly to `SphereFaceCollide` (`45ed50`), retaining
  the earliest fraction. There is no ordinary automatic shallow-overlap retry.
- `45ed50` rejects front OLD distance below the radius. Back OLD distance must be
  at most negative radius, with a present material carrying bit `1000`. Finite
  barycentric and material-prefix gates remain as documented in the sphere note.
- `422b61..422bc9` handles global placement override `677cd8` separately. The
  existing `placementStart` primitive permits a different query start without
  changing the actual OLD pose used for the emitted source type-3 torque point.
  Reusing that primitive in this guard is an extension, not native automatic
  placement behavior.

## Reproduced failures

The final guard formerly tested a rotating OLD material point's displacement.
That point can rise by `radius*(1-cos(angle))` while the sphere's center descends
through support. The guard now tests center displacement in the frozen hit normal;
native solver torque points remain unchanged. A separate mutable-pose alias made
each angular sample overwrite its saved OLD values, losing later crossings. The
guard now retains pose values between samples. These integration fixes belong to
`simulation.ts` and are exercised by `sphere-support-regression.test.mjs`.

A third, smaller gap exists independently: native Float32 root/center stores can
round an otherwise supported double-precision center just inside the sphere shell.
For the observed road height `f32(-.824754)` and original Blokebl HEAD radius
`.01787157729268074`, a double center one nanounit above support rounds to a native
OLD distance `.017871558666229248`, a deficit about `1.86e-8`. The strict installed
OLD gate then rejects an inward crossing. The primitive must retain that behavior.

## Extension contract and bounds

`recoverNativeSphereSupport(input, faces)` returns only additional guard rows in
supplied face order. `nativeSphereCenters` shares the existing validated source
Float32 model/root transforms; it adds no contact behavior. The host retains its
enabled/owner/passthrough filters and maps surface `collisionMode="edges"` to the
same `materialIdentifier=">"` used by `nativeSphereSurfaceContacts`.

For each frozen packed plane, the extension requires a positive OLD radius deficit
no larger than **both** a derived storage-error allowance and `radius/4096`. The
allowance sums full Float32 ULPs for root translation, basis/model terms, rotated
and translated center stores, radius and plane/distance stores, plus a bounded
double-sum rounding term. Coordinate errors are projected through the packed
normal; large coordinates perpendicular to the normal do not enlarge the bound.
Full ULPs include room for representable outward reprojection. The radius-relative
ceiling is a conservative extension policy, not an original constant or `.002`
world snap. At large world coordinates it deliberately refuses bigger errors.

OLD-to-END center motion must be strictly inward and END must be inside the radius;
resting, outward and nonpenetrating motion produce no recovery. Query OLD is
projected outward to a representable start, with at most eight dominant-coordinate
corrections and the same displacement ceiling. Exhausted, nonfinite or over-budget
reprojection returns no row. The exact original finite-face kernel is then queried
again. Only source type-3 rows survive, preserving its finite triangle, prefix,
side/material gates, packed normal, source surface, friction and actual OLD torque
point. Guard fraction/measure become zero because the original OLD shell already
overlaps; neither physical pose is pushed or changed. Edge recovery is excluded.

Faces are handled independently, so an OLD floor shell cannot suppress a distinct
new wall crossing. This helper does not provide moving-world support, deep-overlap
recovery, source impulse changes or proof that every admitted tiny overlap arose
from storage rounding; it recognizes overlaps bounded by those rounding errors.

## Validation

Focused regression: 13 passed, including both earlier guard failures, offset
MODEL/COM rotation, unchanged native OLD rejection, shallow recovery and original
OLD torque identity, deep/radius-cap rejection, outward/resting rejection,
oblique packed normals, original finite/material/backface gates, an independent
wall crossing, and read-only Stock/Advanced Blokebl HEAD bounds. Original tests
skip cleanly when the installation is absent. TypeScript and formatting checks
passed. The helper is integrated only in the sphere final trajectory guard;
the integrated numerical test commits its returned zero fraction and retains
physical support. The production build passes. Browser QA of the two earlier
integration fixes passed Stock/Advanced real HEAD+BOX impacts; combined runtime
verification is pending and remains distinct from those earlier checks.
