import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

// Original WAM bodies and finite track geometry. Reservations, final release
// and initial placement are controlled fixtures; quiet state is never assigned.
const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
try {
  await access(executable);
  await access(process.env.CARMA2_ROOT || "carma2_orig");
} catch {
  console.log(
    "SKIP hierarchy quiet browser regression: Chromium or C2 assets absent.",
  );
  process.exit(0);
}
await mkdir("artifacts", { recursive: true });
const port = 5235;
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
    "Original Eagle3/Cerby WAM release on original finite road; natural quiet observation, impact wake, post-impact force work and repair; maximum25 full40ms steps per car",
  backend:
    "SwiftShader correctness evidence, not hardware performance evidence",
  cases: [],
  unmet: [],
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
  assert.match(report.build, /^\/assets\//, "production bundle required");
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  const catalog = await page.evaluate(() => ({
    track: window.carma.assets.resolve("data/RACES/timber2/timber2.txt"),
    cars: ["EAGLE3", "cerby"].map((name) => ({
      name,
      path: window.carma.assets.resolve(`data/CARS/${name}/${name}.TXT`),
    })),
  }));
  assert.ok(catalog.track, "original Timber race unavailable");
  for (const car of catalog.cars) {
    assert.ok(car.path, `original ${car.name} unavailable`);
    await page.evaluate(
      async ({ track, car }) => {
        document.querySelector("#track-select").value = track;
        document.querySelector("#car-select").value = car;
        await window.carma.loadRace();
        window.carma.paused = true;
        document.querySelector("#panel").hidden = true;
      },
      { track: catalog.track, car: car.path },
    );
    await page.waitForFunction(
      () =>
        window.carma.stats.ready &&
        window.carma.opponentsReady &&
        window.carma.paused,
      null,
      { timeout: 90000 },
    );
    const settle = await page.evaluate(
      ({ name, inspectProp }) => {
        const c = window.carma,
          sim = c.simulation,
          owner = c.player;
        const V = owner.state.position.constructor,
          Q = owner.state.orientation.constructor;
        const B = owner.damage.runtimeParts[0].bounds.constructor;
        const require = (value, message) => {
          if (!value) throw new Error(message);
        };
        require(sim.hierarchyQuiet &&
          sim.quietCensus, "production hierarchy quiet API absent");
        const result = {
          name,
          fixture:
            "Due original WAM reservations; controlled phase2 free release/flat-road launch; no ec/quiet edits",
          unmet: [],
          samples: [],
        };
        window.__hierarchyQuiet = { result };
        for (const item of sim.cars) {
          sim.setCarPhysicsActive(item, item === owner);
          item.input.throttle = item.input.steer = 0;
          item.input.brake = false;
          item.state.velocity.set(0, 0, 0);
          item.state.angularVelocity.set(0, 0, 0);
        }
        let ticks = 0;
        let monitoredPiece, monitoredAttached, currentWork;
        const workTicks = [];
        const originalFreeForces = sim.applyFreeBodyForces;
        const originalWorldContacts = sim.worldContacts;
        sim.applyFreeBodyForces = function (body, ...args) {
          if (currentWork && body === monitoredPiece)
            currentWork.freeBodyForceCalls++;
          return originalFreeForces.call(this, body, ...args);
        };
        sim.worldContacts = function (body, ...args) {
          if (currentWork) {
            currentWork.worldContactMethodCalls.allBodies++;
            if (body === owner) currentWork.worldContactMethodCalls.ownerRoot++;
            if (body === monitoredPiece)
              currentWork.worldContactMethodCalls.freePiece++;
            if (body === monitoredAttached)
              currentWork.worldContactMethodCalls.attachedChild++;
          }
          return originalWorldContacts.call(this, body, ...args);
        };
        const restoreWork = () => {
          sim.applyFreeBodyForces = originalFreeForces;
          sim.worldContacts = originalWorldContacts;
        };
        const workSnapshot = () => {
          const stages = {};
          for (const t of workTicks) {
            const stage = (stages[t.stage] ??= {
              ticks: [],
              freeBodyForceCalls: 0,
              worldContactMethodCalls: {
                allBodies: 0,
                ownerRoot: 0,
                freePiece: 0,
                attachedChild: 0,
              },
            });
            stage.ticks.push(t.tick);
            stage.freeBodyForceCalls += t.freeBodyForceCalls;
            for (const key of Object.keys(stage.worldContactMethodCalls))
              stage.worldContactMethodCalls[key] +=
                t.worldContactMethodCalls[key];
          }
          return {
            note: "Observed production method invocations only. worldContacts calls include early exits and do not measure hull transforms, guard probes or complete world-query work. No historical baseline is inferred.",
            stages,
            ticks: workTicks,
          };
        };
        Object.assign(window.__hierarchyQuiet, { restoreWork, workSnapshot });
        const quietSnapshot = (body) => {
          const s = sim.hierarchyQuiet.get(body);
          return (
            s && {
              doNothing: s.doNothing,
              quietState: s.quietState,
              ownState: s.ownState,
              eligibleLeaves: s.eligibleLeaves,
              sleepTransitions: s.sleepTransitions,
              wakeTransitions: s.wakeTransitions,
              inertiaScale: s.inertiaScale,
              gate: s.lastResult?.gate,
              angularEnergy: s.lastResult?.angularEnergy,
            }
          );
        };
        const tick = (stage = "settle") => {
          require(ticks < 25, "fixture exceeded25 physical steps");
          const record = {
            tick: ticks + 1,
            stage,
            freeQuietBefore: monitoredPiece
              ? (quietSnapshot(monitoredPiece)?.doNothing ?? null)
              : null,
            freeBodyForceCalls: 0,
            worldContactMethodCalls: {
              allBodies: 0,
              ownerRoot: 0,
              freePiece: 0,
              attachedChild: 0,
            },
          };
          currentWork = record;
          try {
            sim.step();
          } finally {
            currentWork = null;
            workTicks.push(record);
          }
          ticks++;
          record.freeQuietAfter = monitoredPiece
            ? (quietSnapshot(monitoredPiece)?.doNothing ?? null)
            : null;
          for (const body of [
            owner,
            ...sim.debris.filter((b) => b.owner === owner),
          ])
            require([
              ...body.state.position.toArray(),
              ...body.state.orientation.toArray(),
              ...body.state.velocity.toArray(),
              ...body.state.angularVelocity.toArray(),
            ].every(Number.isFinite), "nonfinite physical state");
          return record;
        };
        tick("ground");
        tick("ground");
        require(owner.state.groundedWheelCount >
          0, "original road did not ground source car");
        const parts = owner.damage.runtimeParts;
        const attachedPart = parts.find(
          (p) =>
            p.part.type === "detach" &&
            (p.state.type === 0 || p.state.type === 1) &&
            p.state.phase === 0,
        );
        const freePart = parts.find(
          (p) =>
            p !== attachedPart &&
            p.state.type === 2 &&
            p.state.phase === 0 &&
            ["detach", "flap"].includes(p.part.type),
        );
        require(attachedPart &&
          freePart, "original WAM lacks attached/free test parts");
        for (const part of [attachedPart, freePart])
          part.state.queuedAt = sim.elapsed * 1000;
        sim.detachParts(owner);
        const attached = sim.debris.find(
          (b) => b.owner === owner && b.part === parts.indexOf(attachedPart),
        );
        const piece = sim.debris.find(
          (b) => b.owner === owner && b.part === parts.indexOf(freePart),
        );
        require(attached?.joint &&
          piece, "production due reservation failed to create real WAM bodies");
        monitoredPiece = piece;
        monitoredAttached = attached;
        freePart.state.phase = 2;
        piece.joint = undefined;
        const localPoints = piece.hulls.flatMap((h) => h.vertices);
        const localBounds = new B().setFromPoints(localPoints);
        const center = localBounds.getCenter(new V()),
          size = localBounds.getSize(new V());
        let drop;
        for (const [dx, dz] of [
          [2, 0],
          [-2, 0],
          [0, 2],
          [0, -2],
          [2, 2],
          [-2, -2],
          [1, 1],
          [-1, 1],
        ]) {
          const x = owner.state.position.x + dx,
            z = owner.state.position.z + dz;
          const heights = [];
          for (const [ox, oz] of [
            [0, 0],
            [-size.x / 2, -size.z / 2],
            [-size.x / 2, size.z / 2],
            [size.x / 2, -size.z / 2],
            [size.x / 2, size.z / 2],
          ]) {
            const hit = sim.world.raycast(
              new V(x + ox, owner.state.position.y + 1, z + oz),
              new V(0, -1, 0),
              3,
            );
            if (!hit || hit.body || hit.normal.y < 0.999) break;
            heights.push(hit.point.y);
          }
          if (
            heights.length !== 5 ||
            Math.max(...heights) - Math.min(...heights) > 0.002
          )
            continue;
          const position = new V(
            x - center.x,
            Math.max(...heights) - localBounds.min.y + 0.002,
            z - center.z,
          );
          const worldBox = localBounds.clone().translate(position);
          const nearby = sim.world.querySurfaces(worldBox.min, worldBox.max);
          if (nearby.some((face) => face.normal.y < 0.98 && !face.owner))
            continue;
          drop = { position, roadY: Math.max(...heights) };
          break;
        }
        require(drop, "no nearby original flat-road launch for real part");
        piece.state.position.copy(drop.position);
        piece.state.orientation.identity();
        piece.state.velocity.set(0, 0, 0);
        piece.state.angularVelocity.set(0, 0, 0);
        piece.state.predictedPosition = piece.state.predictedOrientation =
          undefined;
        sim.syncActor(piece);
        sim.invalidateWorldFaceCache(piece);
        const sourceGeometry = [];
        piece.actor.traverse((node) => {
          if (node.isMesh)
            sourceGeometry.push({
              node,
              geometry: node.geometry,
              material: node.material,
            });
        });
        let prop;
        if (inspectProp) {
          prop = sim.noncars.find(
            (b) =>
              (b.attached || b.mechanics.worldJoint) &&
              b.joint &&
              !b.mechanics.tumble &&
              !b.mechanics.infiniteInertia &&
              sim.world.getNonCarNativeActor(b.actor),
          );
          if (prop) {
            const admitted =
              sim.isNonCarPhysicsActive(prop) ||
              sim.admitNonCar(prop, { wake: true, resetVelocity: false });
            result.originalJointedProp = {
              fixture:
                "Controlled admission of unchanged original attached ACT; no quiet/motor edits; not a settle claim",
              actor: prop.actor.name,
              mechanicsIndex: prop.mechanics.index,
              mass: prop.properties.mass,
              admitted,
              authoredWorldJoint: prop.mechanics.worldJoint?.kind ?? null,
              jointType: prop.joint.type,
            };
            if (!admitted)
              result.unmet.push(
                "original jointed NONCAR could not obtain PHIL/slot",
              );
          } else
            result.unmet.push(
              "no eligible original jointed NONCAR for provider coverage",
            );
        }
        result.parts = {
          attached: attached.actor.name,
          free: piece.actor.name,
          freeMass: piece.properties.mass,
          freeInertia: piece.properties.inertia.toArray(),
          freeBounds: [localBounds.min.toArray(), localBounds.max.toArray()],
          drop: drop.position.toArray(),
          roadY: drop.roadY,
        };
        let sleptAt = null;
        for (let i = 0; i < 12; i++) {
          tick();
          const sample = {
            tick: ticks,
            free: quietSnapshot(piece),
            attached: quietSnapshot(attached),
            owner: quietSnapshot(owner),
            grounded: owner.state.groundedWheelCount,
            velocity: piece.state.velocity.toArray(),
            omega: piece.state.angularVelocity.toArray(),
          };
          result.samples.push(sample);
          if (
            sample.free?.doNothing &&
            sample.free.eligibleLeaves > 0 &&
            sample.free.sleepTransitions > 0
          ) {
            sleptAt = ticks;
            break;
          }
        }
        result.naturalSleep = {
          sleptAt,
          last: quietSnapshot(piece),
          census: sim.quietCensus(),
        };
        if (sleptAt === null)
          result.unmet.push(
            "real free WAM part did not reach natural eligible-to-sleep transition within12 settle steps",
          );
        if (!sim.hierarchyQuiet.get(attached) || !attached.joint)
          result.unmet.push(
            "original attached part lost hierarchy/provider ownership",
          );
        const groundSamples = result.samples.filter((s) => s.grounded > 0);
        if (
          !groundSamples.length ||
          groundSamples.some((s) => s.owner?.doNothing || s.attached?.doNothing)
        )
          result.unmet.push(
            "grounded source car/attached part did not remain awake",
          );
        if (attached.joint) {
          const j = attached.joint;
          result.attachedAnchorGap = j.childAnchor
            .clone()
            .applyQuaternion(attached.state.orientation)
            .add(attached.state.position)
            .distanceTo(
              j.parentAnchor
                .clone()
                .applyQuaternion(j.parent.state.orientation)
                .add(j.parent.state.position),
            );
          if (result.attachedAnchorGap > 0.01)
            result.unmet.push(
              "original attached part committed a broken hierarchy anchor",
            );
        }
        if (prop && result.originalJointedProp.admitted) {
          const s = quietSnapshot(prop);
          result.originalJointedProp.after = {
            quiet: s,
            retained: sim.noncars.includes(prop),
            physical: sim.isNonCarPhysicsActive(prop),
            header: sim.phil.getHeader(prop)?.index,
            slot: sim.nonCarSlots.get(prop),
            jointRetained: !!prop.joint,
          };
          if (!s || !prop.joint || !sim.phil.getHeader(prop))
            result.unmet.push(
              "original jointed NONCAR lacks live generic quiet/provider/joint",
            );
        }
        if (sleptAt !== null) {
          const oldPosition = piece.state.position.clone(),
            oldQ = piece.state.orientation.clone();
          const retentionWork = [
            tick("sleep-retention"),
            tick("sleep-retention"),
          ];
          result.retention = {
            retained: sim.debris.includes(piece),
            header: !!sim.phil.getHeader(piece),
            renderParent: !!piece.actor.parent,
            unchangedPose:
              piece.state.position.equals(oldPosition) &&
              piece.state.orientation.equals(oldQ),
            quiet: quietSnapshot(piece),
            work: retentionWork,
          };
          if (
            !result.retention.retained ||
            !result.retention.header ||
            !result.retention.renderParent ||
            !result.retention.unchangedPose ||
            !result.retention.quiet?.doNothing
          )
            result.unmet.push(
              "sleeping original free part lost PHIL/render/pose retention",
            );
          if (
            retentionWork.some(
              (t) =>
                t.freeQuietBefore !== true ||
                t.freeQuietAfter !== true ||
                t.freeBodyForceCalls !== 0,
            )
          )
            result.unmet.push(
              "truly asleep retained free part received force work during sleep-retention ticks",
            );
        }
        Object.assign(window.__hierarchyQuiet, {
          sim,
          owner,
          piece,
          attached,
          freePart,
          attachedPart,
          V,
          Q,
          B,
          tick,
          quietSnapshot,
          sourceGeometry,
          sleptAt,
          getTicks: () => ticks,
        });
        result.work = workSnapshot();
        result.ticks = ticks;
        return result;
      },
      { name: car.name, inspectProp: car.name === "EAGLE3" },
    );
    report.cases.push(settle);
    await page.screenshot({
      path: `artifacts/browser-hierarchy-quiet-${car.name.toLowerCase()}-settle.png`,
    });
    const ending = await page.evaluate(() => {
      const f = window.__hierarchyQuiet;
      const {
        sim,
        owner,
        piece,
        attached,
        freePart,
        attachedPart,
        V,
        Q,
        B,
        tick,
        quietSnapshot,
        sourceGeometry,
      } = f;
      const result = { unmet: [], wake: null, repair: null };
      const vertices = (
        body,
        q = body.state.orientation,
        p = body.state.position,
      ) =>
        body.hulls.flatMap((h) =>
          h.vertices.map((v) => v.clone().applyQuaternion(q).add(p)),
        );
      if (f.sleptAt !== null) {
        const pieceBounds = new B().setFromPoints(vertices(piece)),
          center = pieceBounds.getCenter(new V());
        const oldOwnerPosition = owner.state.position.clone();
        const oldOwnerInverse = owner.state.orientation.clone().invert();
        const attachedLocalPosition = attached.state.position
          .clone()
          .sub(oldOwnerPosition)
          .applyQuaternion(oldOwnerInverse);
        const attachedLocalOrientation = oldOwnerInverse
          .clone()
          .multiply(attached.state.orientation);
        let approach;
        for (const direction of [
          new V(0, 0, -1),
          new V(1, 0, 0),
          new V(0, 0, 1),
          new V(-1, 0, 0),
        ]) {
          const q = new Q().setFromAxisAngle(
            new V(0, 1, 0),
            Math.atan2(-direction.x, -direction.z),
          );
          const front = Math.max(
            ...vertices(owner, q, new V()).map((v) => v.dot(direction)),
          );
          const back = Math.min(
            ...vertices(piece).map((v) => v.dot(direction)),
          );
          const position = center
            .clone()
            .addScaledVector(
              direction,
              back - center.dot(direction) - front - 0.025,
            );
          const heights = [];
          for (let wheel = 0; wheel < 4; wheel++) {
            const axle = wheel >> 1,
              length =
                owner.motion.suspensionLength[axle] -
                owner.motion.suspensionBase.give[axle];
            const offset = owner.motion.wheelPositions[wheel]
              .clone()
              .multiplyScalar(1 / 6.9)
              .applyQuaternion(q)
              .add(new V(0, -length / 6.9, 0));
            const hit = sim.world.raycast(
              new V(position.x + offset.x, center.y + 1, position.z + offset.z),
              new V(0, -1, 0),
              3,
            );
            if (!hit || hit.body || hit.normal.y < 0.999) break;
            heights.push(hit.point.y - offset.y);
          }
          if (
            heights.length !== 4 ||
            Math.max(...heights) - Math.min(...heights) > 0.002
          )
            continue;
          position.y = heights.reduce((a, b) => a + b, 0) / 4;
          sim.rematerializePose(
            owner,
            position,
            q,
            direction.clone().multiplyScalar(1.5),
          );
          // Controlled relocation preserves the original physical parent/child
          // anchors; a stale child pose would turn this into a teleport-gap test.
          attached.state.position
            .copy(attachedLocalPosition)
            .applyQuaternion(q)
            .add(position);
          attached.state.orientation.copy(q).multiply(attachedLocalOrientation);
          attached.state.velocity.copy(owner.state.velocity);
          attached.state.angularVelocity.set(0, 0, 0);
          attached.state.predictedPosition =
            attached.state.predictedOrientation = undefined;
          sim.syncActor(attached);
          sim.invalidateWorldFaceCache(attached);
          if (sim.testCarPlacement(owner) !== -1) continue;
          approach = { direction, position, q };
          break;
        }
        if (!approach)
          result.unmet.push(
            "no clear grounded original-car approach to sleeping real part",
          );
        else {
          const prelude = [],
            impacts = [],
            springReactions = [],
            contactPairs = [],
            wakeDiagnostics = [];
          const originalPrepare = sim.preparePedContacts;
          const originalGround = sim.oilGround;
          const originalWake = sim.hierarchyQuiet.wake;
          const collectedIncoming = new Map();
          const actorName = (body) =>
            body?.actor?.name ?? body?.group?.name ?? null;
          const incomingRole = (body) => {
            if (body === owner)
              return { role: "owner-root", actor: actorName(body) };
            const seen = new Set();
            for (
              let node = body;
              node && !seen.has(node);
              node = node.joint?.parent
            ) {
              if (node === owner)
                return {
                  role: "attached-child",
                  actor: actorName(body),
                  part: body.part,
                  jointType: body.joint?.type,
                };
              seen.add(node);
            }
            return null;
          };
          const otherEndpoint = (row) =>
            row.a === piece ? row.b : row.b === piece ? row.a : null;
          sim.preparePedContacts = function (rows) {
            const relevant = [];
            for (const row of rows) {
              const other = otherEndpoint(row);
              contactPairs.push({
                tick: f.getTicks() + 1,
                a: actorName(row.a),
                b: actorName(row.b),
                sourceType: row.sourceType,
              });
              const role = incomingRole(other);
              if (!role) continue;
              relevant.push(role);
              // Preserve this collection's verified physical-tree provenance
              // if the real contact callback subsequently releases its joint.
              collectedIncoming.set(other, role);
            }
            const before = quietSnapshot(piece);
            const value = originalPrepare.call(this, rows);
            if (relevant.length)
              prelude.push({
                tick: f.getTicks() + 1,
                rows: relevant.length,
                incoming: relevant,
                before,
                after: quietSnapshot(piece),
              });
            return value;
          };
          sim.hierarchyQuiet.wake = function (body, ...args) {
            const before = quietSnapshot(piece);
            const value = originalWake.call(this, body, ...args);
            const after = quietSnapshot(piece);
            if (before?.doNothing && after?.doNothing === false)
              wakeDiagnostics.push({
                tick: f.getTicks() + 1,
                requestedActor: actorName(body),
                before,
                after,
                stack: new Error("Observed actual hierarchy wake").stack,
              });
            return value;
          };
          // Observe the real production wheel-load reaction. The callback is
          // supplied afresh by oilGround and receives the actual hit/impulse;
          // forwarding it unchanged preserves its wake and impulse ordering.
          sim.oilGround = function (car) {
            const ground = originalGround.call(this, car);
            if (car !== owner || !ground.springReaction) return ground;
            const originalReaction = ground.springReaction;
            ground.springReaction = function (hit, impulse) {
              if (hit.body !== piece)
                return originalReaction.call(this, hit, impulse);
              const before = quietSnapshot(piece);
              const velocityBefore = piece.state.velocity.clone();
              const omegaBefore = piece.state.angularVelocity.clone();
              const impulseVector = impulse.toArray();
              const impulseMagnitude = impulse.length();
              const value = originalReaction.call(this, hit, impulse);
              springReactions.push({
                tick: f.getTicks() + 1,
                point: hit.point?.toArray() ?? null,
                impulse: impulseVector,
                impulseMagnitude,
                before,
                after: quietSnapshot(piece),
                velocityBefore: velocityBefore.toArray(),
                velocityAfter: piece.state.velocity.toArray(),
                velocityDelta: piece.state.velocity.distanceTo(velocityBefore),
                omegaDelta: piece.state.angularVelocity.distanceTo(omegaBefore),
              });
              return value;
            };
            return ground;
          };
          const geometryWakeObserved = () =>
            prelude.some(
              (s) => s.before?.doNothing && s.after?.doNothing === false,
            );
          const geometryImpulseObserved = () =>
            impacts.some(
              (row) =>
                row.solverAccepted &&
                row.sourceType !== 9 &&
                row.normalImpulse > 1e-6,
            );
          const springWakeObserved = () =>
            springReactions.some(
              (s) =>
                s.before?.doNothing &&
                s.after?.doNothing === false &&
                s.impulseMagnitude > 1e-6 &&
                s.velocityDelta > 1e-10,
            );
          const coveredRoute = () =>
            (geometryWakeObserved() && geometryImpulseObserved()) ||
            (f.result.name === "EAGLE3" && springWakeObserved());
          const start = piece.state.position.clone();
          try {
            owner.input.throttle = 0.25;
            for (let i = 0; i < 6; i++) {
              collectedIncoming.clear();
              tick("impact");
              for (const impact of sim.lastImpacts) {
                const other = otherEndpoint(impact);
                const role =
                  incomingRole(other) ?? collectedIncoming.get(other);
                if (role)
                  impacts.push({
                    tick: f.getTicks(),
                    incoming: role,
                    normalImpulse: impact.normalImpulse,
                    sourceType: impact.sourceType,
                    solverAccepted: impact.solverAccepted,
                  });
              }
              if (coveredRoute() && piece.state.velocity.lengthSq() > 1e-10)
                break;
            }
          } finally {
            sim.preparePedContacts = originalPrepare;
            sim.oilGround = originalGround;
            sim.hierarchyQuiet.wake = originalWake;
            owner.input.throttle = 0;
          }
          result.wake = {
            prelude,
            impacts,
            springReactions,
            contactPairs,
            wakeDiagnostics,
            incomingScope:
              "Owner root or body connected by live physical joint ancestry at collection; shared repair ownership alone does not qualify",
            requiredRoute:
              f.result.name === "EAGLE3"
                ? "Geometry contact or actual native wheel spring reaction"
                : "Geometry contact: pre-lambda wake and accepted positive normal impulse",
            coveredRoutes: [
              ...(geometryWakeObserved() && geometryImpulseObserved()
                ? ["geometry-body-contact"]
                : []),
              ...(springWakeObserved() ? ["native-wheel-spring-reaction"] : []),
            ],
            quiet: quietSnapshot(piece),
            velocity: piece.state.velocity.toArray(),
            moved: piece.state.position.distanceTo(start),
          };
          if (f.result.name === "EAGLE3") {
            if (!coveredRoute())
              result.unmet.push(
                "owner approach demonstrated neither geometry wake/normal impulse nor actual wheel spring wake/impulse on the sleeping Eagle part",
              );
          } else {
            if (!geometryWakeObserved())
              result.unmet.push(
                "real geometry did not demonstrate quiet wake before solver",
              );
            if (!geometryImpulseObserved())
              result.unmet.push(
                "owner approach produced no accepted positive normal impulse on sleeping original Cerby part",
              );
          }
          if (
            !result.wake.quiet?.wakeTransitions ||
            piece.state.velocity.lengthSq() <= 1e-10
          )
            result.unmet.push(
              "impact did not produce actual wake and part momentum",
            );
        }
      } else
        result.unmet.push(
          "impact wake unexercised because bounded natural settle did not sleep",
        );
      if (
        result.wake?.quiet?.doNothing === false &&
        result.wake.quiet.wakeTransitions > 0
      ) {
        result.postImpactWork = tick("post-impact");
        result.postImpactWork.quiet = quietSnapshot(piece);
        if (
          result.postImpactWork.freeQuietBefore !== false ||
          result.postImpactWork.freeBodyForceCalls < 1
        )
          result.unmet.push(
            "woken original free part did not re-enter force work on the next physical step",
          );
      } else
        result.unmet.push(
          "post-impact force work unexercised because actual wake was not observed",
        );
      const geometryPreserved = sourceGeometry.every(
        (e) => e.node.geometry === e.geometry && e.node.material === e.material,
      );
      // Repair is required even if natural settling is unmet; do not mask stale
      // ownership with a forced quiet transition or by dropping physical rows.
      sim.repair(owner);
      owner.input.throttle = owner.input.steer = 0;
      owner.input.brake = false;
      owner.state.velocity.set(0, 0, 0);
      sim.reset(owner);
      tick("repair");
      tick("repair");
      result.repair = {
        freePhase: freePart.state.phase,
        attachedPhase: attachedPart.state.phase,
        freeOriginalParent: freePart.actor.parent === freePart.originalParent,
        attachedOriginalParent:
          attachedPart.actor.parent === attachedPart.originalParent,
        ownedBodies: sim.debris.filter((b) => b.owner === owner).length,
        freeHeader: !!sim.phil.getHeader(piece),
        attachedHeader: !!sim.phil.getHeader(attached),
        freeProvider: !!sim.hierarchyQuiet.get(piece),
        attachedProvider: !!sim.hierarchyQuiet.get(attached),
        grounded: owner.state.groundedWheelCount,
        components: [...owner.damage.componentLevels],
        geometryPreserved,
        census: sim.quietCensus(),
        ticks: f.getTicks(),
      };
      const r = result.repair;
      if (
        r.freePhase !== 0 ||
        r.attachedPhase !== 0 ||
        !r.freeOriginalParent ||
        !r.attachedOriginalParent ||
        r.ownedBodies ||
        r.freeHeader ||
        r.attachedHeader ||
        r.freeProvider ||
        r.attachedProvider
      )
        result.unmet.push(
          "repair retained original part physical/provider ownership",
        );
      if (!r.grounded || r.components.some((v) => v !== 0))
        result.unmet.push("repair failed reground/damage reset");
      result.work = f.workSnapshot();
      f.restoreWork();
      return result;
    });
    settle.ending = ending;
    report.unmet.push(
      ...[...settle.unmet, ...ending.unmet].map(
        (message) => `${car.name}: ${message}`,
      ),
    );
    await page.screenshot({
      path: `artifacts/browser-hierarchy-quiet-${car.name.toLowerCase()}-repair.png`,
    });
  }
  // Independent split startup regression. The plane/near-rest creation seam
  // is controlled; this is not evidence of native SPAM/contact admission.
  const splitCar = catalog.cars.find((car) => car.name === "EAGLE3");
  await page.evaluate(
    async ({ track, car }) => {
      document.querySelector("#track-select").value = track;
      document.querySelector("#car-select").value = car;
      await window.carma.loadRace();
      window.carma.paused = true;
      document.querySelector("#panel").hidden = true;
    },
    { track: catalog.track, car: splitCar.path },
  );
  await page.waitForFunction(
    () =>
      window.carma.stats.ready &&
      window.carma.opponentsReady &&
      window.carma.paused,
    null,
    { timeout: 90000 },
  );
  report.splitStartup = await page.evaluate(() => {
    const sim = window.carma.simulation,
      owner = window.carma.player;
    const V = owner.state.position.constructor;
    const require = (value, message) => {
      if (!value) throw new Error(message);
    };
    const result = {
      car: "EAGLE3",
      fixture:
        "Controlled original-car split plane and near-rest creation seam, maximum3 full40ms steps; not native SPAM admission evidence",
      startupBridge:
        "Explicit browser deviation: new private secondary uses parent's actual gravity hint for creation-phase quiet evaluation without applying another force or initial velocity kick; next free-force step supplies its own packet. Native split pools initially contain zero-G and subsequently retain packets.",
      unmet: [],
      ticks: 0,
    };
    window.__hierarchySplitStartup = result;
    const check = (value, message) => {
      if (!value) result.unmet.push(message);
    };
    const finite = (body) =>
      [
        ...body.state.position.toArray(),
        ...body.state.orientation.toArray(),
        ...body.state.velocity.toArray(),
        ...body.state.angularVelocity.toArray(),
      ].every(Number.isFinite);
    let child;
    const tick = () => {
      require(result.ticks <
        3, "split startup fixture exceeded3 physical steps");
      sim.step();
      result.ticks++;
      require(finite(owner) &&
        (!child || finite(child)), "nonfinite split startup state");
    };
    for (const car of sim.cars) {
      sim.setCarPhysicsActive(car, car === owner);
      car.input.throttle = car.input.steer = 0;
      car.input.brake = false;
    }
    require(owner.protection ===
      1, "controlled original split requires ordinary unprotected car");
    sim.rematerializePose(
      owner,
      owner.state.position.clone().add(new V(0, 3, 0)),
      owner.state.orientation.clone(),
      new V(),
    );
    tick();
    const gravityHint = sim.hierarchyQuiet.get(owner)?.gravityIncrement.clone();
    require(gravityHint &&
      gravityHint.y < 0 &&
      gravityHint
        .toArray()
        .every(
          Number.isFinite,
        ), "first real airborne force step did not supply actual nonzero parent gravity packet");
    result.firstAirborneStep = {
      position: owner.state.position.toArray(),
      velocity: owner.state.velocity.toArray(),
      grounded: owner.state.groundedWheelCount,
      gravityHint: gravityHint.toArray(),
    };
    check(
      owner.state.groundedWheelCount === 0,
      "raised original car unexpectedly retains ground support",
    );
    // Capture OLD V only after the controlled near-rest reset. Reusing the
    // first falling tick's OLD V could qualify genuine gravity-response quiet.
    owner.state.velocity.set(0, 0, 0);
    owner.state.angularVelocity.set(0, 0, 0);
    sim.retainHierarchyQuiet();
    sim.quietGravity.set(owner, gravityHint.clone());
    sim.hierarchyQuiet.prepare(owner, gravityHint);
    const pristine = {
      mass: owner.properties.mass,
      inertia: owner.properties.inertia.clone(),
      com: owner.properties.centerOfMass.clone(),
    };
    const plane = owner.damage.prepareSplitPlane(new V(0, 0, 1), 0);
    require(plane, "original Eagle geometry refused controlled center split plane");
    child = sim.performSplit(owner, plane);
    require(child &&
      owner.damage
        .splitRuntime, "production split did not create original physical secondary");
    const partition = owner.damage.splitRuntime;
    const expected = {
      mass: partition.negative.mass,
      inertia: partition.negative.inertia.clone(),
      com: partition.negative.centerOfMass.clone(),
    };
    const creationPosition = child.state.position.clone();
    sim.retainHierarchyQuiet();
    sim.hierarchyQuiet.prepareNewHierarchy(
      sim.allBodies(),
      sim.quietJoints(),
      (body) =>
        sim.quietGravity.get(body) ??
        sim.hierarchyQuiet.get(body)?.gravityIncrement ??
        new V(),
    );
    const state = sim.hierarchyQuiet.get(child);
    require(state, "split secondary missing hierarchy quiet provider");
    result.beforeFinish = {
      gravityHint: state.gravityIncrement.toArray(),
      velocity: child.state.velocity.toArray(),
      beforeWorldV: state.beforeWorldV.toArray(),
      mass: child.properties.mass,
      inertia: child.properties.inertia.toArray(),
      com: child.properties.centerOfMass.toArray(),
    };
    check(
      state.gravityIncrement.y < 0 &&
        state.gravityIncrement.distanceTo(gravityHint) < 1e-8,
      "secondary creation phase lost actual parent gravity hint",
    );
    check(
      child.state.velocity.lengthSq() === 0 &&
        state.beforeWorldV.lengthSq() === 0,
      "split startup added a velocity kick or captured pre-reset OLD V",
    );
    sim.finishHierarchyQuiet();
    result.afterFinish = {
      doNothing: state.doNothing,
      gate: state.lastResult?.gate,
      quietEligible: state.lastResult?.quietEligible,
      unorderedGravity: state.lastResult?.gravityComparisonUnordered,
      velocity: child.state.velocity.toArray(),
      inertiaScale: state.inertiaScale,
    };
    check(
      state.doNothing === false &&
        !child.properties.immovable &&
        state.lastResult?.gate === "gravity-response" &&
        state.lastResult?.quietEligible === false &&
        state.lastResult?.gravityComparisonUnordered === false,
      "airborne near-rest secondary incorrectly entered zero-G quiet",
    );
    check(
      child.state.velocity.lengthSq() === 0,
      "quiet startup bridge applied a physical velocity kick",
    );
    const weightedCom = owner.properties.centerOfMass
      .clone()
      .multiplyScalar(owner.properties.mass)
      .addScaledVector(child.properties.centerOfMass, child.properties.mass)
      .divideScalar(pristine.mass);
    const reconstructedInertia = owner.properties.inertia
      .clone()
      .add(child.properties.inertia);
    for (const body of [owner, child]) {
      const d = body.properties.centerOfMass.clone().sub(pristine.com);
      reconstructedInertia.add(
        new V(
          body.properties.mass * (d.y * d.y + d.z * d.z),
          body.properties.mass * (d.x * d.x + d.z * d.z),
          body.properties.mass * (d.x * d.x + d.y * d.y),
        ),
      );
    }
    result.partition = {
      massBefore: pristine.mass,
      massSum: owner.properties.mass + child.properties.mass,
      parentMatches:
        Math.abs(owner.properties.mass - partition.positive.mass) < 1e-9 &&
        owner.properties.inertia.distanceTo(partition.positive.inertia) < 1e-8,
      childMatches:
        Math.abs(child.properties.mass - expected.mass) < 1e-9 &&
        child.properties.inertia.distanceTo(expected.inertia) < 1e-8 &&
        child.properties.centerOfMass.distanceTo(expected.com) < 1e-8,
      comError: weightedCom.distanceTo(pristine.com),
      inertiaError: reconstructedInertia.distanceTo(pristine.inertia),
    };
    check(
      Math.abs(result.partition.massSum - pristine.mass) < 1e-9 &&
        result.partition.parentMatches &&
        result.partition.childMatches &&
        result.partition.comError < 1e-8 &&
        result.partition.inertiaError < 1e-8,
      "split startup changed original partition mass/COM/physical moments",
    );
    tick();
    result.firstSecondaryForceStep = {
      position: child.state.position.toArray(),
      velocity: child.state.velocity.toArray(),
      fall: creationPosition.y - child.state.position.y,
      doNothing: sim.hierarchyQuiet.get(child)?.doNothing,
      gravityHint: sim.hierarchyQuiet.get(child)?.gravityIncrement.toArray(),
      inertiaScale: sim.hierarchyQuiet.get(child)?.inertiaScale,
    };
    check(
      child.state.position.y < creationPosition.y - 0.0005 &&
        child.state.velocity.y < -0.03 &&
        sim.hierarchyQuiet.get(child)?.doNothing === false,
      "new original airborne secondary hung instead of falling on its first force step",
    );
    check(
      Math.abs(child.properties.mass - expected.mass) < 1e-9 &&
        child.properties.inertia.distanceTo(expected.inertia) < 1e-8 &&
        sim.hierarchyQuiet.get(child)?.inertiaScale === 1,
      "first secondary force step corrupted physical mass/moments",
    );
    sim.repair(owner);
    tick();
    result.repair = {
      snapped: owner.damage.snapped,
      splitRuntime: !!owner.damage.splitRuntime,
      ownedBodies: sim.debris.filter((body) => body.owner === owner).length,
      childHeader: !!sim.phil.getHeader(child),
      childProvider: !!sim.hierarchyQuiet.get(child),
      mass: owner.properties.mass,
      inertia: owner.properties.inertia.toArray(),
    };
    check(
      !result.repair.snapped &&
        !result.repair.splitRuntime &&
        !result.repair.ownedBodies &&
        !result.repair.childHeader &&
        !result.repair.childProvider &&
        Math.abs(owner.properties.mass - pristine.mass) < 1e-9,
      "split repair retained secondary physics/provider or changed original mass",
    );
    return result;
  });
  report.unmet.push(
    ...report.splitStartup.unmet.map(
      (message) => `EAGLE3 split startup: ${message}`,
    ),
  );
  await page.screenshot({
    path: "artifacts/browser-hierarchy-quiet-eagle3-split-startup-repair.png",
  });
  report.gl = await page.evaluate(() => {
    const gl = document.querySelector("#view").getContext("webgl2"),
      ext = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      error: gl.getError(),
      renderer: ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
      size: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    };
  });
  report.coverageComplete = report.unmet.length === 0;
  await writeFile(
    "artifacts/browser-hierarchy-quiet.json",
    JSON.stringify(report, null, 2),
  );
  assert.equal(report.gl.error, 0);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  assert.deepEqual(
    report.unmet,
    [],
    "bounded hierarchy quiet coverage unmet; see artifacts/browser-hierarchy-quiet.json",
  );
  console.log(
    `PASS hierarchy quiet original browser cases: ${report.cases.length}; artifacts/browser-hierarchy-quiet.json`,
  );
} catch (error) {
  report.failure = String(error);
  if (page && !page.isClosed()) {
    report.failureState = await page
      .evaluate(() => {
        const f = window.__hierarchyQuiet;
        const snapshot = {
          result: f?.result,
          ticks: f?.getTicks?.(),
          work: f?.workSnapshot?.(),
          splitStartup: window.__hierarchySplitStartup,
          census: window.carma?.simulation?.quietCensus?.(),
        };
        f?.restoreWork?.();
        return snapshot;
      })
      .catch((e) => ({ captureError: String(e) }));
    await page
      .screenshot({ path: "artifacts/browser-hierarchy-quiet-failure.png" })
      .catch(() => {});
  }
  await writeFile(
    "artifacts/browser-hierarchy-quiet-failure.json",
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
