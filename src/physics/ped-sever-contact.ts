import {
  resolvePedContactDamage,
  type PedContactForm,
  type PedContactState,
} from "./ped-contact";
import {
  mutateNativePedSever,
  type NativePedSeverInput,
  type NativePedSeverProviders,
  type NativePedSeverState,
  type NativePedSeverTailContext,
  type NativePedSeverKillModelEffect,
  type NativePedSeverResult,
} from "./ped-sever";

export interface PedDamageTailRequest {
  damage: number;
  form: PedContactForm;
  state: PedContactState;
  aliveMove: number;
  deadMove: number;
}

export type PedDamageHealth = ReturnType<typeof resolvePedContactDamage>;
export interface PedDamageTailResult {
  health: PedDamageHealth | null;
  unresolved: string[];
  receipt: PedSeverContactReceipt;
}

export interface PedSeverContactReceipt {
  status: "complete" | "provider-required";
  damage: number;
  tailInvoked: boolean;
  callerInvoked: boolean;
  health: PedDamageHealth | null;
  unresolved: string[];
  severResult: NativePedSeverResult<PedDamageHealth> | null;
}

export interface PedSeverContactProviders<Actor, Model, Body> {
  /** Actual source hit reaction/noise continuations; no generic effects are made. */
  onReaction: (health: PedDamageHealth) => void;
  onNoise: (health: PedDamageHealth) => void;
  /** Called only for a newly killed live ped, after HP/reaction/noise. */
  onKill?: (
    health: PedDamageHealth,
    context: NativePedSeverTailContext,
  ) => void;
  /** Existing contact caller after the common HP/reaction/noise tail. */
  callerContinuation: (
    health: PedDamageHealth,
    context: NativePedSeverTailContext,
  ) => void;
  /** Real model-owner callback used only if onKill requests emitted model phases. */
  applyKillModelEffect?: (effect: NativePedSeverKillModelEffect) => void;
  sever: Omit<
    NativePedSeverProviders<Actor, Model, Body, PedDamageHealth>,
    "commonTail" | "callerContinuation" | "applyKillModelEffect" | "onEffect"
  > & {
    onEffect?: NativePedSeverProviders<
      Actor,
      Model,
      Body,
      PedDamageHealth
    >["onEffect"];
  };
}

export interface PedSeverContactOptions<Actor, Model, Body> {
  /** Mutable instance state shared with the native sever body/cache providers. */
  state: NativePedSeverState;
  /** Per-contact source gates/settings; normalizedDamage is supplied by the tail. */
  input: Omit<NativePedSeverInput, "normalizedDamage">;
  providers: PedSeverContactProviders<Actor, Model, Body>;
}

/**
 * Builds the one-shot damage-tail callback consumed by active/passive contact
 * dispatch. Severing runs before HP; the exact common HP kernel runs once with
 * the post-sever mask/head state. A receipt prevents any tail/caller replay if
 * an upstream caller retries after a partially completed native phase.
 */
export function createPedSeverDamageTail<Actor, Model, Body>(
  options: PedSeverContactOptions<Actor, Model, Body>,
): {
  damageTail: (request: PedDamageTailRequest) => PedDamageTailResult;
  get receipt(): PedSeverContactReceipt | null;
} {
  let receipt: PedSeverContactReceipt | null = null;
  let inProgress = false;
  const damageTail = (request: PedDamageTailRequest): PedDamageTailResult => {
    if (receipt)
      return {
        health: null,
        unresolved: ["native-damage-tail-already-received"],
        receipt,
      };
    if (inProgress)
      return {
        health: null,
        unresolved: ["native-damage-tail-reentry"],
        receipt: {
          status: "provider-required",
          damage: request.damage,
          tailInvoked: false,
          callerInvoked: false,
          health: null,
          unresolved: ["native-damage-tail-reentry"],
          severResult: null,
        },
      };
    inProgress = true;
    const priorMissing: string[] = [];
    if (!options.providers.onReaction)
      priorMissing.push("source-reaction-provider");
    if (!options.providers.onNoise) priorMissing.push("source-noise-provider");
    if (!options.providers.callerContinuation)
      priorMissing.push("source-contact-caller-continuation");
    if (request.form.boneCount !== options.input.form.bones.length)
      priorMissing.push("matching-contact-FORM-bone-count");
    if (request.form.nonHumanoid !== options.input.form.nonHumanoid)
      priorMissing.push("matching-contact-FORM-humanoid-kind");
    if (priorMissing.length) {
      receipt = {
        status: "provider-required",
        damage: request.damage,
        tailInvoked: false,
        callerInvoked: false,
        health: null,
        unresolved: priorMissing,
        severResult: null,
      };
      return { health: null, unresolved: [...priorMissing], receipt };
    }

    // These live fields come from the same contact packet as common HP damage;
    // keep the sever gate and mutable instance HP on that exact source state.
    options.state.hitPoints = request.state.hitPoints;
    let health: PedDamageHealth | null = null;
    const unresolved: string[] = [];
    const providers: NativePedSeverProviders<
      Actor,
      Model,
      Body,
      PedDamageHealth
    > = {
      ...options.providers.sever,
      applyKillModelEffect: options.providers.applyKillModelEffect,
      commonTail: (context) => {
        const state: PedContactState = {
          ...request.state,
          hitPoints: options.state.hitPoints,
          removedBoneMask: context.removedBoneMask,
          headMissing: context.headMissing,
        };
        health = resolvePedContactDamage(
          context.normalizedDamage,
          request.form,
          state,
          request.aliveMove,
          request.deadMove,
        );
        options.state.hitPoints = health.hitPoints;
        options.providers.onReaction(health);
        options.providers.onNoise(health);
        if (health.killed) {
          if (options.providers.onKill)
            options.providers.onKill(health, context);
          else unresolved.push("source-actual-kill-provider");
        }
        return health;
      },
      callerContinuation: (tailHealth, context) => {
        options.providers.callerContinuation(tailHealth, context);
      },
    };
    const severResult = mutateNativePedSever(
      options.state,
      {
        ...options.input,
        normalizedDamage: request.damage,
        goreLevel: request.state.goreLevel,
        immortal: request.state.immortal,
        brittle: request.state.brittle,
        exploding: request.state.exploding,
      },
      providers,
    );
    const finalUnresolved = [
      ...new Set([...severResult.requiredProviders, ...unresolved]),
    ];
    receipt = {
      status:
        severResult.status === "provider-required" || finalUnresolved.length
          ? "provider-required"
          : "complete",
      damage: request.damage,
      tailInvoked: severResult.tailInvoked,
      callerInvoked: severResult.callerInvoked,
      health: severResult.tailInvoked ? health : null,
      unresolved: finalUnresolved,
      severResult,
    };
    return {
      health: receipt.health,
      unresolved: [...receipt.unresolved],
      receipt,
    };
  };
  return {
    damageTail,
    get receipt() {
      return receipt;
    },
  };
}
