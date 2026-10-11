/** Installed DamagePost440120. These are executable byte-table divisors,
 * not thresholds inferred from the browser armour bar. */
export const NATIVE_DAMAGE_SMOKE_DIVISORS = [
  20, 20, 0, 10, 10, 10, 10, 10, 10, 10, 10, 10,
] as const;

function levels(values: Uint8Array) {
  if (
    !(values instanceof Uint8Array) ||
    values.length !== 12 ||
    values.some((value) => value > 99)
  )
    throw new Error("Component smoke requires twelve damage levels in 0..99");
}

/** smokeLast is source +4e8, distinct from +4e4 crash-earnings baseline. */
export function dispatchNativeDamageSmoke(input: {
  driver: number;
  current: Uint8Array;
  smokeLast: Uint8Array;
  setSmoke: (component: number, colour: number) => void;
  shortenExisting: () => void;
}) {
  if (!Number.isInteger(input.driver))
    throw new Error("Invalid component smoke driver");
  levels(input.current);
  levels(input.smokeLast);
  if (input.driver <= 5) return;
  let keepSmoke = false;
  for (let component = 0; component < 12; component++) {
    const divisor = NATIVE_DAMAGE_SMOKE_DIVISORS[component];
    if (divisor === 0) continue;
    const current = input.current[component],
      previous = input.smokeLast[component];
    const colour = Math.trunc((99 - current) / divisor);
    if (colour <= 2) keepSmoke = true;
    if (
      current > previous &&
      colour <= 2 &&
      colour !== Math.trunc((99 - previous) / divisor)
    )
      input.setSmoke(component, colour);
  }
  if (!keepSmoke) input.shortenExisting();
  input.smokeLast.set(input.current);
}

export interface ComponentSmokeColumn {
  active: boolean;
  matchingCar: boolean;
  colour: number;
  remaining: number;
}

/** Installed SetCarSmoke4fc840 lifetime/quality control. The caller snapshots
 * ring slots in native index order; writing lifetimes can occur before an
 * early return, so a global minimum/replacement test would change behavior. */
export function prepareNativeComponentColumn(input: {
  driver: number;
  colour: number;
  columns: readonly ComponentSmokeColumn[];
  writeRemaining: (slot: number, lifetimeMs: number) => void;
}): number | undefined {
  if (
    !Number.isInteger(input.driver) ||
    !Number.isInteger(input.colour) ||
    input.colour < 0 ||
    input.colour > 2 ||
    input.columns.length !== 10
  )
    throw new Error("Invalid component smoke column request");
  const colour = input.colour === 0 && input.driver < 7 ? 1 : input.colour;
  if (input.columns.some((column) => column.active && column.matchingCar))
    for (const [slot, column] of input.columns.entries()) {
      if (!column.matchingCar) continue;
      if (column.active && column.colour <= colour && column.remaining !== 0)
        return undefined;
      input.writeRemaining(slot, 2000);
    }
  return colour;
}
