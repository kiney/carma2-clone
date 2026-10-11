import * as THREE from "three";

const f32 = Math.fround;
const STEP = f32(0.05);

export interface SkidWheelSample {
  car: THREE.Object3D;
  wheel: number;
  /** WheelForces demand/capacity request, before 41bd60's contact filters. */
  requested: boolean;
  /** Native marker point projected onto the selected face, in world actor units. */
  position: THREE.Vector3;
  normal: THREE.Vector3;
  skidMaterial?: string;
  contact: {
    /** Native wheel-data pointer, including contacts beyond suspension travel. */
    present: boolean;
    pixelmapType?: number;
    materialName?: string;
  };
  oilRemaining?: number;
  oilMaterial?: string;
  suspensionDistance?: number;
  suspensionHeight?: number;
}
export interface SkidMarkOptions {
  /** Return a stable shared original material, with its texture/alpha mapping. */
  resolveMaterial: (name: string) => THREE.Material | undefined;
}
type Wheel = {
  active: boolean;
  id: number;
  total: number;
  source: THREE.Vector3;
  normal: THREE.Vector3;
  previous: THREE.Vector3;
  previousNormal: THREE.Vector3;
  start: THREE.Vector3;
  end: THREE.Vector3;
};
type Mark = {
  mesh: THREE.Mesh<THREE.BufferGeometry>;
  normal: THREE.Vector3;
  position: THREE.Vector3;
  material?: THREE.Material;
};
export type SkidSampleResult = {
  status:
    | "idle"
    | "armed"
    | "spacing"
    | "stopped"
    | "discontinuity"
    | "created"
    | "extended";
  id: number;
  oilRemaining: number;
};

function vector(value: THREE.Vector3) {
  if (![value.x, value.y, value.z].every((n) => Number.isFinite(f32(n))))
    throw new Error("Invalid skid vector");
  return new THREE.Vector3(f32(value.x), f32(value.y), f32(value.z));
}
function stored(value: THREE.Vector3) {
  return value.set(f32(value.x), f32(value.y), f32(value.z));
}

/** Installed 41bd60 filters. Type 0x12 is the nested material colour-map type. */
export function skidContactEligible(contact: SkidWheelSample["contact"]) {
  return (
    contact.present &&
    contact.pixelmapType !== 0x12 &&
    !(contact.materialName?.length === 12 && contact.materialName[5] === "|")
  );
}

/** Installed StretchMark4ea030, including the native degenerate Y scale. */
export function skidMarkTransform(
  from: THREE.Vector3,
  to: THREE.Vector3,
  normal: THREE.Vector3,
  textureStart: number,
  textureStep = STEP,
) {
  const displacement = stored(vector(to).sub(vector(from)));
  const n = vector(normal);
  if (
    !Number.isFinite(f32(textureStart)) ||
    !Number.isFinite(f32(textureStep)) ||
    f32(textureStep) <= 0
  )
    throw new Error("Invalid skid texture mapping");
  const length = displacement.length();
  if (length < f32(0.001))
    return {
      matrix: new THREE.Matrix4().makeScale(f32(0.001), 1, f32(0.001)),
      uv: null,
    };
  const width = stored(displacement.clone().cross(n));
  width.multiplyScalar(textureStep / length);
  stored(width);
  const centre = stored(vector(from).add(vector(to)).multiplyScalar(f32(0.5)));
  const matrix = new THREE.Matrix4()
    .makeBasis(displacement, n, width)
    .setPosition(centre);
  const u0 = f32(textureStart / textureStep),
    u1 = f32((textureStart + length) / textureStep);
  return { matrix, uv: new Float32Array([u0, 0, u0, 1, u1, 1, u1, 0]) };
}

/** Independent native 100-section persistent pool. Call each wheel once at the
 * end of its 40 ms force step, after all marker request sites have run. */
export class SkidMarkSystem {
  readonly group = new THREE.Group();
  readonly diagnostics: string[] = [];
  private wheels = new WeakMap<THREE.Object3D, Wheel[]>();
  private readonly marks: Mark[] = [];
  private readonly empty = new THREE.MeshBasicMaterial();
  private cursor = 0;
  private disposed = false;
  private created = 0;
  private extended = 0;
  private overwrites = 0;

  constructor(private readonly options: SkidMarkOptions) {
    this.group.name = "C2 tyre marks";
    for (let i = 0; i < 100; i++) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          [-0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 0, -0.5],
          3,
        ),
      );
      geometry.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(
          [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
          3,
        ),
      );
      geometry.setAttribute(
        "uv",
        new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 1, 0], 2),
      );
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      const mesh = new THREE.Mesh(geometry, this.empty);
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      mesh.name = `C2 skid section ${i}`;
      this.group.add(mesh);
      this.marks.push({
        mesh,
        normal: new THREE.Vector3(),
        position: new THREE.Vector3(),
      });
    }
  }

  get debug() {
    return {
      active: this.marks.filter((mark) => mark.mesh.visible).length,
      cursor: this.cursor,
      created: this.created,
      extended: this.extended,
      overwrites: this.overwrites,
      diagnostics: [...this.diagnostics],
    };
  }
  snapshot(car?: THREE.Object3D) {
    return {
      ...this.debug,
      marks: this.marks.map((mark, id) => ({
        id,
        visible: mark.mesh.visible,
        material: mark.material?.name,
        matrix: mark.mesh.matrix.toArray(),
        position: mark.position.toArray(),
        normal: mark.normal.toArray(),
        uv: Array.from(mark.mesh.geometry.getAttribute("uv").array),
      })),
      wheels: car
        ? this.wheels.get(car)?.map((wheel) => ({
            active: wheel.active,
            id: wheel.id,
            total: wheel.total,
            position: wheel.source.toArray(),
            normal: wheel.normal.toArray(),
            previous: wheel.previous.toArray(),
            previousNormal: wheel.previousNormal.toArray(),
          }))
        : undefined,
    };
  }
  private state(car: THREE.Object3D, index: number) {
    let wheels = this.wheels.get(car);
    if (!wheels) {
      wheels = Array.from({ length: 4 }, () => ({
        active: false,
        id: -1,
        total: 0,
        source: new THREE.Vector3(),
        normal: new THREE.Vector3(),
        previous: new THREE.Vector3(),
        previousNormal: new THREE.Vector3(),
        start: new THREE.Vector3(),
        end: new THREE.Vector3(),
      }));
      this.wheels.set(car, wheels);
    }
    return wheels[index];
  }
  private material(name?: string) {
    if (!name || name.toLowerCase() === "none" || name === "0" || name === "1")
      return undefined;
    const material = this.options.resolveMaterial(name);
    if (!material) {
      const message = `Unresolved original skid material ${name}`;
      if (!this.diagnostics.includes(message) && this.diagnostics.length < 32)
        this.diagnostics.push(message);
    }
    return material;
  }
  private stretch(
    mark: Mark,
    from: THREE.Vector3,
    to: THREE.Vector3,
    start: number,
  ) {
    const result = skidMarkTransform(from, to, mark.normal, start);
    mark.mesh.matrix.copy(result.matrix);
    mark.mesh.matrixWorldNeedsUpdate = true;
    if (result.uv) {
      mark.position.setFromMatrixPosition(result.matrix);
      const uv = mark.mesh.geometry.getAttribute("uv") as THREE.BufferAttribute;
      (uv.array as Float32Array).set(result.uv);
      uv.needsUpdate = true;
    }
  }
  private section(
    wheel: Wheel,
    material: THREE.Material,
  ): SkidSampleResult["status"] {
    const n = wheel.normal,
      p = wheel.source,
      previous = wheel.previous;
    if (
      n.dot(wheel.previousNormal) < f32(0.997) ||
      Math.abs(n.dot(p) - n.dot(previous)) > f32(0.01)
    ) {
      wheel.id = -1;
      return "discontinuity";
    }
    const mark =
      wheel.id >= 0 && wheel.id < 100 ? this.marks[wheel.id] : undefined;
    if (mark?.material === material) {
      const matrix = mark.mesh.matrix.elements;
      const widthSq = matrix[8] ** 2 + matrix[9] ** 2 + matrix[10] ** 2;
      const length = Math.hypot(matrix[0], matrix[1], matrix[2]);
      const stepSq = STEP * STEP;
      if (widthSq < 2 * stepSq && stepSq <= 2 * widthSq && length <= f32(0.5)) {
        const baseline = wheel.end.clone().sub(wheel.start).setY(0);
        const advance = p.clone().sub(wheel.end).setY(0);
        const displacement = p.clone().sub(previous).setY(0);
        const history = previous.clone().sub(wheel.start).setY(0);
        if (
          Math.abs(baseline.clone().cross(advance).y) <=
            STEP * baseline.length() &&
          displacement.dot(history) >= 0
        ) {
          this.stretch(mark, wheel.start, p, wheel.total);
          this.extended++;
          return "extended";
        }
      }
    }
    wheel.start.copy(previous);
    wheel.end.copy(p);
    const target = this.marks[this.cursor];
    if (target.mesh.visible) this.overwrites++;
    target.material = material;
    target.mesh.material = material;
    target.mesh.visible = true;
    target.normal.copy(n);
    this.stretch(target, previous, p, wheel.total);
    wheel.id = this.cursor;
    this.cursor = (this.cursor + 1) % 100;
    this.created++;
    return "created";
  }
  singlePhysicsWheelSample(sample: SkidWheelSample): SkidSampleResult {
    if (!Number.isInteger(sample.wheel) || sample.wheel < 0 || sample.wheel > 3)
      throw new Error("Invalid skid wheel index");
    const position = vector(sample.position),
      normal = vector(sample.normal);
    let oil = f32(sample.oilRemaining ?? 0);
    if (!Number.isFinite(oil) || oil < 0)
      throw new Error("Invalid skid oil distance");
    if (
      oil !== 0 &&
      (!Number.isFinite(sample.suspensionDistance) ||
        !Number.isFinite(sample.suspensionHeight))
    )
      throw new Error("Oil skid source requires suspension distances");
    const wheel = this.state(sample.car, sample.wheel);
    const result = (status: SkidSampleResult["status"]): SkidSampleResult => ({
      status,
      id: wheel.id,
      oilRemaining: oil,
    });
    if (this.disposed) return result("idle");
    const eligible = skidContactEligible(sample.contact);
    let requested = (sample.requested || oil !== 0) && eligible;
    if (requested) {
      wheel.source.copy(position);
      wheel.normal.copy(normal);
    }
    let material = this.material(sample.skidMaterial);
    if (oil !== 0 && sample.suspensionDistance! < sample.suspensionHeight!) {
      requested = true;
      material = this.material(sample.oilMaterial ?? "OILSMEAR.MAT");
    }
    if (!material) {
      wheel.active = false;
      return result("stopped");
    }
    if (!requested && !wheel.active) return result("idle");
    let status: SkidSampleResult["status"];
    if (!requested) {
      wheel.active = false;
      status = "stopped";
    } else if (!wheel.active) {
      wheel.active = true;
      wheel.total = 0;
      wheel.id = -1;
      status = "armed";
    } else {
      const distance = wheel.source.distanceTo(wheel.previous);
      if (distance < STEP) return result("spacing");
      status = this.section(wheel, material);
      if (status === "discontinuity") wheel.active = false;
      const storedDistance = f32(distance);
      wheel.total = f32(wheel.total + storedDistance);
      oil = f32(Math.max(0, oil - storedDistance));
    }
    wheel.previous.copy(wheel.source);
    wheel.previousNormal.copy(wheel.normal);
    return result(status);
  }
  /** Native SkidsPerFrame4ea490 restores stored world translations. No fading. */
  update() {
    for (const mark of this.marks)
      if (mark.mesh.visible) {
        mark.mesh.matrix.setPosition(mark.position);
        mark.mesh.matrixWorldNeedsUpdate = true;
      }
  }
  clear() {
    for (const mark of this.marks) mark.mesh.visible = false;
    this.wheels = new WeakMap();
    // HideSkids does not reset the insertion cursor or mark record contents.
  }
  dispose() {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    for (const mark of this.marks) mark.mesh.geometry.dispose();
    this.empty.dispose();
    this.group.clear();
    this.group.removeFromParent();
    // Materials/textures belong to the injected original-material provider.
  }
}
