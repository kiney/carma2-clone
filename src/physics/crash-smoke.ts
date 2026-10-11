/** The ORIGINAL DoCrashEarnings440550 arguments, before driver normalization.
 * A non-car's accumulator is not read when its driver is <=5. */
export interface NativeCrashSmokeArgument {
  driver: number;
  accumulatorF32: number;
}

/** Caller-owned normalized car snapshot, captured BEFORE attribution clears
 * accumulated damage or refreshes the last-attacker timestamp. */
export interface NativeCrashSmokeCar {
  frameKnackered: boolean;
  accumulatorF32: number;
  lastAttackerMs: number;
}

export interface NativeCrashSmokeReturnInput {
  originalFirst: NativeCrashSmokeArgument | null;
  originalSecond: NativeCrashSmokeArgument | null;
  normalizedFirst: NativeCrashSmokeCar | null;
  normalizedSecond: NativeCrashSmokeCar | null;
  nowMs: number;
}

const LOW_DAMAGE = Math.fround(0.00005);

function uint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

function stored(value: number): number {
  const result = Math.fround(value);
  if (!Number.isFinite(result))
    throw new Error("Invalid native crash-smoke accumulator");
  return result;
}

function argumentDamage(arg: NativeCrashSmokeArgument | null): number {
  if (!arg) return 0;
  if (!Number.isInteger(arg.driver))
    throw new Error("Invalid native crash-smoke driver");
  return arg.driver > 5 ? stored(arg.accumulatorF32) : 0;
}

function validateCar(car: NativeCrashSmokeCar | null): void {
  if (!car) return;
  if (typeof car.frameKnackered !== "boolean" || !uint32(car.lastAttackerMs))
    throw new Error("Invalid native crash-smoke car snapshot");
  stored(car.accumulatorF32);
}

/** Exact return-value channel of installed DoCrashEarnings440550–441239.
 * CrashEarnings440530 invokes SortOutSmoke on its ORIGINAL first/second args
 * iff this is true, independently of selected attacker/victim or cleanup.
 *
 * Driver normalization/history-owner writes remain the caller's responsibility:
 * <=5 first + >5 second moves the second into first and clears second; a <=5
 * second is also cleared. The saved damage fields precede those operations.
 * This helper does not replace the attribution selector or mutate its state. */
export function nativeCrashSmokeReturn(
  input: NativeCrashSmokeReturnInput,
): boolean {
  if (!uint32(input.nowMs))
    throw new Error("Invalid native crash-smoke platform timestamp");
  const originalFirstDamage = argumentDamage(input.originalFirst);
  const originalSecondDamage = argumentDamage(input.originalSecond);
  validateCar(input.normalizedFirst);
  validateCar(input.normalizedSecond);
  const firstOrdinary = (input.originalFirst?.driver ?? 0) > 5;
  const secondOrdinary = (input.originalSecond?.driver ?? 0) > 5;
  const first = input.normalizedFirst;
  const second = input.normalizedSecond;
  // Installed4405f2/4405fb return0 when neither original argument is a car.
  if (!firstOrdinary && !secondOrdinary) {
    if (first || second)
      throw new Error("Invalid native crash-smoke normalized pair");
    return false;
  }
  if (!first || Boolean(second) !== (firstOrdinary && secondOrdinary))
    throw new Error("Invalid native crash-smoke normalized pair");

  // Installed4405ab saves __ftol's low DWORD of ORIGINAL first damage. Its
  // integer test differs from the ORIGINAL second's float!=0 test4405d0.
  const savedDamageReturn =
    (Math.trunc(originalFirstDamage) | 0) !== 0 ||
    (second !== null && originalSecondDamage !== 0);
  // These branches jump441129 without clearing accumulators, then use the
  // same saved-damage return gate as ordinary accepted cleanup44110f–441123.
  if (
    first.frameKnackered ||
    second?.frameKnackered ||
    (second &&
      stored(first.accumulatorF32) <= LOW_DAMAGE &&
      stored(second.accumulatorF32) <= LOW_DAMAGE)
  )
    return savedDamageReturn;

  // Installed440a81 JGE441141 returns1 directly, even with zero saved damage.
  // This signed wrapped PD-clock age is evaluated only after the early gates.
  if (!second && ((input.nowMs - first.lastAttackerMs) | 0) >= 5000)
    return true;
  return savedDamageReturn;
}
