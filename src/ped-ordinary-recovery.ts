/** Production recovery effects over actual ordinary process/ground owners.
 * See c2-ped-halt-re.md and c2-ped-native-gameplay-re.md. This module dispatches
 * supported operations; it does not infer floor normals or synthesize falls. */
import type { PedVector } from "./ped-form";
import type {
  NativePedGameplayCache,
  NativePedGameplayOptions,
  NativePedGameplayState,
} from "./ped-native-gameplay";
import type { NativePedRuntimeCallback } from "./ped-native-runtime";
import {
  preflightNativePedRecoveryEffects,
  type NativePedRecoveryEffectsHost,
} from "./ped-recovery-effects";
import type {
  NativePedHaltDecision,
  NativePedHaltInput,
  NativePedHaltState,
} from "./physics/ped-halt";

export interface OrdinaryPedRecoveryOperationResult {
  status: "complete" | "provider-required";
  requiredProviders: readonly string[];
}
export interface OrdinaryPedRecoveryProcess<FaceSlot extends object>
  extends NativePedGameplayCache {
  faceCache: FaceSlot | null;
}
type Context<Owner extends object> = NativePedRuntimeCallback<Owner>;
type Operation<Owner extends object> = (
  context: Context<Owner>,
  state: NativePedGameplayState,
) => OrdinaryPedRecoveryOperationResult;
export interface OrdinaryPedRecoveryOptions<
  Owner extends object,
  FaceSlot extends object,
> extends Pick<
    NativePedRecoveryEffectsHost<Owner>,
    | "readAllocation"
    | "readOil"
    | "readSlick"
    | "readMaterials"
    | "onSlickResult"
  > {
  /** Return the current bounded process record, never a retained per-ped copy. */
  readProcess(owner: Owner): OrdinaryPedRecoveryProcess<FaceSlot> | null;
  /** Actual bounded face-pool release. It must retain copied face order/data. */
  releaseBorrowedFaceSlot(slot: FaceSlot): void;
  /** Installed accepted living halt forces RecacheAndSetFace before direction.
   * A normal walking prepare() guarded by action/active state is not this owner. */
  recacheGround?: (
    context: Context<Owner>,
    request: { force: true; timeMs: number },
    state: NativePedGameplayState,
  ) => OrdinaryPedRecoveryOperationResult;
  setDirection?: (
    context: Context<Owner>,
    vector: PedVector,
    timeMs: number,
    state: NativePedGameplayState,
  ) => OrdinaryPedRecoveryOperationResult;
  rescanProximity?: Operation<Owner>;
  /** Exact ordinary object scan, including record-address seed and its own
   * authored vocal choices. Recovery adds no second noise/CRT draw. */
  scanObjects?: (
    context: Context<Owner>,
    timeMs: number,
    state: NativePedGameplayState,
  ) => OrdinaryPedRecoveryOperationResult;
  /** PipeSinglePedStatus recording can be explicitly off; never reactivate here. */
  statusRecording?: NativePedRecoveryEffectsHost<Owner>["statusRecording"];
  /** Read-only readiness for actual floor/source owners, before halt writes/RNG. */
  preflight?: (
    context: Context<Owner>,
    state: NativePedHaltState,
    input: NativePedHaltInput,
    decision: NativePedHaltDecision,
  ) => readonly string[];
}
export interface OrdinaryPedRecoveryHost<Owner extends object>
  extends NativePedRecoveryEffectsHost<Owner> {
  /** Wire into NativePedGameplay.preflightRecoveryEffects, replacing the generic
   * slick-only preflight. This also checks the living recovery operations. */
  preflightRecoveryEffects: NonNullable<
    NativePedGameplayOptions<Owner>["preflightRecoveryEffects"]
  >;
}
function requirements(
  result: OrdinaryPedRecoveryOperationResult,
): readonly string[] {
  if (
    !result ||
    !["complete", "provider-required"].includes(result.status) ||
    !Array.isArray(result.requiredProviders) ||
    result.requiredProviders.some(
      (name) => typeof name !== "string" || !name.trim(),
    ) ||
    (result.status === "complete" && result.requiredProviders.length !== 0) ||
    (result.status === "provider-required" &&
      result.requiredProviders.length === 0)
  )
    throw new Error(
      "Ordinary pedestrian recovery requires an explicit source operation result",
    );
  return result.requiredProviders;
}

export function createOrdinaryPedRecoveryHost<
  Owner extends object,
  FaceSlot extends object,
>(
  options: OrdinaryPedRecoveryOptions<Owner, FaceSlot>,
): OrdinaryPedRecoveryHost<Owner> {
  const host: OrdinaryPedRecoveryHost<Owner> = {
    readAllocation: (owner) => options.readAllocation(owner),
    readOil: () => options.readOil(),
    readSlick: () => options.readSlick(),
    readMaterials: () => options.readMaterials(),
    statusRecording: options.statusRecording ?? "disabled",
    onSlickResult: options.onSlickResult,
    grounding: {
      releaseFaceCache(owner) {
        // Installed4cbf90..4cbfa9 permits both NULL links. A present borrowed
        // slot is released before clearing process+b0; all other cache state stays.
        const process = options.readProcess(owner);
        if (!process?.faceCache) return;
        const slot = process.faceCache;
        options.releaseBorrowedFaceSlot(slot);
        process.faceCache = null;
      },
    },
    otherEffects: (context, effect, state) => {
      switch (effect.kind) {
        case "recache-ground":
          return options.recacheGround
            ? requirements(
                options.recacheGround(
                  context,
                  { force: effect.force, timeMs: effect.timeMs },
                  state,
                ),
              )
            : ["source-PED07-recache-ground-owner"];
        case "direction":
          return options.setDirection
            ? requirements(
                options.setDirection(
                  context,
                  effect.vector,
                  effect.timeMs,
                  state,
                ),
              )
            : ["source-recovery-direction-owner"];
        case "rescan-proximity":
          return options.rescanProximity
            ? requirements(options.rescanProximity(context, state))
            : ["source-recovery-rescan-proximity-owner"];
        case "scan-objects":
          return options.scanObjects
            ? requirements(options.scanObjects(context, effect.timeMs, state))
            : ["source-recovery-scan-objects-pointer-CRT-owner"];
        default:
          // Gameplay consumes move/action/root/volume/settling itself. Do not
          // accept an unexpected effect just because it reached this adapter.
          return [`source-recovery-${effect.kind}-owner`];
      }
    },
    preflightRecoveryEffects: (context, state, input, decision) => {
      const missing = preflightNativePedRecoveryEffects(
        host,
        context,
        state,
        input,
        decision,
      );
      if (
        decision.kind !== "retry" &&
        decision.kind !== "unsupported" &&
        state.hitPoints > 0
      ) {
        if (!options.recacheGround)
          missing.push("source-PED07-recache-ground-owner");
        if (decision.kind !== "kill-required") {
          if (!options.setDirection)
            missing.push("source-recovery-direction-owner");
          if (!options.rescanProximity)
            missing.push("source-recovery-rescan-proximity-owner");
          if (!options.scanObjects)
            missing.push("source-recovery-scan-objects-pointer-CRT-owner");
        }
      }
      if (options.preflight)
        missing.push(...options.preflight(context, state, input, decision));
      return [...new Set(missing)];
    },
  };
  return host;
}
