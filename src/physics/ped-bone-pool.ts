/** Ordinary simple-character detached-part resources. Installed4059f7..405acb
 * allocates FORM bone objects once;40b88a and408f46 reserve first-free slots;
 *409108..409168 removes parts before freeing a slot. No quiet/TTL reclamation.
 * Hosts provide actual preallocated objects, in-place4085f0 setup and PHIL. */
import type { PedForm, PedFormBone } from "../ped-form";
import { NATIVE_PED_FORM_LIMIT } from "../ped-body-pool";
import type {
  NativePedSeverBoneRequest,
  NativePedSeverBoneSnapshot,
  NativePedSeverRegistration,
} from "./ped-sever";

export interface NativePedBonePoolCharacter<Owner extends object> {
  owner: Owner;
  formKey: string;
  bonedSlot: number;
  removedBoneMask: number;
  vanishedBoneMask: number;
  physicsFlags: number;
}
export interface NativePedBonePoolAllocation<Owner extends object, Body> {
  character: NativePedBonePoolCharacter<Owner>;
  slot: number;
  /** Stable FORM array, including NULL entries for zero-mass bones. */
  readonly bodies: readonly (Body | null)[];
  phase: "owned" | "release-pending";
}
export interface NativePedBonePoolHeader {
  /** Actual4b5db0 state; ec/quiet is deliberately absent. */
  state: 0 | 1 | 2;
  queued: boolean;
}
export interface NativePedBonePoolHost<
  Owner extends object,
  Actor,
  Model,
  Body extends object,
> {
  /** Called bone-major/slot-minor once at FORM registration. Allocate the real
   * stable body/shape; no ACT/current MODEL is available at this boundary. */
  createBone(
    formKey: string,
    slot: number,
    index: number,
    bone: Readonly<PedFormBone>,
  ): Body;
  /** Reprepare THIS body/shape in place. Retain untouched object flags, friction
   * and joint2; copy actual ACT/current model, native12, type5 and source zeros.
   * This callback must not replace the physical resource or clear a PHIL header. */
  prepareBone(
    allocation: NativePedBonePoolAllocation<Owner, Body>,
    body: Body,
    request: NativePedSeverBoneRequest<Actor, Model>,
    reason: "sever" | "reacquire",
  ): void;
  /** After successful registration only:0/3/4/5/7/8/6 properties and type5 fill
   * A40000/B50000. The pool does not fabricate a header or retained fields. */
  finishBone(
    allocation: NativePedBonePoolAllocation<Owner, Body>,
    body: Body,
  ): void;
  registrar: {
    registerImmediate(body: Body): 0 | 1 | 2;
    header(body: Body): NativePedBonePoolHeader;
    remove(body: Body): { code: 0 | 3; phase: "complete" | "deferred" };
  };
  /**409148/409154: clear ring+1d8 and owner+23c after proven PHIL removal. */
  clearBone(
    allocation: NativePedBonePoolAllocation<Owner, Body>,
    body: Body,
    index: number,
  ): void;
  supportsShape?(bone: Readonly<PedFormBone>): boolean;
  /** Explicit adoption of an already occupied external source slot. Verify
   * FORM table occupancy, character+6 and owner links; not a free-slot claim. */
  confirmAdoption?(
    allocation: NativePedBonePoolAllocation<Owner, Body>,
  ): boolean;
  onSlotReleased?(allocation: NativePedBonePoolAllocation<Owner, Body>): void;
}
export class NativePedBonePoolProviderError extends Error {
  constructor(readonly provider: string) {
    super(`Required native bone pool provider: ${provider}`);
    this.name = "NativePedBonePoolProviderError";
  }
}
export interface NativePedBonePoolRegistration<Body> {
  registration: NativePedSeverRegistration<Body> | null;
  code: 0 | 1 | 2;
}
interface Slot<Owner extends object, Body> {
  bodies: (Body | null)[];
  allocation: NativePedBonePoolAllocation<Owner, Body> | null;
  pending: Set<number>;
  cleared: Set<number>;
}
interface Form<Owner extends object, Body> {
  bones: Readonly<PedFormBone>[];
  slots: Slot<Owner, Body>[];
}
function integer(value: number, min: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`Invalid native bone pool ${label}`);
}
const bit = (index: number) => (1 << index) >>> 0;

export class NativePedBonePool<
  Owner extends object,
  Actor,
  Model,
  Body extends object,
> {
  private readonly forms = new Map<string, Form<Owner, Body>>();
  private readonly owners = new Map<
    Owner,
    NativePedBonePoolAllocation<Owner, Body>
  >();
  private readonly resources = new Set<Body>();
  constructor(
    private readonly host: NativePedBonePoolHost<Owner, Actor, Model, Body>,
  ) {
    for (const name of [
      "createBone",
      "prepareBone",
      "finishBone",
      "clearBone",
    ] as const)
      if (typeof host[name] !== "function")
        throw new NativePedBonePoolProviderError(name);
    for (const name of ["registerImmediate", "header", "remove"] as const)
      if (typeof host.registrar?.[name] !== "function")
        throw new NativePedBonePoolProviderError(`shared-PHIL-${name}`);
  }
  registerForm(key: string, input: Pick<PedForm, "bones" | "maxBoned">): void {
    if (!key || key.length > 255 || key.includes("\0"))
      throw new Error("Invalid native FORM identity");
    integer(input.maxBoned, 0, 128, "signed-byte capacity");
    integer(input.bones.length, 1, 32, "mask bone count");
    for (const bone of input.bones)
      if (!Number.isFinite(bone.mass) || bone.mass < 0 || !bone.name)
        throw new Error("Invalid native FORM bone allocation");
    const old = this.forms.get(key);
    if (old) {
      if (
        old.slots.length !== input.maxBoned ||
        old.bones.length !== input.bones.length ||
        old.bones.some(
          (bone, i) => JSON.stringify(bone) !== JSON.stringify(input.bones[i]),
        )
      )
        throw new Error("Conflicting shared native FORM bone resources");
      return;
    }
    if (this.forms.size >= NATIVE_PED_FORM_LIMIT)
      throw new Error("Native FORM registry exhausted (20)");
    const bones = input.bones.map((bone) =>
      Object.freeze({ ...bone, jointRecords: [...bone.jointRecords] }),
    );
    const slots: Slot<Owner, Body>[] = Array.from(
      { length: input.maxBoned },
      () => ({
        bodies: Array<Body | null>(bones.length).fill(null),
        allocation: null,
        pending: new Set(),
        cleared: new Set(),
      }),
    );
    const created = new Set<Body>();
    // Installed4059f7 visits every slot for one bone before reading NEXT BONE.
    for (let index = 0; index < bones.length; index++) {
      const bone = bones[index];
      if (bone.mass === 0) continue;
      for (let slot = 0; slot < slots.length; slot++) {
        const body = this.host.createBone(key, slot, index, bone);
        if (
          !body ||
          typeof body !== "object" ||
          created.has(body) ||
          this.resources.has(body)
        )
          throw new Error(
            "Native FORM bone resources must have distinct stable identities",
          );
        if (!this.absent(body))
          throw new Error("New native bone resource has a live PHIL header");
        created.add(body);
        slots[slot].bodies[index] = body;
      }
    }
    for (const slot of slots) Object.freeze(slot.bodies);
    this.forms.set(key, { bones, slots });
    for (const body of created) this.resources.add(body);
  }
  private form(
    character: NativePedBonePoolCharacter<Owner>,
  ): Form<Owner, Body> {
    const form = this.forms.get(character.formKey);
    if (!form) throw new Error("Unregistered native bone FORM");
    integer(character.bonedSlot, -1, form.slots.length - 1, "character slot");
    for (const value of [
      character.removedBoneMask,
      character.vanishedBoneMask,
      character.physicsFlags,
    ])
      integer(value, 0, 0xffffffff, "character flags/mask");
    const mask =
      form.bones.length === 32 ? 0xffffffff : 2 ** form.bones.length - 1;
    if (character.removedBoneMask & ~mask || character.vanishedBoneMask & ~mask)
      throw new Error("Native bone masks exceed FORM bone count");
    if (character.physicsFlags & 2)
      throw new NativePedBonePoolProviderError("articulated-FORM-owner");
    return form;
  }
  private header(body: Body): NativePedBonePoolHeader {
    const header = this.host.registrar.header(body);
    if (
      !header ||
      ![0, 1, 2].includes(header.state) ||
      typeof header.queued !== "boolean"
    )
      throw new Error("Invalid actual PHIL header proof");
    return header;
  }
  private absent(body: Body): boolean {
    const header = this.header(body);
    return header.state === 0 && !header.queued;
  }
  allocation(
    character: NativePedBonePoolCharacter<Owner>,
  ): NativePedBonePoolAllocation<Owner, Body> | null {
    this.form(character);
    const allocation = this.owners.get(character.owner) ?? null;
    if (
      allocation &&
      (allocation.character.formKey !== character.formKey ||
        allocation.slot !== character.bonedSlot)
    )
      throw new Error("Native character does not match its owned boned slot");
    return allocation;
  }
  /** Existing ownership is shared by sever/acquisition callbacks, not reallocated. */
  reserve(character: NativePedBonePoolCharacter<Owner>): number | null {
    const form = this.form(character),
      existing = this.allocation(character);
    if (existing) {
      if (existing.phase !== "owned")
        throw new Error("Native boned release is pending");
      return existing.slot;
    }
    if (character.bonedSlot >= 0)
      throw new NativePedBonePoolProviderError("occupied-slot-adoption");
    const index = form.slots.findIndex((slot) => slot.allocation === null);
    if (index < 0) return null;
    const slot = form.slots[index];
    for (const body of slot.bodies)
      if (body && !this.absent(body))
        throw new Error("Free boned slot lacks PHIL release proof");
    const allocation = {
      character,
      slot: index,
      bodies: slot.bodies,
      phase: "owned" as const,
    };
    slot.allocation = allocation;
    this.owners.set(character.owner, allocation);
    character.bonedSlot = index;
    return index;
  }
  adopt(
    character: NativePedBonePoolCharacter<Owner>,
  ): NativePedBonePoolAllocation<Owner, Body> {
    const form = this.form(character),
      existing = this.allocation(character);
    if (existing) return existing;
    if (character.bonedSlot < 0)
      throw new Error("Adoption requires an occupied native slot");
    const slot = form.slots[character.bonedSlot];
    if (slot.allocation)
      throw new Error("Native boned slot belongs to another character");
    if (!this.host.confirmAdoption)
      throw new NativePedBonePoolProviderError("occupied-slot-adoption");
    const allocation = {
      character,
      slot: character.bonedSlot,
      bodies: slot.bodies,
      phase: "owned" as const,
    };
    if (!this.host.confirmAdoption(allocation))
      throw new Error("Native occupied-slot adoption was not proved");
    slot.allocation = allocation;
    this.owners.set(character.owner, allocation);
    return allocation;
  }
  registerBone(
    character: NativePedBonePoolCharacter<Owner>,
    request: NativePedSeverBoneRequest<Actor, Model>,
    reason: "sever" | "reacquire" = "sever",
  ): NativePedBonePoolRegistration<Body> {
    const form = this.form(character),
      allocation = this.allocation(character);
    if (
      !allocation ||
      allocation.phase !== "owned" ||
      request.slot !== allocation.slot
    )
      throw new Error("Bone setup requires the character's owned boned slot");
    integer(request.index, 1, form.bones.length - 1, "detached bone index");
    const bone = form.bones[request.index],
      body = allocation.bodies[request.index];
    if (
      !body ||
      request.bone.name !== bone.name ||
      request.bone.mass !== bone.mass ||
      request.bone.collisionType !== bone.collisionType
    )
      throw new Error(
        "Bone setup does not match preallocated native FORM object",
      );
    if (
      request.rigidType !== 5 ||
      request.filterA !== 0x40000 ||
      request.filterB !== 0x50000
    )
      throw new Error("Native detached type5 filter policy required");
    if (this.host.supportsShape && !this.host.supportsShape(bone))
      throw new NativePedBonePoolProviderError(
        `analytic-${bone.collisionType}-shape`,
      );
    this.host.prepareBone(allocation, body, request, reason);
    const code = this.host.registrar.registerImmediate(body);
    if (code !== 0 && code !== 1 && code !== 2)
      throw new Error("Invalid immediate PHIL registration result");
    if (code !== 0) return { registration: null, code };
    const header = this.header(body);
    if (header.state !== 1 || header.queued)
      throw new Error("Immediate PHIL success lacks actual passive header");
    this.host.finishBone(allocation, body);
    return {
      code,
      registration: { body, rigidType: 5, filterA: 0x40000, filterB: 0x50000 },
    };
  }
  /**408f7b..409019: no spin/activation draws; successful setup zeros V/omega in
   * prepareBone. Native full/duplicate failures are collected and do not abort. */
  reacquire(
    character: NativePedBonePoolCharacter<Owner>,
    readBone: (
      index: number,
    ) => NativePedSeverBoneSnapshot<Actor, Model> | null,
  ): { slot: number | null; results: { index: number; code: 0 | 1 | 2 }[] } {
    const form = this.form(character),
      results: { index: number; code: 0 | 1 | 2 }[] = [];
    if (!character.removedBoneMask)
      return {
        slot: character.bonedSlot < 0 ? null : character.bonedSlot,
        results,
      };
    const slot = this.reserve(character);
    if (slot === null) return { slot, results };
    for (let index = 1; index < form.bones.length; index++) {
      if (
        !(character.removedBoneMask & bit(index)) ||
        character.vanishedBoneMask & bit(index)
      )
        continue;
      if (typeof readBone !== "function")
        throw new NativePedBonePoolProviderError("stored-removed-bone-pose");
      const snapshot = readBone(index);
      if (!snapshot)
        throw new NativePedBonePoolProviderError(
          `stored-removed-bone-pose-${index}`,
        );
      const result = this.registerBone(
        character,
        {
          index,
          slot,
          bone: form.bones[index],
          snapshot,
          rigidType: 5,
          filterA: 0x40000,
          filterB: 0x50000,
          localOmega: [0, 0, 0],
          activation: null,
          clearParentJoint: true,
          clearChildren: true,
          clearLink188: true,
        },
        "reacquire",
      );
      results.push({ index, code: result.code });
    }
    return { slot, results };
  }
  /** Call from the ordinary simple collision-release outlet, after removing its
   * root. Caller owns clearing whole-character physicsFlags at40916c/4091c2. */
  releaseRemovedParts(
    character: NativePedBonePoolCharacter<Owner>,
  ): "complete" | "release-pending" | "not-applicable" {
    const form = this.form(character),
      allocation = this.allocation(character);
    if (
      !character.physicsFlags ||
      !(character.physicsFlags & 1) ||
      !character.removedBoneMask ||
      character.bonedSlot < 0
    )
      return "not-applicable";
    if (!allocation)
      throw new NativePedBonePoolProviderError("occupied-slot-adoption");
    const slot = form.slots[allocation.slot];
    allocation.phase = "release-pending";
    for (let index = 1; index < form.bones.length; index++) {
      if (!(character.removedBoneMask & bit(index)) || slot.cleared.has(index))
        continue;
      const body = slot.bodies[index];
      if (!body)
        throw new Error("Removed native bone has no authored physical object");
      if (!slot.pending.has(index)) {
        // State2 includes ec=1 sleeping active bodies. Native marks BEFORE remove.
        if (this.header(body).state === 2)
          character.vanishedBoneMask =
            (character.vanishedBoneMask | bit(index)) >>> 0;
        const removed = this.host.registrar.remove(body);
        if (
          !removed ||
          (removed.code !== 0 && removed.code !== 3) ||
          !["complete", "deferred"].includes(removed.phase)
        )
          throw new Error("Invalid native PHIL removal result");
        if (removed.phase === "deferred") slot.pending.add(index);
        else if (!this.absent(body))
          throw new Error("Completed PHIL removal lacks released header proof");
      }
      if (!this.absent(body)) continue;
      this.host.clearBone(allocation, body, index);
      slot.pending.delete(index);
      slot.cleared.add(index);
    }
    if (slot.pending.size) return "release-pending";
    // Guard even unmasked/failed setup resources against a queued/live header.
    for (const body of slot.bodies)
      if (body && !this.absent(body))
        throw new Error("Boned slot still owns an unreleased PHIL object");
    slot.allocation = null;
    slot.pending.clear();
    slot.cleared.clear();
    this.owners.delete(character.owner);
    character.bonedSlot = -1;
    this.host.onSlotReleased?.(allocation);
    return "complete";
  }
  counts(key: string): {
    capacity: number;
    owned: number;
    releasePending: number;
    physicalResources: number;
  } {
    const form = this.forms.get(key);
    if (!form) throw new Error("Unregistered native bone FORM");
    return {
      capacity: form.slots.length,
      owned: form.slots.filter((s) => s.allocation).length,
      releasePending: form.slots.filter(
        (s) => s.allocation?.phase === "release-pending",
      ).length,
      physicalResources: form.slots.reduce(
        (n, s) => n + s.bodies.filter(Boolean).length,
        0,
      ),
    };
  }
}
