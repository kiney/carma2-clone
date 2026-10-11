import test from "node:test";
import assert from "node:assert/strict";
import { MeshBasicMaterial, Vector3 } from "three";
import { nativeAbstractShrapnel } from "../src/smash-abstract.ts";
import { ShrapnelSystem } from "../src/shrapnel.ts";

test("abstract connotations feed explicit colours and native square-root severity into the shared pool", () => {
  const materials = [new MeshBasicMaterial(), new MeshBasicMaterial()];
  materials[0].name = "authored-red";
  materials[1].name = "authored-blue";
  const system = new ShrapnelSystem({
    carMaterials: () => {
      throw new Error("abstract must not access car colours");
    },
    random: () => 0.75,
  });
  const packet = (effectMagnitude) =>
    nativeAbstractShrapnel({
      position: new Vector3(1, 2, 3),
      startingVelocity: new Vector3(4, -2, 6),
      effectMagnitude,
      materials,
    });
  assert.equal(system.spawn(packet(0.99)).length, 0);
  assert.equal(system.spawn(packet(1)).length, 12);
  assert.equal(system.spawn(packet(4)).length, 20);
  const source = packet(4);
  assert.equal(source.forceLength, 20);
  assert.deepEqual(source.cars, [null, null]);
  assert.deepEqual(source.normal.toArray(), [0, 0, 0]);
  assert.deepEqual(source.velocity.toArray(), [4, -2, 6]);
  assert.equal(source.materials, materials);
  assert.ok(
    system
      .snapshot()
      .records.filter((r) => r.active)
      .every((r) => r.material === "authored-blue"),
  );
  assert.equal(
    system.stats.overwritten,
    2,
    "abstract and collision fragments share the same30slots",
  );
  system.dispose();
  materials.forEach((m) => m.dispose());
});

test("abstract source rejects negative or nonfinite strength and absent original colours", () => {
  const base = {
    position: new Vector3(),
    effectMagnitude: 1,
    materials: [new MeshBasicMaterial()],
  };
  for (const effectMagnitude of [-1, NaN, Infinity])
    assert.throws(
      () => nativeAbstractShrapnel({ ...base, effectMagnitude }),
      /magnitude/,
    );
  assert.throws(
    () => nativeAbstractShrapnel({ ...base, materials: [] }),
    /material/,
  );
  assert.deepEqual(nativeAbstractShrapnel(base).velocity.toArray(), [0, 1, 0]);
  base.materials[0].dispose();
});
