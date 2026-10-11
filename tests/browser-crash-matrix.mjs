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
    "SKIP crash matrix browser regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5212;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
let browser;
let page;
const report = { catalog: {}, cases: [], errors: [], failedRequests: [] };
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
    ],
  });
  page = await browser.newPage({
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

  const catalog = await page.evaluate(() => {
    const cars = [...document.querySelector("#car-select").options];
    const tracks = [...document.querySelector("#track-select").options];
    const findStockCar = (pattern) =>
      cars.find(
        (option) =>
          /^data\/CARS\//i.test(option.value) &&
          pattern.test(`${option.textContent} ${option.value}`),
      )?.value;
    const findTrack = (pattern) =>
      tracks.find((option) =>
        pattern.test(`${option.textContent} ${option.value}`),
      )?.value;
    return {
      stockTrack: findTrack(/NICE BEAVER/i),
      advancedTrack: tracks.find(
        (option) =>
          /^adv_data\//i.test(option.value) &&
          /carrier_mission\.txt$/i.test(option.value),
      )?.value,
      eagle3: findStockCar(/(?:^|[/\\])EAGLE3\.TXT|EAGLE\s*3/i),
      buggy: findStockCar(/(?:^|[/\\])BUGGY\.TXT|\bBUGGY\b/i),
      bigdump: findStockCar(/(?:^|[/\\])BIGDUMP\.TXT|\bBIGDUMP\b/i),
      porker2: findStockCar(/(?:^|[/\\])PORKER2\.TXT|\bPORKER\s*2\b/i),
      advancedCar: cars.find(
        (option) =>
          /^adv_data\/CARS\//i.test(option.value) &&
          /69mach1\.txt$/i.test(option.value),
      )?.value,
    };
  });
  report.catalog = catalog;
  for (const key of [
    "stockTrack",
    "advancedTrack",
    "eagle3",
    "buggy",
    "bigdump",
    "porker2",
    "advancedCar",
  ])
    assert.ok(catalog[key], `original catalog entry ${key} is absent`);

  const scenarios = [
    {
      name: "stock-eagle3-headon",
      track: catalog.stockTrack,
      car: catalog.eagle3,
      offset: 0,
      reverse: true,
    },
    {
      name: "stock-buggy-oblique",
      track: catalog.stockTrack,
      car: catalog.buggy,
      offset: 0.13,
      reverse: false,
    },
    {
      name: "stock-bigdump-headon",
      track: catalog.stockTrack,
      car: catalog.bigdump,
      offset: 0,
      reverse: false,
    },
    {
      name: "advanced-69mach1-oblique",
      track: catalog.advancedTrack,
      car: catalog.advancedCar,
      offset: 0.13,
      reverse: false,
    },
  ];

  for (const scenario of scenarios) {
    await page.evaluate(async ({ track, car }) => {
      const c = window.carma;
      document.querySelector("#track-select").value = track;
      document.querySelector("#car-select").value = car;
      await c.loadRace();
      c.paused = true;
      document.querySelector("#panel").hidden = true;
    }, scenario);
    await page.waitForFunction(
      () => window.carma.stats.ready && window.carma.opponentsReady,
      null,
      { timeout: 90000 },
    );

    const setup = await page.evaluate(
      ({ offset, name }) => {
        const c = window.carma;
        const player = c.player;
        const rivals = c.simulation.cars.filter(
          (car) => car !== player && !car.human,
        );
        const rival = rivals.sort(
          (a, b) =>
            Math.abs(a.properties.mass - player.properties.mass) -
            Math.abs(b.properties.mass - player.properties.mass),
        )[0];
        if (!rival)
          throw new Error("Loaded original race has no physical rival");
        for (const body of c.simulation.cars) {
          c.simulation.setCarPhysicsActive(
            body,
            body === player || body === rival,
          );
          body.input.throttle = 0;
          body.input.steer = 0;
          body.input.brake = false;
          body.state.velocity.set(0, 0, 0);
          body.state.angularVelocity.set(0, 0, 0);
          body.crashAccelerationKey = false;
        }
        if (c.opponentFleet) {
          const update = c.opponentFleet.update.bind(c.opponentFleet);
          c.opponentFleet.update = (...args) => {
            update(...args);
            for (const body of c.simulation.cars)
              c.simulation.setCarPhysicsActive(
                body,
                body === player || body === rival,
              );
            const ai = c.rivals.find((entry) => entry.body === rival);
            if (ai) {
              ai.body.state.accForce =
                ai.body.state.brakeForce =
                ai.body.state.curvature =
                  0;
              ai.body.input.throttle =
                ai.body.input.steer =
                ai.body.input.brake =
                  0;
            }
          };
        }
        const origin = player.state.position.clone();
        const forward = new player.state.position.constructor(0, 0, -1)
          .applyQuaternion(player.state.orientation)
          .normalize();
        const right = new player.state.position.constructor(0, 1, 0)
          .cross(forward)
          .normalize();
        player.state.heading = player.state.heading;
        c.simulation.reset(player);
        rival.state.position
          .copy(origin)
          .addScaledVector(forward, 5)
          .addScaledVector(right, offset);
        rival.state.heading = player.state.heading + Math.PI;
        c.simulation.reset(rival);
        rival.state.velocity.set(0, 0, 0);
        rival.state.angularVelocity.set(0, 0, 0);
        const record = {
          scenario: name,
          track: document.querySelector("#track-select").value,
          player: player.group.name,
          rival: rival.group.name,
          playerMass: player.properties.mass,
          rivalMass: rival.properties.mass,
          offset,
          before: [...player.damage.componentLevels],
          rivalBefore: [...rival.damage.componentLevels],
          revisionBefore: player.damage.deformationRevision,
          start: player.state.position.toArray(),
          attribution: [],
          structuralOutcomes: [],
          crashKeyObserved: false,
          startTime: c.simulation.elapsed,
          startCredits: c.race.credits,
        };
        const sim = c.simulation;
        const beforeStep = sim.onBeforeStep;
        sim.onBeforeStep = (...args) => {
          beforeStep?.(...args);
          record.crashKeyObserved ||= player.crashAccelerationKey;
        };
        const oldAttribution = sim.onCrashAttribution;
        sim.onCrashAttribution = (attacker, victim) => {
          record.attribution.push({
            attacker: attacker.group.name,
            victim: victim.group.name,
          });
          oldAttribution?.(attacker, victim);
        };
        for (const body of [player, rival]) {
          const applyImpact = body.damage.applyImpact.bind(body.damage);
          body.damage.applyImpact = (...args) => {
            const beforeRevision = body.damage.deformationRevision;
            const result = applyImpact(...args);
            if (record.structuralOutcomes.length < 32)
              record.structuralOutcomes.push({
                car: body.group.name,
                queuedForce: result.queuedForce,
                maxInfluence: result.maxInfluence,
                markedForBend: result.markedForBend ?? false,
                bendCase: result.bendCase ?? null,
                beforeRevision,
                afterRevision: body.damage.deformationRevision,
              });
            return result;
          };
        }
        window.__crashMatrix = { record, player, rival };
        window.__crashMatrixUntil = sim.elapsed + 16;
        c.paused = false;
        return { time: sim.elapsed, rivalCount: rivals.length };
      },
      { offset: scenario.offset, name: scenario.name },
    );
    assert.ok(setup.rivalCount > 0);

    await page.keyboard.down("w");
    await page.waitForFunction(
      () =>
        window.__crashMatrix.record.attribution.length > 0 ||
        window.carma.simulation.elapsed >= window.__crashMatrixUntil,
      null,
      { timeout: 25000 },
    );
    await page.keyboard.up("w");
    const impact = await page.evaluate(() => {
      const c = window.carma;
      c.paused = true;
      const { record, player, rival } = window.__crashMatrix;
      record.elapsed = c.simulation.elapsed;
      record.crashKeyObserved =
        record.crashKeyObserved || player.crashAccelerationKey;
      record.after = [...player.damage.componentLevels];
      record.rivalAfter = [...rival.damage.componentLevels];
      record.deformationRevision = player.damage.deformationRevision;
      record.rivalDeformationRevision = rival.damage.deformationRevision;
      record.deformationObserved =
        record.deformationRevision + record.rivalDeformationRevision > 0;
      record.knackered = player.knackered || player.damage.wasted;
      record.rivalKnackered = rival.knackered || rival.damage.wasted;
      record.positionAfter = player.state.position.toArray();
      record.imageReady =
        c.stats.ready && document.querySelector("#view").width > 0;
      record.damageDelta = record.after.reduce(
        (sum, value, i) => sum + Math.max(0, value - record.before[i]),
        0,
      );
      record.rivalDamageDelta = record.rivalAfter.reduce(
        (sum, value, i) => sum + Math.max(0, value - record.rivalBefore[i]),
        0,
      );
      return record;
    });
    assert.ok(impact.elapsed > impact.startTime, JSON.stringify(impact));
    assert.ok(
      impact.crashKeyObserved,
      `W did not enter crash acceleration: ${JSON.stringify(impact)}`,
    );
    assert.ok(
      impact.attribution.some(
        (event) =>
          event.attacker === impact.player && event.victim === impact.rival,
      ),
      JSON.stringify(impact),
    );
    assert.ok(
      impact.damageDelta > 0 || impact.rivalDamageDelta > 0,
      `no authored component damage: ${JSON.stringify(impact)}`,
    );
    assert.ok(impact.imageReady, JSON.stringify(impact));

    const result = { impact, reverse: null, repair: null, severeChain: null };
    report.currentCase = result;
    if (scenario.name === "stock-eagle3-headon") {
      await page.keyboard.press("c");
      await page.keyboard.press("c");
      await page.evaluate(() => {
        document.querySelector("#panel").hidden = true;
      });
      await page.screenshot({
        path: "artifacts/browser-crash-matrix-eagle3-impact.png",
      });
    }
    if (scenario.reverse && !impact.knackered) {
      const repairBefore = await page.evaluate(() => {
        const { rival, player } = window.__crashMatrix;
        return {
          components: [...rival.damage.componentLevels],
          revision: rival.damage.deformationRevision,
          nearObstacle:
            rival.state.position.distanceTo(player.state.position) < 10,
          wasted: rival.knackered || rival.damage.wasted,
        };
      });
      result.repairBefore = repairBefore;
      assert.ok(
        repairBefore.components.some((value) => value > 0),
        JSON.stringify(repairBefore),
      );
      assert.ok(
        repairBefore.nearObstacle && !repairBefore.wasted,
        JSON.stringify(repairBefore),
      );
      await page.evaluate(() =>
        window.carma.simulation.repair(window.__crashMatrix.rival),
      );
      result.repair = await page.evaluate(() => {
        const { rival, player } = window.__crashMatrix;
        return {
          components: [...rival.damage.componentLevels],
          revision: rival.damage.deformationRevision,
          nearObstacle:
            rival.state.position.distanceTo(player.state.position) < 10,
        };
      });
      assert.ok(
        result.repair.components.every((value) => value === 0),
        JSON.stringify(result.repair),
      );
      assert.ok(
        result.repair.revision > repairBefore.revision,
        JSON.stringify(result.repair),
      );
      assert.ok(result.repair.nearObstacle, JSON.stringify(result.repair));
      await page.evaluate(() => {
        document.querySelector("#panel").hidden = true;
      });
      await page.screenshot({
        path: "artifacts/browser-crash-matrix-eagle3-repaired.png",
      });

      const reverseSetup = await page.evaluate(() => {
        const c = window.carma;
        const player = c.player;
        window.__crashReverseStart = player.state.position.clone();
        window.__crashReverseUntil = c.simulation.elapsed + 7;
        c.paused = false;
      });
      await page.keyboard.down("ArrowDown");
      await page.waitForFunction(
        () => window.carma.simulation.elapsed >= window.__crashReverseUntil,
        null,
        { timeout: 15000 },
      );
      await page.keyboard.up("ArrowDown");
      result.reverse = await page.evaluate(() => {
        const c = window.carma;
        c.paused = true;
        return {
          distance: c.player.state.position.distanceTo(
            window.__crashReverseStart,
          ),
          gear: c.player.state.gear,
          position: c.player.state.position.toArray(),
        };
      });
      assert.ok(result.reverse.distance > 0.5, JSON.stringify(result.reverse));

      // Accumulate further contacts through the normal fixed-step contact and
      // applyImpactDamage pipeline while the car remains beside its obstacle.
      result.severeChain = await page.evaluate(() => {
        const c = window.carma;
        const { player, rival } = window.__crashMatrix;
        const before = [...rival.damage.componentLevels];
        const revision = rival.damage.deformationRevision;
        const splitRevision = rival.damage.splitRevision;
        const debrisBefore = c.simulation.debris.filter(
          (body) => body.owner === rival,
        ).length;
        const direction = player.state.position
          .clone()
          .sub(rival.state.position)
          .normalize();
        player.state.position
          .copy(rival.state.position)
          .addScaledVector(direction, 5);
        player.state.velocity.copy(direction).multiplyScalar(-45);
        player.state.angularVelocity.set(0, 0, 0);
        player.state.predictedPosition = undefined;
        player.state.predictedOrientation = undefined;
        for (let i = 0; i < 24 && !rival.knackered; i++) c.simulation.step();
        // This fixture advances the production fixed-step simulation while
        // paused, so frame-driven chase-camera history is intentionally stale.
        // Reframe the actual world camera around the damaged rival for capture.
        const cameraOffset = new rival.state.position.constructor(0, 1.8, 3.5);
        c.camera.position.copy(rival.state.position).add(cameraOffset);
        c.camera.lookAt(rival.state.position);
        return {
          before,
          after: [...rival.damage.componentLevels],
          revisionBefore: revision,
          revisionAfter: rival.damage.deformationRevision,
          damagedComponentCount: rival.damage.componentLevels.filter(
            (level) => level > 0,
          ).length,
          splitBefore: splitRevision,
          splitAfter: rival.damage.splitRevision,
          snapped: rival.damage.snapped,
          debrisBefore,
          debrisAfter: c.simulation.debris.filter(
            (body) => body.owner === rival,
          ).length,
          wasted: rival.knackered || rival.damage.wasted,
          nearby: player.state.position.distanceTo(rival.state.position),
          geometry: rival.shapeVertices
            .flat()
            .some((point) => point.length() > 0),
        };
      });
      assert.ok(
        result.severeChain.after.some(
          (value, i) => value > result.severeChain.before[i],
        ),
        JSON.stringify(result.severeChain),
      );
      assert.ok(
        result.severeChain.damagedComponentCount > 1,
        JSON.stringify(result.severeChain),
      );
      assert.ok(
        result.severeChain.nearby < 10,
        JSON.stringify(result.severeChain),
      );
      if (result.severeChain.wasted) {
        report.evidence = report.evidence || {};
        report.evidence.wastedObserved = true;
      }
      if (result.severeChain.snapped) {
        assert.ok(
          result.severeChain.splitAfter > result.severeChain.splitBefore &&
            result.severeChain.debrisAfter > result.severeChain.debrisBefore,
          JSON.stringify(result.severeChain),
        );
      }
      report.evidence = {
        ...report.evidence,
        splitObserved: result.severeChain.snapped,
      };
      await page.evaluate(() => {
        document.querySelector("#panel").hidden = true;
      });
      await page.screenshot({
        path: "artifacts/browser-crash-matrix-eagle3-severe.png",
      });
    }
    report.cases.push(result);
  }

  // The stock Porker2 WAM has authored positive snappability. Build component
  // damage through ordinary physical contacts, then exercise native SPAM's
  // simulation entry point with a deterministic random stream. This retains
  // the real spamModel plane request, world validation, split and debris paths.
  await page.evaluate(
    async ({ track, car }) => {
      const c = window.carma;
      document.querySelector("#track-select").value = track;
      document.querySelector("#car-select").value = car;
      await c.loadRace();
      c.paused = true;
      document.querySelector("#panel").hidden = true;
    },
    { track: catalog.stockTrack, car: catalog.porker2 },
  );
  await page.waitForFunction(
    () => window.carma.stats.ready && window.carma.opponentsReady,
    null,
    { timeout: 90000 },
  );
  const splitCase = await page.evaluate(() => {
    const c = window.carma;
    const sim = c.simulation;
    const target = c.player;
    const source = sim.cars.find((body) => body !== target && !body.human);
    if (!source) throw new Error("Porker2 split fixture has no original rival");
    const snappability = target.damage.wam?.snappability ?? 0;
    if (snappability <= 0)
      throw new Error(
        `Original Porker2 has no positive snappability (${snappability})`,
      );
    for (const body of sim.cars) {
      sim.setCarPhysicsActive(body, body === target || body === source);
      body.input.throttle = 0;
      body.input.steer = 0;
      body.input.brake = false;
      body.state.velocity.set(0, 0, 0);
      body.state.angularVelocity.set(0, 0, 0);
    }
    const origin = target.state.position.clone();
    const forward = new target.state.position.constructor(0, 0, -1)
      .applyQuaternion(target.state.orientation)
      .normalize();
    const oldRandom = target.damage.damageContext.random;
    const sourceRandom = source.damage.damageContext.random;
    target.damage.damageContext.random = () => 0.5;
    source.damage.damageContext.random = () => 0.5;
    const history = [];
    try {
      const approaches = [
        forward.clone(),
        new forward.constructor(1, 0, 0).applyQuaternion(
          target.state.orientation,
        ),
        forward.clone().negate(),
        new forward.constructor(-1, 0, 0).applyQuaternion(
          target.state.orientation,
        ),
      ];
      const condition = () => {
        const levels = target.damage.componentLevels;
        const groups = [
          levels[0],
          levels[1],
          levels[2],
          Math.trunc((levels[8] + levels[9] + levels[10] + levels[11]) / 4),
        ];
        return groups.every((level) => level <= 75)
          ? Math.max(
              25,
              100 -
                Math.trunc(groups.reduce((sum, level) => sum + level, 0) / 4),
            )
          : 100 - Math.max(...groups);
      };
      const pendingParts = () =>
        target.damage.runtimeParts.flatMap((part, index) =>
          part.state.queuedAt !== null ||
          part.state.phase !== 0 ||
          part.forcedFullDetach
            ? [
                {
                  index,
                  actor: part.actor.name,
                  type: part.state.type,
                  phase: part.state.phase,
                  queuedAt: part.state.queuedAt,
                  forcedFullDetach: !!part.forcedFullDetach,
                },
              ]
            : [],
        );
      for (const speed of [8, 9, 10, 11, 12, 13, 14, 15, 16]) {
        for (const approach of approaches) {
          target.state.position.copy(origin);
          target.state.velocity.set(0, 0, 0);
          target.state.angularVelocity.set(0, 0, 0);
          sim.reset(target);
          source.state.position.copy(origin).addScaledVector(approach, 5);
          source.state.heading = target.state.heading + Math.PI;
          source.state.velocity.copy(approach).multiplyScalar(-speed);
          source.state.angularVelocity.set(0, 0, 0);
          sim.reset(source);
          source.state.velocity.copy(approach).multiplyScalar(-speed);
          const beforeContact = [...target.damage.componentLevels];
          for (let step = 0; step < 45; step++) {
            sim.step();
            if (
              target.damage.componentLevels.some(
                (level, index) => level !== beforeContact[index],
              ) ||
              target.knackered ||
              target.damage.wasted
            )
              break;
          }
          history.push({
            speed,
            approach: approach.toArray(),
            components: [...target.damage.componentLevels],
            condition: condition(),
            wasted: target.knackered || target.damage.wasted,
          });
          if (condition() < 75 || target.knackered || target.damage.wasted)
            break;
        }
        if (condition() < 75 || target.knackered || target.damage.wasted) break;
      }
      const supplementalImpacts = [];
      if (condition() >= 75 && !target.knackered && !target.damage.wasted) {
        // The physical contacts above are retained as genuine evidence. If
        // they do not cross the snap condition before ordinary wastage, use
        // controlled impacts through DamageSystem.applyImpact to exercise the
        // authored component/crush program, never by assigning health values.
        source.state.position
          .copy(target.state.position)
          .add(new target.state.position.constructor(1000, 0, 0));
        source.state.velocity.set(0, 0, 0);
        sim.reset(source);
        const bounds = target.damage.bounds;
        const center = bounds.getCenter(
          new target.state.position.constructor(),
        );
        for (const [axis, sign] of [
          [2, -1],
          [2, 1],
          [0, -1],
          [1, -1],
          [1, -1],
          [1, -1],
          [1, -1],
          [1, -1],
          [1, -1],
          [1, -1],
        ]) {
          if (condition() < 75 || target.knackered || target.damage.wasted)
            break;
          const point = center.clone();
          point.setComponent(
            axis,
            sign < 0
              ? bounds.min.getComponent(axis)
              : bounds.max.getComponent(axis),
          );
          const energy = new target.state.position.constructor();
          energy.setComponent(axis, sign * 0.5);
          const impact = target.damage.applyImpact(
            [point],
            energy,
            true,
            false,
            sim.elapsed * 1000,
            energy,
            point,
          );
          supplementalImpacts.push({
            axis,
            sign,
            energy: 0.5,
            componentEvents: impact.componentEvents?.map((event) => ({
              systemIndex: event.systemIndex,
              increment: event.increment,
            })),
            queuedForce: impact.queuedForce,
            maxInfluence: impact.maxInfluence,
            condition: condition(),
            wasted: target.knackered || target.damage.wasted,
          });
          sim.step();
        }
      }
      if (condition() >= 75)
        throw new Error(
          `Porker2 did not reach the native snap-eligible condition gate: ${JSON.stringify({ history, supplementalImpacts })}`,
        );
      const before = [...target.damage.componentLevels];
      const revisionBefore = target.damage.deformationRevision;
      const splitBefore = target.damage.splitRevision;
      const massBefore = target.properties.mass;
      const spamPreconditions = {
        elapsed: sim.elapsed,
        condition: condition(),
        wasted: target.knackered || target.damage.wasted,
        snapped: target.damage.snapped,
        structuralBend: !!target.damage.structuralBend,
        components: [...target.damage.componentLevels],
        impactRngFixture: "constant 0.5",
        pendingParts: pendingParts(),
      };
      let randomCalls = 0;
      target.damage.damageContext.random = () => {
        randomCalls++;
        return 0;
      };
      const spam = sim.spamCar(target, 0.1);
      const snapped = target.damage.snapped;
      const secondary = sim.debris.find(
        (body) => body.owner === target && body.part < 0,
      );
      const splitState = {
        snappability,
        history,
        supplementalImpacts,
        spamPreconditions,
        before,
        after: [...target.damage.componentLevels],
        revisionBefore,
        revisionAfter: target.damage.deformationRevision,
        splitBefore,
        splitAfter: target.damage.splitRevision,
        snapped,
        randomCalls,
        spamRays: spam?.rays.length ?? 0,
        spamSplitRequest: !!spam?.splitRequest,
        massBefore,
        massAfterRoot: target.properties.mass,
        debrisCount: sim.debris.filter((body) => body.owner === target).length,
        jointedDebris: sim.debris
          .filter((body) => body.owner === target && body.joint)
          .map((body) => ({
            part: body.part,
            parentPart: body.joint.parent.part,
          })),
        secondary: secondary
          ? {
              mass: secondary.properties.mass,
              velocity: secondary.state.velocity.toArray(),
              position: secondary.state.position.toArray(),
              part: secondary.part,
            }
          : null,
        wasted: target.knackered || target.damage.wasted,
        pendingParts: pendingParts(),
      };
      if (!snapped || !secondary)
        throw new Error(
          `Original Porker2 SPAM did not split through simulation: ${JSON.stringify(splitState)}`,
        );
      const secondaryStart = secondary.state.position.clone();
      const jointTimeline = [];
      let peakJointCount = 0;
      let previousJointParts = "";
      for (let i = 0; i < 180; i++) {
        sim.step();
        const jointed = sim.debris
          .filter((body) => body.owner === target && body.joint)
          .map((body) => body.part)
          .sort((a, b) => a - b);
        peakJointCount = Math.max(peakJointCount, jointed.length);
        const signature = JSON.stringify(jointed);
        if (signature !== previousJointParts) {
          jointTimeline.push({
            step: i + 1,
            elapsedMs: sim.elapsed * 1000,
            jointedParts: jointed,
          });
          previousJointParts = signature;
        }
      }
      splitState.secondaryAfterSimulationWindow =
        secondary.state.position.toArray();
      splitState.secondaryMoved =
        secondary.state.position.distanceTo(secondaryStart) > 0;
      splitState.simulatedWindowMs = (180 / 24) * 1000;
      splitState.jointTimeline = jointTimeline;
      splitState.peakJointCount = peakJointCount;
      splitState.debrisCountAfterWindow = sim.debris.filter(
        (body) => body.owner === target,
      ).length;
      splitState.jointedDebrisAfterWindow = sim.debris
        .filter((body) => body.owner === target && body.joint)
        .map((body) => ({
          part: body.part,
          parentPart: body.joint.parent.part,
        }));
      splitState.pendingPartsAfterWindow = pendingParts();
      splitState.secondaryFinite = [
        ...secondary.state.position.toArray(),
        ...secondary.state.velocity.toArray(),
        ...secondary.state.angularVelocity.toArray(),
      ].every(Number.isFinite);
      splitState.massConserved =
        Math.abs(
          sim.debris
            .filter((body) => body.owner === target && body.part < 0)
            .reduce(
              (sum, body) => sum + body.properties.mass,
              target.properties.mass,
            ) - massBefore,
        ) < 1e-6;
      const beforeRepair = {
        snapped: target.damage.snapped,
        wasted: target.knackered || target.damage.wasted,
        debrisCount: sim.debris.filter((body) => body.owner === target).length,
      };
      sim.repair(target);
      sim.step();
      splitState.repair = {
        before: beforeRepair,
        snappedAfter: target.damage.snapped,
        splitRevisionAfter: target.damage.splitRevision,
        debrisAfter: sim.debris.filter((body) => body.owner === target).length,
        componentLevelsAfter: [...target.damage.componentLevels],
        wastedAfter: target.knackered || target.damage.wasted,
      };
      splitState.camera = {
        position: target.state.position.toArray(),
        target: target.state.position.toArray(),
      };
      const focus = target.state.position;
      c.camera.position.copy(focus).add(new focus.constructor(0, 2, 4));
      c.camera.lookAt(focus);
      return splitState;
    } finally {
      target.damage.damageContext.random = oldRandom;
      source.damage.damageContext.random = sourceRandom;
    }
  });
  assert.ok(splitCase.snappability > 0, JSON.stringify(splitCase));
  assert.ok(
    splitCase.spamRays > 0 && splitCase.spamSplitRequest,
    JSON.stringify(splitCase),
  );
  assert.ok(
    splitCase.snapped && splitCase.secondary,
    JSON.stringify(splitCase),
  );
  assert.ok(splitCase.massConserved, JSON.stringify(splitCase));
  assert.ok(splitCase.secondaryMoved && splitCase.secondaryFinite);
  assert.equal(
    splitCase.repair.wastedAfter,
    splitCase.repair.before.wasted,
    `full repair must preserve the prior WASTED state: ${JSON.stringify(splitCase)}`,
  );
  if (!splitCase.repair.before.wasted) {
    assert.equal(
      splitCase.repair.snappedAfter,
      false,
      JSON.stringify(splitCase),
    );
    assert.ok(
      splitCase.repair.debrisAfter < splitCase.repair.before.debrisCount,
      JSON.stringify(splitCase),
    );
    assert.ok(
      splitCase.repair.componentLevelsAfter.every((level) => level === 0),
      JSON.stringify(splitCase),
    );
  }
  report.splitCase = splitCase;
  report.evidence = {
    ...report.evidence,
    splitObserved: true,
    multipleJointLinksObserved: splitCase.peakJointCount >= 2,
  };
  await page.evaluate(() => {
    document.querySelector("#panel").hidden = true;
  });
  await page.screenshot({
    path: "artifacts/browser-crash-matrix-porker2-split-repair.png",
  });

  // Exercise original Eagle3 semi-detached bodywork through the ordinary
  // DamageSystem.applyImpact -> applyQueuedCrush -> shared scheduling path.
  // This fixture is independent of the W-driven matrix and SPAM split above.
  await page.evaluate(
    async ({ track, car }) => {
      const c = window.carma;
      document.querySelector("#track-select").value = track;
      document.querySelector("#car-select").value = car;
      await c.loadRace();
      c.paused = true;
      document.querySelector("#panel").hidden = true;
    },
    { track: catalog.stockTrack, car: catalog.eagle3 },
  );
  await page.waitForFunction(
    () => window.carma.stats.ready && window.carma.opponentsReady,
    null,
    { timeout: 90000 },
  );
  const jointCase = await page.evaluate(() => {
    const c = window.carma;
    const sim = c.simulation;
    const target = c.player;
    for (const body of sim.cars) {
      sim.setCarPhysicsActive(body, body === target);
      body.input.throttle = 0;
      body.input.steer = 0;
      body.input.brake = false;
      body.state.velocity.set(0, 0, 0);
      body.state.angularVelocity.set(0, 0, 0);
    }
    const oldRandom = target.damage.damageContext.random;
    target.damage.damageContext.random = () => 0.5;
    const findPart = (fragment) =>
      target.damage.runtimeParts.find((part) =>
        part.actor.name.toUpperCase().includes(fragment),
      );
    const front = findPart("FBMP");
    const rear = findPart("RBMP");
    if (!front || !rear)
      throw new Error("Original Eagle3 front/rear bumper WAM records missing");
    const targets = [front, rear].map((part) => ({
      index: target.damage.runtimeParts.indexOf(part),
      actor: part.actor.name,
      type: part.part.type,
      stateType: part.state.type,
      phaseBefore: part.state.phase,
      ease: part.part.ease,
      bounds: [part.bounds.min.toArray(), part.bounds.max.toArray()],
    }));
    if (targets.some((part) => part.stateType !== 1 || part.phaseBefore !== 0))
      throw new Error(
        `Expected attached Eagle3 semi-detached WAM parts: ${JSON.stringify(targets)}`,
      );
    const origin = target.state.position.clone();
    const impacts = [];
    const impactPart = (part, sign) => {
      const point = part.bounds.getCenter(
        new target.state.position.constructor(),
      );
      const energy = new target.state.position.constructor(0, 0, sign * 1);
      const beforeRevision = target.damage.deformationRevision;
      const result = target.damage.applyImpact(
        [point],
        energy,
        true,
        true,
        sim.elapsed * 1000,
        energy,
        point,
      );
      sim.step();
      impacts.push({
        part: part.actor.name,
        sign,
        timeMs: sim.elapsed * 1000,
        queuedForce: result.queuedForce,
        maxInfluence: result.maxInfluence,
        markedForBend: result.markedForBend ?? false,
        deformationRevisionBefore: beforeRevision,
        deformationRevisionAfter: target.damage.deformationRevision,
        levels: [...target.damage.componentLevels],
        scheduled: [front, rear].map((record) => ({
          actor: record.actor.name,
          queuedAt: record.state.queuedAt,
          accumulatedForce: record.state.accumulatedForce,
          phase: record.state.phase,
        })),
      });
    };
    const detachTimeline = [];
    let peakJointCount = 0;
    let previousJointParts = "";
    try {
      // Front/rear body ends exercise their actual bumper WAM geometry and
      // ordinary crush influence. Native shared queue spacing remains intact.
      impactPart(front, -1);
      impactPart(rear, 1);
      impactPart(front, -1);
      impactPart(rear, 1);
      for (let i = 0; i < 240; i++) {
        sim.step();
        const jointed = sim.debris
          .filter((body) => body.owner === target && body.joint)
          .map((body) => body.part)
          .sort((a, b) => a - b);
        peakJointCount = Math.max(peakJointCount, jointed.length);
        const signature = JSON.stringify(jointed);
        if (signature !== previousJointParts) {
          detachTimeline.push({
            step: i + 1,
            elapsedMs: sim.elapsed * 1000,
            jointedParts: jointed,
            scheduled: [front, rear].map((record) => ({
              actor: record.actor.name,
              queuedAt: record.state.queuedAt,
              accumulatedForce: record.state.accumulatedForce,
              phase: record.state.phase,
            })),
          });
          previousJointParts = signature;
        }
      }
      const beforeRepair = {
        jointedParts: sim.debris
          .filter((body) => body.owner === target && body.joint)
          .map((body) => body.part),
        debrisCount: sim.debris.filter((body) => body.owner === target).length,
        pending: [front, rear].map((record) => ({
          actor: record.actor.name,
          phase: record.state.phase,
          queuedAt: record.state.queuedAt,
          accumulatedForce: record.state.accumulatedForce,
        })),
        wasted: target.knackered || target.damage.wasted,
        components: [...target.damage.componentLevels],
      };
      sim.repair(target);
      sim.step();
      return {
        car: target.group.name,
        elapsedStart: impacts[0]?.timeMs,
        elapsedEnd: sim.elapsed * 1000,
        origin: origin.toArray(),
        targets,
        impacts,
        detachTimeline,
        peakJointCount,
        beforeRepair,
        afterRepair: {
          jointedParts: sim.debris
            .filter((body) => body.owner === target && body.joint)
            .map((body) => body.part),
          debrisCount: sim.debris.filter((body) => body.owner === target)
            .length,
          snapped: target.damage.snapped,
          wasted: target.knackered || target.damage.wasted,
          components: [...target.damage.componentLevels],
        },
      };
    } finally {
      target.damage.damageContext.random = oldRandom;
    }
  });
  assert.ok(
    jointCase.targets.length === 2 &&
      jointCase.targets.every((part) => part.stateType === 1),
    JSON.stringify(jointCase),
  );
  assert.ok(jointCase.impacts.every((impact) => impact.queuedForce > 0));
  assert.ok(
    jointCase.peakJointCount >= 2,
    `ordinary Eagle3 crush should produce multiple joint links: ${JSON.stringify(jointCase)}`,
  );
  assert.equal(
    jointCase.afterRepair.jointedParts.length,
    0,
    JSON.stringify(jointCase),
  );
  assert.equal(jointCase.afterRepair.debrisCount, 0, JSON.stringify(jointCase));
  assert.deepEqual(
    jointCase.afterRepair.components,
    Array(12).fill(0),
    JSON.stringify(jointCase),
  );
  report.jointCase = jointCase;
  report.evidence = {
    ...report.evidence,
    multipleJointLinksObserved: jointCase.peakJointCount >= 2,
  };

  const glError = await page.evaluate(() =>
    document.querySelector("#view").getContext("webgl2").getError(),
  );
  assert.equal(glError, 0, `WebGL error ${glError}`);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  report.glError = glError;
  await writeFile(
    "artifacts/browser-crash-matrix.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = String(error);
  if (page && !page.isClosed())
    report.failureState = await page
      .evaluate(() => ({
        cars: window.carma?.simulation.cars.map((car) => ({
          name: car.group.name,
          deformationRevision: car.damage.deformationRevision,
          shapeRevision: car.revision,
          shapes: car.shapeVertices.map((shape) =>
            shape.map((point) => point.toArray()),
          ),
        })),
      }))
      .catch((captureError) => ({ captureError: String(captureError) }));
  await writeFile(
    "artifacts/browser-crash-matrix-failure.json",
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
