import * as THREE from 'three';
import { noiseNormalMap, flowNormalMap } from './textures.js';
import { HALL } from './hall.js';

const SURFACE_Y = 0.32;
const WIDTH = 4.6;
const POOL = new THREE.Vector3(0, SURFACE_Y, -19.2);
const POOL_R = 3.8;

export const riverCurve = new THREE.CatmullRomCurve3(
  [
    [0, -19.2], [-3, -14.5], [-6.5, -8], [-4.5, -1], [2, 4.5],
    [6.5, 10], [5, 16.5], [0, 21], [-3, HALL.d / 2 + 1],
  ].map(([x, z]) => new THREE.Vector3(x, SURFACE_Y, z)),
  false,
  'centripetal'
);

function ribbonGeometry(curve, width, segments, uvScale, across = 20) {
  const pos = [], uv = [], idx = [];
  const len = curve.getLength();
  const side = new THREE.Vector3();
  const row = across + 1;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    side.set(-tan.z, 0, tan.x).normalize().multiplyScalar(width / 2);
    for (let j = 0; j <= across; j++) {
      const s = 1 - (2 * j) / across; // +1 → left bank, -1 → right bank
      pos.push(p.x + side.x * s, p.y, p.z + side.z * s);
      uv.push(j / across, (t * len) / uvScale);
    }
    if (i < segments)
      for (let j = 0; j < across; j++) {
        const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Shared uniforms for the whirlpool that forms when the user holds on the river. */
export const vortex = {
  uVortexCenter: { value: new THREE.Vector3(0, 0, 0) },
  uVortexStrength: { value: 0 },
  uVortexSpin: { value: 0 },
  uVortexRadius: { value: 1.7 },
  uVortexDepth: { value: 4.5 },
  uTime: { value: 0 },
  uImpact: { value: new THREE.Vector3(0, -19.8, 1.45) }, // (x, z, half-width) of the line where the falls land
};

// Twists the surface around the vortex centre and sinks it into a funnel.
// Works in world space so the river ribbon and the (rotated) pool deform as one.
function applyVortex(material) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, vortex);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform vec3 uVortexCenter;
uniform float uVortexStrength, uVortexSpin, uVortexRadius, uVortexDepth, uTime;
uniform vec3 uImpact;
vec3 vortexWorld;
vec3 vortexNormalW;
// Where the falls land: a soft heap of chocolate plus rings travelling outward.
float impactH(vec2 xz) {
  float dx = max(abs(xz.x - uImpact.x) - uImpact.z, 0.0);
  float dz = xz.y - uImpact.y;
  float d = sqrt(dx * dx + dz * dz);
  float heap = 0.26 * exp(-d * d / 0.35) + 0.05 * sin(uTime * 6.0 + xz.x * 3.0) * exp(-d * d / 0.2);
  float rings = 0.045 * sin(d * 6.5 - uTime * 4.2) * exp(-d * 0.45) * smoothstep(0.2, 0.9, d)
              + 0.02 * sin(d * 11.0 - uTime * 6.3 + 1.7) * exp(-d * 0.8);
  return heap + rings;
}
void vortexApply(vec3 p) {
  vec3 w = (modelMatrix * vec4(p, 1.0)).xyz;
  vec2 rel = w.xz - uVortexCenter.xz;
  float d = length(rel);
  float s2 = uVortexRadius * uVortexRadius;
  float f = exp(-d * d / s2);
  float th = exp(-d * d / (s2 * 0.12));            // narrow throat
  float ang = (uVortexSpin + 5.0) * uVortexStrength * f; // unwinds as strength → 0
  float c = cos(ang), sn = sin(ang);
  vec2 r = vec2(c * rel.x - sn * rel.y, sn * rel.x + c * rel.y);
  float A = uVortexStrength * uVortexDepth;
  vortexWorld = vec3(uVortexCenter.x + r.x, w.y - A * (0.55 * f + 0.9 * th), uVortexCenter.z + r.y);
  float dh = A * (0.55 * f * 2.0 * d / s2 + 0.9 * th * 2.0 * d / (s2 * 0.12));
  vec2 g = d > 1e-4 ? dh * r / d : vec2(0.0);
  // add the impact heap/ripples (normal from finite differences)
  vec2 xz = vortexWorld.xz;
  const float e = 0.05;
  float hx = (impactH(xz + vec2(e, 0.0)) - impactH(xz - vec2(e, 0.0))) / (2.0 * e);
  float hz = (impactH(xz + vec2(0.0, e)) - impactH(xz - vec2(0.0, e))) / (2.0 * e);
  vortexWorld.y += impactH(xz);
  vortexNormalW = normalize(vec3(-g.x - hx, 1.0, -g.y - hz));
}`)
      .replace('#include <beginnormal_vertex>', `vortexApply(position);
vec3 objectNormal = transpose(mat3(modelMatrix)) * vortexNormalW;
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif`)
      .replace('#include <begin_vertex>', `vec3 transformed = (inverse(modelMatrix) * vec4(vortexWorld, 1.0)).xyz;
#ifdef USE_ALPHAHASH
  vPosition = vec3(position);
#endif`);
  };
  material.customProgramCacheKey = () => 'vortex';
}

/** Alpha mask that cuts the river's footprint out of the floor, so the funnel can sink below it. */
export function riverFloorMask() {
  const W = 1200, H = Math.round((W * HALL.d) / HALL.w);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  const px = (x) => ((x + HALL.w / 2) / HALL.w) * W;
  const pz = (z) => ((z + HALL.d / 2) / HALL.d) * H;
  ctx.strokeStyle = ctx.fillStyle = '#000';
  ctx.lineWidth = ((WIDTH + 0.2) / HALL.w) * W;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.beginPath();
  riverCurve.getSpacedPoints(400).forEach((p, i) => (i ? ctx.lineTo(px(p.x), pz(p.z)) : ctx.moveTo(px(p.x), pz(p.z))));
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px(POOL.x), pz(POOL.z), ((POOL_R + 0.1) / HALL.w) * W, 0, Math.PI * 2);
  ctx.fill();
  return new THREE.CanvasTexture(c);
}

function offsetCurve(curve, offset, t0, t1, samples = 160) {
  const pts = [];
  const side = new THREE.Vector3();
  for (let i = 0; i <= samples; i++) {
    const t = t0 + (t1 - t0) * (i / samples);
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    side.set(-tan.z, 0, tan.x).normalize().multiplyScalar(offset);
    pts.push(new THREE.Vector3(p.x + side.x, SURFACE_Y - 0.02, p.z + side.z));
  }
  return new THREE.CatmullRomCurve3(pts);
}

function glowSprite(color, size) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c), color, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  s.scale.setScalar(size);
  return s;
}

export function buildRiver(scene) {
  const normal = noiseNormalMap(11, 256, 3.2, 1);
  normal.repeat.set(1, 1);
  const chocolate = new THREE.MeshPhysicalMaterial({
    color: 0x3d1c0b,
    roughness: 0.2,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    envMapIntensity: 1.1,
  });

  const river = new THREE.Mesh(ribbonGeometry(riverCurve, WIDTH, 800, 5), chocolate);
  river.receiveShadow = true;
  scene.add(river);

  // Collecting pool beneath the falls
  const poolMat = chocolate.clone();
  poolMat.normalMap = normal;
  const pool = new THREE.Mesh(new THREE.RingGeometry(0.001, POOL_R, 96, 40), poolMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.copy(POOL).setY(SURFACE_Y + 0.005);
  pool.receiveShadow = true;
  scene.add(pool);

  // Marble curbs with a thin gold inlay
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xd9c7a8, roughness: 0.3, envMapIntensity: 0.3 });
  const inlayMat = new THREE.MeshStandardMaterial({ color: 0xe0a94f, metalness: 1, roughness: 0.25 });
  const BANK = WIDTH / 2 + 0.15, RING_R = POOL_R + 0.15;
  // Each bank starts exactly where it meets the pool's ring
  const bankStart = (sgn) => {
    const side = new THREE.Vector3();
    for (let t = 0; t < 0.3; t += 0.0005) {
      const p = riverCurve.getPointAt(t), tan = riverCurve.getTangentAt(t);
      side.set(-tan.z, 0, tan.x).normalize().multiplyScalar(sgn * BANK);
      if (Math.hypot(p.x + side.x - POOL.x, p.z + side.z - POOL.z) >= RING_R) return t;
    }
    return 0.06;
  };
  const bankEnds = [];
  for (const sgn of [1, -1]) {
    const t0 = bankStart(sgn);
    const c = offsetCurve(riverCurve, sgn * BANK, t0, 1);
    bankEnds.push(c.points[0]);
    const curb = new THREE.Mesh(new THREE.TubeGeometry(c, 500, 0.34, 14), curbMat);
    curb.castShadow = curb.receiveShadow = true;
    const ci = offsetCurve(riverCurve, sgn * BANK, t0, 1);
    ci.points.forEach((p) => (p.y += 0.3));
    const inlay = new THREE.Mesh(new THREE.TubeGeometry(ci, 500, 0.07, 8), inlayMat);
    scene.add(curb, inlay);
  }

  // Pool ring: an arc whose opening spans exactly between the two bank ends.
  // Torus angles φ map to world (cos φ, -sin φ) in xz after the -90° x-rotation.
  const angOf = (p) => Math.atan2(-(p.z - POOL.z), p.x - POOL.x);
  let a0 = angOf(bankEnds[0]), a1 = angOf(bankEnds[1]);
  // opening runs from a1 → a0 on the short side; the ring covers the rest
  let gap = ((a0 - a1) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  if (gap > Math.PI) { [a0, a1] = [a1, a0]; gap = Math.PI * 2 - gap; }
  const arcLen = Math.PI * 2 - gap;
  for (const [r, tube, mat, dy] of [[RING_R, 0.34, curbMat, 0], [RING_R, 0.07, inlayMat, 0.3]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 16, 128, arcLen), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.rotation.z = a0;
    ring.position.copy(POOL).setY(SURFACE_Y - 0.02 + dy);
    ring.castShadow = ring.receiveShadow = true;
    scene.add(ring);
  }
  // Round knuckles where ring meets bank
  for (const p of bankEnds) {
    const k = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16), curbMat);
    k.position.copy(p);
    const g = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), inlayMat);
    g.position.copy(p).setY(p.y + 0.4);
    scene.add(k, g);
  }

  // ---------- Waterfall ----------
  // One continuous sheet: flows forward out of the arch, curls over the lip,
  // then falls on a ballistic arc (horizontal offset ∝ √drop) into the pool.
  const topY = 10.2, botY = SURFACE_Y;
  const zBack = -HALL.d / 2 + 0.05, zEdge = -HALL.d / 2 + 1.7;
  const yS = topY + 0.1, drop = yS - botY, k = 0.78;
  const profile = [];
  for (let i = 0; i <= 10; i++) profile.push([zBack + (zEdge - zBack) * (i / 10), yS, 0]);
  for (let j = 1; j <= 90; j++) {
    const d = (drop + 0.4) * Math.pow(j / 90, 1.7);
    profile.push([zEdge + k * Math.sqrt(d), yS - d, j / 90]);
  }
  const fallPos = [], fallUv = [], fallIdx = [];
  const cols = 24;
  let arc = 0;
  profile.forEach(([z, y, f], r) => {
    if (r > 0) arc += Math.hypot(z - profile[r - 1][0], y - profile[r - 1][1]);
    const halfW = 2.0 - 0.55 * Math.pow(f, 0.7); // viscous sheet necks in as it falls
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      // edges thin out and ripple slightly as the sheet falls
      const edge = (u - 0.5) * 2;
      const wobble = f * 0.08 * Math.sin(arc * 0.9 + u * 2.4);
      const bulge = (0.08 + 0.12 * f) * Math.sqrt(Math.max(0, 1 - edge * edge)); // rounded, thick cross-section
      fallPos.push(edge * halfW, y + (r <= 10 ? bulge * 0.5 : 0), z + wobble + (r > 10 ? bulge : 0));
      fallUv.push(u, arc / 3);
    }
    if (r < profile.length - 1)
      for (let c = 0; c < cols; c++) {
        const a = r * (cols + 1) + c, b = a + 1, cc = a + cols + 1, dd = cc + 1;
        fallIdx.push(a, cc, b, b, cc, dd);
      }
  });
  const fallGeo = new THREE.BufferGeometry();
  fallGeo.setAttribute('position', new THREE.Float32BufferAttribute(fallPos, 3));
  fallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(fallUv, 2));
  fallGeo.setIndex(fallIdx);
  fallGeo.computeVertexNormals();

  const fallNormal = flowNormalMap();
  fallNormal.repeat.set(1, 0.25);
  const fallMat = chocolate.clone();
  fallMat.normalMap = fallNormal;
  fallMat.normalScale = new THREE.Vector2(0.6, 0.6);
  fallMat.side = THREE.DoubleSide;
  const impactZ = zEdge + k * Math.sqrt(drop);
  vortex.uImpact.value.set(0, impactZ, 1.45);
  const fall = new THREE.Mesh(fallGeo, fallMat);
  fall.castShadow = true;
  scene.add(fall);

  // Stone spillway: slab + rounded nose + side cheeks that channel the flow
  const stone = new THREE.MeshStandardMaterial({ color: 0xd9c7a8, roughness: 0.32, envMapIntensity: 0.3 });
  const slabD = zEdge - 0.35 - zBack;
  const lip = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.7, slabD), stone);
  lip.position.set(0, topY - 0.35, zBack + slabD / 2);
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 5.2, 32), stone);
  nose.rotation.z = Math.PI / 2;
  nose.position.set(0, topY - 0.35, zEdge - 0.35);
  const lipTrim = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5.3, 12), inlayMat);
  lipTrim.rotation.z = Math.PI / 2;
  lipTrim.position.set(0, topY - 0.78, zEdge - 0.45);
  scene.add(lip, nose, lipTrim);
  for (const sx of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.55, zEdge - zBack + 0.1), stone);
    cheek.position.set(sx * 2.38, topY + 0.27, (zBack + zEdge) / 2 + 0.05);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, zEdge - zBack + 0.15), inlayMat);
    cap.position.set(sx * 2.38, topY + 0.58, (zBack + zEdge) / 2 + 0.05);
    cheek.castShadow = true;
    scene.add(cheek, cap);
  }
  [lip, nose].forEach((m) => (m.castShadow = m.receiveShadow = true));

  // Arched opening in the wall behind the spillway
  const archMat = new THREE.MeshStandardMaterial({ color: 0x120703, roughness: 1 });
  const s = new THREE.Shape();
  s.moveTo(-2.4, 0); s.lineTo(2.4, 0); s.lineTo(2.4, 2.2);
  s.absarc(0, 2.2, 2.4, 0, Math.PI, false); s.lineTo(-2.4, 0);
  const arch = new THREE.Mesh(new THREE.ShapeGeometry(s, 24), archMat);
  arch.position.set(0, topY + 0.05, -HALL.d / 2 + 0.03);
  const archFrame = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.22, 12, 48, Math.PI), inlayMat);
  archFrame.position.set(0, topY + 2.25, -HALL.d / 2 + 0.1);
  scene.add(arch, archFrame);

  // Warm glow & mist where the falls hit the pool
  const mist = [];
  for (let i = 0; i < 6; i++) {
    const m = glowSprite(new THREE.Color(0.9, 0.55, 0.3), 3 + Math.random() * 2);
    m.material.opacity = 0.18;
    m.position.set((Math.random() - 0.5) * 3, 0.8 + Math.random() * 1.2, -20.6 + Math.random() * 1.5);
    m.userData.seed = Math.random() * 10;
    mist.push(m);
    scene.add(m);
  }

  // Chocolate droplets thrown off the impact line
  const DROPS = 40;
  const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), fallMat, DROPS);
  const dropState = [];
  const spawnDrop = (s) => {
    s.p.set((Math.random() * 2 - 1) * 1.4, SURFACE_Y + 0.15, impactZ + (Math.random() - 0.5) * 0.3);
    const out = Math.random() < 0.75 ? 1 : -1;
    s.v.set((Math.random() - 0.5) * 1.2, 1.2 + Math.random() * 2.2, out * (0.6 + Math.random() * 1.6));
    s.r = 0.018 + Math.random() * 0.04;
  };
  for (let i = 0; i < DROPS; i++) {
    const s = { p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0 };
    spawnDrop(s);
    s.p.addScaledVector(s.v, Math.random() * 0.8); // stagger so they don't fire in unison
    dropState.push(s);
  }
  drops.frustumCulled = false;
  scene.add(drops);
  const dropDummy = new THREE.Object3D();

  // Patch after the waterfall cloned the base material, so only river + pool swirl
  applyVortex(chocolate);
  applyVortex(poolMat);

  return {
    meshes: [river, pool],
    surfaceY: SURFACE_Y,
    update(dt, t) {
      vortex.uTime.value = t;
      dropState.forEach((s, i) => {
        s.v.y -= 9.8 * dt;
        s.p.addScaledVector(s.v, dt);
        if (s.p.y < SURFACE_Y) spawnDrop(s);
        dropDummy.position.copy(s.p);
        // stretch along velocity like a real droplet
        const sp = s.v.length();
        dropDummy.scale.set(s.r, s.r * (1 + sp * 0.35), s.r);
        dropDummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), s.v.clone().normalize());
        dropDummy.updateMatrix();
        drops.setMatrixAt(i, dropDummy.matrix);
      });
      drops.instanceMatrix.needsUpdate = true;
      normal.offset.y -= dt * 0.12;
      normal.offset.x = Math.sin(t * 0.3) * 0.03;
      fallNormal.offset.y -= dt * 0.9;
      for (const m of mist) {
        const k = m.userData.seed;
        m.material.opacity = 0.12 + 0.08 * Math.sin(t * 1.3 + k);
        m.position.y += Math.sin(t * 0.8 + k) * 0.002;
      }
    },
  };
}
