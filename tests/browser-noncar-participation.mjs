import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const assetRoot = process.env.CARMA2_ROOT || "carma2_orig";
try {
  await access(executable);
  await access(assetRoot);
} catch {
  console.log(
    "SKIP noncar participation browser regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}
await mkdir("artifacts", { recursive: true });
const port = 5234;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "",
  browser,
  page;
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));
const report = {
  fixture:
    "Original retained ACT/geometry; controlled player approach; at most twelve full 40ms steps per case",
  reclaimFixture:
    "Diagnostic: set existing authoritative quiet providers to doNothing, clear their motion, move active cars and refresh real caches, invoke the production outer-frame reclaim pass. This does not demonstrate natural settling.",
  backend:
    "SwiftShader correctness regression, not hardware performance evidence",
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
    "test requires the production bundle",
  );
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  const catalog = await page.evaluate(() => {
    const options = [...document.querySelector("#track-select").options];
    return {
      car: window.carma.assets.resolve("data/CARS/EAGLE3/EAGLE3.TXT"),
      targets: ["data", "adv_data"].flatMap((root) =>
        ["newcity1", "Carrier1"].map((race) => ({
          label: `${root === "data" ? "Stock" : "Advanced"} ${race}`,
          root,
          race,
          path: options.find(
            (option) =>
              option.value.toLowerCase().startsWith(`${root}/`) &&
              new RegExp(`/${race}/${race}\\.txt$`, "i").test(option.value),
          )?.value,
        })),
      ),
    };
  });
  report.catalog = catalog;
  assert.ok(catalog.car, "original Eagle3 configuration absent");
  for (const target of catalog.targets) {
    assert.ok(target.path, `original catalog entry absent: ${target.label}`);
    await page.evaluate(
      async ({ path, car }) => {
        const c = window.carma;
        document.querySelector("#track-select").value = path;
        document.querySelector("#car-select").value = car;
        await c.loadRace();
        c.paused = true;
        document.querySelector("#panel").hidden = true;
      },
      { path: target.path, car: catalog.car },
    );
    await page.waitForFunction(
      () =>
        window.carma.stats.ready &&
        window.carma.opponentsReady &&
        window.carma.paused,
      null,
      { timeout: 90000 },
    );

    const approach = await page.evaluate(({ label }) => {
      const c = window.carma,
        sim = c.simulation,
        player = c.player;
      const V = player.state.position.constructor,
        Q = player.state.orientation.constructor;
      const B = player.damage.runtimeParts[0].bounds.constructor;
      const require = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      for (const car of sim.cars) {
        if (car !== player && typeof sim.deactivateCar === "function")
          sim.deactivateCar(car);
        else sim.setCarPhysicsActive(car, car === player);
        car.input.throttle = car.input.steer = 0;
        car.input.brake = false;
        car.state.velocity.set(0, 0, 0);
        car.state.angularVelocity.set(0, 0, 0);
      }
      const initial = sim.nonCarCensus(),
        roster = sim.allBodies();
      const inactive = sim.noncars.filter(
        (body) => !sim.isNonCarPhysicsActive(body),
      );
      require(initial.retained >= 10 &&
        inactive.length >=
          10, `fixture lacks retained inactive scenery: ${JSON.stringify(initial)}`);
      require(inactive.every(
        (body) =>
          !roster.includes(body) &&
          !sim.phil.getHeader(body) &&
          !sim.nonCarSlots.get(body),
      ), "inactive catalog entries leaked into physics");
      const vertices = (
        body,
        orientation = body.state.orientation,
        position = body.state.position,
      ) =>
        body.hulls.flatMap((hull) =>
          hull.vertices.map((vertex) =>
            vertex.clone().applyQuaternion(orientation).add(position),
          ),
        );
      const bounds = (body) => new B().setFromPoints(vertices(body));
      const owns = (surface, body, native) => {
        if (surface?.native?.actor === native) return true;
        for (let actor = surface?.actor; actor; actor = actor.parent)
          if (actor === body.actor) return true;
        return false;
      };
      const candidates = inactive
        .filter((body) => {
          const m = body.mechanics;
          return (
            !body.attached &&
            !body.joint &&
            !m.worldJoint &&
            !m.infiniteInertia &&
            !m.tumble &&
            m.freeMass > 0 &&
            m.freeMass < 5 &&
            sim.world.getNonCarModelBounds(body.actor)
          );
        })
        .map((body) => ({
          body,
          bounds: bounds(body),
          native: sim.world.getNonCarNativeActor(body.actor),
        }))
        .filter((item) => {
          const size = item.bounds.getSize(new V());
          return item.native && size.y < 1 && size.x < 3 && size.z < 3;
        })
        .sort(
          (a, b) =>
            a.body.properties.mass - b.body.properties.mass ||
            a.bounds
              .getCenter(new V())
              .distanceToSquared(player.state.position) -
              b.bounds
                .getCenter(new V())
                .distanceToSquared(player.state.position),
        );
      const observations = [];
      window.__noncarParticipationFailure = {
        label,
        initial,
        eligible: candidates.length,
        observations,
      };
      let selected;
      for (const item of candidates.slice(0, 24)) {
        const { body, native } = item;
        const modelBounds = sim.world.getNonCarModelBounds(body.actor);
        body.actor.updateWorldMatrix(true, true);
        const modelWorld = modelBounds
          .clone()
          .applyMatrix4(body.actor.matrixWorld)
          .expandByScalar(0.005);
        const staticRows = sim.world
          .querySurfaces(modelWorld.min, modelWorld.max)
          .filter(
            (surface) =>
              owns(surface, body, native) &&
              !surface.owner &&
              surface.enabled !== false,
          );
        let staticRay;
        for (const surface of staticRows.slice(0, 8)) {
          if (surface.normal.lengthSq() < 1e-8) continue;
          const normal = surface.normal.clone().normalize();
          const center = surface.a
            .clone()
            .add(surface.b)
            .add(surface.c)
            .multiplyScalar(1 / 3);
          const hit = sim.world.raycast(
            center.addScaledVector(normal, 0.02),
            normal.negate(),
            0.05,
          );
          if (hit && owns(hit.surface, body, native)) {
            staticRay = {
              distance: hit.distance,
              point: hit.point.toArray(),
              material: hit.surface.material,
            };
            break;
          }
        }
        if (!staticRows.length || !staticRay) {
          observations.push({
            actor: body.actor.name,
            reason: "no selected MODEL static face/ray coverage",
            staticRows: staticRows.length,
          });
          continue;
        }
        const center = item.bounds.getCenter(new V());
        for (const localDirection of [
          new V(0, 0, -1),
          new V(1, 0, 0),
          new V(0, 0, 1),
          new V(-1, 0, 0),
        ]) {
          const direction = localDirection
            .applyQuaternion(body.state.orientation)
            .setY(0)
            .normalize();
          if (!direction.lengthSq()) continue;
          const heading = Math.atan2(-direction.x, -direction.z);
          const orientation = new Q().setFromAxisAngle(new V(0, 1, 0), heading);
          const carFront = Math.max(
            ...vertices(player, orientation, new V()).map((vertex) =>
              vertex.dot(direction),
            ),
          );
          const propBack = Math.min(
            ...vertices(body).map((vertex) => vertex.dot(direction)),
          );
          const position = center
            .clone()
            .addScaledVector(
              direction,
              propBack - center.dot(direction) - carFront - 0.025,
            );
          const heights = [];
          for (let wheel = 0; wheel < 4; wheel++) {
            const axle = wheel >> 1;
            const length =
              player.motion.suspensionLength[axle] -
              player.motion.suspensionBase.give[axle];
            const offset = player.motion.wheelPositions[wheel]
              .clone()
              .multiplyScalar(1 / 6.9)
              .applyQuaternion(orientation)
              .add(new V(0, -length / 6.9, 0));
            const origin = new V(
              position.x + offset.x,
              item.bounds.max.y + 1,
              position.z + offset.z,
            );
            const hit = sim.world.raycast(origin, new V(0, -1, 0), 3);
            if (
              !hit ||
              hit.normal.y < 0.98 ||
              hit.body ||
              owns(hit.surface, body, native)
            )
              break;
            heights.push(hit.point.y - offset.y);
          }
          if (
            heights.length !== 4 ||
            Math.max(...heights) - Math.min(...heights) > 0.015
          )
            continue;
          position.y = heights.reduce((sum, height) => sum + height, 0) / 4;
          const carWorld = new B().setFromPoints(
            vertices(player, orientation, position),
          );
          if (
            Math.min(carWorld.max.y, item.bounds.max.y) -
              Math.max(carWorld.min.y, item.bounds.min.y) <
            0.01
          )
            continue;
          sim.rematerializePose(
            player,
            position,
            orientation,
            direction.clone().multiplyScalar(1.5),
          );
          if (sim.testCarPlacement(player) !== -1) continue;
          sim.predictHierarchy(sim.allBodies());
          const probeRows = sim
            .worldContacts(player, player.hulls)
            .filter((contact) => owns(contact.sourceSurface, body, native));
          // Probe uses real world geometry outside PHIL's physics query phase.
          // Discard its face cache before the actual collection-time pull.
          sim.invalidateWorldFaceCache(player);
          if (!probeRows.length) continue;
          require(!sim.isNonCarPhysicsActive(
            body,
          ), "readonly candidate probe unexpectedly admitted an ACT");
          selected = {
            ...item,
            direction,
            position,
            orientation,
            staticRay,
            staticFaceCount: staticRows.length,
            candidateRows: probeRows.length,
            modelBounds: [modelBounds.min.toArray(), modelBounds.max.toArray()],
          };
          break;
        }
        if (selected) break;
        observations.push({
          actor: body.actor.name,
          reason:
            "no clear supported approach with selected MODEL candidate contact",
        });
      }
      require(selected, `no original dormant free MODEL approach in ${label}: ${JSON.stringify(window.__noncarParticipationFailure)}`);
      const body = selected.body,
        native = selected.native;
      const geometry = [];
      body.actor.traverse((node) => {
        if (node.isMesh)
          geometry.push({
            node,
            geometry: node.geometry,
            material: node.material,
          });
      });
      const resource = native.localModel.value;
      const retainedCount = sim.noncars.length;
      let ticks = 0;
      const tick = () => {
        require(ticks < 12, "case exceeded twelve physical steps");
        sim.step();
        ticks++;
        for (const item of [player, body])
          require([
            ...item.state.position.toArray(),
            ...item.state.orientation.toArray(),
            ...item.state.velocity.toArray(),
            ...item.state.angularVelocity.toArray(),
          ].every(Number.isFinite), "nonfinite physical state");
      };
      const steps = [],
        contacts = [];
      Object.assign(window.__noncarParticipationFailure, {
        selectedActor: body.actor.name,
        selectedMechanicsIndex: body.mechanics.index,
        steps,
        contacts,
      });
      const start = player.state.position.clone(),
        elapsedStart = sim.elapsed;
      player.input.throttle = 0.25;
      for (let i = 0; i < 8; i++) {
        tick();
        for (const impact of sim.lastImpacts)
          if (
            (impact.a === player && impact.b === body) ||
            (impact.a === body && impact.b === player)
          )
            contacts.push({
              tick: ticks,
              sourceType: impact.sourceType,
              solverAccepted: impact.solverAccepted,
              normalImpulse: impact.normalImpulse,
              closingSpeed: impact.closingSpeed,
            });
        steps.push({
          tick: ticks,
          active: sim.isNonCarPhysicsActive(body),
          slot: sim.nonCarSlots.get(body),
          header: sim.phil.getHeader(body)?.index ?? null,
          player: player.state.position.toArray(),
          prop: body.state.position.toArray(),
          groundedWheels: player.state.groundedWheelCount,
        });
      }
      require(sim.isNonCarPhysicsActive(body) &&
        sim.phil.getHeader(body) &&
        sim.nonCarSlots.get(
          body,
        ), "original approached ACT did not obtain PHIL and a global physical slot");
      require(contacts.some(
        (contact) =>
          contact.solverAccepted &&
          contact.sourceType !== 9 &&
          contact.normalImpulse > 1e-6,
      ), `no meaningful original car/prop collision: ${JSON.stringify(contacts)}`);
      require(player.state.position.distanceTo(start) >
        0.005, "approaching player never committed motion");
      const result = {
        label,
        initial,
        eligible: candidates.length,
        excludedInactive: inactive.length,
        selected: {
          actor: body.actor.name,
          mechanicsIndex: body.mechanics.index,
          mass: body.properties.mass,
          freeMass: body.mechanics.freeMass,
          attachedMass: body.mechanics.attachedMass,
          hulls: body.hulls.length,
          model: resource.source?.name ?? null,
          modelBounds: selected.modelBounds,
          staticFaceCount: selected.staticFaceCount,
          staticRay: selected.staticRay,
          candidateRows: selected.candidateRows,
          initialPose: {
            position: selected.position.toArray(),
            orientation: selected.orientation.toArray(),
          },
        },
        elapsedStart,
        elapsedAfter: sim.elapsed,
        contacts,
        steps,
        censusAfterApproach: sim.nonCarCensus(),
      };
      window.__noncarParticipation = {
        sim,
        player,
        body,
        native,
        resource,
        geometry,
        retainedCount,
        tick,
        owns,
        get ticks() {
          return ticks;
        },
        result,
      };
      return result;
    }, target);
    const result = { ...approach };
    report.cases.push(result);
    await page.screenshot({
      path: `artifacts/browser-noncar-participation-${target.root}-${target.race.toLowerCase()}-approach.png`,
    });
    result.reclaimAndRepull = await page.evaluate(() => {
      const f = window.__noncarParticipation;
      const { sim, player, body, native, resource, geometry, tick, owns } = f;
      const V = player.state.position.constructor,
        Q = player.state.orientation.constructor;
      const B = player.damage.runtimeParts[0].bounds.constructor;
      const require = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      require(sim.nativeNonCarQuietState(
        body,
      ), "selected original free prop lacks authoritative quiet ownership");
      const diagnostics = [];
      for (const item of sim.activeNonCars()) {
        const quiet = sim.nativeNonCarQuietState(item);
        if (quiet) {
          quiet.doNothing = true;
          quiet.localVelocity.set(0, 0, 0);
          quiet.auxiliaryLocalOmega.set(0, 0, 0);
          item.state.velocity.set(0, 0, 0);
          item.state.angularVelocity.set(0, 0, 0);
          item.properties.immovable = true;
          diagnostics.push(item.actor.name);
        } else sim.facesNearBody(item, item.hulls);
      }
      // Actual pose/cache transition, not invented reclaim bounds. Other cars
      // are inactive; move the remaining awake car away from reclaim blockers.
      const away = body.state.position.clone().add(new V(40, 20, 40));
      player.input.throttle = player.input.steer = 0;
      sim.rematerializePose(player, away, new Q(), new V());
      sim.facesNearBody(player, player.hulls);
      const before = sim.nonCarCensus();
      sim.finishNonCarReclaim(1000);
      const after = sim.nonCarCensus();
      require(!sim.isNonCarPhysicsActive(body) &&
        !sim.phil.getHeader(body) &&
        !sim.nonCarSlots.get(
          body,
        ), `diagnostic reclaim retained the selected occupancy: ${JSON.stringify({ before, after, diagnostics })}`);
      require(sim.noncars.length === f.retainedCount &&
        sim.noncars.includes(
          body,
        ), "reclaim discarded retained ACT catalog identity");
      require(native.localModel.value ===
        resource, "reclaim replaced original MODEL identity");
      require(geometry.every(
        (entry) =>
          entry.node.geometry === entry.geometry &&
          entry.node.material === entry.material,
      ), "reclaim changed borrowed geometry/material identity");
      require(body.actor.userData.noncarPulled === false &&
        body.actor.userData.c2ActorTypeData === undefined &&
        body.actor.userData.nativeNoncarDriver ===
          0, "reclaim failed to clear native owner binding");
      const modelBounds = sim.world.getNonCarModelBounds(body.actor).clone();
      body.actor.updateWorldMatrix(true, true);
      const modelWorld = modelBounds
        .applyMatrix4(body.actor.matrixWorld)
        .expandByScalar(0.01);
      const restoredFaces = sim.world
        .querySurfaces(modelWorld.min, modelWorld.max)
        .filter((surface) => owns(surface, body, native) && !surface.owner);
      require(restoredFaces.length >
        0, "reclaimed original MODEL lost static collision coverage");
      const center = modelWorld.getCenter(new V());
      const direction = new V(0, 0, -1)
        .applyQuaternion(body.state.orientation)
        .setY(0)
        .normalize();
      const heading = Math.atan2(-direction.x, -direction.z);
      const orientation = new Q().setFromAxisAngle(new V(0, 1, 0), heading);
      const carFront = Math.max(
        ...player.hulls.flatMap((hull) =>
          hull.vertices.map((point) =>
            point.clone().applyQuaternion(orientation).dot(direction),
          ),
        ),
      );
      const propBack = Math.min(
        ...body.hulls.flatMap((hull) =>
          hull.vertices.map((point) =>
            point
              .clone()
              .applyQuaternion(body.state.orientation)
              .add(body.state.position)
              .dot(direction),
          ),
        ),
      );
      // Repull is a diagnostic collision-query fixture after the real approach.
      // Match vertical hull centers; no ground/settling claim is made here.
      const position = center
        .clone()
        .addScaledVector(
          direction,
          propBack - center.dot(direction) - carFront - 0.02,
        );
      const carBounds = new B().setFromPoints(
        player.hulls.flatMap((hull) => hull.vertices),
      );
      position.y -= carBounds.getCenter(new V()).y;
      sim.rematerializePose(
        player,
        position,
        orientation,
        direction.clone().multiplyScalar(1.5),
      );
      let repulledAt = null;
      for (let i = 0; i < 4; i++) {
        tick();
        if (sim.isNonCarPhysicsActive(body) && repulledAt === null)
          repulledAt = f.ticks;
      }
      require(repulledAt !== null &&
        sim.phil.getHeader(body) &&
        sim.nonCarSlots.get(
          body,
        ), "retained original ACT did not repull in the next physical collection");
      require(native.localModel.value ===
        resource, "repull replaced source MODEL");
      return {
        diagnosticQuietActors: diagnostics,
        before,
        after,
        restoredFaces: restoredFaces.length,
        retainedActorCount: sim.noncars.length,
        repulledAt,
        slot: sim.nonCarSlots.get(body),
        header: sim.phil.getHeader(body).index,
        censusAfterRepull: sim.nonCarCensus(),
        ticks: f.ticks,
      };
    });
    assert.equal(result.reclaimAndRepull.ticks, 12);
    await page.screenshot({
      path: `artifacts/browser-noncar-participation-${target.root}-${target.race.toLowerCase()}-repull.png`,
    });
  }
  report.massComparisons = ["newcity1", "Carrier1"].map((race) => ({
    race,
    cases: report.cases
      .filter((item) => item.label.toLowerCase().endsWith(race.toLowerCase()))
      .map((item) => ({
        label: item.label,
        actor: item.selected.actor,
        mechanicsIndex: item.selected.mechanicsIndex,
        mass: item.selected.mass,
        freeMass: item.selected.freeMass,
      })),
    note: "Values are original selected properties. Different selected types are not evidence of a namespace multiplier; equal Stock/Advanced values are retained.",
  }));
  report.gl = await page.evaluate(() => {
    const gl = document.querySelector("#view").getContext("webgl2");
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
    "artifacts/browser-noncar-participation.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = String(error);
  if (page && !page.isClosed()) {
    report.failureState = await page
      .evaluate(() => ({
        setup: window.__noncarParticipationFailure,
        result: window.__noncarParticipation?.result,
        ticks: window.__noncarParticipation?.ticks,
        census: window.carma?.simulation?.nonCarCensus?.(),
      }))
      .catch((captureError) => ({ captureError: String(captureError) }));
    await page
      .screenshot({
        path: "artifacts/browser-noncar-participation-failure.png",
      })
      .catch(() => {});
  }
  await writeFile(
    "artifacts/browser-noncar-participation-failure.json",
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
