import type { RigidBody } from "./contact";
import type { PedContactOther } from "./ped-contact";
import type { DetachedBody } from "./simulation";
import type { NativePedAttributionOther } from "../ped-contact-attribution";

type OwnedBody = RigidBody & { owner?: object | null };
type NativeOtherClass = {
  type: number;
  owner: object | null;
  knownWrapper: boolean;
};

function pointer(value: unknown, name: string): object | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object")
    throw new RangeError(`Invalid native pedestrian other ${name}`);
  return value;
}
function sourceType(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 255)
    throw new RangeError("Invalid native pedestrian other type BYTE");
  return Number(value);
}
function detached(body: RigidBody): body is DetachedBody {
  return "part" in body && "owner" in body;
}
function classify(body: RigidBody): NativeOtherClass {
  if ("kind" in body) {
    if (body.kind === "pedestrian" || body.kind === "pedestrian-bone") {
      const expected = body.kind === "pedestrian" ? 2 : 5;
      if (!("rigidType" in body) || sourceType(body.rigidType) !== expected)
        throw new RangeError(
          "Unprepared or invalid native pedestrian other body",
        );
      return {
        type: expected,
        owner: pointer((body as OwnedBody).owner, "character owner"),
        knownWrapper: false,
      };
    }
    if (body.kind === "noncar")
      return { type: 1, owner: body, knownWrapper: true };
    if (body.kind === "mine") {
      if (!("mine" in body) || !body.mine || typeof body.mine !== "object")
        throw new RangeError("Invalid native pedestrian other mine owner");
      return { type: 0x40, owner: body.mine, knownWrapper: false };
    }
    // Moving-world is an engine kinematic partner, not an installed PHIL
    // tagged body. Preserve the existing adapter type0/ownerfalse explicitly.
    if (body.kind === "moving-world")
      return { type: 0, owner: null, knownWrapper: false };
  }
  if ("damage" in body || detached(body))
    return { type: 1, owner: body, knownWrapper: true };
  if ("rigidType" in body)
    return {
      type: sourceType(body.rigidType),
      owner: pointer((body as OwnedBody).owner, "tagged owner"),
      knownWrapper: false,
    };
  // Controlled RigidBody fixtures have no source tag. This compatibility
  // fallback does not certify native type0 and cannot attribute a killer.
  return { type: 0, owner: null, knownWrapper: false };
}
function scalar(value: number, name: string): number {
  const result = Math.fround(value);
  if (!Number.isFinite(value) || !Number.isFinite(result))
    throw new RangeError(`Invalid native pedestrian other ${name}`);
  return result;
}

/** Current raw Object+4/+68 packet for the installed contact kernels. NULL
 * world remains NULL; known cars, parts and noncars all use source type1. */
export function classifyNativePedOther(
  body: RigidBody | undefined,
): PedContactOther | null {
  if (!body) return null;
  const descriptor = classify(body),
    mass = scalar(body.properties.mass, "mass"),
    velocity = body.state.velocity;
  if (mass < 0) throw new RangeError("Invalid native pedestrian other mass");
  return {
    type: descriptor.type,
    ownerPresent: descriptor.owner !== null,
    mass,
    velocity: {
      x: scalar(velocity.x, "velocity X"),
      y: scalar(velocity.y, "velocity Y"),
      z: scalar(velocity.z, "velocity Z"),
    },
  };
}

export interface NativePedOtherAttributionProviders {
  /** Type2..4 owner+e4 -> ped+0c. Null is a real missing link; undefined is
   * an unavailable provider. Do not infer its killer from contact history. */
  readCharacterCache?: (
    owner: object,
    body: RigidBody,
  ) => { killer: object | null } | null | undefined;
}

/** Installed4cdc60 pointer packet. Wrapper identity is independent of repair
 * owner and culprit; source driver/c8 lookup belongs to simulation's provider.
 * Undefined means world or an unsupported source descriptor. */
export function describeNativePedAttributionOther(
  body: RigidBody | undefined,
  providers: NativePedOtherAttributionProviders,
): NativePedAttributionOther | undefined {
  if (!body) return undefined;
  const descriptor = classify(body);
  if (descriptor.knownWrapper) {
    let parentPresent = false;
    if (detached(body) && body.joint) {
      // Semi setup43705a links the actual child to its physics parent. The
      // prop's infinite-world joint and repair .owner are not Object+228.
      parentPresent = body.joint.child === body && body.joint.parent !== body;
    }
    return { typeByte: 1, owner: body, parentPresent };
  }
  if (descriptor.type >= 2 && descriptor.type <= 4)
    return {
      typeByte: descriptor.type,
      owner: descriptor.owner,
      parentPresent: false, // Type2..4 rejects before direct-parent selection.
      characterCache: descriptor.owner
        ? providers.readCharacterCache?.(descriptor.owner, body)
        : null,
    };
  if (descriptor.type === 5)
    return { typeByte: 5, owner: descriptor.owner, parentPresent: false };
  if ("kind" in body && body.kind === "mine") {
    const mine = descriptor.owner as {
      owner?: { victim?: unknown } | null;
    };
    const candidate = mine.owner?.victim;
    // The source mine owner+30 pointer exists separately from its cached driver.
    // Missing victim is unknown, not a NULL firing car or latest attacker.
    return {
      typeByte: 0x40,
      owner: descriptor.owner,
      parentPresent: false,
      mineCar:
        candidate === undefined
          ? undefined
          : pointer(candidate, "mine firing car"),
    };
  }
  // No tail/drone runtime owner chains are currently represented. Preserve
  // their explicit tagged contact type above, but do not guess attribution.
  return undefined;
}
