/** Read-only stock damage robustness sweep: six regional impact directions per
 * car, physical hull synchronization, and full repair. Detailed numerical
 * conformance remains in tests/ and tools/crash-report.mjs. */
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { Group, Vector3 } from "three";
import { originalCar } from "../tests/support/original-car.mjs";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
let files;
try {
  files = await readdir("carma2_orig/data/CARS");
} catch (error) {
  if (error.code === "ENOENT") {
    console.log("SKIP: original stock car archives absent");
    process.exit(0);
  }
  throw error;
}
const names = files.filter((n) => /\.twt$/i.test(n)).map((n) => n.slice(0, -4));
const failures = [],
  bent = [];
let cases = 0;
for (const name of names)
  for (const side of [-1, 1])
    for (const direction of [
      [0, 0, -side],
      [0.5, 0.15, -side],
      [1, 0, -side],
    ]) {
      const original = await originalCar(name),
        damage = new DamageSystem(
          original.assets,
          original.group,
          original.text,
        );
      await damage.init();
      damage.damageContext.random = () => 0;
      const car = createSimulatedCar(
          original.group,
          original.text,
          damage,
          new Vector3(0, 3, 0),
          0,
          true,
        ),
        sim = new VehicleSimulation(
          { raycast: () => null, querySurfaces: () => [] },
          new Group(),
        );
      sim.scene.add(car.group);
      sim.add(car);
      const points = car.shapeVertices.flat(),
        xs = points.map((p) => p.x),
        zs = points.map((p) => p.z);
      const point = new Vector3(
          Math.min(...xs) * 0.4,
          0.1,
          (side < 0 ? Math.min(...zs) : Math.max(...zs)) * 0.8,
        ),
        force = new Vector3(...direction).normalize().multiplyScalar(5);
      try {
        damage.applyImpact([point], force, false, true, 10000, force);
        if (damage.structuralBend) bent.push({ name, side, direction });
        sim.step();
        sim.repair(car);
        sim.step();
      } catch (e) {
        failures.push({
          name,
          side,
          direction,
          error: String(e),
          bent: !!damage.structuralBend,
        });
      }
      cases++;
      sim.dispose();
    }
const report = { cars: names.length, cases, bent: bent.length, failures };
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/car-damage-audit.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
if (failures.length) process.exitCode = 1;
