/** Reconstructed from rec2 MungeEngineNoise (mapped0x456070) and
 * car.c's speedometer-to-revs calculation (0x41e660). */
export interface EngineNoise {
  /** Integer pitch value passed to S3UpdateSoundSource. */
  pitchFixed: number;
  /** Integer volume value passed to S3UpdateSoundSource, 0..255 nominally. */
  volume: number;
  /** Browser playback-rate equivalent of the native 16.16 pitch. */
  playbackRate: number;
  /** Nominal normalized browser gain. */
  gain: number;
}

/** Apply the native engine-source pitch and volume transforms.
 * Unknown finite volume indices follow the source's normal-volume branch. */
export function engineNoise(
  revs: number,
  engineNoiseIndex: number,
  boost = 1,
  replayRate?: number,
): EngineNoise {
  if (!Number.isFinite(revs)) throw new Error("Invalid engine revs");
  if (!Number.isFinite(engineNoiseIndex))
    throw new Error("Invalid engine noise index");
  if (!Number.isFinite(boost)) throw new Error("Invalid engine noise boost");
  if (replayRate !== undefined && !Number.isFinite(replayRate))
    throw new Error("Invalid replay rate");

  let pitch = 40960 + 10 * revs;
  if (replayRate !== undefined) pitch *= Math.abs(replayRate);
  if (engineNoiseIndex === 1) pitch *= 0.75;
  else if (engineNoiseIndex === 2) pitch *= 0.55;
  pitch = Math.min(131072, Math.max(4096, pitch));

  let volume = 96 + revs * 0.0015;
  if (engineNoiseIndex === 1) volume *= 5;
  else if (engineNoiseIndex === 2) volume *= 2;
  else volume *= 2.5;
  volume = Math.min(255, volume);
  if (boost > 1) volume *= 1 + (boost - 1) / 12;

  const pitchFixed = Math.trunc(pitch);
  const integerVolume = Math.trunc(volume);
  return {
    pitchFixed,
    volume: integerVolume,
    playbackRate: pitchFixed / 65536,
    gain: integerVolume / 255,
  };
}

/** Native AI cosmetic revs (driver<network human); local humans use motion
 * revs. Native frac is pN - (int)pN, where C truncates toward zero. */
export function nativeEngineRevs(speedoSpeed: number, redLine: number): number {
  if (!Number.isFinite(speedoSpeed) || !Number.isFinite(redLine))
    throw new Error("Invalid speedometer engine input");
  const speedUnits = speedoSpeed / 0.003;
  const fraction = speedUnits - Math.trunc(speedUnits);
  return fraction * (redLine - 800) + 800;
}
