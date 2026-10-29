/** Installed ordinary movement policy. The canonical process record owns every
 * retained scalar/vector; character, proximity and CRT effects remain providers. */
import type { PedVector } from "./ped-form";

export interface NativePedOrdinaryMoveResult {
  status: "complete" | "provider-required";
  requiredProviders: string[];
}
export interface NativePedOrdinaryCharacter {
  /** Live GetCharacterMatrixPtr translation and character+c0/cc/d8 fields. */
  rootPosition: PedVector;
  direction: PedVector;
  up: PedVector;
  velocity: PedVector;
  /** Character signed WORD+1e, before any new animation-period write. */
  periodMs: number;
}
export interface NativePedOrdinaryMoveInput {
  /** Borrowed NativePedProcessCache.storage, never a permanent per-ped copy. */
  process: { storage: Uint8Array };
  character: NativePedOrdinaryCharacter;
  selectedFloorNormal: PedVector | null;
  timeMs: number;
  framePeriodMs: number;
  movement: {
    minTurnIntervalMs: number;
    maxTurnIntervalMs: number;
    maxRandomAngle: number;
  };
  action: number;
  pedestrianSpeedFactor: number;
  avoidDistanceSquared: number;
  reachSquared: number;
  suicidal: boolean;
  blind: boolean;
  /** Reverse action replay is supported only by acceleration. */
  reverseReplay?: boolean;
  providers: {
    nextCrtInteger?: () => number;
    /** Actual SetCharacterDirectionAR: consumes a potentially unnormalised
     * direction and actual character up, updates the live character/body owner. */
    setCharacterDirection?: (direction: PedVector, up: PedVector) => void;
    /** Actual SetCharacterMoveAR(-1,period,0,0,time), preserving the current move. */
    setCharacterPeriod?: (periodMs: number, timeMs: number) => void;
    /** Verified native scanner writes this same canonical record and may mutate
     * borrowed two-sided face records. Returns its source scalar distance. */
    rescanProximity?: (
      direction: PedVector | null,
    ) => NativePedOrdinaryMoveResult & {
      distance: number;
    };
    /** Full installed4ced30 writer, including its actual pointer CRT reseed.
     * A browser identity number is not a source pointer provider. */
    scanForObjects?: () => NativePedOrdinaryMoveResult;
  };
}
const f = Math.fround;
const complete = (): NativePedOrdinaryMoveResult => ({
  status: "complete",
  requiredProviders: [],
});
const missing = (name: string): NativePedOrdinaryMoveResult => ({
  status: "provider-required",
  requiredProviders: [name],
});
function view(input: NativePedOrdinaryMoveInput): DataView {
  const s = input.process.storage;
  if (!(s instanceof Uint8Array) || s.byteLength !== 0x12c)
    throw new Error(
      "Ordinary movement requires the canonical 300-byte process record",
    );
  if (
    !Number.isInteger(input.timeMs) ||
    input.timeMs < 0 ||
    input.timeMs > 0xffffffff
  )
    throw new Error("Invalid ordinary pedestrian time");
  return new DataView(s.buffer, s.byteOffset, s.byteLength);
}
function vector(v: PedVector): PedVector {
  if (v.length !== 3 || v.some((n) => !Number.isFinite(f(n))))
    throw new Error("Ordinary movement requires finite Float32 vectors");
  return [f(v[0]), f(v[1]), f(v[2])];
}
const read = (v: DataView, offset: number): PedVector => [
  v.getFloat32(offset, true),
  v.getFloat32(offset + 4, true),
  v.getFloat32(offset + 8, true),
];
const write = (v: DataView, offset: number, x: PedVector) =>
  x.forEach((n, i) => v.setFloat32(offset + i * 4, n, true));
const dot = (a: PedVector, b: PedVector) =>
  a[1] * b[1] + a[2] * b[2] + a[0] * b[0];
const negate = (x: PedVector): PedVector => [-x[0], -x[1], -x[2]];
function cross(a: PedVector, b: PedVector): PedVector {
  return [
    f(a[1] * b[2] - a[2] * b[1]),
    f(a[2] * b[0] - a[0] * b[2]),
    f(a[0] * b[1] - a[1] * b[0]),
  ];
}
/** Installed403f90 checks all three components, unlike rec2's duplicated X. */
export function nativePedSafeCross(a0: PedVector, b0: PedVector): PedVector {
  const a = vector(a0),
    b = vector(b0);
  const c = cross(a, b);
  if (!c.every((n) => Math.abs(n) < f(2.384185791015625e-6))) return c;
  const ax = Math.abs(a[0]),
    ay = Math.abs(a[1]),
    az = Math.abs(a[2]);
  return cross(
    a,
    ax <= ay && ax <= az
      ? [1, 0, 0]
      : ay <= ax && ay <= az
        ? [0, 1, 0]
        : [0, 0, 1],
  );
}
function normalise(a: PedVector): PedVector {
  const length = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  if (!(length > 2 ** -22)) return [1, 0, 0];
  const inverseLength = 1 / length;
  return [
    f(a[0] * inverseLength),
    f(a[1] * inverseLength),
    f(a[2] * inverseLength),
  ];
}
function sample(input: NativePedOrdinaryMoveInput): number {
  const n = input.providers.nextCrtInteger!();
  if (!Number.isInteger(n) || n < 0 || n > 32767)
    throw new Error("Ordinary movement requires a native 15-bit CRT sample");
  return n;
}
function integer(input: NativePedOrdinaryMoveInput, low: number, high: number) {
  return (
    (low + Math.trunc(Math.imul(sample(input), (high - low + 1) | 0) / 32768)) |
    0
  );
}
function chance(input: NativePedOrdinaryMoveInput, percent: number) {
  return percent !== 0 && Math.trunc((sample(input) * 100) / 32768) < percent;
}
const directionProvider = (input: NativePedOrdinaryMoveInput) =>
  input.selectedFloorNormal === null
    ? missing("source-selected-pedestrian-floor-normal")
    : !input.providers.setCharacterDirection
      ? missing("source-SetCharacterDirectionAR-provider")
      : null;

/** Installed4d3c84..4d3dcd. +80 is unsigned in the installed clamp branch. */
export function accelerateNativeOrdinaryPed(
  input: NativePedOrdinaryMoveInput,
): NativePedOrdinaryMoveResult {
  const v = view(input),
    old = v.getUint32(0x80, true);
  if (!old) return complete();
  if (!input.providers.setCharacterPeriod)
    return missing("source-SetCharacterMoveAR-period-provider");
  if (
    !Number.isFinite(input.framePeriodMs) ||
    input.framePeriodMs < 0 ||
    !Number.isFinite(input.pedestrianSpeedFactor)
  )
    throw new Error("Invalid ordinary pedestrian acceleration input");
  const delta = input.framePeriodMs * v.getFloat32(0xb8, true);
  let speed = Math.trunc(old + (input.reverseReplay ? delta : -delta)) >>> 0;
  let retained = speed;
  if (input.reverseReplay ? speed >= 100 : speed <= 30) {
    speed = input.reverseReplay ? 100 : 30;
    retained = 0;
  }
  v.setUint32(0x80, retained, true);
  input.providers.setCharacterPeriod(
    f(
      input.pedestrianSpeedFactor === 0
        ? speed
        : speed / f(input.pedestrianSpeedFactor),
    ),
    input.timeMs,
  );
  return complete();
}

/** Installed4cc060. No selected support face means no direction stores. */
export function setNativePedXZDirection(
  input: NativePedOrdinaryMoveInput,
  requested: PedVector,
  distance: number,
): NativePedOrdinaryMoveResult {
  const v = view(input);
  // Installed4cc074..4cc07f returns before reading direction/providers when
  // the actual process has no list or selected support. NULL is resolved state.
  if (input.selectedFloorNormal === null) return complete();
  const unavailable = directionProvider(input);
  if (unavailable) return unavailable;
  const floor = vector(input.selectedFloorNormal!);
  const direction = normalise(
    nativePedSafeCross(nativePedSafeCross([0, 1, 0], requested), floor),
  );
  if (v.getUint32(0x6c, true) && dot(read(v, 0x48), direction) > 0.95)
    return complete();
  if (!Number.isFinite(distance) || distance < 0)
    throw new Error("Invalid ordinary pedestrian turn distance");
  write(v, 0x48, direction);
  if (distance !== 0) {
    write(v, 0x54, direction);
    const velocity = vector(input.character.velocity);
    const length = f(
      Math.sqrt(
        velocity[0] * velocity[0] +
          velocity[1] * velocity[1] +
          velocity[2] * velocity[2],
      ),
    );
    const duration = Math.min(
      0.5,
      ((input.character.periodMs * distance) / length) * f(1 / 30),
    );
    if (!Number.isFinite(duration))
      throw new Error("Unsupported native turn duration");
    v.setUint32(0x6c, input.timeMs, true);
    v.setUint32(0x70, Math.trunc(input.timeMs + duration * 1000) >>> 0, true);
    write(v, 0x60, vector(input.character.direction));
  } else {
    v.setUint32(0x6c, 0, true);
    input.providers.setCharacterDirection!(
      direction,
      vector(input.character.up),
    );
  }
  return complete();
}

/** Installed4d4111..4d4399; body/cache effects belong to the direction outlet. */
export function smoothTurnNativeOrdinaryPed(
  input: NativePedOrdinaryMoveInput,
): NativePedOrdinaryMoveResult {
  const v = view(input);
  if (!v.getUint32(0x6c, true)) return complete();
  const unavailable = directionProvider(input);
  if (unavailable) return unavailable;
  const start = v.getUint32(0x6c, true),
    end = v.getUint32(0x70, true);
  let direction: PedVector;
  if (input.timeMs < end) {
    const t = ((input.timeMs - start) >>> 0) / ((end - start) >>> 0),
      target = read(v, 0x54),
      old = read(v, 0x60);
    direction = [0, 1, 2].map((i) =>
      f(t * target[i] + (1 - t) * old[i]),
    ) as unknown as PedVector;
  } else {
    v.setUint32(0x6c, 0, true);
    direction = read(v, 0x48);
  }
  input.providers.setCharacterDirection!(direction, vector(input.character.up));
  return complete();
}

/** Installed4d43a9..4d4503; rejected turns restore all 0x12c process bytes. */
export function wanderNativeOrdinaryPed(
  input: NativePedOrdinaryMoveInput,
): NativePedOrdinaryMoveResult {
  const v = view(input),
    next = v.getUint32(0x7c, true);
  if (!next || input.timeMs < next) return complete();
  const unavailable = directionProvider(input);
  if (unavailable) return unavailable;
  if (!input.providers.nextCrtInteger)
    return missing("source-shared-native-CRT-provider");
  if (!input.providers.rescanProximity)
    return missing("source-RescanPedProximity-provider");
  const movement = input.movement;
  v.setUint32(
    0x7c,
    movement.maxTurnIntervalMs
      ? (input.timeMs +
          integer(
            input,
            movement.minTurnIntervalMs,
            movement.maxTurnIntervalMs,
          )) >>>
          0
      : 0,
    true,
  );
  const positive = chance(input, 50),
    angle =
      (positive ? 1 : -1) * integer(input, 0x71c, movement.maxRandomAngle);
  const radians = (angle & 0xffff) * 9.587379924285257e-5,
    cosine = f(Math.cos(radians)),
    sine = f(Math.sin(radians));
  const oldDirection = vector(input.character.direction),
    snapshot = input.process.storage.slice();
  const candidate: PedVector = [
    f(oldDirection[0] * cosine + oldDirection[2] * sine),
    0,
    f(oldDirection[2] * cosine - oldDirection[0] * sine),
  ];
  const turned = setNativePedXZDirection(input, candidate, 1);
  if (turned.status !== "complete") return turned;
  const scanned = input.providers.rescanProximity(candidate);
  if (scanned.status !== "complete") return scanned;
  if (v.getUint8(0x18)) {
    input.process.storage.set(snapshot);
    return setNativePedXZDirection(input, oldDirection, 0);
  }
  return complete();
}

/** Installed4d451c..4d492b, including whole-record opposite-candidate restore. */
export function avoidNativeOrdinaryPed(
  input: NativePedOrdinaryMoveInput,
): NativePedOrdinaryMoveResult {
  const v = view(input);
  if (!v.getUint8(0x18)) return complete();
  const root = vector(input.character.rootPosition),
    position = read(v, 0x3c);
  const dx = f(root[0] - position[0]),
    dy = root[1] - position[1],
    dz = f(root[2] - position[2]);
  const squared = f(dx * dx + dy * dy + dz * dz);
  const reset = () => write(v, 0xc, [0, 0, 0]);
  if (!(squared < input.avoidDistanceSquared)) {
    reset();
    return complete();
  }
  const unavailable = directionProvider(input);
  if (unavailable) return unavailable;
  if (!input.providers.nextCrtInteger)
    return missing("source-shared-native-CRT-provider");
  if (!input.providers.rescanProximity)
    return missing("source-RescanPedProximity-provider");
  const distance =
    squared > input.reachSquared
      ? Math.min(
          0.5,
          f(
            (f(Math.sqrt(squared)) - f(Math.sqrt(input.reachSquared))) *
              (f(0.7) + ((1 - f(0.7)) * sample(input)) / 32768),
          ),
        )
      : 0;
  const flags = v.getUint8(0x18);
  if (
    flags === 1 &&
    (input.suicidal ||
      input.blind ||
      (distance === 0 && input.action === 1 && chance(input, 100)))
  ) {
    v.setUint8(0x18, 0);
    return complete();
  }
  if (input.suicidal && flags & 4) return complete();
  if (flags === 4) {
    if (input.timeMs < v.getUint32(0x90, true)) return complete();
    v.setUint32(0x90, (input.timeMs + integer(input, 200, 500)) >>> 0, true);
  }
  const normal = read(v, 0xa4),
    current = vector(input.character.direction),
    velocity = read(v, 0x30);
  let transverse: PedVector = [0, 0, 0],
    candidate: PedVector;
  if (squared === 0) candidate = normal;
  else {
    transverse =
      Math.abs(dot(normal, current)) > 0.985
        ? [0, chance(input, 50) ? -1 : 1, 0]
        : nativePedSafeCross(normal, current);
    candidate = nativePedSafeCross(transverse, normal);
    if (velocity.some((n) => n !== 0) && dot(velocity, candidate) < 0) {
      transverse = negate(transverse);
      candidate = nativePedSafeCross(transverse, normal);
    }
  }
  let result = setNativePedXZDirection(input, candidate, distance);
  if (result.status !== "complete") return result;
  const savedNormal = read(v, 0xa4),
    first = input.providers.rescanProximity(candidate);
  if (first.status !== "complete") return first;
  if (v.getUint8(0x18) && squared !== 0) {
    const other = nativePedSafeCross(negate(transverse), savedNormal);
    result = setNativePedXZDirection(input, other, distance);
    if (result.status !== "complete") return result;
    const snapshot = input.process.storage.slice(),
      second = input.providers.rescanProximity(other);
    if (second.status !== "complete") return second;
    if (second.distance <= first.distance) {
      input.process.storage.set(snapshot);
      result = setNativePedXZDirection(input, candidate, distance);
      reset();
    }
  }
  return result;
}

/** Call after supported grounding/initial rescan, before character animation.
 * Full object scanning remains a real provider, including pointer-based reseed. */
export function advanceNativeOrdinaryPedSteering(
  input: NativePedOrdinaryMoveInput,
): NativePedOrdinaryMoveResult {
  const v = view(input);
  if (!input.providers.scanForObjects)
    return missing("source-PedScanForObjects-pointer-CRT-provider");
  if (!input.providers.rescanProximity)
    return missing("source-RescanPedProximity-provider");
  let result: NativePedOrdinaryMoveResult;
  if (v.getUint32(0x6c, true)) {
    result = smoothTurnNativeOrdinaryPed(input);
    if (result.status !== "complete") return result;
    result = input.providers.rescanProximity(null);
  } else result = wanderNativeOrdinaryPed(input);
  if (result.status !== "complete") return result;
  result = input.providers.scanForObjects();
  if (result.status !== "complete") return result;
  return avoidNativeOrdinaryPed(input);
}
