/** Independent normal-constraint solve informed by C2 HW 0x4c3900.
 * The native RQ dependence test removes rows rather than adding compliance.
 * Arithmetic remains double precision; the active-set path is bounded here
 * rather than reproducing the native cached joint blocks or x87 rounding. */
export interface NormalConstraintSolution {
  impulses: number[];
  status: "solved" | "numerical-failure";
  reason?:
    | "invalid-input"
    | "dependent-prefix"
    | "unresponsive-row"
    | "nonfinite"
    | "physical-residual"
    | "iteration-overflow";
  iterations: number;
  dependenceRemovals: number;
  activeRows: number[];
  residuals: number[];
}

const DEPENDENCE_RATIO = 100000;
const NEGATIVE_IMPULSE_TOLERANCE = 0.0001;
const INACTIVE_RESIDUAL_TOLERANCE = 0.001;
const ACTIVE_RESIDUAL_TOLERANCE = 0.01;
const MAX_TRANSITIONS = 50;

interface RQFactors {
  lower: number[][];
  orthogonal: number[][];
}

/** Right rotations maintain A = lower * orthogonal. Unlike row Gram-Schmidt,
 * scaled orthogonal rotations also handle nearly dependent input rows. */
function factorRQ(matrix: number[][]): RQFactors | undefined {
  const count = matrix.length;
  const lower = matrix.map((row) => row.slice());
  const orthogonal = Array.from({ length: count }, (_, i) =>
    Array.from({ length: count }, (_, j) => Number(i === j)),
  );
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const a = lower[i][i];
      const b = lower[i][j];
      if (b === 0) continue;
      const magnitude = Math.hypot(a, b);
      if (!(magnitude > 0) || !Number.isFinite(magnitude)) return;
      const cosine = a / magnitude;
      const sine = b / magnitude;
      for (let k = i; k < count; k++) {
        const x = lower[k][i];
        const y = lower[k][j];
        lower[k][i] = cosine * x + sine * y;
        lower[k][j] = -sine * x + cosine * y;
      }
      lower[i][j] = 0;
      for (let k = 0; k < count; k++) {
        const x = orthogonal[i][k];
        const y = orthogonal[j][k];
        orthogonal[i][k] = cosine * x + sine * y;
        orthogonal[j][k] = -sine * x + cosine * y;
      }
    }
  }
  if (
    lower.some((row) => row.some((value) => !Number.isFinite(value))) ||
    orthogonal.some((row) => row.some((value) => !Number.isFinite(value)))
  )
    return;
  return { lower, orthogonal };
}

function dependentRow(lower: number[][], row: number): boolean {
  const threshold = Math.abs(lower[row][row] * DEPENDENCE_RATIO);
  for (let column = 0; column < row; column++)
    if (Math.abs(lower[row][column]) > threshold) return true;
  return lower[row][row] === 0;
}

function activeKey(active: number[]): string {
  return active
    .slice()
    .sort((a, b) => a - b)
    .join(",");
}

/** Solve K lambda - b >= 0 with nonnegative unilateral multipliers. Bilateral
 * rows remain equalities with signed multipliers. Returned failures contain
 * only the last finite, physically checked active solution, never an unchecked
 * singular solve. Its inactive constraints may remain unsatisfied, as in C2's
 * finite partial output on matrix-solve failure. */
function solveDistinctNormalConstraints(
  matrix: ReadonlyArray<ReadonlyArray<number>>,
  rhs: ReadonlyArray<number>,
  unilateral: ReadonlyArray<boolean> = rhs.map(() => true),
): NormalConstraintSolution {
  const count = rhs.length;
  const empty = new Array<number>(count).fill(0);
  if (
    matrix.length !== count ||
    unilateral.length !== count ||
    rhs.some((value) => !Number.isFinite(value)) ||
    matrix.some(
      (row) =>
        row.length !== count || row.some((value) => !Number.isFinite(value)),
    )
  )
    return {
      impulses: empty,
      status: "numerical-failure",
      reason: "invalid-input",
      iterations: 0,
      dependenceRemovals: 0,
      activeRows: [],
      residuals: empty.slice(),
    };

  // Symmetric permutation puts every protected equality before contact rows.
  // Callers retain their contact/joint indexes and impulse application order.
  const permutation = Array.from({ length: count }, (_, i) => i).sort(
    (a, b) => Number(unilateral[a]) - Number(unilateral[b]) || a - b,
  );
  const protectedCount = permutation.filter((i) => !unilateral[i]).length;
  const coefficients = permutation.map((i) =>
    permutation.map((j) => matrix[i][j]),
  );
  const demands = permutation.map((i) => rhs[i]);
  let impulses = empty.slice();
  let acceptedActive: number[] = [];
  let iterations = 0;
  let dependenceRemovals = 0;

  const residualsFor = (values: number[]): number[] =>
    coefficients.map((row, i) => {
      let residual = -demands[i];
      for (let j = 0; j < count; j++) residual += row[j] * values[j];
      return residual;
    });
  const result = (
    reason?: NormalConstraintSolution["reason"],
  ): NormalConstraintSolution => {
    const output = empty.slice();
    const residuals = empty.slice();
    const physicalResiduals = residualsFor(impulses);
    for (let i = 0; i < count; i++) {
      output[permutation[i]] = impulses[i];
      residuals[permutation[i]] = physicalResiduals[i];
    }
    return {
      impulses: output,
      status: reason ? "numerical-failure" : "solved",
      reason,
      iterations,
      dependenceRemovals,
      activeRows: acceptedActive.map((i) => permutation[i]),
      residuals,
    };
  };
  if (count === 0) return result();

  // Native single-normal fast path (0x4c3937). Signed equality rows still need
  // their exact reaction even when their effective inverse mass is small.
  if (count === 1 && protectedCount === 0 && coefficients[0][0] <= 0.0001)
    return result();

  const initialCount = Math.min(count, protectedCount + 1);
  const active = Array.from({ length: initialCount }, (_, i) => i);
  const inactive = Array.from(
    { length: count - initialCount },
    (_, i) => i + initialCount,
  );
  const visited = new Set<string>();
  const remove = (position: number): void => {
    inactive.push(active[position]);
    active.splice(position, 1);
  };

  for (let transition = 0; transition <= MAX_TRANSITIONS; transition++) {
    iterations++;
    if (transition === MAX_TRANSITIONS) return result("iteration-overflow");
    visited.add(activeKey(active));
    const factors = factorRQ(
      active.map((i) => active.map((j) => coefficients[i][j])),
    );
    if (!factors) return result("nonfinite");
    const { lower, orthogonal } = factors;

    // A protected block cannot be made invertible by dropping a signed row.
    // Check its rank before considering removal of the appended normal row.
    for (let i = 0; i < protectedCount; i++)
      if (dependentRow(lower, i)) return result("dependent-prefix");

    const last = active.length - 1;
    if (last >= protectedCount && dependentRow(lower, last)) {
      const candidates = Array.from(
        { length: last - protectedCount },
        (_, i) => i + protectedCount,
      )
        .filter((i) => Math.abs(orthogonal[last][i]) > 0)
        .sort(
          (a, b) =>
            Math.abs(orthogonal[last][b]) - Math.abs(orthogonal[last][a]) ||
            a - b,
        );
      // Native dependence removal uses the last Q row, not a diagonal pivot.
      // With only protected prior rows, remove the appended unilateral row.
      const unseen = candidates.find(
        (position) =>
          !visited.has(activeKey(active.filter((_, i) => i !== position))),
      );
      remove(unseen ?? candidates[0] ?? protectedCount);
      dependenceRemovals++;
      continue;
    }

    const forward: number[] = [];
    for (let i = 0; i < active.length; i++) {
      let value = demands[active[i]];
      for (let j = 0; j < i; j++) value -= lower[i][j] * forward[j];
      forward.push(value / lower[i][i]);
    }
    const solution = active.map((_, i) => {
      let value = 0;
      for (let j = 0; j < active.length; j++)
        value += orthogonal[j][i] * forward[j];
      return value;
    });
    if (solution.some((value) => !Number.isFinite(value)))
      return result("nonfinite");

    const negatives = active
      .map((_, i) => i)
      .filter(
        (i) => i >= protectedCount && solution[i] < -NEGATIVE_IMPULSE_TOLERANCE,
      )
      .sort((a, b) => solution[a] - solution[b] || a - b);
    if (negatives.length) {
      const unseen = negatives.find(
        (position) =>
          !visited.has(activeKey(active.filter((_, i) => i !== position))),
      );
      remove(unseen ?? negatives[0]);
      continue;
    }

    const candidate = empty.slice();
    for (let i = 0; i < active.length; i++)
      candidate[active[i]] =
        i < protectedCount ? solution[i] : Math.max(0, solution[i]);
    const residuals = residualsFor(candidate);
    if (residuals.some((value) => !Number.isFinite(value)))
      return result("nonfinite");
    if (active.some((i) => Math.abs(residuals[i]) > ACTIVE_RESIDUAL_TOLERANCE))
      return result("physical-residual");
    // Store only a finite candidate whose active physical equations hold.
    // Inactive residuals determine further activation, never regularization.
    impulses = candidate;
    acceptedActive = active.slice();

    const violations = inactive
      .filter((i) => residuals[i] < -INACTIVE_RESIDUAL_TOLERANCE)
      .sort(
        (a, b) =>
          residuals[a] / coefficients[a][a] -
            residuals[b] / coefficients[b][b] || a - b,
      );
    if (!violations.length) return result();
    if (violations.some((i) => !(coefficients[i][i] > 0)))
      return result("unresponsive-row");
    const unseen = violations.find(
      (i) => !visited.has(activeKey([...active, i])),
    );
    const next = unseen ?? violations[0];
    active.push(next);
    inactive.splice(inactive.indexOf(next), 1);
  }
  return result("iteration-overflow");
}

/** Preserve equal loading for physically identical browser contact rows.
 * This is a browser compatibility adaptation, not a literal native RQ step:
 * equal matrix rows AND columns with equal demands depend only on the sum of
 * their unilateral multipliers. Solve that aggregate once, then distribute it
 * uniformly, the minimum Euclidean norm distribution of the same response.
 * Protected equalities and unequal demands are never combined. */
export function solveNormalConstraints(
  matrix: ReadonlyArray<ReadonlyArray<number>>,
  rhs: ReadonlyArray<number>,
  unilateral: ReadonlyArray<boolean> = rhs.map(() => true),
): NormalConstraintSolution {
  const count = rhs.length;
  if (
    matrix.length !== count ||
    unilateral.length !== count ||
    rhs.some((value) => !Number.isFinite(value)) ||
    matrix.some(
      (row) =>
        row.length !== count || row.some((value) => !Number.isFinite(value)),
    )
  )
    return solveDistinctNormalConstraints(matrix, rhs, unilateral);

  const groups: number[][] = [];
  for (let i = 0; i < count; i++) {
    const equivalent = unilateral[i]
      ? groups.find((group) => {
          const representative = group[0];
          if (!unilateral[representative] || rhs[i] !== rhs[representative])
            return false;
          for (let j = 0; j < count; j++)
            if (
              matrix[i][j] !== matrix[representative][j] ||
              matrix[j][i] !== matrix[j][representative]
            )
              return false;
          return true;
        })
      : undefined;
    if (equivalent) equivalent.push(i);
    else groups.push([i]);
  }
  if (groups.length === count)
    return solveDistinctNormalConstraints(matrix, rhs, unilateral);

  const solution = solveDistinctNormalConstraints(
    groups.map(([i]) => groups.map(([j]) => matrix[i][j])),
    groups.map(([i]) => rhs[i]),
    groups.map(([i]) => unilateral[i]),
  );
  const impulses = new Array<number>(count).fill(0);
  for (let i = 0; i < groups.length; i++)
    for (const row of groups[i])
      impulses[row] = solution.impulses[i] / groups[i].length;
  const residuals = matrix.map((row, i) => {
    let value = -rhs[i];
    for (let j = 0; j < count; j++) value += row[j] * impulses[j];
    return value;
  });
  const activeRows = solution.activeRows.flatMap((i) => groups[i]);
  // Recheck the original physical equations after floating-point scatter.
  const scatterFailure = residuals.some((value) => !Number.isFinite(value))
    ? "nonfinite"
    : activeRows.some((i) => Math.abs(residuals[i]) > ACTIVE_RESIDUAL_TOLERANCE)
      ? "physical-residual"
      : undefined;
  return {
    ...solution,
    impulses,
    activeRows,
    residuals,
    status: scatterFailure ? "numerical-failure" : solution.status,
    reason: scatterFailure ?? solution.reason,
  };
}
