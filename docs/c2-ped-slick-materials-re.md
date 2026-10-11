# Native pedestrian slick material resources

`src/ped-slick-materials.ts` implements the independently reconstructed ordinary
GIBSLICK/GIBSMEAR resource registration bridge and temporary-material lookup.
It uses the installed textures and parsed MAT data, retains shared material
identity, and separates registration from later native lighting/fog adaptation.
It does not generate spill geometry, replace the existing shared oil-slot owner,
or claim complete native race material rendering.

## Evidence and executable identity

Primary evidence is the installed `carma2_HW.exe`, SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`, PE image
base `0x400000`, entry `0x577eb0`, timestamp `1998-10-18T20:13:36Z`. Analysis and
isolated captures read the installation without modifying it. `madebr/rec2`
`pedestrn.c`, `skidmark.c`, `temp.c`, `loading.c`, and `utility.c` provided the
symbol map. Implementation is independent; no reference implementation or
proprietary asset content is included in these source files.

| Installed address                           | Verified operation                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `0x4cb1ae..0x4cb287`                        | ReadPedGiblets GIBSLICK material allocation, registration, initialization and Glorify(0)       |
| `0x51e880`                                  | BrMaterialAllocate: allocate 156 bytes, copy 39-DWORD default descriptor, duplicate identifier |
| `0x525f80..0x526026`                        | Installed SetupDefaultMaterial; white colour/opaque byte at `0x525fac` / `0x525fb9`            |
| `0x51e490` / `0x51e4e0` / `0x51e630`        | BrMaterialAdd / BrMaterialFind / BrMapFind                                                     |
| `0x4e99b0`, especially `0x4e99df..0x4e9af8` | InitSkids: find existing material or load/Glorify(4)/register                                  |
| `0x48edd0`                                  | Installed LoadMaterial used by InitSkids                                                       |
| `0x4ee3b5..0x4ee3ef`, `0x4ee4a4..0x4ee4d6`  | ReadSpillData inline LoadTemporaryMaterial for primary/smear material                          |
| `0x4ea590`                                  | TemporaryMaterialStore append with capacity 200                                                |
| `0x4ea4d0`                                  | Initialize temporary adaptation count to zero                                                  |
| `0x4ea4e0`, `0x4ea530`                      | FogificateMaterials / auto-enabled AdaptCachedMaterials                                        |
| `0x4ea5b0`, `0x4ea5c0`, `0x4ea5d0`          | Enable/disable auto adaptation; replace matching pending pointers with NULL                    |
| `0x517d50..0x517f5a`                        | GlorifyMaterial renderer exceptions and shading coefficients                                   |
| `0x445050`                                  | FogAccordingToGPSCDE called after Glorify for each pending material                            |

The reconstructed ReadPedGiblets function-start annotation is not the installed
start of the material sequence. The installed addresses above are the evidence.
Also, the GIBSLICK colour-map lookup at `0x4cb25b` calls BrMapFind, although the
reference map labels that colour-map expression as BrTableFind.
The installed SetupDefaultMaterial address is `0x525f80`, rather than the
reference annotation `0x526940`; BrBegin stores its result in the default
material pointer `0x79c95c` at `0x524f4d`.

## The two original materials

GIBSLICK has no authored `GIBSLICK.MAT`. The original creates that material after
loading the giblet resources:

1. Allocate identifier `GIBSLICK`, store global pointer `0x69a2a0`, and add that
   exact pointer to the material registry before customizing it.
2. Set LIGHT (`1`), PERSPECTIVE (`0x20`), SMOOTH (`4`), ambient
   `Float32(0.99)`, diffuse/specular/power zero, identity UV transform, and zero
   index-base/index-range. Original default colour/opacity is white/255.
3. Find `IDENTITY.TAB` and the already registered `GIBSLICK` PIX.
4. Glorify with shading type 0, then update the material with flags `0x7fff`.

The bridge records the procedural _pre-Glorify_ descriptor separately from its
effective descriptor. It loads the original
`<tree>/PEDS/GIBLETS/<PIX8|PIX16>/GIBSLICK.PIX`. It does not synthesize a red
texture or pretend that there is an authored MAT.

Normal-mode GIBSMEAR comes from `<tree>/MATERIAL/GIBSMEAR.MAT`; its internal
identifier is **`GIBSMEAR.MAT`**, and its colour-map identifier is **`GIBSMEAR`**.
Both Stock (`data`) and Advanced (`adv_data`) originals have:

| Field                                | Authored value                               |
| ------------------------------------ | -------------------------------------------- |
| RGBA                                 | `[255,255,255,255]`                          |
| ambient / diffuse / specular / power | `Float32(.2)` / `.5` / `Float32(.05)` / `20` |
| flags / UV                           | `0` / identity                               |

InitSkids first uses BrMaterialFind. An existing pointer bypasses loading and
initialization; this is the purpose of `registry.addBorrowed(resource)`. When
absent, the original loads `GIBSMEAR.PIX` and `GIBSMEAR.MAT`, Glorifies with type
4 (ambient-only), and registers the result. The bridge uses the original
`<tree>/PIXELMAP/<PIX8|PIX16>/GIBSMEAR.PIX`. Alternate sausage-mode skid materials
are outside this ordinary GIBSMEAR bridge.

Both original PIX16 resources are nameless 64×64 RGBA4444 pixelmaps (type 18).
GIBSMEAR contains all 16 nibble-alpha values, including partial alpha: opaque
MAT opacity is insufficient to decide texture blending. Both PIX8 resources are
indexed type 3 without an embedded palette. The module requires the actual
render palette for PIX8 and returns `source-slick-PIX8-render-palette` when it is
missing; it does not use the parser's grayscale fallback as original colour.
Both inspected data trees expose `Reg/PALETTES/DRRENDER.PAL` through the original
`PALETTES.TWT` archive, even though no physical PAL file appears in the unpacked
directory. The virtual asset manifest resolves it; `Assets.common` already
loads the Stock palette. Its type7 pixelmap contains256 authored colours. PIX8
original-installation tests explicitly bind the respective tree's palette and
check coloured pixels as well as transparent index0. A shade table remains a
separate resource and is not a replacement palette. Native palette mutation
and animation are separate from this initial resource-colour check.

## Glorify arithmetic and capture

The original reads interpolation global `0x74b0d8`, antialiasing `0x74b0c0`,
perspective `0x74abf4`, and the linked texture-exception list `0x74aba4`. Exception
lookup is case-insensitive and uses the **PIX identifier**, not the MAT name.
For a non-NULL colour map:

- interpolation adds `0x20000`, unless exception bit 1 is set;
- interpolation plus exception bit 8 replaces both UV translations with
  Float32 `.02` (`0x3ca3d70a`);
- antialiasing adds `0x10000`; perspective adds `0x20`.

These operations only OR quality flags: later calls do not clear previously set
bits or restore the UV translations. Shading runs after these texture operations.

| Type          | ambient     | diffuse     | specular    | Flag mutation                              |
| ------------- | ----------- | ----------- | ----------- | ------------------------------------------ |
| 0             | 1           | 0           | 0           | unchanged                                  |
| 1 Default     | Float32(.2) | Float32(.8) | 0           | clear PRELIT (`2`), set LIGHT/SMOOTH (`5`) |
| 2 Specular    | Float32(.6) | Float32(.2) | Float32(.8) | same                                       |
| 3 Diffuse1    | Float32(.4) | Float32(.8) | 0           | same                                       |
| 4 AmbientOnly | 1           | 0           | 0           | same                                       |

Power is unchanged. The type-3 jump table entry at `0x517f68` targets
`0x517ebc`, then jumps to `0x517f06`; it sets diffuse/specular and flags as well
as ambient. Treating type 3 as an ambient-only assignment is incorrect.

An isolated private 32-bit PE mapper invoked the installed `0x517d50` directly
on invented material/PIX/exception records. A deterministic seed `0x534c4943`
and LCG `s = (1664525*s + 1013904223) mod 2^32` generated 1,000 cases over types
0–4, all eight renderer-quality combinations, exception absence/0/1/8/9, NULL
and non-NULL colour maps, arbitrary initial uint32 flags, nontrivial UVs and
coefficients. Comparison of ambient/diffuse/specular/power, flags and six UV
Float32 bit patterns produced **0 differences in 11,000 fields**. The executable,
mapper and capture files remain under `/tmp`, not in the repository.

## Temporary lookup and ownership

LoadTemporaryMaterial is an inline registry-find operation, not a file loader:
missing BrMaterialFind calls FatalError(120). A successful lookup returns the
same pointer, appending it to global list `0x6a19d0` only if count `0x6a53c8` is
less than 200. Duplicate entries are retained. A full list still returns the
valid material; NULL removal keeps the count and does not compact holes.

`loadTemporaryMaterial(name)` preserves that literal identifier behavior:
`GIBSLICK` and `GIBSMEAR.MAT` resolve case-insensitively; `GIBSMEAR` is not silently
accepted as the MAT name. Native fatal absence is exposed as an explicit
provider-required result instead of fabricating a material.

Use one registry across the actual installation/tree/render mode and all its
pedestrians/spills. Its pending list is deliberately limited to the resources
registered with this bridge; it is **not** evidence that the engine-wide
temporary list for unrelated skid/track/effect materials is integrated.
`dispose(releaseProof)` requires the host to confirm that render borrowers have
released these materials. It disposes only owned MATs, owned source PIX textures
and declared UV wrappers; borrowed registered resources survive. It adds no
per-pedestrian clones, timers, TTL or eviction.

## Production adapter and remaining constraints

```ts
const registry = new NativePedSlickMaterialRegistry(assets, {
  dataRoot: "data", // or "adv_data", actual selected installation
  pixelmapDirectory: "PIX16", // actual renderer resource mode
  textureQuality: actualTextureGlobalsAndExceptionLookup,
});
const prepared = await registry.prepare();
// Check status/requiredProviders before binding a recovery-effect host.
const primary = registry.loadTemporaryMaterial("GIBSLICK");
const smear = registry.loadTemporaryMaterial("GIBSMEAR.MAT");
// prepared.materials has "gibslick"/"gibsmear" keys consumed by
// queueNativePedCorpseSlick; source resource identifiers retain their spelling.
```

The public `Assets.resolve`, `bytes` and `pixelmaps` methods perform actual
bounded parsing and texture creation. A private per-registry PIX map prevents
Stock/Advanced name collisions and does not overwrite `assets.textures`.
Per-MAT texture wrappers borrow the same source image while retaining separate
UV/sampler state. The scene's private generic Lambert conversion is not used:
it does not represent initial unlit/ambient-only coefficient semantics and
decides transparency from MAT opacity without the required PIX16 alpha.

The bounded default mapper supports the two initial ordinary resources, their
actual type-3/type-18 alpha, UV transform, culling flags, material opacity and
quality flags. It uses MeshBasicMaterial for unlit or ambient-1/diffuse-0/
specular-0 descriptors; PRELIT, nonzero diffuse/specular and unknown effect flags
require `mapMaterial`. The BRender-to-WebGL sampler/raster bridge is a scoped
adaptation, not a captured claim of exact original D3D filtering, depth or colour
conversion. Source flags and arithmetic are verified; supporting driver details
(type-18 texture blending and independent depth write) are reconstructed from
rec2's BRender material and D3D driver maps.

Later FogificateMaterials (`0x4ea4e0`) visits each non-NULL pending pointer,
Glorifies it, then calls FogAccordingToGPSCDE, finally zeroing count. The automatic
variant (`0x4ea530`) leaves the list unchanged if global enable `0x6a6928` is zero.
The caller owns that enable gate. `adaptCachedMaterials(type, actualInPlaceHost)`
implements the ordered adaptation outlet: it supplies the exact next effective
descriptor, preserves MAT identity, and clears the pending list only after
successful host processing. An absent actual lighting/fog owner returns
`native-temporary-MAT-glorify-and-fog-owner` and retains the list. A host-reported
partial failure also retains pending entries; that diagnostic behavior is an
explicit safe integration extension, not an original recoverable failure branch.

Registration with modes 0/4 therefore works for the controlled native recovery
wrapper; it does not imply that Default-mode race lighting/fog is complete.
Spill geometry, PHIL/render registration, chance, delay/latch and the shared oil
slot lifecycle remain with `ped-slick.ts`, `OilRuntime` and their actual owners.

## Validation

`tests/ped-slick-materials.test.mjs` checks initial resource descriptors, shared
identity/coalesced loads, capacity 200 and NULL holes, all coefficient modes and
exception flags, bounded alpha/UV/sampler mapping, explicit missing providers,
retry, ordered duplicate adaptation and owned/borrowed disposal. Read-only
Stock/Advanced tests parse the real MAT/PIX resources, verify every decoded PIX
byte against the existing parser, and check partial alpha and shared lookup.
Original tests honor `CARMA2_ROOT` and skip cleanly when installation is absent.

No production population switch, build or browser run is part of this isolated
material-module handoff. The root-owned native recovery wrapper is the intended
next real-host validation seam.
