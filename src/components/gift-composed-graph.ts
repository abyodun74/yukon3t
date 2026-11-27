import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PlaneGeometry,
  PointLight,
  Points,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  type Material,
  type MeshPhysicalMaterialParameters,
  type Texture,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { bowGeometry, boxShellGeometry, carvedSidesGeometry, carvedTopGeometry, mergeParts, starGeometry, trophyGeometries } from "@/components/gift-composed-objects";
import { CARVE_LEVEL, POSTCARD_CARVE, POSTCARD_CORNER_EASE, POSTCARD_WRAP_REPEAT, sampleHeight } from "@/lib/gift-postcard-wrap";
import { buildKitten, type Kitten } from "@/components/gift-kitten";
import { seededRandom } from "@/lib/gift-legendary-plan";
import {
  BADGE_PLANE,
  BOX_OPENING,
  COMPOSED_REST,
  COMPOSED_TILT,
  CRYSTAL_PLANE,
  FRAME_PLANE,
  GEM_TABLE,
  KITTEN_BOX,
  KITTEN_SCALE,
  POSTCARD_BOX,
  STAR_FACE_Z,
  TROPHY_BASE_Y,
  TWIN_HEART_SCALE,
  badgePose,
  boxGlow,
  composedLevels,
  composedObjectPose,
  composedPulse,
  crystalPose,
  crystalRestY,
  crystalSparkle,
  engraveGlint,
  framePose,
  kittenPose,
  lidAngle,
  postcardWrapV,
  sweepReveal,
  sweepShimmer,
  twinHeartPose,
  type ComposedScenePlan,
  type ComposedVariant,
} from "@/lib/gift-composed-plan";

export { starGeometry } from "@/components/gift-composed-objects";

// The three.js objects of the composed reveals (gift-scene-composed.tsx), built from the pure plan
// (src/lib/gift-composed-plan.ts) and posed by `update(t)`. No React here, so it can be built and disposed in a unit
// test (gift-composed-graph.test.ts). All geometry is procedural (no model file, nothing downloaded: gift-composed-
// objects.ts, gift-kitten.ts); the only textures are made by the scene from the gift's own icon (cut out of its
// backdrop, or turned into engraving / wrap maps), owned and disposed by the scene, as is the environment map
// (prefiltered from buildStudioEnvironment below, one studio per kind of material) that makes metal read as metal.
//
// Layering: the objects use the depth buffer (the icon on the star sits on the star's face, the frame and the crystal
// stand on the gem and are hidden by it while behind it); additive glows, sparkles, fireworks and rings are drawn after
// them, by renderOrder, without writing depth.

const ORDER = { glow: -4, object: 0, art: 2, sparkles: 3, fireworks: 4, ring: 5 } as const;

const VERTEX_UV = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const GLOW_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uLevel;
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float d = length(p) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 2.0) * uLevel * 0.85;
  gl_FragColor = vec4(mix(uColor, uColor2, smoothstep(-0.4, 0.4, p.x + p.y)), a);
  #include <colorspace_fragment>
}`;

const RING_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uRadius;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float x = (r - uRadius) / 0.04;
  float a = (exp(-x * x) + 0.15 * (1.0 - smoothstep(0.0, uRadius, r))) * uAlpha;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;

const SPARKLE_VERTEX = /* glsl */ `
attribute float aSize;
attribute float aPhase;
attribute float aRate;
uniform float uTime;
uniform float uPixelRatio;
uniform float uLevel;
varying float vAlpha;
void main() {
  vec3 p = position;
  p.y += 0.04 * sin(uTime * 0.35 + aPhase);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPixelRatio * (4.2 / max(0.5, -mv.z));
  float twinkle = 0.5 + 0.5 * sin(uTime * aRate + aPhase);
  vAlpha = twinkle * twinkle * uLevel;
}`;

const SPARKLE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float core = 1.0 - smoothstep(0.0, 0.5, length(c));
  float glint = max(0.0, 1.0 - abs(c.x) * 14.0) * max(0.0, 1.0 - abs(c.y) * 2.2)
    + max(0.0, 1.0 - abs(c.y) * 14.0) * max(0.0, 1.0 - abs(c.x) * 2.2);
  float a = (core * core + 0.6 * glint) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;

// Fireworks: every rocket (with its trail) and every burst spark is one point; the shader places it from uTime, so
// nothing is updated per frame but one uniform.
const FIREWORK_VERTEX = /* glsl */ `
attribute vec3 aFrom;
attribute vec3 aTo;
attribute vec3 aColor;
attribute vec4 aTiming;
attribute float aSize;
uniform float uTime;
uniform float uPixelRatio;
uniform float uGravity;
uniform float uLife;
varying vec3 vColor;
varying float vAlpha;
float easeOutCubic(float t) { t = clamp(t, 0.0, 1.0); return 1.0 - pow(1.0 - t, 3.0); }
void main() {
  float start = aTiming.x;
  float end = aTiming.y;
  float lag = aTiming.z;
  float kind = aTiming.w;
  vec3 p = aFrom;
  float alpha = 0.0;
  float size = aSize;
  float t = uTime - lag;
  if (kind < 0.5) {
    // A rocket (or one of its trail points, lagging behind): from the box up to the burst, slowing as it climbs.
    float k = (t - start) / max(1.0, end - start);
    p = mix(aFrom, aTo, easeOutCubic(k));
    alpha = step(0.0, k) * step(k, 1.0) * (1.0 - lag / 340.0) * 1.6;
    size *= 1.0 - lag / 420.0;
  } else if (kind < 1.5) {
    // A burst spark: flies out fast, slows, falls a little and fades.
    float age = (uTime - start) / uLife;
    float s = (uTime - start) / 1000.0;
    p = aFrom + aTo * easeOutCubic(age * 1.7) - vec3(0.0, 0.5 * uGravity * s * s, 0.0);
    float live = step(0.0, age) * step(age, 1.0);
    float flicker = 0.75 + 0.25 * sin(uTime * 0.03 + lag);
    alpha = live * pow(max(0.0, 1.0 - age), 1.4) * flicker;
    size *= mix(1.0, 0.45, clamp(age, 0.0, 1.0));
  } else {
    // The burst's flash: one soft point, a fifth of a second.
    float age = (uTime - start) / 220.0;
    alpha = step(0.0, age) * step(age, 1.0) * (1.0 - age);
  }
  vColor = aColor;
  vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uPixelRatio * (4.2 / max(0.5, -mv.z)) * step(0.001, alpha);
}`;

const FIREWORK_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 1.2) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * (1.3 + 0.9 * (1.0 - d)), a);
  #include <colorspace_fragment>
}`;

// The Aurora Sweep painted onto the gem's facets: the icon projected from the front in the gem's own space (so it turns
// with the gem and breaks across the facets), drawn on from one end of the sweep to the other, with a shimmer.
const SWEEP_VERTEX = /* glsl */ `
varying vec3 vObj;
varying vec3 vNormalObj;
void main() {
  vObj = position;
  vNormalObj = normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SWEEP_FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform float uReveal;
uniform float uShimmer;
uniform float uLevel;
varying vec3 vObj;
varying vec3 vNormalObj;
void main() {
  vec2 uv = vec2(0.5 + vObj.x * 0.47, 0.5 + (vObj.y + 0.22) * 0.37);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
  vec4 tex = texture2D(map, uv);
  // Along the sweep: it rises from the lower left to the upper right of the icon.
  float s = uv.x * 0.78 + uv.y * 0.22;
  float r = mix(0.02, 1.05, uReveal);
  float drawn = 1.0 - smoothstep(r - 0.07, r, s);
  float edge = exp(-pow((s - r) / 0.035, 2.0)) * step(uReveal, 0.999);
  float shimmer = exp(-pow((s - uShimmer) / 0.06, 2.0));
  float facing = smoothstep(-0.15, 0.45, normalize(vNormalObj).z);
  // The icon's dark halo would read as a smudge on the gem: only its lit parts are painted on.
  float lit = smoothstep(0.06, 0.28, dot(tex.rgb, vec3(0.2126, 0.7152, 0.0722)));
  float a = tex.a * lit * drawn * facing * uLevel;
  vec3 col = tex.rgb * (1.05 + 0.9 * shimmer) + vec3(1.0, 0.97, 0.9) * (edge * 0.9 + shimmer * 0.25) * tex.a;
  a = clamp(a + edge * tex.a * facing * uLevel * 0.6, 0.0, 1.0);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

function additive(uniforms: Record<string, { value: unknown }>, fragmentShader: string, vertexShader = VERTEX_UV): ShaderMaterial {
  return new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

/**
 * Which studio a variant's materials reflect: polished gold, the bright room the gems need (three's RoomEnvironment),
 * a darker room with crisp cards for the clear-coated red hearts, a paper gift box.
 */
export type StudioKind = "gold" | "room" | "gem" | "box";

export const STUDIO_FOR_VARIANT: Readonly<Record<ComposedVariant, StudioKind>> = {
  "gold-heart": "gold",
  "star-badge": "gold",
  trophy: "gold",
  "star-engraved": "gold",
  "gem-sweep": "room",
  "gem-frame": "room",
  "gem-crystal": "room",
  "twin-hearts": "gem",
  "fireworks-box": "box",
  "kitten-box": "box",
  "postcard-box": "box",
};

type StudioPanel = { size: [number, number]; intensity: number; tint: string; at: [number, number, number] };
type StudioSpec = { floor: string; horizon: string; ceiling: string; panels: StudioPanel[] };

/**
 * The studios, per kind. Gold is metal: everything it shows is a reflection, so its studio is warm all round (a warm
 * brown floor rather than black, so the lower part of a heart or a cup reads as rich gold, not bronze), with soft cards
 * and nothing bright enough to clip a face turned to the camera to white or pale lemon. The gem studio is darker with
 * several small bright cards, so each facet of the ruby (and the red hearts' clearcoat) catches a crisp highlight, and a
 * low warm bounce card in front so the pavilion's downward facets glow red instead of going black. The box studio is a
 * bright, neutral room for paper and ribbon.
 */
const STUDIOS: Record<Exclude<StudioKind, "room">, StudioSpec> = {
  gold: {
    floor: "#4a3216",
    horizon: "#b48a4c",
    ceiling: "#c8b591",
    panels: [
      { size: [9, 6], intensity: 1.2, tint: "#fff0d6", at: [6, 9, 8] },
      { size: [12, 7], intensity: 0.62, tint: "#ffd89c", at: [0, 1.5, 14] },
      { size: [10, 4], intensity: 0.95, tint: "#ffcf86", at: [0, -7, 9] },
      { size: [2.5, 12], intensity: 1.3, tint: "#e8eeff", at: [-10, 2, -5] },
      { size: [4, 8], intensity: 0.8, tint: "#ffdcae", at: [11, -1, 2] },
    ],
  },
  gem: {
    floor: "#2a1216",
    horizon: "#5a4048",
    ceiling: "#8e8290",
    panels: [
      { size: [5, 4], intensity: 2.3, tint: "#ffffff", at: [6, 9, 8] },
      { size: [3, 5], intensity: 2.0, tint: "#fff2f4", at: [-8, 6, 6] },
      { size: [8, 3], intensity: 1.5, tint: "#ffc8cf", at: [0, -7, 9] },
      { size: [2, 8], intensity: 1.7, tint: "#e6ecff", at: [9, 0, -6] },
      { size: [4, 3], intensity: 1.3, tint: "#ffe6ea", at: [-6, -4, -8] },
      { size: [6, 4], intensity: 1.0, tint: "#ffffff", at: [0, 3, 14] },
    ],
  },
  box: {
    floor: "#2b2430",
    horizon: "#6c6474",
    ceiling: "#b8b0c0",
    panels: [
      { size: [9, 6], intensity: 1.7, tint: "#fffaf2", at: [6, 9, 8] },
      { size: [12, 7], intensity: 0.9, tint: "#fff0e0", at: [0, 1.5, 14] },
      { size: [2.5, 12], intensity: 1.2, tint: "#e8eeff", at: [-10, 2, -5] },
      { size: [4, 8], intensity: 0.8, tint: "#ffe8d0", at: [11, -1, 2] },
    ],
  },
};

/**
 * The studio a variant's metal, gem or paper reflects (prefiltered by the scene with PMREM): a floor, a horizon, a
 * ceiling and a few soft cards (STUDIOS). All moderate (nothing near the blown-out panels of three's RoomEnvironment).
 * Procedural, no file; `dispose` frees what it made.
 */
export function buildStudioEnvironment(kind: StudioKind = "gold"): { scene: Scene; dispose: () => void } {
  if (kind === "room") {
    const room = new RoomEnvironment();
    return { scene: room, dispose: () => room.dispose() };
  }
  const spec = STUDIOS[kind];
  const scene = new Scene();
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const sky = new SphereGeometry(20, 32, 16);
  const colors: number[] = [];
  const position = sky.getAttribute("position");
  const floor = new Color(spec.floor);
  const horizon = new Color(spec.horizon);
  const ceiling = new Color(spec.ceiling);
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i) / 20;
    const c = y < 0 ? floor.clone().lerp(horizon, Math.pow(1 + y, 3)) : horizon.clone().lerp(ceiling, Math.pow(y, 0.7));
    colors.push(c.r, c.g, c.b);
  }
  sky.setAttribute("color", new Float32BufferAttribute(colors, 3));
  const skyMaterial = new MeshBasicMaterial({ vertexColors: true, side: BackSide });
  geometries.push(sky);
  materials.push(skyMaterial);
  scene.add(new Mesh(sky, skyMaterial));
  for (const p of spec.panels) {
    const geometry = new PlaneGeometry(p.size[0], p.size[1]);
    const material = new MeshBasicMaterial({ color: new Color(p.tint).multiplyScalar(p.intensity), side: DoubleSide });
    geometries.push(geometry);
    materials.push(material);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(...p.at);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  }
  return {
    scene,
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      scene.clear();
    },
  };
}

/** The classic 3D heart surface, (x^2 + 9/4 y^2 + z^2 - 1)^3 - x^2 z^3 - 9/200 y^2 z^3 = 0 (z up, y = depth). */
function heartField(x: number, y: number, z: number): number {
  const a = x * x + 2.25 * y * y + z * z - 1;
  return a * a * a - x * x * z * z * z - 0.045 * y * y * z * z * z;
}

/**
 * A rounded, puffy heart (Keepsake Locket): a sphere whose every vertex is pushed out along its direction to the heart
 * surface (bisection from the centre), so the polished metal has real curvature to roll its highlights over. Height
 * about 2 (y up, depth along z), centred.
 */
export function goldHeartGeometry(widthSegments = 96, heightSegments = 72): BufferGeometry {
  const geometry = new SphereGeometry(1, widthSegments, heightSegments);
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    // Sphere y is up; in the heart field z is up and y is depth.
    const dx = position.getX(i);
    const dUp = position.getY(i);
    const dDepth = position.getZ(i);
    let lo = 0;
    let hi = 1.6;
    for (let step = 0; step < 28; step++) {
      const mid = (lo + hi) / 2;
      if (heartField(dx * mid, dDepth * mid, dUp * mid) < 0) lo = mid;
      else hi = mid;
    }
    const r = (lo + hi) / 2;
    position.setXYZ(i, dx * r, dUp * r, dDepth * r * 0.82);
  }
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  geometry.translate(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, -(box.min.z + box.max.z) / 2);
  const height = box.max.y - box.min.y;
  geometry.scale(2 / height, 2 / height, 2 / height);
  geometry.computeVertexNormals();
  return geometry;
}

/** The gem of the earlier placeholder model: a ten-sided crown (flat top = the table) over a pointed pavilion. */
export function gemGeometries(): { crown: BufferGeometry; pavilion: BufferGeometry } {
  const crown = new CylinderGeometry(0.55, 0.95, 0.35, 10, 1);
  crown.translate(0, 0.32, 0);
  const pavilion = new ConeGeometry(0.95, 1.1, 10, 1);
  pavilion.rotateX(Math.PI);
  pavilion.translate(0, -0.4, 0);
  return { crown, pavilion };
}

/** Where the gem's light starts to be compressed, and the most any channel may reach (before tone mapping). */
export const GEM_HUE_KNEE = 0.6;
export const GEM_HUE_CEILING = 0.9;
/** In a bright facet, the weakest channel is held to at most this share of the strongest (the facet keeps its colour). */
export const GEM_HIGHLIGHT_WHITENESS = 0.08;

/**
 * Keeps every facet of the gem its own colour, however hard it catches the light. The faceted gem is flat-shaded, so
 * when the key light's (or a studio panel's) mirror direction lines up with one facet, the whole facet gets one very
 * bright highlight, which the clear coat and the thin-film glint make paler still; the filmic tone mapping then turns
 * any colour that bright into flat white (it desaturates highlights), which is the solid white facet seen mid-sway.
 * Here, before tone mapping and only for bright pixels: the light level above GEM_HUE_KNEE is compressed smoothly
 * towards GEM_HUE_CEILING (all channels by the same factor), and the weakest channel is held to at most
 * GEM_HIGHLIGHT_WHITENESS of the strongest along the pixel's own hue (a pure white pixel takes the stone's hue, `hue`,
 * 0..1 per channel with its weakest at 0). So a facet in the light reads as a bright ruby (or sapphire) facet, never
 * white; the rest of the stone (below the knee, not bright) is untouched, so the gem is no duller.
 */
export function keepGemHue(material: MeshPhysicalMaterial, hue: readonly [number, number, number]): void {
  const f = (v: number) => v.toFixed(4);
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <tonemapping_fragment>",
      /* glsl */ `{
        vec3 c = gl_FragColor.rgb;
        float peak = max(c.r, max(c.g, c.b));
        if (peak > ${f(GEM_HUE_KNEE)}) {
          float span = ${f(GEM_HUE_CEILING - GEM_HUE_KNEE)};
          float soft = ${f(GEM_HUE_KNEE)} + span * (1.0 - exp(-(peak - ${f(GEM_HUE_KNEE)}) / span));
          c *= soft / peak;
          peak = soft;
        }
        float lo = min(c.r, min(c.g, c.b));
        float bright = smoothstep(0.45, 1.0, peak);
        float target = mix(lo, min(lo, ${f(GEM_HIGHLIGHT_WHITENESS)} * peak), bright);
        vec3 dir = peak - lo > 0.0001 ? (c - vec3(lo)) / (peak - lo) : vec3(${f(hue[0])}, ${f(hue[1])}, ${f(hue[2])});
        gl_FragColor.rgb = vec3(target) + dir * (peak - target);
      }
      #include <tonemapping_fragment>`,
    );
  };
  material.customProgramCacheKey = () => `gem-keep-hue-${hue.join(",")}`;
}

/**
 * Polished gold: a warm, saturated base colour that every reflection takes as its tint. No clear coat: a clear coat
 * reflects the studio untinted, which is what turned the brightest faces pale lemon or white.
 */
const GOLD = { color: "#f4b942", metalness: 1, roughness: 0.24, envMapIntensity: 1.0 } as const;

/** Each rocket is drawn with a trail of points lagging behind it (ms), so the upward blast reads as a streak. */
export const ROCKET_TRAIL_MAX_LAG = 300;
export const ROCKET_TRAIL_STEP = 8;

export type ComposedView = { pixelRatio: number };

/** A height field (0..1, row 0 at the top), for geometry the carving displaces. */
export type HeightField = { data: Float32Array; width: number; height: number };

/**
 * What the scene hands the graph: the icon (cut out) or, for the engraved star, the colour map it made from the icon
 * and, for the postcard box, the carving's colour map; the environment map; and the extra maps those two need (relief
 * normals, roughness, the postcard lid's top, and the carving's height fields that displace the box's sides and lid).
 * All owned and disposed by the scene.
 */
export type ComposedAssets = {
  art: Texture | null;
  envMap: Texture | null;
  maps?: { normal?: Texture | null; roughness?: Texture | null; lidTop?: Texture | null; lidTopNormal?: Texture | null };
  carving?: { sides: HeightField; lid: HeightField };
};

export type ComposedGraph = {
  root: Group;
  update: (t: number, view: ComposedView) => void;
  /** Disposes every geometry and material it created (not the textures passed in: their owner disposes those). */
  dispose: () => void;
};

const LOOK: Record<ComposedVariant, { glow: string; glow2: string; sparkle: string; light: string; ring: string }> = {
  "gold-heart": { glow: "#ffb83a", glow2: "#ffe39a", sparkle: "#fff0c4", light: "#ffcf7a", ring: "#ffd98a" },
  "fireworks-box": { glow: "#9a5cff", glow2: "#ff5fa2", sparkle: "#ffe2f2", light: "#c58cff", ring: "#ffffff" },
  "star-badge": { glow: "#ffb43a", glow2: "#b26bff", sparkle: "#fff0c4", light: "#ffcf7a", ring: "#ffe7a6" },
  "gem-sweep": { glow: "#ff2d55", glow2: "#3fd6c6", sparkle: "#ffe1e8", light: "#ff3a5c", ring: "#ffd0da" },
  "gem-frame": { glow: "#ff2d55", glow2: "#b26bff", sparkle: "#ffe1e8", light: "#ff3a5c", ring: "#ffd0da" },
  trophy: { glow: "#ffb83a", glow2: "#ffe39a", sparkle: "#fff0c4", light: "#ffcf7a", ring: "#ffd98a" },
  "kitten-box": { glow: "#ff8fc0", glow2: "#7fd0ff", sparkle: "#ffe8f4", light: "#ffc2dc", ring: "#ffffff" },
  "twin-hearts": { glow: "#ff2d55", glow2: "#ff86a8", sparkle: "#ffd6e0", light: "#ff5a78", ring: "#ffc0cc" },
  "star-engraved": { glow: "#ffb43a", glow2: "#ffe08a", sparkle: "#fff0c4", light: "#ffcf7a", ring: "#ffe7a6" },
  "gem-crystal": { glow: "#3a5cff", glow2: "#b26bff", sparkle: "#e4ecff", light: "#6a86ff", ring: "#cfe0ff" },
  "postcard-box": { glow: "#ff8a3d", glow2: "#c65cff", sparkle: "#ffe6c4", light: "#ffb070", ring: "#ffd9a0" },
};

/** The gift box's colours (Fireworks, Playful Kitten): its paper, the lining inside, the ribbon. */
const BOX_COLORS: Partial<Record<ComposedVariant, { paper: string; lining: string; ribbon: string }>> = {
  "fireworks-box": { paper: "#7d4ef2", lining: "#5e3fb8", ribbon: "#f6cd62" },
  "kitten-box": { paper: "#f06aa8", lining: "#b8487e", ribbon: "#f6cd62" },
};

export function buildComposedGraph(plan: ComposedScenePlan, assets: ComposedAssets): ComposedGraph {
  const variant = plan.variant;
  const look = LOOK[variant];
  const root = new Group();
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const own = <G extends BufferGeometry, M extends Material>(geometry: G, material: M) => {
    geometries.push(geometry);
    materials.push(material);
    return [geometry, material] as const;
  };
  const ownMaterial = <M extends Material>(material: M) => {
    materials.push(material);
    return material;
  };
  const ownGeometry = <G extends BufferGeometry>(geometry: G) => {
    geometries.push(geometry);
    return geometry;
  };
  const random = seededRandom(0x6f1f7 + plan.fireworks.length);
  const studio = STUDIO_FOR_VARIANT[variant];

  root.add(new AmbientLight(0xffffff, 0.35));
  // Softer on gold: polished metal turns a strong key light into a blown-out white spot.
  const key = new DirectionalLight(0xfff4e0, studio === "gold" ? 1.0 : studio === "box" ? 1.7 : 2.4);
  key.position.set(2.5, 3, 4);
  root.add(key);
  const rim = new DirectionalLight(0xffe2b0, 1.8);
  rim.position.set(-2.2, 1.6, -3);
  root.add(rim);
  // A coloured fill from low left; weaker on gold, where a point light makes a pale hot spot on a broad face.
  const fill = new PointLight(new Color(look.light), studio === "gold" ? 2.2 : 6, 0, 2);
  fill.position.set(-1.6, -0.6, 2.2);
  root.add(fill);

  // The glow behind the object.
  const [glowGeometry, glowMaterial] = own(
    new PlaneGeometry(3.2, 3.2),
    additive({ uColor: { value: new Color(look.glow) }, uColor2: { value: new Color(look.glow2) }, uLevel: { value: 0 } }, GLOW_FRAGMENT),
  );
  const glow = new Mesh(glowGeometry, glowMaterial);
  glow.position.set(0, variant === "fireworks-box" ? -0.2 : 0.05, -1.2);
  glow.renderOrder = ORDER.glow;
  // The carved postcard box hides the glow behind it (otherwise the glow, drawn over everything, washes a pale veil
  // over the carving's colours and shadows). The gems keep it over them: it is part of the ruby's bright crimson.
  if (variant === "postcard-box") glowMaterial.depthTest = true;
  root.add(glow);

  // The object, in a group that carries its entrance and sway (everything placed on it is a child, so it follows).
  const object = new Group();
  root.add(object);
  const gold = (extra: Partial<MeshPhysicalMaterialParameters> = {}) =>
    ownMaterial(
      new MeshPhysicalMaterial({
        ...GOLD,
        color: new Color(GOLD.color),
        emissive: new Color("#4a2a00"),
        emissiveIntensity: 0.3,
        envMap: assets.envMap,
        ...extra,
      }),
    );

  let lid: Group | null = null;
  let openingGlow: ShaderMaterial | null = null;
  let badge: Mesh | null = null;
  let badgeMaterial: MeshBasicMaterial | null = null;
  let frame: Mesh | null = null;
  let frameMaterial: MeshBasicMaterial | null = null;
  let sweepMaterial: ShaderMaterial | null = null;
  let kitten: Kitten | null = null;
  let hearts: Group[] = [];
  let glint: PointLight | null = null;
  let crystal: Mesh | null = null;
  let crystalMaterial: MeshBasicMaterial | null = null;
  let crystalSparkles: ShaderMaterial | null = null;

  /** The gift box (Fireworks, Playful Kitten): an open body with real walls and a lining, and the lid on its hinge. */
  const giftBox = (colors: { paper: string; lining: string; ribbon: string }) => {
    const group = new Group();
    const paper = ownMaterial(
      new MeshPhysicalMaterial({ color: new Color(colors.paper), roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.35, envMap: assets.envMap, envMapIntensity: 0.7 }),
    );
    const lining = ownMaterial(
      new MeshPhysicalMaterial({
        color: new Color(colors.lining),
        roughness: 0.7,
        sheen: 0.5,
        sheenColor: new Color("#ffffff"),
        sheenRoughness: 0.45,
        envMap: assets.envMap,
        envMapIntensity: 0.35,
      }),
    );
    const edge = ownMaterial(new MeshPhysicalMaterial({ color: new Color(colors.paper).lerp(new Color("#ffffff"), 0.25), roughness: 0.6, envMap: assets.envMap, envMapIntensity: 0.5 }));
    const ribbon = ownMaterial(
      new MeshPhysicalMaterial({ color: new Color(colors.ribbon), metalness: 0.8, roughness: 0.32, clearcoat: 0.4, envMap: assets.envMap, envMapIntensity: 1.1, side: DoubleSide }),
    );
    const shellMaterials = [paper, lining, edge];
    const body = new Mesh(ownGeometry(boxShellGeometry(1.3, 1.0, 1.3, 0.045, "top")), shellMaterials);
    body.position.y = -0.2;
    group.add(body);
    // Ribbon down the middle of each side (thin plates on the paper).
    const strip = (w: number, h: number, d: number, x: number, y: number, z: number) => ({ geometry: new BoxGeometry(w, h, d), group: 0, matrix: new Matrix4().makeTranslation(x, y, z) });
    const bodyStrips = [strip(0.22, 1.0, 0.012, 0, -0.2, 0.656), strip(0.22, 1.0, 0.012, 0, -0.2, -0.656), strip(0.012, 1.0, 0.22, 0.656, -0.2, 0), strip(0.012, 1.0, 0.22, -0.656, -0.2, 0)];
    group.add(new Mesh(ownGeometry(mergeParts(bodyStrips)), ribbon));
    for (const s of bodyStrips) s.geometry.dispose();

    // The lid: a cap whose walls come down over the body's top, hinged along its back bottom edge.
    const hinge = new Group();
    hinge.position.set(0, 0.1, -0.7);
    const lidShell = new Mesh(ownGeometry(boxShellGeometry(1.4, 0.24, 1.4, 0.04, "bottom")), shellMaterials);
    lidShell.position.set(0, 0.12, 0.7);
    const lidStrips = [
      strip(0.24, 0.012, 1.412, 0, 0.246, 0.7),
      strip(1.412, 0.012, 0.24, 0, 0.246, 0.7),
      strip(0.24, 0.24, 0.012, 0, 0.12, 1.406),
      strip(0.24, 0.24, 0.012, 0, 0.12, -0.006),
      strip(0.012, 0.24, 0.24, 0.706, 0.12, 0.7),
      strip(0.012, 0.24, 0.24, -0.706, 0.12, 0.7),
    ];
    const lidRibbon = new Mesh(ownGeometry(mergeParts(lidStrips)), ribbon);
    for (const s of lidStrips) s.geometry.dispose();
    const bow = new Mesh(ownGeometry(bowGeometry()), ribbon);
    bow.position.set(0, 0.252, 0.7);
    hinge.add(lidShell, lidRibbon, bow);
    group.add(hinge);
    return { group, hinge };
  };

  if (variant === "gold-heart") {
    object.add(new Mesh(ownGeometry(goldHeartGeometry()), gold()));
  } else if (variant === "star-badge") {
    object.add(new Mesh(ownGeometry(starGeometry()), gold()));
    if (assets.art) {
      badgeMaterial = ownMaterial(
        new MeshBasicMaterial({ map: assets.art, transparent: true, depthWrite: false, toneMapped: false, side: FrontSide, opacity: 0 }),
      );
      badge = new Mesh(ownGeometry(new PlaneGeometry(BADGE_PLANE.size, BADGE_PLANE.size)), badgeMaterial);
      badge.renderOrder = ORDER.art;
      object.add(badge);
    }
  } else if (variant === "star-engraved") {
    // The Supporter Star engraved into the front face: the scene's colour map (the gold darkened in the cuts), relief
    // normals and a satin finish inside the engraving, all on the star's own surface, lit with it.
    const maps = assets.maps ?? {};
    const engraved = gold({
      map: assets.art,
      normalMap: maps.normal ?? null,
      normalScale: new Vector2(1.1, 1.1),
      roughnessMap: maps.roughness ?? null,
      roughness: 1,
    });
    object.add(new Mesh(ownGeometry(starGeometry(true)), engraved));
    glint = new PointLight(new Color("#fff1d6"), 0, 2.4, 2);
    object.add(glint);
  } else if (variant === "trophy") {
    const parts = trophyGeometries();
    for (const g of Object.values(parts)) ownGeometry(g);
    const cupGold = gold();
    const lacquer = ownMaterial(
      new MeshPhysicalMaterial({ color: new Color("#0c0a10"), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, envMap: assets.envMap, envMapIntensity: 0.45 }),
    );
    const plate = gold({ roughness: 0.38, clearcoat: 0 });
    object.add(new Mesh(parts.cup, cupGold), new Mesh(parts.handles, cupGold), new Mesh(parts.plinth, lacquer), new Mesh(parts.plate, plate));
  } else if (variant === "twin-hearts") {
    const geometry = ownGeometry(goldHeartGeometry(80, 60));
    const reds = ["#b8001a", "#c80a22"].map((c) =>
      ownMaterial(
        new MeshPhysicalMaterial({
          color: new Color(c),
          emissive: new Color("#300006"),
          emissiveIntensity: 0.5,
          roughness: 0.2,
          metalness: 0.05,
          clearcoat: 1,
          clearcoatRoughness: 0.04,
          envMap: assets.envMap,
          envMapIntensity: 1.1,
        }),
      ),
    );
    hearts = reds.map((material) => {
      const group = new Group();
      const mesh = new Mesh(geometry, material);
      mesh.scale.setScalar(TWIN_HEART_SCALE);
      group.add(mesh);
      object.add(group);
      return group;
    });
  } else if (variant === "gem-sweep" || variant === "gem-frame" || variant === "gem-crystal") {
    const { crown, pavilion } = gemGeometries();
    ownGeometry(crown);
    ownGeometry(pavilion);
    const midnight = variant === "gem-crystal";
    // The ruby (the Aurora gifts) or the midnight sapphire (Midnight Crystal): a glossy, faceted, metallic-tinted stone in
    // the bright "room" studio (three's RoomEnvironment), whose many lit panels give every facet its own highlight. Red or
    // deep blue can't clip to white the way polished gold does, so the gem keeps the bright studio the gold left behind.
    const gem = ownMaterial(
      new MeshPhysicalMaterial({
        color: new Color(midnight ? "#1c2ca8" : "#9c0018"),
        emissive: new Color(midnight ? "#0a1040" : "#2a0008"),
        metalness: 0.75,
        roughness: 0.05,
        clearcoat: midnight ? 0.08 : 0.3,
        clearcoatRoughness: 0.06,
        // The thin-film glint reflects untinted light; on the darker blue stone it turned the table white, so it is faint.
        iridescence: midnight ? 0.1 : 0.3,
        iridescenceIOR: 1.7,
        iridescenceThicknessMaximum: 420,
        flatShading: true,
        envMap: assets.envMap,
        envMapIntensity: midnight ? 0.3 : 0.55,
      }),
    );
    keepGemHue(gem, midnight ? [0, 0.11, 1] : [1, 0, 0.1]);
    object.add(new Mesh(crown, gem), new Mesh(pavilion, gem));
    if (variant === "gem-sweep" && assets.art) {
      sweepMaterial = ownMaterial(
        new ShaderMaterial({
          uniforms: { map: { value: assets.art }, uReveal: { value: 0 }, uShimmer: { value: -10 }, uLevel: { value: 1 } },
          vertexShader: SWEEP_VERTEX,
          fragmentShader: SWEEP_FRAGMENT,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      for (const geometry of [crown, pavilion]) {
        const overlay = new Mesh(geometry, sweepMaterial);
        overlay.renderOrder = ORDER.art;
        object.add(overlay);
      }
    }
    if (variant === "gem-frame" && assets.art) {
      frameMaterial = ownMaterial(
        new MeshBasicMaterial({ map: assets.art, transparent: true, depthWrite: false, toneMapped: false, side: DoubleSide, opacity: 0 }),
      );
      frame = new Mesh(ownGeometry(new PlaneGeometry(FRAME_PLANE.size, FRAME_PLANE.size)), frameMaterial);
      frame.renderOrder = ORDER.art;
      object.add(frame);
    }
    if (variant === "gem-crystal" && assets.art) {
      crystalMaterial = ownMaterial(
        new MeshBasicMaterial({ map: assets.art, transparent: true, depthWrite: false, toneMapped: false, side: DoubleSide, opacity: 0 }),
      );
      crystal = new Mesh(ownGeometry(new PlaneGeometry(CRYSTAL_PLANE.size, CRYSTAL_PLANE.size)), crystalMaterial);
      crystal.renderOrder = ORDER.art;
      object.add(crystal);
      // Its own glints, around the crystal's points once it has landed (gem units, in front of and around it).
      const restY = crystalRestY();
      const specs = Array.from({ length: plan.lowEnd ? 10 : 22 }, () => ({
        x: (random() * 2 - 1) * 0.62,
        y: restY - 0.25 + random() * 0.85,
        z: (random() * 2 - 1) * 0.18 + 0.08,
        size: 6 + random() * 9,
        phase: random() * Math.PI * 2,
        rate: 2.2 + random() * 2.2,
      }));
      const geometry = ownGeometry(new BufferGeometry());
      geometry.setAttribute("position", new Float32BufferAttribute(specs.flatMap((s) => [s.x, s.y, s.z]), 3));
      geometry.setAttribute("aSize", new Float32BufferAttribute(specs.map((s) => s.size), 1));
      geometry.setAttribute("aPhase", new Float32BufferAttribute(specs.map((s) => s.phase), 1));
      geometry.setAttribute("aRate", new Float32BufferAttribute(specs.map((s) => s.rate), 1));
      crystalSparkles = additive(
        { uColor: { value: new Color("#eef3ff") }, uTime: { value: 0 }, uPixelRatio: { value: 1 }, uLevel: { value: 0 } },
        SPARKLE_FRAGMENT,
        SPARKLE_VERTEX,
      );
      materials.push(crystalSparkles);
      const points = new Points(geometry, crystalSparkles);
      points.frustumCulled = false;
      points.renderOrder = ORDER.sparkles;
      object.add(points);
    }
  } else if (variant === "postcard-box") {
    // The sunset carved round the box: one panorama round the four sides and on up the lid's rim, the box's sides and
    // the lid's top displaced by the carving's height (real relief) with its normal map for the bevels, finished in a
    // clear lacquer so highlights run over the raised edges as the box turns; a gold bow on top.
    const maps = assets.maps ?? {};
    const carving = assets.carving;
    const B = POSTCARD_BOX;
    const lacquer = (map: Texture | null | undefined, normal: Texture | null | undefined) =>
      ownMaterial(
        new MeshPhysicalMaterial({
          color: new Color("#ffffff"),
          map: map ?? null,
          normalMap: normal ?? null,
          normalScale: new Vector2(1, 1),
          roughness: 0.55,
          clearcoat: 0.6,
          clearcoatRoughness: 0.18,
          envMap: assets.envMap,
          envMapIntensity: 0.14,
        }),
      );
    const wrap = lacquer(assets.art, maps.normal);
    const base = ownMaterial(new MeshPhysicalMaterial({ color: new Color("#2b1640"), roughness: 0.6, envMap: assets.envMap, envMapIntensity: 0.4 }));
    const top = lacquer(maps.lidTop, maps.lidTopNormal);
    const ribbon = ownMaterial(
      new MeshPhysicalMaterial({ color: new Color("#f6cd62"), metalness: 0.8, roughness: 0.32, clearcoat: 0.4, envMap: assets.envMap, envMapIntensity: 1.1, side: DoubleSide }),
    );
    const sides = carving?.sides;
    const sideHeight = sides ? (u: number, v: number) => sampleHeight(sides.data, sides.width, sides.height, u * POSTCARD_WRAP_REPEAT, v, true) : () => 0;
    const fine = plan.lowEnd ? 0.5 : 1;
    const bodyHeight = B.bodyTop - B.bodyBottom;
    const lidV = postcardWrapV(B.lidBottom);
    const body = new Mesh(
      ownGeometry(
        carvedSidesGeometry(B.width, bodyHeight, B.width, [postcardWrapV(B.bodyBottom), postcardWrapV(B.bodyTop)], { top: true, bottom: true }, {
          height: sideHeight,
          depth: POSTCARD_CARVE.depth,
          columns: Math.round(240 * fine),
          rows: Math.round(200 * fine),
          cornerEase: POSTCARD_CORNER_EASE,
          // Under the lid the body stays plain (the carving must not reach the lid's walls).
          fadeAboveV: lidV - 0.045,
          fadeSpan: 0.03,
        }),
      ),
      [wrap, base],
    );
    body.position.y = (B.bodyTop + B.bodyBottom) / 2;
    const lidHeight = B.lidTop - B.lidBottom;
    const lidSides = new Mesh(
      ownGeometry(
        carvedSidesGeometry(B.lidWidth, lidHeight, B.lidWidth, [lidV, postcardWrapV(B.lidTop)], { top: false, bottom: true }, {
          height: sideHeight,
          depth: POSTCARD_CARVE.depth,
          columns: Math.round(240 * fine),
          rows: Math.round(50 * fine),
          cornerEase: POSTCARD_CORNER_EASE,
        }),
      ),
      [wrap, base],
    );
    lidSides.position.y = (B.lidTop + B.lidBottom) / 2;
    const lid = carving?.lid;
    const lidTop = new Mesh(
      ownGeometry(
        carvedTopGeometry(B.lidWidth, {
          height: lid ? (u, v) => sampleHeight(lid.data, lid.width, lid.height, u, v, false) : () => 0,
          depth: POSTCARD_CARVE.depth,
          columns: Math.round(160 * fine),
          rows: Math.round(160 * fine),
          cornerEase: POSTCARD_CORNER_EASE,
        }),
      ),
      top,
    );
    lidTop.position.y = B.lidTop;
    const bow = new Mesh(ownGeometry(bowGeometry()), ribbon);
    bow.position.set(0, B.lidTop + POSTCARD_CARVE.depth * CARVE_LEVEL.sun, 0);
    bow.scale.setScalar(0.85);
    object.add(body, lidSides, lidTop, bow);
  } else {
    // The gift box (Fireworks, Playful Kitten).
    const built = giftBox(BOX_COLORS[variant]!);
    lid = built.hinge;
    if (variant === "kitten-box") {
      built.group.position.set(KITTEN_BOX.x, 0, KITTEN_BOX.z);
      object.add(built.group);
      kitten = buildKitten(assets.envMap);
      for (const g of kitten.geometries) ownGeometry(g);
      for (const m of kitten.materials) ownMaterial(m);
      kitten.root.scale.setScalar(KITTEN_SCALE);
      object.add(kitten.root);
    } else {
      object.add(built.group);
      // The light inside the open box.
      const [openingGeometry, openingMaterial] = own(
        new PlaneGeometry(1.2, 1.2),
        additive({ uColor: { value: new Color("#ffd8a0") }, uColor2: { value: new Color("#ff9ad0") }, uLevel: { value: 0 } }, GLOW_FRAGMENT),
      );
      // Hidden by the lid where the lid is in front of it (it must not wash over the open lid).
      openingMaterial.depthTest = true;
      openingGlow = openingMaterial;
      const opening = new Mesh(openingGeometry, openingMaterial);
      opening.rotation.x = -Math.PI / 2;
      opening.position.y = BOX_OPENING.y - 0.02;
      opening.renderOrder = ORDER.sparkles;
      object.add(opening);
    }
  }

  // Twinkles around the object.
  const sparkleMaterial = additive(
    { uColor: { value: new Color(look.sparkle) }, uTime: { value: 0 }, uPixelRatio: { value: 1 }, uLevel: { value: 0 } },
    SPARKLE_FRAGMENT,
    SPARKLE_VERTEX,
  );
  materials.push(sparkleMaterial);
  const sparkleGeometry = ownGeometry(new BufferGeometry());
  sparkleGeometry.setAttribute("position", new Float32BufferAttribute(plan.sparkles.flatMap((s) => [s.x, s.y, s.z]), 3));
  sparkleGeometry.setAttribute("aSize", new Float32BufferAttribute(plan.sparkles.map((s) => s.size), 1));
  sparkleGeometry.setAttribute("aPhase", new Float32BufferAttribute(plan.sparkles.map((s) => s.phase), 1));
  sparkleGeometry.setAttribute("aRate", new Float32BufferAttribute(plan.sparkles.map((s) => s.rate), 1));
  const sparkles = new Points(sparkleGeometry, sparkleMaterial);
  sparkles.frustumCulled = false;
  sparkles.renderOrder = ORDER.sparkles;
  root.add(sparkles);

  // Fireworks (scene space, so the bursts don't sway with the box): rockets with trails, sparks, flashes.
  let fireworkMaterial: ShaderMaterial | null = null;
  if (plan.fireworks.length > 0) {
    const rest = COMPOSED_REST[variant];
    const from: number[] = [];
    const to: number[] = [];
    const colors: number[] = [];
    const timing: number[] = [];
    const sizes: number[] = [];
    const push = (f: number[], tt: number[], c: Color, tm: number[], size: number) => {
      from.push(...f);
      to.push(...tt);
      colors.push(c.r, c.g, c.b);
      timing.push(...tm);
      sizes.push(size);
    };
    for (const fw of plan.fireworks) {
      const color = new Color(fw.color);
      const core = new Color(fw.core);
      const start = [fw.fromX * rest.scale, rest.y + BOX_OPENING.y * rest.scale, fw.fromZ * rest.scale];
      const burst = [fw.x, fw.y, fw.z];
      for (let lag = 0; lag <= ROCKET_TRAIL_MAX_LAG; lag += ROCKET_TRAIL_STEP) push(start, burst, lag < 60 ? core : color, [fw.launchMs, fw.burstMs, lag, 0], lag === 0 ? 28 : 18);
      for (let i = 0; i < fw.particles; i++) {
        // Evenly spread directions (golden-angle spiral on a sphere), each at a slightly different speed.
        const y = 1 - (2 * (i + 0.5)) / fw.particles;
        const ring = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = i * 2.399963 + random() * 0.3;
        const speed = fw.radius * (0.72 + random() * 0.3);
        push(burst, [Math.cos(theta) * ring * speed, y * speed, Math.sin(theta) * ring * speed * 0.6], i % 4 === 0 ? core : color, [fw.burstMs, 0, random() * 200, 1], 11 + random() * 6);
      }
      push(burst, [0, 0, 0], core, [fw.burstMs, 0, 0, 2], 28);
    }
    const geometry = ownGeometry(new BufferGeometry());
    geometry.setAttribute("position", new Float32BufferAttribute(from, 3));
    geometry.setAttribute("aFrom", new Float32BufferAttribute(from, 3));
    geometry.setAttribute("aTo", new Float32BufferAttribute(to, 3));
    geometry.setAttribute("aColor", new Float32BufferAttribute(colors, 3));
    geometry.setAttribute("aTiming", new Float32BufferAttribute(timing, 4));
    geometry.setAttribute("aSize", new Float32BufferAttribute(sizes, 1));
    fireworkMaterial = additive(
      { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uGravity: { value: plan.gravity }, uLife: { value: plan.burstLifeMs } },
      FIREWORK_FRAGMENT,
      FIREWORK_VERTEX,
    );
    materials.push(fireworkMaterial);
    const points = new Points(geometry, fireworkMaterial);
    points.frustumCulled = false;
    points.renderOrder = ORDER.fireworks;
    root.add(points);
  }

  // The landing pulse: on the star's face, lying on the gem's table under the frame / crystal, at the trophy's and the
  // postcard box's base, round the hearts.
  const [ringGeometry, ringMaterial] = own(
    new PlaneGeometry(2, 2),
    additive({ uColor: { value: new Color(look.ring) }, uRadius: { value: 0 }, uAlpha: { value: 0 } }, RING_FRAGMENT),
  );
  const ring = new Mesh(ringGeometry, ringMaterial);
  ring.renderOrder = ORDER.ring;
  ring.visible = false;
  if (variant === "gem-frame" || variant === "gem-crystal") {
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, GEM_TABLE.y + 0.005, 0);
    ring.scale.setScalar(0.75);
  } else if (variant === "star-badge" || variant === "star-engraved") {
    ring.position.set(0, BADGE_PLANE.y, STAR_FACE_Z + 0.02);
    ring.scale.setScalar(1.05);
  } else if (variant === "trophy") {
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, TROPHY_BASE_Y, 0);
    ring.scale.setScalar(0.9);
  } else if (variant === "postcard-box") {
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, POSTCARD_BOX.bodyBottom, 0);
    ring.scale.setScalar(1.3);
  } else {
    ring.position.set(0, 0, 0.1);
    ring.scale.setScalar(1.2);
  }
  // The spinning variants' rings lie in scene space at the base, so they don't spin (a ring is round either way).
  object.add(ring);

  const tilt = COMPOSED_TILT[variant] ?? 0;

  return {
    root,
    update(t, view) {
      const seconds = t / 1000;
      const pose = composedObjectPose(plan, t);
      object.position.y = pose.y;
      object.scale.setScalar(pose.scale);
      object.rotation.set(pose.pitch + tilt, pose.yaw, 0);
      const levels = composedLevels(plan, t);
      glowMaterial.uniforms.uLevel.value = levels.glow;
      sparkleMaterial.uniforms.uTime.value = seconds;
      sparkleMaterial.uniforms.uPixelRatio.value = view.pixelRatio;
      sparkleMaterial.uniforms.uLevel.value = levels.sparkles;

      if (lid) lid.rotation.x = lidAngle(plan, t);
      if (openingGlow) openingGlow.uniforms.uLevel.value = boxGlow(plan, t);
      if (fireworkMaterial) {
        fireworkMaterial.uniforms.uTime.value = t;
        fireworkMaterial.uniforms.uPixelRatio.value = view.pixelRatio;
      }
      if (badge && badgeMaterial) {
        const b = badgePose(plan, t);
        badge.position.set(0, BADGE_PLANE.y, STAR_FACE_Z + 0.012 + b.z);
        badge.scale.setScalar(b.scale);
        badgeMaterial.opacity = b.opacity;
      }
      if (frame && frameMaterial) {
        const f = framePose(plan, t);
        frame.position.set(0, f.y, f.z);
        frameMaterial.opacity = f.opacity;
      }
      if (crystal && crystalMaterial) {
        const c = crystalPose(plan, t);
        crystal.position.set(c.x, c.y, 0);
        crystalMaterial.opacity = c.opacity;
      }
      if (crystalSparkles) {
        crystalSparkles.uniforms.uTime.value = seconds;
        crystalSparkles.uniforms.uPixelRatio.value = view.pixelRatio;
        crystalSparkles.uniforms.uLevel.value = crystalSparkle(plan, t);
      }
      if (sweepMaterial) {
        sweepMaterial.uniforms.uReveal.value = sweepReveal(plan, t);
        sweepMaterial.uniforms.uShimmer.value = sweepShimmer(plan, t) ?? -10;
      }
      if (kitten) kitten.pose(kittenPose(plan, t));
      hearts.forEach((group, i) => {
        const h = twinHeartPose(plan, i as 0 | 1, t);
        group.position.set(h.x, h.y, h.z);
        group.rotation.set(0, h.yaw, h.roll);
      });
      if (glint) {
        const g = engraveGlint(plan, t);
        glint.intensity = g ? 4 * g.strength : 0;
        if (g) glint.position.set(g.x, 0.35, STAR_FACE_Z + 0.55);
      }
      const pulse = composedPulse(plan, t);
      ring.visible = pulse !== null;
      if (pulse) {
        ringMaterial.uniforms.uRadius.value = pulse.radius;
        ringMaterial.uniforms.uAlpha.value = pulse.alpha;
      }
    },
    dispose() {
      for (const geometry of new Set(geometries)) geometry.dispose();
      for (const material of new Set(materials)) material.dispose();
      root.clear();
    },
  };
}
