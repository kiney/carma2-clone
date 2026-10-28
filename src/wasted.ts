import type { Assets } from "./content";
import type { AudioSystem } from "./audio";
import {
  NativeFont,
  acceptsFancyHeadup,
  fancyHeadupOffsets,
  legacyPolyfontId,
  nativePolyfontSpec,
  parseFancyHeadupSlot,
  parseScrollerRecords,
  type FancyHeadupSlot,
  type ScrollerRecord,
} from "./native-font";

/**
 * C2's wasted HUD feedback. RaceCompleted(6) scrolls the original BIG_ITALIC
 * lettering from SCROLLERS entry34; rivals use a 150 ms flashing HUD label.
 * The label is queued for five seconds before advancing to the next one.
 */
export class WastedFeedback {
  private readonly assets: Assets;
  private readonly audio: Pick<AudioSystem, "playSound">;
  private readonly fancyFont = new NativeFont();
  private activeFancyFont = this.fancyFont;
  private readonly fancyFonts = new Map<number, NativeFont>();
  private fancyMessages: ScrollerRecord[] = [];
  private fancySlot: FancyHeadupSlot = {
    x: 320,
    y: 400,
    justification: "centre",
  };
  private externalFancySlot: FancyHeadupSlot = this.fancySlot;
  private internalFancySlot: FancyHeadupSlot = this.fancySlot;
  private readonly rivalFont = new NativeFont();
  private playerText = "";
  private rivalText = "";
  private fancyText = "";
  private lastFancyIndex = -1;
  private lastFancyAt = 0;
  private wastedText = "";
  private fancyOffset = 0;
  private fancyStage = 3;
  private fancyHeldAt = 0;
  private fancyUpdatedAt = 0;
  private readonly recent = new Set<string>();
  private readonly queue: string[] = [];
  private queueStartedAt = 0;
  private lastFlashAt = 0;
  private flashState = 0;
  private playerUntil = 0;

  constructor(assets: Assets, audio: Pick<AudioSystem, "playSound">) {
    this.assets = assets;
    this.audio = audio;
  }

  /** Loads native scroller text and original polygon-font glyphs from local archives. */
  async init(): Promise<void> {
    const messages = parseScrollerRecords(
      await this.assets.text("data/SCROLLERS.TXT"),
    );
    this.fancyMessages = messages;
    this.playerText = messages[34].text;
    this.rivalText = messages[30].text;
    if (messages[34].font !== 21 || messages[30].font !== 21)
      throw new Error("Unsupported original player-wasted font");
    this.wastedText = (await this.assets.text("data/TEXT.TXT"))
      .split(/\r?\n/)
      .map((line) => line.split("//")[0].trim())
      .filter(Boolean)[19];
    const headupText = await this.assets.text("data/64x48x8/HEADUP.TXT");
    this.externalFancySlot = parseFancyHeadupSlot(headupText);
    this.fancySlot = this.externalFancySlot;
    this.internalFancySlot = parseFancyHeadupSlot(headupText, true);
    const needed = new Set<number>();
    for (const { font, legacyFont } of messages.slice(10)) {
      needed.add(font);
      const widthFont = legacyPolyfontId(legacyFont);
      if (widthFont === undefined)
        throw new Error(
          `Unsupported legacy SCROLLERS.TXT font ID ${legacyFont}`,
        );
      needed.add(widthFont);
    }
    needed.add(21);
    for (const fontId of needed) {
      const spec = nativePolyfontSpec(fontId);
      if (!spec)
        throw new Error(`Unsupported SCROLLERS.TXT polygon font ID ${fontId}`);
      const font = new NativeFont();
      this.fancyFonts.set(fontId, fontId === 21 ? this.fancyFont : font);
      if (fontId === 21)
        await this.fancyFont.init(this.assets, spec.name, spec.colour);
      else await font.init(this.assets, spec.name, spec.colour);
    }
    await this.rivalFont.init(this.assets, "Medium_Headup", 17);
  }

  /** Call once for each newly wasted car. Duplicate calls within a race are ignored. */
  wasted(
    kind: "player" | "rival",
    id: string | number,
    label: string,
    now: number,
    soundId?: number,
    creditedToPlayer = false,
  ): boolean {
    const key = `${kind}:${id}`;
    if (this.recent.has(key)) return false;
    this.recent.add(key);
    if (kind === "player") {
      this.playerUntil = now + 10_000;
      this.startFancy(this.playerText, 24, now);
    } else {
      // Native QueueWastedMessage has five slots, drops the oldest if full,
      // and starts the five-second head timer only when the queue was empty.
      if (this.queue.length === 5) this.dropOldest(now);
      if (this.queue.length === 0) this.queueStartedAt = now;
      this.queue.push(label);
      if (creditedToPlayer) this.startFancy(this.rivalText, 20, now);
    }
    if (soundId !== undefined) void this.audio.playSound(soundId);
    return true;
  }

  /** Countdown lasts ten seconds; native fancy lettering scrolls in, holds, then scrolls out. */
  state(
    now: number,
    framePeriodMs?: number,
  ): {
    playerVisible: boolean;
    rivalLabel?: string;
    rivalVisible: boolean;
  } {
    this.advanceFancy(now, framePeriodMs);
    if (this.queue.length && now > this.queueStartedAt + 5_000)
      this.dropOldest(now);
    if (this.queue.length && now - this.lastFlashAt > 150) {
      this.flashState = this.flashState ? 0 : 1;
      this.lastFlashAt = now;
    }
    return {
      playerVisible: now < this.playerUntil,
      rivalLabel: this.queue[0],
      rivalVisible: this.queue.length > 0 && this.flashState !== 0,
    };
  }

  get playerTextVisible(): boolean {
    return this.fancyStage < 3 && this.lastFancyIndex === 24;
  }

  get fancyVisible(): boolean {
    return this.fancyStage < 3;
  }

  get fancySnapshot() {
    return {
      index: this.lastFancyIndex,
      startedAt: this.lastFancyAt,
      stage: this.fancyStage,
      offset: this.fancyOffset,
      endOffset: this.fancyEndOffset,
      text: this.fancyText,
      fontId:
        [...this.fancyFonts].find(
          ([, font]) => font === this.activeFancyFont,
        )?.[0] ?? 21,
      slot: { ...this.fancySlot },
    };
  }

  /** Native DoFancyHeadup(0x44ac60): use SCROLLERS[index+10] and slot 6. */
  fancy(
    index: number,
    now: number,
    options: { mapView?: number; internal?: boolean } = {},
  ): boolean {
    if (options.mapView === 2) return false;
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index + 10 >= this.fancyMessages.length
    )
      throw new RangeError(
        `Fancy headup index ${index} is outside the loaded SCROLLERS table`,
      );
    const message = this.fancyMessages[index + 10];
    const font = this.fancyFonts.get(message.font);
    if (!font)
      throw new Error(
        `Polygon font ${message.font} was not loaded for fancy headups`,
      );
    const slot = options.internal
      ? this.internalFancySlot
      : this.externalFancySlot;
    const widthFontId = legacyPolyfontId(message.legacyFont);
    const widthFont =
      widthFontId === undefined ? undefined : this.fancyFonts.get(widthFontId);
    if (!widthFont)
      throw new Error(
        `Legacy polygon font for ID ${message.legacyFont} was not loaded`,
      );
    return this.startFancy(message.text, index, now, font, slot, widthFont);
  }

  /** Draw into the full-screen overlay using C2's authored 640x480 HUD coordinates. */
  draw(
    ctx: CanvasRenderingContext2D,
    now: number,
    framePeriodMs?: number,
  ): void {
    const state = this.state(now, framePeriodMs);
    ctx.save();
    ctx.scale(ctx.canvas.width / 640, ctx.canvas.height / 480);
    ctx.imageSmoothingEnabled = false;
    if (this.fancyVisible)
      this.activeFancyFont.draw(
        ctx,
        this.fancyText,
        this.fancySlot.x + this.fancyOffset,
        this.fancySlot.y,
        this.fancySlot.justification,
      );
    if (state.rivalVisible)
      this.rivalFont.draw(
        ctx,
        `${state.rivalLabel} ${this.wastedText}`,
        416,
        13,
      );
    ctx.restore();
  }

  /** Start a fresh race, clearing dedupe state and any active wasted display. */
  reset(): void {
    this.recent.clear();
    this.queue.length = 0;
    this.playerUntil = 0;
    this.queueStartedAt = 0;
    this.lastFlashAt = 0;
    this.flashState = 0;
    this.fancyStage = 3;
    this.lastFancyIndex = -1;
    this.lastFancyAt = 0;
  }

  private dropOldest(now: number): void {
    this.queue.shift();
    this.queueStartedAt = now;
  }

  private advanceFancy(now: number, framePeriodMs?: number): void {
    const step = Math.trunc(
      (325 * (framePeriodMs ?? Math.max(0, now - this.fancyUpdatedAt))) / 1000,
    );
    this.fancyUpdatedAt = now;
    if (this.fancyStage === 0) {
      this.fancyOffset -= step;
      if (this.fancyOffset <= 0) {
        this.fancyOffset = 0;
        this.fancyStage = 1;
        this.fancyHeldAt = now;
      }
    } else if (this.fancyStage === 1) {
      if ((now - this.fancyHeldAt) >>> 0 > 1000) this.fancyStage = 2;
    } else if (this.fancyStage === 2) {
      this.fancyOffset -= step;
      if (this.fancyOffset <= this.fancyEndOffset) this.fancyStage = 3;
    }
  }

  private fancyEndOffset = 0;

  private startFancy(
    text: string,
    index: number,
    now: number,
    font = this.fancyFont,
    slot = this.externalFancySlot,
    widthFont = font,
  ): boolean {
    if (!acceptsFancyHeadup(this.lastFancyIndex, this.lastFancyAt, index, now))
      return false;
    this.lastFancyIndex = index;
    this.lastFancyAt = Math.trunc(now) >>> 0;
    this.fancyText = text;
    this.activeFancyFont = font;
    this.fancySlot = slot;
    const offsets = fancyHeadupOffsets(
      widthFont.width(text),
      slot.justification,
    );
    this.fancyOffset = offsets.initial;
    this.fancyEndOffset = offsets.end;
    this.fancyStage = 0;
    this.fancyUpdatedAt = now;
    return true;
  }
}
