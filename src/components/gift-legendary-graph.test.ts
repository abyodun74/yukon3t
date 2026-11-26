import { describe, expect, it } from "vitest";
import { BufferGeometry, InstancedMesh, Material, Matrix4, Mesh, PerspectiveCamera, Points, Texture, type Object3D } from "three";
import { buildLegendaryGraph, petalGeometry } from "@/components/gift-legendary-graph";
import { legendaryScenePlan, type LegendaryVariant } from "@/lib/gift-legendary-plan";

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

describe.each(["rose", "orchid"] as LegendaryVariant[])("buildLegendaryGraph (%s)", (variant) => {
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
