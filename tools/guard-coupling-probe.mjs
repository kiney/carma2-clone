/** Bounded PHY-12 diagnostics on locally supplied original cars. Never bundled. */
import { Vector3, Quaternion } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import {
  BodyTrajectoryGuard,
  guardPairTrajectory,
} from "../src/physics/pair-guard.ts";
import { hullPenetration, transformHull } from "../src/physics/geometry.ts";

export async function inspectGuardCoupling() {
  const c = window.carma;
  if (!c?.stats.ready || !c.paused)
    throw new Error("Load and pause a race first");
  const { BodyTrajectoryGuard: LegacyGuard } = await import(
    /* @vite-ignore */ "/artifacts/phy12-reference/src/physics/pair-guard.ts"
  );
  const V = (...v) => new Vector3(...v),
    Q = () => new Quaternion();
  const minY = Math.min(
    ...c.player.hulls.flatMap((h) => h.vertices.map((v) => v.y)),
  );
  const car = {
    ...c.player,
    state: { ...c.player.state, position: V(0, 10, 0), orientation: Q() },
  };
  const box = (position, immovable = false) => ({
    hulls: [buildBoxHull(V(-0.05, -0.05, -0.05), V(0.05, 0.05, 0.05))],
    properties: { mass: 1, inertia: V(1, 1, 1), centerOfMass: V(), immovable },
    state: { position, orientation: Q(), velocity: V(), angularVelocity: V() },
  });
  const prop = box(V(0, 10 + minY - 0.1, 0)),
    obstacle = box(prop.state.position.clone().add(V(0.075, 0, 0)), true);
  const path = (body, delta) => {
    const result = (t) => ({
      position: body.state.position.clone().addScaledVector(delta, t),
      orientation: body.state.orientation.clone(),
    });
    result.stable = true;
    if (body.properties.immovable) result.constantPose = result(0);
    return result;
  };
  const paths = new Map([
    [car, path(car, V(-0.1, 0, 0))],
    [prop, path(prop, V(0.1, 0, 0))],
    [obstacle, path(obstacle, V())],
  ]);
  const bodies = [...paths.keys()],
    original = new LegacyGuard(),
    current = new BodyTrajectoryGuard();
  const sample = (guard) => {
    const start = performance.now(),
      diagnostics = {};
    const fractions = guard.run(bodies, paths, undefined, diagnostics);
    return {
      ms: performance.now() - start,
      car: fractions.get(car),
      prop: fractions.get(prop),
      obstacle: fractions.get(obstacle),
      diagnostics,
    };
  };
  const independent = guardPairTrajectory(
    car,
    prop,
    paths.get(car),
    paths.get(prop),
  );
  const samples = [
    sample(original),
    sample(current),
    sample(current),
    sample(original),
  ];
  if (
    independent !== 1 ||
    samples[1].car !== 1 ||
    samples[2].car !== 1 ||
    !(samples[0].car < 0.001)
  )
    throw new Error("Original-car separated-prop regression failed");
  const at = (body, fraction) =>
    body.hulls.map((h) => {
      const p = paths.get(body)(fraction);
      return transformHull(h, p.position, p.orientation);
    });
  const depth = (a, b, fa, fb) =>
    Math.max(
      0,
      ...at(a, fa).flatMap((ha) =>
        at(b, fb).map((hb) => hullPenetration(ha, hb)),
      ),
    );
  const final = current.run(bodies, paths);
  if (depth(car, prop, final.get(car), final.get(prop)) !== 0)
    throw new Error("Clear car acquired contact");
  return {
    car: c.player.group.name,
    hulls: car.hulls.length,
    damageRevision: c.player.damage.deformationRevision,
    independent,
    clearance: 0.05,
    requestedMovement: 0.1,
    samples,
    legacyMovement: 0.1 * samples[0].car,
    currentMovement: 0.1 * samples[1].car,
    glError: c.renderer.getContext().getError(),
    note: "Original live car geometry, generated props, isolated real guard evaluation; no simulation or game state edits. ABBA inclusive CPU samples, not an FPS benchmark.",
  };
}
