import test from "node:test";
import assert from "node:assert/strict";
import {
  createNativeRenderMaterial,
  updateNativeRenderMaterial,
} from "../src/native-material-render.ts";
const material = () => ({
  name: "test",
  flags: 0x80025,
  rgba: [255, 255, 255, 255],
  ambient: 0.2,
  diffuse: 0.8,
  specular: 0,
  power: 20,
  uvTransform: [1, 0, 0, 1, 0, 0],
  fogMin: 10,
  fogMax: 35,
  fogColor: 0x816750,
});
test("larger visual fog ranges leave exact native MAT descriptors and default behavior intact", () => {
  const source = material(),
    before = JSON.stringify(source),
    render = createNativeRenderMaterial(source, undefined);
  assert.deepEqual(
    render.userData.c2NativeUniforms.c2FogRange.value.toArray(),
    [10, 35],
  );
  updateNativeRenderMaterial(render, source, { visualFogDistanceScale: 4 });
  assert.deepEqual(
    render.userData.c2NativeUniforms.c2FogRange.value.toArray(),
    [40, 140],
  );
  assert.equal(render.userData.c2NativeState.fogMin, 10);
  assert.equal(render.userData.c2NativeState.fogMax, 35);
  assert.equal(JSON.stringify(source), before);
  updateNativeRenderMaterial(render, source, {});
  assert.deepEqual(
    render.userData.c2NativeUniforms.c2FogRange.value.toArray(),
    [10, 35],
  );
});
