import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const assetRoot = process.env.CARMA2_ROOT || "carma2_orig";
try {
  await access(executable);
  await access(assetRoot);
} catch {
  console.log(
    "SKIP motion powerup browser regression: Chromium or C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5203;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));
let browser;
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
  const selectRace = async (carPath) => {
    const selected = await page.evaluate(async (selectedCar) => {
      const c = window.carma;
      const track = c.assets.resolve("data/RACES/newcity1/newcity1.txt");
      const car = c.assets.resolve(selectedCar);
      if (!track || !car)
        throw new Error(`Missing stock race/car: ${selectedCar}`);
      document.querySelector("#track-select").value = track;
      document.querySelector("#car-select").value = car;
      await c.loadRace();
      c.paused = true;
      return { track, car };
    }, carPath);
    await page.waitForFunction(
      () => window.carma.stats.ready && window.carma.paused,
      null,
      { timeout: 90000 },
    );
    return selected;
  };

  const selectedCars = [
    "data/CARS/EAGLE3/EAGLE3.TXT",
    "data/CARS/buggy/buggy.txt",
  ];
  await selectRace(selectedCars[0]);
  const diagnostics = await page.evaluate(() => {
    const c = window.carma;
    const events = [];
    const grant = c.powerups.grant.bind(c.powerups);
    c.powerups.grant = (index, vehicle, race, onEvent) =>
      grant(index, vehicle, race, (event) => {
        events.push({
          kind: event.kind,
          action: event.definition.action,
          index: event.definition.index,
        });
        onEvent?.(event);
      });
    window.__motionPowerupEvents = events;
    return { ready: c.stats.ready };
  });
  assert.equal(diagnostics.ready, true);
  await page.click("#debug-button");
  await page.waitForFunction(
    () =>
      document.querySelector("#debug-enabled").checked &&
      !document.querySelector("#debug-panel").hidden,
  );

  const ensureDebugGrantObserver = async () => {
    await page.evaluate(() => {
      const c = window.carma;
      if (c.powerups.__motionGrantWrapped) return;
      const events = window.__motionPowerupEvents;
      const grant = c.powerups.grant.bind(c.powerups);
      c.powerups.grant = (index, vehicle, race, onEvent) =>
        grant(index, vehicle, race, (event) => {
          events.push({
            kind: event.kind,
            action: event.definition.action,
            index: event.definition.index,
          });
          onEvent?.(event);
        });
      c.powerups.__motionGrantWrapped = true;
    });
  };
  const grant = async (index) => {
    await ensureDebugGrantObserver();
    await page.selectOption("#debug-powerup", String(index));
    await page.click("#debug-grant");
  };
  const sampleSuspension = async () =>
    page.evaluate(() => {
      const p = window.carma.player;
      return {
        spring: [...p.motion.spring],
        damper: [...p.motion.damper],
        length: [...p.motion.suspensionLength],
        base: {
          give: [...p.motion.suspensionBase.give],
          damping: p.motion.suspensionBase.damping,
          rideHeight: p.motion.suspensionBase.rideHeight,
        },
        mass: p.motion.mass,
        comZ: p.motion.centerOfMass.z,
        rearWheelZ: p.motion.wheelPositions[0].z,
        frontWheelZ: p.motion.wheelPositions[2].z,
      };
    });
  const applyMainLoopSuspension = async (expected) => {
    await page.evaluate(() => (window.carma.paused = false));
    await page.waitForFunction(
      (target) => {
        const p = window.carma.player.motion;
        return ["spring", "damper", "suspensionLength"].every((key, k) => {
          const values = [target.spring, target.damper, target.length][k];
          return p[key].every((value, i) => Math.abs(value - values[i]) < 1e-7);
        });
      },
      expected,
      { timeout: 5000 },
    );
    await page.evaluate(() => (window.carma.paused = true));
  };
  const expireAndReset = async (baseline) => {
    await page.evaluate(() => {
      const c = window.carma;
      c.powerups.update(31, c.vehicle, c.race);
      c.paused = false;
    });
    await page.waitForFunction(
      (base) => {
        const p = window.carma.player.motion;
        return (
          p.spring.every(
            (value, i) => Math.abs(value - base.spring[i]) < 1e-7,
          ) &&
          p.damper.every(
            (value, i) => Math.abs(value - base.damper[i]) < 1e-7,
          ) &&
          p.suspensionLength.every(
            (value, i) => Math.abs(value - base.length[i]) < 1e-7,
          )
        );
      },
      baseline,
      { timeout: 5000 },
    );
    await page.evaluate(() => (window.carma.paused = true));
  };
  const expectedSuspension = (base, params) => {
    const ratio = Math.abs(
      (base.rearWheelZ - base.comZ) / (base.frontWheelZ - base.comZ),
    );
    const axleMass = [base.mass / (ratio + 1), base.mass / (1 / ratio + 1)];
    const mult = [params[1], params[0]];
    const extra = [params[3], params[2]];
    return {
      spring: axleMass.map(
        (mass, axle) => (mass * 5) / (base.base.give[axle] * mult[axle]),
      ),
      damper: axleMass.map(
        (mass, axle) =>
          mass *
          Math.sqrt(5 / (base.base.give[axle] * mult[axle])) *
          base.base.damping *
          params[4],
      ),
      length: base.base.give.map(
        (give, axle) => base.base.rideHeight + give * mult[axle] + extra[axle],
      ),
    };
  };

  const action20 = [
    { index: 23, params: [2, 2, 0.25, 0.25, 0.1], label: "soft" },
    { index: 40, params: [0.5, 0.5, -0.01, -0.01, 1], label: "hard" },
  ];
  const suspensionResults = [];
  for (const carPath of selectedCars) {
    const selected = await selectRace(carPath);
    assert.ok(selected.car);
    for (const effect of action20) {
      const definition = await page.evaluate((index) => {
        const d = window.carma.powerups.definitions[index];
        if (!d) throw new Error(`Original suspension powerup ${index} missing`);
        return {
          action: d.action,
          duration: d.duration,
          params: d.floatParams,
        };
      }, effect.index);
      assert.equal(definition.action, 20);
      assert.equal(definition.duration, 30);
      assert.deepEqual(definition.params, effect.params);

      const baseline = await sampleSuspension();
      const expected = expectedSuspension(baseline, definition.params);
      await grant(effect.index);
      await applyMainLoopSuspension(expected);
      const actual = await sampleSuspension();
      for (const key of ["spring", "damper", "length"])
        for (let i = 0; i < 2; i++)
          assert.ok(
            Math.abs(actual[key][i] - expected[key][i]) < 1e-7,
            `${effect.label} ${key}[${i}] for ${carPath}: ${actual[key][i]} vs ${expected[key][i]}`,
          );
      const event = await page.evaluate(
        (index) =>
          window.__motionPowerupEvents.findLast((e) => e.index === index),
        effect.index,
      );
      assert.deepEqual(event, {
        kind: "engine",
        action: 20,
        index: effect.index,
      });
      await expireAndReset(baseline);
      suspensionResults.push({ car: carPath, effect: effect.label, expected });
    }
  }

  // Use the current Buggy race for a real post-physics bounce and keyboard drive.
  await grant(22);
  const bounceDefinition = await page.evaluate(() => {
    const d = window.carma.powerups.definitions[22];
    const events = window.__motionPowerupEvents;
    const original = window.carma.powerups.periodicBounce.bind(
      window.carma.powerups,
    );
    const hits = [];
    window.carma.powerups.periodicBounce = (state) => {
      const beforeY = state.velocity.y;
      const result = original(state);
      if (result)
        hits.push({
          beforeY,
          afterY: state.velocity.y,
          grounded: state.groundedWheelCount ?? 0,
        });
      return result;
    };
    const audioHits = [];
    const playSound = window.carma.audio.playSound.bind(window.carma.audio);
    window.carma.audio.playSound = (id, ...args) => {
      if (id === 9010) audioHits.push(id);
      return playSound(id, ...args);
    };
    window.__bounceHits = hits;
    window.__bounceSounds = audioHits;
    return {
      action: d.action,
      duration: d.duration,
      params: d.floatParams,
      period: 1000 / d.floatParams[0],
      amount: d.floatParams[1],
      event: events.findLast((e) => e.index === 22),
    };
  });
  assert.deepEqual(bounceDefinition, {
    action: 19,
    duration: 30,
    params: [0.5, 6],
    period: 2000,
    amount: 6,
    event: { kind: "engine", action: 19, index: 22 },
  });

  const initialPosition = await page.evaluate(() => {
    const c = window.carma;
    c.paused = false;
    return c.vehicle.position.toArray();
  });
  await page.keyboard.down("ArrowUp");
  await page.waitForFunction(
    (before) => {
      const p = window.carma.vehicle.position;
      return Math.hypot(p.x - before[0], p.z - before[2]) > 0.5;
    },
    initialPosition,
    { timeout: 20000 },
  );
  await page.keyboard.up("ArrowUp");
  await page.waitForFunction(() => window.__bounceHits.length > 0, null, {
    timeout: 15000,
  });
  await page.evaluate(() => (window.carma.paused = true));
  const bounceHits = await page.evaluate(() => window.__bounceHits);
  assert.ok(bounceHits[0].grounded > 2, JSON.stringify(bounceHits[0]));
  assert.ok(
    Math.abs(bounceHits[0].afterY - bounceHits[0].beforeY - 6 / 6.9) < 1e-6,
    JSON.stringify(bounceHits[0]),
  );
  const bounceSounds = await page.evaluate(() => window.__bounceSounds.length);
  assert.equal(
    bounceSounds,
    bounceHits.length,
    "each grounded bounce plays native sound 9010",
  );

  const afterExpiry = await page.evaluate(() => {
    const c = window.carma;
    const modifiers = c.powerups.update(31, c.vehicle, c.race);
    return {
      period: modifiers.bouncePeriodMs,
      bounce: c.powerups.periodicBounce(c.player.state),
    };
  });
  assert.deepEqual(afterExpiry, { period: 0, bounce: false });

  // Verify the original action 18 grant/reset and place the car against a
  // near-vertical solid face from the loaded Newcity collision mesh. The
  // deterministic pose tests supported forces; it does not claim arbitrary
  // authored walls are traversable.
  await selectRace(selectedCars[0]);
  const wallClimbDefinition = await page.evaluate(() => {
    const d = window.carma.powerups.definitions[21];
    if (!d) throw new Error("Original wall-climb powerup 21 is absent");
    return {
      action: d.action,
      duration: d.duration,
      params: d.floatParams,
      integerParams: d.integerParams,
    };
  });
  assert.deepEqual(wallClimbDefinition, {
    action: 18,
    duration: 30,
    params: [],
    integerParams: [],
  });
  await grant(21);
  await page.evaluate(() => (window.carma.paused = false));
  await page.waitForFunction(
    () => window.carma.player.state.wallClimb === true,
    null,
    { timeout: 5000 },
  );
  await page.evaluate(() => (window.carma.paused = true));
  const wallEvent = await page.evaluate(() =>
    window.__motionPowerupEvents.findLast((e) => e.index === 21),
  );
  assert.deepEqual(wallEvent, { kind: "effect", action: 18, index: 21 });

  const originalGeometryWall = await page.evaluate(() => {
    const c = window.carma;
    const sim = c.simulation;
    const state = c.player.state;
    const motion = c.player.motion;
    const world = sim.world;
    const originalCars = sim.cars;
    const savedElapsed = sim.elapsed;
    const savedAccumulator = sim.accumulator;
    const vec = state.position.clone();
    const up = vec.clone().set(0, 1, 0);
    const down = vec.clone().set(0, -1, 0);
    const scale = 6.9;
    const wheelPositions = motion.wheelPositions;
    const rayLength = Math.max(...motion.suspensionLength) + 0.5;
    const surfaces = [...new Set([...world.cells.values()].flat())].filter(
      (surface) =>
        surface.enabled !== false &&
        surface.collisionMode !== "edges" &&
        !/^[!>?]/.test(surface.material) &&
        Math.abs(surface.normal.y) < 0.12 &&
        surface.normal.lengthSq() > 0.9 &&
        (surface.a.y + surface.b.y + surface.c.y) / 3 >= 0,
    );
    const areaOf = (surface) =>
      surface.b
        .clone()
        .sub(surface.a)
        .cross(surface.c.clone().sub(surface.a))
        .length() * 0.5;
    surfaces.sort((a, b) => areaOf(b) - areaOf(a));
    const candidates = surfaces.slice(0, 1200);
    let best = null;
    let probes = 0;
    for (const surface of candidates) {
      const center = surface.a
        .clone()
        .add(surface.b)
        .add(surface.c)
        .multiplyScalar(1 / 3);
      for (const side of [1, -1]) {
        probes++;
        const normal = surface.normal.clone().normalize().multiplyScalar(side);
        const orientation = state.orientation
          .clone()
          .setFromUnitVectors(up, normal);
        const avgAnchor = vec.set(0, 0, 0);
        for (const wheel of wheelPositions)
          avgAnchor.add(wheel.clone().applyQuaternion(orientation));
        avgAnchor.multiplyScalar(1 / (wheelPositions.length * scale));
        const minSuspension = Math.min(...motion.suspensionLength);
        // Use most of the authored travel so the vehicle body clears the
        // collision face while each original wheel ray remains supported.
        const gap = (minSuspension * 0.92) / scale;
        const position = center
          .clone()
          .addScaledVector(normal, gap)
          .sub(avgAnchor);
        const direction = down.clone().applyQuaternion(orientation).normalize();
        const contacts = [];
        for (let i = 0; i < wheelPositions.length; i++) {
          const axle = i >> 1;
          const origin = wheelPositions[i]
            .clone()
            .multiplyScalar(1 / scale)
            .applyQuaternion(orientation)
            .add(position);
          const hit = world.wheelRaycast(origin, direction, rayLength / scale);
          if (
            hit &&
            hit.distance * scale <= motion.suspensionLength[axle] + 1e-6
          )
            contacts.push({
              wheel: i,
              distance: hit.distance,
              normal: hit.normal.toArray(),
              material: hit.surface.material,
            });
        }
        if (contacts.length > (best?.contacts.length ?? 0))
          best = { surface, center, normal, orientation, position, contacts };
        if (contacts.length >= 3) break;
      }
      if (best?.contacts.length >= 3) break;
    }
    if (!best)
      throw new Error(
        `Original Newcity collision mesh has no searchable surfaces; cells=${world.cells.size}`,
      );
    if (best.contacts.length < 3)
      throw new Error(
        `Could not place original wheel rays on a near-vertical Newcity face: surfaces=${surfaces.length}, candidates=${candidates.length}, bestAccepted=${best.contacts.length}, probes=${probes}, sample=${JSON.stringify(best.contacts)}`,
      );

    // Keep a full pre-step snapshot so the on/off runs use identical poses,
    // wheel state and velocities. The only changed input is wallClimb.
    const saved = new Map();
    for (const [key, value] of Object.entries(state)) {
      if (value?.clone) saved.set(key, value.clone());
      else if (Array.isArray(value)) saved.set(key, [...value]);
      else saved.set(key, value);
    }
    const restoreState = () => {
      for (const [key, value] of saved) {
        const current = state[key];
        if (current?.copy && value?.clone) current.copy(value);
        else if (Array.isArray(current) && Array.isArray(value))
          current.splice(0, current.length, ...value);
        else state[key] = value;
      }
      sim.elapsed = savedElapsed;
      sim.accumulator = savedAccumulator;
    };
    const installFixture = () => {
      restoreState();
      state.position.copy(best.position);
      state.orientation.copy(best.orientation);
      state.velocity.set(0, 0, 0);
      state.angularVelocity.set(0, 0, 0);
      state.wheelLengths = [
        motion.suspensionLength[0],
        motion.suspensionLength[0],
        motion.suspensionLength[1],
        motion.suspensionLength[1],
      ];
      state.rpm = 0;
      state.tractionRpm = 0;
      state.gear = 0;
      sim.accumulator = 0;
    };
    const run = (wallClimb) => {
      installFixture();
      state.wallClimb = wallClimb;
      sim.update(0.04);
      return {
        grounded: c.player.debug?.grounded,
        force: c.player.debug?.force.toArray(),
      };
    };
    sim.cars = [c.player];
    try {
      const on = run(true);
      const off = run(false);
      installFixture();
      state.wallClimb = true;
      sim.sync?.(c.player);
      return {
        mass: motion.mass,
        on,
        off,
        contactCount: best.contacts.length,
        contacts: best.contacts,
        surface: {
          material: best.surface.material,
          normal: best.surface.normal.toArray(),
          vertices: [
            best.surface.a.toArray(),
            best.surface.b.toArray(),
            best.surface.c.toArray(),
          ],
        },
        position: best.position.toArray(),
        orientation: best.orientation.toArray(),
        probes,
      };
    } finally {
      restoreState();
      sim.cars = originalCars;
      sim.sync?.(c.player);
    }
  });
  assert.ok(
    originalGeometryWall.contactCount >= 3,
    JSON.stringify(originalGeometryWall),
  );
  assert.ok(
    originalGeometryWall.on.grounded >= 3,
    JSON.stringify(originalGeometryWall),
  );
  assert.ok(
    originalGeometryWall.off.grounded >= 3,
    JSON.stringify(originalGeometryWall),
  );
  const forceDelta = originalGeometryWall.on.force.map(
    (value, i) => value - originalGeometryWall.off.force[i],
  );
  assert.ok(
    forceDelta.some((value) => Math.abs(value) > 1e-3),
    JSON.stringify({ originalGeometryWall, forceDelta }),
  );

  // Render the deterministic pose against the same original Newcity face
  // while the real action is active; this screenshot is visual evidence of
  // the placement fixture, not a claim that arbitrary walls are traversable.
  await page.click("#debug-close");
  await page.evaluate(({ position, orientation, contacts }) => {
    const c = window.carma;
    c.player.state.position.fromArray(position);
    c.player.state.orientation.fromArray(orientation);
    c.player.state.wallClimb = true;
    c.simulation.sync(c.player);
    const up = c.player.state.position.clone().set(0, 1, 0);
    const normal = c.player.state.position
      .clone()
      .fromArray(contacts[0].normal)
      .normalize();
    const camera = c.camera;
    camera.position.copy(
      c.player.state.position
        .clone()
        .addScaledVector(normal, 4)
        .addScaledVector(up, 1),
    );
    camera.lookAt(c.player.state.position);
    window.__wallCameraRestore = [camera.position.lerp, camera.lookAt];
    camera.position.lerp = () => camera.position;
    camera.lookAt = () => {};
    c.paused = false;
  }, originalGeometryWall);
  await page.waitForTimeout(120);
  await page.screenshot({ path: "artifacts/browser-motion-wall-original.png" });
  await page.evaluate(() => {
    window.carma.paused = true;
    const [lerp, lookAt] = window.__wallCameraRestore;
    window.carma.camera.position.lerp = lerp;
    window.carma.camera.lookAt = lookAt;
    delete window.__wallCameraRestore;
  });

  await page.evaluate(() => {
    const c = window.carma;
    c.powerups.update(31, c.vehicle, c.race);
    c.paused = false;
  });
  await page.waitForFunction(
    () => window.carma.player.state.wallClimb === false,
    null,
    { timeout: 5000 },
  );
  await page.evaluate(() => (window.carma.paused = true));
  const wallClimbExpired = await page.evaluate(() => ({
    state: window.carma.player.state.wallClimb,
    event: window.__motionPowerupEvents.findLast((e) => e.index === 21),
  }));
  assert.equal(wallClimbExpired.state, false);
  assert.deepEqual(wallClimbExpired.event, {
    kind: "effect",
    action: 18,
    index: 21,
  });

  await page.evaluate(() => (window.carma.paused = false));
  await page.waitForTimeout(500);

  const gl = await page.evaluate(
    () =>
      document.querySelector("#view").getContext("webgl2")?.getError() ?? null,
  );
  assert.equal(gl, 0, "WebGL remains error-free");
  await page.screenshot({ path: "artifacts/browser-motion-powerups.png" });
  assert.deepEqual(
    errors,
    [],
    `browser runtime/console errors: ${errors.join("\n")}`,
  );
  assert.deepEqual(
    failedRequests,
    [],
    `failed requests: ${failedRequests.join("\n")}`,
  );
  console.log(
    JSON.stringify({
      suspensionResults,
      bounceDefinition,
      bounceHits,
      bounceSounds,
      wallClimbDefinition,
      originalGeometryWall,
      forceDelta,
      wallClimbExpired,
      webglError: gl,
    }),
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
