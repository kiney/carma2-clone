import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
try {
  await access(executable);
  await access(process.env.CARMA2_ROOT || "carma2_orig");
} catch {
  console.log(
    "SKIP ordinary pedestrian recovery: Chromium or C2 assets absent",
  );
  process.exit(0);
}
await mkdir("artifacts", { recursive: true });
const port = Number(process.env.PED_RECOVERY_PORT || 5270);
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "",
  browser;
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));
const report = {
  mode: "Original normal population; controlled root lift followed by ordinary grounding and real PHIL fall/halt/recovery",
  physicsSetup:
    process.env.PED_RECOVERY_LYING === "1"
      ? "After source fall activation, rotate the actual retained physical body by 90 degrees around world X; no HP/action/count/normal overrides"
      : "Source passive root lifted by one native unit; physical pose and velocities otherwise preserved",
  frameBudgetPerTree: 120,
  cases: [],
  errors: [],
  failedRequests: [],
  badResponses: [],
};
try {
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/manifest`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (server.exitCode !== null) throw new Error(serverLog);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `production asset server failed: ${serverLog}`);
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
  page.on("pageerror", (error) =>
    report.errors.push(String(error?.stack ?? error)),
  );
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    report.failedRequests.push(
      `${request.url()}: ${request.failure()?.errorText}`,
    ),
  );
  page.on("response", (response) => {
    if (response.status() >= 400)
      report.badResponses.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  const trees = process.env.PED_RECOVERY_TREE
    ? [process.env.PED_RECOVERY_TREE]
    : ["data", "adv_data"];
  for (const dataRoot of trees) {
    const selection = await page.evaluate(async (root) => {
      const trackSelect = document.querySelector("#track-select"),
        carSelect = document.querySelector("#car-select");
      const track = [...trackSelect.options].find(
        (option) =>
          option.value.toLowerCase().startsWith(`${root}/`) &&
          /newcity1/i.test(`${option.value} ${option.textContent}`),
      )?.value;
      const car = [...carSelect.options].find(
        (option) =>
          option.value.toLowerCase() === "data/cars/eagle3/eagle3.txt",
      )?.value;
      if (!track || !car)
        throw new Error(`Missing ${root} Newcity1 or Stock Eagle3`);
      trackSelect.value = track;
      carSelect.value = car;
      await window.carma.loadRace();
      window.carma.paused = false;
      document.querySelector("#panel").hidden = true;
      return { track, car };
    }, dataRoot);
    await page.waitForFunction(
      () =>
        window.carma?.populationLoadState?.pedestrians?.state === "ready" &&
        window.carma?.pedestrians?.nativeLifecycle?.physical > 0,
      null,
      { timeout: 90000 },
    );
    await page.evaluate(() => (window.carma.paused = true));
    const result = await page.evaluate(
      ({ lying, candidateIndex }) => {
        const c = window.carma,
          system = c.pedestrians,
          runtime = system.nativeRuntime,
          bridge = system.nativeBridge;
        if (!bridge) throw new Error("Ordinary native bridge is unavailable");
        const available = runtime.characters.filter(
          (row) =>
            row.body &&
            row.instance &&
            row.formKey === "BIPED1" &&
            row.hitPoints > 0 &&
            !(row.flags & 0x180) &&
            !row.instance.physicsActive &&
            row.diagnostics.size === 0 &&
            system.renderActors.has(row.owner) &&
            system.peds.find((ped) => ped.object === row.owner)?.alive,
        );
        // Selection is bounded and retains original authored population/FORM capacities.
        const nearestCarDistance = (row) =>
          Math.sqrt(
            Math.min(
              ...c.simulation.cars.map((car) =>
                (
                  row.body?.state.position ?? row.owner.position
                ).distanceToSquared(car.state.position),
              ),
            ),
          );
        const candidates = available
          .sort((a, b) => nearestCarDistance(b) - nearestCarDistance(a))
          .slice(0, 3);
        if (candidates[0] && nearestCarDistance(candidates[0]) < 2.5)
          throw new Error(
            `No existing passive candidate is clear of traffic: nearest car ${nearestCarDistance(candidates[0])}`,
          );
        const character = candidates[candidateIndex];
        if (!character)
          throw new Error(
            `No diagnostic-free living passive ordinary BIPED1; candidates=${JSON.stringify(
              runtime.characters
                .filter((row) => row.body)
                .slice(0, 3)
                .map((row) => ({
                  personality: row.personality,
                  form: row.formKey,
                  hp: row.hitPoints,
                  active: row.instance?.physicsActive,
                  diagnostics: [...row.diagnostics],
                })),
            )}`,
          );
        const owner = character.owner,
          body = character.body,
          instance = character.instance,
          ped = system.peds.find((row) => row.object === owner),
          gameplay = bridge.gameplay.state(owner),
          start = Math.max(0, Math.trunc(c.stats.gameTimeMs)),
          camera = body.state.position.clone(),
          allocated = new Set(runtime.simpleResources),
          population = runtime.characters.slice();
        const threat = {
          position: c.player.state.position,
          yaw: c.player.state.heading,
          speed: 0,
          velocity: c.player.state.velocity,
        };
        const update = (timeMs) =>
          system.update(0.04, threat, {
            gameTimeMs: timeMs,
            physicsTickMs: Math.round(c.simulation.elapsed * 1000) >>> 0,
            framePeriodMs: 40,
            cameraPosition: camera,
            threats: [],
            combatOwner: c.player,
            combatPosition: c.player.state.position,
          });
        update(start + 40);
        update(start + 80);
        if (!(character.flags & 0x40))
          throw new Error(
            "Two normal outer visits did not arm source falling eligibility flag40",
          );
        const before = {
          hp: character.hitPoints,
          flags: character.flags,
          action: gameplay.action,
          move: character.moveId,
          root: Array.from(instance.rootPose),
          hits: system.hits,
          count: system.count,
          process: bridge.processes.slots.length,
          ground: bridge.steering.grounding.pool.size,
        };
        const halt = [],
          quietFrames = [],
          completion = [],
          grounds = [],
          transitions = [];
        const originalHalt = runtime.hooks.onHalt,
          originalComplete = runtime.hooks.onMoveCompleted,
          originalGround = bridge.steering.grounding.advance;
        runtime.hooks.onHalt = (ctx, reason) => {
          if (ctx.owner !== owner) return originalHalt?.(ctx, reason);
          const event = {
            time: ctx.timeMs,
            reason,
            beforeMove: ctx.character.moveId,
            orientationY: ctx.instance.characterOrientation[4],
            normals: ctx.body.worldFaceNormals.map((normal) =>
              normal.toArray(),
            ),
            firstNormal: ctx.body.firstWorldFaceNormal?.toArray() ?? null,
          };
          const result = originalHalt?.(ctx, reason);
          halt.push({
            ...event,
            result,
            afterMove: ctx.character.moveId,
            action: gameplay.action,
            hp: ctx.character.hitPoints,
          });
          return result;
        };
        runtime.hooks.onMoveCompleted = (row, current, timeMs) => {
          if (row.owner !== owner)
            return originalComplete?.(row, current, timeMs);
          const event = {
            time: timeMs,
            move: current.moveId,
            callbackFlags: gameplay.callback.flags,
            completionRequested: current.completionRequested,
            hadFace: !!gameplay.cache?.faceCache,
          };
          const result = originalComplete?.(row, current, timeMs);
          completion.push({
            ...event,
            afterMove: row.moveId,
            action: gameplay.action,
            faceReleased: gameplay.cache?.faceCache === null,
          });
          return result;
        };
        bridge.steering.grounding.advance = function (ctx) {
          const result = originalGround.call(this, ctx);
          if (ctx.owner === owner)
            grounds.push({
              time: ctx.timeMs,
              status: result.ground.status,
              completion: result.completion,
            });
          return result;
        };
        const snapshot = (time, phase) => ({
          time,
          phase,
          move: character.moveId,
          action: gameplay.action,
          hp: character.hitPoints,
          flags: character.flags,
          active: !!character.instance?.physicsActive,
          phil: character.body ? c.simulation.phil.getState(character.body) : 0,
          position: body.state.position.toArray(),
          velocity: body.state.velocity.toArray(),
          quiet: body.quietState,
          doNothing: body.doNothing,
          omega: body.state.angularVelocity.toArray(),
          collisionFlags: body.collisionFlags,
          gravityIncrement: body.gravityIncrement.toArray(),
          beforeV: body.beforeWorldVelocity.toArray(),
          ring: [
            ...(c.simulation.pedContactRings.get(body) ?? new Set([body])),
          ].map((member) => ({
            selected: member === body,
            kind: member.kind ?? "car-or-part",
            name:
              member.owner?.name ??
              member.actor?.name ??
              member.config?.name ??
              null,
            quiet: c.simulation.nativeQuietRingState(member),
            genericQuiet:
              c.simulation.hierarchyQuiet.get(member)?.quietState ?? null,
            genericGate:
              c.simulation.hierarchyQuiet.get(member)?.lastResult?.gate ?? null,
            doNothing: member.doNothing ?? null,
            speed: member.state.velocity.length(),
            phil: c.simulation.phil.getState(member),
          })),
        });
        let lift,
          afterFall,
          steps = 0;
        try {
          const lifted = instance.rootPose.slice();
          lifted[10] += 1;
          lift = runtime.setRootPose(owner, lifted);
          if (lift.status !== "complete")
            throw new Error(
              `Controlled passive root lift failed: ${JSON.stringify(lift)}`,
            );
          // Teleporting the source root invalidates retained support, like the
          // native changed-point invalidation owner; no floor normal is supplied.
          bridge.steering.grounding.invalidate(owner);
          update(start + 120);
          afterFall = snapshot(start + 120, "ordinary-source-fall");
          transitions.push(afterFall);
          if (lying && character.instance?.physicsActive) {
            const axis = body.state.position.clone().set(1, 0, 0),
              rotation = body.state.orientation
                .clone()
                .setFromAxisAngle(axis, Math.PI / 2);
            body.state.orientation.premultiply(rotation).normalize();
          }
          for (let step = 1; step <= 120; step++) {
            const time = start + 120 + step * 40;
            update(time);
            c.simulation.updateFrame(time, 40);
            system.finishPhysics();
            const current = snapshot(time, "physical-frame");
            quietFrames.push(current);
            const last = transitions.at(-1);
            if (
              current.move !== last.move ||
              current.action !== last.action ||
              current.active !== last.active ||
              current.hp !== last.hp
            )
              transitions.push(current);
            steps = step;
            if (
              !character.body ||
              character.hitPoints <= 0 ||
              character.flags & 0x180
            )
              break;
            if (
              halt.some((event) => event.result?.returnValue === 1) &&
              !current.active &&
              current.move === 41
            )
              break;
          }
          const final = snapshot(start + 120 + steps * 40, "final");
          const gl = c.renderer.getContext(),
            debug = gl.getExtension("WEBGL_debug_renderer_info");
          return {
            personality: character.personality,
            actor: owner.name,
            form: character.formKey,
            selectedAmong: candidates.length,
            candidatePersonalities: candidates.map((row) => ({
              personality: row.personality,
              actor: row.owner.name,
              nearestCarDistance: nearestCarDistance(row),
            })),
            nearestCarDistance: nearestCarDistance(character),
            before,
            lift,
            afterFall,
            steps,
            grounds,
            quietFrames,
            halt,
            completion,
            transitions,
            final,
            bodyRetained: character.body === body && body.owner === owner,
            instanceRetained: character.instance === instance,
            populationRetained:
              runtime.characters.length === population.length &&
              runtime.characters.every((row, i) => row === population[i]),
            poolBounded:
              allocated.size === runtime.simpleResources.size &&
              [...runtime.simpleResources].every((row) => allocated.has(row)),
            duplicateBodyOwners: c.simulation.pedBodies.filter(
              (row) => row.owner === owner,
            ).length,
            diagnostics: [...character.diagnostics],
            bodyDiagnostics: [...body.diagnostics],
            worldFaceNormals: body.worldFaceNormals.map((normal) =>
              normal.toArray(),
            ),
            graphics: {
              renderer: debug
                ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
                : gl.getParameter(gl.RENDERER),
              buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
              error: gl.getError(),
            },
          };
        } finally {
          runtime.hooks.onHalt = originalHalt;
          runtime.hooks.onMoveCompleted = originalComplete;
          bridge.steering.grounding.advance = originalGround;
        }
      },
      {
        lying: process.env.PED_RECOVERY_LYING === "1",
        candidateIndex: Number(
          process.env.PED_RECOVERY_CANDIDATE ??
            (dataRoot === "adv_data" ? 1 : 0),
        ),
      },
    );
    report.cases.push({ dataRoot, selection, ...result });
    console.log(
      `${dataRoot} recovery: ${JSON.stringify({ personality: result.personality, nearestCarDistance: result.nearestCarDistance, steps: result.steps, halt: result.halt, completion: result.completion, final: result.final, diagnostics: result.diagnostics })}`,
    );
    try {
      assert.equal(
        result.afterFall.active,
        true,
        `${dataRoot}: normal unsupported support activates PHIL`,
      );
      assert.equal(
        result.afterFall.move,
        72,
        `${dataRoot}: source fall selects move72`,
      );
      assert.equal(
        result.afterFall.action,
        3,
        `${dataRoot}: source fall owns action3`,
      );
      assert.equal(
        result.grounds.filter((event) => event.status === "fall").length,
        1,
        `${dataRoot}: falling transition runs once`,
      );
      assert.equal(
        result.afterFall.hp,
        result.before.hp,
        `${dataRoot}: setup changes no HP`,
      );
      assert.equal(
        result.halt.filter((event) => event.result?.returnValue === 1).length,
        1,
        `${dataRoot}: actual solver reaches accepted native halt within120 steps`,
      );
      assert.ok(
        result.halt.every((event) => event.normals.length > 0),
        `${dataRoot}: halt uses actual collected world faces`,
      );
      assert.ok(
        result.halt.some((event) => [41, 80, 81].includes(event.afterMove)),
        `${dataRoot}: native living recovery move selected`,
      );
      assert.equal(
        result.final.move,
        41,
        `${dataRoot}: living recovery returns to authored running41`,
      );
      assert.equal(
        result.final.active,
        false,
        `${dataRoot}: accepted halt retains passive character ownership`,
      );
      assert.ok(
        result.final.hp > 0,
        `${dataRoot}: ordinary fall remains living`,
      );
      const getups = result.halt.filter((event) =>
        [80, 81].includes(event.afterMove),
      );
      if (getups.length) {
        assert.equal(
          result.completion.filter((event) => [80, 81].includes(event.move))
            .length,
          1,
          `${dataRoot}: get-up completion dispatches exactly once`,
        );
        const event = result.completion.find((row) =>
          [80, 81].includes(row.move),
        );
        assert.equal(
          event.callbackFlags & 2,
          0,
          `${dataRoot}: completion callback bit cleared before callback`,
        );
        assert.equal(
          event.faceReleased,
          true,
          `${dataRoot}: completion releases selected face slot`,
        );
      }
      assert.equal(
        result.bodyRetained &&
          result.instanceRetained &&
          result.populationRetained &&
          result.poolBounded,
        true,
        `${dataRoot}: source resource/census owners remain bounded`,
      );
      assert.equal(
        result.duplicateBodyOwners,
        1,
        `${dataRoot}: exactly one retained body owns the population actor`,
      );
      assert.deepEqual(
        result.diagnostics,
        [],
        `${dataRoot}: no unresolved source provider`,
      );
      assert.deepEqual(
        result.bodyDiagnostics,
        [],
        `${dataRoot}: no physical provider failures`,
      );
      assert.equal(result.graphics.error, 0, `${dataRoot}: no WebGL error`);
    } catch (error) {
      (report.validationFailures ??= []).push({
        dataRoot,
        failure: String(error?.stack ?? error),
      });
    }
    await page.screenshot({
      path: `artifacts/browser-ped-recovery-${dataRoot}.png`,
    });
  }
  assert.deepEqual(report.validationFailures ?? [], []);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  assert.deepEqual(report.badResponses, []);
} catch (error) {
  report.failure = String(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  await writeFile(
    "artifacts/browser-ped-recovery.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
  server.kill("SIGTERM");
}
console.log(
  JSON.stringify(
    {
      artifact: "artifacts/browser-ped-recovery.json",
      cases: report.cases.map(
        ({ dataRoot, personality, steps, final, halt, completion }) => ({
          dataRoot,
          personality,
          steps,
          final,
          halt,
          completion,
        }),
      ),
      errors: report.errors,
      failedRequests: report.failedRequests,
      badResponses: report.badResponses,
      validationFailures: report.validationFailures,
      failure: report.failure,
    },
    null,
    2,
  ),
);
