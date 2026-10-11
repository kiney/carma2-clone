import { nativeResourceNameMatches } from "./native-resource-registry";
/** Admission belongs to a storage; lookup belongs to the global registry.
 * ClearOutStorageSpace removes only that storage's registrations by identity. */
export class NativeGlobalResources<T extends { name: string }> {
  readonly registrations: { storage: object; resource: T }[] = [];
  constructor(readonly rejectExactDuplicates: boolean) {}
  add(
    storage: object,
    resource: T,
    rejectExactDuplicates = this.rejectExactDuplicates,
  ): boolean {
    if (
      rejectExactDuplicates &&
      this.registrations.some(
        (entry) =>
          entry.storage === storage && entry.resource.name === resource.name,
      )
    )
      return false;
    this.registrations.push({ storage, resource });
    return true;
  }
  find(identifier: string | null): T | undefined {
    for (let i = this.registrations.length - 1; i >= 0; i--)
      if (
        nativeResourceNameMatches(
          identifier,
          this.registrations[i].resource.name,
        )
      )
        return this.registrations[i].resource;
    return undefined;
  }
  removeStorage(storage: object): T[] {
    const removed = this.registrations
      .filter((entry) => entry.storage === storage)
      .map((entry) => entry.resource);
    for (let i = this.registrations.length - 1; i >= 0; i--)
      if (this.registrations[i].storage === storage)
        this.registrations.splice(i, 1);
    return removed;
  }
}
