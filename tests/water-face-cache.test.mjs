import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3, Quaternion, Box3, Matrix4 } from "three";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { WorldDestruction } from "../src/world-destruction.ts";
import { WorldCollision } from "../src/world.ts";
import { BrowserGameClock } from "../src/game-clock.ts";
import { DEFAULT_SURFACE } from "../src/physics/surfaces.ts";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import {
  detectWaterPlane,
  NATIVE_WATER_NORMAL_Y_MINIMUM,
  NO_WATER_DISTANCE,
  parseDefaultWaterVolume,
} from "../src/physics/volumes.ts";

const cube = buildBoxHull(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
function body() {
  return {
    state: {
      position: new Vector3(),
      orientation: new Quaternion(),
      predictedPosition: new Vector3(),
      predictedOrientation: new Quaternion(),
      velocity: new Vector3(),
      angularVelocity: new Vector3(),
    },
    properties: {
      mass: 1,
      inertia: new Vector3(1, 1, 1),
      centerOfMass: new Vector3(),
      worldFriction: 0,
    },
    hulls: [cube],
  };
}
function face(material = "!WATER", y = 0, normal = new Vector3(0, 1, 0)) {
  return {
    material,
    a: new Vector3(-2, y, -2),
    b: new Vector3(0, y, 2),
    c: new Vector3(2, y, -2),
    normal,
    minY: y,
    maxY: y,
    modifier: DEFAULT_SURFACE,
    twoSided: true,
    materialFlags: 4096,
    faceFlags: 0,
  };
}
function fixture() {
  const scene = new Group(),
    world = new WorldCollision(scene),
    simulation = new VehicleSimulation(world, scene);
  simulation.defaultWaterVolume = parseDefaultWaterVolume(
    "// Default underwater special volume parameters\n.2\n50\n0\n.002\n-1\n-1\nNONE\n-1\n-1\n0\n10",
  );
  world.raycast = () => null;
  return { scene, world, simulation, rigid: body() };
}

test("retained water plane updates only on face-cache refresh while depth updates each force pass", () => {
  const { simulation, world, rigid } = fixture();
  let faces = [face()],
    calls = 0;
  world.querySurfaces = (_, __, includeNonSolid) => {
    assert.equal(includeNonSolid, true);
    calls++;
    return faces;
  };
  simulation.facesNearBody(rigid, rigid.hulls);
  simulation.updateSpecialVolume(rigid);
  assert.equal(rigid.specialVolume.waterDistance, 0);
  assert.equal(rigid.specialVolume.depth, 0.5);
  faces = [face("!WATER", 0.1)];
  rigid.state.position.y = 0.005;
  simulation.facesNearBody(rigid, rigid.hulls);
  simulation.updateSpecialVolume(rigid);
  assert.equal(calls, 1, "strict interior query retains last plane");
  assert.equal(rigid.specialVolume.waterDistance, 0);
  assert.equal(rigid.specialVolume.depth, Math.fround(0.995 / 2));
  simulation.invalidateWorldFaceCache(rigid);
  simulation.facesNearBody(rigid, rigid.hulls);
  assert.equal(calls, 2);
  assert.equal(rigid.specialVolume.waterDistance, Math.fround(0.1));
});

test("invalid last emitted bang face clears only distance and never falls back to an earlier valid face", () => {
  const { simulation, world, rigid } = fixture();
  world.querySurfaces = () => [face()];
  simulation.facesNearBody(rigid, rigid.hulls);
  simulation.updateSpecialVolume(rigid);
  const previousNormal = rigid.specialVolume.waterNormal;
  const previousAuto = rigid.specialVolume.automatic;
  const previousDepth = rigid.specialVolume.depth;
  world.querySurfaces = () => [
    face("!GOOD", 0.25),
    face("!STEEP", 0.5, new Vector3(1, 0.5, 0)),
  ];
  simulation.invalidateWorldFaceCache(rigid);
  simulation.facesNearBody(rigid, rigid.hulls);
  assert.equal(rigid.specialVolume.waterDistance, NO_WATER_DISTANCE);
  assert.equal(rigid.specialVolume.waterNormal, previousNormal);
  assert.equal(rigid.specialVolume.automatic, previousAuto);
  assert.equal(rigid.specialVolume.depth, previousDepth);
  simulation.updateSpecialVolume(rigid);
  assert.equal(
    rigid.specialVolume.automatic,
    null,
    "MungeSpecialVolume clears a partial-depth latch separately",
  );
});

test("normal callback boundary is the exact stored Float32 .9 and downward normals are flipped", () => {
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, 0x3f666666, true);
  const threshold = view.getFloat32(0, true);
  view.setUint32(0, 0x3f666667, true);
  const above = view.getFloat32(0, true);
  assert.equal(NATIVE_WATER_NORMAL_Y_MINIMUM, threshold);
  assert.equal(
    detectWaterPlane([face("!EQUAL", 0, new Vector3(0, threshold, 0))]),
    null,
  );
  assert.ok(detectWaterPlane([face("!ABOVE", 0, new Vector3(0, above, 0))]));
  const plane = detectWaterPlane([
    face("!DOWN", 0.123456789, new Vector3(0, -1, 0)),
  ]);
  assert.equal(plane.normal.y, 1);
  assert.equal(plane.distance, Math.fround(0.123456789));
});

test("hash material is emitted but does not supply the water-plane pointer", () => {
  const { simulation, world, rigid } = fixture();
  world.querySurfaces = () => [face("!FIRST", 0.25), face("#LAST", 0.5)];
  simulation.facesNearBody(rigid, rigid.hulls);
  assert.equal(rigid.specialVolume.waterDistance, 0.25);
  world.querySurfaces = () => [face("#ONLY", 0.5)];
  simulation.invalidateWorldFaceCache(rigid);
  simulation.facesNearBody(rigid, rigid.hulls);
  assert.equal(rigid.specialVolume.waterDistance, NO_WATER_DISTANCE);
});

test("first300 finite faces exclude a later water face before callback selection", () => {
  const { simulation, world, rigid } = fixture();
  world.querySurfaces = () => [
    ...Array.from({ length: 300 }, () => face("/SOLID")),
    face("!LATE", 0.25),
  ];
  simulation.facesNearBody(rigid, rigid.hulls);
  assert.equal(simulation.worldFaceCache.count, 300);
  assert.equal(simulation.worldFaceCache.epoch, 2);
  assert.equal(rigid.specialVolume.waterDistance, NO_WATER_DISTANCE);
});

test("water pointer is cleared once and survives a wrap pass with no later bang", () => {
  const { simulation, world, rigid } = fixture();
  const filler = simulation.worldFaceCache.createState();
  simulation.worldFaceCache.get(
    filler,
    {
      bounds: new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
      matrix: new Matrix4(),
      committedMatrix: new Matrix4(),
    },
    () => Array.from({ length: 299 }, () => face("/OLD")),
  );
  let calls = 0;
  world.querySurfaces = () =>
    ++calls === 1 ? [face("!TAIL", 0.25)] : [face("/NEW")];
  const faces = simulation.facesNearBody(rigid, rigid.hulls);
  assert.equal(calls, 2);
  assert.equal(faces.length, 1);
  assert.equal(faces[0].material, "/NEW");
  assert.equal(
    rigid.specialVolume.waterDistance,
    0.25,
    "native pointer still targets slot299 outside the new range",
  );
});

test("wrap overwriting the pointed slot changes callback input even without another bang", () => {
  const { simulation, world, rigid } = fixture();
  let calls = 0;
  world.querySurfaces = () =>
    ++calls === 1
      ? [
          face("!FIRST", 0.25),
          ...Array.from({ length: 299 }, () => face("/FILL")),
        ]
      : [face("/OVERWRITE", 0.125)];
  simulation.facesNearBody(rigid, rigid.hulls);
  assert.equal(calls, 2);
  assert.equal(
    rigid.specialVolume.waterDistance,
    0.125,
    "EDX points to the overwritten ring record, without material revalidation",
  );
});

test("generic force volume selection uses its previous plane until collision face collection refreshes it", () => {
  const { simulation, world, rigid } = fixture();
  let calls = 0;
  world.querySurfaces = () => {
    calls++;
    return [face()];
  };
  simulation.updateSpecialVolume(rigid);
  assert.equal(
    calls,
    0,
    "generic force phase does not invent an early FindFaces query",
  );
  assert.equal(rigid.specialVolume.volume, null);
  simulation.facesNearBody(rigid, rigid.hulls, true);
  assert.equal(rigid.specialVolume.waterDistance, 0);
  assert.equal(
    rigid.specialVolume.volume,
    null,
    "refresh stores plane, projection waits for force phase",
  );
  simulation.updateSpecialVolume(rigid);
  assert.equal(rigid.specialVolume.depth, 0.5);
  assert.equal(rigid.specialVolume.volume, simulation.defaultWaterVolume);
});

test("destruction uses the shared integer gameplay clock across physics and final flush domains", () => {
  const { simulation, scene, rigid } = fixture();
  const destruction = new WorldDestruction(scene, []);
  simulation.destruction = destruction;
  simulation.elapsed = 0.12000000000000001;
  let clock = 321;
  simulation.smashClock = () => clock;
  destruction.update(clock);
  clock = 400;
  simulation.step();
  assert.equal(
    destruction.timeMs,
    400,
    "fractional physics160 must not rewind a gameplay321 state",
  );
  let observedContact;
  const originalContact = destruction.handleContact.bind(destruction);
  destruction.handleContact = (contact) => {
    observedContact = contact;
    return originalContact(contact);
  };
  simulation.processWorldSmash(
    [
      {
        a: rigid,
        point: new Vector3(),
        normal: new Vector3(0, 1, 0),
        normalImpulse: 1,
        tangentImpulse: new Vector3(),
        closingSpeed: 1,
        sourceType: 1,
        sourceSurface: { ...face("/SOLID"), actor: new Group() },
      },
    ],
    [],
  );
  assert.equal(
    observedContact.timeMs,
    400,
    "world contact uses the queue gameplay domain as well",
  );
  simulation.flushSmashEffects();
  clock = 405;
  simulation.step();
  assert.equal(destruction.timeMs, 405);
  destruction.update(404);
  assert.equal(
    destruction.timeMs,
    404,
    "native predicted game time can regress after a stall",
  );
  for (const invalid of [-1, NaN, Infinity])
    assert.throws(
      () => destruction.update(invalid),
      /Invalid destruction time/,
    );
});

test("destruction accepts the native 2000 to1032 predicted-clock correction after a stall", () => {
  const destruction = new WorldDestruction(new Group(), []);
  const clock = new BrowserGameClock();
  clock.start(10000);
  const frames = [11000, 11016, 11032].map((now) => clock.sample(now, true));
  assert.deepEqual(
    frames.map((frame) => frame.endMs),
    [2000, 1032, 1048],
  );
  for (const frame of frames) destruction.update(frame.endMs);
  assert.equal(destruction.timeMs, 1048);
});
