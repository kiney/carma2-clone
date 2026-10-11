import type { Material } from "three";
import type { NativePedGameplayOptions } from "./ped-native-gameplay";
import type { NativePedRuntimeAllocation } from "./ped-native-runtime";
import type { PedBloodSettings } from "./ped-blood";
import {
  nativePedCorpseSlickRequirements,
  queueNativePedCorpseSlick,
  type NativePedSlickHost,
  type NativePedSlickResult,
} from "./ped-slick";
import type { OilRuntime } from "./physics/oil";
import type {
  NativePedHaltDecision,
  NativePedHaltInput,
  NativePedHaltState,
} from "./physics/ped-halt";

type RecoveryOutlet<Owner extends object> = NonNullable<
  NativePedGameplayOptions<Owner>["onRecoveryEffect"]
>;
export interface NativePedRecoveryEffectsHost<Owner extends object> {
  readAllocation(owner: Owner): NativePedRuntimeAllocation<Owner> | null;
  readOil(): OilRuntime | null;
  readSlick(): PedBloodSettings["slick"] | null;
  readMaterials(): ReadonlyMap<string, Material> | null;
  /** PipeSinglePedStatus is a recording event, not SetPhysicsLevel. */
  statusRecording?: "disabled" | RecoveryOutlet<Owner>;
  /** Narrow borrowed-list release; retain process-cache floor/head/direction. */
  grounding?: { releaseFaceCache(owner: Owner): unknown };
  otherEffects?: RecoveryOutlet<Owner>;
  onSlickResult?: (owner: Owner, result: NativePedSlickResult) => void;
}

function readSlickHost<Owner extends object>(
  host: NativePedRecoveryEffectsHost<Owner>,
  context: Parameters<RecoveryOutlet<Owner>>[0],
): { value: NativePedSlickHost<Owner> | null; missing: string[] } {
  const oil = host.readOil(),
    slick = host.readSlick(),
    materials = host.readMaterials();
  const missing = [
    ...(!oil ? ["source-shared-oil-runtime-owner"] : []),
    ...(!slick ? ["source-registered-ped-slick-settings"] : []),
    ...(!materials ? ["source-registered-ped-slick-materials"] : []),
  ];
  return {
    value: missing.length
      ? null
      : {
          oil: oil!,
          slick: slick!,
          materials: materials!,
          allocation: host.readAllocation(context.owner),
          timeMs: context.timeMs,
        },
    missing,
  };
}

/** Readiness is checked before the native kernel: resources cannot be discovered
 * missing only after the source chance draw and permanent once-bit mutation. */
export function preflightNativePedRecoveryEffects<Owner extends object>(
  host: NativePedRecoveryEffectsHost<Owner>,
  context: Parameters<RecoveryOutlet<Owner>>[0],
  state: NativePedHaltState,
  input: NativePedHaltInput,
  decision: NativePedHaltDecision,
): string[] {
  if (decision.kind === "retry" || decision.kind === "unsupported") return [];
  const missing =
    host.statusRecording === undefined
      ? ["source-ped-status-recording-owner"]
      : [];
  if (
    decision.kind === "dead" &&
    !input.replay &&
    !(state.flags & 0x10) &&
    input.goreLevel > 0 &&
    (input.volumeGravity === null || Math.fround(input.volumeGravity) >= 1)
  ) {
    const slick = readSlickHost(host, context);
    missing.push(...slick.missing);
    if (slick.value)
      missing.push(...nativePedCorpseSlickRequirements(slick.value));
  }
  return missing;
}

/** Actual effect owners for the existing halt/completion bridge. Unimplemented
 * direction/proximity/recache effects remain explicit instead of a blanket noop. */
export function createNativePedRecoveryEffects<Owner extends object>(
  host: NativePedRecoveryEffectsHost<Owner>,
): RecoveryOutlet<Owner> {
  return (context, effect, state) => {
    // NativePedGameplay has already executed startHeadSequence against the
    // actual runtime/cache/MODEL owner before forwarding this observer event.
    if (effect.kind === "head-sequence") return;
    if (effect.kind === "status-physical-level") {
      if (host.statusRecording === "disabled") return;
      if (host.statusRecording)
        return host.statusRecording(context, effect, state);
      return ["source-ped-status-recording-owner"];
    }
    if (effect.kind === "release-selected-face-cache" && host.grounding) {
      host.grounding.releaseFaceCache(context.owner);
      return;
    }
    if (effect.kind === "corpse-slick") {
      const slick = readSlickHost(host, context);
      if (!slick.value) return slick.missing;
      const result = queueNativePedCorpseSlick(slick.value);
      host.onSlickResult?.(context.owner, result);
      return result.requiredProviders;
    }
    if (host.otherEffects) return host.otherEffects(context, effect, state);
    return [`source-recovery-${effect.kind}-owner`];
  };
}
