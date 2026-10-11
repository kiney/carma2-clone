import { Vector3 } from "three";

const HEAD_ON_EPSILON = 2 ** -22;
const HEAD_ON_COSINE = Math.fround(Math.cos(0.5235668420791626));

export interface NativeVisibilityQuery {
  nowMs: number;
  /** Source opponent+18 value, already stored as Float32. */
  playerDistance: number;
  playerPosition: Vector3;
  rivalPosition: Vector3;
}

export interface NativeVisibilitySnapshot {
  nextCheckMs: number;
  inView: boolean;
  acknowledged: boolean;
}

export type NativeVisibilityRay = (from: Vector3, direction: Vector3) => number;

function u32(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
    throw new Error(`Invalid native visibility ${label}`);
  return value;
}

function stored(value: number, label: string): number {
  if (!Number.isFinite(value))
    throw new Error(`Invalid native visibility ${label}`);
  const result = Math.fround(value);
  if (!Number.isFinite(result))
    throw new Error(`Native visibility ${label} exceeds Float32 bounds`);
  return result;
}

function storedVector(value: Vector3, label: string): Vector3 {
  if (!(value instanceof Vector3))
    throw new Error(`Invalid native visibility ${label}`);
  return new Vector3(
    stored(value.x, label),
    stored(value.y, label),
    stored(value.z, label),
  );
}

/** Installed regular-opponent visibility4ad880 timer, range gate and ray.
 * Acknowledgment is outer-owned; synchronize it after the caller handles a
 * visibility transition. */
export class NativeVisibilityState {
  private data: NativeVisibilitySnapshot = {
    nextCheckMs: 0,
    inView: false,
    acknowledged: false,
  };

  get snapshot(): NativeVisibilitySnapshot {
    return { ...this.data };
  }

  synchronize(
    snapshot: Pick<NativeVisibilitySnapshot, "inView" | "acknowledged">,
  ): void {
    if (
      typeof snapshot.inView !== "boolean" ||
      typeof snapshot.acknowledged !== "boolean"
    )
      throw new Error("Invalid native visibility synchronization snapshot");
    this.data.inView = snapshot.inView;
    this.data.acknowledged = snapshot.acknowledged;
  }

  run(
    query: NativeVisibilityQuery,
    ray: NativeVisibilityRay,
    random = Math.random,
  ): NativeVisibilitySnapshot {
    const now = u32(query.nowMs, "timestamp");
    if (now <= this.data.nextCheckMs) return this.snapshot;
    const playerDistance = stored(query.playerDistance, "player distance");
    if (playerDistance < 0)
      throw new Error("Invalid native visibility player distance");
    const player = storedVector(query.playerPosition, "player position");
    const rival = storedVector(query.rivalPosition, "rival position");

    this.data.inView = false;
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
      throw new Error("Native visibility random sample must be in [0, 1)");
    const delay = Math.floor((Math.floor(sample * 32768) * 901) / 32768);
    this.data.nextCheckMs = (now + delay + 4000) >>> 0;

    if (!(playerDistance < 50)) return this.snapshot;

    const from = new Vector3(
      player.x,
      stored(player.y + stored(0.15, "ray elevation"), "ray origin height"),
      player.z,
    );
    const direction = new Vector3(
      stored(rival.x - player.x, "ray direction"),
      stored(
        rival.y - player.y + stored(0.15, "ray elevation"),
        "ray direction",
      ),
      stored(rival.z - player.z, "ray direction"),
    );
    const fraction = stored(ray(from, direction), "ray fraction");
    if (fraction > 1) {
      this.data.inView = true;
      this.data.acknowledged = false;
    }
    return this.snapshot;
  }
}

export interface NativeHeadOnQuery {
  playerPosition: Vector3;
  rivalPosition: Vector3;
  playerDirection: Vector3;
  rivalDirection: Vector3;
}

/** Installed head-on classifier 0x4ad338–0x4ad423 used by selector 0x4acc10.
 * Source vector fields are Float32 stores; direction subtraction and length
 * normalization and dot products remain live through their comparisons. */
export function nativeHeadOnChance(query: NativeHeadOnQuery): boolean {
  const player = storedVector(query.playerPosition, "player position");
  const rival = storedVector(query.rivalPosition, "rival position");
  const playerDirection = storedVector(
    query.playerDirection,
    "player direction",
  );
  const rivalDirection = storedVector(query.rivalDirection, "rival direction");

  const dx = player.x - rival.x;
  const dy = player.y - rival.y;
  const dz = player.z - rival.z;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  let nx: number, ny: number, nz: number;
  if (length > HEAD_ON_EPSILON) {
    const inverse = 1 / length;
    nx = dx * inverse;
    ny = dy * inverse;
    nz = dz * inverse;
  } else {
    nx = 1;
    ny = 0;
    nz = 0;
  }

  const rivalDot =
    stored(rivalDirection.y, "rival direction") * ny +
    stored(rivalDirection.x, "rival direction") * nx +
    stored(rivalDirection.z, "rival direction") * nz;
  if (!(rivalDot > HEAD_ON_COSINE)) return false;
  const playerDot =
    stored(playerDirection.x, "player direction") * nx +
    stored(playerDirection.y, "player direction") * ny +
    stored(playerDirection.z, "player direction") * nz;
  return playerDot < -HEAD_ON_COSINE;
}
