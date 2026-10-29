/** Native SpawnPedsOnFace population planning from raw pre-migration MODEL faces.
 * This is a static reconstruction of the installed call sequence, not a
 * numerical capture from the original executable. */
import type { NativeTrackFaceVisit } from "./native-track-models";
import type { PedSpawnSpec } from "./pedestrians";
import type { PedMovement } from "./ped-rules";
import { pedRandomFloat, pedRandomInteger } from "./ped-rules";
import { nativePedSlopeCosine } from "./ped-rules";
import { prepareNativeModelFacePlane } from "./physics/prepared-plane";

export interface NativePedResolvedSpawnSpec<M extends object> {
  spec: PedSpawnSpec;
  /** The resolved MAT object. Matching is by object identity, including NULL. */
  material: M | null;
}

export interface NativePedPopulationEntry {
  spec: PedSpawnSpec;
  sourceTriangle: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
  personality: string;
  position: [number, number, number];
  direction: [number, number, number];
  movement: number;
  walkPeriod: number;
  group: number;
  sourceModel: object;
  sourceFaceIndex: number;
  objective?: boolean;
}

export interface NativePedPopulationPlanOptions<M extends object> {
  specs: readonly NativePedResolvedSpawnSpec<M>[];
  groups: ReadonlyMap<number, readonly string[]>;
  movements: readonly PedMovement[];
  maxSlopeDegrees: number;
  random: () => number;
  capacity?: number;
  suppressAnimals?: boolean;
  animal?: (name: string) => boolean;
  objectiveGroup?: number;
  objectiveGroups?: readonly number[];
  allObjectives?: boolean;
  onObjective?: (entry: NativePedPopulationEntry, index: number) => void;
}

const f = Math.fround;
const rawIdentifier = (material: object) => {
  const value = material as { identifier?: unknown; name?: unknown };
  return typeof value.identifier === "string"
    ? value.identifier
    : typeof value.name === "string"
      ? value.name
      : null;
};
const point = (
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
  random: () => number,
): [number, number, number] => {
  let alpha = pedRandomFloat(random, 0.1, 0.9);
  let beta = pedRandomFloat(random, 0.1, 0.9);
  if (alpha + beta > 1) {
    alpha = 1 - alpha;
    beta = 1 - beta;
  }
  return [0, 1, 2].map((axis) =>
    f(f(a[axis] * (1 - alpha - beta) + b[axis] * alpha) + c[axis] * beta),
  ) as [number, number, number];
};

/** Stateful per-race spawn plan; call visit before the track face is migrated. */
export class NativePedPopulationPlan<M extends object> {
  readonly entries: NativePedPopulationEntry[] = [];
  private readonly carry = new Map<PedSpawnSpec, number>();
  private readonly byMaterial = new Map<
    M | null,
    NativePedResolvedSpawnSpec<M>
  >();
  private readonly slopeCosine: number;
  private readonly capacity: number;

  constructor(private readonly options: NativePedPopulationPlanOptions<M>) {
    const capacity = options.capacity ?? 2000;
    if (!Number.isInteger(capacity) || capacity < 0 || capacity > 2000)
      throw new Error("Native pedestrian population capacity must be 0..2000");
    if (options.suppressAnimals && !options.animal)
      throw new Error(
        "Animal predicate required when animal suppression is enabled",
      );
    this.capacity = capacity;
    this.slopeCosine = nativePedSlopeCosine(options.maxSlopeDegrees);
    for (const resolved of options.specs) {
      if (!this.byMaterial.has(resolved.material))
        this.byMaterial.set(resolved.material, resolved);
    }
  }

  /** Return entries created by this face. Capacity exhaustion leaves carry
   * untouched, matching the source return before its remainder store. */
  visit<V, F>(
    visit: NativeTrackFaceVisit<M, V, F>,
  ): readonly NativePedPopulationEntry[] {
    const { model, face } = visit;
    const resolved = this.byMaterial.get(face.material);
    if (!resolved || !face.material || this.entries.length >= this.capacity)
      return [];
    const identifier = rawIdentifier(face.material);
    if (
      identifier === null ||
      identifier.length - 4 <= 7 ||
      identifier[7] !== "?"
    )
      return [];
    const [ia, ib, ic] = face.indices;
    const a = model.vertices[ia]?.position;
    const b = model.vertices[ib]?.position;
    const c = model.vertices[ic]?.position;
    if (!a || !b || !c) return [];
    const plane = prepareNativeModelFacePlane(a, b, c);
    if (plane.normal[1] <= this.slopeCosine) return [];

    const areaXZ = Math.abs(
      (a[0] * (b[2] - c[2]) + b[0] * (c[2] - a[2]) + c[0] * (a[2] - b[2])) / 2,
    );
    const spec = resolved.spec;
    const priorCarry = this.carry.get(spec) ?? 0;
    const expected =
      spec.density < 0
        ? -spec.density
        : priorCarry + (6.9 * 6.9 * areaXZ * spec.density) / 1000;
    const count = Math.floor(expected);
    const nextCarry = expected - count;
    const created: NativePedPopulationEntry[] = [];
    for (let i = 0; i < count; i++) {
      if (this.entries.length >= this.capacity) return created;
      const names = this.options.groups.get(spec.group) ?? [];
      if (!names.length) continue;
      const selected =
        names[pedRandomInteger(this.options.random, 0, names.length - 1)];
      if (this.options.suppressAnimals && this.options.animal!(selected))
        continue;
      let x = this.options.random() * 2 - 1;
      let z = this.options.random() * 2 - 1;
      const length = Math.hypot(x, z);
      if (length === 0) {
        x = 1;
        z = 0;
      } else {
        x /= length;
        z /= length;
      }
      const position = point(a, b, c, this.options.random);
      const movement = spec.movement;
      const movementRow = this.options.movements[movement];
      const walkPeriod =
        movementRow && movementRow.maxWalkPeriod !== 0
          ? pedRandomInteger(
              this.options.random,
              movementRow.minWalkPeriod,
              movementRow.maxWalkPeriod,
            )
          : 0;
      const entry: NativePedPopulationEntry = {
        spec,
        sourceTriangle: [[...a], [...b], [...c]],
        personality: selected,
        position,
        direction: [f(x), 0, f(z)],
        movement,
        walkPeriod,
        group: spec.group,
        sourceModel: model.identity,
        sourceFaceIndex: face.sourceFaceIndex,
        ...(this.options.allObjectives ||
        this.options.objectiveGroup === spec.group ||
        this.options.objectiveGroups?.includes(spec.group)
          ? { objective: true }
          : {}),
      };
      this.entries.push(entry);
      if (entry.objective)
        this.options.onObjective?.(entry, this.entries.length - 1);
      created.push(entry);
    }
    this.carry.set(spec, nextCarry);
    return created;
  }

  carryFor(spec: PedSpawnSpec): number {
    return this.carry.get(spec) ?? 0;
  }
}
