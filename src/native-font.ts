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
    centred = false,
  ): void {
    if (centred) x -= Math.trunc(this.width(text) / 2);
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
  return lines(text)
    .slice(1)
    .map((line) => {
      const fields = line.split(/[\s,]+/);
      return { font: Number(fields[1]), text: fields[2].replace(/_/g, " ") };
    });
}
