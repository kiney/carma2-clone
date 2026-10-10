import type { OpponentConfig, RaceCatalog } from "./config";

// Installed ftol 0x575190 converts through signed64 and returns its low32.
// Masked invalid conversions (including native denominator-zero NaN) return 0.
const nativeTrunc = (value: number): number =>
  Number.isFinite(value) ? Math.trunc(value) : 0;

/** Installed LoadRaces 0x48c502–0x48c61e: preserve authored requests, then
 * interpolate missing strength tiers. Positive/zero entries are catalog IDs;
 * negatives request random opponents of the corresponding positive strength.
 */
export function resolveOpponentRequests(
  catalog: RaceCatalog,
  raceIndex: number,
): number[] {
  if (
    !Number.isSafeInteger(raceIndex) ||
    raceIndex < 0 ||
    raceIndex >= catalog.races.length
  )
    throw new RangeError("Invalid opponent selection race index");
  const race = catalog.races[raceIndex];
  const first = catalog.firstRaceDefaults;
  const last = catalog.lastRaceDefaults;
  for (const value of [
    race.numberOfOpponents,
    first.numberOfOpponents,
    last.numberOfOpponents,
    ...first.softnessHardness,
    ...last.softnessHardness,
  ]) {
    if (!Number.isFinite(value))
      throw new RangeError("Opponent selection defaults must be finite");
  }
  if (!Number.isSafeInteger(race.numberOfOpponents))
    throw new RangeError("Opponent count must be an integer");

  const factor = raceIndex / (catalog.races.length - 1);
  const count =
    race.numberOfOpponents < 0
      ? nativeTrunc(
          first.numberOfOpponents +
            factor * (last.numberOfOpponents - first.numberOfOpponents),
        )
      : race.numberOfOpponents;
  // Original request storage has 15 slots; reject overflow, never shrink it.
  if (!Number.isSafeInteger(count) || count < 0 || count > 15)
    throw new RangeError(
      `Opponent count ${count} exceeds native request bounds`,
    );
  const requests = race.explicitOpponents.slice(0, count);
  if (requests.some((request) => !Number.isSafeInteger(request)))
    throw new RangeError(
      "Opponent requests must be integer catalog IDs or tiers",
    );
  const explicitCount = requests.length;
  if (explicitCount === count) return requests;

  // Softness is stored as float32 at 0x48c592; hardest endpoint stays on x87.
  const softness = Math.fround(
    first.softnessHardness[0] +
      factor * (last.softnessHardness[0] - first.softnessHardness[0]),
  );
  const hardest =
    first.softnessHardness[1] +
    factor * (last.softnessHardness[1] - first.softnessHardness[1]);
  for (let slot = explicitCount; slot < count; slot++) {
    const strength = nativeTrunc(
      softness +
        (hardest - softness) *
          ((slot - explicitCount) / (count - 1 - explicitCount)),
    );
    // One missing slot produces NaN, ftol ->0, then the native <=0 fallback.
    requests.push(-Math.max(1, Math.min(strength, 5)));
  }
  return requests;
}

/** Installed SelectOpponents 0x5036b0 and ChooseOpponent 0x5037d0.
 * Authored duplicate IDs and the player's ID are valid explicit selections.
 * Random fillers exclude all explicitly selected IDs and the player's ID.
 */
export function selectOpponentIds(
  requests: readonly number[],
  opponents: readonly OpponentConfig[],
  playerId: number,
  random: () => number = Math.random,
): number[] {
  if (!Number.isSafeInteger(playerId))
    throw new RangeError("Player opponent catalog ID must be an integer");
  const picked = new Set<number>();
  for (const request of requests) {
    if (!Number.isSafeInteger(request))
      throw new RangeError(
        "Opponent requests must be integer catalog IDs or tiers",
      );
    if (request >= 0) {
      if (!opponents[request])
        throw new RangeError(`Unknown explicit opponent catalog ID ${request}`);
      // Native 0x503726 marks actual IDs; rec2 incorrectly marks slot indices.
      picked.add(request);
    }
  }
  return requests.map((request) => {
    if (request >= 0) return request;
    const eligible = opponents.flatMap((opponent, id) =>
      opponent.strengthRating >= 1 &&
      opponent.strengthRating <= 5 &&
      id !== playerId &&
      !picked.has(id)
        ? [id]
        : [],
    );
    // Native retries forever if exhausted. Fail clearly instead of hanging or
    // silently reducing the original objective population.
    if (!eligible.length)
      throw new Error(`No eligible opponent remains for strength ${-request}`);
    let strength = -request;
    let candidates = eligible.filter(
      (id) => opponents[id].strengthRating === strength,
    );
    while (!candidates.length) {
      strength = strength < 5 ? strength + 1 : 0;
      candidates =
        strength === 0
          ? eligible
          : eligible.filter((id) => opponents[id].strengthRating === strength);
    }
    const draw = random();
    if (!Number.isFinite(draw) || draw < 0 || draw >= 1)
      throw new RangeError(
        "Opponent random callback must return a value in [0, 1)",
      );
    const id = candidates[Math.floor(draw * candidates.length)];
    picked.add(id);
    return id;
  });
}
