import type { Camera, Object3D, Scene, WebGLRenderer } from "three";

/** Prepare the shared sky/main pose once. Only registered, invisible population
 * actors may defer descendant updates; explicit physics matrix APIs stay native.
 * Ordinary branches retain updateMatrixWorld overrides (bones, LOD, etc.). */
export function prepareSceneMatrices(
  scene: Scene,
  pedestrianGroup?: Object3D,
  pedestrianActors?: ReadonlySet<Object3D>,
): void {
  scene.updateWorldMatrix(false, false);
  for (const child of scene.children) {
    if (child !== pedestrianGroup || !pedestrianActors) {
      child.updateMatrixWorld(true);
      continue;
    }
    child.updateWorldMatrix(false, false);
    for (const actor of child.children) {
      if (!actor.visible && pedestrianActors.has(actor)) {
        // Keep the root pose current even while the unseen mesh/limbs sleep.
        // Becoming visible refreshes every descendant on the same render frame.
        actor.updateWorldMatrix(false, false);
      } else {
        // Blood, flames, rays and visible population actors remain ordinary.
        actor.updateMatrixWorld(true);
      }
    }
  }
}

/** No scene mutations occur between these passes. Restore flags on failures too;
 * callers can then restore interpolated actors to their committed physics pose. */
export function renderScenePasses(
  renderer: Pick<WebGLRenderer, "autoClear" | "render">,
  scene: Scene,
  cameras: readonly Camera[],
  prepare: () => void = () => prepareSceneMatrices(scene),
): void {
  const matrixAuto = scene.matrixWorldAutoUpdate;
  const autoClear = renderer.autoClear;
  try {
    prepare();
    scene.matrixWorldAutoUpdate = false;
    for (let i = 0; i < cameras.length; i++) {
      renderer.autoClear = i === 0;
      renderer.render(scene, cameras[i]);
    }
  } finally {
    scene.matrixWorldAutoUpdate = matrixAuto;
    renderer.autoClear = autoClear;
  }
}
