import type {
  RigidBody,
  ContactImpact,
  JointConstraintImpact,
} from "../physics/contact";
import type { CollisionHull } from "../physics/geometry";
import type { RigidJoint } from "../physics/joint";
import type {
  VehicleSimulation,
  PhysicsCaptureObserver,
} from "../physics/simulation";
import { sharedNativeRandom } from "../native-random";
import { BoundedCaptureRing, DEFAULT_CAPTURE_MAX_BYTES } from "./ring";
import { createCaptureBlob } from "./format";

type Vector = { x: number; y: number; z: number };
type Body = RigidBody & {
  group?: { name: string };
  actor?: { name: string };
  kind?: string;
  hulls?: CollisionHull[];
  joint?: RigidJoint;
  owner?: RigidBody;
  shape?: { type: string };
  attached?: boolean;
  knackered?: boolean;
  worldRecovery?: boolean;
  worldOverlapDetected?: boolean;
  overlapRecovery?: boolean;
  overlapDetected?: boolean;
  motor?: { sleeping: boolean; flags: number };
  revision?: number;
  structuralRevision?: number;
  splitRevision?: number;
  poseEpoch?: number;
  input?: {
    throttle: number;
    steer: number;
    brake: number | boolean;
    handbrake?: boolean;
  };
  damage?: {
    componentLevels: ArrayLike<number>;
    deformationRevision: number;
    repairRevision: number;
  };
};

export const BODY_COLUMNS = [
  "id",
  "kind",
  "flags",
  "px",
  "py",
  "pz",
  "qx",
  "qy",
  "qz",
  "qw",
  "vx",
  "vy",
  "vz",
  "wx",
  "wy",
  "wz",
  "candidatePx",
  "candidatePy",
  "candidatePz",
  "candidateQx",
  "candidateQy",
  "candidateQz",
  "candidateQw",
  "mass",
  "ix",
  "iy",
  "iz",
  "comX",
  "comY",
  "comZ",
  "throttle",
  "steer",
  "brake",
  "handbrake",
  "shapeRevision",
  "structuralRevision",
  "splitRevision",
  "poseEpoch",
  "deformationRevision",
  "repairRevision",
  ...Array.from({ length: 12 }, (_, i) => `damage${i}`),
] as const;
export const CONTACT_COLUMNS = [
  "a",
  "b",
  "sourceActor",
  "face",
  "normalImpulse",
  "closingSpeed",
  "solverAccepted",
  "sourceType",
  "px",
  "py",
  "pz",
  "pointBx",
  "pointBy",
  "pointBz",
  "nx",
  "ny",
  "nz",
  "aVx",
  "aVy",
  "aVz",
  "aWx",
  "aWy",
  "aWz",
  "bVx",
  "bVy",
  "bVz",
  "bWx",
  "bWy",
  "bWz",
  "faceAx",
  "faceAy",
  "faceAz",
  "faceBx",
  "faceBy",
  "faceBz",
  "faceCx",
  "faceCy",
  "faceCz",
] as const;
const STATE_HEADER = [
  "generation",
  "tick",
  "phase:0=before-containment,1=after-step,2=failed-step",
  "physicsSeconds",
  "nativeRandomState",
  "stepCpuMs",
  "bodyCount",
  "omittedBodies",
];
const CONTACT_HEADER = [
  "generation",
  "tick",
  "physicsSeconds",
  "phase:0=callback-candidate,1=after-normal-response",
  "callbackAccepted:-1=not-applicable",
  "rowCount",
  "omittedRows",
];
const FRAME_COLUMNS = [
  "generation",
  "gameTimeMs",
  "framePeriodMs",
  "intervalMs",
  "frameCpuMs",
  "paused",
  "fps",
  "drawCalls",
  "triangles",
  "skippedPhysicsMs",
  "cameraX",
  "cameraY",
  "cameraZ",
  "nativeRandomState",
];
const JOINT_COLUMNS = [
  "child",
  "parent",
  "normalImpulse",
  "closingSpeed",
  "sourceType",
  "rowIndex",
  "childAngularX",
  "childAngularY",
  "childAngularZ",
  "parentAngularX",
  "parentAngularY",
  "parentAngularZ",
];
const JOINT_HEADER = [
  "generation",
  "tick",
  "physicsSeconds",
  "callbackAccepted",
  "rowCount",
  "omittedRows",
];
const MAX_BODIES = 2048,
  MAX_CONTACTS = 128,
  MAX_DIRECTORY = 1024;
const MiB = 1024 * 1024;

export interface PlaytestCaptureOptions {
  maxBytes?: number;
  maxAgeMs?: number;
  now?: () => number;
  readContext?: () => unknown;
}

/** Always-on diagnostics, not a deterministic full-game replay. No engine
 * objects are retained in the ring. IDs are weak; the bounded scalar directory
 * supplies labels even if their initial creation event has aged out. */
export class PlaytestCapture implements PhysicsCaptureObserver {
  readonly ring: BoundedCaptureRing;
  readonly memoryLimitBytes: number;
  enabled = true; // Diagnostic A/B only; no gameplay switch changes this.
  private now: () => number;
  private readContext: () => unknown;
  private ids = new WeakMap<object, number>();
  private nextId = 1;
  private directory = new Map<
    number,
    { id: number; kind: string; name: string; lastSeenMs: number }
  >();
  private generation = 0;
  private tick = 0;
  private timeMs = 0;
  private lastFrame?: number;
  private lastPlaying = false;
  private frameStart = 0;
  private frameInterval = 0;
  private lastContext = -Infinity;
  private lastKeyframe = -Infinity;
  private stepStart = 0;
  private scratch = new Float64Array(4096);
  private frameScratch = new Float64Array(FRAME_COLUMNS.length);
  private textEncoder = new TextEncoder();
  private captureCpuMs = 0;
  private calls = 0;
  private errors = 0;
  private omittedBodies = 0;
  private omittedContacts = 0;
  private omittedDefinitions = 0;
  private failures: string[] = [];
  private exportCount = 0;

  constructor(options: PlaytestCaptureOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.readContext = options.readContext ?? (() => ({}));
    this.memoryLimitBytes = options.maxBytes ?? DEFAULT_CAPTURE_MAX_BYTES;
    // Reserve half for the immutable downloadable Blob, plus bounded scratch,
    // metadata and keyframe construction. This limits recorder-owned payloads;
    // it cannot promise a ceiling for the browser's entire JavaScript heap.
    const reserve = Math.min(16 * MiB, Math.floor(this.memoryLimitBytes / 8));
    const ringBudget = Math.floor((this.memoryLimitBytes - reserve) / 2);
    this.ring = new BoundedCaptureRing({
      maxBytes: ringBudget,
      maxAgeMs: options.maxAgeMs ?? 180_000,
      maxRecords: 262_144,
      reserveBytes: Math.min(64 * 1024, Math.floor(ringBudget / 16)),
    });
  }
  private safe(work: () => void): void {
    if (!this.enabled) return;
    const start = this.now();
    try {
      work();
    } catch (error) {
      this.errors++;
      if (this.failures.length < 8)
        this.failures.push(String(error).slice(0, 512));
      // A diagnostic failure must never poison the physics tick.
      if (this.errors >= 3) this.enabled = false;
    } finally {
      this.captureCpuMs += this.now() - start;
      this.calls++;
    }
  }
  private json(kind: number, value: unknown): void {
    // Bound traversal before serialization, and never invoke engine getters or
    // toJSON methods supplied through a custom diagnostic provider.
    let nodes = 0,
      chars = 0;
    const seen = new Set<object>();
    const visit = (v: unknown, depth: number): void => {
      if (++nodes > 160_000 || depth > 24)
        throw new RangeError("Diagnostic JSON exceeds traversal budget");
      if (typeof v === "string") chars += v.length;
      else if (v && typeof v === "object") {
        if (seen.has(v)) throw new TypeError("Cyclic diagnostic context");
        if (Object.getOwnPropertyDescriptor(v, "toJSON"))
          throw new TypeError("Diagnostic toJSON is unsupported");
        if (
          !Array.isArray(v) &&
          Object.getPrototypeOf(v) !== Object.prototype &&
          Object.getPrototypeOf(v) !== null
        )
          throw new TypeError("Diagnostic context must be plain JSON");
        seen.add(v);
        if (Array.isArray(v)) {
          if (v.length > 65_536)
            throw new RangeError("Diagnostic array exceeds budget");
          for (let i = 0; i < v.length; i++) {
            const d = Object.getOwnPropertyDescriptor(v, String(i));
            if (d && !("value" in d))
              throw new TypeError("Diagnostic getters are unsupported");
            if (d) visit(d.value, depth + 1);
          }
        } else {
          let keys = 0;
          for (const key in v) {
            if (!Object.hasOwn(v, key)) continue;
            if (++keys > 4096)
              throw new RangeError("Diagnostic object exceeds budget");
            chars += key.length;
            const d = Object.getOwnPropertyDescriptor(v, key)!;
            if (!("value" in d))
              throw new TypeError("Diagnostic getters are unsupported");
            visit(d.value, depth + 1);
          }
        }
        seen.delete(v);
      }
      if (chars > MiB) throw new RangeError("Diagnostic strings exceed budget");
    };
    visit(value, 0);
    const text = JSON.stringify(value);
    if (text.length > 2 * MiB) {
      this.omittedDefinitions++;
      return;
    }
    const bytes = this.textEncoder.encode(text);
    if (bytes.length > 4 * MiB) {
      this.omittedDefinitions++;
      return;
    }
    this.ring.push(this.timeMs, kind, bytes);
  }
  private id(value?: object, kind = "object", label?: string): number {
    if (!value) return 0;
    let id = this.ids.get(value);
    if (!id) {
      id = this.nextId++;
      this.ids.set(value, id);
    }
    const entry = this.directory.get(id);
    if (entry) entry.lastSeenMs = this.timeMs;
    else if (this.directory.size < MAX_DIRECTORY) {
      const body = value as Body;
      this.directory.set(id, {
        id,
        kind,
        name: String(
          label ?? body.group?.name ?? body.actor?.name ?? "world-anchor",
        ).slice(0, 160),
        lastSeenMs: this.timeMs,
      });
    } else this.omittedDefinitions++;
    return id;
  }
  private numbers(count: number): Float64Array<ArrayBuffer> {
    if (this.scratch.length < count) this.scratch = new Float64Array(count);
    return this.scratch.subarray(0, count);
  }
  private vector(out: Float64Array, offset: number, value?: Vector): number {
    out[offset++] = value?.x ?? NaN;
    out[offset++] = value?.y ?? NaN;
    out[offset++] = value?.z ?? NaN;
    return offset;
  }
  private bodyKind(body: Body): number {
    return body.damage
      ? 1
      : body.kind === "noncar"
        ? 2
        : body.kind === "pedestrian"
          ? 4
          : body.kind === "pedestrian-bone"
            ? 5
            : body.owner
              ? 3
              : 6;
  }
  private state(
    sim: VehicleSimulation,
    bodies: readonly RigidBody[],
    phase: number,
    cpu: number,
  ): void {
    const count = Math.min(bodies.length, MAX_BODIES);
    this.omittedBodies += bodies.length - count;
    const out = this.numbers(STATE_HEADER.length + count * BODY_COLUMNS.length);
    out.set([
      this.generation,
      this.tick,
      phase,
      sim.elapsed,
      sharedNativeRandom.state,
      cpu,
      count,
      bodies.length - count,
    ]);
    let p = STATE_HEADER.length;
    for (let index = 0; index < count; index++) {
      const b = bodies[index] as Body,
        s = b.state,
        prop = b.properties;
      out[p++] = this.id(
        b,
        b.damage ? "car" : (b.kind ?? (b.owner ? "part" : "body")),
      );
      out[p++] = this.bodyKind(b);
      out[p++] =
        Number(!!prop.immovable) |
        (Number(!!prop.rotationLocked) << 1) |
        (Number(!!b.attached) << 2) |
        (Number(!!b.motor?.sleeping) << 3) |
        (Number(!!b.knackered) << 4) |
        (Number(!!b.worldRecovery) << 5) |
        (Number(!!b.worldOverlapDetected) << 6) |
        (Number(!!b.overlapRecovery) << 7) |
        (Number(!!b.overlapDetected) << 8);
      p = this.vector(out, p, s.position);
      p = this.vector(out, p, s.orientation);
      out[p++] = s.orientation.w;
      p = this.vector(out, p, s.velocity);
      p = this.vector(out, p, s.angularVelocity);
      p = this.vector(out, p, s.predictedPosition);
      p = this.vector(out, p, s.predictedOrientation);
      out[p++] = s.predictedOrientation?.w ?? NaN;
      out[p++] = prop.mass;
      p = this.vector(out, p, prop.inertia);
      p = this.vector(out, p, prop.centerOfMass);
      out[p++] = b.input?.throttle ?? NaN;
      out[p++] = b.input?.steer ?? NaN;
      out[p++] = Number(b.input?.brake ?? 0);
      out[p++] = Number(!!b.input?.handbrake);
      out[p++] = b.revision ?? NaN;
      out[p++] = b.structuralRevision ?? NaN;
      out[p++] = b.splitRevision ?? NaN;
      out[p++] = b.poseEpoch ?? NaN;
      out[p++] = b.damage?.deformationRevision ?? NaN;
      out[p++] = b.damage?.repairRevision ?? NaN;
      for (let component = 0; component < 12; component++)
        out[p++] = b.damage?.componentLevels[component] ?? NaN;
    }
    this.ring.push(
      this.timeMs,
      1,
      new Uint8Array(out.buffer, out.byteOffset, out.byteLength),
    );
  }
  /** Publish pause/resume immediately: a hidden tab may not receive another
   * RAF before a long workstation lock, so a stale playing flag is unsafe. */
  setPlaying(now: number, playing: boolean): void {
    if (this.lastFrame !== undefined && this.lastPlaying)
      this.timeMs += Math.max(0, now - this.lastFrame);
    this.lastFrame = now;
    this.lastPlaying = playing;
    if (this.enabled) this.ring.advance(this.timeMs);
  }
  beginFrame(now: number, playing: boolean): void {
    this.frameInterval =
      this.lastFrame === undefined ? 0 : Math.max(0, now - this.lastFrame);
    this.setPlaying(now, playing);
    this.frameStart = this.now();
  }
  endFrame(
    frame: {
      gameTimeMs: number;
      framePeriodMs: number;
      fps: number;
      drawCalls: number;
      triangles: number;
      physicsSkippedMs: number;
    },
    paused: boolean,
    camera: Vector,
  ): void {
    if (!this.lastPlaying) return;
    this.safe(() => {
      this.frameScratch.set([
        this.generation,
        frame.gameTimeMs,
        frame.framePeriodMs,
        this.frameInterval,
        this.now() - this.frameStart,
        Number(paused),
        frame.fps,
        frame.drawCalls,
        frame.triangles,
        frame.physicsSkippedMs,
        camera.x,
        camera.y,
        camera.z,
        sharedNativeRandom.state,
      ]);
      this.ring.push(this.timeMs, 2, new Uint8Array(this.frameScratch.buffer));
      if (this.timeMs - this.lastContext >= 5000) {
        for (const [id, entry] of this.directory)
          if (entry.lastSeenMs < this.timeMs - this.ring.maxAgeMs)
            this.directory.delete(id);
        this.json(4, {
          generation: this.generation,
          context: this.readContext(),
        });
        this.lastContext = this.timeMs;
      }
    });
  }
  session(): void {
    this.safe(() => {
      this.generation++;
      this.tick = 0;
      this.lastKeyframe = this.lastContext = -Infinity;
      this.json(5, {
        event: "race-load",
        generation: this.generation,
        context: this.readContext(),
      });
    });
  }
  event(name: string, details: unknown): void {
    this.safe(() =>
      this.json(5, {
        event: name.slice(0, 80),
        generation: this.generation,
        details,
      }),
    );
  }
  startStep(sim: VehicleSimulation, bodies: readonly RigidBody[]): void {
    this.stepStart = this.now();
    this.safe(() => {
      this.tick++;
      this.state(sim, bodies, 0, 0);
      if (this.timeMs - this.lastKeyframe >= 5000) {
        this.keyframe(sim, bodies);
        this.lastKeyframe = this.timeMs;
      }
    });
  }
  finishStep(
    sim: VehicleSimulation,
    bodies: readonly RigidBody[],
    complete: boolean,
  ): void {
    this.safe(() =>
      this.state(sim, bodies, complete ? 1 : 2, this.now() - this.stepStart),
    );
  }
  contacts(
    sim: VehicleSimulation,
    impacts: readonly ContactImpact[],
    phase: 0 | 1,
    accepted?: boolean,
  ): void {
    if (!impacts.length) return;
    this.safe(() => {
      const count = Math.min(impacts.length, MAX_CONTACTS);
      this.omittedContacts += impacts.length - count;
      const out = this.numbers(
        CONTACT_HEADER.length + count * CONTACT_COLUMNS.length,
      );
      out.set([
        this.generation,
        this.tick,
        sim.elapsed,
        phase,
        accepted === undefined ? -1 : Number(accepted),
        count,
        impacts.length - count,
      ]);
      let p = CONTACT_HEADER.length;
      for (let index = 0; index < count; index++) {
        const r = impacts[index],
          face = r.sourceSurface;
        out[p++] = this.id(r.a, "body");
        out[p++] = this.id(r.b, "body");
        out[p++] = this.id(face?.actor, "world-actor", face?.actor?.name);
        out[p++] = face?.faceIndex ?? -1;
        out[p++] = r.normalImpulse;
        out[p++] = r.closingSpeed;
        out[p++] =
          r.solverAccepted === undefined ? -1 : Number(r.solverAccepted);
        out[p++] = r.sourceType ?? -1;
        p = this.vector(out, p, r.point);
        p = this.vector(out, p, r.pointB);
        p = this.vector(out, p, r.normal);
        p = this.vector(out, p, r.a.state.velocity);
        p = this.vector(out, p, r.a.state.angularVelocity);
        p = this.vector(out, p, r.b?.state.velocity);
        p = this.vector(out, p, r.b?.state.angularVelocity);
        p = this.vector(out, p, face?.a);
        p = this.vector(out, p, face?.b);
        p = this.vector(out, p, face?.c);
      }
      this.ring.push(
        this.timeMs,
        3,
        new Uint8Array(out.buffer, out.byteOffset, out.byteLength),
      );
    });
  }
  joints(
    sim: VehicleSimulation,
    rows: readonly JointConstraintImpact[],
    accepted: boolean,
  ): void {
    if (!rows.length) return;
    this.safe(() => {
      const count = Math.min(rows.length, 128);
      const out = this.numbers(
        JOINT_HEADER.length + count * JOINT_COLUMNS.length,
      );
      out.set([
        this.generation,
        this.tick,
        sim.elapsed,
        Number(accepted),
        count,
        rows.length - count,
      ]);
      let p = JOINT_HEADER.length;
      for (let i = 0; i < count; i++) {
        const row = rows[i];
        out[p++] = this.id(row.joint.child);
        out[p++] = this.id(row.joint.parent);
        out[p++] = row.normalImpulse;
        out[p++] = row.closingSpeed;
        out[p++] = row.sourceType;
        out[p++] = row.rowIndex;
        p = this.vector(out, p, row.angularConstraintLocal);
        p = this.vector(out, p, row.parentAngularConstraintLocal);
      }
      this.ring.push(
        this.timeMs,
        7,
        new Uint8Array(out.buffer, out.byteOffset, out.byteLength),
      );
    });
  }
  private keyframe(sim: VehicleSimulation, bodies: readonly RigidBody[]): void {
    let vertexBudget = 16384,
      faceBudget = 16384,
      edgeBudget = 32768,
      indexBudget = 65536,
      orderBudget = 16384;
    let truncated = bodies.length > 128;
    const entries = bodies.slice(0, 128).map((raw) => {
      const b = raw as Body;
      if ((b.hulls?.length ?? 0) > 16) truncated = true;
      const hulls = (b.hulls ?? []).slice(0, 16).map((h) => {
        if (h.faces.length > faceBudget) {
          truncated = true;
          return null;
        }
        const indices = h.faces.reduce((sum, f) => sum + f.indices.length, 0);
        if (
          h.vertices.length > vertexBudget ||
          h.faces.length > faceBudget ||
          h.edges.length > edgeBudget ||
          indices > indexBudget ||
          (h.vertexOrder?.length ?? 0) > orderBudget
        ) {
          truncated = true;
          return null;
        }
        vertexBudget -= h.vertices.length;
        faceBudget -= h.faces.length;
        edgeBudget -= h.edges.length;
        indexBudget -= indices;
        orderBudget -= h.vertexOrder?.length ?? 0;
        return {
          nativeType: h.nativeType ?? null,
          vertices: h.vertices.map((v) => [v.x, v.y, v.z]),
          faces: h.faces.map((f) => ({
            normal: [f.normal.x, f.normal.y, f.normal.z],
            constant: f.constant,
            indices: [...f.indices],
          })),
          edges: h.edges.map((e) => [e[0], e[1]]),
          vertexOrder: h.vertexOrder ? Array.from(h.vertexOrder) : null,
        };
      });
      const j = b.joint;
      if (
        (j?.planeLimits.length ?? 0) > 16 ||
        (b.shape && b.shape.type !== "BOX")
      )
        truncated = true;
      const vec = (v?: Vector) => (v ? [v.x, v.y, v.z] : null);
      return {
        id: this.id(b),
        name: String(b.group?.name ?? b.actor?.name ?? "").slice(0, 160),
        kind: b.kind ?? (b.owner ? "part" : "car"),
        unsupportedShape: b.shape?.type !== undefined && b.shape.type !== "BOX",
        owner: this.id(b.owner),
        hulls,
        joint: j
          ? {
              type: j.type,
              parent: this.id(j.parent),
              child: this.id(j.child),
              childAnchor: [j.childAnchor.x, j.childAnchor.y, j.childAnchor.z],
              parentAnchor: [
                j.parentAnchor.x,
                j.parentAnchor.y,
                j.parentAnchor.z,
              ],
              childAxis: vec(j.childAxis),
              parentAxis: vec(j.parentAxis),
              translationAxis: vec(j.translationAxis),
              translationTravel: j.translationTravel ?? null,
              quickHinge: j.quickHinge ?? false,
              allowNearBoundary: j.allowNearBoundary ?? false,
              hingeBasis: j.hingeBasis?.map((v) => vec(v)) ?? null,
              translationTransverse:
                j.translationTransverse?.map((v) => vec(v)) ?? null,
              planes: j.planeLimits.slice(0, 16).map((p) => ({
                child: [
                  p.childDirection.x,
                  p.childDirection.y,
                  p.childDirection.z,
                ],
                parent: [p.parentNormal.x, p.parentNormal.y, p.parentNormal.z],
              })),
            }
          : null,
      };
    });
    this.json(6, {
      generation: this.generation,
      tick: this.tick,
      physicsSeconds: sim.elapsed,
      truncated,
      collisionGeometryOnly: true,
      bodies: entries,
    });
  }
  get status() {
    const r = this.ring.stats;
    return {
      enabled: this.enabled,
      generation: this.generation,
      timeMs: this.timeMs,
      retainedSeconds:
        r.oldestTimeMs === null
          ? 0
          : Math.max(0, (this.timeMs - r.oldestTimeMs) / 1000),
      memoryLimitBytes: this.memoryLimitBytes,
      ring: r,
      captureCpuMs: this.captureCpuMs,
      captureCalls: this.calls,
      errors: this.errors,
      omittedBodies: this.omittedBodies,
      omittedContacts: this.omittedContacts,
      omittedDefinitions: this.omittedDefinitions,
    };
  }
  exportBlob(extra: Record<string, unknown> = {}): Blob {
    if (this.exportCount)
      throw new Error("A bug capture export is already in progress");
    this.exportCount++;
    try {
      this.safe(() =>
        this.json(4, {
          generation: this.generation,
          context: this.readContext(),
        }),
      );
      return createCaptureBlob(this.ring.snapshot(), {
        type: "carma-bug-capture",
        version: 1,
        createdAt: new Date().toISOString(),
        ...extra,
        diagnosticOnly: true,
        limitations: [
          "Not a deterministic full-game replay",
          "Collision geometry keyframes are bounded; render-mesh deformation, all AI queues, async work and custom random streams are not fully serialized",
          "Candidate callbacks and accepted normal responses are distinct; friction is finalized later",
          "Retention uses active play time; pauses preserve history",
        ],
        status: this.status,
        failures: this.failures,
        directory: [...this.directory.values()],
        schemas: {
          "1": { header: STATE_HEADER, bodyColumns: BODY_COLUMNS },
          "2": { columns: FRAME_COLUMNS },
          "3": { header: CONTACT_HEADER, contactColumns: CONTACT_COLUMNS },
          "4": "UTF-8 JSON context",
          "5": "UTF-8 JSON event",
          "6": "UTF-8 JSON collision keyframe",
          "7": { header: JOINT_HEADER, jointColumns: JOINT_COLUMNS },
        },
      });
    } finally {
      this.exportCount--;
    }
  }
}
