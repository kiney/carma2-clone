/** Ordered ordinary pedestrian blood phases from installed HW. The host owns
 * actual resources, shared CRT, shrapnel allocation and the shared skid pool. */
import type { PedVector } from "./ped-form";
import { skidContactEligible } from "./skidmarks";

const f = Math.fround;
const SIZE = 0x12c;
export const nativePedBloodCacheOffsets = Object.freeze({
  stumpCounters: 0x23,
  spurtPeriod: 0x84,
  lastSpurt: 0x88,
  flags: 0xc4,
  skidId: 0xc8,
  contactCount: 0xca,
  sectionStart: 0xcc,
  sectionEnd: 0xd8,
  sum: 0xe4,
  normal: 0xf0,
  previousPosition: 0xfc,
  previousNormal: 0x108,
  lateral: 0x114,
  maximum: 0x124,
  minimum: 0x128,
});

export interface NativePedImpactBloodPacket {
  kind: "impact";
  point: PedVector;
  pedestrianPosition: PedVector;
  /** Already world velocity * double6.9, with Float32 component stores. */
  velocity: PedVector;
  force: number;
  startSize: number;
  timeMs: number;
  seed: number;
}
export interface NativePedSpurtBloodPacket {
  kind: "spurt";
  point: PedVector;
  direction: PedVector;
  /** Already metric; the fragment consumer must not multiply6.9 again. */
  velocity: PedVector;
  timeMs: number;
  seed: number;
}
export type NativePedBloodPacket =
  | NativePedImpactBloodPacket
  | NativePedSpurtBloodPacket;
export interface NativePedBloodGate {
  goreLevel: number;
  /** Current selected Object+258; null means no selected volume. */
  volumeGravity: number | null;
}
function integer(value: number, min: number, max: number, name: string) {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`Invalid native pedestrian blood ${name}`);
  return value;
}
function scalar(value: number): number {
  const stored = f(value);
  if (!Number.isFinite(stored))
    throw new Error("Invalid native pedestrian blood scalar");
  return stored;
}
function vector(value: PedVector): [number, number, number] {
  if (!value || value.length !== 3)
    throw new Error("Missing native pedestrian blood vector");
  return [scalar(value[0]), scalar(value[1]), scalar(value[2])];
}
function matrix(value: Float32Array): Float32Array {
  if (!(value instanceof Float32Array) || value.length !== 12)
    throw new Error("Missing native pedestrian blood native12 matrix");
  return Float32Array.from(value, scalar);
}
function storage(value: Uint8Array): DataView {
  if (!(value instanceof Uint8Array) || value.byteLength !== SIZE)
    throw new Error(
      "Native pedestrian blood requires actual0x12c process storage",
    );
  return new DataView(value.buffer, value.byteOffset, value.byteLength);
}
function readVector(view: DataView, offset: number): PedVector {
  return [0, 4, 8].map((i) =>
    view.getFloat32(offset + i, true),
  ) as unknown as PedVector;
}
function writeVector(view: DataView, offset: number, value: PedVector): void {
  for (let i = 0; i < 3; i++) view.setFloat32(offset + i * 4, value[i], true);
}
const dot = (a: PedVector, b: PedVector) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const metric = (velocity: PedVector): PedVector =>
  vector(velocity).map((value) => f(value * 6.9)) as unknown as PedVector;
function allowed(input: NativePedBloodGate): boolean {
  integer(input.goreLevel, 0, 0x7fffffff, "gore");
  return (
    input.goreLevel > 0 &&
    (input.volumeGravity === null || scalar(input.volumeGravity) >= 1)
  );
}
function pointSeed(point: PedVector, timeMs: number): number {
  let seed = integer(timeMs, 0, 0xffffffff, "time");
  for (const value of point) {
    const component = Math.trunc(value);
    integer(component, -0x80000000, 0x7fffffff, "seed component");
    seed ^= component;
  }
  return seed >>> 0;
}

export interface NativePedImpactBloodInput {
  point: PedVector;
  pedestrianPosition: PedVector;
  velocity: PedVector;
  other: { address: number; velocity: PedVector } | null;
  pedAddress: number;
  timeMs: number;
  force: number;
  startSize: number;
}
/** DoGiblets4ccda0 packet; the consumer performs cloud then seeded fragments. */
export function createNativePedImpactBloodPacket(
  input: NativePedImpactBloodInput,
): NativePedImpactBloodPacket {
  const point = vector(input.point);
  const pedAddress = integer(input.pedAddress, 0, 0xffffffff, "ped address");
  const otherAddress = input.other
    ? integer(input.other.address, 0, 0xffffffff, "other address")
    : 0;
  return {
    kind: "impact",
    point,
    pedestrianPosition: vector(input.pedestrianPosition),
    velocity: metric(input.other?.velocity ?? input.velocity),
    force: scalar(input.force),
    startSize: integer(input.startSize, 0, 0x7fffffff, "start size"),
    timeMs: input.timeMs,
    seed: (pointSeed(point, input.timeMs) ^ pedAddress ^ otherAddress) >>> 0,
  };
}
/** Active4d2389..23c8, after the caller's raw-damage/continuation gates. */
export function activeNativePedBloodPacket(
  input: Omit<NativePedImpactBloodInput, "force"> &
    NativePedBloodGate & {
      effectiveLambda: number;
      simpleMass: number;
    },
): NativePedImpactBloodPacket | null {
  if (!allowed(input)) return null;
  const mass = scalar(input.simpleMass);
  if (!(mass > 0))
    throw new Error("Invalid native pedestrian blood simple mass");
  const ratio = 0.068 / mass;
  return createNativePedImpactBloodPacket({
    ...input,
    force: f(scalar(input.effectiveLambda) * (ratio * ratio)),
  });
}

export interface NativePedWorldSmearInput extends NativePedBloodGate {
  hitPoints: number;
  otherPresent: boolean;
  point: PedVector;
  velocity: PedVector;
  face: {
    normal: PedVector;
    materialName?: string;
    pixelmapType?: number;
  } | null;
}
export interface NativePedBloodPhaseResult {
  requiredProviders: readonly string[];
  emitted: number;
  /** Only this phase's percentage draws; emission consumers own their draws. */
  randomDraws: number;
}
/** Active world-only corpse patch accumulation4d23cd..26de. */
export function accumulateNativePedWorldSmear(
  processStorage: Uint8Array | null,
  input: NativePedWorldSmearInput,
): { collected: boolean; requiredProviders: readonly string[] } {
  const skipped = {
    collected: false,
    requiredProviders: [] as readonly string[],
  };
  if (!allowed(input) || input.otherPresent || input.hitPoints > 0)
    return skipped;
  if (!input.face)
    return { collected: false, requiredProviders: ["native-blood-world-face"] };
  if (!skidContactEligible({ present: true, ...input.face })) return skipped;
  if (!processStorage)
    return {
      collected: false,
      requiredProviders: ["native-blood-process-cache"],
    };
  const view = storage(processStorage),
    p = vector(input.point),
    n = vector(input.face.normal);
  const flags = view.getUint32(0xc4, true);
  if (!(flags & 2)) {
    const velocity = vector(input.velocity),
      length = Math.sqrt(dot(velocity, velocity));
    const u: PedVector =
      length > f(2 ** -22)
        ? [velocity[0] / length, velocity[1] / length, velocity[2] / length]
        : [1, 0, 0];
    const lateral: PedVector = [
      f(n[1] * u[2] - n[2] * u[1]),
      f(n[2] * u[0] - n[0] * u[2]),
      n[0] * u[1] - n[1] * u[0],
    ];
    // Z stays live through the first projection; its retained matrix field is F32.
    const projection = f(dot(p, lateral));
    view.setUint32(0xc4, flags | 2, true);
    view.setUint8(0xca, 1);
    writeVector(view, 0xe4, p);
    writeVector(view, 0xf0, n);
    writeVector(view, 0x114, lateral);
    view.setFloat32(0x124, projection, true);
    view.setFloat32(0x128, projection, true);
  } else {
    const savedNormal = readVector(view, 0xf0),
      sum = readVector(view, 0xe4);
    const count = view.getUint8(0xca);
    const planeDistance = Math.abs(
      dot(savedNormal, p) - dot(savedNormal, sum) / count,
    );
    //4d2647 tests C0 alone: unordered (e.g. wrapped count0 and0/0) also
    // continues. A JavaScript strict-less test would incorrectly reject it.
    if (!(dot(n, savedNormal) > f(0.997)) || planeDistance >= f(0.01))
      return skipped;
    const projection = dot(readVector(view, 0x114), p);
    if (view.getFloat32(0x124, true) < projection)
      view.setFloat32(0x124, projection, true);
    if (projection < view.getFloat32(0x128, true))
      view.setFloat32(0x128, projection, true);
    writeVector(view, 0xe4, [
      f(sum[0] + p[0]),
      f(sum[1] + p[1]),
      f(sum[2] + p[2]),
    ]);
    view.setUint8(0xca, (count + 1) & 255);
  }
  return { collected: true, requiredProviders: [] };
}

export interface NativePedSmearSection {
  id: number;
  start: PedVector;
  end: PedVector;
  position: PedVector;
  normal: PedVector;
  previousPosition: PedVector;
  previousNormal: PedVector;
  totalDistance: 0;
  width: number;
}
export interface NativePedSmearSectionResult {
  stop: boolean;
  id: number;
  start: PedVector;
  end: PedVector;
}
/** Once at late-frame LastChance4d5740, AFTER all contacts. Source clears batch
 * bit2 on the NEXT process-cache visit, not here. The caller owns once/frame. */
export function consumeNativePedWorldSmear(
  processStorage: Uint8Array | null,
  processed: boolean,
  host: {
    skidSection?: (
      section: NativePedSmearSection,
    ) => NativePedSmearSectionResult;
  },
): NativePedBloodPhaseResult {
  const result = {
    requiredProviders: [] as string[],
    emitted: 0,
    randomDraws: 0,
  };
  if (!processed || !processStorage) return result;
  const view = storage(processStorage),
    flags = view.getUint32(0xc4, true),
    count = view.getUint8(0xca);
  if (!(flags & 2) || count < 2) {
    view.setUint32(0xc4, flags & ~1, true);
    return result;
  }
  const sum = readVector(view, 0xe4),
    normal = readVector(view, 0xf0);
  const position: PedVector = [
    f(sum[0] / count),
    f(sum[1] / count),
    f(sum[2] / count),
  ];
  if (!(flags & 1)) {
    view.setInt16(0xc8, -1, true);
    view.setUint32(0xc4, flags | 1, true);
  } else {
    if (!host.skidSection) {
      result.requiredProviders.push("native-blood-shared-skid-section");
      return result;
    }
    const next = host.skidSection({
      id: view.getInt16(0xc8, true),
      start: readVector(view, 0xcc),
      end: readVector(view, 0xd8),
      position,
      normal,
      previousPosition: readVector(view, 0xfc),
      previousNormal: readVector(view, 0x108),
      totalDistance: 0,
      width: f(
        view.getFloat32(0x124, true) - view.getFloat32(0x128, true) - f(-0.01),
      ),
    });
    integer(next.id, -32768, 32767, "skid ID");
    const start = vector(next.start),
      end = vector(next.end);
    view.setInt16(0xc8, next.id, true);
    writeVector(view, 0xcc, start);
    writeVector(view, 0xd8, end);
    if (next.stop) view.setUint32(0xc4, flags & ~1, true);
    result.emitted = 1;
  }
  writeVector(view, 0xfc, position);
  writeVector(view, 0x108, normal);
  return result;
}

const ROOT_LOOK: readonly PedVector[] = [
  [0, 1, 0],
  [0, -1, 0],
  [0, -1, 0],
  [0, -1, 0],
  [0, -1, 0],
  [1, 0, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [-1, 0, 0],
];

export interface NativePedBloodRootLooks {
  /** Native unchecked index1..15 reads: nine authored vectors followed by
   * adjacent initialized-data words, including pointer bits reinterpreted F32.
   * This is a bounded installed-image snapshot, not an enlarged authored array. */
  readonly vectors: readonly PedVector[];
  readonly sourceAddress: number;
  readonly sourceOffset: number;
}

/** Locate HW/SW source lookup plus the bounded adjacent words needed by all
 * installed FORM bones. Never embed executable payload or assume equal RVAs. */
export function readNativePedBloodRootLooks(
  bytes: Uint8Array,
): NativePedBloodRootLooks {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (message: string): never => {
    throw new Error(`C2 pedestrian blood: ${message}`);
  };
  const span = (offset: number, length: number): void => {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      length < 0 ||
      offset > bytes.length - length
    )
      fail("PE span exceeds file bounds");
  };
  span(0, 64);
  if (bytes.length > 32 * 1024 * 1024 || view.getUint16(0, true) !== 0x5a4d)
    fail("bounded DOS/PE image required");
  const pe = view.getUint32(0x3c, true);
  span(pe, 24);
  const count = view.getUint16(pe + 6, true),
    optionalSize = view.getUint16(pe + 20, true);
  if (
    view.getUint32(pe, true) !== 0x4550 ||
    view.getUint16(pe + 4, true) !== 0x14c ||
    count < 1 ||
    count > 96 ||
    optionalSize < 96
  )
    fail("x86 PE32 headers required");
  span(pe + 24, optionalSize + count * 40);
  if (view.getUint16(pe + 24, true) !== 0x10b)
    fail("PE32 optional header required");
  const imageBase = view.getUint32(pe + 24 + 28, true);
  const sections: Array<{
    address: number;
    offset: number;
    size: number;
    flags: number;
  }> = [];
  for (let i = 0; i < count; i++) {
    const at = pe + 24 + optionalSize + i * 40;
    const offset = view.getUint32(at + 20, true),
      size = view.getUint32(at + 16, true);
    span(offset, size);
    sections.push({
      address: imageBase + view.getUint32(at + 12, true),
      offset,
      size,
      flags: view.getUint32(at + 36, true),
    });
  }
  const signature = ROOT_LOOK.flat(),
    name = "NONHUMANOID\0",
    matches: NativePedBloodRootLooks[] = [];
  for (const section of sections) {
    if (!(section.flags & 0x40) || section.flags & 0x20000000) continue;
    for (
      let at = section.offset;
      at <= section.offset + section.size - 15 * 12;
      at += 4
    ) {
      if (
        !signature.every(
          (value, i) => view.getFloat32(at + i * 4, true) === value,
        )
      )
        continue;
      // The first adjacent cell is gForm_non_humanoid_names[0]. Validate its
      // actual pointer target before accepting an incidental vector signature.
      const pointer = view.getUint32(at + 9 * 12, true);
      const target = sections.find(
        (s) =>
          pointer >= s.address && pointer - s.address <= s.size - name.length,
      );
      if (!target) continue;
      const stringOffset = target.offset + pointer - target.address;
      if (
        ![...name].every(
          (c, i) => view.getUint8(stringOffset + i) === c.charCodeAt(0),
        )
      )
        continue;
      const vectors = Array.from(
        { length: 15 },
        (_, index) =>
          Object.freeze([
            view.getFloat32(at + index * 12, true),
            view.getFloat32(at + index * 12 + 4, true),
            view.getFloat32(at + index * 12 + 8, true),
          ]) as PedVector,
      );
      if (!vectors.every((v) => v.every(Number.isFinite)))
        fail("nonfinite adjacent root-look words");
      matches.push(
        Object.freeze({
          vectors: Object.freeze(vectors),
          sourceOffset: at,
          sourceAddress: section.address + at - section.offset,
        }),
      );
    }
  }
  if (matches.length !== 1)
    fail(`expected one original root lookup, found ${matches.length}`);
  return matches[0];
}
function apply(m: Float32Array, v: PedVector, point: boolean): PedVector {
  return [0, 1, 2].map((axis) =>
    f(
      v[0] * m[axis] +
        v[1] * m[axis + 3] +
        v[2] * m[axis + 6] +
        (point ? m[axis + 9] : 0),
    ),
  ) as unknown as PedVector;
}
/** DoSpurt4d55f0 packet. Its consumer owns rand/save/seed/spawn/restore. */
export function createNativePedSpurtBloodPacket(input: {
  matrix: Float32Array;
  attachment: PedVector;
  look: PedVector;
  velocity: PedVector;
  timeMs: number;
}): NativePedSpurtBloodPacket {
  const m = matrix(input.matrix),
    point = apply(m, vector(input.attachment), true);
  return {
    kind: "spurt",
    point,
    direction: apply(m, vector(input.look), false),
    velocity: metric(input.velocity),
    timeMs: input.timeMs,
    seed: pointSeed(point, input.timeMs),
  };
}
export interface NativePedBleedingBone {
  parent: number;
  childAttachment: PedVector | null;
  parentAttachment: PedVector | null;
}
export interface NativePedBleedingInput extends NativePedBloodGate {
  processStorage: Uint8Array | null;
  timeMs: number;
  hitPoints: number;
  action: number;
  mutantSpeed: number;
  removedBoneMask: number;
  vanishedBoneMask: number;
  pedestrianPosition: PedVector;
  pedAddress: number;
  bodyVelocity: PedVector;
  characterVelocity: PedVector;
  scrapeStart: number;
  lumpsPerEmission: number;
  bones: readonly NativePedBleedingBone[];
  /** Installed shared global69eab8, never a per-ped timestamp. */
  globals: { lastMutantBleedTimeMs: number };
}
export interface NativePedBleedingHost {
  /** Current GetBoneMatrixPtr and actual detached Object worldV. */
  readBone?: (
    index: number,
  ) => { matrix: Float32Array | null; velocity: PedVector | null } | null;
  /** Raw source lookup at base+12*(index-1). Required beyond the nine authored
   * humanoid entries: actual installed adjacent words, never a fallback axis. */
  readRootLook?: (index: number) => PedVector | null;
  nextCrtInteger?: () => number;
  emit?: (packet: NativePedBloodPacket) => void | readonly string[];
  /** Optional resource preflight before phase RNG, counters or timestamps. */
  preflightPacket?: (packet: NativePedBloodPacket) => readonly string[];
}
/** Post-pose MakeEmBleed4d4dad..5158. Plan resource-dependent emissions first;
 * missing providers leave source cache/global state and shared CRT untouched. */
export function processNativePedBleeding(
  input: NativePedBleedingInput,
  host: NativePedBleedingHost,
): NativePedBloodPhaseResult {
  const result = {
    requiredProviders: [] as string[],
    emitted: 0,
    randomDraws: 0,
  };
  if (!allowed(input)) return result;
  const now = integer(input.timeMs, 0, 0xffffffff, "time");
  const lastMutant = integer(
    input.globals.lastMutantBleedTimeMs,
    0,
    0xffffffff,
    "last mutant time",
  );
  const mutantEligible =
    scalar(input.mutantSpeed) !== 0 &&
    input.hitPoints <= 0 &&
    input.action === 6 &&
    (now - lastMutant) >>> 0 > 300;
  const view = input.processStorage ? storage(input.processStorage) : null;
  const removed = integer(input.removedBoneMask, 0, 0xffffffff, "removed mask");
  const vanished = integer(
    input.vanishedBoneMask,
    0,
    0xffffffff,
    "vanished mask",
  );
  const period = view?.getUint32(0x84, true) ?? 0;
  const stumpEligible =
    !!view &&
    removed !== 0 &&
    (now - view.getUint32(0x88, true)) >>> 0 > period;
  if (!mutantEligible && !stumpEligible) return result;
  const mutantPacket = mutantEligible
    ? createNativePedImpactBloodPacket({
        point: input.pedestrianPosition,
        pedestrianPosition: input.pedestrianPosition,
        velocity: input.bodyVelocity,
        other: null,
        pedAddress: input.pedAddress,
        timeMs: now,
        force: f(0.06),
        startSize: input.scrapeStart,
      })
    : null;
  let nextPeriod = period;
  const plans: Array<{
    index: number;
    counter: number;
    packets: NativePedSpurtBloodPacket[];
  }> = [];
  if (stumpEligible) {
    integer(input.bones.length, 1, 32, "bone count");
    const allowedMask =
      input.bones.length === 32 ? 0xffffffff : 2 ** input.bones.length - 1;
    if (removed & ~allowedMask || vanished & ~allowedMask)
      throw new Error("Native pedestrian blood mask exceeds FORM");
    const count = integer(
      input.lumpsPerEmission,
      -0x80000000,
      0x7fffffff,
      "lump count",
    );
    if (input.hitPoints <= 0) {
      nextPeriod = Math.trunc(period * 1.2) >>> 0;
      if (nextPeriod > 1000) nextPeriod = 0;
    }
    const snapshots = new Map<
      number,
      ReturnType<NonNullable<NativePedBleedingHost["readBone"]>>
    >();
    const read = (index: number) => {
      if (!snapshots.has(index))
        snapshots.set(index, host.readBone?.(index) ?? null);
      return snapshots.get(index)!;
    };
    const emitFor = (
      index: number,
      attachment: PedVector | null,
      look: PedVector | null,
      velocity: PedVector,
      packets: NativePedSpurtBloodPacket[],
    ) => {
      const m = read(index)?.matrix;
      if (!m || !attachment || !look) {
        result.requiredProviders.push(`native-blood-current-bone-${index}`);
        return;
      }
      packets.push(
        createNativePedSpurtBloodPacket({
          matrix: m,
          attachment,
          look,
          velocity,
          timeMs: now,
        }),
      );
    };
    for (let index = 1; index < input.bones.length; index++) {
      if (!(removed & (1 << index)) || vanished & (1 << index)) continue;
      const bone = input.bones[index],
        part = read(index);
      if (!part?.velocity) {
        result.requiredProviders.push(
          `native-blood-detached-velocity-${index}`,
        );
        continue;
      }
      const velocity = vector(part.velocity),
        packets: NativePedSpurtBloodPacket[] = [];
      let counter = view!.getUint8(0x23 + index);
      if (counter < count && dot(velocity, velocity) === 0) counter = 0;
      else {
        if (counter !== 0) counter = (counter - count) & 255;
        const m = part.matrix;
        emitFor(
          index,
          bone.childAttachment,
          m ? [m[0], m[1], m[2]] : null,
          velocity,
          packets,
        );
      }
      const parent = integer(
        bone.parent,
        0,
        input.bones.length - 1,
        "parent index",
      );
      const parentRemoved = !!(removed & (1 << parent));
      if (!parentRemoved || counter !== 0) {
        const parentVelocity = parentRemoved
          ? read(parent)?.velocity
          : input.characterVelocity;
        if (!parentVelocity)
          result.requiredProviders.push(
            `native-blood-detached-velocity-${parent}`,
          );
        else {
          const v = vector(parentVelocity);
          if (dot(v, v) !== 0 || nextPeriod !== 0) {
            const m = read(parent)?.matrix;
            let look: PedVector | null = m ? [m[0], m[1], m[2]] : null;
            if (parent === 0) {
              const sourceLook =
                ROOT_LOOK[index - 1] ?? host.readRootLook?.(index);
              if (!sourceLook) {
                result.requiredProviders.push(
                  `native-blood-root-look-${index}`,
                );
                continue;
              }
              look = m ? apply(matrix(m), vector(sourceLook), false) : null;
            }
            emitFor(parent, bone.parentAttachment, look, v, packets);
          }
        }
      }
      plans.push({ index, counter, packets });
    }
  }
  const candidates: NativePedBloodPacket[] = [
    ...(mutantPacket ? [mutantPacket] : []),
    ...plans.flatMap((plan) => plan.packets),
  ];
  if (candidates.length && !host.emit)
    result.requiredProviders.push("native-blood-emission-owner");
  if (mutantEligible && !host.nextCrtInteger)
    result.requiredProviders.push("native-blood-shared-CRT");
  for (const packet of candidates)
    result.requiredProviders.push(...(host.preflightPacket?.(packet) ?? []));
  if (result.requiredProviders.length) {
    result.requiredProviders = [...new Set(result.requiredProviders)];
    return result;
  }
  const emit = (packet: NativePedBloodPacket) => {
    const missing = host.emit!(packet);
    if (missing) result.requiredProviders.push(...missing);
    result.emitted++;
  };
  if (mutantPacket) {
    const sample = integer(host.nextCrtInteger!(), 0, 32767, "CRT draw");
    result.randomDraws++;
    if (Math.floor((sample * 100) / 32768) < 40) {
      input.globals.lastMutantBleedTimeMs = now;
      emit(mutantPacket);
    }
  }
  if (stumpEligible) {
    view!.setUint32(0x84, nextPeriod, true);
    view!.setUint32(0x88, now, true);
    for (const plan of plans) {
      view!.setUint8(0x23 + plan.index, plan.counter);
      for (const packet of plan.packets) emit(packet);
    }
  }
  return result;
}
