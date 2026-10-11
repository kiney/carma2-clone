import type { ContactImpact, RigidBody } from "./contact";

const NORMAL_GROUP_DOT = Math.fround(0.707107);
const MAX_ROWS = 4;

/** Installed HW41d39c: consumers process only totalLambda strictly above this. */
export const NATIVE_IMPACT_MINIMUM_LAMBDA = Math.fround(0.02);

export interface NativeImpactRowGroup {
  readonly a: RigidBody;
  readonly b: RigidBody | undefined;
  readonly rows: readonly ContactImpact[];
  readonly totalLambda: number;
}

/** Independently reconstructed HW41cc11–41d24e greedy grouping.
 * Browser type9 means an invalidated solve and is excluded. Native zero-lambda
 * rows are also tagged9 before this callback, but remain in its primitive list;
 * browser zero rows are untagged and likewise occupy a slot here.
 * Low/zero groups are returned; consumers apply the strict .02 lambda gate.
 */
export function groupNativeImpactRows(
  impacts: readonly ContactImpact[],
): NativeImpactRowGroup[] {
  const native = impacts.map((row) => {
    if (row.sourceType === 9) return undefined;
    if (!row.a || row.a === row.b)
      throw new Error("Impact rows require distinct bodies and a receiver");
    const lambda = Math.fround(row.normalImpulse);
    if (
      !Number.isFinite(row.normalImpulse) ||
      row.normalImpulse < 0 ||
      !Number.isFinite(lambda)
    )
      throw new Error("Impact lambda must be finite, nonnegative Float32");
    const normal = [row.normal.x, row.normal.y, row.normal.z].map(Math.fround);
    if (
      normal.some((value) => !Number.isFinite(value) || Math.abs(value) > 1) ||
      normal.every((value) => value === 0)
    )
      throw new Error("Impact normal must have finite nonzero unit components");
    return { lambda, normal };
  });
  const consumed = new Uint8Array(impacts.length);
  const groups: NativeImpactRowGroup[] = [];
  for (let seedIndex = 0; seedIndex < impacts.length; seedIndex++) {
    const seedNative = native[seedIndex];
    if (consumed[seedIndex] || !seedNative) continue;
    const seed = impacts[seedIndex];
    const rows = [seed];
    consumed[seedIndex] = 1;
    let totalLambda = seedNative.lambda;
    for (
      let index = seedIndex + 1;
      index < impacts.length && rows.length < MAX_ROWS;
      index++
    ) {
      const candidateNative = native[index];
      if (consumed[index] || !candidateNative) continue;
      const candidate = impacts[index];
      const same = candidate.a === seed.a && candidate.b === seed.b;
      const reversed =
        seed.b !== undefined &&
        candidate.a === seed.b &&
        candidate.b === seed.a;
      if (!same && !reversed) continue;
      const [sx, sy, sz] = seedNative.normal;
      const [cx, cy, cz] = candidateNative.normal;
      // Native live products/sums have no intermediate Float32 stores.
      const dot = same
        ? sx * cx + sy * cy + sz * cz
        : sz * cz + sx * cx + sy * cy;
      if (!(same ? dot > NORMAL_GROUP_DOT : dot < -NORMAL_GROUP_DOT)) continue;
      consumed[index] = 1;
      rows.push(candidate);
      totalLambda = Math.fround(totalLambda + candidateNative.lambda);
      if (!Number.isFinite(totalLambda))
        throw new Error("Grouped impact lambda exceeds Float32 bounds");
    }
    groups.push({ a: seed.a, b: seed.b, rows, totalLambda });
  }
  return groups;
}
