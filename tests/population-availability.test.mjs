import test from "node:test";
import assert from "node:assert/strict";
import { assessPopulationAvailability } from "../src/population-availability.ts";

const ready = { state: "ready" };
function input(changes = {}) {
  return {
    opponents: ready,
    pedestrians: ready,
    opponentIds: [3, 3, 7],
    pedestrianCount: 8,
    groupCounts: new Map([
      [4, { total: 5 }],
      [9, { total: 3 }],
    ]),
    checkpointRouteAvailable: true,
    ...changes,
  };
}
function mission(raceType, changes = {}) {
  return { raceType, opponentsToKill: [], pedGroupsToKill: [], ...changes };
}

test("pending populations never become missing target failures", () => {
  const state = assessPopulationAvailability(
    mission("cars", { opponentsToKill: [7] }),
    input({
      opponents: { state: "loading" },
      opponentIds: [],
    }),
  );
  assert.deepEqual(state.pending, ["Opponents are still loading."]);
  assert.deepEqual(state.unavailable, []);
  assert.deepEqual(
    assessPopulationAvailability(
      mission("checkpoints"),
      input({
        opponents: { state: "loading" },
        pedestrians: { state: "loading" },
      }),
    ).pending,
    [],
    "checkpoint-only missions do not wait for unrelated populations",
  );
});

test("partial opponent rejection and absent selected IDs stay explicit", () => {
  const definition = mission("cars", { opponentsToKill: [3, 7] });
  assert.deepEqual(
    assessPopulationAvailability(definition, input()).unavailable,
    [],
  );
  const partial = assessPopulationAvailability(
    definition,
    input({
      opponents: { state: "failed", reason: "Opponent 7 ACT is unavailable" },
      opponentIds: [3],
    }),
  );
  assert.match(
    partial.unavailable.join(" "),
    /could not finish loading.*ACT is unavailable/,
  );
  assert.deepEqual(
    assessPopulationAvailability(definition, input({ opponentIds: [3, 3] }))
      .unavailable,
    ["Required opponent 7 has no loaded vehicle."],
  );
  assert.equal(
    assessPopulationAvailability(mission("cars"), input({ opponentIds: [] }))
      .unavailable.length,
    1,
  );
});

test("known missing pedestrian groups cannot silently shrink mission targets", () => {
  const definition = mission("peds", { pedGroupsToKill: [4, 9, 9] });
  const partial = input({
    groupCounts: new Map([[4, { total: 5 }]]),
    pedestrianFailures: [
      { group: 9, reason: "Required pedestrian group 9 has no loaded actors." },
    ],
  });
  assert.deepEqual(
    assessPopulationAvailability(definition, partial).unavailable,
    ["Required pedestrian group 9 has no loaded actors."],
  );
  partial.groupCounts.set(9, { total: 0 });
  assert.equal(
    assessPopulationAvailability(definition, partial).unavailable.length,
    1,
  );
  partial.pedestrians = { state: "loading" };
  assert.deepEqual(
    assessPopulationAvailability(definition, partial).unavailable,
    [],
  );
  assert.equal(
    assessPopulationAvailability(definition, partial).pending.length,
    1,
  );
  assert.equal(
    assessPopulationAvailability(mission("peds"), input({ pedestrianCount: 0 }))
      .unavailable.length,
    1,
  );
});

test("classic races keep other victory paths after an optional population fails", () => {
  const definition = mission("carma");
  const failed = { state: "failed", reason: "missing optional asset" };
  const state = assessPopulationAvailability(
    definition,
    input({ opponents: failed, pedestrians: failed }),
  );
  assert.deepEqual(state.unavailable, []);
  assert.equal(state.disabledAlternatives.length, 2);
  assert.equal(
    assessPopulationAvailability(
      definition,
      input({
        opponents: failed,
        pedestrians: failed,
        checkpointRouteAvailable: false,
      }),
    ).unavailable.length,
    1,
  );
  assert.deepEqual(
    assessPopulationAvailability(
      definition,
      input({
        opponents: failed,
        pedestrians: { state: "loading" },
        checkpointRouteAvailable: false,
      }),
    ).unavailable,
    [],
    "defer until the remaining possible victory path settles",
  );
  assert.deepEqual(
    assessPopulationAvailability(
      definition,
      input({
        opponents: failed,
        checkpointRouteAvailable: false,
      }),
    ).unavailable,
    [],
    "a complete pedestrian population still provides an objective",
  );
});

test("pure smash and practice content do not depend on irrelevant populations", () => {
  const empty = input({
    opponents: { state: "failed" },
    pedestrians: { state: "failed" },
    opponentIds: [],
    pedestrianCount: 0,
    groupCounts: new Map(),
    checkpointRouteAvailable: false,
  });
  for (const definition of [
    undefined,
    mission("smash"),
    mission("checkpoints"),
  ]) {
    const state = assessPopulationAvailability(definition, empty);
    assert.deepEqual(state.pending, []);
    assert.deepEqual(state.unavailable, []);
    assert.deepEqual(state.disabledAlternatives, []);
  }
  const mixed = assessPopulationAvailability(
    mission("smashAndPed", { pedGroupsToKill: [4] }),
    empty,
  );
  assert.equal(
    mixed.unavailable.length,
    1,
    "authored pedestrian targets are required for the mixed mission",
  );
});

test("an authored zero-count group is not confused with a loader failure", () => {
  const definition = mission("peds", { pedGroupsToKill: [4, 9] });
  const emptyGroup = input({ groupCounts: new Map([[4, { total: 5 }]]) });
  assert.deepEqual(
    assessPopulationAvailability(definition, emptyGroup).unavailable,
    [],
  );
  const unrelated = {
    ...emptyGroup,
    pedestrianFailures: [{ group: 77, reason: "Unrelated group unavailable" }],
  };
  assert.equal(
    assessPopulationAvailability(definition, unrelated).pedestriansUsable,
    true,
  );
  assert.equal(
    assessPopulationAvailability(mission("carma"), unrelated).pedestriansUsable,
    false,
    "classic all-pedestrians objective cannot silently exclude a known failed group",
  );
  assert.equal(
    assessPopulationAvailability(definition, {
      ...emptyGroup,
      groupCounts: new Map(),
    }).unavailable.length,
    1,
  );
});

test("real population creation reports missing actors separately from optional visual warnings", async () => {
  const THREE = await import("three");
  const { PedestrianSystem } = await import("../src/pedestrians.ts");
  const track = new THREE.Group();
  for (const name of ["first", "second"]) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([-1, 0, -1, 0, 0, 1, 1, 0, -1], 3),
    );
    const material = new THREE.MeshBasicMaterial();
    material.name = name;
    track.add(new THREE.Mesh(geometry, material));
  }
  const actor = new THREE.Group();
  actor.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.28, 0.05),
      new THREE.MeshBasicMaterial(),
    ),
  );
  const system = await PedestrianSystem.create(
    {
      manifest: [{ path: "data/PEDS/PEEPS/Alice/Alice.act", size: 1000 }],
      text: async () => "// Group #7\n1\nAlice\n// Group #9\n1\nBob\n",
      scene: async () => ({ group: actor.clone(true) }),
    },
    track,
    "// Ped specs\n2\nfirst\n0\n7\n-1\n0\n0\nsecond\n0\n9\n-1\n0\n0\n",
    () => 0,
    { spawn: new THREE.Vector3(), maxCount: 8, random: () => 0.5 },
  );
  try {
    assert.equal(system.count, 1);
    assert.deepEqual(
      system.populationFailures.map((failure) => failure.group),
      [9],
    );
    const selected = assessPopulationAvailability(
      mission("peds", { pedGroupsToKill: [7, 9] }),
      input({
        pedestrianCount: system.count,
        groupCounts: system.groupCounts,
        pedestrianFailures: system.populationFailures,
      }),
    );
    assert.match(selected.unavailable.join(" "), /group 9.*no loadable actor/);
    assert.equal(selected.pedestriansUsable, false);
    assert.equal(
      assessPopulationAvailability(
        mission("peds", { pedGroupsToKill: [7] }),
        input({
          pedestrianCount: system.count,
          groupCounts: system.groupCounts,
          pedestrianFailures: system.populationFailures,
        }),
      ).pedestriansUsable,
      true,
      "an unrelated failed group does not block the selected mission",
    );
  } finally {
    system.dispose();
    track.traverse((object) => {
      object.geometry?.dispose();
      object.material?.dispose();
    });
    actor.traverse((object) => {
      object.geometry?.dispose();
      object.material?.dispose();
    });
  }
});
