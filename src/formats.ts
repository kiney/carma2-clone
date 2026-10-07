/** Independently implemented readers for the public BRender/Carmageddon formats.
 * All offsets and counts are validated before allocating or reading. */
export interface DatFace {
  indices: [number, number, number];
  smoothing: number;
  flags: number;
  /** One based index into materials; zero means use the actor material. */
  material: number;
}
export interface DatModel {
  name: string;
  flags: number;
  positions: Float32Array;
  uvs: Float32Array;
  faces: DatFace[];
  materials: string[];
  warnings?: string[];
}
export interface ActNode {
  name: string;
  type: number;
  renderStyle: number;
  model?: string;
  material?: string;
  /** BRender 4 by 3 matrix: three basis rows, then a translation row. */
  transform: number[];
  children: ActNode[];
}
export interface MatMaterial {
  name: string;
  texture?: string;
  rgba: [number, number, number, number];
  ambient: number;
  diffuse: number;
  specular: number;
  power: number;
  flags: number;
  uvTransform: number[];
}
export interface PixMap {
  name: string;
  width: number;
  height: number;
  format: number;
  rgba: Uint8Array;
  palette?: Uint8Array;
}

class Reader {
  pos = 0;
  readonly view: DataView;
  constructor(
    readonly bytes: Uint8Array,
    readonly label: string,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get remaining() {
    return this.bytes.length - this.pos;
  }
  need(n: number) {
    if (!Number.isSafeInteger(n) || n < 0 || n > this.remaining) {
      throw new Error(
        `${this.label}: truncated or invalid data at byte ${this.pos}`,
      );
    }
  }
  u8() {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }
  u16() {
    this.need(2);
    const v = this.view.getUint16(this.pos);
    this.pos += 2;
    return v;
  }
  u32() {
    this.need(4);
    const v = this.view.getUint32(this.pos);
    this.pos += 4;
    return v;
  }
  f32(allowNonFinite = false) {
    this.need(4);
    const v = this.view.getFloat32(this.pos);
    this.pos += 4;
    if (!allowNonFinite && !Number.isFinite(v))
      throw new Error(`${this.label}: non-finite coordinate`);
    return v;
  }
  skip(n: number) {
    this.need(n);
    this.pos += n;
  }
  string() {
    const end = this.bytes.indexOf(0, this.pos);
    if (end < 0) throw new Error(`${this.label}: unterminated name`);
    const s = latin1(this.bytes.subarray(this.pos, end));
    this.pos = end + 1;
    return s;
  }
  floats(count: number) {
    this.need(count * 4);
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) out[i] = this.f32();
    return out;
  }
  sub(n: number) {
    this.need(n);
    const out = new Reader(
      this.bytes.subarray(this.pos, this.pos + n),
      this.label,
    );
    this.pos += n;
    return out;
  }
}

function latin1(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return result;
}
function binaryReader(
  bytes: Uint8Array,
  type: number,
  label: string,
  optionalHeader = false,
) {
  const r = new Reader(bytes, label);
  if (bytes.length >= 16 && r.view.getUint32(0) === 0x12) {
    if (
      r.u32() !== 0x12 ||
      r.u32() !== 8 ||
      r.u32() !== type ||
      r.u32() !== 2
    ) {
      throw new Error(`${label}: invalid BRender header`);
    }
  } else if (!optionalHeader)
    throw new Error(`${label}: missing BRender header`);
  return r;
}
function chunk(r: Reader): [number, Reader] {
  const tag = r.u32(),
    length = r.u32();
  return [tag, r.sub(length)];
}
const identity = () => [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

export function parseDat(bytes: Uint8Array): DatModel[] {
  const r = binaryReader(bytes, 0xface, "DAT");
  const out: DatModel[] = [];
  let model: DatModel | undefined;
  const current = () => {
    if (!model) throw new Error("DAT: model data precedes model declaration");
    return model;
  };
  const finish = () => {
    if (!model) return;
    const vertexCount = model.positions.length / 3;
    if (model.uvs.length && model.uvs.length / 2 !== vertexCount)
      throw new Error("DAT: vertex/UV counts differ");
    for (const face of model.faces) {
      if (face.indices.some((i) => i >= vertexCount))
        throw new Error("DAT: face vertex index exceeds model");
      if (face.material > model.materials.length)
        throw new Error("DAT: face material index exceeds table");
    }
    out.push(model);
    model = undefined;
  };
  while (r.remaining) {
    const [tag, c] = chunk(r);
    switch (tag) {
      case 0x36:
        if (model) throw new Error("DAT: missing end of model");
        model = {
          flags: c.u16(),
          name: c.string(),
          positions: new Float32Array(),
          uvs: new Float32Array(),
          faces: [],
          materials: [],
        };
        break;
      case 0x17:
        current().positions = c.floats(c.u32() * 3);
        break;
      case 0x18: {
        const m = current(),
          count = c.u32() * 2;
        c.need(count * 4);
        m.uvs = new Float32Array(count);
        let invalid = 0;
        for (let i = 0; i < count; i++) {
          const value = c.f32(true);
          m.uvs[i] = Number.isFinite(value) ? value : 0;
          if (!Number.isFinite(value)) invalid++;
        }
        // Retail forklift contains NaN U values in otherwise valid, referenced
        // fork models. UV fallback is confined here; XYZ/transforms remain strict.
        if (invalid)
          (m.warnings ??= []).push(
            `${m.name}: ${invalid} non-finite UV components replaced with zero`,
          );
        break;
      }
      case 0x35: {
        const m = current(),
          count = c.u32();
        c.need(count * 9);
        for (let i = 0; i < count; i++)
          m.faces.push({
            indices: [c.u16(), c.u16(), c.u16()],
            smoothing: c.u16(),
            flags: c.u8(),
            material: 0,
          });
        break;
      }
      case 0x16: {
        const m = current(),
          count = c.u32();
        c.need(count);
        for (let i = 0; i < count; i++) m.materials.push(c.string());
        break;
      }
      case 0x1a: {
        const m = current(),
          count = c.u32(),
          size = c.u32();
        if (size !== 2 || count > m.faces.length)
          throw new Error("DAT: invalid face material block");
        c.need(count * size);
        for (let i = 0; i < count; i++) m.faces[i].material = c.u16();
        break;
      }
      case 0:
        finish();
        break;
      // Optional pivot, precomputed bounds, and unknown extensions are isolated chunks.
    }
  }
  if (model) throw new Error("DAT: missing final end marker");
  return out;
}

export function parseAct(bytes: Uint8Array): ActNode[] {
  const r = binaryReader(bytes, 1, "ACT");
  const roots: ActNode[] = [],
    stack: ActNode[] = [];
  let pendingTransform: number[] | undefined;
  const current = () => {
    const node = stack.at(-1);
    if (!node) throw new Error("ACT: property precedes actor");
    return node;
  };
  while (r.remaining) {
    const tag = r.u32(),
      length = r.u32();
    // Some shipped legacy references (CPOINT.ACT) retain stale chunk lengths.
    // Names are NUL terminated in the bounded file reader, just as MAT refs.
    if (tag === 0x24 || tag === 0x26) {
      r.need(length);
      const name = r.string();
      if (tag === 0x24) current().model = name;
      else current().material = name;
      continue;
    }
    const c = r.sub(length);
    switch (tag) {
      case 0x23:
        stack.push({
          type: c.u8(),
          renderStyle: c.u8(),
          name: c.string(),
          transform: identity(),
          children: [],
        });
        break;
      case 0x24:
        current().model = c.string();
        break;
      case 0x26:
        current().material = c.string();
        break;
      case 0x2b:
      case 0x2c:
        pendingTransform = Array.from(c.floats(12));
        break;
      case 0x30:
        pendingTransform = identity();
        pendingTransform.splice(9, 3, ...Array.from(c.floats(3)));
        break;
      case 0x31:
        pendingTransform = identity();
        break;
      case 0x25:
        if (!pendingTransform)
          throw new Error("ACT: transform marker without transform");
        current().transform = pendingTransform;
        pendingTransform = undefined;
        break;
      case 0x2a: {
        if (stack.length < 2)
          throw new Error("ACT: child marker without parent");
        const child = stack.pop()!;
        current().children.push(child);
        break;
      }
      case 0:
        if (stack.length !== 1) throw new Error("ACT: unbalanced hierarchy");
        roots.push(stack.pop()!);
        break;
    }
  }
  if (stack.length || pendingTransform)
    throw new Error("ACT: incomplete hierarchy");
  return roots;
}

export function parseMat(bytes: Uint8Array): MatMaterial[] {
  const r = binaryReader(bytes, 5, "MAT");
  const out: MatMaterial[] = [];
  let material: MatMaterial | undefined;
  while (r.remaining) {
    // A few stock smear materials shortened references in place, retaining
    // zero padding before the following chunk. End markers always have length 0.
    while (
      r.remaining >= 8 &&
      r.view.getUint32(r.pos) === 0 &&
      r.view.getUint32(r.pos + 4) !== 0
    )
      r.skip(1);
    const tag = r.u32(),
      length = r.u32();
    const start = r.pos;
    // Shipped files include renamed legacy materials/references whose chunk
    // lengths were never updated. Even the standard C2 writer overstates 0x3c
    // by two bytes. Known fields and NUL names determine the next chunk.
    if (tag === 0x3c || tag === 4) {
      if (material) throw new Error("MAT: missing material end marker");
      r.need(tag === 0x3c ? 65 : 48);
      const rgba: [number, number, number, number] = [
        r.u8(),
        r.u8(),
        r.u8(),
        r.u8(),
      ];
      const ambient = r.f32(),
        diffuse = r.f32(),
        specular = r.f32(),
        power = r.f32();
      const flags = tag === 4 ? r.u16() : r.u32();
      const uvTransform = Array.from(r.floats(6));
      r.skip(tag === 4 ? 2 : 17);
      material = {
        name: r.string(),
        rgba,
        ambient,
        diffuse,
        specular,
        power,
        flags,
        uvTransform,
      };
      if (length > r.bytes.length - start + 2)
        throw new Error("MAT: material length exceeds file bounds");
    } else if ([0x1c, 0x1e, 0x1f, 0x20, 0x3b].includes(tag)) {
      if (!material) throw new Error("MAT: reference precedes material");
      const reference = r.string();
      if (tag === 0x1c) material.texture = reference;
    } else {
      r.sub(length);
      if (tag === 0) {
        if (!material) throw new Error("MAT: end marker without material");
        out.push(material);
        material = undefined;
      }
    }
  }
  if (material) throw new Error("MAT: missing final end marker");
  return out;
}

interface RawPix {
  name: string;
  width: number;
  height: number;
  format: number;
  rowBytes: number;
  bytes?: Uint8Array;
  pixelSize?: number;
  map?: RawPix;
}
function pixels(raw: RawPix, palette?: Uint8Array): PixMap {
  const { name, width, height, format } = raw;
  const data = raw.bytes;
  if (!data) throw new Error(`PIX: missing pixels for ${name}`);
  if (!width || !height || width * height > 16_777_216)
    throw new Error("PIX: invalid dimensions");
  const sizes: Record<number, number> = {
    3: 1,
    4: 2,
    5: 2,
    6: 3,
    7: 4,
    8: 4,
    13: 1,
    17: 2,
    18: 2,
  };
  const bpp = sizes[format];
  if (!bpp || raw.pixelSize !== bpp)
    throw new Error(`PIX: unsupported pixel format ${format}`);
  const tightStride = width * bpp;
  // Block writers may strip row padding; prefer the declared stride when present.
  const stride =
    raw.rowBytes >= tightStride && raw.rowBytes * height <= data.length
      ? raw.rowBytes
      : tightStride;
  if (stride * height > data.length)
    throw new Error("PIX: pixel data shorter than dimensions");
  const rgba = new Uint8Array(width * height * 4);
  if (raw.map) palette = pixels(raw.map).rgba;
  if (palette && palette.length < 1024)
    throw new Error("PIX: palette must contain 256 RGBA entries");
  const expand5 = (v: number) => (v << 3) | (v >> 2);
  const expand6 = (v: number) => (v << 2) | (v >> 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = y * stride + x * bpp,
        to = (y * width + x) * 4;
      let r = 0,
        g = 0,
        b = 0,
        a = 255;
      if (format === 3) {
        const i = data[at];
        if (palette) [r, g, b] = palette.subarray(i * 4, i * 4 + 3);
        else r = g = b = i;
        // C2 reserves palette index zero for transparent texture texels.
        if (!i) a = 0;
      } else if (
        format === 4 ||
        format === 5 ||
        format === 17 ||
        format === 18
      ) {
        const value = (data[at] << 8) | data[at + 1];
        if (format === 18) {
          a = (value >> 12) * 17;
          r = ((value >> 8) & 15) * 17;
          g = ((value >> 4) & 15) * 17;
          b = (value & 15) * 17;
        } else if (format === 5) {
          r = expand5(value >> 11);
          g = expand6((value >> 5) & 63);
          b = expand5(value & 31);
          // RGB565 has no alpha. C2's hardware buffer marks it
          // unblended; black tyre rubber and dark windows must stay opaque.
        } else {
          r = expand5((value >> 10) & 31);
          g = expand5((value >> 5) & 31);
          b = expand5(value & 31);
          if (format === 17) [r, b] = [b, r];
        }
      } else if (format === 6) {
        [r, g, b] = data.subarray(at, at + 3);
      } else if (format === 7 || format === 8) {
        [r, g, b] = data.subarray(at + 1, at + 4);
        if (format === 8) a = 255 - data[at];
      } else if (format === 13) {
        r = g = b = 255;
        a = data[at];
      }
      rgba.set([r, g, b, a], to);
    }
  return {
    name,
    width,
    height,
    format,
    rgba,
    ...(format === 7 && width * height >= 256 ? { palette: rgba } : {}),
  };
}

export function parsePix(bytes: Uint8Array, palette?: Uint8Array): PixMap[] {
  const r = binaryReader(bytes, 2, "PIX", true);
  const stack: RawPix[] = [],
    raw: RawPix[] = [];
  const current = () => {
    const p = stack.at(-1);
    if (!p) throw new Error("PIX: pixels precede map declaration");
    return p;
  };
  while (r.remaining) {
    const [tag, c] = chunk(r);
    switch (tag) {
      case 3:
      case 0x3d: {
        const format = c.u8(),
          rowBytes = c.u16(),
          width = c.u16(),
          height = c.u16();
        c.skip(tag === 3 ? 4 : 6);
        stack.push({ format, rowBytes, width, height, name: c.string() });
        break;
      }
      case 0x21: {
        const map = current(),
          count = c.u32(),
          pixelSize = c.u32();
        if (!pixelSize || pixelSize > 4)
          throw new Error("PIX: invalid pixel size");
        c.need(count * pixelSize);
        map.bytes = c.bytes.subarray(c.pos, c.pos + count * pixelSize);
        map.pixelSize = pixelSize;
        break;
      }
      case 0x22: {
        if (stack.length < 2)
          throw new Error("PIX: palette marker without parent");
        const map = stack.pop()!;
        current().map = map;
        break;
      }
      case 0:
        if (stack.length !== 1) throw new Error("PIX: unbalanced map stack");
        raw.push(stack.pop()!);
        break;
    }
  }
  if (stack.length) throw new Error("PIX: missing final end marker");
  // A palette in the same file can provide indices for subsequent maps.
  for (const p of raw)
    if (p.format === 7 && p.width * p.height >= 256) palette = pixels(p).rgba;
  return raw.map((p) => pixels(p, palette));
}

// The byte keys are file-format constants, shared by C1 and C2 retail text files.
const textKey = [
  0x6c, 0x1b, 0x99, 0x5f, 0xb9, 0xcd, 0x5f, 0x13, 0xcb, 4, 0x20, 0x0e, 0x5e,
  0x1c, 0xa1, 0x0e,
];
const commentKey = [
  0x67, 0xa8, 0xd6, 0x26, 0xb6, 0xdd, 0x45, 0x1b, 0x32, 0x7e, 0x22, 0x13, 0x15,
  0xc2, 0x94, 0x37,
];
export function decodeText(bytes: Uint8Array): string {
  const lines: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = start;
    while (end < bytes.length && bytes[end] !== 10 && bytes[end] !== 13) end++;
    let line = bytes.subarray(start, end);
    if (line[0] === 64) {
      // Buffer.slice aliases its input, while Uint8Array.slice copies it.
      line = new Uint8Array(line.subarray(1));
      let seed = line.length % 16,
        key = textKey;
      for (let i = 0; i < line.length; i++) {
        if (i >= 2 && line[i - 1] === 47 && line[i - 2] === 47)
          key = commentKey;
        const value = line[i] === 9 ? 159 : line[i];
        const decoded = (((value - 32) ^ key[seed]) & 127) + 32;
        line[i] = decoded === 159 ? 9 : decoded;
        seed = (seed + 7) % 16;
      }
    }
    lines.push(latin1(line));
    if (end < bytes.length) {
      if (bytes[end] === 13 && bytes[end + 1] === 10) end++;
      end++;
    }
    start = end;
  }
  return lines.join("\n");
}

/** Strip // comments and blank lines, preserving each config value's order. */
export function configLines(bytes: Uint8Array): string[] {
  return decodeText(bytes)
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter(Boolean);
}
