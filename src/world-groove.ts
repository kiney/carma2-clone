import * as THREE from "three";

export type WorldGrooveMode = "continuous" | "linear" | "harmonic";
export interface WorldGroove {
  actor: string;
  nature: "constant" | "distance";
  path?: {
    mode: WorldGrooveMode;
    periodMs: number;
    centre: THREE.Vector3;
    delta: THREE.Vector3;
  };
  object?: {
    type: "spin" | "rock";
    mode: WorldGrooveMode;
    periodMs: number;
    centre: THREE.Vector3;
    axis: "x" | "y" | "z";
    maxAngle: number;
  };
}
export interface WorldGrooveDiagnostic {
  block: number;
  actor?: string;
  message: string;
}
export interface ParsedWorldGrooves {
  grooves: WorldGroove[];
  diagnostics: WorldGrooveDiagnostic[];
}

function clean(line: string): string {
  return line
    .replace(/\/\/.*$/, "")
    .replace(/#.*$/, "")
    .trim();
}
function words(line: string): string[] {
  return clean(line)
    .split(/[\s,\/]+/)
    .filter(Boolean);
}
function vec(line: string): THREE.Vector3 {
  const n = words(line).map(Number);
  if (n.length !== 3 || n.some((v) => !Number.isFinite(v)))
    throw new Error("Expected three finite coordinates");
  return new THREE.Vector3(...n);
}
function scalar(line: string): number {
  const n = Number(words(line)[0]);
  if (!Number.isFinite(n)) throw new Error("Expected finite number");
  return n;
}
function period(line: string): number {
  const rate = scalar(line);
  return rate === 0 ? 0 : 1000 / rate;
}
function mode(line: string): WorldGrooveMode {
  const m = clean(line).toLowerCase();
  if (m === "continuous" || m === "linear" || m === "harmonic") return m;
  throw new Error(`Unsupported timed mode ${m || "(empty)"}`);
}
function known(line: string, choices: readonly string[]): string | undefined {
  const key = clean(line).toLowerCase();
  return choices.includes(key) ? key : undefined;
}

/** Reads the source START OF GROOVE section. Unknown enum values deliberately
 * behave like the game's -1 enum result and are recorded per block. */
export function parseWorldGrooves(text: string): ParsedWorldGrooves {
  const lines = text.split(/\r?\n/),
    start = lines.findIndex(
      (l) => clean(l).toUpperCase() === "START OF GROOVE",
    );
  if (start < 0) return { grooves: [], diagnostics: [] };
  const end = lines.findIndex(
    (l, i) => i > start && clean(l).toUpperCase() === "END OF GROOVE",
  );
  const section = lines.slice(start + 1, end < 0 ? lines.length : end);
  const blocks: string[][] = [];
  let block: string[] = [];
  for (const line of section) {
    const value = clean(line);
    if (!value) continue;
    if (value.toUpperCase() === "NEXT GROOVE") {
      if (block.length) blocks.push(block);
      block = [];
    }
    if (value.toUpperCase() !== "NEXT GROOVE") block.push(value);
  }
  if (block.length) blocks.push(block);
  const grooves: WorldGroove[] = [],
    diagnostics: WorldGrooveDiagnostic[] = [];
  blocks.forEach((b, i) => {
    let at = 0,
      actor: string | undefined;
    const take = () => {
      if (at >= b.length) throw new Error("Truncated GROOVE block");
      return b[at++];
    };
    try {
      actor = words(take())[0];
      if (!actor) throw new Error("Missing actor name");
      const lollipop = take().toLowerCase();
      if (["xlollipop", "ylollipop", "zlollipop"].includes(lollipop))
        throw new Error(`Unsupported lollipop mode ${lollipop}`);
      const nature = known(take(), ["constant", "distance"]);
      if (!nature) throw new Error("Unsupported groove nature");
      const pathName = known(take(), ["straight", "circular"]);
      let path: WorldGroove["path"];
      if (pathName === "straight") {
        const pathMode = mode(take()),
          centre = vec(take()),
          p = period(take()),
          delta = vec(take());
        if (
          pathMode === "continuous" ||
          pathMode === "linear" ||
          pathMode === "harmonic"
        )
          path = { mode: pathMode, periodMs: p, centre, delta };
      } else if (pathName === "circular") {
        throw new Error("Circular path is not implemented");
      }
      const objectName = known(take(), ["spin", "rock", "throb", "shear"]);
      let object: WorldGroove["object"];
      if (objectName === "spin" || objectName === "rock") {
        const objectMode = mode(take()),
          p = period(take()),
          pivot = vec(take()),
          axisName = known(take(), ["x", "y", "z"]);
        if (!axisName) throw new Error("Unsupported spin/rock axis");
        const amplitude = objectName === "rock" ? scalar(take()) : 360;
        object = {
          type: objectName,
          mode: objectMode,
          periodMs: p,
          centre: pivot,
          axis: axisName as "x" | "y" | "z",
          maxAngle: amplitude,
        };
      } else if (objectName)
        throw new Error(`Unsupported object animation ${objectName}`);
      grooves.push({
        actor,
        nature: nature as "constant" | "distance",
        path,
        object,
      });
    } catch (e) {
      diagnostics.push({
        block: i + 1,
        actor,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  });
  return { grooves, diagnostics };
}

function wave(
  mode: WorldGrooveMode,
  periodMs: number,
  timeMs: number,
  amplitude: number,
): number {
  if (!(periodMs > 0)) return 0;
  const phase = (((timeMs % periodMs) + periodMs) % periodMs) / periodMs;
  if (mode === "continuous") return amplitude * phase;
  if (mode === "linear")
    return amplitude * (phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase);
  return amplitude * Math.sin(phase * Math.PI * 2);
}

/** Applies authored world actor poses at simulation timestamps. Actors are
 * retained by reference so their original parent hierarchy stays intact. */
export class WorldGrooveRuntime {
  readonly actors = new Set<THREE.Object3D>();
  readonly diagnostics: WorldGrooveDiagnostic[];
  readonly grooves: Array<{
    definition: WorldGroove;
    actor: THREE.Object3D;
    sourceParent: THREE.Object3D | null;
    sourceRoot: THREE.Object3D;
    sourceParentWorld: THREE.Matrix4;
    basePosition: THREE.Vector3;
    baseQuaternion: THREE.Quaternion;
  }> = [];
  constructor(root: THREE.Object3D, text: string) {
    const parsed = parseWorldGrooves(text);
    this.diagnostics = parsed.diagnostics;
    const byName = new Map<string, THREE.Object3D>();
    root.traverse((o) => {
      if (o.name && !(o instanceof THREE.Mesh))
        byName.set(o.name.toLowerCase(), o);
    });
    for (const definition of parsed.grooves) {
      const actor = byName.get(definition.actor.toLowerCase());
      if (!actor) {
        this.diagnostics.push({
          block: this.grooves.length + 1,
          actor: definition.actor,
          message: "Referenced actor absent from loaded world",
        });
        continue;
      }
      this.actors.add(actor);
      actor.updateWorldMatrix(true, false);
      const sourceParent = actor.parent;
      this.grooves.push({
        definition,
        actor,
        sourceParent,
        sourceRoot: root,
        sourceParentWorld:
          sourceParent?.matrixWorld.clone() ?? new THREE.Matrix4(),
        basePosition: actor.position.clone(),
        baseQuaternion: actor.quaternion.clone(),
      });
    }
  }
  update(nowMs: number): void {
    if (!Number.isFinite(nowMs)) return;
    for (const entry of this.grooves) {
      const { definition: g, actor } = entry;
      actor.position.copy(entry.basePosition);
      if (g.path) {
        actor.position.copy(
          g.path.centre.lengthSq() === 0 ? entry.basePosition : g.path.centre,
        );
        actor.position.add(
          new THREE.Vector3(
            wave(g.path.mode, g.path.periodMs, nowMs, g.path.delta.x),
            wave(g.path.mode, g.path.periodMs, nowMs, g.path.delta.y),
            wave(g.path.mode, g.path.periodMs, nowMs, g.path.delta.z),
          ),
        );
      }
      actor.quaternion.copy(entry.baseQuaternion);
      if (g.object) {
        const radians = THREE.MathUtils.degToRad(
          wave(g.object.mode, g.object.periodMs, nowMs, g.object.maxAngle),
        );
        const axis = new THREE.Vector3(
          Number(g.object.axis === "x"),
          Number(g.object.axis === "y"),
          Number(g.object.axis === "z"),
        );
        const pivot = g.object.centre;
        const q = new THREE.Quaternion().setFromAxisAngle(axis, radians);
        // GrooveThisDelic resets the source actor matrix to identity before
        // applying ObjectGrooveBastard's post-rotation.
        actor.quaternion.copy(q);
        actor.position.sub(pivot).applyQuaternion(q).add(pivot);
      }
      // GROOVE values are authored in the actor's source-parent coordinates.
      // batchStaticWorld may reparent retained actors to an identity root, so
      // convert through the live source-parent and current-parent world poses.
      const sourceParent = entry.sourceParent;
      if (
        sourceParent &&
        (sourceParent === entry.sourceRoot || sourceParent.parent)
      )
        sourceParent.updateWorldMatrix(true, false);
      const sourceWorld =
        sourceParent &&
        (sourceParent === entry.sourceRoot || sourceParent.parent)
          ? sourceParent.matrixWorld
          : entry.sourceParentWorld;
      const worldPosition = actor.position.clone().applyMatrix4(sourceWorld);
      const sourceRotation = new THREE.Quaternion(),
        sourceScale = new THREE.Vector3();
      sourceWorld.decompose(new THREE.Vector3(), sourceRotation, sourceScale);
      const worldRotation = sourceRotation.multiply(actor.quaternion);
      if (actor.parent) {
        actor.parent.updateWorldMatrix(true, false);
        const parentInverse = actor.parent.matrixWorld.clone().invert();
        actor.position.copy(worldPosition.applyMatrix4(parentInverse));
        const parentRotation = new THREE.Quaternion();
        actor.parent.matrixWorld.decompose(
          new THREE.Vector3(),
          parentRotation,
          new THREE.Vector3(),
        );
        actor.quaternion.copy(parentRotation.invert().multiply(worldRotation));
      } else {
        actor.position.copy(worldPosition);
        actor.quaternion.copy(worldRotation);
      }
      actor.updateMatrix();
    }
  }
}
