import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { warmEnvironmentScene } from './textures.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildHall } from './hall.js';
import { buildRiver, riverFloorMask } from './river.js';
import { buildUnderworld } from './underworld.js';
import { createDive } from './dive.js';

import { MARBLES } from './textures.js';

const loaderFill = document.getElementById('loader-fill');
// Yield to the browser between heavy steps so the loader keeps animating
const tick = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
async function setProgress(p) {
  loaderFill.style.transform = `scaleX(${p})`;
  window.dispatchEvent(new CustomEvent('loadprogress', { detail: p }));
  await tick();
}
await tick();
await setProgress(0.04);

// ---------- quality ----------
// Phones get a lighter profile up front; every device then adapts its
// resolution to the frame rate it actually achieves.
const MOBILE = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
const DPR_MAX = Math.min(window.devicePixelRatio, MOBILE ? 1.5 : 2);
const DPR_MIN = MOBILE ? 0.75 : 1;
let dpr = DPR_MAX;

// ---------- renderer ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !MOBILE, powerPreference: 'high-performance' });
renderer.setPixelRatio(dpr);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.78;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = MOBILE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a0c06);
scene.fog = new THREE.FogExp2(0x1f0d05, 0.015);

const pmrem = new THREE.PMREMGenerator(renderer);
const envTexture = pmrem.fromScene(warmEnvironmentScene(), 0.03).texture;
scene.environment = envTexture;

// ---------- camera ----------
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 200);
/** Vertical FOV for a desired one, widened on portrait screens so at least `minH`° fits horizontally. */
function fitFov(vfov, minH = 52) {
  const aspect = window.innerWidth / window.innerHeight;
  const needed = 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(minH / 2)) / aspect));
  return Math.min(Math.max(vfov, needed), 78);
}
camera.fov = fitFov(42);
camera.updateProjectionMatrix();
const CAM_START = new THREE.Vector3(21, 14, 21.5);
const CAM_END = new THREE.Vector3(12, 5, 16);
camera.position.copy(CAM_START);

const HALL_MIN = new THREE.Vector3(-27.5, 0.8, -22.5);
const HALL_MAX = new THREE.Vector3(27.5, 16, 22.5);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 5.5, -2); // hall centre, so the orbit stays inside the room
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 6;
controls.maxDistance = 22;
controls.maxPolarAngle = Math.PI * 0.49;
controls.autoRotateSpeed = 0.25;
controls.enabled = false;

// ---------- lighting ----------
// Phones drop the per-brazier point lights, so lift the ambient a touch to compensate
scene.add(new THREE.HemisphereLight(0xffc88a, 0x1a0905, MOBILE ? 0.34 : 0.26));

const sun = new THREE.DirectionalLight(0xffa24a, 1.7);
sun.position.set(-28, 26, -22);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(MOBILE ? 1024 : 2048);
sun.shadow.camera.left = -36;
sun.shadow.camera.right = 36;
sun.shadow.camera.top = 36;
sun.shadow.camera.bottom = -36;
sun.shadow.camera.far = 100;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun);

// Fill from the right-hand windows
const fill = new THREE.DirectionalLight(0xff9a50, 0.35);
fill.position.set(30, 18, 6);
scene.add(fill);

// ---------- world ----------
// Marble swatches are the slowest part — build them one per frame
let p = 0.08;
for (const k of Object.keys(MARBLES)) {
  MARBLES[k]();
  await setProgress((p += 0.09));
}
const hall = buildHall(scene, { floorMask: riverFloorMask(), lite: MOBILE });
await setProgress(0.55);
const river = buildRiver(scene);
await setProgress(0.66);
const underworld = buildUnderworld(envTexture);
await setProgress(0.74);

// ---------- post ----------
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const bloomRes = MOBILE ? 0.5 : 1;
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth * bloomRes, innerHeight * bloomRes), 0.38, 0.55, 0.92);
composer.addPass(bloom);
// declared below the loop vars; created here so its pass sits before tone mapping
let introDone = false;
const dive = createDive({
  camera, controls, canvas, renderPass, surfaceScene: scene, underworld, river,
  canInteract: () => introDone,
  fitFov,
});
composer.addPass(dive.pass);
composer.addPass(new OutputPass());

function applySize() {
  camera.aspect = innerWidth / innerHeight;
  if (dive.mode === 'surface' || dive.mode === 'under') camera.fov = fitFov(dive.mode === 'under' ? 50 : 42);
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(dpr);
  composer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
}
window.addEventListener('resize', applySize);

// Adaptive resolution: watch the real frame time and step the pixel ratio
// down when we're struggling, back up when there's headroom.
const perf = { frames: 0, time: 0, cooldown: 2 };
function adaptQuality(dt) {
  perf.frames++;
  perf.time += dt;
  if (perf.time < 1) return;
  const fps = perf.frames / perf.time;
  perf.frames = 0;
  perf.time = 0;
  if (perf.cooldown-- > 0) return;
  let next = dpr;
  if (fps < 42 && dpr > DPR_MIN) next = Math.max(DPR_MIN, dpr - 0.25);
  else if (fps > 57 && dpr < DPR_MAX) next = Math.min(DPR_MAX, dpr + 0.25);
  if (next !== dpr) {
    dpr = next;
    applySize();
    perf.cooldown = 2;
  }
}

// ---------- loop ----------
const clock = new THREE.Clock();
const INTRO = 4.5;
const ease = (x) => 1 - Math.pow(1 - x, 3);

let introStart = null; // set when the loader opens

function frame() {
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  const t = clock.elapsedTime;
  if (introDone && !document.hidden) adaptQuality(rawDt);

  if (!introDone) {
    const k = introStart === null ? 0 : ease(Math.min((t - introStart) / INTRO, 1));
    camera.position.lerpVectors(CAM_START, CAM_END, k);
    camera.lookAt(controls.target);
    if (k >= 1) {
      introDone = true;
      controls.enabled = true;
      controls.autoRotate = true;
    }
  }
  const diveOwnsCamera = dive.update(dt, t);
  if (!diveOwnsCamera) {
    controls.update();
    // Never let the camera leave the hall (walls are only drawn from inside)
    if (!dive.underActive) camera.position.clamp(HALL_MIN, HALL_MAX);
  }
  if (dive.underActive) underworld.update(dt, t);
  else {
    river.update(dt, t);
    hall.update(dt, t);
  }
  composer.render();
  requestAnimationFrame(frame);
}


// Compile every shader for both worlds up front (non-blocking where supported),
// so neither the reveal nor the first dive hitches.
await setProgress(0.8);
await renderer.compileAsync(scene, camera);
await setProgress(0.9);
await renderer.compileAsync(underworld.scene, camera);
await setProgress(0.96);
composer.render();
await setProgress(1);

frame();
await revealLoader();
canvas.addEventListener('pointerdown', () => (controls.autoRotate = false));

/** Gold line draws across, curtains part; the camera intro starts as they open. */
function revealLoader() {
  const loader = document.getElementById('loader');
  return new Promise((resolve) => {
    loader.classList.add('complete');
    setTimeout(() => {
      loader.classList.add('open');
      document.body.classList.remove('loading');
      introStart = clock.elapsedTime;
    }, 1900);
    // only hide once the curtains have fully left the screen
    loader.querySelector('.curtain.top').addEventListener('transitionend', () => {
      loader.classList.add('gone');
      resolve();
    }, { once: true });
  });
}
