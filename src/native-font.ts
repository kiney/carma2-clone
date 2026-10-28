import type { Assets } from "./content";
import { parsePix } from "./formats";

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.split("//")[0].trim())
    .filter(Boolean);

/** Original C2 polygon font: archived glyphs, authored widths and vertex colours. */
export class NativeFont {
  readonly glyphs = new Map<
    number,
    { width: number; size: number; rgba: Uint8Array; image?: HTMLCanvasElement }
  >();
  spacing = 1;
  blankWidth = 12;
  height = 24;

  async init(assets: Assets, name: string, colourIndex: number): Promise<void> {
    const prefix = `data/64x48x8/FONTS/${name}`;
    const metadata = lines(await assets.text(`${prefix}/font.txt`)).map(Number);
    [, this.spacing, , this.height, this.blankWidth] = metadata;
    const colours = lines(await assets.text("data/FontCol.TXT"))
      .slice(colourIndex * 4, colourIndex * 4 + 4)
      .map((line) => line.split(",").map(Number));
    if (colours.length !== 4 || metadata.length < 5)
      throw new Error(`Invalid original font: ${name}`);
    const maps = parsePix(await assets.bytes(`${prefix}/PIXIES.P16`));
    for (const map of maps) {
      const code = Number(map.name.replace(/\.pix$/i, ""));
      if (!Number.isInteger(code)) continue;
      if (map.format !== 18)
        throw new Error(
          `Unsupported original glyph format: ${name}/${map.name}`,
        );
      let width = 1;
      for (let y = 0; y < map.height; y++)
        for (let x = 0; x < map.width; x++)
          if (
            map.rgba[(y * map.width + x) * 4] ||
            map.rgba[(y * map.width + x) * 4 + 1] ||
            map.rgba[(y * map.width + x) * 4 + 2] ||
            (map.format === 18 && map.rgba[(y * map.width + x) * 4 + 3])
          )
            width = Math.max(width, x + 1);
      const rgba = map.rgba.slice();
      // FindCharacterWidth reads nonzero native 16-bit texels, not opacity.
      // Retail BIG_ITALIC/MEDIUM_HEADUP are ARGB4444 with authored alpha.
      // The native quad's vertex RGB modulates the original grayscale texture.
      for (let y = 0; y < map.height; y++)
        for (let x = 0; x < map.width; x++) {
          const u = x / map.width,
            v = y / map.height;
          for (let c = 0; c < 3; c++) {
            const top = colours[0][c] * (1 - u) + colours[1][c] * u;
            const bottom = colours[2][c] * (1 - u) + colours[3][c] * u;
            rgba[(y * map.width + x) * 4 + c] = Math.round(
              (rgba[(y * map.width + x) * 4 + c] *
                (top * (1 - v) + bottom * v)) /
                255,
            );
          }
        }
      this.glyphs.set(code, { width, size: map.width, rgba });
    }
  }

  width(text: string): number {
    return (
      [...text.toUpperCase()].reduce(
        (width, char) =>
          width +
          (this.glyphs.get(char.charCodeAt(0))?.width ?? this.blankWidth),
        0,
      ) +
      Math.max(0, text.length - 1) * this.spacing
    );
  }

  draw(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    alignment: boolean | "left" | "right" | "centre" = false,
  ): void {
    if (alignment === true || alignment === "centre")
      x -= Math.trunc(this.width(text) / 2);
    else if (alignment === "right") x -= this.width(text);
    for (const char of text.toUpperCase()) {
      const glyph = this.glyphs.get(char.charCodeAt(0));
      if (!glyph) {
        x += this.blankWidth;
        continue;
      }
      if (!glyph.image) {
        glyph.image = document.createElement("canvas");
        glyph.image.width = glyph.image.height = glyph.size;
        const image = glyph.image.getContext("2d")!;
        const pixels = image.createImageData(glyph.size, glyph.size);
        pixels.data.set(glyph.rgba);
        image.putImageData(pixels, 0, 0);
      }
      ctx.drawImage(glyph.image, Math.trunc(x), Math.trunc(y));
      x += glyph.width + this.spacing;
    }
  }
}

export function parseScrollerMessages(
  text: string,
): { font: number; text: string }[] {
  return parseScrollerRecords(text).map(({ font, text }) => ({ font, text }));
}

export interface ScrollerRecord {
  legacyFont: number;
  font: number;
  text: string;
}

export function parseScrollerRecords(text: string): ScrollerRecord[] {
  const rows = lines(text);
  const count = parseAssetCount(rows[0], "scroller");
  if (count > 46)
    throw new Error(`Invalid scroller count ${count}; maximum is 46`);
  if (rows.length - 1 < count)
    throw new Error(
      `SCROLLERS.TXT declares ${count} rows but only ${rows.length - 1} are present`,
    );
  return rows.slice(1, count + 1).map((line, index) => {
    const fields = line.split(/[\s,\/]+/);
    if (fields.length < 3)
      throw new Error(
        `Invalid SCROLLERS.TXT row ${index + 1}: expected two font IDs and text`,
      );
    const legacyFont = Number(fields[0]),
      font = Number(fields[1]);
    if (
      !Number.isInteger(legacyFont) ||
      legacyFont < 0 ||
      legacyFont >= LEGACY_POLYFONT.length ||
      !Number.isInteger(font) ||
      font < 0 ||
      font > 26
    )
      throw new Error(`Invalid SCROLLERS.TXT font ID at row ${index + 1}`);
    return {
      legacyFont,
      font,
      text: fields.slice(2).join(" ").replace(/_/g, " "),
    };
  });
}

function parseAssetCount(value: string | undefined, name: string): number {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0)
    throw new Error(`Invalid ${name} count in asset text`);
  return count;
}

export type HeadupJustification = "left" | "right" | "centre";
export interface FancyHeadupSlot {
  x: number;
  y: number;
  justification: HeadupJustification;
}

/** Parse the external/internal slot tables used by LoadHeadupMessageFile. */
export function parseFancyHeadupSlot(
  text: string,
  internal = false,
): FancyHeadupSlot {
  const rows = lines(text),
    externalCount = parseAssetCount(rows[0], "external headup");
  if (externalCount > 37)
    throw new Error(
      `Invalid external headup count ${externalCount}; maximum is 37`,
    );
  if (rows.length < externalCount + 1)
    throw new Error(
      `HEADUP.TXT declares ${externalCount} external rows but only ${Math.max(0, rows.length - 1)} are present`,
    );
  const internalCount = parseAssetCount(
    rows[externalCount + 1],
    "internal headup",
  );
  if (internalCount > 37)
    throw new Error(
      `Invalid internal headup count ${internalCount}; maximum is 37`,
    );
  if (rows.length < externalCount + internalCount + 2)
    throw new Error(
      `HEADUP.TXT declares ${internalCount} internal rows but only ${Math.max(0, rows.length - externalCount - 2)} are present`,
    );
  const selectedCount = internal ? internalCount : externalCount;
  if (selectedCount < 7)
    throw new Error(
      `HEADUP.TXT ${internal ? "internal" : "external"} table has ${selectedCount} rows; fancy slot 6 requires at least 7`,
    );
  const index = (internal ? externalCount + 2 : 1) + 6;
  const row = rows[index];
  if (!row)
    throw new Error(
      `HEADUP.TXT has no fancy slot 6 for ${internal ? "internal" : "external"} view`,
    );
  const fields = row.split(/[\s,\/]+/),
    x = Number(fields[1]),
    y = Number(fields[2]);
  const token = fields[4]?.toLowerCase();
  const justification = token?.startsWith("l")
    ? "left"
    : token?.startsWith("r")
      ? "right"
      : token?.startsWith("c")
        ? "centre"
        : undefined;
  if (!Number.isInteger(x) || !Number.isInteger(y) || !justification)
    throw new Error(`Invalid HEADUP.TXT fancy slot 6: ${row}`);
  return { x, y, justification };
}

export interface NativePolyfontSpec {
  name: string;
  colour: number;
}

/** Installed gDRFont_to_polyfont_mapping ranges relevant to fancy headups. */
export function nativePolyfontSpec(id: number): NativePolyfontSpec | undefined {
  if (id >= 12 && id <= 15) return { name: "TinyFont", colour: id };
  if (id === 16) return { name: "BigYellowTimer", colour: id };
  if (id >= 17 && id <= 20) return { name: "Medium_Headup", colour: id };
  if (id >= 21 && id <= 24) return { name: "Big_Italic", colour: id };
  if (id === 25) return { name: "NetPosFont", colour: id };
  if (id === 26) return { name: "hand15lo", colour: id };
  return undefined;
}

const LEGACY_POLYFONT = [
  14, 12, 13, 15, 21, 16, 18, 17, 19, 15, 20, 13, 14, 12, 13, 13, 13, 24, 24,
  22, 22, 24, 24, 18,
];

export function legacyPolyfontId(legacyFont: number): number | undefined {
  return Number.isInteger(legacyFont) && legacyFont >= 0
    ? LEGACY_POLYFONT[legacyFont]
    : undefined;
}

export function acceptsFancyHeadup(
  lastIndex: number,
  lastAt: number,
  index: number,
  now: number,
  mapView?: number,
): boolean {
  if (mapView === 2) return false;
  if (lastIndex < 0 || index >= lastIndex) return true;
  return ((Math.trunc(now) >>> 0) - (lastAt >>> 0)) >>> 0 > 2000;
}

export function fancyHeadupOffsets(
  width: number,
  justification: HeadupJustification,
  screenWidth = 640,
): { initial: number; end: number } {
  const centre = Math.trunc(screenWidth / 2),
    halfWidth = Math.trunc(width / 2);
  if (justification === "left")
    return { initial: centre, end: -Math.trunc(width) };
  if (justification === "right")
    return { initial: centre + halfWidth, end: centre };
  return { initial: centre + halfWidth, end: -centre - halfWidth };
}
