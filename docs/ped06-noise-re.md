# Pedestrian noise tables

`src/ped-noise.ts` parses the eleven ordered sound groups in each personality's
`PEDS/SOUND/*.TXT` file. Counts and IDs are retained in independent JavaScript
arrays, with a parser safety limit of 32 IDs per group. The installed packed
personality structure has eleven groups with room for five WORD IDs each.
`nativePedNoiseDiagnostics` reports groups that exceed that native capacity;
it does not truncate their authored choices.

The installed `MakePedNoise` (`0x4cd630`) selects an ID with inclusive
`IRandomBetween(0, count - 1)`. Empty groups do not consume a draw, and duplicate
IDs remain duplicated as selection weights. This module only chooses an ID;
sound loading, playback volume, and audio routing belong to the runtime owner.
The available rec2 `MakePedNoise` body is a stub, so no further behavior is
claimed here.

Both installed Stock and Advanced `SICKSOUNDS.TXT` files author seven entries
in group 3, beyond the packed five-ID capacity. The parser safely retains all
seven so playback can use those source choices. It does not emulate or claim
the original loader's behavior when writing this oversized group into its
fixed packed structure. The browser can issue the diagnostic while continuing
to play the authored choices.
