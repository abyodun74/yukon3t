import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  Matrix4,
  PlaneGeometry,
  Shape,
  SphereGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";

// Procedural geometry for the composed reveals (gift-composed-graph.ts): the trophy, open and closed box shells, the
// postcard box's carved sides and lid top (displaced by the carving's height), and the star with planar UVs for its engraving. No React, no DOM, no files:
// everything is built from numbers, so it is unit-tested in node (gift-composed-graph.test.ts).

/**
 * Joins geometries into one non-indexed geometry with one draw group per part (`group` = the material index), so a
 * multi-material object is one mesh. Every part must carry position, normal and uv; the parts are not disposed here.
 */
export type MergePart = {
  geometry: BufferGeometry;
  group: number;
  matrix?: Matrix4;
  /** A vertex colour from the (transformed) position; white when absent. */
  color?: (x: number, y: number, z: number) => [number, number, number];
};

export function mergeParts(parts: MergePart[], withColor = false): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const groups: { start: number; count: number; group: number }[] = [];
  for (const part of parts) {
    const flat = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
    const g = part.matrix ? flat.clone().applyMatrix4(part.matrix) : flat;
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    const uv = g.getAttribute("uv");
    const start = positions.length / 3;
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      if (withColor) colors.push(...(part.color ? part.color(p.getX(i), p.getY(i), p.getZ(i)) : ([1, 1, 1] as const)));
    }
    const last = groups[groups.length - 1];
    if (last && last.group === part.group && last.start + last.count === start) last.count += p.count;
    else groups.push({ start, count: p.count, group: part.group });
    if (g !== flat) g.dispose();
    if (flat !== part.geometry) flat.dispose();
  }
  const merged = new BufferGeometry();
  merged.setAttribute("position", new Float32BufferAttribute(positions, 3));
  merged.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  merged.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  if (withColor) merged.setAttribute("color", new Float32BufferAttribute(colors, 3));
  for (const g of groups) merged.addGroup(g.start, g.count, g.group);
  return merged;
}

/** A w x h plane facing `normal` (one of the six axis directions), centred at `at`. */
function face(w: number, h: number, normal: "+x" | "-x" | "+y" | "-y" | "+z" | "-z", at: [number, number, number]): { geometry: BufferGeometry; matrix: Matrix4 } {
  const geometry = new PlaneGeometry(w, h);
  const m = new Matrix4();
  const r = new Matrix4();
  switch (normal) {
    case "+z":
      break;
    case "-z":
      r.makeRotationY(Math.PI);
      break;
    case "+x":
      r.makeRotationY(Math.PI / 2);
      break;
    case "-x":
      r.makeRotationY(-Math.PI / 2);
      break;
    case "+y":
      r.makeRotationX(-Math.PI / 2);
      break;
    case "-y":
      r.makeRotationX(Math.PI / 2);
      break;
  }
  m.makeTranslation(...at).multiply(r);
  return { geometry, matrix: m };
}

/** Material slots of a box shell: the outside paper, the lining inside, the cut edge of its walls (the rim). */
export const SHELL_OUTSIDE = 0;
export const SHELL_INSIDE = 1;
export const SHELL_RIM = 2;

/**
 * An open box with real wall thickness, centred on the origin: `w` x `h` x `d` outside, walls `wall` thick, open at the
 * top (a box body) or at the bottom (a lid). Outside, inside (lining) and the rim are separate groups (SHELL_*), so an
 * open lid shows a finished lining framed by its walls' edges instead of a bare panel.
 */
export function boxShellGeometry(w: number, h: number, d: number, wall: number, open: "top" | "bottom"): BufferGeometry {
  const parts: MergePart[] = [];
  const add = (group: number, f: { geometry: BufferGeometry; matrix: Matrix4 }) => parts.push({ group, ...f });
  const hw = w / 2;
  const hh = h / 2;
  const hd = d / 2;
  const iw = w - 2 * wall;
  const id = d - 2 * wall;
  // The closed end (outside face and the lining just inside it).
  const closedY = open === "top" ? -hh : hh;
  const innerClosedY = open === "top" ? -hh + wall : hh - wall;
  const innerH = h - wall;
  const innerMidY = open === "top" ? (innerClosedY + hh) / 2 : (innerClosedY - hh) / 2;
  // Outside.
  add(SHELL_OUTSIDE, face(w, h, "+z", [0, 0, hd]));
  add(SHELL_OUTSIDE, face(w, h, "-z", [0, 0, -hd]));
  add(SHELL_OUTSIDE, face(d, h, "+x", [hw, 0, 0]));
  add(SHELL_OUTSIDE, face(d, h, "-x", [-hw, 0, 0]));
  add(SHELL_OUTSIDE, face(w, d, open === "top" ? "-y" : "+y", [0, closedY, 0]));
  // Inside (facing in).
  add(SHELL_INSIDE, face(iw, innerH, "-z", [0, innerMidY, id / 2]));
  add(SHELL_INSIDE, face(iw, innerH, "+z", [0, innerMidY, -id / 2]));
  add(SHELL_INSIDE, face(id, innerH, "-x", [iw / 2, innerMidY, 0]));
  add(SHELL_INSIDE, face(id, innerH, "+x", [-iw / 2, innerMidY, 0]));
  add(SHELL_INSIDE, face(iw, id, open === "top" ? "+y" : "-y", [0, innerClosedY, 0]));
  // The rim: the walls' cut edge around the opening.
  const rimY = open === "top" ? hh : -hh;
  const rimN = open === "top" ? "+y" : "-y";
  add(SHELL_RIM, face(w, wall, rimN, [0, rimY, hd - wall / 2]));
  add(SHELL_RIM, face(w, wall, rimN, [0, rimY, -hd + wall / 2]));
  add(SHELL_RIM, face(wall, id, rimN, [hw - wall / 2, rimY, 0]));
  add(SHELL_RIM, face(wall, id, rimN, [-hw + wall / 2, rimY, 0]));
  const merged = mergeParts(parts);
  for (const p of parts) p.geometry.dispose();
  return merged;
}

/** Material slots of the postcard box: the carved sides, its plain ends (top / bottom). */
export const WRAP_SIDES = 0;
export const WRAP_ENDS = 1;

/** The carving on a surface: its height (0..1) at texture (u, v), how far 1 stands out, and how finely it is meshed. */
export type Relief = {
  height: (u: number, v: number) => number;
  depth: number;
  /** Grid cells along each side (or across the lid top) and up the height. */
  columns: number;
  rows: number;
  /** Within this distance (units) of a box corner the carving eases out to the plain surface, so corners stay clean. */
  cornerEase: number;
  /** Above this v the carving eases out over `fadeSpan` (the body's top, hidden under the lid, stays plain). */
  fadeAboveV?: number;
  fadeSpan?: number;
};

const ease = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The four sides of a `w` x `h` x `d` box with ONE picture carved round them: u runs along the perimeter (front, right,
 * back, left, as seen turning the box), so the picture continues across every corner and meets itself where the left
 * side ends at the front; v runs from `v0` at the bottom to `v1` at the top. A periodic picture (gift-postcard-wrap.ts)
 * therefore has no seam anywhere. Each side is a fine grid whose vertices stand out along the side's normal by the
 * relief's height (real displaced geometry, its normals recomputed, so the carving catches light and casts its edges),
 * easing to the plain surface right at the corners. Sides only (group WRAP_SIDES), plus the bottom (WRAP_ENDS) when
 * `bottom`, plus the top when `top`.
 */
export function carvedSidesGeometry(w: number, h: number, d: number, v: [number, number], ends: { top: boolean; bottom: boolean }, relief: Relief): BufferGeometry {
  const perimeter = 2 * (w + d);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const hw = w / 2;
  const hd = d / 2;
  const hh = h / 2;
  // Corners in turning order (front-left -> front-right -> back-right -> back-left -> front-left), with the outward normal.
  const sides: { a: [number, number]; b: [number, number]; n: [number, number] }[] = [
    { a: [-hw, hd], b: [hw, hd], n: [0, 1] },
    { a: [hw, hd], b: [hw, -hd], n: [1, 0] },
    { a: [hw, -hd], b: [-hw, -hd], n: [0, -1] },
    { a: [-hw, -hd], b: [-hw, hd], n: [-1, 0] },
  ];
  const { columns, rows } = relief;
  let along = 0;
  for (const side of sides) {
    const length = Math.hypot(side.b[0] - side.a[0], side.b[1] - side.a[1]);
    const first = positions.length / 3;
    for (let j = 0; j <= rows; j++) {
      const fy = j / rows;
      const y = -hh + h * fy;
      const vv = v[0] + (v[1] - v[0]) * fy;
      const fade = relief.fadeAboveV === undefined ? 1 : 1 - ease(relief.fadeAboveV, relief.fadeAboveV + (relief.fadeSpan ?? 0.02), vv);
      for (let i = 0; i <= columns; i++) {
        const fx = i / columns;
        const s = length * fx;
        const u = (along + s) / perimeter;
        const corner = ease(0, relief.cornerEase, Math.min(s, length - s));
        const out = relief.depth * relief.height(u, vv) * corner * fade;
        const x = side.a[0] + (side.b[0] - side.a[0]) * fx + side.n[0] * out;
        const z = side.a[1] + (side.b[1] - side.a[1]) * fx + side.n[1] * out;
        positions.push(x, y, z);
        uvs.push(u, vv);
      }
    }
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < columns; i++) {
        const a = first + j * (columns + 1) + i;
        const b = a + 1;
        const c = a + columns + 1;
        const e = c + 1;
        indices.push(a, b, e, a, e, c);
      }
    }
    along += length;
  }
  const sideIndexCount = indices.length;
  const endFaces: { y: number; up: boolean }[] = [];
  if (ends.bottom) endFaces.push({ y: -hh, up: false });
  if (ends.top) endFaces.push({ y: hh, up: true });
  for (const e of endFaces) {
    const corners: [number, number][] = e.up
      ? [
          [-hw, hd],
          [hw, hd],
          [hw, -hd],
          [-hw, -hd],
        ]
      : [
          [-hw, -hd],
          [hw, -hd],
          [hw, hd],
          [-hw, hd],
        ];
    const first = positions.length / 3;
    for (const [x, z] of corners) {
      positions.push(x, e.y, z);
      uvs.push(x / w + 0.5, (e.up ? -z : z) / d + 0.5);
    }
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.addGroup(0, sideIndexCount, WRAP_SIDES);
  if (indices.length > sideIndexCount) geometry.addGroup(sideIndexCount, indices.length - sideIndexCount, WRAP_ENDS);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A square lid top (`size` across, lying flat at y = 0, facing up) carved by `relief` (u, v over the square, v = 1 at
 * the back edge), easing to the plain surface at its four edges so it meets the lid's rim cleanly.
 */
export function carvedTopGeometry(size: number, relief: Relief): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const n = relief.columns;
  for (let j = 0; j <= n; j++) {
    const fv = j / n;
    for (let i = 0; i <= n; i++) {
      const fu = i / n;
      const edge = Math.min(fu, 1 - fu, fv, 1 - fv) * size;
      const up = relief.depth * relief.height(fu, fv) * ease(0, relief.cornerEase, edge);
      positions.push((fu - 0.5) * size, up, (0.5 - fv) * size);
      uvs.push(fu, fv);
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const b = a + 1;
      const c = a + n + 1;
      const e = c + 1;
      indices.push(a, b, e, a, e, c);
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
 * The five-point star of the earlier placeholder model (scripts/generate-gift-models.mjs), smoother bevels. With
 * `engraveUv`, its front face gets planar UVs (the face's x/y mapped onto 0..1 over the star's full width), so a
 * texture laid on it lines up with the star; every other face (bevel, sides, back) samples the texture's corner, which
 * is plain (no engraving there).
 */
export function starGeometry(engraveUv = false): BufferGeometry {
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
  if (engraveUv) {
    geometry.computeBoundingBox();
    const top = geometry.boundingBox!.max.z;
    const position = geometry.getAttribute("position");
    const uv: number[] = [];
    for (let i = 0; i < position.count; i++) {
      const onFace = position.getZ(i) > top - 1e-4;
      uv.push(onFace ? 0.5 + position.getX(i) / (2 * STAR_ENGRAVE_HALF) : 0.002, onFace ? 0.5 + position.getY(i) / (2 * STAR_ENGRAVE_HALF) : 0.002);
    }
    geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  }
  return geometry;
}

/**
 * A ribbon bow to sit on a lid, its base at y = 0 (nothing below it, so it never pokes through the lid): two loops of
 * flat ribbon (a band, wide front to back and thin, not a round tube) standing up and leaning out, a knot between them,
 * and two short tails lying on the lid. About 0.7 wide. Draw it double-sided (the loops' insides show).
 */
export function bowGeometry(): BufferGeometry {
  const parts: MergePart[] = [];
  for (const side of [1, -1] as const) {
    // A short open cylinder with its axis front to back is a loop of flat ribbon; stretched sideways into a teardrop-ish
    // oval, leaning out and tipped back a little, its lowest point at y = 0.
    const loop = new CylinderGeometry(0.15, 0.15, 0.11, 40, 1, true);
    const m = new Matrix4()
      .makeTranslation(side * 0.19, 0.165, 0)
      .multiply(new Matrix4().makeRotationZ(-side * 0.42))
      .multiply(new Matrix4().makeRotationX(-0.35))
      .multiply(new Matrix4().makeScale(1.35, 0.85, 1))
      .multiply(new Matrix4().makeRotationX(Math.PI / 2));
    parts.push({ geometry: loop, group: 0, matrix: m });
    const tail = new BoxGeometry(0.12, 0.016, 0.3);
    const t = new Matrix4()
      .makeTranslation(side * 0.1, 0.012, 0.13)
      .multiply(new Matrix4().makeRotationY(-side * 0.55))
      .multiply(new Matrix4().makeTranslation(0, 0, 0.1));
    parts.push({ geometry: tail, group: 0, matrix: t });
  }
  const knot = new SphereGeometry(0.075, 18, 12);
  parts.push({ geometry: knot, group: 0, matrix: new Matrix4().makeTranslation(0, 0.065, 0).multiply(new Matrix4().makeScale(1, 0.85, 0.9)) });
  const merged = mergeParts(parts);
  for (const p of parts) p.geometry.dispose();
  return merged;
}

/** The engraving's texture spans this half-width of the star's face (star units; the points reach 1). */
export const STAR_ENGRAVE_HALF = 1.0;

/**
 * The trophy, about 1.66 high, its plinth's underside at y = -0.69 (TROPHY_BASE_Y): a deep cup with a turned lip (outside and inside walls),
 * a short stem with a knop, a flared foot, two looping handles, and a two-tier plinth with a name plate on its front.
 * The cup, stem and foot are one lathe (smooth, 72 segments round); the handles are tubes along smooth curves that
 * meet the cup's wall.
 */
export function trophyGeometries(): { cup: BufferGeometry; handles: BufferGeometry; plinth: BufferGeometry; plate: BufferGeometry } {
  // The profile, from the middle of the cup's inside floor, up the inside wall, over the lip, down the outside of the
  // bowl, the stem, the knop and the foot, to the middle of the underside.
  const profile = [
    [0, 0.2],
    [0.16, 0.22],
    [0.27, 0.29],
    [0.36, 0.4],
    [0.42, 0.55],
    [0.455, 0.7],
    [0.47, 0.8],
    [0.478, 0.835],
    [0.505, 0.85],
    [0.53, 0.84],
    [0.535, 0.82],
    [0.51, 0.79],
    [0.495, 0.68],
    [0.46, 0.52],
    [0.4, 0.37],
    [0.3, 0.24],
    [0.17, 0.14],
    [0.085, 0.08],
    [0.065, 0.02],
    [0.065, -0.06],
    [0.11, -0.09],
    [0.13, -0.12],
    [0.11, -0.155],
    [0.06, -0.18],
    [0.055, -0.28],
    [0.07, -0.33],
    [0.14, -0.38],
    [0.25, -0.42],
    [0.3, -0.445],
    [0.305, -0.475],
    [0.29, -0.49],
    [0, -0.49],
  ]
    // Walked from the underside up the outside (three's lathe takes the side to the right of the walk as the outside),
    // raised so the foot stands on the plinth's top (y = -0.37).
    .reverse()
    .map(([x, y]) => new Vector2(x, y + 0.12));
  const cup = new LatheGeometry(profile, 72);

  const handle = (side: 1 | -1) => {
    const curve = new CatmullRomCurve3(
      [
        [0.47, 0.72, 0],
        [0.64, 0.75, 0],
        [0.78, 0.66, 0],
        [0.78, 0.48, 0],
        [0.62, 0.35, 0],
        [0.37, 0.34, 0],
      ].map(([x, y, z]) => new Vector3(side * x, y + 0.12, z)),
    );
    return new TubeGeometry(curve, 48, 0.04, 12, false);
  };
  const handles = mergeParts([
    { geometry: handle(1), group: 0 },
    { geometry: handle(-1), group: 0 },
  ]);

  const block = (w: number, h: number, d: number, y: number) => {
    const parts = [
      face(w, h, "+z", [0, y, d / 2]),
      face(w, h, "-z", [0, y, -d / 2]),
      face(d, h, "+x", [w / 2, y, 0]),
      face(d, h, "-x", [-w / 2, y, 0]),
      face(w, d, "+y", [0, y + h / 2, 0]),
      face(w, d, "-y", [0, y - h / 2, 0]),
    ];
    return parts.map((p) => ({ ...p, group: 0 }));
  };
  const plinthParts = [...block(0.86, 0.2, 0.86, -0.59), ...block(0.7, 0.12, 0.7, -0.43)];
  const plinth = mergeParts(plinthParts);
  for (const p of plinthParts) p.geometry.dispose();
  const plateFace = face(0.4, 0.09, "+z", [0, -0.59, 0.431]);
  const plate = mergeParts([{ ...plateFace, group: 0 }]);
  plateFace.geometry.dispose();
  return { cup, handles, plinth, plate };
}
