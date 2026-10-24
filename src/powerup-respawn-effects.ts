import { chooseSmashAudio } from "./smash-effects";
import type {
  SmashConnotations,
  SmashExplosion,
  SmashSlick,
} from "./world-smash";

export interface PowerupRespawnEffectOutlets<Actor> {
  random?: () => number;
  sound: (
    id: number,
    volume: number,
    playbackRate: number,
    actor: Actor,
  ) => void;
  isVisible: (actor: Actor) => boolean;
  explode: (groups: readonly SmashExplosion[], actor: Actor) => void;
  slick: (spec: SmashSlick, actor: Actor) => void;
}

/** Emit only the effects used by the native powerup-respawn path. */
export function emitPowerupRespawnEffects<Actor>(
  data: SmashConnotations,
  actor: Actor,
  outlets: PowerupRespawnEffectOutlets<Actor>,
): void {
  const audio = chooseSmashAudio(data.sounds, outlets.random);
  if (audio) outlets.sound(audio.id, 1, audio.playbackRate, actor);

  if (data.explosions.length && outlets.isVisible(actor))
    outlets.explode(data.explosions, actor);

  if (data.slick) outlets.slick(data.slick, actor);
}
