/** Strict parser and evaluator for the six original car impact damage programs. */

export type DamageAxis = "x" | "y" | "z";
export type DamageOperator = "<" | ">";
export type ImpactLocation =
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "front"
  | "rear";

export const DAMAGE_SYSTEMS = [
  "engine",
  "transmission",
  "driver",
  "steering",
  "lf_brake",
  "rf_brake",
  "lr_brake",
  "rr_brake",
  "lf_wheel",
  "rf_wheel",
  "lr_wheel",
  "rr_wheel",
] as const;

export type DamageSystem = (typeof DAMAGE_SYSTEMS)[number];

export interface DamageCondition {
  axis: DamageAxis;
  operator: DamageOperator;
  threshold: number;
}

export interface DamageEffect {
  system: DamageSystem;
  systemIndex: number;
  weaknessFactor: number;
}

export interface DamageClause {
  conditions: DamageCondition[];
  effects: DamageEffect[];
}

export interface DamageProgram {
  location: ImpactLocation;
  clauses: DamageClause[];
}

export interface DamageProgramSet {
  version: number;
  name: string;
  softness: number;
  engineNoises: [number, number, number];
  canBeStolen: boolean;
  programs: Record<ImpactLocation, DamageProgram>;
}

export type NormalizedPoint = [number, number, number];

const IMPACT_LOCATIONS: ImpactLocation[] = [
  "top",
  "bottom",
  "left",
  "right",
  "front",
  "rear",
];
const MAX_TEXT_LENGTH = 1024 * 1024;
const MAX_LINES = 20_000;
const MAX_CLAUSES = 128;
const MAX_EFFECTS_PER_CLAUSE = 4;

function parseError(message: string, line: number): never {
  throw new Error(`Damage program ${message} at line ${line + 1}`);
}

class DataReader {
  private at = 0;

  constructor(private readonly lines: string[]) {}

  line(label: string): { text: string; number: number } {
    while (this.at < this.lines.length) {
      const number = this.at++;
      const text = this.lines[number].replace(/\/\/.*$/, "").trim();
      if (text) return { text, number };
    }
    return parseError(
      `section is incomplete; expected ${label}`,
      this.lines.length - 1,
    );
  }

  expect(regex: RegExp, label: string): string {
    const item = this.line(label);
    const match = item.text.match(regex);
    if (!match) parseError(`expected ${label}`, item.number);
    return match[1] ?? item.text;
  }

  number(label: string): number {
    const item = this.line(label);
    const values = parseNumericLine(item.text);
    if (values.length !== 1) parseError(`expected ${label}`, item.number);
    return values[0];
  }

  integer(label: string, minimum: number, maximum: number): number {
    const item = this.line(label);
    const values = parseNumericLine(item.text);
    if (
      values.length !== 1 ||
      !Number.isInteger(values[0]) ||
      values[0] < minimum ||
      values[0] > maximum
    )
      parseError(`expected bounded integer ${label}`, item.number);
    return values[0];
  }

  numbers(label: string, count: number): number[] {
    const item = this.line(label);
    const values = parseNumericLine(item.text);
    if (values.length !== count)
      parseError(`expected ${count} numbers for ${label}`, item.number);
    return values;
  }
}

function parseNumericLine(line: string): number[] {
  const tokens = line.split(/[\s,]+/).filter(Boolean);
  const number = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?$/;
  if (!tokens.length || !tokens.every((token) => number.test(token))) return [];
  const values = tokens.map(Number);
  return values.every(Number.isFinite) ? values : [];
}

function parseConditions(text: string, line: number): DamageCondition[] {
  if (/^always$/i.test(text)) return [];
  const pieces = text.split("&").map((part) => part.trim());
  if (pieces.length < 1 || pieces.length > 2)
    parseError("condition must have at most two comparisons", line);
  return pieces.map((piece) => {
    const match = piece.match(
      /^([xyz])\s*([<>])\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?)$/i,
    );
    if (!match) parseError("has an invalid condition comparison", line);
    const threshold = Number(match[3]);
    if (!Number.isFinite(threshold))
      parseError("condition threshold is not finite", line);
    return {
      axis: match[1].toLowerCase() as DamageAxis,
      operator: match[2] as DamageOperator,
      threshold,
    };
  });
}

function parseClause(reader: DataReader): DamageClause {
  const conditionLine = reader.line("clause condition");
  const conditions = parseConditions(conditionLine.text, conditionLine.number);
  const effectCount = reader.integer("effect count", 0, MAX_EFFECTS_PER_CLAUSE);
  const effects: DamageEffect[] = [];
  for (let i = 0; i < effectCount; i++) {
    const item = reader.line("damage system and weakness factor");
    const fields = item.text.split(/[\s,\/]+/).filter(Boolean);
    if (fields.length !== 2)
      parseError("expected damage system and weakness factor", item.number);
    const systemIndex = DAMAGE_SYSTEMS.indexOf(fields[0] as DamageSystem);
    const weaknessFactor = Number(fields[1]);
    if (systemIndex < 0)
      parseError(`contains unknown damage system ${fields[0]}`, item.number);
    if (
      !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?$/.test(fields[1]) ||
      !Number.isFinite(weaknessFactor)
    )
      parseError("weakness factor is not a finite number", item.number);
    effects.push({
      system: DAMAGE_SYSTEMS[systemIndex],
      systemIndex,
      weaknessFactor,
    });
  }
  return { conditions, effects };
}

function parseProgram(
  reader: DataReader,
  location: ImpactLocation,
): DamageProgram {
  const clauseCount = reader.integer("clause count", 0, MAX_CLAUSES);
  const clauses = Array.from({ length: clauseCount }, () =>
    parseClause(reader),
  );
  return { location, clauses };
}

/**
 * Read loader-ordered fields through the six impact programs. For old unversioned
 * headers, the first non-comment line is treated as the car name, as LoadCar does.
 */
export function parseDamagePrograms(text: string): DamageProgramSet {
  if (text.length > MAX_TEXT_LENGTH)
    throw new Error("Damage program text exceeds the size limit");
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.length > MAX_LINES)
    throw new Error("Damage program text exceeds the line limit");

  const reader = new DataReader(lines);
  const first = reader.line("version or car name");
  let version = 0;
  let name: string;
  const versionMatch = first.text.match(/^VERSION\s+(\d+)$/i);
  if (versionMatch) {
    version = Number(versionMatch[1]);
    if (version > 2)
      throw new Error(`Unsupported car header version: ${version}`);
    const next = reader.line("car name");
    if (/^(?:GIRL|BOY)$/i.test(next.text)) name = reader.line("car name").text;
    else name = next.text;
  } else if (/^(?:GIRL|BOY)$/i.test(first.text)) {
    name = reader.line("car name").text;
  } else {
    name = first.text;
  }
  const softness = reader.number("softness factor");
  if (softness < 0)
    throw new Error("Damage program softness must not be negative");
  reader.expect(/^START OF DRIVABLE STUFF$/i, "START OF DRIVABLE STUFF");
  let foundDrivableEnd = false;
  while (true) {
    const item = reader.line("END OF DRIVABLE STUFF");
    if (/^END OF DRIVABLE STUFF$/i.test(item.text)) {
      foundDrivableEnd = true;
      break;
    }
  }
  if (!foundDrivableEnd)
    throw new Error("Damage program drivable section is incomplete");

  const engineNoises = reader.numbers("engine noise ids", 3) as [
    number,
    number,
    number,
  ];
  const stealToken = reader.expect(
    /^(stealworthy|not stealworthy|none)$/i,
    "stealworthy token",
  );
  const programs = {} as Record<ImpactLocation, DamageProgram>;
  for (const location of IMPACT_LOCATIONS) {
    programs[location] = parseProgram(reader, location);
  }

  return {
    version,
    name,
    softness,
    engineNoises,
    canBeStolen: /^stealworthy$/i.test(stealToken),
    programs,
  };
}

/** Evaluate strict axis comparisons and concatenate every matching clause's effects. */
export function evaluateDamageProgram(
  program: DamageProgram,
  localPoint: NormalizedPoint,
): DamageEffect[] {
  if (
    localPoint.length !== 3 ||
    localPoint.some((value) => !Number.isFinite(value))
  )
    throw new Error(
      "Damage program point must contain three finite coordinates",
    );
  const axisIndex = { x: 0, y: 1, z: 2 } as const;
  const matching: DamageEffect[] = [];
  for (const clause of program.clauses) {
    const passes = clause.conditions.every((condition) => {
      const value = localPoint[axisIndex[condition.axis]];
      return condition.operator === "<"
        ? value < condition.threshold
        : value > condition.threshold;
    });
    if (passes) matching.push(...clause.effects);
  }
  return matching;
}
