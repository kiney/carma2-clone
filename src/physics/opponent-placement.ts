import { Matrix4, Quaternion, Vector3 } from "three";
import type { TrackPathSection } from "../config";
import type { WorldCollision } from "../world";
import { nativeActorLookUp } from "../ai/actor-look";
import { findNearestPathSection } from "../ai/path-geometry";
import type { NativePathView } from "../ai/path-view";
import {
  NativeRematerializationState,
  type NativeActorPose,
} from "../ai/rematerialization-state";
import type { SimulatedCar, VehicleSimulation } from "./simulation";

const f = Math.fround;
const stored = (v: Vector3) => new Vector3(f(v.x), f(v.y), f(v.z));

/** Installed OnThisSection4a7d8f–4a7ec9 projects onto the current section,
 * stores the parameter before clamping and points the actor toward its end.
 */
export function nativeRematerializationSectionPose(
  position: Vector3,
  start: Vector3,
  finish: Vector3,
) {
  const a = stored(start),
    b = stored(finish),
    p = stored(position);
  if (![a, b, p].every((v) => v.toArray().every(Number.isFinite)))
    throw new Error("Invalid opponent rematerialization section geometry");
  const delta = stored(b.clone().sub(a));
  const square = delta.lengthSq();
  if (!square) return undefined;
  const t = f(
    ((p.x - a.x) * delta.x + (p.y - a.y) * delta.y + (p.z - a.z) * delta.z) /
      square,
  );
  const projected = stored(
    a.clone().addScaledVector(delta, Math.max(0, Math.min(1, t))),
  );
  const look = nativeActorLookUp(delta, projected);
  return { position: projected, orientation: look.quaternion };
}

/** Engine binding of the independently reconstructed native placement loop.
 * Real collision activity changes accompany every attempt and exhausted fallback.
 */
export class NativeOpponentPlacement {
  constructor(
    private readonly simulation: VehicleSimulation,
    private readonly world: WorldCollision,
    private readonly nodes: readonly Vector3[],
    private readonly sections: readonly TrackPathSection[],
    private readonly onFallback: (car: SimulatedCar) => void = () => {},
  ) {}

  onSection(
    car: SimulatedCar,
    view: NativePathView,
    slot: number,
    speed: number,
  ): 1 {
    if (this.simulation.isCarPhysicsActive(car)) return 1;
    const entry = view.route[slot];
    const section = entry && view.sections[entry.section];
    if (!section) throw new Error("Missing opponent rematerialization section");
    const pose = nativeRematerializationSectionPose(
      car.state.position,
      view.nodes[section.nodeIndices[1 - entry.direction]],
      view.nodes[section.nodeIndices[entry.direction]],
    );
    if (pose) {
      car.state.position.copy(pose.position);
      car.state.orientation.copy(pose.orientation);
    }
    return this.run(car, speed);
  }

  nearest(car: SimulatedCar, speed: number): 1 {
    if (this.simulation.isCarPhysicsActive(car)) return 1;
    const nearest = findNearestPathSection(
      car.state.position,
      this.nodes,
      this.sections,
    );
    if (!nearest)
      throw new Error("Cannot rematerialize opponent without a road");
    car.state.position.copy(nearest.intersection);
    car.state.orientation.copy(
      nativeActorLookUp(nearest.direction, nearest.intersection).quaternion,
    );
    const finish = this.nodes[this.sections[nearest.section].nodeIndices[1]];
    const distance = stored(finish.clone().sub(car.state.position)).length();
    this.run(car, speed);
    // Installed nearest wrapper4a7fe4–4a8056 supplies native near-end forces.
    car.state.accForce = car.state.brakeForce = 0;
    if (distance < 5) car.state.brakeForce = f(15 * car.properties.mass);
    else car.state.accForce = f(0.5 * car.properties.mass);
    return 1;
  }

  private run(car: SimulatedCar, speed: number): 1 {
    const pose = this.pose(car);
    const actor = { pose, physical: false, renderStyle: 1, collisionFlags: 0 };
    const applyPose = (next: NativeActorPose, velocity: Vector3) => {
      const orientation = new Quaternion().setFromRotationMatrix(
        new Matrix4().makeBasis(next.row0, next.row1, next.row2),
      );
      this.simulation.rematerializePose(
        car,
        next.position,
        orientation,
        velocity,
      );
    };
    const runtime = new NativeRematerializationState(actor, {
      ray: (origin, direction) => {
        // The ground helper already performs wrapper41e380's metric-to-model
        // Float32 stores. Its callback consumes model coordinates directly.
        const length = direction.length();
        const hit = this.world.raycast(origin, direction, length);
        return {
          fraction: hit ? f(hit.distance / length) : 100,
          normal: hit?.normal ?? new Vector3(0, 1, 0),
        };
      },
      applyAttemptReset: applyPose,
      sensiblePlace: () => this.simulation.testCarPlacement(car),
      successResetSpecialVolume: () => {
        this.simulation.resetCarSpecialVolume(car);
      },
      pipe: () => {}, // Replay serialization is a separate unsupported subsystem.
      rebuild: () => {
        this.simulation.setCarPhysicsActive(car, actor.physical);
        car.group.visible = actor.renderStyle !== 1;
      },
      clearDynamics: () => {
        car.state.velocity.set(0, 0, 0);
        car.state.angularVelocity.set(0, 0, 0);
        car.state.accForce = car.state.brakeForce = car.state.curvature = 0;
      },
      fallback: () => {
        applyPose(actor.pose, new Vector3());
        this.onFallback(car);
      },
    });
    return runtime.run(speed);
  }

  private pose(car: SimulatedCar): NativeActorPose {
    return {
      row0: stored(new Vector3(1, 0, 0).applyQuaternion(car.state.orientation)),
      row1: stored(new Vector3(0, 1, 0).applyQuaternion(car.state.orientation)),
      row2: stored(new Vector3(0, 0, 1).applyQuaternion(car.state.orientation)),
      position: stored(car.state.position),
    };
  }
}
