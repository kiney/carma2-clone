import type { Object3D, Vector3 } from "three";
import { sharedNativeRandom } from "./native-random";
import type { SmokeColumnSource } from "./smoke";
import type { SmashReplacementFire } from "./world-smash";

export interface ReplacementPreparedSource {
  /** Actual first prepared-group count; the random upper bound is inclusive. */
  firstGroupCount: number;
  sampleVertex(vertex: number, out: Vector3): boolean;
}

function signed(value: number, label: string): number {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff)
    throw new Error(`Invalid replacement fire ${label}`);
  return value;
}

/** Installed SmashObject4f4bc0, replacement fire4f4cd1–4f4d2e. Call after
 * committing the replacement MODEL and before its ordinary connotations.
 * A source reads the actor's current prepared MODEL on every subsequent update,
 * so neither the incoming impact car nor a previous MODEL owns its lifetime. */
export function createNativeReplacementColumns(input: {
  /** Native compares actual old/new MODEL identity before Chance or any draws. */
  modelChanged: boolean;
  fire: SmashReplacementFire;
  actor: Object3D;
  /** Host resolves live MODEL/MAT resources and caches preparation by geometry.
   * Never substitute render groups or an index/name ordering for this provider. */
  readPreparedSource(): ReplacementPreparedSource;
  spawn(source: SmokeColumnSource): void;
  random?: () => number;
}): void {
  if (!input.modelChanged) return;
  const chance = signed(input.fire.chance, "chance");
  if (chance === 0) return;
  const random = input.random ?? sharedNativeRandom.random;
  const draw = () => {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new Error("Invalid replacement fire random sample");
    return Math.floor(value * 32768);
  };
  // Chance512f30 consumes rand even for 100 and compares strictly below chance.
  if (Math.floor((100 * draw()) / 32768) >= chance) return;
  const parameters = input.fire.parameters;
  if (!parameters) throw new Error("Missing replacement fire parameters");
  const count = signed(parameters[0], "column count");
  if (count <= 0) return;
  const minimum = signed(parameters[1], "minimum colour");
  const maximum = signed(parameters[2], "maximum colour");
  if (maximum < minimum)
    throw new Error("Invalid replacement fire colour range");
  const integer = (low: number, high: number) =>
    low + Math.floor(((high - low + 1) * draw()) / 32768);
  for (let column = 0; column < count; column++) {
    const { firstGroupCount } = input.readPreparedSource();
    if (
      !Number.isInteger(firstGroupCount) ||
      firstGroupCount < 0 ||
      firstGroupCount > 0xffff
    )
      throw new Error("Invalid replacement fire prepared group count");
    const vertex = integer(0, firstGroupCount);
    const colour = integer(minimum, maximum);
    input.spawn({
      mode: 0,
      actor: input.actor,
      colour,
      vertex,
      lifetimeMs: 10_000_000,
      sampleVertex: (index, out) =>
        input.readPreparedSource().sampleVertex(index, out),
    });
  }
}
