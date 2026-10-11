/** Independent contact kernels verified against installed C2 HW. See the RE note. */
export interface PedContactVector {
  x: number;
  y: number;
  z: number;
}
export interface PedContactSettings {
  severDamage: number;
  severChance: number;
  maxSurvivableInitialImpact: number;
  damagePerForce: number;
}
export interface PedContactForm {
  /** Original personality +0x4c, in tonnes; not kilograms. */
  personalityMass: number;
  /** Original selected simple physics object's +4, in tonnes. */
  simpleBodyMass: number;
  boneCount: number;
  nonHumanoid: boolean;
}
export interface PedContactState {
  hitPoints: number;
  flags: number;
  immortal: boolean;
  exploding: boolean;
  brittle: boolean;
  goreLevel: number;
  /** State AFTER an externally handled severing outlet, if one was required. */
  removedBoneMask: number;
  headMissing: boolean;
}
export interface PedContactOther {
  type: number;
  ownerPresent: boolean;
  mass: number;
  velocity: PedContactVector;
}
export interface PedContactInputs {
  settings: PedContactSettings;
  form: PedContactForm;
  state: PedContactState;
  other: PedContactOther | null;
  /** Original special type32 mass global +0x703d14. Unknown provider stays explicit. */
  specialMass?: number;
}
export interface PassivePedContactPacket extends PedContactInputs {
  characterVelocity: PedContactVector;
  pedRigidType: number;
  impactCount: number;
}
export interface ActivePedContactPacket extends PedContactInputs {
  pedRigidType: number;
  pedOwnerPresent: boolean;
  replay: boolean;
  /** Group sum gates the dispatcher, but does not determine contact HP damage. */
  totalLambda: number;
  /** Solved lambda belonging to the first selected row of that group. */
  firstRowLambda: number;
  pedVelocityY: number;
  /** Per-ped force already transformed by the source rigid basis; no 6.9 scale. */
  worldForce: PedContactVector;
  /** First selected row's source face plane normal, or null. */
  faceNormal: PedContactVector | null;
}

const f = Math.fround;
const finite = (n: number, name: string) => {
  if (!Number.isFinite(n)) throw new RangeError(`Invalid ${name}`);
  return n;
};
const scalar = (n: number, name: string) => finite(f(finite(n, name)), name);
const integer = (n: number, low: number, high: number, name: string) => {
  if (!Number.isInteger(n) || n < low || n > high)
    throw new RangeError(`Invalid ${name}`);
  return n;
};
const sourceInt = (n: number) =>
  integer(
    Math.trunc(finite(n, "native integer conversion")),
    -0x80000000,
    0x7fffffff,
    "native integer conversion",
  );
const vector = (v: PedContactVector): PedContactVector => ({
  x: scalar(v.x, "vector X"),
  y: scalar(v.y, "vector Y"),
  z: scalar(v.z, "vector Z"),
});
const signedByte = (n: number) => ((n + 128) & 255) - 128;

/** The first twelve non-comment settings records; no label matching or defaults. */
export function parsePedContactSettings(text: string): PedContactSettings {
  const rows = text
    .split(/\r?\n/)
    .map((row) => row.split("//")[0].trim())
    .filter(Boolean);
  if (rows.length < 12)
    throw new Error("Incomplete pedestrian contact settings");
  const result = {
    severDamage: Number(rows[8]),
    severChance: Number(rows[9]),
    maxSurvivableInitialImpact: scalar(
      Number(rows[10]),
      "maximum initial impact",
    ),
    damagePerForce: scalar(Number(rows[11]), "damage per force"),
  };
  validateSettings(result);
  return result;
}
function validateSettings(s: PedContactSettings) {
  integer(s.severDamage, 1, 0x7fffffff, "sever damage");
  integer(s.severChance, 0, 100, "sever chance");
  if (
    scalar(s.maxSurvivableInitialImpact, "maximum initial impact") <= 0 ||
    scalar(s.damagePerForce, "damage per force") < 0
  )
    throw new RangeError("Invalid pedestrian contact settings");
}
function validate(input: PedContactInputs) {
  validateSettings(input.settings);
  const form = input.form,
    state = input.state;
  if (
    scalar(form.personalityMass, "personality mass") <= 0 ||
    scalar(form.simpleBodyMass, "simple body mass") <= 0
  )
    throw new RangeError("Invalid pedestrian mass");
  integer(form.boneCount, 1, 255, "bone count");
  integer(state.hitPoints, -128, 127, "hit points");
  integer(state.flags, 0, 0xffff, "pedestrian flags");
  integer(state.goreLevel, 0, 0x7fffffff, "gore level");
  integer(state.removedBoneMask, 0, 0xffffffff, "removed bone mask");
  if (input.other) {
    integer(input.other.type, 0, 255, "other rigid type");
    if (scalar(input.other.mass, "other mass") < 0)
      throw new RangeError("Invalid other mass");
    vector(input.other.velocity);
  }
  if (input.specialMass !== undefined)
    scalar(input.specialMass, "special mass");
}
function specialImpact(input: PedContactInputs) {
  const other = input.other;
  return (
    !!other &&
    other.ownerPresent &&
    other.type === 32 &&
    input.specialMass !== undefined &&
    scalar(other.mass, "other mass") ===
      scalar(input.specialMass, "special mass")
  );
}

/** Installed 4cd3f0: integer input, live double ratio squared, then truncation. */
export function normalisePedContactDamage(
  rawDamage: number,
  form: PedContactForm,
  state: PedContactState,
) {
  integer(rawDamage, -0x80000000, 0x7fffffff, "raw damage");
  const mass = scalar(form.simpleBodyMass, "simple body mass");
  if (mass <= 0) throw new RangeError("Invalid simple body mass");
  const ratio = 0.068 / mass;
  let damage = sourceInt(ratio * ratio * rawDamage);
  if (form.nonHumanoid && (state.exploding || state.brittle) && damage < 100)
    damage = 100;
  return damage;
}

/** Common HP tail only. Bone severing must be handled before supplying this state. */
export function resolvePedContactDamage(
  damage: number,
  form: PedContactForm,
  state: PedContactState,
  aliveMove: number,
  deadMove: number,
) {
  integer(damage, -0x80000000, 0x7fffffff, "damage");
  integer(state.hitPoints, -128, 127, "hit points");
  let hp = state.hitPoints,
    effectiveDamage = damage;
  const wasAlive = hp > 0;
  if (wasAlive) {
    if (form.nonHumanoid && state.removedBoneMask !== 0) {
      hp = 0;
      effectiveDamage = 0;
    }
    if (state.headMissing || effectiveDamage >= 100) hp = 0;
    else hp = signedByte(hp - effectiveDamage);
    if (state.immortal && hp <= 0) hp = 1;
  }
  return {
    damage,
    effectiveDamage,
    hitPoints: hp,
    wasAlive,
    killed: wasAlive && hp <= 0,
    survived: wasAlive && hp > 0,
    reactionMoveId: wasAlive ? (hp > 0 ? aliveMove : deadMove) : -1,
    reactionAction: 5,
  };
}
function diagnostics(input: PedContactInputs, damage: number) {
  const unresolved: string[] = [];
  if (
    input.other?.type === 32 &&
    input.other.ownerPresent &&
    input.specialMass === undefined
  )
    unresolved.push("special-type32-mass");
  if (
    input.other &&
    !input.state.immortal &&
    input.state.goreLevel >= 2 &&
    damage >= (input.state.brittle ? 5 : input.settings.severDamage)
  )
    unresolved.push("bone-severing-outlet-before-HP-tail");
  return unresolved;
}

/** Activation callback 4cd9b0. This computes no impulse and draws no RNG. */
export function passivePedContact(packet: PassivePedContactPacket) {
  validate(packet);
  integer(packet.pedRigidType, 0, 255, "ped rigid type");
  integer(packet.impactCount, 0, 0xffff, "impact count");
  const v = vector(packet.characterVelocity),
    state = packet.state;
  if (!(state.flags & 0x40))
    return { eligible: false as const, reason: "ped-flag40-clear" as const };
  const mass = scalar(packet.form.personalityMass, "personality mass");
  // Native retains X live, but spills -mass*Y and -mass*Z before addition.
  let x = -mass * v.x,
    y = f(-mass * v.y),
    z = f(-mass * v.z);
  if (packet.other) {
    const other = vector(packet.other.velocity),
      otherMass = scalar(packet.other.mass, "other mass");
    x += otherMass * other.x;
    y += otherMass * other.y;
    z += otherMass * other.z;
  }
  let momentumSquared = finite(x * x + y * y + z * z, "momentum squared");
  if (specialImpact(packet)) momentumSquared *= 10;
  const rawDamage = sourceInt(
    f(
      state.exploding
        ? 5 * packet.settings.severDamage
        : (momentumSquared /
            scalar(
              packet.settings.maxSurvivableInitialImpact,
              "maximum initial impact",
            )) *
            100,
    ),
  );
  const damage = normalisePedContactDamage(rawDamage, packet.form, state),
    deadImpactMove = momentumSquared < 10 ? 91 : 92,
    health = resolvePedContactDamage(
      damage,
      packet.form,
      state,
      90,
      deadImpactMove,
    );
  return {
    eligible: true as const,
    momentumSquared,
    rawDamage,
    ...health,
    helperReactionMoveId: health.reactionMoveId,
    // The passive callback overrides the common helper's dead reaction immediately.
    reactionMoveId: health.hitPoints > 0 ? 90 : 94,
    reactionAction: health.hitPoints > 0 ? 5 : 6,
    deadImpactMove,
    impactCount: (packet.impactCount + 1) & 0xffff,
    resetHaltCount: true,
    clearDirectionInterpolation: true,
    collisionFilterA: packet.pedRigidType === 5 ? 0x40000 : 0x20000,
    collisionFilterB: 0x40000,
    unresolved: diagnostics(packet, damage),
  };
}

/** Dispatcher 41d901..41da16 and active contact helper 4d20e0 HP/flag prefix. */
export function activePedContact(packet: ActivePedContactPacket) {
  validate(packet);
  integer(packet.pedRigidType, 0, 255, "ped rigid type");
  const total = scalar(packet.totalLambda, "total lambda"),
    first = scalar(packet.firstRowLambda, "first row lambda"),
    vy = scalar(packet.pedVelocityY, "ped velocity Y"),
    force = vector(packet.worldForce),
    normal = packet.faceNormal ? vector(packet.faceNormal) : null;
  const pedType = packet.pedRigidType >= 2 && packet.pedRigidType <= 4,
    otherPed =
      !!packet.other &&
      packet.other.ownerPresent &&
      packet.other.type >= 2 &&
      packet.other.type <= 4;
  if (
    packet.replay ||
    !pedType ||
    !packet.pedOwnerPresent ||
    otherPed ||
    !(total > f(0.0005))
  )
    return {
      eligible: false as const,
      reason: packet.replay
        ? "replay"
        : otherPed
          ? "ped-ped"
          : !pedType || !packet.pedOwnerPresent
            ? "ped-owner-or-type"
            : "group-lambda-gate",
    };
  const multiplier = specialImpact(packet) || vy < -1.7 ? 10 : 1,
    effectiveLambda = multiplier === 1 ? first : f(first * 10),
    rawDamage = sourceInt(
      packet.state.exploding
        ? packet.form.boneCount * packet.settings.severDamage
        : effectiveLambda *
            scalar(packet.settings.damagePerForce, "damage per force") *
            (packet.other ? 1 : 1.5),
    );
  // The native helper returns before HP, contact flags and blood when input truncates to zero.
  if (rawDamage === 0)
    return {
      eligible: true as const,
      applied: false as const,
      multiplier,
      effectiveLambda,
      rawDamage,
      damage: 0,
      worldForce: force,
      flags: packet.state.flags,
      unresolved: diagnostics(packet, 0),
    };
  const damage = normalisePedContactDamage(
    rawDamage,
    packet.form,
    packet.state,
  );
  const health = resolvePedContactDamage(
    damage,
    packet.form,
    packet.state,
    -1,
    94,
  );
  let flags = packet.state.flags;
  let pinned = false;
  if (effectiveLambda >= 0.01) {
    if (packet.other) flags |= 4;
    else if (normal && normal.y < 0.707) flags |= 2;
    pinned = (flags & 6) === 6 && !(flags & 8);
    if (pinned) flags |= 8;
  }
  return {
    eligible: true as const,
    applied: true as const,
    multiplier,
    effectiveLambda,
    rawDamage,
    ...health,
    flags,
    pinned,
    reactionMoveId: pinned ? 96 : health.reactionMoveId,
    worldForce: force,
    unresolved: diagnostics(packet, damage),
  };
}
