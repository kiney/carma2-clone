import * as THREE from "three";
import type { MatMaterial } from "./formats";
import {
  applyNativeMaterialFog,
  type NativeMaterialDepthEffect,
} from "./native-material-fog";

const materialSources = new WeakMap<THREE.Material, MatMaterial>();
export function nativeRenderMaterialSource(
  material: THREE.Material,
): MatMaterial | undefined {
  return materialSources.get(material);
}
function setNativeTextureSampling(texture: THREE.Texture, flags: number): void {
  const linear = !!(flags & 0x20000);
  const mip = !!(flags & 0x10000);
  const mag = linear ? THREE.LinearFilter : THREE.NearestFilter;
  const min = mip
    ? linear
      ? flags & 0x40000
        ? THREE.LinearMipmapLinearFilter
        : THREE.LinearMipmapNearestFilter
      : flags & 0x40000
        ? THREE.NearestMipmapLinearFilter
        : THREE.NearestMipmapNearestFilter
    : linear
      ? THREE.LinearFilter
      : THREE.NearestFilter;
  const changed =
    texture.colorSpace !== THREE.NoColorSpace ||
    texture.magFilter !== mag ||
    texture.minFilter !== min ||
    texture.generateMipmaps !== mip;
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = mag;
  texture.minFilter = min;
  texture.generateMipmaps = mip;
  if (changed) texture.needsUpdate = true;
}
/** Preserve a FUNK/atlas matrix while applying the current native MAT sampler.
 * Non-native Three materials keep their existing texture policy. */
export function copyNativeTextureSampling(
  texture: THREE.Texture,
  material: THREE.Material,
): void {
  if (!nativeRenderMaterialSource(material)) return;
  const flags =
    material.userData.c2NativeState?.flags ?? material.userData.c2Flags;
  if (typeof flags === "number") setNativeTextureSampling(texture, flags);
}
/** BRender flags mapped by prepmatl; names and values are not inferred from textures. */
export const NativeMaterialFlags = {
  LIGHT: 1,
  PRELIT: 2,
  SMOOTH: 4,
  ENVIRONMENT_I: 8,
  ENVIRONMENT_L: 16,
  PERSPECTIVE: 0x20,
  DECAL: 0x40,
  ALWAYS_VISIBLE: 0x800,
  TWO_SIDED: 0x1000,
  FORCE_FRONT: 0x2000,
  MAP_ANTIALIASING: 0x10000,
  MAP_INTERPOLATION: 0x20000,
  MIP_INTERPOLATION: 0x40000,
  FOG_LOCAL: 0x80000,
} as const;
export interface NativeMaterialRenderOptions {
  shading?: number;
  /** Browser-only presentation extension; native retained MAT fields stay exact. */
  visualFogDistanceScale?: number;
  depth?: NativeMaterialDepthEffect;
  directionalColor?: [number, number, number];
  interpolation?: boolean;
  antialiasing?: boolean;
  perspective?: boolean;
  /** Exact texture identifier exceptions, with native case-folded matching. */
  textureExceptions?: ReadonlyMap<string, number>;
}
export interface NativeMaterialRenderState extends MatMaterial {
  fogMin: number;
  fogMax: number;
  fogColor: number;
}
/** Verified installed HW517d50..517f5a, including the complete shading3 branch. */
export function glorifyNativeMaterial(
  source: MatMaterial,
  options: NativeMaterialRenderOptions,
): NativeMaterialRenderState {
  const state = {
    ...source,
    uvTransform: [...source.uvTransform],
    fogMin: source.fogMin ?? 0,
    fogMax: source.fogMax ?? 0,
    fogColor: source.fogColor ?? 0,
  };
  if (source.texture) {
    const exception =
      options.textureExceptions?.get(source.texture.toUpperCase()) ?? 0;
    if (options.interpolation) {
      if (!(exception & 1)) state.flags |= 0x20000;
      if (exception & 8)
        state.uvTransform[4] = state.uvTransform[5] = Math.fround(0.02);
    }
    if (options.antialiasing) state.flags |= 0x10000;
    if (options.perspective) state.flags |= 0x20;
  }
  if (options.shading !== undefined) {
    const coefficients =
      options.shading === 1
        ? [0.2, 0.8, 0]
        : options.shading === 2
          ? [0.6, 0.2, 0.8]
          : options.shading === 3
            ? [0.4, 0.8, 0]
            : [1, 0, 0];
    [state.ambient, state.diffuse, state.specular] = coefficients.map(
      Math.fround,
    );
    if (options.shading >= 1 && options.shading <= 4)
      state.flags = (state.flags & ~2) | 5;
  }
  return options.depth ? applyNativeMaterialFog(state, options.depth) : state;
}
/** Reconstructed BRender rational highlight, rather than an invented Phong exponent. */
export function nativeMaterialSpecular(
  dot: number,
  ks: number,
  power: number,
): number {
  return dot > Math.fround(0.6172)
    ? (dot * ks) / (power - power * dot + dot)
    : 0;
}
const nativeDeclarations = `
uniform vec3 c2Coefficients;
uniform float c2Power;
uniform vec3 c2DirectionalColor;
uniform vec3 c2Direction;
uniform vec3 c2SurfaceColor;
uniform float c2Lit;
uniform float c2TwoSided;
uniform float c2Smooth;
varying vec3 c2ViewPoint;
varying vec3 c2ModelEye;
varying vec3 c2Front;
varying vec3 c2Back;
varying vec3 c2AffineUV;
varying float c2Depth;
vec3 c2Light(vec3 n, vec3 eye, vec3 direction) {
  if (c2Lit < .5) return c2SurfaceColor;
  float d = dot(n, direction);
  float spec = 0.0;
  if (d > 0.0) {
    float h = dot(n, normalize(direction + eye));
    if (h > 0.6172) spec = h * c2Coefficients.z / (c2Power - c2Power * h + h);
  }
  return clamp(c2SurfaceColor * c2Coefficients.x + c2DirectionalColor * (c2SurfaceColor * c2Coefficients.y * max(d,0.0) + vec3(spec)),0.0,1.0);
}`;
/** Native lamp row2 after RotateX300 and PostRotateY30. BRender quantizes angles to u16. */
export function nativeMaterialLampDirection(): THREE.Vector3 {
  const x = (Math.trunc((300 * 65536) / 360) * 2 * Math.PI) / 65536;
  const y = (Math.trunc((30 * 65536) / 360) * 2 * Math.PI) / 65536;
  return new THREE.Vector3(
    Math.cos(x) * Math.sin(y),
    -Math.sin(x),
    Math.cos(x) * Math.cos(y),
  ).normalize();
}
export function createNativeRenderMaterial(
  source: MatMaterial,
  texture: THREE.Texture | undefined,
  options: NativeMaterialRenderOptions = {},
): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial();
  material.name = source.name;
  material.fog = false;
  material.toneMapped = false;
  material.map = texture ? texture.clone() : null;
  if (material.map) material.map.colorSpace = THREE.NoColorSpace;
  const uniforms = {
    c2Coefficients: { value: new THREE.Vector3() },
    c2Power: { value: source.power },
    c2DirectionalColor: { value: new THREE.Vector3() },
    c2Direction: { value: nativeMaterialLampDirection() },
    c2SurfaceColor: { value: new THREE.Vector3() },
    c2Lit: { value: 0 },
    c2TwoSided: { value: 0 },
    c2Smooth: { value: 0 },
    c2Perspective: { value: 1 },
    c2Fog: { value: 0 },
    c2FogRange: { value: new THREE.Vector2() },
    c2FogColor: { value: new THREE.Vector3() },
    c2Environment: { value: 0 },
  };
  material.userData.c2NativeUniforms = uniforms;
  material.userData.c2SourceMaterial = source;
  materialSources.set(material, source);
  material.customProgramCacheKey = () => "c2-native-gouraud-local-fog-v1";
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace(
      "void main() {",
      nativeDeclarations + `\nuniform float c2Environment;\nvoid main() {`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      `#include <project_vertex>
      vec3 c2N = normalize(transformedNormal);
      vec3 c2Eye = normalize((modelViewMatrix * vec4(0.0,0.0,0.0,1.0)).xyz * -1.0);
      vec3 c2L = normalize(mat3(viewMatrix) * c2Direction);
      c2Front = c2Light(c2N,c2Eye,c2L);
      c2Back = c2Light(-c2N,c2Eye,c2L);
      c2Depth = -mvPosition.z;
      c2ViewPoint = mvPosition.xyz;
      c2ModelEye = c2Eye;
      #ifdef USE_MAP
        if (c2Environment > .5) {
          vec3 eye = c2Environment > 1.5 ? normalize(-mvPosition.xyz) : c2Eye;
          vec3 r = reflect(-eye,c2N);
          // No environment actor is enabled by C2's ordinary load path.
          r = normalize(vec3(dot(r,normalize(modelViewMatrix[0].xyz)),dot(r,normalize(modelViewMatrix[1].xyz)),dot(r,normalize(modelViewMatrix[2].xyz))));
          float cu = atan(r.x,-r.z)/(2.0*PI);
          if (cu < 0.0) cu += 1.0;
          vec2 environmentUV = vec2(cu,.5-r.y*.5);
          vMapUv = (mapTransform * vec3(environmentUV,1.0)).xy;
        }
        c2AffineUV = vec3(vMapUv * gl_Position.w,gl_Position.w);
      #endif
      if (${source.flags & 0x2000 ? "true" : "false"}) gl_Position.z = -gl_Position.w;
    `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "void main() {",
      nativeDeclarations +
        `\nuniform float c2Perspective;\nuniform float c2Fog;\nuniform vec2 c2FogRange;\nuniform vec3 c2FogColor;\nvoid main() {`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `
      vec3 nativeLight = gl_FrontFacing || c2TwoSided < .5 ? c2Front : c2Back;
      if (c2Smooth < .5) {
        vec3 faceN = normalize(cross(dFdx(c2ViewPoint),dFdy(c2ViewPoint)));
        if (!gl_FrontFacing && c2TwoSided < .5) faceN *= -1.0;
        nativeLight = c2Light(faceN,c2ModelEye,normalize(mat3(viewMatrix)*c2Direction));
      }
      // Surface lighting is evaluated before texture modulation in BRender.
      diffuseColor.rgb = nativeLight * diffuse;
      #ifdef USE_MAP
        vec2 c2UV = c2Perspective > .5 ? vMapUv : c2AffineUV.xy/c2AffineUV.z;
        diffuseColor *= texture2D(map,c2UV);
      #endif
    `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;",
      "vec3 outgoingLight = diffuseColor.rgb + totalEmissiveRadiance;",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <colorspace_fragment>",
      "",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <fog_fragment>",
      `if(c2Fog > .5) {
      float c2Amount = clamp((c2Depth-c2FogRange.x)/(c2FogRange.y-c2FogRange.x),0.0,1.0);
      gl_FragColor.rgb = mix(gl_FragColor.rgb,c2FogColor,c2Amount);
    }`,
    );
  };
  // Three's default clone drops shader hooks and JSON-copies source identities.
  // Render clones retain native source identity and shared source shading state.
  const clone = (
    original: THREE.MeshLambertMaterial,
  ): THREE.MeshLambertMaterial => {
    const result = new THREE.MeshLambertMaterial().copy(original);
    result.onBeforeCompile = material.onBeforeCompile;
    result.customProgramCacheKey = material.customProgramCacheKey;
    result.userData.c2NativeUniforms = uniforms;
    result.userData.c2NativeState = original.userData.c2NativeState;
    result.userData.c2SourceMaterial = source;
    materialSources.set(result, source);
    result.clone = (() => clone(result)) as typeof result.clone;
    return result;
  };
  material.clone = (() => clone(material)) as typeof material.clone;
  updateNativeRenderMaterial(material, source, options);
  return material;
}
export function updateNativeRenderMaterial(
  material: THREE.MeshLambertMaterial,
  source: MatMaterial,
  options: NativeMaterialRenderOptions,
): NativeMaterialRenderState {
  const state = glorifyNativeMaterial(source, options);
  const u = material.userData.c2NativeUniforms;
  u.c2Coefficients.value.set(state.ambient, state.diffuse, state.specular);
  u.c2Power.value = state.power;
  const rgb = options.directionalColor ?? [255, 255, 255];
  u.c2DirectionalColor.value.set(rgb[0] / 256, rgb[1] / 256, rgb[2] / 256);
  // The runtime color remains available to funk, damage and debug mutations.
  material.color.setRGB(1, 1, 1);
  u.c2SurfaceColor.value.set(
    state.rgba[0] / 256,
    state.rgba[1] / 256,
    state.rgba[2] / 256,
  );
  u.c2Smooth.value = state.flags & 4 ? 1 : 0;
  if (state.flags & 2 || (material.map && !(state.flags & 3)))
    u.c2SurfaceColor.value.set(1, 1, 1);
  u.c2Lit.value = !!(state.flags & 1) && !(state.flags & 2) ? 1 : 0;
  u.c2TwoSided.value = state.flags & 0x1000 ? 1 : 0;
  u.c2Perspective.value = state.flags & 0x20 ? 1 : 0;
  u.c2Environment.value = state.flags & 8 ? 1 : state.flags & 16 ? 2 : 0;
  u.c2Fog.value = state.flags & 0x80000 ? 1 : 0;
  const fogScale = options.visualFogDistanceScale ?? 1;
  if (!Number.isFinite(fogScale) || fogScale <= 0)
    throw new Error("Invalid visual fog distance scale");
  u.c2FogRange.value.set(state.fogMin * fogScale, state.fogMax * fogScale);
  u.c2FogColor.value.set(
    ((state.fogColor >>> 16) & 255) / 255,
    ((state.fogColor >>> 8) & 255) / 255,
    (state.fogColor & 255) / 255,
  );
  material.side = state.flags & 0x1800 ? THREE.DoubleSide : THREE.FrontSide;
  material.flatShading = !(state.flags & 4);
  material.opacity = state.rgba[3] / 255;
  material.transparent = state.rgba[3] !== 255;
  // Native opacity controls blending; it does not disable depth writes.
  material.depthWrite = !(state.flags & 0x1000000);
  material.alphaTest =
    material.map && !(state.flags & 0x20000000) ? 1 / 255 : 0;
  if (material.map) {
    const t = material.map,
      uv = state.uvTransform;
    t.matrixAutoUpdate = false;
    t.matrix.set(uv[0], uv[2], uv[4], uv[1], uv[3], uv[5], 0, 0, 1);
    setNativeTextureSampling(t, state.flags);
    t.needsUpdate = true;
  }
  material.userData.c2Flags = state.flags;
  if (material.userData.c2NativeState)
    Object.assign(material.userData.c2NativeState, state);
  else material.userData.c2NativeState = state;
  material.needsUpdate = true;
  return state;
}
