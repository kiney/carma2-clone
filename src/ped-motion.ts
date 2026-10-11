export interface PedMotion {
  bones: Array<{ name: string; children: number[] }>;
  frameCount: number;
  /** Frame-major, then bone-major, twelve little-endian floats per matrix. */
  matrices: Float32Array;
}
/** BON and SKL share the 3DS exporter layout; they store motion, not meshes.
 * Bounds-checked original motion data; native root and bone playback consume
 * these matrices through their separate remap/pose providers. */
export function parsePedMotion(bytes: Uint8Array): PedMotion {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const need = (n: number) => {
    if (!Number.isSafeInteger(n) || n < 0 || at + n > bytes.length)
      throw new Error("Truncated BON/SKL motion");
  };
  const u32 = () => {
    need(4);
    const n = view.getUint32(at, true);
    at += 4;
    return n;
  };
  const count = u32(),
    frameCount = u32();
  if (!count || count > 256 || !frameCount || frameCount > 20_000)
    throw new Error("Invalid BON/SKL counts");
  const bones: PedMotion["bones"] = [];
  for (let i = 0; i < count; i++) {
    need(33);
    const end = bytes.subarray(at, at + 33).indexOf(0);
    const name = String.fromCharCode(
      ...bytes.subarray(at, at + (end < 0 ? 33 : end)),
    );
    at += 33;
    const childCount = u32();
    if (childCount > 256) throw new Error("Invalid BON/SKL child count");
    need(childCount * 4);
    const children = Array.from({ length: childCount }, u32);
    // Exported child IDs are one based; 10000 marks a terminal reference.
    if (children.some((c) => c !== 10000 && (c < 1 || c > count)))
      throw new Error("Invalid BON/SKL child reference");
    bones.push({ name, children });
  }
  const length = count * frameCount * 12;
  need(length * 4);
  const matrices = new Float32Array(length);
  for (let i = 0; i < length; i++, at += 4) {
    matrices[i] = view.getFloat32(at, true);
    if (!Number.isFinite(matrices[i]))
      throw new Error("Invalid BON/SKL matrix");
  }
  if (at !== bytes.length) throw new Error("Unexpected trailing BON/SKL data");
  return { bones, frameCount, matrices };
}
