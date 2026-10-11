import type { PedBounds, PedForm, PedFormBone, PedVector } from "../ped-form";

const f = Math.fround;
/** Installed4cc860 type5 body filters, independent of the retained simple body. */
export const nativePedSeverBodyPolicy = {
  rigidType: 5,
  filterA: 0x40000,
  filterB: 0x50000,
} as const;
export interface NativePedSeverState {
  removedBoneMask: number;
  vanishedBoneMask: number;
  bonedSlot: number;
  hitPoints: number;
  physicsActive: boolean;
  characterVelocity: PedVector;
  cache: { stumpCounters: Uint8Array; flags: number } | null;
}
export interface NativePedSeverInput {
  /** Already normalized integer4cd427. Budget spending never changes this D. */
  normalizedDamage: number;
  otherPresent: boolean;
  goreLevel: number;
  immortal: boolean;
  brittle: boolean;
  exploding: boolean;
  articulated: boolean;
  form: Pick<PedForm, "bones" | "headBone" | "nonHumanoid" | "maxBoned">;
  severDamage: number;
  severChance: number;
  /** Source stump-settings total-parts integer692ae4, not a fake timer. */
  dismemberSpurtCount: number;
  /** Reject oversized/nonprogressing work; never truncate a native loop. */
  maximumAttempts?: number;
}
export interface NativePedSeverBoneSnapshot<Actor, Model> {
  actor: Actor;
  model: Model;
  nativePose: ArrayLike<number>;
  /** Bounds of the CURRENT model after its authored per-bone remap. */
  bounds: PedBounds;
}
export interface NativePedSeverBoneRequest<Actor, Model> {
  index: number;
  slot: number;
  bone: Readonly<PedFormBone>;
  snapshot: NativePedSeverBoneSnapshot<Actor, Model>;
  rigidType: 5;
  filterA: 0x40000;
  filterB: 0x50000;
  localOmega: PedVector;
  /** null means setup succeeded without the character-active tail. */
  activation: {
    velocity: PedVector;
    gravity: 1;
    clearProperties: readonly [3, 4, 5];
    clearDoNothing: true;
    enableHalt: true;
  } | null;
  clearParentJoint: true;
  clearChildren: true;
  clearLink188: true;
}
export interface NativePedSeverRegistration<Body> {
  body: Body;
  rigidType: 5;
  filterA: 0x40000;
  filterB: 0x50000;
}
export type NativePedSeverKillModelEffect =
  | { kind: "dead-model-all"; pose: 0; modelSet: 1 }
  | { kind: "dead-model-head"; index: number; pose: 2; modelSet: 1 }
  | { kind: "clear-head-sequence" };
export type NativePedSeverEffect =
  | { kind: "budget"; remaining: number; successfulCount: number }
  | { kind: "chance"; accepted: boolean }
  | { kind: "selection"; index: number }
  | { kind: "stump-counter"; index: number; value: number }
  | { kind: "reserve-slot"; slot: number | null }
  | { kind: "already-removed"; index: number }
  | { kind: "spin"; index: number; omega: PedVector }
  | { kind: "registration"; index: number; accepted: boolean }
  | { kind: "mask"; index: number; removedBoneMask: number }
  | { kind: "detach"; index: number; oldSlot: number; newSlot: number }
  | { kind: "many-parts"; successfulCount: number }
  /** Notification only: HP/reaction/noise still precede actual Kill models. */
  | { kind: "head-kill-required"; index: number }
  | NativePedSeverKillModelEffect
  | { kind: "common-tail" }
  | { kind: "caller-continuation" };
export interface NativePedSeverTailContext {
  normalizedDamage: number;
  removedBoneMask: number;
  headMissing: boolean;
  newlyDetached: number;
  /** Invoke at the actual ordinary Kill phase, after HP/reaction/noise selection.
   * The common-tail owner may instead perform its full native Kill directly.
   * This hook does not fabricate score, giblets, race count or death time. */
  emitKillModelEffects: () => void;
}
export interface NativePedSeverProviders<Actor, Model, Body, Tail> {
  nextCrtInteger?: () => number;
  /** null is native pool exhaustion. Reservation is retained on later failure. */
  reserveBonedSlot?: () => number | null;
  /** Read-only source snapshot provider: validation may inspect every remaining
   * bone before draws. It must not mutate scene/body/cache/RNG ownership. */
  readBone?: (index: number) => NativePedSeverBoneSnapshot<Actor, Model> | null;
  /** Setup/PHIL registration occurs before the missing-mask mutation. */
  registerBone?: (
    request: NativePedSeverBoneRequest<Actor, Model>,
  ) => NativePedSeverRegistration<Body> | null;
  /** Runs AFTER successful registration and missing-mask mutation. Apply link
   * removal/activation, source actor ownership and replay effects in this owner. */
  commitBone?: (
    request: NativePedSeverBoneRequest<Actor, Model>,
    registration: NativePedSeverRegistration<Body>,
    oldSlot: number,
  ) => void;
  /** Full existing HP/reaction/kill continuation, called once even after native
   * chance/pool/register failure. It owns all additional shared CRT effects. */
  commonTail?: (context: NativePedSeverTailContext) => Tail;
  callerContinuation?: (tail: Tail, context: NativePedSeverTailContext) => void;
  applyKillModelEffect?: (effect: NativePedSeverKillModelEffect) => void;
  onEffect?: (effect: NativePedSeverEffect) => void;
}
export interface NativePedSeverAttempt {
  remainingBudget: number;
  chanceAccepted: boolean;
  selectedIndex: number | null;
  newlyDetached: number;
}
export interface NativePedSeverResult<Tail> {
  status: "complete" | "provider-required";
  requiredProviders: string[];
  normalizedDamage: number;
  remainingBudget: number;
  newlyDetached: number;
  removedBoneMask: number;
  randomDraws: number;
  attempts: NativePedSeverAttempt[];
  effects: NativePedSeverEffect[];
  tailInvoked: boolean;
  callerInvoked: boolean;
  tailResult: Tail | undefined;
}
function integer(n: number, lo: number, hi: number, what: string): number {
  if (!Number.isInteger(n) || n < lo || n > hi)
    throw new RangeError(`Invalid native pedestrian sever ${what}`);
  return n;
}
function scalar(n: number): number {
  const value = f(n);
  if (!Number.isFinite(value))
    throw new RangeError("Non-finite native pedestrian sever scalar");
  return value;
}
function vector(v: PedVector): PedVector {
  if (v.length !== 3) throw new RangeError("Invalid sever vector");
  return [scalar(v[0]), scalar(v[1]), scalar(v[2])];
}
function bit(index: number): number {
  return (1 << index) >>> 0;
}
function snapshot<Actor, Model>(
  value: NativePedSeverBoneSnapshot<Actor, Model>,
): NativePedSeverBoneSnapshot<Actor, Model> {
  if (
    value.actor == null ||
    value.model == null ||
    value.nativePose.length !== 12
  )
    throw new RangeError("Invalid source sever bone actor/model/pose");
  const min = vector(value.bounds.min),
    max = vector(value.bounds.max);
  if (max.some((n, i) => n <= min[i]))
    throw new RangeError("Degenerate source sever bone model bounds");
  return {
    actor: value.actor,
    model: value.model,
    nativePose: Float32Array.from(value.nativePose, scalar),
    bounds: { min, max },
  };
}
function validate(
  state: NativePedSeverState,
  input: NativePedSeverInput,
): void {
  integer(input.normalizedDamage, -0x80000000, 0x7fffffff, "damage");
  integer(input.goreLevel, 0, 0x7fffffff, "gore level");
  integer(input.severDamage, 1, 0x7fffffff, "threshold");
  integer(input.severChance, 0, 100, "chance");
  integer(input.dismemberSpurtCount, 0, 0x7fffffff, "stump count");
  const count = integer(input.form.bones.length, 1, 32, "bone count");
  integer(input.form.maxBoned, 0, 128, "boned capacity");
  integer(input.form.headBone, 0, count - 1, "head index");
  integer(state.bonedSlot, -1, input.form.maxBoned - 1, "boned slot");
  integer(state.removedBoneMask, 0, 0xffffffff, "removed mask");
  integer(state.vanishedBoneMask, 0, 0xffffffff, "vanished mask");
  const validMask = count === 32 ? 0xffffffff : 2 ** count - 1;
  if ((state.removedBoneMask | state.vanishedBoneMask) >>> 0 > validMask)
    throw new RangeError("Sever mask exceeds FORM bones");
  integer(state.hitPoints, -128, 127, "hit points");
  vector(state.characterVelocity);
  if (state.cache) {
    integer(state.cache.flags, 0, 0xffff, "cache flags");
    if (state.cache.stumpCounters.length < count)
      throw new RangeError("Incomplete source stump counter cache");
  }
  // Independently validate a rooted tree; arbitrary source index ordering is
  // accepted, but cycles/disconnected roots must not become unbounded recursion.
  input.form.bones.forEach((bone, index) => {
    if (index === 0) {
      if (bone.parent !== -1) throw new RangeError("Invalid sever root");
    } else integer(bone.parent!, 0, count - 1, "parent");
    if (!(scalar(bone.mass) > 0))
      throw new RangeError("Source sever requires a massive bone body");
    const seen = new Set<number>();
    let ancestor = index;
    while (ancestor !== 0) {
      if (seen.has(ancestor)) throw new RangeError("Cyclic sever FORM tree");
      seen.add(ancestor);
      ancestor = integer(
        input.form.bones[ancestor].parent!,
        0,
        count - 1,
        "parent",
      );
    }
  });
}
/** Ordinary installed Kill model mutations. Special-volume/gore gates and
 * full score/death/blood behavior belong to the common-tail owner. */
export function nativePedSeverKillModelEffects(
  headIndex: number,
): NativePedSeverKillModelEffect[] {
  integer(headIndex, 0, 31, "head index");
  return [
    { kind: "dead-model-all", pose: 0, modelSet: 1 },
    { kind: "dead-model-head", index: headIndex, pose: 2, modelSet: 1 },
    { kind: "clear-head-sequence" },
  ];
}
/** Installed4cd480/4cd790/40b860 ordinary severing. Sever/continuation capabilities
 * preflight before draws; native false results ALWAYS resume the supplied tail.
 * The optional Kill-model hook reports a missing owner at its actual tail phase.
 * No implicit generic articulation, exploding velocity, cache or CRT provider. */
export function mutateNativePedSever<Actor, Model, Body, Tail>(
  state: NativePedSeverState,
  input: NativePedSeverInput,
  providers: NativePedSeverProviders<Actor, Model, Body, Tail>,
): NativePedSeverResult<Tail> {
  validate(state, input);
  const effects: NativePedSeverEffect[] = [],
    attempts: NativePedSeverAttempt[] = [],
    required: string[] = [],
    snapshots = new Map<number, NativePedSeverBoneSnapshot<Actor, Model>>();
  let remaining = f(input.normalizedDamage),
    newlyDetached = 0,
    randomDraws = 0,
    tailInvoked = false,
    callerInvoked = false,
    tailResult: Tail | undefined;
  const emit = (effect: NativePedSeverEffect) => {
    effects.push(effect);
    providers.onEffect?.(effect);
  };
  const finish = (): NativePedSeverResult<Tail> => ({
    status: required.length ? "provider-required" : "complete",
    requiredProviders: [...new Set(required)],
    normalizedDamage: input.normalizedDamage,
    remainingBudget: remaining,
    newlyDetached,
    removedBoneMask: state.removedBoneMask,
    randomDraws,
    attempts,
    effects,
    tailInvoked,
    callerInvoked,
    tailResult,
  });
  const threshold = input.brittle ? 5 : input.severDamage;
  const gate = input.otherPresent && !input.immortal && input.goreLevel >= 2;
  const attemptsPossible = gate && remaining - threshold >= 0;
  const selectionPossible =
    attemptsPossible && (input.brittle || input.severChance > 0);
  if (!providers.commonTail) required.push("source-common-HP-kill-tail");
  if (!providers.callerContinuation)
    required.push("source-contact-caller-continuation");
  if (attemptsPossible && input.exploding)
    required.push("source-exploding-sever-velocity-provider");
  if (selectionPossible && input.articulated)
    required.push("source-articulated-joint-sever-provider");
  if (selectionPossible && input.form.nonHumanoid)
    required.push("source-nonhumanoid-sever-provider");
  if (attemptsPossible) {
    const limit = integer(
      input.maximumAttempts ?? 65536,
      1,
      1_000_000,
      "work limit",
    );
    if (
      f(remaining - threshold) >= remaining ||
      Math.floor(remaining / threshold) > limit
    )
      throw new RangeError("Unbounded/nonprogressing native sever budget");
  }
  if (selectionPossible) {
    if (input.form.bones.length < 2)
      throw new RangeError("No valid native non-root sever selection range");
    if (!state.cache) required.push("source-stump-cache-provider");
    if (!providers.nextCrtInteger) required.push("shared-CRT-provider");
    const anyRemaining = input.form.bones.some(
      (_, i) => i !== 0 && !(state.removedBoneMask & bit(i)),
    );
    if (anyRemaining) {
      if (!providers.readBone)
        required.push("source-bone-actor-model-provider");
      if (state.bonedSlot < 0 && !providers.reserveBonedSlot)
        required.push("source-boned-slot-reservation-provider");
      if (!providers.registerBone)
        required.push("source-bone-PHIL-registration-provider");
      if (!providers.commitBone)
        required.push("source-bone-detach-activation-provider");
      if (providers.readBone)
        for (let i = 1; i < input.form.bones.length; i++)
          if (!(state.removedBoneMask & bit(i))) {
            const value = providers.readBone(i);
            if (value === null) required.push(`source-bone-actor-model-${i}`);
            else snapshots.set(i, snapshot(value));
          }
    }
  }
  if (required.length) return finish();
  const draw = () => {
    const n = integer(providers.nextCrtInteger!(), 0, 32767, "CRT result");
    randomDraws++;
    return n;
  };
  const one = (index: number): number => {
    const oldSlot = state.bonedSlot;
    if (state.removedBoneMask & bit(index)) {
      emit({ kind: "already-removed", index });
      return 0;
    }
    if (state.bonedSlot < 0) {
      const slot = providers.reserveBonedSlot!();
      if (slot !== null)
        integer(slot, 0, input.form.maxBoned - 1, "reserved slot");
      emit({ kind: "reserve-slot", slot });
      if (slot === null) return 0;
      state.bonedSlot = slot;
    }
    const omega: PedVector = [
      f(-1 + (2 * draw()) / 32768),
      f(-1 + (2 * draw()) / 32768),
      f(-1 + (2 * draw()) / 32768),
    ];
    emit({ kind: "spin", index, omega });
    const request: NativePedSeverBoneRequest<Actor, Model> = {
      index,
      slot: state.bonedSlot,
      bone: input.form.bones[index],
      snapshot: snapshots.get(index)!,
      ...nativePedSeverBodyPolicy,
      localOmega: omega,
      // PHIL setup must not consume a stale pre-registration character V.
      activation: null,
      clearParentJoint: true,
      clearChildren: true,
      clearLink188: true,
    };
    const registration = providers.registerBone!(request);
    if (
      registration !== null &&
      (registration.rigidType !== 5 ||
        registration.filterA !== 0x40000 ||
        registration.filterB !== 0x50000 ||
        registration.body == null)
    )
      throw new RangeError(
        "Native sever registration violated type5/filter policy",
      );
    emit({ kind: "registration", index, accepted: registration !== null });
    if (registration === null) return 0;
    state.removedBoneMask = (state.removedBoneMask | bit(index)) >>> 0;
    emit({ kind: "mask", index, removedBoneMask: state.removedBoneMask });
    // Installed40b983/40b995 reads the LIVE character flag/V after setup,
    // mask mutation and link removal. Registration can synchronously prepare
    // another object; never capture activation before that provider returns.
    request.activation = state.physicsActive
      ? {
          velocity: vector(state.characterVelocity),
          gravity: 1,
          clearProperties: [3, 4, 5],
          clearDoNothing: true,
          enableHalt: true,
        }
      : null;
    providers.commitBone!(request, registration, oldSlot);
    emit({ kind: "detach", index, oldSlot, newSlot: state.bonedSlot });
    return 1;
  };
  const subtree = (index: number): number => {
    let count = 0;
    for (let child = 0; child < input.form.bones.length; child++)
      if (
        input.form.bones[child].parent === index &&
        !(state.removedBoneMask & bit(child))
      )
        count += subtree(child);
    const value = input.dismemberSpurtCount & 255;
    state.cache!.stumpCounters[index] = value;
    emit({ kind: "stump-counter", index, value });
    return count + one(index);
  };
  if (gate)
    while (true) {
      const difference = remaining - threshold;
      remaining = f(difference);
      emit({ kind: "budget", remaining, successfulCount: newlyDetached });
      if (difference < 0 || newlyDetached >= 5) break;
      const accepted =
        input.brittle ||
        (input.severChance !== 0 &&
          Math.floor((draw() * 100) / 32768) < input.severChance);
      emit({ kind: "chance", accepted });
      const attempt: NativePedSeverAttempt = {
        remainingBudget: remaining,
        chanceAccepted: accepted,
        selectedIndex: null,
        newlyDetached: 0,
      };
      attempts.push(attempt);
      if (!accepted) continue;
      const index =
        1 + Math.floor((draw() * (input.form.bones.length - 1)) / 32768);
      emit({ kind: "selection", index });
      attempt.selectedIndex = index;
      attempt.newlyDetached = subtree(index);
      newlyDetached += attempt.newlyDetached;
    }
  if (newlyDetached > 4) {
    state.cache!.flags |= 2;
    emit({ kind: "many-parts", successfulCount: newlyDetached });
  }
  const headMissing = !!(state.removedBoneMask & bit(input.form.headBone));
  if (state.hitPoints > 0 && headMissing)
    emit({ kind: "head-kill-required", index: input.form.headBone });
  let killModelEffectsEmitted = false;
  const context: NativePedSeverTailContext = {
    normalizedDamage: input.normalizedDamage,
    removedBoneMask: state.removedBoneMask,
    headMissing,
    newlyDetached,
    emitKillModelEffects: () => {
      if (killModelEffectsEmitted) return;
      if (!providers.applyKillModelEffect) {
        required.push("source-dead-model-head-sequence-provider");
        return;
      }
      killModelEffectsEmitted = true;
      for (const effect of nativePedSeverKillModelEffects(
        input.form.headBone,
      )) {
        emit(effect);
        providers.applyKillModelEffect(effect);
      }
    },
  };
  tailInvoked = true;
  emit({ kind: "common-tail" });
  tailResult = providers.commonTail!(context);
  // A missing requested kill-model implementation is not a native chance/
  // allocation failure. Do not repeat an already invoked HP tail to resume it.
  if (required.length) return finish();
  callerInvoked = true;
  emit({ kind: "caller-continuation" });
  providers.callerContinuation!(tailResult, context);
  return finish();
}
