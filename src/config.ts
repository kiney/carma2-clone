/** Parsers for the readable configuration text embedded in Carmageddon 2 assets. */

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export interface TrackConfig {
  version: number | null;
  start: Vec3 | null;
  heading: number | null;
  checkpoints: Array<{ points: Vec3[]; timerIncrement: Vec3 | null }>;
  /** The geometry config describes gates but race rules (including laps) live in RACES.TXT. */
  laps: number | null;
  timeLimit: number | null;
  textureArchive?: string;
  sky?: string;
  skySettings?: {
    repeat: number;
    verticalDegrees: number;
    horizonPixel: number;
  };
  depthCue?: { mode: string; strength: Vec2; color: Vec3 };
  globalLighting?: {
    directionalColor: Vec3;
    ambientDiffuse: [Vec2, Vec2, Vec2];
  };
  mapTexture?: string;
  pathNodes: Vec3[];
  pathEdges: Array<[number, number]>;
  /** C2 opponent navigation sections, including authored directional speeds. */
  pathSections: TrackPathSection[];
  assetReferences: string[];
}

export interface TrackPathSection {
  nodeIndices: [number, number];
  minSpeed: [number, number];
  maxSpeed: [number, number];
  width: number;
  type: number;
  oneWay: boolean;
}

export interface CarWheelConfig {
  name?: string;
  actor?: string;
  position: Vec3;
  steerable?: boolean;
  driven?: boolean;
  frictionAngles?: Vec2;
}

export interface CarConfig {
  version: number | null;
  name?: string;
  softness: number | null;
  mass: number | null;
  dimensions: Vec3 | null;
  wheelbase: number | null;
  minimumTurningCircle: number | null;
  brakeMultiplier: number | null;
  brakingStrengthMultiplier: number | null;
  gears: number | null;
  speedAtRedline: number | null;
  acceleration: number | null;
  downforceBalanceSpeed: number | null;
  wheels: CarWheelConfig[];
  assetReferences: string[];
}

export type RaceType =
  | "carma"
  | "cars"
  | "peds"
  | "checkpoints"
  | "smash"
  | "smashAndPed"
  | number;

export interface RaceCatalogEntry {
  name: string;
  raceFilename: string;
  interfaceElement: string;
  numberOfOpponents: number;
  explicitOpponents: number[];
  opponentNastinessLevel: number;
  powerupExclusions: number[];
  disableTimeAwards: boolean;
  mission: boolean;
  raceType: RaceType;
  initialTimer: Vec3;
  laps: number | null;
  numberOfOpponentsToKill: number | null;
  opponentsToKill: number[];
  numberOfPedGroupsToKill: number | null;
  pedGroupsToKill: number[];
  smashVariable: number | null;
  smashTarget: number | null;
  description: string;
  expansion: number;
  raceCompletedBonus: Vec3[];
}

export interface RaceCatalog {
  raceToStartNewGameWith: number;
  firstRaceDefaults: {
    numberOfOpponents: number;
    softnessHardness: Vec2;
    nastinessInfluencer: number;
  };
  lastRaceDefaults: {
    numberOfOpponents: number;
    softnessHardness: Vec2;
    nastinessInfluencer: number;
  };
  races: RaceCatalogEntry[];
}

export interface OpponentConfig {
  driverName: string;
  driverShortName: string;
  carName: string;
  strengthRating: number;
  costToBuy: number;
  networkAvailability: string;
  carFilename: string;
  topSpeed: string;
  kerbWeight: string;
  to60: string;
  bio: string;
}

function cleanLine(line: string): string {
  return line.replace(/\/\/.*$/, "").trim();
}

function numericValues(line: string): number[] {
  const clean = cleanLine(line);
  if (!clean || !/^[\s+\-.,\dEe]+$/.test(clean)) return [];
  return clean
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);
}

function asVec3(values: number[]): Vec3 | null {
  return values.length >= 3 ? [values[0], values[1], values[2]] : null;
}

function firstDataLine(
  lines: string[],
  from: number,
): { line: string; index: number } | null {
  for (let i = from; i < lines.length; i++) {
    const line = cleanLine(lines[i]);
    if (line) return { line, index: i };
  }
  return null;
}

function readVecAt(
  lines: string[],
  from: number,
): { value: Vec3 | null; index: number } | null {
  const next = firstDataLine(lines, from);
  if (!next) return null;
  return { value: asVec3(numericValues(next.line)), index: next.index };
}

function numericDataAfter(
  lines: string[],
  from: number,
  limit = lines.length,
): Array<{ values: number[]; index: number }> {
  const out: Array<{ values: number[]; index: number }> = [];
  for (let index = from; index < limit; index++) {
    const values = numericValues(lines[index]);
    if (values.length) out.push({ values, index });
  }
  return out;
}

function parseGateBlocks(
  lines: string[],
  count: number,
  from: number,
): TrackConfig["checkpoints"] {
  const gates: TrackConfig["checkpoints"] = [];
  let cursor = from;
  for (let gate = 0; gate < count; gate++) {
    const timer = readVector(lines, cursor, 3);
    if (!timer) break;
    const quadCount = readNumber(lines, timer.index + 1);
    if (
      !quadCount ||
      !Number.isInteger(quadCount.value) ||
      quadCount.value < 0 ||
      quadCount.value > 100
    )
      break;
    const points: Vec3[] = [];
    cursor = quadCount.index + 1;
    let complete = true;
    for (let quad = 0; quad < quadCount.value; quad++) {
      for (let point = 0; point < 4; point++) {
        const found = readVector(lines, cursor, 3);
        if (!found) {
          complete = false;
          break;
        }
        points.push([found.value[0], found.value[1], found.value[2]]);
        cursor = found.index + 1;
      }
      if (!complete) break;
    }
    gates.push({
      points,
      timerIncrement: [timer.value[0], timer.value[1], timer.value[2]],
    });
    if (!complete) break;
  }
  return gates;
}

function collectAssetReferences(text: string): string[] {
  const refs = new Set<string>();
  for (const match of text.matchAll(
    /(?:^|[\s,])([&!]?[^\s,<>"']+\.(?:ACT|DAT|MAT|PIX|TIF|TXT|WAM|SDF|TAB|BON|SKL))\b/gi,
  )) {
    refs.add(match[1].replace(/^[&!]/, ""));
  }
  return [...refs];
}

/** Parse track source such as `AcidReign.txt` or the readable text in a race TWT. */
export function parseTrackConfig(text: string): TrackConfig {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const raw = (pattern: RegExp): { value: string; index: number } | null => {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(pattern);
      if (m) return { value: m[1], index: i };
    }
    return null;
  };
  const versionMatch = raw(/^\s*VERSION\s+([\d.]+)/i);
  const startMatch = raw(
    /^\s*(.*?)\s*\/\/\s*Position of centre of start of grid/i,
  );
  const headingMatch = raw(/^\s*(.*?)\s*\/\/\s*Direction that grid faces in/i);
  const startInline = startMatch ? numericValues(startMatch.value) : [];
  const start = startMatch
    ? asVec3(
        startInline.length
          ? startInline
          : numericValues(
              firstDataLine(lines, startMatch.index + 1)?.line ?? "",
            ),
      )
    : null;
  const headingInline = headingMatch ? numericValues(headingMatch.value) : [];
  const headingValues = headingMatch
    ? headingInline.length
      ? headingInline
      : numericValues(firstDataLine(lines, headingMatch.index + 1)?.line ?? "")
    : [];
  let checkpoints: TrackConfig["checkpoints"] = [];
  const cpMarker = /^\s*\/\/\s*Checkpoint\s+#?\d+/i;
  for (let i = 0; i < lines.length; i++) {
    if (!cpMarker.test(lines[i])) continue;
    const timerLine = firstDataLine(lines, i + 1);
    if (!timerLine) break;
    const timer = numericValues(timerLine.line);
    const quadLine = readNumber(lines, timerLine.index + 1);
    if (
      !quadLine ||
      !Number.isInteger(quadLine.value) ||
      quadLine.value < 0 ||
      quadLine.value > 100
    )
      continue;
    const one = parseGateBlocks(lines, 1, timerLine.index);
    if (one.length) checkpoints.push(one[0]);
  }

  // Older or differently encoded track files may not retain descriptive comments.
  // In those files the fixed header is four lighting vectors, grid position,
  // heading, checkpoint count, then each timer/count/quad sequence.
  const versionIndex = lines.findIndex((line) =>
    /^\s*VERSION\s+[\d.]+/i.test(line),
  );
  const lapMarker = lines.findIndex((line) =>
    /Laps,\s*checkpoints/i.test(line),
  );
  const checkpointCountLine =
    lapMarker >= 0 ? readNumber(lines, lapMarker + 1) : null;
  const sequentialHeader = numericDataAfter(
    lines,
    versionIndex + 1,
    lapMarker >= 0 ? lapMarker : undefined,
  );
  const sequentialStartValues =
    sequentialHeader.length >= 5 ? sequentialHeader[4].values : [];
  const sequentialHeading = sequentialHeader[5]?.values[0];
  const sequentialCount =
    checkpointCountLine?.value ?? sequentialHeader[6]?.values[0];
  const sequentialGateCursor = checkpointCountLine
    ? checkpointCountLine.index + 1
    : sequentialHeader[6]?.index !== undefined
      ? sequentialHeader[6].index + 1
      : -1;
  const fallbackStart = asVec3(sequentialStartValues);
  const startPosition = start ?? fallbackStart;
  const heading = headingValues.length ? headingValues[0] : sequentialHeading;
  if (
    (checkpoints.length === 0 ||
      (lapMarker >= 0 &&
        Number.isInteger(sequentialCount) &&
        (sequentialCount as number) > checkpoints.length)) &&
    Number.isInteger(sequentialCount) &&
    (sequentialCount as number) >= 0 &&
    sequentialGateCursor >= 0
  ) {
    const sequentialGates = parseGateBlocks(
      lines,
      sequentialCount as number,
      sequentialGateCursor,
    );
    if (sequentialGates.length > checkpoints.length)
      checkpoints = sequentialGates;
  }

  const pathNodes: Vec3[] = [];
  const pathEdges: Array<[number, number]> = [];
  const pathSections: TrackPathSection[] = [];
  const pathStart = lines.findIndex((line) =>
    /^\s*START OF OPPONENT PATHS\s*$/i.test(line),
  );
  if (pathStart >= 0) {
    const nodeCountLine = firstDataLine(lines, pathStart + 1);
    const nodeCount = nodeCountLine
      ? numericValues(nodeCountLine.line)[0]
      : NaN;
    if (
      !nodeCountLine ||
      numericValues(nodeCountLine.line).length !== 1 ||
      !Number.isInteger(nodeCount) ||
      nodeCount < 0 ||
      nodeCount > 0x10000
    )
      throw new Error("Track opponent paths have an invalid node count");
    let cursor = nodeCountLine.index + 1;
    for (let i = 0; i < nodeCount; i++) {
      const nodeLine = firstDataLine(lines, cursor);
      const values = nodeLine ? numericValues(nodeLine.line) : [];
      if (!nodeLine || values.length !== 3)
        throw new Error(
          `Track opponent path node ${i} is missing or malformed`,
        );
      const position = values.map(Math.fround);
      if (position.some((value) => !Number.isFinite(value)))
        throw new Error(`Track opponent path node ${i} exceeds Float32 range`);
      pathNodes.push(position as Vec3);
      cursor = nodeLine.index + 1;
    }

    const sectionCountLine = firstDataLine(lines, cursor);
    const sectionCount = sectionCountLine
      ? numericValues(sectionCountLine.line)[0]
      : NaN;
    if (
      !sectionCountLine ||
      numericValues(sectionCountLine.line).length !== 1 ||
      !Number.isInteger(sectionCount) ||
      sectionCount < 0 ||
      sectionCount >= 100000
    )
      throw new Error("Track opponent paths have an invalid section count");
    cursor = sectionCountLine.index + 1;
    const u8 = (value: number) => Math.trunc(value) & 0xff;
    for (let i = 0; i < sectionCount; i++) {
      const sectionLine = firstDataLine(lines, cursor);
      const values = sectionLine
        ? numericValues(sectionLine.line).map(Math.fround)
        : [];
      if (!sectionLine || values.length !== 8)
        throw new Error(
          `Track opponent path section ${i} is missing or malformed`,
        );
      if (values.some((value) => !Number.isFinite(value)))
        throw new Error(
          `Track opponent path section ${i} exceeds Float32 range`,
        );
      const [rawNode0, rawNode1, min0, max0, min1, max1, rawWidth, rawType] =
        values;
      const node0 = Math.trunc(rawNode0),
        node1 = Math.trunc(rawNode1);
      if (
        rawNode0 < 0 ||
        rawNode1 < 0 ||
        rawNode0 > 0xffff ||
        rawNode1 > 0xffff ||
        node0 >= pathNodes.length ||
        node1 >= pathNodes.length
      )
        throw new Error(
          `Track opponent path section ${i} references an invalid node`,
        );
      const oneWay = rawType >= 1000;
      const type = u8(oneWay ? Math.fround(rawType - 1000) : rawType);
      const width = rawWidth;
      const section: TrackPathSection = {
        nodeIndices: [node0, node1],
        minSpeed: [u8(min0), u8(min1)],
        maxSpeed: [u8(max0), u8(max1)],
        width,
        type,
        oneWay,
      };
      pathSections.push(section);
      pathEdges.push(section.nodeIndices);
      cursor = sectionLine.index + 1;
    }
    if (
      !lines
        .slice(cursor)
        .some((line) => /^\s*END OF OPPONENT PATHS\s*$/i.test(line))
    )
      throw new Error("Track opponent path block is truncated");
  }

  const skyMarker = lines.findIndex((line) =>
    /\/\/\s*HORIZON STUFF/i.test(line),
  );
  const skyLine = skyMarker >= 0 ? firstDataLine(lines, skyMarker + 1) : null;
  const sky = skyLine?.line;
  const skyNumbers =
    skyMarker >= 0
      ? numericDataAfter(lines, skyLine ? skyLine.index + 1 : skyMarker + 1)
      : [];
  const skySettings =
    skyNumbers.length >= 3
      ? {
          repeat: skyNumbers[0].values[0],
          verticalDegrees: skyNumbers[1].values[0],
          horizonPixel: skyNumbers[2].values[0],
        }
      : undefined;
  const depthCueModeLine = skySettings
    ? firstDataLine(lines, skyNumbers[2].index + 1)
    : null;
  const depthCueNumbers =
    skySettings && depthCueModeLine
      ? numericDataAfter(lines, depthCueModeLine.index + 1)
      : [];
  const depthCue =
    depthCueModeLine &&
    depthCueNumbers.length >= 2 &&
    depthCueNumbers[0].values.length >= 2 &&
    depthCueNumbers[1].values.length >= 3
      ? {
          mode: depthCueModeLine.line.toLowerCase(),
          strength: [
            depthCueNumbers[0].values[0],
            depthCueNumbers[0].values[1],
          ] as Vec2,
          color: [
            depthCueNumbers[1].values[0],
            depthCueNumbers[1].values[1],
            depthCueNumbers[1].values[2],
          ] as Vec3,
        }
      : undefined;
  const lightRows = sequentialHeader;
  const globalLighting =
    lightRows.length >= 4 &&
    lightRows[0].values.length >= 3 &&
    lightRows[1].values.length >= 2 &&
    lightRows[2].values.length >= 2 &&
    lightRows[3].values.length >= 2
      ? {
          directionalColor: [
            lightRows[0].values[0],
            lightRows[0].values[1],
            lightRows[0].values[2],
          ] as Vec3,
          ambientDiffuse: [
            [lightRows[1].values[0], lightRows[1].values[1]],
            [lightRows[2].values[0], lightRows[2].values[1]],
            [lightRows[3].values[0], lightRows[3].values[1]],
          ] as [Vec2, Vec2, Vec2],
        }
      : undefined;
  const mapMarker = lines.findIndex((line) => /\/\/\s*MAP DETAILS/i.test(line));
  let mapTexture: string | undefined;
  if (mapMarker >= 0) {
    const mapCandidate = firstDataLine(lines, mapMarker + 1)?.line;
    if (mapCandidate && /\.PIX\b/i.test(mapCandidate))
      mapTexture = mapCandidate.split(/[\s,]+/)[0];
  }
  // Track laps and overall race time are stored in RACES.TXT, so the geometry
  // parser leaves these null unless a future source version supplies them.
  return {
    version: versionMatch ? Number(versionMatch.value) : null,
    start: startPosition,
    heading: heading ?? null,
    checkpoints,
    laps: null,
    timeLimit: null,
    ...(sky ? { sky } : {}),
    ...(skySettings ? { skySettings } : {}),
    ...(depthCue ? { depthCue } : {}),
    ...(globalLighting ? { globalLighting } : {}),
    ...(mapTexture ? { mapTexture } : {}),
    pathNodes,
    pathEdges,
    pathSections,
    assetReferences: collectAssetReferences(text),
  };
}

function readNumber(
  lines: string[],
  from: number,
): { value: number; index: number } | null {
  for (let index = from; index < lines.length; index++) {
    const values = numericValues(lines[index]);
    if (values.length) return { value: values[0], index };
  }
  return null;
}

function readVector(
  lines: string[],
  from: number,
  n: number,
): { value: number[]; index: number } | null {
  for (let index = from; index < lines.length; index++) {
    const values = numericValues(lines[index]);
    if (values.length >= n) return { value: values.slice(0, n), index };
  }
  return null;
}

/** Parse useful vehicle physics from the `START OF MECHANICS STUFF` section. */
export function parseCarConfig(text: string): CarConfig {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const findMarker = (regex: RegExp): number =>
    lines.findIndex((line) => regex.test(line));
  const version = lines.join("\n").match(/^\s*VERSION\s+([\d.]+)/im);
  const nameLine = firstDataLine(lines, 1)?.line;
  const softnessMarker = findMarker(/softness(?:_factor)?\b/i);
  const softnessLine = softnessMarker >= 0 ? lines[softnessMarker] : "";
  const softnessInline = softnessLine.match(
    /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?)/,
  );
  const softness = softnessInline
    ? Number(softnessInline[1])
    : softnessMarker >= 0
      ? (readNumber(lines, softnessMarker + 1)?.value ?? null)
      : null;
  const mechanics = findMarker(/START OF MECHANICS STUFF/i);
  const endMechanics = findMarker(/END OF MECHANICS STUFF/i);
  const valueAtMarker = (marker: number): number | null => {
    if (marker < 0) return null;
    const prefix = lines[marker].split("//", 1)[0];
    const inline = numericValues(prefix);
    return inline.length
      ? inline[0]
      : (readNumber(lines, marker + 1)?.value ?? null);
  };
  let turn: number | null = null;
  let brake: number | null = null;
  let brakeStrength: number | null = null;
  let gears: number | null = null;
  let speed: number | null = null;
  let acceleration: number | null = null;
  let mass: number | null = null;
  let downforce: number | null = null;
  const wheels: CarWheelConfig[] = [];
  let dimensions: Vec3 | null = null;
  let wheelbase: number | null = null;
  if (mechanics >= 0) {
    let cursor = mechanics + 1;
    // The mechanics preamble has a stable field order but variable comments.
    const readNextNumber = (): number | null => {
      const found = readNumber(lines, cursor);
      if (!found || (endMechanics >= 0 && found.index >= endMechanics))
        return null;
      cursor = found.index + 1;
      return found.value;
    };
    turn = readNextNumber();
    brake = readNextNumber();
    brakeStrength = readNextNumber();
    gears = readNextNumber();
    speed = readNextNumber();
    acceleration = readNextNumber();
    const massMarker = findMarker(/\/\/\s*Mass\b/i);
    mass = valueAtMarker(massMarker);
    const downforceMarker = findMarker(/Downforce-to-weight balance speed/i);
    downforce = valueAtMarker(downforceMarker);
    const wheelCountMarker = findMarker(/Number of ['"]?Wheels['"]? entries/i);
    const wheelCount = valueAtMarker(wheelCountMarker);
    const wheelCountResult =
      wheelCount === null
        ? null
        : { value: wheelCount, index: wheelCountMarker };
    if (
      wheelCountResult &&
      Number.isInteger(wheelCountResult.value) &&
      wheelCountResult.value >= 0 &&
      wheelCountResult.value < 64
    ) {
      let index = wheelCountResult.index + 1;
      for (let wi = 0; wi < wheelCountResult.value; wi++) {
        const marker = lines.findIndex(
          (line, i) => i >= index && /Wheels entry\s*#\d+/i.test(line),
        );
        if (marker < 0) break;
        const nextMarker = lines.findIndex(
          (line, i) =>
            i > marker &&
            /Wheels entry\s*#\d+|Number of ['"]?Bounding shapes/i.test(line),
        );
        const end =
          nextMarker < 0
            ? endMechanics >= 0
              ? endMechanics
              : lines.length
            : nextMarker;
        const rawBlock = lines.slice(marker, end);
        const blockData = rawBlock.map(cleanLine).filter(Boolean);
        const positionIndex = blockData.findIndex(
          (line) => numericValues(line).length >= 3,
        );
        const position =
          positionIndex >= 0 ? numericValues(blockData[positionIndex]) : [];
        const angle = blockData
          .map(numericValues)
          .find(
            (values) =>
              values.length === 2 &&
              values[0] > 40 &&
              values[0] < 100 &&
              values[1] > 40 &&
              values[1] < 100,
          );
        if (position.length >= 3) {
          const actorIndex = blockData.findIndex((line) =>
            /\.ACT\b/i.test(line),
          );
          const actor = actorIndex >= 0 ? blockData[actorIndex] : undefined;
          const wheelName =
            actorIndex > 0
              ? blockData
                  .slice(0, actorIndex)
                  .reverse()
                  .find((line) => !numericValues(line).length)
              : undefined;
          const followingNumbers = blockData
            .slice(positionIndex + 1)
            .map(numericValues)
            .filter((values) => values.length > 0)
            .map((values) => values[0]);
          const flags = followingNumbers.slice(0, 2);
          wheels.push({
            ...(wheelName ? { name: wheelName } : {}),
            ...(actor ? { actor } : {}),
            position: [position[0], position[1], position[2]],
            ...(flags.length >= 2
              ? { steerable: flags[0] === 1, driven: flags[1] === 1 }
              : {}),
            ...(angle ? { frictionAngles: [angle[0], angle[1]] } : {}),
          });
        }
        index = end;
      }
    }
    // The bounding polyhedron provides reliable collision dimensions.
    const boundsMarker = findMarker(
      /Bounding shapes?\s+entry|Bounding shape:/i,
    );
    if (boundsMarker >= 0) {
      const countLine = readNumber(lines, boundsMarker + 1);
      const count = countLine?.value;
      if (
        countLine &&
        Number.isInteger(count) &&
        count! > 0 &&
        count! < 10000
      ) {
        const mins = [Infinity, Infinity, Infinity];
        const maxs = [-Infinity, -Infinity, -Infinity];
        let at = countLine.index + 1;
        for (let i = 0; i < count!; i++) {
          const point = readVector(lines, at, 3);
          if (!point) break;
          for (let axis = 0; axis < 3; axis++) {
            mins[axis] = Math.min(mins[axis], point.value[axis]);
            maxs[axis] = Math.max(maxs[axis], point.value[axis]);
          }
          at = point.index + 1;
        }
        if (mins.every(Number.isFinite) && maxs.every(Number.isFinite))
          dimensions = [
            maxs[0] - mins[0],
            maxs[1] - mins[1],
            maxs[2] - mins[2],
          ];
      }
    }
    if (wheels.length >= 2) {
      const z = wheels.map((wheel) => wheel.position[2]);
      wheelbase = Math.max(...z) - Math.min(...z);
    }
  }
  return {
    version: version ? Number(version[1]) : null,
    ...(nameLine && /\.TXT\b/i.test(nameLine)
      ? { name: nameLine.split(/[\s,]+/)[0] }
      : {}),
    softness,
    mass,
    dimensions,
    wheelbase,
    minimumTurningCircle: turn,
    brakeMultiplier: brake,
    brakingStrengthMultiplier: brakeStrength,
    gears,
    speedAtRedline: speed,
    acceleration,
    downforceBalanceSpeed: downforce,
    wheels,
    assetReferences: collectAssetReferences(text),
  };
}

function dataLines(text: string): string[] {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);
}

function parseIntLine(lines: string[], cursor: { value: number }): number {
  const line = lines[cursor.value++];
  const number = Number.parseInt(line ?? "", 10);
  if (!Number.isFinite(number))
    throw new Error(`Expected integer near line ${cursor.value}`);
  return number;
}

function parseTuple(
  lines: string[],
  cursor: { value: number },
  size: number,
): number[] {
  const line = lines[cursor.value++];
  const nums = (line ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (
    nums.length < size ||
    nums.slice(0, size).some((value) => !Number.isFinite(value))
  )
    throw new Error(`Expected ${size} numbers near line ${cursor.value}`);
  return nums.slice(0, size);
}

/** Installed LoadRaces0x48c221 terminates an exclusion list at a negative
 * index. rec2's loader map omits this check; slash is also a native delimiter. */
export function parsePowerupExclusions(line: string): number[] {
  const result: number[] = [];
  for (const token of line.split(/[\s,/]+/).filter(Boolean)) {
    const index = Number(token);
    if (!Number.isSafeInteger(index))
      throw new Error(`RACES.TXT: invalid powerup exclusion: ${token}`);
    if (index < 0) break;
    if (result.length >= 50)
      throw new Error("RACES.TXT: too many powerup exclusions");
    result.push(index);
  }
  return result;
}

/** Parse the race progression table (`RACES.TXT`), including mission/type and opponent ids. */
export function parseRaceCatalog(text: string): RaceCatalog {
  const lines = dataLines(text);
  const cursor = { value: 0 };
  const raceToStartNewGameWith = parseIntLine(lines, cursor);
  const firstNumber = parseIntLine(lines, cursor);
  const lastNumber = parseIntLine(lines, cursor);
  const firstSoft = parseTuple(lines, cursor, 2) as Vec2;
  const lastSoft = parseTuple(lines, cursor, 2) as Vec2;
  const firstNasty = Number(lines[cursor.value++]);
  const lastNasty = Number(lines[cursor.value++]);
  const races: RaceCatalogEntry[] = [];
  while (cursor.value < lines.length && lines[cursor.value] !== "END") {
    const name = lines[cursor.value++];
    if (!name) break;
    const raceFilename = lines[cursor.value++];
    const interfaceElement = lines[cursor.value++];
    const numberOfOpponents = parseIntLine(lines, cursor);
    const explicitCount = parseIntLine(lines, cursor);
    const explicitOpponents: number[] = [];
    for (let i = 0; i < Math.max(0, Math.min(explicitCount, 1000)); i++)
      explicitOpponents.push(parseIntLine(lines, cursor));
    // Installed LoadRaces reads this field as a scalar, not an integer.
    const opponentNastinessLevel = Math.fround(Number(lines[cursor.value++]));
    if (!Number.isFinite(opponentNastinessLevel))
      throw new Error("RACES.TXT: invalid opponent nastiness level");
    const exclusionLine = lines[cursor.value++] ?? "";
    const powerupExclusions = parsePowerupExclusions(exclusionLine);
    const disableTimeAwards = parseIntLine(lines, cursor) !== 0;
    const mission = parseIntLine(lines, cursor) !== 0;
    const raceTypeValue = parseIntLine(lines, cursor);
    const raceTypeNames: RaceType[] = [
      "carma",
      "cars",
      "peds",
      "checkpoints",
      "smash",
      "smashAndPed",
    ];
    const raceType: RaceType = raceTypeNames[raceTypeValue] ?? raceTypeValue;
    const initialTimer = parseTuple(lines, cursor, 3) as Vec3;
    let laps: number | null = null;
    let numberOfOpponentsToKill: number | null = null;
    let opponentsToKill: number[] = [];
    let numberOfPedGroupsToKill: number | null = null;
    let pedGroupsToKill: number[] = [];
    let smashVariable: number | null = null;
    let smashTarget: number | null = null;
    if (raceTypeValue === 0 || raceTypeValue === 3) {
      laps = parseIntLine(lines, cursor);
    } else if (raceTypeValue === 1) {
      numberOfOpponentsToKill = parseIntLine(lines, cursor);
      const count = Math.max(0, Math.min(numberOfOpponentsToKill, 1000));
      opponentsToKill = Array.from({ length: count }, () =>
        parseIntLine(lines, cursor),
      );
    } else if (raceTypeValue === 2) {
      numberOfPedGroupsToKill = parseIntLine(lines, cursor);
      const count = Math.max(0, Math.min(numberOfPedGroupsToKill, 1000));
      pedGroupsToKill = Array.from({ length: count }, () =>
        parseIntLine(lines, cursor),
      );
    } else if (raceTypeValue === 4 || raceTypeValue === 5) {
      smashVariable = parseIntLine(lines, cursor);
      smashTarget = parseIntLine(lines, cursor);
      if (raceTypeValue === 5)
        pedGroupsToKill.push(parseIntLine(lines, cursor));
    }
    const raceCompletedBonus: Vec3[] = [];
    const bonusCount = raceTypeValue === 0 ? 3 : 1;
    for (let i = 0; i < bonusCount; i++)
      raceCompletedBonus.push(parseTuple(lines, cursor, 3) as Vec3);
    const description = lines[cursor.value++] ?? "";
    const expansion = parseIntLine(lines, cursor);
    races.push({
      name,
      raceFilename,
      interfaceElement,
      numberOfOpponents,
      explicitOpponents,
      opponentNastinessLevel,
      powerupExclusions,
      disableTimeAwards,
      mission,
      raceType,
      initialTimer,
      laps,
      numberOfOpponentsToKill,
      opponentsToKill,
      numberOfPedGroupsToKill,
      pedGroupsToKill,
      smashVariable,
      smashTarget,
      description,
      expansion,
      raceCompletedBonus,
    });
  }
  if (!Number.isFinite(firstNasty) || !Number.isFinite(lastNasty))
    throw new Error("Invalid race default nastiness values");
  return {
    raceToStartNewGameWith,
    firstRaceDefaults: {
      numberOfOpponents: firstNumber,
      softnessHardness: firstSoft,
      nastinessInfluencer: firstNasty,
    },
    lastRaceDefaults: {
      numberOfOpponents: lastNumber,
      softnessHardness: lastSoft,
      nastinessInfluencer: lastNasty,
    },
    races,
  };
}

/** Parse opponent records (`OPPONENT.TXT`) into their display names and car bundle refs. */
export function parseOpponents(text: string): OpponentConfig[] {
  const lines = dataLines(text);
  const cursor = { value: 0 };
  const count = parseIntLine(lines, cursor);
  if (count < 0 || count > 10000) throw new Error("Invalid opponent count");
  const opponents: OpponentConfig[] = [];
  for (let i = 0; i < count; i++) {
    opponents.push({
      driverName: lines[cursor.value++] ?? "",
      driverShortName: lines[cursor.value++] ?? "",
      carName: lines[cursor.value++] ?? "",
      strengthRating: parseIntLine(lines, cursor),
      costToBuy: parseIntLine(lines, cursor),
      networkAvailability: lines[cursor.value++] ?? "",
      carFilename: lines[cursor.value++] ?? "",
      topSpeed: lines[cursor.value++] ?? "",
      kerbWeight: lines[cursor.value++] ?? "",
      to60: lines[cursor.value++] ?? "",
      bio: lines[cursor.value++] ?? "",
    });
  }
  return opponents;
}
