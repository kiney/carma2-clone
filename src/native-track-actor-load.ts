/** Independent installed C2 loader pass: FindNonCarsCB 40d1f0 and
 * SetSmashableModel 4f5a50. Resource/physics side effects require actual hosts. */
import {
  enumerateNativeActorChildren,
  type NativeOrderedActor,
} from "./native-actor-order";

export class NativeTrackActorLoadError extends Error {
  constructor(
    readonly code:
      | "invalid-input"
      | "native-fatal"
      | "provider-required"
      | "unsafe-native-output",
    message: string,
  ) {
    super(message);
    this.name = "NativeTrackActorLoadError";
  }
}
const fail = (
  code: NativeTrackActorLoadError["code"],
  message: string,
): never => {
  throw new NativeTrackActorLoadError(code, message);
};
export interface NativeTrackActorSmashSpec {
  model: object | null;
  triggerType: number;
  /** Unsigned source WORD at spec+2ac, not an inferred gameplay name. */
  targetCode: number;
}
export interface NativeTrackActorLoadProviders {
  readModelIdentifier: (model: object) => string | null;
  /** Actual ACT type_data NULL assignment; no body/PHIL enrollment implied. */
  clearTypeData?: (actor: NativeOrderedActor) => void;
  /** Shared local ACT/raw face MAT mutation, only called for pixelBits==16. */
  smoothificatePowerups?: (actor: NativeOrderedActor) => void;
  /** Complete source setup including local pretranslation and MODEL custom fields. */
  setSpinningPowerup?: (actor: NativeOrderedActor, opacity: 0) => void;
  /** Complete shared MODEL duplication/preparation/substitution and pretranslation. */
  setChangingPowerup?: (actor: NativeOrderedActor) => void;
  addSmashableRaceTarget?: (
    model: object,
    actor: NativeOrderedActor,
    index: -1,
  ) => void;
}
export interface NativeTrackActorLoadContext {
  /** Source allocation, including extra slots. Must contain explicit NULLs. */
  rawSlots: (NativeOrderedActor | null)[];
  count: number;
  trackCount: number;
  capacity: number;
  specs: readonly NativeTrackActorSmashSpec[];
  /** Source race +1f0/+1f4; explicit null denotes no qualifying race. */
  race: { type: number; targetCode: number } | null;
  /** Explicit null denotes gNet_mode==0; otherwise net-game+74. */
  netGameType: number | null;
  pixelBits: number;
  providers: NativeTrackActorLoadProviders;
}
function integer(value: number, label: string, max = 0x7fffffff): void {
  if (!Number.isInteger(value) || value < 0 || value > max)
    fail("invalid-input", `${label} is outside its native range`);
}
function nameBytes(name: string): void {
  if (
    typeof name !== "string" ||
    name.includes("\0") ||
    [...name].some((c) => c.charCodeAt(0) > 255)
  )
    fail(
      "invalid-input",
      "ACT identifier must contain native Latin-1 bytes without embedded NUL",
    );
}
function localModel(actor: NativeOrderedActor): object | null {
  const binding = actor.localModel;
  if (!binding.resolved)
    return fail(
      "provider-required",
      binding?.requiredProvider ?? "native local MODEL binding",
    );
  if (
    binding.value === undefined ||
    (binding.value !== null && typeof binding.value !== "object")
  )
    fail(
      "invalid-input",
      "local MODEL must be an object identity or explicit NULL",
    );
  return binding.value;
}
function validate(context: NativeTrackActorLoadContext): void {
  integer(context.count, "noncar count");
  integer(context.trackCount, "track noncar count");
  integer(context.capacity, "noncar capacity");
  if (
    context.capacity < context.count ||
    context.trackCount < context.count ||
    context.rawSlots.length < context.capacity
  )
    fail("invalid-input", "noncar counts exceed supplied allocation");
  if ([...context.rawSlots].some((slot) => slot === undefined))
    fail("invalid-input", "noncar slots require explicit NULL entries");
  integer(context.pixelBits, "pixel bits");
  if (!context.providers?.readModelIdentifier)
    fail("provider-required", "native MODEL identifier provider");
  for (const spec of context.specs) {
    integer(spec.triggerType, "smash trigger type");
    integer(spec.targetCode, "smash target WORD", 0xffff);
    if (spec.model !== null && typeof spec.model !== "object")
      fail("invalid-input", "smash MODEL requires resource identity");
  }
  if (context.race === undefined)
    fail("invalid-input", "race state requires an explicit value or NULL");
  if (context.race) {
    integer(context.race.type, "race type");
    integer(context.race.targetCode, "race target");
  }
  if (context.netGameType !== null)
    integer(context.netGameType, "net game type");
}
function required<T>(value: T | undefined, label: string): T {
  return value ?? fail("provider-required", label);
}
/** Installed sprintf(name+5,"%c%02d",'|',index), after overwriting old suffix
 * with eight spaces. Short names preserve fewer original prefix characters. */
export function rewriteNativeSmashableActorName(
  name: string,
  specIndex: number,
): string {
  nameBytes(name);
  integer(specIndex, "smash spec index");
  if (name.length < 4)
    fail("native-fatal", "smash actor identifier is shorter than four bytes");
  const overwritten = name.slice(0, -4) + "        ";
  const result =
    overwritten.slice(0, 5) +
    "|" +
    String(specIndex).padStart(2, "0") +
    name.slice(-4);
  // Installed temporary name/suffix buffers are finite; reproduce no unchecked writes.
  if (name.length > 63 || result.length > 63)
    fail(
      "unsafe-native-output",
      "smash actor identifier exceeds native scratch storage",
    );
  return result;
}
export function setNativeTrackSmashableModel(
  actor: NativeOrderedActor,
  context: NativeTrackActorLoadContext,
): void {
  validate(context);
  const initial = localModel(actor);
  if (initial === null) return;
  const identifier = context.providers.readModelIdentifier(initial);
  if (identifier === null) return;
  nameBytes(identifier);
  for (let index = 0; index < context.specs.length; index++) {
    const spec = context.specs[index],
      model = localModel(actor);
    if (spec.triggerType !== 1 || spec.model !== model) continue;
    const rewritten = rewriteNativeSmashableActorName(actor.name, index);
    const award =
      (context.race !== null &&
        context.race.type >= 4 &&
        spec.targetCode === context.race.targetCode) ||
      (context.netGameType === 2 && spec.targetCode === 1);
    const target = award
      ? required(
          context.providers.addSmashableRaceTarget,
          "AddSmashableRaceTarget provider",
        )
      : undefined;
    actor.name = rewritten;
    if (target) target(model!, actor, -1);
  }
}
/** Signed char arithmetic; original loader validates only name[1], not these bytes. */
export function nativeTrackNonCarId(name: string): number {
  nameBytes(name);
  if (name.length < 8)
    fail(
      "unsafe-native-output",
      "noncar identifier has fewer than eight readable bytes",
    );
  const signed = (index: number) => {
    const byte = name.charCodeAt(index);
    return byte >= 128 ? byte - 256 : byte;
  };
  return (
    1000 * signed(4) + 100 * signed(5) + 10 * signed(6) + signed(7) - 0xd050
  );
}
export interface NativeTrackNonCarNormalization {
  matrix: number[];
  shifted: boolean;
  normalized: boolean;
  storedSquaredLengths: [number, number, number];
}
/** First undersize comparison uses the live x87 double sum. Subsequent rows,
 * all oversize comparisons and sqrt inputs use Float32-stored sums. */
export function normalizeNativeTrackNonCarMatrix(
  matrix: readonly number[],
): NativeTrackNonCarNormalization {
  if (
    matrix.length !== 12 ||
    !matrix.every(
      (value) => Number.isFinite(value) && Math.fround(value) === value,
    )
  )
    fail("invalid-input", "ACT matrix requires twelve finite Float32 values");
  const result = [...matrix],
    raw = [0, 0, 0];
  for (let row = 0; row < 3; row++) {
    const [x, y, z] = result.slice(row * 3, row * 3 + 3);
    raw[row] = x * x + y * y + z * z;
  }
  const stored = raw.map(Math.fround) as [number, number, number];
  if (!stored.every(Number.isFinite))
    fail(
      "unsafe-native-output",
      "noncar squared axis length overflows Float32",
    );
  const shifted = raw[0] < 0.999 || stored[1] < 0.999 || stored[2] < 0.999;
  const normalized = stored.some((length) => length > 1.001);
  if (shifted) result[9] = Math.fround(result[9] + 2000);
  if (normalized)
    for (let row = 0; row < 3; row++) {
      const reciprocal = Math.fround(1 / Math.sqrt(stored[row]));
      for (let column = 0; column < 3; column++)
        result[row * 3 + column] = Math.fround(
          result[row * 3 + column] * reciprocal,
        );
    }
  if (!result.every(Number.isFinite))
    fail(
      "unsafe-native-output",
      "native noncar normalization produces a nonfinite ACT matrix",
    );
  return { matrix: result, shifted, normalized, storedSquaredLengths: stored };
}
/** Includes the supplied actor. Valid registered noncars do not visit children. */
export function findNativeTrackNonCars(
  actor: NativeOrderedActor,
  context: NativeTrackActorLoadContext,
): 0 | 1 {
  validate(context);
  const visiting = new Set<NativeOrderedActor>();
  function visit(current: NativeOrderedActor): 0 | 1 {
    if (visiting.has(current))
      fail("invalid-input", "cycle in native actor ancestry");
    visiting.add(current);
    try {
      nameBytes(current.name);
      setNativeTrackSmashableModel(current, context);
      if (current.name[0] === "&" && localModel(current) === null)
        fail("native-fatal", `accessory ${current.name} has no local MODEL`);
      if (
        current.name[0] === "&" &&
        current.name[1] >= "0" &&
        current.name[1] <= "9"
      ) {
        const id = nativeTrackNonCarId(current.name);
        if (id < 0 || id >= context.count) return 1;
        const clear = required(
          context.providers.clearTypeData,
          "native ACT type_data NULL provider",
        );
        const normalized = normalizeNativeTrackNonCarMatrix(current.matrix);
        current.matrix = normalized.matrix;
        context.rawSlots[id] = current;
        clear(current);
        return 0;
      }
      if (current.name.charCodeAt(1) === 0xa3) {
        if (current.name.length < 4)
          fail(
            "unsafe-native-output",
            "powerup identifier lacks readable ID bytes",
          );
        if (context.pixelBits === 16 && localModel(current) !== null)
          required(
            context.providers.smoothificatePowerups,
            "native SmoothificatePowerups provider",
          )(current);
        const signed = (i: number) => {
          const c = current.name.charCodeAt(i);
          return c >= 128 ? c - 256 : c;
        };
        const id = 10 * signed(2) + signed(3) - 0x210;
        if (id >= 66 && id <= 85)
          required(
            context.providers.setSpinningPowerup,
            "native SetSpinningPowerup provider",
          )(current, 0);
        if (id >= 86 && id <= 87)
          required(
            context.providers.setChangingPowerup,
            "native SetChangingPowerup provider",
          )(current);
      }
      return enumerateNativeActorChildren(current, visit) === 0 ? 0 : 1;
    } finally {
      visiting.delete(current);
    }
  }
  return visit(actor);
}
/** ActorBox/ProcessModels host seam: begin with the existing child list. */
export function findNativeTrackNonCarChildren(
  parent: NativeOrderedActor,
  context: NativeTrackActorLoadContext,
): 0 | 1 {
  validate(context);
  return enumerateNativeActorChildren(parent, (actor) =>
    findNativeTrackNonCars(actor, context),
  ) === 0
    ? 0
    : 1;
}
/** Installed AssertNonCars is inlined at 40ce83..cef9. The allocation and
 * trailing slots persist; only counts and the compact prefix are changed. */
export function compactNativeTrackNonCars(
  context: NativeTrackActorLoadContext,
): { removedNulls: number; actors: NativeOrderedActor[] } {
  validate(context);
  let removedNulls = 0,
    write = 0;
  const actors: NativeOrderedActor[] = [];
  for (let read = 0; read < context.count; read++) {
    const actor = context.rawSlots[read];
    if (actor === null) {
      removedNulls++;
      continue;
    }
    nameBytes(actor.name);
    if (actor.name.length < 4)
      fail(
        "unsafe-native-output",
        "noncar compaction identifier lacks four-byte prefix",
      );
    context.rawSlots[write] = actor;
    actor.name = actor.name.slice(0, 4) + String(write).padStart(4, "0");
    actors.push(actor);
    write++;
  }
  context.count -= removedNulls;
  context.trackCount -= removedNulls;
  context.capacity -= removedNulls;
  return { removedNulls, actors };
}
