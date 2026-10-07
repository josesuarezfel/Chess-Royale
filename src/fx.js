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

// ---------- the world around the board ----------
export function buildWorld(scene) {
  scene.fog = new THREE.FogExp2('#24130e', 0.012);

  const sky = new THREE.Mesh(new THREE.SphereGeometry(160, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP;
      void main(){
        float h = vP.y;
        vec3 horizon = vec3(0.42, 0.16, 0.07);
        vec3 top = vec3(0.05, 0.035, 0.05);
        vec3 below = vec3(0.12, 0.03, 0.01);
        vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, below, pow(-h, 0.4));
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  scene.add(sky);

  scene.add(new THREE.HemisphereLight('#ffcf9a', '#1a1014', 0.55));
  const sun = new THREE.DirectionalLight('#ffb27a', 2.4);
  sun.position.set(-16, 22, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 90 });
  scene.add(sun);
  const rim = new THREE.DirectionalLight('#6f86ff', 0.5);
  rim.position.set(14, 10, -18);
  scene.add(rim);
  return { sun };
}

// Everything that depends on the board size.
export function buildArena(R) {
  const group = new THREE.Group();
  const uniforms = { uTime: { value: 0 } };

  // Lava far below the board: collapsed squares fall into it.
  const lava = new THREE.Mesh(new THREE.CircleGeometry(R + 40, 64), new THREE.ShaderMaterial({
    uniforms, fog: false,
    vertexShader: 'varying vec2 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uTime; varying vec2 vW;
      void main(){
        vec2 p = vW * 0.35;
        float n = sin(p.x * 1.3 + uTime * 0.5) * sin(p.y * 1.1 - uTime * 0.35)
                + 0.5 * sin(p.x * 3.1 - uTime * 1.1 + p.y * 2.3)
                + 0.25 * sin(p.y * 6.0 + uTime * 1.7 + p.x);
        float d = length(vW);
        vec3 c = mix(vec3(0.25, 0.02, 0.0), vec3(1.0, 0.42, 0.04), smoothstep(-0.5, 1.3, n));
        c *= 1.0 - smoothstep(10.0, 60.0, d) * 0.85;
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  lava.rotation.x = -Math.PI / 2;
  lava.position.y = -6;
  group.add(lava);
  const lavaLight = new THREE.PointLight('#ff6a1a', 60, 30, 1.6);
  lavaLight.position.set(0, -4, 0);
  group.add(lavaLight);

  // Rock pillar the board stands on.
  const rock = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.55, R - 1.5, 6, 72, 4, true),
    new THREE.MeshStandardMaterial({ color: '#2a201c', roughness: 0.95, side: THREE.DoubleSide }));
  rock.position.y = -3.25;
  group.add(rock);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R + 0.55, 0.22, 8, 96), new THREE.MeshStandardMaterial({ color: '#3a2c24', roughness: 0.8 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = -0.18;
  group.add(rim);

  // Braziers around the rim.
  const flames = [];
  const pillarGeo = new THREE.CylinderGeometry(0.18, 0.28, 1.1, 10);
  const pillarMat = new THREE.MeshStandardMaterial({ color: '#1d1714', roughness: 0.7, metalness: 0.3 });
  const count = Math.round(R * 1.1);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.13;
    const x = Math.cos(a) * (R + 1.1), z = Math.sin(a) * (R + 1.1);
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.set(x, 0.3, z);
    pillar.castShadow = true;
    group.add(pillar);
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: FLAME, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    flame.position.set(x, 1.15, z);
    flame.userData.seed = Math.random() * 100;
    group.add(flame);
    flames.push(flame);
  }

  // The fire wall marks the edge of the board and moves in as it shrinks.
  const wallMat = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uHot: { value: 0 } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uTime; uniform float uHot; varying vec2 vUv;
      void main(){
        float x = vUv.x * 6.2831853;
        float flick = 0.5 + 0.25 * sin(x * 37.0 + uTime * 5.0) + 0.25 * sin(x * 91.0 - uTime * 7.3);
        float tongues = smoothstep(0.0, 1.0, flick + 0.35 - vUv.y * 1.2);
        float a = min(1.0, tongues * (1.0 - vUv.y) * (0.8 + 0.7 * uHot));
        vec3 c = mix(vec3(1.0, 0.8, 0.35), vec3(0.95, 0.18, 0.04), vUv.y + 0.2);
        gl_FragColor = vec4(c * a, a);
      }`,
  });
  const wallGeo = new THREE.CylinderGeometry(1, 1, 1, 160, 1, true);
  wallGeo.translate(0, 0.5, 0);
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.scale.set(R, 1.6, R);
  wall.userData.radius = R;
  group.add(wall);

  // Drifting smoke.
  const smoke = [];
  for (let i = 0; i < 18; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: SMOKE, depthWrite: false, transparent: true, opacity: 0.5 }));
    const a = Math.random() * Math.PI * 2, d = R * (0.6 + Math.random() * 0.7);
    s.position.set(Math.cos(a) * d, 1 + Math.random() * 3, Math.sin(a) * d);
    s.scale.setScalar(5 + Math.random() * 6);
    s.userData = { a, d, speed: 0.02 + Math.random() * 0.04, y: s.position.y };
    group.add(s);
    smoke.push(s);
  }

  return {
    group, wall, flames, smoke, uniforms, lavaLight,
    update(t, radius, hot) {
      uniforms.uTime.value = t;
      wallMat.uniforms.uHot.value = hot;
      const shown = wall.userData.radius;
      wall.userData.radius = shown + (radius - shown) * 0.04;
      wall.scale.set(wall.userData.radius, 1.8 + hot * 1.2 + 0.2 * Math.sin(t * 3), wall.userData.radius);
      for (const f of flames) {
        const k = 0.75 + 0.25 * Math.sin(t * 9 + f.userData.seed) * Math.sin(t * 5.3 + f.userData.seed * 2);
        f.scale.set(0.9 * k, 1.3 * k, 1);
      }
      for (const s of smoke) {
        s.userData.a += s.userData.speed * 0.016;
        s.position.x = Math.cos(s.userData.a) * s.userData.d;
        s.position.z = Math.sin(s.userData.a) * s.userData.d;
        s.position.y = s.userData.y + Math.sin(t * 0.3 + s.userData.d) * 0.5;
      }
      lavaLight.intensity = 50 + 15 * Math.sin(t * 2.1);
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
