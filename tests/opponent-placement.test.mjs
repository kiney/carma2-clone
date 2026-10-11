import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import {
  NativeOpponentPlacement,
  nativeRematerializationSectionPose,
} from "../src/physics/opponent-placement.ts";
import { NativePathView } from "../src/ai/path-view.ts";
const f = Math.fround;
const close = (a, b, t = 2e-6) =>
  assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);
const sections = [
  {
    nodeIndices: [0, 1],
    width: 1,
    minSpeed: [0, 0],
    maxSpeed: [255, 255],
    type: 0,
    oneWay: false,
  },
];

test("native section placement clamps stored projection and preserves slope orientation", () => {
  const start = new Vector3(0, 0, 0),
    end = new Vector3(0, 5, 10);
  const p = nativeRematerializationSectionPose(
    new Vector3(0, 6, 12),
    start,
    end,
  );
  assert.deepEqual(p.position.toArray(), [0, 5, 10]);
  const z = new Vector3(0, 0, -1).applyQuaternion(p.orientation);
  close(z.dot(end.clone().normalize()), 1);
  assert.equal(
    nativeRematerializationSectionPose(start, start, start),
    undefined,
  );
  assert.throws(
    () =>
      nativeRematerializationSectionPose(
        new Vector3(Infinity, 0, 0),
        start,
        end,
      ),
    /Invalid/,
  );
});

test("native rematerialization binds metric rays through Float32 model scale and real activity", () => {
  const rays = [],
    events = [];
  let physical = false;
  const car = {
    state: {
      position: new Vector3(0, 0, 0),
      orientation: new Quaternion(),
      velocity: new Vector3(),
    },
    group: { visible: false },
    properties: { mass: 1000 },
  };
  const simulation = {
    isCarPhysicsActive: () => physical,
    setCarPhysicsActive: (_car, value) => {
      physical = value;
      events.push(["physical", value]);
    },
    rematerializePose: (_car, p, q, v) => {
      car.state.position.copy(p);
      car.state.orientation.copy(q);
      car.state.velocity.copy(v);
      events.push(["pose", p.toArray()]);
    },
    testCarPlacement: () => -1,
    resetCarSpecialVolume: () => events.push(["volume"]),
  };
  const world = {
    raycast: (origin, dir, length) => {
      rays.push([origin.clone(), dir.clone(), length]);
      return origin.y >= 0
        ? { distance: origin.y, normal: new Vector3(0, 1, 0) }
        : null;
    },
  };
  const nodes = [new Vector3(0, 0, 0), new Vector3(0, 0, 10)];
  const placement = new NativeOpponentPlacement(
    simulation,
    world,
    nodes,
    sections,
  );
  const view = NativePathView.projected(nodes, sections, [
    { section: 0, direction: 1 },
  ]);
  assert.equal(placement.onSection(car, view, 0, 20), 1);
  assert.equal(physical, true);
  assert.equal(car.group.visible, true);
  close(rays[0][0].y, f(1 * f(1 / 6.9)));
  close(rays[0][1].y, f(-100 * f(1 / 6.9)));
  close(rays[0][2], -rays[0][1].y);
  close(car.state.velocity.length(), 10);
  assert.equal(events.at(-1)[0], "volume");
  const before = events.length;
  placement.onSection(car, view, 0, 20);
  assert.equal(
    events.length,
    before,
    "already physical wrapper does not reset pose",
  );
});

test("source vertical traversal honors pling filtering, caret floor and 0x1800 facing flags", async () => {
  const { WorldCollision } = await import("../src/world.ts");
  const {
    Group,
    Mesh,
    MeshBasicMaterial,
    BufferGeometry,
    Float32BufferAttribute,
  } = await import("three");
  const root = new Group();
  const floor = (y, name, flags = 0, down = false) => {
    const material = new MeshBasicMaterial();
    material.name = name;
    material.userData.c2Flags = flags;
    const geo = new BufferGeometry();
    geo.setAttribute(
      "position",
      new Float32BufferAttribute([-2, y, -2, 0, y, 2, 2, y, -2], 3),
    );
    if (down) geo.setIndex([2, 1, 0]);
    const mesh = new Mesh(geo, material);
    root.add(mesh);
    return mesh;
  };
  floor(2, "!water");
  floor(1, ">invisible");
  floor(0, "^void");
  floor(3, "ceiling", 0, true);
  let world = new WorldCollision(root);
  assert.deepEqual(world.nativeYBelow(new Vector3(0, 5, 0)), {
    y: 0,
    materialName: "^void",
  });
  floor(4, "#visible", 0x800, true);
  world = new WorldCollision(root);
  assert.deepEqual(world.nativeYBelow(new Vector3(0, 5, 0)), {
    y: 4,
    materialName: "#visible",
  });
  assert.ok(world.nativeYBelow(new Vector3(20, 5, 0)).y < -100);
  assert.ok(world.nativeYBelow(new Vector3(0, -101, 0)).y < -100);
});
