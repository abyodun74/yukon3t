// Writes the placeholder 3D gift models (public/gifts/models/*.glb) used by the Epic and Legendary reveal
// (src/components/gift-scene-3d.tsx, registry src/lib/gift-3d-assets.ts). Original, procedural, made here with three's
// own GLTFExporter: no textures, no Draco/meshopt compression (nothing to decode, so no decoder is ever fetched), a few
// KB each. Every file is marked as a placeholder in its scene extras. To replace one with commissioned art, drop a GLB
// under the same name (no textures over the size budget, no compression extensions) and run
// `npx vitest run src/lib/gift-3d-assets.test.ts`.
//
//   node scripts/generate-gift-models.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

// GLTFExporter reads its binary output through FileReader, which Node doesn't have.
if (typeof globalThis.FileReader === "undefined") {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.({ target: this });
        this.onload?.({ target: this });
      });
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(buffer).toString("base64")}`;
        this.onloadend?.({ target: this });
        this.onload?.({ target: this });
      });
    }
  };
}

const OUT = path.join(process.cwd(), "public", "gifts", "models");

const material = (color, { metalness = 0.4, roughness = 0.35, emissive = 0x000000, flat = false } = {}) =>
  new THREE.MeshStandardMaterial({ color, metalness, roughness, emissive, flatShading: flat });

function centred(geometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  geometry.translate(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, -(box.min.z + box.max.z) / 2);
  return geometry;
}

function heart() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.9);
  s.bezierCurveTo(-0.15, -0.65, -1.0, -0.25, -1.0, 0.25);
  s.bezierCurveTo(-1.0, 0.7, -0.55, 0.95, -0.25, 0.85);
  s.bezierCurveTo(-0.1, 0.8, 0, 0.65, 0, 0.55);
  s.bezierCurveTo(0, 0.65, 0.1, 0.8, 0.25, 0.85);
  s.bezierCurveTo(0.55, 0.95, 1.0, 0.7, 1.0, 0.25);
  s.bezierCurveTo(1.0, -0.25, 0.15, -0.65, 0, -0.9);
  const geometry = centred(
    new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 2, curveSegments: 8 }),
  );
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, material(0xd8324f, { metalness: 0.3, roughness: 0.3, emissive: 0x2a0008 })));
  return group;
}

function diamond() {
  const group = new THREE.Group();
  const gem = material(0x9fd8ff, { metalness: 0.1, roughness: 0.08, emissive: 0x0a1a2a, flat: true });
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.95, 0.35, 10, 1), gem);
  crown.position.y = 0.32;
  const pavilion = new THREE.Mesh(new THREE.ConeGeometry(0.95, 1.1, 10, 1), gem);
  pavilion.rotation.x = Math.PI;
  pavilion.position.y = -0.4;
  group.add(crown, pavilion);
  return group;
}

function giftBox() {
  const group = new THREE.Group();
  const paper = material(0x7a4cf0, { metalness: 0.15, roughness: 0.5 });
  const ribbon = material(0xf2c14e, { metalness: 0.6, roughness: 0.3 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.0, 1.3), paper);
  box.position.y = -0.2;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.25, 1.42), paper);
  lid.position.y = 0.42;
  const bandA = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.3, 1.46), ribbon);
  bandA.position.y = 0.0;
  const bandB = new THREE.Mesh(new THREE.BoxGeometry(1.46, 1.3, 0.22), ribbon);
  bandB.position.y = 0.0;
  const loopL = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.07, 10, 24), ribbon);
  loopL.position.set(-0.2, 0.72, 0);
  loopL.rotation.set(0, Math.PI / 2, Math.PI / 4);
  const loopR = loopL.clone();
  loopR.position.x = 0.2;
  loopR.rotation.z = -Math.PI / 4;
  group.add(box, lid, bandA, bandB, loopL, loopR);
  return group;
}

function star() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 1 : 0.45;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  const geometry = centred(
    new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.06, bevelSegments: 2 }),
  );
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, material(0xf0b429, { metalness: 0.75, roughness: 0.25, emissive: 0x2a1a00 })));
  return group;
}

const MODELS = { heart, diamond, "gift-box": giftBox, star };

const exporter = new GLTFExporter();
mkdirSync(OUT, { recursive: true });
for (const [name, build] of Object.entries(MODELS)) {
  const scene = new THREE.Scene();
  scene.name = `gift-${name}`;
  scene.userData = { placeholder: true, source: "YuKon3t, generated by scripts/generate-gift-models.mjs", licence: "Original work" };
  scene.add(build());
  const glb = await exporter.parseAsync(scene, { binary: true });
  const file = path.join(OUT, `${name}.glb`);
  writeFileSync(file, Buffer.from(glb));
  console.log(`${path.relative(process.cwd(), file)}: ${Buffer.from(glb).byteLength} bytes`);
}
