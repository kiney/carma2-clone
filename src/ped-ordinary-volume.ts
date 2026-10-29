/** Ordinary Munge/moved volume continuations. See c2-ped-ordinary-volume-re.md.
 * These phases consume the actual selected physical volume; force integration,
 * volume selection, gameplay move selection and death retain their owners. */
import type { NativePedBody } from "./physics/ped-body";
import type { PedVector } from "./ped-form";

const f = Math.fround;
type OutletResult = void | readonly string[];
export type OrdinaryPedVolumeBody = Pick<
  NativePedBody,
  "state" | "specialVolume"
>;
export interface OrdinaryPedVolumeInput {
  body: OrdinaryPedVolumeBody;
  processStorage: Uint8Array | null;
  hitPoints: number;
  moveId: number;
  timeMs: number;
  replay: boolean;
  physicsActive: boolean;
  globalGravity: number;
}
export interface OrdinaryPedVolumeHost {
  setMove?: (request: {
    id: 110 | 94;
    speed: -1;
    completion: false;
    action: 5;
    timeMs: number;
  }) => OutletResult;
  /** Full native KillPedestrian, including count/score/gore; no extra damage. */
  kill?: () => OutletResult;
  /** Actual smoke/napalm resource owner; zero is not a substitute for release. */
  clearBurning?: (signedProcess98: number) => OutletResult;
  stopSmoothTurn?: () => OutletResult;
  activate?: () => OutletResult;
  nextCrtInteger?: () => number;
}
export interface OrdinaryPedVolumeResult {
  status: "complete" | "provider-required";
  requiredProviders: string[];
  randomDraws: number;
}
function result(
  missing: readonly string[] = [],
  randomDraws = 0,
): OrdinaryPedVolumeResult {
  const requiredProviders = [...new Set(missing)];
  return {
    status: requiredProviders.length ? "provider-required" : "complete",
    requiredProviders,
    randomDraws,
  };
}
function scalar(value: number): number {
  const n = f(value);
  if (!Number.isFinite(n))
    throw new Error("Invalid ordinary pedestrian volume scalar");
  return n;
}
function sample(nextCrtInteger: () => number): number {
  const n = nextCrtInteger();
  if (!Number.isInteger(n) || n < 0 || n > 32767)
    throw new Error("Ordinary pedestrian volume requires CRT integer0..32767");
  return n;
}
function processView(storage: Uint8Array | null): DataView | null {
  if (!storage) return null;
  if (storage.length !== 0x12c)
    throw new Error(
      "Ordinary pedestrian volume requires the actual12ch process record",
    );
  return new DataView(storage.buffer, storage.byteOffset, storage.byteLength);
}
function validate(input: OrdinaryPedVolumeInput): void {
  if (
    !Number.isInteger(input.timeMs) ||
    input.timeMs < 0 ||
    input.timeMs > 0xffffffff
  )
    throw new Error("Invalid ordinary pedestrian volume time");
  if (
    !Number.isInteger(input.hitPoints) ||
    input.hitPoints < -128 ||
    input.hitPoints > 127
  )
    throw new Error("Invalid ordinary pedestrian signed HP");
}
function lowGravity(body: OrdinaryPedVolumeBody): boolean {
  const volume = body.specialVolume?.volume;
  return !!volume && scalar(volume.gravityMultiplier) < 1;
}

/**4d3a9d..4d3bfc: before ordinary support/steering, outside replay. */
export function processOrdinaryPedVolume(
  input: OrdinaryPedVolumeInput,
  host: OrdinaryPedVolumeHost,
): OrdinaryPedVolumeResult {
  validate(input);
  if (input.replay) return result();
  const process = processView(input.processStorage);
  if (!process) return result(["source-ped-volume-process-owner"]);
  if (!lowGravity(input.body)) {
    process.setUint32(0x94, 0, true);
    return result();
  }
  const burning = process.getInt32(0x98, true),
    started = process.getUint32(0x94, true) || input.timeMs,
    id = input.hitPoints > 0 ? 110 : 94,
    expired = input.hitPoints > 0 && (input.timeMs - started) >>> 0 > 30000,
    missing = [
      ...(burning !== 0 && !host.clearBurning
        ? ["source-ped-volume-burning-resource-owner"]
        : []),
      ...(input.moveId !== id && !host.setMove
        ? ["source-ped-volume-move-owner"]
        : []),
      ...(expired && !host.kill ? ["source-ped-volume-kill-owner"] : []),
    ];
  if (missing.length) return result(missing);
  if (burning !== 0) {
    const required = host.clearBurning!(burning);
    if (required?.length) return result(required);
    process.setInt32(0x98, 0, true);
  }
  process.setUint32(0x94, started, true);
  if (input.moveId !== id) {
    const required = host.setMove!({
      id,
      speed: -1,
      completion: false,
      action: 5,
      timeMs: input.timeMs,
    });
    if (required?.length) return result(required);
  }
  //4d3bca unsigned JBE: equality is still alive, and DWORD wrap is retained.
  return result(expired ? (host.kill!() ?? []) : []);
}

/**4d4a5b..4d4b1f: each scale expression observes earlier component writes.
 * Keep x87 live products and explicit Float32 spills rather than replacing
 * this with one normalize()/multiplyScalar(2). NULL denotes the native0/0 case. */
export function ordinaryPedInitialVolumeOmega(
  raw: PedVector,
): PedVector | null {
  const [a, b, c] = raw.map(scalar),
    cSquared = f(c * c),
    firstLength = Math.sqrt(a * a + b * b + cSquared);
  if (firstLength === 0) return null;
  const xLive = (2 / firstLength) * a,
    x = f(xLive),
    secondLength = Math.sqrt(xLive * x + b * b + cSquared),
    yLive = (2 / secondLength) * b,
    y = f(yLive),
    thirdLength = Math.sqrt(x * x + yLive * y + cSquared),
    z = f((2 / thirdLength) * c);
  return [x, y, z];
}

/**4d492b..4d4b1f: after support/steering and before BON, including dead HP.
 * The source global gravity and exact depth gates differ from moved's gates. */
export function activateImmersedOrdinaryPed(
  input: OrdinaryPedVolumeInput,
  host: OrdinaryPedVolumeHost,
): OrdinaryPedVolumeResult {
  validate(input);
  if (
    input.replay ||
    input.physicsActive ||
    !lowGravity(input.body) ||
    scalar(input.globalGravity) !== 1 ||
    scalar(input.body.specialVolume!.depth) !== 1
  )
    return result();
  const process = processView(input.processStorage),
    missing = [
      ...(!process ? ["source-ped-volume-process-owner"] : []),
      ...(!host.stopSmoothTurn
        ? ["source-ped-volume-stop-smooth-turn-owner"]
        : []),
      ...(!host.activate ? ["source-ped-volume-activation-owner"] : []),
      ...(!host.nextCrtInteger ? ["source-ped-volume-CRT-owner"] : []),
    ];
  if (missing.length) return result(missing);
  let required = host.stopSmoothTurn!();
  if (required?.length) return result(required);
  process!.setUint32(0x6c, 0, true);
  required = host.activate!();
  if (required?.length) return result(required);
  const raw: PedVector = [
      f(-1 + (2 * sample(host.nextCrtInteger!)) / 32768),
      f(-1 + (2 * sample(host.nextCrtInteger!)) / 32768),
      f(-1 + (2 * sample(host.nextCrtInteger!)) / 32768),
    ],
    omega = ordinaryPedInitialVolumeOmega(raw);
  // Explicit finite stability deviation for the native all-zero0/0 draw.
  input.body.state.angularVelocity
    .set(...(omega ?? [0, 0, 0]))
    .applyQuaternion(input.body.state.orientation);
  return result(
    omega ? [] : ["native-immersed-ped-omega-singularity-suppressed"],
    3,
  );
}

/**4d28ca..4d29a7: after source settling and moved animation-period draw.
 * Object+74 omega is BODY space; Object+68 V is world space. No dt applies. */
export function moveOrdinaryPedInVolume(
  body: OrdinaryPedVolumeBody,
  hitPoints: number,
  nextCrtInteger: () => number,
): OrdinaryPedVolumeResult {
  if (!Number.isInteger(hitPoints) || hitPoints < -128 || hitPoints > 127)
    throw new Error("Invalid ordinary pedestrian signed HP");
  if (hitPoints <= 0 || !lowGravity(body)) return result();
  let draws = 0;
  const local = body.state.angularVelocity
    .clone()
    .applyQuaternion(body.state.orientation.clone().invert());
  const [x, y, z] = local.toArray().map(scalar);
  if (Math.sqrt(x * x + y * y + z * z) < 1) {
    local.set(
      f(x + (-5 + (10 * sample(nextCrtInteger)) / 32768)),
      f(y + (-5 + (10 * sample(nextCrtInteger)) / 32768)),
      f(z + (-5 + (10 * sample(nextCrtInteger)) / 32768)),
    );
    draws += 3;
    body.state.angularVelocity
      .copy(local)
      .applyQuaternion(body.state.orientation);
  }
  if (
    scalar(body.specialVolume!.depth) < 1 &&
    scalar(body.state.velocity.y) > -0.02
  ) {
    body.state.velocity.y = f(
      scalar(body.state.velocity.y) +
        (f(-0.3) * sample(nextCrtInteger)) / 32768,
    );
    draws++;
  }
  return result([], draws);
}
