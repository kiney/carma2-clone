import { createSimulatedCar } from "../../src/physics/simulation.ts";
import { hydrateCapturedBodies } from "./captured-bodies.mjs";

const require = (condition, message) => {
  if (!condition) throw new Error(`Shallow contact fixture: ${message}`);
};
const motion = (body) =>
  Object.fromEntries(
    ["position", "orientation", "velocity", "angularVelocity"].map((key) => [
      key,
      body.state[key].toArray(),
    ]),
  );

/** Test-only reconstruction of the known ten-body Timber pile. The production
 * simulation, world, original actors, mechanics and WAM lifecycle remain active.
 * This imports a post-tick pose, not all historical application state. */
export async function installShallowContactFixture(c, snapshot, options = {}) {
  require(c.paused && c.opponentsReady, "race must be loaded and paused");
  require(snapshot.bodies.length === 10, "expected the recorded ten-body pile");
  require(snapshot.cars.length === 7, "expected seven original cars");
  const sim = c.simulation;
  const hydrated = hydrateCapturedBodies(snapshot);
  const byId = new Map();
  const V = c.player.state.position.constructor;
  const playerRecord = snapshot.cars.find(
    (row) => row.id === snapshot.playerId,
  );
  require(playerRecord?.name.toLowerCase() ===
    "eagle3", "player is not Eagle3");
  sim.repair(c.player);
  for (const car of sim.cars) {
    sim.hierarchyQuiet.remove(car);
    sim.phil.remove(car);
    if (car !== c.player) car.group.removeFromParent();
  }
  sim.cars.length = 0;
  require(sim.debris.length === 0, "fresh race unexpectedly contains debris");
  sim.elapsed = snapshot.elapsed;
  for (const record of snapshot.cars) {
    let car;
    if (record.id === snapshot.playerId) {
      car = c.player;
    } else {
      const config = c.assets.resolve(
        `data/CARS/${record.name}/${record.name}.TXT`,
      );
      require(config, `missing original car ${record.name}`);
      const text = await c.assets.text(config);
      const directory = config.slice(0, config.lastIndexOf("/"));
      const stem = config
        .slice(config.lastIndexOf("/") + 1)
        .replace(/\.[^.]+$/, "");
      const model = await c.assets.scene(directory, stem, {
        shading: 2,
        storage: "opponents",
      });
      const damage = new c.damage.constructor(c.assets, model.group, text);
      damage.structuralSettings = c.damage.structuralSettings;
      await damage.init();
      car = createSimulatedCar(model.group, text, damage, new V(), 0, false, {
        immutableHulls: true,
      });
      c.scene.add(car.group);
    }
    const captured = hydrated.byId.get(record.id);
    Object.assign(car.state, captured.state);
    car.properties = captured.properties;
    car.hulls = captured.hulls;
    // DamageSystem holds these same arrays; mutate them instead of replacing
    // their identities, preserving ordinary later crush and shape publication.
    require(car.shapeVertices.length ===
      car.hulls.length, "shape count mismatch");
    car.shapeVertices.forEach((vertices, index) => {
      require(vertices.length ===
        car.hulls[index].vertices
          .length, `captured shape topology differs for ${record.name}`);
      vertices.forEach((point, vertex) =>
        point.copy(car.hulls[index].vertices[vertex]),
      );
    });
    for (const [key, value] of Object.entries(record.motion)) {
      if (car.motion[key]?.isVector3) car.motion[key].fromArray(value);
      else car.motion[key] = structuredClone(value);
    }
    for (const [key, value] of Object.entries(captured)) {
      if (["state", "properties", "hulls"].includes(key)) continue;
      if (car[key]?.isVector3 && Array.isArray(value))
        car[key].fromArray(value);
      else car[key] = value;
    }
    car.damage.componentLevels.set(record.components);
    car.damage.lastComponentLevels.set(record.components);
    for (const key of [
      "repairRevision",
      "deformationRevision",
      "pendingShapeSwapFlags",
      "structuralRevision",
      "splitRevision",
      "shellModelActive",
    ])
      car.damage[key] = record.damage[key];
    car.damage.currentCenterOfMass.fromArray(record.damage.currentCenterOfMass);
    Object.assign(car.input, record.input);
    sim.add(car);
    sim.setCarPhysicsActive(car, record.physicsActive);
    byId.set(record.id, car);
  }

  for (const row of snapshot.bodies.filter((body) => body.type === "part")) {
    const owner = byId.get(row.owner);
    const part = owner.damage.runtimeParts[row.part];
    require(part, `missing source WAM part ${row.id}`);
    part.state.queuedAt = sim.elapsed * 1000;
    sim.detachParts(owner);
    const body = sim.debris.find(
      (piece) => piece.owner === owner && piece.part === row.part,
    );
    require(body, `native WAM reservation failed for ${row.id}`);
    require(body.actor.name.toLowerCase() ===
      row.name.toLowerCase(), `source actor mismatch for ${row.id}: ${body.actor.name}`);
    const captured = hydrated.byId.get(row.id);
    body.state = captured.state;
    body.properties = captured.properties;
    body.hulls = captured.hulls;
    for (const [key, value] of Object.entries(row.flags)) body[key] = value;
    body.capturedId = row.id;
    // This capture records physical ancestry, but no WAM timer/phase. Keep a
    // known free bumper free and the known door in its ordinary jointed phase.
    part.state.phase = row.joint ? 1 : 2;
    body.joint = undefined;
    byId.set(row.id, body);
    sim.syncActor(body);
  }
  for (const row of snapshot.bodies.filter((body) => body.type === "noncar")) {
    const body = sim.noncars.find(
      (candidate) => candidate.actor.name === row.name,
    );
    require(body, `missing retained original prop ${row.name}`);
    require(sim.admitNonCar(body, {
      wake: true,
      resetVelocity: false,
    }), "prop admission failed");
    const captured = hydrated.byId.get(row.id);
    body.state = captured.state;
    body.properties = captured.properties;
    body.hulls = captured.hulls;
    for (const key of [
      "attached",
      "collisionFlags",
      "overlapRecovery",
      "overlapDetected",
      "worldRecovery",
      "worldOverlapDetected",
    ])
      body[key] = row.flags[key];
    for (const key of [
      "previousVelocity",
      "originalPosition",
      "originalOrientation",
    ])
      body[key].fromArray(row.flags[key]);
    body.capturedId = row.id;
    byId.set(row.id, body);
    sim.syncActor(body);
  }
  for (const row of snapshot.bodies.filter((body) => body.joint)) {
    const captured = hydrated.byId.get(row.id);
    const body = byId.get(row.id);
    body.joint = {
      ...captured.joint,
      child: body,
      parent: byId.get(row.joint.parent) ?? captured.joint.parent,
    };
  }
  if (options.removeBumper) {
    const bumper = byId.get(7);
    sim.phil.remove(bumper);
    sim.debris.splice(sim.debris.indexOf(bumper), 1);
    bumper.actor.removeFromParent();
    // Disable the known part lifecycle only in this explicitly labelled control.
    bumper.owner.damage.runtimeParts[bumper.part].state.phase = 0;
    byId.delete(7);
  }
  c.player.input.throttle = options.throttle ?? 1;
  c.player.input.steer = 0;
  c.player.input.brake = 0;
  c.player.input.handbrake = false;
  const initial = new Map(
    [...byId].map(([id, body]) => [id, body.state.position.clone()]),
  );
  let ticks = 0;
  const steps = [];
  let guardFractions = [];
  const originalGuardRun = sim.bodyTrajectoryGuard.run;
  sim.bodyTrajectoryGuard.run = function (...arguments_) {
    const result = originalGuardRun.apply(this, arguments_);
    guardFractions = [...result].map(([body, fraction]) => ({
      id: body.capturedId ?? null,
      fraction,
    }));
    return result;
  };
  const anchorErrors = () =>
    [...byId].flatMap(([id, body]) => {
      const joint = body.joint;
      if (!joint) return [];
      const anchor = (member, point) =>
        point
          .clone()
          .applyQuaternion(member.state.orientation)
          .add(member.state.position);
      return [
        {
          id,
          parent: joint.parent.capturedId ?? -1,
          type: joint.type,
          error: anchor(body, joint.childAnchor).distanceTo(
            anchor(joint.parent, joint.parentAnchor),
          ),
        },
      ];
    });
  const roster = [...byId].map(([id, body]) => ({
    id,
    name: body.group?.name ?? body.actor.name,
    mass: body.properties.mass,
    hullVertices: body.hulls.map((hull) => hull.vertices.length),
    owner: body.owner?.capturedId ?? null,
    joint: body.joint?.type ?? null,
    overlapRecovery: body.overlapRecovery,
    overlapDetected: body.overlapDetected,
    worldRecovery: body.worldRecovery,
    worldOverlapDetected: body.worldOverlapDetected,
    ...motion(body),
  }));
  return {
    byId,
    sim,
    roster,
    extraRegisteredBodies: sim.phil.registeredBodies
      .filter((body) => ![...byId.values()].includes(body))
      .map((body) => ({
        kind: body.kind ?? "unknown",
        name: body.actor?.name ?? body.group?.name ?? null,
      })),
    anchorErrors,
    limitations: [
      "Post-tick captured poses and collision hulls, not a preceding-tick application restore.",
      "Original DAT/WAM actors and mechanics; prior render dents, random state, queued damage, quiet caches and WAM timers were not captured.",
      "Known bumper reconstructed phase 2 and known door phase 1 from physical ancestry; other original WAM parts start attached.",
      "NPC controls are captured, but this bounded direct-step test does not run AI/graphics outer-frame dispatch.",
    ],
    tick() {
      require(++ticks <= 3, "three-step budget exceeded");
      const diagnostics = {};
      const pair = [];
      sim.correctionDiagnostics = diagnostics;
      sim.bodyPairDiagnostics = (phase, counters) =>
        pair.push({ phase, ...counters });
      const start = performance.now();
      sim.step();
      const bodies = [...byId].map(([id, body]) => {
        const result = {
          id,
          ...motion(body),
          displacement: body.state.position.distanceTo(initial.get(id)),
          present: !body.owner || sim.debris.includes(body),
          joint: body.joint?.type ?? null,
          groundedWheels: body.state.groundedWheelCount ?? null,
        };
        require(Object.values(motion(body))
          .flat()
          .every(Number.isFinite), `nonfinite body ${id}`);
        return result;
      });
      const result = {
        tick: ticks,
        elapsed: sim.elapsed,
        cpuMs: performance.now() - start,
        diagnostics,
        pair,
        guardFractions,
        bodies,
        anchors: anchorErrors(),
        playerForce: c.player.debug?.force?.toArray(),
        playerTorque: c.player.debug?.torque?.toArray(),
        impacts: sim.lastImpacts.map((impact) => ({
          a: impact.a.capturedId,
          b: impact.b?.capturedId ?? null,
          sourceType: impact.sourceType,
          normalImpulse: impact.normalImpulse,
          solverAccepted: impact.solverAccepted,
          closingSpeed: impact.closingSpeed,
          point: impact.point.toArray(),
          normal: impact.normal.toArray(),
          penetration: impact.penetration,
        })),
      };
      steps.push(result);
      return result;
    },
    steps,
    repairPlayer() {
      const bumper = byId.get(7);
      const part = bumper && bumper.owner.damage.runtimeParts[bumper.part];
      const before = part && {
        phase: part.state.phase,
        bodyPresent: sim.debris.includes(bumper),
      };
      sim.repair(c.player);
      return {
        before,
        phase: part?.state.phase ?? null,
        queuedAt: part?.state.queuedAt ?? null,
        originalParent: part ? part.actor.parent === part.originalParent : null,
        components: [...c.player.damage.componentLevels],
        foreignDoorPresent: sim.debris.includes(byId.get(8)),
        foreignDoorJointParent: byId.get(8)?.joint?.parent?.capturedId ?? null,
        // Production removes phase-zero physical reservations on the next tick.
        bodyRemovalPending: bumper ? sim.debris.includes(bumper) : false,
      };
    },
  };
}
