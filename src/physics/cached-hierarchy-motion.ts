import type { RigidBody } from "./contact";
import type { RigidJoint } from "./joint";
import {
  createHierarchyMotionPhase,
  type HierarchyMotionPhase,
} from "./hierarchy-motion";

/** One local-response tick only. Input certificates come from the existing
 * mutation barrier, not from candidate output or a guessed velocity tolerance.
 * An unchanged physical tree keeps its captured OLD trajectory and pose cache;
 * a changed tree is recaptured with all its current ancestors and descendants.
 * Final world/pair-capped commitment uses a separately captured fresh phase. */
export class HierarchyPredictionCache {
  private owners = new Map<RigidBody, HierarchyMotionPhase>();
  private inputs: ReadonlyMap<RigidBody, object> = new Map();
  private step?: number;

  update(
    bodies: readonly RigidBody[],
    joints: readonly RigidJoint[],
    step: number,
    inputs: ReadonlyMap<RigidBody, object>,
  ): Omit<HierarchyMotionPhase, "commit"> {
    const parents = new Map<RigidBody, RigidBody>();
    const find = (body: RigidBody): RigidBody => {
      const parent = parents.get(body);
      if (!parent) {
        parents.set(body, body);
        return body;
      }
      if (parent === body) return body;
      const root = find(parent);
      parents.set(body, root);
      return root;
    };
    const join = (a: RigidBody, b: RigidBody) => {
      const aa = find(a),
        bb = find(b);
      if (aa !== bb) parents.set(bb, aa);
    };
    // Shared external anchors and aliased body states are physical dependencies.
    const states = new Map<RigidBody["state"], RigidBody>();
    for (const body of bodies) {
      find(body);
      const other = states.get(body.state);
      if (other) join(body, other);
      else states.set(body.state, body);
    }
    for (const joint of joints) join(joint.child, joint.parent);
    const invalid = new Set<RigidBody>();
    for (const body of bodies) {
      if (!inputs.has(body))
        throw new Error("Missing hierarchy input certificate");
      if (
        this.step !== step ||
        !this.owners.has(body) ||
        this.inputs.get(body) !== inputs.get(body)
      )
        invalid.add(find(body));
    }
    const changed = bodies.filter((body) => invalid.has(find(body)));
    const changedSet = new Set(changed);
    let fresh: HierarchyMotionPhase | undefined;
    if (changed.length)
      fresh = createHierarchyMotionPhase(
        changed,
        joints.filter((joint) => changedSet.has(joint.child)),
        step,
      );
    const owners = new Map<RigidBody, HierarchyMotionPhase>();
    for (const body of bodies) {
      const owner = changedSet.has(body) ? fresh! : this.owners.get(body)!;
      owners.set(body, owner);
    }
    for (const joint of joints)
      if (!owners.has(joint.parent))
        owners.set(joint.parent, owners.get(joint.child)!);
    this.owners = owners;
    this.inputs = inputs;
    this.step = step;
    const paths: HierarchyMotionPhase["paths"] = new Map();
    const worldFractions = new Map<RigidBody, number>();
    for (const [body, owner] of owners) {
      paths.set(body, owner.paths.get(body)!);
      worldFractions.set(body, owner.worldFractions.get(body) ?? 1);
    }
    const ownerOf = (body: RigidBody) => {
      const owner = owners.get(body);
      if (!owner)
        throw new Error("Target is outside cached hierarchy prediction");
      return owner;
    };
    const batches = (targets: readonly RigidBody[]) => {
      const result = new Map<HierarchyMotionPhase, RigidBody[]>();
      for (const body of targets) {
        const owner = ownerOf(body);
        const batch = result.get(owner);
        if (batch) batch.push(body);
        else result.set(owner, [body]);
      }
      return result;
    };
    return {
      paths,
      worldFractions,
      pose: (body, fraction) => ownerOf(body).pose(body, fraction),
      writeCandidates: (targets, fraction) => {
        for (const [phase, batch] of batches(targets))
          phase.writeCandidates(batch, fraction);
      },
    };
  }
}
