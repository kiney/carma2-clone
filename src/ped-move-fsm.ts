/** Original SetPedMove table access and bounded substitution/fallback policy.
 * The table is read from a local original executable; no executable is run and
 * no original table payload is embedded in the source or production bundle.
 * Evidence: docs/c2-ped-move-fsm-re.md. */
const f = Math.fround;
import type { NativePedGameplayOptions } from "./ped-native-gameplay";
import type { NativePedRuntimeCallback } from "./ped-native-runtime";
const ROWS = 118,
  COLUMNS = 7;
const signature = [0, -2, 5, 6, 111, 31, 112, 0, 0, 5, 6, 111, 31, 112];
export interface NativePedMoveFSM {
  readonly rows: readonly (readonly number[])[];
  readonly sourceAddress: number;
  readonly sourceOffset: number;
  /** Installed SetPedMove reads these preceding-data cells for row−1's
   * missing-leg columns2/3. They are not a fabricated logical FSM row. */
  readonly negativeLegSubstitutions?: {
    readonly values: readonly [number, number];
    /** Provenance of column2; column3 immediately follows it. */
    readonly sourceAddress: number;
    readonly sourceOffset: number;
  };
}

/** Locate the shared HW/SW initialized-data table without assuming equal RVAs.
 * Accept only a unique complete validated table in a bounded x86 PE32 image. */
export function readNativePedMoveFSM(bytes: Uint8Array): NativePedMoveFSM {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  function span(offset: number, length: number): void {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      length < 0 ||
      offset > bytes.length - length
    )
      throw new Error("C2 pedestrian FSM: PE span exceeds file bounds");
  }
  span(0, 64);
  if (bytes.length > 32 * 1024 * 1024 || view.getUint16(0, true) !== 0x5a4d)
    throw new Error("C2 pedestrian FSM: bounded DOS/PE image required");
  const pe = view.getUint32(0x3c, true);
  span(pe, 24);
  const sectionCount = view.getUint16(pe + 6, true),
    optionalSize = view.getUint16(pe + 20, true);
  if (
    view.getUint32(pe, true) !== 0x4550 ||
    view.getUint16(pe + 4, true) !== 0x14c ||
    sectionCount < 1 ||
    sectionCount > 96 ||
    optionalSize < 96
  )
    throw new Error("C2 pedestrian FSM: x86 PE32 headers required");
  span(pe + 24, optionalSize + sectionCount * 40);
  if (view.getUint16(pe + 24, true) !== 0x10b)
    throw new Error("C2 pedestrian FSM: PE32 optional header required");
  const imageBase = view.getUint32(pe + 24 + 28, true),
    matches: NativePedMoveFSM[] = [];
  for (let section = 0; section < sectionCount; section++) {
    const entry = pe + 24 + optionalSize + section * 40;
    const rva = view.getUint32(entry + 12, true),
      size = view.getUint32(entry + 16, true),
      offset = view.getUint32(entry + 20, true),
      flags = view.getUint32(entry + 36, true);
    span(offset, size);
    if (!(flags & 0x40) || flags & 0x20000000) continue;
    for (let at = offset; at <= offset + size - ROWS * COLUMNS * 4; at += 4) {
      if (
        !signature.every(
          (value, i) => view.getInt32(at + i * 4, true) === value,
        )
      )
        continue;
      const rows: (readonly number[])[] = [];
      let valid = true;
      for (let row = 0; row < ROWS; row++) {
        const values = Array.from({ length: COLUMNS }, (_, column) =>
          view.getInt32(at + (row * COLUMNS + column) * 4, true),
        );
        if (
          !Number.isInteger(values[0]) ||
          values[0] < -117 ||
          values[0] > 7 ||
          values.slice(1).some((value) => value < -117 || value >= ROWS)
        )
          valid = false;
        rows.push(Object.freeze(values));
      }
      if (valid) {
        // Require the complete preceding row to belong to this same bounded
        // initialized, non-executable section. Read only the two audited cells;
        // other columns alias unrelated globals and remain unsupported.
        const prefixOffset = at - COLUMNS * 4;
        let negativeLegSubstitutions:
          | NativePedMoveFSM["negativeLegSubstitutions"]
          | undefined;
        if (prefixOffset >= offset) {
          const cellOffset = prefixOffset + 2 * 4;
          const values = [
            view.getInt32(cellOffset, true),
            view.getInt32(cellOffset + 4, true),
          ] as const;
          if (values.every((value) => value >= -1 && value < ROWS))
            negativeLegSubstitutions = Object.freeze({
              values: Object.freeze(values),
              sourceAddress: imageBase + rva + cellOffset - offset,
              sourceOffset: cellOffset,
            });
        }
        matches.push(
          Object.freeze({
            rows: Object.freeze(rows),
            sourceAddress: imageBase + rva + at - offset,
            sourceOffset: at,
            ...(negativeLegSubstitutions ? { negativeLegSubstitutions } : {}),
          }),
        );
      }
    }
  }
  if (matches.length !== 1)
    throw new Error(
      `C2 pedestrian FSM: expected one original table, found ${matches.length}`,
    );
  return matches[0];
}

export interface NativePedMoveRequest {
  requestedId: number;
  previousAction: number;
  requestedAction: number;
  walkSpeed: number;
  pedestrianSpeedFactor: number;
  removedBoneMask: number;
  drunk: boolean;
  dancing: boolean;
  panicking: boolean;
  /** Actual loaded FORM/personality moves; absence is SetCharacterMove return2. */
  availableMoves: ReadonlySet<number>;
}
export type NativePedMovePlan =
  | {
      status: "complete";
      moveId: number;
      action: number;
      speed: number;
      clearCachedRunSpeed: boolean;
      substitutionColumn: number;
      attempts: readonly number[];
    }
  | { status: "provider-required"; requiredProviders: readonly string[] };

export function planNativePedMove(
  table: NativePedMoveFSM,
  input: NativePedMoveRequest,
): NativePedMovePlan {
  if (
    !Number.isInteger(input.requestedId) ||
    input.requestedId < -1 ||
    input.requestedId >= ROWS ||
    !Number.isInteger(input.previousAction) ||
    input.previousAction < 0 ||
    input.previousAction > 6 ||
    !Number.isInteger(input.requestedAction) ||
    input.requestedAction < -1 ||
    input.requestedAction > 6 ||
    !Number.isInteger(input.walkSpeed) ||
    input.walkSpeed < -2147483648 ||
    input.walkSpeed > 2147483647 ||
    !Number.isFinite(f(input.pedestrianSpeedFactor)) ||
    !Number.isInteger(input.removedBoneMask) ||
    input.removedBoneMask < 0 ||
    input.removedBoneMask > 0xffffffff ||
    table.rows.length !== ROWS
  )
    throw new Error("Invalid native pedestrian move request/table");
  const column = input.drunk
    ? 5
    : input.dancing
      ? 4
      : input.panicking
        ? 6
        : input.removedBoneMask & 8
          ? 2
          : input.removedBoneMask & 32
            ? 3
            : 0;
  let moveId: number;
  if (column && input.requestedId === -1) {
    const prefix = table.negativeLegSubstitutions;
    if (
      (column !== 2 && column !== 3) ||
      !prefix ||
      prefix.sourceOffset !== table.sourceOffset - 20 ||
      prefix.sourceAddress !== table.sourceAddress - 20 ||
      prefix.values.length !== 2 ||
      !prefix.values.every(
        (value) => Number.isInteger(value) && value >= -1 && value < ROWS,
      )
    )
      return {
        status: "provider-required",
        requiredProviders: ["native-negative-FSM-row-under-substitution"],
      };
    moveId = prefix.values[column - 2];
  } else
    moveId = column ? table.rows[input.requestedId][column] : input.requestedId;
  let action =
    input.requestedAction >= 0 &&
    input.requestedId >= 0 &&
    input.previousAction !== 6
      ? input.requestedAction
      : input.previousAction;
  if ([112, 31, 111].includes(moveId)) action = 1;
  const clearCachedRunSpeed = ![112, 31, 40, 41, 42].includes(moveId),
    speedFactor = f(input.pedestrianSpeedFactor),
    speed = f(
      speedFactor === 0 ? input.walkSpeed : input.walkSpeed / speedFactor,
    );
  const attempts: number[] = [];
  for (let attempt = 0; attempt < 10; attempt++) {
    if (moveId < -1)
      throw new Error(
        moveId === -2
          ? "Native core pedestrian move is missing"
          : "Native bad pedestrian move requested",
      );
    attempts.push(moveId);
    if (moveId === -1 || input.availableMoves.has(moveId))
      return {
        status: "complete",
        moveId,
        action,
        speed,
        clearCachedRunSpeed,
        substitutionColumn: column,
        attempts: Object.freeze(attempts),
      };
    moveId = table.rows[moveId][1];
  }
  throw new Error("Native cyclic pedestrian move definition (10 attempts)");
}

export interface NativePedMoveGlobals {
  drunk: boolean;
  dancing: boolean;
  panicking: boolean;
  pedestrianSpeedFactor: number;
}

/** Concrete gameplay outlet: read current globals for every transition and
 * use this personality's actual loaded move set, not its FORM declaration. */
export function createNativePedMovePlanner<Owner extends object>(
  table: NativePedMoveFSM,
  readGlobals: (
    context: NativePedRuntimeCallback<Owner>,
  ) => NativePedMoveGlobals,
): NonNullable<NativePedGameplayOptions<Owner>["planMove"]> {
  return (context, request, state) => {
    const globals = readGlobals(context);
    return planNativePedMove(table, {
      ...globals,
      requestedId: request.id,
      previousAction: state.action,
      requestedAction: request.action,
      walkSpeed: request.speed,
      removedBoneMask: context.character.removedBoneMask,
      availableMoves: new Set(context.instance.template.moves.keys()),
    });
  };
}
