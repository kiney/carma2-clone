import * as THREE from "three";
import { Assets } from "./content";
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
  OpponentConfig,
} from "./config";
import { createRace, updateRace, speedMph, recoverVehicle } from "./gameplay";
import type { RaceState, VehicleConfig } from "./gameplay";
import { WorldCollision, batchStaticWorld } from "./world";
import { DamageSystem } from "./damage";
import {
  PowerupSystem,
  type PowerupEvent,
  type PowerupDefinition,
} from "./powerups";
import { DebugPanel } from "./debug-panel";
import { CarAnimation, TextureAnimation } from "./animation";
import { applyRaceObjectives, isSupportedRace, objectiveText } from "./rules";
import {
  createSimulatedCar,
  VehicleSimulation,
  type SimulatedCar,
  PHYSICS_STEP,
} from "./physics/simulation";
import { RenderPoses } from "./render-pose";
import { parseSurfaceModifiers } from "./physics/surfaces";
import {
  parseDefaultWaterVolume,
  parseTrackSpecialVolumes,
} from "./physics/volumes";
import { OilRuntime } from "./physics/oil";
import { parseNonCarMechanics, parseTrackNonCarFiles } from "./noncars";
import { createNonCarBody, nonCarActors } from "./physics/noncar-body";
import { NonCarRenderBatch } from "./noncar-render";
import { WorldDestruction } from "./world-destruction";
import { parseTrackSmashables } from "./world-smash";
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
import { physicsConfigFromCar } from "./handling";
import { RoadNavigator } from "./ai";
import { PedestrianSystem } from "./pedestrians";
import { AudioSystem } from "./audio";
import { WastedFeedback } from "./wasted";
import "./style.css";
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `<canvas id="view" tabindex="0" aria-label="Driving view"></canvas><div id="hud"><div class="top"><strong id="race-name">CARMAGEDDON II</strong><span id="timer">00:00</span><span id="laps">LAP 1/4</span></div><div class="bottom"><div><span id="speed">0</span> MPH<br><small id="damage">ARMOUR 100%</small></div><div id="message"></div><div><span id="credits">CR 1000</span><br><small id="checkpoint">CHECKPOINT 1</small></div></div></div><canvas id="map" width="220" height="220" aria-label="Track minimap"></canvas><button id="menu-button">MENU · ESC</button><div id="panel"><h1>CARMAGEDDON II</h1><p class="subtitle">Independent browser engine · your local game assets</p><label>RACE<select id="track-select"></select></label><label>CAR<select id="car-select"></select></label><button id="play">LOAD RACE</button><p id="status">Indexing your installation…</p><p class="controls">WASD / arrows: drive · Space: handbrake<br>R: recover · E: repair · C: camera · M: map<br>F: use mine/mortar/oil · Tab: select ability<br>Esc: pause/menu · Enter: restart finished race</p><small>Stock race and car data. Reconstructed vehicle physics; simplified AI and browser HUD.</small></div>`;
const el = (id: string) => document.getElementById(id)!;
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
scene.add(sun);
const camera = new THREE.PerspectiveCamera(
  65,
  innerWidth / innerHeight,
  0.035,
  1800,
);
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
  physicsConfig: Partial<VehicleConfig> = {},
  races: RaceCatalogEntry[] = [],
  opponents: OpponentConfig[] = [],
  paused = true,
  loading = false,
  cameraMode = 0,
  mapVisible = true;
let chaseDistance = 1.55,
  chaseHeight = 0.8,
  carTargetHeight = 0.18;
let repairControl = createRepairControl();
let lastTime = performance.now(),
  messageUntil = 0,
  seconds = 0,
  frames = 0,
  fps = 0,
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
const renderPosition = new THREE.Vector3(),
  renderOrientation = new THREE.Quaternion();
let rivalsReady = false,
  pedestriansReady = false;
const keys = new Set<string>(),
  cameraGoal = new THREE.Vector3(),
  target = new THREE.Vector3(),
  previous = new THREE.Vector3();
const trackSelect = el("track-select") as HTMLSelectElement,
  carSelect = el("car-select") as HTMLSelectElement;
const stats = {
  ready: false,
  frames: 0,
  fps: 0,
  drawCalls: 0,
  triangles: 0,
  assetWarnings: assets.warnings,
};
const debug = {
  stats,
  audio,
  wastedFeedback,
  get debugMode() {
    return debugPanel;
  },
  get simulation() {
    return simulation;
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
  get rivals() {
    return rivals;
  },
  get vehicle() {
    return vehicle;
  },
  get race() {
    return race;
  },
  get track() {
    return track;
  },
  get carConfig() {
    return carConfig;
  },
  get camera() {
    return camera;
  },
  get renderPosition() {
    return renderPosition;
  },
  get scene() {
    return scene;
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
function status(text: string) {
  el("status").textContent = text;
}
function message(text: string, duration = 3) {
  el("message").textContent = text;
  messageUntil = performance.now() + duration * 1000;
}
function setPaused(value: boolean) {
  paused = value;
  keys.clear();
  el("panel").hidden = !value;
  el("menu-button").textContent = value ? "RESUME · ESC" : "MENU · ESC";
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
    let catalogPath = assets.resolve("data/RACES.TXT");
    if (catalogPath) {
      const catalog = parseRaceCatalog(await assets.text(catalogPath));
      races = catalog.races;
    }
    const opponentPath = assets.resolve("data/OPPONENT.TXT");
    if (opponentPath)
      opponents = parseOpponents(await assets.text(opponentPath));
    const tracks = assets.manifest.filter(
      (e) =>
        /^(data|adv_data)\/races\/[^/]+\/[^/]+\.txt$/i.test(e.path) &&
        stemOf(e.path).toLowerCase() ===
          dirOf(e.path).split("/").pop()!.toLowerCase(),
    );
    for (const entry of tracks) {
      if (!assets.resolve(`${dirOf(entry.path)}/${stemOf(entry.path)}.act`))
        continue;
      const raceEntry = races.find(
        (r) =>
          r.raceFilename.toLowerCase() ===
          entry.path.split("/").pop()!.toLowerCase(),
      );
      const option = new Option(
        `${entry.path.startsWith("adv_data/") ? "ADV · " : ""}${raceEntry?.name ?? stemOf(entry.path)}${isSupportedRace(raceEntry) ? "" : " · FREE DRIVE"}`,
        entry.path,
      );
      trackSelect.add(option);
    }
    const cars = assets.manifest.filter(
      (e) =>
        /^(data|adv_data)\/cars\/[^/]+\/[^/]+\.txt$/i.test(e.path) &&
        stemOf(e.path).toLowerCase() ===
          dirOf(e.path).split("/").pop()!.toLowerCase(),
    );
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
    await audio.init();
    await assets.common(status);
    await wastedFeedback.init();
    await loadRace();
    setPaused(true);
  } catch (error) {
    status(`Cannot start: ${error instanceof Error ? error.message : error}`);
    console.error(error);
  }
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
  for (const g of geos) g.dispose();
  for (const m of mats) m.dispose();
  const shared = new Set<THREE.Texture>(assets.textures.values());
  for (const map of maps) if (!shared.has(map)) map.dispose();
}
interface Rival {
  object: THREE.Group;
  state: SimulatedCar["state"];
  body: SimulatedCar;
  node: number;
  previousNode: number;
  stuck: number;
  navigator: RoadNavigator;
  wasted: boolean;
  damage: DamageSystem;
  animation: CarAnimation;
  textures: TextureAnimation;
  id: number;
  config: Partial<VehicleConfig>;
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
  loading = true;
  const loadGeneration = ++generation;
  rivalsReady = pedestriansReady = false;
  setPaused(true);
  el("play").setAttribute("disabled", "");
  stats.ready = false;
  wastedFeedback.reset();
  try {
    currentTrack = trackSelect.value;
    currentCar = carSelect.value;
    if (!currentTrack || !currentCar)
      throw new Error("No compatible tracks or cars found in the installation");
    status("Parsing original track geometry…");
    const trackText = await assets.text(currentTrack);
    const newTrack = parseTrackConfig(trackText);
    const world = await assets.scene(dirOf(currentTrack), stemOf(currentTrack));
    const loadedPowerups = new PowerupSystem(assets, world.group);
    await loadedPowerups.init();
    status("Parsing original car…");
    if (!assets.textures.has("oil")) {
      const oilPath =
        assets.resolve("data/PIXELMAP/PIX16/OIL.PIX") ??
        assets.resolve("data/PIXELMAP/PIX8/OIL.PIX");
      if (oilPath) await assets.pixelmaps(oilPath);
    }
    const generalText = await assets.text("data/GENERAL.TXT");
    const loadedMine = await assets.scene("data/MINE", "ShitMine");
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
    const loadedCar = await assets.scene(dirOf(currentCar), stemOf(currentCar));
    // Frame each original car from its authored bounds. A fixed Eagle-sized
    // camera put the viewer inside larger vehicles such as the dumper.
    const cameraBounds = new THREE.Box3().setFromObject(loadedCar.group);
    const cameraSize = cameraBounds.getSize(new THREE.Vector3());
    chaseDistance = Math.max(
      1.55,
      cameraSize.z * 0.5 + 0.8,
      cameraSize.y * 1.5,
      cameraSize.x * 1.5,
    );
    chaseHeight = Math.max(0.8, cameraBounds.max.y + 0.35);
    carTargetHeight = Math.max(
      0.18,
      cameraBounds.getCenter(new THREE.Vector3()).y,
    );
    const loadedDamage = new DamageSystem(assets, loadedCar.group, carText);
    await loadedDamage.init();
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
          return [createNonCarBody(actor, mechanics)];
        } catch (error) {
          delete actor.userData.dynamicBody;
          assets.warnings.push(String(error));
          return [];
        }
      },
    );
    const loadedGrooves = new WorldGrooveRuntime(world.group, trackText);
    const movingWorld = [...loadedGrooves.actors]
      .filter((actor) => !noncarBodies.some((body) => body.actor === actor))
      .map((actor) => {
        actor.userData.dynamicBody = true;
        return createMovingWorldBody(actor);
      });
    const loadedDestruction = new WorldDestruction(
      world.group,
      parseTrackSmashables(trackText, currentTrack),
      {
        models: world.models,
        textures: world.textures,
        materials: world.materials,
        onActivation: (activation, contact) =>
          simulation?.worldActivations.enqueue(activation, contact),
        onConnotations: (data, contact) => {
          for (const id of data.sounds) void audio.playSound(id);
          if (data.explosions.length) {
            const source = contact.bodyActor ?? contact.actor;
            source.updateWorldMatrix(true, true);
            const bounds = new THREE.Box3()
              .setFromObject(source)
              .applyMatrix4(source.matrixWorld.clone().invert());
            explosions?.spawn(
              data.explosions,
              contact.point ?? source.getWorldPosition(new THREE.Vector3()),
              bounds,
              contact.timeMs ?? 0,
              undefined,
              source.getWorldQuaternion(new THREE.Quaternion()),
            );
          }
        },
      },
    );
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
    world.group = batchStaticWorld(world.group, [
      ...noncarBodies.map((body) => body.actor),
      ...loadedGrooves.actors,
      ...loadedDestruction.retainActors,
    ]);
    const newCollision = new WorldCollision(
      world.group,
      parseSurfaceModifiers(trackText),
    );
    noncarRenderBatch?.dispose();
    simulation?.dispose();
    explosions?.dispose();
    explosions = new ExplosionRuntime(
      scene,
      new Map([...world.textures, ...assets.textures]),
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
    damage = loadedDamage;
    content = world.group;
    scene.add(content);
    car = loadedCar.group;
    scene.add(car);
    collision = newCollision;
    track = newTrack;
    carConfig = newCarConfig;
    physicsConfig = physicsConfigFromCar(newCarConfig);
    const start = new THREE.Vector3(...(track.start ?? [0, 1, 0]));
    const ground = collision.height(start.x, start.z, start.y + 1);
    if (ground !== null) start.y = ground;
    player = createSimulatedCar(
      car,
      carText,
      loadedDamage,
      start,
      ((track.heading ?? 0) * Math.PI) / 180,
      true,
    );
    vehicle = player.state;
    repairControl = createRepairControl();
    player.upgrades = createUpgradeState(upgradeSettings, { skill: 0 });
    updateUpgradeFactors(player);
    simulation = new VehicleSimulation(newCollision, scene);
    simulation.onWorldGeometryChanged = () =>
      pedestrians?.invalidateWorldGeometry();
    simulation.specialVolumes = parseTrackSpecialVolumes(trackText);
    simulation.defaultWaterVolume = parseDefaultWaterVolume(generalText);
    simulation.oil = new OilRuntime({ texture: assets.textures.get("oil") });
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
      ]);
    simulation.settings = upgradeSettings;
    simulation.add(player);
    for (const body of noncarBodies) simulation.addNonCar(body);
    noncarRenderBatch = new NonCarRenderBatch(noncarBodies, scene);
    simulation.onRepair = (body, cost, finished) => {
      if (body.human && finished) repairControl.autoRepair = false;
      if (body.human && race && body.upgrades && upgradeSettings) {
        body.upgrades.credits = race.credits;
        payRepair(
          body.upgrades,
          cost,
          upgradeSettings,
          { skill: 0 },
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
    simulation.onWasted = (body) => {
      const rival = rivals.find((r) => r.body === body);
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
    car.rotation.y = vehicle.heading;
    definition = races.find(
      (r) =>
        r.raceFilename.toLowerCase() ===
        currentTrack.split("/").pop()!.toLowerCase(),
    );
    const lapRace =
      !definition ||
      ["carma", "checkpoints"].includes(String(definition.raceType));
    race = createRace(
      (lapRace ? track.checkpoints : []).map((c) => ({
        points: c.points.map((p) => new THREE.Vector3(...p)),
      })),
      {
        laps: definition?.laps ?? 4,
        timeLimit: definition?.initialTimer[0] ?? 180,
        credits: player.upgrades.credits,
        checkpointBonusSeconds: track.checkpoints[0]?.timerIncrement?.[0] ?? 20,
        completionCredits: definition?.raceCompletedBonus[0]?.[0] ?? 20000,
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
      sky.renderOrder = -10;
      scene.add(sky);
    }
    camera.position.copy(start).add(new THREE.Vector3(0, 1, 2));
    camera.lookAt(start);
    stats.ready = true;
    status(
      `Loaded ${world.stats.models} track models, ${loadedCar.stats.models} car models; ${world.stats.missingTextures} unresolved world textures.`,
    );
    localStorage.setItem(
      "c2-selection",
      JSON.stringify({ track: currentTrack, car: currentCar }),
    );
    setPaused(false);
    message("RACE START · W / ↑ TO DRIVE", 5);
    loadPedestrians(trackText, loadGeneration)
      .then(() => {
        if (loadGeneration === generation) pedestriansReady = true;
      })
      .catch((error) => console.warn("Pedestrian content:", error));
    loadRivals(definition, loadGeneration)
      .then(() => {
        if (loadGeneration === generation) rivalsReady = true;
      })
      .catch((error) => console.warn("Opponent content:", error));
  } catch (error) {
    status(`Load failed: ${error instanceof Error ? error.message : error}`);
    console.error(error);
  } finally {
    loading = false;
    el("play").removeAttribute("disabled");
  }
}
async function loadRivals(
  definition: RaceCatalogEntry | undefined,
  loadGeneration: number,
) {
  if (!track || !vehicle || !collision) return;
  const activeTrack = currentTrack;
  const nodes = track.pathNodes;
  if (!nodes.length) return;
  const ids = definition?.explicitOpponents.length
    ? definition.explicitOpponents
    : opponents.map((_, id) => id);
  const candidates = ids
    .map((id) => ({
      id,
      path: opponents[id]
        ? findConfig("CARS", opponents[id].carFilename)
        : undefined,
    }))
    .filter(
      (entry): entry is { id: number; path: string } =>
        !!entry.path && entry.path.toLowerCase() !== currentCar.toLowerCase(),
    );
  const count = Math.min(
    4,
    Math.max(
      0,
      (definition?.numberOfOpponents ?? -1) < 0
        ? 4
        : (definition?.numberOfOpponents ?? 4),
    ),
  );
  for (let i = 0; i < count && i < candidates.length; i++) {
    const configPath = candidates[i].path;
    const text = await assets.text(configPath);
    const config = parseCarConfig(text);
    const model = await assets.scene(dirOf(configPath), stemOf(configPath));
    const rivalDamage = new DamageSystem(assets, model.group, text);
    await rivalDamage.init();
    if (activeTrack !== currentTrack || loadGeneration !== generation) {
      disposeGroup(model.group);
      return;
    }
    let closest = 0,
      distance = Infinity;
    const spawn = vehicle.position
      .clone()
      .add(
        new THREE.Vector3((i % 2 ? 1 : -1) * 0.8, 0, 1 + Math.floor(i / 2) * 1),
      );
    for (let n = 0; n < nodes.length; n++) {
      const d = new THREE.Vector3(...nodes[n]).distanceToSquared(spawn);
      if (d < distance) {
        distance = d;
        closest = n;
      }
    }
    const node = new THREE.Vector3(...nodes[closest]);
    const y = collision.height(spawn.x, spawn.z, spawn.y + 1);
    if (y !== null) spawn.y = y;
    const heading = vehicle.heading;
    const body = createSimulatedCar(
      model.group,
      text,
      rivalDamage,
      spawn,
      heading,
      false,
    );
    const state = body.state;
    if (upgradeSettings)
      state.powerMultiplier =
        player?.state.powerMultiplier ?? upgradeSettings.factors[1][0];
    simulation?.add(body);
    model.group.position.copy(spawn);
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
      wasted: false,
      damage: rivalDamage,
      id: candidates[i].id,
      animation: new CarAnimation(model.group, text),
      textures: new TextureAnimation(
        groupMaterials(model.group),
        model.textures,
        text,
      ),
      config: physicsConfigFromCar(config),
    });
  }
}
async function loadPedestrians(text: string, loadGeneration: number) {
  if (!content || !collision || !vehicle) return;
  const active = currentTrack;
  const system = await PedestrianSystem.create(
    assets,
    content,
    text,
    collision.height.bind(collision),
    {
      spawn: vehicle.position,
      collision,
      onHit: (event) => {
        if (race?.status === "racing") {
          race.credits += event.count * 200;
          race.timeLeft += event.count * 8;
          message(`PEDESTRIAN HIT · +${event.count * 200} CR`);
          audio.impact(0.25);
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
function updateRivals(dt: number) {
  if (!track || !collision || !vehicle || !race) return;
  for (const r of rivals) {
    if (r.wasted) continue;
    const controls = r.navigator.update(
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
    if (r.damage.wasted) {
      r.wasted = true;
      r.body.input = { throttle: 0, steer: 0, brake: 0, handbrake: false };
      race.credits += 2500;
      race.timeLeft += 15;
      message("OPPONENT WASTED · +2500 CR");
      r.object.traverse((o) => {
        if (o instanceof THREE.Mesh)
          for (const m of Array.isArray(o.material)
            ? o.material
            : [o.material]) {
            if (m instanceof THREE.MeshLambertMaterial)
              m.color.multiplyScalar(0.3);
          }
      });
    }
  }
}

function recover() {
  if (!vehicle || !race || !track || !collision || !player || !simulation)
    return;
  if (player?.knackered) {
    message("CAR WASTED · ENTER TO RESTART");
    return;
  }
  const recovered = recoverVehicle(
    vehicle,
    race,
    vehicle.position,
    vehicle.heading,
  );
  if (recovered) {
    simulation.recover(player);
    pedestrians?.resetCar(vehicle.position);
    powerups?.resetPath(vehicle.position);
  }
  message(recovered ? "RECOVERED · CR -250" : "NOT ENOUGH CREDITS");
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
addEventListener("keydown", (event) => {
  if (event.code === "Escape") {
    event.preventDefault();
    if (vehicle && !loading) {
      void audio.unlock();
      setPaused(!paused);
    }
    return;
  }
  if ((event.target as HTMLElement)?.closest("input, select, textarea, button"))
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
  if (event.code === "KeyC") cameraMode = (cameraMode + 1) % 3;
  if (event.code === "KeyM") {
    mapVisible = !mapVisible;
    el("map").hidden = !mapVisible;
  }
  if (event.code === "Enter" && race?.status !== "racing") void loadRace();
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
function onPowerupEvent(event: PowerupEvent) {
  if (event.kind === "ability") {
    message(`${event.name} · ${event.amount} · F TO USE`);
    audio.checkpoint();
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
      { skill: 0 },
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
  audio.checkpoint();
}

function animate(now: number) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  seconds += dt;
  frames++;
  if (seconds >= 1) {
    fps = Math.round(frames / seconds);
    seconds = frames = 0;
  }
  debugPanel.refresh();
  if (vehicle && car && race && collision) {
    if (!paused && race.status === "racing") {
      worldAnimation?.update(dt);
      const modifiers = powerups?.update(dt, vehicle, race, onPowerupEvent);
      previous.copy(vehicle.position);
      if (player && simulation) {
        player.state.engineFactor = modifiers?.accelerationMultiplier ?? 1;
        player.state.tyreGripFactor = modifiers?.lateralGripMultiplier ?? 1;
        player.state.underwaterAbility = modifiers?.underwaterAbility ?? false;
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
          now,
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
        updateRivals(dt);
        simulation.update(dt);
        explosions?.update(simulation.elapsed * 1000);
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
      for (const event of updateRace(
        race,
        previous,
        vehicle.position,
        isSupportedRace(definition) &&
          !modifiers?.timerFrozen &&
          !debugPanel.timerFrozen
          ? dt
          : 0,
      )) {
        audio.checkpoint();
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
      const victory = applyRaceObjectives(race, definition, {
        opponentsTotal: rivals.length,
        opponentsWasted: rivals.filter((r) => r.wasted).length,
        pedestriansTotal: pedestrians?.count ?? 0,
        pedestriansKilled: pedestrians?.hits ?? 0,
        groupCounts: pedestrians?.groupCounts,
        opponentsReady: rivalsReady,
        pedestriansReady,
        opponentsWastedIds: definition?.opponentsToKill.every((id) =>
          rivals.some((r) => r.id === id),
        )
          ? new Set(rivals.filter((r) => r.wasted).map((r) => r.id))
          : undefined,
      });
      if (victory.completed) message(victory.message ?? "RACE COMPLETED", 8);
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
      Math.abs(vehicle.speed) / Math.max(physicsConfig.maxSpeed ?? 12.96, 1),
      Number(keys.has("KeyW") || keys.has("ArrowUp")),
      vehicle.health / 100,
      paused || race.status !== "racing",
    );
    const renderAlpha =
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
      noncarRenderBatch?.update();
      for (const body of simulation.cars)
        renderPoses.apply(body, body.group, renderAlpha);
      for (const body of simulation.debris)
        renderPoses.apply(body, body.actor, renderAlpha);
      for (const body of simulation.movingWorld)
        renderPoses.apply(body, body.actor, renderAlpha);
      for (const body of simulation.noncars)
        renderPoses.apply(body, body.actor, renderAlpha);
      for (const body of simulation.mineBodies)
        if (body.actor.parent) renderPoses.apply(body, body.actor, renderAlpha);
    }
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      renderOrientation,
    );
    forward.y = 0;
    if (forward.lengthSq() > 1e-8) forward.normalize();
    target.copy(renderPosition).add(new THREE.Vector3(0, carTargetHeight, 0));
    if (cameraMode === 0) {
      cameraGoal
        .copy(renderPosition)
        .addScaledVector(
          forward,
          -chaseDistance - Math.min(Math.abs(vehicle.speed) * 0.06, 0.8),
        )
        .add(new THREE.Vector3(0, chaseHeight, 0));
      const obstruction = collision.sweep(target, cameraGoal, 0.08);
      if (obstruction)
        cameraGoal.lerpVectors(
          target,
          cameraGoal,
          Math.max(0.18, obstruction.fraction),
        );
      camera.position.lerp(cameraGoal, 1 - Math.exp(-dt * 6));
      target.addScaledVector(forward, 0.65);
      car.visible = true;
    } else if (cameraMode === 1) {
      camera.position
        .copy(renderPosition)
        .add(new THREE.Vector3(0, 0.18, 0))
        .addScaledVector(forward, 0.17);
      target.addScaledVector(forward, 3);
      car.visible = false;
    } else {
      camera.position.copy(renderPosition).add(new THREE.Vector3(0, 14, 0.1));
      car.visible = true;
    }
    camera.lookAt(target);
    if (sky) {
      sky.position.x = camera.position.x;
      sky.position.z = camera.position.z;
    }
    el("speed").textContent = String(Math.round(Math.abs(speedMph(vehicle))));
    el("damage").textContent = `ARMOUR ${Math.round(vehicle.health)}%`;
    const time = Math.max(0, Math.ceil(race.timeLeft));
    el("timer").textContent = `${Math.floor(time / 60)
      .toString()
      .padStart(2, "0")}:${(time % 60).toString().padStart(2, "0")}`;
    el("laps").textContent =
      `LAP ${Math.min(race.lap, race.laps)}/${race.laps}`;
    el("credits").textContent = `CR ${race.credits}`;
    el("checkpoint").textContent = race.checkpoints.length
      ? `CHECKPOINT ${race.nextCheckpoint + 1}/${race.checkpoints.length}`
      : objectiveText(definition, {
          opponentsTotal: rivals.length,
          opponentsWasted: rivals.filter((r) => r.wasted).length,
          pedestriansTotal: pedestrians?.count ?? 0,
          pedestriansKilled: pedestrians?.hits ?? 0,
        });
    if (!isSupportedRace(definition)) el("timer").textContent = "FREE DRIVE";
    el("timer").classList.toggle("debug-frozen", debugPanel.timerFrozen);
    el("timer").title = debugPanel.timerFrozen
      ? "Debug mode: race timer frozen"
      : "";
    drawMap();
  }
  if (now > messageUntil) el("message").textContent = paused ? "PAUSED" : "";
  feedbackContext.clearRect(0, 0, feedbackCanvas.width, feedbackCanvas.height);
  if (simulation)
    wastedFeedback.draw(
      feedbackContext,
      (simulation.elapsed + simulation.accumulator) * 1000,
    );
  try {
    renderer.render(scene, camera);
  } finally {
    renderPoses.restore();
  }
  stats.frames++;
  stats.fps = fps;
  stats.drawCalls = renderer.info.render.calls;
  stats.triangles = renderer.info.render.triangles;
}
requestAnimationFrame(animate);
void init();
