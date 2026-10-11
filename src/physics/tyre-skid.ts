const DOUBLE_TENTH = 0.1;

function store(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`Invalid tyre-skid ${name}`);
  const stored = Math.fround(value);
  if (!Number.isFinite(stored))
    throw new Error(`Tyre-skid ${name} exceeds Float32 bounds`);
  return stored;
}

function exceedsThreshold(quotient: number, threshold: number): boolean {
  return quotient >= threshold;
}

/** Reconstructs the installed rear/front skid request gates (HW
 * 0x41aca7–0x41adc5 and 0x41b137–0x41b32c). This reports wheel requests only;
 * tyre-force allocation remains in allocateTyrePair. Inputs enter as Float32
 * stores, while the source quotient comparisons retain their live precision. */
export function nativeTyreSkidRequests(
  demand: number,
  cap0: number,
  cap1: number,
  reduction: number,
  isCurrentCar: boolean,
): [boolean, boolean] {
  const d = store(demand, "demand");
  const c0 = store(cap0, "first capacity");
  const c1 = store(cap1, "second capacity");
  const r = store(reduction, "reduction");
  if (typeof isCurrentCar !== "boolean")
    throw new Error("Invalid tyre-skid current-car identity");

  const threshold = isCurrentCar ? 20 : 60;
  const requested: [boolean, boolean] = [false, false];
  const qualifies = (cap: number) => cap > DOUBLE_TENTH;

  if (d > c0 && d > c1) {
    const denominator = Math.fround(c0 + c1);
    const numerator = d + d - c0 - c1;
    const quotient = denominator === 0 ? Infinity : numerator / denominator;
    if (exceedsThreshold(quotient, threshold)) {
      requested[0] = qualifies(c0);
      requested[1] = qualifies(c1);
    }
    return requested;
  }

  if (d > c0) {
    const firstAllocation = Math.fround(r * c0);
    const residualLive = d - firstAllocation + d;
    if (residualLive > c1 && qualifies(c1)) {
      const residualStored = Math.fround(residualLive);
      const quotient = (residualStored - c1) / c1;
      if (exceedsThreshold(quotient, threshold)) requested[1] = true;
    }
    return requested;
  }

  if (d > c1) {
    const firstAllocation = Math.fround(r * c1);
    const residualLive = d - firstAllocation + d;
    if (residualLive > c0 && qualifies(c0)) {
      const residualStored = Math.fround(residualLive);
      const quotient = (residualStored - c0) / c0;
      if (exceedsThreshold(quotient, threshold)) requested[0] = true;
    }
  }
  return requested;
}
