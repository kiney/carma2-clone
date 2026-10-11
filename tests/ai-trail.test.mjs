import assert from "node:assert/strict";
import test from "node:test";
import { Vector3 } from "three";
import { NativeOpponentTrail, nativeTrailSideOffset } from "../src/ai/trail.ts";

const v = (x, y, z) => new Vector3(x, y, z);
const f = Math.fround;

test("installed first side preserves its sign and stored-length normalizer", () => {
  const side = nativeTrailSideOffset(v(0, 0, 0), v(1, 0, 3));
  assert.deepEqual(
    side.toArray(),
    [0.47434163093566895, 0, -0.15811388194561005],
  );
  assert.notEqual(side.x, f((3 / Math.sqrt(10)) * 0.5));
  assert.deepEqual(
    nativeTrailSideOffset(v(0, 0, 0), v(0, 8, 0)).toArray(),
    [0.5, 0, 0],
  );
  assert.deepEqual(
    nativeTrailSideOffset(v(0, 0, 0), v(2 ** -22, 0, 0)).toArray(),
    [0.5, 0, 0],
  );
  assert.equal(nativeTrailSideOffset(v(0, 0, 0), v(2 ** -21, 0, 0)).z, -0.5);
});

test("start seeds two Float32 nodes, heading, and a wrapped 500ms deadline", () => {
  const trail = new NativeOpponentTrail();
  const initial = trail.start(v(1.1, 2.2, 3.3), v(0, 0, 1), 0xffffff00);
  assert.equal(initial.nodes.length, 2);
  assert.deepEqual(initial.nodes[0].toArray(), [
    f(1.1),
    f(2.2),
    f(f(3.3) + f(0.2)),
  ]);
  assert.deepEqual(initial.nodes[1].toArray(), [f(1.1), f(2.2), f(3.3)]);
  assert.deepEqual(initial.baseHeading.toArray(), [0, 0, 1]);
  assert.equal(initial.nextRecordingMs, (0xffffff00 + 500) >>> 0);
  assert.equal(initial.recordingCount, 1);

  const attached = trail.start(v(99, 99, 99), v(1, 0, 0), 5000);
  assert.equal(attached.recordingCount, 2);
  assert.deepEqual(attached.nodes[1].toArray(), initial.nodes[1].toArray());
  assert.deepEqual(
    attached.baseHeading.toArray(),
    initial.baseHeading.toArray(),
  );
});

test("sampling is strictly after deadline and resets deadline from current time", () => {
  const trail = new NativeOpponentTrail();
  trail.start(v(0, 0, -0.2), v(1, 0, 0), 100);
  let rays = 0;
  const same = trail.record(v(0.1, 0, 0), v(1, 0, 0), 600, () => {
    rays++;
    return true;
  });
  assert.equal(same.sampled, false);
  assert.equal(same.snapshot.nextRecordingMs, 600);
  assert.equal(rays, 0);

  const later = trail.record(v(0.1, 0, 0), v(1, 0, 0), 601, () => {
    rays++;
    return true;
  });
  assert.equal(later.sampled, true);
  assert.equal(later.snapshot.nextRecordingMs, 1101);
  assert.equal(rays, 0, "short distance exits before visibility probes");
});

test("short-distance early return preserves the previous moving tail node", () => {
  const trail = new NativeOpponentTrail();
  trail.start(v(0, 0, 0), v(1, 0, 0), 0);
  const before = trail.snapshot.nodes[1].clone();
  const result = trail.record(v(0.1, 0, 0), v(1, 0, 0), 501, () => true);
  assert.equal(result.distance, f(Math.sqrt(0.1 ** 2 + 0.2 ** 2)));
  assert.equal(result.added, false);
  assert.deepEqual(result.snapshot.nodes[1].toArray(), before.toArray());
});

test("exact 0.3 spacing is sampled rather than taking the strict short return", () => {
  const trail = new NativeOpponentTrail();
  trail.start(v(0, 0, -0.2), v(1, 0, 0), 0);
  let rayCalls = 0;
  const result = trail.record(v(f(0.3), 0, 0), v(1, 0, 0), 501, () => {
    rayCalls++;
    return true;
  });
  assert.equal(result.distance, f(0.3));
  assert.equal(
    rayCalls,
    3,
    "length == 0.3 does not satisfy native length < 0.3",
  );
  assert.equal(result.added, false);
  assert.deepEqual(result.snapshot.nodes[1].toArray(), [f(0.3), 0, 0]);
});

test("live mixed-precision length decides the 0.3 early gate before its F32 store", () => {
  const trail = new NativeOpponentTrail();
  trail.start(v(0, 0, 0), v(1, 0, 0), 0);
  const xDelta = f(0.3) - 2 ** -25;
  const y = f(0.0001);
  const dx = xDelta;
  const dy = -y;
  const liveLength = Math.sqrt(dx * f(dx) + dy * f(dy));
  assert.ok(liveLength < f(0.3));
  assert.equal(f(liveLength), f(0.3));

  let rays = 0;
  const result = trail.record(v(-xDelta, y, f(0.2)), v(1, 0, 0), 501, () => {
    rays++;
    return true;
  });
  assert.equal(result.distance, f(0.3));
  assert.equal(
    rays,
    0,
    "the native early gate uses live length, not its F32 copy",
  );
  assert.deepEqual(result.snapshot.nodes[1].toArray(), [0, 0, 0]);
});

test("heading deviation uses strict native cosine threshold and resets on append", () => {
  const trail = new NativeOpponentTrail();
  trail.start(v(0, 0, 0), v(0, 0, 1), 0);
  const boundary = new Vector3(
    Math.sqrt(1 - 0.8660249710083008 ** 2),
    0,
    0.8660249710083008,
  );
  const equal = trail.record(v(0, 0, 2.5), boundary, 501, () => true);
  assert.equal(equal.snapshot.deviated, false);
  assert.equal(equal.added, false, "exact cosine boundary is not deviation");

  const deviant = trail.record(v(0, 0, 5), v(1, 0, 0), 1002);
  assert.equal(deviant.visible, true, "deviation bypasses visibility rays");
  assert.equal(deviant.added, true);
  assert.equal(deviant.snapshot.deviated, false);
  assert.deepEqual(deviant.snapshot.baseHeading.toArray(), [1, 0, 0]);
});

test("Float32 heading-dot store preserves threshold equality before comparison", () => {
  const base = v(0.4632044732570648, -0.5961841344833374, 0.6557484865188599);
  const heading = v(
    0.40114665031433105,
    -0.1463535875082016,
    0.9042466282844543,
  );
  const liveDot =
    f(heading.z) * f(base.z) +
    f(heading.y) * f(base.y) +
    f(heading.x) * f(base.x);
  assert.ok(liveDot < 0.8660249710083008);
  assert.equal(f(liveDot), 0.8660249710083008);

  const trail = new NativeOpponentTrail();
  trail.start(v(0, 0, 0), base, 0);
  const equality = trail.record(v(3, 0, 0), heading, 501, () => true);
  assert.equal(equality.snapshot.deviated, false);
  assert.equal(equality.added, false);

  const below = v(heading.x, heading.y, f(heading.z - 2 ** -24));
  const lower = trail.record(v(6, 0, 0), below, 1002);
  assert.equal(
    lower.snapshot.deviated,
    false,
    "deviation clears after the authored node append",
  );
  assert.equal(lower.added, true);
  assert.equal(lower.snapshot.nodes.length, 3);
  assert.deepEqual(lower.snapshot.baseHeading.toArray(), below.toArray());
});

test("trail visibility requires all three clear probes and stops at first blocked ray", () => {
  for (const blockedProbe of [undefined, 0, 1, 2]) {
    const trail = new NativeOpponentTrail();
    trail.start(v(0, 0, -0.2), v(1, 0, 0), 0);
    const calls = [];
    const result = trail.record(v(3, 0, 0), v(1, 0, 0), 501, (from, to) => {
      calls.push([from.clone(), to.clone()]);
      return calls.length - 1 !== blockedProbe;
    });

    const expectedCalls = blockedProbe === undefined ? 3 : blockedProbe + 1;
    assert.equal(calls.length, expectedCalls);
    assert.equal(result.visible, blockedProbe === undefined);
    assert.equal(result.added, blockedProbe !== undefined);
    assert.equal(
      result.snapshot.nodes.length,
      blockedProbe === undefined ? 2 : 3,
      "blocked rays use the native >1.5 spacing rule",
    );
    assert.deepEqual(calls[0][0].toArray(), [0, 0, -0.5]);
    assert.deepEqual(calls[0][1].toArray(), [3, 0, -0.5]);
    if (expectedCalls >= 2) {
      assert.deepEqual(calls[1][0].toArray(), [0, 0, 0.5]);
      assert.deepEqual(calls[1][1].toArray(), [3, 0, 0.5]);
    }
    if (expectedCalls === 3) {
      assert.deepEqual(calls[2][0].toArray(), [0, 0, 0]);
      assert.deepEqual(calls[2][1].toArray(), [3, 0, 0]);
    }
  }
});

test("the first blocked probe appends only beyond the strict 1.5 distance", () => {
  const trail = new NativeOpponentTrail();
  trail.start(v(0, 0, 0), v(1, 0, 0), 0);
  let calls = 0;
  const exact = trail.record(v(1.5, 0, 0.2), v(1, 0, 0), 501, () => {
    calls++;
    return false;
  });
  assert.equal(exact.distance, 1.5);
  assert.equal(exact.added, false);
  assert.equal(calls, 1);

  calls = 0;
  const beyond = trail.record(v(3.01, 0, 0.2), v(1, 0, 0), 1002, () => {
    calls++;
    return false;
  });
  assert.equal(beyond.added, true);
  assert.equal(calls, 1);
  assert.equal(beyond.snapshot.nodes.length, 3);
  assert.deepEqual(beyond.snapshot.nodes[2].toArray(), [f(3.01), 0, f(0.2)]);
});

test("full trail shifts exactly one node and marks only that frame", () => {
  const trail = new NativeOpponentTrail();
  trail.start(v(0, 0, 0), v(1, 0, 0), 0);
  let now = 501;
  for (let index = 1; index <= 23; index++) {
    const direction = index % 2 ? v(-1, 0, 0) : v(1, 0, 0);
    const result = trail.record(v(index * 3, 0, 0), direction, now);
    assert.equal(result.added, true);
    assert.equal(result.snapshot.shiftedThisFrame, false);
    now += 501;
  }
  assert.equal(trail.snapshot.nodes.length, 25);
  const before = trail.snapshot.nodes.map((node) => node.clone());
  const shifted = trail.record(v(72, 0, 0), v(1, 0, 0), now);
  assert.equal(shifted.added, true);
  assert.equal(shifted.snapshot.shiftedThisFrame, true);
  assert.equal(shifted.snapshot.nodes.length, 25);
  assert.deepEqual(shifted.snapshot.nodes[0].toArray(), before[1].toArray());
  assert.deepEqual(shifted.snapshot.nodes[24].toArray(), [72, 0, 0]);

  const noSample = trail.record(v(72, 0, 0), v(1, 0, 0), now + 1);
  assert.equal(noSample.snapshot.shiftedThisFrame, false);
});

test("a visible deviated trail requires strict distance greater than two", () => {
  const trail = new NativeOpponentTrail();
  trail.start(v(0, 0, 0), v(1, 0, 0), 0);
  const equal = trail.record(v(2, 0, 0.2), v(-1, 0, 0), 501);
  assert.equal(equal.visible, true);
  assert.equal(equal.distance, 2);
  assert.equal(equal.added, false);
  assert.equal(equal.snapshot.deviated, true);
  const beyond = trail.record(v(4.01, 0, 0.2), v(-1, 0, 0), 1002);
  assert.equal(beyond.added, true);
  assert.equal(beyond.visible, true);
  assert.equal(beyond.snapshot.deviated, false);
});
