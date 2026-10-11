import { Vector3 } from "three";

const f = Math.fround;
const ANGLE_TO_RADIANS = 9.587379924285257e-5;
const RADIANS_TO_ANGLE = 10430.378350470453;
const MODEL_PER_METRIC = f(1 / 6.9);
export type NativeGroundRay = (
  origin: Vector3,
  direction: Vector3,
) => {
  /** Native world-ray miss sentinel is100, not1. */
  fraction: number;
  normal: Vector3;
};

function store(v: Vector3): Vector3 {
  const result = new Vector3(f(v.x), f(v.y), f(v.z));
  if (!result.toArray().every(Number.isFinite))
    throw new Error("Invalid native rematerialization ground vector");
  return result;
}
function trig(angle: number) {
  const radians = (angle & 0xffff) * ANGLE_TO_RADIANS;
  return { s: f(Math.sin(radians)), c: f(Math.cos(radians)) };
}
function mix(a: Vector3, x: number, b: Vector3, y: number): Vector3 {
  return store(
    new Vector3(a.x * x + b.x * y, a.y * x + b.y * y, a.z * x + b.z * y),
  );
}
function asinAngle(dot: number, sign = 1): number {
  const angle =
    Math.atan2(dot, Math.sqrt((1 + dot) * (1 - dot))) * RADIANS_TO_ANGLE * sign;
  // Installed ftol575190 returns low32=0 for masked invalid conversion.
  return Number.isFinite(angle) ? Math.trunc(angle) : 0;
}

/** Installed4a8623–8884 ground alignment for one placement attempt. The ray
 * callback consumes MODEL coordinates after the native metric wrapper's
 * extra Float32 conversion. No occupancy test or physics activation is implied.
 */
export function alignNativeRematerializationGround(
  modelPosition: Vector3,
  savedRow2: Vector3,
  ray: NativeGroundRay,
) {
  const position = store(store(modelPosition).multiplyScalar(6.9));
  const row = store(savedRow2);
  const yaw = 0x3ffc - Math.trunc(Math.atan2(row.z, row.x) * RADIANS_TO_ANGLE);
  const { s, c } = trig(yaw);
  let row0 = new Vector3(c, 0, -s);
  let row1 = new Vector3(0, 1, 0);
  let row2 = new Vector3(s, 0, c);
  let queries = 0;
  const query = (metricOrigin: Vector3, metricDirection: Vector3) => {
    queries++;
    const result = ray(
      store(store(metricOrigin).multiplyScalar(MODEL_PER_METRIC)),
      store(store(metricDirection).multiplyScalar(MODEL_PER_METRIC)),
    );
    const fraction = f(result.fraction);
    if (!Number.isFinite(fraction))
      throw new Error("Invalid native rematerialization ground fraction");
    return { fraction, normal: store(result.normal) };
  };
  const first = query(
    new Vector3(position.x, f(position.y + 1), position.z),
    new Vector3(0, -100, 0),
  );
  let second = query(
    new Vector3(position.x, f(position.y + 100), position.z),
    new Vector3(0, -100, 0),
  );
  if (second.fraction <= 1) {
    const origin = new Vector3(
      position.x,
      f(f(position.y - 100) + 5),
      position.z,
    );
    const direction = new Vector3(0, f(-5.01), 0);
    let count = 0;
    do {
      second = query(origin, direction);
      if (second.fraction <= 1) break;
      count++;
    } while (count < 20);
    count++;
    second = {
      ...second,
      fraction: f(count * f(0.05) - second.fraction * f(0.05)),
    };
  }
  const useSecond = second.fraction < first.fraction;
  const fraction = useSecond ? -second.fraction : first.fraction;
  const normal = useSecond ? second.normal : first.normal;
  const aligned = Math.abs(fraction) <= 1;
  if (aligned) {
    position.y = f(position.y - (fraction * 100 - 2));
    const pitch = asinAngle(
      row2.x * normal.x + row2.z * normal.z + row2.y * normal.y,
    );
    const px = trig(pitch);
    const old1 = row1,
      old2 = row2;
    row1 = mix(old1, px.c, old2, px.s);
    row2 = mix(old1, -px.s, old2, px.c);
    const roll = asinAngle(
      row0.z * normal.z + row0.y * normal.y + row0.x * normal.x,
      -1,
    );
    const pz = trig(roll);
    const old0 = row0;
    row0 = mix(old0, pz.c, row1, pz.s);
    row1 = mix(old0, -pz.s, row1, pz.c);
  }
  return {
    position: store(position.multiplyScalar(1 / 6.9)),
    row0,
    row1,
    row2,
    yaw: yaw & 0xffff,
    fraction,
    aligned,
    queries,
  };
}
