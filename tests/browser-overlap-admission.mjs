import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

// Controlled OLD-overlap fixture, not a claim that ordinary crashes reserve a
// part on this schedule. Detachment, geometry, forces, contacts and repair are
// the production paths; only reservation, final release and initial pose differ.
const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const assetRoot = process.env.CARMA2_ROOT || "carma2_orig";
try {
  await access(executable);
  await access(assetRoot);
} catch {
  console.log(
    "SKIP overlap admission browser regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5231;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
let browser;
let page;
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));
const report = {
  fixture:
    "Due WAM reservation; controlled phase-2 release; rigidly contained real part; full 40ms simulation steps",
  backend:
    "SwiftShader browser correctness fixture, not a hardware performance measurement",
  cases: [],
  errors: [],
  failedRequests: [],
};

try {
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
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
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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
  report.build = await page
    .locator('script[type="module"]')
    .getAttribute("src");
  assert.match(
    report.build,
    /^\/assets\//,
    "regression must use the built production bundle",
  );
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  report.catalog = await page.evaluate(() => {
    const c = window.carma;
    return {
      track: c.assets.resolve("data/RACES/timber2/timber2.txt"),
      cars: ["EAGLE3", "cerby"].map((name) => ({
        name,
        path: c.assets.resolve(`data/CARS/${name}/${name}.TXT`),
      })),
    };
  });
  assert.ok(report.catalog.track, "original Timber race unavailable");
  for (const car of report.catalog.cars) {
    assert.ok(car.path, `original ${car.name} configuration unavailable`);
    await page.evaluate(
      async ({ track, car }) => {
        const c = window.carma;
        document.querySelector("#track-select").value = track;
        document.querySelector("#car-select").value = car;
        await c.loadRace();
        c.paused = true;
        document.querySelector("#panel").hidden = true;
      },
      { track: report.catalog.track, car: car.path },
    );
    await page.waitForFunction(
      () =>
        window.carma.stats.ready &&
        window.carma.opponentsReady &&
        window.carma.paused,
      null,
      { timeout: 90000 },
    );

    const overlap = await page.evaluate(({ name }) => {
      const c = window.carma;
      const sim = c.simulation;
      const target = c.player;
      const V = target.state.position.constructor;
      const Q = target.state.orientation.constructor;
      const require = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      for (const body of sim.cars) {
        sim.setCarPhysicsActive(body, body === target);
        body.input.throttle = body.input.steer = 0;
        body.input.brake = false;
        body.state.velocity.set(0, 0, 0);
        body.state.angularVelocity.set(0, 0, 0);
      }
      sim.reset(target);
      let ticks = 0;
      const tick = () => {
        require(ticks < 12, "fixture exceeded its twelve-step budget");
        sim.step();
        ticks++;
        for (const body of [
          target,
          ...sim.debris.filter((piece) => piece.owner === target),
        ])
          require([
            ...body.state.position.toArray(),
            ...body.state.orientation.toArray(),
            ...body.state.velocity.toArray(),
            ...body.state.angularVelocity.toArray(),
          ].every(Number.isFinite), "nonfinite physical state");
      };
      // Settle on the loaded original finite road; no empty or replacement world.
      tick();
      tick();
      const ground = () => {
        const hit = sim.world.raycast(
          target.state.position.clone().add(new V(0, 0.5, 0)),
          new V(0, -1, 0),
          2,
        );
        return (
          hit && {
            distance: hit.distance,
            point: hit.point.toArray(),
            normal: hit.normal.toArray(),
            material: hit.surface.material,
          }
        );
      };
      const initialGround = ground();
      require(initialGround &&
        Number.isFinite(
          initialGround.distance,
        ), "original road absent under settled car");
      require(target.state.groundedWheelCount >
        0, "settled original car has no grounded wheel");
      const rotations = [];
      for (const x of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2])
        for (const y of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2])
          for (const z of [0, Math.PI / 2])
            rotations.push(
              new Q()
                .setFromAxisAngle(new V(1, 0, 0), x)
                .multiply(new Q().setFromAxisAngle(new V(0, 1, 0), y))
                .multiply(new Q().setFromAxisAngle(new V(0, 0, 1), z)),
            );
      const mean = (vertices) =>
        vertices
          .reduce((sum, vertex) => sum.add(vertex), new V())
          .divideScalar(vertices.length);
      let selected;
      const inventory = [];
      for (const [index, part] of target.damage.runtimeParts.entries()) {
        if (
          part.state.phase !== 0 ||
          part.part.type !== "detach" ||
          part.mass <= 0
        )
          continue;
        const vertices =
          part.part.shape === "poly" && part.part.shapePoints.length >= 4
            ? part.part.shapePoints.map(
                (i) => target.damage.getPartVertices(part)[i],
              )
            : Array.from(
                { length: 8 },
                (_, i) =>
                  new V(
                    i & 1 ? part.bounds.max.x : part.bounds.min.x,
                    i & 2 ? part.bounds.max.y : part.bounds.min.y,
                    i & 4 ? part.bounds.max.z : part.bounds.min.z,
                  ),
              );
        if (vertices.some((vertex) => !vertex)) continue;
        const center = mean(vertices);
        let best;
        for (const [hullIndex, hull] of target.hulls.entries()) {
          const carCenter = mean(hull.vertices);
          for (const rotation of rotations) {
            const rotated = vertices.map((vertex) =>
              vertex.clone().sub(center).applyQuaternion(rotation),
            );
            let margin = Infinity;
            for (const vertex of rotated)
              for (const face of hull.faces)
                margin = Math.min(
                  margin,
                  face.constant -
                    face.normal.dot(vertex.clone().add(carCenter)),
                );
            if (!best || margin > best.margin)
              best = { margin, rotation, carCenter, hullIndex };
          }
        }
        inventory.push({
          index,
          actor: part.actor.name,
          type: part.state.type,
          shape: part.part.shape,
          margin: best?.margin,
        });
        // Prefer native flap pieces, then ordinary jointed pieces, over
        // authored fully detachable decorations. Eagle3 supplies a real wing.
        const rank = part.state.type;
        if (
          best?.margin > 0.005 &&
          (!selected ||
            rank < selected.rank ||
            (rank === selected.rank && best.margin > selected.margin))
        )
          selected = { ...best, part, index, center, rank };
      }
      require(selected, `no real WAM part fits wholly inside ${name}: ${JSON.stringify(inventory)}`);
      const { part, index, rotation, center, hullIndex } = selected;
      const queuedAt = sim.elapsed * 1000;
      part.state.queuedAt = queuedAt;
      sim.detachParts(target);
      const piece = sim.debris.find(
        (body) => body.owner === target && body.part === index,
      );
      require(piece, "due original WAM reservation did not create a physical body");
      const phaseAfterReservation = part.state.phase;
      const hadJoint = !!piece.joint;
      // Avoid a seconds-long native release timer in this bounded regression.
      part.state.phase = 2;
      piece.joint = undefined;
      const containedCenter = selected.carCenter
        .clone()
        .add(new V(0, selected.margin * 0.4, 0));
      const place = (localCenter) => {
        piece.state.orientation
          .copy(target.state.orientation)
          .multiply(rotation);
        piece.state.position
          .copy(localCenter)
          .sub(center.clone().applyQuaternion(rotation))
          .applyQuaternion(target.state.orientation)
          .add(target.state.position);
        piece.state.predictedPosition = piece.state.predictedOrientation =
          undefined;
        piece.state.angularVelocity.set(0, 0, 0);
        sim.syncActor(piece);
      };
      place(containedCenter);
      const carInverse = target.state.orientation.clone().invert();
      let containmentMargin = Infinity;
      for (const hull of piece.hulls)
        for (const vertex of hull.vertices) {
          const local = vertex
            .clone()
            .applyQuaternion(piece.state.orientation)
            .add(piece.state.position)
            .sub(target.state.position)
            .applyQuaternion(carInverse);
          for (const face of target.hulls[hullIndex].faces)
            containmentMargin = Math.min(
              containmentMargin,
              face.constant - face.normal.dot(local),
            );
        }
      require(containmentMargin >
        0.001, `actual detached hull is not contained: ${containmentMargin}`);
      piece.state.velocity.set(0, 0, 0);
      piece.overlapRecovery = target.overlapRecovery = true;
      piece.overlapDetected = target.overlapDetected = false;
      target.state.angularVelocity.set(0, 0, 0);
      const forward = new V(0, 0, -1)
        .applyQuaternion(target.state.orientation)
        .normalize();
      target.state.velocity
        .copy(forward)
        .multiplyScalar(1.5)
        .add(new V(0, 0.15, 0));
      target.input.throttle = 0.5;
      const initialPosition = target.state.position.clone();
      const elapsedBefore = sim.elapsed;
      const diagnosticBefore = sim.bodyPairDiagnostics;
      const commits = [];
      sim.bodyPairDiagnostics = (phase, diagnostics) => {
        diagnosticBefore?.(phase, diagnostics);
        if (phase === "commit") commits.push({ ...diagnostics });
      };
      const steps = [];
      for (let i = 0; i < 4; i++) {
        const old = target.state.position.clone();
        tick();
        steps.push({
          elapsed: sim.elapsed,
          distance: target.state.position.distanceTo(old),
          forwardProgress: target.state.position
            .clone()
            .sub(initialPosition)
            .dot(forward),
          velocity: target.state.velocity.toArray(),
          groundedWheels: target.state.groundedWheelCount,
          damage: [...target.damage.componentLevels],
          ownerRetained: piece.owner === target,
          free: !piece.joint,
          phase: part.state.phase,
        });
      }
      require(commits[0]?.recoveryHullAdmissions >
        0, "full commit did not admit native-qualified OLD overlap");
      require(steps[0].forwardProgress > 0.02 &&
        steps.at(-1).forwardProgress >
          0.08, `OLD overlap froze driven car: ${JSON.stringify(steps)}`);
      require(steps.every(
        (step) => step.ownerRetained && step.free && step.phase === 2,
      ), "controlled piece lost physical ownership/release state");
      const result = {
        name,
        part: {
          index,
          actor: part.actor.name,
          type: part.state.type,
          shape: part.part.shape,
          mass: piece.properties.mass,
          nativeHullTypes: piece.hulls.map((hull) => hull.nativeType),
          queuedAt,
          phaseAfterReservation,
          hadJoint,
        },
        inventory,
        containmentMargin,
        initialGround,
        elapsedBefore,
        elapsedAfter: sim.elapsed,
        steps,
        commits,
      };
      window.__overlapAdmission = {
        sim,
        target,
        piece,
        part,
        place,
        center,
        rotation,
        selected,
        tick,
        ground,
        forward,
        diagnosticBefore,
        get ticks() {
          return ticks;
        },
        result,
      };
      return result;
    }, car);
    const result = { ...overlap };
    report.cases.push(result);
    await page.screenshot({
      path: `artifacts/browser-overlap-admission-${car.name.toLowerCase()}-overlap.png`,
    });

    result.releaseAndRepair = await page.evaluate(() => {
      const f = window.__overlapAdmission;
      const {
        sim,
        target,
        piece,
        part,
        selected,
        rotation,
        center,
        place,
        tick,
        ground,
      } = f;
      const V = target.state.position.constructor;
      const require = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      try {
        target.input.throttle = target.input.steer = 0;
        target.state.velocity.set(0, 0, 0);
        target.state.angularVelocity.set(0, 0, 0);
        const localForward = new V(0, 0, -1);
        const forward = localForward
          .clone()
          .applyQuaternion(target.state.orientation)
          .normalize();
        const carFront = Math.max(
          ...target.hulls.flatMap((hull) =>
            hull.vertices.map((vertex) => vertex.dot(localForward)),
          ),
        );
        const pieceBack = Math.min(
          ...piece.hulls.flatMap((hull) =>
            hull.vertices.map((vertex) =>
              vertex
                .clone()
                .sub(center)
                .applyQuaternion(rotation)
                .dot(localForward),
            ),
          ),
        );
        const localCenter = selected.carCenter.clone();
        localCenter.addScaledVector(
          localForward,
          carFront - pieceBack + 0.04 - localCenter.dot(localForward),
        );
        place(localCenter);
        piece.state.velocity.copy(forward).multiplyScalar(-4);
        // Preserve recovery flags. Actual clear OLD geometry must rearm a fresh
        // collision in the next phase even for this owner's previously admitted bit.
        const retainedRecoveryFlags = {
          car: target.overlapRecovery,
          part: piece.overlapRecovery,
        };
        const initialGap = localCenter.dot(localForward) + pieceBack - carFront;
        require(initialGap >
          0.03, "fresh contact fixture is not initially separated");
        const contacts = [];
        for (let i = 0; i < 2; i++) {
          tick();
          for (const impact of sim.lastImpacts)
            if (
              (impact.a === target && impact.b === piece) ||
              (impact.a === piece && impact.b === target)
            )
              contacts.push({
                tick: f.ticks,
                sourceType: impact.sourceType,
                solverAccepted: impact.solverAccepted,
                normalImpulse: impact.normalImpulse,
                closingSpeed: impact.closingSpeed,
              });
        }
        require(contacts.some(
          (contact) =>
            contact.solverAccepted &&
            contact.normalImpulse > 0 &&
            contact.sourceType === 5,
        ), `fresh physical own-piece collision missing: ${JSON.stringify(contacts)}`);
        const beforeRepair = {
          phase: part.state.phase,
          bodyPresent: sim.debris.includes(piece),
          components: [...target.damage.componentLevels],
        };
        sim.repair(target);
        require(part.state.phase === 0 &&
          part.state.queuedAt === null &&
          part.actor.parent ===
            part.originalParent, "repair did not restore original WAM attachment");
        target.state.velocity.set(0, 0, 0);
        sim.reset(target);
        const grounded = [];
        for (let i = 0; i < 4; i++) {
          tick();
          grounded.push(target.state.groundedWheelCount);
        }
        const afterRepair = {
          phase: part.state.phase,
          queuedAt: part.state.queuedAt,
          bodyPresent: sim.debris.includes(piece),
          ownedBodies: sim.debris.filter((body) => body.owner === target)
            .length,
          originalParent: part.actor.parent === part.originalParent,
          components: [...target.damage.componentLevels],
          grounded,
          ground: ground(),
          ticks: f.ticks,
          position: target.state.position.toArray(),
        };
        require(!afterRepair.bodyPresent &&
          afterRepair.ownedBodies === 0, "repair retained physical debris");
        require(afterRepair.components.every(
          (value) => value === 0,
        ), "repair left component damage");
        require(afterRepair.ground &&
          afterRepair.grounded.at(-1) >
            0, "repaired car did not reground on original finite road");
        return {
          initialGap,
          retainedRecoveryFlags,
          contacts,
          beforeRepair,
          afterRepair,
        };
      } finally {
        sim.bodyPairDiagnostics = f.diagnosticBefore;
      }
    });
    assert.equal(result.releaseAndRepair.afterRepair.ticks, 12);
    await page.screenshot({
      path: `artifacts/browser-overlap-admission-${car.name.toLowerCase()}-repair.png`,
    });
  }
  report.gl = await page.evaluate(() => {
    const canvas = document.querySelector("#view");
    const gl = canvas.getContext("webgl2");
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      error: gl.getError(),
      renderer: extension && gl.getParameter(extension.UNMASKED_RENDERER_WEBGL),
      size: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    };
  });
  assert.equal(report.gl.error, 0, `WebGL error ${report.gl.error}`);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  await writeFile(
    "artifacts/browser-overlap-admission.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = String(error);
  if (page && !page.isClosed()) {
    report.failureState = await page
      .evaluate(() => {
        const f = window.__overlapAdmission;
        return (
          f && {
            ticks: f.ticks,
            phase: f.part.state.phase,
            car: f.target.state.position.toArray(),
            piece: f.piece.state.position.toArray(),
            velocity: f.target.state.velocity.toArray(),
            groundedWheels: f.target.state.groundedWheelCount,
            result: f.result,
          }
        );
      })
      .catch((captureError) => ({ captureError: String(captureError) }));
    await page
      .screenshot({ path: "artifacts/browser-overlap-admission-failure.png" })
      .catch(() => {});
  }
  await writeFile(
    "artifacts/browser-overlap-admission-failure.json",
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
