# Asset-read retries and incomplete scene ownership

QUA-11 addresses browser loader failures, not a change to native C2 resource
lookup or acceptance of malformed assets. Original data remains read-only.

`Assets.bytes()` shares pending requests and keeps successful byte buffers for
the session. HTTP errors, network rejection and interrupted response bodies
remove their failed promise from the cache. Rejection removes only that exact
request: it cannot evict a newer replacement. Parsing errors still report the
invalid file; the loader does not silently replace it or accept corrupt data.

An `Assets.scene()` construction episode tracks its own material allocations,
model identities and local textures before publishing its successful owner.
If MAT, DAT, geometry or ACT construction fails, rollback removes only those
new registrations, releases their render wrappers and arena allocations, and
returns its storage reference. Earlier scenes sharing that storage retain their
identities, registration order and allocations. Rejected duplicate materials
remain rejected; failure cannot remove the accepted material they borrowed.
Geometry rejected while resolving its material slots is also released.

Successful episodes retain the existing shared-storage lifetime: final storage
release retires its registrations and local resources. Local texture ownership
includes loaded maps whose names were subsequently shadowed; installation-wide
and explicitly retained textures are protected. Disposal is idempotent.

The read-only original Eagle reproduction injected one ACT read error in
memory. Previously, 53 live material allocations/registrations and 25 model
registrations survived even `releaseRaceResources()`. They now return to zero
immediately after the failure. Retrying the same original scene succeeds, and
normal disposal returns to zero again. Synthetic tests exercise failure stages,
concurrent request sharing, retry, stale rejection, shared-storage preservation
and resource disposal without proprietary fixtures. These are loader ownership
checks; they do not establish all-day memory behavior or physical-GPU usage.
