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
    "SKIP smash follow-up browser regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5214;
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

  const loadRace = async ({ root, pattern }) => {
    const path = await page.evaluate(
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
    await page.evaluate(async (racePath) => {
      const c = window.carma;
      const car = c.assets.resolve("data/CARS/EAGLE3/EAGLE3.TXT");
      if (!car) throw new Error("Stock EAGLE3 car is absent");
      document.querySelector("#track-select").value = racePath;
      document.querySelector("#car-select").value = car;
      await c.loadRace();
      c.paused = true;
      document.querySelector("#panel").hidden = true;
    }, path);
    await page.waitForFunction(
      () => window.carma.stats.ready && window.carma.paused,
      null,
      { timeout: 90000 },
    );
    const snapshot = await page.evaluate(() => ({
      path: document.querySelector("#track-select").value,
      name: window.carma.raceDefinition?.name,
      status: window.carma.race.status,
      raceType: window.carma.raceDefinition?.raceType,
    }));
    await page.screenshot({
      path: `artifacts/browser-smash-followup-${root.replace(/\W/g, "")}-${pattern.replace(/\W/g, "").toLowerCase()}.png`,
    });
    return snapshot;
  };

  const runAuthoredContact = (scenario) =>
    page.evaluate((scenario) => {
      const c = window.carma;
      const destruction = c.simulation?.destruction;
      const runtime = c.worldFollowups;
      if (!destruction || !runtime?.options?.onDue)
        throw new Error("Production world-follow-up runtime is unavailable");
      const matches = [];
      for (const [specIndex, spec] of destruction.specs.entries()) {
        const records = [
          ...(spec.connotations ? [spec.connotations] : []),
          ...spec.levels.map((level) => level.connotations),
        ];
        for (const [connotationIndex, data] of records.entries()) {
          if (
            spec.trigger.name?.toLowerCase() !==
              scenario.trigger.toLowerCase() ||
            data.sideEffects.length === 0
          )
            continue;
          const actor = destruction.retainActors.find(
            (entry) =>
              entry.visible &&
              entry.userData.worldSmashSpecIndices?.includes(specIndex),
          );
          if (actor)
            matches.push({ spec, specIndex, connotationIndex, data, actor });
        }
      }
      if (!matches.length)
        throw new Error(
          `No live ${scenario.trigger} source with follow-ups in ${scenario.root}; specs=${JSON.stringify(destruction.specs.map((spec) => ({ trigger: spec.trigger, mode: spec.mode, sideEffects: spec.connotations?.sideEffects?.length ?? 0 })))}`,
        );
      const { spec, specIndex, connotationIndex, data, actor } = matches[0];
      const point = actor.getWorldPosition(new actor.position.constructor());
      const player = c.player;
      player.state.position.copy(point).add(new point.constructor(1, 0, 0));
      player.state.velocity.set(0, 0, 0);
      c.simulation.sync(player);

      const definition = c.raceDefinition;
      const variable = definition?.smashVariable;
      const missionBefore = Number.isInteger(variable)
        ? c.missionVariables.get(variable)
        : null;
      const creditsBefore = c.race.credits;
      const timeBefore = c.race.timeLeft;
      const geometryBefore = destruction.geometryRevision;
      const activationBefore = c.simulation.worldActivations.pendingCount;
      const queuedBefore = c.simulation.delayedSmashes.count;
      const dueRecords = [];
      const followupCalls = [];
      runtime.options.testCapture = { dueRecords, followupCalls };
      const originalDue = runtime.options.onDue;
      runtime.options.onDue = (context) => {
        const record = {
          route: context.route,
          selector: context.selector,
          callerFlag: context.callerFlag,
          targetKind: context.targetKind,
          dueMs: context.dueMs,
          nowMs: c.stats.gameTimeMs,
          magnitude: context.magnitude,
          targetIdentifier: context.face.actor.readIdentifier(),
          targetSpec: context.targetSpec
            ? {
                trigger: context.targetSpec.trigger,
                mode: context.targetSpec.mode,
                threshold: context.targetSpec.removalThreshold,
              }
            : null,
          missionBefore: Number.isInteger(variable)
            ? c.missionVariables.get(variable)
            : null,
          geometryBefore: destruction.geometryRevision,
          activationBefore: c.simulation.worldActivations.pendingCount,
        };
        dueRecords.push(record);
        originalDue(context);
        record.missionAfter = Number.isInteger(variable)
          ? c.missionVariables.get(variable)
          : null;
        record.geometryAfter = destruction.geometryRevision;
        record.activationAfter = c.simulation.worldActivations.pendingCount;
        record.delayedAfter = c.simulation.delayedSmashes.count;
      };

      const originalFollowup = destruction.handleFollowup.bind(destruction);
      destruction.handleFollowup = (contact, targetSpec, numbered) => {
        const before = {
          mission: Number.isInteger(variable)
            ? c.missionVariables.get(variable)
            : null,
          geometry: destruction.geometryRevision,
          activation: c.simulation.worldActivations.pendingCount,
        };
        const result = originalFollowup(contact, targetSpec, numbered);
        followupCalls.push({
          actor: contact.actor?.name ?? null,
          material: contact.material ?? null,
          faceIndex: contact.faceIndex ?? null,
          normalImpulse: contact.normalImpulse,
          effectForce: contact.effectForce?.toArray() ?? null,
          numbered: !!numbered,
          targetSpec: targetSpec
            ? { trigger: targetSpec.trigger, mode: targetSpec.mode }
            : null,
          changed: result.changed,
          changeCount: result.changes.length,
          before,
          after: {
            mission: Number.isInteger(variable)
              ? c.missionVariables.get(variable)
              : null,
            geometry: destruction.geometryRevision,
            activation: c.simulation.worldActivations.pendingCount,
          },
        });
        return result;
      };

      const contact = destruction.handleContact({
        actor,
        normalImpulse: Math.max(1000, (spec.removalThreshold ?? 0) + 1),
        effectMagnitude: Math.max(1000, (spec.removalThreshold ?? 0) + 1),
        kind: "body",
        bodyActor: player.group,
        impacteeVelocity: player.state.velocity,
        impacteeTransform: player.group.matrixWorld,
        point: point.clone(),
        timeMs: c.simulation.elapsed * 1000,
      });
      return {
        race: {
          path: document.querySelector("#track-select").value,
          name: definition?.name ?? null,
          status: c.race.status,
          variable,
          target: definition?.smashTarget ?? null,
        },
        source: {
          trigger: spec.trigger,
          mode: spec.mode,
          specIndex,
          connotationIndex,
          actor: actor.name,
          actorPosition: point.toArray(),
          connotation: {
            sideEffects: data.sideEffects,
            activations: data.activations,
            variableChanges: data.variableChanges,
            award: data.award,
            roomCode: data.roomCode,
          },
          contact: {
            changed: contact.changed,
            changeCount: contact.changes.length,
          },
        },
        before: {
          mission: missionBefore,
          credits: creditsBefore,
          timeLeft: timeBefore,
          geometryRevision: geometryBefore,
          pendingActivations: activationBefore,
          pendingDelayed: queuedBefore,
        },
        afterContact: {
          mission: Number.isInteger(variable)
            ? c.missionVariables.get(variable)
            : null,
          credits: c.race.credits,
          timeLeft: c.race.timeLeft,
          geometryRevision: destruction.geometryRevision,
          pendingActivations: c.simulation.worldActivations.pendingCount,
          pendingDelayed: c.simulation.delayedSmashes.count,
          dueRecords,
          followupCalls,
        },
      };
    }, scenario);

  const enumerateCarrierTargets = () =>
    page.evaluate(() => {
      const c = window.carma;
      const destruction = c.simulation.destruction;
      const variable = c.raceDefinition?.smashVariable;
      if (!destruction || !Number.isInteger(variable))
        throw new Error("Stock Carrier mission definition is unavailable");
      const seen = new Set();
      const candidates = [];
      for (const [specIndex, spec] of destruction.specs.entries()) {
        if (!["remove", "replacemodel"].includes(spec.mode)) continue;
        if (spec.trigger.name?.toLowerCase() === "&core.act") continue;
        const data = [
          ...(spec.connotations ? [spec.connotations] : []),
          ...spec.levels.map((level) => level.connotations),
        ].find((connotation) =>
          connotation.variableChanges.some(
            ([index, delta]) => index === variable && delta === 1,
          ),
        );
        if (!data) continue;
        for (const actor of destruction.retainActors) {
          if (
            !actor.visible ||
            !actor.userData.worldSmashSpecIndices?.includes(specIndex) ||
            seen.has(actor.uuid)
          )
            continue;
          seen.add(actor.uuid);
          candidates.push({
            actorUuid: actor.uuid,
            actor: actor.name,
            trigger: spec.trigger.name,
            mode: spec.mode,
            specIndex,
            sideEffects: data.sideEffects.length,
          });
        }
      }
      return {
        mission: c.missionVariables.get(variable),
        variable,
        target: c.raceDefinition.smashTarget,
        candidates,
      };
    });

  const contactCarrierTarget = (candidate) =>
    page.evaluate((candidate) => {
      const c = window.carma;
      const destruction = c.simulation.destruction;
      const actor = destruction.retainActors.find(
        (entry) => entry.uuid === candidate.actorUuid,
      );
      if (!actor?.visible)
        return { candidate, changed: false, skipped: "source actor hidden" };
      const point = actor.getWorldPosition(new actor.position.constructor());
      const player = c.player;
      player.state.position.copy(point).add(new point.constructor(1, 0, 0));
      player.state.velocity.set(0, 0, 0);
      c.simulation.sync(player);
      const variable = c.raceDefinition.smashVariable;
      const before = c.missionVariables.get(variable);
      const pendingBefore = c.simulation.delayedSmashes.count;
      const result = destruction.handleContact({
        actor,
        normalImpulse: 1001,
        effectMagnitude: 1001,
        kind: "body",
        bodyActor: player.group,
        impacteeVelocity: player.state.velocity,
        impacteeTransform: player.group.matrixWorld,
        point: point.clone(),
        timeMs: c.simulation.elapsed * 1000,
      });
      return {
        candidate,
        point: point.toArray(),
        changed: result.changed,
        changeCount: result.changes.length,
        missionBefore: before,
        missionAfter: c.missionVariables.get(variable),
        pendingBefore,
        pendingAfter: c.simulation.delayedSmashes.count,
      };
    }, candidate);

  const armCarrierCapture = () =>
    page.evaluate(() => {
      const c = window.carma;
      const runtime = c.worldFollowups;
      const destruction = c.simulation.destruction;
      const variable = c.raceDefinition.smashVariable;
      const capture = { dueRecords: [], followupCalls: [] };
      runtime.options.testCapture = capture;
      const originalDue = runtime.options.onDue;
      runtime.options.onDue = (context) => {
        const record = {
          route: context.route,
          selector: context.selector,
          callerFlag: context.callerFlag,
          dueMs: context.dueMs,
          target: context.face.actor.readIdentifier(),
          targetSpec: context.targetSpec
            ? {
                trigger: context.targetSpec.trigger,
                mode: context.targetSpec.mode,
              }
            : null,
          missionBefore: c.missionVariables.get(variable),
          geometryBefore: destruction.geometryRevision,
        };
        capture.dueRecords.push(record);
        originalDue(context);
        record.missionAfter = c.missionVariables.get(variable);
        record.geometryAfter = destruction.geometryRevision;
      };
      const originalFollowup = destruction.handleFollowup.bind(destruction);
      destruction.handleFollowup = (contact, targetSpec, numbered) => {
        const before = c.missionVariables.get(variable);
        const result = originalFollowup(contact, targetSpec, numbered);
        capture.followupCalls.push({
          actor: contact.actor?.name ?? null,
          targetSpec: targetSpec
            ? { trigger: targetSpec.trigger, mode: targetSpec.mode }
            : null,
          changed: result.changed,
          missionBefore: before,
          missionAfter: c.missionVariables.get(variable),
          geometryRevision: destruction.geometryRevision,
        });
        return result;
      };
    });

  const advanceUntilDrained = async (timeoutMs = 15000) => {
    await page.evaluate(() => {
      const c = window.carma;
      // Contacts teleport the fixture car into objective geometry. Restore its
      // ordinary recovery position before advancing the real outer-frame clock.
      c.simulation.recover(c.player);
      c.pedestrians?.resetCar(c.player.state.position);
      c.powerups?.resetPath(c.player.state.position);
      c.debugMode.timerFrozen = true;
      c.paused = false;
    });
    try {
      await page.waitForFunction(
        () => window.carma.simulation.delayedSmashes.count === 0,
        null,
        { timeout: timeoutMs },
      );
    } finally {
      await page.evaluate(() => {
        window.carma.paused = true;
        window.carma.debugMode.timerFrozen = false;
      });
    }
  };

  const runCarrierCompletionChain = async () => {
    const scenario = {
      root: "data/",
      pattern: "Carrier_mission",
      trigger: "&CORE.ACT",
    };
    const loaded = await loadRace(scenario);
    await page.waitForFunction(
      () =>
        window.carma.stats.ready &&
        window.carma.paused &&
        window.carma.pedestrians,
      null,
      { timeout: 90000 },
    );
    assert.equal(loaded.name, "MISSION: HARD CORE");
    await page.evaluate(() => {
      // This regression measures authored world/objective effects. Use the
      // normal opt-in debug controls so unrelated crash damage during the
      // required two-second delayed scan cannot close the race's awards.
      for (const id of ["debug-menu-toggle", "debug-immune"]) {
        const box = document.getElementById(id);
        box.checked = true;
        box.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    const inventory = await enumerateCarrierTargets();
    assert.equal(inventory.variable, 1);
    assert.equal(inventory.target, 19);
    assert.equal(inventory.mission, 0);
    assert.ok(
      inventory.candidates.length >= 17,
      `Stock Carrier has ${inventory.candidates.length} visible unique authored non-core objective sources`,
    );
    await armCarrierCapture();
    const sourceContacts = [];
    for (const candidate of inventory.candidates) {
      const state = await page.evaluate(() => {
        const c = window.carma;
        return {
          mission: c.missionVariables.get(c.raceDefinition.smashVariable),
          delayed: c.simulation.delayedSmashes.count,
        };
      });
      if (state.mission >= 17) break;
      const result = await contactCarrierTarget(candidate);
      sourceContacts.push(result);
      if (result.pendingAfter >= 16) await advanceUntilDrained();
    }
    let state = await page.evaluate(() => {
      const c = window.carma;
      return {
        mission: c.missionVariables.get(c.raceDefinition.smashVariable),
        delayed: c.simulation.delayedSmashes.count,
        status: c.race.status,
      };
    });
    if (state.delayed > 0) await advanceUntilDrained();
    state = await page.evaluate(() => {
      const c = window.carma;
      return {
        mission: c.missionVariables.get(c.raceDefinition.smashVariable),
        delayed: c.simulation.delayedSmashes.count,
        status: c.race.status,
      };
    });
    assert.equal(
      state.mission,
      17,
      `authored non-core source contacts should prepare 17/19, without seeding: ${JSON.stringify({ state, sourceContacts })}`,
    );
    assert.equal(state.status, "racing");

    const core = await page.evaluate(() => {
      const c = window.carma;
      const destruction = c.simulation.destruction;
      const specIndex = destruction.specs.findIndex(
        (spec) => spec.trigger.name?.toLowerCase() === "&core.act",
      );
      const actor = destruction.retainActors.find(
        (entry) =>
          entry.visible &&
          entry.userData.worldSmashSpecIndices?.includes(specIndex),
      );
      if (!actor) throw new Error("Stock Carrier core actor is not live");
      const sourceNames = [];
      actor.traverse((object) => sourceNames.push(object.name));
      const point = actor.getWorldPosition(new actor.position.constructor());
      const player = c.player;
      player.state.position.copy(point).add(new point.constructor(1, 0, 0));
      player.state.velocity.set(0, 0, 0);
      c.simulation.sync(player);
      const before = c.missionVariables.get(c.raceDefinition.smashVariable);
      const pendingBefore = c.simulation.delayedSmashes.count;
      const result = destruction.handleContact({
        actor,
        normalImpulse: 1001,
        effectMagnitude: 1001,
        kind: "body",
        bodyActor: player.group,
        impacteeVelocity: player.state.velocity,
        impacteeTransform: player.group.matrixWorld,
        point: point.clone(),
        timeMs: c.simulation.elapsed * 1000,
      });
      return {
        actor: actor.name,
        sourceNames,
        sourceTrigger: destruction.specs[specIndex].trigger.name,
        point: point.toArray(),
        changed: result.changed,
        missionBefore: before,
        missionAfter: c.missionVariables.get(c.raceDefinition.smashVariable),
        pendingBefore,
        pendingAfter: c.simulation.delayedSmashes.count,
        pendingTargets: c.simulation.delayedSmashes.slots
          .filter(Boolean)
          .map((entry) => ({
            kind: entry.kind,
            target: entry.context.payload?.face.actor.readIdentifier(),
            targetSpec: entry.context.payload?.targetSpec?.trigger ?? null,
            sourceModel: entry.context.payload?.face.source?.actor?.name,
            dueMs: entry.context.payload?.dueMs,
          })),
        dueRecordsBefore:
          c.worldFollowups.options.testCapture.dueRecords.length,
        status: c.race.status,
      };
    });
    // PHIL admission can change the encoded slot suffix. The retained source
    // ACT binding, not an incidental first runtime name, identifies the Core.
    assert.equal(core.sourceTrigger?.toLowerCase(), "&core.act");
    assert.ok(
      core.sourceNames.some((name) => name.toLowerCase() === "&core.act"),
      `the selected retained actor contains the authored Core model: ${JSON.stringify(core)}`,
    );
    assert.equal(core.changed, true);
    assert.equal(core.missionBefore, 17);
    assert.equal(core.missionAfter, 18);
    assert.equal(core.pendingBefore, 0);
    assert.equal(
      core.pendingAfter,
      8,
      "the native Core cuboid includes eight actual pickup ACTs",
    );
    assert.ok(
      core.pendingTargets.every(
        (entry) =>
          entry.kind === "smash" &&
          /^&£00\d{4}\.ACT$/.test(entry.target) &&
          entry.targetSpec === null &&
          entry.sourceModel === "&74POWERUPB.ACT",
      ),
      `the pending targets are native pickup ACTs, never an extra WIGGLYBIT objective: ${JSON.stringify(core.pendingTargets)}`,
    );
    await advanceUntilDrained();
    const coreDue = await page.evaluate(
      (before) => ({
        records:
          window.carma.worldFollowups.options.testCapture.dueRecords.slice(
            before,
          ),
        playerKnackered: window.carma.player.knackered,
        awardsClosed: !!window.carma.race.awardsClosed,
        pickupStates: window.carma.powerups.pickups
          .filter((entry) =>
            /^&£00(?:010[7-9]|011[0-4])\.ACT$/.test(entry.object.name),
          )
          .map((entry) => ({
            name: entry.object.name,
            collected: entry.collected,
            visible: entry.object.visible,
          })),
        queuedPowerups: window.carma.simulation.smashPowerupQueue.count,
      }),
      core.dueRecordsBefore,
    );
    assert.equal(coreDue.records.length, 8);
    assert.deepEqual(
      coreDue.records.map((record) => record.target).sort(),
      core.pendingTargets.map((entry) => entry.target).sort(),
    );
    assert.ok(
      coreDue.records.every(
        (record) =>
          record.route === "world" &&
          record.missionBefore === 18 &&
          record.missionAfter === 18,
      ),
    );
    assert.equal(coreDue.playerKnackered, false);
    assert.equal(coreDue.awardsClosed, false);
    assert.equal(coreDue.pickupStates.length, 8);
    assert.ok(
      coreDue.pickupStates.every((entry) => entry.collected && !entry.visible),
      `native followup pickup ACTs must be consumed: ${JSON.stringify(coreDue.pickupStates)}`,
    );
    assert.equal(
      coreDue.queuedPowerups,
      0,
      "normal final flush delivers the pickup grants",
    );
    const afterCore = await page.evaluate(() => {
      const c = window.carma;
      return {
        name: c.raceDefinition?.name,
        target: c.raceDefinition?.smashTarget,
        mission: c.missionVariables.get(c.raceDefinition.smashVariable),
        status: c.race.status,
        delayed: c.simulation.delayedSmashes.count,
        completionReason: c.race.completionReason ?? 0,
      };
    });
    assert.equal(afterCore.name, "MISSION: HARD CORE");
    assert.equal(afterCore.target, 19);
    assert.equal(afterCore.mission, 18);
    assert.equal(afterCore.status, "racing");
    assert.equal(afterCore.delayed, 0);
    assert.equal(afterCore.completionReason, 0);

    const admiralDeath = await page.evaluate(() => {
      const c = window.carma;
      const population = c.pedestrians;
      const variable = c.raceDefinition.smashVariable;
      const states = population?.states ?? [];
      const targetPed = states.find(
        (ped) =>
          ped.alive && c.raceDefinition.pedGroupsToKill.includes(ped.group),
      );
      if (!targetPed)
        throw new Error(
          "Stock Carrier has no alive group 56 objective pedestrian",
        );
      const position = targetPed.position.clone();
      const start = position.clone().add(new position.constructor(0, 0, 0.5));
      const end = position.clone().add(new position.constructor(0, 0, -0.5));
      const before = c.missionVariables.get(variable);
      const hitsBefore = population.hits;
      const threat = {
        position: end,
        yaw: 0,
        speed: 2,
        velocity: new position.constructor(0, 0, -2),
      };
      const frame = {
        cameraPosition: position,
        gameTimeMs: Math.max(
          1000,
          c.stats.gameTimeMs + 1,
          c.simulation.destruction.timeMs + 1,
        ),
        combatOwner: c.player,
        threats: [],
      };
      population.resetCar(start);
      population.update(0, threat, frame);
      const after = c.missionVariables.get(variable);
      const statusAfter = c.race.status;
      const reasonAfter = c.race.completionReason ?? 0;
      population.resetCar(start);
      population.update(0, threat, frame);
      return {
        group: targetPed.group,
        position: position.toArray(),
        input: { start: start.toArray(), end: end.toArray(), speed: 2 },
        before,
        after,
        afterRepeatedSweep: c.missionVariables.get(variable),
        statusAfter,
        reasonAfter,
        statusAfterRepeatedSweep: c.race.status,
        reasonAfterRepeatedSweep: c.race.completionReason ?? 0,
        killedDelta: population.hits - hitsBefore,
        adapter: "current legacy vehicle sweep, not native articulated contact",
      };
    });
    assert.equal(admiralDeath.group, 56);
    assert.equal(admiralDeath.before, 18);
    assert.equal(admiralDeath.after, 19);
    assert.equal(admiralDeath.statusAfter, "completed");
    assert.equal(admiralDeath.reasonAfter, 3);
    assert.equal(admiralDeath.afterRepeatedSweep, 19);
    assert.equal(admiralDeath.statusAfterRepeatedSweep, "completed");
    assert.equal(admiralDeath.reasonAfterRepeatedSweep, 3);
    assert.equal(admiralDeath.killedDelta, 1);
    await page.screenshot({
      path: "artifacts/browser-smash-followup-stock-carrier-completed.png",
    });
    return {
      outcome: "completed",
      loaded,
      inventory,
      sourceContacts,
      core,
      coreDue,
      afterCore,
      admiralDeath,
    };
  };

  const waitForDue = async (maximumWaitMs, contactRun) => {
    await page.evaluate(() => {
      const c = window.carma;
      c.debugMode.timerFrozen = true;
      c.paused = false;
    });
    try {
      try {
        await page.waitForFunction(
          () => {
            const runtime = window.carma?.worldFollowups;
            return runtime?.options?.testCapture?.dueRecords?.length > 0;
          },
          null,
          { timeout: maximumWaitMs },
        );
      } catch (error) {
        const snapshot = await page.evaluate(() => ({
          now: window.carma?.stats.gameTimeMs,
          paused: window.carma?.paused,
          status: window.carma?.race.status,
          delayed: window.carma?.simulation.delayedSmashes.count,
          runtime: !!window.carma?.worldFollowups,
          due: window.carma?.worldFollowups.options.testDueRecords?.length,
        }));
        throw new Error(
          `Follow-up due timeout: ${JSON.stringify({ snapshot, source: contactRun.source, afterContact: contactRun.afterContact })}`,
          {
            cause: error,
          },
        );
      }
    } finally {
      await page.evaluate(() => {
        window.carma.paused = true;
        window.carma.debugMode.timerFrozen = false;
      });
    }
  };

  const scenarios = [
    { root: "data/", pattern: "Carrier_mission", trigger: "&CORE.ACT" },
    { root: "data/", pattern: "desert_mission", trigger: "&92" },
    { root: "data/", pattern: "Silo_mission", trigger: "&20" },
    {
      root: "adv_data/",
      pattern: "SILO_MISSION",
      trigger: "&20",
      noMissionExpected: false,
    },
    {
      root: "adv_data/",
      pattern: "Carrier_mission",
      trigger: "&CORE.ACT",
      noMissionExpected: true,
    },
    {
      root: "adv_data/",
      pattern: "desert_mission",
      trigger: "&92",
      noMissionExpected: true,
    },
  ];
  const runs = [];
  for (const scenario of scenarios) {
    const loaded = await loadRace(scenario);
    assert.ok(
      loaded.path.toLowerCase().startsWith(scenario.root.toLowerCase()),
    );
    const run = await runAuthoredContact(scenario);
    if (scenario.noMissionExpected) {
      assert.equal(run.race.name, null);
      assert.ok(run.race.variable == null);
    } else if (scenario.root === "adv_data/") {
      assert.ok(run.race.name, "Advanced Silo is a registered race mission");
      assert.ok(Number.isInteger(run.race.variable));
    }
    assert.ok(run.source.connotation.sideEffects.length > 0);
    assert.equal(run.source.contact.changed, true);
    assert.equal(
      run.afterContact.credits - run.before.credits,
      run.source.connotation.award.first,
      "contact applies the authored credit award",
    );
    const authoredVariableDelta = run.source.connotation.variableChanges
      .filter(([index]) => index === run.race.variable)
      .reduce((sum, [, delta]) => sum + delta, 0);
    if (Number.isInteger(run.race.variable))
      assert.equal(
        run.afterContact.mission - run.before.mission,
        authoredVariableDelta,
        "source connotation applies its authored mission-variable delta",
      );
    assert.equal(
      run.afterContact.pendingActivations - run.before.pendingActivations,
      run.source.connotation.activations.length,
      "source connotation queues its authored world activations",
    );
    assert.ok(
      run.afterContact.pendingDelayed > run.before.pendingDelayed,
      `${scenario.root}${scenario.pattern} source contact should enqueue installed follow-up work`,
    );
    await page.evaluate(() => {
      const runtime = window.carma.worldFollowups;
      runtime.options.testDueRecords = runtime.options.testCapture.dueRecords;
    });
    const minimumDelay = Math.max(
      ...run.source.connotation.sideEffects.map(
        (effect) => Math.max(...effect.delaySeconds) * 1000,
      ),
    );
    await waitForDue(Math.min(30000, minimumDelay + 12000), run);
    const due = await page.evaluate(() => {
      const c = window.carma;
      const destruction = c.simulation.destruction;
      return {
        nowMs: c.stats.gameTimeMs,
        pending: c.simulation.delayedSmashes.count,
        geometryRevision: destruction.geometryRevision,
        mission: Number.isInteger(c.raceDefinition?.smashVariable)
          ? c.missionVariables.get(c.raceDefinition.smashVariable)
          : null,
        activations: c.simulation.worldActivations.pendingCount,
        dueRecords: c.worldFollowups.options.testDueRecords.map((context) => ({
          route: context.route,
          selector: context.selector,
          callerFlag: context.callerFlag,
          dueMs: context.dueMs,
          targetKind: context.targetKind,
          target: context.targetIdentifier,
          magnitude: context.magnitude,
          targetSpec: context.targetSpec
            ? {
                trigger: context.targetSpec.trigger,
                mode: context.targetSpec.mode,
              }
            : null,
        })),
      };
    });
    assert.ok(
      due.dueRecords.length > 0,
      "normal delayed clock reaches a follow-up due callback",
    );
    assert.ok(
      due.dueRecords.every(
        (record) => record.selector === 1 && record.callerFlag === 0,
      ),
    );
    assert.ok(
      due.dueRecords.some((record) => record.targetSpec),
      "at least one actual due candidate resolves an ordinary smash connotation",
    );
    assert.ok(due.geometryRevision > run.before.geometryRevision);
    const postDue = await page.evaluate(() => {
      const c = window.carma;
      return {
        followupCalls:
          c.worldFollowups.options.testCapture?.followupCalls ?? [],
      };
    });
    assert.ok(
      postDue.followupCalls.length > 0,
      "due work delegates to normal handleFollowup",
    );
    assert.ok(
      postDue.followupCalls.some((call) => call.changed),
      "normal follow-up handler applies the selected smash",
    );
    if (Number.isInteger(run.race.variable))
      assert.ok(
        due.mission > run.afterContact.mission,
        "a due target's ordinary smash connotation advances the mission variable",
      );
    runs.push({ loaded, run, due, postDue, scenario });
    await page.screenshot({
      path: `artifacts/browser-smash-followup-${scenario.root.replace(/\W/g, "")}-${scenario.pattern.replace(/\W/g, "").toLowerCase()}-due.png`,
    });
  }

  const carrierCompletion = await runCarrierCompletionChain();

  const gl = await page.evaluate(() => {
    const context = document.querySelector("#view").getContext("webgl2");
    if (!context) throw new Error("WebGL2 context unavailable");
    return context.getError();
  });
  assert.equal(gl, 0);
  assert.deepEqual(errors, [], "Chromium has no page or console errors");
  assert.deepEqual(failedRequests, [], "all requested local assets load");
  const report = { runs, carrierCompletion, errors, failedRequests, gl };
  await writeFile(
    "artifacts/browser-smash-followup.json",
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
