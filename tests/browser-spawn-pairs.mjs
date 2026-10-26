import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
try {
  await access(executable);
  await access(process.env.CARMA2_ROOT || "carma2_orig");
} catch {
  console.log(
    "SKIP spawn/pair browser regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}
await mkdir("artifacts", { recursive: true });
const port = Number(process.env.PORT ?? 5194);
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "",
  browser;
server.stdout.on("data", (data) => (log += data));
server.stderr.on("data", (data) => (log += data));
try {
  let ready = false;
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/api/manifest`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (server.exitCode !== null) throw new Error(log);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, log);
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
  const errors = [],
    failedRequests = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
    if (message.type() === "warning")
      console.log(`Browser warning: ${message.text()}`);
  });
  page.on("requestfailed", (request) =>
    failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`),
  );
  await page.goto(`http://localhost:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  // Independent solid-hull SAT in the actual browser, without engine guard code.
  await page.evaluate(() => {
    window.__pairDepth = (a, b) => {
      const world = (body) =>
        body.hulls
          .filter((h) => h.faces.length)
          .map((h) => ({
            vertices: h.vertices.map((p) =>
              p
                .clone()
                .applyQuaternion(body.state.orientation)
                .add(body.state.position),
            ),
            faces: h.faces.map((f) =>
              f.normal.clone().applyQuaternion(body.state.orientation),
            ),
            edges: h.edges,
          }));
      let result = 0;
      for (const ha of world(a))
        for (const hb of world(b)) {
          const axes = [...ha.faces, ...hb.faces];
          for (const [a0, a1] of ha.edges)
            for (const [b0, b1] of hb.edges)
              axes.push(
                ha.vertices[a1]
                  .clone()
                  .sub(ha.vertices[a0])
                  .cross(hb.vertices[b1].clone().sub(hb.vertices[b0])),
              );
          let depth = Infinity;
          for (const axis of axes) {
            if (axis.lengthSq() < 1e-12) continue;
            axis.normalize();
            const pa = ha.vertices.map((p) => p.dot(axis)),
              pb = hb.vertices.map((p) => p.dot(axis));
            const loA = Math.min(...pa),
              hiA = Math.max(...pa),
              loB = Math.min(...pb),
              hiB = Math.max(...pb);
            if (hiA <= loB || hiB <= loA) {
              depth = 0;
              break;
            }
            depth = Math.min(depth, hiA - loB, hiB - loA);
          }
          if (Number.isFinite(depth)) result = Math.max(result, depth);
        }
      return result;
    };
  });
  const grids = [];
  for (const [track, car] of process.env.SPAWN_PAIRS_ONLY_CRASHES
    ? []
    : [
        [
          "data/RACES/desert2/desert2.txt",
          "data/CARS/eaglegreen/EAGLEGREEN.TXT",
        ],
        ["data/RACES/desert2/desert2.txt", "data/CARS/buggy/buggy.txt"],
        ["data/RACES/desert2/desert2.txt", "data/CARS/bigdump/bigdump.txt"],
        ["data/RACES/newcity1/newcity1.txt", "data/CARS/EAGLE3/EAGLE3.TXT"],
      ]) {
    console.log(`Checking supported grid: ${track}, ${car}`);
    await page.evaluate(
      async ({ track, car }) => {
        const c = window.carma;
        document.querySelector("#track-select").value = c.assets.resolve(track);
        document.querySelector("#car-select").value = c.assets.resolve(car);
        await c.loadRace();
        c.paused = true;
      },
      { track, car },
    );
    await page.waitForFunction(() => window.carma.opponentsReady, null, {
      timeout: 90000,
    });
    const initial = await page.evaluate(() => {
      const c = window.carma;
      if (c.populationLoadState.opponents.state !== "ready")
        throw new Error(
          `Incomplete starting fleet: ${JSON.stringify(c.populationLoadState.opponents)}`,
        );
      window.__gridDamageContacts = [];
      const previousImpactPair = c.simulation.onImpactPair;
      c.simulation.onImpactPair = (a, b) => {
        for (const body of [a, b])
          if (body && body.damage.componentLevels.some((level) => level > 0))
            window.__gridDamageContacts.push({
              car: body.group.name,
              other: (body === a ? b : a)?.group.name ?? "world",
              at: c.simulation.elapsed,
              wasted: body.knackered,
              damage: [...body.damage.componentLevels],
            });
        previousImpactPair?.(a, b);
      };
      window.__gridStart = c.simulation.cars.map((p) =>
        p.state.position.clone(),
      );
      return c.simulation.cars.map((p, i) => ({
        name: p.group.name,
        position: p.state.position.toArray(),
        orientation: p.state.orientation.toArray(),
        wasted: p.knackered,
        support: p.state.groundedWheelCount,
        roadPenetration: Math.max(
          0,
          ...p.hulls.flatMap((h) =>
            h.vertices.map((vertex) => {
              const point = vertex
                .clone()
                .applyQuaternion(p.state.orientation)
                .add(p.state.position);
              const height = c.collision.height(
                point.x,
                point.z,
                p.state.position.y + 1,
              );
              return height === null ? 0 : height - point.y;
            }),
          ),
        ),
        pairPenetration: Math.max(
          0,
          ...c.simulation.cars
            .slice(i + 1)
            .map((other) => window.__pairDepth(p, other)),
        ),
      }));
    });
    assert.ok(
      initial.every((p) => !p.wasted && p.support === 4),
      JSON.stringify(initial),
    );
    assert.ok(
      initial.every(
        (p) => p.roadPenetration < 1e-5 && p.pairPenetration < 1e-5,
      ),
      JSON.stringify(initial),
    );
    await page.evaluate(() => {
      window.carma.paused = false;
      window.__until = window.carma.simulation.elapsed + 4;
    });
    await page.waitForFunction(
      () => window.carma.simulation.elapsed >= window.__until,
      null,
      { timeout: 30000 },
    );
    const settled = await page.evaluate(() => {
      const c = window.carma;
      c.paused = true;
      return c.simulation.cars.map((p, i) => ({
        name: p.group.name,
        moved: p.state.position.distanceTo(window.__gridStart[i]),
        wasted: p.knackered,
        damage: [...p.damage.componentLevels],
        position: p.state.position.toArray(),
        damageContacts: window.__gridDamageContacts.filter(
          (row) => row.car === p.group.name,
        ),
      }));
    });
    // Preserve the complete grid when an early AI crash fails an assertion.
    await writeFile(
      "artifacts/browser-spawn-grid-progress.json",
      JSON.stringify([...grids, { track, car, initial, settled }], null, 2),
    );
    assert.ok(
      settled.every(
        (p) =>
          p.position.every(Number.isFinite) &&
          (!p.wasted ||
            p.damageContacts.some((contact) =>
              contact.damage.some((level) => level > 0),
            )),
      ),
      JSON.stringify(settled),
    );
    assert.ok(
      settled.slice(1).every((p) => p.moved > 0.1),
      JSON.stringify(settled),
    );
    grids.push({ track, car, initial, settled });
  }
  // DUNE head-on and oblique crashes, actual damage/crush + real reverse key.
  const crashes = [];
  for (const offset of [0, 0.13]) {
    console.log(`Checking crash and keyboard release: offset ${offset}`);
    await page.evaluate(async () => {
      const c = window.carma;
      document.querySelector("#track-select").value = c.assets.resolve(
        "data/RACES/desert2/desert2.txt",
      );
      document.querySelector("#car-select").value = c.assets.resolve(
        "data/CARS/eaglegreen/EAGLEGREEN.TXT",
      );
      await c.loadRace();
      c.paused = true;
    });
    await page.waitForFunction(() => window.carma.opponentsReady, null, {
      timeout: 90000,
    });
    const crash = await page.evaluate((offset) => {
      const c = window.carma,
        a = c.player,
        b =
          c.simulation.cars.find((p) => p !== a && p.group.name === "EAGLE3") ??
          c.simulation.cars
            .filter((p) => p !== a)
            .sort(
              (x, y) => Math.abs(x.mass - a.mass) - Math.abs(y.mass - a.mass),
            )[0];
      if (!b)
        throw new Error("No loaded original opponent for crash regression");
      const heading = a.state.heading,
        base = a.state.position.clone();
      const up = base.clone().set(0, 1, 0),
        f = base.clone().set(0, 0, -1).applyQuaternion(a.state.orientation),
        right = up.clone().cross(f);
      for (const p of c.simulation.cars) {
        // Isolate the intended pair from the rest of the original grid.
        c.simulation.setCarPhysicsActive(p, p === a || p === b);
        p.input.throttle = 0;
        p.input.steer = 0;
        p.input.brake = false;
        p.state.velocity.set(0, 0, 0);
        p.state.angularVelocity.set(0, 0, 0);
      }
      a.state.position.copy(base).addScaledVector(f, -0.7);
      a.state.heading = heading;
      c.simulation.reset(a);
      b.state.position
        .copy(base)
        .addScaledVector(f, 0.7)
        .addScaledVector(right, offset);
      b.state.heading = heading + Math.PI;
      c.simulation.reset(b);
      a.state.velocity.copy(f).multiplyScalar(3);
      b.state.velocity.copy(f).multiplyScalar(-3);
      let peakDepth = 0,
        pairImpacts = 0;
      for (let i = 0; i < 30; i++) {
        c.simulation.step();
        peakDepth = Math.max(peakDepth, window.__pairDepth(a, b));
        pairImpacts += c.simulation.lastImpacts.filter(
          (impact) => impact.b === a || impact.b === b,
        ).length;
      }
      window.__reverseStart = a.state.position.clone();
      return {
        offset,
        cars: [a.group.name, b.group.name],
        peakDepth,
        pairImpacts,
        revA: a.damage.deformationRevision,
        revB: b.damage.deformationRevision,
        damageA: [...a.damage.componentLevels],
        damageB: [...b.damage.componentLevels],
      };
    }, offset);
    assert.ok(crash.peakDepth < 2e-6, JSON.stringify(crash));
    assert.ok(
      crash.pairImpacts > 0 && crash.revA + crash.revB > 0,
      JSON.stringify(crash),
    );
    await page.evaluate(() => {
      window.carma.paused = false;
      window.__until = window.carma.simulation.elapsed + 3;
    });
    await page.keyboard.down("ArrowDown");
    await page.waitForFunction(
      () => window.carma.simulation.elapsed >= window.__until,
      null,
      { timeout: 30000 },
    );
    await page.keyboard.up("ArrowDown");
    const reverse = await page.evaluate(() => {
      const c = window.carma;
      c.paused = true;
      document.querySelector("#panel").hidden = true;
      return {
        travel: c.vehicle.position.distanceTo(window.__reverseStart),
        position: c.vehicle.position.toArray(),
        input: { ...c.player.input },
        gear: c.player.state.gear,
        velocity: c.player.state.velocity.toArray(),
      };
    });
    assert.ok(reverse.travel > 0.5, JSON.stringify({ crash, reverse }));
    crashes.push({ ...crash, reverse });
    await page.screenshot({
      path: `artifacts/browser-pair-release-${offset === 0 ? "headon" : "oblique"}.png`,
    });
  }
  const glError = await page.evaluate(() =>
    document.querySelector("#view").getContext("webgl2").getError(),
  );
  assert.equal(glError, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  const report = { grids, crashes, errors, failedRequests, glError };
  await writeFile(
    "artifacts/browser-spawn-pairs.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
