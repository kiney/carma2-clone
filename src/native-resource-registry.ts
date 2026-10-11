/** Installed BrNamePatternMatch 528ea0 / BrRegistryFind 529300.
 * Matching folds ASCII only and preserves extensions. A slash ends the pattern
 * at the candidate's terminator; it is not a path separator to normalize. */
export function nativeResourceNameMatches(
  pattern: string | null,
  identifier: string | null,
): boolean {
  if (pattern === null) return true;
  if (identifier === null) return false;
  const end = pattern.indexOf("/");
  if (end >= 0) pattern = pattern.slice(0, end);
  const fold = (code: number) => (code >= 97 && code <= 122 ? code - 32 : code);
  let row = new Uint8Array(identifier.length + 1);
  row[0] = 1;
  for (let p = 0; p < pattern.length; p++) {
    const next = new Uint8Array(row.length),
      token = pattern.charCodeAt(p);
    if (token === 42) {
      next[0] = row[0];
      for (let s = 1; s < next.length; s++) next[s] = row[s] || next[s - 1];
    } else {
      for (let s = 1; s < next.length; s++)
        next[s] =
          row[s - 1] &&
          (token === 63 || fold(token) === fold(identifier.charCodeAt(s - 1)))
            ? 1
            : 0;
    }
    row = next;
  }
  return !!row[identifier.length];
}

/** Storage admission and registry lookup are separate operations. Materials
 * reject exact identifier duplicates; track MODEL storage admits them all.
 * Accepted registrations prepend, so a lookup visits newest first. */
export class NativeResourceRegistry<T extends { name: string }> {
  readonly accepted: T[] = [];
  #identifiers = new Set<string>();
  #literal = new Map<string, T>();
  #fold(identifier: string) {
    return identifier.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  }
  constructor(readonly rejectExactDuplicates: boolean) {}
  add(resource: T): boolean {
    if (this.rejectExactDuplicates && this.#identifiers.has(resource.name))
      return false;
    this.#identifiers.add(resource.name);
    this.accepted.push(resource);
    this.#literal.set(this.#fold(resource.name), resource);
    return true;
  }
  find(pattern: string | null): T | undefined {
    if (pattern !== null && !/[*/?]/.test(pattern))
      return this.#literal.get(this.#fold(pattern));
    for (let i = this.accepted.length - 1; i >= 0; i--)
      if (nativeResourceNameMatches(pattern, this.accepted[i].name))
        return this.accepted[i];
    return undefined;
  }
}
