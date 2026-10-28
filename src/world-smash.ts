/** Independently implemented track smash records. Format follows rec2 world.c,
 * crush.c and shrapnel.c; installed HW reader is 0x4f01d0 (not rec2 0x4f0450).
 * Connotations have the same ordering as damage.ts's skipConnotations, extended
 * here for abstract debris, box positions and nonempty slicks. Assets stay external.
 */
export type SmashVec3 = [number, number, number];
export type SmashPair = [number, number];
/** Some stock ghost amounts author only one -1. Preserve that omission. */
export type SmashAmount = SmashPair | [number];
export type SmashMode =
  | "nochange"
  | "decal"
  | "texturechange"
  | "remove"
  | "replacemodel"
  | "crush";
export type SmashCollisionMode = "solid" | "passthrough" | "edges";
export type SmashTrigger =
  | { kind: "material" | "model"; name: string }
  | { kind: "number"; name: string; index: number; argument: number };
export interface SmashInitialSpeed {
  towards: SmashPair;
  impacteeVelocityFactor: number;
  randomVelocityMax: number;
  randomUpVelocityMax: number;
  randomNormalVelocityMax: number;
  randomSpinRateMax: number;
}
export type SmashInitialPosition =
  | { kind: "actorbased" }
  | { kind: "boxclumped"; size: SmashVec3 }
  | { kind: "sphereclumped"; radius: number; center: "impact" | "model" };
export interface SmashFire {
  chance: number;
  count?: number;
  smokiness?: SmashPair;
}
export interface SmashReplacementFire {
  chance: number;
  /** ReadSmokeFireChance: column count, minimum colour, maximum colour. */
  parameters?: [number, number, number];
}
export interface SmashShrapnel {
  kind: "abstract" | "shards" | "ghostparts" | "noncars";
  materials?: string[];
  speed?: SmashInitialSpeed;
  position?: SmashInitialPosition;
  lifetimeSeconds?: SmashPair;
  shard?: { scalar: number; integer: number; material: string };
  amount?: SmashAmount;
  actorCountSource?: number;
  actors?: string[];
  fire?: SmashFire;
  actorFile?: string;
  nonCars?: { actor: string; mechanics: string }[];
}
export interface SmashExplosion {
  amount: SmashPair;
  delaySeconds: SmashPair;
  offset: SmashVec3;
  xFactor: SmashPair;
  yFactor: SmashPair;
  zFactor: SmashPair;
  frameRate: SmashPair;
  scale: SmashPair;
  rotation: "norotate" | "randomrotate";
  frames: { opacity: number; pixelmap: string }[];
}
export interface SmashSlick {
  material: string;
  first: SmashVec3;
  second: SmashVec3;
  firstPair: SmashPair;
  secondPair?: SmashPair;
  secondMaterial?: string;
}
export interface SmashActivation {
  /** Native 0x4efa60 reads integer seconds, later stored as16-bit milliseconds. */
  delaySeconds: SmashPair;
  coordinates: "relative" | "absolute";
  nonCarType: number;
  min: SmashVec3;
  max: SmashVec3;
  speed: SmashInitialSpeed;
}
export interface SmashSideEffect {
  delaySeconds: SmashPair;
  target: string;
  coordinates: "relative" | "absolute";
  min: SmashVec3;
  max: SmashVec3;
  direction: "parallel" | "towards" | "away";
  strength: number;
}
export interface SmashConnotations {
  sounds: number[];
  shrapnel: SmashShrapnel[];
  explosions: SmashExplosion[];
  slick: SmashSlick | null;
  activations: SmashActivation[];
  sideEffects: SmashSideEffect[];
  extensionFlags: number;
  extensionArgument?: number;
  roomCode: number;
  award: {
    frequency: "none" | "singleshot" | "repeated" | "doitregardless";
    first?: number;
    second?: number;
    integerFirst?: number;
    integerSecond?: number;
  };
  variableChanges: SmashPair[];
}
export interface SmashLevel {
  threshold: number;
  flags: number;
  collisionMode?: SmashCollisionMode;
  connotations: SmashConnotations;
  pixelmaps: string[];
}
export interface WorldSmashSpec {
  flags: number;
  trigger: SmashTrigger;
  mode: SmashMode;
  intactPixelmap?: string;
  levels: SmashLevel[];
  removalThreshold?: number;
  connotations?: SmashConnotations;
  replacement?: { model: string; fire: SmashReplacementFire };
  reserved: [number, number, number, number];
}

/** Structural reader shared by world and WAM connotation records. */
export interface SmashConnotationReader {
  fail(message: string): never;
  token(label: string): string;
  scalar(label: string): number;
  integer(label: string): number;
  count(label: string, max?: number): number;
  pair(label: string): SmashPair;
  integerPair(label: string): SmashPair;
  amount(label: string): SmashAmount;
  vector(label: string): SmashVec3;
  enum<T extends string>(label: string, options: readonly T[]): T;
  list<T>(label: string, read: () => T, max?: number): T[];
}

/** Bounds-checked token operations; WAM adapters may supply their own cursor. */
export class SmashTextReader implements SmashConnotationReader {
  lines: { value: string; line: number }[];
  cursor = 0;
  constructor(
    text: string,
    readonly source: string,
    lineOffset = 0,
  ) {
    if (text.length > 4_000_000)
      throw new Error(`${source}: smash text exceeds size bound`);
    this.lines = text.split(/\r?\n/).flatMap((raw, i) => {
      const value = raw.split("//", 1)[0].trim();
      return value ? [{ value, line: i + lineOffset + 1 }] : [];
    });
    if (this.lines.length > 100_000) this.fail("too many smash lines");
  }
  fail(message: string): never {
    const entry = this.lines[Math.min(this.cursor, this.lines.length - 1)];
    throw new Error(`${this.source}:${entry?.line ?? 1}: ${message}`);
  }
  read(label: string): string {
    if (this.cursor >= this.lines.length) this.fail(`incomplete ${label}`);
    return this.lines[this.cursor++].value;
  }
  token(label: string): string {
    const value = this.read(label).split(/[\s,]+/, 1)[0];
    if (value.length > 255 || /[\x00-\x1f]/.test(value))
      this.fail(`invalid ${label}`);
    return value;
  }
  numbers(label: string, arity: number, singleton = false): number[] {
    const values = this.read(label)
      .split(/[\s,/]+/)
      .map(Number);
    if (
      (values.length !== arity &&
        !(singleton && values.length === 1 && values[0] === -1)) ||
      values.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e9)
    )
      this.fail(`invalid ${label}`);
    return values;
  }
  scalar(label: string): number {
    return this.numbers(label, 1)[0];
  }
  integer(label: string): number {
    const v = this.scalar(label);
    if (!Number.isInteger(v)) this.fail(`invalid integer ${label}`);
    return v;
  }
  count(label: string, max = 2048): number {
    const value = this.integer(label);
    if (value < 0 || value > max) this.fail(`invalid ${label} count`);
    return value;
  }
  pair(label: string): SmashPair {
    return this.numbers(label, 2) as SmashPair;
  }
  integerPair(label: string): SmashPair {
    const values = this.pair(label);
    if (!values.every(Number.isInteger)) this.fail(`invalid integer ${label}`);
    return values;
  }
  amount(label: string): SmashAmount {
    // GetPairOfInts consumes only one source line. Do not borrow actorCount
    // from the next line or invent the absent second amount for malformed data.
    return this.numbers(label, 2, true) as SmashAmount;
  }
  vector(label: string): SmashVec3 {
    return this.numbers(label, 3) as SmashVec3;
  }
  enum<T extends string>(label: string, options: readonly T[]): T {
    const value = this.token(label).toLowerCase();
    if (!options.includes(value as T)) this.fail(`unknown ${label} '${value}'`);
    return value as T;
  }
  list<T>(label: string, read: () => T, max = 2048): T[] {
    return Array.from({ length: this.count(label, max) }, read);
  }
}
function speed(r: SmashConnotationReader): SmashInitialSpeed {
  return {
    towards: r.pair("towards speed"),
    impacteeVelocityFactor: r.scalar("impactee velocity factor"),
    randomVelocityMax: r.scalar("random velocity"),
    randomUpVelocityMax: r.scalar("random up velocity"),
    randomNormalVelocityMax: r.scalar("random normal velocity"),
    randomSpinRateMax: r.scalar("random spin"),
  };
}
function fire(r: SmashConnotationReader): SmashFire {
  const chance = r.integer("fire chance");
  return chance
    ? { chance, count: r.count("fire columns"), smokiness: r.pair("smokiness") }
    : { chance };
}
function shrapnel(r: SmashConnotationReader): SmashShrapnel {
  const kind = r.enum("shrapnel type", [
    "abstract",
    "shards",
    "ghostparts",
    "noncars",
  ] as const);
  if (kind === "abstract")
    return {
      kind,
      materials: r.list("abstract materials", () =>
        r.token("shrapnel material"),
      ),
    };
  const result: SmashShrapnel = { kind, speed: speed(r) };
  if (kind !== "shards") {
    const position = r.enum("shrapnel position", [
      "actorbased",
      "sphereclumped",
      "boxclumped",
    ] as const);
    result.position =
      position === "sphereclumped"
        ? {
            kind: position,
            radius: r.scalar("clump radius"),
            center: r.enum("clump center", ["impact", "model"] as const),
          }
        : position === "boxclumped"
          ? { kind: position, size: r.vector("clump box") }
          : { kind: position };
  }
  if (kind !== "noncars") result.lifetimeSeconds = r.pair("shrapnel lifetime");
  if (kind === "shards")
    result.shard = {
      scalar: r.scalar("shard scalar"),
      integer: r.integer("shard integer"),
      material: r.token("shard material"),
    };
  if (kind === "ghostparts") {
    result.amount = r.amount("ghost amount");
    const n = r.integer("ghost actors");
    if (n < -1 || n > 2048) r.fail("invalid ghost actor count");
    result.actorCountSource = n;
    result.actors = Array.from({ length: Math.max(1, n) }, () =>
      r.token("ghost actor"),
    );
  }
  if (kind === "noncars") {
    result.amount = r.amount("noncar amount");
    result.fire = fire(r);
    result.actorFile = r.token("noncar actor file");
    result.nonCars = r.list(
      "noncar actors",
      () => ({
        actor: r.token("noncar actor"),
        mechanics: r.token("noncar mechanics"),
      }),
      100,
    );
  }
  return result;
}
function explosion(r: SmashConnotationReader): SmashExplosion {
  return {
    amount: r.pair("explosion amount"),
    delaySeconds: r.pair("explosion delay"),
    offset: r.vector("explosion offset"),
    xFactor: r.pair("explosion x factor"),
    yFactor: r.pair("explosion y factor"),
    zFactor: r.pair("explosion z factor"),
    frameRate: r.pair("explosion frame rate"),
    scale: r.pair("explosion scale"),
    rotation: r.enum("explosion rotation", [
      "norotate",
      "randomrotate",
    ] as const),
    frames: r.list("explosion frames", () => ({
      opacity: r.scalar("frame opacity"),
      pixelmap: r.token("frame pixelmap"),
    })),
  };
}
export function readSmashConnotations(
  r: SmashConnotationReader,
): SmashConnotations {
  const sounds = r.list("sounds", () => r.integer("sound ID"), 100);
  const debris = r.list("shrapnel", () => shrapnel(r), 100);
  const explosions = r.list("explosions", () => explosion(r), 100);
  const material = r.token("slick material");
  let slick: SmashSlick | null = null;
  if (material.toLowerCase() !== "none") {
    slick = {
      material,
      first: r.vector("slick first vector"),
      second: r.vector("slick second vector"),
      firstPair: r.pair("slick first pair"),
    };
    // Native 0x4ee360 uses firstPair[1], unlike rec2's stale-vector temporary.
    if (slick.firstPair[1] !== 0) {
      slick.secondPair = r.pair("slick second pair");
      slick.secondMaterial = r.token("second slick material");
    }
  }
  const activations = r.list(
    "noncar activations",
    (): SmashActivation => ({
      delaySeconds: r.integerPair("activation delay"),
      coordinates: r.enum("activation coordinates", [
        "relative",
        "absolute",
      ] as const),
      nonCarType: r.integer("activation noncar type"),
      min: r.vector("activation minimum"),
      max: r.vector("activation maximum"),
      speed: speed(r),
    }),
    100,
  );
  const sideEffects = r.list(
    "side effect smashes",
    (): SmashSideEffect => ({
      delaySeconds: r.pair("side effect delay"),
      target: r.token("side effect target"),
      coordinates: r.enum("side effect coordinates", [
        "relative",
        "absolute",
      ] as const),
      min: r.vector("side effect minimum"),
      max: r.vector("side effect maximum"),
      direction: r.enum("side effect direction", [
        "parallel",
        "towards",
        "away",
      ] as const),
      strength: r.scalar("side effect strength"),
    }),
    100,
  );
  const extensionFlags = r.integer("extension flags");
  const extensionArgument =
    extensionFlags & 1 ? r.integer("extension argument") : undefined;
  const roomCode = r.integer("room code");
  const frequency = r.enum("award frequency", [
    "none",
    "singleshot",
    "repeated",
    "doitregardless",
  ] as const);
  const award: SmashConnotations["award"] = { frequency };
  if (frequency !== "none")
    Object.assign(award, {
      first: r.scalar("award first"),
      second: r.scalar("award second"),
      integerFirst: r.integer("award integer first"),
      integerSecond: r.integer("award integer second"),
    });
  const variableChanges = r.list(
    "variable changes",
    () => r.pair("variable change"),
    100,
  );
  return {
    sounds,
    shrapnel: debris,
    explosions,
    slick,
    activations,
    sideEffects,
    extensionFlags,
    extensionArgument,
    roomCode,
    award,
    variableChanges,
  };
}
function parse(r: SmashConnotationReader): WorldSmashSpec[] {
  return r.list("smash specs", () => {
    const flags = r.integer("smash flags");
    const name = r.token("smash trigger");
    const trigger: SmashTrigger = /^&\d{2}$/.test(name)
      ? {
          kind: "number",
          name,
          index: Number(name.slice(1)),
          argument: r.integer("numeric trigger argument"),
        }
      : {
          kind:
            name.startsWith("&") || /\.(act|dat)/i.test(name)
              ? "model"
              : "material",
          name,
        };
    const mode = r.enum("smash mode", [
      "nochange",
      "decal",
      "texturechange",
      "remove",
      "replacemodel",
      "crush",
    ] as const);
    const spec: WorldSmashSpec = {
      flags,
      trigger,
      mode,
      levels: [],
      reserved: [0, 0, 0, 0],
    };
    if (mode === "decal" || mode === "texturechange") {
      spec.intactPixelmap = r.token("intact pixelmap");
      spec.levels = r.list(
        "smash levels",
        (): SmashLevel => {
          const threshold = r.scalar("level threshold"),
            flags = r.integer("level flags");
          const collisionMode =
            mode === "texturechange"
              ? r.enum("collision mode", [
                  "solid",
                  "passthrough",
                  "edges",
                ] as const)
              : undefined;
          return {
            threshold,
            flags,
            collisionMode,
            connotations: readSmashConnotations(r),
            pixelmaps: r.list(
              "level pixelmaps",
              () => r.token("level pixelmap"),
              100,
            ),
          };
        },
        100,
      );
    } else {
      spec.removalThreshold = r.scalar("removal threshold");
      spec.connotations = readSmashConnotations(r);
    }
    if (mode === "replacemodel") {
      const model = r.token("replacement model");
      const chance = r.integer("replacement fire chance");
      const smoke: SmashReplacementFire = { chance };
      if (chance) {
        const first = r.integer("replacement fire first integer");
        const rest = r.pair("replacement fire integer pair");
        if (!rest.every(Number.isInteger))
          r.fail("invalid replacement fire integer pair");
        smoke.parameters = [first, ...rest];
      }
      spec.replacement = { model, fire: smoke };
    }
    spec.reserved = Array.from({ length: 4 }, () =>
      r.integer("reserved smash field"),
    ) as WorldSmashSpec["reserved"];
    return spec;
  });
}
/** Parse one count-prefixed block and reject unexpected trailing data. */
export function parseSmashableEnvironment(
  text: string,
  source = "smash environment",
): WorldSmashSpec[] {
  const r = new SmashTextReader(text, source);
  const specs = parse(r);
  if (r.cursor !== r.lines.length)
    r.fail("unexpected data after smash environment");
  return specs;
}
/** Read the original track section without interpreting subsequent track data. */
export function parseTrackSmashables(
  text: string,
  source = "track",
): WorldSmashSpec[] {
  if (text.length > 4_000_000)
    throw new Error(`${source}: track exceeds size bound`);
  const lines = text.split(/\r?\n/);
  const marker = lines.findIndex((line) =>
    /\/\/.*smashable environment specs/i.test(line),
  );
  if (marker < 0) return [];
  return parse(
    new SmashTextReader(lines.slice(marker + 1).join("\n"), source, marker + 1),
  );
}
/** Native 0x4f0ec0 item flags: 1 suppresses wheel/support contacts, 2 body
 * contacts. The metric is the solved normal impulse supplied by 0x41c1d0;
 * this API deliberately does not convert vehicle speed into impact severity. */
export function smashContactAllowed(
  flags: number,
  kind: "wheel" | "body",
): boolean {
  return (flags & (kind === "wheel" ? 1 : 2)) === 0;
}

/** 0x4f0ec0's numbered actor branch uses the trigger argument's byte flags:
 * bit 1 allows attached actors, bit 4 allows released actors (fourth char '!').
 * This branch bypasses ordinary item wheel/body suppression flags. */
export function numericSmashTriggerEligible(
  trigger: SmashTrigger,
  actorIdentifier: string,
): boolean {
  if (trigger.kind !== "number" || !/^&\d{2}/.test(actorIdentifier))
    return false;
  if (Number(actorIdentifier.slice(1, 3)) !== trigger.index) return false;
  return (trigger.argument & (actorIdentifier[3] === "!" ? 4 : 1)) !== 0;
}
/** Native nontexture handler 0x4f4bc0 accepts equality. Caller owns actor
 * idempotence and deferred connotations; texture/decal selection is separate. */
export function removalSmashTriggered(
  spec: WorldSmashSpec,
  normalImpulse: number,
  kind: "wheel" | "body",
): boolean {
  if (!Number.isFinite(normalImpulse) || normalImpulse < 0)
    throw new Error("Invalid smash normal impulse");
  return (
    spec.removalThreshold !== undefined &&
    (spec.trigger.kind === "number" || smashContactAllowed(spec.flags, kind)) &&
    normalImpulse >= spec.removalThreshold
  );
}

/** 0x41c1d0 gate precedes SmashEnvironment for body/world rows. */
export const SMASH_BODY_IMPULSE_GATE = Math.fround(0.02);
/** Native texture/decal entry 0x4f1660 has a separate 0.1 lower bound. */
export const SMASH_TEXTURE_IMPULSE_GATE = 0.1;
/** Source queue 0x4ee010 scans backwards, including threshold equality. The
 * return value is a source level index: zero intact, 1 first damaged level.
 * Damage does not accumulate; a later contact must meet its level threshold.
 * Caller enforces contact gate, matching trigger and deferred queue deduplication.
 */
export function selectSmashLevel(
  spec: WorldSmashSpec,
  normalImpulse: number,
  currentLevel = 0,
): number {
  if (!Number.isFinite(normalImpulse) || normalImpulse < 0)
    throw new Error("Invalid smash normal impulse");
  if (
    !Number.isInteger(currentLevel) ||
    currentLevel < 0 ||
    currentLevel > spec.levels.length
  )
    throw new Error("Invalid current smash level");
  if (
    (spec.mode !== "texturechange" && spec.mode !== "decal") ||
    normalImpulse < SMASH_TEXTURE_IMPULSE_GATE
  )
    return currentLevel;
  for (let i = spec.levels.length - 1; i >= currentLevel; i--)
    if (normalImpulse >= spec.levels[i].threshold) return i + 1;
  return currentLevel;
}
