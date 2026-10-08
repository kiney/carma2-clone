/** Original noncar mechanics: HW ReadNonCarMechanicsData 0x487ec0 and
 * ReadMechanicsShapes 0x488b00. Values remain in authored model units/tonnes;
 * parsing does not normalize axes or convert physics quantities. */
import type { MechanicsShape, MechanicsVec3 } from "./mechanics";

export type NonCarShape = MechanicsShape;
export type NonCarVec3 = MechanicsVec3;
export type NonCarWorldJoint =
  | { kind: "ball"; position: NonCarVec3; friction: number; limitCount: number }
  | {
      kind: "hinge";
      position: NonCarVec3;
      /** Preserve the second vector: rec2 currently reads but discards it. */
      axis: NonCarVec3;
      friction: number;
      limitCount: number;
    }
  | {
      kind: "translation";
      position: NonCarVec3;
      axis: NonCarVec3;
      travel: number;
      forwardAcceleration: number; // g
      reverseAcceleration: number; // g
      forwardResistance: number; // authored exponent input
      reverseResistance: number;
      pauseAtTop: number; // milliseconds
    };

export interface NonCarMechanics {
  /** null means the first line was the legacy type index, not a version. */
  version: 100 | 101 | null;
  index: number;
  centerOfMass: NonCarVec3;
  attachedCenterOfMass: NonCarVec3;
  shapes: NonCarShape[];
  /** Legacy points are read and ignored by the original, retained for inspection. */
  extraPoints: NonCarVec3[];
  freeMass: number;
  attachedMass: number;
  inertiaDimensions: NonCarVec3;
  inertiaPerMass: NonCarVec3;
  snapAngleDegrees: number;
  minimumTorque: number; // KN m; original squares torque / WORLD_SCALE
  shrapnelMaterials: string[];
  /** Source keyword values minus one; absent means the neutral additive value. */
  worldFriction: number;
  objectFriction: number;
  worldFrictionSource?: number;
  objectFrictionSource?: number;
  tumble?: { factor: number; threshold: number };
  worldJoint?: NonCarWorldJoint;
  riseWhenHit: boolean;
  riseWhenDrivenOn: boolean;
  numberOfPushes?: number;
  drivableOn: boolean;
  infiniteInertia: boolean;
  ignoreWorldCollisions: boolean;
  blockCamera: boolean;
  sparky: boolean;
}

const MAX_TEXT = 1_000_000;
const MAX_LINES = 20_000;
const MAX_SCALAR = 1_000_000_000;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

class Reader {
  readonly lines: Array<{ text: string; line: number }>;
  at = 0;
  line = 0;
  constructor(
    text: string,
    readonly source: string,
  ) {
    if (text.length > MAX_TEXT) this.fail("text exceeds size limit");
    const raw = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
    if (raw.length > MAX_LINES) this.fail("text exceeds line limit");
    this.lines = raw.flatMap((value, line) => {
      if (value.length > 4096) this.fail("line exceeds size limit", line);
      const clean = value.replace(/\/\/.*$/, "").trim();
      return clean ? [{ text: clean, line }] : [];
    });
  }
  fail(message: string, line = this.line): never {
    throw new Error(`Noncar ${this.source}: ${message} at line ${line + 1}`);
  }
  next(label: string): string {
    const value = this.lines[this.at++];
    if (!value) this.fail(`incomplete ${label}`);
    this.line = value.line;
    return value.text;
  }
  numbers(label: string, count: number): number[] {
    const tokens = this.next(label).split(/[\s,]+/);
    if (tokens.length !== count || !tokens.every((token) => NUMBER.test(token)))
      this.fail(`expected ${count} numeric values for ${label}`);
    const values = tokens.map(Number);
    if (
      values.some(
        (value) => !Number.isFinite(value) || Math.abs(value) > MAX_SCALAR,
      )
    )
      this.fail(`unbounded ${label}`);
    return values;
  }
  number(label: string): number {
    return this.numbers(label, 1)[0];
  }
  integer(label: string, min: number, max: number): number {
    const value = this.number(label);
    if (!Number.isInteger(value) || value < min || value > max)
      this.fail(`invalid ${label} (expected integer ${min}..${max})`);
    return value;
  }
  vector(label: string): NonCarVec3 {
    return this.numbers(label, 3) as NonCarVec3;
  }
  end(): void {
    if (this.at < this.lines.length)
      this.fail("unexpected trailing data", this.lines[this.at].line);
  }
}

function bounds(reader: Reader) {
  const min = reader.vector("box minimum"),
    max = reader.vector("box maximum");
  if (min.some((value, axis) => value > max[axis]))
    reader.fail("inverted box bounds");
  return { min, max };
}

function shapes(reader: Reader): NonCarShape[] {
  const count = reader.integer("shape count", 0, 128);
  return Array.from({ length: count }, () => {
    // GetAString consumes the first token; stock assets also spell it "wire frame".
    const kind = reader.next("shape kind").split(/\s+/)[0].toLowerCase();
    switch (kind) {
      case "box":
        return { kind, bounds: bounds(reader) };
      case "polyhedron": {
        const count = reader.integer("polyhedron vertex count", 1, 32);
        return {
          kind,
          vertices: Array.from({ length: count }, () =>
            reader.vector("polyhedron vertex"),
          ),
        };
      }
      case "sphere": {
        const radius = reader.number("sphere radius");
        if (radius <= 0) reader.fail("sphere radius must be positive");
        return { kind, radius, center: reader.vector("sphere center") };
      }
      case "wire": {
        const count = reader.integer("wire vertex count", 1, 64);
        const vertices = Array.from({ length: count }, () =>
          reader.vector("wire vertex"),
        );
        const edgeCount = reader.integer("wire edge count", 0, 1024);
        const edges = Array.from({ length: edgeCount }, () => {
          const pair = reader.numbers("wire edge", 2);
          if (pair.some((i) => !Number.isInteger(i) || i < 0 || i >= count))
            reader.fail("wire edge references an invalid vertex");
          return pair as [number, number];
        });
        return { kind, vertices, edges };
      }
      default:
        return reader.fail(`unknown shape ${kind}`);
    }
  });
}

/** Parse a complete loose or archive noncar definition, including v101 commands. */
export function parseNonCarMechanics(
  text: string,
  source = "mechanics",
): NonCarMechanics {
  const reader = new Reader(text, source);
  const header = reader.integer("version or legacy index", 0, 101);
  const version = header < 100 ? null : (header as 100 | 101);
  // Some stock special debris definitions have large indices; do not conflate
  // this field with the two-digit actor naming convention during parsing.
  const index =
    version === null ? header : reader.integer("type index", 0, MAX_SCALAR);
  const centerOfMass = reader.vector("center of mass");
  const attachedCenterOfMass = reader.vector("attached center of mass");
  const collisionShapes: NonCarShape[] =
    version === null
      ? [{ kind: "box", bounds: bounds(reader) }]
      : shapes(reader);
  const extraPoints =
    version === null
      ? Array.from({ length: reader.integer("extra point count", 0, 6) }, () =>
          reader.vector("extra point"),
        )
      : [];
  const [freeMass, attachedMass] = reader.numbers("free and attached mass", 2);
  if (freeMass <= 0 || attachedMass <= 0)
    reader.fail("masses must be positive");
  const inertiaDimensions = reader.vector("inertia dimensions");
  if (inertiaDimensions.some((value) => value < 0))
    reader.fail("negative inertia dimensions");
  const [length, width, height] = inertiaDimensions;
  // Preserve ReadNonCarMechanicsData's axis assignment, including its labels;
  // it differs from assuming the three authored dimensions are xyz extents.
  const inertiaPerMass: NonCarVec3 = [
    (height * height + width * width) / 12,
    (height * height + length * length) / 12,
    (width * width + length * length) / 12,
  ];
  const snapAngleDegrees = reader.number("snap angle");
  const minimumTorque = reader.number("minimum torque");
  if (minimumTorque < 0) reader.fail("negative minimum torque");
  const shrapnelMaterials =
    version === null
      ? []
      : Array.from(
          { length: reader.integer("shrapnel material count", 0, 256) },
          () => reader.next("shrapnel material"),
        );
  const result: NonCarMechanics = {
    version,
    index,
    centerOfMass,
    attachedCenterOfMass,
    shapes: collisionShapes,
    extraPoints,
    freeMass,
    attachedMass,
    inertiaDimensions,
    inertiaPerMass,
    snapAngleDegrees,
    minimumTorque,
    shrapnelMaterials,
    worldFriction: 0,
    objectFriction: 0.4,
    riseWhenHit: false,
    riseWhenDrivenOn: false,
    drivableOn: false,
    infiniteInertia: false,
    ignoreWorldCollisions: false,
    blockCamera: false,
    sparky: false,
  };
  if (version === 101) {
    for (;;) {
      const command = reader.next("keyword or END").toUpperCase();
      if (command === "END") break;
      switch (command) {
        case "WORLD_FRICTION":
          result.worldFrictionSource = reader.number("world friction");
          result.worldFriction = result.worldFrictionSource - 1;
          break;
        case "OBJECT_FRICTION":
          result.objectFrictionSource = reader.number("object friction");
          result.objectFriction = result.objectFrictionSource - 1;
          break;
        case "TUMBLE":
          result.tumble = {
            factor: reader.number("tumble factor"),
            threshold: reader.number("tumble threshold"),
          };
          break;
        case "WORLD_BALL_JOINT":
          result.worldJoint = {
            kind: "ball",
            position: reader.vector("ball joint position"),
            friction: reader.number("joint friction"),
            limitCount: reader.integer("joint limit count", 0, 256),
          };
          break;
        case "WORLD_HINGE_JOINT":
          result.worldJoint = {
            kind: "hinge",
            position: reader.vector("hinge position"),
            axis: reader.vector("hinge axis"),
            friction: reader.number("joint friction"),
            limitCount: reader.integer("joint limit count", 0, 256),
          };
          break;
        case "WORLD_TRANSLATION_JOINT": {
          const position = reader.vector("translation position"),
            axis = reader.vector("translation axis");
          if (axis.every((value) => value === 0))
            reader.fail("zero translation axis");
          const travel = reader.number("translation travel");
          if (travel < 0) reader.fail("negative translation travel");
          result.worldJoint = {
            kind: "translation",
            position,
            axis,
            travel,
            forwardAcceleration: reader.number("forward acceleration"),
            reverseAcceleration: reader.number("reverse acceleration"),
            forwardResistance: reader.number("forward resistance"),
            reverseResistance: reader.number("reverse resistance"),
            pauseAtTop: reader.integer("pause at top", 0, MAX_SCALAR),
          };
          break;
        }
        case "RISE_WHEN_HIT":
          result.riseWhenHit = true;
          break;
        case "RISE_WHEN_DRIVEN_ON":
          result.riseWhenDrivenOn = true;
          break;
        case "NUMBER_OF_PUSHES":
          result.numberOfPushes = reader.integer(
            "number of pushes",
            0,
            MAX_SCALAR,
          );
          break;
        case "DRIVABLE_ON":
          result.drivableOn = true;
          break;
        case "INFINITE_I":
          result.infiniteInertia = true;
          break;
        case "IGNORE_WORLD_COLLISIONS":
          result.ignoreWorldCollisions = true;
          break;
        case "BLOCK_CAMERA":
          result.blockCamera = true;
          break;
        case "SPARKY":
          result.sparky = true;
          break;
        default:
          reader.fail(`unknown keyword ${command}`);
      }
    }
  }
  reader.end();
  return result;
}

/** The original track list has no sentinel. Descriptive comments locate its
 * count in supported track texts, as in the existing track config readers. */
export function parseTrackNonCarFiles(
  text: string,
  source = "track",
): string[] {
  if (text.length > 4_000_000)
    throw new Error(`Noncar ${source}: track exceeds size limit`);
  const lines = text.split(/\r\n|\n|\r/);
  const at = lines.findIndex((line) =>
    /\/\/\s*non[\s-]*car\s*objects\b/i.test(line),
  );
  if (at < 0) return [];
  const ownValue = lines[at].replace(/\/\/.*$/, "").trim();
  const reader = new Reader(
    [ownValue, ...lines.slice(at + 1)].join("\n"),
    `${source} Non CarObjects`,
  );
  const count = reader.integer("type count", 0, 40); // original loader's limit
  return Array.from({ length: count }, () => {
    const name = reader.next("definition filename");
    if (
      name.length > 255 ||
      !/^[^/\\\x00]+\.txt$/i.test(name) ||
      name === "..txt"
    )
      reader.fail("invalid definition filename");
    return name;
  });
}
