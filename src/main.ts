import {
  assessPopulationAvailability,
  type PopulationLoad,
} from "./population-availability";
import { RenderFpsSampler } from "./render-fps";
import {
  DistantOpponentPresentation,
  visualDistances,
  VISUAL_DISTANCE_MULTIPLIER,
} from "./visual-distance";
import { NativeChaseCamera } from "./camera/chase";
import { parseCameraSettings, type CameraSettings } from "./camera/settings";
import { parseTrackCameraSettings } from "./camera/track-settings";
import { cameraWorldQueries } from "./camera/world-queries";
import { clearCameraFromWorld } from "./camera/world-clearance";
import { clearCameraFromOwnShape } from "./camera/own-shape";
import { selectInitialCameraZoom } from "./camera/startup-zoom";
import { CameraVehicleTravel } from "./camera/vehicle-travel";
import { applyCameraControls } from "./camera/controls";
import {
  NativeOpponentSpeedController,
  approachOpponentCurvature,
} from "./physics/opponent-speed";
import { applyOpponentHotrod } from "./physics/opponent-hotrod";
import { NativeOpponentFleet } from "./ai/runtime";
import { NativeOpponentPlacement } from "./physics/opponent-placement";
import { readNativeOpponentRepairLimits } from "./ai/repair";
import {
  assignNativePersonalities,
  resolveNativeRaceNastiness,
} from "./ai/personality";
import { nativeOpponentViewDistance } from "./ai/proximity";
import { nativeHasCarFallenOffWorld } from "./ai/fallen-world";
import { NONCAR_FLAGS } from "./physics/noncar-motion";
import { parseDefaultGravityMultiplier } from "./physics/global-gravity";
import { BrowserGameClock } from "./game-clock";
import { sharedNativeRandom } from "./native-random";
import { parseStructuralSettings } from "./physics/structural";
import {
  consumeSmashAward,
  enqueueConnotationPowerup,
  type NativeSmashAwardState,
} from "./smash-gameplay";
import * as THREE from "three";
import { prepareSceneMatrices, renderScenePasses } from "./render-matrices";
import { placeCarAtStart } from "./physics/spawn";
import { Assets } from "./content";
import { nativeOilActorFollower } from "./oil-actor";
import { queueWorldSlick } from "./world-slick";
import { nativeOilBroadphaseMask } from "./physics/oil-placement";
import {
  parseTrackConfig,
  parseCarConfig,
  parseRaceCatalog,
  parseOpponents,
} from "./config";
import type {
  TrackConfig,
  CarConfig,
  RaceCatalogEntry,
  RaceCatalog,
  OpponentConfig,
} from "./config";
import {
  createRace,
  updateRace,
  speedMph,
  recoverVehicle,
  awardRaceTime,
  awardRaceCredits,
} from "./gameplay";
import type { RaceState } from "./gameplay";
import { WorldCollision, batchStaticWorld } from "./world";
import { captureWorldSource } from "./world-source";
import { captureNativeTrackSceneLayout } from "./native-track-scene-layout";
import { prepareNativeTrackSceneEdges } from "./track-edge-preparation";
import { prepareNativeWorldScene } from "./native-world-scene";
import { WorldFollowupRuntime, type FollowupDue } from "./world-followup";
import { DamageSystem } from "./damage";
import {
  PowerupSystem,
  type PowerupEvent,
  type PowerupDefinition,
} from "./powerups";
import { DebugPanel } from "./debug-panel";
import { SmokeSystem, type SmokeRigid } from "./smoke";
import type { SmokeCar } from "./smoke";
import { prepareCarSmokeSampler, parseNativeDriverZOffset } from "./car-smoke";
import { createNativeWreckColumns } from "./wreck-smoke";
import { initializeNativeFireVertices, parseCarFireVertices } from "./car-fire";
import { dispatchNativeDamageSmoke } from "./component-smoke";
import { NativeTyreEffects } from "./physics/tyre-smoke";
import { SkidMarkSystem } from "./skidmarks";
import { SkidMaterialLibrary } from "./skid-materials";
import { SparkSystem } from "./sparks";
import { CarSparkAllocator } from "./car-sparks";
import { ShrapnelSystem } from "./shrapnel";
import { nativeAbstractShrapnel } from "./smash-abstract";
import {
  SimpleMaterialLibrary,
  parseCarShrapnelMaterials,
} from "./shrapnel-materials";
import { createModelGeometry } from "./render-geometry";
import { nativePointVisible } from "./world-visibility";
import { parseDustShades } from "./dust-shades";
import { CarAnimation, TextureAnimation } from "./animation";
import { applyRaceObjectives, isSupportedRace, objectiveText } from "./rules";
import {
  createSimulatedCar,
  VehicleSimulation,
  type SimulatedCar,
  PHYSICS_STEP,
} from "./physics/simulation";
import { RenderPoses } from "./render-pose";
import { hasGraphicalPoseOwner } from "./render-ownership";
import { parseSurfaceModifiers, DEFAULT_SURFACE } from "./physics/surfaces";
import {
  parseDefaultWaterVolume,
  parseTrackSpecialVolumes,
  findSpecialVolume,
} from "./physics/volumes";
import { OilRuntime } from "./physics/oil";
import { parseNonCarMechanics, parseTrackNonCarFiles } from "./noncars";
import { createNonCarBody, nonCarActors } from "./physics/noncar-body";
import { NonCarRenderBatch } from "./noncar-render";
import { WorldDestruction, type WorldSmashContact } from "./world-destruction";
import { chooseSmashAudio, nativeSmashStartingVelocity } from "./smash-effects";
import { ShardRuntime } from "./smash-shards";
import { loadGhostAssets, type GhostAssetSet } from "./ghost-assets";
import {
  loadNonCarDebrisAssets,
  type NonCarDebrisAssetSet,
} from "./noncar-debris-assets";
import {
  NativeNonCarDebrisRuntime,
  initializeNativeNonCarDebrisBody,
  type NativeNonCarBodySlot,
} from "./noncar-debris";
import type { NonCarBody } from "./physics/noncar-body";
import type { SmashShrapnel } from "./world-smash";
import { nativeDirectSmashSeed, prepareNativeGhostFrame } from "./ghost-frame";
import { MissionVariables } from "./mission-variables";
import { RacePayout } from "./race-payout";
import { RaceFeedback, terminalRaceMessage } from "./race-feedback";
import {
  resolveOpponentRequests,
  selectOpponentIds,
} from "./opponent-selection";
import {
  parseRaceAwards,
  parseCrashDamageAwards,
  parsePedAwards,
  wastedCarCredits,
} from "./race-awards";
import { NativePedAwardCounter } from "./ped-awards";
import {
  NativeCunningStuntCounter,
  parseCunningStuntBonus,
} from "./cunning-stunts";
import { commandJump, instantHandbrake } from "./physics/command-powerups";
import { parseTrackSmashables, type SmashConnotations } from "./world-smash";
import { WorldGrooveRuntime } from "./world-groove";
import { createMovingWorldBody } from "./physics/moving-world";
import { parseDat } from "./formats";
import { parseMineMass, mineParameters } from "./physics/mines";
import { ExplosionRuntime, parseWastedExplosionSettings } from "./explosion";
import {
  parseUpgradeSettings,
  createUpgradeState,
  upgradeFactors,
  payRepair,
  createRepairControl,
  updateRepairControl,
  type UpgradeSettings,
} from "./physics/upgrades";
import { setMotionSuspension } from "./physics/motion";
import { applyUpgradePickup } from "./physics/upgrade-pickup";
import { RoadNavigator } from "./ai";
import { PedestrianSystem } from "./pedestrians";
import {
  pedestrianMapEnabled,
  pedestrianMapColor,
  drawPedestrianMapPoint,
} from "./ped-map";
import { AudioSystem } from "./audio";
import { WastedFeedback } from "./wasted";
import { SelectionMenu, type CarChoice } from "./selection-menu";
import type { DifficultySkill } from "./difficulty";
import type { RaceChoice } from "./selection-catalog";
import {
  assessRaceAvailability,
  type RaceAvailability,
} from "./race-availability";
import {
  createDiagnosticsPanel,
  type BackgroundDiagnostic,
  type DiagnosticInput,
  type DiagnosticProvider,
  type DiagnosticsPanel,
} from "./diagnostics";
import "./style.css";
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `<canvas id="view" tabindex="0" aria-label="Driving view"></canvas><div id="hud"><div class="top"><strong id="race-name">CARMAGEDDON II</strong><span id="timer">00:00</span><span id="laps">LAP 1/4</span></div><p id="population-status" class="population-status" role="status" hidden></p><div class="bottom"><div><span id="speed">0</span> MPH<br><small id="damage">ARMOUR 100%</small></div><div id="message"></div><div><span id="credits">CR 1000</span><br><small id="checkpoint">CHECKPOINT 1</small></div></div></div><canvas id="map" width="220" height="220" aria-label="Track minimap"></canvas><button id="menu-button">MENU · ESC</button><div id="panel"><h1>CARMAGEDDON II</h1><p class="subtitle">Independent browser engine · your local game assets</p><div hidden><label>RACE<select id="track-select"></select></label><label>CAR<select id="car-select"></select></label></div><div id="selection"><p>Preparing race and vehicle previews…</p></div><p id="population-menu-status" class="population-menu-status" role="status" hidden></p><p id="terminal-state" class="terminal-state" role="status" hidden></p><div class="selection-footer"><button id="play">LOAD RACE</button><p id="status">Indexing your installation…</p></div><details id="diagnostics" class="diagnostics-panel"></details><details class="menu-help"><summary>Controls & engine status</summary><p class="controls">WASD / arrows: drive · Space: handbrake<br>R: recover · E: repair · C: camera · M: map<br>F: use selected ability · Tab: select ability<br>Esc: pause/menu · Enter: skip payout / restart finished race</p><small>Stock race and car data. Reconstructed vehicle physics and opponent AI; independent browser HUD.</small></details></div>`;
const el = (id: string) => document.getElementById(id)!;
app.insertAdjacentHTML(
  "beforeend",
  '<div id="fps-counter" aria-label="Frames per second">FPS —</div>',
);
const fpsCounter = el("fps-counter");
el("play").insertAdjacentHTML(
  "beforebegin",
  '<label class="debug-check"><input id="debug-menu-toggle" type="checkbox"> Debug mode (timer, credits, powerups)</label>',
);
const view = el("view") as HTMLCanvasElement;
const feedbackCanvas = document.createElement("canvas");
feedbackCanvas.id = "feedback";
feedbackCanvas.setAttribute("aria-label", "Original wasted feedback");
app.append(feedbackCanvas);
const feedbackContext = feedbackCanvas.getContext("2d")!;
const renderer = new THREE.WebGLRenderer({ canvas: view, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x816750);
const scene = new THREE.Scene();
scene.add(new THREE.AmbientLight(0xffffff, 1.25));
const sun = new THREE.DirectionalLight(0xfff6df, 1.4);
sun.position.set(-3, 10, 4);
// Both passes share Three's scene render-state cache. Keep the directional
// light count stable so unchanged Lambert programs are not reselected each
// frame. The sky's Basic material ignores lighting; main-pass light is unchanged.
sun.layers.enable(1);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(
  65,
  innerWidth / innerHeight,
  0.035,
  1800,
);
const skyCamera = camera.clone();
const nativeChase = new NativeChaseCamera();
const cameraVehicleTravel = new CameraVehicleTravel();
let cameraControlReset = false;
let nativeCameraSettings: CameraSettings | undefined;
let nativeCameraYon = 0;
const distantOpponentPresentation = new DistantOpponentPresentation();
const presentationFrustum = new THREE.Frustum();
const presentationProjection = new THREE.Matrix4();
let distantOpponentCount = 0;
let cameraNeedsReset = true;
const missionVariables = new MissionVariables();
let smashAwardStates = new WeakMap<
  object,
  Map<SmashConnotations, NativeSmashAwardState>
>();
let miscStrings: string[] = [];
let worldFollowups: WorldFollowupRuntime | undefined;
const raceCatalogs = new Map<string, RaceCatalog>();
const assets = new Assets();
const audio = new AudioSystem(assets);
const wastedFeedback = new WastedFeedback(assets, audio);
let content: THREE.Group | undefined,
  car: THREE.Group | undefined,
  sky: THREE.Mesh | undefined,
  collision: WorldCollision | undefined,
  vehicle: SimulatedCar["state"] | undefined,
  race: RaceState | undefined,
  track: TrackConfig | undefined;
let carConfig: CarConfig | undefined,
  races: RaceCatalogEntry[] = [],
  opponents: OpponentConfig[] = [],
  paused = true,
  loading = false,
  cameraMode = 0,
  mapVisible = true;
let carTargetHeight = 0.18;
let repairControl = createRepairControl();
const gameClock = new BrowserGameClock();
const renderFps = new RenderFpsSampler(performance.now());
const raceFeedback = new RaceFeedback();
let fps = 0,
  currentTrack = "",
  currentCar = "",
  generation = 0;
let damage: DamageSystem | undefined,
  carAnimation: CarAnimation | undefined,
  carTextures: TextureAnimation | undefined,
  worldAnimation: TextureAnimation | undefined,
  definition: RaceCatalogEntry | undefined;
let simulation: VehicleSimulation | undefined, player: SimulatedCar | undefined;
let renderPoses = new RenderPoses();
let noncarRenderBatch: NonCarRenderBatch | undefined;
let mineModel: THREE.Group | undefined;
let explosions: ExplosionRuntime | undefined;
let shards: ShardRuntime | undefined;
let ghostTemplateLibrary: THREE.Group | undefined;
let noncarDebris: NativeNonCarDebrisRuntime | undefined;
let noncarDebrisActors: THREE.Group | undefined;
let worldSlickMaterials: ReadonlyMap<string, THREE.Material> = new Map();
let smoke: SmokeSystem | undefined;
const tyreEffects = new NativeTyreEffects<SimulatedCar>({
  isPlaying: (tag) => audio.isSoundPlaying(tag),
  startSound: (source) =>
    audio.startTrackedSound(
      source.soundId,
      source.volume / 255,
      source.pitch / 65536,
    ),
  stopSound: (tag) => audio.stopTrackedSound(tag),
});
const carSmokeSources = new WeakMap<
  SimulatedCar,
  {
    car: SmokeCar;
    fireVertices?: Uint16Array;
    sample: ReturnType<typeof prepareCarSmokeSampler>["sample"];
  }
>();
let skidmarks: SkidMarkSystem | undefined;
let skidMaterials: SkidMaterialLibrary | undefined;
let sparks: SparkSystem | undefined;
let carSparks: CarSparkAllocator | undefined;
let shrapnel: ShrapnelSystem | undefined;
const simpleMaterials = new SimpleMaterialLibrary();
const carShrapnelMaterials = new WeakMap<
  THREE.Object3D,
  readonly THREE.Material[]
>();
const renderPosition = new THREE.Vector3(),
  renderOrientation = new THREE.Quaternion();
let racePayout: RacePayout | undefined;
let raceAwards: ReturnType<typeof parseRaceAwards> | undefined;
let pedAwards: ReturnType<typeof parsePedAwards> | undefined;
let pedAwardCounter = new NativePedAwardCounter();
const cunningStunts = new NativeCunningStuntCounter();
let cunningStuntCredits: ReturnType<typeof parseCunningStuntBonus> | undefined;
let rivalsReady = false;
let opponentObjectivesReady = false,
  pedestrianObjectivesReady = false;
let populationLoads: {
  opponents: PopulationLoad;
  pedestrians: PopulationLoad;
} = {
  opponents: { state: "loading" },
  pedestrians: { state: "loading" },
};
let populationPracticeReason = "";

let selectedDifficulty: DifficultySkill = 0,
  raceDifficulty: DifficultySkill = 0;
let opponentFleet: NativeOpponentFleet | undefined;
const keys = new Set<string>(),
  target = new THREE.Vector3(),
  previous = new THREE.Vector3();
const trackSelect = el("track-select") as HTMLSelectElement,
  carSelect = el("car-select") as HTMLSelectElement;
let selectionMenu: SelectionMenu | undefined;
const raceAvailability = new Map<string, RaceAvailability>();
const stats = {
  ready: false,
  frames: 0,
  cameraUpdates: 0,
  fps: 0,
  drawCalls: 0,
  triangles: 0,
  gameFrames: 0,
  framePeriodMs: 0,
  gameTimeMs: 0,
  physicsSkippedMs: 0,
  assetWarnings: assets.warnings,
};
const debug = {
  stats,
  audio,
  get shards() {
    return shards;
  },
  get noncarDebris() {
    return noncarDebris;
  },
  get opponentFleet() {
    return opponentFleet;
  },
  wastedFeedback,
  get debugMode() {
    return debugPanel;
  },
  get simulation() {
    return simulation;
  },
  get worldFollowups() {
    return worldFollowups;
  },
  get player() {
    return player;
  },
  get carAnimation() {
    return carAnimation;
  },
  get carTextures() {
    return carTextures;
  },
  get worldAnimation() {
    return worldAnimation;
  },
  get powerups() {
    return powerups;
  },
  get damage() {
    return damage;
  },
  get pedestrians() {
    return pedestrians;
  },
  get smoke() {
    return smoke;
  },
  get skidmarks() {
    return skidmarks;
  },
  get sparks() {
    return sparks;
  },
  get carSparks() {
    return carSparks;
  },
  get shrapnel() {
    return shrapnel;
  },
  get cunningStunts() {
    return cunningStunts;
  },
  get opponentsReady() {
    return rivalsReady;
  },
  get populationLoadState() {
    return {
      opponents: { ...populationLoads.opponents },
      pedestrians: { ...populationLoads.pedestrians },
      practiceReason: populationPracticeReason,
      objectives: {
        opponents: opponentObjectivesReady,
        pedestrians: pedestrianObjectivesReady,
      },
    };
  },
  get diagnosticsReport() {
    return diagnosticsPanel?.report;
  },
  refreshDiagnostics() {
    return diagnosticsPanel?.refresh();
  },
  get rivals() {
    return rivals;
  },
  get vehicle() {
    return vehicle;
  },
  get race() {
    return race;
  },
  get raceDefinition() {
    return definition;
  },
  get racePayout() {
    return racePayout;
  },
  missionVariables,
  get track() {
    return track;
  },
  get carConfig() {
    return carConfig;
  },
  get camera() {
    return camera;
  },
  get visibility() {
    return nativeCameraYon > 0
      ? {
          ...visualDistances(
            nativeCameraYon,
            pedestrians?.nativeProcessDistance ?? 12,
          ),
          nativeOpponentDistance: nativeOpponentViewDistance(nativeCameraYon),
          nativePedestrianDistance: pedestrians?.nativeProcessDistance,
          distantPedestrians: pedestrians?.dormantRenderActors.size ?? 0,
          distantOpponents: distantOpponentCount,
        }
      : undefined;
  },
  get cameraState() {
    return { ...nativeChase.state, zoom: nativeChase.zoom };
  },
  get renderPosition() {
    return renderPosition;
  },
  get scene() {
    return scene;
  },
  /** Diagnostic captures use the same renderer; no second WebGL context. */
  get renderer() {
    return renderer;
  },
  /** Shared render preparation is exposed for opt-in CPU timing captures. */
  prepareRenderMatrices(forceFull = false) {
    prepareSceneMatrices(
      scene,
      pedestrians?.group,
      pedestrians?.renderActors,
      forceFull ? undefined : (noncarRenderBatch ?? undefined),
      forceFull || !pedestrians
        ? undefined
        : {
            actors: pedestrians.dormantRenderActors,
            revision: pedestrians.presentationRevision,
          },
    );
  },
  get renderPoses() {
    return renderPoses;
  },
  get noncarRenderBatch() {
    return noncarRenderBatch;
  },
  get collision() {
    return collision;
  },
  get assets() {
    return assets;
  },
  get paused() {
    return paused;
  },
  set paused(v: boolean) {
    setPaused(v);
  },
  loadRace,
};
(window as unknown as { carma: typeof debug }).carma = debug;
function recordBackgroundDiagnostic(
  source: string,
  error: unknown,
  raceContext?: string,
) {
  backgroundDiagnostics.push({
    source,
    message: error instanceof Error ? error.message : String(error),
    race: (raceContext ?? definition?.name ?? currentTrack) || undefined,
    time: new Date().toISOString(),
  });
  if (backgroundDiagnostics.length > 100) backgroundDiagnostics.shift();
}
function readDiagnosticInput(): DiagnosticInput {
  const providers: DiagnosticProvider[] = [
    {
      source: "Asset and runtime warnings",
      scope: "session",
      messages: assets.warnings,
    },
    {
      source: "Player animation",
      scope: "current race",
      messages: carAnimation?.warnings ?? [],
    },
    {
      source: "Player texture animation",
      scope: "current race",
      messages: carTextures?.warnings ?? [],
    },
    {
      source: "World texture animation",
      scope: "current race",
      messages: worldAnimation?.warnings ?? [],
    },
    {
      source: "Power-up loading",
      scope: "current race",
      messages: powerups?.warnings ?? [],
    },
    {
      source: "Pedestrian loading and effects",
      scope: "current race",
      messages: pedestrians?.warnings ?? [],
    },
    {
      source: "Smoke effects",
      scope: "current race",
      messages: smoke?.diagnostics ?? [],
    },
    {
      source: "World destruction effects",
      scope: "current race",
      messages: simulation?.destruction?.diagnostics ?? [],
    },
    {
      source: "World groove diagnostics",
      scope: "current race",
      messages:
        simulation?.grooves?.diagnostics.map(
          (diagnostic) =>
            `Block ${diagnostic.block}${diagnostic.actor ? ` · ${diagnostic.actor}` : ""}: ${diagnostic.message}`,
        ) ?? [],
    },
    {
      source: "Special-volume diagnostics",
      scope: "current race",
      messages: simulation?.specialVolumes?.diagnostics ?? [],
    },
  ];
  for (const rival of rivals) {
    providers.push(
      {
        source: `Opponent ${rival.id} animation`,
        scope: "current race",
        messages: rival.animation.warnings,
      },
      {
        source: `Opponent ${rival.id} texture animation`,
        scope: "current race",
        messages: rival.textures.warnings,
      },
    );
  }
  return {
    track: currentTrack || undefined,
    race: definition?.name,
    providers,
    background: backgroundDiagnostics,
    populations: populationLoads,
  };
}
function status(text: string) {
  el("status").textContent = text;
}
function message(text: string, duration = 3) {
  raceFeedback.notify(text, performance.now(), duration);
  el("message").textContent = text;
}
function setPaused(value: boolean) {
  gameClock.setPaused(value, performance.now());
  paused = value;
  keys.clear();
  el("panel").hidden = !value;
  el("menu-button").textContent = value ? "RESUME · ESC" : "MENU · ESC";
  if (value) diagnosticsPanel?.refresh();
  if (!value) view.focus();
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  feedbackCanvas.width = innerWidth;
  feedbackCanvas.height = innerHeight;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();
function findConfig(area: string, filename: string) {
  const stem = filename.replace(/\.txt$/i, "");
  return (
    assets.resolve(`data/${area}/${stem}/${filename}`) ??
    assets.manifest.find(
      (e) =>
        new RegExp(`^(data|adv_data)/${area}/`, "i").test(e.path) &&
        e.path.split("/").pop()?.toLowerCase() === filename.toLowerCase(),
    )?.path
  );
}
function dirOf(path: string) {
  return path.slice(0, path.lastIndexOf("/"));
}
function stemOf(path: string) {
  return path
    .split("/")
    .pop()!
    .replace(/\.txt$/i, "");
}

async function init() {
  try {
    await assets.init();
    for (const root of ["data", "adv_data"]) {
      const catalogPath = assets.resolve(`${root}/RACES.TXT`);
      if (catalogPath)
        raceCatalogs.set(
          root,
          parseRaceCatalog(await assets.text(catalogPath)),
        );
    }
    races = raceCatalogs.get("data")?.races ?? [];
    const opponentPath = assets.resolve("data/OPPONENT.TXT");
    if (opponentPath)
      opponents = parseOpponents(await assets.text(opponentPath));
    const tracks = assets.manifest.filter(
      (e) =>
        /^(data|adv_data)\/races\/[^/]+\/[^/]+\.txt$/i.test(e.path) &&
        stemOf(e.path).toLowerCase() ===
          dirOf(e.path).split("/").pop()!.toLowerCase(),
    );
    const raceChoices: RaceChoice[] = [];
    for (const entry of tracks) {
      const geometry = !!assets.resolve(
        `${dirOf(entry.path)}/${stemOf(entry.path)}.act`,
      );
      const raceEntry = (
        raceCatalogs.get(entry.path.split("/")[0].toLowerCase())?.races ?? []
      ).find(
        (r) =>
          r.raceFilename.toLowerCase() ===
          entry.path.split("/").pop()!.toLowerCase(),
      );
      const option = new Option(
        `${entry.path.startsWith("adv_data/") ? "ADV · " : ""}${raceEntry?.name ?? stemOf(entry.path)}${isSupportedRace(raceEntry) ? "" : " · FREE DRIVE"}`,
        entry.path,
      );
      trackSelect.add(option);
      let selectionConfig: TrackConfig;
      let configurationError: string | undefined;
      try {
        selectionConfig = parseTrackConfig(await assets.text(entry.path));
      } catch (error) {
        // A bad add-on's optional menu metadata must not hide other races.
        assets.warnings.push(
          `${entry.path}: selection metadata: ${String(error)}`,
        );
        selectionConfig = parseTrackConfig("");
        configurationError = String(error);
      }
      const availability = assessRaceAvailability(selectionConfig, raceEntry, {
        geometry,
        configurationError,
      });
      raceAvailability.set(entry.path, availability);
      option.disabled = availability.mode === "unavailable";
      if (availability.mode !== "race")
        option.textContent = `${option.textContent} · ${availability.label.toUpperCase()}`;
      raceChoices.push({
        path: entry.path,
        name: raceEntry?.name ?? stemOf(entry.path),
        source: entry.path.split("/")[0].toLowerCase() as "data" | "adv_data",
        definition: raceEntry,
        catalogOrder: raceEntry
          ? raceCatalogs
              .get(entry.path.split("/")[0].toLowerCase())!
              .races.indexOf(raceEntry)
          : undefined,
        config: selectionConfig,
        availability,
      });
    }
    const cars = assets.manifest.filter(
      (e) =>
        /^(data|adv_data)\/cars\/[^/]+\/[^/]+\.txt$/i.test(e.path) &&
        stemOf(e.path).toLowerCase() ===
          dirOf(e.path).split("/").pop()!.toLowerCase(),
    );
    const carChoices: CarChoice[] = [];
    for (const entry of cars) {
      const opponent = opponents.find(
        (o) =>
          o.carFilename.toLowerCase() ===
          entry.path.split("/").pop()!.toLowerCase(),
      );
      carSelect.add(
        new Option(
          `${entry.path.startsWith("adv_data/") ? "ADV · " : ""}${opponent?.carName ?? stemOf(entry.path)}`,
          entry.path,
        ),
      );
      carChoices.push({
        path: entry.path,
        name: opponent?.carName ?? stemOf(entry.path),
        source: entry.path.split("/")[0].toLowerCase() as "data" | "adv_data",
        opponent,
      });
    }
    const initialRace = findConfig(
      "RACES",
      races[0]?.raceFilename ?? "newcity1.txt",
    );
    if (initialRace) trackSelect.value = initialRace;
    const initialCar = findConfig("CARS", "EAGLE3.TXT");
    if (initialCar) carSelect.value = initialCar;
    const saved = localStorage.getItem("c2-selection");
    if (saved) {
      try {
        const s = JSON.parse(saved);
        if (assets.resolve(s.track)) trackSelect.value = s.track;
        if (assets.resolve(s.car)) carSelect.value = s.car;
      } catch {}
    }
    if (raceAvailability.get(trackSelect.value)?.mode === "unavailable") {
      const fallback = raceChoices.find(
        (choice) => choice.availability?.mode !== "unavailable",
      );
      if (fallback) trackSelect.value = fallback.path;
    }
    await audio.init();
    await assets.common(status);
    selectionMenu = new SelectionMenu(
      el("selection"),
      assets,
      raceChoices,
      carChoices,
      trackSelect,
      carSelect,
      () => paused && !loading && !el("panel").hidden,
      (skill) => {
        selectedDifficulty = skill;
      },
    );
    await initializeShrapnel();
    await wastedFeedback.init();
    await loadRace();
    setPaused(true);
  } catch (error) {
    recordBackgroundDiagnostic("Startup", error);
    status(`Cannot start: ${error instanceof Error ? error.message : error}`);
    console.error(error);
  }
}
function registerShrapnelMaterials(
  actor: THREE.Object3D,
  names: readonly string[],
  driver: number,
) {
  const materials = names.map((name) =>
    simpleMaterials.resolve(name, driver > 5 ? 2 : 1),
  );
  if (materials.some((material) => !material)) {
    assets.warnings.push(
      `Native shrapnel materials unavailable for ${actor.name}: cache capacity reached`,
    );
    // Preserve authored material indices; an absent provider is diagnosed by
    // the consumer instead of filtering/reordering the original array.
    return;
  }
  carShrapnelMaterials.set(actor, materials as THREE.Material[]);
}

function registerCarSmoke(body: SimulatedCar, carText: string) {
  const mesh = body.damage.primaryRenderMesh;
  if (!mesh) {
    assets.warnings.push(
      `Original principal smoke model missing: ${body.group.name}`,
    );
    return;
  }
  const driverZOffset = parseNativeDriverZOffset(carText);
  if (driverZOffset === undefined)
    assets.warnings.push(
      `Original smoke cockpit head offset missing: ${body.group.name}`,
    );
  const sampler = prepareCarSmokeSampler(mesh, body.group, {
    cockpit:
      driverZOffset === undefined
        ? undefined
        : () => ({
            enabled: cameraMode === 1,
            driver: body.human ? 8 : 6,
            driverZOffset,
          }),
  });
  const car: SmokeCar = {
    get velocity() {
      return body.state.velocity;
    },
    invertedSourceY: () => {
      const vertices = body.hulls[0]?.vertices;
      if (!vertices?.length)
        throw new Error("Wreck smoke requires the first live shape");
      return Math.min(...vertices.map((vertex) => vertex.y));
    },
    isOnDetachedHalf: (local) => {
      const plane = body.damage.splitRuntime?.plane;
      return !!plane && plane.normal.dot(local) - plane.constant < 0;
    },
  };
  const authoredFire = parseCarFireVertices(carText);
  if (!authoredFire)
    assets.warnings.push(
      `Original component smoke vertex table missing: ${body.group.name}`,
    );
  const fireVertices = authoredFire
    ? initializeNativeFireVertices(authoredFire, sampler.sourceVertexIndices)
    : undefined;
  carSmokeSources.set(body, { car, fireVertices, sample: sampler.sample });
}

async function initializeShrapnel() {
  if (shrapnel) return;
  const geometries = [];
  for (const stem of ["FRAG4", "FRAG5"]) {
    const path = assets.resolve(`data/MODELS/${stem}.DAT`);
    if (!path)
      throw new Error(`Original shrapnel model unavailable: ${stem}.DAT`);
    const models = parseDat(await assets.bytes(path));
    const model =
      models.find((model) => model.name.toUpperCase() === `${stem}.DAT`) ??
      models[0];
    if (!model) throw new Error(`Empty original shrapnel model: ${path}`);
    geometries.push(createModelGeometry(model));
  }
  shrapnel = new ShrapnelSystem({
    models: [geometries[0], geometries[1]],
    blackMaterial: simpleMaterials.resolve("M14.MAT", 4),
    carMaterials: (actor) => {
      // Detached/split wrappers have no copied palette; source reads the
      // supplied owner directly rather than following its original-car link.
      return carShrapnelMaterials.get(actor) ?? [];
    },
    timeSyncMs: () => simulation?.mechanicsTimeSync ?? 1,
  });
  for (const geometry of geometries) geometry.dispose();
  scene.add(shrapnel.group);
}

function disposeGroup(group: THREE.Object3D) {
  const geos = new Set<THREE.BufferGeometry>(),
    mats = new Set<THREE.Material>(),
    maps = new Set<THREE.Texture>();
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      geos.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        mats.add(m);
        const mapped = m as THREE.MeshLambertMaterial;
        if (mapped.map) maps.add(mapped.map);
      }
    }
  });
  for (const g of geos) if (!assets.ownsNativeGeometry(g)) g.dispose();
  for (const m of mats) {
    const source = assets.resolveNativeMaterial(m);
    if (
      !assets.isRetainedNativeMaterial(m) &&
      (!source || assets.getNativeRenderMaterial(source) !== m)
    )
      m.dispose();
  }
  const shared = new Set<THREE.Texture>(assets.textures.values());
  for (const map of maps)
    if (
      !shared.has(map) &&
      !assets.isRetainedNativeTexture(map) &&
      !assets.ownsNativeTexture(map)
    )
      map.dispose();
}
interface Rival {
  object: THREE.Group;
  state: SimulatedCar["state"];
  body: SimulatedCar;
  node: number;
  previousNode: number;
  stuck: number;
  navigator: RoadNavigator;
  speedController: NativeOpponentSpeedController;
  frozen: boolean;
  hotrodRevision: number;
  wasted: boolean;
  damage: DamageSystem;
  animation: CarAnimation;
  textures: TextureAnimation;
  id: number;
}
function groupMaterials(group: THREE.Object3D) {
  const map = new Map<string, THREE.Material>();
  group.traverse((o) => {
    if (o instanceof THREE.Mesh)
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        map.set(m.uuid, m);
  });
  return map;
}
let rivals: Rival[] = [];
let pedestrians: PedestrianSystem | undefined;
let powerups: PowerupSystem | undefined;
let upgradeSettings: UpgradeSettings | undefined;
const noPowerups: readonly PowerupDefinition[] = [];
const backgroundDiagnostics: BackgroundDiagnostic[] = [];
let diagnosticsPanel: DiagnosticsPanel | undefined;
const debugPanel = new DebugPanel(app, {
  ready: () => stats.ready && !loading && !!player && !!race && !!simulation,
  running: () => race?.status === "racing",
  definitions: () => powerups?.definitions ?? noPowerups,
  credits: (amount) => {
    if (!race) return;
    race.credits = Math.min(Number.MAX_SAFE_INTEGER, race.credits + amount);
    if (player?.upgrades) player.upgrades.credits = race.credits;
    message(`DEBUG · +${amount} CR`);
  },
  time: (amount) => {
    if (race) race.timeLeft += amount;
    message(`DEBUG · +${amount} SECONDS`);
  },
  grant: (index) => {
    if (vehicle && race) powerups?.grant(index, vehicle, race, onPowerupEvent);
  },
  repair: () => {
    if (player && simulation) simulation.repair(player);
    message(
      player?.knackered
        ? "REPAIRED · WASTED REQUIRES RESTART"
        : "DEBUG · FULL REPAIR",
    );
  },
  recover: () => {
    if (!player || !simulation) return;
    simulation.recover(player);
    cunningStunts.cancelPending();
    cameraNeedsReset = true;
    pedestrians?.resetCar(player.state.position);
    powerups?.resetPath(player.state.position);
    message(
      player.knackered
        ? "RECOVERED · WASTED REQUIRES RESTART"
        : "DEBUG · FREE RECOVERY",
    );
  },
  restart: () => {
    void loadRace();
  },
  focusDriving: () => {
    if (!paused) view.focus();
  },
  clearInput: () => keys.clear(),
});
function updateUpgradeFactors(body: SimulatedCar) {
  if (!body.upgrades || !upgradeSettings) return;
  const factors = upgradeFactors(body.upgrades, upgradeSettings);
  body.armorLevel = body.upgrades.levels[0];
  body.offenseLevel = body.upgrades.levels[2];
  body.armorFactor = factors.armour;
  body.offenseFactor = factors.offensive;
  body.state.powerMultiplier = factors.power;
}
async function loadRace() {
  if (loading) return;
  // Capture the menu choice; failed preflight must not change the live race.
  const loadDifficulty = selectedDifficulty;
  selectionMenu?.sync();
  const availability = raceAvailability.get(trackSelect.value);
  if (availability?.mode === "unavailable") {
    status(`Cannot load this track: ${availability.reasons.join(" ")}`);
    return;
  }
  raceFeedback.clear();
  loading = true;
  selectionMenu?.setLoading(true);
  const loadGeneration = ++generation;
  rivalsReady = opponentObjectivesReady = pedestrianObjectivesReady = false;
  populationLoads = {
    opponents: { state: "loading" },
    pedestrians: { state: "loading" },
  };
  populationPracticeReason = "";
  for (const id of ["population-status", "population-menu-status"]) {
    el(id).textContent = "";
    el(id).hidden = true;
  }
  setPaused(true);
  el("play").setAttribute("disabled", "");
  stats.ready = false;
  wastedFeedback.reset();
  racePayout = undefined;
  try {
    currentTrack = trackSelect.value;
    currentCar = carSelect.value;
    if (!currentTrack || !currentCar)
      throw new Error("No compatible tracks or cars found in the installation");
    status("Parsing original track geometry…");
    const trackText = await assets.text(currentTrack);
    const newTrack = parseTrackConfig(trackText);
    const generalText = await assets.text("data/GENERAL.TXT");
    nativeCameraSettings = parseCameraSettings(generalText);
    distantOpponentPresentation.reset();
    // Native Glorify/Fog runs as materials are admitted, before actor creation.
    // Yon here is the base camera value; the track multiplier only clips views.
    assets.releaseRaceResources();
    const depth = newTrack.depthCue;
    assets.configureNativeRendering({
      directionalColor: newTrack.globalLighting?.directionalColor,
      depth: {
        type: depth ? ["darkness", "fog", "colour"].indexOf(depth.mode) : -1,
        start: depth?.strength[0] ?? 0,
        end: depth?.strength[1] ?? 0,
        red: depth?.color[0] ?? 0,
        green: depth?.color[1] ?? 0,
        blue: depth?.color[2] ?? 0,
        baseYon: Math.fround(nativeCameraSettings.far),
      },
      visualFogDistanceScale: VISUAL_DISTANCE_MULTIPLIER,
      interpolation: true,
      antialiasing: true,
      perspective: true,
    });
    const generatedMaterials = assets.generatedTrackMaterials();
    const world = await assets.scene(
      dirOf(currentTrack),
      stemOf(currentTrack),
      {
        shading: 1,
        storage: "track",
        defaultMaterial: generatedMaterials.defaultTrackMaterial,
      },
    );
    const trackEdges = prepareNativeTrackSceneEdges(world);
    world.group.userData.nativeTrackEdgePreparation = {
      status: trackEdges.status,
      appliedGeometries: trackEdges.appliedGeometries,
      changedFaces: trackEdges.changedFaces,
      requiredProviders: trackEdges.requiredProviders,
    };
    for (const reason of trackEdges.requiredProviders)
      assets.warnings.push(`Track edge preparation: ${reason}`);
    // ExtractColumns computes this before model migration, FindNonCars and
    // authored scale normalization. Never recalculate it from batched meshes.
    const initialNativeLayout = captureNativeTrackSceneLayout(world);
    if (!initialNativeLayout.resolved)
      assets.warnings.push(
        `Track column layout fallback: ${initialNativeLayout.requiredProvider}`,
      );
    definition = (
      raceCatalogs.get(currentTrack.split("/")[0].toLowerCase())?.races ?? []
    ).find(
      (r) =>
        r.raceFilename.toLowerCase() ===
        currentTrack.split("/").pop()!.toLowerCase(),
    );
    missionVariables.clear();
    smashAwardStates = new WeakMap();
    worldFollowups = undefined;
    const worldSmashSpecs = parseTrackSmashables(trackText, currentTrack);
    if (!initialNativeLayout.resolved)
      throw new Error(
        `Native track layout: ${initialNativeLayout.requiredProvider}`,
      );
    const nativeSmashTargets: Array<{
      model: object;
      actor: object;
      index: -1;
    }> = [];
    const nativeWorld = prepareNativeWorldScene(world, {
      initialLayout: initialNativeLayout,
      ...generatedMaterials,
      smashSpecs: worldSmashSpecs.map((spec) => ({
        material:
          spec.trigger.kind === "material"
            ? (world.findSourceMaterial(spec.trigger.name) ?? null)
            : null,
        triggerType:
          spec.trigger.kind === "material"
            ? 0
            : spec.trigger.kind === "model"
              ? 1
              : 2,
        mode: [
          "nochange",
          "decal",
          "texturechange",
          "remove",
          "replacemodel",
          "crush",
        ].indexOf(spec.mode),
        levelCount: spec.levels.length,
      })),
      actorSpecs: worldSmashSpecs.map((spec) => ({
        model:
          spec.trigger.kind === "model"
            ? (world.findSourceModel(spec.trigger.name) ?? null)
            : null,
        triggerType:
          spec.trigger.kind === "material"
            ? 0
            : spec.trigger.kind === "model"
              ? 1
              : 2,
        targetCode: (spec.connotations?.variableChanges[0]?.[0] ?? 0) & 0xffff,
      })),
      race: definition
        ? {
            type:
              typeof definition.raceType === "number"
                ? definition.raceType
                : [
                    "carma",
                    "cars",
                    "peds",
                    "checkpoints",
                    "smash",
                    "smashAndPed",
                  ].indexOf(definition.raceType),
            targetCode: definition.smashVariable ?? 0,
          }
        : null,
      pixelBits: 16,
      // PED-06 owns native load-time enrollment. The current population reads
      // immutable source DAT coverage once, after world load; never respawn it
      // from the compacted/migrated face tables.
      spawnPedsOnFace: () => {},
      updateMaterial: (material) => assets.updateNativeMaterial(material),
      retainChangingPowerupMaterial: (material) =>
        assets.retainNativeMaterial(material),
      resolveRenderedMaterial: (material) =>
        assets.resolveNativeMaterial(material),
      addSmashableRaceTarget: (model, actor, index) => {
        nativeSmashTargets.push({ model, actor, index });
      },
    });
    world.group.userData.nativeSmashTargets = nativeSmashTargets;
    camera.fov = nativeCameraSettings.runtimeFovDegrees;
    nativeCameraYon = Math.fround(
      nativeCameraSettings.far * parseTrackCameraSettings(trackText),
    );
    camera.far = visualDistances(nativeCameraYon, 12).landscape;
    if (
      !(
        nativeCameraYon >
        Math.max(
          nativeCameraSettings.hitherGeneral,
          nativeCameraSettings.hitherCockpit,
        )
      )
    )
      throw new Error(
        "Track camera Yon multiplier produces an invalid far plane",
      );
    camera.near = nativeCameraSettings.hitherGeneral;
    camera.updateProjectionMatrix();
    cameraNeedsReset = true;
    const defaultGravityMultiplier = parseDefaultGravityMultiplier(generalText);
    const loadedPowerups = new PowerupSystem(
      assets,
      world.group,
      sharedNativeRandom.random,
      definition?.powerupExclusions ?? [],
      defaultGravityMultiplier,
    );
    loadedPowerups.onPickup = (definition) =>
      audio.powerupPickup(definition.index);
    await loadedPowerups.init();
    status("Parsing original car…");
    if (!assets.textures.has("oil")) {
      const oilPath =
        assets.resolve("data/PIXELMAP/PIX16/OIL.PIX") ??
        assets.resolve("data/PIXELMAP/PIX8/OIL.PIX");
      if (oilPath) await assets.pixelmaps(oilPath);
    }
    raceAwards = parseRaceAwards(generalText);
    cunningStuntCredits = parseCunningStuntBonus(generalText);
    cunningStunts.cancelPending();
    const miscPath = assets.resolve(`${currentTrack.split("/")[0]}/TEXT.TXT`);
    miscStrings = miscPath
      ? (await assets.text(miscPath))
          .split(/\r?\n/)
          .filter((line) => line.trim() && !line.trim().startsWith("//"))
      : [];
    pedAwards = parsePedAwards(
      await assets.text(
        `${currentTrack.toLowerCase().startsWith("adv_data/") ? "adv_data" : "data"}/PEDS/settings.txt`,
      ),
    );
    pedAwardCounter = new NativePedAwardCounter();
    audio.configurePowerups(generalText);
    const loadedMine = await assets.scene("data/MINE", "ShitMine", {
      shading: 2,
      storage: "mine",
    });
    const explosionSettings = parseWastedExplosionSettings(generalText);
    for (const frame of new Set(
      explosionSettings.groups.flatMap((group) =>
        group.frames.map((frame) => frame.pixelmap),
      ),
    )) {
      const path = assets.resolve(`data/COMMON/boom/PIX8/${frame}.PIX`);
      if (path && !assets.textures.has(frame.toLowerCase()))
        await assets.pixelmaps(path);
    }
    const mineMass = parseMineMass(generalText);
    if (!mineMass) throw new Error("GENERAL.TXT: mine/mortar weight missing");
    upgradeSettings ??= parseUpgradeSettings(generalText);
    const carText = await assets.text(currentCar);
    const newCarConfig = parseCarConfig(carText);
    await audio.setCar(carText);
    const loadedCar = await assets.scene(
      dirOf(currentCar),
      stemOf(currentCar),
      { shading: 2, storage: "our-car" },
    );
    // Original visual bounds support optional views and the explicit startup
    // framing extension; live chase uses native COM/shape equations.
    const cameraBounds = new THREE.Box3().setFromObject(loadedCar.group);
    carTargetHeight = Math.max(
      0.18,
      cameraBounds.getCenter(new THREE.Vector3()).y,
    );
    const loadedDamage = new DamageSystem(
      assets,
      loadedCar.group,
      carText,
      currentCar,
    );
    await loadedDamage.init();
    loadedDamage.structuralSettings = parseStructuralSettings(generalText);
    status("Building collision geometry…");
    const noncarDefinitions = new Map<
      number,
      ReturnType<typeof parseNonCarMechanics>
    >();
    const dataRoot = currentTrack.split("/")[0];
    for (const filename of parseTrackNonCarFiles(trackText, currentTrack)) {
      const path =
        assets.resolve(`${dataRoot}/NONCARS/${filename}`) ??
        assets.resolve(`data/NONCARS/${filename}`);
      if (!path) {
        assets.warnings.push(`${currentTrack}: missing noncar ${filename}`);
        continue;
      }
      try {
        const mechanics = parseNonCarMechanics(await assets.text(path), path);
        noncarDefinitions.set(mechanics.index, mechanics);
      } catch (error) {
        assets.warnings.push(String(error));
      }
    }
    const noncarBodies = nonCarActors(world.group).flatMap(
      ({ actor, type }) => {
        const mechanics = noncarDefinitions.get(type);
        if (!mechanics) return [];
        try {
          return [createNonCarBody(actor, mechanics, { immutableHulls: true })];
        } catch (error) {
          delete actor.userData.dynamicBody;
          assets.warnings.push(String(error));
          return [];
        }
      },
    );
    const originalNonCarActorCount = nonCarActors(world.group).length;
    const loadedGrooves = new WorldGrooveRuntime(world.group, trackText);
    const movingWorld = [...loadedGrooves.actors]
      .filter((actor) => !noncarBodies.some((body) => body.actor === actor))
      .map((actor) => {
        actor.userData.dynamicBody = true;
        return createMovingWorldBody(actor);
      });
    const worldShrapnelSpecs = worldSmashSpecs.flatMap((spec) =>
      [
        spec.connotations,
        ...spec.levels.map((level) => level.connotations),
      ].flatMap((connotations) => connotations?.shrapnel ?? []),
    );
    const newGhostLibrary = new THREE.Group();
    const loadedGhostAssets = await loadGhostAssets(
      worldShrapnelSpecs,
      async (name) => {
        const path = assets.resolve(`${dirOf(currentTrack)}/${name}`);
        if (!path)
          throw new Error(
            `Missing ghost ACT '${name}' in ${dirOf(currentTrack)}`,
          );
        const actors = await world.loadActorFile(path);
        newGhostLibrary.add(actors);
        return actors;
      },
    );
    const ghostAssets = new Map<SmashShrapnel, GhostAssetSet>();
    for (const [index, entry] of loadedGhostAssets) {
      ghostAssets.set(worldShrapnelSpecs[index], entry);
      assets.warnings.push(...entry.diagnostics);
    }
    const loadedNonCarDebrisAssets = await loadNonCarDebrisAssets(
      worldShrapnelSpecs,
      async (name) => {
        const path = assets.resolve(`${dirOf(currentTrack)}/${name}`);
        if (!path)
          throw new Error(
            `Missing noncar debris ACT '${name}' in ${dirOf(currentTrack)}`,
          );
        const actors = await world.loadActorFile(path);
        newGhostLibrary.add(actors);
        return actors;
      },
      async (name) => {
        const path =
          assets.resolve(`${dataRoot}/NONCARS/${name}`) ??
          assets.resolve(`data/NONCARS/${name}`);
        if (!path) throw new Error(`Missing noncar debris mechanics '${name}'`);
        return parseNonCarMechanics(await assets.text(path), path);
      },
    );
    const noncarDebrisAssets = new Map<SmashShrapnel, NonCarDebrisAssetSet>();
    for (const [index, entry] of loadedNonCarDebrisAssets) {
      noncarDebrisAssets.set(worldShrapnelSpecs[index], entry);
      assets.warnings.push(...entry.diagnostics);
    }
    let loadedDebrisRuntime: NativeNonCarDebrisRuntime | undefined;
    const loadedDestruction = new WorldDestruction(
      world.group,
      worldSmashSpecs,
      {
        models: world.models,
        textures: world.textures,
        materials: world.materials,
        cloneMaterial: (material) => assets.cloneNativeMaterial(material),
        random: sharedNativeRandom.random,
        onConnotations: (data, contact, suppressed) =>
          dispatchSmashConnotations(data, contact, suppressed, () => {
            for (const spec of data.shrapnel)
              if (spec.kind === "abstract")
                spawnAbstractShrapnel(spec, contact, world.materials);
              else if (spec.kind === "ghostparts") {
                const templates = ghostAssets.get(spec);
                if (!templates?.templates.length || !shards) continue;
                if (!contact.point) {
                  assets.warnings.push(
                    "Ghost debris requires the native smash point",
                  );
                  continue;
                }
                camera.updateWorldMatrix(true, false);
                const cameraMatrix = camera.matrixWorld.elements;
                const visible = nativePointVisible(
                  contact.point,
                  Math.fround(nativeCameraYon * nativeCameraYon),
                  {
                    camera: {
                      position: new THREE.Vector3(
                        cameraMatrix[12],
                        cameraMatrix[13],
                        cameraMatrix[14],
                      ),
                      backwards: new THREE.Vector3(
                        cameraMatrix[8],
                        cameraMatrix[9],
                        cameraMatrix[10],
                      ),
                      yon: nativeCameraYon,
                    },
                  },
                );
                contact.actor.updateWorldMatrix(true, false);
                const { frame, tinyFace } = prepareNativeGhostFrame(
                  contact.ghostQuad ?? null,
                  contact.actor.matrixWorld,
                  [templates.boundsDX, templates.boundsDY, 0],
                );
                shards.spawnGhosts(spec, {
                  templates: templates.templates.map((template) => ({
                    name: template.name,
                    matrix: template.matrix,
                    geometry: template.model.geometry,
                    material: template.model.material,
                  })),
                  frame,
                  tinyFace,
                  point: contact.point.clone(),
                  impacteeVelocity:
                    contact.smashStartingVelocity?.clone() ??
                    new THREE.Vector3(0, 1, 0),
                  timeMs: Math.round(contact.timeMs ?? stats.gameTimeMs) >>> 0,
                  seed:
                    contact.shrapnelSeed ??
                    nativeDirectSmashSeed(
                      contact.effectForce ?? new THREE.Vector3(),
                    ),
                  visible,
                });
              } else if (spec.kind === "noncars") {
                const templates = noncarDebrisAssets.get(spec);
                if (!templates?.templates.length || !loadedDebrisRuntime)
                  continue;
                if (!contact.point) {
                  assets.warnings.push(
                    "Noncar debris requires the native smash point",
                  );
                  continue;
                }
                contact.actor.updateWorldMatrix(true, false);
                const { frame } = prepareNativeGhostFrame(
                  contact.ghostQuad ?? null,
                  contact.actor.matrixWorld,
                );
                loadedDebrisRuntime.spawn(spec, templates, {
                  frame,
                  point: contact.point.clone(),
                  impacteeVelocity:
                    contact.smashStartingVelocity?.clone() ??
                    new THREE.Vector3(0, 1, 0),
                });
              }
          }),
      },
    );
    worldSlickMaterials = world.materials;
    await loadedDestruction.preload(async (name) => {
      const path = assets.resolve(
        `${dirOf(currentTrack)}/${name.replace(/\.(act|dat)$/i, "")}.DAT`,
      );
      if (!path) return;
      const models = parseDat(await assets.bytes(path));
      return (
        models.find(
          (model) => model.name.toLowerCase() === name.toLowerCase(),
        ) ?? models[0]
      );
    });
    const worldSource = captureWorldSource(world.group, {
      modelPreparation: "track",
      initialNativeLayout: initialNativeLayout.resolved
        ? initialNativeLayout
        : undefined,
    });
    world.group = batchStaticWorld(world.group, [
      ...noncarBodies.map((body) => body.actor),
      ...loadedGrooves.actors,
      ...loadedDestruction.retainActors,
    ]);
    loadedDestruction.root = world.group;
    const newCollision = new WorldCollision(
      world.group,
      parseSurfaceModifiers(trackText),
      worldSource,
      nativeWorld,
    );
    noncarRenderBatch?.dispose();
    for (const body of simulation?.cars ?? []) tyreEffects.stopOwner(body);
    simulation?.dispose();
    noncarDebrisActors?.removeFromParent();
    noncarDebrisActors?.clear();
    noncarDebris = undefined;
    explosions?.dispose();
    shards?.dispose();
    if (ghostTemplateLibrary) disposeGroup(ghostTemplateLibrary);
    ghostTemplateLibrary = newGhostLibrary;
    smoke?.dispose();
    skidmarks?.dispose();
    skidMaterials?.dispose();
    shrapnel?.clear();
    if (sparks) sparks.clear();
    else
      sparks = new SparkSystem({
        shrapnelOutlet: (request) => shrapnel?.spawnFromSpark(request),
      });
    if (!carSparks)
      carSparks = new CarSparkAllocator({
        allocateNative: sparks.allocateNative,
        shrapnelOutlet: (request) => shrapnel?.spawnFromSpark(request),
        timeSyncMs: () => simulation?.mechanicsTimeSync ?? 1,
      });
    scene.add(sparks.group);
    skidMaterials = new SkidMaterialLibrary();
    await skidMaterials.load(assets, [
      ...parseSurfaceModifiers(trackText).map(
        (modifier) => modifier.skidMaterial,
      ),
      "OILSMEAR.MAT",
    ]);
    skidmarks = new SkidMarkSystem({ resolveMaterial: skidMaterials.resolve });
    scene.add(skidmarks.group);
    smoke = new SmokeSystem(assets, {
      camera,
      random: sharedNativeRandom.random,
      shadeColours: Array<number | undefined>(8)
        .fill(undefined)
        .concat(parseDustShades(trackText)),
    });
    scene.add(smoke.group);
    await smoke.loadTextures();
    shards = new ShardRuntime(scene, world.materials, {
      random: sharedNativeRandom.random,
      seed: sharedNativeRandom.seed,
      gravity: () => simulation?.gravityMultiplier ?? defaultGravityMultiplier,
    });
    explosions = new ExplosionRuntime(
      scene,
      new Map([...world.textures, ...assets.textures]),
      { random: sharedNativeRandom.random },
    );
    if (mineModel) disposeGroup(mineModel);
    mineModel = loadedMine.group;
    carAnimation?.dispose();
    carTextures?.dispose();
    worldAnimation?.dispose();
    if (powerups) {
      scene.remove(powerups.group);
      disposeGroup(powerups.group);
      powerups.dispose();
    }
    powerups = loadedPowerups;
    scene.add(powerups.group);
    if (content) {
      scene.remove(content);
      disposeGroup(content);
    }
    if (car) {
      scene.remove(car);
      disposeGroup(car);
    }
    for (const rival of rivals) {
      rival.animation.dispose();
      rival.textures.dispose();
      scene.remove(rival.object);
      disposeGroup(rival.object);
    }
    rivals = [];
    opponentFleet = undefined;
    if (pedestrians) {
      scene.remove(pedestrians.group);
      pedestrians.dispose();
      pedestrians = undefined;
    }
    if (sky) {
      scene.remove(sky);
      sky.geometry.dispose();
      const mat = sky.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
    carAnimation = new CarAnimation(loadedCar.group, carText);
    carTextures = new TextureAnimation(
      groupMaterials(loadedCar.group),
      loadedCar.textures,
      carText,
    );
    worldAnimation = new TextureAnimation(
      world.materials,
      world.textures,
      trackText,
    );
    raceDifficulty = loadDifficulty;
    damage = loadedDamage;
    content = world.group;
    scene.add(content);
    car = loadedCar.group;
    scene.add(car);
    collision = newCollision;
    track = newTrack;
    carConfig = newCarConfig;
    const start = new THREE.Vector3(...(track.start ?? [0, 1, 0]));
    player = createSimulatedCar(
      car,
      carText,
      loadedDamage,
      start,
      ((track.heading ?? 0) * Math.PI) / 180,
      true,
      { immutableHulls: true },
    );
    if (!placeCarAtStart(player, collision, noncarBodies).placed)
      throw new Error(
        "No supported, collision-free player start could be found near the race grid.",
      );
    start.copy(player.state.position);
    vehicle = player.state;
    repairControl = createRepairControl();
    player.upgrades = createUpgradeState(upgradeSettings, {
      skill: raceDifficulty,
    });
    updateUpgradeFactors(player);
    simulation = new VehicleSimulation(newCollision, scene);
    const dustCount = parseDustShades(trackText).length;
    simulation.onFinishCars = (framePeriodMs) => {
      if (!smoke || !simulation || !dustCount) return;
      for (const body of simulation.cars) {
        if (!simulation.isCarPhysicsActive(body) || !body.debug) continue;
        const inverse = body.state.orientation.clone().invert();
        const velocity = body.state.velocity.clone().applyQuaternion(inverse);
        const omega = body.state.angularVelocity
          .clone()
          .applyQuaternion(inverse);
        const bounds = new THREE.Box3();
        for (const hull of body.hulls)
          for (const point of hull.vertices) bounds.expandByPoint(point);
        body.group.updateMatrixWorld(true);
        body.debug.wheelSurfaceModifiers?.forEach((modifier, wheel) => {
          if (!modifier) return;
          smoke!.spawnSurfaceSmoke(
            {
              actor: body.group,
              wheel,
              wheelPosition: body.motion.wheelPositions[wheel],
              suspensionDistance: body.state.wheelLengths[wheel],
              suspensionHeight: body.motion.suspensionLength[wheel >> 1],
              velocityCarSpace: velocity,
              omega,
              bounds,
              smokeType: modifier.smokeType,
              dustRotate: 0,
              dustCount,
              driver: body.state.driver ?? (body.human ? 8 : 6),
              disabled: false,
            },
            framePeriodMs,
          );
        });
      }
    };
    simulation.onWheelMarks = (body) => {
      if (!skidmarks || !body.debug) return;
      for (let wheel = 0; wheel < 4; wheel++) {
        const hit = body.debug.wheelContacts?.[wheel];
        const surface = hit?.surface;
        const position = body.motion.wheelPositions[wheel].clone();
        position.x -= wheel & 1 ? 0.1725 : -0.1725;
        position.y -= body.state.wheelLengths[wheel];
        position
          .multiplyScalar(1 / 6.9)
          .applyQuaternion(body.state.orientation)
          .add(body.state.position);
        const normal = hit?.normal.clone() ?? new THREE.Vector3(0, 1, 0);
        const planePoint = surface?.a ?? hit?.point;
        if (planePoint)
          position.addScaledVector(
            normal,
            normal.dot(planePoint) - normal.dot(position),
          );
        const beforeOil = simulation?.oil?.wheelOilRemaining(body, wheel) ?? 0;
        const result = skidmarks.singlePhysicsWheelSample({
          car: body.group,
          wheel,
          requested: body.debug.skidRequests[wheel],
          position,
          normal,
          skidMaterial: body.debug.wheelSurfaceModifiers?.[wheel]?.skidMaterial,
          contact: {
            present: !!hit,
            pixelmapType: surface?.pixelmapType,
            materialName: surface?.material,
          },
          suspensionDistance: body.state.wheelLengths[wheel],
          suspensionHeight: body.motion.suspensionLength[wheel >> 1],
          oilRemaining: beforeOil,
          oilMaterial:
            simulation?.oil?.wheelOilMaterial(body, wheel)?.name ??
            "OILSMEAR.MAT",
        });
        if (result.oilRemaining < beforeOil)
          simulation?.oil?.consumeOilMark(
            body,
            wheel,
            beforeOil - result.oilRemaining,
          );
      }
    };
    simulation.onStopTyreEffects = (body) => tyreEffects.stopOwner(body);
    simulation.onTyreAxle = (body, input) => {
      const selection = tyreEffects.selectAxle(input);
      if (!selection) return;
      const modifier =
        input.modifiers[selection.wheel] ??
        simulation!.world.modifier?.(0) ??
        DEFAULT_SURFACE;
      const actorPhysicsMatrix = new THREE.Matrix4().compose(
        body.state.position.clone().multiplyScalar(6.9),
        body.state.orientation,
        new THREE.Vector3(1, 1, 1),
      );
      const result = tyreEffects.produce({
        ...selection,
        owner: body,
        driver: body.state.driver ?? (body.human ? 8 : 6),
        modifier,
        wheelPositionPhysics: body.motion.wheelPositions[selection.wheel],
        oldSuspensionDistance: body.state.wheelLengths[selection.wheel],
        actorPhysicsMatrix,
        omegaBody: input.omegaBody,
        velocityCarSpace: input.velocityCarSpace,
        supportNormalBody: input.supportNormalBody,
        cachedSoundVelocity: body.cachedSoundVelocity,
        timeSyncMs: simulation!.mechanicsTimeSync,
      });
      if (result.puff) smoke?.spawnPuff(result.puff);
    };
    simulation.onWorldSparks = (source) => sparks?.spawnWorld(source);
    simulation.onCarSparks = (source) => carSparks?.spawn(source);
    simulation.onOpponentRepulsed = (source, target) => {
      const com = (body: SimulatedCar) =>
        body.properties.centerOfMass
          .clone()
          .applyQuaternion(body.state.orientation)
          .add(body.state.position);
      pedestrians?.emitOpponentRepulsion(
        () => com(source),
        () => com(target),
        stats.gameTimeMs,
      );
    };
    simulation.deferFinalSmashFlush = true;
    simulation.smashClock = () => stats.gameTimeMs >>> 0;
    simulation.onSmashPowerup = ({ car: recipient, index }) => {
      if (recipient === player && race)
        powerups?.grant(index, recipient.state, race, onPowerupEvent);
    };
    simulation.gravityMultiplier = defaultGravityMultiplier;
    simulation.flapGravity = loadedDamage.structuralSettings.battyGravity;
    simulation.onPinball = () => void audio.playSound(9011);
    simulation.onWorldGeometryChanged = () =>
      pedestrians?.invalidateWorldGeometry();
    simulation.specialVolumes = parseTrackSpecialVolumes(trackText);
    simulation.defaultWaterVolume = parseDefaultWaterVolume(generalText);
    simulation.oil = new OilRuntime({
      texture: assets.textures.get("oil"),
      random: sharedNativeRandom.random,
    });
    simulation.mineFactory = {
      actor: mineModel,
      bounds: new THREE.Box3().setFromObject(mineModel),
      mass: mineMass,
    };
    simulation.onMineEvent = (event) => {
      if (event.kind === "impactSound") void audio.playSound(event.sound);
      if (event.kind === "explode")
        void audio.playSound(explosionSettings.soundId);
      if (event.kind === "explode")
        explosions?.spawn(
          explosionSettings.groups,
          event.mine.position,
          simulation!.mineFactory!.bounds,
          simulation!.elapsed * 1000,
          new THREE.Vector3(...explosionSettings.groups[0].offset).negate(),
          event.mine.orientation,
        );
    };
    simulation.destruction = loadedDestruction;
    const followupSimulation = simulation;
    const followupRoot = world.group;
    worldFollowups = new WorldFollowupRuntime({
      delayed: simulation.delayedSmashes,
      readTimeMs: () => followupSimulation.smashClock(),
      readTrackMatrix: () => {
        followupRoot.updateWorldMatrix(true, false);
        return followupRoot.matrixWorld.elements;
      },
      collectFaces: (query, capacity) =>
        loadedDestruction.collectFollowupFaces(query, capacity, {
          readActorPose: (actor) =>
            followupSimulation.liveSmashPhysics(actor)?.transform,
          isRegisteredNoncar: (actor) =>
            followupSimulation.noncars.some((body) => body.actor === actor),
        }),
      random: sharedNativeRandom.random,
      onDue: (context) =>
        dispatchFollowupSmash(followupSimulation, loadedDestruction, context),
      onUnsupportedDirection: () => {
        const warning = "Native parallel followup direction is unresolved";
        recordBackgroundDiagnostic("World follow-up", warning);
        console.warn(warning);
      },
    });
    simulation.grooves = loadedGrooves;
    for (const body of movingWorld) simulation.addMovingWorld(body);
    assets.warnings.push(
      ...loadedDestruction.diagnostics,
      ...loadedGrooves.diagnostics.map(
        (item) => `${currentTrack}: ${item.message}`,
      ),
    );
    for (const warning of simulation.specialVolumes.diagnostics)
      assets.warnings.push(`${currentTrack}: ${warning}`);
    renderPoses = new RenderPoses();
    const activeSimulation = simulation;
    simulation.onBeforeStep = () =>
      renderPoses.capture([
        ...activeSimulation.cars,
        ...activeSimulation.debris,
        ...activeSimulation.noncars,
        ...activeSimulation.movingWorld,
        ...activeSimulation.mineBodies,
        ...activeSimulation.pedBoneBodies,
      ]);
    simulation.settings = upgradeSettings;
    simulation.skill = raceDifficulty;
    simulation.crashDamageAwards = parseCrashDamageAwards(generalText);
    simulation.onCrashAttribution = (attacker, victim) =>
      opponentFleet?.onCrashAttribution(attacker, victim);
    simulation.onCrashDamageAward = (_victim, credits, seconds, multiplier) => {
      if (!race || !awardRaceCredits(race, credits)) return;
      awardRaceTime(race, seconds);
      message(`${multiplier > 1 ? "CRASH BONUS" : "DAMAGE"} · +${credits} CR`);
    };
    bindWamEffects(player, loadedCar.materials);
    registerCarSmoke(player, carText);
    registerShrapnelMaterials(
      player.group,
      parseCarShrapnelMaterials(carText),
      player.state.driver ?? 8,
    );
    simulation.add(player);
    for (const body of noncarBodies) {
      registerShrapnelMaterials(
        body.actor,
        body.mechanics.shrapnelMaterials,
        5,
      );
      simulation.addNonCar(body);
    }
    const debrisSimulation = simulation;
    const debrisActorGroup = new THREE.Group();
    debrisActorGroup.name = "C2 physical noncar debris";
    scene.add(debrisActorGroup);
    noncarDebrisActors = debrisActorGroup;
    let noncarActorCount = originalNonCarActorCount;
    const slotKey = (slot: NativeNonCarBodySlot) =>
      slot.kind === "dedicated"
        ? `dedicated:${slot.mechanicsIndex}`
        : `extra:${slot.index}`;
    loadedDebrisRuntime = new NativeNonCarDebrisRuntime({
      originalActorCount: originalNonCarActorCount,
      readActorCount: () => noncarActorCount,
      addActor: (actor) => {
        debrisActorGroup.add(actor);
        noncarActorCount++;
      },
      removeActor: (actor) => {
        debrisSimulation.world.discardNonCarClone(actor);
        actor.removeFromParent();
        noncarActorCount--;
      },
      isBodySlotOccupied: (slot) =>
        debrisSimulation.nonCarSlots.isOccupied(slot),
      pull: (actor, template, slot) => {
        const body = createNonCarBody(actor, template.mechanics, {
          immutableHulls: true,
        });
        initializeNativeNonCarDebrisBody(body);
        if (!debrisSimulation.world.retainNonCarClone(actor, template.actor))
          assets.warnings.push(
            `Native retained-ACT providers unavailable for noncar debris: ${actor.name}`,
          );
        // The pool/header decision precedes launch/RNG/smoke publication.
        if (!debrisSimulation.admitNonCar(body, { slot, wake: true }))
          return null;
        return body;
      },
      registerBody: (body, slot) => {
        body.actor.userData.nativeDebrisSlot = slotKey(slot);
        registerShrapnelMaterials(
          body.actor,
          body.mechanics.shrapnelMaterials,
          5,
        );
        debrisSimulation.addNonCar(body);
      },
      addSmokeColumn: (source) => void smoke?.spawnColumn(source),
      diagnose: (text) => assets.warnings.push(text),
    });
    noncarDebris = loadedDebrisRuntime;
    noncarRenderBatch = new NonCarRenderBatch(noncarBodies, scene);
    simulation.onRepair = (body, cost, finished) => {
      if (body.human && finished) repairControl.autoRepair = false;
      if (body.human && race && body.upgrades && upgradeSettings) {
        body.upgrades.credits = race.credits;
        payRepair(
          body.upgrades,
          cost,
          upgradeSettings,
          { skill: raceDifficulty },
          body.freeRepairs,
        );
        race.credits = body.upgrades.credits;
        updateUpgradeFactors(body);
      }
    };
    simulation.onImpact = (body, speed) => {
      if (body.human && speed > 0.8) {
        message("IMPACT · E TO REPAIR");
        audio.impact(speed / 6);
      }
    };
    simulation.onFullRepair = (body) => {
      const source = carSmokeSources.get(body);
      if (source) smoke?.expireCarColumns(source.car);
    };
    simulation.onWetSmoke = (body) => {
      const source = carSmokeSources.get(body);
      if (source) smoke?.shortenCarColumns(source.car, 2000);
    };
    simulation.onStopCarSmoke = simulation.onWetSmoke;
    simulation.onDamageSmoke = (body) => {
      const source = carSmokeSources.get(body);
      dispatchNativeDamageSmoke({
        driver: body.state.driver ?? (body.human ? 8 : 6),
        current: body.damage.componentLevels,
        smokeLast: body.smokeLastComponentLevels,
        shortenExisting: () => {
          if (source) smoke?.shortenCarColumns(source.car, 2000);
        },
        setSmoke: (component, colour) => {
          if (!source?.fireVertices || !smoke) return;
          smoke.spawnComponentColumn({
            mode: 1,
            actor: body.group,
            car: source.car,
            rigid: {
              get velocity() {
                return body.state.velocity;
              },
              get omega() {
                return body.state.angularVelocity;
              },
              actor: body.group,
            },
            driver: body.state.driver ?? (body.human ? 8 : 6),
            knackered: body.knackered,
            volumeGravity: body.specialVolume?.volume?.gravityMultiplier,
            colour,
            vertex: source.fireVertices[component],
            lifetimeMs: 10000000,
            sampleVertex: source.sample,
          });
        },
      });
    };
    simulation.onKnackeredSmoke = (body) => {
      const source = carSmokeSources.get(body);
      if (smoke && source)
        createNativeWreckColumns({
          networkMode: 0,
          knackered: body.knackered,
          volumeGravity: body.specialVolume?.volume?.gravityMultiplier,
          shortenExisting: (maximum) =>
            smoke!.shortenCarColumns(source.car, maximum),
          spawn: (packet) =>
            smoke!.spawnColumn({
              ...packet,
              actor: body.group,
              car: source.car,
              rigid: {
                get velocity() {
                  return body.state.velocity;
                },
                get omega() {
                  return body.state.angularVelocity;
                },
                actor: body.group,
              },
              sampleVertex: source.sample,
            }),
        });
    };
    simulation.onWasted = (body) => {
      const rival = rivals.find((r) => r.body === body);
      if (body.human && race) race.awardsClosed = true;
      else if (rival) finishRivalWastage(rival);
      else checkRaceObjective();
      wastedFeedback.wasted(
        body.human ? "player" : "rival",
        body.human ? "player" : (rival?.id ?? body.group.uuid),
        rival ? (opponents[rival.id]?.driverShortName ?? body.group.name) : "",
        simulation!.elapsed * 1000,
        explosionSettings.soundId,
        !!body.wastedByPlayer,
      );
      // CheckDamage 0x43f620 plays the configured wasted explosion before
      // KnackerThisCar. RaceCompleted(6) supplies the original fancy text.
      const bounds = new THREE.Box3();
      for (const hull of body.hulls)
        for (const vertex of hull.vertices) bounds.expandByPoint(vertex);
      explosions?.spawn(
        explosionSettings.groups,
        body.state.position,
        bounds,
        simulation!.elapsed * 1000,
        undefined,
        body.state.orientation,
      );
    };
    car.position.copy(start);
    car.quaternion.copy(vehicle.orientation);
    const lapRace =
      availability?.mode !== "free-drive" &&
      availability?.mode !== "combat" &&
      (!definition ||
        ["carma", "checkpoints"].includes(String(definition.raceType)));
    race = createRace(
      (lapRace ? track.checkpoints : []).map((c) => ({
        points: c.points.map((p) => new THREE.Vector3(...p)),
      })),
      {
        practice: availability?.mode === "free-drive" || undefined,
        laps: definition?.laps ?? 4,
        disableTimeAwards: definition?.disableTimeAwards ?? false,
        timeLimit: definition?.initialTimer[0] ?? 180,
        credits: player.upgrades.credits,
        checkpointBonusSeconds: 0,
        deferCompletionAwards: true,
        checkpointCredits: raceAwards.checkpointCredits[raceDifficulty],
        completionTimeCreditRate: raceAwards.timeBonusCredits[raceDifficulty],
        completionCreditsByReason:
          definition?.raceType === "carma"
            ? definition.raceCompletedBonus.map(
                (bonus) => bonus[raceDifficulty],
              )
            : Array(4).fill(
                definition?.raceCompletedBonus[0]?.[raceDifficulty] ?? 20000,
              ),
        completionCredits:
          definition?.raceCompletedBonus[0]?.[raceDifficulty] ?? 20000,
      },
    );
    el("race-name").textContent = definition?.name ?? stemOf(currentTrack);
    const skyTexture = track.sky
      ? world.textures.get(track.sky.replace(/\.pix$/i, "").toLowerCase())
      : undefined;
    if (skyTexture) {
      const texture = skyTexture.clone();
      texture.repeat.set(track.skySettings?.repeat ?? 7, 1);
      texture.flipY = true;
      texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      sky = new THREE.Mesh(
        new THREE.CylinderGeometry(900, 900, 1200, 64, 1, true),
        new THREE.MeshBasicMaterial({
          map: texture,
          side: THREE.BackSide,
          depthWrite: false,
          fog: false,
        }),
      );
      const height =
        2 *
        900 *
        Math.tan(((track.skySettings?.verticalDegrees ?? 60) * Math.PI) / 360);
      sky.scale.y = height / 1200;
      const horizon =
        (track.skySettings?.horizonPixel ?? skyTexture.image.height / 2) /
        skyTexture.image.height;
      sky.position.y = (horizon - 0.5) * height;
      sky.layers.set(1);
      sky.renderOrder = -10;
      scene.add(sky);
    }
    if (nativeCameraSettings) {
      const initialFraming = selectInitialCameraZoom(
        cameraBounds,
        player.properties.centerOfMass,
        player.hulls,
        { ...nativeCameraSettings, far: nativeCameraYon },
        camera.aspect,
      );
      nativeChase.zoom = initialFraming.zoom;
      if (!initialFraming.framed)
        assets.warnings.push(
          `${currentCar}: body exceeds the native camera zoom range at this viewport aspect.`,
        );
    }
    // Async asset loading can render the preceding car; reset only after the
    // newly selected body and its COM have been published.
    cameraVehicleTravel.reset(player.state.orientation);
    cameraControlReset = false;
    cameraNeedsReset = true;
    camera.position.copy(start).add(new THREE.Vector3(0, 1, 2));
    camera.lookAt(start);
    stats.ready = true;
    gameClock.start(performance.now(), true);
    status(
      `Loaded ${world.stats.models} track models, ${loadedCar.stats.models} car models; ${world.stats.missingTextures} unresolved world textures.`,
    );
    localStorage.setItem(
      "c2-selection",
      JSON.stringify({ track: currentTrack, car: currentCar }),
    );
    setPaused(false);
    message(
      race.practice
        ? "FREE DRIVE · W / ↑ TO DRIVE"
        : "RACE START · W / ↑ TO DRIVE",
      5,
    );
    refreshPopulationAvailability();
    const settlePopulation = (
      kind: "opponents" | "pedestrians",
      result: PopulationLoad,
    ) => {
      // A late completion/rejection from an earlier race owns no current flags.
      if (loadGeneration !== generation) return;
      populationLoads[kind] = result;
      refreshPopulationAvailability();
      checkRaceObjective();
      checkSmashObjective();
    };
    const populationRaceContext = definition?.name ?? currentTrack;
    loadPedestrians(trackText, loadGeneration).then(
      () => settlePopulation("pedestrians", { state: "ready" }),
      (error) => {
        recordBackgroundDiagnostic(
          "Pedestrian background loading",
          error,
          populationRaceContext,
        );
        console.warn("Pedestrian content:", error);
        settlePopulation("pedestrians", {
          state: "failed",
          reason: error instanceof Error ? error.message : String(error),
        });
      },
    );
    (definition
      ? loadRivals(definition, loadGeneration, generalText)
      : Promise.resolve()
    ).then(
      () => settlePopulation("opponents", { state: "ready" }),
      (error) => {
        recordBackgroundDiagnostic(
          "Opponent background loading",
          error,
          populationRaceContext,
        );
        console.warn("Opponent content:", error);
        settlePopulation("opponents", {
          state: "failed",
          reason: error instanceof Error ? error.message : String(error),
        });
      },
    );
  } catch (error) {
    recordBackgroundDiagnostic("Race loading", error);
    status(`Load failed: ${error instanceof Error ? error.message : error}`);
    console.error(error);
  } finally {
    loading = false;
    selectionMenu?.resumePreviews();
    el("play").removeAttribute("disabled");
    selectionMenu?.setLoading(false);
  }
}
/** Shared world/WAM effect outlets. Native alternatives select one sound.
 * Positional audio and unsupported connotation classes remain tracked gaps.
 */
function dispatchSmashConnotations(
  data: SmashConnotations,
  contact: WorldSmashContact,
  suppressed = false,
  shrapnel?: () => void,
  slickMaterials = worldSlickMaterials,
) {
  const sound = chooseSmashAudio(data.sounds, sharedNativeRandom.random);
  if (sound !== undefined)
    void audio.playSound(sound.id, 0.65, sound.playbackRate);
  const owner = simulation?.cars.find(
    (body) => body.group === contact.bodyActor,
  );
  const physics = owner
    ? {
        type: 1,
        owner: { car: owner, driver: owner.human ? 8 : 6 },
        position: owner.state.position.toArray() as [number, number, number],
      }
    : undefined;
  if (!suppressed)
    for (const activation of data.activations)
      simulation?.worldActivations.enqueue(activation, contact);
  if (
    !suppressed &&
    data.sideEffects.length &&
    simulation &&
    contact.bodyActor
  ) {
    const sourceActor = contact.bodyActor;
    const live = simulation.liveSmashPhysics(sourceActor);
    if (live) {
      const activeSimulation = simulation;
      worldFollowups?.enqueue(
        data.sideEffects,
        {
          actor: sourceActor,
          readMatrix: () =>
            (
              activeSimulation.liveSmashPhysics(sourceActor)?.transform ??
              live.transform
            ).elements,
          readVelocity: () =>
            (
              activeSimulation.liveSmashPhysics(sourceActor)?.velocity ??
              live.velocity
            ).toArray(),
        },
        contact.effectMagnitude ?? contact.normalImpulse,
      );
    }
  }
  // Native roomCode is an authored powerup index, following side-effect enqueue.
  if (simulation)
    enqueueConnotationPowerup(
      simulation.smashPowerupQueue,
      data.roomCode,
      physics,
      contact.point?.toArray() as [number, number, number] | undefined,
      suppressed,
    );
  shrapnel?.();
  const identity = contact.effectIdentity ?? data;
  let states = smashAwardStates.get(identity);
  if (!states) {
    states = new Map();
    smashAwardStates.set(identity, states);
  }
  let state = states.get(data);
  if (!state) {
    state = { awarded: false };
    states.set(data, state);
  }
  const award = consumeSmashAward(data.award, state, {
    physics: physics
      ? { type: physics.type, driver: physics.owner.driver }
      : undefined,
    effectMagnitude: contact.effectMagnitude ?? contact.normalImpulse,
    suppressed,
    raceFinished: !race || race.status !== "racing" || race.awardsClosed,
    noTimeAwards: race?.disableTimeAwards,
  });
  if (award) {
    if (race) {
      awardRaceCredits(race, award.credits);
      awardRaceTime(race, award.timeSeconds);
    }
    if (award.textIndex && miscStrings[award.textIndex])
      message(miscStrings[award.textIndex], 3);
  }
  if (data.explosions.length) {
    const source = contact.bodyActor ?? contact.actor;
    source.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3()
      .setFromObject(source)
      .applyMatrix4(source.matrixWorld.clone().invert());
    const transform = contact.impacteeTransform ?? source.matrixWorld;
    const orientation = new THREE.Quaternion();
    transform.decompose(new THREE.Vector3(), orientation, new THREE.Vector3());
    explosions?.spawn(
      data.explosions,
      contact.point ?? new THREE.Vector3().setFromMatrixPosition(transform),
      bounds,
      contact.timeMs ?? 0,
      undefined,
      orientation,
    );
  }
  if (data.slick && simulation?.oil) {
    try {
      const actor = contact.actor;
      const source = nativeOilActorFollower(actor);
      const spill = queueWorldSlick(
        simulation.oil,
        data.slick,
        source,
        slickMaterials,
        stats.gameTimeMs >>> 0,
      );
      if (spill) scene.add(spill.mesh);
    } catch (error) {
      const warning = String(error);
      if (!assets.warnings.includes(warning)) assets.warnings.push(warning);
    }
  }
  // Native variable effects precede the immediate smash-completion check.
  missionVariables.apply(data.variableChanges);
  checkSmashObjective();
}

function spawnAbstractShrapnel(
  spec: SmashConnotations["shrapnel"][number],
  contact: WorldSmashContact,
  materials: ReadonlyMap<string, THREE.Material>,
) {
  const original = (spec.materials ?? []).map((name) =>
    materials.get(name.replace(/\.mat$/i, "").toLowerCase()),
  );
  if (
    !contact.point ||
    !original.length ||
    original.some((material) => !material)
  ) {
    const warning = `Abstract shrapnel source/material unavailable: ${(spec.materials ?? []).join(", ")}`;
    if (!assets.warnings.includes(warning)) assets.warnings.push(warning);
    return;
  }
  shrapnel?.spawn(
    nativeAbstractShrapnel({
      position: contact.point,
      startingVelocity: contact.smashStartingVelocity,
      effectMagnitude: contact.effectMagnitude ?? contact.normalImpulse,
      materials: original as THREE.Material[],
    }),
  );
}

function dispatchFollowupSmash(
  activeSimulation: VehicleSimulation,
  destruction: WorldDestruction,
  context: FollowupDue,
) {
  const actor = context.face.actor.identity as THREE.Object3D;
  if (context.route === "numbered") {
    const body = activeSimulation.noncars.find((body) => body.actor === actor);
    if (body) {
      if (!activeSimulation.admitNonCar(body, { wake: true })) return;
      body.motor.sleeping = false;
    }
    actor.name = actor.name.slice(0, 3) + "!" + actor.name.slice(4);
    if (!context.eligibleAfterRelease) return;
  }
  const source = context.face.source as
    | { actor: THREE.Object3D; faceIndex: number; material: string }
    | undefined;
  const bodyActor = context.sourcePhysics.actor as THREE.Object3D;
  destruction.handleFollowup(
    {
      actor: source?.actor ?? actor,
      faceIndex: source?.faceIndex,
      material: source?.material,
      normalImpulse: context.magnitude,
      effectMagnitude: context.magnitude,
      kind: "body",
      bodyActor,
      point: new THREE.Vector3(...context.point),
      impacteeVelocity: new THREE.Vector3(...context.sourceVelocity),
      effectForce: new THREE.Vector3(...context.force),
      smashStartingVelocity:
        activeSimulation.startingActorSmashVelocity(bodyActor),
      impacteeTransform:
        activeSimulation.liveSmashPhysics(bodyActor)?.transform,
      timeMs: activeSimulation.smashClock(),
    },
    context.targetSpec,
    context.route === "numbered",
  );
  activeSimulation.synchronizeWorldDestruction();
}

function bindWamEffects(
  body: SimulatedCar,
  materials: ReadonlyMap<string, THREE.Material>,
) {
  body.damage.onStructuralBendSound = (playbackRate) =>
    void audio.playSound(5099, 0.65, playbackRate);
  body.damage.onWamSmash = (event) => {
    // Use the collision body's current pose, not its interpolated render pose.
    const transform = new THREE.Matrix4().compose(
      body.state.position,
      body.state.orientation,
      new THREE.Vector3(1, 1, 1),
    );
    const contact: WorldSmashContact = {
      actor: event.actor,
      bodyActor: body.group,
      kind: "body",
      normalImpulse: 0,
      impacteeVelocity: body.state.velocity.clone(),
      impacteeTransform: transform,
      point: event.localPoint.clone().applyMatrix4(transform),
      timeMs: event.timeMs,
      smashStartingVelocity: event.startingVelocity,
      effectMagnitude: Math.fround(event.startingVelocity.length()),
      effectIdentity: body.damage,
    };
    // Preserve model/ACT transforms, replacing only the stale render root pose.
    body.group.updateWorldMatrix(true, true);
    let ancestor: THREE.Object3D | null = event.mesh;
    while (ancestor && ancestor !== body.group) ancestor = ancestor.parent;
    // Detachment can reparent the live queued actor before this final flush.
    // Independent physical pieces already have their own world-space pose.
    const meshTransform = ancestor
      ? transform
          .clone()
          .multiply(
            body.group.matrixWorld
              .clone()
              .invert()
              .multiply(event.mesh.matrixWorld),
          )
      : event.mesh.matrixWorld.clone();
    const meshMaterials = Array.isArray(event.mesh.material)
      ? event.mesh.material
      : [event.mesh.material];
    const slots = meshMaterials.flatMap((material, slot) =>
      material.name.toLowerCase() === event.smash.material.toLowerCase()
        ? [slot]
        : [],
    );
    dispatchSmashConnotations(
      event.connotations,
      contact,
      false,
      () => {
        for (const spec of event.connotations.shrapnel)
          if (spec.kind === "abstract")
            spawnAbstractShrapnel(spec, contact, materials);
          else if (spec.kind === "shards")
            shards?.spawn(spec, {
              geometry: event.mesh.geometry,
              matrixWorld: meshTransform,
              materialSlots: slots,
              sourceVertexLimit: 50,
              sourceFaceLimit: 50,
              materials,
              impacteeVelocity: event.startingVelocity,
              timeMs: event.timeMs,
            });
      },
      materials,
    );
  };
}

async function loadRivals(
  definition: RaceCatalogEntry | undefined,
  loadGeneration: number,
  generalText: string,
) {
  if (!track || !vehicle || !collision || !simulation || !player) return;
  const activeSimulation = simulation;
  const activeCollision = collision;
  const activeTrack = currentTrack;
  const gridOrigin = vehicle.position.clone();
  const gridHeading = vehicle.heading;
  const nodes = track.pathNodes;
  const catalog =
    raceCatalogs.get(currentTrack.split("/")[0].toLowerCase()) ??
    raceCatalogs.get("data");
  if (!catalog)
    throw new Error("Opponent loading requires the original race catalog");
  const raceIndex = definition ? catalog.races.indexOf(definition) : 0;
  const requests = resolveOpponentRequests(catalog, raceIndex);
  const playerId = opponents.findIndex(
    (opponent) =>
      opponent.carFilename.replace(/\.txt$/i, "").toLowerCase() ===
      stemOf(currentCar).toLowerCase(),
  );
  const ids = selectOpponentIds(requests, opponents, playerId);
  if (!ids.length) return;
  if (!nodes.length)
    throw new Error(
      "Opponent navigation data is missing; race population is incomplete",
    );
  const candidates = ids.map((id) => {
    const path = findConfig("CARS", opponents[id].carFilename);
    if (!path)
      throw new Error(
        `Opponent ${id} car asset is missing: ${opponents[id].carFilename}`,
      );
    return { id, path };
  });
  const count = candidates.length;
  const pathNodes = nodes.map((p) => new THREE.Vector3(...p));
  const nastiness = resolveNativeRaceNastiness(catalog, raceIndex);
  const personalities = assignNativePersonalities(count, nastiness);
  const placement = new NativeOpponentPlacement(
    activeSimulation,
    activeCollision,
    pathNodes,
    track.pathSections,
    (body) => fleet.teleportToSafeLocation(body),
  );
  const fleet = new NativeOpponentFleet(
    pathNodes,
    track.pathSections,
    opponents,
    nastiness,
    player,
    {
      skill: activeSimulation.skill,
      random: sharedNativeRandom.random,
      raceIndex,
      raceCount: catalog.races.length,
      viewDistance: nativeOpponentViewDistance(nativeCameraYon),
      repairLimits: readNativeOpponentRepairLimits(generalText),
      rayFraction: (origin, direction) => {
        const length = direction.length();
        const hit = activeCollision.raycast(origin, direction, length);
        return hit ? Math.fround(hit.distance / length) : 100;
      },
      isPhysicsActive: (body) => activeSimulation.isCarPhysicsActive(body),
      setPhysicsActive: (body, active) => {
        distantOpponentPresentation.invalidate(body);
        activeSimulation.setCarPhysicsActive(body, active);
        body.group.visible = active;
      },
      onCheatyPose: (body) => distantOpponentPresentation.publish(body),
      rematerialize: (body, view, slot, speed) =>
        placement.onSection(body, view, slot, speed),
      rematerializeNearest: (body, speed) => placement.nearest(body, speed),
      hasFallenOffWorld: (body) =>
        nativeHasCarFallenOffWorld(
          {
            position: body.state.position,
            actorUp: new THREE.Vector3(0, 1, 0).applyQuaternion(
              body.state.orientation,
            ),
            driver: body.human ? 8 : 6,
            wheelsOnGround: body.state.groundedWheelCount ?? 0,
            cachedMaterialNames: activeSimulation.cachedCarMaterialNames(body),
            carFlying: false,
            actionReplay: false,
          },
          (origin) => activeCollision.nativeYBelow(origin),
        ),
      repair: (body) => activeSimulation.repair(body),
      // Installed empty-route return reads an uninitialized stack slot. The
      // browser treats only that undefined branch as continue, never throws
      // or invents a physical path-end transition.
      emptyRaceRouteStatus: () => 0,
      diagnostic: (text) => assets.warnings.push(text),
    },
  );
  opponentFleet = fleet;
  for (let i = 0; i < count && i < candidates.length; i++) {
    const configPath = candidates[i].path;
    const text = await assets.text(configPath);
    const config = parseCarConfig(text);
    const model = await assets.scene(dirOf(configPath), stemOf(configPath), {
      shading: 2,
      storage: "opponents",
    });
    const rivalDamage = new DamageSystem(assets, model.group, text, configPath);
    rivalDamage.structuralSettings = parseStructuralSettings(generalText);
    try {
      await rivalDamage.init();
    } catch (error) {
      model.dispose();
      disposeGroup(model.group);
      throw error;
    }
    if (activeTrack !== currentTrack || loadGeneration !== generation) {
      model.dispose();
      disposeGroup(model.group);
      return;
    }
    let closest = 0,
      distance = Infinity;
    const spawn = gridOrigin
      .clone()
      .add(
        new THREE.Vector3(
          (i % 2 ? 1 : -1) * 0.8,
          0,
          1 + Math.floor(i / 2) * 1,
        ).applyAxisAngle(new THREE.Vector3(0, 1, 0), gridHeading),
      );
    const heading = gridHeading;
    const body = createSimulatedCar(
      model.group,
      text,
      rivalDamage,
      spawn,
      heading,
      false,
      { immutableHulls: true },
    );
    const reservedStarts = [
      ...(simulation?.cars ?? []),
      ...(simulation?.noncars ?? []),
    ];
    let placement = placeCarAtStart(body, collision, reservedStarts);
    // Browser grid safety extension: dense authored populations and large
    // vehicles can exhaust the immediate grid. Search farther only on failure;
    // retain all ground, hull and wheel-support checks and never force a pose.
    if (!placement.placed)
      placement = placeCarAtStart(body, collision, reservedStarts, {
        searchRadius: 4,
      });
    if (!placement.placed) {
      model.dispose();
      disposeGroup(model.group);
      throw new Error(
        `Opponent ${candidates[i].id} has no supported, collision-free start; race population is incomplete`,
      );
    }
    const state = body.state;
    for (let n = 0; n < nodes.length; n++) {
      const d = new THREE.Vector3(...nodes[n]).distanceToSquared(
        state.position,
      );
      if (d < distance) {
        distance = d;
        closest = n;
      }
    }
    if (upgradeSettings)
      state.powerMultiplier =
        player?.state.powerMultiplier ?? upgradeSettings.factors[1][0];
    bindWamEffects(body, model.materials);
    registerCarSmoke(body, text);
    registerShrapnelMaterials(
      body.group,
      parseCarShrapnelMaterials(text),
      body.state.driver ?? 6,
    );
    simulation?.add(body);
    fleet.add(body, candidates[i].id, personalities[i]);
    model.group.position.copy(state.position);
    model.group.quaternion.copy(state.orientation);
    scene.add(model.group);
    rivals.push({
      object: model.group,
      state,
      body,
      node: closest,
      previousNode: -1,
      stuck: 0,
      navigator: new RoadNavigator(
        nodes.map((p) => new THREE.Vector3(...p)),
        track!.pathEdges,
      ),
      speedController: new NativeOpponentSpeedController(),
      frozen: false,
      hotrodRevision: -1,
      wasted: false,
      damage: rivalDamage,
      id: candidates[i].id,
      animation: new CarAnimation(model.group, text),
      textures: new TextureAnimation(
        groupMaterials(model.group),
        model.textures,
        text,
      ),
    });
  }
}
async function loadPedestrians(text: string, loadGeneration: number) {
  if (!content || !collision || !vehicle) return;
  const active = currentTrack;
  const napalmSmoke = new WeakMap<THREE.Object3D, SmokeRigid>();
  const system = await PedestrianSystem.create(
    assets,
    content,
    text,
    collision.height.bind(collision),
    {
      spawn: vehicle.position,
      collision,
      onCombatSound: (id) => {
        void audio.playSound(id);
      },
      onNapalmExtinguished: (actor) => {
        const rigid = napalmSmoke.get(actor);
        if (rigid) smoke?.stopObject(rigid);
      },
      onNapalmIgnited: (actor, velocity, omega) => {
        let mesh: THREE.Mesh<THREE.BufferGeometry> | undefined;
        actor.traverse((child) => {
          if (
            !mesh &&
            child instanceof THREE.Mesh &&
            child.geometry.getAttribute("position")
          )
            mesh = child;
        });
        if (!mesh || !smoke) return;
        const geometry = mesh.geometry,
          positions = geometry.getAttribute("position");
        const group = geometry.groups[0];
        const sourceIndices = geometry.userData.sourceVertexIndices as
          | Uint32Array
          | undefined;
        // Adapter maps the first render group to unique original vertices.
        // Exact BRender prepared-vertex ordering remains an animation gap.
        const candidates = Array.from(
          { length: group?.count ?? geometry.index?.count ?? positions.count },
          (_, i) =>
            geometry.index?.getX((group?.start ?? 0) + i) ??
            (group?.start ?? 0) + i,
        );
        const seen = new Set<number>();
        const indices = candidates.filter((index) => {
          const id = sourceIndices?.[index] ?? index;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        if (!indices.length) return;
        // Preserve the native inclusive draw; protect its one-past-end result
        // instead of reading invalid BRender memory or silently losing the fire.
        const vertex = Math.min(
          indices.length - 1,
          Math.floor(sharedNativeRandom.random() * (indices.length + 1)),
        );
        const rigid = { velocity, omega, actor };
        napalmSmoke.set(actor, rigid);
        smoke.spawnColumn({
          mode: 2,
          actor,
          rigid,
          colour: 0,
          vertex,
          lifetimeMs: 25000,
          sampleVertex: (index, out) => {
            const selected = indices[index];
            if (selected === undefined) return false;
            mesh!.updateWorldMatrix(true, false);
            actor.updateWorldMatrix(true, false);
            out
              .fromBufferAttribute(positions, selected)
              .applyMatrix4(mesh!.matrixWorld)
              .applyMatrix4(actor.matrixWorld.clone().invert());
            return true;
          },
        });
      },
      readGravityMultiplier: (position) =>
        simulation
          ? findSpecialVolume(
              simulation.specialVolumes?.volumes ?? [],
              position,
            )?.gravityMultiplier
          : undefined,
      onCount: (event) => {
        if (race?.status === "racing" && !race.awardsClosed) {
          if (
            definition?.raceType === "smashAndPed" &&
            definition.pedGroupsToKill.includes(event.group) &&
            definition.smashVariable != null
          ) {
            missionVariables.add(definition.smashVariable, event.count);
          }
          // Native direct-kill path calls OneLessPed/completion before scoring.
          checkRaceObjective();
          checkSmashObjective();
        }
      },
      onHit: (event) => {
        if (race?.status === "racing" && !race.awardsClosed) {
          if (
            pedAwards &&
            race.status === "racing" &&
            event.owner === player &&
            player
          ) {
            const inverse = player.state.orientation.clone().invert();
            const center = player.properties.centerOfMass
              .clone()
              .applyQuaternion(player.state.orientation)
              .add(player.state.position);
            const award = pedAwardCounter.score(
              event.timeMs,
              pedAwards,
              raceDifficulty,
              {
                ...event.awardContext,
                killerDriver: player.state.driver,
                killerAngularVelocity: player.state.angularVelocity
                  .clone()
                  .applyQuaternion(inverse),
                killerUpY: new THREE.Vector3(0, 1, 0).applyQuaternion(
                  player.state.orientation,
                ).y,
                killerActorOriginY: player.state.position.y,
                pedestrianY: event.position.y,
                localPedPosition: event.position
                  .clone()
                  .sub(center)
                  .applyQuaternion(inverse),
                killerLocalVelocity: player.state.velocity
                  .clone()
                  .applyQuaternion(inverse),
              },
            );
            if (award) {
              const before = race.credits;
              awardRaceCredits(race, award.credits);
              awardRaceTime(race, award.seconds);
              message(
                `PEDESTRIAN HIT · +${(race.credits - before) | 0} CR${award.combo > 1 ? ` · COMBO ${award.combo}` : ""}`,
              );
            }
          }
          if (event.count > 0) audio.impact(0.25);
          checkSmashObjective();
        }
      },
    },
  );
  if (active !== currentTrack || loadGeneration !== generation) {
    system.dispose();
    return;
  }
  pedestrians = system;
  // Establish native processing/popup visibility before the first rendered
  // frame, including a race which remains paused after its asynchronous load.
  system.update(
    0,
    {
      position: vehicle.position,
      yaw: vehicle.heading,
      speed: 0,
      velocity: new THREE.Vector3(),
    },
    { cameraPosition: camera.position, threats: [] },
  );
  scene.add(system.group);
}
function motionAnimation(body: SimulatedCar) {
  const p = body.motion,
    s = body.state;
  return {
    wheelLengths: s.wheelLengths,
    wheelRayHeights: p.wheelPositions.map((w) => w.y),
    steeringAngle: Math.atan(
      (p.wheelPositions[0].z - p.wheelPositions[2].z) * s.curvature,
    ),
    rpm: s.rpm,
    gear: s.gear,
    speedRevsRatio: p.speedRevsRatio,
    handbrake: !!body.input.handbrake,
    componentDamage: Array.from(body.damage.componentLevels),
  };
}
/** Commit native wastage and its one-time feedback before race completion.
 * CheckDamage's callback can end the race within the same physics frame.
 */
function finishRivalWastage(r: Rival) {
  if (r.wasted) return;
  r.wasted = true;
  r.state.accForce = r.state.brakeForce = 0;
  r.body.input = { throttle: 0, steer: 0, brake: 0, handbrake: false };
  checkRaceObjective();
  if (
    r.body.wastedByPlayer &&
    raceAwards &&
    race &&
    !race.awardsClosed &&
    race.status === "racing"
  ) {
    const credits = wastedCarCredits(
      raceAwards.wastingCredits[raceDifficulty],
      r.damage.carSoftness,
    );
    awardRaceCredits(race, credits);
    awardRaceTime(race, raceAwards.wastingTime[raceDifficulty]);
    message(`OPPONENT WASTED · +${credits} CR`);
  }
  r.object.traverse((o) => {
    if (o instanceof THREE.Mesh)
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m instanceof THREE.MeshLambertMaterial) m.color.multiplyScalar(0.3);
      }
  });
}

function updateRivals(dt: number, speedFactor = 1) {
  if (!track || !collision || !vehicle || !race) return;
  const special = rivals.find((rival) => rival.id === 29);
  const speedState = powerups?.opponentSpeedState;
  if (special && speedState && special.hotrodRevision !== speedState.revision) {
    applyOpponentHotrod(
      rivals,
      powerups?.definitions[5]?.floatParams ?? [],
      speedState.active,
    );
    special.hotrodRevision = speedState.revision;
  }
  if (opponentFleet) {
    if (rivalsReady)
      opponentFleet.update(
        stats.gameTimeMs,
        Math.round(dt * 1000),
        speedFactor,
        race.status !== "racing",
      );
    else
      // Async browser loading is outside C2's synchronous InitOpponents.
      // Keep loaded cars parked until the entire authored fleet is registered.
      for (const r of rivals) {
        r.state.accForce = 0;
        r.state.brakeForce = Math.fround(15 * r.body.properties.mass);
      }
    for (const r of rivals) {
      r.frozen = speedFactor === 0;
      const animation = {
        ...motionAnimation(r.body),
        speed: r.state.speed,
        steer: r.body.input.steer,
        brake: !!r.body.input.brake,
        throttle: r.body.input.throttle,
      };
      r.animation.update(dt, animation);
      r.state.wheelDamageOffsets = r.animation.wheelDamageOffsets;
      r.textures.update(dt, animation);
      if (r.body.knackered) finishRivalWastage(r);
    }
    return;
  }
  for (const r of rivals) {
    if (r.wasted) {
      r.state.accForce = r.state.brakeForce = 0;
      continue;
    }
    const frozen = speedFactor === 0;
    if (r.frozen && !frozen) {
      r.speedController.reset();
      r.navigator.reset(r.state.position, r.state.heading);
    }
    r.frozen = frozen;
    const controls = frozen
      ? { throttle: 0, steer: 0, brake: 1, handbrake: false }
      : r.navigator.update(
          r.state.position,
          r.state.heading,
          r.state.speed,
          dt,
        );
    if (controls.recoverTo) {
      const p = controls.recoverTo;
      const h = collision.height(p.x, p.z, p.y + 1);
      if (h !== null) p.y = h + 0.05;
      r.state.position.copy(p);
      r.state.velocity.set(0, 0, 0);
      r.state.heading = controls.recoverHeading ?? r.state.heading;
      simulation?.reset(r.body);
      r.speedController.reset();
    }
    const forces = r.speedController.update({
      desiredSpeed: frozen ? 0 : r.navigator.desiredSpeed * 6.9,
      velocity: r.state.velocity,
      factor: speedFactor,
      engineDamage: r.damage.componentLevels[0],
      transmissionDamage: r.damage.componentLevels[1],
      mass: r.body.motion.mass,
      dtMs: dt * 1000,
    });
    r.state.accForce = forces.accForce;
    r.state.brakeForce = forces.brakeForce;
    if (!frozen) {
      const targetCurvature = controls.steer * r.body.motion.maxCurve;
      r.state.curvature = approachOpponentCurvature(
        r.state.curvature,
        targetCurvature,
        dt * 1000,
      );
    }
    r.body.input = {
      throttle: controls.throttle,
      steer: controls.steer,
      brake: controls.brake,
      handbrake: controls.handbrake,
    };
    r.animation.update(dt, {
      ...motionAnimation(r.body),
      speed: r.state.speed,
      steer: controls.steer,
      brake: !!controls.brake,
      throttle: controls.throttle,
    });
    r.state.wheelDamageOffsets = r.animation.wheelDamageOffsets;
    r.textures.update(dt, {
      speed: r.state.speed,
      steer: controls.steer,
      brake: !!controls.brake,
      throttle: controls.throttle,
    });
    r.object.position.copy(r.state.position);
    r.object.quaternion.copy(r.state.orientation);
    if (r.body.knackered) finishRivalWastage(r);
  }
}

function recover() {
  if (!vehicle || !race || !track || !collision || !player || !simulation)
    return;
  if (player?.knackered) {
    message("CAR WASTED · ENTER TO RESTART");
    return;
  }
  const voucher = (powerups?.recoveryVouchers ?? 0) !== 0;
  const recovered = recoverVehicle(
    vehicle,
    race,
    vehicle.position,
    vehicle.heading,
    voucher ? 0 : 250,
  );
  if (recovered) {
    simulation.recover(player);
    cunningStunts.cancelPending();
    cameraNeedsReset = true;
    if (voucher) powerups?.consumeRecoveryVoucher();
    pedestrians?.resetCar(vehicle.position);
    powerups?.resetPath(vehicle.position);
  }
  message(
    recovered
      ? voucher
        ? "RECOVERED · VOUCHER USED"
        : "RECOVERED · CR -250"
      : "NOT ENOUGH CREDITS",
  );
}
el("play").addEventListener("click", () => {
  void audio.unlock();
  void loadRace();
});
el("menu-button").addEventListener("click", () => {
  if (vehicle && !loading) {
    void audio.unlock();
    setPaused(!paused);
  }
});
function readPlayerCombatPosition(): THREE.Vector3 {
  if (!player) return new THREE.Vector3();
  return player.properties.centerOfMass
    .clone()
    .applyQuaternion(player.state.orientation)
    .add(player.state.position);
}
function readPlayerCombatRayOrigin(): THREE.Vector3 {
  if (!player) return new THREE.Vector3();
  const bounds = player.damage.primaryRenderModelBounds;
  const offset = new THREE.Vector3(
    0,
    bounds ? -(bounds.max.y - bounds.min.y) / 5 : 0,
    0,
  );
  return offset
    .applyQuaternion(player.state.orientation)
    .add(readPlayerCombatPosition());
}
addEventListener("keydown", (event) => {
  if (event.code === "Escape") {
    event.preventDefault();
    if (vehicle && !loading) {
      void audio.unlock();
      setPaused(!paused);
    }
    return;
  }
  if (
    event.target instanceof Element &&
    event.target.closest("input, select, textarea, button")
  )
    return;
  if (
    ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(
      event.code,
    )
  )
    event.preventDefault();
  keys.add(event.code);
  if (event.repeat || paused) return;
  if (event.code === "KeyR") recover();
  if (event.code === "KeyF" && race && player)
    powerups?.activateAbility(
      race,
      (event) => {
        if ([37, 45, 49].includes(event.definition.action)) {
          const hit =
            pedestrians?.useCombatPowerup(
              event.definition.action as 37 | 45 | 49,
              event.definition.floatParams,
              {
                position: readPlayerCombatPosition(),
                velocity: player!.state.velocity,
                gravityMultiplier:
                  player!.specialVolume?.volume?.gravityMultiplier,
                owner: player,
                readRayOrigin: readPlayerCombatRayOrigin,
                readPosition: readPlayerCombatPosition,
              },
              Math.round((simulation?.elapsed ?? 0) * 1000) >>> 0,
              stats.gameTimeMs,
            ) ?? false;
          message(hit ? event.name : "NO ELIGIBLE PEDESTRIAN TARGET");
          return hit;
        }
        if (event.definition.action === 38) {
          const hit =
            simulation?.repulseOpponents(
              player!,
              event.definition.floatParams,
            ) ?? false;
          message(hit ? event.name : "REPULSION · NO OPPONENT IN RANGE");
          return hit;
        }
        if (event.definition.action === 36) {
          commandJump(player!.state, event.definition.floatParams[0] ?? 0);
          void audio.playSound(9010);
          message(event.name);
        }
        if (event.definition.action === 35) {
          const placed = simulation?.dropOil(player!);
          message(placed ? "OIL DROPPED" : "OIL · NO SUITABLE SURFACE");
        }
        if (event.definition.action === 34) {
          const launched = simulation?.launchMine(
            player!,
            mineParameters(
              event.definition.floatParams,
              event.definition.integerParams,
            ),
            event.definition.index,
          );
          message(launched ? event.name : "MINE POOL FULL");
        }
      },
      player.knackered,
    );
  if (event.code === "Tab") {
    event.preventDefault();
    const ability = powerups?.cycleAbility();
    if (ability)
      message(`${ability.definition.message} · ${ability.charges} · F TO USE`);
  }
  if (event.code === "KeyE" && player?.knackered)
    message("CAR WASTED · ENTER TO RESTART");
  if (event.code === "KeyC") {
    cameraMode = (cameraMode + 1) % 3;
    cameraNeedsReset = true;
  }
  if (event.code === "KeyM") {
    mapVisible = !mapVisible;
    el("map").hidden = !mapVisible;
  }
  if (
    (event.code === "Enter" || event.code === "NumpadEnter") &&
    race?.status !== "racing"
  ) {
    ensureRacePayout();
    if (racePayout && !racePayout.finished) {
      racePayout.skip();
      race!.credits = racePayout.credits;
      message("RACE COMPLETED · ENTER TO RESTART", 10);
    } else void loadRace();
  }
});
addEventListener("keyup", (event) => keys.delete(event.code));
addEventListener("blur", () => {
  keys.clear();
  if (vehicle && !loading) setPaused(true);
});
function drawMap() {
  if (!track || !vehicle || !race || !mapVisible) return;
  const ctx = (el("map") as HTMLCanvasElement).getContext("2d")!;
  ctx.clearRect(0, 0, 220, 220);
  ctx.fillStyle = "rgba(15,12,9,.72)";
  ctx.fillRect(0, 0, 220, 220);
  const points = track.pathNodes.length
    ? track.pathNodes
    : track.checkpoints.flatMap((g) => g.points);
  if (!points.length) return;
  const xs = points.map((p) => p[0]),
    zs = points.map((p) => p[2]);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minZ = Math.min(...zs),
    maxZ = Math.max(...zs);
  const scale = 190 / Math.max(maxX - minX, maxZ - minZ, 1);
  const project = (x: number, z: number) => [
    15 + (x - minX) * scale,
    15 + (z - minZ) * scale,
  ];
  ctx.strokeStyle = "#706b5b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [a, b] of track.pathEdges) {
    if (!points[a] || !points[b]) continue;
    ctx.moveTo(...(project(points[a][0], points[a][2]) as [number, number]));
    ctx.lineTo(...(project(points[b][0], points[b][2]) as [number, number]));
  }
  ctx.stroke();
  for (const [i, gate] of track.checkpoints.entries()) {
    const p = gate.points
      .reduce((v, p) => v.add(new THREE.Vector3(...p)), new THREE.Vector3())
      .divideScalar(gate.points.length);
    const [x, y] = project(p.x, p.z);
    ctx.fillStyle = i === race.nextCheckpoint ? "#fff" : "#d98b20";
    ctx.fillRect(x - 3, y - 3, 6, 6);
    ctx.font = "bold 12px monospace";
    ctx.fillText(String(i + 1), x + 5, y + 4);
  }
  const pedMapPolicy = {
    effectActive: powerups?.pedestriansOnMap ?? false,
    raceType: definition?.raceType,
    targetGroups: definition?.pedGroupsToKill,
  };
  if (pedestrians && pedestrianMapEnabled(pedMapPolicy)) {
    const color = pedestrianMapColor(assets.palette);
    if (color) {
      ctx.fillStyle = color;
      pedestrians.forEachMapPedestrian(pedMapPolicy, (position) => {
        const [x, y] = project(position.x, position.z);
        drawPedestrianMapPoint(ctx, x, y);
      });
    }
  }
  for (const r of rivals) {
    const [x, y] = project(r.state.position.x, r.state.position.z);
    ctx.fillStyle = "#a22";
    ctx.fillRect(x - 2, y - 2, 4, 4);
  }
  const [x, y] = project(vehicle.position.x, vehicle.position.z);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-vehicle.heading);
  ctx.fillStyle = "#fe3";
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(-4, 4);
  ctx.lineTo(4, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
/** Explicit browser degradation policy after asynchronous population loading.
 * Missing required targets never shrink a mission or grant a completion payout.
 */
function refreshPopulationAvailability() {
  if (!race) return;
  const availability = assessPopulationAvailability(definition, {
    ...populationLoads,
    opponentIds: rivals.map((rival) => rival.id),
    pedestrianCount: pedestrians?.count ?? 0,
    groupCounts: pedestrians?.groupCounts ?? new Map(),
    pedestrianFailures: pedestrians?.populationFailures,
    checkpointRouteAvailable: race.checkpoints.length > 0,
  });
  rivalsReady = populationLoads.opponents.state !== "loading";
  opponentObjectivesReady = availability.opponentsUsable;
  pedestrianObjectivesReady = availability.pedestriansUsable;
  if (
    !race.practice &&
    race.status === "racing" &&
    !race.awardsClosed &&
    availability.unavailable.length
  ) {
    populationPracticeReason = availability.unavailable.join(" ");
    race.practice = true;
    race.checkpoints = [];
    message("MISSION UNAVAILABLE · FREE DRIVE · NO COMPLETION PAYOUT", 8);
  }
  const text = populationPracticeReason
    ? `Mission unavailable · Free drive, no completion payout. ${populationPracticeReason} Reload this race or choose another.`
    : race.practice
      ? ""
      : [...availability.disabledAlternatives, ...availability.pending].join(
          " ",
        );
  for (const id of ["population-status", "population-menu-status"]) {
    el(id).textContent = text;
    el(id).hidden = !text;
  }
}

/** Native completion checks occur at event dispatch, before another event can
 * wrap or subtract from the same byte. End-frame checks alone miss crossings. */
function checkRaceObjective() {
  if (!race) return;
  const victory = applyRaceObjectives(race, definition, {
    opponentsTotal: rivals.length,
    opponentsWasted: rivals.filter((r) => r.body.knackered).length,
    pedestriansTotal: pedestrians?.count ?? 0,
    pedestriansKilled: pedestrians?.hits ?? 0,
    groupCounts: pedestrians?.groupCounts,
    smashValue:
      definition?.smashVariable != null
        ? missionVariables.get(definition.smashVariable)
        : undefined,
    opponentsReady: opponentObjectivesReady,
    pedestriansReady: pedestrianObjectivesReady,
    opponentInstances: rivals.map((r) => ({
      id: r.id,
      wasted: r.body.knackered,
    })),
  });
  if (victory.completed) {
    audio.raceEvents([{ type: "completed", lap: race.lap }], race.laps);
    message(victory.message ?? "RACE COMPLETED", 8);
  }
}

function checkSmashObjective() {
  if (
    definition?.raceType === "smashAndPed" &&
    definition.pedGroupsToKill.length &&
    !pedestrianObjectivesReady
  )
    return;
  if (
    !race ||
    !definition ||
    !["smash", "smashAndPed"].includes(String(definition.raceType))
  )
    return;
  const victory = applyRaceObjectives(race, definition, {
    opponentsTotal: 0,
    opponentsWasted: 0,
    pedestriansTotal: 0,
    pedestriansKilled: 0,
    smashValue:
      definition.smashVariable != null
        ? missionVariables.get(definition.smashVariable)
        : undefined,
  });
  if (victory.completed) {
    audio.raceEvents([{ type: "completed", lap: race.lap }], race.laps);
    message(victory.message ?? "RACE COMPLETED", 8);
  }
}

function onPowerupEvent(event: PowerupEvent) {
  if (event.definition.action === 48 && event.kind === "effect")
    void audio.playSound(3601, 1);
  if (event.kind === "ability") {
    message(`${event.name} · ${event.amount} · F TO USE`);
    return;
  }
  if (event.kind === "unsupported") {
    message(`NOT IMPLEMENTED · ${event.name}`, 5);
    return;
  }
  if (event.kind === "repair") {
    if (player && simulation) simulation.repair(player);
    else damage?.repair();
  }
  if (event.kind === "crash" && player && simulation) {
    if (event.definition.action === 30)
      simulation.hitMine(player, event.definition.floatParams);
    if (event.definition.action === 12)
      simulation.spamCar(player, (0.1 * player.damage.carSoftness * 10) / 7);
  }
  if (event.kind === "upgrade" && player?.upgrades && upgradeSettings && race) {
    player.upgrades.credits = race.credits;
    applyUpgradePickup(
      player.upgrades,
      upgradeSettings,
      { skill: raceDifficulty },
      event.definition.action as 46 | 47,
      event.definition.integerParams,
    );
    race.credits = player.upgrades.credits;
    updateUpgradeFactors(player);
  }
  message(
    event.name === "n/a"
      ? `${event.kind.toUpperCase()} +${event.amount ?? 0}`
      : event.name,
  );
}

function ensureRacePayout() {
  if (
    loading ||
    !race ||
    race.status !== "completed" ||
    racePayout ||
    !race.deferCompletionAwards
  )
    return;
  const reason = race.completionReason ?? 0;
  racePayout = new RacePayout({
    snapshotCredits: race.credits,
    completionBonus:
      race.completionCreditsByReason?.[reason] ?? race.completionCredits,
    timeLeft: race.timeLeft,
    rate: race.completionTimeCreditRate ?? 0,
    suppressPresentation: missionVariables.get(99) !== 0,
  });
}

/** Installed PointOutOfSight4e5aa0. This browser has one render camera;
 * optional source rearview/extra render cameras are not currently enabled. */
function worldGrooveVisible(
  actor: THREE.Object3D,
  definition: { nature: "constant" | "distance" },
) {
  camera.updateWorldMatrix(true, false);
  const matrix = camera.matrixWorld.elements;
  return nativePointVisible(
    actor.getWorldPosition(new THREE.Vector3()),
    definition.nature === "distance"
      ? Math.fround(nativeCameraYon * nativeCameraYon)
      : 36,
    {
      camera: {
        position: new THREE.Vector3(matrix[12], matrix[13], matrix[14]),
        backwards: new THREE.Vector3(matrix[8], matrix[9], matrix[10]),
        yon: nativeCameraYon,
      },
    },
  );
}

function animate(now: number) {
  requestAnimationFrame(animate);
  // Loading retires native resource storages before awaiting the next scene.
  // Drawing the preceding scene in that interval reuploads disposed textures
  // whose owners are then removed without another GPU release. Keep the last
  // complete frame beneath the DOM loading/error UI until a scene is ready.
  if (loading || !stats.ready) return;
  let renderAlpha = 1;
  const gameFrame = gameClock.sample(
    performance.now(),
    stats.ready && !loading && !paused,
  );
  const dt = (gameFrame?.periodMs ?? 0) / 1000;
  if (gameFrame) {
    stats.gameFrames++;
    stats.framePeriodMs = gameFrame.periodMs;
    stats.gameTimeMs = gameFrame.endMs;
  }
  // Render FPS uses real elapsed time, independent of the gameplay dt cap.
  const renderEstimate = renderFps.sample(now);
  if (renderEstimate !== undefined) {
    fps = renderEstimate;
    fpsCounter.textContent = `${fps} FPS`;
  }
  debugPanel.refresh();
  let grooveFrameStarted = false;
  if (vehicle && car && race && collision) {
    if (gameFrame && !paused && race.status === "racing") {
      let modifiers = powerups?.beginFrame(
        dt,
        vehicle,
        race,
        onPowerupEvent,
        gameFrame.endMs,
      );
      previous.copy(vehicle.position);
      if (player && simulation) {
        simulation.gravityMultiplier =
          modifiers?.gravityMultiplier ?? simulation.gravityMultiplier;
        simulation.pinballFactor = modifiers?.pinballFactor ?? 0;
        player.state.engineFactor = modifiers?.accelerationMultiplier ?? 1;
        player.state.tyreGripFactor = modifiers?.lateralGripMultiplier ?? 1;
        player.state.underwaterAbility = modifiers?.underwaterAbility ?? false;
        player.state.bounceRate = modifiers?.bouncePeriodMs ?? 0;
        player.state.wallClimb = modifiers?.wallClimb ?? false;
        player.damage.damageContext.invulnerable =
          debugPanel.invulnerable || (modifiers?.invulnerable ?? false);
        player.damageMultiplier = modifiers?.damageMultiplier ?? 1;
        player.protection = modifiers?.protection ?? 1;
        player.freeRepairs =
          debugPanel.freeRepairs || (modifiers?.freeRepairs ?? false);
        if (
          modifiers?.suspension &&
          modifiers.suspension !== player.suspensionPowerup
        ) {
          player.suspensionPowerup = modifiers.suspension;
          setMotionSuspension(player.motion, modifiers.suspension);
        }
        player.repairing = updateRepairControl(
          repairControl,
          keys.has("KeyE"),
          gameFrame.totalTimeMs,
          player.knackered,
        );
        player.input = {
          throttle:
            Number(keys.has("KeyW") || keys.has("ArrowUp")) -
            Number(keys.has("KeyS") || keys.has("ArrowDown")),
          steer:
            Number(keys.has("KeyA") || keys.has("ArrowLeft")) -
            Number(keys.has("KeyD") || keys.has("ArrowRight")),
          brake: Number(keys.has("ShiftLeft")),
          handbrake: keys.has("Space"),
        };
        player.crashAccelerationKey = keys.has("KeyW") || keys.has("ArrowUp");
        if (
          modifiers?.instantHandbrake &&
          player.input.handbrake &&
          !player.knackered
        ) {
          if (
            (player.state.groundedWheelCount ?? 0) !== 0 &&
            player.state.velocity.lengthSq() > 0.0001
          )
            for (let id = 9000; id < 9005; id++) void audio.playSound(id);
          instantHandbrake(player.state);
          // Installed branch bypasses the ordinary brake-key assignment.
          player.input.handbrake = false;
        }
        updateRivals(dt, modifiers?.opponentSpeedFactor ?? 1);
        simulation.beginWorldGrooveFrame({ isVisible: worldGrooveVisible });
        grooveFrameStarted = true;
        const physicsWindow = simulation.updateFrame(
          gameFrame.startMs,
          gameFrame.periodMs,
        );
        stats.physicsSkippedMs += physicsWindow.skippedMs;
        // Installed4567db–4567f3 copies sound velocity after physics. Retain
        // this frame's snapshot for subsequent mechanics-phase tyre calls.
        for (const body of simulation.cars)
          body.cachedSoundVelocity.copy(body.state.velocity);
        modifiers = powerups?.finishFrame();
        if (modifiers) {
          simulation.gravityMultiplier = modifiers.gravityMultiplier;
          simulation.pinballFactor = modifiers.pinballFactor;
          player.state.wallClimb = modifiers.wallClimb;
          player.state.bounceRate = modifiers.bouncePeriodMs;
        }
        if (powerups?.periodicBounce(player.state)) void audio.playSound(9010);
        const drunkVoice = powerups?.drinkDriving.periodic(stats.gameTimeMs);
        if (drunkVoice)
          void audio.playSound(drunkVoice.id, 1, drunkVoice.playbackRate);
        // Installed C2 RaceCompleted(reason6) lets the wasted body continue
        // simulating during its ten-second end countdown.
        if (
          player.wastedAt !== undefined &&
          simulation.elapsed - player.wastedAt >= 10
        ) {
          race.status = "failed";
          message("YOU ARE WASTED · ENTER TO RESTART", 10);
        }
      }
      const raceEvents = updateRace(
        race,
        previous,
        vehicle.position,
        isSupportedRace(definition) &&
          !modifiers?.timerFrozen &&
          !debugPanel.timerFrozen
          ? dt
          : 0,
      );
      audio.raceEvents(raceEvents, race.laps);
      for (const event of raceEvents) {
        message(
          event.type === "completed"
            ? "RACE COMPLETED · ENTER TO RESTART"
            : event.type === "failed"
              ? "OUT OF TIME · ENTER TO RESTART"
              : event.type === "lap"
                ? "LAP COMPLETE"
                : "CHECKPOINT!",
        );
      }
      pedestrians?.update(
        dt,
        {
          position: vehicle.position,
          yaw: vehicle.heading,
          speed: vehicle.speed,
          velocity: vehicle.velocity,
        },
        {
          cameraPosition: camera.position,
          gameTimeMs: stats.gameTimeMs,
          physicsTickMs: Math.round((simulation?.elapsed ?? 0) * 1000) >>> 0,
          framePeriodMs: gameFrame.periodMs,
          electricRayDistanceSquared: powerups?.electricRayDistanceSquared ?? 0,
          combatOwner: player,
          combatPosition: readPlayerCombatPosition(),
          readCombatRayOrigin: readPlayerCombatRayOrigin,
          cameraOrientation: camera.getWorldQuaternion(new THREE.Quaternion()),
          gravityMultiplier: player?.specialVolume?.volume?.gravityMultiplier,
          threats: simulation
            ? [...simulation.cars, ...simulation.noncars].map((body) => {
                // Source SetObjectRadius uses the furthest authored bound on each
                // axis, preserving different original car sizes in ped prediction.
                const extent = new THREE.Vector3();
                for (const hull of body.hulls)
                  for (const point of hull.vertices) {
                    extent.x = Math.max(extent.x, Math.abs(point.x));
                    extent.y = Math.max(extent.y, Math.abs(point.y));
                    extent.z = Math.max(extent.z, Math.abs(point.z));
                  }
                return {
                  position: body.state.position,
                  yaw: "heading" in body.state ? Number(body.state.heading) : 0,
                  speed:
                    "speed" in body.state
                      ? Number(body.state.speed)
                      : body.state.velocity.length(),
                  velocity: body.state.velocity,
                  radiusSquared: extent.lengthSq(),
                };
              })
            : undefined,
        },
      );
      checkRaceObjective();
      const animationInput = {
        ...(player ? motionAnimation(player) : {}),
        speed: vehicle.speed,
        steer:
          Number(keys.has("KeyA") || keys.has("ArrowLeft")) -
          Number(keys.has("KeyD") || keys.has("ArrowRight")),
        brake: keys.has("ShiftLeft") || keys.has("Space"),
        throttle:
          Number(keys.has("KeyW") || keys.has("ArrowUp")) -
          Number(keys.has("KeyS") || keys.has("ArrowDown")),
      };
      carAnimation?.update(dt, animationInput);
      vehicle.wheelDamageOffsets = carAnimation?.wheelDamageOffsets;
      carTextures?.update(dt, animationInput);
      if (vehicle.position.y < -80) recover();
    }
    audio.update(
      player?.state.rpm ?? 0,
      player?.specialVolume?.volume?.engineNoiseIndex ?? 0,
      paused || race.status !== "racing",
      player?.state.engineFactor ?? 1,
    );
    renderAlpha =
      paused || race.status !== "racing"
        ? 1
        : (simulation?.accumulator ?? 0) / PHYSICS_STEP;
    if (player)
      renderPoses.sample(
        player,
        renderAlpha,
        renderPosition,
        renderOrientation,
      );
    else {
      renderPosition.copy(vehicle.position);
      renderOrientation.copy(vehicle.orientation);
    }
    if (simulation) {
      for (const body of simulation.cars)
        renderPoses.apply(
          body,
          body.group,
          simulation.isCarPhysicsActive(body) ? renderAlpha : 1,
        );
      for (const body of simulation.debris)
        renderPoses.apply(body, body.actor, renderAlpha);
      for (const body of simulation.mineBodies)
        if (body.actor.parent) renderPoses.apply(body, body.actor, renderAlpha);
      for (const body of simulation.pedBoneBodies)
        if (body.actor.parent)
          renderPoses.apply(body, body.actor, renderAlpha, true);
      if (gameFrame && !paused && simulation.oil)
        for (const body of simulation.cars) {
          const driver = body.state.driver ?? (body.human ? 8 : 6);
          if (driver <= 5 || !body.group.visible) continue;
          const bounds = new THREE.Box3();
          // Graphics41ea20 reads the head shape's bound, not the union of
          // attached/deformed collision shapes. Bounds remain in world units.
          const headHull = body.hulls[0];
          if (!headHull) continue;
          for (const point of headHull.vertices) bounds.expandByPoint(point);
          simulation.oil.setWheelBroadphaseMask(
            body,
            nativeOilBroadphaseMask(
              body.group.getWorldPosition(new THREE.Vector3()),
              bounds.max.z,
              simulation.oil.spills,
            ),
          );
        }
    }
    if (player && gameFrame && !paused && cunningStuntCredits) {
      const award = cunningStunts.advance({
        pdTimeMs: performance.now(),
        driver: player.state.driver ?? (player.human ? 8 : 6),
        mass: player.properties.mass,
        bodyInertia: player.properties.inertia,
        bodyAngularVelocity: player.state.angularVelocity
          .clone()
          .applyQuaternion(player.state.orientation.clone().invert()),
        upY: new THREE.Vector3(0, 1, 0).applyQuaternion(
          player.state.orientation,
        ).y,
        wheelsDown: player.state.groundedWheelCount ?? 0,
        volumeGravity: player.specialVolume?.volume?.gravityMultiplier,
        actionReplay: false,
        skill: raceDifficulty,
        creditsBySkill: cunningStuntCredits,
      });
      if (award) {
        const before = race.credits;
        if (awardRaceCredits(race, award.credits))
          message(`CUNNING STUNT · +${(race.credits - before) | 0} CR`);
        if (award.kind === "landing")
          cunningStunts.recordLandingAwardPdTime(performance.now());
      }
    }
    if (player && gameFrame)
      cameraVehicleTravel.update(player.state.velocity, renderOrientation);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      renderOrientation,
    );
    forward.y = 0;
    if (forward.lengthSq() > 1e-8) forward.normalize();
    target.copy(renderPosition).add(new THREE.Vector3(0, carTargetHeight, 0));
    if (cameraMode === 0 && player && simulation && nativeCameraSettings) {
      const com = player.properties.centerOfMass
        .clone()
        .applyQuaternion(renderOrientation)
        .add(renderPosition);
      // Native camera update mutates reversal/swing history even at dt=0.
      // Advance once per gameplay frame; extra RAFs only display the pose.
      if (gameFrame || cameraNeedsReset) {
        const movement = cameraVehicleTravel.snapshot();
        if (cameraNeedsReset) {
          nativeChase.reset(com, renderOrientation, movement.direction);
        }
        const dtMs = gameFrame?.cameraPeriodMs ?? 0;
        const cameraControls = applyCameraControls({
          zoom: nativeChase.zoom,
          yaw: nativeChase.state.yawBRenderAngle,
          reset: cameraControlReset,
          reverse: nativeChase.state.reverse,
          dtMs,
          closer: keys.has("Equal") || keys.has("NumpadAdd"),
          farther: keys.has("Minus") || keys.has("NumpadSubtract"),
          orbitLeft: keys.has("BracketLeft"),
          orbitRight: keys.has("BracketRight"),
        });
        nativeChase.zoom = cameraControls.zoom;
        cameraControlReset = cameraControls.reset;
        const pose = nativeChase.update({
          dtMs,
          worldCOM: com,
          orientation: renderOrientation,
          modelVelocity: player.state.velocity,
          movement,
          angularVelocityLocal: player.state.angularVelocity
            .clone()
            .applyQuaternion(player.state.orientation.clone().invert()),
          rearWheelZ: player.motion.wheelPositions[0].z,
          steeringCurvature: player.state.curvature,
          fovBRenderAngle: nativeCameraSettings.fovAngle16,
          yawBRenderAngle: cameraControls.yaw,
          manualMove: cameraControls.manualMove,
          frameCollision: simulation.cameraContacts.bodies.has(player),
          cameraReset: cameraNeedsReset || cameraControls.reset,
        });
        cameraNeedsReset = false;
        camera.near = nativeCameraSettings.hitherGeneral;
        const queries = cameraWorldQueries(collision, () =>
          simulation!
            .activeNonCars()
            .filter(
              (body) => (body.motor.flags & NONCAR_FLAGS.blockCamera) !== 0,
            )
            .map((body) => ({
              hulls: body.hulls,
              position: body.actor.position,
              orientation: body.actor.quaternion,
            })),
        );
        const worldPose = clearCameraFromWorld(
          pose.cameraPosition,
          com,
          camera.near,
          queries,
          new THREE.Vector3(0, 1, 0).applyQuaternion(renderOrientation).y < 0,
        );
        const ownPose = clearCameraFromOwnShape(
          worldPose.position,
          com,
          {
            hulls: player.hulls,
            position: renderPosition,
            orientation: renderOrientation,
          },
          camera.near,
        );
        nativeChase.resolvePosition(ownPose.position);
        camera.position.copy(ownPose.position);
        stats.cameraUpdates++;
      }
      target
        .copy(camera.position)
        .add(
          nativeChase.aim(com, camera.position, nativeCameraSettings.fovAngle16)
            .aimDirection,
        );
      car.visible = true;
    } else if (cameraMode === 1) {
      camera.near = nativeCameraSettings?.hitherCockpit ?? 0.02;
      camera.position
        .copy(renderPosition)
        .add(new THREE.Vector3(0, 0.18, 0))
        .addScaledVector(forward, 0.17);
      target.addScaledVector(forward, 3);
      car.visible = false;
    } else {
      camera.near = nativeCameraSettings?.hitherGeneral ?? 0.06;
      camera.position.copy(renderPosition).add(new THREE.Vector3(0, 14, 0.1));
      car.visible = true;
    }
    if (nativeCameraSettings && powerups) {
      camera.fov =
        (powerups.drinkDriving.fovAngle16(
          nativeCameraSettings.fovDegrees,
          stats.gameTimeMs,
        ) *
          360) /
        65536;
    }
    camera.updateProjectionMatrix();
    camera.lookAt(target);
    if (grooveFrameStarted && simulation && gameFrame) {
      worldAnimation?.update(dt);
      simulation.finishWorldGrooveFrame(stats.gameTimeMs >>> 0, {
        isVisible: worldGrooveVisible,
      });
      simulation.processOilFrame(stats.gameTimeMs >>> 0);
      // MungeShrapnel first advances the persistent smoke/flame columns,
      // before fragments and the final authored smash queue are processed.
      smoke?.updateColumns(stats.gameTimeMs >>> 0, gameFrame.periodMs >>> 0);
      shrapnel?.update(stats.gameTimeMs >>> 0, gameFrame.periodMs >>> 0);
      simulation.flushSmashEffects();
      explosions?.update(simulation.elapsed * 1000);
      shards?.update(stats.gameTimeMs);
      skidmarks?.update();
      // Native world render invokes sparks before smoke. Both advance once per
      // graphical game frame after physics and the final authored effects flush.
      sparks?.update(stats.gameTimeMs >>> 0, gameFrame.periodMs >>> 0);
      smoke?.updatePuffs(stats.gameTimeMs >>> 0, gameFrame.periodMs >>> 0);
    }
    if (sky) {
      sky.position.x = camera.position.x;
      sky.position.z = camera.position.z;
    }
    ensureRacePayout();
    if (gameFrame && racePayout && !paused && !racePayout.finished) {
      const oldState = racePayout.state;
      for (const id of racePayout.update(gameFrame.periodMs, gameFrame.endMs))
        void audio.playSound(id);
      race.credits = racePayout.credits;
      race.timeLeft = racePayout.timeLeft;
      if (
        racePayout.state !== oldState ||
        racePayout.state === 3 ||
        racePayout.state === 5
      )
        message(
          racePayout.finished
            ? "RACE COMPLETED · ENTER TO RESTART"
            : racePayout.state < 3
              ? `COMPLETION BONUS · ${racePayout.completionBonus} CR · ENTER TO SKIP`
              : `TIME BONUS · ${racePayout.displayedBonus} CR · ENTER TO SKIP`,
          10,
        );
    }
    el("speed").textContent = String(Math.round(Math.abs(speedMph(vehicle))));
    el("damage").textContent = `ARMOUR ${Math.round(vehicle.health)}%`;
    const time = Math.max(0, Math.ceil(race.timeLeft));
    el("timer").textContent = race.practice
      ? "FREE DRIVE"
      : `${Math.floor(time / 60)
          .toString()
          .padStart(2, "0")}:${(time % 60).toString().padStart(2, "0")}`;
    el("laps").textContent = race.practice
      ? "PRACTICE"
      : `LAP ${Math.min(race.lap, race.laps)}/${race.laps}`;
    el("credits").textContent = `CR ${race.credits}`;
    el("checkpoint").textContent = race.practice
      ? "NO RACE OBJECTIVES"
      : race.checkpoints.length
        ? `CHECKPOINT ${race.nextCheckpoint + 1}/${race.checkpoints.length}`
        : objectiveText(definition, {
            opponentInstances: rivals.map((r) => ({
              id: r.id,
              wasted: r.body.knackered,
            })),
            opponentsTotal: rivals.length,
            opponentsWasted: rivals.filter((r) => r.wasted).length,
            pedestriansTotal: pedestrians?.count ?? 0,
            pedestriansKilled: pedestrians?.hits ?? 0,
            groupCounts: pedestrians?.groupCounts,
            smashValue:
              definition?.smashVariable != null
                ? missionVariables.get(definition.smashVariable)
                : undefined,
          });
    if (!isSupportedRace(definition)) el("timer").textContent = "FREE DRIVE";
    el("timer").classList.toggle("debug-frozen", debugPanel.timerFrozen);
    el("timer").title = debugPanel.timerFrozen
      ? "Debug mode: race timer frozen"
      : "";
    drawMap();
  }
  const terminalMessage =
    !loading && race
      ? terminalRaceMessage({
          status: race.status,
          playerWasted: !!player?.knackered,
          payoutActive: !!racePayout && !racePayout.finished,
        })
      : undefined;
  const terminalState = el("terminal-state");
  terminalState.textContent = terminalMessage ?? "";
  terminalState.hidden = !paused || !terminalMessage;
  el("message").textContent = raceFeedback.current(
    now,
    paused,
    terminalMessage,
  );
  feedbackContext.clearRect(0, 0, feedbackCanvas.width, feedbackCanvas.height);
  if (simulation)
    wastedFeedback.draw(
      feedbackContext,
      (simulation.elapsed + simulation.accumulator) * 1000,
    );
  try {
    if (nativeCameraYon > 0 && stats.ready && !loading) {
      const distances = visualDistances(
        nativeCameraYon,
        pedestrians?.nativeProcessDistance ?? 12,
      );
      camera.updateWorldMatrix(true, false);
      presentationFrustum.setFromProjectionMatrix(
        presentationProjection.multiplyMatrices(
          camera.projectionMatrix,
          camera.matrixWorldInverse,
        ),
      );
      pedestrians?.updatePresentation(
        camera.position,
        distances.pedestrians,
        presentationFrustum,
      );
      distantOpponentCount = distantOpponentPresentation.apply(
        simulation?.cars ?? [],
        camera.position,
        distances.opponents,
      );
    }
    // Original sky is a background pass, independent of track Yon clipping.
    skyCamera.copy(camera);
    skyCamera.layers.set(1);
    skyCamera.far = 1800;
    skyCamera.updateProjectionMatrix();
    // Validate after GROOVE, smash and effect mutations, then consume the same
    // certificates for pose admission and the shared sky/main matrix traversal.
    if (simulation?.grooves?.actors.size)
      for (const body of simulation.activeNonCars())
        if (
          !simulation.grooves.actors.has(body.actor) &&
          hasGraphicalPoseOwner(body.actor, simulation.grooves.actors)
        )
          // A native pulled ACT has left its authored parent. Rebase committed
          // presentation against the retained Three parent before interpolation
          // saves its restore pose. Dynamic queries receive committed geometry.
          simulation.syncCommittedNonCarActor(body);
    noncarRenderBatch?.update();
    if (stats.ready && !loading && simulation)
      for (const body of simulation.noncars)
        if (
          !noncarRenderBatch?.isBatched(body) &&
          !hasGraphicalPoseOwner(
            body.actor,
            simulation.grooves?.actors,
            // Native pull severs inherited ACT ancestry, although Three keeps
            // the source parent for collision/render retention. An exact own
            // GROOVE ACT remains graphical-owned (HW478beb–478cac).
            !simulation.isNonCarPhysicsActive(body),
          )
        )
          renderPoses.apply(body, body.actor, renderAlpha);
    renderScenePasses(renderer, scene, [skyCamera, camera], () =>
      debug.prepareRenderMatrices(),
    );
  } finally {
    renderer.autoClear = true;
    distantOpponentPresentation.restore();
    renderPoses.restore();
  }
  stats.frames++;
  stats.fps = fps;
  stats.drawCalls = renderer.info.render.calls;
  stats.triangles = renderer.info.render.triangles;
}
diagnosticsPanel = createDiagnosticsPanel(
  el("diagnostics"),
  readDiagnosticInput,
);
requestAnimationFrame(animate);
void init();
