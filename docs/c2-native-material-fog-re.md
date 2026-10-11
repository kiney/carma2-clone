# Native material-local fog state

Independent implementation: `src/native-material-fog.ts`. Original assets and executable remain read-only. No reference implementation was copied.

## Verified installed function

Installed HW SHA256: `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`. PE32 image base400000, entry577eb0, timestamp1998-10-18.

`FogAccordingToGPSCDE` is installed445050..4451d5; rec2 maps the symbol at4451a0. Its actual globals are current depth type75ac80, start75ac84, end75ac88, RGB75ac8c/90/94 and F32 base camera yon75f46c. The material stores are flags+20, fogMin+5c, fogMax+60 and fogColour+64. This is material-local state, not a global renderer fog replacement.

The jump table selects none−1, darkness0, fog1 and colour2. Darkness/fog/colour set flags bit80000 and store:

```text
negativeStart = signed32 NEG(start), including INT_MIN wrap
fogMin = F32(pow(10.0, double(negativeStart) * double(0.1)) * F32(baseYon))
fogMax = F32(pow(10.0, double(end)           * double(0.1)) * F32(baseYon))
```

Both constants are installed DOUBLEs:10 at588ca8 and0.1 at588cb0. There is no intermediate F32 exponent store, no range ordering, and no clamp. Darkness colour is0, fog colour00f8f8f8; colour mode computes `(((red << 8) | green) << 8) | blue` using source32-bit integer operations without masking each channel.

**Correction to rec2 and the initial static audit:** rec2's `pow(exponent,10)` argument order is wrong for this installed executable. The x87 CRT entry575fb0 takes the earlier-loaded10 as the base. Captured start−5/end8/yon35 produces min110.67971801757812 and max220.83506774902344; these are35×10^.5 and35×10^.8, not35×.5^10 and35×.8^10.

None−1 clears only bit80000 and retains historical fog distances/colour. Unsupported signed enum values retain all fields. Every branch calls `BrMaterialUpdate(material,0x7fff)` at4451c0..c6, including none and unsupported values. Infinity, underflow and arithmetic NaN are not converted into fallback distances.

## Numerical evidence

Private probe `/tmp/c2-material-fog-capture.c` reads the original into private memory, initializes its actual CRT control state through5798e0, and calls445050. Only the final MaterialUpdate service is replaced by a capture-safe callback. The original arithmetic and CRT pow execute directly. Probe/generator/input/output remain under `/tmp`, not tracked fixtures.

4,373 packets matched all four stored32-bit words against the implemented expression with zero differences: all enum branches, signed RGB payloads, INT_MIN/MAX, starts/ends around realistic and extreme depth ranges, 4,000 deterministic randomized packets, widely varying finite F32 yon, signed zero and F32 subnormal/max boundaries. Eight further targeted packets cover the actual track starts4/7, no-intermediate-F32 discrimination, NEG32 wrap, underflow, overflow and overflow×zero NaN. Source-initialized PC53 operation is the precision basis; this is not a universal promise about other FPU configurations.

Focused tests retain independently captured scalar words rather than proprietary assets. Stock and Advanced Newcity1, Airport1 and Carrier1 are read optionally through the real asset store and skip when absent. Their authored colour modes/start/end/RGB are checked before comparison against captured native fog distances with yon35.

JavaScript Math.pow matched these tested final F32 stores. Untested transcendental rounding boundaries remain a limitation; no exhaustive CRT equality claim is made. Numeric NaN is supported, but arbitrary retained NaN payload-bit ownership is outside this number-valued descriptor API.

## Host contract and phase

`applyNativeMaterialFog(material,depth)` returns a shallow descriptor with the new flags/fog fields and `updateMask:0x7fff`. It leaves the original material object untouched and retains identity-bearing payload references. The host applies these fields to the same actual registered MAT/render resource; this result is not a replacement MAT allocation. All integer inputs require native signed/unsigned storage, and existing fog values/baseYon require already-stored F32 values (including nonfinite values).

Temporary adaptation4ea4e0 and enabled4ea530 iterate pending pointer slots, skip NULL and retain duplicates. Each performs Glorify517d50 then fog445050; count clears afterward. Race startup503c49..53 uses shading1 then enables adaptation. Car-load48b36b..373 uses shading2 through the enabled owner. Disabled automatic adaptation retains pending entries. Base yon is distinct from a camera's multiplied clipping distance.

The kernel does not update texture wrappers, lighting, GPU state, pending lists, palette or animation. The existing slick registry's explicit adaptation callback owns those updates. BRender preparation maps FOG_LOCAL to LINEAR fog; exact hardware raster/colour-space agreement is separate. Palette nobbling/PIX8 palette animation is separate from this function and does not gate PIX16 slick adaptation.
