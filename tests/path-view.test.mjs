import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { NativePathView } from "../src/ai/path-view.ts";
import {
  getPathEndpointSpeed,
  getStraightPathGeometry,
} from "../src/ai/path-geometry.ts";

const point = (x, y = 0, z = 0) => new Vector3(x, y, z);
const section = (nodeIndices, options = {}) => ({
  nodeIndices,
  minSpeed: options.minSpeed ?? [0, 0],
  maxSpeed: options.maxSpeed ?? [255, 255],
  width: options.width ?? 1,
  type: options.type ?? 0,
  oneWay: false,
});

test("direct pursuit exposes only native identifier 10000", () => {
  const view = NativePathView.direct(point(0), point(0, 0, 12));

  assert.equal(view.nativeId(0), 10000);
  assert.equal(view.localSlot(10000), 0);
  assert.equal(view.next(10000), -1);
  assert.throws(() => view.localSlot(10001), /identifier/);
  assert.throws(() => view.next(10001), /identifier/);

  const geometry = getStraightPathGeometry(
    view.nodes,
    view.sections,
    view.route,
  );
  assert.deepEqual(geometry.start.toArray(), [0, 0]);
  assert.deepEqual(geometry.finish.toArray(), [12, 0]);
  assert.equal(geometry.width, 0.5);
  assert.equal(geometry.nextSlot, -1);
});

test("trail identifiers traverse virtual segments and feed native geometry", () => {
  const view = NativePathView.trail([
    point(0),
    point(0, 0, 10),
    point(0, 0, 20),
    point(8, 0, 30),
  ]);

  assert.deepEqual(
    [0, 1, 2].map((slot) => view.nativeId(slot)),
    [15000, 15001, 15002],
  );
  assert.deepEqual(
    [15000, 15001, 15002].map((id) => view.next(id)),
    [15001, 15002, -1],
  );
  assert.equal(view.next(15000), 15001);
  assert.deepEqual(
    view.sections.map((entry) => entry.nodeIndices),
    [
      [0, 1],
      [1, 2],
      [2, 3],
    ],
  );
  assert.deepEqual(
    view.sections.map((entry) => entry.width),
    [0.5, 0.5, 0.5],
  );
  assert.deepEqual(
    view.sections.map((entry) => entry.minSpeed),
    [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
  );
  assert.deepEqual(
    view.sections.map((entry) => entry.maxSpeed),
    [
      [255, 255],
      [255, 255],
      [255, 255],
    ],
  );

  // The first two virtual sections are collinear, so the actual path geometry
  // joins them; the turn at the third node remains the next slot.
  const straight = getStraightPathGeometry(
    view.nodes,
    view.sections,
    view.route,
  );
  assert.deepEqual(straight.start.toArray(), [0, 0]);
  assert.deepEqual(straight.finish.toArray(), [20, 0]);
  assert.equal(straight.width, 0.5);
  assert.equal(straight.nextSlot, 2);
  assert.equal(getPathEndpointSpeed(view.sections[0], 1, true, "max"), 255);
  assert.equal(getPathEndpointSpeed(view.sections[0], 1, true, "min"), 0);
});

test("projected view preserves global-slot type-2 lookup and cheat bypass", () => {
  const nodes = [point(0), point(0, 0, 10), point(0, 0, 20)];
  const sections = [
    section([0, 1]),
    section([0, 1], { type: 2 }),
    section([1, 2]),
  ];
  // Both actual route entries refer to ordinary type-0 sections. Native
  // GetNext nevertheless checks sections[routeSlot], where slot 1 is type 2.
  const route = [
    { section: 0, direction: 1 },
    { section: 2, direction: 1 },
  ];
  const view = NativePathView.projected(nodes, sections, route);

  assert.equal(view.nativeId(0), 20000);
  assert.equal(view.next(20000), -1);
  assert.equal(view.next(20000, true), 20001);

  const ordinary = getStraightPathGeometry(
    view.nodes,
    view.sections,
    view.route,
  );
  const cheating = getStraightPathGeometry(
    view.nodes,
    view.sections,
    view.route,
    0,
    true,
  );
  assert.deepEqual(ordinary.finish.toArray(), [10, 0]);
  assert.equal(ordinary.nextSlot, -1);
  assert.deepEqual(cheating.finish.toArray(), [20, 0]);
  assert.equal(cheating.nextSlot, -1);
});

test("path view validates namespaces, local slots, capacity and Float32 nodes", () => {
  const trail = NativePathView.trail([point(0), point(1), point(2)]);
  assert.throws(() => trail.localSlot(10000), /identifier/);
  assert.throws(() => trail.localSlot(15002), /identifier/);
  assert.throws(() => trail.nativeId(-1), /identifier/);
  assert.throws(() => trail.next(15000.5), /identifier/);
  assert.throws(() => NativePathView.trail([point(0)]), /node count/);
  assert.throws(
    () => NativePathView.trail(Array.from({ length: 26 }, (_, i) => point(i))),
    /node count/,
  );
  assert.throws(
    () => NativePathView.trail([point(0), point(Number.MAX_VALUE)]),
    /virtual path node/,
  );

  const route = Array.from({ length: 13 }, (_, section) => ({
    section,
    direction: 1,
  }));
  const sections = Array.from({ length: 13 }, () => section([0, 1]));
  assert.throws(
    () => NativePathView.projected([point(0), point(1)], sections, route),
    /capacity/,
  );
  assert.throws(
    () =>
      NativePathView.projected([point(0), point(1)], sections, []).nativeId(0),
    /identifier/,
  );
});
