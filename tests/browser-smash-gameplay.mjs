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
    "SKIP smash gameplay browser regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5213;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
let browser;
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
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const errors = [];
  const failedRequests = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`),
  );

  await page.goto(`http://localhost:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });

  const chooseTrack = async (root, pattern) =>
    page.evaluate(
      ({ root, pattern }) => {
        const expression = new RegExp(pattern, "i");
        const options = [...document.querySelector("#track-select").options];
        const matches = options.filter(
          (option) =>
            option.value.toLowerCase().startsWith(root.toLowerCase()) &&
            expression.test(`${option.value} ${option.textContent}`),
        );
        matches.sort(
          (a, b) =>
            Number(new RegExp(pattern, "i").test(b.value)) -
            Number(new RegExp(pattern, "i").test(a.value)),
        );
        if (!matches[0])
          throw new Error(`No ${root} race catalog entry matches ${pattern}`);
        return matches[0].value;
      },
      { root, pattern },
    );

  const loadRace = async (root, pattern) => {
    const track = await chooseTrack(root, pattern);
    await page.evaluate(async (path) => {
      const c = window.carma;
      const car = c.assets.resolve("data/CARS/EAGLE3/EAGLE3.TXT");
      if (!car) throw new Error("Stock EAGLE3 car is absent");
      document.querySelector("#track-select").value = path;
      document.querySelector("#car-select").value = car;
      await c.loadRace();
      c.paused = true;
      document.querySelector("#panel").hidden = true;
    }, track);
    await page.waitForFunction(
      () => window.carma.stats.ready && window.carma.paused,
      null,
      { timeout: 90000 },
    );
    const snapshot = await page.evaluate(() => {
      const c = window.carma;
      return {
        path: document.querySelector("#track-select").value,
        name: c.raceDefinition?.name,
        status: c.race.status,
        raceType: c.raceDefinition?.raceType,
      };
    });
    await page.screenshot({
      path: `artifacts/browser-smash-gameplay-${root.replace(/\W/g, "")}-${pattern.replace(/\W/g, "").toLowerCase()}.png`,
    });
    return snapshot;
  };

  const findCandidate = (requirements) =>
    page.evaluate((requirements) => {
      const c = window.carma;
      const destruction = c.simulation.destruction;
      if (!destruction)
        throw new Error("Loaded race has no destruction system");
      const candidates = [];
      const inventory = [];
      for (const [specIndex, spec] of destruction.specs.entries()) {
        const connotations = [
          ...(spec.connotations ? [spec.connotations] : []),
          ...spec.levels.map((level) => level.connotations),
        ];
        for (const [connotationIndex, data] of connotations.entries()) {
          const item = {
            specIndex,
            connotationIndex,
            trigger: spec.trigger,
            mode: spec.mode,
            roomCode: data.roomCode,
            award: data.award,
            variableChanges: data.variableChanges,
            actorCount: destruction.retainActors.filter((actor) =>
              actor.userData.worldSmashSpecIndices?.includes(specIndex),
            ).length,
          };
          inventory.push(item);
          if (
            spec.mode !== requirements.mode ||
            (requirements.triggerPattern &&
              !new RegExp(requirements.triggerPattern, "i").test(
                spec.trigger.name ?? "",
              )) ||
            (requirements.roomCode !== undefined &&
              data.roomCode !== requirements.roomCode) ||
            (requirements.awardFirst !== undefined &&
              data.award.first !== requirements.awardFirst) ||
            (requirements.awardSecond !== undefined &&
              data.award.second !== requirements.awardSecond) ||
            (requirements.frequency &&
              data.award.frequency !== requirements.frequency)
          )
            continue;
          const actor = destruction.retainActors.find(
            (candidate) =>
              candidate.visible &&
              candidate.userData.worldSmashSpecIndices?.includes(specIndex),
          );
          if (actor) candidates.push({ actor, spec, specIndex, data, item });
        }
      }
      if (!candidates.length)
        throw new Error(
          `No matching world target; inventory=${JSON.stringify(inventory)}`,
        );
      const { actor, spec, specIndex, data, item } = candidates[0];
      const point = actor.getWorldPosition(new actor.position.constructor());
      return {
        specIndex,
        spec: {
          mode: spec.mode,
          trigger: spec.trigger,
          removalThreshold: spec.removalThreshold,
        },
        actor: actor.name,
        actorPosition: point.toArray(),
        connotation: {
          roomCode: data.roomCode,
          award: data.award,
          variableChanges: data.variableChanges,
        },
        inventory,
      };
    }, requirements);

  const runCarrierCore = (target, enableTimeAwards = false) =>
    page.evaluate(
      async (target) => {
        const c = window.carma;
        const destruction = c.simulation.destruction;
        const variable = c.raceDefinition.smashVariable;
        const goal = c.raceDefinition.smashTarget;
        const hasObjective = variable != null && Number.isFinite(goal);
        const value = () =>
          hasObjective ? c.missionVariables.get(variable) : null;
        const player = c.player;
        player.state.position.set(100000, 100000, 100000);
        c.simulation.sync(player);
        const beforePrep = value();
        const usedActors = new Set();
        const prepImpacts = [];
        for (const [specIndex, spec] of destruction.specs.entries()) {
          if (
            !hasObjective ||
            specIndex === target.specIndex ||
            !["remove", "replacemodel"].includes(spec.mode) ||
            !spec.connotations?.variableChanges?.some(
              ([address, delta]) => address === variable && delta === 1,
            )
          )
            continue;
          for (const actor of destruction.retainActors) {
            if (
              value() >= goal - 1 ||
              !actor.visible ||
              usedActors.has(actor.uuid) ||
              !actor.userData.worldSmashSpecIndices?.includes(specIndex)
            )
              continue;
            usedActors.add(actor.uuid);
            const point = actor.getWorldPosition(
              new actor.position.constructor(),
            );
            const result = destruction.handleContact({
              actor,
              normalImpulse: Math.max(1000, (spec.removalThreshold ?? 0) + 1),
              kind: "body",
              bodyActor: player.group,
              impacteeVelocity: player.state.velocity,
              impacteeTransform: player.group.matrixWorld,
              point,
              timeMs: Math.max(1000, destruction.timeMs + 1),
            });
            prepImpacts.push({
              specIndex,
              actor: actor.name,
              changed: result.changed,
              value: value(),
            });
          }
        }
        let seededMissionVariableDelta = 0;
        if (hasObjective && value() < goal - 1 && goal - 1 - value() === 1) {
          // The installed stock scene exposes seventeen pre-core world targets;
          // seed the final objective boundary, never credits or award state.
          seededMissionVariableDelta = 1;
          c.missionVariables.add(variable, seededMissionVariableDelta);
        }
        if (hasObjective && value() !== goal - 1)
          throw new Error(
            `Carrier prep stopped at ${value()}, expected ${goal - 1}; prep=${JSON.stringify(prepImpacts)}`,
          );
        const actor = destruction.retainActors.find(
          (entry) =>
            entry.visible &&
            entry.userData.worldSmashSpecIndices?.includes(target.specIndex),
        );
        if (!actor)
          throw new Error(
            "Carrier core actor disappeared before final contact",
          );
        const point = actor.getWorldPosition(new actor.position.constructor());
        player.state.position.copy(point).add(new point.constructor(1, 0, 0));
        c.simulation.sync(player);
        const priorTimeAwardGate = c.race.disableTimeAwards;
        if (target.enableTimeAwards) c.race.disableTimeAwards = false;
        const before = {
          credits: c.race.credits,
          timeLeft: c.race.timeLeft,
          status: c.race.status,
          variable: value(),
        };
        const messageElement = document.querySelector("#message");
        const textContentDescriptor = Object.getOwnPropertyDescriptor(
          Node.prototype,
          "textContent",
        );
        const messageHistory = [];
        Object.defineProperty(messageElement, "textContent", {
          configurable: true,
          get() {
            return textContentDescriptor.get.call(this);
          },
          set(message) {
            messageHistory.push(String(message));
            textContentDescriptor.set.call(this, message);
          },
        });
        const result = destruction.handleContact({
          actor,
          normalImpulse: Math.max(1000, (target.threshold ?? 0) + 1),
          kind: "body",
          bodyActor: player.group,
          impacteeVelocity: player.state.velocity,
          impacteeTransform: player.group.matrixWorld,
          point: point.clone(),
          timeMs: Math.max(1000, destruction.timeMs + 1),
        });
        delete messageElement.textContent;
        const textPath = c.assets.resolve(
          `${document.querySelector("#track-select").value.split("/")[0]}/TEXT.TXT`,
        );
        const text132 = textPath
          ? (await c.assets.text(textPath))
              .split(/\r?\n/)
              .filter(
                (line) => line.trim() && !line.trim().startsWith("//"),
              )[132]
          : undefined;
        return {
          beforePrep,
          seededMissionVariableDelta,
          priorTimeAwardGate,
          timeAwardGateOverride: target.enableTimeAwards,
          prepCount: prepImpacts.length,
          before,
          after: {
            credits: c.race.credits,
            timeLeft: c.race.timeLeft,
            status: c.race.status,
            variable: value(),
          },
          result: { changed: result.changed, changes: result.changes.length },
          queueBeforeFlush: c.simulation.smashPowerupQueue.count,
          mineBodiesBeforeFlush: c.simulation.mineBodies.length,
          message: document.querySelector("#message").textContent,
          messageHistory,
          text132,
        };
      },
      {
        specIndex: target.specIndex,
        threshold: target.spec.removalThreshold,
        enableTimeAwards,
      },
    );

  const carrier = await loadRace("data/", "Carrier_mission");
  const carrierCore = await findCandidate({
    mode: "remove",
    triggerPattern: "core",
    roomCode: 14,
    awardFirst: 3000,
    awardSecond: 20,
    frequency: "singleshot",
  });
  const carrierAwardRun = await runCarrierCore(carrierCore);
  assert.equal(carrierCore.spec.mode, "remove");
  assert.equal(carrierCore.connotation.roomCode, 14);
  assert.deepEqual(
    [
      carrierAwardRun.after.credits - carrierAwardRun.before.credits,
      carrierAwardRun.after.timeLeft - carrierAwardRun.before.timeLeft,
    ],
    [3000, 0],
    "the final real Carrier core contact pays 3000 credits; Hard Core's original no-time gate suppresses its authored 20 seconds",
  );
  assert.equal(carrierAwardRun.priorTimeAwardGate, true);
  assert.equal(carrierAwardRun.timeAwardGateOverride, false);
  assert.equal(carrierAwardRun.queueBeforeFlush, 1);
  assert.equal(carrierAwardRun.before.variable, 18);
  assert.equal(carrierAwardRun.after.variable, 19);
  assert.ok(carrierAwardRun.text132);
  assert.ok(
    carrierAwardRun.messageHistory.includes(carrierAwardRun.text132),
    "the final carrier hit emits its original TEXT.TXT index 132 announcement",
  );
  await page.evaluate(() =>
    window.carma.simulation.flushSmashEffectsBarrier(1),
  );
  const retained = await page.evaluate(
    () => window.carma.simulation.smashPowerupQueue.count,
  );
  assert.equal(
    retained,
    1,
    "barrier one retains the captured connotation powerup",
  );
  const timedCarrier = await loadRace("data/", "Carrier_mission");
  const timedCarrierCore = await findCandidate({
    mode: "remove",
    triggerPattern: "core",
    roomCode: 14,
    awardFirst: 3000,
    awardSecond: 20,
    frequency: "singleshot",
  });
  const timedCarrierAwardRun = await runCarrierCore(timedCarrierCore, true);
  assert.deepEqual(
    [
      timedCarrierAwardRun.after.credits - timedCarrierAwardRun.before.credits,
      timedCarrierAwardRun.after.timeLeft -
        timedCarrierAwardRun.before.timeLeft,
    ],
    [3000, 20],
    "a separate controlled gate override exposes the authored 3000/20 award",
  );
  assert.equal(timedCarrierAwardRun.priorTimeAwardGate, true);
  assert.equal(timedCarrierAwardRun.timeAwardGateOverride, true);
  await page.evaluate(() =>
    window.carma.simulation.flushSmashEffectsBarrier(1),
  );
  assert.equal(
    await page.evaluate(() => window.carma.simulation.smashPowerupQueue.count),
    1,
  );
  const mineBodiesBeforeFinalFlush = await page.evaluate(
    () => window.carma.simulation.mineBodies.length,
  );
  await page.evaluate(() => {
    const simulation = window.carma.simulation;
    const grant = simulation.onSmashPowerup;
    simulation.smashGameplayGrantLog = [];
    simulation.onSmashPowerup = (entry) => {
      simulation.smashGameplayGrantLog.push({
        index: entry.index,
        isPlayer: entry.car === window.carma.player,
      });
      grant?.(entry);
    };
  });
  await page.evaluate(() => window.carma.simulation.flushSmashEffects());
  const carrierGrant = await page.evaluate(
    (before) => ({
      pending: window.carma.simulation.smashPowerupQueue.count,
      mineBodies: window.carma.simulation.mineBodies.length,
      newMineBodies: window.carma.simulation.mineBodies.length - before,
      grants: window.carma.simulation.smashGameplayGrantLog,
    }),
    mineBodiesBeforeFinalFlush,
  );
  assert.equal(carrierGrant.pending, 0);
  assert.deepEqual(carrierGrant.grants, [{ index: 14, isPlayer: true }]);

  const advancedDesert = await loadRace("adv_data/", "desert_mission");
  const advancedDesertTarget = await findCandidate({
    mode: "nochange",
    roomCode: 14,
    awardFirst: 3000,
    awardSecond: 20,
    frequency: "singleshot",
  });
  assert.match(advancedDesert.path, /^adv_data\//i);
  assert.equal(advancedDesertTarget.connotation.roomCode, 14);
  const advancedDesertAward = await page.evaluate(
    (target) => {
      const c = window.carma;
      const destruction = c.simulation.destruction;
      const specIndex = target.specIndex;
      const actor = destruction.retainActors.find(
        (entry) =>
          entry.visible &&
          entry.userData.worldSmashSpecIndices?.includes(specIndex),
      );
      if (!actor) throw new Error("Advanced Desert target actor is absent");
      const point = actor.getWorldPosition(new actor.position.constructor());
      c.player.state.position.copy(point).add(new point.constructor(1, 0, 0));
      c.simulation.sync(c.player);
      const before = { credits: c.race.credits, timeLeft: c.race.timeLeft };
      const result = destruction.handleContact({
        actor,
        normalImpulse: Math.max(1, (target.threshold ?? 0) + 1),
        kind: "body",
        bodyActor: c.player.group,
        impacteeVelocity: c.player.state.velocity,
        impacteeTransform: c.player.group.matrixWorld,
        point: point.clone(),
        timeMs: Math.max(1000, destruction.timeMs + 1),
      });
      return {
        before,
        after: { credits: c.race.credits, timeLeft: c.race.timeLeft },
        disableTimeAwards: c.race.disableTimeAwards,
        changed: result.changed,
        queued: c.simulation.smashPowerupQueue.count,
        actor: actor.name,
      };
    },
    {
      specIndex: advancedDesertTarget.specIndex,
      threshold: advancedDesertTarget.spec.removalThreshold,
    },
  );
  assert.deepEqual(
    [
      advancedDesertAward.after.credits - advancedDesertAward.before.credits,
      advancedDesertAward.after.timeLeft - advancedDesertAward.before.timeLeft,
    ],
    [3000, advancedDesertAward.disableTimeAwards ? 0 : 20],
    "the supported Advanced Desert catalog target awards through real contact",
  );
  assert.equal(advancedDesertAward.queued, 1);
  const desert = await loadRace("data/", "desert_mission");
  const desertNoChange = await findCandidate({
    mode: "nochange",
    roomCode: 14,
    frequency: "singleshot",
  });
  const desertEligibility = await page.evaluate(
    (target) => {
      const c = window.carma;
      const destruction = c.simulation.destruction;
      const actorForTarget = () => {
        const actor = destruction.retainActors.find(
          (entry) =>
            entry.visible &&
            entry.userData.worldSmashSpecIndices?.includes(target.specIndex),
        );
        if (!actor) throw new Error("Desert nochange target actor is absent");
        return actor;
      };
      const actor = actorForTarget();
      const point = actor.getWorldPosition(new actor.position.constructor());
      const player = c.player;
      const npc = c.simulation.cars.find((car) => !car.human);
      if (!npc) throw new Error("Desert race has no live nonhuman car owner");
      const before = { credits: c.race.credits, timeLeft: c.race.timeLeft };
      const contact = (bodyActor, timeMs) =>
        destruction.handleContact({
          actor: actorForTarget(),
          normalImpulse: Math.max(1, (target.threshold ?? 0) + 1),
          kind: "body",
          bodyActor,
          impacteeVelocity: player.state.velocity,
          impacteeTransform: bodyActor.matrixWorld,
          point: point.clone(),
          timeMs,
        });
      contact(actor, Math.max(1000, destruction.timeMs + 1));
      const afterNoOwner = {
        credits: c.race.credits,
        timeLeft: c.race.timeLeft,
        queued: c.simulation.smashPowerupQueue.count,
      };
      contact(npc.group, Math.max(2000, destruction.timeMs + 1));
      const afterNpc = {
        credits: c.race.credits,
        timeLeft: c.race.timeLeft,
        queued: c.simulation.smashPowerupQueue.count,
      };
      const exactBoundary = point
        .clone()
        .add(new point.constructor(Math.sqrt(2), 0, 0));
      player.state.position.copy(exactBoundary);
      c.simulation.sync(player);
      contact(player.group, Math.max(3000, destruction.timeMs + 1));
      const boundary = {
        credits: c.race.credits,
        timeLeft: c.race.timeLeft,
        queued: c.simulation.smashPowerupQueue.count,
      };
      player.state.position.copy(point).add(new point.constructor(1, 0, 0));
      c.simulation.sync(player);
      contact(player.group, Math.max(4000, destruction.timeMs + 1));
      const inside = {
        credits: c.race.credits,
        timeLeft: c.race.timeLeft,
        queued: c.simulation.smashPowerupQueue.count,
      };
      return {
        before,
        afterNoOwner,
        afterNpc,
        boundary,
        inside,
        roomCode: target.roomCode,
        award: target.award,
        playerPosition: player.state.position.toArray(),
        point: point.toArray(),
        outsideDistanceSquared: exactBoundary.distanceToSquared(point),
        nativeOutsideDistanceSquared: exactBoundary
          .toArray()
          .reduce(
            (sum, value, axis) =>
              sum +
              (Math.fround(value) - Math.fround(point.getComponent(axis))) ** 2,
            0,
          ),
      };
    },
    {
      specIndex: desertNoChange.specIndex,
      threshold: desertNoChange.spec.removalThreshold,
      roomCode: desertNoChange.connotation.roomCode,
      award: desertNoChange.connotation.award,
    },
  );
  assert.deepEqual(
    [
      desertEligibility.afterNoOwner.credits,
      desertEligibility.afterNoOwner.timeLeft,
      desertEligibility.afterNoOwner.queued,
      desertEligibility.afterNpc.credits,
      desertEligibility.afterNpc.timeLeft,
      desertEligibility.afterNpc.queued,
    ],
    [
      desertEligibility.before.credits,
      desertEligibility.before.timeLeft,
      0,
      desertEligibility.before.credits,
      desertEligibility.before.timeLeft,
      0,
    ],
    "ownerless and nonhuman contacts receive neither awards nor action-30 queue entries",
  );
  assert.ok(
    desertEligibility.nativeOutsideDistanceSquared >= 2,
    "original large world coordinates round this sqrt(2) offset outside the native gate",
  );
  assert.equal(
    desertEligibility.boundary.queued,
    0,
    "native Float32-rounded positions outside squared distance two do not queue a powerup",
  );
  assert.ok(Math.abs(desertEligibility.outsideDistanceSquared - 2) < 0.001);
  assert.equal(
    desertEligibility.inside.queued,
    1,
    "distance squared below 2 queues the powerup",
  );
  assert.deepEqual(
    [
      desertEligibility.boundary.credits - desertEligibility.before.credits,
      desertEligibility.boundary.timeLeft - desertEligibility.before.timeLeft,
    ],
    [desertNoChange.connotation.award.first, 0],
    "the eligible player contact at the powerup boundary still processes the authored award",
  );
  assert.deepEqual(
    [desertEligibility.inside.credits, desertEligibility.inside.timeLeft],
    [desertEligibility.boundary.credits, desertEligibility.boundary.timeLeft],
    "a later single-shot nochange contact does not pay twice",
  );
  assert.match(desert.path, /^data\//i);

  const gl = await page.evaluate(() => {
    const context = document.querySelector("#view").getContext("webgl2");
    if (!context) throw new Error("WebGL2 context unavailable");
    return context.getError();
  });
  assert.equal(gl, 0);
  assert.deepEqual(errors, [], "Chromium has no page or console errors");
  assert.deepEqual(failedRequests, [], "all requested local assets load");
  const report = {
    carrier,
    carrierCore: {
      actor: carrierCore.actor,
      spec: carrierCore.spec,
      connotation: carrierCore.connotation,
      inventory: carrierCore.inventory,
    },
    carrierAwardRun,
    carrierGrant,
    timedCarrierAwardRun,
    advancedDesert,
    advancedDesertTarget: {
      actor: advancedDesertTarget.actor,
      spec: advancedDesertTarget.spec,
      connotation: advancedDesertTarget.connotation,
    },
    advancedDesertAward,
    desert,
    desertNoChange: {
      actor: desertNoChange.actor,
      spec: desertNoChange.spec,
      connotation: desertNoChange.connotation,
    },
    desertEligibility,
    errors,
    failedRequests,
    gl,
  };
  await writeFile(
    "artifacts/browser-smash-gameplay.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(serverLog);
  throw error;
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  }
}
