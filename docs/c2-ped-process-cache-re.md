# Native pedestrian process-cache owner

`src/ped-process-cache.ts` independently implements the installed bounded
process-record selection and selective initialization in MungePedestrians. It
supplies stable records compatible with `NativePedGameplayCache`. It does not
wire the normal population, create unlimited per-pedestrian caches, or implement
the missing normal movement/proximity/scare owner.

## Installed evidence

Primary executable: installed HW SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`, image base
`0x400000`, entry `0x577eb0`, timestamp `1998-10-18T20:13:36Z`. Original data and
executables were read only. `madebr/rec2` `pedestrn.c` / `rec2_types.h` supply the
symbol and layout map; addresses below come from the installed binary, not
unverified reference annotations.

| Installed evidence   | Meaning                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `0x4d386b..0x4d3877` | Initialize only when ped+0c is NULL or replay singleton                                  |
| `0x4d387d..0x4d388c` | Replay chooses singleton `0x6929b8`                                                      |
| `0x4d388e..0x4d38ba` | Scan100 records; timestamp+74, owner+b4, stride0x12c                                     |
| `0x4d38bc..0x4d38e4` | Selected normal record address `0x692b50 + index*300`; assign new ped+0c                 |
| `0x4d38e7..0x4d38ed` | Full-pool eviction clears displaced owner's ped+0c                                       |
| `0x4d38f0..0x4d3900` | Clear borrowed face-list owner+14, then process+b0                                       |
| `0x4d3906..0x4d3923` | SetNextRandomTurn: max0 writes0; otherwise IRandomBetween512f00 then uint32 now+interval |
| `0x4d3926..0x4d399a` | Selective InitProcessData stores                                                         |
| `0x4d39a2..0x4d39b7` | Every processed visit stores owner+b4, now+74 and clears process+c4 bit2                 |
| `0x512f00..0x512f21` | Exact interval source: one shared CRT draw, signed32 multiply/division, add minimum      |
| `0x575f80`           | Installed shared MSVC CRT rand                                                           |

The first free record in array order wins, even when an earlier occupied record
has an older timestamp. When all records are occupied, initialize candidate0
and oldest=`(now+1) mod 2^32`; replace only for an **unsigned strictly smaller**
stored timestamp. Equal timestamps retain the first candidate. At now
`0xffffffff`, oldest wraps to0 and no timestamp can replace candidate0. This
is absolute timestamp selection, not elapsed-age sorting or a modern LRU policy.

The reference allocator has transcription errors (`[i]` within its `[j]` scan
and no first-free break). The installed loop at `0x4d389e..0x4d38ba` and the
first-free branch to `0x4d38bc` resolve those errors.

## Exact selective stores

Before initialization, the new ped pointer is assigned. Only full normal-pool
eviction clears the displaced ped pointer. Reinitialization next releases the
selected record's borrowed face list, clears its process pointer, and calls the
turn RNG when movement max interval is nonzero. It does not release the actual
process record or its character/FORM/PHIL resources.

| Offset                                   | InitProcessData effect                                         |
| ---------------------------------------- | -------------------------------------------------------------- |
| `+b0`                                    | NULL after clearing the borrowed face-list owner at face+14    |
| `+7c`                                    | next-turn deadline or0                                         |
| `+18`, `+19`, `+21`                      | zero individual bytes; +19 is halt retry count                 |
| `+6c`                                    | zero direction-interpolation timestamp                         |
| `+80`                                    | zero cached run period/speed                                   |
| `+c0`                                    | NULL killer reference                                          |
| `+1c`                                    | NULL head sequence pointer                                     |
| `+2e`                                    | zero cause WORD, distinct from pedestrian/rigid flags          |
| `+a0`                                    | signed DWORD -1                                                |
| `+9c`, `+88`, `+8c`, `+94`, `+90`, `+98` | zero DWORDs; +98 is signed napalm state/deadline               |
| `+84`                                    | actual global gPed_spurting_period (`0x692aec`)                |
| `+c4`                                    | clear bit1; each processed visit subsequently also clears bit2 |
| `+23..+2c`                               | zero exactly10 stump-counter bytes                             |

All other bytes remain untouched, including both vectors at +00/+0c, head
index+1a/time+78, run factor+b8 and opaque retained fields. An initially allocated
zero record has floor normal `[0,0,0]`; initialization does not invent +Y or copy
the current support face normal. Actual native proximity work owns later vector
writes. The stock/Advanced SETTINGS `SPURTING STUMP GIBLETS` second integer is100
milliseconds. The module requires the actual loaded global explicitly; callers
store the signed authored value with `>>> 0`, matching the native DWORD store.

## Ground-face and retained-vector owners

The borrowed face slot's `+14` is the **pedestrian pointer**, not the process
record: `0x4d2088` stores the ped, then `0x4d2090..0x4d2093` stores the slot at
that ped's process `+b0`. Ground-slot eviction dereferences slot `+14` to the
ped, then ped `+0c` to its current process record, and clears process `+b0`
(`0x4d1fe2..0x4d1fec`). A Ped-keyed ground pool therefore preserves the correct
identity. The currently acquired process record must still own all retained
scalar/vector/head state; a permanent per-pedestrian snapshot is insufficient.

`RescanPedProximity` at installed `0x4cf860` first requires nonNULL process `+b0`
and selected face pointer at slot `+30`. It then copies the selected cached
face's packed normal `+34/+38/+3c` verbatim into process `+00/+04/+08`
(`0x4cf899`, `0x4cf8a4`, `0x4cf8b2`). It normalizes a supplied direction or,
when absent, the character's `+c0` direction; the degenerate-vector fallback is
`[1,0,0]` (`0x4cf9a6..0x4cf9b6`). The resulting direction is stored at process
`+0c/+10/+14` (`0x4cf9cf`, `0x4cf9db`, `0x4cf9f0`). These are proximity-phase
writes, not initialization. Grounding must bind/read/write the live process
record after acquisition or reuse. Its eviction adapter must clear only the
specific borrowed face owner's link in native order, rather than reset the
entire retained ground-cache owner before process eviction.

## Replay and offscreen ownership

NULL plus replay selects the one singleton. A singleton pointer is reinitialized
on **every** processed visit, including repeated visits by the same ped. Prior
pedestrians retain their alias to that shared singleton. A previously acquired
normal record remains normal when replay turns on; it takes the retained path.
Leaving replay with a singleton pointer acquires a normal record and leaves the
singleton's old owner field intact, as the source does.

The ordinary offscreen Munge branch releases render/physics resources and skips
this allocator. It neither frees the process record nor refreshes its timestamp.
Therefore the module deliberately has no offscreen release, TTL, eviction by
distance, or per-person lifetime policy. A race-level source reset is a distinct
owner: the reference InitPedsForRace zeroes the entire normal pool as part of
starting a new pedestrian array. This module exposes fresh construction, not an
unproved mid-race reset/release routine.

## Host API

```ts
const process = new NativePedProcessCachePool<Owner, ActualFaceList>({
  readCache: (owner) => gameplay.state(owner).cache,
  writeCache: (owner, cache) => {
    gameplay.state(owner).cache = cache;
  },
  randomTurnInterval: (min, max) =>
    pedRandomInteger(sharedNativeRandom.random, min, max),
  releaseFaceCache: (face, record, oldOwner) => {
    // Actual borrowed-list owner and process+b0 must refer to this same list.
    // Bind the real grounding resource owner; never clear unrelated caches.
    releaseActualBorrowedFaceList(face, record, oldOwner);
  },
});
const visit = process.visit(owner, {
  timeMs,
  replay,
  minTurnIntervalMs: movement.minTurnMs,
  maxTurnIntervalMs: movement.maxTurnMs,
  spurtingPeriodMs: actualLoadedSpurtingPeriod,
});
```

This illustrative host requires a gameplay/cache adapter with the narrower
actual record type; no runtime or gameplay file is changed in this handoff.
Initialize the gameplay owner with cacheNULL, then invoke `visit` only after
successful processed FORM/simple-body admission, before grounding/AI/BON. A
NULL process pointer is valid before that phase and after eviction. The host
stores the real pointer on the real owner; the pool substitutes no unlimited
internal owner Map.

Stable records expose named scalar accessors, vectors, head-sequence accessors,
the10-byte stump view and a300-byte numeric/opaque storage buffer. Setters use
the original integer width/Float32 representation. Vectors are copied on read;
write them through their property setter. Actual JS owner/killer/borrowed-face
identities are separate reference fields. This storage does not invent Windows
addresses for JS objects and must not be treated as a native-pointer image.
Known head table addresses are actual source data identities, unlike an invented
actor/material pointer ordinal.

Missing turn or borrowed-face release providers return explicit diagnostics
**before** pointer mutation, eviction, reset stores or RNG. That preflight is an
integration safeguard; the original has concrete owners and no diagnostic
failure branch. Supplied callbacks run in source order. Their failure cannot
retroactively undo already executed native-prefix effects. Invalid foreign
record identities, inconsistent displaced links, unsupported head addresses or
invalid finite/width stores throw explicit errors. No absent provider is treated
as a completed source callback.

## Numerical capture and tests

A private 32-bit mapper ran the installed inlined block `0x4d386b..0x4d39b7`,
returning before its next GetPedPos call, on invented pool/owner/face records.
The installed IRandomBetween and CRT RNG ran unchanged. Seed `0x43414348`, LCG
`s=(1664525*s+1013904223) mod 2^32`, generated1,000 cases spanning first-free/full
selection, equal/unsigned/wrapped timestamps, NULL/normal/singleton prior links,
ordinary/replay visits, opaque-byte retention, actual turn draws and signed
IMUL overflow. Comparison checked six semantic ownership/RNG outputs and292
record bytes per case: **0 differences in298,000 fields**. The8 face/owner
pointer bytes were excluded from numeric comparison and checked by actual
null/owner outputs instead. Executable mapping, C harness and numerical captures
remain under `/tmp`; no asset payload is committed.

The focused tests check these boundary and lifetime semantics, preflight ordering,
all selective stores versus preserved bytes, shared CRT progression, invalid
identities, and read-only Stock/Advanced movement settings. Original tests honor
`CARMA2_ROOT` and skip cleanly without an installation. Production normal-ped
grounding/scare/powerup/award integration is a separate root-owned task.

## Current-root grounding binding

`NativePedGrounding.readProcessCache(owner)` binds the actual current Ped+0c
record on every read/write. Its canonical floor/direction and b0 pointer no longer
come from an unlimited per-Ped shadow. A missing process record is an explicit
provider; reacquisition uses the retained bytes of the selected bounded record.

The ground-cache slot keeps stable copied face record identities and slot+30
selection, including records beyond a later shortened count. Repreparation retains
the selection until the finite query return stores the new pointer at4d20d3.
Ground-list eviction clears the displaced Ped's current process+b0. Process Init
uses `releaseBorrowedFaceSlot(slot)` after the old Ped+0c is cleared; completion
uses `releaseFaceCache(owner)` while retaining floor/direction/head history.
Replay singleton bypass observes aliases without relinking another Ped's slot.

Numerical tests cover reuse of the real100-record process pool alongside the85
borrowed ground slots, selected-face write chronology, replay aliases, completion
and reset. Normal scene population still uses the legacy owner; full ordinary
proximity/move/scare and ordered native collector providers remain open (PED-03).
