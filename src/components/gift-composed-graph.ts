import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  FrontSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PlaneGeometry,
  PointLight,
  Points,
  ShaderMaterial,
  Shape,
  SphereGeometry,
  TorusGeometry,
  type Material,
  type Texture,
} from "three";
import { seededRandom } from "@/lib/gift-legendary-plan";
import {
  BADGE_PLANE,
  BOX_OPENING,
  COMPOSED_REST,
  FRAME_PLANE,
  STAR_FACE_Z,
  badgePose,
  boxGlow,
  composedLevels,
  composedObjectPose,
  composedPulse,
  framePose,
  lidAngle,
  sweepReveal,
  sweepShimmer,
  type ComposedScenePlan,
  type ComposedVariant,
} from "@/lib/gift-composed-plan";

// The three.js objects of the composed reveals (gift-scene-composed.tsx), built from the pure plan
// (src/lib/gift-composed-plan.ts) and posed by `update(t)`. No React here, so it can be built and disposed in a unit
// test (gift-composed-graph.test.ts). All geometry is procedural (no model file, nothing downloaded); the only texture
// is the gift's own icon, cut out of its backdrop by the scene (gift-art-cutout.ts), owned and disposed by the scene,
// as is the environment map (three's own procedural RoomEnvironment) that makes the metal read as metal.
//
// Layering: the objects use the depth buffer (the icon on the star sits on the star's face, the frame stands on the
// gem and is hidden by it while behind it); additive glows, sparkles, fireworks and rings are drawn after them, by
// renderOrder, without writing depth.

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
    alpha = step(0.0, k) * step(k, 1.0) * (1.0 - lag / 140.0);
    size *= 1.0 - lag / 200.0;
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

/** The five-point star of the earlier placeholder model (scripts/generate-gift-models.mjs), smoother bevels. */
export function starGeometry(): BufferGeometry {
  const s = new Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 1 : 0.45;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  const geometry = new ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.06, bevelSegments: 4 });
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  geometry.translate(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, -(box.min.z + box.max.z) / 2);
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

const GOLD = { color: "#f0ad38", metalness: 1, roughness: 0.25, clearcoat: 0.45, clearcoatRoughness: 0.12, envMapIntensity: 0.95 } as const;

export type ComposedView = { pixelRatio: number };

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
  "gem-sweep": { glow: "#3fd6c6", glow2: "#b26bff", sparkle: "#d9fbff", light: "#9fe8ff", ring: "#c8fff6" },
  "gem-frame": { glow: "#4fa3ff", glow2: "#ff7ad9", sparkle: "#e3f6ff", light: "#c58cff", ring: "#d8f3ff" },
};

export function buildComposedGraph(plan: ComposedScenePlan, assets: { art: Texture | null; envMap: Texture | null }): ComposedGraph {
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

  root.add(new AmbientLight(0xffffff, 0.35));
  const key = new DirectionalLight(0xfff4e0, 2.4);
  key.position.set(2.5, 3, 4);
  root.add(key);
  const rim = new DirectionalLight(0xffe2b0, 1.8);
  rim.position.set(-2.2, 1.6, -3);
  root.add(rim);
  const fill = new PointLight(new Color(look.light), 6, 0, 2);
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
  root.add(glow);

  // The object, in a group that carries its entrance and sway (everything placed on it is a child, so it follows).
  const object = new Group();
  root.add(object);
  const gold = () =>
    ownMaterial(
      new MeshPhysicalMaterial({
        ...GOLD,
        color: new Color(GOLD.color),
        emissive: new Color("#3a2000"),
        emissiveIntensity: 0.35,
        envMap: assets.envMap,
      }),
    );

  let lid: Group | null = null;
  let openingGlow: ShaderMaterial | null = null;
  let badge: Mesh | null = null;
  let badgeMaterial: MeshBasicMaterial | null = null;
  let frame: Mesh | null = null;
  let frameMaterial: MeshBasicMaterial | null = null;
  let sweepMaterial: ShaderMaterial | null = null;

  if (variant === "gold-heart") {
    const heart = new Mesh(ownGeometry(goldHeartGeometry()), gold());
    object.add(heart);
  } else if (variant === "star-badge") {
    const star = new Mesh(ownGeometry(starGeometry()), gold());
    object.add(star);
    if (assets.art) {
      badgeMaterial = ownMaterial(
        new MeshBasicMaterial({ map: assets.art, transparent: true, depthWrite: false, toneMapped: false, side: FrontSide, opacity: 0 }),
      );
      badge = new Mesh(ownGeometry(new PlaneGeometry(BADGE_PLANE.size, BADGE_PLANE.size)), badgeMaterial);
      badge.renderOrder = ORDER.art;
      object.add(badge);
    }
  } else if (variant === "gem-sweep" || variant === "gem-frame") {
    const { crown, pavilion } = gemGeometries();
    ownGeometry(crown);
    ownGeometry(pavilion);
    const gem = ownMaterial(
      new MeshPhysicalMaterial({
        color: new Color("#6a9fe8"),
        emissive: new Color("#0a1430"),
        metalness: 0.35,
        roughness: 0.1,
        clearcoat: 1,
        clearcoatRoughness: 0.06,
        iridescence: 1,
        iridescenceIOR: 1.9,
        iridescenceThicknessMaximum: 560,
        flatShading: true,
        envMap: assets.envMap,
        envMapIntensity: 0.5,
      }),
    );
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
  } else {
    // The gift box: an open body (no top face, inside walls visible), ribbon strips on its sides, and the lid with its
    // ribbon and bow on a hinge along the back top edge.
    const paper = ownMaterial(
      new MeshPhysicalMaterial({ color: new Color("#6a3be0"), roughness: 0.55, clearcoat: 0.15, clearcoatRoughness: 0.4, envMap: assets.envMap, envMapIntensity: 0.3, side: DoubleSide }),
    );
    const hidden = ownMaterial(new MeshBasicMaterial({ visible: false }));
    const ribbon = ownMaterial(
      new MeshPhysicalMaterial({ color: new Color("#f2c14e"), metalness: 0.85, roughness: 0.28, envMap: assets.envMap, envMapIntensity: 1.2 }),
    );
    const body = new Mesh(ownGeometry(new BoxGeometry(1.3, 1.0, 1.3)), [paper, paper, hidden, paper, paper, paper]);
    body.position.y = -0.2;
    object.add(body);
    for (const [w, d, x, z] of [
      [0.22, 0.02, 0, 0.655],
      [0.22, 0.02, 0, -0.655],
      [0.02, 0.22, 0.655, 0],
      [0.02, 0.22, -0.655, 0],
    ] as const) {
      const strip = new Mesh(ownGeometry(new BoxGeometry(w, 1.0, d)), ribbon);
      strip.position.set(x, -0.2, z);
      object.add(strip);
    }
    // The light inside the open box.
    const [openingGeometry, openingMaterial] = own(
      new PlaneGeometry(1.25, 1.25),
      additive({ uColor: { value: new Color("#ffd8a0") }, uColor2: { value: new Color("#ff9ad0") }, uLevel: { value: 0 } }, GLOW_FRAGMENT),
    );
    openingGlow = openingMaterial;
    const opening = new Mesh(openingGeometry, openingMaterial);
    opening.rotation.x = -Math.PI / 2;
    opening.position.y = BOX_OPENING.y - 0.02;
    opening.renderOrder = ORDER.sparkles;
    object.add(opening);

    lid = new Group();
    lid.position.set(0, 0.3, -0.71);
    const lidBox = new Mesh(ownGeometry(new BoxGeometry(1.42, 0.25, 1.42)), paper);
    lidBox.position.set(0, 0.125, 0.71);
    const bandA = new Mesh(ownGeometry(new BoxGeometry(0.24, 0.27, 1.44)), ribbon);
    bandA.position.set(0, 0.125, 0.71);
    const bandB = new Mesh(ownGeometry(new BoxGeometry(1.44, 0.27, 0.24)), ribbon);
    bandB.position.set(0, 0.125, 0.71);
    const loopGeometry = ownGeometry(new TorusGeometry(0.22, 0.07, 12, 32));
    const loopL = new Mesh(loopGeometry, ribbon);
    loopL.position.set(-0.2, 0.42, 0.71);
    loopL.rotation.set(0, Math.PI / 2, Math.PI / 4);
    const loopR = new Mesh(loopGeometry, ribbon);
    loopR.position.set(0.2, 0.42, 0.71);
    loopR.rotation.set(0, Math.PI / 2, -Math.PI / 4);
    lid.add(lidBox, bandA, bandB, loopL, loopR);
    object.add(lid);
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
      for (let lag = 0; lag <= 120; lag += 20) push(start, burst, lag === 0 ? core : color, [fw.launchMs, fw.burstMs, lag, 0], lag === 0 ? 16 : 11);
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

  // The landing pulse: on the star's face, lying on the gem's table under the frame, round the heart.
  const [ringGeometry, ringMaterial] = own(
    new PlaneGeometry(2, 2),
    additive({ uColor: { value: new Color(look.ring) }, uRadius: { value: 0 }, uAlpha: { value: 0 } }, RING_FRAGMENT),
  );
  const ring = new Mesh(ringGeometry, ringMaterial);
  ring.renderOrder = ORDER.ring;
  ring.visible = false;
  if (variant === "gem-frame") {
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.5, 0);
    ring.scale.setScalar(0.75);
  } else if (variant === "star-badge") {
    ring.position.set(0, BADGE_PLANE.y, STAR_FACE_Z + 0.02);
    ring.scale.setScalar(1.05);
  } else {
    ring.position.set(0, 0, 0.1);
    ring.scale.setScalar(1.2);
  }
  object.add(ring);

  return {
    root,
    update(t, view) {
      const seconds = t / 1000;
      const pose = composedObjectPose(plan, t);
      object.position.y = pose.y;
      object.scale.setScalar(pose.scale);
      object.rotation.set(pose.pitch, pose.yaw, 0);
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
      if (sweepMaterial) {
        sweepMaterial.uniforms.uReveal.value = sweepReveal(plan, t);
        sweepMaterial.uniforms.uShimmer.value = sweepShimmer(plan, t) ?? -10;
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
