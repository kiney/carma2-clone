import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const assetRoot = process.env.CARMA2_ROOT || "carma2_orig";
try {
  await access(executable);
  await access(assetRoot);
} catch {
  console.log(
    "SKIP WAM effects browser regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5209;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
let browser;
let report = {
  physicalCrash: null,
  fixtures: [],
  errors: [],
  failedRequests: [],
};
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));

try {
  let ready = false;
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/api/manifest`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (server.exitCode !== null) throw new Error(serverLog);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `production server did not start: ${serverLog}`);
  browser = await chromium.launch({
    executablePath: executable,
    headless: true,
    args: [
      "--no-sandbox",
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  page.on("pageerror", (error) => report.errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    report.failedRequests.push(
      `${request.url()}: ${request.failure()?.errorText}`,
    ),
  );
  await page.goto(`http://localhost:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  await page.evaluate(() => {
    const audio = window.carma.audio;
    window.__wamSoundEvents = [];
    const play = audio.playSound.bind(audio);
    audio.playSound = async (id, ...args) => {
      window.__wamSoundEvents.push(id);
      return play(id, ...args);
    };
  });

  const loadCar = async (name) => {
    await page.evaluate(async (name) => {
      const c = window.carma;
      const track = c.assets.resolve("data/RACES/desert2/desert2.txt");
      const car = c.assets.manifest.find((entry) => {
        const path = entry.path.toLowerCase();
        return (
          path.startsWith("data/cars/") && path.endsWith(`/${name}/${name}.txt`)
        );
      })?.path;
      if (!track || !car)
        throw new Error(`Original DUNE or ${name} car is absent`);
      document.querySelector("#track-select").value = track;
      document.querySelector("#car-select").value = car;
      await c.loadRace();
      c.paused = true;
      document.querySelector("#panel").hidden = true;
    }, name);
    await page.waitForFunction(() => window.carma.opponentsReady, null, {
      timeout: 90000,
    });
  };

  // One real W-driven outer-frame collision verifies the original crash path.
  await loadCar("eagle3");
  report.physicalCrash = await page.evaluate(() => {
    const c = window.carma;
    const events = [];
    const soundStart = window.__wamSoundEvents.length;
    const wrapDamage = (body, owner) => {
      if (!body?.damage) return;
      const previous = body.damage.onWamSmash;
      body.damage.onWamSmash = (event) => {
        events.push({
          owner,
          material: event.smash.material,
          oldLevel: event.oldLevel,
          targetLevel: event.targetLevel,
          repetition: event.repetition,
          repetitions: event.repetitions,
          authoredSounds: [...event.connotations.sounds],
          shardSpecs: event.connotations.shrapnel
            .filter((spec) => spec.kind === "shards")
            .map((spec) => ({
              material: spec.shard.material,
              lifetimeSeconds: [...spec.lifetimeSeconds],
              scalar: spec.shard.scalar,
            })),
        });
        previous?.(event);
      };
    };
    wrapDamage(c.player, c.player.group.name);
    for (const rival of c.rivals) wrapDamage(rival.body, rival.body.group.name);
    const a = c.player;
    const b = c.simulation.cars
      .filter((p) => p !== a && !p.human)
      .sort(
        (x, y) =>
          Math.abs(x.properties.mass - a.properties.mass) -
          Math.abs(y.properties.mass - a.properties.mass),
      )[0];
    if (!b) throw new Error("No original opponent available for Eagle3 crash");
    for (const p of c.simulation.cars) {
      c.simulation.setCarPhysicsActive(p, p === a || p === b);
      p.input.throttle = 0;
      p.input.steer = 0;
      p.input.brake = false;
      p.state.velocity.set(0, 0, 0);
      p.state.angularVelocity.set(0, 0, 0);
    }
    const rival = c.rivals.find((r) => r.body === b);
    if (rival) {
      // Keep this original opponent as a stationary physical target while
      // leaving the other cars on their native fleet update path.
      const fleet = c.opponentFleet;
      const updateFleet = fleet.update.bind(fleet);
      fleet.update = (...args) => {
        const result = updateFleet(...args);
        for (const opponent of c.rivals)
          if (opponent.body !== b)
            c.simulation.setCarPhysicsActive(opponent.body, false);
        c.simulation.setCarPhysicsActive(b, true);
        b.input.throttle = 0;
        b.input.steer = 0;
        b.input.brake = false;
        b.input.handbrake = false;
        b.state.accForce = 0;
        b.state.brakeForce = 0;
        b.state.curvature = 0;
        b.state.velocity.set(0, 0, 0);
        b.state.angularVelocity.set(0, 0, 0);
        return result;
      };
    }
    const origin = a.state.position.clone();
    const forward = new a.state.position.constructor(0, 0, -1)
      .applyQuaternion(a.state.orientation)
      .normalize();
    const heading = a.state.heading;
    a.state.position.copy(origin);
    a.state.heading = heading;
    c.simulation.reset(a);
    b.state.position.copy(origin).addScaledVector(forward, 5);
    b.state.heading = heading + Math.PI;
    c.simulation.reset(b);
    b.state.velocity.set(0, 0, 0);
    const attribution = [];
    const previousAttribution = c.simulation.onCrashAttribution;
    c.simulation.onCrashAttribution = (attacker, victim) => {
      previousAttribution?.(attacker, victim);
      const fleetState = c.opponentFleet.snapshot;
      const affected = fleetState.rivals.find(
        (entry) =>
          entry.identity === attacker.group.uuid ||
          entry.identity === victim.group.uuid,
      );
      attribution.push({
        attacker: attacker.group.name,
        victim: victim.group.name,
        attackerIdentity: attacker.group.uuid,
        victimIdentity: victim.group.uuid,
        nativeContact: affected?.contact ?? null,
        catalogGrudge: affected
          ? fleetState.catalogGrudges[affected.catalogIndex]
          : null,
        physical: affected?.physical ?? null,
        objective: affected?.objective.objective ?? null,
      });
    };
    window.__wamPhysical = {
      events,
      soundStart,
      attribution,
      until: c.simulation.elapsed + 15,
      rival: b.group.name,
      player: a.group.name,
      startDamage: [...b.damage.componentLevels],
    };
    c.paused = false;
    return { elapsed: c.simulation.elapsed };
  });
  await page.keyboard.down("w");
  await page.waitForFunction(
    () =>
      window.__wamPhysical.attribution.length > 0 ||
      window.carma.simulation.elapsed >= window.__wamPhysical.until,
    null,
    { timeout: 25000 },
  );
  await page.keyboard.up("w");
  report.physicalCrash = await page.evaluate(() => {
    const c = window.carma;
    c.paused = true;
    const p = window.__wamPhysical;
    const rival = c.simulation.cars.find((body) => body.group.name === p.rival);
    return {
      ...p,
      endElapsed: c.simulation.elapsed,
      rivalDamage: [...rival.damage.componentLevels],
      raceStatus: c.race.status,
      sounds: window.__wamSoundEvents.slice(p.soundStart),
      wamEvents: p.events,
    };
  });
  assert.ok(report.physicalCrash.endElapsed > report.physicalCrash.until - 15);
  assert.ok(
    report.physicalCrash.attribution.some(
      (e) =>
        e.attacker === report.physicalCrash.player ||
        e.victim === report.physicalCrash.player,
    ),
    JSON.stringify(report.physicalCrash),
  );
  const creditedNativeHit = report.physicalCrash.attribution.find(
    (event) =>
      event.attacker === report.physicalCrash.player &&
      event.nativeContact?.flags.grudgeRecent &&
      event.nativeContact.lastHitter === event.attackerIdentity,
  );
  assert.ok(
    creditedNativeHit,
    `actual player crash did not update native opponent attribution/grudge state: ${JSON.stringify(report.physicalCrash.attribution)}`,
  );
  assert.ok(
    report.physicalCrash.rivalDamage.some(
      (level, i) => level > report.physicalCrash.startDamage[i],
    ),
    JSON.stringify(report.physicalCrash),
  );
  assert.ok(
    report.physicalCrash.wamEvents.length > 0,
    `actual Eagle3 crash did not emit WAM smash effects: ${JSON.stringify(report.physicalCrash)}`,
  );
  const physicalSoundEvents = report.physicalCrash.wamEvents.filter(
    (event) => event.authoredSounds.length,
  );
  assert.equal(
    report.physicalCrash.sounds.length,
    physicalSoundEvents.length,
    "physical crash should play one authored sound per permitted repetition",
  );
  for (const [index, event] of physicalSoundEvents.entries())
    assert.ok(
      event.authoredSounds.includes(report.physicalCrash.sounds[index]),
      JSON.stringify({ event, sound: report.physicalCrash.sounds[index] }),
    );
  assert.ok(
    !report.physicalCrash.sounds.includes(8012),
    "car smash played checkpoint voice 8012",
  );
  await page.evaluate(() => {
    const c = window.carma;
    document.querySelector("#panel").hidden = true;
    c.player.group.position.copy(c.player.state.position);
    c.player.group.updateMatrixWorld(true);
  });
  await page.locator("#view").click();
  await page.keyboard.press("c");
  await page.keyboard.press("c");
  await page.waitForTimeout(150);
  await page.screenshot({ path: "artifacts/browser-wam-effects-driving.png" });
  await page.screenshot({ path: "artifacts/browser-wam-effects-eagle3.png" });

  // Isolated effect-tier fixture: use original car WAMs and original material
  // centroids, calling the same model-crush stage to cross authored tiers exactly.
  for (const name of ["eagle3", "copcar", "vlad3"]) {
    await loadCar(name);
    const fixture = await page.evaluate((name) => {
      const c = window.carma;
      const body = c.player;
      const damage = body.damage;
      const shardSummary = () => {
        const snapshot = c.shards.snapshot();
        const starts = snapshot.fragments.map((fragment) => fragment.startMs);
        const ends = snapshot.fragments.map((fragment) => fragment.endMs);
        return {
          active: snapshot.active,
          visible: snapshot.visible,
          totalCreated: snapshot.totalCreated,
          startMs: starts.length ? Math.min(...starts) : null,
          endMs: ends.length ? Math.max(...ends) : null,
        };
      };
      const soundStart = window.__wamSoundEvents.length;
      const events = [];
      const previous = damage.onWamSmash;
      damage.onWamSmash = (event) => {
        events.push({
          material: event.smash.material,
          oldLevel: event.oldLevel,
          targetLevel: event.targetLevel,
          repetition: event.repetition,
          repetitions: event.repetitions,
          authoredSounds: [...event.connotations.sounds],
          shardSpecs: event.connotations.shrapnel
            .filter((spec) => spec.kind === "shards")
            .map((spec) => ({
              material: spec.shard.material,
              lifetimeSeconds: [...spec.lifetimeSeconds],
              scalar: spec.shard.scalar,
            })),
        });
        previous?.(event);
      };
      body.group.updateWorldMatrix(true, true);
      let selected;
      for (const runtime of damage.runtimeParts) {
        const smashes = runtime.part.smashes ?? [];
        if (!smashes.length) continue;
        const meshes = [];
        runtime.actor.traverse((object) => {
          if (object.isMesh) meshes.push(object);
        });
        for (const smash of smashes) {
          const materialName = smash.material.toLowerCase();
          const levelData = smash.levels.at(-1);
          if (
            !levelData?.connotations.sounds.length ||
            !levelData.connotations.shrapnel.some(
              (spec) => spec.kind === "shards",
            )
          )
            continue;
          const softness = runtime.part.softnessFactor;
          const maxMagnitude =
            (10 * softness * 0.0135) / Math.sqrt(0.0014492754);
          const targetLevel = smash.levels.reduce(
            (n, level, i) => (level.threshold <= maxMagnitude ? i + 1 : n),
            0,
          );
          if (!targetLevel) continue;
          for (const mesh of meshes) {
            const materials = Array.isArray(mesh.material)
              ? mesh.material
              : [mesh.material];
            const materialIndex = materials.findIndex(
              (m) => m.name.toLowerCase() === materialName,
            );
            if (materialIndex < 0) continue;
            const geometry = mesh.geometry;
            const position = geometry.getAttribute("position");
            const indices = new Set();
            const groups = geometry.groups.length
              ? geometry.groups
              : [
                  {
                    start: 0,
                    count: geometry.index?.count ?? position.count,
                    materialIndex: 0,
                  },
                ];
            for (const group of groups)
              if (group.materialIndex === materialIndex)
                for (let i = group.start; i < group.start + group.count; i++)
                  indices.add(geometry.index ? geometry.index.getX(i) : i);
            if (!indices.size) continue;
            const point = new mesh.position.constructor();
            for (const index of indices)
              point.add(
                new mesh.position.constructor().fromBufferAttribute(
                  position,
                  index,
                ),
              );
            point.divideScalar(indices.size);
            mesh.localToWorld(point);
            body.group.worldToLocal(point);
            selected = {
              runtime,
              smash,
              point,
              direction: new point.constructor(0, 0, 1),
              targetLevel,
            };
            break;
          }
          if (selected) break;
        }
        if (selected) break;
      }
      if (!selected)
        throw new Error(
          `${name} has no sound and shard-bearing smash material reachable at native force cap`,
        );
      const staleRenderRootPosition = body.group.position.toArray();
      body.state.position.add(new body.state.position.constructor(20, 0, -12));
      body.state.velocity.set(1.5, 0.5, -0.75);
      const physicsRootPosition = body.state.position.toArray();
      const shardBaseline = shardSummary();
      const before = events.length;
      const crush = () =>
        damage.applyModelCrush(
          [selected.point.clone()],
          selected.point.clone(),
          selected.direction.clone(),
          10,
          Math.trunc(c.simulation.elapsed * 1000),
        );
      crush();
      const firstEvents = events.slice(before);
      const firstShardSnapshot = shardSummary();
      const firstSounds = window.__wamSoundEvents.slice(soundStart);
      const repeatsBefore = events.length;
      crush();
      const repeatedEvents = events.length - repeatsBefore;
      const repeatSounds = window.__wamSoundEvents.slice(
        soundStart + firstSounds.length,
      );
      damage.repair();
      const afterRepairStart = events.length;
      const repairedSoundStart = window.__wamSoundEvents.length;
      crush();
      const repairedEvents = events.slice(afterRepairStart);
      const newSounds = window.__wamSoundEvents.slice(repairedSoundStart);
      const finalShardSnapshot = shardSummary();
      return {
        name,
        material: selected.smash.material,
        authoredSounds: [
          ...selected.smash.levels[selected.targetLevel - 1].connotations
            .sounds,
        ],
        targetLevel: selected.targetLevel,
        firstEvents,
        firstSounds,
        repeatSounds,
        repeatedEvents,
        repairedEvents,
        newSounds,
        staleRenderRootPosition,
        physicsRootPosition,
        shardBaseline,
        firstShardSnapshot,
        finalShardSnapshot,
        repaired: damage.repairRevision > 0,
        bodyName: body.group.name,
      };
    }, name);
    report.fixtures.push(fixture);
    assert.ok(fixture.firstEvents.length > 0, JSON.stringify(fixture));
    assert.ok(
      fixture.firstEvents.some(
        (event) =>
          event.material === fixture.material &&
          event.targetLevel === fixture.targetLevel,
      ),
      JSON.stringify(fixture),
    );
    assert.equal(fixture.repeatedEvents, 0, `same tier replayed for ${name}`);
    assert.equal(
      fixture.repeatSounds.length,
      0,
      `same tier replayed sound for ${name}`,
    );
    assert.ok(fixture.repaired, JSON.stringify(fixture));
    assert.deepEqual(
      fixture.repairedEvents.map((e) => [e.repetition, e.repetitions]),
      fixture.firstEvents.map((e) => [e.repetition, e.repetitions]),
      JSON.stringify(fixture),
    );
    const checkSounds = (events, sounds, phase) => {
      const withSounds = events.filter((event) => event.authoredSounds.length);
      assert.equal(
        sounds.length,
        withSounds.length,
        `expected one sound per permitted repetition for ${name} (${phase})`,
      );
      for (const [index, event] of withSounds.entries()) {
        assert.ok(
          event.authoredSounds.includes(sounds[index]),
          `sound was outside authored alternatives for ${name}: ${JSON.stringify({ event, sound: sounds[index] })}`,
        );
        assert.notEqual(
          sounds[index],
          8012,
          "car smash selected checkpoint voice 8012",
        );
      }
    };
    checkSounds(fixture.firstEvents, fixture.firstSounds, "first crush");
    checkSounds(fixture.repairedEvents, fixture.newSounds, "after repair");
    assert.ok(
      !fixture.firstSounds.includes(8012) && !fixture.newSounds.includes(8012),
    );
    const firstShardEvents = fixture.firstEvents.filter(
      (event) => event.shardSpecs.length,
    );
    assert.ok(
      firstShardEvents.length > 0,
      `original ${name} crush did not reach a shard-bearing WAM tier`,
    );
    assert.ok(
      fixture.firstShardSnapshot.totalCreated >
        fixture.shardBaseline.totalCreated,
      `original ${name} WAM did not create shards`,
    );
    const startMs = fixture.finalShardSnapshot.startMs;
    const maxEndMs = fixture.finalShardSnapshot.endMs;
    assert.ok(Number.isFinite(startMs) && Number.isFinite(maxEndMs));
    fixture.shardLifecycle = await page.evaluate(
      ({ startMs, physicsRootPosition, staleRenderRootPosition }) => {
        const c = window.carma;
        const runtime = c.shards;
        const live = runtime.snapshot();
        const updateStart = Math.max(
          c.simulation.elapsed * 1000 + 2,
          startMs + 2,
        );
        runtime.update(updateStart);
        runtime.update(updateStart + 150);
        const beforeMove = runtime.snapshot();
        runtime.update(updateStart + 300);
        const moved = runtime.snapshot();
        let visibleTriangleMeshes = 0;
        c.scene.traverse((object) => {
          if (
            object.name === "WAM shard" &&
            object.visible &&
            object.isMesh &&
            object.geometry.getAttribute("position")?.count === 3
          )
            visibleTriangleMeshes++;
        });
        const movedFragments = moved.fragments.filter(
          (fragment, index) =>
            beforeMove.fragments[index] &&
            Math.hypot(
              fragment.position[0] - beforeMove.fragments[index].position[0],
              fragment.position[1] - beforeMove.fragments[index].position[1],
              fragment.position[2] - beforeMove.fragments[index].position[2],
            ) > 1e-5,
        ).length;
        const centre = moved.fragments.reduce(
          (sum, fragment) =>
            sum.map(
              (value, axis) =>
                value + fragment.position[axis] / moved.fragments.length,
            ),
          [0, 0, 0],
        );
        const distance = (a, b) =>
          Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        return {
          activeAtSpawn: live.active,
          totalCreated: live.totalCreated,
          visibleAtSpawn: live.visible,
          visibleTriangleMeshes,
          movementSamples: movedFragments,
          centre,
          currentPhysicsPosition: physicsRootPosition,
          staleRenderRootPosition,
          distanceToPhysicsRoot: distance(centre, physicsRootPosition),
          distanceToRenderRoot: distance(centre, staleRenderRootPosition),
          endMs: Math.max(...moved.fragments.map((fragment) => fragment.endMs)),
          updateStart,
        };
      },
      {
        startMs,
        physicsRootPosition: fixture.physicsRootPosition,
        staleRenderRootPosition: fixture.staleRenderRootPosition,
      },
    );
    assert.ok(
      fixture.shardLifecycle.activeAtSpawn > 0,
      JSON.stringify(fixture.shardLifecycle),
    );
    assert.ok(
      fixture.shardLifecycle.visibleAtSpawn > 0,
      JSON.stringify(fixture.shardLifecycle),
    );
    assert.ok(
      fixture.shardLifecycle.visibleTriangleMeshes > 0,
      JSON.stringify(fixture.shardLifecycle),
    );
    assert.ok(
      fixture.shardLifecycle.movementSamples > 0,
      JSON.stringify(fixture.shardLifecycle),
    );
    assert.ok(
      fixture.shardLifecycle.distanceToPhysicsRoot + 10 <
        fixture.shardLifecycle.distanceToRenderRoot,
      `shards followed stale render transform instead of current physics transform: ${JSON.stringify(fixture.shardLifecycle)}`,
    );
    fixture.shardLifecycle.expired = await page.evaluate(() => {
      const c = window.carma;
      const runtime = c.shards;
      const live = runtime.snapshot();
      const timeMs =
        Math.max(
          c.simulation.elapsed * 1000,
          ...live.fragments.map((fragment) => fragment.endMs),
        ) + 1;
      runtime.update(timeMs);
      const expired = runtime.snapshot();
      // Expire every fragment at its authored deadline, then remove the empty
      // fixture population without rewinding the runtime's monotonic clock.
      runtime.clear();
      return { ...expired, expiryAtMs: timeMs };
    });
    assert.equal(
      fixture.shardLifecycle.expired.active,
      0,
      `original ${name} WAM shards did not expire at authored lifetime`,
    );
  }

  report.glError = await page.evaluate(() =>
    document.querySelector("#view").getContext("webgl2").getError(),
  );
  assert.equal(report.glError, 0);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
  await writeFile(
    "artifacts/browser-wam-effects.json",
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify(report, null, 2));
