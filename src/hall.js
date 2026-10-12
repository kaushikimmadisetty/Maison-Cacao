import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { marbleTexture, romanFloorUnit, romanFloorRoughness, romanWallBay } from './textures.js';

// An imperial Roman hall: coffered barrel vault, Corinthian colonnades on
// verde-antico shafts, a full entablature with dentils, opus sectile floor,
// a thermal (Diocletian) window in the lunette, gilded urns and braziers.

export const HALL = { w: 60, d: 48, h: 18 };   // h = height where the vault springs
const COL_H = 14;                              // column top / entablature base
const VAULT_R = HALL.w / 2;
const BAY = 8;
const COLUMN_Z = [-18, -10, -2, 6, 14, 22];
const COLUMN_X = 27;

// ---------- materials ----------
const ivory = new THREE.MeshStandardMaterial({ color: 0xeadfc8, roughness: 0.32, envMapIntensity: 0.45 });
const gold = new THREE.MeshStandardMaterial({ color: 0xe0ab52, metalness: 1, roughness: 0.22, envMapIntensity: 1.2 });
const goldSoft = new THREE.MeshStandardMaterial({ color: 0xc9944a, metalness: 1, roughness: 0.38 });
const cofferPaint = new THREE.MeshStandardMaterial({ color: 0x2b1409, roughness: 0.75, envMapIntensity: 0.3, side: THREE.DoubleSide });
// Amber glass: bright at the top, deepening to honey at the sill, faintly mottled.
// Only the top of each pane crosses the bloom threshold, so windows glow without glaring.
let glassCanvas = null;
function glassMaterial(w, h, xMin = -w / 2) {
  if (!glassCanvas) {
    const W = 128, H = 512;
    glassCanvas = document.createElement('canvas');
    glassCanvas.width = W; glassCanvas.height = H;
    const ctx = glassCanvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgb(255, 232, 186)');
    grad.addColorStop(0.35, 'rgb(240, 190, 120)');
    grad.addColorStop(1, 'rgb(214, 146, 78)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // hand-blown glass mottling
    for (let i = 0; i < 260; i++) {
      const x = Math.random() * W, y = Math.random() * H, r = 4 + Math.random() * 14;
      const g2 = ctx.createRadialGradient(x, y, 0, x, y, r);
      const dark = Math.random() < 0.5;
      g2.addColorStop(0, dark ? 'rgba(120,60,20,0.045)' : 'rgba(255,240,210,0.06)');
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  const tex = new THREE.CanvasTexture(glassCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // ShapeGeometry UVs are in metres; map the shape's bounds onto the texture
  tex.repeat.set(1 / w, 1 / h);
  tex.offset.set(-xMin / w, 0);
  return new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.45, 1.4, 1.32) });
}
const coveGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.7, 0.38).multiplyScalar(2.2) });

function shadows(obj, cast = true, receive = true) {
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } });
  return obj;
}

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

// ---------- floor ----------
function floor(alphaMap) {
  const map = romanFloorUnit();
  const rough = romanFloorRoughness();
  const rx = HALL.w / 4, ry = HALL.d / 4;
  map.repeat.set(rx, ry);
  rough.repeat.set(rx, ry);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(HALL.w, HALL.d),
    new THREE.MeshStandardMaterial({
      map, roughnessMap: rough, roughness: 1, envMapIntensity: 0.55,
      alphaMap, alphaTest: alphaMap ? 0.5 : 0,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------- walls ----------
function archShape(w, h) {
  const r = w / 2;
  const s = new THREE.Shape();
  s.moveTo(-r, 0);
  s.lineTo(r, 0);
  s.lineTo(r, h - r);
  s.absarc(0, h - r, r, 0, Math.PI, false);
  s.lineTo(-r, 0);
  return s;
}

// A moulded ring around an arch opening. Each ring gets its own distinct inner
// edge (`inset`), so nested rings never share a surface (which z-fights).
function archRing(w, h, inset, grow, depth, mat) {
  const iw = w + inset * 2, ih = h + inset;
  const outer = archShape(iw + grow * 2, ih + grow);
  outer.holes.push(new THREE.Path(archShape(iw, ih).getPoints(48).reverse()));
  const ring = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth, bevelEnabled: false, curveSegments: 48 }), mat);
  ring.position.z = -0.05;
  return ring;
}

function archWindow(w, h) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.ShapeGeometry(archShape(w, h), 32), glassMaterial(w, h)));
  // Stepped surround, stepping back from a gilded bead at the glass
  const surround = new THREE.Group();
  surround.add(
    archRing(w, h, 0, 0.09, 0.62, gold),        // bead hugging the glass
    archRing(w, h, 0.09, 0.42, 0.5, ivory),     // inner fascia
    archRing(w, h, 0.51, 0.5, 0.34, ivory),     // outer fascia, set back
  );
  g.add(surround);

  // Keystone
  const ks = new THREE.Shape();
  ks.moveTo(-0.32, 0); ks.lineTo(0.32, 0); ks.lineTo(0.48, 1.2); ks.lineTo(-0.48, 1.2); ks.lineTo(-0.32, 0);
  const key = new THREE.Mesh(new THREE.ExtrudeGeometry(ks, { depth: 0.7, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04 }), gold);
  key.position.set(0, h - 0.25, -0.05);
  g.add(key);

  // Bronze glazing bars
  const bar = (bw, bh, x, y) => g.add(box(bw, bh, 0.12, goldSoft, x, y, 0.05));
  bar(0.1, h, 0, h / 2);
  for (let y = h / 5; y < h - w / 2; y += h / 5) bar(w, 0.08, 0, y);
  // Sill
  g.add(box(w + 1.4, 0.25, 0.8, ivory, 0, -0.12, 0.2));
  g.userData.noShadow = true;
  return g;
}

/** Diocletian window: a glowing half-disc split into three lights. */
function thermalWindow(r) {
  const g = new THREE.Group();
  const half = new THREE.Shape();
  half.absarc(0, 0, r, 0, Math.PI, false);
  half.lineTo(r, 0);
  g.add(new THREE.Mesh(new THREE.ShapeGeometry(half, 64), glassMaterial(2 * r, r)));
  const frame = new THREE.Shape();
  frame.absarc(0, 0, r + 1.1, 0, Math.PI, false);
  frame.lineTo(-r, 0);
  frame.absarc(0, 0, r, Math.PI, 0, true);
  frame.lineTo(r + 1.1, 0);
  g.add(new THREE.Mesh(new THREE.ExtrudeGeometry(frame, { depth: 0.5, bevelEnabled: false, curveSegments: 64 }), ivory));
  const bead = new THREE.Mesh(new THREE.TorusGeometry(r + 0.05, 0.1, 8, 96, Math.PI), gold);
  bead.position.z = 0.5;
  g.add(bead);
  for (const x of [-r / 3, r / 3]) {
    const h = Math.sqrt(r * r - x * x);
    g.add(box(0.7, h, 0.6, ivory, x, h / 2, 0.15));
    g.add(box(0.12, h, 0.7, gold, x, h / 2, 0.2));
  }
  g.add(box(2 * r + 2.6, 0.5, 1.2, ivory, 0, -0.25, 0.3));
  // radiating glazing bars
  for (let i = 1; i < 6; i++) {
    const m = box(0.06, r, 0.08, goldSoft, 0, 0, 0.05);
    m.geometry.translate(0, r / 2, 0);
    m.rotation.z = (i / 6) * Math.PI - Math.PI / 2;
    g.add(m);
  }
  return g;
}

function wallPanel(len, offsetU) {
  const tex = romanWallBay();
  tex.repeat.set(len / BAY, 1);
  tex.offset.set(offsetU, 0);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(len, HALL.h),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.28, envMapIntensity: 0.45 })
  );
}

function walls() {
  const g = new THREE.Group();
  const { w, d, h } = HALL;

  // Texture offsets put a bay centre (one bay = 8m) behind each window
  const back = wallPanel(w, 0.75);
  back.position.set(0, h / 2, -d / 2);
  const front = wallPanel(w, 0.75);
  front.rotation.y = Math.PI;
  front.position.set(0, h / 2, d / 2);
  const left = wallPanel(d, -0.25);
  left.rotation.y = Math.PI / 2;
  left.position.set(-w / 2, h / 2, 0);
  const right = wallPanel(d, 0.25);
  right.rotation.y = -Math.PI / 2;
  right.position.set(w / 2, h / 2, 0);
  g.add(back, front, left, right);

  // Lunettes closing the vault at each end, with a thermal window in the back one
  const lunetteShape = new THREE.Shape();
  lunetteShape.absarc(0, 0, VAULT_R, 0, Math.PI, false);
  lunetteShape.lineTo(VAULT_R, 0);
  const stucco = new THREE.MeshStandardMaterial({ color: 0xe4d6bb, roughness: 0.55, side: THREE.DoubleSide, envMapIntensity: 0.35 });
  for (const z of [-d / 2, d / 2]) {
    const l = new THREE.Mesh(new THREE.ShapeGeometry(lunetteShape, 64), stucco);
    l.position.set(0, h, z);
    g.add(l);
    // Concentric gilded mouldings echoing the vault
    for (const [r, tube] of [[VAULT_R - 1.4, 0.12], [VAULT_R - 1.9, 0.06], [17, 0.1], [14.2, 0.07]]) {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 160, Math.PI), r > 15 ? gold : goldSoft);
      arc.position.set(0, h, z + Math.sign(-z) * 0.08);
      g.add(arc);
    }
  }
  const tw = thermalWindow(11);
  tw.position.set(0, h + 0.4, -d / 2 + 0.05);
  g.add(tw);

  for (const x of [-16, 16]) {
    const win = archWindow(5.4, 9.4);
    win.position.set(x, 4, -d / 2 + 0.05);
    g.add(win);
  }
  for (const z of [-14, -6, 2, 10, 18]) {
    const l = archWindow(4, 9);
    l.position.set(-w / 2 + 0.05, 4.4, z);
    l.rotation.y = Math.PI / 2;
    const r = archWindow(4, 9);
    r.position.set(w / 2 - 0.05, 4.4, z);
    r.rotation.y = -Math.PI / 2;
    g.add(l, r);
  }

  // Skirting plinth all round
  g.add(box(w, 0.5, 0.35, ivory, 0, 0.25, -d / 2 + 0.17));
  g.add(box(w, 0.5, 0.35, ivory, 0, 0.25, d / 2 - 0.17));
  g.add(box(0.35, 0.5, d, ivory, -w / 2 + 0.17, 0.25, 0));
  g.add(box(0.35, 0.5, d, ivory, w / 2 - 0.17, 0.25, 0));

  shadows(g, false, true); // walls let the sun through the windows
  // window frames: thin reveals at grazing sun angles cause shadow acne
  g.traverse((o) => { if (o.userData.noShadow) shadows(o, false, false); });
  return g;
}

// ---------- entablature ----------
/**
 * Architrave (three fasciae), porphyry frieze with gold medallions, dentils,
 * projecting cornice and a hidden cove light that washes the vault.
 * Built along local x, wall at z=0, projecting toward +z by `depth`.
 */
function entablature(len, depth) {
  const g = new THREE.Group();
  const porphyry = new THREE.MeshStandardMaterial({ map: marbleTexture('porphyry', [len / 6, 0.25]), roughness: 0.25, envMapIntensity: 0.6 });
  const layer = (y0, y1, out, mat = ivory) => g.add(box(len, y1 - y0, out, mat, 0, (y0 + y1) / 2, out / 2));
  const y = COL_H;
  layer(y, y + 0.35, depth - 0.3);
  layer(y + 0.35, y + 0.7, depth - 0.2);
  layer(y + 0.7, y + 1.05, depth - 0.1);
  layer(y + 1.05, y + 1.15, depth - 0.05, gold);
  layer(y + 1.15, y + 2.05, depth - 0.2, porphyry);
  layer(y + 2.05, y + 2.45, depth - 0.1);
  layer(y + 2.45, y + 2.85, depth + 0.45);
  layer(y + 2.85, y + 2.95, depth + 0.5, gold);
  layer(y + 2.95, y + 3.25, depth + 0.35);
  layer(y + 3.25, HALL.h, depth);

  const m4 = new THREE.Matrix4();
  // Gold medallions on the frieze
  const nMed = Math.floor(len / 2);
  const med = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.26, 0.26, 0.08, 32).rotateX(Math.PI / 2), gold, nMed);
  for (let i = 0; i < nMed; i++) {
    m4.makeTranslation(-len / 2 + (i + 0.5) * (len / nMed), y + 1.6, depth - 0.16);
    med.setMatrixAt(i, m4);
  }
  g.add(med);

  // Dentils
  const nDent = Math.floor(len / 0.42);
  const dent = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.3, 0.3), ivory, nDent);
  for (let i = 0; i < nDent; i++) {
    m4.makeTranslation(-len / 2 + (i + 0.5) * (len / nDent), y + 2.27, depth + 0.05);
    dent.setMatrixAt(i, m4);
  }
  g.add(dent);

  // Cove light strip on top of the cornice
  g.add(box(len, 0.06, 0.12, coveGlow, 0, y + 3.29, depth + 0.25));
  return shadows(g, false, true);
}

// ---------- columns ----------
let capitalGeo = null;
/** Corinthian capital: bell + two tiers of acanthus leaves + corner volutes + abacus, merged into one geometry. */
function corinthianCapital() {
  if (capitalGeo) return capitalGeo;
  const parts = [];
  parts.push(new THREE.TorusGeometry(0.82, 0.07, 10, 48).rotateX(Math.PI / 2));
  parts.push(new THREE.CylinderGeometry(1.0, 0.78, 1.5, 40).translate(0, 0.8, 0));
  for (const [tier, yy, rr, tilt, off] of [[0, 0.45, 0.82, 0.32, 0], [1, 0.95, 0.9, 0.42, Math.PI / 8]]) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + off;
      const l = new THREE.SphereGeometry(1, 16, 12, 0, Math.PI);
      l.scale(0.24, 0.55, 0.16);
      l.rotateX(-tilt);            // tip curls outward
      l.rotateY(-a + Math.PI / 2);
      l.translate(Math.cos(a) * rr, yy + tier * 0.05, Math.sin(a) * rr);
      parts.push(l);
    }
  }
  // Corner volutes
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const v = new THREE.TorusGeometry(0.18, 0.07, 10, 24);
    v.rotateY(-a + Math.PI / 2);
    v.translate(Math.cos(a) * 1.05, 1.45, Math.sin(a) * 1.05);
    parts.push(v);
  }
  // Abacus with a rosette on each face
  parts.push(new THREE.BoxGeometry(2.4, 0.3, 2.4).translate(0, 1.72, 0));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    parts.push(new THREE.SphereGeometry(0.13, 12, 8).translate(Math.cos(a) * 1.22, 1.72, Math.sin(a) * 1.22));
  }
  capitalGeo = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  return capitalGeo;
}

let shaftMat = null;
function column() {
  const g = new THREE.Group();
  shaftMat ??= new THREE.MeshPhysicalMaterial({
    map: marbleTexture('verde', [2, 3]), roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.9,
  });
  // Attic base: plinth, torus, scotia, torus
  g.add(box(2.3, 0.7, 2.3, ivory, 0, 0.35, 0));
  g.add(box(2.4, 0.08, 2.4, gold, 0, 0.74, 0));
  const t1 = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.16, 16, 48), gold);
  t1.rotation.x = Math.PI / 2; t1.position.y = 0.92;
  const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.94, 0.25, 40), ivory);
  sc.position.y = 1.18;
  const t2 = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.12, 16, 48), gold);
  t2.rotation.x = Math.PI / 2; t2.position.y = 1.36;
  g.add(t1, sc, t2);

  const capH = 1.9;
  const shaftH = COL_H - 1.45 - capH;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.84, shaftH, 64), shaftMat);
  shaft.position.y = 1.45 + shaftH / 2;
  g.add(shaft);

  const cap = new THREE.Mesh(corinthianCapital(), gold);
  cap.position.y = 1.45 + shaftH;
  g.add(cap);
  return shadows(g);
}

// ---------- coffered barrel vault ----------
function vault() {
  const g = new THREE.Group();
  const { d, h } = HALL;
  const R = VAULT_R;

  const shell = new THREE.Mesh(new THREE.CylinderGeometry(R, R, d, 128, 1, true, -Math.PI / 2, Math.PI), cofferPaint);
  shell.rotation.x = -Math.PI / 2;
  shell.position.y = h;
  g.add(shell);

  const RIB = 0.9;
  // Transverse ribs: annular sectors extruded along z
  const ribShape = new THREE.Shape();
  ribShape.absarc(0, 0, R, 0, Math.PI, false);
  ribShape.lineTo(-(R - RIB), 0);
  ribShape.absarc(0, 0, R - RIB, Math.PI, 0, true);
  ribShape.lineTo(R, 0);
  const ribGeo = new THREE.ExtrudeGeometry(ribShape, { depth: 0.55, bevelEnabled: false, curveSegments: 96 });
  const beadGeo = new THREE.TorusGeometry(R - RIB, 0.05, 6, 160, Math.PI);
  const nZ = 12;
  const zStep = d / nZ;
  for (let i = 0; i <= nZ; i++) {
    const z = -d / 2 + i * zStep;
    const rib = new THREE.Mesh(ribGeo, ivory);
    rib.position.set(0, h, z - 0.275);
    const b1 = new THREE.Mesh(beadGeo, gold);
    b1.position.set(0, h, z - 0.3);
    const b2 = b1.clone();
    b2.position.z = z + 0.3;
    g.add(rib, b1, b2);
  }

  // Longitudinal ribs
  const nA = 24;
  const aStep = Math.PI / nA;
  const longGeo = new THREE.BoxGeometry(0.55, RIB, d);
  for (let k = 1; k < nA; k++) {
    const a = k * aStep;
    const m = new THREE.Mesh(longGeo, ivory);
    m.position.set(Math.cos(a) * (R - RIB / 2), h + Math.sin(a) * (R - RIB / 2), 0);
    m.rotation.z = a - Math.PI / 2;
    g.add(m);
  }

  // Each coffer: a stepped inner frame and a gilded rosette
  const cellW = zStep - 0.55, cellA = aStep * (R - RIB) - 0.55;
  const frameShape = new THREE.Shape();
  frameShape.moveTo(-cellA / 2, -cellW / 2); frameShape.lineTo(cellA / 2, -cellW / 2);
  frameShape.lineTo(cellA / 2, cellW / 2); frameShape.lineTo(-cellA / 2, cellW / 2);
  const inner = 0.32;
  frameShape.holes.push(new THREE.Path([
    new THREE.Vector2(-cellA / 2 + inner, -cellW / 2 + inner), new THREE.Vector2(-cellA / 2 + inner, cellW / 2 - inner),
    new THREE.Vector2(cellA / 2 - inner, cellW / 2 - inner), new THREE.Vector2(cellA / 2 - inner, -cellW / 2 + inner),
  ]));
  const frameGeo = new THREE.ExtrudeGeometry(frameShape, { depth: 0.35, bevelEnabled: false });
  const rosetteGeo = mergeGeometries([
    new THREE.SphereGeometry(0.32, 20, 12).scale(1, 1, 0.45),
    new THREE.TorusGeometry(0.42, 0.06, 8, 32),
    ...Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2;
      return new THREE.SphereGeometry(0.16, 10, 8).scale(1.6, 0.8, 0.4).rotateZ(a).translate(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0);
    }),
  ].map((p) => p.toNonIndexed()));

  const count = nA * nZ;
  const frames = new THREE.InstancedMesh(frameGeo, ivory, count);
  const rosettes = new THREE.InstancedMesh(rosetteGeo, gold, count);
  const dummy = new THREE.Object3D();
  dummy.up.set(0, 0, 1);
  let i = 0;
  for (let k = 0; k < nA; k++) {
    const a = (k + 0.5) * aStep;
    for (let j = 0; j < nZ; j++) {
      const z = -d / 2 + (j + 0.5) * zStep;
      const r = R - 0.02;
      dummy.position.set(Math.cos(a) * r, h + Math.sin(a) * r, z);
      dummy.lookAt(0, h, z); // local +z faces the vault axis
      dummy.updateMatrix();
      frames.setMatrixAt(i, dummy.matrix);
      dummy.position.set(Math.cos(a) * (r - 0.12), h + Math.sin(a) * (r - 0.12), z);
      dummy.updateMatrix();
      rosettes.setMatrixAt(i, dummy.matrix);
      i++;
    }
  }
  g.add(frames, rosettes);
  return shadows(g, false, false);
}

// ---------- ornaments ----------
let urnGeo = null;
function urn() {
  const g = new THREE.Group();
  urnGeo ??= new THREE.LatheGeometry([
    [0, 0], [0.42, 0], [0.45, 0.08], [0.28, 0.22], [0.26, 0.4], [0.5, 0.8], [0.78, 1.3], [0.86, 1.75],
    [0.78, 2.15], [0.46, 2.5], [0.3, 2.75], [0.32, 2.9], [0.5, 3.02], [0.46, 3.12], [0, 3.12],
  ].map(([x, y]) => new THREE.Vector2(x, y)), 64);
  const body = new THREE.Mesh(urnGeo, gold);
  body.position.y = 1.6;
  g.add(box(1.3, 1.5, 1.3, ivory, 0, 0.75, 0), box(1.45, 0.1, 1.45, gold, 0, 1.55, 0), body);
  for (const s of [-1, 1]) {
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.05, 8, 24, Math.PI * 1.3), gold);
    handle.position.set(s * 0.72, 1.6 + 2.35, 0);
    handle.rotation.z = s > 0 ? -0.6 : Math.PI + 0.6;
    g.add(handle);
  }
  return shadows(g);
}

const flameUniforms = { uTime: { value: 0 } };
const flameMaterial = new THREE.ShaderMaterial({
  uniforms: flameUniforms,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uSeed;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }
    float fbm(vec2 p) { return 0.5 * noise(p) + 0.25 * noise(p * 2.1) + 0.125 * noise(p * 4.3); }
    void main() {
      float t = uTime * 2.4 + uSeed * 17.0;
      float h = vUv.y;
      float n = fbm(vec2(vUv.x * 3.0 + uSeed * 5.0, h * 3.5 - t));
      // licks sway more toward the tip
      float x = (vUv.x - 0.5) * 2.0 + (n - 0.5) * 0.7 * h + sin(t * 0.7 + h * 3.0) * 0.08 * h;
      float width = 0.62 * pow(1.0 - h, 0.75) * smoothstep(0.0, 0.12, h + 0.02);
      float d = abs(x) / max(width, 1e-3);
      float body = smoothstep(1.0, 0.25, d) * smoothstep(1.0, 0.55, h + (n - 0.5) * 0.45);
      float core = smoothstep(0.55, 0.0, d) * smoothstep(0.55, 0.05, h);
      vec3 col = mix(vec3(0.75, 0.16, 0.02), vec3(1.0, 0.52, 0.12), body) * body * 0.9
               + vec3(1.0, 0.78, 0.45) * core * 0.9;
      gl_FragColor = vec4(col, 1.0);
    }`,
});

function flame(seed, w, h) {
  const geo = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0);
  const mat = flameMaterial.clone();
  mat.uniforms = { uTime: flameUniforms.uTime, uSeed: { value: seed } };
  const m = new THREE.Mesh(geo, mat);
  // Billboard around the vertical axis so the flame always faces the viewer
  const wp = new THREE.Vector3();
  m.onBeforeRender = (r, s, cam) => {
    m.getWorldPosition(wp);
    m.rotation.y = Math.atan2(cam.position.x - wp.x, cam.position.z - wp.z);
  };
  return m;
}

function brazier() {
  const g = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.LatheGeometry([
    [0, 0], [0.3, 0.02], [0.75, 0.25], [0.95, 0.55], [1.0, 0.62], [0.92, 0.62], [0.85, 0.5], [0, 0.4],
  ].map(([x, y]) => new THREE.Vector2(x, y)), 48), gold);
  bowl.position.y = 2.1;
  g.add(bowl);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, 2.3, 8), goldSoft);
    leg.position.set(Math.cos(a) * 0.45, 1.1, Math.sin(a) * 0.45);
    leg.rotation.set(Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), gold);
    foot.position.set(Math.cos(a) * 0.7, 0.1, Math.sin(a) * 0.7);
    g.add(leg, foot);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 8, 32), gold);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 1.0;
  g.add(ring);
  shadows(g, true, false);
  // Smouldering coals: dark, with a faint ember glow
  const coals = new THREE.Mesh(
    new THREE.SphereGeometry(0.85, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.22, 1),
    new THREE.MeshStandardMaterial({ color: 0x1a0c06, roughness: 0.9, emissive: 0xff5a1a, emissiveIntensity: 0.35 })
  );
  coals.position.y = 2.55;
  g.add(coals);
  // A few overlapping flame tongues of different sizes
  for (const [dx, dz, w, h] of [[0, 0, 1.0, 1.7], [0.22, 0.1, 0.6, 1.1], [-0.25, -0.05, 0.55, 1.0]]) {
    const f = flame(Math.random(), w, h);
    f.position.set(dx, 2.62, dz);
    g.add(f);
  }
  const light = new THREE.PointLight(0xff8a3a, 12, 14, 2);
  light.position.y = 3.4;
  g.add(light);
  return {
    group: g,
    update(t) {
      light.intensity = 12 + 2.5 * Math.sin(t * 11) + 1.5 * Math.sin(t * 23);
    },
  };
}

// ---------- assemble ----------
export function buildHall(scene, { floorMask } = {}) {
  scene.add(floor(floorMask));
  scene.add(walls());
  scene.add(vault());

  for (const x of [-COLUMN_X, COLUMN_X])
    for (const z of COLUMN_Z) {
      const c = column();
      c.position.set(x, 0, z);
      scene.add(c);
    }

  // Entablature: deep along the colonnades, shallow on the end walls,
  // and broken around the waterfall arch on the back wall.
  const sideDepth = HALL.w / 2 - COLUMN_X + 1.25;
  for (const s of [-1, 1]) {
    const e = entablature(HALL.d, sideDepth);
    e.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    e.position.set(s * HALL.w / 2, 0, 0);
    scene.add(e);
  }
  const endLen = HALL.w - 2 * sideDepth;
  const gap = 7.2;
  for (const s of [-1, 1]) {
    const len = (endLen - gap) / 2;
    const e = entablature(len, 1.4);
    e.position.set(s * (gap / 2 + len / 2), 0, -HALL.d / 2);
    scene.add(e);
  }
  const fe = entablature(endLen, 1.4);
  fe.rotation.y = Math.PI;
  fe.position.set(0, 0, HALL.d / 2);
  scene.add(fe);

  // Lights hidden on the cornice, washing up into the vault
  for (const x of [-22, 22])
    for (const z of [-12, 10]) {
      const l = new THREE.PointLight(0xffb468, 90, 34, 2);
      l.position.set(x, HALL.h + 1, z);
      scene.add(l);
    }

  // Gilded urns silhouetted against the side windows, and flanking the falls
  for (const s of [-1, 1]) {
    for (const z of [-14, -6, 2, 10, 18]) {
      const u = urn();
      u.position.set(s * 23.5, 0, z);
      scene.add(u);
    }
    const u = urn();
    u.position.set(s * 6.8, 0, -21.8);
    scene.add(u);
  }

  // Braziers along the river
  const braziers = [[5.5, -13], [-12, -4], [2.5, -4.5], [-2.5, 10], [12, 15.5], [-9, 17]].map(([x, z]) => {
    const b = brazier();
    b.group.position.set(x, 0, z);
    scene.add(b.group);
    return b;
  });

  return {
    update(dt, t) {
      flameUniforms.uTime.value = t;
      for (const b of braziers) b.update(t);
    },
  };
}
