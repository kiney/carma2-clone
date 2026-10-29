import assert from "node:assert/strict";
import test from "node:test";
import { Quaternion, Vector3 } from "three";
import {
  processOrdinaryPedVolume,
  activateImmersedOrdinaryPed,
  moveOrdinaryPedInVolume,
  ordinaryPedInitialVolumeOmega,
} from "../src/ped-ordinary-volume.ts";

const f = Math.fround;
function fixture() {
  const processStorage = new Uint8Array(0x12c),
    view = new DataView(processStorage.buffer),
    body = {
      state: {
        velocity: new Vector3(),
        angularVelocity: new Vector3(),
        orientation: new Quaternion(),
      },
      specialVolume: { volume: { gravityMultiplier: 0.5 }, depth: 1 },
    },
    input = {
      body,
      processStorage,
      hitPoints: 100,
      moveId: 30,
      timeMs: 1000,
      replay: false,
      physicsActive: false,
      globalGravity: 1,
    },
    events = [],
    host = {
      setMove: (request) => events.push(["move", request]) && undefined,
      kill: () => events.push(["kill"]) && undefined,
      clearBurning: (value) =>
        events.push(["clear-burning", value]) && undefined,
      stopSmoothTurn: () => events.push(["stop-turn"]) && undefined,
      activate: () => events.push(["activate"]) && undefined,
      nextCrtInteger: () => {
        events.push(["draw"]);
        return 0;
      },
    };
  return { input, host, body, view, events };
}
function sequence(values) {
  let offset = 0;
  return {
    draw() {
      assert.ok(offset < values.length, "unexpected CRT draw");
      return values[offset++];
    },
    get used() {
      return offset;
    },
  };
}

test("outer selected low-gravity volume clears actual burning owner before timer and move110", () => {
  const { input, host, view, events } = fixture();
  view.setInt32(0x98, 9000, true);
  assert.equal(processOrdinaryPedVolume(input, host).status, "complete");
  assert.equal(view.getUint32(0x94, true), 1000);
  assert.equal(view.getInt32(0x98, true), 0);
  assert.deepEqual(events, [
    ["clear-burning", 9000],
    [
      "move",
      { id: 110, speed: -1, completion: false, action: 5, timeMs: 1000 },
    ],
  ]);
});

test("outer timeout is strict30000ms, unsigned across wrap, and selects110 before full kill", () => {
  for (const start of [1000, 0xfffffff0]) {
    const { input, host, view, events } = fixture();
    view.setUint32(0x94, start, true);
    input.timeMs = (start + 30000) >>> 0;
    input.moveId = 110;
    assert.equal(processOrdinaryPedVolume(input, host).status, "complete");
    assert.deepEqual(events, []);
    input.timeMs = (start + 30001) >>> 0;
    input.moveId = 30;
    processOrdinaryPedVolume(input, host);
    assert.deepEqual(
      events.map((event) => event[0]),
      ["move", "kill"],
    );
  }
});

test("outer timer uses source zero sentinel and resets on leaving selected low gravity", () => {
  const { input, host, view, body, events } = fixture();
  input.timeMs = 0;
  input.moveId = 110;
  processOrdinaryPedVolume(input, host);
  assert.equal(view.getUint32(0x94, true), 0);
  input.timeMs = 123;
  processOrdinaryPedVolume(input, host);
  assert.equal(view.getUint32(0x94, true), 123);
  body.specialVolume = {
    volume: null,
    automatic: { gravityMultiplier: 0.1 },
    depth: 0.5,
  };
  processOrdinaryPedVolume(input, host);
  assert.equal(view.getUint32(0x94, true), 0);
  assert.deepEqual(events, []);
});

test("outer living volume state is independent of depth, global gravity and active physics", () => {
  const { input, host, view, body, events } = fixture();
  input.physicsActive = true;
  input.globalGravity = 2;
  body.specialVolume.depth = 0;
  processOrdinaryPedVolume(input, host);
  assert.equal(view.getUint32(0x94, true), 1000);
  assert.equal(events[0][1].id, 110);
});

test("outer corpse selects94 without repeated kill or another same-move selection", () => {
  const { input, host, view, events } = fixture();
  input.hitPoints = -1;
  view.setUint32(0x94, 1, true);
  input.timeMs = 90000;
  processOrdinaryPedVolume(input, host);
  assert.deepEqual(
    events.map((event) => event[0]),
    ["move"],
  );
  assert.equal(events[0][1].id, 94);
  input.moveId = 94;
  events.length = 0;
  processOrdinaryPedVolume(input, host);
  assert.deepEqual(events, []);
});

test("replay leaves outer volume timer, burning and all effects untouched", () => {
  const { input, host, view, events } = fixture();
  input.replay = true;
  view.setUint32(0x94, 11, true);
  view.setInt32(0x98, -2, true);
  assert.equal(processOrdinaryPedVolume(input, host).status, "complete");
  assert.equal(activateImmersedOrdinaryPed(input, host).randomDraws, 0);
  assert.equal(view.getUint32(0x94, true), 11);
  assert.equal(view.getInt32(0x98, true), -2);
  assert.deepEqual(events, []);
});

test("missing outer actual providers reject before timer mutation or effect dispatch", () => {
  const { input, view, events } = fixture();
  view.setUint32(0x94, 1, true);
  view.setInt32(0x98, -2, true);
  input.timeMs = 40000;
  const r = processOrdinaryPedVolume(input, {});
  assert.deepEqual(r.requiredProviders, [
    "source-ped-volume-burning-resource-owner",
    "source-ped-volume-move-owner",
    "source-ped-volume-kill-owner",
  ]);
  assert.equal(view.getUint32(0x94, true), 1);
  assert.equal(view.getInt32(0x98, true), -2);
  assert.deepEqual(events, []);
});

test("immersed passive activation stops smooth turn then activates then draws exactly3", () => {
  const { input, host, body, view, events } = fixture();
  input.hitPoints = 0;
  view.setUint32(0x6c, 777, true);
  const r = activateImmersedOrdinaryPed(input, host);
  assert.equal(r.status, "complete");
  assert.equal(r.randomDraws, 3);
  assert.equal(view.getUint32(0x6c, true), 0);
  assert.deepEqual(
    events.map((event) => event[0]),
    ["stop-turn", "activate", "draw", "draw", "draw"],
  );
  // Installed successive scale expressions do not produce a unit-normalized vector.
  assert.deepEqual(
    body.state.angularVelocity.toArray(),
    ordinaryPedInitialVolumeOmega([-1, -1, -1]),
  );
});

test("immersed activation requires exact depth1/global gravity1 and an inactive nonreplay body", () => {
  for (const change of [
    (input) => {
      input.physicsActive = true;
    },
    (input) => {
      input.globalGravity = 0.5;
    },
    (input) => {
      input.body.specialVolume.depth = f(1 - 2 ** -24);
    },
    (input) => {
      input.body.specialVolume.volume.gravityMultiplier = 1;
    },
    (input) => {
      input.replay = true;
    },
  ]) {
    const { input, host, events, body } = fixture();
    body.state.angularVelocity.set(1, 2, 3);
    change(input);
    assert.equal(activateImmersedOrdinaryPed(input, host).randomDraws, 0);
    assert.deepEqual(body.state.angularVelocity.toArray(), [1, 2, 3]);
    assert.deepEqual(events, []);
  }
});

test("initial source sequential normalization has independent numerical reference values", () => {
  assert.deepEqual(
    ordinaryPedInitialVolumeOmega([0.5, -0.5, 0.25]),
    [1.3333333730697632, -0.6916685104370117, 0.3283592760562897],
  );
  assert.deepEqual(
    ordinaryPedInitialVolumeOmega([-1, 0.25, 0.75]),
    [-1.5689290761947632, 0.28459951281547546, 0.8512516617774963],
  );
  assert.deepEqual(ordinaryPedInitialVolumeOmega([0, 0, 0.5]), [0, 0, 2]);
  assert.equal(ordinaryPedInitialVolumeOmega([0, 0, 0]), null);
});

test("all-zero initial CRT triple explicitly reports native0/0 singularity and stays finite", () => {
  const { input, host, body } = fixture(),
    crt = sequence([16384, 16384, 16384]);
  host.nextCrtInteger = () => crt.draw();
  const r = activateImmersedOrdinaryPed(input, host);
  assert.equal(r.randomDraws, 3);
  assert.deepEqual(r.requiredProviders, [
    "native-immersed-ped-omega-singularity-suppressed",
  ]);
  assert.deepEqual(body.state.angularVelocity.toArray(), [0, 0, 0]);
});

test("moved low-gravity additions consume ordered XYZ SFRand5 then vertical FRand−.3", () => {
  const { body } = fixture(),
    crt = sequence([0, 16384, 32767, 32767]);
  body.specialVolume.depth = 0.5;
  body.state.angularVelocity.set(0.25, 0, -0.25);
  const r = moveOrdinaryPedInVolume(body, 100, () => crt.draw());
  assert.equal(r.randomDraws, 4);
  assert.equal(crt.used, 4);
  assert.deepEqual(
    body.state.angularVelocity.toArray(),
    [-4.75, 0, 4.74969482421875],
  );
  assert.equal(body.state.velocity.y, f((f(-0.3) * 32767) / 32768));
});

test("moved angular additions use body coordinates under a rotated physical root", () => {
  const { body } = fixture(),
    crt = sequence([0, 16384, 16384]);
  body.state.orientation.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
  const r = moveOrdinaryPedInVolume(body, 100, () => crt.draw());
  assert.equal(r.randomDraws, 3);
  assert.ok(Math.abs(body.state.angularVelocity.x) < 1e-12);
  assert.equal(body.state.angularVelocity.y, -5);
  assert.equal(body.state.angularVelocity.z, 0);
});

test("moved strict magnitude/depth/VY gates preserve source CRT consumption", () => {
  const { body } = fixture();
  body.state.angularVelocity.set(1, 0, 0);
  const noDraw = () => assert.fail("unexpected CRT draw");
  assert.equal(moveOrdinaryPedInVolume(body, 100, noDraw).randomDraws, 0);
  body.specialVolume.depth = 0.5;
  body.state.velocity.y = f(-0.020000002);
  assert.equal(moveOrdinaryPedInVolume(body, 100, noDraw).randomDraws, 0);
  // Float32(-.02) is above the installed double(-.02), so it DOES draw.
  body.state.velocity.y = f(-0.02);
  const crt = sequence([0]);
  assert.equal(
    moveOrdinaryPedInVolume(body, 100, () => crt.draw()).randomDraws,
    1,
  );
});

test("moved dead HP, absent selected volume and gravity1 consume no draws or velocity writes", () => {
  for (const change of [
    (body) => {
      body.specialVolume.volume = null;
    },
    (body) => {
      body.specialVolume.volume.gravityMultiplier = 1;
    },
    () => {},
  ]) {
    const { body } = fixture();
    body.specialVolume.depth = 0;
    body.state.velocity.set(1, 2, 3);
    change(body);
    const hp = body.specialVolume.volume?.gravityMultiplier === 0.5 ? 0 : 100;
    assert.equal(
      moveOrdinaryPedInVolume(body, hp, () => assert.fail("draw")).randomDraws,
      0,
    );
    assert.deepEqual(body.state.velocity.toArray(), [1, 2, 3]);
    assert.deepEqual(body.state.angularVelocity.toArray(), [0, 0, 0]);
  }
});

test("failed activation or missing effect providers consume no initial random samples", () => {
  const { input, host, events } = fixture();
  assert.equal(
    activateImmersedOrdinaryPed(input, {}).status,
    "provider-required",
  );
  assert.deepEqual(events, []);
  host.activate = () => ["source-native-activation-unavailable"];
  const r = activateImmersedOrdinaryPed(input, host);
  assert.deepEqual(r.requiredProviders, [
    "source-native-activation-unavailable",
  ]);
  assert.equal(r.randomDraws, 0);
  assert.deepEqual(
    events.map((event) => event[0]),
    ["stop-turn"],
  );
});
