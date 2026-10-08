import type { Assets } from "./content";
import type { AudioSystem } from "./audio";
import { NativeFont, parseScrollerMessages } from "./native-font";

/**
 * C2's wasted HUD feedback. RaceCompleted(6) scrolls the original BIG_ITALIC
 * lettering from SCROLLERS entry34; rivals use a 150 ms flashing HUD label.
 * The label is queued for five seconds before advancing to the next one.
 */
export class WastedFeedback {
  private readonly assets: Assets;
  private readonly audio: Pick<AudioSystem, "playSound">;
  private readonly fancyFont = new NativeFont();
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
    const messages = parseScrollerMessages(
      await this.assets.text("data/SCROLLERS.TXT"),
    );
    this.playerText = messages[34].text;
    this.rivalText = messages[30].text;
    if (messages[34].font !== 21 || messages[30].font !== 21)
      throw new Error("Unsupported original player-wasted font");
    this.wastedText = (await this.assets.text("data/TEXT.TXT"))
      .split(/\r?\n/)
      .map((line) => line.split("//")[0].trim())
      .filter(Boolean)[19];
    await Promise.all([
      this.fancyFont.init(this.assets, "Big_Italic", 21),
      this.rivalFont.init(this.assets, "Medium_Headup", 17),
    ]);
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
  state(now: number): {
    playerVisible: boolean;
    rivalLabel?: string;
    rivalVisible: boolean;
  } {
    this.advanceFancy(now);
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

  /** Draw into the full-screen overlay using C2's authored 640x480 HUD coordinates. */
  draw(ctx: CanvasRenderingContext2D, now: number): void {
    const state = this.state(now);
    ctx.save();
    ctx.scale(ctx.canvas.width / 640, ctx.canvas.height / 480);
    ctx.imageSmoothingEnabled = false;
    if (this.fancyVisible)
      this.fancyFont.draw(
        ctx,
        this.fancyText,
        320 + this.fancyOffset,
        400,
        true,
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
  }

  private dropOldest(now: number): void {
    this.queue.shift();
    this.queueStartedAt = now;
  }

  private advanceFancy(now: number): void {
    const step = Math.trunc(
      (325 * Math.max(0, now - this.fancyUpdatedAt)) / 1000,
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
      if (now - this.fancyHeldAt > 1000) this.fancyStage = 2;
    } else if (this.fancyStage === 2) {
      this.fancyOffset -= step;
      if (
        this.fancyOffset <=
        -320 - Math.trunc(this.fancyFont.width(this.fancyText) / 2)
      )
        this.fancyStage = 3;
    }
  }

  private startFancy(text: string, index: number, now: number): void {
    if (
      this.lastFancyIndex >= 0 &&
      now - this.lastFancyAt <= 2000 &&
      index < this.lastFancyIndex
    )
      return;
    this.lastFancyIndex = index;
    this.lastFancyAt = now;
    this.fancyText = text;
    this.fancyOffset = 320 + Math.trunc(this.fancyFont.width(text) / 2);
    this.fancyStage = 0;
    this.fancyUpdatedAt = now;
  }
}
