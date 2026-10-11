import { engineNoise } from "./engine-noise";
import type { Assets } from "./content";
import type { RaceEvent } from "./gameplay";
import { parsePowerupPickupSounds, raceEventSoundIds } from "./event-audio";

type SoundDefinition = { id: number; file: string };
const SOUND_TABLE = "data/SOUND/SOUND.TXT";
const ENGINE_LINE = /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\/\/\s*Engine noise/i;

/** Browser audio for original Carmageddon assets. AudioContext starts only after unlock(). */
export class AudioSystem {
  readonly diagnostics: string[] = [];
  private readonly assets: Assets;
  private sounds = new Map<number, SoundDefinition>();
  private buffers = new Map<number, Promise<AudioBuffer | null>>();
  private context?: AudioContext;
  private master?: GainNode;
  private engineGain?: GainNode;
  private engineSource?: AudioBufferSourceNode;
  private engineIds: [number, number, number] | null = null;
  private engineBuffer?: AudioBuffer;
  private engineLoading = false;
  private engineWanted = false;
  private engineRate = 1;
  private engineVolume = 0;
  private impactIds: number[] = [];
  private checkpointId?: number;
  private pickupIds: number[] = [];
  private disposed = false;

  constructor(assets: Assets) {
    this.assets = assets;
  }

  async init(): Promise<void> {
    try {
      const path = this.assets.resolve(SOUND_TABLE);
      if (!path) {
        this.diagnostics.push(`Original sound map is missing: ${SOUND_TABLE}`);
        return;
      }
      const text = await this.assets.text(path);
      const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^\s*(\d+)\s*\/\/\s*Sound ID\b/i);
        if (!match) continue;
        const file = (lines[i + 2] ?? "").replace(/\/\/.*$/, "").trim();
        if (/^[^/\\]+\.wav$/i.test(file))
          this.sounds.set(Number(match[1]), { id: Number(match[1]), file });
      }
      this.impactIds = [...this.sounds.values()]
        .filter((sound) => /impact\d*\.wav$/i.test(sound.file))
        .map((sound) => sound.id);
      this.checkpointId = [...this.sounds.values()].find((sound) =>
        /chkpoint\.wav$/i.test(sound.file),
      )?.id;
      if (!this.sounds.size)
        this.diagnostics.push(
          "Original sound map contained no usable WAV entries.",
        );
      if (!this.impactIds.length)
        this.diagnostics.push("Original impact sounds are unavailable.");
      if (!this.checkpointId)
        this.diagnostics.push("Original checkpoint sound is unavailable.");
    } catch (error) {
      this.diagnostics.push(
        `Could not read original sound map: ${String(error)}`,
      );
    }
  }

  async unlock(): Promise<void> {
    if (this.disposed) return;
    const AudioContextType = globalThis.AudioContext;
    if (!AudioContextType) {
      this.diagnostics.push("Web Audio is unavailable in this browser.");
      return;
    }
    if (!this.context) {
      this.context = new AudioContextType();
      this.master = this.context.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.context.destination);
      this.engineGain = this.context.createGain();
      this.engineGain.gain.value = 0;
      this.engineGain.connect(this.master);
    }
    if (this.context.state !== "running") {
      try {
        await this.context.resume();
      } catch (error) {
        this.diagnostics.push(`Audio unlock failed: ${String(error)}`);
      }
    }
    if (this.engineIds) await this.loadEngine();
  }

  async setCar(configText: string): Promise<void> {
    const match = configText
      .split(/\r?\n/)
      .map((line) => line.match(ENGINE_LINE))
      .find(Boolean);
    if (!match) {
      this.engineIds = null;
      this.stopEngine();
      this.diagnostics.push("Car config has no original engine noise IDs.");
      return;
    }
    const ids: [number, number, number] = [
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    ];
    this.stopEngine();
    if (this.engineGain && this.context)
      this.engineGain.gain.setValueAtTime(0, this.context.currentTime);
    this.engineIds = ids;
    this.engineBuffer = undefined;
    this.buffers.delete(ids[0]);
    if (!this.sounds.has(ids[0])) {
      this.diagnostics.push(
        `Car engine sound ${ids[0]} is absent from the original sound map.`,
      );
      this.stopEngine();
      return;
    }
    if (this.context?.state === "running") await this.loadEngine();
  }

  update(
    revs: number,
    engineNoiseIndex: number,
    paused: boolean,
    engineFactor = 1,
  ): void {
    if (
      this.disposed ||
      !this.context ||
      this.context.state !== "running" ||
      !this.engineGain
    )
      return;
    const audible = !paused && !!this.engineBuffer;
    this.engineWanted = audible;
    if (!audible) {
      this.engineGain.gain.setTargetAtTime(0, this.context.currentTime, 0.08);
      if (paused || !this.engineBuffer) this.stopEngine();
      return;
    }
    this.startEngine();
    // rec2 MungeEngineNoise: source remains active at standstill. Player revs
    // come from reconstructed motion; speedo cycling is an AI-only proxy.
    const values = engineNoise(revs, engineNoiseIndex, engineFactor);
    this.engineRate = values.playbackRate;
    this.engineVolume = values.gain;
    this.engineSource!.playbackRate.setValueAtTime(
      this.engineRate,
      this.context.currentTime,
    );
    this.engineGain.gain.setValueAtTime(
      this.engineVolume,
      this.context.currentTime,
    );
  }

  impact(strength: number): void {
    if (
      !this.context ||
      this.context.state !== "running" ||
      !this.impactIds.length
    )
      return;
    const power = clamp(Number.isFinite(strength) ? strength : 0, 0, 1);
    const id =
      this.impactIds[Math.floor(Math.random() * this.impactIds.length)];
    void this.playOneShot(
      id,
      clamp(0.15 + power * 0.7, 0, 0.85),
      0.8 + Math.random() * 0.4,
    );
  }

  checkpoint(): void {
    if (
      this.checkpointId === undefined ||
      !this.context ||
      this.context.state !== "running"
    )
      return;
    void this.playOneShot(this.checkpointId, 0.55, 1);
  }
  configurePowerups(generalText: string): void {
    this.pickupIds = parsePowerupPickupSounds(generalText);
  }
  /** World flask connotations only. Grants, use and expiry have no generic
   * sound. HW0x4f1010 gives the authored mine pickup(index14) its own explosion. */
  powerupPickup(index: number, random: () => number = Math.random): void {
    if (!this.context || this.context.state !== "running") return;
    if (index === 14) {
      void this.playOneShot(5400, 1, 1);
      return;
    }
    if (!this.pickupIds.length) return;
    const id = this.pickupIds[Math.floor(random() * this.pickupIds.length)];
    const pitch = (0xe000 + Math.floor(random() * 0x4001)) / 0x10000;
    void this.playOneShot(id, 1, pitch);
  }
  raceEvents(events: readonly RaceEvent[], totalLaps: number): void {
    for (const id of raceEventSoundIds(events, totalLaps)) {
      if (id === 8012) this.checkpoint();
      else void this.playSound(id, 0.55);
    }
  }
  /** Original event IDs, including mine5400 and low-impact5403. */
  async playSound(id: number, volume = 0.65, playbackRate = 1): Promise<void> {
    if (!this.context || this.context.state !== "running") return;
    await this.playOneShot(id, volume, playbackRate);
  }

  dispose(): void {
    this.disposed = true;
    this.stopEngine();
    if (this.context) void this.context.close();
    this.context = undefined;
    this.master = undefined;
    this.engineGain = undefined;
    this.engineBuffer = undefined;
    this.buffers.clear();
  }

  private async loadEngine(): Promise<void> {
    if (this.engineLoading || !this.engineIds || !this.context) return;
    const definition = this.sounds.get(this.engineIds[0]);
    if (!definition) return;
    this.engineLoading = true;
    try {
      this.engineBuffer =
        (await this.loadSound(this.engineIds[0])) ?? undefined;
      if (!this.engineBuffer)
        this.diagnostics.push(
          `Original engine WAV is unavailable: ${definition.file}`,
        );
      if (
        this.engineWanted &&
        this.engineBuffer &&
        this.context.state === "running"
      )
        this.startEngine();
    } finally {
      this.engineLoading = false;
    }
  }

  private async loadSound(id: number): Promise<AudioBuffer | null> {
    if (!this.context) return null;
    let pending = this.buffers.get(id);
    if (!pending) {
      pending = (async () => {
        const sound = this.sounds.get(id);
        if (!sound) return null;
        const asset =
          this.assets.resolve(`data/SOUND/${sound.file}`) ??
          this.assets.resolve(`adv_data/SOUND/${sound.file}`);
        if (!asset) return null;
        try {
          const bytes = await this.assets.bytes(asset);
          const copy = new ArrayBuffer(bytes.byteLength);
          new Uint8Array(copy).set(bytes);
          return await this.context!.decodeAudioData(copy);
        } catch (error) {
          this.diagnostics.push(
            `Could not decode original WAV ${sound.file}: ${String(error)}`,
          );
          return null;
        }
      })();
      this.buffers.set(id, pending);
    }
    return pending;
  }

  private async playOneShot(
    id: number,
    volume: number,
    rate: number,
  ): Promise<void> {
    const buffer = await this.loadSound(id);
    if (
      !buffer ||
      !this.context ||
      this.context.state !== "running" ||
      !this.master ||
      this.disposed
    )
      return;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(this.master);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    source.start();
  }

  private startEngine(): void {
    if (
      !this.context ||
      !this.engineGain ||
      !this.engineBuffer ||
      this.engineSource ||
      !this.engineWanted
    )
      return;
    const source = this.context.createBufferSource();
    source.buffer = this.engineBuffer;
    source.loop = true;
    source.playbackRate.value = this.engineRate;
    source.connect(this.engineGain);
    source.onended = () => {
      if (this.engineSource === source) this.engineSource = undefined;
    };
    this.engineSource = source;
    source.start();
  }

  private stopEngine(): void {
    if (!this.engineSource) return;
    try {
      this.engineSource.stop();
    } catch {
      /* already stopped */
    }
    this.engineSource.disconnect();
    this.engineSource = undefined;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
