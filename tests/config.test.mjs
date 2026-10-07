import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import {
  parseCarConfig,
  parseOpponents,
  parseRaceCatalog,
  parseTrackConfig,
} from "../src/config.ts";

let originalAssetsAvailable = true;
try {
  await access(new URL("../carma2_orig", import.meta.url));
} catch {
  originalAssetsAvailable = false;
}

test("parses track start, checkpoint gates, map, and opponent path graph", () => {
  const config = `VERSION 1
255,255,255 // directional light
0.2,0.8
1.0,0.8
0.3,0.8
HORIZON
sky_dome // Name of sky texture pixelmap
// Position of centre of start of grid
12.5, 3, -4
90 // Direction that grid faces in
// Checkpoint #1
20, 10, 5 // timer per skill level
1 // number of quads
0,0,1
0,1,1
1,1,1
1,0,1
// Checkpoint #2
5, 4, 3
1
2,0,3
2,1,3
3,1,3
3,0,3
// HORIZON STUFF
skytexture
7
60
158
fog
4,0
129,103,80
// MAP DETAILS
track_map.PIX // Map pixelmap name
// ****** START OF OPPONENT PATHS ******
START OF OPPONENT PATHS
3 // Number of path nodes
0, 0, 0 // Node #0
1, 0, 1 // Node #1
2, 0, 1 // Node #2
2 // Number of path sections
0, 1, 0, 255, 0, 255, 1.0, 1
1, 2, 0, 255, 0, 255, 1.0, 1
0 // Number of cop start points
END OF OPPONENT PATHS`;

  const parsed = parseTrackConfig(config);
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.start, [12.5, 3, -4]);
  assert.equal(parsed.heading, 90);
  assert.equal(parsed.laps, null);
  assert.equal(parsed.timeLimit, null);
  assert.equal(parsed.checkpoints.length, 2);
  assert.deepEqual(parsed.checkpoints[0].timerIncrement, [20, 10, 5]);
  assert.deepEqual(parsed.checkpoints[1].points[2], [3, 1, 3]);
  assert.equal(parsed.mapTexture, "track_map.PIX");
  assert.deepEqual(parsed.globalLighting, {
    directionalColor: [255, 255, 255],
    ambientDiffuse: [
      [0.2, 0.8],
      [1, 0.8],
      [0.3, 0.8],
    ],
  });
  assert.equal(parsed.sky, "skytexture");
  assert.deepEqual(parsed.skySettings, {
    repeat: 7,
    verticalDegrees: 60,
    horizonPixel: 158,
  });
  assert.deepEqual(parsed.depthCue, {
    mode: "fog",
    strength: [4, 0],
    color: [129, 103, 80],
  });
  assert.deepEqual(parsed.pathNodes, [
    [0, 0, 0],
    [1, 0, 1],
    [2, 0, 1],
  ]);
  assert.deepEqual(parsed.pathEdges, [
    [0, 1],
    [1, 2],
  ]);
});

test("falls back to the sequential track header and gate records without comments", () => {
  const config = `VERSION 1
255,255,255
0.2,0.8
1.0,0.8
0.3,0.8
12.5,3,-4
90
1
20,10,5
1
0,0,1
0,1,1
1,1,1
1,0,1`;
  const parsed = parseTrackConfig(config);
  assert.deepEqual(parsed.start, [12.5, 3, -4]);
  assert.equal(parsed.heading, 90);
  assert.equal(parsed.checkpoints.length, 1);
  assert.deepEqual(parsed.checkpoints[0].points[3], [1, 0, 1]);
});

test("parses vehicle mechanics, bounding dimensions, and wheel geometry", () => {
  const config = `VERSION 2
EAGLE3.TXT // Name of Car
0.46 // softness
START OF MECHANICS STUFF version 1
// Minimum turning circle
0.465
1.1 // Brake multiplier
1.2 // Braking strength multiplier
4 // Number of gears
155 // Speed at red line in highest gear
4.1 // Acceleration
// Sub member: Root part
normal
none
EAGLE3.ACT
// Centre of mass
0, 0.04, 0.05
// Mass
2.34
0.32, 0.27, 0.8
50 // Downforce-to-weight balance speed
2 // Number of 'Wheels' entries
// Wheels entry #1
0
Left front
FLWHEEL.ACT
-0.5,0.1,-1
1 // Steerable
0 // Driven
0.01
1
1
83,85 // Friction angles
// Wheels entry #2
1
Right rear
RRWHEEL.ACT
0.5,0.1,1
0
1
0.01
1
1
82,84 // Friction angles
1 // Number of 'Bounding shapes' entries
// Bounding shape: this shape definition
polyhedron
4
-1,0,-2
1,0,-2
1,1,2
-1,1,2
0 // Number of sub-parts.
END OF MECHANICS STUFF`;

  const parsed = parseCarConfig(config);
  assert.equal(parsed.version, 2);
  assert.equal(parsed.name, "EAGLE3.TXT");
  assert.equal(parsed.softness, 0.46);
  assert.equal(parsed.mass, 2.34);
  assert.deepEqual(parsed.dimensions, [2, 1, 4]);
  assert.equal(parsed.wheelbase, 2);
  assert.equal(parsed.minimumTurningCircle, 0.465);
  assert.equal(parsed.gears, 4);
  assert.equal(parsed.speedAtRedline, 155);
  assert.equal(parsed.wheels.length, 2);
  assert.deepEqual(parsed.wheels[0].position, [-0.5, 0.1, -1]);
  assert.deepEqual(parsed.wheels[1].frictionAngles, [82, 84]);
});

test(
  "parses actual archived Eagle 3 car and New City track configs",
  { skip: !originalAssetsAvailable },
  async () => {
    const assets = await createAssetStore(
      new URL("../carma2_orig", import.meta.url).pathname,
    );
    const bytes = await assets.read("data/CARS/EAGLE3/EAGLE3.TXT");
    assert.ok(
      bytes,
      "Eagle 3 config should be present in the stock car bundle",
    );
    const car = parseCarConfig(decodeText(bytes));
    assert.equal(car.name, "EAGLE3.TXT");
    assert.equal(car.softness, 0.7);
    assert.equal(car.mass, 1.5);
    assert.deepEqual(car.dimensions, [0.4, 0.2, 0.78]);
    assert.equal(car.wheels.length, 4);
    assert.equal(car.wheels[0].steerable, true);
    assert.equal(car.wheels[0].driven, false);
    assert.equal(car.wheels[2].steerable, false);
    assert.equal(car.wheels[2].driven, false);

    const trackBytes = await assets.read("data/RACES/newcity1/newcity1.txt");
    assert.ok(
      trackBytes,
      "New City config should be present in the stock race bundle",
    );
    const track = parseTrackConfig(decodeText(trackBytes));
    assert.deepEqual(track.skySettings, {
      repeat: 7,
      verticalDegrees: 60,
      horizonPixel: 158,
    });
    assert.deepEqual(track.globalLighting?.directionalColor, [255, 255, 255]);
  },
);

test("parses race progression and race-specific opponent requirements", () => {
  const text = `0
5
11
0.5,3
3,6
0.8
5
NICE BEAVER
NEWCITY1.TXT
NotDoneYet
-1
0
-1
-1
0
0
0
120,90,60
4
20000,10000,5000
75000,50000,30000
20000,10000,5000
LOCATION: BEAVER CITY
0
SMASH CARS
JUNKYARD.TXT
Done
2
2
7
1
1
-1
0
0
1
120,90,60
1
7
8000,4000,2000
Destroy the required opponents
0
END`;

  const parsed = parseRaceCatalog(text);
  assert.equal(parsed.races.length, 2);
  assert.equal(parsed.firstRaceDefaults.numberOfOpponents, 5);
  assert.equal(parsed.lastRaceDefaults.nastinessInfluencer, 5);
  assert.equal(parsed.races[0].name, "NICE BEAVER");
  assert.equal(parsed.races[0].raceType, "carma");
  assert.equal(parsed.races[0].laps, 4);
  assert.deepEqual(parsed.races[0].initialTimer, [120, 90, 60]);
  assert.equal(parsed.races[1].raceType, "cars");
  assert.deepEqual(parsed.races[1].explicitOpponents, [7, 1]);
  assert.deepEqual(parsed.races[1].opponentsToKill, [7]);
});

test("parses opponent records with car bundle references", () => {
  const parsed = parseOpponents(`1
Max Damage
Max
Eagle 3
-1
50000
eagle
EAGLE3.TXT
TOP SPEED: 200MPH
KERB WEIGHT: 1.5 TONS
0-60MPH: 3.4 SECONDS
The Eagle is back.
END`);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].driverName, "Max Damage");
  assert.equal(parsed[0].carFilename, "EAGLE3.TXT");
  assert.equal(parsed[0].costToBuy, 50000);
});
