import { describe, expect, it } from "vitest";
import { BufferGeometry, Material, Mesh, MeshPhysicalMaterial, Points, Texture, type Object3D } from "three";
import { ROCKET_TRAIL_MAX_LAG, ROCKET_TRAIL_STEP, buildComposedGraph, gemGeometries, goldHeartGeometry, starGeometry } from "@/components/gift-composed-graph";
import { COMPOSED_USES_ART, COMPOSED_VARIANTS, GEM_TABLE, composedScenePlan, type ComposedVariant } from "@/lib/gift-composed-plan";

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
      expect(nodes).toBeLessThanOrEqual(24);
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
    if (variant === "gold-heart" || variant === "star-badge") {
      expect(physical.some((m) => m.metalness === 1 && m.roughness <= 0.3)).toBe(true);
    }
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
    const trail = ROCKET_TRAIL_MAX_LAG / ROCKET_TRAIL_STEP + 1;
    const expected = plan.fireworks.reduce((n, f) => n + trail + f.particles + 1, 0);
    expect(clouds.map((c) => c.geometry.getAttribute("position").count)).toContain(expected);
    graph.dispose();
  });
});
