const GRAVITY_MARKER = /^\s*\/\/\s*default\s+Gravity\s+Multiplier\s*$/i;
const SCALAR = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Read GENERAL's `// default Gravity Multiplier` scalar. */
export function parseDefaultGravityMultiplier(text: string): number {
  const lines = text.split(/\r?\n/);
  const markers = lines.flatMap((line, index) =>
    GRAVITY_MARKER.test(line) ? [index] : [],
  );
  if (markers.length !== 1)
    throw new Error(
      "GENERAL must contain one default Gravity Multiplier label",
    );

  for (const raw of lines.slice(markers[0] + 1)) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!line) continue;
    if (!SCALAR.test(line))
      throw new Error("Invalid default Gravity Multiplier scalar");
    const value = Number(line);
    if (!Number.isFinite(value))
      throw new Error("Invalid default Gravity Multiplier scalar");
    return value;
  }
  throw new Error("Missing default Gravity Multiplier scalar");
}

/** Global gravity value: powerups assign it and reset restores GENERAL's default. */
export class GlobalGravityState {
  readonly defaultMultiplier: number;
  multiplier: number;

  constructor(defaultMultiplier: number) {
    if (!Number.isFinite(defaultMultiplier))
      throw new Error("Default gravity multiplier must be finite");
    const stored = Math.fround(defaultMultiplier);
    if (!Number.isFinite(stored))
      throw new Error("Default gravity multiplier exceeds native float range");
    this.defaultMultiplier = stored;
    this.multiplier = stored;
  }

  setPowerup(parameters: readonly number[]): number {
    const value = parameters[0];
    if (value === undefined || !Number.isFinite(value))
      throw new Error("Gravity powerup requires a finite first parameter");
    const stored = Math.fround(value);
    if (!Number.isFinite(stored))
      throw new Error("Gravity powerup exceeds native float range");
    this.multiplier = stored;
    return this.multiplier;
  }

  reset(): number {
    this.multiplier = this.defaultMultiplier;
    return this.multiplier;
  }
}
