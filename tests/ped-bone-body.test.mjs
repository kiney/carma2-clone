import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import {
  nativePedBoneShape,
  nativePedBoneMassProperties,
  createNativePedBoneBody,
  registerNativePedBoneBody,
  commitNativePedBoneBody,
} from "../src/physics/ped-bone-body.ts";
import { createAssetStore } from "../server/assets.mjs";
import { Assets } from "../src/content.ts";
import { loadNativePedAssets } from "../src/ped-native-assets.ts";

const f = Math.fround;
const nativePose = [0, 1, 0, -1, 0, 0, 0, 0, 1, 4, 5, 6];
function request(extra = {}) {
  return {
    index: 1,
    slot: 3,
    bone: { name: "HEAD", massKg: 4, mass: f(0.004), collisionType: "BOX" },
    snapshot: {
      actor: new Group(),
      model: { name: "actual-current-head" },
      nativePose,
      bounds: { min: [-1, 2, -3], max: [1, 6, 3] },
    },
    rigidType: 5,
    filterA: 0x40000,
    filterB: 0x50000,
    localOmega: [1, 2, 3],
    activation: {
      velocity: [12, 13, 14],
      gravity: 1,
      clearProperties: [3, 4, 5],
      clearDoNothing: true,
      enableHalt: true,
    },
    clearParentJoint: true,
    clearChildren: true,
    clearLink188: true,
    ...extra,
  };
}
function create(r = request(), extra = {}) {
  return createNativePedBoneBody({
    request: r,
    owner: {},
    levelOut: 0.3,
    retained: { collisionFlags: 0x80000041, objectFriction: 0.7 },
    ...extra,
  });
}
const accepts = { supportsShape: () => true, registerImmediate: () => 0 };

test("current ACT/model identity, FORM bone mass and MODEL .025 moments remain independent of intact body", () => {
  const r = request(),
    body = create(r);
  assert.equal(body.actor, r.snapshot.actor);
  assert.equal(body.model, r.snapshot.model);
  assert.equal(body.properties.mass, f(0.004));
  assert.deepEqual(body.state.position.toArray(), [4, 5, 6]);
  assert.deepEqual(
    new Vector3(1, 0, 0)
      .applyQuaternion(body.state.orientation)
      .toArray()
      .map((v) => Math.round(v)),
    [0, 1, 0],
  );
  assert.deepEqual(body.properties.centerOfMass.toArray(), [0, 4, 0]);
  assert.deepEqual(body.properties.inertia.toArray(), [
    f(f(0.004) * 52 * f(0.025)),
    f(f(0.004) * 40 * f(0.025)),
    f(f(0.004) * 20 * f(0.025)),
  ]);
  assert.equal(body.properties.worldFriction, 1);
  assert.equal(body.properties.objectFriction, f(0.7));
  assert.equal(body.radiusSquared, 46); // farthest corner from MODEL origin, not COM
  assert.equal(body.hulls[0], body.shape.hull);
  assert.deepEqual(body.state.velocity.toArray(), [0, 0, 0]);
  assert.equal(body.headerState, 0);
  assert.equal(body.filterA, null);
  assert.equal(body.subindex, 0);
  assert.equal(r.snapshot.actor.userData.dynamicBody, undefined);
});

test("inertia preserves installed x87 square spills instead of uniformly rounding products", () => {
  const dims = [f(0.0789), f(0.12345), f(0.00009)],
    mass = f(0.003);
  const actual = nativePedBoneMassProperties(mass, {
    min: [0, 0, 0],
    max: dims,
  });
  const [x, y, z] = dims;
  assert.deepEqual(actual.inertia.toArray(), [
    f(mass * (z * z + f(y * y)) * f(0.025)),
    f(mass * (z * z + f(x * x)) * f(0.025)),
    f(mass * (y * y + f(x * x)) * f(0.025)),
  ]);
  const bits = (n) => new Uint32Array(new Float32Array([n]).buffer)[0];
  assert.equal(bits(actual.inertia.x), 0x359968f4);
  assert.equal(bits(f(mass * f(f(z * z) + f(y * y)) * f(0.025))), 0x359968f5);
});

test("SPHERE uses mean MODEL diameter and common MODEL box inertia, never a substituted BOX", () => {
  const r = request();
  r.bone.collisionType = "SPHERE";
  const body = create(r),
    radius = f(12 * f(1 / 6));
  assert.equal(body.shape.type, "SPHERE");
  assert.equal(body.shape.radius, radius);
  assert.deepEqual(body.shape.center, [0, 4, 0]);
  assert.deepEqual(body.shape.bounds, { min: [-2, 2, -2], max: [2, 6, 2] });
  assert.deepEqual(body.hulls, []);
  assert.deepEqual(
    body.properties.inertia.toArray(),
    create().properties.inertia.toArray(),
  );
  assert.throws(
    () =>
      registerNativePedBoneBody(body, {
        ...accepts,
        supportsShape: (s) => s.type === "BOX",
      }),
    /SPHERE.*provider/,
  );
  assert.equal(body.registered, false);
});

test("LINE selects first strict maximum axis and authored midpoint endpoints, with zero thickness", () => {
  const shape = nativePedBoneShape("LINE", {
    min: [-2, -4, 5],
    max: [2, 0, 6],
  });
  assert.deepEqual(shape.endpoints, [
    [-2, -2, 5.5],
    [2, -2, 5.5],
  ]);
  assert.deepEqual(shape.edge, [0, 1]);
  assert.deepEqual(shape.bounds, { min: [-2, -2, 5.5], max: [2, -2, 5.5] });
  const r = request();
  r.bone.collisionType = "LINE";
  const body = create(r);
  assert.equal(body.shape.type, "LINE");
  assert.deepEqual(body.hulls, []);
});

test("immediate PHIL failure stops properties and filters after preparing body", () => {
  for (const code of [1, 2, 3]) {
    const body = create(),
      log = [];
    const result = registerNativePedBoneBody(body, {
      supportsShape: () => true,
      registerImmediate: (b) => {
        assert.equal(b.headerState, 0);
        assert.equal(b.filterA, null);
        assert.equal(b.collisionFlags, 0x80000041);
        assert.deepEqual(b.state.velocity.toArray(), [0, 0, 0]);
        return code;
      },
      onProperty: (...args) => log.push(args),
    });
    assert.deepEqual(result, { accepted: false, code });
    assert.deepEqual(log, []);
    assert.equal(body.registered, false);
    assert.equal(body.filterB, null);
  }
});

test("sever extra1 makes passive property3 false, ordered properties then installed type5 masks", () => {
  const body = create(),
    log = [];
  assert.deepEqual(
    registerNativePedBoneBody(body, {
      ...accepts,
      onProperty: (b, index, value) => {
        assert.equal(b.filterA, null);
        log.push([index, value]);
      },
    }),
    { accepted: true, code: 0 },
  );
  assert.deepEqual(log, [
    [0, 1],
    [3, 0],
    [4, 1],
    [5, 1],
    [7, 1],
    [8, f(0.3)],
    [6, 1],
  ]);
  assert.equal(body.collisionFlags, 0x80000039);
  assert.equal(body.headerFlags, 12);
  assert.equal(body.headerState, 1);
  assert.equal(body.doNothing, true);
  assert.equal(body.haltCallbackEnabled, true);
  assert.equal(body.suppressWorldFaces, false);
  assert.equal(body.suppressSelfSentinel, true);
  assert.equal(body.suppressJointConstraints, true);
  assert.equal(body.waterPlaneD, 10000);
  assert.equal(body.filterA, 0x40000);
  assert.equal(body.filterB, 0x50000);
});

test("post-mask unlink precedes activation; raw world V and BODY omega transform without 6.9 scaling", () => {
  const r = request(),
    body = create(r),
    log = [];
  registerNativePedBoneBody(body, accepts);
  commitNativePedBoneBody(r, body, {
    unlink: (b) => {
      log.push("unlink");
      assert.equal(b.doNothing, true);
    },
    activate: (b) => {
      log.push("activate");
      assert.equal(b.doNothing, false);
      assert.equal(b.suppressSelfSentinel, true);
      assert.equal(b.headerState, 1);
      assert.deepEqual(b.state.velocity.toArray(), [12, 13, 14]);
    },
    onProperty: (_, index, value) => log.push([index, value]),
  });
  assert.deepEqual(log, ["unlink", "activate", [0, 1], [3, 0], [4, 0], [5, 0]]);
  assert.deepEqual(body.localOmega.toArray(), [1, 2, 3]);
  assert.deepEqual(body.state.angularVelocity.toArray(), [-2, 1, 3]);
  assert.equal(body.collisionFlags, 0x80000001);
  assert.equal(body.headerFlags, 12);
  assert.equal(body.headerState, 2);
  assert.equal(body.properties.immovable, false);
  assert.throws(
    () => commitNativePedBoneBody(r, body, { unlink() {}, activate() {} }),
    /commit/,
  );
});

test("inactive character still detaches the registered bone without invented spin or PHIL activation", () => {
  const r = request({ activation: null }),
    body = create(r),
    log = [];
  registerNativePedBoneBody(body, accepts);
  commitNativePedBoneBody(r, body, {
    unlink: () => log.push("unlink"),
    activate: () => log.push("activate"),
  });
  assert.deepEqual(log, ["unlink"]);
  assert.equal(body.detached, true);
  assert.equal(body.doNothing, true);
  assert.equal(body.headerState, 1);
  assert.deepEqual(body.localOmega.toArray(), [0, 0, 0]);
});

test("unsupported NULL shapes, singular masses and non-rigid ACT bases fail explicitly", () => {
  for (const collisionType of [null, "NONE", "POLYHEDRON", "POLYGON"])
    assert.throws(
      () => nativePedBoneShape(collisionType, request().snapshot.bounds),
      /no installed shape provider/,
    );
  assert.throws(
    () => nativePedBoneMassProperties(0, request().snapshot.bounds),
    /Massless/,
  );
  assert.throws(
    () => nativePedBoneMassProperties(1, { min: [0, 0, 0], max: [1, 0, 0] }),
    /singular/,
  );
  assert.throws(
    () => nativePedBoneShape("BOX", { min: [2, 0, 0], max: [1, 1, 1] }),
    /Inverted/,
  );
  const r = request();
  r.snapshot.nativePose = [...nativePose];
  r.snapshot.nativePose[0] = 2;
  assert.throws(() => create(r), /full-matrix rigid provider/);
});

for (const tree of ["data", "adv_data"])
  for (const name of ["Blokebl", "Bandsman", "twolf"])
    test(`original ${tree}/${name} actual MODEL/FORM detached head and limb profiles`, async (t) => {
      let store;
      try {
        store = await createAssetStore(
          new URL("../carma2_orig/", import.meta.url).pathname,
        );
      } catch (e) {
        if (e?.code === "ENOENT" || /Original installation/.test(String(e))) {
          t.skip("Original installation unavailable");
          return;
        }
        throw e;
      }
      const assets = new Assets();
      assets.manifest = store.manifest;
      assets.lookup = new Map(
        store.manifest.map((x) => [x.path.toLowerCase(), x.path]),
      );
      assets.bytes = async (p) => new Uint8Array(await store.read(p));
      const live = await loadNativePedAssets(
        assets,
        `PEDS/PEEPS/${name}`,
        name,
        tree,
      );
      for (const index of [live.form.headBone, 3]) {
        const bone = live.form.bones[index],
          variant = live.bones[index].variants[0];
        assert.ok(variant.actor);
        const sourceBounds = variant.modelBounds.get(variant.sourceModels[0]);
        assert.ok(sourceBounds);
        const r = request({
          index,
          bone,
          snapshot: {
            actor: new Group(),
            model: variant.actor.children[0].geometry,
            nativePose,
            bounds: {
              min: sourceBounds.min.toArray(),
              max: sourceBounds.max.toArray(),
            },
          },
        });
        const body = create(r);
        assert.equal(body.properties.mass, bone.mass);
        assert.equal(
          body.shape.type,
          index === live.form.headBone ? "SPHERE" : "BOX",
        );
        assert.equal(body.model, r.snapshot.model);
        assert.deepEqual(body.modelBounds, r.snapshot.bounds);
        const d = sourceBounds.getSize(new Vector3()).toArray().map(f);
        assert.deepEqual(
          body.properties.centerOfMass.toArray(),
          sourceBounds.min.toArray().map((v, i) => f(v + d[i] / 2)),
        );
        if (body.shape.type === "SPHERE")
          assert.equal(body.shape.radius, f((d[0] + d[1] + d[2]) * f(1 / 6)));
        registerNativePedBoneBody(body, accepts);
        assert.equal(body.filterA, 0x40000);
      }
    });
