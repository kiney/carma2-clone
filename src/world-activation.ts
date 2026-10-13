import { Box3, Matrix4, Object3D, Vector3 } from "three";
import type { SmashActivation, SmashInitialSpeed } from "./world-smash";
import type { WorldSmashContact } from "./world-destruction";
import type { NonCarBody } from "./physics/noncar-body";
import { activateNonCarMotor } from "./physics/noncar-motion";
import {
  NativeDelayedSideEffects,
  type NativeDelayedTask,
} from "./smash-delayed";

export interface WorldActivationContact extends WorldSmashContact {
  /** Installed enqueue 0x4ed5d0 copies physics velocity without a unit conversion. */
  impacteeVelocity?: Vector3;
  /** Explicit source physics world transform, when the render actor differs. */
  impacteeTransform?: Matrix4;
}
export interface WorldActivationOptions {
  random?: () => number;
  delayed?: NativeDelayedSideEffects<NativeDelayedTask>;
  readTimeMs?: () => number;
  readPhysics?: (contact: WorldActivationContact) =>
    | {
        velocity: Vector3;
        transform: Matrix4;
      }
    | undefined;
  /** Native actor.type_data != NULL: already pulled into active physics. */
  isPulled?: (body: NonCarBody) => boolean;
  /** Host reserves physical ownership before applying initial movement. */
  admit?: (body: NonCarBody) => boolean;
  onActivate?: (body: NonCarBody) => void;
}
export interface NonCarInitialMovement {
  velocity: Vector3;
  angularVelocity: Vector3;
}
const EPSILON = 2 ** -22; // installed float 0x589ee4
const ANGULAR_SCALE = 0.09587379924285257; // installed double 0x589f38
const checkedRandom = (random: () => number): number => {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1)
    throw new Error("World activation random must be in [0,1)");
  // Installed MS rand() returns15 bits; 0x512f90/0x512fc0 multiply by
  // -1/32768 (float at0x58a288), and inclusive integer delays use the same draw.
  return Math.floor(value * 0x8000) / 0x8000;
};
function validateSpeed(speed: SmashInitialSpeed): void {
  if (
    ![
      ...speed.towards,
      speed.impacteeVelocityFactor,
      speed.randomVelocityMax,
      speed.randomUpVelocityMax,
      speed.randomNormalVelocityMax,
      speed.randomSpinRateMax,
    ].every(Number.isFinite)
  )
    throw new Error("Invalid noncar initial movement");
}

/** Independent equations from installed ApplyInitialMovement 0x4eaef0 and
 * delayed dispatch 0x4ec9f0. Three towards samples and componentwise spin
 * samples are intentional source behavior, not a single spherical sample.
 * This input retains authored spin; activation reader 0x4efa60 divides it by10.
 */
export function nonCarInitialMovement(
  speed: SmashInitialSpeed,
  impacteeVelocity: Vector3,
  targetPosition: Vector3,
  actorPosition: Vector3,
  random: () => number = Math.random,
): NonCarInitialMovement {
  validateSpeed(speed);
  if (
    ![
      ...impacteeVelocity.toArray(),
      ...targetPosition.toArray(),
      ...actorPosition.toArray(),
    ].every(Number.isFinite)
  )
    throw new Error("Invalid noncar movement context");
  const sample = (min: number, max: number) =>
    min + (max - min) * checkedRandom(random);
  const signed = (max: number) => sample(-max, max);
  const velocity = impacteeVelocity
    .clone()
    .multiplyScalar(speed.impacteeVelocityFactor);
  // The native branch requires BOTH endpoints to be nonzero. It does not
  // guard a coincident target; report that undefined case instead of a NaN body.
  if (speed.towards[0] !== 0 && speed.towards[1] !== 0) {
    const towards = targetPosition.clone().sub(actorPosition);
    const distance = towards.length();
    if (distance === 0) throw new Error("Coincident noncar movement target");
    for (let i = 0; i < 3; i++)
      velocity.setComponent(
        i,
        velocity.getComponent(i) +
          (towards.getComponent(i) * sample(...speed.towards)) / distance,
      );
  }
  const spinAxis = new Vector3();
  for (let i = 0; i < 3; i++) {
    velocity.setComponent(
      i,
      velocity.getComponent(i) + signed(speed.randomVelocityMax),
    );
    spinAxis.setComponent(i, sample(0, 1));
  }
  velocity.y += sample(0, speed.randomUpVelocityMax);
  // Delayed noncars pass gZero_vector as the normal. Native normalization
  // falls back to +X and still draws three independent normal magnitudes.
  velocity.x += sample(0, speed.randomNormalVelocityMax);
  sample(0, speed.randomNormalVelocityMax);
  sample(0, speed.randomNormalVelocityMax);
  if (spinAxis.length() <= EPSILON) spinAxis.set(1, 0, 0);
  else spinAxis.normalize();
  const angularVelocity = spinAxis;
  for (let i = 0; i < 3; i++)
    angularVelocity.setComponent(
      i,
      angularVelocity.getComponent(i) *
        signed(speed.randomSpinRateMax / 10) *
        ANGULAR_SCALE,
    );
  // Queue copies model-unit velocity, then this source assignment divides by
  // 6.9. Preserve that apparent source unit quirk rather than silently fixing it.
  velocity.multiplyScalar(1 / 6.9);
  return { velocity, angularVelocity };
}

interface Action {
  body: NonCarBody;
  due: number;
  speed: SmashInitialSpeed;
  velocity: Vector3;
  target: Vector3;
}
/** Native cuboid enqueue 0x4ed5d0, candidate callback 0x4ed890 and due dispatch
 * 0x4ec9f0. Candidate identities and context are captured at smash time; each
 * selected actor has its own random delay, with a source limit of20 per cuboid.
 */
export class WorldActivationRuntime {
  readonly diagnostics: string[] = [];
  readonly delayed: NativeDelayedSideEffects<NativeDelayedTask>;
  private groups = new Set<{ actions: Action[] }>();
  private activatedDuringUpdate: NonCarBody[] = [];
  private timeMs = 0;
  constructor(
    private readonly bodies:
      | readonly NonCarBody[]
      | (() => readonly NonCarBody[]),
    private readonly options: WorldActivationOptions = {},
  ) {
    this.delayed = options.delayed ?? new NativeDelayedSideEffects();
  }
  get pendingCount(): number {
    return [...this.groups].reduce(
      (sum, group) => sum + group.actions.length,
      0,
    );
  }
  private list(): readonly NonCarBody[] {
    return typeof this.bodies === "function" ? this.bodies() : this.bodies;
  }
  enqueue(
    activation: SmashActivation,
    contact: WorldActivationContact,
  ): number {
    validateSpeed(activation.speed);
    const now = this.options.readTimeMs?.() ?? contact.timeMs ?? this.timeMs;
    if (
      !Number.isFinite(now) ||
      now < 0 ||
      now > 0xffffffff ||
      ![...activation.min, ...activation.max, ...activation.delaySeconds].every(
        Number.isFinite,
      ) ||
      !activation.delaySeconds.every(Number.isInteger) ||
      !Number.isInteger(activation.nonCarType)
    )
      throw new Error("Invalid noncar activation");
    const random = this.options.random ?? Math.random;
    let noncarActor: Object3D | undefined;
    for (let node: Object3D | null = contact.actor; node; node = node.parent)
      if (node.name.startsWith("&")) {
        noncarActor = node;
        break;
      }
    const contextActor = noncarActor ?? contact.bodyActor;
    const live = this.options.readPhysics?.(contact);
    const transform =
      live?.transform.clone() ?? contact.impacteeTransform?.clone();
    const matrix = noncarActor
      ? (noncarActor.updateWorldMatrix(true, false),
        noncarActor.matrixWorld.clone())
      : (transform ??
        (contextActor &&
          (contextActor.updateWorldMatrix(true, false),
          contextActor.matrixWorld.clone())));
    if (activation.coordinates === "relative" && !matrix) {
      this.diagnostics.push(
        "Relative activation requires impactee physics transform",
      );
      return 0;
    }
    const first = new Vector3(...activation.min),
      second = new Vector3(...activation.max);
    if (activation.coordinates === "relative") {
      first.applyMatrix4(matrix!);
      second.applyMatrix4(matrix!);
    }
    // The original transforms only the two authored corners, not all eight.
    const bounds =
      activation.coordinates === "relative"
        ? new Box3(first.clone().min(second), first.clone().max(second))
        : new Box3(first, second);
    const target = matrix
      ? new Vector3().setFromMatrixPosition(matrix)
      : new Vector3();
    if (
      (!matrix &&
        activation.speed.towards[0] !== 0 &&
        activation.speed.towards[1] !== 0) ||
      (!live &&
        !contact.impacteeVelocity &&
        activation.speed.impacteeVelocityFactor !== 0)
    ) {
      this.diagnostics.push(
        "Noncar initial movement requires impactee transform/velocity",
      );
      return 0;
    }
    const velocity =
      live?.velocity.clone() ??
      contact.impacteeVelocity?.clone() ??
      new Vector3();
    if (
      !velocity.toArray().every(Number.isFinite) ||
      (matrix && !matrix.elements.every(Number.isFinite))
    )
      throw new Error("Invalid noncar activation context");
    const speed = {
      ...activation.speed,
      towards: [...activation.speed.towards] as [number, number],
    };
    // Reader stores seconds from integer text as16-bit milliseconds; enqueue
    // zero-extends those words before inclusive IRandomBetween 0x512f00.
    const delay = activation.delaySeconds.map(
      (value) => (value * 1000) & 0xffff,
    );
    const type = (activation.nonCarType << 24) >> 24;
    const group = { actions: [] as Action[] };
    let selected = 0;
    for (const body of this.list()) {
      const match = /^&(\d{2})/.exec(body.actor.name);
      if (
        !match ||
        (type >= 0 && Number(match[1]) !== type) ||
        !bounds.containsPoint(body.state.position)
      )
        continue;
      if (selected === 20) {
        this.diagnostics.push("Noncar activation cuboid actor limit20 reached");
        break;
      }
      const milliseconds =
        delay[0] +
        Math.floor(checkedRandom(random) * (delay[1] - delay[0] + 1));
      group.actions.push({
        body,
        due: (Math.trunc(now) + milliseconds) >>> 0,
        speed,
        velocity,
        target,
      });
      selected++;
    }
    // Native samples the entire cuboid before testing shared slot capacity.
    // Even an empty cuboid retains a slot until the next delayed scan.
    if (
      !this.delayed.enqueue({
        kind: "noncar",
        context: { advance: (timeMs) => this.advanceGroup(group, timeMs) },
      })
    ) {
      this.diagnostics.push(
        "Source delayed side-effect limit20 cuboids/smashes reached",
      );
      return 0;
    }
    this.groups.add(group);
    return selected;
  }
  private advanceGroup(group: { actions: Action[] }, timeMs: number): boolean {
    const future: Action[] = [];
    for (const action of group.actions) {
      if (timeMs < action.due) {
        future.push(action);
        continue;
      }
      const body = action.body;
      const pulled =
        this.options.isPulled?.(body) ??
        (!!body.actor.userData.noncarPulled || !body.properties.immovable);
      if (pulled) continue;
      if (this.options.admit && !this.options.admit(body)) continue;
      if (body.mechanics.worldJoint?.kind === "translation")
        activateNonCarMotor(body.motor);
      else {
        if (
          action.speed.towards[0] !== 0 &&
          action.speed.towards[1] !== 0 &&
          action.target.equals(body.state.position)
        ) {
          this.diagnostics.push(
            `Undefined native initial movement at coincident target '${body.actor.name}'`,
          );
          continue;
        }
        const movement = nonCarInitialMovement(
          action.speed,
          action.velocity,
          action.target,
          body.state.position,
          this.options.random,
        );
        body.state.velocity.copy(movement.velocity);
        body.state.angularVelocity.copy(movement.angularVelocity);
        body.motor.sleeping = false;
      }
      body.actor.userData.noncarPulled = true;
      body.properties.immovable = false;
      this.activatedDuringUpdate.push(body);
      this.options.onActivate?.(body);
    }
    group.actions = future;
    if (!future.length) this.groups.delete(group);
    return !future.length;
  }
  update(timeMs: number): NonCarBody[] {
    if (!Number.isSafeInteger(timeMs) || timeMs < 0 || timeMs > 0xffffffff)
      throw new Error("Invalid world activation time");
    this.timeMs = timeMs;
    this.activatedDuringUpdate = [];
    this.delayed.update(timeMs, (entry, now) => entry.context.advance(now));
    return this.activatedDuringUpdate;
  }
  dispose(): void {
    this.delayed.initialize();
    this.groups.clear();
  }
}
