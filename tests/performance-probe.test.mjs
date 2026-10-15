import test from "node:test";
import assert from "node:assert/strict";
import { Scene, Vector3, Quaternion } from "three";
import { installPerformanceProbe } from "../tools/performance-probe.mjs";

test("performance probe preserves transform and collector identities", () => {
  const keys = [
    "window",
    "innerWidth",
    "innerHeight",
    "devicePixelRatio",
    "navigator",
  ];
  const saved = Object.fromEntries(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const scene = new Scene();
  const updateMatrixWorld = scene.updateMatrixWorld;
  const world = {
    querySurfaces() {},
    collectFaces() {},
  };
  const querySurfaces = world.querySurfaces;
  const collectFaces = world.collectFaces;
  const simulation = {
    elapsed: 0,
    cars: [],
    noncars: [],
    world,
    isCarPhysicsActive: () => false,
    worldContacts() {},
    advanceWorldContacts() {},
    collectBodyContacts() {},
  };
  const nativeWorldContacts = simulation.worldContacts;
  const nativeAdvanceWorldContacts = simulation.advanceWorldContacts;
  const nativeCollectBodyContacts = simulation.collectBodyContacts;
  const gl = {
    getExtension: () => null,
    getParameter: () => 0,
    getContextAttributes: () => ({ antialias: false }),
  };
  const renderer = {
    getContext: () => gl,
    getPixelRatio: () => 1,
    setPixelRatio() {},
    domElement: { dispatchEvent() {} },
    info: {
      programs: [],
      memory: { geometries: 0, textures: 0 },
      render: { calls: 0, triangles: 0 },
    },
    render() {},
  };
  const carma = {
    stats: { ready: true },
    scene,
    renderer,
    simulation,
    collision: world,
    paused: true,
    rivals: [],
    player: {
      state: { position: new Vector3(), orientation: new Quaternion() },
    },
    camera: { far: 100 },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { carma },
  });
  Object.defineProperty(globalThis, "innerWidth", {
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(globalThis, "innerHeight", {
    configurable: true,
    value: 720,
  });
  Object.defineProperty(globalThis, "devicePixelRatio", {
    configurable: true,
    value: 1,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { hardwareConcurrency: 4 },
  });
  try {
    installPerformanceProbe();
    const probe = window.__c2Perf;
    assert.equal(scene.updateMatrixWorld, updateMatrixWorld);
    assert.equal(world.querySurfaces, querySurfaces);
    assert.equal(world.collectFaces, collectFaces);
    assert.equal(
      simulation.worldContacts.correctionObserverSource,
      nativeWorldContacts,
    );
    assert.equal(
      simulation.advanceWorldContacts.correctionObserverSource,
      nativeAdvanceWorldContacts,
    );
    assert.equal(
      simulation.collectBodyContacts.correctionObserverSource,
      nativeCollectBodyContacts,
    );
    probe.dispose();
    assert.equal(scene.updateMatrixWorld, updateMatrixWorld);
    assert.equal(world.querySurfaces, querySurfaces);
    assert.equal(world.collectFaces, collectFaces);
    assert.equal(simulation.worldContacts, nativeWorldContacts);
    assert.equal(simulation.advanceWorldContacts, nativeAdvanceWorldContacts);
    assert.equal(simulation.collectBodyContacts, nativeCollectBodyContacts);
  } finally {
    window.__c2Perf?.dispose();
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
