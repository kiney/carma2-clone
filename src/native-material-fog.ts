/** Independent installed HW445050 FogAccordingToGPSCDE state update. This
 * returns a descriptor; the host retains the actual registered MAT identity. */
export const NATIVE_MATERIAL_FOG_LOCAL = 0x80000;
export const NATIVE_MATERIAL_FOG_UPDATE_ALL = 0x7fff;

export interface NativeMaterialFogState {
  flags: number;
  fogMin: number;
  fogMax: number;
  fogColor: number;
}
export interface NativeMaterialDepthEffect {
  /** Installed enum: -1 none, 0 darkness, 1 fog, 2 colour. */
  type: number;
  start: number;
  end: number;
  red: number;
  green: number;
  blue: number;
  /** Actual F32 gCamera_yon, not multiplied camera clipping distance. */
  baseYon: number;
}
function signed(value: number, field: string): void {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff)
    throw new Error(`Invalid native material fog int32 ${field}`);
}
function unsigned(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
    throw new Error(`Invalid native material fog uint32 ${field}`);
}
function stored(value: number, field: string): void {
  // Native retained state can contain infinity/NaN after arithmetic overflow.
  if (typeof value !== "number" || !Object.is(Math.fround(value), value))
    throw new Error(`Invalid native material fog stored F32 ${field}`);
}
/** HW4451a8..b0 uses integer shifts/OR without masking RGB to bytes. */
export function nativeMaterialFogColor(
  red: number,
  green: number,
  blue: number,
): number {
  signed(red, "red");
  signed(green, "green");
  signed(blue, "blue");
  return ((((red << 8) | green) << 8) | blue) >>> 0;
}

export function applyNativeMaterialFog<T extends NativeMaterialFogState>(
  material: T,
  depth: NativeMaterialDepthEffect,
): T & { updateMask: typeof NATIVE_MATERIAL_FOG_UPDATE_ALL } {
  unsigned(material.flags, "flags");
  unsigned(material.fogColor, "fogColor");
  stored(material.fogMin, "fogMin");
  stored(material.fogMax, "fogMax");
  stored(depth.baseYon, "baseYon");
  for (const field of ["type", "start", "end", "red", "green", "blue"] as const)
    signed(depth[field], field);
  const result: T & { updateMask: typeof NATIVE_MATERIAL_FOG_UPDATE_ALL } = {
    ...material,
    updateMask: NATIVE_MATERIAL_FOG_UPDATE_ALL,
  };
  if (depth.type === -1) {
    result.flags = (material.flags & ~NATIVE_MATERIAL_FOG_LOCAL) >>> 0;
  } else if (depth.type >= 0 && depth.type <= 2) {
    // CRT575fb0 takes the stack's earlier-loaded10 as BASE. Private original
    // captures disprove rec2's reversed pow arguments. NEG wraps as int32;
    // exponent multiplication uses double0.1 (588cb0), with no F32 store.
    const negativeStart = -depth.start | 0;
    result.fogMin = Math.fround(
      Math.pow(10, negativeStart * 0.1) * depth.baseYon,
    );
    result.fogMax = Math.fround(Math.pow(10, depth.end * 0.1) * depth.baseYon);
    result.fogColor =
      depth.type === 0
        ? 0
        : depth.type === 1
          ? 0xf8f8f8
          : nativeMaterialFogColor(depth.red, depth.green, depth.blue);
    result.flags = (material.flags | NATIVE_MATERIAL_FOG_LOCAL) >>> 0;
  }
  // None/unsupported types retain historical fog fields, even nonfinite ones.
  // MaterialUpdateALL follows every branch, including an unsupported enum.
  return result;
}
