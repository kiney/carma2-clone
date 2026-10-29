import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const assetRoot = process.env.CARMA2_ROOT || "carma2_orig";
try {
  await access(executable);
  await access(assetRoot);
} catch {
  console.log(
    "SKIP ordinary native pedestrian browser test: Chromium or C2 assets absent",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = Number(process.env.PED_ORDINARY_PORT || 5268);
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
let browser;
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));
const report = {
  mode: "Normal authored pedestrian population and production native lifecycle",
  cases: [],
  errors: [],
  failedRequests: [],
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
  assert.ok(ready, `production asset server did not start: ${serverLog}`);
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
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });

  const selectRace = async (root) => {
    const selection = await page.evaluate((dataRoot) => {
      const track = [...document.querySelector("#track-select").options].find(
        (option) =>
          option.value.toLowerCase().startsWith(`${dataRoot}/`) &&
          /newcity1/i.test(`${option.value} ${option.textContent}`),
      )?.value;
      const car = [...document.querySelector("#car-select").options].find(
        (option) =>
          option.value.toLowerCase() === "data/cars/eagle3/eagle3.txt",
      )?.value;
      if (!track || !car)
        throw new Error(
          `Missing ${dataRoot} Newcity1 or Stock Eagle3 selection`,
        );
      document.querySelector("#track-select").value = track;
      document.querySelector("#car-select").value = car;
      return { track, car };
    }, root);
    await page.evaluate(async () => {
      const c = window.carma;
      await c.loadRace();
      c.paused = false;
      document.querySelector("#panel").hidden = true;
    });
    await page.waitForFunction(
      () =>
        window.carma?.stats.ready &&
        window.carma?.populationLoadState?.pedestrians?.state === "ready" &&
        window.carma?.pedestrians?.count > 0,
      null,
      { timeout: 90000 },
    );
    // Let normal RAF/gameplay frames admit nearby authored pedestrian owners.
    await page.waitForFunction(
      () => (window.carma?.pedestrians?.nativeLifecycle?.physical ?? 0) > 0,
      null,
      { timeout: 30000 },
    );
    await page.waitForTimeout(500);
    await page.evaluate(() => (window.carma.paused = true));
    await page.waitForFunction(() => window.carma.paused);
    return selection;
  };

  const inspectPopulation = async () =>
    page.evaluate(() => {
      const c = window.carma;
      const system = c.pedestrians;
      const runtime = system.nativeRuntime;
      const physical = runtime.characters.filter((character) => character.body);
      const renderActors = system.renderActors;
      const candidates = physical
        .map((character) => ({
          character,
          ped: system.peds.find((ped) => ped.object === character.owner),
        }))
        .filter(
          ({ character, ped }) => ped && renderActors.has(character.owner),
        );
      const chosen = candidates[0];
      if (!chosen)
        throw new Error(
          "No ordinary population identity owns a native PHIL body",
        );
      const { character, ped } = chosen;
      const body = character.body;
      const instance = character.instance;
      const tuple = (value) =>
        Array.isArray(value) ? value : (value?.toArray?.() ?? null);
      const poolBodies = c.simulation.pedBodies.filter(
        (candidate) => candidate.owner,
      );
      return {
        count: system.count,
        failures: system.populationFailures,
        hits: system.hits,
        populationOwnerCount: system.renderActors.size,
        native: {
          lifecycle: system.nativeLifecycle,
          runtimeCharacterCount: runtime.characters.length,
          physicalCharacterCount: physical.length,
          physicalBodies: c.simulation.pedBodies.length,
          poolBodiesWithOwner: poolBodies.length,
          duplicateBodyOwners:
            poolBodies.length -
            new Set(poolBodies.map((body) => body.owner)).size,
          ownerIsOriginalPopulationActor:
            renderActors.has(character.owner) &&
            system.group.children.includes(character.owner),
          personality: character.personality,
          populationPersonality: ped.personality,
          nativeForm: character.formKey,
          philState: c.simulation.phil.getState(body),
          alive: ped.alive,
          corporeal: ped.corporeal,
          ordinaryVisualVisible: ped.visual.visible,
          nativeRenderVisible: instance?.group.visible ?? false,
          profileMass: ped.profile.mass,
          instanceMass: instance?.hullProfile.mass,
          bodyMass: body.properties.mass,
          profileCentreOfMass: instance?.template.profile.centreOfMass,
          instanceCentreOfMass: instance?.hullProfile.centreOfMass,
          bodyCentreOfMass: tuple(body.properties.centerOfMass),
          profileInertia: instance?.hullProfile.inertia,
          bodyInertia: tuple(body.properties.inertia),
          position: body.state.position.toArray(),
          velocity: body.state.velocity.toArray(),
          hitPoints: character.hitPoints,
          impactCount: character.impactCount,
          flags: character.flags,
          actorName: character.owner.name,
        },
      };
    });

  const runContactAndReset = async () =>
    page.evaluate(async () => {
      const c = window.carma;
      const system = c.pedestrians;
      const runtime = system.nativeRuntime;
      const available = runtime.characters.filter(
        (row) =>
          row.body &&
          row.instance &&
          system.renderActors.has(row.owner) &&
          system.peds.find((ped) => ped.object === row.owner)?.alive,
      );
      const character =
        available.find((row) => row.formKey === "BIPED1") ?? available[0];
      if (!character)
        throw new Error(
          "No active ordinary pedestrian body available for contact fixture",
        );
      const target = character.body;
      window.__pedOrdinaryContactOwner = character.owner;
      const before = {
        hitPoints: character.hitPoints,
        impactCount: character.impactCount,
        flags: character.flags,
        hits: system.hits,
        count: system.count,
        target: target.state.position.toArray(),
      };
      // Move only the player car into the already-authored, already-admitted
      // pedestrian lane. The pedestrian owner, pose, census and render stay intact.
      const direction = character.direction;
      const length = Math.hypot(direction[0], direction[2]) || 1;
      const x = direction[0] / length;
      const z = direction[2] / length;
      const car = c.player;
      const distance = 0.65;
      c.simulation.reset(car);
      car.state.position.set(
        target.state.position.x - x * distance,
        target.state.position.y,
        target.state.position.z - z * distance,
      );
      car.state.velocity.set(x * 3, 0, z * 3);
      car.state.angularVelocity.set(0, 0, 0);
      // Car forward is local -Z: invert the ped-lane vector when deriving yaw.
      car.state.heading = Math.atan2(-x, -z);
      car.state.orientation.set(
        0,
        Math.sin(car.state.heading / 2),
        0,
        Math.cos(car.state.heading / 2),
      );
      car.input.throttle = 0;
      car.input.brake = 0;
      car.input.steer = 0;
      car.input.handbrake = false;
      car.state.speed = 3;
      const start = Math.max(0, Math.trunc(c.stats.gameTimeMs));
      for (let step = 0; step < 20; step++) {
        c.simulation.updateFrame(start + step * 40, 40);
        system.finishPhysics();
      }
      const after = {
        hitPoints: character.hitPoints,
        impactCount: character.impactCount,
        flags: character.flags,
        hits: system.hits,
        count: system.count,
        position: target.state.position.toArray(),
      };
      if (character.hitPoints === 0 || character.flags & 0x100) {
        for (let step = 20; step < 30; step++) {
          c.simulation.updateFrame(start + step * 40, 40);
          system.finishPhysics();
        }
      }
      return {
        before,
        after,
        finalHits: system.hits,
        countedFlag: !!(character.flags & 0x100),
        sameOrdinaryOwner: system.renderActors.has(character.owner),
        sameBodyOwner: target.owner === character.owner,
      };
    });

  const runOffscreenReacquire = async () =>
    page.evaluate(() => {
      const c = window.carma,
        system = c.pedestrians,
        bridge = system.nativeBridge,
        runtime = system.nativeRuntime;
      const active = runtime.characters.find(
        (row) =>
          row.owner === window.__pedOrdinaryContactOwner &&
          row.body &&
          row.instance &&
          c.simulation.phil.getState(row.body) === 2,
      );
      if (!active)
        throw new Error(
          "Actual collision owner is not PHIL header2 before scope exit",
        );
      // A second original, intact owner proves the separate passive resource
      // path. Never force the collided actor asleep to obtain reacquisition.
      const passive = runtime.characters
        .filter(
          (row) =>
            row !== active &&
            row.body &&
            row.instance &&
            c.simulation.phil.getState(row.body) === 1 &&
            !row.instance.physicsActive &&
            row.hitPoints > 0 &&
            !(row.flags & 0x80) &&
            !row.removedBoneMask &&
            system.renderActors.has(row.owner),
        )
        .slice(0, 3)[0];
      if (!passive)
        throw new Error(
          "No genuine original passive owner for resource reacquisition",
        );
      const activeBody = active.body,
        passiveBody = passive.body,
        activeInstance = active.instance,
        allocatedBodies = new Set(runtime.simpleResources),
        actorCount = system.renderActors.size,
        characters = runtime.characters.slice(),
        nearActive = [...active.position],
        nearPassive = [...passive.position],
        before = {
          flags: active.flags,
          hp: active.hitPoints,
          action: bridge.gameplay.state(active.owner).action,
          header: c.simulation.phil.getState(activeBody),
          passiveFlags: passive.flags,
          passiveHP: passive.hitPoints,
        },
        settings = {
          processDistance: system.settings.processDistance,
          popupDistance: system.settings.popupDistance,
          innerProcessDistance: Math.fround(
            system.settings.processDistance * 0.6,
          ),
          innerPopupDistance: Math.fround(system.settings.popupDistance * 0.6),
        };
      const countCalls = [],
        oneLess = system.oneLessNativePed;
      system.oneLessNativePed = function (owner, ...args) {
        const counted = oneLess.call(this, owner, ...args);
        if (owner === active.owner)
          countCalls.push({
            counted,
            flags: active.flags,
            hp: active.hitPoints,
          });
        return counted;
      };
      const record = (row) => {
        const view = new DataView(
          bridge.records.memory.buffer,
          bridge.nativeAddress(row.owner),
          0x54,
        );
        return {
          hp: view.getInt8(4),
          flags: view.getUint16(8, true),
          action: view.getInt32(0x10, true),
        };
      };
      const time = Math.max(0, Math.trunc(c.stats.gameTimeMs)) + 8001;
      try {
        // Native Munge4d5369: an actual active root sets80 before release,
        // counts once afterwards, then scores a living owner (HP0/action6).
        runtime.prepareFrame({
          cameraOrigin: [100000, 100000, 100000],
          timeMs: time,
          settings,
          pedNearness: true,
        });
        system.finishPhysics();
        const released = {
          activeBody: active.body === null,
          activeInstance: active.instance === null,
          passiveBody: passive.body === null,
          passiveInstance: passive.instance === null,
          activeUnregistered: c.simulation.phil.getState(activeBody) === 0,
          passiveUnregistered: c.simulation.phil.getState(passiveBody) === 0,
          activeACTDetached: activeInstance.group.parent === null,
          record: record(active),
          flags: active.flags,
          hp: active.hitPoints,
          action: bridge.gameplay.state(active.owner).action,
        };
        runtime.prepareFrame({
          cameraOrigin: nearActive,
          timeMs: time + 40,
          settings,
          pedNearness: true,
        });
        system.finishPhysics();
        const activeReacquired = !!active.body || !!active.instance;
        runtime.prepareFrame({
          cameraOrigin: nearPassive,
          timeMs: time + 80,
          settings,
          pedNearness: true,
        });
        system.finishPhysics();
        const owners = c.simulation.phil.registeredBodies.filter(
          (body) => body.owner === passive.owner,
        );
        return {
          before,
          released,
          countCalls,
          activeReacquired,
          activeStillReleased: active.body === null && active.instance === null,
          activeFinalRecord: record(active),
          activeStillOriginal: system.renderActors.has(active.owner),
          sameCensus:
            runtime.characters.length === characters.length &&
            runtime.characters.every((row, i) => row === characters[i]),
          actorCount,
          actorCountAfter: system.renderActors.size,
          passive: {
            originalOwner: system.renderActors.has(passive.owner),
            reacquired: !!passive.body && !!passive.instance,
            bodyOwner: passive.body?.owner === passive.owner,
            flags: passive.flags,
            hp: passive.hitPoints,
            bodyWasPreallocated:
              allocatedBodies.has(passive.body) &&
              allocatedBodies.size === runtime.simpleResources.size,
            philState: passive.body
              ? c.simulation.phil.getState(passive.body)
              : 0,
            duplicateOwnerBodies: owners.length,
          },
        };
      } finally {
        system.oneLessNativePed = oneLess;
      }
    });

  for (const dataRoot of ["data", "adv_data"]) {
    const selection = await selectRace(dataRoot);
    console.log(`Loaded ${dataRoot} ordinary population`);
    const first = await inspectPopulation();
    const native = first.native;
    assert.ok(
      first.count > 0,
      `${dataRoot}: authored ordinary population loaded`,
    );
    assert.ok(
      native.runtimeCharacterCount >= first.populationOwnerCount,
      `${dataRoot}: normal owner census enrolled`,
    );
    assert.ok(
      native.physicalCharacterCount > 0,
      `${dataRoot}: normal running frames admitted a physical pedestrian`,
    );
    assert.equal(
      native.ownerIsOriginalPopulationActor,
      true,
      `${dataRoot}: PHIL owner is its original population identity`,
    );
    assert.equal(
      native.personality,
      native.populationPersonality,
      `${dataRoot}: owner retains its configured personality`,
    );
    assert.equal(
      native.duplicateBodyOwners,
      0,
      `${dataRoot}: one physical body per ordinary owner`,
    );
    assert.equal(
      native.poolBodiesWithOwner,
      native.physicalCharacterCount,
      `${dataRoot}: no duplicate/unowned physical roots`,
    );
    assert.deepEqual(
      first.failures,
      [],
      `${dataRoot}: native population has no missing authored personalities`,
    );
    assert.ok(
      native.philState > 0,
      `${dataRoot}: admitted ordinary owner is registered in PHIL`,
    );
    assert.ok(
      native.instanceMass > 0 &&
        Math.abs(native.bodyMass - native.instanceMass) < 1e-8,
      `${dataRoot}: authored FORM mass reaches PHIL`,
    );
    assert.deepEqual(
      native.profileCentreOfMass,
      native.instanceCentreOfMass,
      `${dataRoot}: authored COM reaches native instance`,
    );
    assert.deepEqual(
      native.bodyCentreOfMass,
      native.instanceCentreOfMass,
      `${dataRoot}: PHIL COM matches the authored hull profile`,
    );
    for (let axis = 0; axis < 3; axis++)
      assert.ok(
        Math.abs(native.bodyInertia[axis] - native.profileInertia[axis]) < 1e-8,
        `${dataRoot}: authored inertia axis${axis}`,
      );
    assert.equal(
      native.ordinaryVisualVisible,
      false,
      `${dataRoot}: old ordinary rendering is hidden while native instance owns display`,
    );
    assert.equal(
      native.nativeRenderVisible,
      true,
      `${dataRoot}: native instance is the visible presentation owner`,
    );
    console.log(`Checking ${dataRoot} actual contacts`);
    const contact = await runContactAndReset();
    console.log(`Contact ${dataRoot}: ${JSON.stringify(contact)}`);
    assert.ok(
      contact.after.impactCount > contact.before.impactCount ||
        contact.after.hitPoints < contact.before.hitPoints,
      `${dataRoot}: actual player collision reaches the ordinary PHIL body`,
    );
    assert.equal(
      contact.sameOrdinaryOwner,
      true,
      `${dataRoot}: real contact retains authored census identity`,
    );
    assert.equal(
      contact.sameBodyOwner,
      true,
      `${dataRoot}: real contact retains PHIL owner identity`,
    );
    if (contact.countedFlag)
      assert.equal(
        contact.finalHits,
        contact.before.hits + 1,
        `${dataRoot}: corpse contacts count the population once`,
      );

    const offscreen = await runOffscreenReacquire();
    console.log(`Offscreen ${dataRoot}: ${JSON.stringify(offscreen)}`);
    assert.ok(
      offscreen.sameCensus &&
        offscreen.activeStillOriginal &&
        offscreen.passive.originalOwner,
      `${dataRoot}: scope changes preserve the original census identities`,
    );
    assert.equal(
      offscreen.before.header,
      2,
      `${dataRoot}: collided root is genuinely active before scope exit`,
    );
    assert.ok(
      Object.entries(offscreen.released)
        .filter(([key]) => !["record", "flags", "hp", "action"].includes(key))
        .every(([, value]) => value === true),
      `${dataRoot}: active and passive owners release their real ACT/PHIL resources`,
    );
    assert.ok(
      offscreen.released.flags & 0x80,
      `${dataRoot}: active offscope sets source vanish80`,
    );
    assert.ok(
      offscreen.released.flags & 0x100,
      `${dataRoot}: active offscope retains source counted100`,
    );
    assert.equal(
      offscreen.released.hp,
      0,
      `${dataRoot}: active offscope scores living HP to0`,
    );
    assert.equal(
      offscreen.released.action,
      6,
      `${dataRoot}: active offscope retains source dead action6`,
    );
    assert.equal(
      offscreen.countCalls.length,
      1,
      `${dataRoot}: source offscope invokes population outlet once`,
    );
    assert.equal(
      offscreen.countCalls.filter((row) => row.counted).length,
      offscreen.before.flags & 0x100 ? 0 : 1,
      `${dataRoot}: counted corpse is never counted twice`,
    );
    assert.deepEqual(
      offscreen.released.record,
      {
        hp: offscreen.released.hp,
        flags: offscreen.released.flags & 0xffff,
        action: 6,
      },
      `${dataRoot}: source record bytes mirror released HP/flags/action`,
    );
    assert.ok(
      !offscreen.activeReacquired && offscreen.activeStillReleased,
      `${dataRoot}: source vanished active corpse cannot reacquire resources`,
    );
    assert.deepEqual(
      offscreen.activeFinalRecord,
      offscreen.released.record,
      `${dataRoot}: near visits do not revive the vanished source record`,
    );
    assert.ok(
      offscreen.passive.reacquired &&
        offscreen.passive.bodyOwner &&
        offscreen.passive.bodyWasPreallocated,
      `${dataRoot}: genuine passive owner reacquires a preallocated FORM slot`,
    );
    assert.equal(
      offscreen.passive.philState,
      1,
      `${dataRoot}: intact passive resource returns in PHIL header1`,
    );
    assert.equal(
      offscreen.passive.duplicateOwnerBodies,
      1,
      `${dataRoot}: passive reacquisition has one body`,
    );
    assert.equal(
      offscreen.passive.hp,
      offscreen.before.passiveHP,
      `${dataRoot}: passive scope cycle preserves HP`,
    );
    assert.equal(
      offscreen.passive.flags & 0x180,
      offscreen.before.passiveFlags & 0x180,
      `${dataRoot}: passive resource cycle does not vanish or count the actor`,
    );
    assert.equal(
      offscreen.actorCountAfter,
      offscreen.actorCount,
      `${dataRoot}: no population identity created or lost`,
    );

    console.log(`Reloading ${dataRoot}`);
    const teardown = await page.evaluate(() => {
      const c = window.carma;
      const oldSystem = c.pedestrians;
      const oldRuntime = oldSystem.nativeRuntime;
      const oldBodies = oldRuntime.characters
        .map((character) => character.body)
        .filter(Boolean);
      const oldGenerationActors = [...oldSystem.renderActors];
      const oldCensus = {
        count: oldSystem.count,
        groupCounts: [...oldSystem.groupCounts],
      };
      window.__pedOrdinaryOld = { oldRuntime, oldBodies, oldGenerationActors };
      return { oldCensus };
    });
    await page.evaluate(async () => {
      const c = window.carma;
      await c.loadRace();
      c.paused = false;
    });
    await page.waitForFunction(
      () =>
        window.carma?.stats.ready &&
        window.carma?.populationLoadState?.pedestrians?.state === "ready" &&
        window.carma?.pedestrians?.count > 0,
      null,
      { timeout: 90000 },
    );
    await page.waitForFunction(
      () => (window.carma?.pedestrians?.nativeLifecycle?.physical ?? 0) > 0,
      null,
      { timeout: 30000 },
    );
    await page.waitForTimeout(250);
    await page.evaluate(() => (window.carma.paused = true));
    const reset = await page.evaluate(() => {
      const c = window.carma;
      const system = c.pedestrians;
      return {
        lifecycle: system.nativeLifecycle,
        count: system.count,
        groupCounts: [...system.groupCounts],
        actors: [...system.renderActors],
        bodies: c.simulation.pedBodies.length,
      };
    });
    const oldAudit = await page.evaluate(() => ({
      characters: window.__pedOrdinaryOld.oldRuntime.characters.length,
      oldBodiesStillRegistered: window.__pedOrdinaryOld.oldBodies.filter(
        (body) => window.carma.simulation.pedBodies.includes(body),
      ).length,
      sameRuntime:
        window.carma.pedestrians.nativeRuntime ===
        window.__pedOrdinaryOld.oldRuntime,
      hasFreshActor: [...window.carma.pedestrians.renderActors].some(
        (actor) => !window.__pedOrdinaryOld.oldGenerationActors.includes(actor),
      ),
    }));
    assert.equal(
      oldAudit.characters,
      0,
      `${dataRoot}: prior runtime cleared at race reset`,
    );
    assert.equal(
      oldAudit.oldBodiesStillRegistered,
      0,
      `${dataRoot}: prior PHIL bodies removed at reset`,
    );
    assert.equal(
      oldAudit.sameRuntime,
      false,
      `${dataRoot}: fresh native lifecycle allocated`,
    );
    assert.equal(
      oldAudit.hasFreshActor,
      true,
      `${dataRoot}: fresh authored population identities created`,
    );
    assert.ok(
      reset.count > 0 &&
        reset.lifecycle.enrolled > 0 &&
        reset.lifecycle.physical > 0,
      `${dataRoot}: new census re-enrolled through ordinary population`,
    );
    report.cases.push({
      dataRoot,
      selection,
      first: {
        count: first.count,
        hits: first.hits,
        populationOwnerCount: first.populationOwnerCount,
        native: { ...native, position: undefined },
      },
      contact,
      offscreen,
      priorCensus: teardown.oldCensus,
      reset: {
        count: reset.count,
        groupCounts: reset.groupCounts,
        lifecycle: reset.lifecycle,
        bodyCount: reset.bodies,
      },
    });
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  await writeFile(
    "artifacts/browser-ped-ordinary.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = String(error?.stack ?? error);
  await writeFile(
    "artifacts/browser-ped-ordinary.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
