import { Vector3 } from "three";
import type { TrackPathSection } from "../config";
import { nextProjectedPathSlot, type ProjectedPathSection } from "./path-route";

export interface CheatyPathState {
  /** Logical projected route slot; -1 is the native end-of-route sentinel. */
  sectionSlot: number;
  movingToIntersection: boolean;
  intersection: Vector3;
}

export interface CheatyPathResult {
  kind: "ok" | "path-end";
  state: CheatyPathState;
  position: Vector3;
  /** Entry asks the caller to run the native physics-off side effect. */
  requestPhysicsOff?: true;
  /** Present only for stable cheaty processing; native collision velocity. */
  velocity?: Vector3;
  /** Direction passed to native actor orientation helper, where applicable. */
  lookVector?: Vector3;
}

const f32 = Math.fround;
const finiteVector = (v: Vector3) => v.toArray().every(Number.isFinite);

function validate(
  position: Vector3,
  route: readonly ProjectedPathSection[],
  nodes: readonly Vector3[],
  sections: readonly TrackPathSection[],
  framePeriodMs: number,
  routeCapacity: 12 | 24,
) {
  if (
    !finiteVector(position) ||
    !finiteVector(storedPosition(position)) ||
    nodes.some((node) => !finiteVector(node)) ||
    nodes.some((node) => !finiteVector(storedPosition(node))) ||
    !Number.isInteger(framePeriodMs) ||
    framePeriodMs < 0 ||
    framePeriodMs > 0xffffffff ||
    (routeCapacity !== 12 && routeCapacity !== 24) ||
    route.length > routeCapacity
  )
    throw new Error("Invalid native cheaty-path input");
  for (const entry of route) {
    if (
      !Number.isInteger(entry.section) ||
      !sections[entry.section] ||
      (entry.direction !== 0 && entry.direction !== 1)
    )
      throw new Error("Invalid native cheaty-path route entry");
    const section = sections[entry.section];
    if (!nodes[section.nodeIndices[0]] || !nodes[section.nodeIndices[1]])
      throw new Error("Invalid native cheaty-path section nodes");
  }
}

function sectionPoints(
  entry: ProjectedPathSection,
  nodes: readonly Vector3[],
  sections: readonly TrackPathSection[],
) {
  const section = sections[entry.section];
  const start = storedPosition(nodes[section.nodeIndices[1 - entry.direction]]);
  const finish = storedPosition(nodes[section.nodeIndices[entry.direction]]);
  return { start, finish };
}

function storedDelta(to: Vector3, from: Vector3): Vector3 {
  // The binary stores the component differences to Float32 locals before its
  // distance/projection math; retain x87-like precision between those stores.
  return new Vector3(
    f32(to.x - from.x),
    f32(to.y - from.y),
    f32(to.z - from.z),
  );
}

function storedPosition(position: Vector3): Vector3 {
  return new Vector3(f32(position.x), f32(position.y), f32(position.z));
}

function frameStep(periodMs: number): number {
  // Installed fild(u32), fmul(double .001), fmul(float 6), fstp(float).
  return f32(periodMs * 0.001 * 6.0);
}

function projectedIntersection(
  position: Vector3,
  start: Vector3,
  finish: Vector3,
): Vector3 {
  const direction = storedDelta(finish, start);
  // The actor and endpoints load from Float32 fields. Unlike section delta,
  // actor-start remains live in x87 while contributing to projection dot.
  const actor = storedPosition(position);
  const offset = actor.clone().sub(start);
  const denominator = direction.lengthSq();
  if (denominator === 0)
    throw new Error("Cannot project onto a zero-length native path section");
  // Native divides the dot products in extended precision, then stores t as F32.
  const t = f32(offset.dot(direction) / denominator);
  if (t < 0) return storedPosition(start);
  if (t > 1) return storedPosition(finish);
  return storedPosition(start.clone().addScaledVector(direction, t));
}

function moveToward(
  position: Vector3,
  target: Vector3,
  step: number,
): { position: Vector3; reached: boolean } {
  const delta = storedDelta(target, position);
  const distance = Math.sqrt(delta.lengthSq());
  if (distance < step)
    return { position: storedPosition(target), reached: true };
  if (distance === 0)
    return { position: storedPosition(position), reached: false };
  const fraction = step / distance;
  return {
    position: storedPosition(position.clone().addScaledVector(delta, fraction)),
    reached: false,
  };
}

/** Enter the installed nonphysical path mode. The caller owns flag changes and
 * TurnOpponentPhysicsOff; this function returns the first transition step. */
export function enterCheatyPath(
  position: Vector3,
  sectionSlot: number,
  route: readonly ProjectedPathSection[],
  nodes: readonly Vector3[],
  sections: readonly TrackPathSection[],
  framePeriodMs: number,
  routeCapacity: 12 | 24 = 12,
): CheatyPathResult {
  validate(position, route, nodes, sections, framePeriodMs, routeCapacity);
  if (!Number.isInteger(sectionSlot) || !route[sectionSlot])
    throw new Error("Invalid native cheaty-path section slot");
  const { start, finish } = sectionPoints(route[sectionSlot], nodes, sections);
  const intersection = projectedIntersection(position, start, finish);
  const moved = moveToward(
    storedPosition(position),
    intersection,
    frameStep(framePeriodMs),
  );
  return {
    kind: "ok",
    state: {
      sectionSlot,
      movingToIntersection: !moved.reached,
      intersection: intersection.clone(),
    },
    position: moved.position,
    requestPhysicsOff: true,
  };
}

/** One installed ProcessFollowPath call while the opponent is nonphysical.
 * Approach frames discard their unused distance; ordinary path frames carry
 * leftover distance across endpoint crossings. */
export function stepCheatyPath(
  position: Vector3,
  state: CheatyPathState,
  route: readonly ProjectedPathSection[],
  nodes: readonly Vector3[],
  sections: readonly TrackPathSection[],
  framePeriodMs: number,
  routeCapacity: 12 | 24 = 12,
): CheatyPathResult {
  validate(position, route, nodes, sections, framePeriodMs, routeCapacity);
  if (
    !Number.isInteger(state.sectionSlot) ||
    state.sectionSlot < 0 ||
    state.sectionSlot >= route.length ||
    !finiteVector(state.intersection)
  )
    throw new Error("Invalid native cheaty-path state");

  let currentPosition = storedPosition(position);
  const nextState: CheatyPathState = {
    sectionSlot: state.sectionSlot,
    movingToIntersection: state.movingToIntersection,
    intersection: storedPosition(state.intersection),
  };
  const velocity = new Vector3(0, f32(41.4), 0);
  let remaining = frameStep(framePeriodMs);

  if (nextState.movingToIntersection) {
    const moved = moveToward(
      currentPosition,
      nextState.intersection,
      remaining,
    );
    currentPosition = moved.position;
    if (moved.reached) nextState.movingToIntersection = false;
    const { start, finish } = sectionPoints(
      route[nextState.sectionSlot],
      nodes,
      sections,
    );
    return {
      kind: "ok",
      state: nextState,
      position: currentPosition,
      velocity,
      lookVector: storedDelta(finish, start),
    };
  }

  // A finite 12-entry route bounds zero-length endpoint crossings without an
  // invented movement timeout. Each crossed slot is visited at most once.
  let crossings = 0;
  while (remaining > 0) {
    const entry = route[nextState.sectionSlot];
    const { finish } = sectionPoints(entry, nodes, sections);
    const delta = storedDelta(finish, currentPosition);
    const distance = Math.sqrt(delta.lengthSq());
    if (distance < remaining) {
      currentPosition = storedPosition(finish);
      // Installed 0x4b0cc5 writes remaining-distance to a Float32 stack local
      // before the section lookup and subsequent endpoint iteration.
      remaining = f32(remaining - distance);
      const nextSlot = nextProjectedPathSlot(
        sections,
        route,
        nextState.sectionSlot,
        true,
      );
      nextState.sectionSlot = nextSlot;
      if (nextSlot < 0)
        return {
          kind: "path-end",
          state: nextState,
          position: currentPosition,
          velocity,
        };
      if (++crossings >= route.length)
        throw new Error("Native cheaty path contains a zero-length cycle");
      continue;
    }

    if (distance !== 0) {
      const fraction = remaining / distance;
      currentPosition = storedPosition(
        currentPosition.clone().addScaledVector(delta, fraction),
      );
    }
    remaining = 0;
    const { finish: currentFinish } = sectionPoints(
      route[nextState.sectionSlot],
      nodes,
      sections,
    );
    return {
      kind: "ok",
      state: nextState,
      position: currentPosition,
      velocity,
      lookVector: storedDelta(currentFinish, currentPosition),
    };
  }

  // A zero-length frame performs no ordinary movement or section advance.
  const { finish } = sectionPoints(
    route[nextState.sectionSlot],
    nodes,
    sections,
  );
  return {
    kind: "ok",
    state: nextState,
    position: currentPosition,
    velocity,
    lookVector: storedDelta(finish, currentPosition),
  };
}
