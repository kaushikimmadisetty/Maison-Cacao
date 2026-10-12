import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mulberry32, noiseNormalMap } from './textures.js';

// The world beneath the river: an amber cavern lit from the chocolate surface
// overhead, full of drifting cacao pods, truffles, gold leaf and bubbles.

export const UNDER_CAM = new THREE.Vector3(0, 2.5, 17);
export const UNDER_TARGET = new THREE.Vector3(0, 3.5, 0);
const SURFACE_Y = 20;
const FLOOR_Y = -7;

const surfaceShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    varying vec2 vUv;
    #define TAU 6.28318530718
    // Classic iterative caustics pattern
    float caustic(vec2 uv, float time) {
      vec2 p = mod(uv * TAU, TAU) - 250.0;
      vec2 i = p;
      float c = 1.0, inten = 0.005;
      for (int n = 0; n < 5; n++) {
        float t = time * (1.0 - (3.5 / float(n + 1)));
        i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
        c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
      }
      c /= 5.0;
      c = 1.17 - pow(c, 1.4);
      return pow(abs(c), 8.0);
    }
    void main() {
      float c = caustic(vUv * 6.0, uTime * 0.35);
      float r = length(vUv - 0.5) * 2.0;
      float fade = smoothstep(1.0, 0.05, r);
      // Dark chocolate seen from below; caustics are thin gold filaments, not a bright sheet
      vec3 deep = vec3(0.09, 0.035, 0.012);
      vec3 gold = vec3(1.0, 0.62, 0.26);
      vec3 col = deep * fade + gold * c * 0.55 * fade;
      col += gold * 0.35 * pow(fade, 10.0);   // soft glow where the light enters
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const rayShader = {
  vertexShader: /* glsl */ `
    varying vec3 vN;
    varying vec3 vV;
    varying float vY;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      vY = uv.y;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime, uSeed, uOpacity;
    varying vec3 vN;
    varying vec3 vV;
    varying float vY;
    void main() {
      float facing = pow(abs(dot(vN, vV)), 2.5);
      float vertical = smoothstep(0.0, 0.9, vY);
      float flicker = 0.65 + 0.35 * sin(uTime * 0.6 + uSeed * 7.0);
      float a = facing * vertical * flicker * uOpacity;
      gl_FragColor = vec4(vec3(1.0, 0.64, 0.3) * a, 1.0);
    }`,
};

function gradientDome() {
  const geo = new THREE.SphereGeometry(90, 48, 24);
  const p = geo.attributes.position;
  const lo = new THREE.Color(0.012, 0.004, 0.002), mid = new THREE.Color(0.16, 0.06, 0.02), hi = new THREE.Color(0.36, 0.16, 0.05);
  const c = new THREE.Color(), cols = [];
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 90;
    if (y < 0) c.copy(mid).lerp(lo, Math.min(1, -y * 2.5));
    else c.copy(mid).lerp(hi, Math.pow(y, 1.5));
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
}

function dunes() {
  const geo = new THREE.PlaneGeometry(220, 220, 220, 220);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const h = 1.4 * Math.sin(x * 0.11 + Math.sin(y * 0.07) * 2) + 0.8 * Math.sin(y * 0.17 + x * 0.05) + 0.3 * Math.sin(x * 0.4 + y * 0.3);
    p.setZ(i, h);
  }
  geo.computeVertexNormals();
  const normal = noiseNormalMap(31, 256, 2.5);
  normal.repeat.set(18, 18);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x2a1106, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.1,
    normalMap: normal, normalScale: new THREE.Vector2(0.4, 0.4),
  });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = FLOOR_Y;
  return m;
}

function lumpySphere(amount = 0.035) {
  const g = new THREE.SphereGeometry(1, 48, 32);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + amount * Math.sin(5 * x + 1) * Math.sin(4 * y + 2) * Math.sin(6 * z);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}

function cacaoPod() {
  const g = new THREE.SphereGeometry(1, 64, 48);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const ridge = 1 + 0.07 * Math.cos(a * 10) + 0.02 * Math.sin(y * 9 + a * 3);
    const taper = y > 0 ? 1 - 0.35 * Math.pow(y, 3) : 1 - 0.15 * Math.pow(-y, 3);
    x *= ridge * taper; z *= ridge * taper;
    p.setXYZ(i, x, y * 1.9 + (y > 0.9 ? (y - 0.9) * 1.5 : 0), z);
  }
  g.computeVertexNormals();
  return g;
}

export function buildUnderworld(envTexture) {
  const scene = new THREE.Scene();
  scene.environment = envTexture;
  scene.background = new THREE.Color(0x0e0502);
  scene.fog = new THREE.FogExp2(0x3a1806, 0.026);
  const uTime = { value: 0 };

  scene.add(gradientDome());

  // The river's underside, glittering with caustics
  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 160),
    new THREE.ShaderMaterial({ ...surfaceShader, uniforms: { uTime }, fog: false, side: THREE.DoubleSide, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending })
  );
  surface.rotation.x = Math.PI / 2;
  surface.position.y = SURFACE_Y;
  scene.add(surface);

  // Shafts of light filtering down
  const rand = mulberry32(77);
  const rays = [];
  for (let i = 0; i < 9; i++) {
    const h = 34;
    const mat = new THREE.ShaderMaterial({
      ...rayShader,
      uniforms: { uTime, uSeed: { value: rand() }, uOpacity: { value: 0.16 + rand() * 0.14 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    const ray = new THREE.Mesh(new THREE.CylinderGeometry(0.7 + rand() * 1.4, 3 + rand() * 4, h, 40, 1, true), mat);
    const ang = rand() * Math.PI * 2, rad = 3 + rand() * 18;
    ray.position.set(Math.cos(ang) * rad, SURFACE_Y - h / 2 + 0.5, Math.sin(ang) * rad - 4);
    ray.rotation.set((rand() - 0.5) * 0.25, 0, (rand() - 0.5) * 0.25);
    ray.userData.base = ray.rotation.clone();
    ray.userData.seed = rand() * 10;
    rays.push(ray);
    scene.add(ray);
  }

  scene.add(dunes());

  // Lighting
  scene.add(new THREE.HemisphereLight(0xffb060, 0x1a0804, 0.7));
  const top = new THREE.DirectionalLight(0xffc27a, 2.4);
  top.position.set(4, 30, 6);
  scene.add(top);
  const rim = new THREE.DirectionalLight(0xff7a30, 1.0);
  rim.position.set(-10, -4, -12);
  scene.add(rim);
  const glow = new THREE.PointLight(0xffa050, 40, 30, 2);
  glow.position.set(0, 6, 4);
  scene.add(glow);

  // ---------- drifting things ----------
  const choc = new THREE.MeshPhysicalMaterial({ color: 0x2b1207, roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.12 });
  const dusted = new THREE.MeshStandardMaterial({ color: 0x6a3a1e, roughness: 0.95 });
  const white = new THREE.MeshPhysicalMaterial({ color: 0xf0dfc0, roughness: 0.4, clearcoat: 0.6, sheen: 0.5, sheenColor: new THREE.Color(0xffe6b0) });
  const pod = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3 });
  const bean = new THREE.MeshStandardMaterial({ color: 0x5a2a14, roughness: 0.55 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xffc35a, metalness: 1, roughness: 0.18, side: THREE.DoubleSide, envMapIntensity: 1.6 });
  const bubble = new THREE.MeshPhysicalMaterial({
    color: 0xffdca8, roughness: 0, clearcoat: 1, transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 2.2,
  });

  const groups = [];
  const dummy = new THREE.Object3D();
  function spawn(geo, mat, count, sMin, sMax, opts = {}) {
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const items = [];
    for (let i = 0; i < count; i++) {
      let pos;
      do {
        pos = new THREE.Vector3((rand() - 0.5) * 46, -5 + rand() * (opts.yMax ?? 19), (rand() - 0.5) * 46 - 3);
      } while (pos.distanceTo(UNDER_CAM) < 4.5);
      items.push({
        pos,
        s: sMin + rand() * (sMax - sMin),
        axis: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
        spin: (0.1 + rand() * 0.4) * (opts.spin ?? 1),
        bob: 0.2 + rand() * 0.5,
        bobSpeed: 0.3 + rand() * 0.5,
        phase: rand() * 100,
        rise: opts.rise ? 0.5 + rand() * 1.3 : 0,
        stretch: opts.stretch ?? 1,
      });
      if (opts.colors) mesh.setColorAt(i, new THREE.Color(opts.colors[Math.floor(rand() * opts.colors.length)]));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
    groups.push({ mesh, items });
  }

  const sphere = lumpySphere();
  spawn(sphere, choc, 22, 0.35, 0.7);
  spawn(sphere, dusted, 12, 0.35, 0.6);
  spawn(sphere, white, 8, 0.35, 0.55);
  spawn(cacaoPod(), pod, 12, 0.55, 0.95, { colors: [0xd2691e, 0xb33a16, 0xe0a030, 0x9c2c12, 0xc85a1a], spin: 0.6 });
  const beanGeo = new THREE.SphereGeometry(1, 20, 14);
  beanGeo.scale(1, 0.55, 0.7);
  spawn(beanGeo, bean, 60, 0.14, 0.24, { spin: 2 });
  spawn(new RoundedBoxGeometry(1.6, 0.32, 1.6, 4, 0.08), choc, 14, 0.6, 1.0, { spin: 0.7 });
  spawn(new THREE.PlaneGeometry(0.24, 0.24, 2, 2), gold, 180, 0.5, 1.5, { spin: 6 });
  spawn(new THREE.SphereGeometry(1, 24, 16), bubble, 200, 0.04, 0.2, { rise: true, spin: 0 });

  // Golden dust
  const dustN = 2200;
  const dustPos = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) {
    dustPos[i * 3] = (rand() - 0.5) * 60;
    dustPos[i * 3 + 1] = -6 + rand() * 26;
    dustPos[i * 3 + 2] = (rand() - 0.5) * 60;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0xffc070, size: 0.07, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  scene.add(dust);

  const q = new THREE.Quaternion();
  return {
    scene,
    update(dt, t) {
      uTime.value = t;
      dust.rotation.y = t * 0.01;
      dust.position.y = Math.sin(t * 0.2) * 0.3;
      for (const r of rays) {
        r.rotation.x = r.userData.base.x + Math.sin(t * 0.15 + r.userData.seed) * 0.05;
        r.rotation.z = r.userData.base.z + Math.cos(t * 0.12 + r.userData.seed) * 0.05;
      }
      for (const { mesh, items } of groups) {
        items.forEach((it, i) => {
          dummy.position.copy(it.pos);
          if (it.rise) {
            const span = SURFACE_Y - FLOOR_Y;
            dummy.position.y = FLOOR_Y + ((it.pos.y - FLOOR_Y + t * it.rise + it.phase) % span);
            dummy.position.x += Math.sin(t * 1.5 + it.phase) * 0.15;
          } else {
            dummy.position.y += Math.sin(t * it.bobSpeed + it.phase) * it.bob;
            dummy.position.x += Math.cos(t * it.bobSpeed * 0.7 + it.phase) * it.bob * 0.5;
          }
          q.setFromAxisAngle(it.axis, t * it.spin + it.phase);
          dummy.quaternion.copy(q);
          dummy.scale.setScalar(it.s);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
