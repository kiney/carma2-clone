import { Vector3 } from "three";

export interface RoadControls {
  throttle: number;
  steer: number;
  brake: number;
  handbrake: boolean;
  /** Caller should ground this point, reset velocity, and use recoverHeading. */
  recoverTo?: Vector3;
  recoverHeading?: number;
}
export interface RoadNavigationOptions {
  maxSpeed: number;
  stuckSeconds: number;
  minimumLookahead: number;
}
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));
const horizontalDistance = (a: Vector3, b: Vector3) =>
  Math.hypot(a.x - b.x, a.z - b.z);
const direction = (from: Vector3, to: Vector3) =>
  new Vector3(to.x - from.x, 0, to.z - from.z).normalize();
const headingOf = (v: Vector3) => Math.atan2(-v.x, -v.z);
const stopped = (): RoadControls => ({
  throttle: 0,
  steer: 0,
  brake: 1,
  handbrake: false,
});

/** Independent road-graph driver for original track path nodes and sections.
 * It follows committed edges and looks ahead along connected road segments,
 * rather than steering toward individual nodes or pursuing a target off-road.
 * Optional targets bias shortest graph routes at junctions. Section widths,
 * one-way flags and opponent personalities are not represented by this API.
 */
export class RoadNavigator {
  private readonly nodes: Vector3[];
  private readonly adjacency: number[][];
  private readonly options: RoadNavigationOptions;
  private route: number[] = [];
  private visits: number[];
  private targetNode = -1;
  private targetDistances: number[] = [];
  private progressPosition = new Vector3();
  private stuckTime = 0;
  private initialized = false;
  private aim = new Vector3();
  private requestedSpeed = 0;

  /** Model units/second; the native force controller converts to metres/second. */
  get desiredSpeed(): number {
    return this.requestedSpeed;
  }

  constructor(
    nodes: Vector3[],
    edges: [number, number][],
    options: Partial<RoadNavigationOptions> = {},
  ) {
    this.nodes = nodes.map((node) => node.clone());
    this.adjacency = nodes.map(() => []);
    this.visits = nodes.map(() => 0);
    this.options = {
      maxSpeed: 4.5,
      stuckSeconds: 4,
      minimumLookahead: 1.1,
      ...options,
    };
    for (const [a, b] of edges) {
      if (
        !Number.isInteger(a) ||
        !Number.isInteger(b) ||
        a === b ||
        !this.nodes[a] ||
        !this.nodes[b] ||
        !this.nodes[a].toArray().every(Number.isFinite) ||
        !this.nodes[b].toArray().every(Number.isFinite) ||
        horizontalDistance(this.nodes[a], this.nodes[b]) < 0.01
      )
        continue;
      if (!this.adjacency[a].includes(b)) this.adjacency[a].push(b);
      if (!this.adjacency[b].includes(a)) this.adjacency[b].push(a);
    }
    // Stable tie breaking makes replays and tests reproducible.
    for (const neighbors of this.adjacency) neighbors.sort((a, b) => a - b);
  }

  get currentNode(): number {
    return this.route[0] ?? -1;
  }
  get nextNode(): number {
    return this.route[1] ?? -1;
  }
  get aimPoint(): Vector3 {
    return this.aim.clone();
  }

  private nearest(position: Vector3, connectedOnly = false): number {
    let nearest = -1;
    let distance = Infinity;
    this.nodes.forEach((node, index) => {
      if (connectedOnly && !this.adjacency[index].length) return;
      const d = position.distanceToSquared(node);
      if (d < distance) {
        distance = d;
        nearest = index;
      }
    });
    return nearest;
  }

  /** Reinitialize after an external teleport. Keeps graph-target preferences. */
  reset(position: Vector3, heading: number): void {
    const nearest = this.nearest(position, true);
    this.route = nearest < 0 ? [] : [nearest];
    if (nearest >= 0) {
      const forward = new Vector3(-Math.sin(heading), 0, -Math.cos(heading));
      if (horizontalDistance(position, this.nodes[nearest]) > 0.75) {
        // Sparse node endpoints can make a node across a canal nearer than the
        // endpoints of the road under the car. Acquire the closest actual edge.
        let best = Infinity;
        let selected: [number, number] | undefined;
        let alignment = 0;
        for (let index = 0; index < this.nodes.length; index++)
          for (const neighbor of this.adjacency[index]) {
            if (neighbor <= index) continue;
            const a = this.nodes[index],
              b = this.nodes[neighbor];
            const edge = b.clone().sub(a);
            const t = clamp(
              position.clone().sub(a).dot(edge) / edge.lengthSq(),
              0,
              1,
            );
            const projected = a.clone().lerp(b, t);
            const dot = direction(a, b).dot(forward);
            const score =
              position.distanceToSquared(projected) + (1 - Math.abs(dot)) * 0.5;
            if (score < best) {
              best = score;
              selected = [index, neighbor];
              alignment = dot;
            }
          }
        if (selected)
          this.route = alignment >= 0 ? selected : [selected[1], selected[0]];
      } else {
        const next = this.chooseNext(nearest, -1, forward);
        if (next >= 0) this.route.push(next);
      }
      this.fillRoute();
    }
    this.progressPosition.copy(position);
    this.stuckTime = 0;
    this.initialized = true;
  }

  private setTarget(target?: Vector3): void {
    const node = target ? this.nearest(target, true) : -1;
    if (node === this.targetNode) return;
    this.targetNode = node;
    this.targetDistances = this.nodes.map(() => Infinity);
    if (node < 0) return;
    this.targetDistances[node] = 0;
    const pending = new Set(this.nodes.map((_point, index) => index));
    // Track graphs are small (NEWCITY1 has 174 nodes); simple Dijkstra suffices.
    while (pending.size) {
      let current = -1;
      let distance = Infinity;
      for (const index of pending) {
        if (this.targetDistances[index] < distance) {
          distance = this.targetDistances[index];
          current = index;
        }
      }
      if (current < 0) break;
      pending.delete(current);
      for (const next of this.adjacency[current]) {
        const candidate =
          distance + this.nodes[current].distanceTo(this.nodes[next]);
        if (candidate < this.targetDistances[next])
          this.targetDistances[next] = candidate;
      }
    }
  }

  private chooseNext(
    current: number,
    previous: number,
    forward: Vector3,
  ): number {
    const all = this.adjacency[current];
    if (!all?.length) return -1;
    const alternatives = all.filter((index) => index !== previous);
    const candidates = alternatives.length ? alternatives : all;
    let chosen = candidates[0];
    let best = -Infinity;
    for (const next of candidates) {
      const alignment = direction(this.nodes[current], this.nodes[next]).dot(
        forward,
      );
      const here = this.targetDistances[current];
      const there = this.targetDistances[next];
      const targetGain =
        this.targetNode >= 0 &&
        current !== this.targetNode &&
        Number.isFinite(here) &&
        Number.isFinite(there)
          ? clamp(
              (here - there) / this.nodes[current].distanceTo(this.nodes[next]),
              -1,
              1,
            )
          : 0;
      const score =
        alignment * (this.targetNode < 0 ? 2 : 0.6) +
        targetGain * 3 -
        Math.min(this.visits[next], 10) * 0.04;
      if (score > best + 1e-8) {
        chosen = next;
        best = score;
      }
    }
    return chosen;
  }

  private fillRoute(): void {
    while (this.route.length >= 2 && this.route.length < 4) {
      const current = this.route[this.route.length - 1];
      const previous = this.route[this.route.length - 2];
      const next = this.chooseNext(
        current,
        previous,
        direction(this.nodes[previous], this.nodes[current]),
      );
      if (next < 0) return;
      this.route.push(next);
    }
  }

  private projection(position: Vector3): {
    point: Vector3;
    fraction: number;
    length: number;
  } {
    const a = this.nodes[this.route[0]],
      b = this.nodes[this.route[1]];
    const dx = b.x - a.x,
      dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    const fraction =
      ((position.x - a.x) * dx + (position.z - a.z) * dz) / (length * length);
    return {
      point: a.clone().lerp(b, clamp(fraction, 0, 1)),
      fraction,
      length,
    };
  }

  private lookAhead(point: Vector3, distance: number): Vector3 {
    let cursor = point.clone();
    for (let index = 1; index < this.route.length; index++) {
      const end = this.nodes[this.route[index]];
      const length = horizontalDistance(cursor, end);
      if (length > distance && length > 1e-8)
        return cursor.lerp(end, distance / length);
      distance -= length;
      cursor.copy(end);
    }
    return cursor;
  }

  update(
    position: Vector3,
    heading: number,
    speed: number,
    dt: number,
    target?: Vector3,
  ): RoadControls {
    this.requestedSpeed = 0;
    if (
      !position.toArray().every(Number.isFinite) ||
      !Number.isFinite(heading) ||
      !Number.isFinite(speed)
    )
      return stopped();
    this.setTarget(target);
    if (!this.initialized) this.reset(position, heading);
    if (this.route.length < 2) return stopped();
    let projected = this.projection(position);
    // A teleport or a missed junction should reattach to a nearby connected road.
    if (position.distanceTo(projected.point) > 12) {
      this.reset(position, heading);
      projected = this.projection(position);
    }
    const reach = clamp(0.4 + Math.abs(speed) * 0.15, 0.4, 1.1);
    let transitions = 0;
    while (
      transitions++ < this.nodes.length &&
      (projected.fraction >= 1 ||
        horizontalDistance(position, this.nodes[this.route[1]]) < reach)
    ) {
      this.visits[this.route[1]]++;
      this.route.shift();
      this.fillRoute();
      if (this.route.length < 2) return stopped();
      projected = this.projection(position);
      // A dead-end return leg begins at the same node; do not immediately skip it.
      if (projected.fraction < 0.01) break;
    }

    const frameTime = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
    if (horizontalDistance(position, this.progressPosition) > 0.3) {
      this.progressPosition.copy(position);
      this.stuckTime = 0;
    } else {
      this.stuckTime += frameTime;
    }
    const fallen = position.y < projected.point.y - 8;
    if (this.stuckTime >= this.options.stuckSeconds || fallen) {
      const recoverTo = this.nodes[this.route[1]].clone();
      const following = this.route[2] ?? this.route[0];
      const recoverHeading = headingOf(
        direction(recoverTo, this.nodes[following]),
      );
      this.reset(recoverTo, recoverHeading);
      return { ...stopped(), recoverTo, recoverHeading };
    }

    const lookahead = clamp(
      this.options.minimumLookahead + Math.abs(speed) * 0.8,
      1,
      5,
    );
    this.aim.copy(this.lookAhead(projected.point, lookahead));
    // If spawned off-road, acquire the current edge before looking round corners.
    if (horizontalDistance(position, projected.point) > 2.5)
      this.aim.copy(projected.point);
    const delta = this.aim.clone().sub(position);
    const desiredHeading = headingOf(delta);
    const error = Math.atan2(
      Math.sin(desiredHeading - heading),
      Math.cos(desiredHeading - heading),
    );
    const remaining = horizontalDistance(
      projected.point,
      this.nodes[this.route[1]],
    );
    const incoming = direction(
      this.nodes[this.route[0]],
      this.nodes[this.route[1]],
    );
    const outgoing =
      this.route.length > 2
        ? direction(this.nodes[this.route[1]], this.nodes[this.route[2]])
        : incoming;
    const corner = Math.acos(clamp(incoming.dot(outgoing), -1, 1));
    const turnSpeed = Math.max(1.1, this.options.maxSpeed / (1 + corner * 1.4));
    const brakingDistance = Math.max(1.5, (speed * speed) / 3 + 2);
    const nearCorner = clamp(1 - remaining / brakingDistance, 0, 1);
    let desiredSpeed =
      this.options.maxSpeed * (1 - nearCorner) + turnSpeed * nearCorner;
    desiredSpeed = Math.min(
      desiredSpeed,
      Math.max(1, this.options.maxSpeed / (1 + Math.abs(error) * 1.8)),
    );
    const brake =
      speed > desiredSpeed + 0.35
        ? clamp((speed - desiredSpeed) * 0.7, 0, 1)
        : 0;
    this.requestedSpeed = desiredSpeed;
    const throttle =
      brake > 0
        ? 0
        : clamp((desiredSpeed - Math.max(0, speed)) * 0.8 + 0.1, 0.15, 1);
    return {
      throttle,
      steer: clamp(error * 2, -1, 1),
      brake,
      handbrake: false,
    };
  }
}
