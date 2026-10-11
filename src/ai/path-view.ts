import { Vector3 } from "three";
import type { TrackPathSection } from "../config";
import { nextProjectedPathSlot, type ProjectedPathSection } from "./path-route";

export type NativePathKind = "projected" | "direct" | "trail";

/** Installed section accessors4ae7a0–4aeb90 distinguish three namespaces.
 * Geometry uses local slots; external objective state retains native IDs.
 * Refreshing a view must not restart the follower or discard its corner/PID.
 */
export class NativePathView {
  private constructor(
    readonly kind: NativePathKind,
    readonly nodes: readonly Vector3[],
    readonly sections: readonly TrackPathSection[],
    readonly route: readonly ProjectedPathSection[],
    private readonly base: number,
  ) {}

  static projected(
    nodes: readonly Vector3[],
    sections: readonly TrackPathSection[],
    route: readonly ProjectedPathSection[],
  ): NativePathView {
    if (route.length > 12)
      throw new Error("Native projected route exceeds capacity");
    return new NativePathView("projected", nodes, sections, route, 20000);
  }

  static direct(start: Vector3, finish: Vector3): NativePathView {
    return NativePathView.virtual("direct", [start, finish], 10000);
  }

  static trail(nodes: readonly Vector3[]): NativePathView {
    if (nodes.length < 2 || nodes.length > 25)
      throw new Error("Invalid native trail node count");
    return NativePathView.virtual("trail", nodes, 15000);
  }

  private static virtual(
    kind: "direct" | "trail",
    points: readonly Vector3[],
    base: number,
  ): NativePathView {
    const nodes = points.map((point) => {
      const stored = new Vector3(
        Math.fround(point.x),
        Math.fround(point.y),
        Math.fround(point.z),
      );
      if (!stored.toArray().every(Number.isFinite))
        throw new Error("Invalid native virtual path node");
      return stored;
    });
    const sections: TrackPathSection[] = nodes.slice(1).map((_, slot) => ({
      nodeIndices: [slot, slot + 1],
      minSpeed: [0, 0],
      maxSpeed: [255, 255],
      width: 0.5,
      type: 0,
      oneWay: false,
    }));
    const route: ProjectedPathSection[] = sections.map((_, slot) => ({
      section: slot,
      direction: 1,
    }));
    return new NativePathView(kind, nodes, sections, route, base);
  }

  nativeId(slot: number): number {
    this.checkSlot(slot);
    return this.base + slot;
  }

  localSlot(nativeId: number): number {
    const slot = nativeId - this.base;
    this.checkSlot(slot);
    return slot;
  }

  next(nativeId: number, cheating = false): number {
    const slot = this.localSlot(nativeId);
    // Virtual metadata is independent of authored global section slots.
    const next =
      this.kind === "projected"
        ? nextProjectedPathSlot(this.sections, this.route, slot, cheating)
        : slot + 1 < this.route.length
          ? slot + 1
          : -1;
    return next < 0 ? -1 : this.nativeId(next);
  }

  private checkSlot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.route.length)
      throw new Error("Invalid native path section identifier");
  }
}
