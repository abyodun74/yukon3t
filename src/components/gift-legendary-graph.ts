import {
  AdditiveBlending,
  AmbientLight,
  BufferGeometry,
  Color,
  Curve,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Points,
  ShaderMaterial,
  TubeGeometry,
  Vector3,
  type Material,
  type PerspectiveCamera,
  type Texture,
} from "three";
import {
  legendaryCameraPose,
  legendaryLevels,
  legendaryPetalPose,
  legendaryPulse,
  legendarySweep,
  type LegendaryRibbon,
  type LegendaryScenePlan,
  type PetalSpec,
  type SparkleSpec,
} from "@/lib/gift-legendary-plan";

// The three.js objects of the legendary scene (gift-scene-legendary.tsx), built from its pure plan
// (src/lib/gift-legendary-plan.ts) and posed by `update(t)`. No React here, so it can be built and disposed in a unit
// test. Everything is cheap: one textured plane, two instanced petal meshes, two point clouds, one tube drawn twice,
// two quads (glow, pulse ring), three lights. Shaders are tiny and unlit except the petals (MeshStandardMaterial).
//
// Depth without a depth buffer fight: the picture sits at z = 0 and never moves (the camera sways around it), so each
// layer is either behind it (drawn first) or in front of it (drawn after), by renderOrder. The picture itself is drawn
// with depthTest off, over whatever is behind it; it is opaque in the middle and fades out at the edges, where the
// layers behind it show through. Petals are flagged transparent (opacity 1) so they sort with the rest by renderOrder.

const ORDER = { glow: -4, backSparkles: -3, backRibbon: -3, backPetals: -2, art: 0, frontPetals: 2, frontRibbon: 3, frontSparkles: 3, ring: 4 };

/** A curved, cupped petal: a grid along its length (base to rounded tip) and across, bent into a shallow bowl. Length 1. */
export function petalGeometry(lengthSegments = 6, widthSegments = 4): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= lengthSegments; i++) {
    const u = i / lengthSegments;
    const halfWidth = 0.4 * Math.sin(Math.PI * Math.pow(0.06 + 0.86 * u, 0.8)) + 0.015;
    for (let j = 0; j <= widthSegments; j++) {
      const v = (j / widthSegments) * 2 - 1;
      positions.push(v * halfWidth, u - 0.5, 0.45 * v * v * halfWidth + 0.14 * u * u);
      uvs.push(j / widthSegments, u);
    }
  }
  const row = widthSegments + 1;
  for (let i = 0; i < lengthSegments; i++) {
    for (let j = 0; j < widthSegments; j++) {
      const a = i * row + j;
      indices.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** A round brilliant's proportions (diameter 1): table, crown and pavilion as a jeweller would cut them. */
export const BRILLIANT = { radius: 0.5, table: 0.28, star: 0.39, crown: 0.16, girdle: 0.03, pavilion: 0.43, lowerGirdle: 0.78 } as const;

/**
 * A small round brilliant (the jewelry box's floating diamonds), cut facet by facet like the real thing: an octagonal
 * table, 8 star facets, 8 kite (bezel) facets and 16 upper girdle facets on the crown, a thin girdle, and on the
 * pavilion 8 long main facets and 16 lower girdle facets meeting at the culet. Diameter 1, about 0.62 high, centred.
 * Non-indexed, every facet one flat normal, and each vertex carries `aEdge` (barycentric, with the diagonals inside a
 * kite or the table hidden), so the shader can draw the facet outlines: the brilliant's pattern reads at any angle.
 */
export function diamondGeometry(): BufferGeometry {
  const B = BRILLIANT;
  const positions: number[] = [];
  const normals: number[] = [];
  const edges: number[] = [];
  const top = B.crown;
  const girdleTop = 0;
  const girdleBottom = -B.girdle;
  const culetY = girdleBottom - B.pavilion;
  const at = (r: number, angle: number, y: number) => new Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r);
  const step = Math.PI / 4;
  const T = (k: number) => at(B.table, k * step, top);
  const S = (k: number) => at(B.star, (k + 0.5) * step, top * ((B.radius - B.star) / (B.radius - B.table)));
  const G = (angle: number, y: number) => at(B.radius, angle, y);
  const P = (k: number) => at(B.radius * (1 - B.lowerGirdle), (k + 0.5) * step, girdleBottom - B.pavilion * B.lowerGirdle);
  const culet = new Vector3(0, culetY, 0);
  const centre = new Vector3(0, (top + culetY) / 2, 0);
  const facet = (points: Vector3[]) => {
    // Newell's normal, turned to face out of the stone; then a fan, the fan's inner diagonals hidden.
    const n = new Vector3();
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      n.x += (a.y - b.y) * (a.z + b.z);
      n.y += (a.z - b.z) * (a.x + b.x);
      n.z += (a.x - b.x) * (a.y + b.y);
    }
    n.normalize();
    const mid = points.reduce((acc, p) => acc.add(p), new Vector3()).multiplyScalar(1 / points.length);
    const outward = n.dot(mid.clone().sub(centre)) >= 0;
    const ordered = outward ? points : [...points].reverse();
    if (!outward) n.negate();
    for (let i = 1; i < ordered.length - 1; i++) {
      const tri = [ordered[0], ordered[i], ordered[i + 1]];
      // Edge opposite vertex 0 is always a facet edge; v0-v(i) is one only for the first triangle, v(i+1)-v0 only for the last.
      const hideAB = i > 1 ? 1 : 0;
      const hideCA = i + 1 < ordered.length - 1 ? 1 : 0;
      const bary = [
        [1, 0 + hideCA, 0 + hideAB],
        [0, 1 + hideCA, 0 + hideAB],
        [0, 0 + hideCA, 1 + hideAB],
      ];
      tri.forEach((p, j) => {
        positions.push(p.x, p.y, p.z);
        normals.push(n.x, n.y, n.z);
        edges.push(...bary[j]);
      });
    }
  };
  facet(Array.from({ length: 8 }, (_, k) => T(k)));
  for (let k = 0; k < 8; k++) {
    const a = k * step;
    const h = (k + 0.5) * step;
    facet([T(k), T(k + 1), S(k)]);
    facet([T(k), S(k), G(a, girdleTop), S(k - 1)]);
    facet([S(k), G(a, girdleTop), G(h, girdleTop)]);
    facet([S(k), G(h, girdleTop), G(a + step, girdleTop)]);
    for (const [from, to] of [
      [a, h],
      [h, a + step],
    ]) {
      facet([G(from, girdleTop), G(to, girdleTop), G(to, girdleBottom), G(from, girdleBottom)]);
    }
    facet([G(a, girdleBottom), G(h, girdleBottom), P(k)]);
    facet([G(h, girdleBottom), G(a + step, girdleBottom), P(k)]);
    facet([G(a, girdleBottom), P(k), culet, P(k - 1)]);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("aEdge", new Float32BufferAttribute(edges, 3));
  geometry.translate(0, -(top + culetY) / 2, 0);
  return geometry;
}

// The floating diamonds: an unlit, faceted look in the shader (cheap: no environment map, no transmission), made to
// read as a 3D diamond at phone size, not a white disc. A real diamond is a mosaic of bright and dark facets (it
// reflects a bright room through itself), so each flat facet takes its tone from a "kaleidoscope" studio of bright and
// dark sectors that neighbouring facets see differently and that changes as the stone turns (the sparkle); on top of
// that the cut itself sets the contrast: the table and crown are mostly bright (white with a little fire), the
// pavilion's facets alternate between deep blue-black and bright white round the stone, so its pointed silhouette and
// the classic dark "arrows" read even when the stone is only a few px tall. Facet edges are only a faint line (at phone
// size full-strength lines filled the whole stone with white), plus a cool rim and a per-diamond twinkle.
const DIAMOND_VERTEX = /* glsl */ `
attribute float aPhase;
attribute vec3 aEdge;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vEdge;
varying vec3 vLocal;
varying float vPhase;
void main() {
  vec4 local = vec4(position, 1.0);
  mat4 model = modelMatrix;
  #ifdef USE_INSTANCING
    local = instanceMatrix * local;
    model = modelMatrix * instanceMatrix;
  #endif
  vec4 world = modelMatrix * local;
  vNormal = normalize(mat3(model) * normal);
  vLocal = normal;
  vView = normalize(cameraPosition - world.xyz);
  vEdge = aEdge;
  vPhase = aPhase;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const DIAMOND_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vEdge;
varying vec3 vLocal;
varying float vPhase;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(vView);
  vec3 r = reflect(-v, n);
  float facing = max(dot(n, v), 0.0);
  float az = atan(r.z, r.x);
  float sectors = smoothstep(0.3, 0.7, 0.5 + 0.5 * sin(az * 5.0 + r.y * 4.0 + vPhase));
  float bands = smoothstep(0.15, 0.85, 0.5 + 0.5 * sin(r.y * 6.0 - 0.6 + vPhase * 0.5));
  float studio = sectors * (0.5 + 0.5 * bands);
  // Where the facet is on the cut (its own normal, before the stone turns).
  float up = vLocal.y;
  float around = atan(vLocal.z, vLocal.x);
  // Pavilion: of each eighth of the stone (a main facet and its two lower girdle facets), one lower girdle facet is
  // bright and the other two dark, so dark and bright alternate all round the pointed half.
  float alternate = step(0.5, fract(around * 1.273240));
  // (Tones are linear light: 0.06 is already a mid-dark grey on screen.)
  float pavilion = alternate > 0.5 ? mix(0.45, 1.0, studio) : mix(0.0, 0.05, studio);
  // Crown and table: bright, with the studio's sectors darkening some kites.
  float crown = 0.06 + 0.94 * studio * studio;
  float table = 0.4 + 0.6 * bands;
  float tone = up > 0.97 ? table : up > 0.02 ? crown : up < -0.02 ? pavilion : 0.55;
  float k = dot(n, vec3(12.9898, 78.233, 37.719));
  float h = fract(sin(k) * 43758.5453);
  vec3 fire = 0.5 + 0.5 * cos(6.2831 * (h + vec3(0.0, 0.33, 0.67)));
  vec3 white = vec3(1.0, 0.97, 0.95);
  vec3 dark = vec3(0.03, 0.05, 0.16);
  vec3 col = mix(dark, mix(white, fire, 0.22), tone);
  vec3 width = fwidth(vEdge) * 1.1;
  vec3 line = smoothstep(vec3(0.0), width, vEdge);
  float edge = 1.0 - min(min(line.x, line.y), line.z);
  col = mix(col, vec3(0.95, 0.97, 1.0), edge * 0.22);
  col += vec3(0.7, 0.8, 1.0) * pow(1.0 - facing, 3.0) * 0.1;
  float twinkle = pow(max(sin(uTime * 1.7 + vPhase + k * 0.01), 0.0), 24.0);
  col += vec3(1.0) * twinkle * smoothstep(0.6, 1.0, facing) * 0.9;
  gl_FragColor = vec4(min(col, vec3(1.4)), 1.0);
  #include <colorspace_fragment>
}`;

class HelixCurve extends Curve<Vector3> {
  constructor(private readonly ribbon: LegendaryRibbon) {
    super();
  }
  override getPoint(t: number, target = new Vector3()): Vector3 {
    const r = this.ribbon;
    const angle = t * r.turns * Math.PI * 2;
    const radius = r.radius * (0.85 + 0.15 * t);
    return target.set(Math.cos(angle) * radius, r.bottom + (r.top - r.bottom) * t + 0.03 * Math.sin(angle * 2), Math.sin(angle) * r.depth);
  }
}

const VERTEX_UV = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ART_FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform float uOpacity;
uniform float uSweep;
uniform vec3 uSweepColor;
uniform float uSweepStrength;
varying vec2 vUv;
void main() {
  vec4 tex = texture2D(map, vUv);
  float lum = dot(tex.rgb, vec3(0.2126, 0.7152, 0.0722));
  float d = vUv.x + (1.0 - vUv.y) * 0.6 - uSweep;
  float band = exp(-d * d / 0.012);
  vec3 col = tex.rgb + uSweepColor * band * smoothstep(0.18, 0.7, lum) * uSweepStrength;
  #ifdef EDGE_BLEND
    // The picture's edges dissolve into the scene instead of ending as a card: its dark backdrop fades out over the
    // outer third (a rounded-square falloff), while the light painted in it (the gold rings, the sparkles) carries on
    // to the very edge and is added like light, so the rings thin out into the scene's glow rather than stopping at a
    // border. Premultiplied output (the material blends ONE, ONE_MINUS_SRC_ALPHA). Nothing in the middle changes.
    vec2 p = abs(vUv - 0.5) * 2.0;
    float edge = pow(pow(p.x, 4.0) + pow(p.y, 4.0), 0.25);
    float backdrop = 1.0 - smoothstep(0.62, 0.97, edge);
    float light = 1.0 - smoothstep(0.84, 1.0, edge);
    float bright = smoothstep(0.16, 0.5, lum);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
    float a = tex.a * uOpacity;
    gl_FragColor = vec4(gl_FragColor.rgb * a * mix(backdrop, light, bright), a * backdrop);
  #else
    gl_FragColor = vec4(col, tex.a * uOpacity);
    #include <colorspace_fragment>
  #endif
}`;

const GLOW_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uLevel;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 1.8) * uLevel * 0.9;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;

const RING_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uRadius;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float x = (r - uRadius) / 0.035;
  float ring = exp(-x * x) + 0.18 * (1.0 - smoothstep(0.0, uRadius, r));
  float a = ring * uAlpha;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;

const RIBBON_VERTEX = /* glsl */ `
varying vec2 vUv;
varying float vWorldZ;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldZ = world.z;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const RIBBON_FRAGMENT = /* glsl */ `
uniform vec3 uFrom;
uniform vec3 uTo;
uniform float uLevel;
uniform float uTime;
uniform float uSide;
varying vec2 vUv;
varying float vWorldZ;
void main() {
  if (vWorldZ * uSide < 0.0) discard;
  float u = vUv.x;
  float ends = pow(sin(3.14159265 * u), 1.4);
  float flow = 0.55 + 0.45 * sin(u * 26.0 - uTime * 2.2);
  gl_FragColor = vec4(mix(uFrom, uTo, u), ends * flow * uLevel * 0.9);
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
  p.y += 0.03 * sin(uTime * 0.3 + aPhase);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPixelRatio * (4.0 / max(0.5, -mv.z));
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

function sparkleCloud(specs: SparkleSpec[], material: ShaderMaterial): Points {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(specs.flatMap((s) => [s.x, s.y, s.z]), 3));
  geometry.setAttribute("aSize", new Float32BufferAttribute(specs.map((s) => s.size), 1));
  geometry.setAttribute("aPhase", new Float32BufferAttribute(specs.map((s) => s.phase), 1));
  geometry.setAttribute("aRate", new Float32BufferAttribute(specs.map((s) => s.rate), 1));
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

export type LegendaryView = {
  camera: PerspectiveCamera;
  /** The camera distance at which the 1 x 1 picture is exactly the stage poster's size. */
  baseDistance: number;
  pixelRatio: number;
  /** Pulse start times (ms). */
  pulses: readonly number[];
};

export type LegendaryGraph = {
  root: Group;
  update: (t: number, view: LegendaryView) => void;
  /** Disposes every geometry and material it created (not the texture: its owner disposes that). */
  dispose: () => void;
};

export function buildLegendaryGraph(plan: LegendaryScenePlan, texture: Texture, aspect = 1): LegendaryGraph {
  const look = plan.look;
  const root = new Group();
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const own = <G extends BufferGeometry, M extends Material>(geometry: G, material: M) => {
    geometries.push(geometry);
    materials.push(material);
    return [geometry, material] as const;
  };

  root.add(new AmbientLight(0xffffff, 0.7));
  const key = new DirectionalLight(0xffffff, 2.2);
  key.position.set(1.5, 2.5, 3);
  root.add(key);
  const warm = new PointLight(new Color(look.glowColor), 3, 0, 2);
  warm.position.set(0, -0.15, 1.1);
  root.add(warm);

  // The soft glow behind the picture (seen around and through its faded edges).
  const [glowGeometry, glowMaterial] = own(new PlaneGeometry(2.2, 2.2), additive({ uColor: { value: new Color(look.glowColor) }, uLevel: { value: 0 } }, GLOW_FRAGMENT));
  const glow = new Mesh(glowGeometry, glowMaterial);
  glow.position.set(0, 0.04, -0.3);
  glow.renderOrder = ORDER.glow;
  root.add(glow);

  // The artwork.
  const [artGeometry, artMaterial] = own(
    new PlaneGeometry(1, 1),
    new ShaderMaterial({
      uniforms: {
        map: { value: texture },
        uOpacity: { value: 0 },
        uSweep: { value: -10 },
        uSweepColor: { value: new Color(look.sweepColor) },
        uSweepStrength: { value: look.sweepStrength },
      },
      vertexShader: VERTEX_UV,
      fragmentShader: ART_FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      ...(look.edgeBlend ? { defines: { EDGE_BLEND: "" }, premultipliedAlpha: true } : {}),
    }),
  );
  const art = new Mesh(artGeometry, artMaterial);
  // The picture keeps its own aspect (height / width; the jewelry box is wider than tall), as the poster draws it.
  art.scale.y = aspect;
  art.renderOrder = ORDER.art;
  root.add(art);

  // Petals (or, for the jewelry box, small diamonds), behind and in front of the picture.
  const [petalGeo, petalMaterial] = own(
    look.particle === "diamond" ? diamondGeometry() : petalGeometry(),
    look.particle === "diamond"
      ? new ShaderMaterial({
          uniforms: { uTime: { value: 0 } },
          vertexShader: DIAMOND_VERTEX,
          fragmentShader: DIAMOND_FRAGMENT,
          transparent: true,
          toneMapped: false,
        })
      : new MeshStandardMaterial({
          color: new Color(look.petalColor),
          emissive: new Color(look.petalEmissive),
          emissiveIntensity: 1,
          metalness: look.petalMetalness,
          roughness: look.petalRoughness,
          side: DoubleSide,
          transparent: true,
        }),
  );
  const petalSets = (["back", "front"] as const).map((side) => {
    const specs = plan.petals.filter((p) => p.side === side);
    // Diamonds carry a per-instance twinkle phase, so each set gets its own copy of the geometry for that attribute.
    let geometry = petalGeo;
    if (look.particle === "diamond") {
      geometry = petalGeo.clone();
      geometries.push(geometry);
      const phases = new Float32Array(Math.max(1, specs.length));
      specs.forEach((s, i) => (phases[i] = s.swayPhase * 3.7));
      geometry.setAttribute("aPhase", new InstancedBufferAttribute(phases, 1));
    }
    const mesh = new InstancedMesh(geometry, petalMaterial, Math.max(1, specs.length));
    mesh.count = specs.length;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = side === "back" ? ORDER.backPetals : ORDER.frontPetals;
    root.add(mesh);
    return { mesh, specs };
  });

  // Sparkles.
  const sparkleMaterial = additive(
    { uColor: { value: new Color(look.sparkleColor) }, uTime: { value: 0 }, uPixelRatio: { value: 1 }, uLevel: { value: 0 } },
    SPARKLE_FRAGMENT,
    SPARKLE_VERTEX,
  );
  materials.push(sparkleMaterial);
  for (const side of ["back", "front"] as const) {
    const cloud = sparkleCloud(plan.sparkles.filter((s) => s.side === side), sparkleMaterial);
    geometries.push(cloud.geometry);
    cloud.renderOrder = side === "back" ? ORDER.backSparkles : ORDER.frontSparkles;
    root.add(cloud);
  }

  // The glow ribbon orbiting the flower: one tube, drawn twice (the half behind the picture, then the half in front).
  const ribbonGroup = new Group();
  const ribbonGeometry = new TubeGeometry(new HelixCurve(plan.ribbon), plan.ribbon.tubularSegments, plan.ribbon.thickness, plan.ribbon.radialSegments, false);
  geometries.push(ribbonGeometry);
  const ribbonMaterials = ([-1, 1] as const).map((side) => {
    const material = additive(
      {
        uFrom: { value: new Color(look.ribbonFrom) },
        uTo: { value: new Color(look.ribbonTo) },
        uLevel: { value: 0 },
        uTime: { value: 0 },
        uSide: { value: side },
      },
      RIBBON_FRAGMENT,
      RIBBON_VERTEX,
    );
    materials.push(material);
    const mesh = new Mesh(ribbonGeometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = side < 0 ? ORDER.backRibbon : ORDER.frontRibbon;
    ribbonGroup.add(mesh);
    return material;
  });
  root.add(ribbonGroup);

  // The light pulse ring on the floor disc at the base.
  const [ringGeometry, ringMaterial] = own(
    new PlaneGeometry(2, 2),
    additive({ uColor: { value: new Color(look.ringColor) }, uRadius: { value: 0 }, uAlpha: { value: 0 } }, RING_FRAGMENT),
  );
  const ring = new Mesh(ringGeometry, ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, look.baseY, 0.02);
  ring.renderOrder = ORDER.ring;
  ring.visible = false;
  root.add(ring);

  const dummy = new Object3D();
  // A diamond turns about its own axis first (y), then leans sideways (z), then tips its table towards the camera (x).
  if (look.particle === "diamond") dummy.rotation.order = "XZY";
  const placePetals = (specs: PetalSpec[], mesh: InstancedMesh, t: number, level: number) => {
    specs.forEach((spec, i) => {
      const pose = legendaryPetalPose(plan, spec, t, level);
      dummy.position.set(pose.x, pose.y, pose.z);
      dummy.rotation.set(pose.rx, pose.ry, pose.rz);
      dummy.scale.setScalar(Math.max(pose.scale, 1e-5));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };

  return {
    root,
    update(t, view) {
      const seconds = t / 1000;
      const levels = legendaryLevels(plan, t);
      const pose = legendaryCameraPose(plan, t);
      const distance = view.baseDistance * pose.distance;
      view.camera.position.set(
        distance * Math.sin(pose.yaw) * Math.cos(pose.pitch),
        distance * Math.sin(pose.pitch),
        distance * Math.cos(pose.yaw) * Math.cos(pose.pitch),
      );
      view.camera.lookAt(0, 0, 0);

      artMaterial.uniforms.uOpacity.value = levels.art;
      artMaterial.uniforms.uSweep.value = legendarySweep(plan, t) ?? -10;
      glowMaterial.uniforms.uLevel.value = levels.glow;
      for (const { mesh, specs } of petalSets) {
        placePetals(specs, mesh, t, levels.petals);
        mesh.visible = levels.petals > 0;
      }
      sparkleMaterial.uniforms.uTime.value = seconds;
      if (petalMaterial instanceof ShaderMaterial) petalMaterial.uniforms.uTime.value = seconds;
      sparkleMaterial.uniforms.uPixelRatio.value = view.pixelRatio;
      sparkleMaterial.uniforms.uLevel.value = levels.sparkles;
      ribbonGroup.rotation.y = seconds * look.ribbonSpin;
      ribbonGroup.visible = levels.ribbon > 0;
      for (const material of ribbonMaterials) {
        material.uniforms.uLevel.value = levels.ribbon;
        material.uniforms.uTime.value = seconds;
      }
      const pulse = legendaryPulse(plan, view.pulses, t);
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
