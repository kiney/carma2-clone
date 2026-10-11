import { Box3, Matrix4, Vector3 } from "three";
import type { DatModel } from "../formats";

export interface NativeNonCarReclaimCollider<Owner> {
  owner: Owner;
  /** Actual PHIL +ec, never inferred from speed or a motor timer. */
  doNothing: boolean;
  /** Retained GetFacesNearObject +124/+144, without an epoch-validity gate. */
  cachedBounds: Box3;
  cachedInverse: Matrix4;
}

export interface NativeNonCarReclaimObject<Owner> {
  owner: Owner;
  driver: number;
  doNothing: boolean;
  /** Source ACT matrix, in the native non-track/world parent frame. */
  actorMatrix: Matrix4;
  /** Bounds of this ACT's MODEL, excluding children and collision shapes. */
  authoredModelBounds: Box3;
  committedMatrix: Matrix4;
  flags: number;
  /** Physics +17c; required only for owner flag10000. */
  jointReference?: Vector3;
  /** Native unsigned WORD; ffff is the additional-actors sentinel. */
  carId: number;
}

export interface NativeNonCarReclaimFrame<Owner> {
  activeNonCars: readonly NativeNonCarReclaimObject<Owner>[];
  /** Original combined list, retained through this increasing pass. */
  activeObjects: readonly NativeNonCarReclaimCollider<Owner>[];
  minimumWorldY: number;
  viewedOwner: Owner | null;
}

export type NativeNonCarReclaimEffect<Owner> =
  | { kind: "set-do-nothing"; owner: Owner; value: true }
  | { kind: "zero-body-omega"; owner: Owner }
  | { kind: "set-actor-matrix"; owner: Owner; matrix: Matrix4 }
  | { kind: "set-committed-translation"; owner: Owner; position: Vector3 }
  | { kind: "remove-actor"; owner: Owner }
  | { kind: "clear-splashes"; owner: Owner }
  | { kind: "set-driver"; owner: Owner; value: 0 }
  | {
      kind: "return-actor";
      owner: Owner;
      destination: "track-column" | "additional-actors";
      /** Track host uses current X/Z; additional parent may be absent. */
      position: Vector3;
      carId: number;
    }
  | { kind: "clear-actor-binding"; owner: Owner }
  | { kind: "remove-physics"; owner: Owner };

export interface NativeNonCarReclaimResult<Owner> {
  ran: boolean;
  accumulatorMs: number;
  survivors: NativeNonCarReclaimObject<Owner>[];
  reclaimed: NativeNonCarReclaimObject<Owner>[];
  effects: NativeNonCarReclaimEffect<Owner>[];
}

const f = Math.fround;
function uint(value: number, maximum: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > maximum)
    throw new Error(`Invalid native noncar reclaim ${name}`);
  return value;
}
function finite(value: number, name: string): number {
  const result = f(value);
  if (!Number.isFinite(result))
    throw new Error(`Non-finite native noncar reclaim ${name}`);
  return result;
}
function point(value: Vector3, name: string): Vector3 {
  return new Vector3(
    finite(value.x, name),
    finite(value.y, name),
    finite(value.z, name),
  );
}
function bounds(value: Box3): Box3 {
  const result = new Box3(
    point(value.min, "bounds"),
    point(value.max, "bounds"),
  );
  if (result.isEmpty()) throw new Error("Invalid native noncar reclaim bounds");
  return result;
}
function matrix(value: Matrix4): Matrix4 {
  const result = value.clone();
  for (let i = 0; i < 16; i++)
    result.elements[i] = finite(result.elements[i], "matrix");
  if (
    result.elements[3] !== 0 ||
    result.elements[7] !== 0 ||
    result.elements[11] !== 0 ||
    result.elements[15] !== 1
  )
    throw new Error("Native noncar reclaim requires an affine matrix");
  return result;
}

/** Installed DoPullActorFromWorld42002a..420063. Bytes5..7, not the full
 * decimal clone suffix. Only the explicit additional-parent case means -1. */
export function nativeNonCarId(
  identifier: string,
  additionalActorParent: boolean,
): number {
  if (additionalActorParent) return 0xffff;
  if (identifier.length < 8)
    throw new Error("Native noncar identifier lacks bytes5..7");
  const signed = (index: number) => {
    const byte = identifier.charCodeAt(index);
    if (byte > 255)
      throw new Error("Native noncar identifier is not byte text");
    return byte >= 128 ? byte - 256 : byte;
  };
  return (100 * signed(5) + 10 * signed(6) + signed(7) - 5328) & 0xffff;
}

/** BRender PrepareBoundingBox scans ALL original model vertices, including
 * unused vertices, before preparation. Render triangles/hulls/child meshes
 * are not equivalent. Custom MODEL bounds require the original provider. */
export function nativeNonCarModelBounds(
  model: Pick<DatModel, "positions" | "flags">,
  customBounds?: Box3,
): Box3 {
  uint(model.flags, 0xffff, "model flags");
  if (model.flags & 0x400) {
    if (!customBounds)
      throw new Error("Native noncar MODEL requires authored custom bounds");
    return bounds(customBounds);
  }
  const positions = model.positions;
  if (!positions.length || positions.length % 3)
    throw new Error("Invalid native noncar MODEL positions");
  const result = new Box3();
  for (let i = 0; i < positions.length; i += 3)
    result.expandByPoint(
      point(
        new Vector3(positions[i], positions[i + 1], positions[i + 2]),
        "model vertex",
      ),
    );
  return result;
}

/** Installed GetNewBoundingBox45fab0: Float32 extent/contribution stores,
 * then one Float32 addition per source axis (unlike rec2's combined sum).
 * The reversed product bridges BRender row vectors to Three column vectors. */
export function nativeNonCarReclaimBounds(
  modelBounds: Box3,
  actorMatrix: Matrix4,
  cachedInverse: Matrix4,
): Box3 {
  const box = bounds(modelBounds),
    transform = matrix(matrix(cachedInverse).multiply(matrix(actorMatrix))),
    e = transform.elements,
    min = point(box.min.clone().applyMatrix4(transform), "transformed bounds"),
    max = min.clone(),
    extent = point(box.max.clone().sub(box.min), "bounds extent");
  for (let axis = 0; axis < 3; axis++) {
    for (let component = 0; component < 3; component++) {
      const contribution = finite(
        e[axis * 4 + component] * extent.getComponent(axis),
        "bounds contribution",
      );
      const target = contribution < 0 ? min : max;
      target.setComponent(
        component,
        finite(target.getComponent(component) + contribution, "bounds sum"),
      );
    }
  }
  return new Box3(min, max);
}

/** Installed4203e0. Host effects are dispatched inline in native order; the
 * kernel owns no ACT count, resource disposal, sleep heuristic or RNG.
 * Caller owns preceding PipeNonCars replay recording on every active outer
 * frame, including frames before the reclaim accumulator reaches1000.
 * Evidence: docs/c2-noncar-slot-reclaim-re.md. */
export class NativeNonCarReclaimRuntime<Owner> {
  accumulatorMs: number;
  constructor(initialAccumulatorMs = 0) {
    this.accumulatorMs = uint(initialAccumulatorMs, 0xffffffff, "accumulator");
  }

  advanceFrame(
    framePeriodMs: number,
    frame: NativeNonCarReclaimFrame<Owner>,
    emitEffect: (effect: NativeNonCarReclaimEffect<Owner>) => void = () => {},
  ): NativeNonCarReclaimResult<Owner> {
    const period = uint(framePeriodMs, 0xffffffff, "frame period"),
      survivors: NativeNonCarReclaimObject<Owner>[] = [],
      reclaimed: NativeNonCarReclaimObject<Owner>[] = [],
      effects: NativeNonCarReclaimEffect<Owner>[] = [];
    const result = (ran: boolean): NativeNonCarReclaimResult<Owner> => ({
      ran,
      accumulatorMs: this.accumulatorMs,
      survivors,
      reclaimed,
      effects,
    });
    if (!frame.activeNonCars.length) return result(false);
    this.accumulatorMs = (this.accumulatorMs + period) >>> 0;
    if (this.accumulatorMs < 1000) {
      survivors.push(...frame.activeNonCars);
      return result(false);
    }
    this.accumulatorMs = 0;
    const minY = finite(frame.minimumWorldY, "minimum world Y"),
      doNothing = new Map<Owner, boolean>();
    for (const collider of frame.activeObjects) {
      if (typeof collider.doNothing !== "boolean")
        throw new Error("Missing native noncar reclaim ec provider");
      doNothing.set(collider.owner, collider.doNothing);
    }
    const emitted = (effect: NativeNonCarReclaimEffect<Owner>) => {
      effects.push(effect);
      emitEffect(effect);
    };
    const seen = new Set<Owner>();
    for (const input of frame.activeNonCars) {
      if (seen.has(input.owner))
        throw new Error("Duplicate active noncar owner");
      seen.add(input.owner);
      uint(input.driver, 0x7fffffff, "driver");
      uint(input.flags, 0xffffffff, "flags");
      uint(input.carId, 0xffff, "car ID");
      if (typeof input.doNothing !== "boolean")
        throw new Error("Missing native noncar reclaim ec provider");
      const current = { ...input, actorMatrix: input.actorMatrix.clone() };
      let asleep = input.doNothing;
      const forceSleep = () => {
        asleep = true;
        emitted({ kind: "set-do-nothing", owner: input.owner, value: true });
      };
      const actorY = f(current.actorMatrix.elements[13]);
      if (minY - 10 > actorY) forceSleep();
      // TestForNan515ad0 tests exponent bits, catching +/-Infinity as well.
      if (!Number.isFinite(actorY)) {
        emitted({ kind: "zero-body-omega", owner: input.owner });
        current.actorMatrix.makeTranslation(2000, 0, 0);
        emitted({
          kind: "set-actor-matrix",
          owner: input.owner,
          matrix: current.actorMatrix.clone(),
        });
        forceSleep();
      }
      current.doNothing = asleep;
      doNothing.set(input.owner, asleep);
      let drop = asleep && input.driver === 4;
      if (drop) {
        for (const collider of frame.activeObjects) {
          if (collider.owner === input.owner || doNothing.get(collider.owner))
            continue;
          const transformed = nativeNonCarReclaimBounds(
            input.authoredModelBounds,
            current.actorMatrix,
            collider.cachedInverse,
          );
          if (transformed.intersectsBox(bounds(collider.cachedBounds))) {
            drop = false;
            break;
          }
        }
      }
      if (drop && input.flags & 0x10000) {
        if (!input.jointReference)
          throw new Error("Missing native noncar translation reference");
        const reference = point(input.jointReference, "joint reference"),
          committed = matrix(input.committedMatrix).elements,
          dx = reference.x - committed[12],
          dy = reference.y - committed[13],
          dz = reference.z - committed[14],
          squared = dx * f(dx) + dy * f(dy) + dz * dz;
        if (squared > f(0.005 * 0.005)) drop = false;
        else {
          current.committedMatrix = input.committedMatrix
            .clone()
            .setPosition(reference);
          emitted({
            kind: "set-committed-translation",
            owner: input.owner,
            position: reference,
          });
        }
      }
      // Installed4206bc rechecks drop; rec2 omitted this essential guard.
      if (!drop || input.owner === frame.viewedOwner) {
        survivors.push(current);
        continue;
      }
      const owner = input.owner;
      emitted({ kind: "remove-actor", owner });
      emitted({ kind: "clear-splashes", owner });
      emitted({ kind: "set-driver", owner, value: 0 });
      emitted({
        kind: "return-actor",
        owner,
        destination:
          input.carId === 0xffff ? "additional-actors" : "track-column",
        position: point(
          new Vector3().setFromMatrixPosition(current.actorMatrix),
          "return position",
        ),
        carId: input.carId,
      });
      emitted({ kind: "clear-actor-binding", owner });
      emitted({ kind: "remove-physics", owner });
      reclaimed.push(current);
    }
    return result(true);
  }
}
