import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { vortex } from './river.js';
import { UNDER_CAM, UNDER_TARGET } from './underworld.js';

// Click-and-hold on the river: a whirlpool opens, the camera is dragged toward
// it, the screen twists — then you plunge through into the world below.

const HOLD_TIME = 2.2;   // seconds of holding needed to dive
const PLUNGE_TIME = 1.2;
const EMERGE_TIME = 2.4;
const RISE_TIME = 1.3;
const RESURFACE_TIME = 2.6;

const CHOC = new THREE.Color(0.012, 0.005, 0.002);
const GOLD = new THREE.Color(1.3, 0.85, 0.45);

const VortexShader = {
  uniforms: {
    tDiffuse: { value: null },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uBlur: { value: 0 },
    uSwirl: { value: 0 },
    uVignette: { value: 0 },
    uAberr: { value: 0 },
    uFade: { value: 0 },
    uFadeColor: { value: new THREE.Color() },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uCenter;
    uniform float uBlur, uSwirl, uVignette, uAberr, uFade, uAspect;
    uniform vec3 uFadeColor;
    varying vec2 vUv;
    void main() {
      // twist the image around the vortex centre
      vec2 d = vUv - uCenter;
      d.x *= uAspect;
      float r = length(d);
      float a = uSwirl * exp(-r * 2.2);
      d = mat2(cos(a), sin(a), -sin(a), cos(a)) * d;
      d.x /= uAspect;
      // radial zoom blur with chromatic split, pulling toward the centre
      vec3 col = vec3(0.0);
      float tot = 0.0;
      for (int i = 0; i < 20; i++) {
        float t = float(i) / 19.0;
        float k = 1.0 - uBlur * t * 0.45;
        float w = 1.0 - 0.6 * t;
        col.r += texture2D(tDiffuse, uCenter + d * k * (1.0 + uAberr)).r * w;
        col.g += texture2D(tDiffuse, uCenter + d * k).g * w;
        col.b += texture2D(tDiffuse, uCenter + d * k * (1.0 - uAberr)).b * w;
        tot += w;
      }
      col /= tot;
      vec2 v = vUv - 0.5;
      v.x *= uAspect;
      col *= mix(1.0, smoothstep(0.95, 0.12, length(v)), uVignette);
      col = mix(col, uFadeColor, uFade);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const smooth = (x) => x * x * (3 - 2 * x);
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

export function createDive({ camera, controls, canvas, renderPass, surfaceScene, underworld, river, canInteract, fitFov = (f) => f }) {
  const pass = new ShaderPass(VortexShader);
  pass.enabled = false;
  const U = pass.uniforms;

  const surfaceBtn = document.getElementById('surface-btn');

  const surfaceLimits = {
    minDistance: controls.minDistance, maxDistance: controls.maxDistance,
    maxPolarAngle: controls.maxPolarAngle, autoRotateSpeed: controls.autoRotateSpeed,
  };
  const underLimits = { minDistance: 3, maxDistance: 22, maxPolarAngle: Math.PI * 0.62, autoRotateSpeed: 0.35 };
  const setLimits = (l) => Object.assign(controls, l);

  let mode = 'surface'; // surface | plunge | emerge | under | rise | resurface
  let hold = 0, holding = false, q = 0;
  const P = new THREE.Vector3();          // where the user grabbed the river
  const awayDir = new THREE.Vector3();    // horizontal direction from P back toward the camera
  const base = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: camera.fov };
  const from = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 0 };
  const look = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function hitRiver(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObjects(river.meshes, false)[0];
  }

  // Long-press is our gesture: suppress the browser's context menu / callout
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const activePointers = new Set();
  canvas.addEventListener('pointerdown', (e) => activePointers.add(e.pointerId));
  const forget = (e) => activePointers.delete(e.pointerId);
  window.addEventListener('pointerup', forget);
  window.addEventListener('pointercancel', forget);

  // Capture phase so we can disable OrbitControls before it sees the press
  canvas.addEventListener('pointerdown', (e) => {
    if (mode !== 'surface' || !canInteract()) return;
    // A second finger means pinch / pan: abandon any dive in progress
    if (activePointers.size > 0) {
      holding = false;
      return;
    }
    const hit = hitRiver(e);
    if (!hit) return;
    controls.enabled = false;
    controls.autoRotate = false;
    if (hold === 0) {
      base.pos.copy(camera.position);
      base.target.copy(controls.target);
      base.fov = camera.fov;
      P.copy(hit.point).setY(river.surfaceY);
      vortex.uVortexCenter.value.copy(P);
      vortex.uVortexSpin.value = 0;
      awayDir.copy(base.pos).sub(P).setY(0).normalize();
    }
    holding = true;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
  }, { capture: true });

  const release = () => (holding = false);
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return; // no hover on touch screens
    if (mode !== 'surface' || holding || hold > 0 || !canInteract()) return;
    canvas.style.cursor = hitRiver(e) ? 'pointer' : '';
  });

  surfaceBtn.addEventListener('click', () => {
    if (mode !== 'under') return;
    mode = 'rise';
    q = 0;
    controls.enabled = false;
    controls.autoRotate = false;
    from.pos.copy(camera.position);
    from.look.copy(controls.target);
    from.fov = camera.fov;
    document.body.classList.remove('under');
  });

  function post({ blur = 0, swirl = 0, vignette = 0, aberr = 0, fade = 0, color = CHOC, center = null }) {
    pass.enabled = blur > 0.001 || swirl > 0.001 || vignette > 0.001 || fade > 0.001;
    U.uBlur.value = blur;
    U.uSwirl.value = swirl;
    U.uVignette.value = vignette;
    U.uAberr.value = aberr;
    U.uFade.value = fade;
    U.uFadeColor.value.copy(color);
    U.uAspect.value = camera.aspect;
    if (center) U.uCenter.value.copy(center);
  }

  function screenOf(p) {
    tmp.copy(p).project(camera);
    return new THREE.Vector2(clamp01(tmp.x * 0.5 + 0.5), clamp01(tmp.y * 0.5 + 0.5));
  }

  function shake(amount) {
    camera.position.x += (Math.random() - 0.5) * amount;
    camera.position.y += (Math.random() - 0.5) * amount;
  }

  function aim(fov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.lookAt(look);
  }

  /** Returns true while the dive owns the camera (OrbitControls should not update). */
  function update(dt) {
    switch (mode) {
      case 'surface': {
        hold = clamp01(hold + (holding ? dt / HOLD_TIME : -dt / 0.6));
        if (hold === 0) {
          vortex.uVortexStrength.value = 0;
          vortex.uVortexSpin.value = 0;
          if (!holding && !controls.enabled && canInteract()) {
            controls.target.copy(base.target);
            camera.fov = base.fov;
            camera.updateProjectionMatrix();
            controls.enabled = true;
          }
          post({});
          return holding;
        }
        document.body.classList.toggle('pulling', hold > 0.15);
        const e = smooth(hold);
        vortex.uVortexStrength.value = e;
        vortex.uVortexSpin.value += dt * (0.5 + 7 * e) * e;
        // drift toward a point just above the whirlpool
        tmp.copy(P).addScaledVector(awayDir, 4).add({ x: 0, y: 3.5, z: 0 });
        camera.position.lerpVectors(base.pos, tmp, e * e * 0.8);
        shake(e * e * e * 0.08);
        look.lerpVectors(base.target, P, e);
        aim(base.fov + 24 * e * e);
        post({ blur: 0.5 * e * e, swirl: 2.2 * e * e, vignette: 0.9 * e, aberr: 0.015 * e * e, center: screenOf(P) });
        if (hold >= 1) {
          mode = 'plunge';
          q = 0;
          holding = false;
          from.pos.copy(camera.position);
          from.look.copy(look);
          from.fov = camera.fov;
        }
        return true;
      }

      case 'plunge': {
        q = clamp01(q + dt / PLUNGE_TIME);
        const k = q * q;
        vortex.uVortexSpin.value += dt * 10;
        tmp.copy(P).addScaledVector(awayDir, 0.3).add({ x: 0, y: -2.5, z: 0 });
        camera.position.lerpVectors(from.pos, tmp, k);
        shake(0.12 * (1 - q));
        tmp.copy(P).addScaledVector(awayDir, -0.6).add({ x: 0, y: -8, z: 0 });
        look.lerpVectors(from.look, tmp, smooth(q));
        aim(from.fov + (105 - from.fov) * k);
        post({ blur: 0.5 + 0.5 * q, swirl: 2.2 + 5 * k, vignette: 0.9, aberr: 0.015 + 0.03 * q, fade: smooth(clamp01((q - 0.55) / 0.45)), center: screenOf(P) });
        if (q >= 1) {
          renderPass.scene = underworld.scene;
          document.body.classList.remove('pulling');
          document.body.classList.add('under');
          mode = 'emerge';
          q = 0;
        }
        return true;
      }

      case 'emerge': {
        q = clamp01(q + dt / EMERGE_TIME);
        const e = easeOut(q);
        camera.position.lerpVectors(tmp.set(0, 17, 5), UNDER_CAM, e);
        look.lerpVectors(tmp.set(0, -2, 0), UNDER_TARGET, smooth(q));
        aim(105 + (fitFov(50) - 105) * e);
        post({ blur: 1 - e, swirl: 3 * (1 - e), vignette: 0.9 * (1 - e) + 0.25, aberr: 0.03 * (1 - e), fade: 1 - smooth(clamp01(q / 0.5)), center: new THREE.Vector2(0.5, 0.5) });
        if (q >= 1) {
          mode = 'under';
          controls.target.copy(UNDER_TARGET);
          setLimits(underLimits);
          controls.enabled = true;
          controls.autoRotate = true;
          vortex.uVortexStrength.value = 0;
        }
        return true;
      }

      case 'under':
        post({ vignette: 0.25 });
        return false;

      case 'rise': {
        q = clamp01(q + dt / RISE_TIME);
        const k = q * q;
        camera.position.lerpVectors(from.pos, tmp.set(from.pos.x * 0.2, 19, from.pos.z * 0.2), k);
        look.lerpVectors(from.look, tmp.set(0.5, 40, 0), smooth(q));
        aim(from.fov + (100 - from.fov) * k);
        post({ blur: q, swirl: -4 * k, vignette: 0.25 + 0.6 * q, aberr: 0.03 * q, fade: smooth(clamp01((q - 0.5) / 0.5)), color: GOLD, center: new THREE.Vector2(0.5, 0.5) });
        if (q >= 1) {
          renderPass.scene = surfaceScene;
          vortex.uVortexStrength.value = 1;
          mode = 'resurface';
          q = 0;
        }
        return true;
      }

      case 'resurface': {
        q = clamp01(q + dt / RESURFACE_TIME);
        const e = easeOut(q);
        vortex.uVortexStrength.value = 1 - smooth(q);
        vortex.uVortexSpin.value += dt * 4 * (1 - q);
        camera.position.lerpVectors(tmp.copy(P).addScaledVector(awayDir, 0.8).add({ x: 0, y: 0.8, z: 0 }), base.pos, e);
        look.lerpVectors(P, base.target, smooth(q));
        aim(100 + (base.fov - 100) * e);
        post({ blur: 1 - e, swirl: -3 * (1 - e), vignette: 0.85 * (1 - e), aberr: 0.03 * (1 - e), fade: 1 - smooth(clamp01(q / 0.45)), color: GOLD, center: screenOf(P) });
        if (q >= 1) {
          mode = 'surface';
          hold = 0;
          vortex.uVortexStrength.value = 0;
          setLimits(surfaceLimits);
          controls.target.copy(base.target);
          controls.enabled = true;
        }
        return true;
      }
    }
    return false;
  }

  return {
    pass,
    update,
    get mode() { return mode; },
    get underActive() { return renderPass.scene === underworld.scene; },
  };
}
