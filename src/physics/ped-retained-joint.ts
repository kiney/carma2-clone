import type { PedVector } from "../ped-form";

const f = Math.fround;

/** Actual tPhysics_joint+4, preserved by sever through Object+18c. Quiet's
 * orientation gate reads Object+9c instead; it is not a field of this joint. */
export interface NativePedRetainedJoint {
  friction: number;
}

/** Friction alone does not prove that source world-anchor/limit rows are absent.
 * NONE0/count0 is the verified free-movement, no-geometric-row branch. */
export function nativePedFrictionOnlyJoint(joint: {
  friction?: number;
  type?: number;
  limitCount?: number;
}): boolean {
  return (
    joint.type === 0 &&
    joint.limitCount === 0 &&
    joint.friction !== undefined &&
    Number.isFinite(f(joint.friction))
  );
}

export interface NativePedRetainedJointResult {
  status: "complete" | "provider-required";
  requiredProviders: string[];
  /** BODY coordinates, matching Object+74/78/7c. The owner rotates to world. */
  localOmega: PedVector;
  applied: boolean;
  clamped: boolean;
}

/** Installed HW4c18a1–4c195c / SW4bd7f1–4bd8ac retained joint2 angular
 * friction. The CRT selects nearest-rounded53-bit x87 arithmetic (CW027f).
 * Preserve live products for the norm, the separate Float32 momentum spills,
 * and the final Float32 angular stores. No timestep or RNG is consumed here. */
export function evaluateNativePedRetainedJoint(input: {
  joint: NativePedRetainedJoint | null;
  inertia: PedVector;
  localOmega: PedVector;
}): NativePedRetainedJointResult {
  if (input.inertia.length !== 3 || input.localOmega.length !== 3)
    throw new RangeError("Invalid retained joint2 vector width");
  const omega = input.localOmega.map(f) as unknown as PedVector;
  const result = (
    requiredProviders: string[] = [],
    localOmega: PedVector = omega,
    applied = false,
    clamped = false,
  ): NativePedRetainedJointResult => ({
    status: requiredProviders.length ? "provider-required" : "complete",
    requiredProviders,
    localOmega,
    applied,
    clamped,
  });
  if (input.joint === null) return result();
  const friction = f(input.joint.friction);
  // The native early exit tests equality with0, including negative zero.
  if (friction === 0) return result();
  const inertia = input.inertia.map(f);
  if (![friction, ...inertia, ...omega].every(Number.isFinite))
    return result(["native-retained-joint2-finite-input-provider"]);
  // Native has no zero or negative guard. Signed nonzero inertia follows its
  // arithmetic; zero divides stored momentum by0 and produces nonfinite state.
  if (inertia.some((value) => value === 0))
    return result(["native-retained-joint2-zero-inertia-numerics-provider"]);
  const limit = friction * f(0.04);
  const limitSquared = limit * limit;
  const momentum: number[] = [];
  let normSquared = 0;
  for (let i = 0; i < 3; i++) {
    const live = omega[i] * inertia[i];
    normSquared += live * live;
    momentum.push(f(live));
  }
  if (!momentum.every(Number.isFinite))
    return result(["native-retained-joint2-momentum-overflow-provider"]);
  const clamped = normSquared > limitSquared;
  if (clamped) {
    const scale = Math.sqrt(limitSquared / normSquared);
    for (let i = 0; i < 3; i++) momentum[i] = f(momentum[i] * scale);
  }
  const localOmega = omega.map((value, i) =>
    f(value - momentum[i] / inertia[i]),
  ) as unknown as PedVector;
  if (!localOmega.every(Number.isFinite))
    return result(["native-retained-joint2-angular-overflow-provider"]);
  return result([], localOmega, true, clamped);
}
