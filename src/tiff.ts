import UTIF from "utif";
/** Validate TIFF dimensions, tables and referenced buffers before library decoding.
 * The original game's TIFFRGB libraries contain baseline RGB/palette, LZW and
 * uncompressed strips; UTIF handles the compression and horizontal predictor. */
export function parseTiff(bytes: Uint8Array) {
  if (bytes.length < 8 || bytes.length > 32 * 1024 * 1024)
    throw new Error("TIFF: invalid file size");
  const little = bytes[0] === 73 && bytes[1] === 73;
  if (!little && !(bytes[0] === 77 && bytes[1] === 77))
    throw new Error("TIFF: invalid byte order");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const need = (at: number, n: number) => {
    if (!Number.isSafeInteger(at) || at < 0 || n < 0 || at + n > bytes.length)
      throw new Error("TIFF: offset outside file");
  };
  const u16 = (at: number) => {
      need(at, 2);
      return view.getUint16(at, little);
    },
    u32 = (at: number) => {
      need(at, 4);
      return view.getUint32(at, little);
    };
  if (u16(2) !== 42) throw new Error("TIFF: unsupported signature");
  const sizes = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
  const seen = new Set<number>();
  let width = 0,
    height = 0;
  const validate = (offset: number) => {
    if (!offset) return;
    if (seen.has(offset) || seen.size > 16)
      throw new Error("TIFF: cyclic or excessive image directories");
    seen.add(offset);
    const count = u16(offset);
    if (count > 512) throw new Error("TIFF: excessive tag count");
    need(offset + 2, count * 12 + 4);
    for (let i = 0; i < count; i++) {
      const at = offset + 2 + i * 12,
        tag = u16(at),
        type = u16(at + 2),
        n = u32(at + 4),
        size = sizes[type];
      if (!size || n > 1024 * 1024)
        throw new Error("TIFF: unsupported or excessive field");
      const pointer = n * size <= 4 ? at + 8 : u32(at + 8);
      need(pointer, n * size);
      const val = type === 3 ? u16(pointer) : u32(pointer);
      if (tag === 256) width = val;
      if (tag === 257) height = val;
      if ([330, 34665, 34853, 40965].includes(tag)) {
        for (let j = 0; j < n; j++) validate(u32(pointer + j * 4));
      }
    }
    validate(u32(offset + 2 + count * 12));
  };
  validate(u32(4));
  if (width < 1 || height < 1 || width > 4096 || height > 4096)
    throw new Error("TIFF: unsupported image dimensions");
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  const image = UTIF.decode(buffer)[0];
  if (!image) throw new Error("TIFF: no image");
  UTIF.decodeImage(buffer, image);
  const rgba = UTIF.toRGBA8(image);
  if (rgba.length !== width * height * 4)
    throw new Error("TIFF: decoded size mismatch");
  for (let i = 0; i < rgba.length; i += 4)
    if (rgba[i] === 0 && rgba[i + 1] === 0 && rgba[i + 2] === 0)
      rgba[i + 3] = 0;
  return { width, height, rgba };
}
