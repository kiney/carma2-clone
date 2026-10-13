import { Matrix4, Mesh, Object3D, Vector3 } from "three";
import type { DatFace } from "./formats";
import {
  prepareNativeModelVertexOrder,
  type ModelPreparedOptions,
} from "./car-smoke";
import { sharedNativeRandom } from "./native-random";
import type {
  NonCarDebrisAssetSet,
  NonCarDebrisTemplate,
} from "./noncar-debris-assets";
import { createNonCarBody, type NonCarBody } from "./physics/noncar-body";
import { nativeShrapnelMovement } from "./shrapnel-movement";
import type { SmokeColumnSource, SmokeRigid } from "./smoke";
import type { SmashShrapnel } from "./world-smash";

export type NativeNonCarBodySlot =
  | { kind: "dedicated"; mechanicsIndex: number }
  | { kind: "extra"; index: number };

export interface NativeNonCarDebrisHost {
  /** Native compacted original ACT count; render capacity is this plus250. */
  originalActorCount: number;
  /** Includes other native ACT consumers and unreclaimed clone reservations. */
  readActorCount(): number;
  /** These operations own ACT registration/count increment and decrement. */
  addActor(actor: Object3D): void;
  removeActor(actor: Object3D): void;
  /** Driver4 means occupied. The host owns existing props and reclaim timing. */
  isBodySlotOccupied(slot: NativeNonCarBodySlot): boolean;
  /** Native pull reuses an allocated dedicated/extra body. A host implementing
   * actual resource reuse supplies this; default creates the browser body. */
  pull?(
    actor: Object3D,
    template: NonCarDebrisTemplate,
    slot: NativeNonCarBodySlot,
  ): NonCarBody | null;
  registerBody(body: NonCarBody, slot: NativeNonCarBodySlot): void;
  /** Synchronous: native column construction may consume the same CRT stream. */
  addSmokeColumn?(source: SmokeColumnSource): void;
  preparedOptions?(template: NonCarDebrisTemplate): ModelPreparedOptions;
  diagnose?(message: string): void;
}

export interface NativeNonCarDebrisContext {
  /** Actor-based optional captured frame, or the source ACT frame if absent.
   * Already chosen by the caller; never compose source ACT a second time. */
  frame: Matrix4;
  point: Vector3;
  /** Starting-step velocity already in native metric units. */
  impacteeVelocity: Vector3;
}

export interface NativeDebrisRandom {
  random(): number;
  seed(value: number): void;
}

export interface NativeNonCarDebrisLaunch {
  actor: Object3D;
  body: NonCarBody;
  slot: NativeNonCarBodySlot;
  /** Native body-space +74 before the browser world-omega bridge. */
  nativeOmega: Vector3;
  attemptSeed: number;
  savedMovementRand: number;
}

const f32 = Math.fround;
const TWO_PI = 6.283185307179586;

function store(vector: Vector3): Vector3 {
  vector.set(f32(vector.x), f32(vector.y), f32(vector.z));
  if (!vector.toArray().every(Number.isFinite))
    throw new Error("Invalid native noncar-debris vector");
  return vector;
}
function integer(value: number, name: string, maximum = 0x7fffffff): number {
  if (!Number.isInteger(value) || value < 0 || value > maximum)
    throw new Error(`Invalid native noncar-debris ${name}`);
  return value;
}

/** Complete free-body initialization before assigning launch fields. Calling
 * releaseNonCar/finalizeNonCarRelease after launch would erase both velocities. */
export function initializeNativeNonCarDebrisBody(body: NonCarBody): void {
  body.attached = false;
  body.joint = undefined;
  body.pendingFreeMass = false;
  body.properties.immovable = false;
  body.properties.mass = body.mechanics.freeMass;
  body.properties.inertia
    .fromArray(body.mechanics.inertiaPerMass)
    .multiplyScalar(body.properties.mass);
  body.motor.sleeping = false;
  body.state.velocity.set(0, 0, 0);
  body.state.angularVelocity.set(0, 0, 0);
  body.previousVelocity.set(0, 0, 0);
}

/** Mode2 uses the model's single contiguous prepared vertex allocation.
 * sampleVertex writes MODEL coordinates: SmokeSystem applies the full live ACT
 * and its -.03 world-Y offset. An inclusive one-past-final index fails safely
 * and diagnoses; it is never clamped onto a different source vertex. */
export function prepareNativeNonCarSmokeSampler(
  actor: Object3D,
  options: ModelPreparedOptions = {},
  diagnose: (message: string) => void = () => {},
) {
  const mesh =
    actor instanceof Mesh
      ? actor
      : (actor.children.find((child) => child instanceof Mesh) as
          | Mesh
          | undefined);
  if (!mesh) throw new Error("Noncar fire requires the source actor's model");
  const geometry = mesh.geometry;
  const positions = geometry.getAttribute("position");
  const original = geometry.userData.sourcePositions as
    | Float32Array
    | undefined;
  const uvs = geometry.userData.sourceUVs as Float32Array | undefined;
  const flags = geometry.userData.modelFlags as number | undefined;
  const faces = geometry.userData.sourceFaces as DatFace[] | undefined;
  if (
    !positions ||
    !original ||
    !uvs ||
    flags === undefined ||
    !faces ||
    positions.count !== faces.length * 3
  )
    throw new Error(
      "Noncar fire requires original model positions, UVs, flags and faces",
    );
  const prepared = prepareNativeModelVertexOrder(
    { positions: original, uvs, flags, faces },
    options,
  );
  if (
    prepared.materialOrder === "browser-first-approximation" ||
    prepared.remainingMaterialOrder ===
      "browser-positive-material-approximation"
  )
    diagnose(
      `Noncar prepared positive material-pointer order unavailable: ${actor.name}`,
    );
  const diagnosed = new Set<number>();
  const sampleVertex = (index: number, out: Vector3): boolean => {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= prepared.corners.length
    ) {
      if (!diagnosed.has(index)) {
        diagnose(
          `Noncar prepared vertex unavailable: ${actor.name}, index ${index}, allocation ${prepared.corners.length}`,
        );
        diagnosed.add(index);
      }
      return false;
    }
    out.fromBufferAttribute(positions, prepared.corners[index]);
    return out.toArray().every(Number.isFinite);
  };
  return {
    ...prepared,
    count: prepared.corners.length,
    sampleVertex,
    sampleWorldVertex(index: number, out: Vector3): boolean {
      if (!sampleVertex(index, out)) return false;
      actor.updateWorldMatrix(true, false);
      store(out.applyMatrix4(actor.matrixWorld));
      out.y = f32(out.y - f32(0.03));
      return true;
    },
  };
}

/** Installed noncar branch4eba86–4ebde5, actor-based placement only. Native
 * ACT/body capacity, existing prop occupancy and reclaim are live host providers;
 * this module invents no fragment TTL or private per-type extra pool. */
export class NativeNonCarDebrisRuntime {
  constructor(
    readonly host: NativeNonCarDebrisHost,
    readonly random: NativeDebrisRandom = sharedNativeRandom,
  ) {
    integer(host.originalActorCount, "original ACT count");
  }

  spawn(
    spec: SmashShrapnel,
    assets: NonCarDebrisAssetSet,
    context: NativeNonCarDebrisContext,
  ): NativeNonCarDebrisLaunch[] {
    if (
      spec.kind !== "noncars" ||
      spec.position?.kind !== "actorbased" ||
      !spec.speed ||
      !spec.amount
    )
      throw new Error(
        "Noncar debris requires authored actor-based noncar specification",
      );
    if (!context.frame || !context.frame.elements.every(Number.isFinite))
      throw new Error("Invalid native noncar-debris frame");
    const incoming = store(context.impacteeVelocity.clone());
    const point = store(context.point.clone());
    const templates = assets.templates;
    if (!templates.length) {
      this.host.diagnose?.("Noncar debris has no loaded authored templates");
      return [];
    }
    const minimum = spec.amount[0];
    if (!Number.isInteger(minimum))
      throw new Error("Invalid native noncar-debris amount");
    const ordered = minimum < 0;
    const count = ordered
      ? templates.length
      : this.between(
          integer(minimum, "amount minimum"),
          integer(spec.amount[1]!, "amount maximum"),
        );
    const result: NativeNonCarDebrisLaunch[] = [];
    for (let attempt = 0; attempt < count; attempt++) {
      // 4ebae4: draw even when the render ACT array is already saturated.
      const attemptSeed = this.draw();
      const actorIndex = integer(
        this.host.readActorCount(),
        "current ACT count",
      );
      if (actorIndex >= this.host.originalActorCount + 250) {
        this.host.diagnose?.("Noncar debris native ACT capacity exhausted");
        break;
      }
      const template =
        templates[ordered ? attempt : this.between(0, templates.length - 1)];
      const actor = cloneActor(template.actor);
      actor.name =
        template.nativeIdentifier.slice(0, 4) +
        String(actorIndex).padStart(4, "0") +
        ".ACT";
      actor.matrix.premultiply(context.frame);
      for (let i = 0; i < 16; i++)
        actor.matrix.elements[i] = f32(actor.matrix.elements[i]);
      actor.matrixAutoUpdate = false;
      this.host.addActor(actor);
      const dedicated: NativeNonCarBodySlot = {
        kind: "dedicated",
        mechanicsIndex: template.mechanics.index,
      };
      let slot: NativeNonCarBodySlot | undefined = dedicated;
      if (this.host.isBodySlotOccupied(dedicated)) {
        slot = undefined;
        for (let i = 0; i < 40; i++) {
          const extra: NativeNonCarBodySlot = { kind: "extra", index: i };
          if (!this.host.isBodySlotOccupied(extra)) {
            slot = extra;
            break;
          }
        }
      }
      let body: NonCarBody | null = null;
      try {
        if (slot)
          body = this.host.pull
            ? this.host.pull(actor, template, slot)
            : createNonCarBody(actor, template.mechanics, {
                immutableHulls: true,
              });
      } catch (error) {
        this.host.diagnose?.(`Noncar debris pull failed: ${String(error)}`);
      }
      if (!body || !slot) {
        this.host.diagnose?.("Noncar debris native body pull unavailable");
        this.host.removeActor(actor);
        break; // Failed pull aborts the whole branch after decrementing ACT count.
      }
      initializeNativeNonCarDebrisBody(body);
      body.actor = actor;
      // The existing physics bridge updates position/quaternion, not a manual
      // matrix. Extract the source pose before enabling its renderer path.
      actor.matrix.decompose(actor.position, actor.quaternion, actor.scale);
      const recomposed = new Matrix4().compose(
        actor.position,
        actor.quaternion,
        actor.scale,
      );
      if (
        actor.matrix.elements.some(
          (value, i) => Math.abs(value - recomposed.elements[i]) > 1e-6,
        )
      )
        this.host.diagnose?.(
          `Noncar full ACT shear exceeds the current rigid-pose bridge: ${actor.name}`,
        );
      actor.matrixAutoUpdate = true;
      this.host.registerBody(body, slot);
      const savedMovementRand = this.draw();
      const movement = nativeShrapnelMovement({
        speed: spec.speed,
        impacteeVelocity: incoming,
        normal: new Vector3(),
        sizeFactor: 1,
        towardsPosition: point,
        piecePosition: new Vector3().setFromMatrixPosition(actor.matrix),
        random: () => this.random.random(),
      });
      body.state.velocity.copy(
        store(movement.velocity.multiplyScalar(1 / 6.9)),
      );
      const nativeOmega = store(movement.spin.multiplyScalar(TWO_PI));
      body.state.angularVelocity.copy(
        store(nativeOmega.clone().applyQuaternion(body.state.orientation)),
      );
      body.motor.sleeping = false;
      this.random.seed(attemptSeed);
      const fire = spec.fire;
      const chance = integer(fire?.chance ?? 0, "fire chance", 100);
      if (chance !== 0 && Math.floor((100 * this.draw()) / 32768) < chance) {
        const columns = integer(fire?.count ?? 0, "fire column count");
        if (columns > 0) {
          if (!fire?.smokiness)
            throw new Error("Missing native noncar-debris smokiness bounds");
          const sampler = prepareNativeNonCarSmokeSampler(
            actor,
            this.host.preparedOptions?.(template),
            (message) => this.host.diagnose?.(message),
          );
          const rigid: SmokeRigid = {
            actor,
            velocity: body.state.velocity,
            get omega() {
              return store(
                body.state.angularVelocity
                  .clone()
                  .applyQuaternion(body.state.orientation.clone().invert()),
              );
            },
          };
          for (let column = 0; column < columns; column++) {
            const vertex = this.between(0, sampler.firstGroupCount);
            const colour = this.between(
              integer(fire.smokiness[0], "smokiness minimum"),
              integer(fire.smokiness[1], "smokiness maximum"),
            );
            this.host.addSmokeColumn?.({
              mode: 2,
              actor,
              rigid,
              colour,
              vertex,
              lifetimeMs: 10_000_000,
              sampleVertex: sampler.sampleVertex,
            });
          }
        }
      }
      this.random.seed(savedMovementRand);
      result.push({
        actor,
        body,
        slot,
        nativeOmega,
        attemptSeed,
        savedMovementRand,
      });
    }
    return result;
  }

  private draw(): number {
    const value = this.random.random();
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new Error("Invalid native noncar-debris random sample");
    return Math.floor(value * 32768);
  }
  private between(minimum: number, maximum: number): number {
    if (maximum < minimum)
      throw new Error("Reversed native noncar-debris integer range");
    return (
      minimum +
      Math.trunc(Math.imul(this.draw(), maximum - minimum + 1) / 32768)
    );
  }
}

function cloneActor(source: Object3D): Object3D {
  const clone = source.clone(true);
  const originals: Object3D[] = [],
    copies: Object3D[] = [];
  source.traverse((object) => originals.push(object));
  clone.traverse((object) => copies.push(object));
  for (let i = 0; i < originals.length; i++) {
    const original = originals[i],
      copied = copies[i];
    if (original.matrixAutoUpdate) original.updateMatrix();
    copied.matrix.copy(original.matrix);
    copied.matrixAutoUpdate = false;
  }
  clone.parent = null;
  return clone;
}
