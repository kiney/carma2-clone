import * as THREE from "three";
import { Assets } from "./content";
import type { TrackConfig } from "./config";
import { parsePix } from "./formats";
import { prepareNativeTrackSceneEdges } from "./track-edge-preparation";

/** Session-only pictures from the local installation. No preview files are written. */
export class SelectionPreviews {
  private readonly pictures = new Map<string, Promise<string>>();
  private renderer?: THREE.WebGLRenderer;
  private disposed = false;
  // A single context serves all track cards, including simultaneous callers.
  private trackQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly assets: Assets) {}

  private cached(key: string, create: () => Promise<string>): Promise<string> {
    if (this.disposed)
      return Promise.reject(new Error("Selection previews disposed"));
    let picture = this.pictures.get(key);
    if (!picture) {
      picture = create();
      this.pictures.set(key, picture);
      void picture.catch(() => this.pictures.delete(key));
    }
    return picture;
  }

  async car(path: string): Promise<string> {
    return this.cached(`car:${path.toLowerCase()}`, async () => {
      const stem = path
        .split("/")
        .pop()!
        .replace(/\.txt$/i, "");
      const root = path.split("/")[0];
      const relative = `INTRFACE/CarImage/${stem}CI/PIXIES.P16`;
      const file =
        this.assets.resolve(`${root}/${relative}`) ??
        this.assets.resolve(`${root}/${relative.replace(/P16$/, "P08")}`) ??
        this.assets.resolve(`data/${relative}`) ??
        this.assets.resolve(`data/${relative.replace(/P16$/, "P08")}`);
      if (!file) throw new Error(`Original car picture missing: ${path}`);
      let palette = this.assets.palette;
      if (!palette && /\.p08$/i.test(file)) {
        const palettePath =
          this.assets.resolve(`${root}/Reg/PALETTES/DRRENDER.PAL`) ??
          this.assets.resolve("data/Reg/PALETTES/DRRENDER.PAL");
        if (palettePath) {
          const maps = parsePix(await this.assets.bytes(palettePath));
          palette = maps[0]?.palette ?? maps[0]?.rgba;
        }
        if (!palette)
          throw new Error(`Original car picture palette missing: ${path}`);
      }
      const maps = parsePix(await this.assets.bytes(file), palette);
      const name = (value: string) =>
        value.replace(/\.pix$/i, "").toLowerCase();
      const pictureRoot = file.split("/")[0];
      const layoutPath =
        this.assets.resolve(`${pictureRoot}/INTRFACE/changecar.txt`) ??
        this.assets.resolve("data/INTRFACE/changecar.txt");
      if (!layoutPath)
        throw new Error(`Original car picture layout missing: ${path}`);
      const layout = (await this.assets.text(layoutPath)).split(/\r?\n/);
      // The six maps are image fragments, not six views. The native interface
      // places CarA/B/C at (50,88)/(114,88)/(178,88), and D/E/F 64px below.
      // Read the installed layout so add-on interface positions remain intact.
      const tiles = "ABCDEF".split("").map((letter) => {
        const index = layout.findIndex((line) =>
          new RegExp(`//\\s*Car${letter}\\s*$`, "i").test(line),
        );
        if (index < 0)
          throw new Error(
            `Original Car${letter} layout missing: ${layoutPath}`,
          );
        const fields = layout
          .slice(index + 1)
          .map((line) => line.split("//")[0].trim())
          .filter(Boolean);
        const position = fields[0]?.split(/\s*,\s*/).map(Number);
        const size = fields[1]?.split(/\s*,\s*/).map(Number);
        if (
          !position ||
          position.length !== 2 ||
          !position.every(Number.isSafeInteger) ||
          !size ||
          size.length !== 2 ||
          size.some((value) => value !== 64)
        )
          throw new Error(
            `Invalid original Car${letter} tile bounds: ${layoutPath}`,
          );
        const map =
          maps.find(
            (map) => name(map.name) === `${stem}${letter}`.toLowerCase(),
          ) ??
          maps.find(
            (map) =>
              name(map.name).endsWith(letter.toLowerCase()) &&
              map.width === size[0] &&
              map.height === size[1],
          );
        if (!map || map.width !== size[0] || map.height !== size[1])
          throw new Error(`Original car fragment ${letter} missing in ${file}`);
        return { map, x: position[0], y: position[1] };
      });
      const minX = Math.min(...tiles.map((tile) => tile.x));
      const minY = Math.min(...tiles.map((tile) => tile.y));
      const width =
        Math.max(...tiles.map((tile) => tile.x + tile.map.width)) - minX;
      const height =
        Math.max(...tiles.map((tile) => tile.y + tile.map.height)) - minY;
      if (width <= 0 || height <= 0 || width > 1024 || height > 1024)
        throw new Error(`Original car composite bounds invalid: ${layoutPath}`);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Car preview canvas unavailable");
      for (const tile of tiles) {
        const pixels = context.createImageData(tile.map.width, tile.map.height);
        pixels.data.set(tile.map.rgba);
        context.putImageData(pixels, tile.x - minX, tile.y - minY);
      }
      return canvas.toDataURL("image/png");
    });
  }

  async track(path: string, config: TrackConfig): Promise<string> {
    return this.cached(`track:${path.toLowerCase()}`, () => {
      const picture = this.trackQueue.then(() =>
        this.renderTrack(path, config),
      );
      this.trackQueue = picture.catch(() => undefined);
      return picture;
    });
  }

  private async renderTrack(
    path: string,
    config: TrackConfig,
  ): Promise<string> {
    if (this.disposed) throw new Error("Selection previews disposed");
    if (!config.start || !config.start.every(Number.isFinite))
      throw new Error(
        `Track preview has no authored starting position: ${path}`,
      );
    const privateAssets = new Assets();
    privateAssets.manifest = this.assets.manifest;
    privateAssets.lookup = new Map(this.assets.lookup);
    privateAssets.palette = this.assets.palette?.slice();
    // Native material construction changes sampler state and owns cloned maps.
    // Keep those changes and all disposal away from the live game's textures.
    for (const [key, texture] of this.assets.textures)
      privateAssets.textures.set(key, texture.clone());
    let world: Awaited<ReturnType<Assets["scene"]>> | undefined;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>(privateAssets.textures.values());
    try {
      if (!privateAssets.palette) {
        const palettePath = privateAssets.resolve(
          "data/Reg/PALETTES/DRRENDER.PAL",
        );
        if (palettePath) {
          const maps = parsePix(await privateAssets.bytes(palettePath));
          privateAssets.palette = maps[0]?.palette ?? maps[0]?.rgba;
        }
      }
      privateAssets.configureNativeRendering({
        directionalColor: config.globalLighting?.directionalColor,
        perspective: true,
        interpolation: true,
      });
      const generated = privateAssets.generatedTrackMaterials();
      for (const source of Object.values(generated)) {
        const material = privateAssets.getNativeRenderMaterial(source);
        if (material) materials.add(material);
      }
      const slash = path.lastIndexOf("/");
      world = await privateAssets.scene(
        path.slice(0, slash),
        path.slice(slash + 1).replace(/\.txt$/i, ""),
        {
          shading: 1,
          storage: "selection-preview",
          defaultMaterial: generated.defaultTrackMaterial,
        },
      );
      prepareNativeTrackSceneEdges(world);
      world.group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          materials.add(material);
          const map = (material as THREE.MeshLambertMaterial).map;
          if (map) textures.add(map);
        }
      });
      for (const texture of world.textures.values()) textures.add(texture);
      if (this.disposed) throw new Error("Selection previews disposed");
      if (!this.renderer) {
        this.renderer = new THREE.WebGLRenderer({
          antialias: false,
          preserveDrawingBuffer: true,
        });
        this.renderer.setPixelRatio(1);
        this.renderer.setSize(400, 220, false);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      }
      const scene = new THREE.Scene();
      const color = config.depthCue?.color;
      scene.background = color
        ? new THREE.Color(color[0] / 255, color[1] / 255, color[2] / 255)
        : new THREE.Color(0x816750);
      scene.add(world.group, new THREE.AmbientLight(0xffffff, 1.25));
      const sun = new THREE.DirectionalLight(0xffffff, 1.4);
      sun.position.set(-3, 10, 4);
      scene.add(sun);
      const start = new THREE.Vector3(...config.start);
      const heading = ((config.heading ?? 0) * Math.PI) / 180;
      const forward = new THREE.Vector3(
        -Math.sin(heading),
        0,
        -Math.cos(heading),
      );
      // C2 world units are 6.9 metres. An elevated static grid view shows the
      // actual location without adding simulated cars, opponents or scenery.
      const camera = new THREE.PerspectiveCamera(65, 400 / 220, 0.01, 250);
      camera.position.copy(start).addScaledVector(forward, -0.8);
      camera.position.y += 0.65;
      const aim = start.clone().addScaledVector(forward, 2.5);
      aim.y += 0.15;
      camera.lookAt(aim);
      this.renderer.render(scene, camera);
      return this.renderer.domElement.toDataURL("image/png");
    } catch (error) {
      throw new Error(
        `Track preview failed for ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      world?.dispose();
      privateAssets.releaseRaceResources();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      privateAssets.cache.clear();
      privateAssets.textures.clear();
      this.renderer?.renderLists.dispose();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.pictures.clear();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = undefined;
  }
}
