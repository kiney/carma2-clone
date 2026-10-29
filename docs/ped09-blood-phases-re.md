# Ordinary pedestrian blood phases

`src/ped-native-blood-phases.ts` independently implements the numerical and
ordered cache phases between actual pedestrian contacts/poses and the existing
effect consumers. It uses native world-unit vectors, current native12 bone
matrices, the actual `0x12c` process storage and injected source owners. It does
not select a floor, score a death, allocate fragments or advance physics.

Evidence is **verified from the installed HW binary**, SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
The executable remains read-only. rec2 `common/pedestrn.c` supplied the symbol
map; installed addresses and instructions resolve its stubs/different image
addresses. Related evidence: [contact](c2-ped-contact-re.md),
[severing](c2-ped-sever-contact-re.md), [halt](c2-ped-halt-re.md).

## Contact packet and common emission boundary

Active `4d2389..4d23c8` emits after its actual caller damage/continuation gates:

```text
ratio = double(.068) / Float32(selected simple Object.mass)
force = Float32(effective first-row lambda * (ratio * ratio))
```

The point is the selected contact point; the optional speed owner is the actual
other Object, NULL for world. This is not the vector force length. Gore must be
positive and the current selected-volume gravity must be at least1, or NULL.
Passive `4cd9b0` has no separate contact DoGiblets call; its death continuation
can emit the ordinary FullKill packet. FullKill uses force`.4f`, ped.pos and
start size1. Active contact and mutant scraping use the authored scrape-start
integer, including zero.

`createNativePedImpactBloodPacket` keeps impact point and pedestrian position
distinct. It stores componentwise Float32 speed-owner world velocity multiplied
by double6.9; the downstream consumer must not multiply again. Seed is the XOR
of truncated point coordinates, actual time, actual pedestrian-record address
and actual optional speed-Object address. There is no synthetic pointer seed.
`DoGiblets4ccda0` gates the entire cloud/chunk operation at gore>0, not gore>=2.

Cloud ownership clarification: `407b00` simply returns the character's actual
root ACT. The personality-local bounds and Object+14 pointer pushed before it
remain arguments to `DoExplosion4eaa70`; Object+14 is the **local COM vector**.
Thus clouds use root ACT, local personality bounds and local COM offset. They
do not use world-transformed bounds or the impact point as their root origin.
The fragment consumer owns strict cloud thresholds and the common shared
fragment pool/RNG sequence.

## World smear accumulation and late consumer

After active DoGiblets, `4d23cd..4d26de` restricts patch accumulation to world
contacts with dead HP and eligible material. Existing `skidContactEligible`
implements the source exclusions: colour-map type`0x12`, or a 12-character
material identifier with `|` at index5. A missing face/process owner remains
explicit; no floor normal is fabricated.

The actual process fields are:

| Offset       | Native storage                                                     |
| ------------ | ------------------------------------------------------------------ |
| `c4`         | DWORD flags: bit2 current contact batch, bit1 previous valid batch |
| `c8`         | signed WORD shared skid-section ID                                 |
| `ca`         | wrapping BYTE contact count                                        |
| `cc`, `d8`   | retained section start/end vectors                                 |
| `e4`         | summed contact positions                                           |
| `f0`         | first contact normal                                               |
| `fc`, `108`  | previous mean position/normal                                      |
| `114`        | lateral vector                                                     |
| `124`, `128` | maximum/minimum lateral projections                                |

First contact sets count1 and stores point/normal. Its lateral vector is
`normal × normalized(worldV)`, with positive-X fallback when speed is not
strictly above Float32`2^-22`. X/Y lateral components spill before the initial
projection; Z remains live through that projection, then its retained field is
Float32. Later contacts preserve the first plane/lateral and require normal
dot strictly above Float32`.997` and absolute plane distance strictly below
Float32`.01`. All sums/extrema use source Float32 stores; count wraps modulo256.
Installed `4d2647` tests x87 C0 alone: an unordered plane comparison after a
wrapped count0 and `0/0` also continues. The kernel preserves this edge case.

`consumeNativePedWorldSmear` is called **once per late frame, after all contacts**,
for source-processed pedestrians. LastChance `4d5740..4d58df` clears trail bit1
when there is no batch or count<2. First valid batch arms the trail and sets
ID−1 without a section. Subsequent valid batches call the shared SkidSection
owner with mean point, retained normal/history, texture distance0 and
`Float32(max-min+Float32(.01))`. A nonzero native return clears trail bit1;
current mean/normal are retained either way. The installed constant at589ba4
is negative Float32`.01`, not `.1`.

LastChance does **not** clear batch bit2. The next ordinary process-cache visit
already does that. Calling this consumer twice within one frame is not a native
mainloop operation; the API does not invent an extra timer/token or change the
source flags to conceal a duplicate host call.

## Post-pose bleeding and stump order

Installed inline MakeEmBleed `4d4dad..4d5158` follows successful outer pose and
head-model work. Its selected-volume/gore gates precede all RNG and cache work.
The injected `globals.lastMutantBleedTimeMs` is shared across pedestrians and
represents persistent global69eab8, not a per-ped timer. With mutant speed
nonzero, HP<=0, action6 and unsigned elapsed strictly greater than300, draw
PercentageChance40. On success write the global timestamp before emitting
DoGiblets force`.06f` at ped.pos with NULL optional speed Object.

Removed-member emission additionally requires nonzero removed mask, a process
cache and unsigned `(now-cache88)>unsigned(cache84)`. For dead HP, multiply the
unsigned period by **double1.2**, truncate/store low32; values above1000 become0.
Write cache88=now before processing nonvanished removed bones1..N−1:

1. Read the actual detached Object world velocity and counter BYTE`23+index`.
   If counter<authored lumps-per-emission and speed squared is0, zero counter
   and skip the detached side. Otherwise subtract the low byte of the authored
   count from a nonzero counter, wrapping BYTE, then emit from the current bone
   matrix and child attachment with matrix row0 as look.
2. The parent side observes that **already updated** counter. A removed parent
   supplies its actual detached velocity and requires nonzero counter. An intact
   parent supplies character world velocity. Emit when velocity squared is
   nonzero or updated period is nonzero, using parent attachment/current matrix.
3. Nonroot parent look is its matrix row0. Root-parent look comes from installed
   table65d064: +Y, four −Y, two +X, two −X. The caller applies the root matrix
   to this vector, then DoSpurt applies the matrix again. The kernel preserves
   that double transform rather than replacing it with an assumed world look.

`createNativePedSpurtBloodPacket` follows `DoSpurt4d55f0`: attachment ApplyP,
look ApplyV, Float32(worldV\*double6.9), seed truncated world point XOR actual
time. It neither normalizes the look nor draws RNG. The synchronous emission
consumer owns captured rand/srand/spawn/restore, priority1 and authored stump
position/speed/model/lifetime. No extra gravity or dt enters these phases.

## Provider boundaries and checks

The phase preflights current matrices, actual detached velocities, emission and
percentage-CRT owners before mutating source counters/timestamps or drawing.
An optional packet preflight lets the production consumer prove its resources
at the same boundary. This bounded unsupported-provider behavior avoids partial
state/RNG mutation; complete supported execution retains native effect order:
mutant chance/emission, stump timer, each child's counter/emission, parent
emission. Emission callbacks run immediately, so their shared CRT effects are
visible before the next source emission.

Tests exercise numerical mass scaling, source seed/velocity units, material and
strict plane gates, wrapping count, shared skid state/width, untouched batches
on missing owners, attachment/current-matrix transforms, double root look,
stump counter underflow, dead period growth/exhaustion, removed-parent ordering,
shared mutant40%/strict300ms/unsigned-wrap timing, once-per-visit timer gates,
chronology and no RNG/state mutation on missing providers. Float32 stores are
explicit; JavaScript live arithmetic is not claimed to reproduce every x87
intermediate rounding boundary.
