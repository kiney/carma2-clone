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
    "SKIP priority browser regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}
await mkdir("artifacts", { recursive: true });
const port = 5191;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));
let browser;
async function settleView(page) {
  await page.evaluate(() => (document.querySelector("#panel").hidden = true));
  await page.evaluate(async () => {
    // Chase-camera smoothing needs committed render frames after long test
    // teleports, rather than a wall-clock sleep on a software renderer.
    for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
  });
}
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
  await page.waitForFunction(() => window.carma?.stats.ready, {
    timeout: 90000,
  });
  await page.evaluate(async () => {
    const c = window.carma;
    const track = c.assets.resolve("data/RACES/newcity1/newcity1.txt");
    const car = c.assets.resolve("data/CARS/EAGLE3/EAGLE3.TXT");
    if (!track || !car)
      throw new Error("Stock New City/EAGLE3 not in manifest");
    document.querySelector("#track-select").value = track;
    document.querySelector("#car-select").value = car;
    await c.loadRace();
    c.paused = true;
    document.querySelector("#panel").hidden = true;
    const gl = document.querySelector("#view").getContext("webgl2");
    if (!gl) throw new Error("WebGL2 context unavailable");
    const errors = [];
    for (let i = 0; i < 16; i++) {
      const error = gl.getError();
      if (error === gl.NO_ERROR) break;
      errors.push(error);
    }
    if (errors.length)
      throw new Error(`Initial WebGL errors: ${errors.join(",")}`);
  });
  await page.waitForFunction(
    () => window.carma.stats.ready && window.carma.paused,
    { timeout: 90000 },
  );
  await settleView(page);
  await page.screenshot({ path: "artifacts/browser-priority-newcity.png" });

  const minePickup = await page.evaluate(() => {
    const c = window.carma;
    const p = c.player;
    const startPosition = p.state.position.clone();
    const startHeading = p.state.heading;
    const pickup = c.powerups.pickups.find((item) => item.index === 52);
    if (!pickup)
      throw new Error("New City has no stock mine pickup (index 52)");
    p.state.position.copy(pickup.position);
    p.state.velocity.set(0, 0, 0);
    c.simulation.reset(p);
    c.powerups.resetPath(p.state.position);
    const events = [];
    c.powerups.update(0, p.state, c.race, (event) => events.push(event));
    p.state.position.copy(startPosition);
    p.state.heading = startHeading;
    p.state.velocity.set(0, 0, 0);
    p.state.angularVelocity.set(0, 0, 0);
    c.simulation.reset(p);
    c.powerups.resetPath(p.state.position);
    return {
      events: events.map((event) => [event.kind, event.definition.action]),
      charges: c.powerups.abilities.get(52)?.charges ?? 0,
      pickupPosition: pickup.position.toArray(),
      startPosition: startPosition.toArray(),
      restoredPosition: p.state.position.toArray(),
      restoredVelocity: p.state.velocity.toArray(),
    };
  });
  assert.deepEqual(minePickup.events, [["ability", 34]]);
  assert.equal(minePickup.charges, 10, "stock mine pickup grants ten charges");
  assert.deepEqual(minePickup.restoredPosition, minePickup.startPosition);
  assert.deepEqual(minePickup.restoredVelocity, [0, 0, 0]);

  await page.evaluate(() => (window.carma.paused = false));
  await page.keyboard.press("f");
  await page.evaluate(() => (window.carma.paused = true));
  const mineLaunched = await page.evaluate(() => {
    const c = window.carma;
    const body = c.simulation.mineBodies[0];
    if (!body) throw new Error("F did not launch a physical stock mine");
    let meshes = 0;
    body.actor.traverse((object) => {
      if (object.isMesh) meshes++;
    });
    return {
      charges: c.powerups.abilities.get(52)?.charges ?? 0,
      meshes,
      name: body.actor.name,
      inScene: body.actor.parent === c.scene,
      position: body.state.position.toArray(),
    };
  });
  assert.equal(mineLaunched.charges, 9, "F consumes one mine charge");
  assert.ok(mineLaunched.meshes > 0, "mine uses its original rendered model");
  assert.ok(mineLaunched.inScene, "launched mine actor is in the scene");

  const mineImpact = await page.evaluate(() => {
    const c = window.carma;
    const p = c.player;
    const sim = c.simulation;
    const body = sim.mineBodies[0];
    let seed = 12345;
    p.damage.damageContext.random = () => {
      seed = (Math.imul(seed, 214013) + 2531011) >>> 0;
      return ((seed >>> 16) & 32767) / 32768;
    };
    const shapeBefore = p.shapeVertices.map((shape) =>
      shape.map((point) => point.clone()),
    );
    const componentsBefore = Array.from(p.damage.componentLevels);
    const partPhasesBefore = p.damage.runtimeParts.map(
      (part) => part.state.phase,
    );
    const events = [];
    const onMineEvent = sim.onMineEvent;
    sim.onMineEvent = (event) => {
      events.push(event.kind);
      onMineEvent?.(event);
    };
    const carTop = Math.max(
      ...p.hulls.flatMap((hull) => hull.vertices.map((point) => point.y)),
    );
    body.state.position.set(
      p.state.position.x,
      p.state.position.y + carTop + body.properties.radius * 0.7,
      p.state.position.z,
    );
    body.state.velocity.set(0, -4, 0);
    body.state.predictedPosition = undefined;
    body.state.predictedOrientation = undefined;
    for (let i = 0; i < 8; i++) sim.step();
    const moved = p.shapeVertices.some((shape, s) =>
      shape.some((point, i) => point.distanceTo(shapeBefore[s][i]) > 1e-7),
    );
    const partsDetached = p.damage.runtimeParts.some(
      (part, i) => partPhasesBefore[i] !== 2 && part.state.phase === 2,
    );
    return {
      events,
      componentsBefore,
      componentsAfter: Array.from(p.damage.componentLevels),
      moved,
      partsDetached,
      debris: sim.debris.length,
      mineBodies: sim.mineBodies.length,
      mineActorParent: body.actor.parent?.name ?? null,
      shapeBefore: shapeBefore.map((shape) =>
        shape.map((point) => point.toArray()),
      ),
    };
  });
  assert.ok(
    mineImpact.events.includes("crush"),
    `mine crush callback: ${mineImpact.events}`,
  );
  assert.ok(
    mineImpact.events.includes("reaction"),
    `mine reaction callback: ${mineImpact.events}`,
  );
  assert.ok(
    mineImpact.componentsAfter.some(
      (value, i) => value > mineImpact.componentsBefore[i],
    ),
    "mine contact damages authored car components",
  );
  assert.ok(mineImpact.moved, "mine crush leaves persistent local deformation");
  assert.ok(
    mineImpact.partsDetached || mineImpact.debris > 0,
    "mine crush can detach stock parts",
  );
  await settleView(page);
  await page.screenshot({ path: "artifacts/browser-priority-mine.png" });

  const repair = await page.evaluate((shapeBefore) => {
    const c = window.carma;
    const p = c.player;
    c.simulation.repair(p);
    return {
      components: Array.from(p.damage.componentLevels),
      shapeRestored: p.shapeVertices.every((shape, s) =>
        shape.every((point, i) =>
          point
            .toArray()
            .every(
              (value, axis) => Math.abs(value - shapeBefore[s][i][axis]) < 1e-7,
            ),
        ),
      ),
    };
  }, mineImpact.shapeBefore);
  assert.ok(
    repair.components.every((value) => value === 0),
    "repair clears mine component damage",
  );
  assert.equal(
    repair.shapeRestored,
    true,
    "repair restores original car geometry",
  );
  delete mineImpact.shapeBefore;

  const snowRecovery = await page.evaluate(async () => {
    const c = window.carma;
    document.querySelector("#track-select").value = c.assets.resolve(
      "data/RACES/skitrack3/skitrack3.txt",
    );
    document.querySelector("#car-select").value = c.assets.resolve(
      "data/CARS/monsterbug/monsterbug.txt",
    );
    await c.loadRace();
    c.paused = true;
    document.querySelector("#panel").hidden = true;
    const p = c.player,
      start = p.state.position.clone();
    for (let i = 0; i < 50; i++) c.simulation.step();
    p.input.throttle = 1;
    for (let i = 0; i < 90; i++) c.simulation.step();
    p.input.throttle = 0;
    const poses = p.recoveryHistory.snapshots;
    const allWheels = p.state.wheelLengths.every(
      (length, i) => length < p.motion.suspensionLength[i >> 1],
    );
    const expected =
      poses[
        allWheels &&
        p.state.position.distanceToSquared(poses[0].position) <=
          Math.fround(8.3015966)
          ? 1
          : 0
      ];
    return {
      start: start.toArray(),
      beached: p.state.position.toArray(),
      distance: start.distanceTo(p.state.position),
      expected: expected.position.toArray(),
      expectedUp: expected.position
        .clone()
        .set(0, 1, 0)
        .applyQuaternion(expected.orientation)
        .toArray(),
      credits: c.race.credits,
    };
  });
  assert.ok(
    snowRecovery.distance > 1,
    "original Monsterbug drove into the Snow Way Out embankment",
  );
  await page.locator("#view").focus();
  await page.evaluate(() => {
    window.carma.paused = false;
    // Exercise the real keyboard command, then freeze its restored pose before
    // the next RAF; the subsequent fixed ticks verify settling and driving.
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.code === "KeyR") window.carma.paused = true;
      },
      { once: true },
    );
  });
  await page.keyboard.press("r");
  const recoveredSnow = await page.evaluate(() => {
    const c = window.carma,
      p = c.player;
    const recovered = {
      position: p.state.position.toArray(),
      up: p.state.position
        .clone()
        .set(0, 1, 0)
        .applyQuaternion(p.state.orientation)
        .toArray(),
      credits: c.race.credits,
    };
    for (let i = 0; i < 70; i++) c.simulation.step();
    const before = p.state.position.clone();
    p.input.throttle = -1;
    for (let i = 0; i < 80; i++) c.simulation.step();
    p.input.throttle = 0;
    return {
      ...recovered,
      driveDistance: before.distanceTo(p.state.position),
      wheelCount: p.state.groundedWheelCount,
      positionAfterDriving: p.state.position.toArray(),
    };
  });
  assert.equal(recoveredSnow.credits, snowRecovery.credits - 250);
  assert.ok(
    recoveredSnow.position.every(
      (v, i) => Math.abs(v - snowRecovery.expected[i]) < (i === 1 ? 0.3 : 0.01),
    ),
    "R restores source-safe history instead of the adjacent snowbank path projection",
  );
  assert.ok(
    recoveredSnow.up.every(
      (v, i) => Math.abs(v - snowRecovery.expectedUp[i]) < 1e-7,
    ),
    "R restores full original safe rotation",
  );
  assert.ok(
    recoveredSnow.driveDistance > 1,
    "recovered Monsterbug can leave the contour again",
  );

  await page.evaluate(async () => {
    const c = window.carma;
    document.querySelector("#track-select").value = c.assets.resolve(
      "data/RACES/newcity1/newcity1.txt",
    );
    document.querySelector("#car-select").value = c.assets.resolve(
      "data/CARS/EAGLE3/EAGLE3.TXT",
    );
    await c.loadRace();
    c.paused = true;
    document.querySelector("#panel").hidden = true;
  });
  await page.waitForFunction(
    () => window.carma.stats.ready && window.carma.paused,
    { timeout: 90000 },
  );

  const oil = await page.evaluate(() => {
    const c = window.carma;
    const p = c.player;
    const d = c.powerups.definitions[53];
    if (!d || d.action !== 35)
      throw new Error("Original oil ability action 35 missing");
    const [sx, sy, sz] = c.track.start;
    let placement = null;
    for (let radius = 0; radius <= 8 && !placement; radius += 1) {
      for (let x = -radius; x <= radius && !placement; x += 1) {
        for (let z = -radius; z <= radius && !placement; z += 1) {
          if (Math.max(Math.abs(x), Math.abs(z)) !== radius) continue;
          const ground = c.collision.height(sx + x, sz + z, sy + 4);
          if (ground === null) continue;
          const candidate = p.state.position
            .clone()
            .set(sx + x, ground, sz + z);
          const surface = c.simulation.projectOil(candidate, 0.4, null);
          if (!surface || surface.normal.y < 0.97) continue;
          if (
            surface.nearbyFaceNormals.some((normal, i) => {
              const dot = normal.clone().normalize().dot(surface.normal);
              return (
                dot < 0.98 &&
                (dot > 0.8 || surface.sameSideOfNearbyPlanes[i] === false)
              );
            })
          )
            continue;
          placement = candidate;
        }
      }
    }
    if (!placement)
      throw new Error(
        "No source-valid oil placement found near New City start",
      );
    p.state.position.copy(placement);
    c.simulation.reset(p);
    c.powerups.resetPath(p.state.position);
    c.powerups.apply(53, p.state, c.race);
    return {
      charges: c.powerups.abilities.get(53)?.charges ?? 0,
      selected: c.powerups.selectedAbility,
      action: c.powerups.abilities.get(53)?.definition.action ?? null,
      knackered: p.knackered,
      raceStatus: c.race.status,
      position: p.state.position.toArray(),
    };
  });
  assert.equal(
    oil.charges,
    5,
    "original stock oil definition supplies five uses",
  );
  await page.evaluate(() => (window.carma.paused = false));
  await page.keyboard.press("f");
  await page.evaluate(() => (window.carma.paused = true));
  const oilPatch = await page.evaluate(() => {
    const c = window.carma;
    c.simulation.step();
    const spill = c.simulation.oil.spills.find(Boolean);
    if (!spill)
      return {
        charges: c.powerups.abilities.get(53)?.charges ?? 0,
        selected: c.powerups.selectedAbility,
        raceStatus: c.race.status,
        knackered: c.player.knackered,
        spillCount: c.simulation.oil.spills.filter(Boolean).length,
      };
    const center = spill.position.clone().multiplyScalar(6.9);
    const factors = c.simulation.oil.wheelFactors(c.player, [
      center,
      center,
      center,
      center,
    ]);
    return {
      charges: c.powerups.abilities.get(53)?.charges ?? 0,
      visible: spill.mesh.visible,
      pending: spill.pending,
      fullSize: spill.fullSize,
      factors,
      position: spill.position.toArray(),
    };
  });
  assert.equal(oilPatch.charges, 4, "F consumes one oil charge");
  assert.equal(
    oilPatch.visible,
    true,
    `oil projector places a visible patch on the stock track: ${JSON.stringify(oilPatch)}`,
  );
  assert.ok(
    oilPatch.factors.every((factor) => factor >= 0.01 && factor <= 0.15),
    "stock wheel samples receive source oil grip",
  );
  await settleView(page);
  await page.screenshot({ path: "artifacts/browser-priority-oil.png" });

  const water = await page.evaluate(() => {
    const c = window.carma,
      p = c.player,
      sim = c.simulation;
    const surfaces = c.collision.querySurfaces(
      p.state.position.clone().set(-300, -100, -300),
      p.state.position.clone().set(300, 100, 300),
      true,
    );
    const surface = surfaces.find(
      (s) =>
        s.material.startsWith("!") &&
        /water/i.test(s.material) &&
        s.normal.y > 0.8,
    );
    if (!surface) throw new Error("Stock New City finite water surface absent");
    p.state.position
      .copy(surface.a)
      .add(surface.b)
      .add(surface.c)
      .multiplyScalar(1 / 3);
    p.state.position.y -= 0.5;
    p.state.velocity.set(0, 0, 0);
    p.state.underwaterAbility = false;
    sim.reset(p);
    sim.step();
    const submerged = {
      depth: p.specialVolume.depth,
      gravity: p.state.volumeGravityFactor,
      drag: p.state.volumeDragFactor,
      grounded: p.state.groundedWheelCount,
    };
    p.state.underwaterAbility = true;
    sim.step();
    const ability = {
      gravity: p.state.volumeGravityFactor,
      drag: p.state.volumeDragFactor,
    };
    p.state.position.fromArray(c.track.start);
    p.state.velocity.set(0, 0, 0);
    p.state.underwaterAbility = false;
    sim.reset(p);
    sim.step();
    return {
      material: surface.material,
      submerged,
      ability,
      exit: {
        active: p.specialVolume.volume !== null,
        gravity: p.state.volumeGravityFactor,
        drag: p.state.volumeDragFactor,
      },
    };
  });
  assert.equal(water.submerged.depth, 1);
  assert.ok(
    Math.abs(water.submerged.gravity - 0.2) < 1e-6,
    "source submerged gravity",
  );
  assert.equal(water.submerged.drag, 50);
  assert.equal(
    water.submerged.grounded,
    0,
    "finite water is not a solid floor",
  );
  assert.ok(
    Math.abs(water.ability.gravity - 0.52) < 1e-6,
    "underwater ability interpolates source gravity",
  );
  assert.equal(water.ability.drag, 30);
  assert.deepEqual(water.exit, { active: false, gravity: 1, drag: 1 });

  await page.evaluate(async () => {
    const c = window.carma;
    const track = c.assets.resolve("data/RACES/Carrier1/CARRIER1.txt");
    const car = c.assets.resolve("data/CARS/EAGLE3/EAGLE3.TXT");
    if (!track || !car)
      throw new Error("Carrier1/EAGLE3 missing from manifest");
    document.querySelector("#track-select").value = track;
    document.querySelector("#car-select").value = car;
    await c.loadRace();
    c.paused = true;
    document.querySelector("#panel").hidden = true;
  });
  await page.waitForFunction(
    () => window.carma.stats.ready && window.carma.paused,
    { timeout: 90000 },
  );
  const liftImpact = await page.evaluate(() => {
    const c = window.carma;
    const sim = c.simulation;
    const p = c.player;
    const lift = sim.noncars.find((body) =>
      /&98l0341\.act/i.test(body.actor.name),
    );
    if (!lift)
      throw new Error("Carrier1 original &98l0341.ACT lift was not loaded");
    const bounds = (vertices) => {
      const points = vertices.flatMap((shape) => shape.vertices);
      return {
        min: [0, 1, 2].map((axis) =>
          Math.min(...points.map((point) => point.getComponent(axis))),
        ),
        max: [0, 1, 2].map((axis) =>
          Math.max(...points.map((point) => point.getComponent(axis))),
        ),
      };
    };
    const carBounds = bounds(p.hulls);
    const liftBounds = bounds(lift.hulls);
    sim.reset(p);
    p.state.position.set(
      lift.state.position.x + liftBounds.max[0] - carBounds.min[0] + 0.3,
      lift.state.position.y +
        (liftBounds.min[1] + liftBounds.max[1]) / 2 -
        (carBounds.min[1] + carBounds.max[1]) / 2,
      lift.state.position.z,
    );
    p.state.velocity.set(-16, 0, 0);
    p.state.predictedPosition = undefined;
    p.state.predictedOrientation = undefined;
    let impact = false;
    for (let i = 0; i < 60 && lift.motor.sleeping; i++) {
      sim.step();
      impact ||= sim.lastImpacts.some(
        (row) => row.a === lift || row.b === lift,
      );
    }
    if (lift.motor.sleeping)
      throw new Error("Controlled car impact did not wake Carrier1 lift");
    sim.repair(p);
    const beforeDamage = Array.from(p.damage.componentLevels);
    sim.reset(p);
    p.state.position.set(
      lift.state.position.x,
      lift.state.position.y + liftBounds.max[1] - carBounds.min[1] + 0.015,
      lift.state.position.z,
    );
    p.state.velocity.set(0, 0, 0);
    p.state.predictedPosition = undefined;
    p.state.predictedOrientation = undefined;
    const liftStart = lift.state.position.y;
    const carStart = p.state.position.y;
    let maxGrounded = 0;
    for (let i = 0; i < 60; i++) {
      sim.step();
      maxGrounded = Math.max(maxGrounded, p.state.groundedWheelCount ?? 0);
    }
    return {
      impact,
      sleeping: lift.motor.sleeping,
      liftRise: lift.state.position.y - liftStart,
      carRise: p.state.position.y - carStart,
      grounded: p.state.groundedWheelCount ?? 0,
      maxGrounded,
      beforeDamage,
      afterDamage: Array.from(p.damage.componentLevels),
      lift: lift.actor.name,
      noncarCount: sim.noncars.length,
    };
  });
  assert.ok(
    liftImpact.impact,
    "player produced a physical Carrier1 noncar impact",
  );
  assert.ok(
    liftImpact.liftRise > 0.1,
    `lift rises: ${JSON.stringify(liftImpact)}`,
  );
  assert.ok(
    liftImpact.carRise > 0.1,
    `supported Eagle rises: ${JSON.stringify(liftImpact)}`,
  );
  assert.ok(
    liftImpact.maxGrounded > 0,
    "Eagle remains grounded on the lift during motion",
  );
  assert.deepEqual(
    liftImpact.afterDamage,
    liftImpact.beforeDamage,
    "lift motion does not damage the car",
  );
  await settleView(page);
  await page.screenshot({
    path: "artifacts/browser-priority-carrier-lift.png",
  });

  let airportSmash = null;
  const airportAvailable = await page.evaluate(
    () =>
      window.carma.assets.resolve("data/RACES/Airport1/airport1.txt") &&
      window.carma.assets.resolve("data/CARS/EAGLE3/EAGLE3.TXT"),
  );
  if (airportAvailable) {
    await page.evaluate(async () => {
      const c = window.carma;
      document.querySelector("#track-select").value = c.assets.resolve(
        "data/RACES/Airport1/airport1.txt",
      );
      document.querySelector("#car-select").value = c.assets.resolve(
        "data/CARS/EAGLE3/EAGLE3.TXT",
      );
      await c.loadRace();
      c.paused = true;
      document.querySelector("#panel").hidden = true;
    });
    await page.waitForFunction(
      () => window.carma.stats.ready && window.carma.paused,
      { timeout: 90000 },
    );
    airportSmash = await page.evaluate(() => {
      const c = window.carma;
      const p = c.player;
      const sim = c.simulation;
      let door;
      let doorDistance = Infinity;
      const doorHitPoint = p.state.position
        .clone()
        .set(4.358955, 0.06, 123.451445);
      c.scene.traverse((object) => {
        if (
          object.isMesh &&
          !object.userData.worldRenderBatch &&
          (Array.isArray(object.material)
            ? object.material
            : [object.material]
          ).some((material) => /^hangerdoor(?:\.mat)?$/i.test(material.name))
        ) {
          object.geometry.computeBoundingBox();
          const distance = object.geometry.boundingBox
            .clone()
            .applyMatrix4(object.matrixWorld)
            .distanceToPoint(doorHitPoint);
          if (distance < doorDistance) {
            doorDistance = distance;
            door = object;
          }
        }
      });
      if (!door)
        throw new Error("Airport1 hangerdoor smash mesh was not retained");
      if (doorDistance > 0.05)
        throw new Error(
          "Airport1 hangerdoor source actor is absent at the prescribed impact point",
        );
      const beforeModes = door.geometry.userData.worldSmashFaceModes ?? [];
      const beforeMaterial = door.material;
      const beforeMap = Array.isArray(beforeMaterial)
        ? beforeMaterial.map((material) => material.map?.name ?? null)
        : [beforeMaterial.map?.name ?? null];
      const nx = 0.9848076;
      const nz = 0.17364896;
      p.state.position.set(4.358955 + nx, 0.06, 123.451445 + nz);
      p.state.heading = Math.atan2(nx, nz);
      p.state.orientation.setFromAxisAngle(
        p.state.position.clone().set(0, 1, 0),
        p.state.heading,
      );
      p.state.velocity.set(-nx * 12, 0, -nz * 12);
      p.state.angularVelocity.set(0, 0, 0);
      p.input.throttle = 1;
      sim.reset(p);
      const impacts = [];
      for (let i = 0; i < 2; i++) {
        sim.step();
        impacts.push(...sim.lastImpacts.filter((row) => row.a === p));
      }
      const modes = door.geometry.userData.worldSmashFaceModes ?? [];
      const materials = Array.isArray(door.material)
        ? door.material
        : [door.material];
      const patched = materials.find(
        (material) => material.userData.worldSmashLevel === 1,
      );
      return {
        beforeModes: {
          passthrough: beforeModes.filter((mode) => mode === "passthrough")
            .length,
          solid: beforeModes.filter((mode) => mode === "solid").length,
        },
        modes: {
          passthrough: modes.filter((mode) => mode === "passthrough").length,
          solid: modes.filter((mode) => mode === "solid").length,
        },
        beforeMap,
        patchedMap: patched?.map?.name ?? null,
        smashLevel: patched?.userData.worldSmashLevel ?? null,
        finite: p.state.position.toArray().every(Number.isFinite),
        aboveFloor: p.state.position.y > -1,
        position: p.state.position.toArray(),
        impactTypes: [...new Set(impacts.map((row) => row.sourceType))],
        type9Rows: impacts.filter((row) => row.sourceType === 9).length,
        maximumImpulse: Math.max(0, ...impacts.map((row) => row.normalImpulse)),
        cappedImpulse: impacts
          .filter((row) => row.sourceType === 9)
          .reduce((sum, row) => sum + row.normalImpulse, 0),
      };
    });
    assert.ok(
      airportSmash.modes.passthrough > 0,
      "hangerdoor exposes removed/pass-through faces",
    );
    assert.ok(
      airportSmash.modes.solid > 0,
      "hangerdoor retains solid UV-tile faces",
    );
    assert.notEqual(
      airportSmash.patchedMap,
      airportSmash.beforeMap[0],
      "smash replaces the original door material map",
    );
    assert.equal(
      airportSmash.patchedMap,
      "airhut_smash",
      "smash applies the original tile texture",
    );
    assert.equal(airportSmash.smashLevel, 1);
    assert.ok(
      airportSmash.type9Rows > 0,
      "smash invalidates the pre-topology contact solve",
    );
    assert.ok(
      Math.abs(airportSmash.cappedImpulse - 1) < 1e-6,
      "native door threshold caps the invalidated impulse rows",
    );
    assert.ok(
      airportSmash.finite && airportSmash.aboveFloor,
      "car remains finite and above the airport floor",
    );
    await settleView(page);
    await page.screenshot({
      path: "artifacts/browser-priority-airport-smash.png",
    });
  }

  await page.evaluate(async () => {
    const c = window.carma;
    document.querySelector("#track-select").value = c.assets.resolve(
      "data/RACES/newcity1/newcity1.txt",
    );
    document.querySelector("#car-select").value = c.assets.resolve(
      "data/CARS/EAGLE3/EAGLE3.TXT",
    );
    await c.loadRace();
    c.paused = true;
  });
  await page.waitForFunction(() => !!window.carma.pedestrians, {
    timeout: 90000,
  });
  const pedestrians = await page.evaluate(() => {
    const c = window.carma,
      peds = c.pedestrians;
    const target = peds.states[0].position.clone();
    const position = target.clone();
    position.z -= 0.1;
    const car = { position, yaw: 0, speed: 0 };
    peds.resetCar(position); // Recovery/teleport resets native popup hysteresis.
    peds.update(0.1, car, { cameraPosition: target, threats: [] });
    const before = peds.states[0];
    const rival = {
      position: target.clone(),
      yaw: 0,
      speed: 3,
      velocity: target.clone().set(0, 0, -3),
      radiusSquared: 0.2,
    };
    rival.position.z += 2;
    peds.update(0.1, car, { cameraPosition: target, threats: [rival] });
    const scared = peds.states[0];
    peds.reset();
    peds.resetCar(target.clone().add(target.clone().set(0, 0, 0.8)));
    peds.update(
      0.01,
      { position: target, yaw: 0, speed: 3 },
      { cameraPosition: target, threats: [] },
    );
    const impact = peds.bloodStats;
    for (let i = 0; i < 25; i++)
      peds.update(0.1, car, { cameraPosition: target, threats: [] });
    const settled = peds.bloodStats;
    return {
      count: peds.count,
      before: before.action,
      scared: scared.action,
      impact,
      settled,
      hits: peds.hits,
      warnings: peds.warnings,
    };
  });
  assert.equal(pedestrians.count, 791, "native complete stock race population");
  assert.equal(pedestrians.before, 0);
  assert.equal(
    pedestrians.scared,
    2,
    "a moving rival triggers native panic prediction",
  );
  assert.ok(pedestrians.impact.clouds > 0 && pedestrians.impact.giblets > 0);
  assert.ok(
    pedestrians.settled.smears > 0,
    "sliding corpse leaves original blood texture",
  );
  assert.deepEqual(pedestrians.warnings, []);

  await page.evaluate(() => window.carma.audio.unlock());
  const wasted = await page.evaluate(() => {
    const c = window.carma,
      p = c.player,
      sounds = [];
    const originalSound = c.audio.playSound.bind(c.audio);
    c.audio.playSound = async (id, ...args) => {
      sounds.push(id);
      return originalSound(id, ...args);
    };
    try {
      p.damage.componentLevels[0] = 99;
      for (let i = 0; i < 40; i++) c.simulation.step();
      const canvas = document.querySelector("#feedback"),
        ctx = canvas.getContext("2d");
      c.wastedFeedback.draw(ctx, c.simulation.elapsed * 1000);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let visiblePixels = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) visiblePixels++;
      return {
        sounds,
        knackered: p.knackered,
        visiblePixels,
        lettering: c.wastedFeedback.playerTextVisible,
        raceStatus: c.race.status,
      };
    } finally {
      c.audio.playSound = originalSound;
    }
  });
  assert.deepEqual(
    wasted.sounds,
    [5400],
    "configured native wasted sound occurs once",
  );
  assert.ok(wasted.knackered && wasted.lettering && wasted.visiblePixels > 100);
  assert.equal(
    wasted.raceStatus,
    "racing",
    "original ten-second wreck countdown continues",
  );
  await page.screenshot({ path: "artifacts/browser-priority-wasted.png" });

  const glErrors = await page.evaluate(() => {
    const gl = document.querySelector("#view").getContext("webgl2");
    const errors = [];
    for (let i = 0; i < 16; i++) {
      const error = gl.getError();
      if (error === gl.NO_ERROR) break;
      errors.push(error);
    }
    return errors;
  });
  assert.deepEqual(glErrors, [], "WebGL reports no errors");
  assert.deepEqual(errors, [], "browser reports no page or console errors");
  assert.deepEqual(failedRequests, [], "browser has no failed asset requests");
  const report = {
    minePickup,
    mineLaunched,
    mineImpact,
    repair,
    oil,
    oilPatch,
    water,
    liftImpact,
    airportSmash,
    snowRecovery: { ...snowRecovery, after: recoveredSnow },
    pedestrians,
    wasted,
    glErrors,
    errors,
    failedRequests,
  };
  await writeFile(
    "artifacts/browser-priority-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error);
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
