/** Production outlets for ordinary FORM/PHIL pedestrians. Current gameplay
 * owners supply effects and awards; missing grounding/recovery stays explicit. */
import { Vector3 } from "three";
import {
  NativePedGameplay,
  type NativePedGameplayCache,
  type NativePedGameplayGlobals,
  type NativePedGameplayOptions,
} from "./ped-native-gameplay";
import type { NativePedRuntimeAllocation } from "./ped-native-runtime";
import {
  createNativePedMovePlanner,
  type NativePedMoveFSM,
  type NativePedMoveGlobals,
} from "./ped-move-fsm";
import { selectNativePedNoise, type NativePedNoiseGroups } from "./ped-noise";
import { createNativePedContactAttribution } from "./ped-contact-attribution";
import {
  createNativePedRecoveryEffects,
  preflightNativePedRecoveryEffects,
  type NativePedRecoveryEffectsHost,
} from "./ped-recovery-effects";
import { sharedNativeRandom } from "./native-random";
import { pedRandomInteger } from "./ped-rules";
import { nativePedRootPose } from "./physics/ped-body";
import { describeNativePedAttributionOther } from "./physics/ped-other";
import type { PedContactSettings } from "./physics/ped-contact";
import type { VehicleSimulation } from "./physics/simulation";

type GameplayOutlet<
  Owner extends object,
  Key extends keyof NativePedGameplayOptions<Owner>,
> = NonNullable<NativePedGameplayOptions<Owner>[Key]>;

export interface OrdinaryNativePedGameplayOptions<Owner extends object> {
  simulation: Pick<
    VehicleSimulation,
    "pedestrianAttributionDriver" | "pedestrianAttributionCulprit"
  >;
  contactSettings: PedContactSettings;
  moveFSM: NativePedMoveFSM;
  readGlobals(): NativePedGameplayGlobals & NativePedMoveGlobals;
  /** Other native character bodies can inherit this actual cache's killer. */
  readCache(owner: object): NativePedGameplayCache | null;
  readNoiseGroups(owner: Owner): NativePedNoiseGroups | null;
  playNoise(id: number, position: Vector3): void;
  readAllocation(owner: Owner): NativePedRuntimeAllocation<Owner> | null;
  oneLess: GameplayOutlet<Owner, "onOneLessPed">;
  scoreDeath: GameplayOutlet<Owner, "onScoreDeath">;
  killGiblets: GameplayOutlet<Owner, "onKillGiblets">;
  contactEffects: GameplayOutlet<Owner, "onContactEffects">;
  readGroundHeight?: GameplayOutlet<Owner, "readGroundHeight">;
  writeGroundedRoot?: GameplayOutlet<Owner, "writeGroundedRoot">;
  /** Supply only actual grounding/cache/slick/direction owners. In their
   * absence NativePedGameplay reports its recovery-provider requirements. */
  recoveryEffects?: NativePedRecoveryEffectsHost<Owner>;
  onMovedVolume?: GameplayOutlet<Owner, "onMovedVolume">;
}

export function createOrdinaryNativePedGameplay<Owner extends object>(
  options: OrdinaryNativePedGameplayOptions<Owner>,
): NativePedGameplay<Owner> {
  const attribution = createNativePedContactAttribution<Owner>({
    readOther: (_context, dispatch) =>
      describeNativePedAttributionOther(dispatch.other, {
        readCharacterCache: (owner) => options.readCache(owner),
      }),
    readCarDriver: (car) => options.simulation.pedestrianAttributionDriver(car),
    readCarCulprit: (car) =>
      options.simulation.pedestrianAttributionCulprit(car),
  });
  const recovery = options.recoveryEffects;
  return new NativePedGameplay<Owner>({
    settings: options.contactSettings,
    readGlobals: options.readGlobals,
    nextCrtInteger: () => sharedNativeRandom.nextInteger(),
    // The application has no native AR resource/pointer serializer.
    headModelRecording: "disabled",
    attributeContact: attribution,
    planMove: createNativePedMovePlanner(options.moveFSM, () =>
      options.readGlobals(),
    ),
    onNoise: ({ context, index }) => {
      const groups = options.readNoiseGroups(context.owner);
      if (!groups) return ["source-personality-noise-table-owner"];
      const id = selectNativePedNoise(groups, index, (low, high) =>
        pedRandomInteger(sharedNativeRandom.random, low, high),
      );
      if (id !== undefined)
        options.playNoise(id, new Vector3(...context.character.position));
    },
    onOneLessPed: options.oneLess,
    onScoreDeath: options.scoreDeath,
    onKillGiblets: options.killGiblets,
    onContactEffects: options.contactEffects,
    readVolumeGravity: (context) =>
      context.body.specialVolume?.volume?.gravityMultiplier ?? null,
    readHaltInput: (context) => {
      const { body, instance } = context;
      const globals = options.readGlobals();
      const renderSlot =
        options.readAllocation(context.owner)?.renderSlot ?? -1;
      return {
        actorRootPose: nativePedRootPose(body),
        characterOrientation: instance.characterOrientation,
        worldFaceNormals: body.worldFaceNormals.map((normal) => [
          normal.x,
          normal.y,
          normal.z,
        ]),
        optionalFaceNormal: body.firstWorldFaceNormal
          ? [
              body.firstWorldFaceNormal.x,
              body.firstWorldFaceNormal.y,
              body.firstWorldFaceNormal.z,
            ]
          : null,
        mass: body.properties.mass,
        inertia: [
          body.properties.inertia.x,
          body.properties.inertia.y,
          body.properties.inertia.z,
        ],
        bounds: body.profile.bounds,
        lyingAxes: instance.template.form.lyingAxes,
        head: {
          boneIndex: instance.template.form.headBone,
          renderSlot,
          modelState: renderSlot,
        },
        collisionFlag: body.collisionFlags !== 0,
        nowMs: context.timeMs,
        immortal: globals.immortal,
        volumeGravity: body.specialVolume?.volume?.gravityMultiplier ?? null,
        goreLevel: globals.goreLevel,
        mutantSpeed: globals.mutantSpeed,
      };
    },
    ...(options.readGroundHeight
      ? { readGroundHeight: options.readGroundHeight }
      : {}),
    ...(options.writeGroundedRoot
      ? { writeGroundedRoot: options.writeGroundedRoot }
      : {}),
    ...(options.onMovedVolume ? { onMovedVolume: options.onMovedVolume } : {}),
    ...(recovery
      ? {
          onRecoveryEffect: createNativePedRecoveryEffects(recovery),
          preflightRecoveryEffects: (context, state, input, decision) =>
            preflightNativePedRecoveryEffects(
              recovery,
              context,
              state,
              input,
              decision,
            ),
        }
      : {}),
  });
}
