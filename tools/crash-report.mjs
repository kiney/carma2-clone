/** Deterministic read-only conformance diagnostics. Numeric original-data
 * results are generated under ignored artifacts, never proprietary fixtures. */
import { mkdir, writeFile } from "node:fs/promises";
import {
  Group,
  Vector3,
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  DoubleSide,
} from "three";
import { originalCar } from "../tests/support/original-car.mjs";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
  PHYSICS_STEP,
} from "../src/physics/simulation.ts";
const emptyWorld = { raycast: () => null, querySurfaces: () => [] };
async function car(name, human = true) {
  const original = await originalCar(name),
    damage = new DamageSystem(original.assets, original.group, original.text);
  await damage.init();
  damage.damageContext.random = () => 0.5;
  return createSimulatedCar(
    original.group,
    original.text,
    damage,
    new Vector3(),
    0,
    human,
  );
}
function state(body) {
  return {
    position: body.state.position.toArray(),
    orientation: body.state.orientation.toArray(),
    mass: body.properties.mass,
    centerOfMass: body.properties.centerOfMass.toArray(),
    inertia: body.properties.inertia.toArray(),
    velocity: body.state.velocity.toArray(),
    angularVelocity: body.state.angularVelocity.toArray(),
  };
}
function visual(body) {
  const snapshot = new Map();
  body.group.traverse((o) => {
    if (o.isMesh)
      snapshot.set(o, Float32Array.from(o.geometry.attributes.position.array));
  });
  return snapshot;
}
function results(sim, body, pristine) {
  let moved = 0,
    max = 0,
    total = 0;
  for (const [mesh, original] of pristine) {
    const now = mesh.geometry.attributes.position.array;
    if (now.length !== original.length) continue;
    for (let i = 0; i < now.length; i += 3) {
      const d = Math.hypot(
        ...[0, 1, 2].map((j) => now[i + j] - original[i + j]),
      );
      if (d > 1e-7) moved++;
      max = Math.max(max, d);
      total += d;
    }
  }
  return {
    state: state(body),
    componentDamage: [...body.damage.componentLevels],
    knackered: body.knackered,
    snapped: body.damage.snapped,
    deformation: {
      movedRenderVertices: moved,
      maxModelDisplacement: max,
      totalModelDisplacement: total,
    },
    parts: body.damage.runtimeParts
      .filter((p) => p.state.phase || p.state.queuedAt !== null)
      .map((p) => ({
        actor: p.actor.name,
        phase: p.state.phase,
        queuedAt: p.state.queuedAt,
        accumulatedForce: p.state.accumulatedForce,
      })),
    detached: sim.debris.map((b) => ({
      actor: b.actor.name,
      part: b.part,
      jointed: !!b.joint,
      ...state(b),
    })),
    contacts: sim.lastImpacts.map((c) => ({
      point: c.point.toArray(),
      pointB: c.pointB?.toArray(),
      normal: c.normal.toArray(),
      type: c.sourceType,
      lambda: c.normalImpulse,
      closingSpeed: c.closingSpeed,
    })),
  };
}
const cases = [];
for (const name of ["EAGLE3", "buggy", "bigdump"])
  for (const [region, axis, direction, speed] of [
    ["front", 2, -1, 2],
    ["front", 2, -1, 8],
    ["side", 0, -1, 4],
    ["rear", 2, 1, 4],
  ]) {
    const body = await car(name),
      before = visual(body),
      bounds = new Box3().setFromPoints(body.shapeVertices.flat());
    body.state.position.setComponent(
      axis,
      -(direction < 0 ? bounds.min : bounds.max).getComponent(axis) -
        direction * 0.05,
    );
    body.state.velocity.setComponent(axis, direction * speed);
    const initial = state(body),
      scene = new Group(),
      geo = new BufferGeometry();
    const v =
      axis === 2
        ? [
            -10, -10, 0, 10, 10, 0, 10, -10, 0, -10, -10, 0, -10, 10, 0, 10, 10,
            0,
          ]
        : [
            0, -10, -10, 0, 10, 10, 0, 10, -10, 0, -10, -10, 0, -10, 10, 0, 10,
            10,
          ];
    geo.setAttribute("position", new Float32BufferAttribute(v, 3));
    geo.userData.sourceFaceFlags = Uint8Array.from([7, 7]);
    const material = new MeshBasicMaterial({ side: DoubleSide });
    material.userData.c2Flags = 4096;
    scene.add(new Mesh(geo, material));
    const { WorldCollision } = await import("../src/world.ts"),
      world = new WorldCollision(scene),
      sim = new VehicleSimulation(world, scene);
    scene.add(body.group);
    sim.add(body);
    sim.step();
    cases.push({
      name,
      scenario: region + "-plane",
      speed,
      initial,
      output: results(sim, body, before),
    });
  }
for (const [first, second, offset] of [
  ["EAGLE3", "EAGLE3", 0],
  ["buggy", "bigdump", 0],
  ["EAGLE3", "EAGLE3", 0.14],
]) {
  const a = await car(first),
    b = await car(second, false),
    beforeA = visual(a),
    beforeB = visual(b);
  a.state.position.z =
    -Math.min(...a.shapeVertices.flat().map((v) => v.z)) + 0.05;
  b.state.position.set(
    offset,
    0,
    Math.min(...b.shapeVertices.flat().map((v) => v.z)) - 0.05,
  );
  b.state.orientation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
  b.state.heading = Math.PI;
  a.state.velocity.z = -4;
  b.state.velocity.z = 4;
  const initial = [state(a), state(b)],
    sim = new VehicleSimulation(emptyWorld, new Group());
  sim.add(a);
  sim.add(b);
  sim.step();
  cases.push({
    names: [first, second],
    scenario: offset ? "off-center-car" : "head-on-car",
    initial,
    output: [results(sim, a, beforeA), results(sim, b, beforeB)],
  });
}
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/crash-conformance.json",
  JSON.stringify(
    { step: PHYSICS_STEP, evidence: "docs/c2-physics-re.md", cases },
    null,
    2,
  ) + "\n",
);
console.log(
  `${cases.length} deterministic original-car scenarios recorded in artifacts/crash-conformance.json`,
);
