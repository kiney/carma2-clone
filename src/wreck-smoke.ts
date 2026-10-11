import { sharedNativeRandom } from "./native-random";

export interface WreckColumnPacket {
  mode: 1;
  colour: 0;
  /** Native first prepared-group index, not an original DAT vertex number. */
  vertex: number;
  lifetimeMs: 20000 | 180000;
}

/** Installed CheckDamage43f7b5–43f80f and CreateSmokeColumn4fb620.
 * Invoke once at the ordinary newly-wasted barrier. Network/replay callers
 * are excluded by CheckDamage, independently of the column creator. */
export function createNativeWreckColumns(input: {
  networkMode: number;
  knackered: boolean;
  volumeGravity?: number;
  random?: () => number;
  shortenExisting: (maximumMs: number) => void;
  spawn: (packet: WreckColumnPacket) => void;
}) {
  if (!Number.isInteger(input.networkMode) || input.networkMode < 0)
    throw new Error("Invalid wreck smoke network mode");
  if (
    input.volumeGravity !== undefined &&
    !Number.isFinite(Math.fround(input.volumeGravity))
  )
    throw new Error("Invalid wreck smoke volume gravity");
  if (input.networkMode !== 0) return;
  const random = input.random ?? sharedNativeRandom.random;
  const integer = (maximum: number) => {
    const value = random();
    if (!(value >= 0 && value < 1))
      throw new Error("Invalid wreck smoke random sample");
    return Math.floor(value * (maximum + 1));
  };
  const wet =
    input.volumeGravity !== undefined && Math.fround(input.volumeGravity) < 1;
  const spawn = (lifetimeMs: WreckColumnPacket["lifetimeMs"]) => {
    const vertex = integer(11); // Caller draw happens even when wet rejects.
    if (wet) return;
    // SmudgeCar4fc750 is RET in this HW binary. Its knackered branch still
    // consumes a second fire-vertex selection before calling that no-op.
    if (input.knackered) integer(11);
    input.spawn({ mode: 1, colour: 0, vertex, lifetimeMs });
  };
  if (integer(1) !== 0) {
    input.shortenExisting(2000);
    spawn(20000);
  }
  spawn(180000);
}
