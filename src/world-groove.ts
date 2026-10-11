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
  const n = words(line).map((value) => Math.fround(Number(value)));
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
  const rate = Math.fround(scalar(line));
  return rate === 0 ? 0 : Math.fround(1000 / rate);
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
        const amplitude =
          objectName === "rock" ? Math.fround(scalar(take())) : 360;
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
  if (periodMs === 0) return 0;
  const phase = (timeMs % periodMs) / periodMs;
  if (mode === "continuous") return amplitude * phase;
  if (mode === "linear")
    return amplitude * (phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase);
  // Installed Path/ObjectGrooveBastard quantize through BrDegreeToAngle
  // before the harmonic sine, rather than evaluating a smooth JS phase.
  return amplitude * Math.sin(nativeGrooveRadians(phase * 360));
}

function nativeGrooveRadians(degrees: number): number {
  return (Math.trunc(degrees * (65536 / 360)) & 0xffff) * (Math.PI / 32768);
}

export interface WorldGrooveEvaluationOptions {
  actionReplay?: boolean;
  replayPaused?: boolean;
  /** Native PointOutOfSight also considers rearview/extra-render cameras and
   * nature-dependent range. The owner supplies those live camera tests. In
   * its absence the compatibility evaluator deliberately remains uncullled. */
  isVisible?: (actor: THREE.Object3D, definition: WorldGroove) => boolean;
}

export type WorldGrooveInterrupt = 0 | 1 | 2;

export interface WorldGrooveBinding {
  definition: WorldGroove;
  actor: THREE.Object3D;
  sourceParent: THREE.Object3D | null;
  sourceRoot: THREE.Object3D;
  sourceParentWorld: THREE.Matrix4;
  basePosition: THREE.Vector3;
  baseQuaternion: THREE.Quaternion;
  baseScale: THREE.Vector3;
  objectPosition: THREE.Vector3;
  currentAngle: number;
  pathInterrupt: WorldGrooveInterrupt;
  pathResumption: number;
  objectInterrupt: WorldGrooveInterrupt;
  objectResumption: number;
  doneThisFrame: boolean;
  blockFlags: number;
}

/** Applies authored world actor poses at simulation timestamps. Actors are
 * retained by reference so their original parent hierarchy stays intact. */
export class WorldGrooveRuntime {
  readonly actors = new Set<THREE.Object3D>();
  readonly diagnostics: WorldGrooveDiagnostic[];
  readonly grooves: WorldGrooveBinding[] = [];
  private grooveTimes: [number, number] = [0, 0];
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
        baseScale: actor.scale.clone(),
        objectPosition: actor.position.clone(),
        currentAngle: 0,
        pathInterrupt: 0,
        pathResumption: 0,
        objectInterrupt: 0,
        objectResumption: 0,
        doneThisFrame: false,
        blockFlags: 0,
      });
    }
  }
  get previousTimes(): readonly [number, number] {
    return [...this.grooveTimes];
  }
  beginFrame(): void {
    for (const entry of this.grooves) entry.doneThisFrame = false;
  }
  finishFrame(nowMs: number, options: WorldGrooveEvaluationOptions = {}): void {
    if (!Number.isFinite(nowMs)) return;
    const time = nowMs >>> 0;
    this.grooveTimes = [time, this.grooveTimes[0]];
    for (const entry of this.grooves)
      if (!entry.doneThisFrame) this.evaluate(entry, time, false, options);
  }
  /** Installed 0x47b040 selects only the first exact actor match, requires
   * both statuses clear, and samples history[1]. rec2's all-actor/array-index
   * reconstruction is incorrect for the installed HW executable. */
  stopActor(
    actor: THREE.Object3D,
    options: WorldGrooveEvaluationOptions = {},
  ): boolean {
    const entry = this.grooves.find((g) => g.actor === actor);
    if (!entry || entry.pathInterrupt || entry.objectInterrupt) return false;
    this.evaluate(entry, this.grooveTimes[1], true, options);
    return true;
  }
  disableActor(actor: THREE.Object3D, bits = 3): void {
    const entry = this.grooves.find((g) => g.actor === actor);
    if (entry) entry.blockFlags |= bits;
  }
  enableActor(actor: THREE.Object3D, bits = 3): void {
    const entry = this.grooves.find((g) => g.actor === actor);
    if (entry) entry.blockFlags &= ~bits;
  }
  /** Compatibility entry point: immediate poses, without owning frame history.
   * Native frame owners use beginFrame/finishFrame instead. */
  update(nowMs: number, options: WorldGrooveEvaluationOptions = {}): void {
    if (!Number.isFinite(nowMs)) return;
    for (const entry of this.grooves) {
      this.evaluate(entry, nowMs >>> 0, false, options);
    }
  }
  private sourceWorld(entry: WorldGrooveBinding): THREE.Matrix4 {
    const parent = entry.sourceParent;
    if (parent && (parent === entry.sourceRoot || parent.parent)) {
      parent.updateWorldMatrix(true, false);
      return parent.matrixWorld;
    }
    return entry.sourceParentWorld;
  }
  private evaluate(
    entry: WorldGrooveBinding,
    nowMs: number,
    interrupt: boolean,
    options: WorldGrooveEvaluationOptions,
  ): void {
    const { definition: g, actor } = entry;
    // 0x478c07 precedes the visibility return: even culled stop callbacks
    // suppress the ordinary groove pass for this frame.
    entry.doneThisFrame = true;
    if (options.isVisible && !options.isVisible(actor, g)) return;
    actor.updateWorldMatrix(true, false);
    const sourceWorld = this.sourceWorld(entry);
    const sourcePose = sourceWorld.clone().invert().multiply(actor.matrixWorld);
    const position = new THREE.Vector3(),
      rotation = new THREE.Quaternion();
    sourcePose.decompose(position, rotation, new THREE.Vector3());
    const paused = options.actionReplay && options.replayPaused;
    if (g.path && !(entry.blockFlags & 1) && !paused) {
      const centre =
        g.path.centre.lengthSq() === 0 ? entry.basePosition : g.path.centre;
      // Native straight paths share ONE status/threshold across X,Y,Z. Each
      // accepted axis copies the whole centre before writing that coordinate.
      for (const axis of ["x", "y", "z"] as const) {
        if (g.path.delta[axis] === 0) continue;
        const value =
          wave(g.path.mode, g.path.periodMs, nowMs, g.path.delta[axis]) +
          centre[axis];
        if (interrupt) {
          entry.pathResumption = Math.fround(value);
          entry.pathInterrupt = value >= position[axis] ? 2 : 1;
        } else if (entry.pathInterrupt) {
          const resumes =
            entry.pathInterrupt === 1
              ? value < entry.pathResumption
              : value > entry.pathResumption;
          if (!resumes) continue;
          entry.pathInterrupt = 0;
        }
        position.copy(centre);
        position[axis] = Math.fround(value);
      }
      entry.objectPosition.copy(position);
    }
    if (g.object && !(entry.blockFlags & 2) && !paused) {
      const value = wave(
        g.object.mode,
        g.object.periodMs,
        nowMs,
        g.object.maxAngle,
      );
      let apply = true;
      if (g.object.type === "rock") {
        if (interrupt) {
          entry.objectResumption = Math.fround(value);
          entry.objectInterrupt = value >= entry.currentAngle ? 2 : 1;
        } else if (entry.objectInterrupt) {
          const resumes =
            entry.objectInterrupt === 1
              ? value < entry.objectResumption
              : value > entry.objectResumption;
          apply = resumes && !options.actionReplay;
          if (apply) entry.objectInterrupt = 0;
        }
        if (apply) entry.currentAngle = Math.fround(value);
      }
      const radians = nativeGrooveRadians(
        g.object.type === "rock" ? entry.currentAngle : value,
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
      rotation.copy(q);
      position
        .copy(entry.objectPosition)
        .add(pivot)
        .sub(pivot.clone().applyQuaternion(q));
    }
    // GROOVE values are authored in the actor's source-parent coordinates.
    // batchStaticWorld may reparent retained actors to an identity root, so
    // convert through the live source-parent and current-parent world poses.
    const worldPose = sourceWorld
      .clone()
      .multiply(
        new THREE.Matrix4().compose(position, rotation, entry.baseScale),
      );
    if (actor.parent) {
      actor.parent.updateWorldMatrix(true, false);
      const parentInverse = actor.parent.matrixWorld.clone().invert();
      worldPose.premultiply(parentInverse);
    }
    worldPose.decompose(actor.position, actor.quaternion, actor.scale);
    actor.updateMatrix();
  }
}
