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

const timings = {};
let lastMark = performance.now();
const loaderFill = document.getElementById('loader-fill');
// Yield to the browser between heavy steps so the loader keeps animating
const tick = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
async function setProgress(p, label) {
  const now = performance.now();
  if (label) timings[label] = Math.round(now - lastMark);
  lastMark = now;
  loaderFill.style.transform = `scaleX(${p})`;
  window.dispatchEvent(new CustomEvent('loadprogress', { detail: p }));
  await tick();
}
await tick();
await setProgress(0.04);

// ---------- renderer ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.78;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a0c06);
scene.fog = new THREE.FogExp2(0x1f0d05, 0.015);

const pmrem = new THREE.PMREMGenerator(renderer);
const envTexture = pmrem.fromScene(warmEnvironmentScene(), 0.03).texture;
scene.environment = envTexture;

// ---------- camera ----------
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 200);
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
scene.add(new THREE.HemisphereLight(0xffc88a, 0x1a0905, 0.26));

const sun = new THREE.DirectionalLight(0xffa24a, 1.7);
sun.position.set(-28, 26, -22);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
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
  await setProgress((p += 0.09), `marble:${k}`);
}
const hall = buildHall(scene, { floorMask: riverFloorMask() });
await setProgress(0.55, 'hall');
const river = buildRiver(scene);
await setProgress(0.66, 'river');
const underworld = buildUnderworld(envTexture);
await setProgress(0.74, 'underworld');

// ---------- post ----------
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.38, 0.55, 0.92);
composer.addPass(bloom);
// declared below the loop vars; created here so its pass sits before tone mapping
let introDone = false;
const dive = createDive({
  camera, controls, canvas, renderPass, surfaceScene: scene, underworld, river,
  canInteract: () => introDone,
});
composer.addPass(dive.pass);
composer.addPass(new OutputPass());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- loop ----------
const clock = new THREE.Clock();
const INTRO = 4.5;
const ease = (x) => 1 - Math.pow(1 - x, 3);

let introStart = null; // set when the loader opens

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

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

window.__debug = {
  camera, controls, dive, timings,
  render: () => { controls.update(); composer.render(); },
  skipIntro: () => { introStart = clock.elapsedTime - INTRO; },
};

// Compile every shader for both worlds up front (non-blocking where supported),
// so neither the reveal nor the first dive hitches.
await setProgress(0.8, 'setup');
await renderer.compileAsync(scene, camera);
await setProgress(0.9, 'compile:hall');
await renderer.compileAsync(underworld.scene, camera);
await setProgress(0.96, 'compile:underworld');
composer.render();
await setProgress(1, 'first-frame');
console.info('[load ms]', timings);

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
