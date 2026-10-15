import test from "node:test";
import assert from "node:assert/strict";
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  Vector3,
} from "three";
import {
  DamageSystem,
  modelRepairCoordinate,
  parseWam,
} from "../src/damage.ts";
import { parseCarMechanics } from "../src/mechanics.ts";
import { originalCar } from "./support/original-car.mjs";

function wam(actor = "BODY.DAT") {
  return [
    "VERSION 4",
    "1",
    "0.1",
    "1",
    "-0.1",
    "0",
    "0",
    "1",
    "0.25",
    "1",
    "-0.25",
    "1",
    "-0.05",
    "0.15",
    "1",
    "0",
    "0,0.16,0.05",
    "1",
    actor,
    "normal",
    "boring",
    "0",
  ].join("\n");
}

function fixture(resources, configPath = "data/CARS/VARIANT/VARIANT.TXT") {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(
      new Float32Array([-0.2, 0.1, -0.4, 0.2, 0.1, -0.4, -0.2, 0.2, -0.4]),
      3,
    ),
  );
  geometry.setIndex([0, 1, 2]);
  const body = new Mesh(geometry, new MeshLambertMaterial());
  body.name = "BODY.DAT";
  const group = new Group();
  group.name = "VARIANT";
  group.add(body);
  const reads = [];
  const assets = {
    manifest: Object.keys(resources).map((path) => ({ path })),
    warnings: [],
    resolve: (path) =>
      Object.keys(resources).find(
        (candidate) => candidate.toLowerCase() === path.toLowerCase(),
      ),
    async text(path) {
      reads.push(path);
      return resources[path];
    },
  };
  return {
    assets,
    reads,
    group,
    system: new DamageSystem(
      assets,
      group,
      "MISLEADING.TXT\nLEGACY.WAM",
      configPath,
    ),
  };
}

for (const scope of ["data", "adv_data"]) {
  test(`WAM resolution prefers the authored local token in ${scope}`, async () => {
    const local = `${scope}/CARS/VARIANT/LEGACY.WAM`;
    const { system, reads, assets } = fixture(
      {
        [local]: wam(),
        [`${scope}/CARS/VARIANT/VARIANT.WAM`]: wam("WRONG.DAT"),
      },
      `${scope}/CARS/VARIANT/VARIANT.TXT`,
    );
    await system.init();
    assert.deepEqual(reads, [local]);
    assert.equal(system.runtimeParts.length, 1);
    assert.deepEqual(assets.warnings, []);
  });

  test(`WAM fallback uses the selected TXT filename in ${scope}`, async () => {
    const local = `${scope}/CARS/VARIANT/VARIANT.WAM`;
    const otherScope = scope === "data" ? "adv_data" : "data";
    const { system, reads, assets } = fixture(
      {
        [`${otherScope}/CARS/VARIANT/LEGACY.WAM`]: wam("WRONG.DAT"),
        [`${scope}/CARS/MISLEADING/LEGACY.WAM`]: wam("WRONG.DAT"),
        [local]: wam(),
      },
      `${scope}/CARS/VARIANT/VARIANT.TXT`,
    );
    await system.init();
    assert.deepEqual(reads, [local]);
    assert.equal(system.runtimeParts.length, 1);
    assert.deepEqual(assets.warnings, []);
  });
}

test("missing local WAM warns without borrowing global or other-scope resources", async () => {
  const { system, reads, assets } = fixture({
    "data/CARS/OTHER/LEGACY.WAM": wam(),
    "data/CARS/MISLEADING/LEGACY.WAM": wam(),
    "adv_data/CARS/VARIANT/LEGACY.WAM": wam(),
    "adv_data/CARS/VARIANT/VARIANT.WAM": wam(),
  });
  await system.init();
  assert.deepEqual(reads, []);
  assert.equal(system.runtimeParts.length, 0);
  assert.match(
    assets.warnings.join("\n"),
    /Damage data missing.*VARIANT\.TXT.*LEGACY\.WAM.*VARIANT\.WAM/,
  );
});

test("malformed authored WAM warns without falling back to a valid variant file", async () => {
  const path = "data/CARS/VARIANT/LEGACY.WAM";
  const { system, reads, assets } = fixture({
    [path]: "VERSION 3",
    "data/CARS/VARIANT/VARIANT.WAM": wam(),
  });
  await system.init();
  assert.deepEqual(reads, [path]);
  assert.equal(system.runtimeParts.length, 0);
  assert.match(
    assets.warnings.join("\n"),
    /Damage data .*LEGACY\.WAM.*Unsupported WAM version/,
  );
});

test("a valid WAM with unmatched actors reports the zero-part binding", async () => {
  const { system, assets } = fixture({
    "data/CARS/VARIANT/LEGACY.WAM": wam("UNMATCHED.ACT"),
  });
  await system.init();
  assert.equal(system.runtimeParts.length, 0);
  assert.match(
    assets.warnings.join("\n"),
    /Damage binding.*0\/1 WAM actors bound.*UNMATCHED\.ACT/,
  );
});

test("legacy test adapters infer a Stock car directory from the embedded TXT token", async () => {
  const path = "data/CARS/MISLEADING/LEGACY.WAM";
  const { assets, group, reads } = fixture({ [path]: wam() });
  const legacy = new DamageSystem(assets, group, "MISLEADING.TXT\nLEGACY.WAM");
  await legacy.init();
  assert.deepEqual(reads, [path]);
  assert.equal(legacy.runtimeParts.length, 1);
});

for (const name of ["eaglegold", "eaglegreen", "eagleblue", "mustang"]) {
  test(`original ${name} binds its own WAM, accumulates body dents and repairs`, async (t) => {
    let data;
    try {
      data = await originalCar(name);
    } catch (error) {
      if (error.code === "ENOENT") {
        t.skip("Original assets absent");
        return;
      }
      throw error;
    }
    const configPath = `data/CARS/${name}/${name}.TXT`;
    const system = new DamageSystem(
      data.assets,
      data.group,
      data.text,
      configPath,
    );
    await system.init();
    const wamPath = data.assets.resolve(`data/CARS/${name}/${name}.WAM`);
    const authored = parseWam(await data.assets.text(wamPath));
    assert.equal(system.runtimeParts.length, authored.parts.length);
    assert.ok(
      system.runtimeParts.some(({ part }) => part.type !== "boring"),
      "detachable actors bind",
    );
    assert.deepEqual(data.assets.warnings, []);
    const principal = system.runtimeParts.find(
      ({ actor }) => actor.parent === data.group,
    );
    assert.ok(principal, "principal body actor binds");
    const body = principal.actor.children.find((object) => object.isMesh);
    assert.ok(body, "principal actor has body geometry");
    const originals = [];
    data.group.traverse((object) => {
      if (object.isMesh)
        originals.push([
          object,
          Array.from(object.geometry.attributes.position.array),
        ]);
    });
    const mechanics = parseCarMechanics(data.text);
    const hull = mechanics.shapes.map((shape) =>
      shape.vertices.map((point) => new Vector3(...point)),
    );
    const pristineHull = hull.map((shape) =>
      shape.map((point) => point.toArray()),
    );
    system.configurePhysics(mechanics, hull);
    system.damageContext.random = () => 0.5;
    data.group.updateMatrixWorld(true);
    const impactEnd = (front, now) => {
      const positions = body.geometry.attributes.position;
      let index = 0;
      for (let i = 1; i < positions.count; i++) {
        if (
          front
            ? positions.getZ(i) < positions.getZ(index)
            : positions.getZ(i) > positions.getZ(index)
        )
          index = i;
      }
      const contact = new Vector3()
        .fromBufferAttribute(positions, index)
        .applyMatrix4(body.matrixWorld);
      const force = new Vector3(0, 0, front ? 0.2 : -0.2);
      return system.applyImpact([contact], force, false, true, now, force);
    };
    const pristineBody = Array.from(body.geometry.attributes.position.array);
    const first = impactEnd(true, 10000);
    assert.ok(
      first.maxInfluence > 0,
      "front impact reaches authored crush vertices",
    );
    const firstBody = Array.from(body.geometry.attributes.position.array);
    assert.notDeepEqual(
      firstBody,
      pristineBody,
      "principal body vertices deform",
    );
    const firstChanged = firstBody.flatMap((value, index) =>
      Math.abs(value - pristineBody[index]) > 1e-5 ? [index] : [],
    );
    const second = impactEnd(false, 12000);
    assert.ok(
      second.maxInfluence > 0,
      "rear impact reaches authored crush vertices",
    );
    const secondBody = Array.from(body.geometry.attributes.position.array);
    assert.notDeepEqual(
      secondBody,
      firstBody,
      "another impact adds deformation",
    );
    assert.ok(
      firstChanged.some(
        (index) => Math.abs(secondBody[index] - pristineBody[index]) > 1e-5,
      ),
      "earlier localized deformation persists",
    );
    assert.ok(system.deformationRevision >= 2);
    if (authored.version === 4) {
      const hullContact = hull
        .flat()
        .reduce((front, point) => (point.z < front.z ? point : front))
        .clone();
      const hullForce = new Vector3(0, 0, 0.2);
      system.applyImpact(
        [hullContact],
        hullForce,
        false,
        true,
        13000,
        hullForce,
      );
      assert.ok(
        system.pendingShapeSwapFlags & 1,
        "WAM4 contact on the hull requests collision-shape synchronization",
      );
      assert.notDeepEqual(
        hull.map((shape) => shape.map((point) => point.toArray())),
        pristineHull,
        "physical hull vertices deform at their contact",
      );
    } else
      assert.deepEqual(
        hull.map((shape) => shape.map((point) => point.toArray())),
        pristineHull,
        "WAM104 preserves collision geometry while bodywork deforms",
      );
    assert.ok(
      hull.flat().every((point) => point.toArray().every(Number.isFinite)),
    );
    const detachable = system.runtimeParts.find(
      ({ part }) => part.type !== "boring",
    );
    const detachableIndex = authored.parts.findIndex(
      (part) => part.actor === detachable.part.actor,
    );
    system.damageContext.random = () =>
      (detachableIndex + 0.5) / authored.parts.length;
    const spam = system.spamModel(1, 14000);
    assert.ok(
      spam.detachedParts.includes(detachable),
      "normal model-damage path can request authored detachment",
    );
    assert.equal(detachable.forcedFullDetach, true);
    system.repair();
    for (const [object, original] of originals) {
      const bound = system.runtimeParts.some(
        ({ actor }) => actor === object || actor === object.parent,
      );
      assert.deepEqual(
        Array.from(object.geometry.attributes.position.array),
        bound ? original.map(modelRepairCoordinate) : original,
      );
    }
    assert.equal(
      system.runtimeParts.filter(
        ({ forcedFullDetach, state }) => forcedFullDetach || state.phase !== 0,
      ).length,
      0,
    );
  });
}
