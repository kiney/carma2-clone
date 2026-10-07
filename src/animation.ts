import * as THREE from "three";

export interface AnimationInput {
  speed: number;
  steer: number;
  brake: boolean;
  throttle: number;
}
type Axis = "x" | "y" | "z";
type Mode =
  | "continuous"
  | "linear"
  | "harmonic"
  | "flash"
  | "controlled"
  | "absolute";
interface Groove {
  actor: string;
  nature: string;
  animation: "spin" | "rock";
  mode: Mode;
  value: number;
  pivot: THREE.Vector3;
  axis: Axis;
  amplitude: number;
}
interface Frame {
  texture: string;
  columns: number;
  column: number;
  rows: number;
  row: number;
}
interface Funk {
  material: string;
  matrix: "none" | "roll" | "slither" | "spin";
  mode: Mode;
  rates: [number, number];
  amounts: [number, number];
  frameMode: "none" | "continuous" | "texturebits";
  bits: string;
  rate: number;
  frames: Frame[];
}
const TAU = Math.PI * 2;
const nameKey = (name: string) =>
  name.replace(/\.(act|dat|mat|pix)$/i, "").toLowerCase();
const cleaned = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter(Boolean);

function sections(text: string, kind: "FUNK" | "GROOVE"): string[][] {
  if (text.length > 4_000_000)
    throw new Error("Animation config exceeds size limit");
  const lines = cleaned(text),
    start = lines.findIndex((line) => line === `START OF ${kind}`);
  if (start < 0) return [];
  const end = lines.findIndex(
    (line, i) => i > start && line === `END OF ${kind}`,
  );
  if (end < 0) throw new Error(`Missing END OF ${kind}`);
  const out: string[][] = [[]];
  for (const line of lines.slice(start + 1, end)) {
    if (line === `NEXT ${kind}`) {
      if (out.length >= 512) throw new Error("Too many animation entries");
      out.push([]);
    } else out.at(-1)!.push(line);
  }
  return out.filter((block) => block.length);
}
class ConfigReader {
  at = 0;
  constructor(readonly lines: string[]) {}
  string() {
    const value = this.lines[this.at++];
    if (value === undefined) throw new Error("Truncated animation entry");
    return value;
  }
  number() {
    const n = Number(this.string());
    if (!Number.isFinite(n) || Math.abs(n) > 1_000_000)
      throw new Error("Invalid animation number");
    return n;
  }
  vector(n: number) {
    const values = this.string()
      .split(/[\s,]+/)
      .map(Number);
    if (
      values.length !== n ||
      values.some((v) => !Number.isFinite(v) || Math.abs(v) > 1_000_000)
    )
      throw new Error("Invalid animation vector");
    return values;
  }
  mode(): Mode {
    const mode = this.string().toLowerCase();
    if (
      ![
        "continuous",
        "linear",
        "harmonic",
        "flash",
        "controlled",
        "absolute",
      ].includes(mode)
    )
      throw new Error(`Unsupported movement mode ${mode}`);
    return mode as Mode;
  }
  end() {
    if (this.at !== this.lines.length)
      throw new Error("Unsupported trailing animation fields");
  }
}
function parseGroove(lines: string[]): Groove {
  const r = new ConfigReader(lines),
    actor = r.string();
  if (r.string().toLowerCase() !== "not a lollipop")
    throw new Error("Lollipop billboarding is unsupported");
  const nature = r.string().toLowerCase();
  if (!["constant", "distance"].includes(nature))
    throw new Error(`Unsupported groove nature ${nature}`);
  const path = r.string().toLowerCase();
  if (path === "straight") {
    const mode = r.mode();
    r.vector(3);
    r.number();
    r.vector(3);
    if (!["absolute", "controlled"].includes(mode))
      throw new Error("Only car-controlled straight paths are supported");
    // Suspension bindings are parsed but remain at their original positions.
  } else if (!["no path", "none"].includes(path))
    throw new Error(`Unsupported groove path ${path}`);
  const animation = r.string().toLowerCase();
  if (animation !== "spin" && animation !== "rock")
    throw new Error(`Unsupported object animation ${animation}`);
  const mode = r.mode(),
    value = r.number(),
    pivot = new THREE.Vector3(...r.vector(3)),
    axis = r.string().toLowerCase();
  if (!["x", "y", "z"].includes(axis))
    throw new Error("Invalid animation axis");
  const amplitude = animation === "rock" ? r.number() : 360;
  r.end();
  return {
    actor,
    nature,
    animation,
    mode,
    value,
    pivot,
    axis: axis as Axis,
    amplitude,
  };
}
function parseFunk(lines: string[]): Funk {
  const r = new ConfigReader(lines),
    material = r.string().split(/[\s,]+/)[0],
    nature = r.string().toLowerCase();
  if (!["constant", "distance"].includes(nature))
    throw new Error(`Unsupported funk nature ${nature}`);
  const type = r.string().toLowerCase();
  let matrix: Funk["matrix"] = "none",
    mode: Mode = "continuous";
  let rates: [number, number] = [0, 0],
    amounts: [number, number] = [1, 1];
  if (["roll", "slither", "spin"].includes(type)) {
    matrix = type as Funk["matrix"];
    mode = r.mode();
    if (mode === "controlled" || mode === "absolute")
      throw new Error("Bound texture matrices are unsupported");
    if (matrix === "spin") rates = [r.number(), 0];
    else rates = r.vector(2) as [number, number];
    if (matrix === "slither")
      amounts = r.vector(2).map((n) => n / 100) as [number, number];
  } else if (!["piss off", "none"].includes(type))
    throw new Error(`Unsupported texture matrix ${type}`);
  const lighting = r.string().toLowerCase();
  if (!/^no .*lighting/.test(lighting) && lighting !== "none")
    throw new Error(`Unsupported material lighting ${lighting}`);
  const animation = r.string().toLowerCase();
  let frameMode: Funk["frameMode"] = "none",
    bits = "",
    rate = 0;
  const frames: Frame[] = [];
  if (animation === "frames") {
    const timing = r.string().toLowerCase();
    if (!["accurate", "approximate"].includes(timing))
      throw new Error("Unsupported frame timing");
    const frameType = r.string().toLowerCase();
    if (frameType === "texturebits") {
      frameMode = "texturebits";
      bits = r.string().toUpperCase();
      if (!/^[BV]{1,8}$/.test(bits))
        throw new Error(`Unsupported texture bits ${bits}`);
    } else if (frameType === "continuous") {
      frameMode = "continuous";
      rate = r.number();
    } else throw new Error(`Unsupported frame mode ${frameType}`);
    const count = r.number();
    if (!Number.isInteger(count) || count < 1 || count > 256)
      throw new Error("Invalid frame count");
    for (let i = 0; i < count; i++) {
      const values = r.string().split(/[\s,]+/),
        texture = values[0];
      let columns = 1,
        column = 0,
        rows = 1,
        row = 0;
      if (values.length === 5)
        [columns, column, rows, row] = values.slice(1).map(Number);
      else if (values.length !== 1) throw new Error("Invalid atlas frame");
      if (
        ![columns, column, rows, row].every(Number.isInteger) ||
        columns < 1 ||
        rows < 1 ||
        columns > 4096 ||
        rows > 4096 ||
        column < 0 ||
        column >= columns ||
        row < 0 ||
        row >= rows
      )
        throw new Error("Atlas frame exceeds dimensions");
      frames.push({ texture, columns, column, rows, row });
    }
    if (frameMode === "texturebits" && 2 ** bits.length > frames.length)
      throw new Error("Texture bits require more frames");
  } else if (!/^no .*animation/.test(animation) && animation !== "none")
    throw new Error(`Unsupported texture animation ${animation}`);
  r.end();
  return {
    material,
    matrix,
    mode,
    rates,
    amounts,
    frameMode,
    bits,
    rate,
    frames,
  };
}
function wave(mode: Mode, time: number, rate: number, amount = 1) {
  const phase = (((time * rate) % 1) + 1) % 1;
  if (mode === "harmonic") return Math.sin(phase * TAU) * amount;
  if (mode === "linear")
    return (phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4) * amount;
  if (mode === "flash") return (phase < 0.5 ? -1 : 1) * amount;
  return phase * amount;
}
interface CarBindings {
  steering: Set<number>;
  driven: Set<number>;
  rolling: Set<number>;
  drivenDiameter: number;
  rollingDiameter: number;
}
function carBindings(text: string): CarBindings {
  const lines = cleaned(text),
    start = lines.indexOf("START OF FUNK"),
    prefix = lines.slice(0, start < 0 ? 0 : start);
  const numbers = (line: string) =>
    line
      .split(",")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0);
  const result: CarBindings = {
    steering: new Set(),
    driven: new Set(),
    rolling: new Set(),
    drivenDiameter: 0.14,
    rollingDiameter: 0.14,
  };
  // These eight trailing values precede FUNK in stock C2 car files.
  if (prefix.length >= 9) {
    const driven = Number(prefix.at(-2)),
      rolling = Number(prefix.at(-1));
    if (driven > 0 && driven < 10 && rolling > 0 && rolling < 10) {
      result.drivenDiameter = driven;
      result.rollingDiameter = rolling;
      result.driven = new Set(numbers(prefix.at(-4)!));
      result.rolling = new Set(numbers(prefix.at(-3)!));
      for (let count = 0; count <= 8; count++) {
        const at = prefix.length - 9 - count;
        if (at >= 0 && Number(prefix[at]) === count) {
          const refs = prefix.slice(at + 1, at + 1 + count).map(Number);
          if (refs.every((n) => Number.isInteger(n) && n >= 0)) {
            result.steering = new Set(refs);
            break;
          }
        }
      }
    }
  }
  return result;
}
interface ActorBinding {
  groove: Groove;
  object: THREE.Object3D;
  base: THREE.Matrix4;
  pivot: THREE.Vector3;
  angle: number;
  kind: "wheel" | "steering" | "timed";
  diameter: number;
  autoUpdate: boolean;
}

/** Original GROOVE axes and car binding references drive visual wheels. The
 * browser's bicycle steering and rolling speed supply approximate control values. */
export class CarAnimation {
  readonly warnings: string[] = [];
  private bindings: ActorBinding[] = [];
  private elapsed = 0;
  get wheelCount() {
    return this.bindings.filter((b) => b.kind === "wheel").length;
  }
  get steeringCount() {
    return this.bindings.filter((b) => b.kind === "steering").length;
  }
  constructor(group: THREE.Group, configText: string) {
    if (configText.length > 4_000_000) {
      this.warnings.push("Animation config exceeds size limit");
      return;
    }
    const controls = carBindings(configText);
    let blocks: string[][] = [];
    try {
      blocks = sections(configText, "GROOVE");
    } catch (e) {
      this.warnings.push(String(e));
    }
    const actors = new Map<string, THREE.Object3D>();
    group.traverse((o) => {
      if (o instanceof THREE.Group && !actors.has(nameKey(o.name)))
        actors.set(nameKey(o.name), o);
    });
    group.updateMatrixWorld(true);
    for (const block of blocks) {
      try {
        const groove = parseGroove(block),
          object = actors.get(nameKey(groove.actor));
        if (!object) throw new Error(`Actor ${groove.actor} is absent`);
        let kind: ActorBinding["kind"] = "timed",
          diameter = controls.rollingDiameter;
        if (["controlled", "absolute"].includes(groove.mode)) {
          if (
            groove.animation === "spin" &&
            (controls.driven.has(groove.value) ||
              controls.rolling.has(groove.value))
          ) {
            kind = "wheel";
            diameter = controls.driven.has(groove.value)
              ? controls.drivenDiameter
              : controls.rollingDiameter;
          } else if (
            groove.animation === "rock" &&
            controls.steering.has(groove.value)
          )
            kind = "steering";
          else throw new Error(`Unsupported control reference ${groove.value}`);
        }
        if (object.matrixAutoUpdate) object.updateMatrix();
        const pivot = groove.pivot.clone();
        if (kind !== "timed" && pivot.lengthSq() === 0) {
          // The native loader centers wheel geometry. Here original DAT positions
          // stay intact, so the local bounds supply an equivalent hub pivot.
          const box = new THREE.Box3(),
            inverse = object.matrixWorld.clone().invert();
          object.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            child.geometry.computeBoundingBox();
            if (child.geometry.boundingBox)
              box.union(
                child.geometry.boundingBox
                  .clone()
                  .applyMatrix4(inverse.clone().multiply(child.matrixWorld)),
              );
          });
          if (!box.isEmpty()) box.getCenter(pivot);
        }
        this.bindings.push({
          groove,
          object,
          base: object.matrix.clone(),
          pivot,
          angle: 0,
          kind,
          diameter,
          autoUpdate: object.matrixAutoUpdate,
        });
      } catch (e) {
        this.warnings.push(`${block[0]}: ${e}`);
      }
    }
  }
  update(dt: number, input: AnimationInput) {
    if (!Number.isFinite(dt)) return;
    dt = THREE.MathUtils.clamp(dt, 0, 1);
    this.elapsed += dt;
    for (const binding of this.bindings) {
      const { groove, object, pivot } = binding;
      let angle: number;
      if (binding.kind === "wheel") {
        binding.angle =
          (binding.angle - (input.speed * dt * 2) / binding.diameter) % TAU;
        angle = binding.angle;
      } else if (binding.kind === "steering")
        angle = THREE.MathUtils.clamp(input.steer, -1, 1) * 0.5;
      else if (groove.animation === "spin")
        angle = this.elapsed * groove.value * TAU;
      else
        angle = wave(
          groove.mode,
          this.elapsed,
          groove.value,
          THREE.MathUtils.degToRad(groove.amplitude),
        );
      const axis = new THREE.Vector3(
        Number(groove.axis === "x"),
        Number(groove.axis === "y"),
        Number(groove.axis === "z"),
      );
      const animated = binding.base
        .clone()
        .multiply(
          new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z),
        )
        .multiply(new THREE.Matrix4().makeRotationAxis(axis, angle))
        .multiply(
          new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z),
        );
      // Keep the complete local matrix, including any original affine transform.
      object.matrixAutoUpdate = false;
      object.matrix.copy(animated);
      animated.decompose(object.position, object.quaternion, object.scale);
      object.matrixWorldNeedsUpdate = true;
    }
  }
  reset() {
    this.elapsed = 0;
    for (const b of this.bindings) {
      b.angle = 0;
      b.object.matrix.copy(b.base);
      b.base.decompose(b.object.position, b.object.quaternion, b.object.scale);
      b.object.matrixAutoUpdate = b.autoUpdate;
      b.object.matrixWorldNeedsUpdate = true;
    }
  }
  dispose() {
    this.reset();
    this.bindings = [];
  }
}

type MappedMaterial = THREE.Material & {
  map?: THREE.Texture | null;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
};
interface TextureBinding {
  spec: Funk;
  material: MappedMaterial;
  original: THREE.Texture | null | undefined;
  baseUv: THREE.Matrix3;
  maps: THREE.Texture[];
  atlasUvs: THREE.Matrix3[];
  matrixMap?: THREE.Texture;
  originalEmissive?: THREE.Color;
  originalEmissiveIntensity?: number;
}
const noInput: AnimationInput = {
  speed: 0,
  steer: 0,
  brake: false,
  throttle: 0,
};

/** Original FUNK frame rates, atlas cells, VB reverse/brake bits and water UV
 * movement. Distance gating, FLIC playback, lighting curves and other modes
 * remain unsupported and are exposed through warnings. */
export class TextureAnimation {
  readonly warnings: string[] = [];
  private bindings: TextureBinding[] = [];
  private owned = new Set<THREE.Texture>();
  private elapsed = 0;
  get count() {
    return this.bindings.length;
  }
  constructor(
    materials: Map<string, THREE.Material>,
    textures: Map<string, THREE.Texture>,
    configText: string,
  ) {
    const mats = new Map<string, MappedMaterial[]>();
    for (const [key, material] of materials) {
      const name = nameKey(material.name || key),
        matches = mats.get(name) ?? [];
      if (!matches.includes(material)) matches.push(material as MappedMaterial);
      mats.set(name, matches);
    }
    const maps = new Map([...textures].map(([name, t]) => [nameKey(name), t]));
    let blocks: string[][] = [];
    try {
      blocks = sections(configText, "FUNK");
    } catch (e) {
      this.warnings.push(String(e));
    }
    for (const block of blocks) {
      try {
        const spec = parseFunk(block),
          matches = mats.get(nameKey(spec.material));
        if (!matches?.length)
          throw new Error(`Material ${spec.material} is absent`);
        for (const material of matches) {
          const original = material.map,
            baseUv = original?.matrix.clone() ?? new THREE.Matrix3();
          const frameMaps = spec.frames.map((frame) => {
            const source = maps.get(nameKey(frame.texture));
            if (!source)
              throw new Error(`Frame texture ${frame.texture} is absent`);
            const texture = source.clone();
            this.owned.add(texture);
            texture.matrixAutoUpdate = false;
            const atlas = new THREE.Matrix3().set(
              1 / frame.columns,
              0,
              frame.column / frame.columns,
              0,
              1 / frame.rows,
              frame.row / frame.rows,
              0,
              0,
              1,
            );
            texture.matrix.copy(atlas).multiply(baseUv);
            texture.needsUpdate = true;
            return texture;
          });
          let matrixMap: THREE.Texture | undefined;
          if (!frameMaps.length && spec.matrix !== "none") {
            if (!original)
              throw new Error("Animated material has no texture map");
            matrixMap = original.clone();
            this.owned.add(matrixMap);
            matrixMap.matrixAutoUpdate = false;
          }
          this.bindings.push({
            spec,
            material,
            original,
            baseUv,
            maps: frameMaps,
            atlasUvs: frameMaps.map((t) => t.matrix.clone()),
            matrixMap,
            originalEmissive: material.emissive?.clone(),
            originalEmissiveIntensity: material.emissiveIntensity,
          });
        }
        if (block[1]?.toLowerCase() === "distance")
          this.warnings.push(
            `${spec.material}: distance gating approximated as always active`,
          );
      } catch (e) {
        this.warnings.push(`${block[0]}: ${e}`);
      }
    }
    this.update(0);
  }
  update(dt: number, input: AnimationInput = noInput) {
    if (!Number.isFinite(dt)) return;
    this.elapsed += Math.max(0, dt);
    for (const binding of this.bindings) {
      const { spec, material } = binding;
      let texture = binding.matrixMap;
      let baseUv = binding.baseUv;
      if (binding.maps.length) {
        let frame =
          Math.floor(this.elapsed * Math.max(0, spec.rate)) %
          binding.maps.length;
        if (spec.frameMode === "texturebits") {
          const reverse =
            input.speed < -0.05 ||
            (input.throttle < -0.1 && Math.abs(input.speed) < 0.05);
          frame = [...spec.bits].reduce(
            (n, bit, i) =>
              n | ((bit === "B" ? input.brake : reverse) ? 1 << i : 0),
            0,
          );
        }
        texture = binding.maps[frame];
        baseUv = binding.atlasUvs[frame];
        if (spec.frameMode === "texturebits" && material.emissive) {
          const active =
            input.brake ||
            input.speed < -0.05 ||
            (input.throttle < -0.1 && Math.abs(input.speed) < 0.05);
          material.emissive.copy(
            active
              ? new THREE.Color(0x331111)
              : (binding.originalEmissive ?? new THREE.Color(0)),
          );
          material.emissiveIntensity = active
            ? 0.6
            : (binding.originalEmissiveIntensity ?? 1);
        }
      }
      if (!texture) continue;
      if (spec.matrix !== "none") {
        const u = wave(spec.mode, this.elapsed, spec.rates[0], spec.amounts[0]);
        const v = wave(spec.mode, this.elapsed, spec.rates[1], spec.amounts[1]);
        if (spec.matrix === "spin") {
          const c = Math.cos(u * TAU),
            s = Math.sin(u * TAU);
          texture.matrix
            .set(
              c,
              -s,
              0.5 - 0.5 * c + 0.5 * s,
              s,
              c,
              0.5 - 0.5 * s - 0.5 * c,
              0,
              0,
              1,
            )
            .multiply(baseUv);
        } else
          texture.matrix
            .copy(baseUv)
            .premultiply(new THREE.Matrix3().set(1, 0, u, 0, 1, v, 0, 0, 1));
      }
      if (material.map !== texture) {
        material.map = texture;
        material.needsUpdate = true;
      }
    }
  }
  reset() {
    this.elapsed = 0;
    this.update(0);
  }
  dispose() {
    for (const b of this.bindings) {
      b.material.map = b.original;
      if (b.originalEmissive && b.material.emissive)
        b.material.emissive.copy(b.originalEmissive);
      if (b.originalEmissiveIntensity !== undefined)
        b.material.emissiveIntensity = b.originalEmissiveIntensity;
      b.material.needsUpdate = true;
    }
    this.owned.forEach((texture) => texture.dispose());
    this.owned.clear();
    this.bindings = [];
  }
}
