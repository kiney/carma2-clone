/** OneLessPed accounting is independent of body/death transport. Installed
 * 4ccf10–4ccf29 uses Ped flag100; a score-only death does not consume a ped. */
export const PED_COUNTED_FLAG = 0x100;

export class PedPopulationAccounting<Owner extends object> {
  private readonly records = new Map<Owner, { group: number; flags: number }>();
  private killedCount = 0;

  enroll(owner: Owner, group: number): void {
    if (this.records.has(owner) || !Number.isSafeInteger(group) || group < 0)
      throw new Error("Invalid pedestrian population owner");
    this.records.set(owner, { group, flags: 0 });
  }

  private record(owner: Owner) {
    const record = this.records.get(owner);
    if (!record) throw new Error("Unknown pedestrian population owner");
    return record;
  }

  flags(owner: Owner): number {
    return this.record(owner).flags;
  }

  /** The native callback arrives after its character has set flag100. This
   * population record shares the once gate with ordinary sweep/combat kills. */
  oneLess(owner: Owner): { group: number; count: 1; total: number } | null {
    const record = this.record(owner);
    if (record.flags & PED_COUNTED_FLAG) return null;
    record.flags |= PED_COUNTED_FLAG;
    this.killedCount++;
    return { group: record.group, count: 1, total: this.hits };
  }

  get hits(): number {
    return this.killedCount;
  }

  get alive(): number {
    return this.records.size - this.hits;
  }

  get groupCounts(): Map<number, { total: number; killed: number }> {
    const groups = new Map<number, { total: number; killed: number }>();
    for (const record of this.records.values()) {
      const group = groups.get(record.group) ?? { total: 0, killed: 0 };
      group.total++;
      if (record.flags & PED_COUNTED_FLAG) group.killed++;
      groups.set(record.group, group);
    }
    return groups;
  }

  reset(): void {
    this.killedCount = 0;
    for (const record of this.records.values()) record.flags = 0;
  }

  clear(): void {
    this.killedCount = 0;
    this.records.clear();
  }
}
