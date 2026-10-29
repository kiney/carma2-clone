const MAX_FORMS = 20;
const MAX_BONES = 32;

interface StoredForm<Owner extends object> {
  boneCount: number;
  records: Array<{ storage: Float32Array; owner: Owner | null }>;
}

export interface NativePedStoredPoseCharacter<Owner extends object> {
  owner: Owner;
  formKey: string;
  removedBoneMask: number;
  vanishedBoneMask: number;
}

export interface NativePedStoredPoseInstance {
  bones: readonly { pose: Float32Array }[];
}

export interface NativePedStoredPoseStats {
  forms: number;
  occupied: number;
  capacity: number;
  bytes: number;
}

const integer = (value: number, min: number, max: number, label: string) => {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new RangeError(`Invalid stored pedestrian pose ${label}`);
  return value;
};

/** Bounded per-FORM retained native matrices for dismembered corpse recovery.
 * Root data is intentionally unused; occupancy occupies storage[0]. */
export class NativePedStoredPoses<Owner extends object> {
  private readonly forms = new Map<string, StoredForm<Owner>>();
  private readonly owners = new Map<Owner, { key: string; slot: number }>();

  registerForm(
    key: string,
    input: { bones: readonly unknown[]; maxStoredDismembered: number },
  ): void {
    if (!key || key.length > 255 || key.includes("\0"))
      throw new Error("Invalid native stored-pose FORM identity");
    integer(input.bones.length, 1, MAX_BONES, "FORM bone count");
    integer(input.maxStoredDismembered, 0, 255, "FORM capacity");
    const old = this.forms.get(key);
    if (old) {
      if (
        old.boneCount !== input.bones.length ||
        old.records.length !== input.maxStoredDismembered
      )
        throw new Error("Conflicting native stored-pose FORM registration");
      return;
    }
    if (this.forms.size >= MAX_FORMS)
      throw new Error("Native stored-pose FORM registry exhausted (20)");
    const records = Array.from({ length: input.maxStoredDismembered }, () => ({
      storage: new Float32Array(input.bones.length * 12),
      owner: null as Owner | null,
    }));
    this.forms.set(key, { boneCount: input.bones.length, records });
  }

  store(
    character: NativePedStoredPoseCharacter<Owner>,
    instance: NativePedStoredPoseInstance,
  ): void {
    const form = this.form(character, instance);
    if (this.owners.has(character.owner))
      throw new Error("Native pedestrian already owns a stored-pose record");
    const removed = this.mask(character.removedBoneMask, form.boneCount);
    this.mask(character.vanishedBoneMask, form.boneCount);
    const selected: Array<{ index: number; pose: Float32Array }> = [];
    for (let index = 1; index < form.boneCount; index++) {
      if (!(removed & (1 << index))) continue;
      const pose = instance.bones[index]?.pose;
      if (!(pose instanceof Float32Array) || pose.length !== 12)
        throw new Error(`Missing native stored-pose matrix for bone ${index}`);
      for (let element = 0; element < 12; element++)
        if (!Number.isFinite(pose[element]))
          throw new Error(
            `Invalid native stored-pose matrix for bone ${index}`,
          );
      selected.push({ index, pose });
    }
    if (removed === 0) return;
    const slot = form.records.findIndex((record) => record.owner === null);
    if (slot < 0) return;
    const record = form.records[slot];
    record.storage.fill(0);
    record.storage[0] = 1;
    for (const { index, pose } of selected)
      record.storage.set(pose.subarray(0, 12), index * 12);
    record.owner = character.owner;
    this.owners.set(character.owner, { key: character.formKey, slot });
  }

  restore(
    character: NativePedStoredPoseCharacter<Owner>,
    instance: NativePedStoredPoseInstance,
  ): void {
    const form = this.form(character, instance),
      removed = this.mask(character.removedBoneMask, form.boneCount),
      allocation = this.owners.get(character.owner);
    if (!allocation) {
      character.vanishedBoneMask = removed;
      return;
    }
    if (allocation.key !== character.formKey)
      throw new Error("Native stored-pose FORM ownership mismatch");
    const record = form.records[allocation.slot];
    if (record.owner !== character.owner || record.storage[0] !== 1)
      throw new Error("Native stored-pose owner record is inconsistent");
    // Check every destination before writing any pose or releasing ownership.
    for (let index = 1; index < form.boneCount; index++)
      if (removed & (1 << index)) {
        const pose = instance.bones[index]?.pose;
        if (!(pose instanceof Float32Array) || pose.length !== 12)
          throw new Error(
            `Missing native restore-pose matrix for bone ${index}`,
          );
      }
    for (let index = 1; index < form.boneCount; index++)
      if (removed & (1 << index))
        instance.bones[index].pose.set(
          record.storage.subarray(index * 12, index * 12 + 12),
        );
    record.storage.fill(0);
    record.owner = null;
    this.owners.delete(character.owner);
  }

  clear(): void {
    for (const form of this.forms.values())
      for (const record of form.records) {
        record.storage.fill(0);
        record.owner = null;
      }
    this.owners.clear();
  }

  get stats(): NativePedStoredPoseStats {
    let occupied = 0,
      capacity = 0,
      bytes = 0;
    for (const form of this.forms.values()) {
      capacity += form.records.length;
      bytes +=
        form.records.length *
        form.boneCount *
        12 *
        Float32Array.BYTES_PER_ELEMENT;
      for (const record of form.records)
        occupied += Number(record.owner !== null);
    }
    return { forms: this.forms.size, occupied, capacity, bytes };
  }

  private form(
    character: NativePedStoredPoseCharacter<Owner>,
    instance: NativePedStoredPoseInstance,
  ): StoredForm<Owner> {
    const form = this.forms.get(character.formKey);
    if (!form) throw new Error("Unregistered native stored-pose FORM");
    if (instance.bones.length !== form.boneCount)
      throw new Error("Native stored-pose instance FORM mismatch");
    this.mask(character.removedBoneMask, form.boneCount);
    this.mask(character.vanishedBoneMask, form.boneCount);
    return form;
  }

  private mask(value: number, boneCount: number): number {
    integer(value, 0, 0xffffffff, "bone mask");
    const allowed = boneCount === 32 ? 0xffffffff : 2 ** boneCount - 1;
    if (value & ~allowed)
      throw new Error("Native stored-pose mask exceeds FORM");
    return value >>> 0;
  }
}
