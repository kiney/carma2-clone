import {
  gainUpgrade,
  skillValue,
  type APOType,
  type APOValues,
  type UpgradeContext,
  type UpgradeSettings,
  type UpgradeState,
} from "./upgrades";

/** Independent expression of local GainAPO4dc030/GainAPOPotential4dc2d0.
 * One full requested type tries its two neighbours in one randomly chosen
 * direction. An all-type request never redirects its individual grants.
 * Network role-specific power eligibility belongs to the caller. */
export function applyUpgradePickup(
  state: UpgradeState,
  settings: UpgradeSettings,
  context: UpgradeContext,
  action: 46 | 47,
  integerParams: readonly number[],
  random: () => number = Math.random,
) {
  if (
    integerParams.length !== 3 ||
    integerParams.some((value) => !Number.isSafeInteger(value))
  )
    throw new Error("APO pickup needs three integer parameters");
  const target = action === 46 ? state.levels : state.potential;
  const original = [...target] as APOValues;
  const apply = (type: APOType, amount: number) => {
    if (action === 46) return gainUpgrade(state, type, amount);
    const old = state.potential[type];
    state.potential[type] = Math.min(
      old + amount,
      skillValue(settings.maximum[type], context),
    );
    return state.potential[type] - old;
  };
  let selectedType: APOType | undefined;
  if (integerParams.every((value) => value !== 0)) {
    for (const type of [0, 1, 2] as const) apply(type, integerParams[type]);
  } else {
    const requestedType: APOType =
      integerParams[0] !== 0 ? 0 : integerParams[1] !== 0 ? 1 : 2;
    const amount = integerParams[requestedType];
    selectedType = requestedType;
    if (apply(requestedType, amount) === 0) {
      const direction = random() < 0.5 ? 1 : -1;
      for (let offset = 1; offset < 3; offset++) {
        selectedType = ((requestedType + direction * offset + 3) %
          3) as APOType;
        if (apply(selectedType, amount) !== 0) break;
      }
    }
  }
  const gained = target.map(
    (value, type) => value - original[type],
  ) as APOValues;
  const creditsAwarded = gained.every((value) => value === 0)
    ? skillValue(
        action === 46 ? settings.substitution : settings.potentialSubstitution,
        context,
      )
    : 0;
  state.credits += creditsAwarded;
  return { gained, creditsAwarded, selectedType };
}
