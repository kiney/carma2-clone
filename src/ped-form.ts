/** Independently implemented original pedestrian simple-body data and pose math.
 * Evidence: docs/c2-ped-simple-body-re.md. Matrices use BRender basis rows and
 * translation row; lengths/velocities remain in native world units. */
export type PedVector = readonly [number, number, number];
export interface PedBounds {
  min: PedVector;
  max: PedVector;
}
export interface PedFormBone {
  name: string;
  massKg: number;
  mass: number;
  collisionType: string | null;
  jointType: string | null;
  parent: number | null;
  /** Retained authored articulated limits; this module does not solve joints. */
  jointRecords: string[];
}
export interface PedFormMove {
  id: number;
  periodMs: number;
  resetAxes: string;
  direction: PedVector;
  filename: string;
  flags: number;
}
export interface PedForm {
  maxSimple: number;
  maxBoned: number;
  maxRender: number;
  maxStoredDismembered: number;
  remapFilename: string | null;
  bones: PedFormBone[];
  mass: number;
  moves: PedFormMove[];
  nonHumanoid: boolean;
  headBone: number;
  lyingAxes: readonly [number, number];
}
export interface PedBoneRemap {
  general: PedVector;
  powerup: PedVector;
}
export type PedRemap = ReadonlyMap<string, PedBoneRemap>;
export interface PedBoneAttachment {
  /** Personality +20, independently remapped through this FORM bone. */
  child: PedVector;
  /** Personality +2c, independently remapped through its FORM parent. */
  parent: PedVector;
}
export interface PedSimpleBodyProfile {
  formName: string;
  defaultMovesName: string;
  rootName: string;
  rootRemap: PedBoneRemap | null;
  mass: number;
  bounds: PedBounds;
  centreOfMass: PedVector;
  radius: number;
  inertia: PedVector;
  modelsByBone: ReadonlyMap<string, readonly (string | null)[]>;
  /** Native joint anchors, indexed by exact FORM name; root has no entry. */
  attachmentsByBone: ReadonlyMap<string, PedBoneAttachment>;
  /** Default records followed by personality overrides; missing IDs stay absent. */
  movement: ReadonlyMap<number, PedPersonalityMove>;
}
export interface PedPersonalityMove {
  scale: number;
  groundingMode: 0 | -1;
  groundingOffset: number;
}
const f = Math.fround;
const collisionTypes = new Set([
  "BOX",
  "POLYHEDRON",
  "LINE",
  "POLYGON",
  "SPHERE",
  "NONE",
]);
const jointTypes = new Set([
  "NONE",
  "HINGE",
  "UNIVERSAL",
  "BALLNSOCKET",
  "QUICKHINGE",
  "PHANTOM",
  "FALSE",
]);
function records(text: string): string[] {
  if (text.length > 2_000_000 || text.includes("\0"))
    throw new Error("PED: invalid text size/content");
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.split("//")[0].trim())
    .filter(Boolean);
  if (lines.length > 32768 || lines.some((s) => s.length > 4096))
    throw new Error("PED: too many/large records");
  return lines;
}
function finite(n: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(f(n)))
    throw new Error("PED: non-finite scalar");
  return n;
}
function scalar(s: string | undefined): number {
  if (
    s === undefined ||
    s === "" ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)
  )
    throw new Error("PED: invalid scalar");
  return f(finite(Number(s)));
}
function integer(s: string | undefined, lo: number, hi: number): number {
  const n = scalar(s);
  if (!Number.isInteger(n) || n < lo || n > hi)
    throw new Error("PED: integer out of bounds");
  return n;
}
function vector(s: string | undefined): PedVector {
  const parts = s?.split(/[\s,]+/);
  if (parts?.length !== 3) throw new Error("PED: invalid vector");
  return [scalar(parts[0]), scalar(parts[1]), scalar(parts[2])];
}
function checkedVector(v: PedVector): [number, number, number] {
  if (v.length !== 3) throw new Error("PED: invalid vector length");
  return [f(finite(v[0])), f(finite(v[1])), f(finite(v[2]))];
}
function name(s: string | undefined): string {
  if (!s || s.length > 39) throw new Error("PED: invalid name");
  return s;
}
function filename(s: string | undefined): string {
  if (!s || s.length > 255 || /[\\/:]/.test(s) || s === "." || s === "..")
    throw new Error("PED: invalid filename");
  return s;
}
function section(
  lines: string[],
  start: string,
  end: string,
): [number, number] {
  const a = lines.indexOf(start),
    b = lines.indexOf(end, a + 1);
  if (a < 0 || b <= a) throw new Error(`PED: missing ${start}/${end}`);
  return [a, b];
}
export function parsePedForm(text: string): PedForm {
  const rows = records(text);
  const [bs, be] = section(rows, "START OF BONES", "END OF BONES");
  const [ms, me] = section(rows, "START OF MOVES", "END OF MOVES");
  if (bs !== 5 || ms !== be + 1)
    throw new Error("PED: invalid form section order");
  const bones: PedFormBone[] = [];
  let start = bs + 1,
    mass = 0;
  for (let i = start; i <= be; i++) {
    if (i !== be && rows[i] !== "NEXT BONE") continue;
    const part = rows.slice(start, i);
    if (part.length < 2 || bones.length >= 255)
      throw new Error("PED: invalid bone count/record");
    const massKg = scalar(part[1]);
    if (massKg < 0) throw new Error("PED: negative bone mass");
    const boneMass = f(massKg * 0.001);
    mass = f(finite(mass + boneMass));
    const collisionType = boneMass === 0 ? null : part[2];
    const jointType = boneMass === 0 ? null : part[3];
    if (
      (boneMass === 0 && part.length !== 2) ||
      (boneMass !== 0 &&
        (!collisionTypes.has(collisionType!) || !jointTypes.has(jointType!)))
    )
      throw new Error("PED: invalid bone collision/joint");
    const parent =
      jointType === null
        ? null
        : jointType === "NONE"
          ? -1
          : integer(part[4], 0, bones.length - 1);
    const jointRecords = part.slice(parent === -1 || parent === null ? 4 : 5);
    if (
      (jointType === "NONE" ||
        jointType === "FALSE" ||
        jointType === "PHANTOM") &&
      jointRecords.length
    )
      throw new Error("PED: unexpected joint records");
    const boneName = name(part[0]);
    if (bones.some((b) => b.name === boneName))
      throw new Error("PED: duplicate bone name");
    bones.push({
      name: boneName,
      massKg,
      mass: boneMass,
      collisionType,
      jointType,
      parent,
      jointRecords,
    });
    start = i + 1;
  }
  if (!bones.length || bones[0].parent !== -1 || !(mass > 0))
    throw new Error("PED: missing massive root");
  const moves: PedFormMove[] = [];
  if ((me - ms - 1) % 6 !== 0 || (me - ms - 1) / 6 > 255)
    throw new Error("PED: invalid move records");
  for (let i = ms + 1; i < me; i += 6) {
    const id = integer(rows[i].split(/[\s,/]+/)[0], 0, 0x7fff),
      fps = integer(rows[i + 1], 1, 1000);
    if (moves.some((m) => m.id === id))
      throw new Error("PED: duplicate move id");
    const resetAxes = rows[i + 2];
    if (!/^(?:NONE|[XYZ]+)$/i.test(resetAxes))
      throw new Error("PED: invalid reset axes");
    moves.push({
      id,
      periodMs: Math.trunc(1000 / fps),
      resetAxes:
        resetAxes.toUpperCase() === "NONE" ? "" : resetAxes.toUpperCase(),
      direction: vector(rows[i + 3]),
      filename: filename(rows[i + 4]),
      flags: integer(rows[i + 5], 0, 0x7fffffff),
    });
  }
  if (
    !["HUMANOID", "NONHUMANOID"].includes(rows[me + 1]) ||
    rows.length !== me + 5
  )
    throw new Error("PED: invalid form tail");
  return {
    maxSimple: integer(rows[0], 1, 255),
    maxBoned: integer(rows[1], 0, 255),
    maxRender: integer(rows[2], 1, 255),
    maxStoredDismembered: integer(rows[3], 0, 255),
    remapFilename: rows[4] === "NONE" ? null : filename(rows[4]),
    bones,
    mass,
    moves,
    nonHumanoid: rows[me + 1] === "NONHUMANOID",
    headBone: integer(rows[me + 2], -1, bones.length - 1),
    lyingAxes: [integer(rows[me + 3], -3, 3), integer(rows[me + 4], -3, 3)],
  };
}
export function parsePedRemap(text: string): PedRemap {
  const rows = records(text),
    [a, b] = section(rows, "START OF BONES", "END OF BONES");
  if (a !== 0 || b !== rows.length - 1)
    throw new Error("PED: invalid remap section");
  const result = new Map<string, PedBoneRemap>(),
    axes = ["+X", "+Y", "+Z", "-X", "-Y", "-Z"];
  for (let at = a + 1; at < b; ) {
    const bone = name(rows[at++]);
    if (result.has(bone) || result.size >= 255)
      throw new Error("PED: duplicate/too many remaps");
    const choices = rows
      .slice(at, at + 6)
      .map((s) => axes.indexOf(s.toUpperCase()));
    if (choices.length !== 6 || choices.some((n) => n < 0))
      throw new Error("PED: invalid remap axis");
    result.set(bone, {
      general: [choices[0], choices[1], choices[2]],
      powerup: [choices[3], choices[4], choices[5]],
    });
    at += 6;
    // ReadRemap's count pass recognizes NEXT BONE; its read pass discards
    // the final separator without interpreting it. Shipped DOG.TXT has a
    // malformed non-command final separator, so preserve that native quirk.
    if (at === b - 1 && rows[at] !== "NEXT BONE") at++;
    if (at < b && (rows[at++] !== "NEXT BONE" || at === b))
      throw new Error("PED: invalid remap separator");
  }
  return result;
}
export function remapPedVector(
  v: PedVector,
  choices: PedVector | null,
): PedVector {
  const p = checkedVector(v);
  if (!choices) return p;
  return choices.map((c) => {
    if (!Number.isInteger(c) || c < 0 || c > 5)
      throw new Error("PED: invalid remap choice");
    return c < 3 ? p[c % 3] : -p[c % 3];
  }) as [number, number, number];
}
export function nativePedBoxInertia(
  mass: number,
  bounds: PedBounds,
): PedVector {
  const m = f(finite(mass)),
    lo = checkedVector(bounds.min),
    hi = checkedVector(bounds.max);
  if (!(m > 0) || hi.some((n, i) => n <= lo[i]))
    throw new Error("PED: degenerate body");
  const d = hi.map((n, i) => f(finite(n - lo[i]))),
    square = d.map((n) => n * n);
  // Installed initializer spills x²/y² but retains z² in the x87 stack.
  const x = f(square[0]),
    y = f(square[1]),
    z = square[2],
    c = f(0.025);
  return [
    f(finite(m * (y + z) * c)),
    f(finite(m * (x + z) * c)),
    f(finite(m * (x + y) * c)),
  ];
}
/** Native one-command grounding table recognizes GROUND; other tokens mean -1. */
export function parsePedPersonalityMoves(
  text: string,
  form: PedForm,
): Map<number, PedPersonalityMove> {
  const rows = records(text),
    [a, b] = section(rows, "START OF MOVES", "END OF MOVES");
  if ((b - a - 1) % 4 !== 0)
    throw new Error("PED: invalid personality movement records");
  const result = new Map<number, PedPersonalityMove>();
  for (let i = a + 1; i < b; i += 4) {
    const id = integer(rows[i].split(/[\s,/]+/)[0], 0, 0x7fff);
    if (!form.moves.some((m) => m.id === id))
      throw new Error("PED: personality move missing from form");
    result.set(id, {
      scale: scalar(rows[i + 1]),
      groundingMode: rows[i + 2] === "GROUND" ? 0 : -1,
      groundingOffset: scalar(rows[i + 3]),
    });
  }
  return result;
}
export function parsePedPersonalitySimpleBody(
  text: string,
  form: PedForm,
  remap?: PedRemap,
  defaultMovesText?: string,
): PedSimpleBodyProfile {
  const rows = records(text),
    [bs, be] = section(rows, "START OF BONES", "END OF BONES"),
    [ms, me] = section(rows, "START OF MOVES", "END OF MOVES");
  if (bs !== 2 || ms !== be + 1 || rows.length < me + 4)
    throw new Error("PED: invalid personality sections");
  if (form.remapFilename && !remap)
    throw new Error("PED: required remap missing");
  const modelsByBone = new Map<string, readonly (string | null)[]>();
  const attachmentsByBone = new Map<string, PedBoneAttachment>();
  let at = bs + 1;
  for (let i = 0; i < form.bones.length; i++) {
    const boneName = rows[at++];
    const bone = form.bones.find((b) => b.name === boneName);
    if (!bone || modelsByBone.has(bone.name))
      throw new Error("PED: unknown/duplicate personality bone");
    const models = rows[at++]?.split(",").map((s) => s.trim());
    if (
      !models?.length ||
      models.length > 4 ||
      models.some((s) => !s || s.length > 255)
    )
      throw new Error("PED: invalid personality model variants");
    modelsByBone.set(
      bone.name,
      models.map((s) => (s.toUpperCase() === "NULL" ? null : s)),
    );
    if (bone.parent !== null && bone.parent >= 0) {
      const parent = form.bones[bone.parent];
      if (!parent)
        throw new Error("PED: personality attachment parent missing");
      const childRemap = remap?.get(bone.name)?.general ?? null;
      const parentRemap = remap?.get(parent.name)?.general ?? null;
      attachmentsByBone.set(bone.name, {
        child: remapPedVector(vector(rows[at++]), childRemap),
        parent: remapPedVector(vector(rows[at++]), parentRemap),
      });
    }
    if (bone.parent === null)
      throw new Error("PED: zero-mass personality bone attachment unresolved");
  }
  if (at !== be || (me - ms - 1) % 4 !== 0)
    throw new Error("PED: invalid personality bone/move records");
  const rootName = form.bones[0].name,
    rootRemap = form.remapFilename ? (remap!.get(rootName) ?? null) : null;
  const p = remapPedVector(vector(rows[me + 1]), rootRemap?.general ?? null),
    q = remapPedVector(vector(rows[me + 2]), rootRemap?.general ?? null);
  const bounds: PedBounds = {
    min: [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.min(p[2], q[2])],
    max: [Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.max(p[2], q[2])],
  };
  const movement = defaultMovesText
    ? parsePedPersonalityMoves(defaultMovesText, form)
    : new Map<number, PedPersonalityMove>();
  for (const [id, move] of parsePedPersonalityMoves(text, form))
    movement.set(id, move);
  return {
    formName: filename(rows[0]),
    defaultMovesName: filename(rows[1]),
    rootName,
    rootRemap,
    mass: form.mass,
    bounds,
    centreOfMass: remapPedVector(
      vector(rows[me + 3]),
      rootRemap?.general ?? null,
    ),
    radius: Math.max(...bounds.min.map(Math.abs), ...bounds.max.map(Math.abs)),
    inertia: nativePedBoxInertia(form.mass, bounds),
    modelsByBone,
    attachmentsByBone,
    movement,
  };
}
function matrix(input: ArrayLike<number>): Float32Array {
  if (input.length !== 12) throw new Error("PED: expected 4x3 matrix");
  return Float32Array.from(input, finite);
}
export function flipPedExportMatrix(input: ArrayLike<number>): Float32Array {
  const p = matrix(input),
    out = new Float32Array(12);
  // C^-1 R C and p C for exporter coordinates (x,y,z)->(x,z,-y).
  out.set([
    p[0],
    p[2],
    -p[1],
    p[6],
    p[8],
    -p[7],
    -p[3],
    -p[5],
    p[4],
    p[9],
    p[11],
    -p[10],
  ]);
  return out;
}
function cross(a: PedVector, b: PedVector): [number, number, number] {
  return [
    f(a[1] * b[2] - a[2] * b[1]),
    f(a[2] * b[0] - a[0] * b[2]),
    f(a[0] * b[1] - a[1] * b[0]),
  ];
}
function normalise(a: PedVector): [number, number, number] {
  const l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  return l > 2 ** -22 ? [f(a[0] / l), f(a[1] / l), f(a[2] / l)] : [1, 0, 0];
}
/** Installed 5325a0: row2 normalize, row1×row2 normalize, row2×row0. */
export function lpNormalisePedMatrix(input: ArrayLike<number>): Float32Array {
  const p = matrix(input),
    z = normalise([p[6], p[7], p[8]]),
    x = normalise(cross([p[3], p[4], p[5]], z)),
    y = cross(z, x);
  return new Float32Array([...x, ...y, ...z, p[9], p[10], p[11]]);
}
export interface PedRootMotionInput {
  bones: readonly { name: string }[];
  frameCount: number;
  matrices: ArrayLike<number>;
}
export interface PedRootMotionPreparationOptions {
  /** Installed BrMemAllocate526c00 zeroes frame storage. ReadMove leaves
   * unmatched FORM roots at zero; strict parser/math callers opt in explicitly. */
  missingRoot?: "reject" | "native-zero";
}
/** Build native movement root bases and per-frame deltas, including frame0 resets. */
export function buildPedRootMotion(
  motion: PedRootMotionInput,
  rootName: string,
  resetAxes = "",
  options: PedRootMotionPreparationOptions = {},
): Float32Array[] {
  const count = motion.bones.length,
    frames = motion.frameCount,
    root = motion.bones.findIndex((b) => b.name === rootName);
  if (
    !count ||
    count > 256 ||
    (root < 0 && options.missingRoot !== "native-zero") ||
    (options.missingRoot !== undefined &&
      options.missingRoot !== "reject" &&
      options.missingRoot !== "native-zero") ||
    !Number.isInteger(frames) ||
    frames < 1 ||
    frames > 20000 ||
    motion.matrices.length !== count * frames * 12 ||
    !/^[XYZ]*$/.test(resetAxes)
  )
    throw new Error("PED: invalid root motion");
  const result: Float32Array[] = [],
    accumulated = [0, 0, 0];
  let previous: PedVector = [0, 0, 0];
  for (let i = 0; i < frames; i++) {
    if (root < 0) {
      // Do not normalize this zero allocation (which would invent an identity
      // fallback) or substitute the first exporter bone under another name.
      result.push(new Float32Array(12));
      continue;
    }
    const at = (i * count + root) * 12,
      raw = Array.from({ length: 12 }, (_, j) => motion.matrices[at + j]);
    const pose = lpNormalisePedMatrix(flipPedExportMatrix(raw)),
      position: PedVector = [pose[9], pose[10], pose[11]];
    if (i)
      for (let j = 0; j < 3; j++) {
        pose[9 + j] = f(position[j] - previous[j]);
        accumulated[j] = f(accumulated[j] + pose[9 + j]);
      }
    previous = position;
    result.push(pose);
  }
  for (let j = 0; j < 3; j++)
    result[0][9 + j] = resetAxes.includes("XYZ"[j])
      ? -accumulated[j]
      : frames > 1
        ? result[1][9 + j]
        : 0;
  return result;
}
/** SetCharacterBonePositions root basis product, with explicit world origin. */
export function composePedRootPose(
  frame: ArrayLike<number>,
  orientation: ArrayLike<number>,
  position: PedVector,
): Float32Array {
  const a = matrix(frame),
    b = matrix(orientation),
    p = checkedVector(position),
    out = new Float32Array(12);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      out[i * 3 + j] = f(
        finite(
          a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j],
        ),
      );
  out.set(p, 9);
  return out;
}
export function transformPedPoint(
  pose: ArrayLike<number>,
  point: PedVector,
): PedVector {
  const a = matrix(pose),
    p = checkedVector(point);
  return [0, 1, 2].map((j) =>
    f(finite(a[9 + j] + p[0] * a[j] + p[1] * a[3 + j] + p[2] * a[6 + j])),
  ) as [number, number, number];
}

function dot(a: PedVector, b: PedVector): number {
  return f(finite(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
}
function planeProjection(p: PedVector, normal: PedVector): PedVector {
  const k = f(-dot(normal, p));
  return [0, 1, 2].map((i) => f(p[i] + f(k * normal[i]))) as [
    number,
    number,
    number,
  ];
}
function orthogonalAxis(a: PedVector, b: PedVector, safe: boolean): PedVector {
  const axis = cross(a, b);
  if (axis.every((n) => Math.abs(n) < 2.384185791015625e-6)) {
    let unit: PedVector;
    if (safe) {
      const p = a.map(Math.abs);
      unit =
        p[0] <= p[1] && p[0] <= p[2]
          ? [1, 0, 0]
          : p[1] <= p[0] && p[1] <= p[2]
            ? [0, 1, 0]
            : [0, 0, 1];
    } else unit = Math.abs(a[0]) <= Math.abs(a[2]) ? [1, 0, 0] : [0, 0, 1];
    return cross(a, unit);
  }
  return axis;
}
/** DRMatrix34RotateCos 40aed0: positive sine branch and clamped cosine. */
export function rotatePedMatrixCos(
  axisInput: PedVector,
  cosine: number,
): Float32Array {
  const [x, y, z] = checkedVector(axisInput),
    c = Math.max(-1, Math.min(1, f(finite(cosine)))),
    s = f(Math.sqrt(1 - c * c)),
    k = 1 - c;
  return matrix([
    x * x * k + c,
    x * y * k + z * s,
    x * z * k - y * s,
    x * y * k - z * s,
    y * y * k + c,
    y * z * k + x * s,
    x * z * k + y * s,
    y * z * k - x * s,
    z * z * k + c,
    0,
    0,
    0,
  ]);
}
function multiplyPedMatrices(
  left: ArrayLike<number>,
  right: ArrayLike<number>,
): Float32Array {
  const a = matrix(left),
    b = matrix(right),
    out = composePedRootPose(a, b, [0, 0, 0]);
  out.set(transformPedPoint(b, [a[9], a[10], a[11]]), 9);
  return out;
}
export interface PedOrientation {
  orientation: Float32Array;
  movement: Float32Array;
  direction: PedVector;
  up: PedVector;
}
/** SetCharacterDirection 40a730; sourceDirection is move+40, not the root's X axis. */
export function buildPedOrientation(
  directionInput: PedVector,
  upInput: PedVector | null,
  sourceDirectionInput: PedVector,
): PedOrientation {
  const direction = normalise(checkedVector(directionInput)),
    up =
      upInput === null
        ? ([0, 1, 0] as const)
        : normalise(checkedVector(upInput)),
    source = checkedVector(sourceDirectionInput);
  const targetOnPlane = normalise(planeProjection(direction, up)),
    sourceOnPlane = normalise(planeProjection(source, up));
  const yaw = rotatePedMatrixCos(
    normalise(orthogonalAxis(sourceOnPlane, targetOnPlane, false)),
    dot(targetOnPlane, sourceOnPlane),
  );
  // Installed 40acc1..40ad1a differs from rec2's reconstructed component order.
  const tilt = rotatePedMatrixCos(normalise([up[2], 0, -up[0]]), up[1]);
  const orientation = multiplyPedMatrices(tilt, yaw);
  const pitch = rotatePedMatrixCos(
    normalise(orthogonalAxis(targetOnPlane, direction, true)),
    dot(targetOnPlane, direction),
  );
  return {
    orientation,
    movement: multiplyPedMatrices(orientation, pitch),
    direction,
    up,
  };
}
/** ReadMove source direction and stationary flag, after authored reset handling. */
export function pedRootMotionDirection(
  frames: readonly Float32Array[],
  authoredDirection: PedVector,
  resetAxes = "",
): {
  sourceDirection: PedVector;
  movementDirection: PedVector;
  stationary: boolean;
} {
  if (!frames.length || frames.length > 20000 || !/^[XYZ]*$/.test(resetAxes))
    throw new Error("PED: invalid motion direction input");
  const total = [0, 0, 0];
  for (const input of frames.slice(1)) {
    const frame = matrix(input);
    for (let i = 0; i < 3; i++) total[i] = f(finite(total[i] + frame[9 + i]));
  }
  const first = matrix(frames[0]);
  for (let i = 0; i < 3; i++)
    total[i] = resetAxes.includes("XYZ"[i])
      ? 0
      : f(finite(total[i] + first[9 + i]));
  const authored = checkedVector(authoredDirection),
    nonzero = authored.some((n) => n !== 0),
    moving = total.some((n) => n !== 0) && !resetAxes.includes("X");
  const movementDirection: PedVector = moving
    ? normalise(total as [number, number, number])
    : [0, 0, 0];
  return {
    sourceDirection: nonzero
      ? normalise(authored)
      : moving
        ? movementDirection
        : [0, 0, 1],
    movementDirection,
    stationary: !moving,
  };
}
/** Preserve the current animation basis and origin across a direction change. */
export function reorientPedRootPose(
  currentPose: ArrayLike<number>,
  oldOrientation: ArrayLike<number>,
  nextOrientation: ArrayLike<number>,
): Float32Array {
  const pose = matrix(currentPose),
    old = matrix(oldOrientation),
    next = matrix(nextOrientation),
    inverse = new Float32Array(12);
  const a = [old[0], old[1], old[2]] as const,
    b = [old[3], old[4], old[5]] as const,
    c = [old[6], old[7], old[8]] as const;
  const u = cross(b, c),
    v = cross(c, a),
    w = cross(a, b),
    det = a[0] * u[0] + a[1] * u[1] + a[2] * u[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-20)
    throw new Error("PED: singular orientation");
  if (
    old[9] !== 0 ||
    old[10] !== 0 ||
    old[11] !== 0 ||
    next[9] !== 0 ||
    next[10] !== 0 ||
    next[11] !== 0
  )
    throw new Error("PED: orientation must have zero translation");
  for (let j = 0; j < 3; j++) {
    inverse[j * 3] = f(u[j] / det);
    inverse[j * 3 + 1] = f(v[j] / det);
    inverse[j * 3 + 2] = f(w[j] / det);
  }
  const position: PedVector = [pose[9], pose[10], pose[11]];
  pose.fill(0, 9);
  const result = lpNormalisePedMatrix(
    multiplyPedMatrices(multiplyPedMatrices(pose, inverse), next),
  );
  result.set(position, 9);
  return result;
}
/** Scale the frame's root delta in model units and rotate it by character+5c. */
export function stepPedRootPose(
  currentPose: ArrayLike<number>,
  frame: ArrayLike<number>,
  orientation: ArrayLike<number>,
  movement: ArrayLike<number>,
  scale: number,
  translate = true,
): Float32Array {
  const old = matrix(currentPose),
    source = matrix(frame),
    k = f(finite(scale));
  let position: PedVector = [old[9], old[10], old[11]];
  if (translate) {
    const rotation = matrix(movement);
    rotation.fill(0, 9);
    const delta = transformPedPoint(rotation, [
      f(source[9] * k),
      f(source[10] * k),
      f(source[11] * k),
    ]);
    position = [
      f(old[9] + delta[0]),
      f(old[10] + delta[1]),
      f(old[11] + delta[2]),
    ];
  }
  return composePedRootPose(source, orientation, position);
}
/** SetOnGroundVector/SetCharacterPosition(mode1); offset is not scale multiplied. */
export function groundPedRootOrigin(
  position: PedVector,
  groundY: number,
  groundingOffset: number,
): PedVector {
  const p = checkedVector(position);
  return [
    p[0],
    f(finite(f(finite(groundY)) + f(finite(groundingOffset)))),
    p[2],
  ];
}
export interface PedAnimationClock {
  frame: number;
  fraction: number;
  lastTimeMs: number;
  periodMs: number;
}
/** Non-morph clock only; caller dispatches end-of-move and replay callbacks. */
export function advancePedAnimationClock(
  clock: PedAnimationClock,
  timeMs: number,
): {
  advance: number;
  fraction: number;
  lastTimeMs: number;
  initialPose: boolean;
} {
  if (
    !Number.isInteger(clock.frame) ||
    clock.frame < 0 ||
    clock.frame > 32767 ||
    !Number.isInteger(clock.periodMs) ||
    clock.periodMs < -32768 ||
    clock.periodMs > 32767 ||
    !Number.isInteger(timeMs) ||
    timeMs < 0 ||
    timeMs > 0xffffffff ||
    !Number.isInteger(clock.lastTimeMs) ||
    clock.lastTimeMs < 0 ||
    clock.lastTimeMs > 0xffffffff ||
    clock.fraction < 0 ||
    clock.fraction >= 1
  )
    throw new Error("PED: invalid animation clock");
  const fraction = f(finite(clock.fraction));
  if (clock.periodMs === 0 || clock.lastTimeMs === 0)
    return {
      advance: 0,
      fraction,
      lastTimeMs: timeMs,
      initialPose: clock.periodMs !== 0 && clock.lastTimeMs === 0,
    };
  const delta = (timeMs - clock.lastTimeMs) | 0,
    target =
      clock.frame +
      fraction +
      Math.max(-10, Math.min(10, delta / clock.periodMs)),
    integral = Math.floor(target);
  return {
    advance: integral - clock.frame,
    fraction: f(target - integral),
    lastTimeMs: timeMs,
    initialPose: false,
  };
}
