const COMPONENT_COUNT = 12;
const MAX_COMPONENT_LEVEL = 99;
const MAX_COMPONENT_DELTA = COMPONENT_COUNT * MAX_COMPONENT_LEVEL;
const F32 = Math.fround;

function componentArray(
  value: unknown,
  label: string,
): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== COMPONENT_COUNT)
    throw new TypeError(`${label} must be a 12-entry Uint8Array`);
  for (const level of value) {
    if (level > MAX_COMPONENT_LEVEL)
      throw new RangeError(`${label} component levels must be in 0..99`);
  }
}

/**
 * HW 0x440ce5..0x440d68: independently scale each car's increasing component
 * damage for a crash pair. Baselines remain separate from current levels;
 * repeated pairs therefore compound against the most recent snapshot.
 */
export function redistributeNativeCrashDamage(
  attacker: Uint8Array,
  attackerLast: Uint8Array,
  victim: Uint8Array,
  victimLast: Uint8Array,
): number {
  componentArray(attacker, "attacker");
  componentArray(attackerLast, "attackerLast");
  componentArray(victim, "victim");
  componentArray(victimLast, "victimLast");

  let victimDamage = 0;
  for (let index = 0; index < COMPONENT_COUNT; index++) {
    const victimLevel = victim[index];
    const victimBaseline = victimLast[index];
    if (victimLevel > victimBaseline) {
      const increased = Math.min(
        MAX_COMPONENT_LEVEL,
        Math.trunc(victimBaseline + 2 * (victimLevel - victimBaseline)),
      );
      victimDamage += increased - victimBaseline;
      victim[index] = increased;
    }

    const attackerLevel = attacker[index];
    const attackerBaseline = attackerLast[index];
    if (attackerLevel > attackerBaseline) {
      attacker[index] = Math.max(
        0,
        Math.trunc(attackerBaseline + 0.1 * (attackerLevel - attackerBaseline)),
      );
    }
  }
  return victimDamage;
}

function nonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(`${label} must be finite and nonnegative`);
}

function authoredRate(value: number, label: string): number {
  nonnegative(value, label);
  const rate = F32(value);
  if (!Number.isFinite(rate))
    throw new RangeError(`${label} exceeds Float32 bounds`);
  return rate;
}

/** HW 0x440fd2..0x4410e4: convert transferred damage to credits and time. */
export function nativeCrashDamageAward(
  componentDelta: number,
  softness: number,
  multiplier: number,
  creditsPerDamage: number,
  secondsPerDamage: number,
): { rawCredits: number; credits: number; seconds: number } {
  if (
    !Number.isSafeInteger(componentDelta) ||
    componentDelta < 0 ||
    componentDelta > MAX_COMPONENT_DELTA
  )
    throw new RangeError(
      `componentDelta must be an integer in 0..${MAX_COMPONENT_DELTA}`,
    );
  if (!Number.isFinite(softness) || softness <= 0)
    throw new RangeError("softness must be finite and positive");
  nonnegative(multiplier, "multiplier");

  const creditsRate = authoredRate(creditsPerDamage, "creditsPerDamage");
  const secondsRate = authoredRate(secondsPerDamage, "secondsPerDamage");
  const softnessOperand = F32(softness);
  if (!Number.isFinite(softnessOperand) || softnessOperand <= 0)
    throw new RangeError("softness is outside positive Float32 bounds");
  const damage = Math.trunc(componentDelta * (0.7 / softnessOperand));
  if (!Number.isSafeInteger(damage) || damage < 0)
    throw new RangeError("softness produces an out-of-range damage value");
  const storedDamage = F32(damage);
  if (!Number.isFinite(storedDamage))
    throw new RangeError("damage exceeds Float32 bounds");

  const creditUnits = Math.trunc(
    (creditsRate * storedDamage * Math.min(multiplier, 8) + F32(50)) *
      F32(0.01),
  );
  const rawCredits = 100 * creditUnits;
  const credits = Math.min(rawCredits, 2000);
  const seconds = Math.min(
    5 * Math.trunc((secondsRate * storedDamage + 2.5) * 0.2),
    90,
  );
  return { rawCredits, credits, seconds };
}
