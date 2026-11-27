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
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Points,
  ShaderMaterial,
  TubeGeometry,
  Vector2,
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

/**
 * A small brilliant-cut diamond (the jewelry box's floating diamonds), the classic silhouette: a wide flat table, a
 * two-tier crown (star and bezel facets), a thin girdle and a deep pavilion to a point, sixteen facets round. Height 1
 * (it scales like a petal), widest 1. Non-indexed with one normal per facet, so every facet is one flat tone (crisp facet
 * contrast in the shader instead of a smooth pebble).
 */
export function diamondGeometry(segments = 16): BufferGeometry {
  const profile = [
    new Vector2(0, -0.6),
    new Vector2(0.5, 0.06),
    new Vector2(0.5, 0.1),
    new Vector2(0.43, 0.24),
    new Vector2(0.3, 0.38),
    new Vector2(0, 0.38),
  ];
  const lathe = new LatheGeometry(profile, segments);
  const geometry = lathe.toNonIndexed();
  lathe.dispose();
  geometry.computeVertexNormals();
  return geometry;
}

// The floating diamonds: an unlit, faceted "studio" look in the shader (cheap: no environment map, no transmission).
// Each flat facet takes a tone from where its reflection points (bright ceiling and softboxes, a dark floor, deep blue
// sides), a cool-violet dispersion tint that changes facet to facet, a white rim, sharp specular glints from two light
// directions and a per-diamond twinkle. So a diamond reads clear-white with cool/violet reflections and crisp contrast.
const DIAMOND_VERTEX = /* glsl */ `
attribute float aPhase;
varying vec3 vNormal;
varying vec3 vView;
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
  vView = normalize(cameraPosition - world.xyz);
  vPhase = aPhase;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const DIAMOND_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec3 vNormal;
varying vec3 vView;
varying float vPhase;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(vView);
  vec3 r = reflect(-v, n);
  float facing = max(dot(n, v), 0.0);
  // The studio: dark floor, deep blue sides, bright soft ceiling and two softboxes.
  float ceiling = smoothstep(-0.1, 0.8, r.y);
  float box1 = pow(max(dot(r, normalize(vec3(0.6, 0.7, 0.4))), 0.0), 18.0);
  float box2 = pow(max(dot(r, normalize(vec3(-0.7, 0.3, 0.6))), 0.0), 14.0);
  vec3 col = mix(vec3(0.04, 0.05, 0.16), vec3(0.3, 0.36, 0.68), smoothstep(-0.6, 0.2, r.y));
  col = mix(col, vec3(0.95, 0.97, 1.0), ceiling);
  col += vec3(1.0) * box1 * 2.0 + vec3(0.9, 0.85, 1.0) * box2 * 1.4;
  // Dispersion: a cool / violet / pale-gold tint that changes from facet to facet, and every few facets a bright one.
  float k = dot(n, vec3(12.9898, 78.233, 37.719));
  float h = fract(sin(k) * 43758.5453);
  vec3 fire = 0.5 + 0.5 * cos(6.2831 * (h + vec3(0.0, 0.33, 0.67)));
  col *= mix(vec3(1.0), mix(vec3(0.8, 0.86, 1.0), fire, 0.5), 0.3);
  col += vec3(0.95, 0.97, 1.0) * step(0.72, h) * 0.45;
  // White rim, and a twinkle: now and then one facet flashes.
  col += vec3(0.9, 0.93, 1.0) * pow(1.0 - facing, 3.0) * 0.6;
  float twinkle = pow(max(sin(uTime * 1.7 + vPhase + k * 0.01), 0.0), 24.0);
  col += vec3(1.0) * twinkle * smoothstep(0.6, 1.0, facing) * 1.4;
  gl_FragColor = vec4(col, 1.0);
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
  gl_FragColor = vec4(col, tex.a * uOpacity);
  #include <colorspace_fragment>
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
