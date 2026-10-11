import {
  NativeDelayedSideEffects,
  type NativeDelayedTask,
} from "./smash-delayed";
import type { SmashSideEffect, SmashVec3, WorldSmashSpec } from "./world-smash";

export type FollowupVector = readonly [number, number, number];
/** Column-major affine matrix, in the same model units as native physics. */
export type FollowupMatrix = readonly number[];
export type FollowupTargetClass =
  | "all"
  | "materials"
  | "actors"
  | "numbers"
  | "material-name"
  | "actor-name"
  | "number-name";

/** Reader 0x4ef2d0 compares suffixes without case, runtime names with case. */
export function classifyFollowupTarget(name: string): FollowupTargetClass {
  if (name === "*") return "all";
  const suffix = name.slice(-4).toUpperCase();
  if (name.startsWith("*")) {
    if (suffix === ".MAT") return "materials";
    if (suffix === ".DAT" || suffix === ".ACT") return "actors";
  }
  if (name === "&*") return "numbers";
  if (/^&\d/.test(name)) return "number-name";
  if (suffix === ".MAT") return "material-name";
  if (suffix === ".DAT" || suffix === ".ACT") return "actor-name";
  return "all";
}

const bindingKey = (name: string) =>
  name.replace(/\.(ACT|DAT|MAT|PIX)$/i, "").toLowerCase();
/** Existing ACT metadata unions model/material/number bindings. Model tags
 * prove original registration even after the ACT is renamed. Actual DAT/ACT
 * names disambiguate sibling bindings; a single original identity can fall
 * back to its authoritative tag. Omitted names accept the metadata's last
 * model binding. The packing pass leaves the last matching spec in the ID. */
export function resolveFollowupActorSpec(
  specs: readonly WorldSmashSpec[],
  metadataIndices: readonly number[],
  actualModelNames?: readonly string[],
): WorldSmashSpec | undefined {
  const models = metadataIndices
    .filter((i) => specs[i]?.trigger.kind === "model")
    .sort((a, b) => a - b);
  const last = models.at(-1);
  if (last === undefined) return undefined;
  if (!actualModelNames?.length) return specs[last];
  const names = new Set(actualModelNames.map(bindingKey));
  const matched = models.filter((i) =>
    names.has(bindingKey(specs[i].trigger.name)),
  );
  if (matched.length) return specs[matched[matched.length - 1]];
  const identities = new Set(
    models.map((i) => bindingKey(specs[i].trigger.name)),
  );
  return identities.size === 1 ? specs[last] : undefined;
}

export interface FollowupActor {
  identity: object;
  /** Read live: numbered actors may acquire '!' before this task becomes due. */
  readIdentifier(): string;
  /** Native ACT local t.translation, not a world bounds center. */
  readTranslation(): FollowupVector;
  ordinarySpec?: WorldSmashSpec;
  /** Native packed ordinary ACT IDs can be represented by existing spec metadata. */
  ordinarySpecProxy?: boolean;
  numbered?: { registered: boolean; argument: number };
}
export interface FollowupMaterial {
  identifier: string;
  spec?: WorldSmashSpec;
  /** Adapter's independently resolved material binding replaces packed ID bytes. */
  specProxy?: boolean;
}
export interface FollowupFace {
  actor: FollowupActor;
  groupIndex: number;
  faceIndex: number;
  vertices: readonly [FollowupVector, FollowupVector, FollowupVector];
  normal: FollowupVector;
  material?: FollowupMaterial;
  /** Optional retained UV/source-face data needed by the world smash adapter. */
  source?: unknown;
}
export interface FollowupSourcePhysics {
  actor: object;
  readMatrix(): FollowupMatrix;
  readVelocity(): FollowupVector;
}
export interface FollowupQuery {
  min: FollowupVector;
  max: FollowupVector;
  /** Native tBounds.mat is the track root, never the impacting actor. */
  trackMatrix: FollowupMatrix;
}
export interface FollowupPayload {
  sourcePhysics: FollowupSourcePhysics;
  sourceVelocity: FollowupVector;
  point: FollowupVector;
  force: FollowupVector;
  magnitude: number;
  dueMs: number;
  targetKind: "material" | "actor";
  targetSpec?: WorldSmashSpec;
  face: FollowupFace;
}
export interface FollowupDue extends FollowupPayload {
  route: "numbered" | "world";
  selector: 1;
  callerFlag: 0;
  /** Numbered route must pull/mark actor BEFORE evaluating this bit-two gate. */
  numberedArgument?: number;
  eligibleAfterRelease: boolean;
}
export interface WorldFollowupOptions {
  delayed: NativeDelayedSideEffects<NativeDelayedTask>;
  readTimeMs(): number;
  readTrackMatrix(): FollowupMatrix;
  /** Return triangle-clipped native face order, including non-solid faces. The
   * 400-face limit precedes target filtering. Coarse collision bounds alone
   * are insufficient. Native order is columns, ACT/model groups, extra ACTs. */
  collectFaces(query: FollowupQuery, capacity: 400): readonly FollowupFace[];
  random?: () => number;
  onDue(context: FollowupDue): void;
  /** Inspected parallel branch uses undefined scratch; no force is invented. */
  onUnsupportedDirection?: (effect: SmashSideEffect) => void;
}

const f32 = Math.fround;
const vector = (v: FollowupVector): SmashVec3 => [
  f32(v[0]),
  f32(v[1]),
  f32(v[2]),
];
const packed = (id: string) => id.length === 12 && id[5] === "|";
const numeric = (id: string) => /^&\d/.test(id);
const EPSILON = 2 ** -22;

function transform(point: FollowupVector, matrix: FollowupMatrix): SmashVec3 {
  if (matrix.length !== 16 || !matrix.every(Number.isFinite))
    throw new Error("Invalid followup physics matrix");
  const p = vector(point);
  return [0, 1, 2].map((axis) =>
    f32(
      p[0] * f32(matrix[axis]) +
        p[1] * f32(matrix[axis + 4]) +
        p[2] * f32(matrix[axis + 8]) +
        f32(matrix[axis + 12]),
    ),
  ) as SmashVec3;
}

/** Native relative cuboids transform only two corners, then swap axes. */
export function followupBounds(
  effect: SmashSideEffect,
  sourceMatrix: FollowupMatrix,
): { min: SmashVec3; max: SmashVec3 } {
  if (effect.coordinates === "absolute")
    return { min: vector(effect.min), max: vector(effect.max) };
  const min = transform(effect.min, sourceMatrix);
  const max = transform(effect.max, sourceMatrix);
  for (let i = 0; i < 3; i++)
    if (min[i] > max[i]) [min[i], max[i]] = [max[i], min[i]];
  return { min, max };
}

function candidate(
  face: FollowupFace,
  target: string,
): {
  kind: "material" | "actor";
  point: SmashVec3;
  spec?: WorldSmashSpec;
} | null {
  const type = classifyFollowupTarget(target);
  const material = face.material;
  // A packed smash material owns the face: rejected material selectors never
  // fall through to the ACT binding, even when that ACT is smashable.
  if (
    material &&
    (packed(material.identifier) || (material.specProxy && material.spec))
  ) {
    if (
      type !== "all" &&
      type !== "materials" &&
      !(type === "material-name" && material.identifier === target)
    )
      return null;
    const third = f32(1 / 3);
    const vertices = face.vertices.map(vector);
    return {
      kind: "material",
      point: [0, 1, 2].map((i) =>
        f32((vertices[0][i] + vertices[1][i] + vertices[2][i]) * third),
      ) as SmashVec3,
      spec: material.spec,
    };
  }
  const actor = face.actor;
  const id = actor.readIdentifier();
  if (
    !(
      packed(id) ||
      id[1] === "\u00a3" ||
      (actor.ordinarySpecProxy && actor.ordinarySpec) ||
      (numeric(id) && actor.numbered?.registered)
    )
  )
    return null;
  if (numeric(id)) {
    if (id[3] === "!") return null;
    if (
      type !== "all" &&
      type !== "numbers" &&
      !(type === "number-name" && id.slice(1, 3) === target.slice(1, 3))
    )
      return null;
  } else if (
    type !== "all" &&
    type !== "actors" &&
    !(type === "actor-name" && id === target)
  )
    return null;
  return {
    kind: "actor",
    point: vector(actor.readTranslation()),
    spec: actor.ordinarySpec,
  };
}

/** Delay words are zero-extended milliseconds, regardless of signed declarations. */
export function followupDelayMs(
  seconds: readonly [number, number],
  random: () => number,
): number {
  if (!seconds.every(Number.isInteger))
    throw new Error("Followup delays require authored integer seconds");
  const lo = (seconds[0] * 1000) & 0xffff;
  const hi = (seconds[1] * 1000) & 0xffff;
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1)
    throw new Error("Followup random must be in [0,1)");
  const draw = Math.floor(value * 0x8000);
  return lo + Math.trunc((draw * (hi - lo + 1)) / 0x8000);
}

export class WorldFollowupTask implements NativeDelayedTask {
  constructor(
    readonly payload: FollowupPayload,
    private readonly onDue: (context: FollowupDue) => void,
  ) {}
  advance(nowMs: number): boolean {
    if (nowMs >>> 0 < this.payload.dueMs) return false;
    const actor = this.payload.face.actor;
    const numbered =
      this.payload.targetKind === "actor" && numeric(actor.readIdentifier());
    const argument = numbered ? actor.numbered?.argument : undefined;
    this.onDue({
      ...this.payload,
      route: numbered ? "numbered" : "world",
      selector: 1,
      callerFlag: 0,
      numberedArgument: argument,
      eligibleAfterRelease: !numbered || !!((argument ?? 0) & 2),
    });
    return true;
  }
}

export class WorldFollowupRuntime {
  constructor(private readonly options: WorldFollowupOptions) {}

  enqueue(
    effects: readonly SmashSideEffect[],
    sourcePhysics: FollowupSourcePhysics,
    incomingMagnitude: number,
  ): number {
    if (!Number.isFinite(incomingMagnitude))
      throw new Error("Invalid followup magnitude");
    const now = this.options.readTimeMs();
    if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffff)
      throw new Error("Invalid followup clock");
    let inserted = 0;
    for (const effect of effects) {
      if (effect.direction === "parallel") {
        this.options.onUnsupportedDirection?.(effect);
        continue;
      }
      if (
        ![...effect.min, ...effect.max, effect.strength].every(Number.isFinite)
      )
        throw new Error("Invalid followup effect");
      const bounds = followupBounds(effect, sourcePhysics.readMatrix());
      const faces = this.options
        .collectFaces(
          { ...bounds, trackMatrix: [...this.options.readTrackMatrix()] },
          400,
        )
        .slice(0, 400);
      for (const face of faces) {
        const selected = candidate(face, effect.target);
        if (!selected || face.actor.identity === sourcePhysics.actor) continue;
        const duplicate = this.options.delayed.find((entry) => {
          if (
            entry.kind !== "smash" ||
            !(entry.context instanceof WorldFollowupTask)
          )
            return false;
          const pending = entry.context.payload;
          if (pending.face.actor.identity !== face.actor.identity) return false;
          return (
            selected.kind === "actor" ||
            (pending.face.groupIndex === face.groupIndex &&
              pending.face.faceIndex === face.faceIndex)
          );
        });
        if (duplicate) continue;
        const sourceVelocity = vector(sourcePhysics.readVelocity());
        const dueMs =
          (now +
            followupDelayMs(
              effect.delaySeconds,
              this.options.random ?? Math.random,
            )) >>>
          0;
        const matrix = sourcePhysics.readMatrix();
        const origin: SmashVec3 = [
          f32(matrix[12]),
          f32(matrix[13]),
          f32(matrix[14]),
        ];
        const sign = effect.direction === "away" ? 1 : -1;
        const delta = selected.point.map((v, i) => sign * (v - origin[i]));
        const length = Math.sqrt(delta[0] ** 2 + delta[1] ** 2 + delta[2] ** 2);
        const direction =
          length <= EPSILON ? [1, 0, 0] : delta.map((v) => f32(v / length));
        const strength = f32(effect.strength);
        const magnitude =
          strength < 0 ? f32(-f32(incomingMagnitude) * strength) : strength;
        const payload: FollowupPayload = {
          sourcePhysics,
          sourceVelocity,
          point: selected.point,
          force: direction.map((v) => f32(v * magnitude)) as SmashVec3,
          magnitude,
          dueMs,
          targetKind: selected.kind,
          targetSpec: selected.spec,
          face: {
            ...face,
            vertices: face.vertices.map(vector) as [
              SmashVec3,
              SmashVec3,
              SmashVec3,
            ],
            normal: vector(face.normal),
            material: face.material ? { ...face.material } : undefined,
          },
        };
        if (
          this.options.delayed.enqueue({
            kind: "smash",
            context: new WorldFollowupTask(payload, this.options.onDue),
          })
        )
          inserted++;
      }
    }
    return inserted;
  }
}
