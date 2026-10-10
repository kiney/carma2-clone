/** Independently expressed GENERAL.TXT/APO and repair rules from the local HW
 * loader 0x486d90, engine 0x415320, repair key branch 0x4432cc and APO helpers.
 * Order is armour, power, offensive. These are damage/engine factors, not mass.
 */
export type APOType = 0 | 1 | 2;
export type APOValues = [number, number, number];
export interface SkillValues {
  skill: APOValues;
  network: number[];
}
export interface UpgradeSettings {
  initial: [SkillValues, SkillValues, SkillValues];
  potential: [SkillValues, SkillValues, SkillValues];
  maximum: [SkillValues, SkillValues, SkillValues];
  cost: SkillValues;
  tradeIn: SkillValues;
  substitution: SkillValues;
  potentialSubstitution: SkillValues;
  base: APOValues;
  perLevel: APOValues;
  factors: [number[], number[], number[]];
  netTimeReplacement: number;
  startingMoney: SkillValues;
  repairCost: SkillValues;
  recoveryCost: SkillValues;
  softness: SkillValues;
  carDamageMultiplier: SkillValues;
}
export interface UpgradeContext {
  skill: 0 | 1 | 2;
  networkType?: number;
}
export interface UpgradeState {
  levels: APOValues;
  potential: APOValues;
  credits: number;
}

/** Read the original labelled APO subsection, preserving all 3 skill / 8 network
 * columns. Comments locate its start; subsequent records follow the HW grammar.
 */
export function parseUpgradeSettings(text: string): UpgradeSettings {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const start = lines.findIndex((line) =>
    /\/\/\s*Initial armou?r,\s*single player/i.test(line),
  );
  if (start < 0)
    throw new Error("GENERAL.TXT: missing Initial armour subsection");
  let cursor = start;
  function values(count: number, label: string, integer = false): number[] {
    while (cursor < lines.length) {
      const line = lines[cursor++].split("//")[0].trim();
      if (!line) continue;
      const parts = line.split(/[\s,]+/).map(Number);
      if (
        parts.length !== count ||
        parts.some(
          (n) =>
            !Number.isFinite(n) ||
            n < 0 ||
            (integer && !Number.isSafeInteger(n)),
        )
      ) {
        throw new Error(`GENERAL.TXT: invalid ${label} at line ${cursor}`);
      }
      return integer ? parts : parts.map(Math.fround);
    }
    throw new Error(`GENERAL.TXT: missing ${label}`);
  }
  function bunch(label: string, integer = true): SkillValues {
    return {
      skill: values(3, `${label} skill`, integer) as APOValues,
      network: values(8, `${label} network`, integer),
    };
  }
  const triple = (label: string) =>
    [
      bunch(`${label} armour`),
      bunch(`${label} power`),
      bunch(`${label} offensive`),
    ] as [SkillValues, SkillValues, SkillValues];
  const initial = triple("initial"),
    potential = triple("potential"),
    maximum = triple("maximum");
  const cost = bunch("cost"),
    tradeIn = bunch("trade-in"),
    substitution = bunch("substitution"),
    potentialSubstitution = bunch("potential substitution");
  const base = [
    values(1, "armour base")[0],
    values(1, "power base")[0],
    values(1, "offensive base")[0],
  ] as APOValues;
  const perLevel = [
    values(1, "armour multiplier")[0],
    values(1, "power multiplier")[0],
    values(1, "offensive multiplier")[0],
  ] as APOValues;
  const factors = base.map((value, type) => {
    const table = [value];
    for (let i = 1; i < 100; i++)
      table.push(Math.fround(table[i - 1] * perLevel[type]));
    return table;
  }) as [number[], number[], number[]];
  return {
    initial,
    potential,
    maximum,
    cost,
    tradeIn,
    substitution,
    potentialSubstitution,
    base,
    perLevel,
    factors,
    netTimeReplacement: values(1, "network time replacement", true)[0],
    startingMoney: bunch("starting money"),
    repairCost: bunch("repair cost", false),
    recoveryCost: bunch("recovery cost", false),
    softness: bunch("softness", false),
    carDamageMultiplier: bunch("car damage", false),
  };
}

export function skillValue(
  value: SkillValues,
  context: UpgradeContext,
): number {
  const index = context.networkType ?? context.skill;
  const result =
    context.networkType === undefined
      ? value.skill[index]
      : value.network[index];
  if (!Number.isInteger(index) || result === undefined)
    throw new Error("Invalid skill/network game type");
  return result;
}
/** The HW loader reads only the first five network money columns; remaining
 * runtime slots are zero despite the eight values retained in parsed settings. */
export function createUpgradeState(
  settings: UpgradeSettings,
  context: UpgradeContext,
): UpgradeState {
  return {
    levels: settings.initial.map((v) => skillValue(v, context)) as APOValues,
    potential: settings.potential.map((v) =>
      skillValue(v, context),
    ) as APOValues,
    credits:
      context.networkType !== undefined && context.networkType >= 5
        ? 0
        : skillValue(settings.startingMoney, context),
  };
}
export function upgradeFactors(
  state: Pick<UpgradeState, "levels">,
  settings: UpgradeSettings,
) {
  const factors = state.levels.map((level, type) => {
    if (!Number.isInteger(level) || level < 0 || level >= 100)
      throw new Error("APO level outside source table");
    return settings.factors[type][level];
  });
  return { armour: factors[0], power: factors[1], offensive: factors[2] };
}

/** Local 0x502b40: buy one level only when below potential and able to pay. */
export function buyUpgrade(
  state: UpgradeState,
  type: APOType,
  settings: UpgradeSettings,
  context: UpgradeContext,
): "bought" | "full" | "unaffordable" {
  if (state.levels[type] >= state.potential[type]) return "full";
  const cost = skillValue(settings.cost, context);
  if (state.credits < cost) return "unaffordable";
  state.credits -= cost;
  state.levels[type]++;
  return "bought";
}

/** Local 0x4dc1e0: negative amount fills available slots; gains clamp to
 * potential. Pickup replacement credits are awarded separately by GainAPO. */
export function gainUpgrade(
  state: UpgradeState,
  type: APOType,
  amount: number,
): number {
  const old = state.levels[type];
  if (amount < 0) amount = Math.max(0, state.potential[type] - old);
  state.levels[type] = Math.min(
    state.potential[type],
    old + Math.trunc(amount),
  );
  return state.levels[type] - old;
}

/** Source rejection sampling chooses among all three types, retrying empty types.
 * Inject an integer RNG for replay; it must eventually select an available type.
 */
export function tradeInAPO(
  state: UpgradeState,
  cost: number,
  settings: UpgradeSettings,
  context: UpgradeContext,
  randomType: () => APOType = () => Math.floor(Math.random() * 3) as APOType,
) {
  let remaining = Math.trunc(cost);
  const sold: APOValues = [0, 0, 0];
  const value = skillValue(settings.tradeIn, context);
  let emptyAttempts = 0;
  while (remaining > 0 && state.levels.some((level) => level !== 0)) {
    const type = randomType();
    if (type !== 0 && type !== 1 && type !== 2)
      throw new Error("APO random type must be 0, 1 or 2");
    if (!state.levels[type]) {
      if (++emptyAttempts > 100000)
        throw new Error("APO random source never selects a remaining upgrade");
      continue;
    }
    emptyAttempts = 0;
    state.levels[type]--;
    sold[type]++;
    remaining -= value;
    state.credits += value;
  }
  return { remainingCost: Math.max(0, remaining), sold };
}

/** RepairCar returns bodywork amount restored this frame and total deflection.
 * The original then proportionally repairs all 12 damage components and rounds
 * their total bill down to a multiple of ten. No deflection means full repair.
 */
export function repairComponents(
  levels: readonly number[],
  repaired: number,
  totalDeflection: number,
  settings: UpgradeSettings,
  context: UpgradeContext,
) {
  if (levels.length !== 12)
    throw new Error("C2 repair requires 12 damage components");
  if (
    repaired < 0 ||
    totalDeflection < 0 ||
    !Number.isFinite(repaired + totalDeflection)
  )
    throw new Error("Invalid repair deflection");
  const price = skillValue(settings.repairCost, context);
  let cost = 0,
    difference = 0;
  const damage = levels.map((old) => {
    const restored =
      totalDeflection === 0
        ? old
        : Math.floor(
            old * (Math.fround(repaired) / Math.fround(totalDeflection)),
          );
    const level = Math.max(0, Math.min(99, Math.trunc(old - restored)));
    difference += old - level;
    cost = Math.trunc(cost + (old - level) * price);
    return level;
  });
  return {
    damage,
    cost: 10 * Math.trunc(cost / 10),
    difference,
    finished: cost === 0 && repaired === 0,
  };
}

/** SpendCredits clamps to zero. TradeInAPO receives the FULL bill rather than
 * the cash deficit; this original quirk can sell more APO than strictly needed.
 */
export function payRepair(
  state: UpgradeState,
  cost: number,
  settings: UpgradeSettings,
  context: UpgradeContext,
  free = false,
  randomType?: () => APOType,
) {
  const sold: APOValues = [0, 0, 0];
  if (!free) {
    if (cost > state.credits)
      sold.splice(
        0,
        3,
        ...tradeInAPO(state, cost, settings, context, randomType).sold,
      );
    state.credits = Math.max(0, state.credits - cost);
  }
  return { charged: free ? 0 : cost, sold };
}
export interface RepairControl {
  autoRepair: boolean;
  lastRepairTime: number;
  repairWasHeld: boolean;
}
export function createRepairControl(): RepairControl {
  return { autoRepair: false, lastRepairTime: 0, repairWasHeld: false };
}
/** Source double tap enables auto repair within 1200ms; blocking cancels hold
 * bookkeeping but retains auto repair until a completed repair frame clears it.
 */
export function updateRepairControl(
  control: RepairControl,
  held: boolean,
  timeMs: number,
  blocked = false,
): boolean {
  if ((control.autoRepair || held) && !blocked) {
    if (
      !control.autoRepair &&
      !control.repairWasHeld &&
      timeMs - control.lastRepairTime < 1200
    )
      control.autoRepair = true;
    control.lastRepairTime = timeMs;
    control.repairWasHeld = true;
    return true;
  }
  control.repairWasHeld = false;
  return false;
}

export interface TemporaryMotionFactors {
  engineFactor?: number;
  tyreGripFactor?: number;
}
export interface SuspensionPowerupValues {
  /** Source AdjustSuspension param2/param3: front/rear give scales. */
  frontGiveMultiplier: number;
  rearGiveMultiplier: number;
  dampingMultiplier: number;
  frontExtraLength: number;
  rearExtraLength: number;
}
/** Installed action20 SetSuspension 0x4dcc90 forwards five parameters to
 * AdjustSuspension 0x41fc80: front/rear give, front/rear extra length, damping.
 */
export function setSuspensionPowerup(
  parameters: readonly number[],
): SuspensionPowerupValues {
  if (
    parameters.length !== 5 ||
    parameters.some((value) => !Number.isFinite(value))
  )
    throw new Error("Missing source suspension powerup parameters");
  return {
    frontGiveMultiplier: parameters[0],
    rearGiveMultiplier: parameters[1],
    frontExtraLength: parameters[2],
    rearExtraLength: parameters[3],
    dampingMultiplier: parameters[4],
  };
}

/** Installed ResetSuspension 0x4de560 calls AdjustSuspension with defaults. */
export function resetSuspensionPowerup(): SuspensionPowerupValues {
  return {
    frontGiveMultiplier: 1,
    rearGiveMultiplier: 1,
    frontExtraLength: 0,
    rearExtraLength: 0,
    dampingMultiplier: 1,
  };
}

/** Local SetEngineFactor 0x4dc840 and SetTyreGrip 0x4dcce0 assign, rather
 * than multiply, temporary values. SetEngineFactor also adjusts suspension.
 */
export function setTemporaryMotionPowerup(
  target: TemporaryMotionFactors,
  action: 9 | 21,
  parameters: readonly number[],
): SuspensionPowerupValues | undefined {
  const count = action === 9 ? 7 : 1;
  if (
    parameters.length < count ||
    parameters.slice(0, count).some((v) => !Number.isFinite(v))
  )
    throw new Error("Missing source motion powerup parameters");
  if (action === 21) {
    target.tyreGripFactor = parameters[0];
    return;
  }
  target.engineFactor = parameters[0];
  target.tyreGripFactor = parameters[1];
  return setSuspensionPowerup([
    parameters[2],
    parameters[3],
    parameters[4],
    parameters[5],
    parameters[6],
  ]);
}
/** Local engine removal 0x4de3d0 resets both factors and suspension defaults;
 * tyre-only removal resets grip only. No older active effect is reinstated.
 */
export function resetTemporaryMotionPowerup(
  target: TemporaryMotionFactors,
  action: 9 | 21,
): SuspensionPowerupValues | undefined {
  target.tyreGripFactor = 1;
  if (action === 21) return;
  target.engineFactor = 1;
  return resetSuspensionPowerup();
}
