// The battlefield: sky, lava pit, fire wall, braziers, embers, smoke and combat effects.
import * as THREE from 'three';

function softDot(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.6)'));
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const DOT = softDot();
const SMOKE = softDot('rgba(60,50,45,0.55)', 'rgba(40,35,30,0)');
const FLAME = softDot('rgba(255,200,120,1)', 'rgba(255,80,10,0)');

// ---------- particles: one additive pool shared by sparks, explosions and embers ----------
export class Particles {
  constructor(scene, max = 4000) {
    this.max = max;
    this.pos = new Float32Array(max * 3).fill(-999);
    this.col = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.grav = new Float32Array(max);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.22, map: DOT, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  emit(x, y, z, { color = '#ffa040', count = 30, speed = 3, up = 2, life = 1, gravity = 6, spread = 0.1 } = {}) {
    const c = new THREE.Color(color);
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      this.pos.set([x + (Math.random() - 0.5) * spread, y, z + (Math.random() - 0.5) * spread], i * 3);
      this.vel.set([Math.cos(a) * s, up * (0.4 + Math.random()), Math.sin(a) * s], i * 3);
      const jitter = 0.75 + Math.random() * 0.25;
      this.base.set([c.r * jitter, c.g * jitter, c.b * jitter], i * 3);
      this.life[i] = this.maxLife[i] = life * (0.6 + Math.random() * 0.4);
      this.grav[i] = gravity;
    }
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      if (this.life[i] <= 0) { this.pos[k + 1] = -999; this.col.fill(0, k, k + 3); continue; }
      this.vel[k + 1] -= this.grav[i] * dt;
      this.vel[k] *= 0.985; this.vel[k + 2] *= 0.985;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const f = this.life[i] / this.maxLife[i];
      this.col[k] = this.base[k] * f; this.col[k + 1] = this.base[k + 1] * f; this.col[k + 2] = this.base[k + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

// ---------- shared shader noise ----------
const NOISE = `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return v;
  }
`;

// Same value noise on the CPU, for the terrain.
function hash2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm2(x, y, oct = 5) {
  let v = 0, a = 0.5;
  for (let i = 0; i < oct; i++) { v += a * noise2(x, y); x = x * 2.03 + 17.1; y = y * 2.03 + 17.1; a *= 0.5; }
  return v;
}

// ---------- camera-facing quads drawn by a shader (flames and smoke) ----------
const BILLBOARD_VERT = `
  attribute vec3 aCenter; attribute vec2 aSize; attribute float aSeed;
  uniform float uHeight;
  varying vec2 vUv; varying float vSeed; varying float vFade;
  void main() {
    vUv = uv; vSeed = aSeed;
    vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
    vec3 p = aCenter + right * position.x * aSize.x + vec3(0.0, (position.y + 0.5) * aSize.y * uHeight, 0.0);
    vFade = 1.0 - smoothstep(70.0, 160.0, distance(cameraPosition, p));
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

// Flame shape after the classic fbm fire: a teardrop eaten away by rising noise.
const FIRE_FRAG = `
  uniform float uTime;
  varying vec2 vUv; varying float vSeed; varying float vFade;
  ${NOISE}
  void main() {
    vec2 q = vec2(vUv.x - 0.5, vUv.y * 1.6 - 0.25);
    float t = uTime * (2.4 + fract(vSeed * 7.3)) + vSeed * 40.0;
    float n = fbm(vec2(q.x * 4.0 + vSeed * 13.0, q.y * 3.0 - t));
    float c = 1.0 - 16.0 * pow(max(0.0, length(q * vec2(1.8 + q.y * 1.5, 0.75)) - n * max(0.0, q.y + 0.25)), 1.2);
    float c1 = clamp(n * c * (1.5 - pow(1.25 * vUv.y, 4.0)), 0.0, 1.0);
    vec3 col = vec3(1.5 * c1, 1.5 * c1 * c1 * c1, c1 * c1 * c1 * c1 * c1 * c1);
    float a = clamp(c * (1.0 - pow(vUv.y, 3.0)), 0.0, 1.0) * vFade;
    gl_FragColor = vec4(col * a * 1.25, a);
  }
`;

// Thick dark smoke rolling upward.
const SMOKE_FRAG = `
  uniform float uTime;
  varying vec2 vUv; varying float vSeed; varying float vFade;
  ${NOISE}
  void main() {
    vec2 p = vUv * vec2(2.0, 3.0) + vec2(vSeed * 9.0, -uTime * 0.25);
    float n = fbm(p + fbm(p * 1.7 + uTime * 0.05));
    float edge = smoothstep(0.5, 0.15, abs(vUv.x - 0.5)) * smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
    float a = smoothstep(0.35, 0.8, n) * edge * 0.55 * vFade;
    vec3 col = mix(vec3(0.05, 0.04, 0.04), vec3(0.32, 0.17, 0.09), (1.0 - vUv.y) * 0.8);
    gl_FragColor = vec4(col, a);
  }
`;

function billboards(count, frag, uniforms, blending) {
  const plane = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = plane.index;
  geo.setAttribute('position', plane.attributes.position);
  geo.setAttribute('uv', plane.attributes.uv);
  const center = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const size = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2);
  const seed = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  geo.setAttribute('aCenter', center);
  geo.setAttribute('aSize', size);
  geo.setAttribute('aSeed', seed);
  geo.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uHeight: { value: 1 }, ...uniforms },
    vertexShader: BILLBOARD_VERT, fragmentShader: frag,
    transparent: true, depthWrite: false, blending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return {
    mesh, mat,
    set(i, x, y, z, w, h, s = Math.random()) {
      center.setXYZ(i, x, y, z); size.setXY(i, w, h); seed.setX(i, s);
    },
    commit() { center.needsUpdate = true; size.needsUpdate = true; seed.needsUpdate = true; },
  };
}

// ---------- sky and lights ----------
const hexVec = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

export function buildWorld(scene) {
  const uniforms = {
    uTime: { value: 0 }, uHorizon: { value: new THREE.Vector3() }, uTop: { value: new THREE.Vector3() },
    uCloudLit: { value: new THREE.Vector3() }, uCloudDark: { value: new THREE.Vector3() }, uBelow: { value: new THREE.Vector3() },
    uClouds: { value: 0.45 },
  };
  scene.fog = new THREE.FogExp2('#3a1a0e', 0.0075);

  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uTime; uniform vec3 uHorizon, uTop, uCloudLit, uCloudDark, uBelow; uniform float uClouds; varying vec3 vP;
      ${NOISE}
      void main() {
        float h = vP.y;
        vec3 c = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.5));
        // Clouds (or smoke), brighter near the horizon.
        vec2 p = vP.xz / max(0.12, h + 0.15) * 1.4 + vec2(uTime * 0.01, uTime * 0.004);
        float n = fbm(p + fbm(p * 0.6));
        float cloud = smoothstep(uClouds, uClouds + 0.4, n) * smoothstep(-0.02, 0.25, h);
        vec3 lit = mix(uCloudLit, uCloudDark, clamp(h * 1.6, 0.0, 1.0));
        c = mix(c, lit, cloud * 0.85);
        if (h < 0.0) c = mix(uHorizon, uBelow, clamp(-h * 4.0, 0.0, 1.0));
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  scene.add(sky);

  const hemi = new THREE.HemisphereLight('#ffcf9a', '#2a1a14', 0.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffb27a', 2.3);
  sun.position.set(-16, 22, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 90 });
  scene.add(sun);
  const rim = new THREE.DirectionalLight('#6f86ff', 0.45);
  rim.position.set(14, 10, -18);
  scene.add(rim);
  return {
    sun,
    update(t) { uniforms.uTime.value = t; },
    setField(f) {
      for (const k of ['horizon', 'top', 'cloudLit', 'cloudDark', 'below']) uniforms['u' + k[0].toUpperCase() + k.slice(1)].value.copy(hexVec(f.sky[k]));
      uniforms.uClouds.value = f.sky.clouds;
      scene.fog.color.set(f.fog[0]);
      scene.fog.density = f.fog[1];
      hemi.color.set(f.light.hemi[0]); hemi.groundColor.set(f.light.hemi[1]); hemi.intensity = f.light.hemi[2];
      sun.color.set(f.light.sun[0]); sun.intensity = f.light.sun[1];
      rim.color.set(f.light.rim[0]); rim.intensity = f.light.rim[1];
    },
  };
}

// ---------- weather: snow, rain, blowing sand, cherry petals ----------
function streak() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.9)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(30, 0, 4, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const WEATHER = {
  snow: { count: 2200, color: '#ffffff', size: 0.22, fall: 1.6, drift: 0.6, sway: 0.5, top: 30, opacity: 0.95 },
  rain: { count: 2600, color: '#c4d2e0', size: 0.55, fall: 18, drift: 1.5, sway: 0, top: 30, opacity: 0.5, streak: true },
  dust: { count: 1400, color: '#e2c08a', size: 0.5, fall: 0.15, drift: 6, sway: 0.4, top: 7, opacity: 0.35 },
  petals: { count: 900, color: '#ffc6d4', size: 0.2, fall: 0.9, drift: 1.2, sway: 1.4, top: 22, opacity: 0.95 },
};
export class Weather {
  constructor(scene) {
    this.scene = scene;
    this.points = null;
  }
  set(kind) {
    if (this.points) { this.scene.remove(this.points); this.points.geometry.dispose(); this.points.material.dispose(); this.points = null; }
    const w = WEATHER[kind];
    this.w = w;
    if (!w) return;
    const pos = new Float32Array(w.count * 3);
    this.seed = new Float32Array(w.count);
    for (let i = 0; i < w.count; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * 45;
      pos.set([Math.cos(a) * d, Math.random() * w.top, Math.sin(a) * d], i * 3);
      this.seed[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      color: w.color, size: w.size, map: w.streak ? streak() : DOT, transparent: true, opacity: w.opacity, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }
  update(dt, t) {
    if (!this.points) return;
    const w = this.w, p = this.points.geometry.attributes.position, a = p.array;
    for (let i = 0; i < w.count; i++) {
      const s = this.seed[i], k = i * 3;
      a[k] += (w.drift + Math.sin(t * 0.9 + s) * w.sway) * dt;
      a[k + 1] -= w.fall * (0.7 + (s % 1) * 0.6) * dt;
      a[k + 2] += Math.cos(t * 0.7 + s * 1.3) * w.sway * dt;
      if (a[k + 1] < -2 || a[k] > 45) {
        const ang = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * 45;
        a[k] = Math.cos(ang) * d - (w.drift > 2 ? 20 : 0); a[k + 1] = w.top * (0.6 + Math.random() * 0.4); a[k + 2] = Math.sin(ang) * d;
      }
    }
    p.needsUpdate = true;
  }
}

// ---------- the land around the arena ----------
function terrainHeight(x, z, R, g) {
  const d = Math.hypot(x, z);
  const cliff = THREE.MathUtils.smoothstep(d, R + 6, R + 9);
  let rough = ((fbm2(x * 0.06, z * 0.06) - 0.5) * 3 + (fbm2(x * 0.25, z * 0.25) - 0.5) * 0.8) * g.rough;
  if (g.dunes) {
    const warp = fbm2(x * 0.03, z * 0.03) * 6;
    rough += (1 - Math.abs(Math.sin(x * 0.09 + z * 0.04 + warp))) * 3.2 * THREE.MathUtils.smoothstep(d, R + 10, R + 30);
  }
  const ridge = 1 - Math.abs(fbm2(x * 0.018 + 3, z * 0.018 - 7) * 2 - 1);
  const mountains = THREE.MathUtils.smoothstep(d, 55, 140) * (18 + 40 * ridge * ridge) * g.mountains;
  return -10 * (1 - cliff) + cliff * (1.2 + rough + mountains);
}

function buildTerrain(R, g) {
  const size = 420, seg = 260;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const low = new THREE.Color(g.low), mid = new THREE.Color(g.mid), high = new THREE.Color(g.high), edge = new THREE.Color(g.edge);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z, R, g);
    pos.setY(i, h);
    const d = Math.hypot(x, z);
    c.copy(low).lerp(mid, THREE.MathUtils.clamp(fbm2(x * 0.15, z * 0.15) * 1.3 - 0.2, 0, 1));
    c.lerp(high, THREE.MathUtils.smoothstep(h, 10, 36));
    // The cliff walls above the moat (they glow over lava).
    c.lerp(edge, g.edgeAmount * (1 - THREE.MathUtils.smoothstep(h, -9.5, -6.5)) * (1 - THREE.MathUtils.smoothstep(d, R + 6, R + 12)));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  mesh.receiveShadow = true;
  return mesh;
}

// ---------- props: trees, ruins and the leftovers of each war ----------
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, ...extra });
function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

const TREES = {
  dead(t) {
    const tree = new THREE.Group(), wood = std(t.wood, { flatShading: false, roughness: 1 });
    const h = rand(2.5, 4.5);
    tree.add(mesh(new THREE.CylinderGeometry(0.08, 0.2, h, 6), wood, 0, h / 2, 0));
    for (let b = 0; b < 4; b++) {
      const len = rand(0.8, 1.6);
      const br = mesh(new THREE.CylinderGeometry(0.02, 0.07, len, 5), wood, 0, h * rand(0.45, 0.9), 0);
      br.rotation.z = rand(0.5, 1.1) * (b % 2 ? 1 : -1);
      br.rotation.y = rand(0, Math.PI * 2);
      br.translateY(len / 2);
      tree.add(br);
    }
    tree.rotation.set(rand(-0.15, 0.15), rand(0, 6), rand(-0.15, 0.15));
    return tree;
  },
  round(t, wide = 1) {
    const tree = new THREE.Group();
    const h = rand(1.8, 3.2);
    const trunk = mesh(new THREE.CylinderGeometry(0.12, 0.22, h, 6), std(t.wood), 0, h / 2, 0);
    trunk.rotation.z = rand(-0.12, 0.12);
    tree.add(trunk);
    const leaf = std(pick(t.leaf));
    for (let k = 0; k < 4; k++) {
      const s = rand(0.9, 1.5) * wide;
      const blob = mesh(new THREE.IcosahedronGeometry(1, 0), leaf, rand(-0.8, 0.8) * wide, h + rand(-0.2, 0.9), rand(-0.8, 0.8) * wide);
      blob.scale.set(s, s * 0.8, s);
      tree.add(blob);
    }
    tree.scale.setScalar(rand(0.8, 1.3));
    return tree;
  },
  blossom(t) { return TREES.round(t, 1.35); },
  palm(t) {
    const tree = new THREE.Group(), wood = std(t.wood);
    let x = 0, y = 0, lean = rand(0.05, 0.12);
    const dir = rand(0, Math.PI * 2);
    for (let k = 0; k < 6; k++) {
      const seg = mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.85, 6), wood, x, y + 0.42, 0);
      seg.rotation.z = -lean * k;
      tree.add(seg);
      x += Math.sin(lean * k) * 0.85; y += Math.cos(lean * k) * 0.82;
    }
    const leaf = std(pick(t.leaf), { side: THREE.DoubleSide });
    for (let k = 0; k < 8; k++) {
      const frond = new THREE.Group();
      const blade = mesh(new THREE.ConeGeometry(0.35, 2.4, 4), leaf, 0, 1.2, 0);
      blade.scale.z = 0.2;
      frond.add(blade);
      frond.position.set(x, y, 0);
      frond.rotation.set(0, (k / 8) * Math.PI * 2, rand(1.2, 1.9), 'YXZ');
      tree.add(frond);
    }
    tree.rotation.y = dir;
    return tree;
  },
};

const RUINS = {
  columns(r, place) {
    const mat = std(r.color);
    const a = rand(0, Math.PI * 2), d = rand(place.near + 1, place.near + 13);
    for (let k = 0; k < 4; k++) {
      const h = rand(0.6, 3.5);
      const col = mesh(new THREE.CylinderGeometry(0.42, 0.5, h, 10), mat);
      const o = place.at(col, d + rand(-2, 2), a + rand(-0.08, 0.08));
      o.position.y += h / 2 - 0.2;
      o.rotation.z = rand(-0.12, 0.12);
    }
    place.at(mesh(new THREE.BoxGeometry(rand(1, 2), 0.6, 0.8), mat), d + 1.5, a).position.y += 0.2;
  },
  farmhouse(r, place) {
    const g = new THREE.Group();
    const w = rand(3.5, 5), dpt = rand(2.5, 3.2), h = rand(1.8, 2.4);
    g.add(mesh(new THREE.BoxGeometry(w, h, dpt), std(r.color), 0, h / 2 - 0.2, 0));
    const rr = dpt * 0.62, roofGeo = new THREE.CylinderGeometry(rr, rr, w + 0.3, 3);
    roofGeo.rotateZ(Math.PI / 2).rotateX(-Math.PI / 2); // a triangular prism along x, ridge up
    const roof = mesh(roofGeo, std(r.roof), 0, h - 0.2 + rr * 0.5 * 0.7, 0);
    roof.scale.y = 0.7;
    g.add(roof);
    if (Math.random() < 0.5) { const wall = mesh(new THREE.BoxGeometry(0.4, h * 0.8, dpt * 1.6), std(r.color), w / 2 + 1.5, h * 0.4 - 0.2, 0); g.add(wall); }
    g.rotation.y = rand(0, Math.PI * 2);
    place.at(g, rand(place.near + 3, place.near + 22), rand(0, Math.PI * 2));
  },
  blocks(r, place) {
    // A bombed-out building: two broken walls with ragged tops and empty windows.
    const g = new THREE.Group(), mat = std(r.color);
    for (const side of [0, 1]) {
      const segs = Math.floor(rand(5, 8));
      for (let k = 0; k < segs; k++) {
        const h = rand(0.8, 5.5);
        if (Math.random() < 0.18) continue;
        const piece = mesh(new THREE.BoxGeometry(0.7, h, 0.35), mat, 0, h / 2 - 0.2, 0);
        if (side === 0) piece.position.x = k * 0.75; else { piece.position.z = k * 0.75; piece.rotation.y = Math.PI / 2; }
        g.add(piece);
        if (h > 2.4 && Math.random() < 0.6) {
          const lintel = mesh(new THREE.BoxGeometry(0.7, 0.3, 0.4), mat, piece.position.x, 1.6, piece.position.z);
          lintel.rotation.y = piece.rotation.y;
          g.add(lintel);
        }
      }
    }
    for (let k = 0; k < 6; k++) {
      const rub = mesh(new THREE.DodecahedronGeometry(rand(0.2, 0.6), 0), mat, rand(0, 4), 0, rand(0, 4));
      g.add(rub);
    }
    g.rotation.y = rand(0, Math.PI * 2);
    place.at(g, rand(place.near + 2, place.near + 24), rand(0, Math.PI * 2));
  },
  torii(r, place) {
    const g = new THREE.Group(), red = std(r.color, { flatShading: false, roughness: 0.6 }), black = std('#1c1816');
    for (const x of [-1.3, 1.3]) g.add(mesh(new THREE.CylinderGeometry(0.16, 0.2, 3.6, 10), red, x, 1.6, 0));
    g.add(mesh(new THREE.BoxGeometry(3.4, 0.22, 0.3), red, 0, 2.6, 0));
    g.add(mesh(new THREE.BoxGeometry(4.2, 0.28, 0.45), black, 0, 3.45, 0));
    g.add(mesh(new THREE.BoxGeometry(3.8, 0.2, 0.36), red, 0, 3.22, 0));
    const a = rand(0, Math.PI * 2);
    g.rotation.y = -a;
    place.at(g, rand(place.near + 1, place.near + 14), a);
  },
};

const EXTRAS = {
  cannon(e, place) {
    const g = new THREE.Group(), iron = std('#2a2a2a', { metalness: 0.6, roughness: 0.5, flatShading: false }), wood = std('#5a3e24');
    const barrel = mesh(new THREE.CylinderGeometry(0.13, 0.2, 1.9, 10), iron, 0, 0.75, 0.3);
    barrel.rotation.x = Math.PI / 2 - 0.12;
    g.add(barrel, mesh(new THREE.BoxGeometry(0.45, 0.3, 1.6), wood, 0, 0.45, -0.3));
    for (const x of [-0.38, 0.38]) {
      const wheel = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 14), wood, x, 0.5, 0.1);
      wheel.rotation.z = Math.PI / 2;
      g.add(wheel);
    }
    const a = rand(0, Math.PI * 2);
    g.rotation.y = Math.PI / 2 - a + Math.PI + rand(-0.3, 0.3); // aimed at the arena
    place.at(g, rand(place.near + 0.5, place.near + 8), a);
  },
  fence(e, place) {
    const g = new THREE.Group(), wood = std('#6a5236');
    for (let k = 0; k < 5; k++) g.add(mesh(new THREE.BoxGeometry(0.12, 1, 0.12), wood, k * 1.1, 0.3, 0));
    for (const y of [0.35, 0.7]) g.add(mesh(new THREE.BoxGeometry(4.6, 0.08, 0.06), wood, 2.2, y, 0));
    g.rotation.set(rand(-0.06, 0.06), rand(0, Math.PI * 2), 0);
    place.at(g, rand(place.near + 2, place.near + 30), rand(0, Math.PI * 2));
  },
  hedgehog(e, place) {
    const g = new THREE.Group(), steel = std('#3a3634', { metalness: 0.5, roughness: 0.6 });
    const beam = new THREE.BoxGeometry(0.12, 0.12, 1.7);
    for (const [rx, ry] of [[0.6, 0], [-0.6, Math.PI / 2], [0, Math.PI / 4]]) {
      const b = mesh(beam, steel, 0, 0.45, 0);
      b.rotation.set(rx, ry, rx ? 0 : Math.PI / 2);
      g.add(b);
    }
    g.rotation.y = rand(0, 3);
    place.at(g, rand(place.near, place.near + 20), rand(0, Math.PI * 2));
  },
  tank(e, place) {
    const g = new THREE.Group(), hull = std(e.color, { metalness: 0.3, roughness: 0.8 }), dark = std('#22201c');
    g.add(mesh(new THREE.BoxGeometry(1.8, 0.7, 3.2), hull, 0, 0.35, 0));
    for (const x of [-1.0, 1.0]) g.add(mesh(new THREE.BoxGeometry(0.4, 0.6, 3.4), dark, x, 0.3, 0));
    const turret = mesh(new THREE.CylinderGeometry(0.65, 0.75, 0.55, 8), hull, 0, 0.95, -0.2);
    const gun = mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.2, 8), dark, 0, 0.95, 1.0);
    gun.rotation.x = Math.PI / 2 - rand(-0.1, 0.3);
    const top = new THREE.Group();
    top.add(turret, gun);
    top.rotation.y = rand(-1, 1);
    g.add(top);
    g.rotation.set(rand(-0.12, 0.12), rand(0, Math.PI * 2), rand(-0.15, 0.15)); // knocked out, slightly tipped
    place.at(g, rand(place.near + 3, place.near + 24), rand(0, Math.PI * 2));
    return g;
  },
  shields(e, place) {
    const g = new THREE.Group(), bronze = std('#9a6a2c', { metalness: 0.7, roughness: 0.4, flatShading: false }), wood = std('#4a3826');
    const shield = mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 18), bronze, 0, 0.45, 0);
    shield.rotation.x = rand(1.0, 1.4);
    g.add(shield);
    for (let k = 0; k < 2; k++) {
      const spear = mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.6, 5), wood, rand(-0.8, 0.8), 1.1, rand(-0.6, 0.6));
      spear.rotation.set(rand(-0.3, 0.3), 0, rand(-0.3, 0.3));
      g.add(spear);
    }
    g.rotation.y = rand(0, 6);
    place.at(g, rand(place.near, place.near + 14), rand(0, Math.PI * 2));
  },
  lantern(e, place) {
    const g = new THREE.Group(), stone = std('#8a857a');
    g.add(mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.25, 6), stone, 0, 0, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.9, 6), stone, 0, 0.55, 0));
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.42, 0.5), new THREE.MeshStandardMaterial({ color: '#ffcf8a', emissive: '#ff9a3a', emissiveIntensity: 1.6 }), 0, 1.2, 0));
    g.add(mesh(new THREE.ConeGeometry(0.55, 0.4, 4), stone, 0, 1.6, 0));
    g.rotation.y = rand(0, 3);
    place.at(g, rand(place.near, place.near + 12), rand(0, Math.PI * 2));
  },
};

function buildProps(R, players, field) {
  const group = new THREE.Group();
  const g = field.ground, pr = field.props;
  const place = {
    near: R + 9,
    at(obj, d, a) {
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      obj.position.set(x, terrainHeight(x, z, R, g), z);
      group.add(obj);
      return obj;
    },
  };
  const rockMat = std(pr.rock, { roughness: 1 });
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  for (let i = 0; i < pr.rocks; i++) {
    const r = mesh(rockGeo, rockMat);
    r.scale.set(rand(0.5, 2.4), rand(0.4, 1.6), rand(0.5, 2.2));
    r.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    place.at(r, rand(R + 9, R + 45), rand(0, Math.PI * 2));
  }
  for (let i = 0; i < pr.trees.count; i++) place.at(TREES[pr.trees.kind](pr.trees), rand(R + 10, R + 42), rand(0, Math.PI * 2));
  for (let i = 0; i < pr.ruins.count; i++) RUINS[pr.ruins.kind](pr.ruins, place);
  const wrecks = [];
  for (const e of pr.extras) for (let i = 0; i < e.count; i++) {
    const obj = EXTRAS[e.kind](e, place);
    if (obj && e.kind === 'tank') wrecks.push(obj.position.clone());
  }
  // A war banner behind each army.
  const flags = [];
  const poleMat = new THREE.MeshStandardMaterial({ color: '#2a2018', roughness: 0.8, metalness: 0.2 });
  players.forEach((p, i) => {
    const a = Math.PI / 2 + (2 * Math.PI * i) / players.length;
    for (const off of [-0.07, 0.07]) {
      const pole = new THREE.Group();
      pole.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, 6, 8), poleMat, 0, 3, 0));
      const flagGeo = new THREE.PlaneGeometry(2.2, 1.3, 12, 6);
      flagGeo.translate(1.1, 0, 0);
      const flag = mesh(flagGeo, new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.8, side: THREE.DoubleSide }), 0, 5.2, 0);
      flag.userData.base = flagGeo.attributes.position.array.slice();
      pole.add(flag);
      flags.push(flag);
      pole.rotation.y = -a + Math.PI;
      place.at(pole, R + 9.5, a + off);
    }
  });
  return { group, flags, wrecks };
}

// ---------- the moat around the arena's rock ----------
const MOAT_HEAD = `uniform float uTime; uniform float uR; uniform vec3 uDeep, uShallow, uFoam; varying vec2 vW;
  ${NOISE}`;
const MOATS = {
  // A dark crust broken by glowing, slowly flowing veins.
  lava: `
    void main() {
      vec2 p = vW * 0.22;
      float flow = fbm(p * 0.7 + vec2(uTime * 0.02, -uTime * 0.015));
      float n = fbm(p * 1.6 + flow * 2.2 + vec2(-uTime * 0.03, uTime * 0.025));
      float veins = 1.0 - smoothstep(0.01, 0.05, abs(n - 0.5));
      float pools = smoothstep(0.7, 0.82, fbm(p * 0.9 - uTime * 0.01));
      float heat = clamp(veins + pools, 0.0, 1.0);
      float pulse = 0.85 + 0.15 * sin(uTime * 1.3 + flow * 12.0);
      vec3 crust = mix(vec3(0.05, 0.025, 0.02), vec3(0.16, 0.05, 0.02), fbm(p * 5.0));
      vec3 hot = mix(vec3(0.75, 0.12, 0.01), vec3(1.0, 0.6, 0.15), heat * heat);
      vec3 ember = vec3(0.25, 0.04, 0.0) * smoothstep(0.3, 0.7, flow);
      gl_FragColor = vec4(mix(crust + ember, hot * 1.3 * pulse, heat), 1.0);
    }`,
  // Moving water with foam where it breaks on the rock and the cliffs, and firelight on it.
  water: `
    uniform float uSpeed;
    void main() {
      float d = length(vW), ang = atan(vW.y, vW.x);
      vec2 flow = vec2(ang * uR * 0.25 + uTime * uSpeed, d * 0.25);
      vec2 p = mix(vW * 0.2 + uTime * 0.03, flow, step(0.5, uSpeed));
      float w = fbm(p * 1.3 + vec2(uTime * 0.05, uTime * 0.03)) * 0.65 + fbm(p * 3.1 - vec2(uTime * 0.09, -uTime * 0.07)) * 0.35;
      vec3 c = mix(uDeep, uShallow, smoothstep(0.35, 0.75, w));
      float glint = pow(noise(vW * 2.2 + uTime * 0.7) * noise(vW * 3.3 - uTime * 0.5), 2.5) * 1.6;
      float edge = max(1.0 - smoothstep(0.0, 1.2, abs(d - uR + 2.1)), smoothstep(uR + 5.0, uR + 7.5, d)); // the rock and the cliffs
      float foam = smoothstep(0.6, 0.8, w + edge * 0.3 + 0.08 * sin(uTime * 2.0 + d * 3.0)) * (0.12 + 0.75 * edge);
      c = mix(c, uFoam, clamp(foam, 0.0, 0.8)) + glint * uFoam * 0.25;
      c += vec3(1.0, 0.45, 0.15) * 0.2 * (1.0 - smoothstep(uR - 2.0, uR + 3.0, d));
      gl_FragColor = vec4(c, 1.0);
    }`,
  // A frozen river: pale ice, dark cracks and drifts of snow.
  ice: `
    void main() {
      vec2 p = vW * 0.25;
      float n = fbm(p * 1.5);
      float cracks = 1.0 - smoothstep(0.0, 0.025, abs(fbm(p * 2.2 + 3.0) - 0.5));
      vec3 c = mix(vec3(0.42, 0.55, 0.66), vec3(0.74, 0.83, 0.9), n);
      c = mix(c, vec3(0.12, 0.2, 0.3), cracks * 0.8);
      c = mix(c, vec3(0.88, 0.9, 0.93), smoothstep(0.55, 0.72, fbm(p * 0.8 + 7.0)));
      c += vec3(1.0, 0.5, 0.2) * 0.18 * (1.0 - smoothstep(uR - 2.0, uR + 3.0, length(vW)));
      gl_FragColor = vec4(c, 1.0);
    }`,
  // A sand pit with rippled dunes and drifting sand.
  sand: `
    void main() {
      vec2 p = vW * 0.2;
      float n = fbm(p);
      float rip = sin(dot(vW, vec2(1.3, 0.6)) * 3.0 + n * 8.0) * 0.5 + 0.5;
      vec3 c = mix(vec3(0.36, 0.25, 0.14), vec3(0.58, 0.43, 0.26), n);
      c *= 0.82 + 0.18 * rip;
      float drift = fbm(p * 2.0 + vec2(uTime * 0.35, uTime * 0.1));
      c = mix(c, vec3(0.72, 0.58, 0.4), smoothstep(0.6, 0.8, drift) * 0.35);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

// ---------- everything that depends on the board size ----------
export function buildArena(R, players = [], field) {
  const group = new THREE.Group();
  const uniforms = { uTime: { value: 0 } };

  const kind = field.moat === 'river' || field.moat === 'sea' ? 'water' : field.moat;
  const wc = field.water || { deep: '#000000', shallow: '#000000', foam: '#000000' };
  const lin = (hex, k) => hexVec(hex).multiplyScalar(k);
  const moat = new THREE.Mesh(new THREE.CircleGeometry(R + 30, 96), new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms, uR: { value: R }, uSpeed: { value: field.moat === 'river' ? 0.6 : 0.0 },
      uDeep: { value: lin(wc.deep, 1) }, uShallow: { value: lin(wc.shallow, 0.8) }, uFoam: { value: lin(wc.foam, 0.75) },
    },
    fog: false,
    vertexShader: 'varying vec2 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: MOAT_HEAD + MOATS[kind],
  }));
  moat.rotation.x = -Math.PI / 2;
  moat.position.y = -7;
  group.add(moat);
  const moatLight = new THREE.PointLight('#ff5a12', kind === 'lava' ? 80 : 0, 40, 1.4);
  moatLight.position.set(0, -5, 0);
  group.add(moatLight);

  // Rock pillar under the board.
  const pillarGeo = new THREE.CylinderGeometry(R + 0.55, R - 2.5, 7.5, 72, 6, true);
  const pp = pillarGeo.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
    if (y > 3.6) continue; // keep the top rim round
    const k = 1 + (fbm2(Math.atan2(z, x) * 4, y * 0.6) - 0.5) * 0.12;
    pp.setX(i, x * k); pp.setZ(i, z * k);
  }
  pillarGeo.computeVertexNormals();
  const rock = new THREE.Mesh(pillarGeo, new THREE.MeshStandardMaterial({ color: field.stone, roughness: 1, flatShading: true, side: THREE.DoubleSide }));
  rock.position.y = -3.95;
  group.add(rock);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R + 0.55, 0.22, 8, 96), new THREE.MeshStandardMaterial({ color: new THREE.Color(field.stone).multiplyScalar(1.3), roughness: 0.8 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = -0.18;
  group.add(rim);

  group.add(buildTerrain(R, field.ground));
  const props = buildProps(R, players, field);
  group.add(props.group);

  // Braziers on the rim.
  const count = Math.round(R * 1.1);
  const pillarMesh = new THREE.CylinderGeometry(0.18, 0.28, 1.1, 10);
  const pillarMat = new THREE.MeshStandardMaterial({ color: '#1d1714', roughness: 0.7, metalness: 0.3 });
  const brazier = billboards(count, FIRE_FRAG, uniforms, THREE.AdditiveBlending);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.13;
    const x = Math.cos(a) * (R + 1.1), z = Math.sin(a) * (R + 1.1);
    const p = new THREE.Mesh(pillarMesh, pillarMat);
    p.position.set(x, 0.3, z);
    p.castShadow = true;
    group.add(p);
    brazier.set(i, x, 0.8, z, 0.7, 1.3);
  }
  brazier.commit();
  group.add(brazier.mesh);

  // Campfires and burning wrecks out on the battlefield, each with a column of smoke.
  const camps = props.wrecks.map((p) => [p.x, p.y + 0.6, p.z]);
  for (let i = 0; i < field.props.camps; i++) {
    const a = Math.random() * Math.PI * 2, d = R + 11 + Math.random() * 20;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    camps.push([x, terrainHeight(x, z, R, field.ground), z]);
  }
  const campFire = billboards(camps.length * 3, FIRE_FRAG, uniforms, THREE.AdditiveBlending);
  const campSmoke = billboards(camps.length, SMOKE_FRAG, uniforms, THREE.NormalBlending);
  camps.forEach(([x, y, z], i) => {
    for (let k = 0; k < 3; k++) campFire.set(i * 3 + k, x + (k - 1) * 0.35, y - 0.1, z, 1.3, 2.4);
    campSmoke.set(i, x, y + 1.5, z, 5, 14);
  });
  campFire.commit(); campSmoke.commit();
  group.add(campFire.mesh, campSmoke.mesh);
  const campLight = new THREE.PointLight('#ff7a2a', 25, 18, 1.6);
  campLight.position.set(camps[0][0], camps[0][1] + 2, camps[0][2]);
  group.add(campLight);

  // The wall of fire marking the edge of the board, with smoke above it.
  const wallCount = Math.round(R * 2 * Math.PI / 0.42);
  const wall = billboards(wallCount, FIRE_FRAG, uniforms, THREE.AdditiveBlending);
  const smokeCount = Math.round(wallCount / 4);
  const wallSmoke = billboards(smokeCount, SMOKE_FRAG, uniforms, THREE.NormalBlending);
  const wallSizes = Array.from({ length: wallCount }, () => [1.0 + Math.random() * 0.5, 1.6 + Math.random() * 1.2]);
  function placeWall(radius) {
    for (let i = 0; i < wallCount; i++) {
      const a = (i / wallCount) * Math.PI * 2;
      wall.set(i, Math.cos(a) * radius, -0.05, Math.sin(a) * radius, wallSizes[i][0], wallSizes[i][1], i * 0.618);
    }
    for (let i = 0; i < smokeCount; i++) {
      const a = (i / smokeCount) * Math.PI * 2;
      wallSmoke.set(i, Math.cos(a) * (radius + 0.3), 1.2, Math.sin(a) * (radius + 0.3), 3.2, 6, i * 0.37);
    }
    wall.commit(); wallSmoke.commit();
  }
  placeWall(R);
  group.add(wall.mesh, wallSmoke.mesh);

  // Firelight cast on the board's edge.
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uHot: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uTime; uniform float uHot; varying vec2 vUv;
      void main() {
        float k = pow(vUv.y, 2.5);
        float flick = 0.8 + 0.2 * sin(uTime * 13.0 + vUv.x * 60.0) * sin(uTime * 7.0 + vUv.x * 23.0);
        gl_FragColor = vec4(vec3(1.0, 0.42, 0.1) * k * flick * (0.45 + 0.4 * uHot), 1.0);
      }`,
  });
  const glow = new THREE.Mesh(new THREE.RingGeometry(1 - 1.8 / R, 1, 128, 1), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.02;
  glow.scale.setScalar(R);
  group.add(glow);
  const fireLights = [0, 1, 2, 3].map(() => {
    const l = new THREE.PointLight('#ff6a1a', 0, 12, 1.5);
    group.add(l);
    return l;
  });

  let shown = R;
  return {
    group,
    update(t, radius, hot, camera) {
      uniforms.uTime.value = t;
      if (Math.abs(shown - radius) > 0.01) {
        shown += (radius - shown) * 0.04;
        placeWall(shown);
        glow.scale.setScalar(shown);
      }
      wall.mat.uniforms.uHeight.value = 1 + hot * 0.7 + 0.08 * Math.sin(t * 2.7);
      glowMat.uniforms.uHot.value = hot;
      // Keep a few lights on the stretch of fire nearest the camera.
      const ca = Math.atan2(camera.position.z, camera.position.x);
      fireLights.forEach((l, i) => {
        const a = ca + (i - 1.5) * 0.45;
        l.position.set(Math.cos(a) * shown, 1, Math.sin(a) * shown);
        l.intensity = (9 + hot * 6) * (0.8 + 0.2 * Math.sin(t * 11 + i * 2));
      });
      if (kind === 'lava') moatLight.intensity = 75 + 20 * Math.sin(t * 1.7);
      campLight.intensity = 22 + 6 * Math.sin(t * 9) * Math.sin(t * 5.1);
      for (const f of props.flags) {
        const pos = f.geometry.attributes.position, base = f.userData.base;
        for (let i = 0; i < pos.count; i++) {
          const x = base[i * 3];
          pos.setZ(i, Math.sin(x * 2.4 - t * 5 + f.id) * 0.18 * (x / 2.2));
        }
        pos.needsUpdate = true;
      }
    },
  };
}

// ---------- short-lived combat effects ----------
export class Effects {
  constructor(scene, particles) {
    this.scene = scene;
    this.particles = particles;
    this.items = [];
    this.shake = 0;
    this.lights = [0, 1, 2].map(() => {
      const l = new THREE.PointLight('#ffa040', 0, 12, 1.5);
      scene.add(l);
      return { light: l, life: 0 };
    });
  }
  flash(x, y, z, color, power = 40) {
    const slot = this.lights.reduce((a, b) => (a.life < b.life ? a : b));
    slot.light.position.set(x, y, z);
    slot.light.color.set(color);
    slot.light.intensity = power;
    slot.life = 0.5;
  }
  ring(x, z, color, size = 3, life = 0.6) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 48), new THREE.MeshBasicMaterial({
      color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.08, z);
    this.scene.add(m);
    this.items.push({ t: 0, life, update: (f) => { m.scale.setScalar(0.2 + f * size); m.material.opacity = 1 - f; }, dispose: () => { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); } });
  }
  smokePuff(x, z, count = 4) {
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: SMOKE, depthWrite: false, transparent: true }));
      s.position.set(x + (Math.random() - 0.5), 0.4, z + (Math.random() - 0.5));
      this.scene.add(s);
      const drift = [(Math.random() - 0.5) * 0.8, 1 + Math.random(), (Math.random() - 0.5) * 0.8];
      this.items.push({ t: 0, life: 2.2, update: (f, dt) => {
        s.position.x += drift[0] * dt; s.position.y += drift[1] * dt; s.position.z += drift[2] * dt;
        s.scale.setScalar(1 + f * 3); s.material.opacity = 0.9 * (1 - f);
      }, dispose: () => { this.scene.remove(s); s.material.dispose(); } });
    }
  }
  explosion(x, z, big = true) {
    this.particles.emit(x, 0.5, z, { color: '#ffb347', count: big ? 140 : 70, speed: big ? 5 : 3, up: 4, life: 1.1, gravity: 7 });
    this.particles.emit(x, 0.5, z, { color: '#ff4a1c', count: big ? 80 : 40, speed: 2.5, up: 6, life: 1.4, gravity: 5 });
    this.flash(x, 1.2, z, '#ff8a30', big ? 80 : 40);
    this.ring(x, z, '#ff7a30', big ? 4 : 2.5);
    this.smokePuff(x, z, big ? 5 : 3);
    this.shake = Math.max(this.shake, big ? 0.35 : 0.15);
  }
  clash(x, z) {
    this.particles.emit(x, 0.8, z, { color: '#cfe4ff', count: 70, speed: 4, up: 3, life: 0.7, gravity: 9 });
    this.flash(x, 1.2, z, '#9fc4ff', 30);
    this.ring(x, z, '#8fb8ff', 2);
    this.shake = Math.max(this.shake, 0.12);
  }
  dust(x, z) {
    this.particles.emit(x, 0.1, z, { color: '#7a5a3a', count: 12, speed: 1.2, up: 0.6, life: 0.6, gravity: 2 });
  }
  update(dt) {
    for (const it of this.items) { it.t += dt; it.update(Math.min(1, it.t / it.life), dt); }
    this.items = this.items.filter((it) => { if (it.t >= it.life) { it.dispose(); return false; } return true; });
    for (const l of this.lights) { l.life = Math.max(0, l.life - dt); l.light.intensity *= l.life > 0 ? 0.88 : 0; }
    this.shake *= Math.exp(-dt * 6);
  }
}

// A glowing arc from attacker to defender while a duel is open.
export function duelArc(from, to) {
  const mid = from.clone().add(to).multiplyScalar(0.5);
  mid.y += 1.6 + from.distanceTo(to) * 0.25;
  const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.045, 6), new THREE.MeshBasicMaterial({
    color: '#ff3b2f', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: FLAME, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  spark.scale.setScalar(0.7);
  const group = new THREE.Group();
  group.add(tube, spark);
  group.userData = {
    update(t) {
      tube.material.opacity = 0.45 + 0.35 * Math.sin(t * 8);
      spark.position.copy(curve.getPoint((t * 0.8) % 1));
    },
    dispose() { tube.geometry.dispose(); tube.material.dispose(); spark.material.dispose(); },
  };
  return group;
}

// ---------- the flag, in capture the flag ----------
export function buildFlag(radius) {
  const group = new THREE.Group();
  const gold = new THREE.Color('#ffd36b');

  // The circle on the ground you have to stand in.
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.16, radius, 72, 1), new THREE.MeshBasicMaterial({
    color: gold, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 72), new THREE.MeshBasicMaterial({
    color: gold, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.03;

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.4, 8), new THREE.MeshStandardMaterial({ color: '#2a2018', roughness: 0.7, metalness: 0.3 }));
  pole.position.y = 1.7;
  pole.castShadow = true;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshStandardMaterial({ color: '#ffd36b', metalness: 0.8, roughness: 0.25 }));
  knob.position.y = 3.45;

  const clothGeo = new THREE.PlaneGeometry(1.5, 0.95, 14, 7);
  clothGeo.translate(0.75, 0, 0);
  const clothMat = new THREE.MeshStandardMaterial({ color: '#f2e6cf', roughness: 0.75, side: THREE.DoubleSide, emissive: '#000000' });
  const cloth = new THREE.Mesh(clothGeo, clothMat);
  cloth.position.y = 2.85;
  cloth.castShadow = true;
  const base = clothGeo.attributes.position.array.slice();

  const light = new THREE.PointLight('#ffd36b', 14, 14, 1.6);
  light.position.y = 2.4;
  group.add(ring, disc, pole, knob, cloth, light);
  group.visible = false;

  return {
    group,
    // color: whoever holds the flag, or null; contested: more than one player on it.
    update(t, color, contested) {
      const c = color ? new THREE.Color(color) : gold;
      ring.material.color.copy(c);
      disc.material.color.copy(c);
      light.color.copy(c);
      clothMat.color.copy(color ? c : new THREE.Color('#f2e6cf'));
      clothMat.emissive.copy(c).multiplyScalar(contested ? 0.35 + 0.25 * Math.sin(t * 9) : 0.12);
      ring.material.opacity = 0.65 + 0.3 * Math.sin(t * (contested ? 7 : 2.2));
      light.intensity = 12 + 6 * Math.sin(t * 3);
      const pos = clothGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1];
        pos.setZ(i, Math.sin(x * 3.2 - t * 6 + y * 1.5) * 0.14 * (x / 1.5));
      }
      pos.needsUpdate = true;
    },
  };
}
