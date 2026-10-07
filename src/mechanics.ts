/** Strict bounded reader for the original `START OF MECHANICS STUFF` car data. */

export type MechanicsVec3 = [number, number, number];
export type MechanicsVec2 = [number, number];

export interface MechanicsWheel {
  type: number;
  identifier: string;
  actor: string;
  /** Original local position. Zero means the game resolves it from the actor. */
  position: MechanicsVec3;
  positionFromActor: boolean;
  steerableFlag: number;
  drivenFlag: number;
  steerable: boolean;
  driven: boolean;
  suspensionGive: number;
  damping: number;
  slippingFrictionReduction: number;
  frictionAngles: MechanicsVec2;
  tractionMultiplier: number;
  rollingResistance: number;
}

export type MechanicsShape =
  | { kind: "box"; bounds: { min: MechanicsVec3; max: MechanicsVec3 } }
  | { kind: "polyhedron"; vertices: MechanicsVec3[] }
  | { kind: "sphere"; radius: number; center: MechanicsVec3 }
  | { kind: "wire"; vertices: MechanicsVec3[]; edges: Array<[number, number]> };

export interface CarMechanics {
  mechanicsVersion: number;
  minimumTurningCircle: number;
  brakeMultiplier: number;
  brakingStrengthMultiplier: number;
  gearCount: number;
  speedAtRedline: number;
  highestGearAcceleration: number;
  root: {
    type: string;
    identifier: string;
    actor: string;
    jointType: string;
    centerOfMass: MechanicsVec3;
    mass: number;
    inertiaDimensions: MechanicsVec3;
    inertia: MechanicsVec3;
    downforceBalanceSpeed: number;
  };
  wheels: [MechanicsWheel, MechanicsWheel, MechanicsWheel, MechanicsWheel];
  shapes: MechanicsShape[];
  subPartCount: number;
}

const MAX_TEXT_LENGTH = 1024 * 1024;
const MAX_LINES = 20_000;
const MAX_SHAPES = 128;
const MAX_POLYHEDRON_VERTICES = 32;
const MAX_WIRE_VERTICES = 64;
const MAX_WIRE_EDGES = 1024;

function fail(message: string, line: number): never {
  throw new Error(`Car mechanics ${message} at line ${line + 1}`);
}

class MechanicsReader {
  private readonly lines: string[];
  private index: number;

  constructor(text: string, markerIndex: number) {
    this.lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
    this.index = markerIndex + 1;
  }

  private nextDataLine(): { value: string; line: number } {
    while (this.index < this.lines.length) {
      const line = this.index++;
      const value = this.lines[line].replace(/\/\/.*$/, "").trim();
      if (value) return { value, line };
    }
    return fail("section is incomplete", this.lines.length - 1);
  }

  string(label: string): string {
    const item = this.nextDataLine();
    if (/^END OF MECHANICS STUFF$/i.test(item.value))
      fail(`ended before ${label}`, item.line);
    return item.value;
  }

  number(label: string): number {
    const item = this.nextDataLine();
    const values = this.parseNumbers(item.value);
    if (values.length !== 1) fail(`expected ${label}`, item.line);
    return values[0];
  }

  integer(label: string, min: number, max: number): number {
    const item = this.nextDataLine();
    const values = this.parseNumbers(item.value);
    if (
      values.length !== 1 ||
      !Number.isInteger(values[0]) ||
      values[0] < min ||
      values[0] > max
    )
      fail(`expected bounded integer ${label}`, item.line);
    return values[0];
  }

  vector3(label: string): MechanicsVec3 {
    const item = this.nextDataLine();
    const values = this.parseNumbers(item.value);
    if (values.length !== 3)
      fail(`expected three values for ${label}`, item.line);
    return [values[0], values[1], values[2]];
  }

  vector2(label: string): MechanicsVec2 {
    const item = this.nextDataLine();
    const values = this.parseNumbers(item.value);
    if (values.length !== 2)
      fail(`expected two values for ${label}`, item.line);
    return [values[0], values[1]];
  }

  end(): void {
    const item = this.nextDataLine();
    if (!/^END OF MECHANICS STUFF$/i.test(item.value))
      fail("expected END OF MECHANICS STUFF", item.line);
  }

  private parseNumbers(value: string): number[] {
    const parts = value.split(/[\s,]+/).filter(Boolean);
    if (!parts.length) return [];
    const numericPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?$/;
    if (!parts.every((part) => numericPattern.test(part))) return [];
    const numbers = parts.map(Number);
    return numbers.every(Number.isFinite) ? numbers : [];
  }
}

function isZero(vector: MechanicsVec3): boolean {
  return vector[0] === 0 && vector[1] === 0 && vector[2] === 0;
}

function readWheel(reader: MechanicsReader): MechanicsWheel {
  const type = reader.integer("wheel type", 0, 255);
  const identifier = reader.string("wheel identifier");
  const actor = reader.string("wheel actor");
  const position = reader.vector3("wheel position");
  const steerableFlag = reader.integer("steerable flag", 0, 0x7fffffff);
  const drivenFlag = reader.integer("driven flag", 0, 0x7fffffff);
  const suspensionGive = reader.number("suspension give");
  const damping = reader.number("damping");
  const slippingFrictionReduction = reader.number(
    "slipping friction reduction",
  );
  const frictionAngles = reader.vector2("friction angles");
  const tractionMultiplier = reader.number("traction multiplier");
  const rollingResistance = reader.number("rolling resistance");
  return {
    type,
    identifier,
    actor,
    position,
    positionFromActor: isZero(position),
    steerableFlag,
    drivenFlag,
    steerable: steerableFlag !== 0,
    driven: drivenFlag !== 0,
    suspensionGive,
    damping,
    slippingFrictionReduction,
    frictionAngles,
    tractionMultiplier,
    rollingResistance,
  };
}

function readShapes(reader: MechanicsReader): MechanicsShape[] {
  const count = reader.integer("bounding shape count", 0, MAX_SHAPES);
  const shapes: MechanicsShape[] = [];
  for (let i = 0; i < count; i++) {
    const kind = reader.string("bounding shape type").toLowerCase();
    switch (kind) {
      case "box":
        shapes.push({
          kind,
          bounds: {
            min: reader.vector3("box minimum"),
            max: reader.vector3("box maximum"),
          },
        });
        break;
      case "polyhedron": {
        const vertexCount = reader.integer(
          "polyhedron vertex count",
          0,
          MAX_POLYHEDRON_VERTICES,
        );
        const vertices = Array.from({ length: vertexCount }, () =>
          reader.vector3("polyhedron vertex"),
        );
        shapes.push({ kind, vertices });
        break;
      }
      case "sphere":
        shapes.push({
          kind,
          radius: reader.number("sphere radius"),
          center: reader.vector3("sphere center"),
        });
        break;
      case "wire": {
        const vertexCount = reader.integer(
          "wire vertex count",
          0,
          MAX_WIRE_VERTICES,
        );
        const vertices = Array.from({ length: vertexCount }, () =>
          reader.vector3("wire vertex"),
        );
        const edgeCount = reader.integer("wire edge count", 0, MAX_WIRE_EDGES);
        const edges: Array<[number, number]> = [];
        for (let edge = 0; edge < edgeCount; edge++) {
          const pair = reader.vector2("wire edge");
          if (
            !Number.isInteger(pair[0]) ||
            !Number.isInteger(pair[1]) ||
            pair[0] < 0 ||
            pair[1] < 0 ||
            pair[0] >= vertexCount ||
            pair[1] >= vertexCount
          )
            throw new Error(
              "Car mechanics wire edge references an invalid vertex",
            );
          edges.push([pair[0], pair[1]]);
        }
        shapes.push({ kind, vertices, edges });
        break;
      }
      default:
        throw new Error(
          `Car mechanics has unsupported bounding shape: ${kind}`,
        );
    }
  }
  return shapes;
}

/** Parse the original version 1 car mechanics block; malformed/truncated data throws. */
export function parseCarMechanics(text: string): CarMechanics {
  if (text.length > MAX_TEXT_LENGTH)
    throw new Error("Car mechanics text exceeds the size limit");
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.length > MAX_LINES)
    throw new Error("Car mechanics text exceeds the line limit");
  const marker = lines.findIndex((line) =>
    /^\s*START OF MECHANICS STUFF\s+version\s+(\d+)\s*$/i.test(line),
  );
  if (marker < 0)
    throw new Error("Car mechanics version 1 section was not found");
  const versionMatch = lines[marker].match(/version\s+(\d+)/i);
  const mechanicsVersion = Number(versionMatch?.[1]);
  if (mechanicsVersion !== 1)
    throw new Error(`Unsupported car mechanics version: ${mechanicsVersion}`);

  const reader = new MechanicsReader(text, marker);
  const minimumTurningCircle = reader.number("minimum turning circle");
  const brakeMultiplier = reader.number("brake multiplier");
  const brakingStrengthMultiplier = reader.number(
    "braking strength multiplier",
  );
  const gearCount = reader.integer("gear count", 1, 32);
  const speedAtRedline = reader.number("speed at redline");
  const highestGearAcceleration = reader.number("highest gear acceleration");

  const root = {
    type: reader.string("root type"),
    identifier: reader.string("root identifier"),
    actor: reader.string("root actor"),
    jointType: reader.string("root joint type"),
    centerOfMass: reader.vector3("center of mass"),
    mass: reader.number("mass"),
    inertiaDimensions: reader.vector3("inertia dimensions"),
    inertia: [0, 0, 0] as MechanicsVec3,
    downforceBalanceSpeed: reader.number("downforce balance speed"),
  };
  if (root.mass <= 0) throw new Error("Car mechanics mass must be positive");
  const [x, y, z] = root.inertiaDimensions;
  root.inertia = [
    ((y * y + z * z) * root.mass) / 12,
    ((x * x + z * z) * root.mass) / 12,
    ((x * x + y * y) * root.mass) / 12,
  ];

  const wheelCount = reader.integer("wheel count", 0, 64);
  if (wheelCount !== 4)
    throw new Error(`Car mechanics requires four wheels; found ${wheelCount}`);
  const wheels = [
    readWheel(reader),
    readWheel(reader),
    readWheel(reader),
    readWheel(reader),
  ] as [MechanicsWheel, MechanicsWheel, MechanicsWheel, MechanicsWheel];
  const shapes = readShapes(reader);
  const subPartCount = reader.integer("subpart count", 0, 4096);
  reader.end();

  return {
    mechanicsVersion,
    minimumTurningCircle,
    brakeMultiplier,
    brakingStrengthMultiplier,
    gearCount,
    speedAtRedline,
    highestGearAcceleration,
    root,
    wheels,
    shapes,
    subPartCount,
  };
}
