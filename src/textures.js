import * as THREE from 'three';

// Deterministic PRNG so the scene looks identical every load.
export function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tileable fractal value noise sampled on a [0,1) square.
function makeNoise(seed, baseCells = 8) {
  const rand = mulberry32(seed);
  const octaves = [];
  for (let o = 0; o < 5; o++) {
    const cells = baseCells << o;
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    octaves.push({ cells, grid });
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  return (u, v) => {
    let sum = 0, amp = 1, norm = 0;
    for (const { cells, grid } of octaves) {
      const x = u * cells, y = v * cells;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const fx = smooth(x - x0), fy = smooth(y - y0);
      const xa = ((x0 % cells) + cells) % cells, xb = (xa + 1) % cells;
      const ya = ((y0 % cells) + cells) % cells, yb = (ya + 1) % cells;
      const a = grid[ya * cells + xa], b = grid[ya * cells + xb];
      const c = grid[yb * cells + xa], d = grid[yb * cells + xb];
      sum += amp * ((a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy);
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/** Normal map built from tileable noise; `stretch` elongates ripples along v. */
export function noiseNormalMap(seed = 7, size = 256, strength = 2.5, stretch = 1) {
  const noise = makeNoise(seed, 4);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      h[y * size + x] = noise(x / size, ((y / size) / stretch) % 1);

  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x];
      const d = h[((y + 1) % size) * size + x];
      const nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Checkered marble floor: cream and dark-chocolate stone with gold grout. */
export function marbleFloor(size = 2048, tiles = 8) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const veinNoise = makeNoise(42, 3);
  const grainNoise = makeNoise(9, 16);
  const img = ctx.createImageData(size, size);
  const t = size / tiles;
  const grout = 3;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tx = Math.floor(x / t), ty = Math.floor(y / t);
      const lx = x % t, ly = y % t;
      const dark = (tx + ty) % 2 === 1;
      const u = x / size, v = y / size;
      const n = veinNoise(u, v);
      // marble veins: thin bright/dark ridges where a warped sine crosses zero
      const vein = Math.pow(1 - Math.abs(Math.sin((u * 6 + v * 3 + n * 4) * Math.PI)), 18);
      const g = grainNoise(u, v) * 0.12;
      let r, gg, b;
      if (dark) {
        r = 52 + g * 80 + vein * 60; gg = 28 + g * 50 + vein * 38; b = 18 + g * 30 + vein * 20;
      } else {
        r = 196 - g * 60 - vein * 60; gg = 168 - g * 60 - vein * 70; b = 134 - g * 50 - vein * 70;
      }
      if (lx < grout || ly < grout) { r = 176; gg = 132; b = 70; }
      const i = (y * size + x) * 4;
      img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Roughness map paired with the floor: grout is rough, stone is polished. */
export function floorRoughness(size = 512, tiles = 8) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(40,40,40)';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgb(220,220,220)';
  const t = size / tiles;
  for (let i = 0; i < tiles; i++) {
    ctx.fillRect(i * t, 0, 1.5, size);
    ctx.fillRect(0, i * t, size, 1.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Vertical streaks for falling chocolate. */
export function streakTexture(size = 256) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const rand = mulberry32(3);
  ctx.fillStyle = '#3b1d0e';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 140; i++) {
    const x = rand() * size;
    const w = 1 + rand() * 6;
    const l = 30 + rand() * 50;
    ctx.fillStyle = `rgba(${120 + l}, ${70 + l * 0.5}, ${40 + l * 0.3}, ${0.15 + rand() * 0.35})`;
    ctx.fillRect(x, 0, w, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Warm environment for reflections: dark cocoa below, amber walls, bright
 * window panels — so glossy chocolate reflects gold instead of studio grey.
 */
export function warmEnvironmentScene() {
  const s = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 64, 32);
  const colors = [];
  const p = geo.attributes.position;
  const lo = new THREE.Color(0.05, 0.022, 0.01), mid = new THREE.Color(0.55, 0.3, 0.13), hi = new THREE.Color(0.16, 0.08, 0.04);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 50;
    if (y < 0) c.copy(lo).lerp(mid, Math.pow(1 + y, 6));
    else c.copy(mid).lerp(hi, Math.pow(y, 0.6));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

  const win = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.7, 0.4).multiplyScalar(5) });
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2 + 0.2;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(6, 14), win);
    m.position.set(Math.cos(ang) * 40, 10, Math.sin(ang) * 40);
    m.lookAt(0, 10, 0);
    s.add(m);
  }
  return s;
}

/** Normal map of long, gently wavering vertical flow lines (for falling liquid). */
export function flowNormalMap(size = 256, strength = 3) {
  const rand = mulberry32(21);
  const waves = Array.from({ length: 14 }, (_, i) => ({
    k: 1 + Math.floor(rand() * 9) + (i > 9 ? 8 : 0),
    a: 0.4 + rand(),
    phase: rand(),
    wob: 0.04 + rand() * 0.12,
    wphase: rand(),
    wk: 1 + Math.floor(rand() * 2),
  }));
  const height = (u, v) => {
    let h = 0;
    for (const w of waves) h += (w.a / w.k) * Math.sin(2 * Math.PI * (w.k * u + w.phase + w.wob * Math.sin(2 * Math.PI * (w.wk * v + w.wphase))));
    return h;
  };
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const e = 1 / size;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const nx = (height(u - e, v) - height(u + e, v)) * strength;
      const ny = (height(u, v - e) - height(u, v + e)) * strength;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      img.data[i] = (nx / len * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny / len * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---------------------------------------------------------------------------
// Roman marbles. Each swatch is a small tileable canvas; larger surfaces are
// composed from them with canvas patterns (much faster than per-pixel work).

const swatchCache = new Map();

/** Tileable marble swatch canvas. Veins are warped sines; `speckle` adds granular flecks (porphyry). */
export function marbleSwatch(name, { seed, base, vein, vein2 = vein, veins = 2, sharp = 14, grain = 0.14, speckle = 0, speckleColor = [255, 255, 255], size = 512 }) {
  if (swatchCache.has(name)) return swatchCache.get(name);
  const warp = makeNoise(seed, 3);
  const warp2 = makeNoise(seed + 1, 4);
  const fine = makeNoise(seed + 2, 32);
  const rand = mulberry32(seed + 3);
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const n = warp(u, v), n2 = warp2(u, v);
      const v1 = Math.pow(1 - Math.abs(Math.sin(Math.PI * (veins * u + v + n * 3.2))), sharp);
      const v2 = Math.pow(1 - Math.abs(Math.sin(Math.PI * (u - 2 * v + n2 * 4.5))), sharp * 2.2) * 0.6;
      const g = (fine(u, v) - 0.5) * grain * 2;
      let r = base[0] * (1 + g), gg = base[1] * (1 + g), b = base[2] * (1 + g);
      const cloud = (n - 0.5) * 0.25;
      r *= 1 + cloud; gg *= 1 + cloud; b *= 1 + cloud;
      r += (vein[0] - r) * v1 + (vein2[0] - r) * v2 * (1 - v1);
      gg += (vein[1] - gg) * v1 + (vein2[1] - gg) * v2 * (1 - v1);
      b += (vein[2] - b) * v1 + (vein2[2] - b) * v2 * (1 - v1);
      if (speckle && rand() < speckle) {
        const k = 0.4 + rand() * 0.6;
        r += (speckleColor[0] - r) * k; gg += (speckleColor[1] - gg) * k; b += (speckleColor[2] - b) * k;
      }
      const i = (y * size + x) * 4;
      img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  swatchCache.set(name, c);
  return c;
}

export const MARBLES = {
  statuario: () => marbleSwatch('statuario', { seed: 101, base: [238, 229, 212], vein: [176, 164, 150], vein2: [214, 204, 190], sharp: 26, grain: 0.04 }),
  giallo: () => marbleSwatch('giallo', { seed: 202, base: [204, 146, 66], vein: [234, 196, 124], vein2: [168, 104, 44], sharp: 5, grain: 0.12 }),
  verde: () => marbleSwatch('verde', { seed: 303, base: [20, 46, 34], vein: [196, 214, 192], vein2: [8, 18, 14], sharp: 12, grain: 0.25, speckle: 0.02, speckleColor: [120, 160, 130] }),
  porphyry: () => marbleSwatch('porphyry', { seed: 404, base: [104, 24, 30], vein: [80, 16, 22], sharp: 4, grain: 0.18, speckle: 0.09, speckleColor: [214, 160, 160] }),
};

function texFrom(c, { repeat = [1, 1], srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function marbleTexture(kind, repeat = [1, 1]) {
  return texFrom(MARBLES[kind](), { repeat });
}

/** One 4m × 4m unit of opus sectile floor: giallo field, verde diamond, porphyry roundel, gold grout. */
export function romanFloorUnit(S = 1024) {
  const c = canvas(S);
  const ctx = c.getContext('2d');
  const pat = (k) => ctx.createPattern(MARBLES[k](), 'repeat');
  const gold = '#c9973f';

  ctx.fillStyle = pat('statuario');
  ctx.fillRect(0, 0, S, S);
  const m = S * 0.075;
  ctx.fillStyle = pat('giallo');
  ctx.fillRect(m, m, S - 2 * m, S - 2 * m);
  // verde diamond touching the mid-points of the giallo field
  ctx.fillStyle = pat('verde');
  ctx.beginPath();
  ctx.moveTo(S / 2, m); ctx.lineTo(S - m, S / 2); ctx.lineTo(S / 2, S - m); ctx.lineTo(m, S / 2);
  ctx.closePath();
  ctx.fill();
  // ivory ring + porphyry roundel
  ctx.fillStyle = pat('statuario');
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.27, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pat('porphyry');
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.235, 0, Math.PI * 2); ctx.fill();
  // small porphyry squares in the giallo corners
  const q = S * 0.07;
  for (const [x, y] of [[m + q, m + q], [S - m - q, m + q], [m + q, S - m - q], [S - m - q, S - m - q]]) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
    ctx.fillStyle = pat('porphyry'); ctx.fillRect(-q / 2, -q / 2, q, q);
    ctx.strokeStyle = gold; ctx.lineWidth = 3; ctx.strokeRect(-q / 2, -q / 2, q, q);
    ctx.restore();
  }
  // gold inlay lines
  ctx.strokeStyle = gold;
  ctx.lineWidth = 4;
  ctx.strokeRect(m, m, S - 2 * m, S - 2 * m);
  ctx.beginPath();
  ctx.moveTo(S / 2, m); ctx.lineTo(S - m, S / 2); ctx.lineTo(S / 2, S - m); ctx.lineTo(m, S / 2);
  ctx.closePath(); ctx.stroke();
  for (const r of [0.27, 0.235]) { ctx.beginPath(); ctx.arc(S / 2, S / 2, S * r, 0, Math.PI * 2); ctx.stroke(); }
  ctx.lineWidth = 6;
  ctx.strokeRect(0, 0, S, S);
  return texFrom(c);
}

/** Roughness for the floor unit: polished stone, slightly rougher gold grout lines. */
export function romanFloorRoughness(S = 512) {
  const c = canvas(S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(28,28,28)';
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = 'rgb(110,110,110)';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, S, S);
  return texFrom(c, { srgb: false });
}

/** One 8m-wide × 18m-tall wall bay: porphyry skirting, verde dado, framed giallo panel, ivory pilaster strips. */
export function romanWallBay() {
  const PX = 128, W = 8 * PX, H = 18 * PX;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const pat = (k) => ctx.createPattern(MARBLES[k](), 'repeat');
  const gold = '#c9973f';
  const Y = (m) => H - m * PX; // metres above floor → canvas y

  ctx.fillStyle = pat('statuario');
  ctx.fillRect(0, 0, W, H);
  // skirting + dado
  ctx.fillStyle = pat('porphyry');
  ctx.fillRect(0, Y(0.45), W, 0.45 * PX);
  ctx.fillStyle = pat('verde');
  ctx.fillRect(0, Y(2.9), W, 2.35 * PX);
  ctx.fillStyle = gold;
  ctx.fillRect(0, Y(0.5), W, 6);
  ctx.fillRect(0, Y(2.95), W, 8);
  // dado panels
  ctx.strokeStyle = gold; ctx.lineWidth = 4;
  ctx.strokeRect(0.6 * PX, Y(2.6), 6.8 * PX, 1.8 * PX);
  // main framed panel
  const px0 = 0.55 * PX, px1 = W - 0.55 * PX, py0 = Y(13.5), py1 = Y(3.4);
  ctx.fillStyle = pat('giallo');
  ctx.fillRect(px0, py0, px1 - px0, py1 - py0);
  ctx.lineWidth = 6;
  ctx.strokeRect(px0, py0, px1 - px0, py1 - py0);
  ctx.fillStyle = pat('verde');
  const inset = 0.25 * PX;
  ctx.fillRect(px0 + inset, py0 + inset, px1 - px0 - 2 * inset, 0.12 * PX);
  ctx.fillRect(px0 + inset, py1 - inset - 0.12 * PX, px1 - px0 - 2 * inset, 0.12 * PX);
  // porphyry pilaster strips at bay edges
  ctx.fillStyle = pat('porphyry');
  ctx.fillRect(0, Y(13.5), 0.32 * PX, 10.1 * PX);
  ctx.fillRect(W - 0.32 * PX, Y(13.5), 0.32 * PX, 10.1 * PX);
  ctx.fillStyle = gold;
  ctx.fillRect(0.32 * PX, Y(13.5), 4, 10.1 * PX);
  ctx.fillRect(W - 0.32 * PX - 4, Y(13.5), 4, 10.1 * PX);
  return texFrom(c);
}
