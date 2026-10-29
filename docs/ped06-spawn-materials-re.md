# PED-06 live spawn material markers

`markNativePedSpawnMaterials` implements the installed ReadPedSpecs identifier
mutation which precedes face spawning. Primary evidence is read-only installed
HW SHA-256 `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`,
PE32 base400000, entry577eb0, timestamp1998-10-18T20:13:36Z. rec2 supplies the
function map; installed instructions resolve its padding transcription error.
No reference implementation or original asset bytes were copied into source.

## Installed chronology and mutation

ReadTrack calls installed ReadPedSpecs4ca7a0 at5055bd, before ExtractColumns
40cc50 at5055ce. The latter reaches ProcessModelsCB40cf10, MungeFaces40d530
and SpawnPedsOnFace4d2a80. FinishUpLoadingPeds4d32f0 follows at5055d8.

ReadPedSpecs first resolves all configured spawn, exclusion and exception
material names into actual MAT pointers. Its second pass4caa43..4cab28 visits
spawn pointers in source spec order and mutates their live identifiers:

1.4caa65..4caa6f computes unsigned `strlen(identifier)-4` and skips padding
when this is greater than7.
2.Otherwise it copies the original string to scratch.4caab2..4caab6 addresses
`scratch+strlen-4`;4caab8..4caad4 writes the13-byte literal
`xxxxxxxx.MAT` plus terminator, independently verified at65d17c.
3.4caadf frees the old identifier,4caaf7 duplicates the new identifier under
the same MAT resource, and4cab09 publishes that string pointer.
4.4cab1d always stores `identifier[7]='?'`, including the no-padding branch.

The padding replaces the final four characters; it does not append after the
whole name. rec2's `strcpy(&s2[len],...)` differs from the installed address
calculation. For example, extensionless `CROSSING` becomes
`CROSxxx?xxxx.MAT`, whereas `CROSSING.MAT` becomes `CROSSIN?.MAT` without
padding. This unusual transformation is independent of whether the original
identifier actually ends in `.MAT`.

Installed SpawnPedsOnFace still requires the marker.4d2ad5..4d2ae2 rejects
unsigned `strlen-4<=7` or `identifier[7]!='?'`. Omitting the loader mutation
therefore produces an empty population from ordinary unmarked track names;
removing the callee predicate would conceal the missing loader owner.

## Host contract and validation

The helper accepts already resolved live MAT identities and mutates only
`name`. It preserves duplicate pointer visit order, skips explicit NULLs and
reports only changes to strings. All pointer/name resolution must complete
before this marker pass, including exclusion/exception and smash bindings
which still refer to the original names. The marker does not rename source
files, mutate installation assets, replace MAT objects or change their flags.

The installed short-name path is unsafe: it lacks rec2's minimum-length clamp,
and an identifier shorter than four bytes underflows the unsigned subtraction
before an unchecked byte7 write. The browser helper instead preflights every
non-NULL entry for a string of at least four non-NUL ASCII bytes before any
mutation. Unsupported strings return explicit provider requirements with no
partial writes. This atomic malformed-input rejection is a safe host boundary,
not a claim that native failure was transactional. Names outside ASCII require
an independently established byte encoding provider rather than JS UTF-16
indexing.

Six deterministic tests cover extensionless names, `.MAT` names, long names,
already marked short/long names, duplicate pointers and distinct equal names,
malformed-input atomicity, NULLs, order and unchanged material properties.
