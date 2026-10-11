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
    { root: "adv_data/", pattern: "Carrier_mission", trigger: "&CORE.ACT" },
    { root: "data/", pattern: "desert_mission", trigger: "&92" },
    { root: "adv_data/", pattern: "desert_mission", trigger: "&92" },
    { root: "data/", pattern: "Silo_mission", trigger: "&20" },
  ];
  const runs = [];
  for (const scenario of scenarios) {
    const loaded = await loadRace(scenario);
    assert.ok(
      loaded.path.toLowerCase().startsWith(scenario.root.toLowerCase()),
    );
    const run = await runAuthoredContact(scenario);
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

  const gl = await page.evaluate(() => {
    const context = document.querySelector("#view").getContext("webgl2");
    if (!context) throw new Error("WebGL2 context unavailable");
    return context.getError();
  });
  assert.equal(gl, 0);
  assert.deepEqual(errors, [], "Chromium has no page or console errors");
  assert.deepEqual(failedRequests, [], "all requested local assets load");
  const report = { runs, errors, failedRequests, gl };
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
