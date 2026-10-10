import { Vector2, Vector3 } from "three";
import type { TrackPathSection } from "../config";
import type { ProjectedPathSection } from "./path-route";
import { getStraightPathGeometry } from "./path-geometry";
import {
  applyNativeSOCBraking,
  calculateNativePathCorners,
  calculateNativeSpeedConstraints,
  nearestSectionInStraight,
  type NativePathCornerRecord,
} from "./path-constraints";
import {
  nativeCornerErrors,
  nativeInLaneSteering,
  nativeOutsideLaneSteering,
  nativeStraightErrors,
  type NativePathEscapeState,
} from "./path-steering";

export interface NativeFollowGeometryState {
  sectionSlot: number;
  desiredSpeed: number;
  corner?: NativePathCornerRecord & { width: number };
  escape: NativePathEscapeState;
}

export interface NativeFollowGeometryQuery {
  position: Vector3;
  /** Model units per second, before native horizontal metric conversion. */
  velocity: Vector3;
  dtMs: number;
  nowMs: number;
  maxCurve: number;
}

/** The physical geometry branch of ProcessFollowPath, independent of the
 * objective, borrowing/struggle state and direct-force controller. A corner
 * alone advances persistent section; nearest-in-straight is only a SOC query.
 * This helper is not a complete opponent brain or an arrival-distance driver. */
export function stepNativeFollowGeometry(
  nodes: readonly Vector3[],
  sections: readonly TrackPathSection[],
  route: readonly ProjectedPathSection[],
  previous: NativeFollowGeometryState,
  query: NativeFollowGeometryQuery,
  random = Math.random,
): { state: NativeFollowGeometryState; curvature: number } {
  if (
    ![
      ...query.position.toArray(),
      ...query.velocity.toArray(),
      query.dtMs,
      query.nowMs,
      query.maxCurve,
      previous.desiredSpeed,
    ].every(Number.isFinite) ||
    query.dtMs < 0 ||
    query.nowMs < 0 ||
    query.maxCurve < 0
  )
    throw new Error("Invalid native physical path query");
  const state: NativeFollowGeometryState = {
    ...previous,
    escape: { ...previous.escape },
    corner: previous.corner && {
      ...previous.corner,
      center: previous.corner.center.clone(),
    },
  };
  let straight = getStraightPathGeometry(
    nodes,
    sections,
    route,
    state.sectionSlot,
  );
  if (!straight)
    throw new Error("Native physical path requires a projected route");
  const position = new Vector2(query.position.z, query.position.x);
  const liveX = Math.fround(query.velocity.z) * 6.9;
  const liveY = Math.fround(query.velocity.x) * 6.9;
  const velocity = new Vector2(Math.fround(liveX), Math.fround(liveY));
  // Installed4afe07–29 multiplies each live component by its stored value.
  const speed = Math.fround(Math.sqrt(liveX * velocity.x + liveY * velocity.y));
  const finishDeltaX = Math.fround(position.x - straight.finish.x);
  const finishDeltaY = Math.fround(position.y - straight.finish.y);
  const distanceSquared = finishDeltaX ** 2 + finishDeltaY ** 2;
  const makeConstraints = (startSlot: number) => {
    const corners = calculateNativePathCorners(
      nodes,
      sections,
      route,
      state.sectionSlot,
      random,
    );
    const constraints = calculateNativeSpeedConstraints(
      nodes,
      sections,
      route,
      corners,
      startSlot,
    );
    return { corners, constraints };
  };
  if (!state.corner) {
    const delta = straight.finish.clone().sub(straight.start);
    const projectedDistance =
      delta.length() > 0
        ? position.clone().sub(straight.start).dot(delta) / delta.length()
        : 0;
    const nearest = nearestSectionInStraight(
      nodes,
      sections,
      route,
      state.sectionSlot,
      straight.nextSlot,
      projectedDistance,
    );
    const { corners, constraints } = makeConstraints(nearest);
    const first = corners[0];
    if (
      first &&
      query.dtMs * speed * Math.fround(0.0005) >
        Math.fround(6.9) * (Math.sqrt(distanceSquared) - first.tangentReach)
    ) {
      const width = sections[route[first.sectionSlot].section].width;
      state.corner = { ...first, center: first.center.clone(), width };
      // StuffDataFromCorner does not write desired_speed: retain prior state.
    } else {
      state.desiredSpeed = applyNativeSOCBraking(
        nodes,
        sections,
        route,
        corners,
        constraints,
        { position: query.position, speed, desiredSpeed: 80, dtMs: query.dtMs },
      ).desiredSpeed;
    }
  } else if (distanceSquared <= state.corner.tangentReach ** 2) {
    const corners = calculateNativePathCorners(
      nodes,
      sections,
      route,
      state.sectionSlot,
      random,
    );
    const first = corners[0];
    // Native would read uninitialized corner storage on malformed routes.
    if (!first)
      throw new Error("Native active corner has no following geometry");
    const constraints = calculateNativeSpeedConstraints(
      nodes,
      sections,
      route,
      corners,
      first.sectionSlot,
    );
    state.desiredSpeed = applyNativeSOCBraking(
      nodes,
      sections,
      route,
      corners,
      constraints,
      {
        position: query.position,
        speed,
        desiredSpeed: Math.min(80, first.speed),
        dtMs: query.dtMs,
      },
    ).desiredSpeed;
  } else {
    state.sectionSlot = state.corner.sectionSlot;
    state.corner = undefined;
    straight = getStraightPathGeometry(
      nodes,
      sections,
      route,
      state.sectionSlot,
    )!;
  }
  const errors = state.corner
    ? nativeCornerErrors(
        state.corner.center,
        state.corner.radius,
        state.corner.width,
        state.corner.left,
        position,
        velocity,
        speed,
      )
    : nativeStraightErrors(
        straight.start,
        straight.finish,
        position,
        velocity,
        straight.width,
        speed,
      );
  const inLane = nativeInLaneSteering(
    errors,
    state.desiredSpeed,
    speed,
    query.maxCurve,
  );
  if (inLane) {
    state.desiredSpeed = inLane.desiredSpeed;
    state.escape.timeMs = 0;
    return { state, curvature: inLane.curvature };
  }
  const escape = nativeOutsideLaneSteering(
    straight.start,
    straight.finish,
    position,
    velocity,
    query.maxCurve,
    query.nowMs,
    state.escape,
    speed,
  );
  state.escape = escape.escape;
  state.desiredSpeed = escape.desiredSpeed;
  return { state, curvature: escape.curvature };
}
