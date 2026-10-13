import { Box3, Quaternion, Vector3 } from "three";
import type { HullBody } from "./pair-guard";

export interface StationaryBoundsDiagnostics {
  boundsBuilds?: number;
  boundsHits?: number;
  boundsVertexTests?: number;
}
interface BoundsEntry {
  values: number[];
  bounds: Box3;
}
type Visit = (value: number) => void;
function pose(position: Vector3, orientation: Quaternion, visit: Visit) {
  visit(position.x);
  visit(position.y);
  visit(position.z);
  visit(orientation.x);
  visit(orientation.y);
  visit(orientation.z);
  visit(orientation.w);
}
/** Bounds ignore source planes/edges, but compact vertexOrder is authoritative:
 * unused authored vertices do not participate in hullsBounds(). */
function values(body: HullBody, visit: Visit) {
  const state = body.state;
  pose(state.position, state.orientation, visit);
  pose(state.predictedPosition!, state.predictedOrientation!, visit);
  visit(body.hulls.length);
  for (const hull of body.hulls) {
    visit(hull.vertices.length);
    for (const vertex of hull.vertices) {
      visit(vertex.x);
      visit(vertex.y);
      visit(vertex.z);
    }
    visit(hull.vertexOrder === undefined ? 0 : 1);
    if (hull.vertexOrder) {
      visit(hull.vertexOrder.length);
      for (const index of hull.vertexOrder) visit(index);
    }
  }
}
function at(body: HullBody, position: Vector3, orientation: Quaternion): Box3 {
  const bounds = new Box3();
  for (const hull of body.hulls) {
    if (hull.vertexOrder) {
      for (const index of hull.vertexOrder)
        bounds.expandByPoint(
          hull.vertices[index]
            .clone()
            .applyQuaternion(orientation)
            .add(position),
        );
    } else {
      for (const vertex of hull.vertices)
        bounds.expandByPoint(
          vertex.clone().applyQuaternion(orientation).add(position),
        );
    }
  }
  return bounds;
}

/** Persistent aggregate broadphase bounds for caller-certified immovable
 * polygonal noncars. Never use for native spheres, whose bounds are analytic.
 * Exact OLD/NEXT pose and source vertex values are checked on every get; no
 * object/array identity or shape immutability assumption substitutes for them.
 * Faces/edges and other collision metadata remain the narrow phase's concern.
 * The returned Box3 is owned by this cache: consumers must treat it as immutable
 * and clone before expanding or unioning. Missing candidate poses are an error,
 * matching the existing transformed-hull collection's required endpoints. */
export class StationaryBoundsCache {
  private entries = new WeakMap<HullBody, BoundsEntry>();
  constructor(public diagnostics?: StationaryBoundsDiagnostics) {}
  private count(key: keyof StationaryBoundsDiagnostics, amount = 1) {
    if (this.diagnostics)
      this.diagnostics[key] = (this.diagnostics[key] ?? 0) + amount;
  }
  get(body: HullBody): Box3 {
    if (!body.state.predictedPosition || !body.state.predictedOrientation)
      throw new Error(
        "Stationary bounds require both candidate pose endpoints",
      );
    const old = this.entries.get(body);
    let offset = 0,
      same = !!old;
    for (const hull of body.hulls)
      this.count("boundsVertexTests", hull.vertices.length);
    values(body, (value) => {
      if (!old || !Object.is(old.values[offset], value)) same = false;
      offset++;
    });
    if (same && offset === old!.values.length) {
      this.count("boundsHits");
      return old!.bounds;
    }
    const captured: number[] = [];
    values(body, (value) => captured.push(value));
    const bounds = at(body, body.state.position, body.state.orientation).union(
      at(body, body.state.predictedPosition, body.state.predictedOrientation),
    );
    this.entries.set(body, { values: captured, bounds });
    this.count("boundsBuilds");
    return bounds;
  }
}
