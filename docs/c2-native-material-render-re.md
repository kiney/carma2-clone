# Native MAT shading and host rendering

The independent adapter in `src/native-material-render.ts` preserves admitted
source MAT identities and stores the effective native shading/fog state on their
actual render wrappers. Original data and executable files remain read only.
rec2 is GPL-3.0 and was consulted as a symbol/structure map, not copied into this
MIT implementation. Installed executable behavior takes precedence over rec2.

## Verified state changes

Installed HW SHA-256:
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`;
PE32 i386, image base `0x400000`, entry `0x577eb0`, timestamp
1998-10-18 20:13:36. Static inspection used read-only `objdump`.

`GlorifyMaterial` is installed `0x517d50..517f5a`. Shading 1 assigns F32
ambient/diffuse/specular `.2/.8/0`; shading 2 assigns `.6/.2/.8`; shading 3
assigns `.4/.8/0`; shading 4 assigns `1/0/0`. All four clear PRELIT and set LIGHT
and SMOOTH. Other shading values assign `1/0/0` and retain the flags. In
particular, rec2 `common/graphics.c` incorrectly leaves shading 3's diffuse,
specular and flags unchanged; the installed branch `0x517ebc` falls into the
common suffix at `0x517f06`. rec2's alternative `newcommon/41-utility.c` agrees
with the installed branch.

Textured materials retain all authored flags. When interpolation is selected,
exception bit 1 inhibits addition of MAP_INTERPOLATION; exception bit 8 replaces
both UV translations with F32 `.02`. Selected map antialiasing and perspective
add their respective flags independently. The exception map is supplied through
the renderer options; an arbitrary identifier or filename is not used to invent
an exception.

The MAT parser now retains index base/range, local fog min/max/RGB, signed
subdivision tolerance and all five reference roles. These occupy the previously
skipped fields after the six UV coefficients. Old MAT records inherit zero fog
and subdivision values. Unknown chunks remain bounds checked. Admission episodes retain actual MAT object identity separately from effective
render descriptors. Native load callbacks such as Smoothification may later
mutate the admitted MAT's flags/coefficients, and `Assets.updateNativeMaterial`
updates the same GPU wrapper without a new MAT allocation or a second Glorify
coefficient override. Initial file records and later runtime state must therefore
be distinguished when interpreting admission evidence.

The local fog state kernel is verified separately in
[c2-native-material-fog-re.md](c2-native-material-fog-re.md). The adapter uses its
actual F32 fields in a per-material linear depth shader, with the original base
yon rather than the track-multiplied camera clipping distance.

The optional installed-data inventory read 1,979 MAT files / 31,446 records
across Stock and Advanced with no parser failures. The union of authored flags
is `0x2103d`: LIGHT, SMOOTH, ENVIRONMENT_I/L, PERSPECTIVE, TWO_SIDED and
MAP_INTERPOLATION. This inventory is asset evidence, not proof of all possible
runtime-generated material flags.

## Rendering implementation and confidence

BRender `prepmatl.c` maps LIGHT/PRELIT, SMOOTH, culling, opacity, map filtering,
UV transform and local fog into renderer state. Always-visible disables culling;
two-sided additionally flips the lighting normal on back faces. The adapter
retains this distinction despite both using Three DoubleSide. Native opacity
controls blending independently of depth writes. Nonzero texture alpha survives
colour-key rejection; the previous arbitrary `.15` cutoff was removed.

The ordinary directional lamp is reconstructed from `DRLoadLights`: RotateX
300 degrees, then PostRotateY 30 degrees, using u16 BRender angle quantization,
unit attenuation and the track's authored directional RGB. The shader computes
surface lighting at vertices for SMOOTH materials and interpolates the result
before texture modulation. It uses native byte colour arithmetic rather than a
Three ambient/sun brightness multiplier or sRGB lighting conversion.

Installed directional accumulation is `0x5487f0..5489b8`. It multiplies the
positive normal/light dot by the material's diffuse coefficient (`surface+0x30`),
unlike rec2 `light24.c`, which omits this factor. The specular branch
`0x5488bc..548924` uses the half-vector and the rational expression
`h*ks/(power-power*h+h)` above F32 cutoff `.6172` at `0x58b97c`, rather than a
Phong exponent. The adapter implements this equation. Whole-driver x87 rounding
and the original hardware's finite colour quantization are not claimed to match
WebGL bit for bit.

FUNK frame and matrix-animation texture clones inherit the current native MAT
sampling policy through `copyNativeTextureSampling`. This changes colour space,
filters and mipmap generation without touching an atlas or animated UV matrix.
The shared startup texture library remains unchanged, and unchanged sampling
does not trigger a fresh upload on every animation tick.

Geometry UVs retain the authored six-coefficient map transform. PERSPECTIVE
uses ordinary perspective interpolation; its absence uses the homogeneous
varying correction for affine interpolation. ENVIRONMENT_I and ENVIRONMENT_L
select reflected-direction longitude/latitude coordinates, preserving infinite
(actor-origin eye) versus local (per-vertex eye) selection. This follows rec2
`softrend/mapping.c`; exact environment mapping under nonuniform/sheared actor
transforms has not been compared with the installed driver. No environment
actor is manufactured. Flat directional shading uses the live triangle normal
and actor-origin eye; it does not run the original prepared-face constant
function or its floating-point rounding sequence.

PRELIT disables light accumulation and multiplies supplied geometry colour.
Ordinary C2 16-bit model loading whitens vertex RGB. The current DAT renderer
has no independent authored vertex-colour payload binding; this remains a limit
for future geometry outside the ordinary whitened load path. Paletted shade,
blend, screendoor and fog tables are retained as source references; the 16-bit
texture rendering path does not emulate the complete software palette pipeline.
Rare flags outside the installed authored inventory (decal, indexed intensity
mapping, dither, custom primitive callbacks, subdivision and newer BRender
extensions) are not claimed as fully implemented merely because their numeric
values are known. Exact original triangle rasterization and hardware filtering
remain driver differences.

## Global ownership and teardown

`NativeGlobalResources` separates per-storage exact-name admission from global,
newest-first native name lookup. `Assets.scene(...,{storage,shading})` allows
opponent car loads to share admission storage while track/player/mine storage
remain independent. All admitted MATs use one Assets-owned material arena, so
cross-storage native references are live and orderable in that same host arena.
The arena addresses remain host addresses, not recovered Windows heap pointers.

Startup `Assets.common` now registers actual `data/Reg/MATERIAL` files before
`data/Reg/MODELS`, following rec2's `LoadInRegisteeDir` sequence. Installed
`DRLoadMaterials` is `0x48f020..76`: it clears LIGHT on each loaded MAT and calls
`BrMaterialAddMany` directly, without track `AddMaterials` duplicate rejection
or Glorify. Installed `DRLoadModels` is `0x48f080..dd`: after the ordinary white
vertex RGB pass it overwrites MODEL flags with `0x80`/UPDATEABLE and registers
them. These installed addresses differ from rec2's annotations. The installed
REG archives supply 22 MAT files and three real powerup MODELs named
`&68POWERUP1.ACT`, `&69POWERUP1.ACT` and `&70POWERUP1.ACT`. Their exact objects,
arena allocations, GPU wrappers and geometry remain startup owned across race
changes. This provides a genuine cold Junknet fallback, without synthesizing
resource identifiers. Common ACT/LIGHT and the software table registries remain
outside this bounded MAT/MODEL registration change.

`scene.sourceModelMaterialBindings` exposes slot-aligned MAT pointers captured
when each DAT loads, including authoritative NULLs and common MODELs. Later
race/car registrations can change newest-first global lookup without changing
an earlier DAT's material table. Both geometry rendering and native world MODEL
preparation use this same captured table. `ownsNativeGeometry` and
`ownsNativeTexture` identify still-owned geometry and dependent texture sources
for external group teardown; display clones retain independent material wrappers.

`scene.dispose()` releases a named storage after its final scene owner leaves;
`Assets.releaseRaceResources()` clears all scene-owned registrations, geometry,
textures and arena allocations while retaining startup resources.
Process-global changing-powerup MODEL copies retain borrowed original face MAT
identities through `Assets.retainNativeMaterial`. This idempotent lease keeps
that exact source object, arena handle/address, render wrapper and its dependent
texture live until the Assets instance ends. Ordinary storage removal still
unregisters the source from name lookup; unrelated race MATs are freed normally.
External group teardown uses the material/texture retention predicates too.
This is an explicit host ownership policy: original C2 can retain stale face MAT
pointers after storage frees and subsequently reuse those heap addresses. The
browser preserves valid object references instead and does not claim to
reproduce original dangling pointers or Windows heap reuse.

Persistent generated `gDefault_track_material` and black `Simple` retain identity
across races. The first inherits LIGHT and power 20, assigns palette index
227/range 1, the actual palette entry 227 and ambient-only coefficients
(installed `0x47e006..62`). Its name is verified from `0x6557d4`, not NULL.
The second is selected by input `M14.MAT`, but installed `GetSimpleMaterial`
(`0x488c70..488d92`) allocates identifier `Simple` at `0x488d3e`, uses RGB
`0x212121`, computes the first closest squared-RGB palette index through
`0x517f70..518033`, sets index range zero, and applies shading 4. Its flags are
LIGHT|SMOOTH and its inherited power is 20. The original common `M14.MAT` remains
a separate lookup identity. Both generated materials are globally admitted:
installed `0x47e062` and `0x488d7c` call `BrMaterialAdd(0x51e490)` respectively.

`Assets.cloneNativeMaterial` creates a distinct live MAT/arena episode for
native allocation paths such as smash tile copies; race teardown unregisters
and frees it. Incidental display-only `.clone()` retains its source MAT identity
and native shader instead. A WeakMap provides identity lookup without a
name-based fallback; default Three cloning otherwise JSON-copies the source
object and drops the shader hook. GPU lighting uniforms remain shared between
display copies, while damage/animation display colour is independent.

Headless conformance checks cover verified shading branches, UV exceptions,
rational specular, culling/alpha/depth/filtering, generated defaults, clone
ownership, original-installation startup admission/load-time bindings and
shared-storage teardown. The existing
Stock/Advanced registration tests continue to check the first admitted
advert2/advert3/cinema01 TWO_SIDED materials and case-distinct Airport materials.
Browser rendering and race reload checks belong to the integrated runtime audit.

## Integrated application validation

The final production Stock/Advanced smoke and smash-gameplay checks passed scene
rendering and race reloads, original textured cars/worlds, keyboard driving,
Carrier/Desert rewards and queued powerups. No fatal JavaScript, failed asset
requests or WebGL errors were reported. Chrome DevTools MCP also inspected the
original Newcity scene and localized crash damage with WebGL error0. Advanced
Desert screenshots were inspected after the native NULL-material inheritance
fix. These checks establish the browser shader and resource integration, not
bit-for-bit original hardware or software rasterization.
