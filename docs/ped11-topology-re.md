# PED-11 articulated topology audit (read-only, 2026-10-30)

## Conclusion

The installed original has a boned allocation branch and authored BIPEDF joints,
but the inspected ordinary game call graph does not select physics level2/6.
It selects simple passive mode0 through MakeCharacterCollideworthy and level5
for active reactions. No generic ragdoll implementation is justified by these
branches alone. The boned branch does not construct physical parent/child links,
and no pedestrian writer establishing character+e8 temporary matrices was found.
Those are verified omissions in the inspected installed pedestrian instruction
range, not a proof that every conceivable external caller is impossible.

## Binary identity

- HW SHA256 698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c.
  PE32/i386 image base400000, entry577eb0, timestamp1998-10-18 20:13:36,
  SizeOfImage39f000, code186800. Timestamp printed by objdump in local timezone.
- SW SHA256 15d08246a43446364e7e8308a434da1821e5aef224b3692f14dadd312949611d.
  PE32/i386 image base400000, entry572ef0, timestamp1998-10-18 21:16:25,
  SizeOfImage396000, code181400.
- HW/SW408c30..409023: 1005/1011 bytes identical. The six differences belong
  to two helper-call displacement operands and two static-data addresses
  (friction constant and removed-bone mask table); control flow/body stores match.
  Both have the joint1 store at408d74. This is not a rec2 address-map mistake.
- rec2 is a symbol/layout map; SetCharacterPhysicsLevel and
  MakeCharacterCollideworthy2 remain stubs. rec2 incorrectly annotates
  SetCharacterPhysicsLevelAR as4cc860, which is the installed fill callback;
  installed AR wrapper is4cc610. Many physics addresses differ by0x250/0x220.

## All direct native callsites

Installed core SetCharacterPhysicsLevel409570 is cdecl(character,level[,arg]).
Its only direct callers are4cc642/4cc64e in AR wrapper4cc610, and4d53db in
offscreen release with literal level0. No literal pointer to409570/4cc610/
408c30/409030 occurs anywhere in either installed executable, and the full HW
objdump contains no tail-jump callers to these functions.

The ten direct HW wrapper4cc610 callsites are:

| Callsite | Level | Context                                          |
| -------- | ----- | ------------------------------------------------ |
| 4cc56c   | 5     | settling/reaction activation                     |
| 4ce11d   | 5     | physical reaction                                |
| 4d1170   | 5     | halt retry (only if incoming simple bit1 absent) |
| 4d33bf   | 5     | falling activation                               |
| 4d3f56   | 0     | vanish/release (EBX is outer zero)               |
| 4d3f94   | 5     | missing-ground activation                        |
| 4d4a0a   | 5     | ground/falling activation                        |
| 4d5395   | 0     | offscreen vanish (EDI explicitly zero at4d532b)  |
| 4d54a8   | 0     | offscreen vanish (same EDI)                      |
| 4d6199   | 5     | selected-ped debug activation (push5 at4d6176)   |

Ordinary population acquisition4d375f calls MakeCharacterCollideworthy409030
with EDX0. That wrapper forwards mode0 into408c30. Only409037 and4095c6 call
408c30, latter with mode=(requestedLevel&2). No inspected native caller
supplies level2/6, or any nonzero allocation mode. No dead->boned transition
is present in these callsites. The source level field is bit composition,
not an ordinal severity ladder.

## Level2/6 branch, verified instruction order

409570 lowers an active character for requestedlevel<5 via halt409400 before
other work. Level0 calls release409090. Nonzero levels call408c30 with mode
level&2, optional argument forwarded, explicit slot=-1. Return23 is normalized
to0. A successful requested bit4 then activates the selected root, recursively
copies character V through409300, sets callback flag2=true, restores properties
0/3/4/5 and ORs character physics bit4.

408c30 returns23 when existing simple bit1 matches mode0, or boned bit2 matches
nonzero mode. It ensures a render slot, then for boned mode:

1. First free FORM+34 boned slot bounded by byte+2c; explicit nonnegative slot
   selects that slot. Exhaustion falls through to ordinary simple allocation.
   2.408cfa stores character physics flags=2 and character+5=boned slot (NOT+6,
   which remains the separate detached-parts slot). Marks slot occupied.
2. Iterates bones0..count-1. Reads each allocated object and skips NULL shape
   at Object+20. Clears rigid flag0x400. There is no NULL body guard before
   this shape read (zero-mass objects are NULL in loader4059f7..).
3. Clones personality bone+38 joint using installed ClonePhysicsJoint4c5bf0,
   stores clone at Object+188 (joint1), orNULL. Does not assign joint2+18c.
4. Scans FORM bones in index order for the first bone whose parent equals
   this index. Its personality parent anchor+2c becomes a scratch LINE endpoint.
   When no child exists the scratch slot is left unchanged (initially uninitialized).
5. Calls body initializer4085f0 with current ACT/current MODEL bounds, NULL COM,
   selector1 for bone0 and1 -> rigidtype3, selector2 for indices>1 -> rigidtype4;
   source bone index becomes byte+190. Only first physical body passes
   register=true, every subsequent physical body passesfalse. Return is ignored.
6. After first physical body, remembers friction=f32(firstBody.Ix \*25), constant
   float25 at588394. Every later nonnull cloned joint gets this same friction+4.
7. End calls PHIL property1=true on array bone0 (not dynamically found root).
   This is a boolean header property, not ordinary drag property2.

No release of an existing simple header occurs before replacing flags/slot in
this branch. No physical tree construction occurs here. Full HW disassembly
parent/child stores occur in generic4c6160/4c6180/4c61c0 and explicit sever
40b961..40b97d, with no generic add call from the pedestrian range.

PhysicsAddObject is installed4c6160 (rec2 annotates4c63b0):
child.next=parent.child; parent.child=child; child.parent=parent.
Installed parent/child/sibling offsets228/224/220. It is called by car component
and special external attachment paths, not by408c30 or form/personality loaders.

## Temporary matrix ownership

GetCharacterMatrixPtr installed407a90: if render slot+4<0 use stored+2c;
else if character+e8 nonnull use that; else use actor0 matrix.
GetBoneMatrixPtr407ac0/407acd similarly indexes temporary+e8 by48\*boneIndex.
SetBonePositions407b20..407b4b returns immediately for active bit4+boned bit2
when temporary+e8 isNULL. Animation advancement409ca0/409ccb..409cd1 has the
same active-boned/no-temp early exit. Physical ACTs can therefore remain
authoritative instead of being overwritten by BON.

No explicit pedestrian write to character+e8 exists in inspected404000..40c000;
only readers. BuildCharacterInstance407990 allocates236 bytes and initializes
flags, slots and matrices, but never allocates/assigns+e8. Do not invent a
temporary matrix allocator or present it as verified installed behavior.

## Authored joints and retained joint2

BIPED1 has onlyNONE/FALSE, so personality anchor relationships are not proof
of physical joints. Original BIPEDF has head/upper limb BALLNSOCKET and lower
limb HINGE with explicit PLANE/UNIVERSAL limits. It is actually referenced by
DOCTOR4.TWT embedded DOCTOR4.TXT first line in both original data trees; no
loose text file exposes that reference. Loading that personality still does
not select boned physics level.

Form loader405399..4053aa allocates 0x54+0x20\*limitCount and stores joint type
and count+50. Limit record: type+0, cosine threshold+4, normalized child+8,
normalized parent+14. FORM remaps child through its own general mapping and
parent through authored parent's general mapping.40553c calls GetAScalar,
405541 converts it tointeger through CRT575190,405548 calls FastFloatCos510e20;
rec2's `FastFloatCos((int)GetAScalar)` line is a reconstruction transcription
error, not pointer-cosine native behavior. UNIVERSAL consumes a second generated
record using safeCross(previous.child, previous.parent), rotating that child
around previous parent by the following authored angle; binary4053d6/4053f4/ 405409. Generated record's type/value are not assigned in that branch before
normalization. A browser parser must not pretend arbitrary initialized values
are source evidence.

Joint layout: type0, friction4, childAnchor8, parentAnchor14, hinge transverse
axes20/2c, hinge childAxis38, parentAxis44, count50, limits54. Personality loader
4071f7 clones FORMjoint, inserts separately remapped own/parent anchors at8/14,
stores personality bone+38. Articulated allocation clones it again intojoint1.

Sever40b961..40b97d clears parent.child, body.parent, body.child, andjoint1.
It deliberately leavesjoint2. Full disassembly's directjoint2 writer paths are
external effects/powerups, e.g.4201a9 and487ff1..4885b5. No pedestrianjoint2
assignment exists in the inspected pedestrian range. Thus joint2 preservation
is correct resource hygiene, but is not ordinary FORM hinge retention.

Installed4c1680 is joint friction, not the angular-limit/integrator routine:
joint1 friction with actual partner+230, thenjoint2 friction against world,
then awake children recursively. Forjoint2, L_i=f32(I_i*omega_i), J=friction*.04;
remove min(|L|,J) in the direction ofL (native Float32 spills), dividing removed
momentum by each diagonalI. Constants .04 at589818. Forjoint1 it builds the
relative angular Jacobian/effective inertia against partner+230 and similarly
caps the three-axis impulse norm by friction\*.04. No autonomous part lifetime
or header release occurs in this routine.

## Halt/free behavior and host relevance

409400 and409090 full-boned branches discover the first nonnull-shape object in
character+5's boned array. Halt derives O from current physical root/current
animation, poses mode3, clears bit4 before owner callback; rejection restoresbit4,
acceptance setsroot.ec1, copiesV, restores properties3/4/5. Release removes the
discovered root header, clearsring+1d8, frees bonedslot+5 and clears character
flags. It does not free cloned joint memory or clear all bone owner pointers.
If no nonnull shape exists it then dereferences theNULL root: another native
failure branch, not a reason to silently manufacture a box.

At the initial audit, NativePedBoneBody was intentionally type5 only and its
retained joint2 adapter exposed only a quiet-orientation placeholder. It refused
all nonnull joint2. PED-11 now supplies the source angular-friction subphase for
verified NONE0/count0 joints and derives quiet orientation from the body basis;
unknown or positive world-joint geometry still requires its actual provider.
It has no actual joint1 tree owner,
full-boned slot+5 owner, type3/4 callback owner or temporary buffer owner.
src/ped-form.ts retains raw jointRecords; NativePedBoneAsset exposes jointType
and attachments but no parsed angular limits. Existing JointPlaneLimit only
has childDirection/parentNormal and compares dot against0/.001: it cannot
represent BIPEDF's authored nonzero cosine thresholds unchanged.

Recommended scope correction: retain simple ordinary gameplay and detached
type5 path; documentlevel2/6 as dormant/incomplete native capability with exact
callsite evidence. Do not add a generic physical tree, force DOCTOR4 into6,
or label shippedFALSE relationships as ball joints. If an explicit new browser
articulation feature is later desired, it needs its own honest extension scope,
parsed limits and topology/admission/quiet ownership, separate from native
ordinary completion. Any obsolete missing-provider diagnostic cleanup should
be based on reachable production owners, preserving retainedjoint2 invariants.
