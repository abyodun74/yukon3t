import { describe, expect, it } from "vitest";
import { BufferGeometry, InstancedMesh, Material, Matrix4, Mesh, PerspectiveCamera, Points, ShaderMaterial, Texture, type Object3D } from "three";
import { BRILLIANT, buildLegendaryGraph, diamondGeometry, petalGeometry } from "@/components/gift-legendary-graph";
import { legendaryPetalPose, legendaryScenePlan, type LegendaryVariant } from "@/lib/gift-legendary-plan";

// The legendary scene's three.js objects, built for real (three.js needs no WebGL to create them) with a fake texture:
// bounded counts, finite poses over the whole timeline, and every geometry and material disposed on close (the texture
// is its owner's to dispose, gift-scene-legendary.tsx).

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

const view = (camera = new PerspectiveCamera(35, 1, 0.1, 100)) => ({ camera, baseDistance: 4, pixelRatio: 2, pulses: [2180] });

describe("petalGeometry", () => {
  it("is a small cupped grid of length 1", () => {
    const geometry = petalGeometry();
    expect(geometry.getAttribute("position").count).toBe(7 * 5);
    expect(geometry.getIndex()!.count).toBe(6 * 4 * 6);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    expect(box.max.y - box.min.y).toBeCloseTo(1, 5);
    expect(box.max.z).toBeGreaterThan(0.05);
    geometry.dispose();
  });
});

describe.each(["rose", "orchid", "jewelry"] as LegendaryVariant[])("buildLegendaryGraph (%s)", (variant) => {
  it.each([false, true])("lowEnd=%s: bounded instance and point counts", (lowEnd) => {
    const plan = legendaryScenePlan(variant, { lowEnd, hitMs: 2180 });
    const graph = buildLegendaryGraph(plan, new Texture());
    const instanced: InstancedMesh[] = [];
    const clouds: Points[] = [];
    graph.root.traverse((node) => {
      if ((node as InstancedMesh).isInstancedMesh) instanced.push(node as InstancedMesh);
      if ((node as Points).isPoints) clouds.push(node as Points);
    });
    expect(instanced).toHaveLength(2);
    expect(instanced.reduce((n, m) => n + m.count, 0)).toBe(plan.petals.length);
    expect(clouds.reduce((n, p) => n + p.geometry.getAttribute("position").count, 0)).toBe(plan.sparkles.length);
    let nodes = 0;
    graph.root.traverse(() => nodes++);
    expect(nodes).toBeLessThanOrEqual(16);
    graph.dispose();
  });

  it("poses everything with finite numbers over the whole timeline, the camera within the sway", () => {
    const plan = legendaryScenePlan(variant, { lowEnd: false, hitMs: 2180 });
    const graph = buildLegendaryGraph(plan, new Texture());
    const v = view();
    const matrix = new Matrix4();
    for (let t = 0; t <= plan.endMs + 4000; t += 997) {
      graph.update(t, v);
      expect(Number.isFinite(v.camera.position.x) && Number.isFinite(v.camera.position.z)).toBe(true);
      expect(Math.abs(Math.atan2(v.camera.position.x, v.camera.position.z))).toBeLessThanOrEqual((10 * Math.PI) / 180 + 1e-6);
      graph.root.traverse((node) => {
        const mesh = node as InstancedMesh;
        if (!mesh.isInstancedMesh) return;
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix);
          expect(matrix.elements.every(Number.isFinite)).toBe(true);
        }
      });
    }
    // At the start the camera is exactly at the poster-matching distance, straight on.
    graph.update(0, v);
    expect(v.camera.position.toArray().map((n) => Math.round(n * 1e9) / 1e9)).toEqual([0, 0, 4]);
    graph.dispose();
  });

  it("disposes every geometry and material it created on close, and leaves the texture to its owner", () => {
    const plan = legendaryScenePlan(variant, { lowEnd: false, hitMs: 2180 });
    const texture = new Texture();
    let textureDisposed = false;
    texture.addEventListener("dispose", () => {
      textureDisposed = true;
    });
    const graph = buildLegendaryGraph(plan, texture);
    graph.update(5000, view());
    const { geometries, materials } = collect(graph.root);
    expect(geometries.size).toBeGreaterThanOrEqual(6);
    expect(materials.size).toBeGreaterThanOrEqual(6);
    const disposed = new Set<object>();
    for (const item of [...geometries, ...materials]) item.addEventListener("dispose", () => disposed.add(item));
    graph.dispose();
    for (const item of [...geometries, ...materials]) expect(disposed.has(item)).toBe(true);
    expect(textureDisposed).toBe(false);
    expect(graph.root.children).toHaveLength(0);
  });
});

describe("the jewelry box's floating diamonds", () => {
  it("are round brilliants: an octagonal table, a low crown, a deeper pavilion to a point, one flat normal per facet", () => {
    const geometry = diamondGeometry();
    expect(geometry.getIndex()).toBeNull();
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    // A jeweller's proportions: diameter 1, crown 0.16, girdle 0.03, pavilion 0.43.
    expect(box.max.y - box.min.y).toBeCloseTo(BRILLIANT.crown + BRILLIANT.girdle + BRILLIANT.pavilion, 5);
    expect(box.max.x - box.min.x).toBeCloseTo(1, 1);
    // 57 facets as on a real brilliant (table, 8 star, 8 kite, 16 upper girdle, 8 main, 16 lower girdle), plus the
    // girdle band: 1 + 8 + 8 + 16 + 8 + 16 = 57, triangulated.
    expect(geometry.getAttribute("aEdge").count).toBe(geometry.getAttribute("position").count);
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    // Flat facets: the three vertices of every triangle share one normal.
    for (let t = 0; t < position.count; t += 3) {
      for (let k = 1; k < 3; k++) {
        expect(normal.getX(t + k)).toBeCloseTo(normal.getX(t), 5);
        expect(normal.getY(t + k)).toBeCloseTo(normal.getY(t), 5);
      }
    }
    // The flat table on top is wide; the bottom comes to a point.
    let top = 0;
    let bottom = 0;
    for (let i = 0; i < position.count; i++) {
      const r = Math.hypot(position.getX(i), position.getZ(i));
      if (Math.abs(position.getY(i) - box.max.y) < 1e-6) top = Math.max(top, r);
      if (Math.abs(position.getY(i) - box.min.y) < 1e-6) bottom = Math.max(bottom, r);
    }
    expect(top).toBeCloseTo(BRILLIANT.table, 5);
    expect(bottom).toBeLessThan(1e-6);
    // Every facet faces out of the stone.
    for (let t = 0; t < position.count; t += 3) {
      const cx = (position.getX(t) + position.getX(t + 1) + position.getX(t + 2)) / 3;
      const cy = (position.getY(t) + position.getY(t + 1) + position.getY(t + 2)) / 3 - (box.max.y + box.min.y) / 2;
      const cz = (position.getZ(t) + position.getZ(t + 1) + position.getZ(t + 2)) / 3;
      expect(cx * normal.getX(t) + cy * normal.getY(t) + cz * normal.getZ(t)).toBeGreaterThan(0);
    }
    geometry.dispose();
  });

  it("use a faceted shader with a per-diamond twinkle, stay near upright, and the picture keeps its aspect", () => {
    const plan = legendaryScenePlan("jewelry", { lowEnd: false, hitMs: 2180 });
    const graph = buildLegendaryGraph(plan, new Texture(), 0.8);
    const instanced: InstancedMesh[] = [];
    const art: Mesh[] = [];
    graph.root.traverse((node) => {
      if ((node as InstancedMesh).isInstancedMesh) instanced.push(node as InstancedMesh);
      else if ((node as Mesh).isMesh && (node as Mesh).renderOrder === 0) art.push(node as Mesh);
    });
    expect(instanced).toHaveLength(2);
    for (const mesh of instanced) {
      expect((mesh.material as ShaderMaterial).isShaderMaterial).toBe(true);
      expect(mesh.geometry.getAttribute("aPhase").count).toBeGreaterThanOrEqual(mesh.count);
    }
    expect(instanced[0].geometry).not.toBe(instanced[1].geometry);
    expect(art).toHaveLength(1);
    expect(art[0].scale.y).toBeCloseTo(0.8, 6);
    // The jewelry box's picture dissolves into the scene at its edges (premultiplied, its own blend); the rose and
    // orchid keep their plain fade.
    const artMaterial = art[0].material as ShaderMaterial;
    expect(artMaterial.defines).toHaveProperty("EDGE_BLEND");
    expect(artMaterial.premultipliedAlpha).toBe(true);
    for (const spec of plan.petals) {
      for (const t of [0, 3000, 9000]) {
        const pose = legendaryPetalPose(plan, spec, t, 1);
        // The table always tips towards the camera (never a cone from below or a disc from above).
        expect(pose.rx).toBeGreaterThanOrEqual(0.3 - 1e-9);
        expect(pose.rx).toBeLessThanOrEqual(0.54 + 1e-9);
        expect(Math.abs(pose.rz)).toBeLessThanOrEqual(0.18 + 1e-9);
      }
    }
    graph.update(5000, view());
    graph.dispose();
  });
});
