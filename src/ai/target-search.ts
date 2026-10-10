import { Vector3 } from "three";
import type { TrackPathSection } from "../config";
import type { ProjectedPathSection } from "./path-route";

const FLOAT_MAX = 3.4028234663852886e38;

/** SearchForSection's installed incident table and short-circuit DFS. */
export class NativeTargetSectionSearch {
  private readonly points: Vector3[];
  private readonly lengths: number[];
  private readonly incident: number[][];
  private readonly visited: boolean[];
  private bestCost = FLOAT_MAX;
  private bestPath: ProjectedPathSection[] = [];
  private improvements = 0;

  constructor(
    nodes: readonly Vector3[],
    private readonly sections: readonly TrackPathSection[],
  ) {
    this.points = nodes.map((node) => {
      if (!node.toArray().every(Number.isFinite))
        throw new Error("Invalid target-search node");
      const rounded = new Vector3(
        Math.fround(node.x),
        Math.fround(node.y),
        Math.fround(node.z),
      );
      if (!rounded.toArray().every(Number.isFinite))
        throw new Error("Target-search node exceeds Float32 bounds");
      return rounded;
    });
    this.incident = Array.from({ length: nodes.length }, () => []);
    this.lengths = sections.map((section, index) => {
      const [node0, node1] = section.nodeIndices;
      const first = this.points[node0];
      const second = this.points[node1];
      if (
        !Number.isInteger(node0) ||
        !Number.isInteger(node1) ||
        !first ||
        !second
      )
        throw new Error(`Invalid target-search section ${index}`);
      for (const node of [node0, node1]) {
        const slots = this.incident[node];
        // Native incidence capacity is eight; self-loops occupy both slots.
        if (slots.length < 8) slots.push(index);
      }
      const dx = Math.fround(second.x - first.x);
      const dy = Math.fround(second.y - first.y);
      const dz = Math.fround(second.z - first.z);
      const length = Math.fround(Math.sqrt(dx * dx + dy * dy + dz * dz));
      if (!Number.isFinite(length))
        throw new Error(
          `Target-search section ${index} exceeds Float32 bounds`,
        );
      return length;
    });
    this.visited = Array.from({ length: nodes.length }, () => false);
  }

  search(
    seed: ProjectedPathSection,
    targetSection: number,
    cheating = false,
  ): { entries: ProjectedPathSection[]; cost: number; improvements: number } {
    if (
      !Number.isInteger(targetSection) ||
      !this.sections[targetSection] ||
      !Number.isInteger(seed.section) ||
      !this.sections[seed.section] ||
      (seed.direction !== 0 && seed.direction !== 1)
    )
      throw new Error("Invalid target-search seed or target");
    this.visited.fill(false);
    this.bestCost = FLOAT_MAX;
    this.bestPath = [];
    this.improvements = 0;
    const work: ProjectedPathSection[] = [{ ...seed }];
    this.searchDepth(work, 1, 0, targetSection, cheating);
    return {
      entries: this.bestPath.map((entry) => ({ ...entry })),
      cost: this.bestCost,
      improvements: this.improvements,
    };
  }

  private searchDepth(
    work: ProjectedPathSection[],
    depth: number,
    accumulatedCost: number,
    targetSection: number,
    cheating: boolean,
  ): 0 | 1 {
    if (depth >= 10) return 0;
    const previous = work[depth - 1];
    const previousNodes = this.sections[previous.section].nodeIndices;
    const currentNode = previousNodes[previous.direction];
    this.visited[currentNode] = true;

    for (const candidateIndex of this.incident[currentNode]) {
      const section = this.sections[candidateIndex];
      const [node0, node1] = section.nodeIndices;
      const direction: 0 | 1 = currentNode !== node1 ? 1 : 0;
      const nextNode = section.nodeIndices[direction];
      if (
        this.visited[nextNode] ||
        (section.oneWay && currentNode === node1) ||
        (!cheating && section.type === 2)
      )
        continue;

      const candidate: ProjectedPathSection = {
        section: candidateIndex,
        direction,
      };
      work[depth] = candidate;
      const nextCost = Math.fround(
        accumulatedCost + this.lengths[candidateIndex],
      );
      if (candidateIndex === targetSection && nextCost < this.bestCost) {
        this.bestPath = work.slice(0, depth + 1).map((entry) => ({ ...entry }));
        this.bestCost = nextCost;
        this.improvements++;
        if (this.improvements >= 2) return 1;
        this.visited[currentNode] = false;
        return 0;
      }
      if (depth < 9) {
        const foundSecond = this.searchDepth(
          work,
          depth + 1,
          nextCost,
          targetSection,
          cheating,
        );
        if (foundSecond) return 1;
      }
    }
    this.visited[currentNode] = false;
    return 0;
  }
}
