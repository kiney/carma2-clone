/** Independent installed65d050/65d054 head-model sequences and outer update.
 * Actual SetCharacterBoneModelAR/SetCharacterModelAR and replay recording belong
 * to the explicit model owner; this kernel never changes physics or BON clocks. */
export interface NativePedHeadSequence {
  readonly address: 0x65d048 | 0x65d050 | 0x65d054;
  readonly count: number;
  readonly poses: readonly number[];
}
/** Initial object-scan fear finishes at99; repeated fear uses65d050. */
export const nativePedInitialFearHeadSequence: NativePedHeadSequence =
  Object.freeze({
    address: 0x65d048,
    count: 4,
    poses: Object.freeze([1, 2, 1, 99]),
  });
export const nativePedScareHeadSequence: NativePedHeadSequence = Object.freeze({
  address: 0x65d050,
  count: 3,
  poses: Object.freeze([1, 2, 1]),
});
export const nativePedCalmHeadSequence: NativePedHeadSequence = Object.freeze({
  address: 0x65d054,
  count: 2,
  poses: Object.freeze([0, 99]),
});
/** Source process-cache +1c/+1a/+78. A NULL sequence retains index/timestamp. */
export interface NativePedHeadSequenceState {
  sequence: NativePedHeadSequence | null;
  index: number;
  lastChangeTimeMs: number;
}
export interface NativePedHeadActorInput {
  hitPoints: number;
  /** Signed character+4 render slot, not head model pose/state. */
  renderSlot: number;
  /** Signed FORM+4d; negative selects all character bones. */
  headBone: number;
  timeMs: number;
}
export interface NativePedHeadAdvanceInput extends NativePedHeadActorInput {
  replay: boolean;
}
export interface NativePedHeadModelRequest {
  kind: "bone-model" | "all-models";
  headBone: number;
  poseIndex: number;
  modelSet: 0 | 1;
  timeMs: number;
  phase: "start" | "advance";
}
export interface NativePedHeadModelResult {
  status: "complete" | "provider-required";
  requiredProviders: readonly string[];
  /** Native known-NULL requested model returns0; it is still a completed call. */
  nativeModelReturn?: 0 | 1;
}
export interface NativePedHeadSequenceProviders {
  /** Full source AR model outlet, including actual ACT identity and explicitly
   * enabled/disabled replay recording. Negative headBone uses all-models branch. */
  setModels?: (request: NativePedHeadModelRequest) => NativePedHeadModelResult;
}
export interface NativePedHeadSequenceDecision {
  kind: "unchanged" | "start" | "advance" | "end";
  reason?: "dead" | "cache-unavailable" | "replay" | "inactive" | "timer";
  nextState: NativePedHeadSequenceState | null;
  modelRequest: NativePedHeadModelRequest | null;
}
export interface NativePedHeadSequenceResult
  extends NativePedHeadSequenceDecision {
  status: "complete" | "provider-required";
  requiredProviders: string[];
  /** Missing outlet preflight does not consume a source sequence step. A
   * supplied outlet is called AFTER state stores, retaining them on failure. */
  committed: boolean;
  modelResult?: NativePedHeadModelResult;
}
function integer(
  value: number,
  min: number,
  max: number,
  label: string,
): number {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`Native pedestrian head ${label} is out of range`);
  return value;
}
function sequence(value: NativePedHeadSequence): void {
  const installed =
    value.address === 0x65d048
      ? nativePedInitialFearHeadSequence
      : value.address === 0x65d050
        ? nativePedScareHeadSequence
        : value.address === 0x65d054
          ? nativePedCalmHeadSequence
          : null;
  if (
    !installed ||
    value.count !== installed.count ||
    value.poses.length !== value.count ||
    value.poses.some((pose, i) => pose !== installed.poses[i])
  )
    throw new Error(
      "Native pedestrian head requires an installed sequence table",
    );
}
function validate(
  state: NativePedHeadSequenceState | null,
  input: NativePedHeadActorInput,
): void {
  integer(input.hitPoints, -128, 127, "signed-byte HP");
  integer(input.renderSlot, -128, 127, "signed-byte render slot");
  integer(input.headBone, -128, 127, "signed-byte FORM head bone");
  integer(input.timeMs, 0, 0xffffffff, "uint32 time");
  if (state) {
    integer(state.index, 0, 255, "uint8 sequence index");
    integer(state.lastChangeTimeMs, 0, 0xffffffff, "uint32 timestamp");
    if (state.sequence !== null) sequence(state.sequence);
  }
}
function request(
  input: NativePedHeadActorInput,
  poseIndex: number,
  modelSet: 0 | 1,
  phase: NativePedHeadModelRequest["phase"],
): NativePedHeadModelRequest | null {
  if (input.renderSlot < 0) return null;
  return {
    kind: input.headBone < 0 ? "all-models" : "bone-model",
    headBone: input.headBone,
    poseIndex,
    modelSet,
    timeMs: input.timeMs,
    phase,
  };
}
/** Alive/cache gate and first-state writes used by halt/completion/scare callers.
 * The source start operation itself has no replay gate. */
export function decideNativePedHeadSequenceStart(
  state: NativePedHeadSequenceState | null,
  selected: NativePedHeadSequence,
  input: NativePedHeadActorInput,
): NativePedHeadSequenceDecision {
  validate(state, input);
  sequence(selected);
  if (input.hitPoints <= 0 || state === null)
    return {
      kind: "unchanged",
      reason: input.hitPoints <= 0 ? "dead" : "cache-unavailable",
      nextState: state ? { ...state } : null,
      modelRequest: null,
    };
  return {
    kind: "start",
    nextState: { sequence: selected, index: 0, lastChangeTimeMs: input.timeMs },
    modelRequest: request(input, selected.poses[0], 0, "start"),
  };
}
/** Installed4d4cab..4d4da8: unsigned absolute-time gate, one byte increment,
 * wrap to index1, sentinel clear or timestamp store before the AR model call. */
export function decideNativePedHeadSequenceAdvance(
  state: NativePedHeadSequenceState | null,
  input: NativePedHeadAdvanceInput,
): NativePedHeadSequenceDecision {
  validate(state, input);
  if (typeof input.replay !== "boolean")
    throw new Error("Native pedestrian head replay state must be explicit");
  const unchanged = (
    reason: NativePedHeadSequenceDecision["reason"],
  ): NativePedHeadSequenceDecision => ({
    kind: "unchanged",
    reason,
    nextState: state ? { ...state } : null,
    modelRequest: null,
  });
  if (input.replay) return unchanged("replay");
  if (state === null) return unchanged("cache-unavailable");
  if (state.sequence === null) return unchanged("inactive");
  if (input.timeMs <= (state.lastChangeTimeMs + 125) >>> 0)
    return unchanged("timer");
  let index = (state.index + 1) & 255;
  if (index >= state.sequence.count) index = 1;
  const pose = state.sequence.poses[index];
  if (pose === 99)
    return {
      kind: "end",
      nextState: { ...state, index, sequence: null },
      modelRequest: null,
    };
  return {
    kind: "advance",
    nextState: { ...state, index, lastChangeTimeMs: input.timeMs },
    modelRequest: request(input, pose, input.hitPoints <= 0 ? 1 : 0, "advance"),
  };
}
function apply(
  state: NativePedHeadSequenceState | null,
  decision: NativePedHeadSequenceDecision,
  providers: NativePedHeadSequenceProviders,
): NativePedHeadSequenceResult {
  if (decision.modelRequest && !providers.setModels)
    return {
      ...decision,
      status: "provider-required",
      committed: false,
      requiredProviders: [
        decision.modelRequest.kind === "all-models"
          ? "native-head-all-models-AR-provider"
          : "native-head-bone-model-AR-provider",
      ],
    };
  if (state && decision.nextState && decision.kind !== "unchanged") {
    state.sequence = decision.nextState.sequence;
    state.index = decision.nextState.index;
    state.lastChangeTimeMs = decision.nextState.lastChangeTimeMs;
  }
  const modelResult = decision.modelRequest
    ? providers.setModels!(decision.modelRequest)
    : undefined;
  if (
    modelResult &&
    modelResult.status !== "complete" &&
    modelResult.status !== "provider-required"
  )
    throw new Error(
      "Native pedestrian head model outlet must resolve explicitly",
    );
  if (decision.modelRequest && !modelResult)
    throw new Error(
      "Native pedestrian head requires an actual model outlet result",
    );
  if (
    modelResult &&
    (!Array.isArray(modelResult.requiredProviders) ||
      modelResult.requiredProviders.some(
        (name) => typeof name !== "string" || !name.trim(),
      ) ||
      (modelResult.status === "provider-required" &&
        modelResult.requiredProviders.length === 0) ||
      (modelResult.status === "complete" &&
        modelResult.requiredProviders.length !== 0) ||
      (modelResult.nativeModelReturn !== undefined &&
        modelResult.nativeModelReturn !== 0 &&
        modelResult.nativeModelReturn !== 1))
  )
    throw new Error(
      "Native pedestrian head model outlet has invalid resolution",
    );
  return {
    ...decision,
    status: modelResult?.status ?? "complete",
    requiredProviders: [...(modelResult?.requiredProviders ?? [])],
    committed: decision.kind !== "unchanged",
    ...(modelResult ? { modelResult } : {}),
  };
}
export function startNativePedHeadSequence(
  state: NativePedHeadSequenceState | null,
  selected: NativePedHeadSequence,
  input: NativePedHeadActorInput,
  providers: NativePedHeadSequenceProviders = {},
): NativePedHeadSequenceResult {
  return apply(
    state,
    decideNativePedHeadSequenceStart(state, selected, input),
    providers,
  );
}
export function advanceNativePedHeadSequence(
  state: NativePedHeadSequenceState | null,
  input: NativePedHeadAdvanceInput,
  providers: NativePedHeadSequenceProviders = {},
): NativePedHeadSequenceResult {
  return apply(
    state,
    decideNativePedHeadSequenceAdvance(state, input),
    providers,
  );
}
/** Installed4ccd44 when the real KillPedestrian branch requests this effect.
 * The caller owns that branch's gore/volume eligibility; only its pointer clears. */
export function clearNativePedHeadSequence(
  state: NativePedHeadSequenceState | null,
): void {
  if (state) state.sequence = null;
}
