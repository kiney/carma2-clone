# Powerup group conflicts, renewal and field reset

## Executive Summary

PUP-18 corrects missing authored group cancellation. In the installed C2 binary,
Hot rod followed by Greased tyres removes Hot rod before assigning the tyre
factor: engine and suspension return to defaults immediately. The former browser
implementation retained engine factor 8 and Hot rod suspension. Timers belong to
individual POWERUP.TXT definitions, not action numbers. Renewing the same record
refreshes its deadline without a reset; different records can remain active when
their group masks do not intersect. Reset handlers assign defaults and never
reinstate an earlier effect.

The implementation has deterministic synthetic and read-only original-data
coverage. Application/browser validation is recorded separately; these numerical
checks do not establish rendering or full powerup subsystem parity.

## Evidence and revision

Evidence below is **verified by static inspection of the installed original HW
binary**, with authored values read from the original installation. It is not an
original-game behavioral recording. The HW SHA-256 was rechecked as
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`;
SW as `15d08246a43446364e7e8308a434da1821e5aef224b3692f14dadd312949611d`.
HW metadata is PE32 i386, image base 0x400000, entry RVA 0x177eb0,
timestamp 1998-10-18 20:13:36 UTC. These match the revision recorded in
[c2-physics-re.md](c2-physics-re.md). Addresses here are installed HW VAs.

[rec2](https://github.com/madebr/rec2) was consulted first as the function map.
Its source page/raw fetches were unavailable in this session, and no local rec2
checkout was available. The conclusions here come from installed disassembly,
existing verified function mappings and local original data. No reconstruction
code was copied or vendored; rec2 is GPL-3.0, while this implementation is
independently expressed within this repository's MIT code.

| Operation                 | Address and observation                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Definition layout         | `GotPowerupX 0x4d8f5b–0x4d8f6b` computes catalog record `base + index * 0x8c`.                                                                                                                                                                                                                                                                                                    |
| Incoming conflict scan    | `0x4d9017–0x4d9115` scans the catalog in ascending index order. `0x4d9031/33` skips the incoming record itself. `0x4d9039` requires the older record to be active.                                                                                                                                                                                                                |
| Group test                | `0x4d9042/46` loads/tests 16-bit group values at record `+0x10`. The loader stores that field as a word at `0x4d9944`. Upper bits of configuration integers are discarded.                                                                                                                                                                                                        |
| Removal before assignment | For an intersection, `0x4d9050–0x4d905c` calls the older record's reset handler; `0x4d90e2` clears its indexed deadline and `0x4d9103` clears its active timestamp. Only after the full scan does `0x4d9135–0x4d9153` call the incoming got handler. This order applies to instant as well as timed incoming effects.                                                             |
| Renewal and duration      | Loader `0x4d9851–0x4d9870` distinguishes instant duration `<0`, whole-race duration `0`, and timed duration `>0`. `0x4d9273–0x4d92c9` marks whole-race/timed records and stores the timed deadline as current time plus duration. The same record was excluded from conflict loss, so renewal does not reset it first. Instant setters do not acquire an active lifecycle record. |
| Expiry                    | `DoPowerupPeriodics 0x4db05a–0x4db290` visits the same catalog order. `0x4db092/95` retains a timed effect only while unsigned now is below its deadline; equality expires. `0x4db0a4–0x4db0af` invokes the reset; `0x4db12c` and `0x4db265` clear deadline/active state.                                                                                                         |
| Explicit removal          | `LosePowerupX 0x4db410` invokes the reset of an active record and clears its indexed lifetime.                                                                                                                                                                                                                                                                                    |
| Cancellificator           | Action51 got handler `0x4dfd50`, active scan `0x4dfd6f–0x4dfe8f`: invokes reset handlers and clears active records in catalog order. Extra native pedestrian/global side effects later in that handler are outside this field-lifecycle change.                                                                                                                                   |
| Charged commands          | `GotPowerupEarwig 0x4d8b10` places supported command inventory without invoking `GotPowerupX`. Command use at `0x4db365` enters `GotPowerupX`, so conflict removal precedes the command callback even if it returns failure. A failed command retains its charge; group removals have already happened.                                                                           |

Native timers are per definition. The browser's active list is kept in catalog
order, records renewal by definition index, and removes conflicts using the low
16 bits of both group values. The old action-wide replacement incorrectly erased
independent same-action records whose masks did not overlap. For such modded
records, expiration of either record can reset their shared field even while the
other record remains active. This is intentional source behavior.

## Shared motion fields

| Handler                                           | Assigned/reset fields                                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine action9: `0x4dc840`, reset `0x4de3d0`      | Got assigns engine `car+0x4d4`, grip `car+0x4d0`, then calls `AdjustSuspension 0x41fc80`. Reset assigns both factors to 1 and default suspension. |
| Suspension action20: `0x4dcc90`, reset `0x4de560` | Assigns authored front/rear give, front/rear extra length and damping. Reset assigns default suspension only.                                     |
| Grip action21: `0x4dcce0`, reset `0x4de590`       | Assigns grip; reset assigns grip 1 only.                                                                                                          |

Stock and Advanced tables have the following motion conflict masks:

| Definitions                                               | Group |
| --------------------------------------------------------- | ----- |
| Hot rod5, Turbo34, Mega-turbo35, Nitrous49, Afterburner51 | 7     |
| Jelly suspension23, Rock springs40                        | 4     |
| Greased tyres26, Grip-o-matic42                           | 2     |

Consequently grip and suspension pickups coexist; either conflicts with an
engine pickup. Replacing engine with grip resets engine and suspension before
assigning grip. Replacing engine with suspension resets engine and grip before
assigning suspension. Replacing either/both with engine performs their resets
first, then assigns all engine parameters. Removed records cannot later expire
and clear the new effect. No former effect is restored.

The existing application suspension object reference remains a setter-event
identity. A group reset produces a new defaults object, so the application
applies it even when the incoming effect changes only grip. An unchanged active
powerup does not continually reapply its suspension after a bend or repair reset.
No suspension force formula or application frame ordering was changed.

## Validation and boundaries

`tests/powerup-overlap.test.mjs` checks both pickup and debug grant paths,
conflict/reset order, disjoint groups, same-record renewal, independent
same-action/zero-group lifetimes, uint16 edge bits, exact expiry, whole-race and
instant distinctions, immediate/unsupported incoming outcomes, and inventory
collection versus failed command use. A reset dispatch observer additionally
checks catalog ordering for conflict loss, expiry, cancellificator and disposal.

Original-data cases read both `data/powerup.txt` and `adv_data/powerup.txt` and
Eagle3/buggy mechanics through the read-only asset store. They verify authored
masks, scalar transitions and spring/damper/travel conformance across engine,
grip and suspension sequences. Given base axle give `g`, multiplier `m`, extra
length `e` and damping multiplier `d`, the independent checks require:

- spring = base spring / m;
- damper = base damper \* d / sqrt(m);
- suspension length = ride height + g\*m + e.

Original-installation checks skip cleanly if the installation is unavailable.
Synthetic fixtures remain redistributable. Existing tests formerly describing
renewal using _different_ zero-group definitions now use a repeated grant of the
same definition; fixture replacement cases explicitly supply their conflict mask.
The opponent fixture likewise uses the verified original opponent mask 64 and
cop mask 128, and verifies that group replacement runs reset before assignment.

Implementation validation on 2026-10-24: directly invoked `powerups.test.mjs`
passes 28 tests, `powerup-overlap.test.mjs` passes 11, and
`opponent-powerups.test.mjs` passes 4. With `CARMA2_ROOT` pointing to an absent
installation, overlap coverage passes its 9 synthetic tests and cleanly skips
the 2 original-data cases. `tsc --noEmit` and the changed-file whitespace check
pass. Separate command-powerups and drink-driving test files also pass.

Unsupported handlers still report unsupported events and do not acquire invented
behavior/lifetimes. Their incoming group cancellation is known from the common
native path, but their own missing side effects and subsequent lifetimes are not
claimed implemented. Native networking, multi-day uint32 clock wrap, positive
keyboard budgets such as Afterburner, the full generic inventory grammar and
cancellificator's additional pedestrian/global resets remain outside this
change. Existing supported inventory dispatch and debug authorization are
preserved. Application integration was additionally checked with `tests/browser-motion-powerups.mjs` in headless Chromium using SwiftShader: original Eagle3 and Buggy accepted the normal debug-grant sequence Hot rod → Greased tyres → Jelly suspension → Hot rod → Jelly suspension. Actual player engine/grip fields, spring/damper/travel and active definition identities matched the native-derived expectations. Expiry returned original suspension; the existing keyboard-drive, bounce, wall-climb, gravity and pinball checks also passed, with no fatal console/network errors and WebGL error0. The desktop was locked, so this is state/runtime validation rather than a physical-display or hardware-performance claim.
