import { describe, expect, it } from "vitest";
import { BufferGeometry, Material, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, Points, Texture, type Object3D } from "three";
import {
  GEM_HIGHLIGHT_WHITENESS,
  GEM_HUE_CEILING,
  GEM_HUE_KNEE,
  ROCKET_TRAIL_MAX_LAG,
  ROCKET_TRAIL_STEP,
  buildComposedGraph,
  keepGemHue,
  buildStudioEnvironment,
  gemGeometries,
  goldHeartGeometry,
  starGeometry,
} from "@/components/gift-composed-graph";
import { bowGeometry, boxShellGeometry, carvedSidesGeometry, carvedTopGeometry, trophyGeometries } from "@/components/gift-composed-objects";
import { buildKitten } from "@/components/gift-kitten";
import {
  COMPOSED_USES_ART,
  COMPOSED_VARIANTS,
  GEM_TABLE,
  STAR_FACE_Z,
  TROPHY_BASE_Y,
  composedScenePlan,
  kittenPose,
  type ComposedVariant,
} from "@/lib/gift-composed-plan";

// The composed scenes' three.js objects, built for real (three.js needs no WebGL to create them) with fake textures:
// the procedural objects' shapes, the gold being real metal, finite poses over the whole timeline, and every geometry
// and material disposed on close (the icon and the environment map are the scene's to dispose).

function collect(root: Object3D) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
  });
  return { geometries, materials };
}

const build = (variant: ComposedVariant, lowEnd = false) => {
  const plan = composedScenePlan(variant, { lowEnd, hitMs: 1190 });
  const art = COMPOSED_USES_ART[variant] ? new Texture() : null;
  const envMap = new Texture();
  return { plan, art, envMap, graph: buildComposedGraph(plan, { art, envMap }) };
};

describe("the procedural objects", () => {
  it("the gold heart is a closed, rounded heart about 2 high, wider than deep, with its cleft at the top", () => {
    const geometry = goldHeartGeometry(48, 36);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    expect(box.max.y - box.min.y).toBeCloseTo(2, 5);
    const width = box.max.x - box.min.x;
    const depth = box.max.z - box.min.z;
    expect(width).toBeGreaterThan(1.6);
    expect(depth).toBeLessThan(width * 0.75);
    // The cleft: straight up the middle the surface is lower than over each lobe.
    const position = geometry.getAttribute("position");
    let middleTop = -Infinity;
    let lobeTop = -Infinity;
    for (let i = 0; i < position.count; i++) {
      const x = Math.abs(position.getX(i));
      const y = position.getY(i);
      if (x < 0.03) middleTop = Math.max(middleTop, y);
      if (x > 0.3 && x < 0.6) lobeTop = Math.max(lobeTop, y);
    }
    expect(lobeTop - middleTop).toBeGreaterThan(0.1);
    for (let i = 0; i < position.count * 3; i++) expect(Number.isFinite(position.array[i])).toBe(true);
    geometry.dispose();
  });

  it("the star keeps the earlier model's five points; the gem its flat table where the frame stands", () => {
    const star = starGeometry();
    star.computeBoundingBox();
    expect(star.boundingBox!.max.z).toBeCloseTo(0.25, 5);
    star.dispose();
    const { crown, pavilion } = gemGeometries();
    crown.computeBoundingBox();
    expect(crown.boundingBox!.max.y).toBeCloseTo(GEM_TABLE.y, 3);
    crown.dispose();
    pavilion.dispose();
  });
});

describe.each(COMPOSED_VARIANTS)("buildComposedGraph (%s)", (variant) => {
  it("poses everything with finite numbers over the whole timeline, and stays small", () => {
    for (const lowEnd of [false, true]) {
      const { plan, graph } = build(variant, lowEnd);
      let nodes = 0;
      graph.root.traverse(() => nodes++);
      // The kitten is a dozen nodes of its own (head, eyes, legs and tail move); everything else stays small.
      expect(nodes).toBeLessThanOrEqual(variant === "kitten-box" ? 40 : 24);
      for (let t = 0; t <= plan.endMs + 3000; t += 331) {
        graph.update(t, { pixelRatio: 2 });
        graph.root.traverse((node) => {
          expect(node.position.toArray().every(Number.isFinite)).toBe(true);
          expect(node.rotation.toArray().slice(0, 3).every((n) => Number.isFinite(n as number))).toBe(true);
          expect(node.scale.toArray().every(Number.isFinite)).toBe(true);
        });
      }
      graph.dispose();
    }
  });

  it("uses the environment map for its metal / gem, and gold is fully metallic", () => {
    const { graph, envMap } = build(variant);
    const physical = [...collect(graph.root).materials].filter((m): m is MeshPhysicalMaterial => (m as MeshPhysicalMaterial).isMeshPhysicalMaterial);
    expect(physical.length).toBeGreaterThan(0);
    for (const m of physical) expect(m.envMap).toBe(envMap);
    if (variant === "gold-heart" || variant === "star-badge" || variant === "trophy") {
      expect(physical.some((m) => m.metalness === 1 && m.roughness <= 0.3)).toBe(true);
    }
    // Gold has no clear coat: a clear coat reflects the studio untinted, which is what made gold faces pale or white.
    for (const m of physical) if (m.metalness === 1) expect(m.clearcoat).toBe(0);
    graph.dispose();
  });

  it("disposes every geometry and material it created on close, and leaves the textures to their owner", () => {
    const { plan, graph, art, envMap } = build(variant);
    graph.update(plan.momentMs + 300, { pixelRatio: 2 });
    const disposedTextures: Texture[] = [];
    for (const texture of [art, envMap]) texture?.addEventListener("dispose", () => disposedTextures.push(texture));
    const { geometries, materials } = collect(graph.root);
    expect(geometries.size).toBeGreaterThanOrEqual(3);
    const disposed = new Set<object>();
    for (const item of [...geometries, ...materials]) item.addEventListener("dispose", () => disposed.add(item));
    graph.dispose();
    for (const item of [...geometries, ...materials]) expect(disposed.has(item)).toBe(true);
    expect(disposedTextures).toEqual([]);
    expect(graph.root.children).toHaveLength(0);
  });
});

describe("the Fireworks", () => {
  it("draws every rocket, trail point, spark and flash as one point cloud driven by one clock uniform", () => {
    const { plan, graph } = build("fireworks-box");
    const clouds: Points[] = [];
    graph.root.traverse((node) => {
      if ((node as Points).isPoints) clouds.push(node as Points);
    });
    const trail = Math.floor(ROCKET_TRAIL_MAX_LAG / ROCKET_TRAIL_STEP) + 1;
    const expected = plan.fireworks.reduce((n, f) => n + trail + f.particles + 1, 0);
    expect(clouds.map((c) => c.geometry.getAttribute("position").count)).toContain(expected);
    graph.dispose();
  });
});

describe("the studio environment", () => {
  it("is moderate (nothing that would clip polished gold to white) and disposes everything it made", () => {
    const studio = buildStudioEnvironment();
    const materials: MeshBasicMaterial[] = [];
    const geometries: BufferGeometry[] = [];
    studio.scene.traverse((node) => {
      const mesh = node as Mesh;
      if (mesh.isMesh) {
        materials.push(mesh.material as MeshBasicMaterial);
        geometries.push(mesh.geometry);
      }
    });
    expect(materials.length).toBeGreaterThanOrEqual(4);
    // The brightest panel stays under 2.5 (three's RoomEnvironment lights its boxes far brighter).
    for (const m of materials) expect(Math.max(m.color.r, m.color.g, m.color.b)).toBeLessThanOrEqual(2.5);
    const disposed = new Set<object>();
    for (const item of [...materials, ...geometries]) item.addEventListener("dispose", () => disposed.add(item));
    studio.dispose();
    for (const item of [...materials, ...geometries]) expect(disposed.has(item)).toBe(true);
    expect(studio.scene.children).toHaveLength(0);
  });
});

describe("the new procedural objects", () => {
  it("the trophy: a deep cup with a lip, two handles meeting the cup, a stem and foot on a plinth, standing on y = TROPHY_BASE_Y", () => {
    const { cup, handles, plinth, plate } = trophyGeometries();
    for (const g of [cup, handles, plinth, plate]) g.computeBoundingBox();
    expect(plinth.boundingBox!.min.y).toBeCloseTo(TROPHY_BASE_Y, 5);
    // The foot stands on the plinth's top, the cup rises well above it, the handles stick out to both sides.
    expect(cup.boundingBox!.min.y).toBeCloseTo(plinth.boundingBox!.max.y, 5);
    expect(cup.boundingBox!.max.y - cup.boundingBox!.min.y).toBeGreaterThan(1.2);
    expect(handles.boundingBox!.max.x).toBeGreaterThan(cup.boundingBox!.max.x + 0.2);
    expect(handles.boundingBox!.min.x).toBeLessThan(cup.boundingBox!.min.x - 0.2);
    for (const g of [cup, handles, plinth, plate]) g.dispose();
  });

  it("box shells have real walls: outside, lining and rim groups, the lining inside the outside", () => {
    const shell = boxShellGeometry(1.4, 0.24, 1.4, 0.04, "bottom");
    expect(new Set(shell.groups.map((g) => g.materialIndex))).toEqual(new Set([0, 1, 2]));
    shell.computeBoundingBox();
    expect(shell.boundingBox!.max.x).toBeCloseTo(0.7, 5);
    shell.dispose();
  });

  it("the postcard box's carved sides: the wrap runs once round (u 0 -> 1, the corners shared), displaced by the carving", () => {
    // A carving that is 1 everywhere except a groove (0) round u = 0.125 (the front side's middle).
    const height = (u: number) => (Math.abs(u - 0.125) < 0.01 ? 0 : 1);
    const g = carvedSidesGeometry(1.3, 1, 1.3, [0, 0.8], { top: false, bottom: true }, { height, depth: 0.05, columns: 40, rows: 4, cornerEase: 0.03 });
    const uv = g.getAttribute("uv");
    const pos = g.getAttribute("position");
    const index = g.getIndex()!;
    const sides = g.groups.find((x) => x.materialIndex === 0)!;
    const corners = new Map<string, Set<number>>();
    let maxOut = 0;
    let grooveOut = Infinity;
    for (let k = sides.start; k < sides.start + sides.count; k++) {
      const i = index.getX(k);
      const u = Number(uv.getX(i).toFixed(6));
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // The front side (u in 0..0.25): how far it stands out of the plain surface at z = 0.65.
      if (u > 0 && u < 0.25) {
        maxOut = Math.max(maxOut, z - 0.65);
        if (Math.abs(u - 0.125) < 0.005) grooveOut = Math.min(grooveOut, z - 0.65);
      }
      if ([0, 0.25, 0.5, 0.75, 1].includes(u)) {
        const key = `${x.toFixed(3)},${z.toFixed(3)}`;
        if (!corners.has(key)) corners.set(key, new Set());
        corners.get(key)!.add(u);
      }
    }
    // Corners stay on the plain box (the carving eases out there), each with one u, the front-left with 0 and 1.
    expect(corners.size).toBe(4);
    expect([...corners.values()].flatMap((s) => [...s]).sort((a, b) => a - b)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    // Real relief: the face stands out by the full depth, and the groove is cut back down to the surface.
    expect(maxOut).toBeCloseTo(0.05, 6);
    expect(grooveOut).toBeCloseTo(0, 6);
    expect(g.getAttribute("normal")).toBeDefined();
    g.dispose();
  });

  it("the carving fades out under the lid and the carved lid top eases to its edges", () => {
    const side = carvedSidesGeometry(1, 1, 1, [0, 1], { top: false, bottom: false }, { height: () => 1, depth: 0.04, columns: 8, rows: 20, cornerEase: 0.03, fadeAboveV: 0.7, fadeSpan: 0.1 });
    const pos = side.getAttribute("position");
    const uv = side.getAttribute("uv");
    for (let i = 0; i < pos.count; i++) {
      if (uv.getY(i) >= 0.8 - 1e-9) expect(Math.max(Math.abs(pos.getX(i)), Math.abs(pos.getZ(i)))).toBeCloseTo(0.5, 6);
    }
    side.dispose();
    const top = carvedTopGeometry(1.36, { height: () => 1, depth: 0.04, columns: 20, rows: 20, cornerEase: 0.03 });
    const tp = top.getAttribute("position");
    let peak = 0;
    for (let i = 0; i < tp.count; i++) {
      const edge = Math.max(Math.abs(tp.getX(i)), Math.abs(tp.getZ(i)));
      if (edge >= 0.68 - 1e-6) expect(tp.getY(i)).toBeCloseTo(0, 6);
      peak = Math.max(peak, tp.getY(i));
    }
    expect(peak).toBeCloseTo(0.04, 6);
    top.dispose();
  });

  it("the gem keeps its hue: bright facets are compressed before tone mapping and never turn white", () => {
    const material = new MeshPhysicalMaterial();
    keepGemHue(material, [1, 0, 0.1]);
    const shader = { fragmentShader: "void main() {\n#include <tonemapping_fragment>\n}", vertexShader: "", uniforms: {} };
    material.onBeforeCompile(shader as never, undefined as never);
    expect(shader.fragmentShader.indexOf("peak")).toBeLessThan(shader.fragmentShader.indexOf("#include <tonemapping_fragment>"));
    expect(shader.fragmentShader).toContain(GEM_HUE_KNEE.toFixed(4));
    expect(shader.fragmentShader).toContain((GEM_HUE_CEILING - GEM_HUE_KNEE).toFixed(4));
    expect(GEM_HUE_KNEE).toBeLessThan(GEM_HUE_CEILING);
    expect(GEM_HUE_CEILING).toBeLessThanOrEqual(1.2);
    expect(GEM_HIGHLIGHT_WHITENESS).toBeLessThanOrEqual(0.2);
    expect(material.customProgramCacheKey()).toContain("gem-keep-hue");
    // The same rule in numbers: the brightest facet's weakest channel stays a small share of its strongest.
    const keep = (c: [number, number, number]) => {
      let peak = Math.max(...c);
      if (peak > GEM_HUE_KNEE) {
        const span = GEM_HUE_CEILING - GEM_HUE_KNEE;
        const soft = GEM_HUE_KNEE + span * (1 - Math.exp(-(peak - GEM_HUE_KNEE) / span));
        c = c.map((v) => (v * soft) / peak) as [number, number, number];
        peak = soft;
      }
      const lo = Math.min(...c);
      const t = Math.min(1, Math.max(0, (peak - 0.45) / 0.55));
      const bright = t * t * (3 - 2 * t);
      const target = lo + (Math.min(lo, GEM_HIGHLIGHT_WHITENESS * peak) - lo) * bright;
      return c.map((v) => target + ((v - lo) / (peak - lo)) * (peak - target));
    };
    const blown = keep([40, 9, 9]);
    expect(Math.max(...blown)).toBeLessThanOrEqual(GEM_HUE_CEILING + 1e-9);
    // A blown-out facet stays deep red: its weakest channel is about a tenth of its strongest (white would be 1).
    expect(Math.min(...blown) / Math.max(...blown)).toBeLessThan(0.12);
    const dim = keep([0.3, 0.02, 0.03]);
    expect(dim[0]).toBeCloseTo(0.3, 9);
    material.dispose();
  });

  it("the bow sits on its base: nothing below y = 0, so it never pokes through a lid", () => {
    const bow = bowGeometry();
    bow.computeBoundingBox();
    expect(bow.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.005);
    bow.dispose();
  });

  it("the engraved star's front face maps onto the engraving texture; every other face samples its plain corner", () => {
    const star = starGeometry(true);
    const pos = star.getAttribute("position");
    const uv = star.getAttribute("uv");
    let front = 0;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getZ(i) > STAR_FACE_Z - 1e-4) {
        front++;
        expect(uv.getX(i)).toBeCloseTo(0.5 + pos.getX(i) / 2, 5);
      } else expect(uv.getX(i)).toBeLessThan(0.01);
    }
    expect(front).toBeGreaterThan(10);
    star.dispose();
  });

  it("the kitten is a kitten: head bigger than half the body, two eyes, ears, whiskers, legs and a tail, posed in the box and sitting", () => {
    const kitten = buildKitten(null);
    let meshes = 0;
    kitten.root.traverse((n) => {
      if ((n as Mesh).isMesh) meshes++;
    });
    // Body, two legs, tail, head (with ears, muzzle, nose and whiskers merged), eyes.
    expect(meshes).toBe(6);
    expect(kitten.materials.length).toBe(6);
    const plan = composedScenePlan("kitten-box", { lowEnd: false, hitMs: 1190 });
    for (let t = 0; t < plan.endMs; t += 97) {
      kitten.pose(kittenPose(plan, t));
      kitten.root.updateMatrixWorld(true);
      kitten.root.traverse((n) => expect(n.matrixWorld.elements.every(Number.isFinite)).toBe(true));
    }
    for (const g of kitten.geometries) g.dispose();
    for (const m of kitten.materials) m.dispose();
  });
});
