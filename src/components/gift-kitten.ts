import {
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  Quaternion,
  SphereGeometry,
  TubeGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Texture,
} from "three";
import { mergeParts, type MergePart } from "@/components/gift-composed-objects";
import type { KittenPose } from "@/lib/gift-composed-plan";

// The Playful Kitten's 3D kitten (gift-composed-graph.ts, variant "kitten-box"): an orange tabby kitten built from
// simple shapes, proportioned like a kitten (a big round head, large eyes set low and wide, small nose and muzzle,
// upright ears with pink insides, whiskers, a round body with a white chest, white paws, a long striped tail). Origin
// at its feet, facing +z, about 1.2 high sitting. Parts that move (head, eyes, each front leg, tail) are their own
// nodes; everything else is merged into one mesh per part, with one material per colour. No textures: the tabby stripes
// are vertex colours. Posed every frame from kittenPose (gift-composed-plan.ts).

const FUR = new Color("#f2a04c");
const STRIPE = new Color("#c2621f");
const CREAM = new Color("#fff3e4");

/** Material slots in the merged meshes. */
const M = { fur: 0, white: 1, pink: 2, dark: 3, iris: 4, shine: 5 } as const;

const mat4 = (position: [number, number, number], scale: [number, number, number] = [1, 1, 1], rotation?: [number, number, number]) => {
  const q = new Quaternion();
  if (rotation) {
    const m = new Matrix4().makeRotationX(rotation[0]).multiply(new Matrix4().makeRotationY(rotation[1])).multiply(new Matrix4().makeRotationZ(rotation[2]));
    q.setFromRotationMatrix(m);
  }
  return new Matrix4().compose(new Vector3(...position), q, new Vector3(...scale));
};

/** Tabby: soft darker bands across the back and the top of the head, none on the face, chest or belly. */
function tabby(x: number, y: number, z: number): [number, number, number] {
  const back = 1 - smooth(-0.02, 0.18, z);
  const band = smooth(0.45, 0.8, 0.5 + 0.5 * Math.sin(y * 27 + Math.sin(x * 8) * 1.3));
  const k = band * back * 0.75;
  const c = FUR.clone().lerp(STRIPE, k);
  return [c.r, c.g, c.b];
}
function headTabby(x: number, y: number, z: number): [number, number, number] {
  // Forehead stripes (the tabby "M") running up from between the eyes, and bands round the back of the head.
  const forehead = smooth(0.12, 0.2, y) * smooth(0.0, 0.12, z) * (0.5 + 0.5 * Math.cos(x * 34)) * smooth(0.04, 0.0, Math.abs(x) - 0.13);
  const back = (1 - smooth(-0.05, 0.1, z)) * smooth(0.45, 0.8, 0.5 + 0.5 * Math.sin(y * 24 + x * 3));
  const k = Math.min(1, forehead * 0.8 + back * 0.6);
  const c = FUR.clone().lerp(STRIPE, k);
  return [c.r, c.g, c.b];
}
function tailTabby(x: number, y: number, z: number): [number, number, number] {
  const along = Math.hypot(x, z + 0.25) + y * 0.5;
  const k = smooth(0.4, 0.75, 0.5 + 0.5 * Math.sin(along * 30)) * 0.8;
  const c = FUR.clone().lerp(STRIPE, k);
  return [c.r, c.g, c.b];
}
const plain = (c: Color) => () => [c.r, c.g, c.b] as [number, number, number];
function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** A tube whose radius tapers from `r0` at its start to `r1` at its end (TubeGeometry rings scaled about the curve). */
function taperedTube(points: Vector3[], r0: number, r1: number, segments = 32, radial = 10): BufferGeometry {
  const curve = new CatmullRomCurve3(points);
  const tube = new TubeGeometry(curve, segments, 1, radial, false);
  const position = tube.getAttribute("position");
  const normal = tube.getAttribute("normal");
  const ring = radial + 1;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const center = curve.getPointAt(t);
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j < ring; j++) {
      const k = i * ring + j;
      position.setXYZ(k, center.x + normal.getX(k) * r, center.y + normal.getY(k) * r, center.z + normal.getZ(k) * r);
    }
  }
  tube.computeVertexNormals();
  return tube;
}

export type Kitten = {
  root: Group;
  pose: (p: KittenPose) => void;
  geometries: BufferGeometry[];
  materials: Material[];
};

export function buildKitten(envMap: Texture | null): Kitten {
  const geometries: BufferGeometry[] = [];
  const temp: BufferGeometry[] = [];
  const g = <G extends BufferGeometry>(geometry: G) => {
    temp.push(geometry);
    return geometry;
  };
  const sphere = (segments = 28) => g(new SphereGeometry(1, segments, Math.round(segments * 0.75)));
  const fur = new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.78, sheen: 0.35, sheenColor: new Color("#ffd2a0"), sheenRoughness: 0.5, envMap, envMapIntensity: 0.5 });
  const white = new MeshPhysicalMaterial({ color: CREAM, roughness: 0.8, sheen: 0.5, sheenColor: new Color("#ffffff"), envMap, envMapIntensity: 0.5 });
  const pink = new MeshPhysicalMaterial({ color: new Color("#ff8fae"), roughness: 0.55, envMap, envMapIntensity: 0.5 });
  const dark = new MeshPhysicalMaterial({ color: new Color("#120c08"), roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, envMap, envMapIntensity: 1 });
  const iris = new MeshPhysicalMaterial({ color: new Color("#3aa66a"), roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, emissive: new Color("#0c3a1e"), envMap, envMapIntensity: 0.9 });
  const shine = new MeshPhysicalMaterial({ color: new Color("#ffffff"), emissive: new Color("#ffffff"), emissiveIntensity: 0.9, roughness: 0.3, envMap });
  const materials: Material[] = [fur, white, pink, dark, iris, shine];
  const slots = materials;

  const merged = (parts: MergePart[]) => {
    const geometry = mergeParts(parts, true);
    geometries.push(geometry);
    return new Mesh(geometry, slots);
  };

  const root = new Group();
  const body = new Group();
  root.add(body);

  // Body: a round, slightly pear-shaped sitting body, haunches, a white chest and the back paws.
  body.add(
    merged([
      { geometry: sphere(36), group: M.fur, matrix: mat4([0, 0.33, -0.04], [0.3, 0.33, 0.31]), color: tabby },
      { geometry: sphere(), group: M.fur, matrix: mat4([0.17, 0.15, -0.06], [0.16, 0.15, 0.21]), color: tabby },
      { geometry: sphere(), group: M.fur, matrix: mat4([-0.17, 0.15, -0.06], [0.16, 0.15, 0.21]), color: tabby },
      { geometry: sphere(), group: M.white, matrix: mat4([0, 0.36, 0.17], [0.19, 0.23, 0.14]), color: plain(CREAM) },
      { geometry: sphere(), group: M.white, matrix: mat4([0.19, 0.035, 0.1], [0.08, 0.045, 0.11]), color: plain(CREAM) },
      { geometry: sphere(), group: M.white, matrix: mat4([-0.19, 0.035, 0.1], [0.08, 0.045, 0.11]), color: plain(CREAM) },
    ]),
  );

  // Front legs: each its own node, pivoting at the shoulder (they reach forward in the jump).
  const legs = ([1, -1] as const).map((side) => {
    const leg = new Group();
    leg.position.set(side * 0.1, 0.4, 0.14);
    leg.add(
      merged([
        { geometry: g(new CapsuleGeometry(0.062, 0.26, 6, 14)), group: M.fur, matrix: mat4([0, -0.19, 0.03]), color: () => [FUR.r, FUR.g, FUR.b] },
        { geometry: sphere(), group: M.white, matrix: mat4([0, -0.355, 0.07], [0.075, 0.05, 0.09]), color: plain(CREAM) },
      ]),
    );
    body.add(leg);
    return leg;
  });

  // Tail: a long tapering striped tail curling round the side, pivoting at its base.
  const tail = new Group();
  tail.position.set(0, 0.12, -0.3);
  tail.add(
    merged([
      {
        geometry: g(
          taperedTube(
            [
              [0, 0, 0],
              [0.1, -0.06, -0.14],
              [0.3, -0.06, -0.12],
              [0.42, 0.02, 0.06],
              [0.44, 0.16, 0.22],
              [0.38, 0.3, 0.3],
            ].map(([x, y, z]) => new Vector3(x, y, z)),
            0.06,
            0.036,
          ),
        ),
        group: M.fur,
        color: (x, y, z) => tailTabby(x, y, z),
      },
    ]),
  );
  body.add(tail);

  // Head: a big round head (kitten proportions) pivoting at the neck, with ears, muzzle, nose, blush and whiskers.
  const head = new Group();
  head.position.set(0, 0.62, 0.05);
  body.add(head);
  const whiskers: MergePart[] = [];
  for (const side of [1, -1] as const) {
    for (const [lift, spread] of [
      [0.03, 0.2],
      [0, 0.04],
      [-0.03, -0.13],
    ] as const) {
      // A thin cylinder (along y) turned to point out from the muzzle, fanning up / level / down.
      whiskers.push({
        geometry: g(new CylinderGeometry(0.0065, 0.004, 0.3, 5, 1)),
        group: M.white,
        matrix: mat4([side * 0.215, 0.11 + lift, 0.27], [1, 1, 1], [0, side * 0.3, -side * (Math.PI / 2 - spread)]),
        color: plain(CREAM),
      });
    }
  }
  head.add(
    merged([
      { geometry: sphere(40), group: M.fur, matrix: mat4([0, 0.2, 0.02], [0.33, 0.29, 0.29]), color: headTabby },
      // Ears: fur cones, tilted out, with pink insides just in front.
      { geometry: g(new ConeGeometry(0.11, 0.22, 20)), group: M.fur, matrix: mat4([0.19, 0.46, -0.01], [1, 1, 0.55], [0, 0, -0.38]), color: () => [FUR.r, FUR.g, FUR.b] },
      { geometry: g(new ConeGeometry(0.11, 0.22, 20)), group: M.fur, matrix: mat4([-0.19, 0.46, -0.01], [1, 1, 0.55], [0, 0, 0.38]), color: () => [FUR.r, FUR.g, FUR.b] },
      { geometry: g(new ConeGeometry(0.075, 0.16, 16)), group: M.pink, matrix: mat4([0.185, 0.44, 0.03], [1, 1, 0.4], [0, 0, -0.38]) },
      { geometry: g(new ConeGeometry(0.075, 0.16, 16)), group: M.pink, matrix: mat4([-0.185, 0.44, 0.03], [1, 1, 0.4], [0, 0, 0.38]) },
      // Muzzle: two white cheek puffs and a chin, a small pink nose.
      { geometry: sphere(), group: M.white, matrix: mat4([0.065, 0.105, 0.25], [0.085, 0.07, 0.07]), color: plain(CREAM) },
      { geometry: sphere(), group: M.white, matrix: mat4([-0.065, 0.105, 0.25], [0.085, 0.07, 0.07]), color: plain(CREAM) },
      { geometry: sphere(), group: M.white, matrix: mat4([0, 0.055, 0.22], [0.07, 0.05, 0.06]), color: plain(CREAM) },
      { geometry: sphere(), group: M.pink, matrix: mat4([0, 0.155, 0.31], [0.036, 0.024, 0.025]) },
      // Blush.
      { geometry: sphere(), group: M.pink, matrix: mat4([0.2, 0.12, 0.2], [0.055, 0.03, 0.02], [0, 0.6, 0]) },
      { geometry: sphere(), group: M.pink, matrix: mat4([-0.2, 0.12, 0.2], [0.055, 0.03, 0.02], [0, -0.6, 0]) },
      ...whiskers,
    ]),
  );
  // Eyes: big, glossy, set low and wide: green iris, dark pupil, two catchlights. One node, so a blink squashes both.
  const eyes = new Group();
  eyes.position.set(0, 0.215, 0);
  const eyeParts: MergePart[] = [];
  for (const side of [1, -1] as const) {
    eyeParts.push(
      { geometry: sphere(), group: M.dark, matrix: mat4([side * 0.12, 0, 0.255], [0.078, 0.088, 0.05]) },
      { geometry: sphere(), group: M.iris, matrix: mat4([side * 0.12, -0.004, 0.286], [0.064, 0.074, 0.026]) },
      { geometry: sphere(), group: M.dark, matrix: mat4([side * 0.12, -0.002, 0.302], [0.034, 0.05, 0.016]) },
      { geometry: sphere(), group: M.shine, matrix: mat4([side * 0.12 + 0.026, 0.03, 0.315], [0.022, 0.022, 0.01]) },
      { geometry: sphere(), group: M.shine, matrix: mat4([side * 0.12 - 0.02, -0.028, 0.313], [0.011, 0.011, 0.006]) },
    );
  }
  eyes.add(merged(eyeParts));
  head.add(eyes);

  for (const geometry of temp) geometry.dispose();

  return {
    root,
    geometries,
    materials,
    pose(p) {
      root.visible = p.visible;
      root.position.set(p.x, p.y, p.z);
      root.rotation.set(-p.pitch, p.yaw, 0, "YXZ");
      const stretch = Math.max(0, p.stretch);
      const crouch = Math.max(0, -p.stretch);
      // Curled / crouched: lower and a little wider; stretched: longer (front legs reach forward, tail streams back).
      body.scale.set(1 + 0.08 * crouch, 1 - 0.26 * crouch - 0.06 * stretch, 1 + 0.2 * stretch);
      for (const leg of legs) leg.rotation.x = -1.15 * stretch;
      head.rotation.set(-0.15 * stretch + 0.1 * crouch, 0, p.headTilt);
      tail.rotation.set(0.5 * stretch, p.tail, 0);
      eyes.scale.y = Math.max(0.08, 1 - p.blink);
    },
  };
}
