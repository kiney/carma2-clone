import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { CorrectionWorkingSet } from "../src/physics/correction-working-set.ts";
import { NativeWorldContactCache } from "../src/physics/native-world-contact-cache.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
function fixture() {
  const body = {
    hulls: [],
    state: {
      position: v(),
      orientation: new Quaternion(),
      velocity: v(),
      angularVelocity: v(),
      predictedPosition: v(1),
      predictedOrientation: new Quaternion(),
    },
    properties: {
      centerOfMass: v(),
      mass: 10,
      inertia: v(1, 1, 1),
      worldFriction: 0.5,
    },
  };
  const surface = {
    a: v(),
    b: v(1),
    c: v(0, 0, 1),
    normal: v(0, 1),
    minY: 0,
    maxY: 0,
    material: "road",
    modifier: { wallFriction: 0.7 },
    twoSided: false,
    materialFlags: 0,
    faceFlags: 0,
  };
  const diagnostics = {},
    cache = new NativeWorldContactCache(diagnostics),
    geometry = new CorrectionWorkingSet(),
    center = v();
  let calls = 0,
    recovery = false,
    surfaces = [surface];
  const emit = () => {
    calls++;
    return {
      contacts: [
        { a: body, point: v(), normal: v(0, 1), sourceSurface: surface },
      ],
      overlap: false,
    };
  };
  return {
    body,
    surface,
    surfaces,
    diagnostics,
    cache,
    geometry,
    center,
    get calls() {
      return calls;
    },
    set recovery(value) {
      recovery = value;
    },
    set faces(value) {
      surfaces = value;
    },
    get: (options = {}) =>
      cache.get(
        body,
        geometry.captureGeometry(body, options.cacheable ?? true),
        center,
        recovery,
        surfaces,
        options.emit ?? emit,
      ),
  };
}

test("native world raw emissions reuse unchanged inputs without copying rows", () => {
  const f = fixture(),
    first = f.get();
  assert.equal(f.get(), first);
  assert.equal(f.calls, 1);
  assert.equal(f.diagnostics.nativeWorldEmitTests, 2);
  assert.equal(f.diagnostics.nativeWorldEmitHits, 1);
  assert.equal("normalImpulse" in first.contacts[0], false);
});

test("endpoint geometry changes invalidate while solver-only changes reuse", () => {
  const f = fixture(),
    first = f.get();
  f.body.state.velocity.x = 4;
  f.body.state.angularVelocity.z = 2;
  f.body.properties.inertia.y = 12;
  f.body.properties.worldFriction = 0.2;
  assert.equal(f.get(), first);
  f.body.state.predictedPosition.y = 0.125;
  assert.notEqual(f.get(), first);
  f.body.state.position.x = -0.25;
  f.get();
  f.body.hulls = [...f.body.hulls];
  f.get();
  assert.equal(f.calls, 4);
  assert.equal(f.diagnostics.nativeWorldGeometryInvalidations, 3);
});

test("ordered face identities and mutable face inputs invalidate emission", () => {
  const changes = [
    (s) => (s.a.x += 0.1),
    (s) => (s.b.y += 0.1),
    (s) => (s.c.z += 0.1),
    (s) => (s.normal.x += 0.1),
    (s) => (s.material = "wall"),
    (s) => (s.enabled = false),
    (s) => (s.collisionMode = "edges"),
    (s) => (s.twoSided = true),
    (s) => (s.materialFlags = 2),
    (s) => (s.faceFlags = 4),
    (s) => (s.modifier.wallFriction = 0.25),
    (s) => (s.modifier = { ...s.modifier }),
    (s) => (s.actor = {}),
    (s) => (s.source = {}),
    (s) => (s.native = {}),
  ];
  for (const change of changes) {
    const f = fixture(),
      first = f.get();
    change(f.surface);
    assert.notEqual(f.get(), first);
    assert.equal(f.calls, 2);
    assert.equal(f.diagnostics.nativeWorldFaceInvalidations, 1);
  }
  const f = fixture(),
    second = { ...f.surface };
  f.faces = [f.surface, second];
  const first = f.get();
  f.faces = [second, f.surface];
  assert.notEqual(f.get(), first);
  f.faces = [second];
  f.get();
  f.faces = [{ ...second }];
  f.get();
  assert.equal(f.calls, 4);
});

test("world recovery mode and captured world center are independent dependencies", () => {
  const f = fixture(),
    first = f.get();
  f.recovery = true;
  assert.notEqual(f.get(), first);
  f.center.x = -0;
  f.get();
  f.center.y = 0.25;
  f.get();
  assert.equal(f.calls, 4);
  assert.equal(f.diagnostics.nativeWorldRecoveryInvalidations, 3);
});

test("moving owners and uncertified snapshots fall back and discard old entries", () => {
  const f = fixture();
  f.get();
  f.surface.owner = f.body;
  f.get();
  f.get();
  delete f.surface.owner;
  f.get();
  assert.equal(f.calls, 4);
  f.get({ cacheable: false });
  f.get();
  assert.equal(f.calls, 6);
  assert.equal(f.diagnostics.nativeWorldUncacheableInvalidations, 3);
});

test("empty overlap results retain evidence and cache ownership is tick scoped", () => {
  const f = fixture();
  let emitted = 0;
  const emit = () => {
    emitted++;
    return { contacts: [], overlap: true };
  };
  const first = f.get({ emit });
  assert.equal(f.get({ emit }), first);
  assert.deepEqual(first, { contacts: [], overlap: true });
  new NativeWorldContactCache().get(
    f.body,
    f.geometry.captureGeometry(f.body),
    f.center,
    false,
    f.surfaces,
    emit,
  );
  assert.equal(emitted, 2);
});

test("misses capture face values once and report their primary invalidation cause", () => {
  const f = fixture();
  let reads = 0;
  Object.defineProperty(f.surface.normal, "x", {
    get() {
      reads++;
      return 0;
    },
  });
  f.get();
  assert.equal(reads, 1);
  reads = 0;
  f.body.state.predictedPosition.y += 1;
  f.recovery = true;
  f.surface.faceFlags = 4;
  f.get();
  assert.equal(reads, 1, "geometry miss captures faces without comparing them");
  assert.equal(f.diagnostics.nativeWorldGeometryInvalidations, 1);
  assert.equal(f.diagnostics.nativeWorldRecoveryInvalidations, undefined);
  assert.equal(f.diagnostics.nativeWorldFaceInvalidations, undefined);
  reads = 0;
  f.center.y += 1;
  f.surface.faceFlags = 8;
  f.get();
  assert.equal(reads, 1, "recovery miss captures faces without comparing them");
  assert.equal(f.diagnostics.nativeWorldRecoveryInvalidations, 1);
  assert.equal(f.diagnostics.nativeWorldFaceInvalidations, undefined);
  reads = 0;
  f.surface.faceFlags = 16;
  f.get();
  assert.equal(reads, 1, "face miss compares and captures in a single walk");
  assert.equal(f.diagnostics.nativeWorldFaceInvalidations, 1);
  assert.equal(f.get(), f.get());
});
