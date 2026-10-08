import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  pedFacePopulation,
  pedTrianglePoint,
  pedFloorAllowed,
  pedObstacleIgnored,
  predictPedThreat,
  parsePedSettings,
  PedAction,
  pedTurnDuration,
  pedInterpolateDirection,
  pedRandomInteger,
  pedRandomFloat,
} from "../src/ped-rules.ts";
import { PedestrianSystem, collectPedSurfaces } from "../src/pedestrians.ts";

function floor(material = "walk", area = 10, x = 0) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([x, 0, 0, x, 0, 2, x + area, 0, 0], 3),
  );
  const m = new THREE.MeshBasicMaterial();
  m.name = material;
  return new THREE.Mesh(geometry, m);
}
const spec = (material, density) => ({
  material,
  density,
  movement: 0,
  group: 0,
  exclusions: [],
  exclusionFlags: [],
  exceptions: [],
});
test("installed C2 population divides projected area by1000, floors and carries per material", () => {
  // Installed0x4d2a80 multiplies double47.61 and float-.001 after negative
  // projected determinant/2. For20world² at density1, expected0.9522, not9.522.
  const first = pedFacePopulation(20, 1, 0);
  assert.equal(first.count, 0);
  assert.ok(Math.abs(first.carry - 0.9522) < 1e-8);
  const second = pedFacePopulation(20, 1, first.carry);
  assert.equal(second.count, 1);
  assert.ok(Math.abs(second.carry - 0.9044) < 1e-8);
  assert.deepEqual(pedFacePopulation(999, -3.5, 0.9), { count: 3, carry: 0.5 });
  const track = new THREE.Group();
  track.add(floor("a", 20), floor("b", 20, 50), floor("a", 20, 100));
  const a = spec("a", 1),
    b = spec("b", 1),
    surfaces = collectPedSurfaces(track, [a, b]);
  assert.equal(surfaces.length, 1);
  assert.equal(surfaces[0].spec, a);
  assert.equal(surfaces[0].a.x, 100);
});
test("face population uses slope limit and horizontal projection, unaffected by player start", () => {
  const steep = floor("walk", 20);
  steep.geometry.getAttribute("position").setY(1, 2);
  steep.geometry.getAttribute("position").needsUpdate = true;
  assert.equal(collectPedSurfaces(steep, [spec("walk", -4)]).length, 0);
  const flat = floor("walk", 20);
  const surfaces = collectPedSurfaces(flat, [spec("walk", -4)]);
  assert.equal(surfaces[0].count, 4);
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(1, 0, 0),
    c = new THREE.Vector3(0, 0, 1);
  const values = [0, 0];
  assert.deepEqual(
    pedTrianglePoint(a, b, c, () => values.shift()).toArray(),
    [0.1, 0, 0.1],
  );
  const folded = pedTrianglePoint(a, b, c, () => 1);
  const sourceFolded = 1 - (0.1 + (0.8 * 32767) / 32768);
  assert.ok(Math.abs(folded.x - sourceFolded) < 1e-12);
  assert.ok(Math.abs(folded.z - sourceFolded) < 1e-12);
});
test("floor exclusions retain flags; wall exceptions do not override floor restrictions", () => {
  const s = {
    ...spec("walk", 1),
    exclusions: ["road", "water"],
    exclusionFlags: [1, 0],
    exceptions: ["road", "fence"],
  };
  assert.equal(pedFloorAllowed(s, "ROAD.MAT", false), false);
  assert.equal(pedFloorAllowed(s, "road", true), true);
  assert.equal(pedFloorAllowed(s, "water", true), false);
  assert.equal(pedObstacleIgnored(s, "FENCE.MAT"), true);
  assert.equal(pedFloorAllowed(s, "road", false), false);
  assert.equal(
    pedFloorAllowed({ ...s, exclusionFlags: [2, 0] }, "road", true),
    true,
    "native unsigned-byte flag is Boolean, not a bitmask",
  );
  assert.equal(
    pedFloorAllowed({ ...s, exclusionFlags: [256, 0] }, "road", true),
    false,
    "native byte storage wraps256 to zero",
  );
});
test("native threat prediction reacts to approaching corridors and all supplied vehicles", () => {
  const p = new THREE.Vector3(),
    v = new THREE.Vector3();
  const moving = {
    position: new THREE.Vector3(0, 0, 4),
    yaw: 0,
    speed: 2,
    radiusSquared: 0.1,
  };
  assert.equal(predictPedThreat(p, v, [moving], 1)?.timeToClosest, 2);
  assert.equal(predictPedThreat(p, v, [{ ...moving, speed: -2 }], 1), null);
  assert.equal(
    predictPedThreat(
      p,
      v,
      [{ ...moving, position: new THREE.Vector3(1, 0, 4) }],
      1,
    ),
    null,
  );
  assert.equal(
    predictPedThreat(
      p,
      v,
      [{ ...moving, position: new THREE.Vector3(0, 5, 4) }],
      1,
    ),
    null,
  );
  assert.equal(
    predictPedThreat(
      p,
      v,
      [{ ...moving, position: new THREE.Vector3(0, 0, 5) }],
      1,
    ),
    null,
  );
  assert.equal(
    predictPedThreat(p, v, [{ ...moving, speed: 0 }, moving], 1)?.threat,
    moving,
  );
  // Relative pedestrian velocity matters; a receding car can still threaten
  // a faster pedestrian headed into its path.
  assert.ok(
    predictPedThreat(
      p,
      new THREE.Vector3(0, 0, 3),
      [{ ...moving, speed: -2 }],
      1,
    ),
  );
});
const settings =
  "12\n9\n25\n.5\n4\n// MOVEMENT STUFF\n2\n2\n30\n180\n.7\n1.7\n0\n0\n0\n0\n0\n// Group #0\n1\nAlice\n";
test("installed walk periods use1000/(30*multiplier), correcting rec2'sfactor900 error", () => {
  const parsed = parsePedSettings(settings);
  assert.equal(parsed.movements[0].minWalkPeriod, 47);
  assert.equal(parsed.movements[0].maxWalkPeriod, 19);
  assert.equal(parsed.movements[1].maxWalkPeriod, 0);
  assert.equal(parsed.movements[0].minTurnMs, 2000);
  assert.equal(parsed.movements[0].maxTurnMs, 30000);
  assert.throws(
    () => parsePedSettings(settings.replace("\n30\n180", "\n1\n180")),
    /Invalid/,
  );
});
function minimalAssets() {
  const prototype = new THREE.Group();
  prototype.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.28, 0.06),
      new THREE.MeshBasicMaterial(),
    ),
  );
  return {
    manifest: [{ path: "data/PEDS/PEEPS/Alice/Alice.act", size: 1000 }],
    async text(path) {
      if (/settings/i.test(path)) return settings;
      throw new Error("fixture has no motion packages");
    },
    async scene() {
      return { group: prototype.clone(true) };
    },
  };
}
test("production population reaches native2000 cap with no80/240 cap, start bias or spacing rejection", async () => {
  const track = new THREE.Group();
  for (let i = 0; i < 21; i++) track.add(floor("walk", 1, i * 10));
  const config = "// Ped specs\n1\nwalk\n0\n0\n-100\n0\n0\n";
  const peds = await PedestrianSystem.create(
    minimalAssets(),
    track,
    config,
    () => 0,
    { spawn: new THREE.Vector3(10000, 0, 10000), random: () => 0.25 },
  );
  assert.equal(peds.count, 2000);
  assert.equal(peds.groupCounts.get(0).total, 2000);
  assert.ok(peds.states.some((p) => p.position.x < 2));
  assert.ok(peds.states.some((p) => p.position.x > 190));
  peds.dispose();
});
test("camera processing preserves full count and obeys native popup hysteresis/reset", async () => {
  const peds = await PedestrianSystem.create(
    minimalAssets(),
    floor(),
    "// Ped specs\n1\nwalk\n0\n0\n-1\n0\n0\n",
    () => 0,
    { spawn: new THREE.Vector3(), random: () => 0.25 },
  );
  const target = peds.states[0].position.clone(),
    car = { position: new THREE.Vector3(100, 0, 100), yaw: 0, speed: 0 };
  peds.update(0.1, car, { cameraPosition: target });
  assert.equal(peds.states[0].active, true);
  peds.update(0.1, car, {
    cameraPosition: target.clone().add(new THREE.Vector3(20, 0, 0)),
  });
  assert.equal(peds.states[0].active, false);
  assert.equal(peds.count, 1);
  peds.update(0.1, car, { cameraPosition: target });
  assert.equal(peds.states[0].active, false);
  peds.resetCar(car.position);
  peds.update(0.1, car, { cameraPosition: target });
  assert.equal(peds.states[0].active, true);
  // Supply a rival on an approaching collision course while player isfar away.
  const rival = {
    position: target.clone().add(new THREE.Vector3(0, 0, 4)),
    yaw: 0,
    speed: 2,
  };
  peds.update(0.1, car, { cameraPosition: target, threats: [rival] });
  assert.equal(peds.states[0].action, PedAction.Panicking);
  for (let i = 0; i < 6; i++)
    peds.update(0.1, car, { cameraPosition: target, threats: [rival] });
  assert.equal(peds.states[0].action, PedAction.Running);
  peds.reset();
  assert.equal(peds.states[0].action, PedAction.Walking);
  peds.dispose();
});

test("native random endpoints, signed reversed walk periods and vector turn interpolation", () => {
  assert.equal(
    pedRandomInteger(() => 1, 47, 19),
    21,
  );
  assert.equal(
    pedRandomInteger(() => 0, 47, 19),
    47,
  );
  assert.ok(
    Math.abs(
      pedRandomFloat(() => 1, 0.8, 1.2) - (0.8 + (0.4 * 32767) / 32768),
    ) < 1e-15,
  );
  assert.equal(pedTurnDuration(30, 1, 1), 500);
  assert.ok(Math.abs(pedTurnDuration(30, 0.1, 1) - 100) < 0.00001);
  const t = 0.25,
    angle = Math.PI * 0.75;
  assert.equal(
    pedInterpolateDirection(0, angle, t),
    Math.atan2(t * Math.sin(angle), 0.75 + t * Math.cos(angle)),
  );
  assert.ok(Math.abs(pedInterpolateDirection(0, angle, t) - angle * t) > 0.1);
});
function movingAssets() {
  const assets = minimalAssets(),
    bytes = new Uint8Array(8 + 37 + 96),
    view = new DataView(bytes.buffer);
  view.setUint32(0, 1, true);
  view.setUint32(4, 2, true);
  bytes.set(new TextEncoder().encode("Root"), 8);
  for (let frame = 0; frame < 2; frame++) {
    for (const axis of [0, 4, 8])
      view.setFloat32(45 + frame * 48 + axis * 4, 1, true);
    view.setFloat32(45 + frame * 48 + 10 * 4, -0.02 * frame, true);
  }
  assets.bytes = async () => bytes;
  assets.text = async (path) => {
    if (/settings/i.test(path)) return settings;
    if (/PEEPS/i.test(path)) return "FORM\nDEFAULT\n";
    if (/FORMS/i.test(path))
      return (
        "START OF BONES\nRoot\n68\nBOX\nEND OF BONES\nSTART OF MOVES\n" +
        [2, 11, 13, 30, 41]
          .map((id) => `${id}\n30\nY\n0,0,0\nwalk.SKL\n0\n`)
          .join("") +
        "END OF MOVES"
      );
    return (
      "START OF MOVES\n" +
      [2, 11, 13, 30, 41].map((id) => `${id}\n1\nGROUND\n.15\n`).join("") +
      "END OF MOVES"
    );
  };
  return assets;
}
const clearFloor = (material = "walk") => ({
  raycast(origin, direction) {
    return direction.y < 0
      ? {
          distance: 0.05,
          normal: new THREE.Vector3(0, 1, 0),
          surface: { material },
        }
      : null;
  },
});
test("actor update applies exclusion flags to authored root movement while scared", async () => {
  const peds = await PedestrianSystem.create(
    movingAssets(),
    floor(),
    "// Ped specs\n1\nwalk\n0\n0\n-1\n1\n1\nroad\n1\nroad\n",
    () => 0,
    {
      spawn: new THREE.Vector3(),
      random: () => 0.25,
      collision: clearFloor("road"),
    },
  );
  const start = peds.states[0].position,
    car = { position: new THREE.Vector3(100, 0, 100), yaw: 0, speed: 0 };
  peds.update(0.1, car, { cameraPosition: start });
  assert.equal(
    peds.states[0].position.distanceTo(start),
    0,
    "wall exception cannot override forbidden floor while walking",
  );
  const rival = {
    position: start.clone().add(new THREE.Vector3(0, 0, 4)),
    yaw: 0,
    speed: 2,
    radiusSquared: 1,
  };
  peds.update(0.1, car, { cameraPosition: start, threats: [rival] });
  peds.update(0.1, car, { cameraPosition: start, threats: [rival] });
  assert.equal(peds.states[0].action, PedAction.Running);
  assert.ok(
    peds.states[0].position.distanceTo(start) > 0.01,
    "flag1 floor becomes permissible to running actor",
  );
  peds.dispose();
});
test("actor turns smoothly and native repeated fear selects pleading after ten seconds", async () => {
  let sample = 0.25;
  const peds = await PedestrianSystem.create(
    movingAssets(),
    floor(),
    "// Ped specs\n1\nwalk\n0\n0\n-1\n0\n0\n",
    () => 0,
    {
      spawn: new THREE.Vector3(),
      random: () => sample,
      collision: clearFloor(),
    },
  );
  const car = { position: new THREE.Vector3(100, 0, 100), yaw: 0, speed: 0 },
    camera = peds.states[0].position;
  const actor = peds.group.children.find((o) => o.name.startsWith("ped-")),
    before = actor.rotation.y;
  // The authored minimum/maximum interval is2..30seconds; sample.25 picks9s.
  for (let i = 0; i < 90; i++)
    peds.update(0.1, car, { cameraPosition: camera });
  const first = actor.rotation.y;
  peds.update(0.1, car, { cameraPosition: camera });
  peds.update(0.1, car, { cameraPosition: camera });
  assert.ok(
    Math.abs(actor.rotation.y - first) > 0,
    "random wander enters interpolated turn",
  );
  assert.ok(
    Math.abs(actor.rotation.y - before) < Math.PI,
    "turn does not jump to its target on the first frame",
  );
  peds.reset();
  const target = peds.states[0].position;
  const rival = {
    position: target.clone().add(new THREE.Vector3(0, 0, 4)),
    yaw: 0,
    speed: 2,
    radiusSquared: 1,
  };
  peds.update(0.1, car, { cameraPosition: target, threats: [rival] });
  sample = 0.5; // IRandomBetween(0,8) =>4 => installed table move11.
  for (let i = 0; i < 102; i++) {
    rival.position
      .copy(peds.states[0].position)
      .add(new THREE.Vector3(0, 0, 4));
    peds.update(0.1, car, { cameraPosition: target, threats: [rival] });
  }
  assert.equal(peds.states[0].moveId, 11);
  assert.equal(peds.states[0].action, PedAction.Panicking);
  peds.dispose();
});
test("actor avoids parked collision objects before the native speed fear gate", async () => {
  const peds = await PedestrianSystem.create(
    movingAssets(),
    floor(),
    "// Ped specs\n1\nwalk\n0\n0\n-1\n0\n0\n",
    () => 0,
    { spawn: new THREE.Vector3(), random: () => 0.25, collision: clearFloor() },
  );
  const actor = peds.group.children.find((o) => o.name.startsWith("ped-")),
    heading = actor.rotation.y,
    direction = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading)),
    start = peds.states[0].position,
    parked = {
      position: start
        .clone()
        .addScaledVector(direction, 0.3)
        .add(new THREE.Vector3(0, 0.15, 0)),
      yaw: 0,
      speed: 0,
      radiusSquared: 1,
    },
    car = { position: new THREE.Vector3(100, 0, 100), yaw: 0, speed: 0 };
  peds.update(0.1, car, { cameraPosition: start, threats: [parked] });
  assert.equal(peds.states[0].action, PedAction.Walking);
  const moved = peds.states[0].position.clone().sub(start);
  assert.ok(moved.length() > 0.01);
  assert.ok(Math.abs(moved.clone().normalize().dot(direction)) < 0.0001);
  peds.dispose();
});
test("actor avoidance uses native projected finite face corners rather than center rays", async () => {
  const faces = [],
    collision = { ...clearFloor(), querySurfaces: () => faces };
  const peds = await PedestrianSystem.create(
    movingAssets(),
    floor(),
    "// Ped specs\n1\nwalk\n0\n0\n-1\n0\n0\n",
    () => 0,
    { spawn: new THREE.Vector3(), random: () => 0.25, collision },
  );
  const actor = peds.group.children.find((o) => o.name.startsWith("ped-")),
    heading = actor.rotation.y,
    forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading)),
    right = new THREE.Vector3(0, 1, 0).cross(forward),
    start = peds.states[0].position,
    center = start.clone().addScaledVector(forward, 0.3),
    a = center.clone().addScaledVector(right, 0.06),
    b = a.clone().add(new THREE.Vector3(0, 0.3, 0)),
    c = center.clone().addScaledVector(right, 0.2);
  faces.push({
    a,
    b,
    c,
    normal: forward.clone().negate(),
    material: "brick",
    materialFlags: 0,
    minY: 0,
    maxY: 0.3,
  });
  const car = { position: new THREE.Vector3(100, 0, 100), yaw: 0, speed: 0 };
  peds.update(0.1, car, { cameraPosition: start, threats: [] });
  const moved = peds.states[0].position.clone().sub(start);
  assert.ok(moved.length() > 0.01);
  assert.ok(
    Math.abs(moved.clone().normalize().dot(forward)) < 0.001,
    "body strip corner causes native instant tangent before contact",
  );
  assert.equal(peds.states[0].action, PedAction.Walking);
  peds.dispose();
});
test("actor native floor-edge clipping turns before forbidden road and flag1 opens it while running", async () => {
  const values = [0.25, 0.25, 0.25, 0.5, 1, 0.25, 0.25, 0.25],
    faces = [],
    collision = { ...clearFloor(), querySurfaces: () => faces };
  const peds = await PedestrianSystem.create(
    movingAssets(),
    floor(),
    "// Ped specs\n1\nwalk\n0\n0\n-1\n1\n1\nroad\n0\n",
    () => 0,
    {
      spawn: new THREE.Vector3(),
      random: () => values.shift() ?? 0.25,
      collision,
    },
  );
  const start = peds.states[0].position,
    a = start.clone().add(new THREE.Vector3(0.2, 0, 0.3)),
    b = start.clone().add(new THREE.Vector3(-0.2, 0, 0.3)),
    c = start.clone().add(new THREE.Vector3(0, 0, 0.6));
  faces.push({
    a,
    b,
    c,
    normal: new THREE.Vector3(0, 1, 0),
    material: "road",
    materialFlags: 0,
    minY: 0,
    maxY: 0,
  });
  const car = { position: new THREE.Vector3(100, 0, 100), yaw: 0, speed: 0 };
  peds.update(0.1, car, { cameraPosition: start, threats: [] });
  assert.ok(
    peds.states[0].position.z < start.z,
    "source flag8 and second scan choose back direction before reaching road",
  );
  peds.reset();
  const rival = {
    position: start.clone().add(new THREE.Vector3(0, 0.15, -4)),
    yaw: Math.PI,
    speed: 2,
    radiusSquared: 1,
  };
  peds.update(0.1, car, { cameraPosition: start, threats: [rival] });
  assert.equal(peds.states[0].action, PedAction.Panicking);
  peds.update(0.1, car, { cameraPosition: start, threats: [rival] });
  assert.equal(peds.states[0].action, PedAction.Running);
  assert.ok(
    peds.states[0].position.z > start.z,
    "running ignores road flag1, so neither proximity nor floor step rejects it",
  );
  peds.dispose();
});
