/** Installed PedScanForObjects4ced30..4cf7bf. Canonical record writes and
 * ordered callbacks; native addresses belong to the host's actual allocation. */
import type { PedVector } from "./ped-form";

export const NATIVE_ORDINARY_PED_RECORD_BYTES = 0x54;
export const NATIVE_ORDINARY_PED_PROCESS_BYTES = 0x12c;
export interface NativeOrdinaryPedScanObject<Body extends object> {
  body: Body;
  /** Current Object actor+50, not an extrapolated COM or radius center. */
  actorPosition: PedVector;
  velocity: PedVector;
  radiusSquared: number;
  typeByte: number;
  owner: object | null;
  /** Required for owned type1 electric rays; unknown is not a driver guess. */
  driver?: number;
  electricRangeSquared?: number;
}
export interface NativeOrdinaryPedScanMove {
  id: number;
  speed: number;
  completion: boolean;
  action: number;
  timeMs: number;
}
export interface NativeOrdinaryPedScanHead {
  address: 0x65d048 | 0x65d050 | 0x65d054;
  timeMs: number;
}
type OutletResult = void | readonly string[];
export interface NativeOrdinaryPedObjectScanInput<Body extends object> {
  /** Exact address of this live0x54 array record, never an actor ID or index. */
  pedAddress: number;
  pedStorage: Uint8Array;
  /** Actual current bounded process record; NULL returns before seeding CRT. */
  processStorage: Uint8Array | null;
  timeMs: number;
  characterVelocity: PedVector;
  removedBoneMask: number;
  /** Actual movement-spec integer period bounds at+08/+0c. */
  walkPeriodBounds?: readonly [number, number];
  /** Actual PHIL head/next order. No renderer/cars/noncars concatenation. */
  objects: readonly NativeOrdinaryPedScanObject<Body>[];
  playerObject: NativeOrdinaryPedScanObject<Body> | null;
  globals: {
    immortal: boolean;
    suicidal: boolean;
    blind: boolean;
    valiumTimeMs: number;
    /** Installed75a41c bit08000000; independently overrides player targeting. */
    playerThreatOverride: boolean;
  };
  crt: { seed(seed: number): void; nextInteger(): number };
  setDirection?: (
    direction: PedVector,
    distance: number,
    timeMs: number,
  ) => OutletResult;
  rescanProximity?: () => OutletResult;
  setMove?: (request: NativeOrdinaryPedScanMove) => OutletResult;
  /** Called after source sequence pointer/time/index stores; actual MODEL/AR owner. */
  startHead?: (request: NativeOrdinaryPedScanHead) => OutletResult;
  noise?: (index: 6 | 8 | 10, force: boolean) => OutletResult;
  /** Actual4cde00 effect continuation, including culprit/HP/ray ownership. */
  electric?: (
    object: NativeOrdinaryPedScanObject<Body>,
    distanceSquared: number,
    timeMs: number,
  ) => OutletResult;
}
export interface NativeOrdinaryPedObjectScanResult<Body extends object> {
  status: "complete" | "provider-required";
  requiredProviders: string[];
  selected: NativeOrdinaryPedScanObject<Body> | null;
  distanceSquared: number | null;
  electric: boolean;
}
const f = Math.fround;
const initialMoves = [2, 2, 2, 2, 2, 2, 3, 4];
const repeatedMoves = [2, 2, 2, 10, 11, 13, -41, -41, -41];
const maximumFloat = f(3.4028234663852886e38);
function uint(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
    throw new Error(`Native pedestrian scan requires uint32 ${name}`);
}
function vector(v: PedVector): void {
  if (v.length !== 3 || v.some((n) => !Number.isFinite(f(n))))
    throw new Error("Native pedestrian scan requires finite source vectors");
}

export function scanNativeOrdinaryPedObjects<Body extends object>(
  input: NativeOrdinaryPedObjectScanInput<Body>,
): NativeOrdinaryPedObjectScanResult<Body> {
  uint(input.pedAddress, "record address");
  uint(input.timeMs, "clock");
  uint(input.removedBoneMask, "removed mask");
  if (
    !input.pedAddress ||
    input.pedAddress % 4 ||
    input.pedStorage.length !== NATIVE_ORDINARY_PED_RECORD_BYTES
  )
    throw new Error(
      "Native pedestrian scan requires actual aligned0x54 record storage",
    );
  const result: NativeOrdinaryPedObjectScanResult<Body> = {
    status: "complete",
    requiredProviders: [],
    selected: null,
    distanceSquared: null,
    electric: false,
  };
  if (!input.processStorage) return result;
  if (input.processStorage.length !== NATIVE_ORDINARY_PED_PROCESS_BYTES)
    throw new Error(
      "Native pedestrian scan requires actual0x12c process storage",
    );
  vector(input.characterVelocity);
  const ped = new DataView(
    input.pedStorage.buffer,
    input.pedStorage.byteOffset,
    input.pedStorage.byteLength,
  );
  const process = new DataView(
    input.processStorage.buffer,
    input.processStorage.byteOffset,
    input.processStorage.byteLength,
  );
  const position = [
    ped.getFloat32(0x1c, true),
    ped.getFloat32(0x20, true),
    ped.getFloat32(0x24, true),
  ] as const;
  vector(position);
  const call = (
    name: string,
    invoke: (() => OutletResult) | undefined,
  ): boolean => {
    const missing = invoke ? (invoke() ?? []) : [name];
    result.requiredProviders.push(...missing);
    if (missing.length) result.status = "provider-required";
    return missing.length === 0;
  };
  const draw = () => {
    const n = input.crt.nextInteger();
    if (!Number.isInteger(n) || n < 0 || n > 32767)
      throw new Error("Native pedestrian scan requires CRT rand0..32767");
    return n;
  };
  const integer = (low: number, high: number) =>
    low + Math.trunc(Math.imul(draw(), high + 1 - low) / 32768);
  const reseed = () => input.crt.seed((input.timeMs ^ input.pedAddress) >>> 0);
  const head = (address: NativeOrdinaryPedScanHead["address"]) => {
    if (ped.getInt8(4) <= 0) return true;
    process.setUint32(0x1c, address, true);
    process.setUint32(0x78, input.timeMs, true);
    process.setUint8(0x1a, 0);
    return call(
      "source-ped-scan-head-MODEL-owner",
      input.startHead &&
        (() => input.startHead!({ address, timeMs: input.timeMs })),
    );
  };
  const move = (
    id: number,
    speed: number,
    completion: boolean,
    action: number,
  ) =>
    call(
      "source-ped-scan-SetPedMove-owner",
      input.setMove &&
        (() =>
          input.setMove!({
            id,
            speed,
            completion,
            action,
            timeMs: input.timeMs,
          })),
    );
  const noise = (index: 6 | 8 | 10, force = false) =>
    call(
      "source-ped-scan-noise-owner",
      input.noise && (() => input.noise!(index, force)),
    );
  const direct = (direction: PedVector) =>
    call(
      "source-ped-scan-SetPedXZDirection-owner",
      input.setDirection &&
        (() => input.setDirection!(direction, 0, input.timeMs)),
    ) &&
    call("source-ped-scan-RescanPedProximity-owner", input.rescanProximity);
  const fallbackFear = () => {
    if ([1, 2, 4].includes(ped.getInt32(0x10, true))) return true;
    if (!move(initialMoves[integer(0, 7)], -1, true, 2)) return false;
    if (!noise(6)) return false;
    return head(0x65d048);
  };
  const calm = () => {
    if (
      ped.getInt8(4) <= 0 ||
      ped.getInt32(0x10, true) !== 1 ||
      process.getUint8(0x18) !== 0 ||
      (input.timeMs - ped.getUint32(0x28, true)) >>> 0 < 10000 ||
      input.removedBoneMask !== 0 ||
      process.getInt32(0x98, true) > 0
    )
      return;
    const bounds = input.walkPeriodBounds;
    if (!bounds) {
      call("source-ped-scan-calm-movement-period-bounds", undefined);
      return;
    }
    if (!bounds.every(Number.isInteger))
      throw new Error(
        "Native pedestrian scan requires authored integer walk periods",
      );
    if (move(30, integer(bounds[0], bounds[1]), true, 0)) head(0x65d054);
  };
  process.setUint8(0x18, process.getUint8(0x18) & ~4);
  input.crt.seed(input.pedAddress);
  const lookahead = f((f(0.8) + ((f(1.2) - f(0.8)) * draw()) / 32768) * 7);
  let selected: NativeOrdinaryPedScanObject<Body> | null = null;
  let q = maximumFloat;
  let selectedPosition: PedVector = position;
  const inBox = (candidate: NativeOrdinaryPedScanObject<Body>) => {
    vector(candidate.actorPosition);
    vector(candidate.velocity);
    return candidate.actorPosition.every(
      (n, axis) => Math.abs(f(n - position[axis])) < 5,
    );
  };
  if (
    input.globals.playerThreatOverride &&
    input.playerObject &&
    inBox(input.playerObject)
  ) {
    selected = input.playerObject;
    q = 0;
    selectedPosition = selected.actorPosition;
  } else {
    for (const candidate of input.objects) {
      if (candidate.owner && candidate.typeByte >= 2 && candidate.typeByte <= 5)
        continue;
      if (!inBox(candidate)) continue;
      const dx = f(candidate.actorPosition[0] - position[0]);
      const dy = f(candidate.actorPosition[1] - position[1]);
      const dz = f(candidate.actorPosition[2] - position[2]);
      let distance: number;
      const vx = f(candidate.velocity[0] - input.characterVelocity[0]);
      const vz = f(candidate.velocity[2] - input.characterVelocity[2]);
      if (input.globals.suicidal) distance = f(dx * dx + dy * dy + dz * dz);
      else if (vx === 0 && vz === 0) distance = f(dx * dx + dz * dz);
      else {
        const cross = vz * dx - vx * dz;
        distance = f((cross * cross) / (vx * vx + vz * vz));
      }
      if (
        !input.globals.immortal &&
        candidate.typeByte === 1 &&
        candidate.owner
      ) {
        if (candidate.driver === undefined) {
          call("source-ped-scan-electric-driver-owner", undefined);
          return result;
        }
        if (
          candidate.driver > 5 &&
          candidate.electricRangeSquared === undefined
        ) {
          call("source-ped-scan-electric-range-owner", undefined);
          return result;
        }
        if (
          candidate.driver > 5 &&
          distance < candidate.electricRangeSquared!
        ) {
          result.selected = candidate;
          result.distanceSquared = distance;
          result.electric = true;
          if (
            call(
              "source-ped-scan-electric-continuation",
              input.electric &&
                (() => input.electric!(candidate, distance, input.timeMs)),
            )
          )
            calm();
          return result;
        }
      }
      if (input.globals.suicidal) {
        if (distance < q) {
          selected = candidate;
          q = distance;
          selectedPosition = candidate.actorPosition;
        }
      } else if (distance < 2 * candidate.radiusSquared) {
        const closestTime = -(vx * dx + vz * dz) / (vx * vx + vz * vz);
        if (closestTime >= 0 && closestTime < lookahead) {
          selected = candidate;
          q = distance;
          selectedPosition = candidate.actorPosition;
          break;
        }
      }
    }
    reseed();
  }
  result.selected = selected;
  result.distanceSquared = selected ? q : null;
  if (
    !selected ||
    ((input.globals.blind || input.globals.valiumTimeMs !== 0) &&
      !input.globals.playerThreatOverride) ||
    ((process.getUint8(0x18) & 2) !== 0 &&
      !(q / process.getFloat32(0xbc, true) < 0.25))
  ) {
    calm();
    return result;
  }
  process.setUint8(0x18, process.getUint8(0x18) | 4);
  if (input.globals.suicidal) {
    direct(
      selectedPosition.map((n, i) => f(n - position[i])) as [
        number,
        number,
        number,
      ],
    );
    return result;
  }
  for (let axis = 0; axis < 3; axis++) {
    process.setFloat32(0x30 + 4 * axis, selected.velocity[axis], true);
    process.setFloat32(0x3c + 4 * axis, selectedPosition[axis], true);
  }
  const delta = position.map((n, i) => n - selectedPosition[i]);
  const length = Math.hypot(...delta);
  const away: PedVector =
    length > 2.384185791015625e-7
      ? (delta.map((n) => f(n / length)) as [number, number, number])
      : [1, 0, 0];
  // Source builds a rotation matrix with this draw but never applies it.
  integer(-0x2aa8, 0x2aa8);
  away.forEach((n, i) => process.setFloat32(0xa4 + i * 4, n, true));
  const speedSquared = selected.velocity.reduce((sum, n) => sum + n * n, 0);
  if (
    speedSquared <= 1 &&
    !(
      input.globals.playerThreatOverride &&
      input.playerObject?.body === selected.body
    )
  )
    return result;
  const toward = away.map((n) => f(-n)) as [number, number, number];
  if (ped.getInt32(0x10, true) === 0) {
    if (!direct(toward) || !fallbackFear()) return result;
    ped.setUint32(0x28, input.timeMs, true);
    ped.setUint32(0x2c, input.timeMs, true);
    return result;
  }
  if (
    (input.timeMs - ped.getUint32(0x2c, true)) >>> 0 >= 10000 &&
    process.getInt32(0x98, true) <= 0
  ) {
    if (!head(0x65d050)) return result;
    const requested = repeatedMoves[integer(0, 8)];
    const id = Math.abs(requested),
      action = requested < 0 ? 1 : 2;
    if (![13, 40, 41].includes(id) && !direct(toward)) return result;
    if (!move(id, -1, true, action)) return result;
    if (id === 2 && !noise(6)) return result;
    if ((id === 10 || id === 11) && !noise(8)) return result;
    if (id === 13 && !noise(10, true)) return result;
  }
  if (!fallbackFear()) return result;
  ped.setUint32(0x28, input.timeMs, true);
  return result;
}
