import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  newGame, legalMoves, move, startAttack, defend, tick, eligibleGuards, bidLimits, isPlayable, isDoomed,
  isReady, findPiece, cellCenter, pointsByPlayer, PIECE_NAMES, START_POINTS, inFlag, flagHolders,
} from './rules.js';
import { botAct, botDefense } from './bot.js';
import { Particles, Effects, Weather, buildWorld, buildArena, duelArc, buildFlag } from './fx.js';
import { FIELDS, fieldById } from './fields.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const BOT_ANSWER_DELAY = 1200; // bots "think" this long before answering an attack, so the duel shows

// ---------- renderer and camera ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
$('view').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = 1.32;
controls.minDistance = 6;
controls.autoRotateSpeed = 0.5;

const world = buildWorld(scene);
const weather = new Weather(scene);
let field = null;
let mode = 'royale'; // 'royale' or 'flag'
try { if (localStorage.getItem('chessRoyale.mode') === 'flag') mode = 'flag'; } catch { /* no saved choice */ }
try { field = fieldById(localStorage.getItem('chessRoyale.field')); } catch { field = FIELDS[0]; }
const particles = new Particles(scene);
const fx = new Effects(scene, particles);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  placeCamera();
}
window.addEventListener('resize', resize);

// ---------- piece models ----------
const V = (x, y) => new THREE.Vector2(x, y);
const BASE = [V(0, 0), V(0.38, 0), V(0.38, 0.07), V(0.31, 0.11), V(0.25, 0.15)];
const lathe = (pts) => new THREE.LatheGeometry([...BASE, ...pts], 28);
const GEOMS = {
  P: { parts: [[lathe([V(0.13, 0.22), V(0.1, 0.42), V(0.17, 0.47), V(0.06, 0.5), V(0, 0.5)])],
    [new THREE.SphereGeometry(0.16, 20, 14), [0, 0.62, 0]]], height: 0.78 },
  R: { parts: [[lathe([V(0.22, 0.2), V(0.19, 0.62), V(0.28, 0.66), V(0.28, 0.88), V(0.2, 0.88), V(0.2, 0.8), V(0, 0.8)])],
    ...[0, 1, 2, 3].map((i) => [new THREE.BoxGeometry(0.1, 0.12, 0.1), [Math.cos(i * Math.PI / 2) * 0.22, 0.94, Math.sin(i * Math.PI / 2) * 0.22]])], height: 1.0 },
  B: { parts: [[lathe([V(0.15, 0.25), V(0.11, 0.62), V(0.2, 0.66), V(0.08, 0.7), V(0, 0.7)])],
    [new THREE.SphereGeometry(0.17, 20, 14), [0, 0.84, 0], [1, 1.35, 1]],
    [new THREE.SphereGeometry(0.06, 12, 8), [0, 1.08, 0]]], height: 1.12 },
  N: { parts: [[lathe([V(0.2, 0.22), V(0, 0.22)])],
    [new THREE.BoxGeometry(0.26, 0.55, 0.32), [0, 0.47, -0.04], null, [-0.25, 0, 0]],
    [new THREE.BoxGeometry(0.22, 0.22, 0.48), [0, 0.74, 0.08], null, [0.35, 0, 0]],
    [new THREE.BoxGeometry(0.08, 0.14, 0.08), [0.07, 0.9, -0.07]],
    [new THREE.BoxGeometry(0.08, 0.14, 0.08), [-0.07, 0.9, -0.07]]], height: 0.98 },
  Q: { parts: [[lathe([V(0.18, 0.28), V(0.12, 0.82), V(0.24, 0.9), V(0.2, 1.0), V(0, 1.0)])],
    ...[0, 1, 2, 3, 4].map((i) => [new THREE.SphereGeometry(0.045, 8, 6), [Math.cos(i * 1.2566) * 0.2, 1.03, Math.sin(i * 1.2566) * 0.2]]),
    [new THREE.SphereGeometry(0.09, 14, 10), [0, 1.08, 0]]], height: 1.16 },
  K: { parts: [[lathe([V(0.19, 0.3), V(0.13, 0.88), V(0.25, 0.95), V(0.21, 1.06), V(0, 1.06)])],
    [new THREE.BoxGeometry(0.07, 0.28, 0.07), [0, 1.2, 0]],
    [new THREE.BoxGeometry(0.22, 0.07, 0.07), [0, 1.22, 0]]], height: 1.34 },
};
const RING_GEO = new THREE.RingGeometry(0.33, 0.44, 32);

function buildPiece(piece, color) {
  const group = new THREE.Group();
  const spec = GEOMS[piece.type];
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.35, emissive: '#000000' });
  for (const [geom, pos, scale, rot] of spec.parts) {
    const mesh = new THREE.Mesh(geom, mat);
    if (pos) mesh.position.set(...pos);
    if (scale) mesh.scale.set(...scale);
    if (rot) mesh.rotation.set(...rot);
    mesh.castShadow = true;
    mesh.userData.pieceId = piece.id;
    group.add(mesh);
  }
  // A glowing team ring on the ground.
  const ring = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.015;
  group.add(ring);
  const label = makeLabel();
  label.position.y = spec.height + 0.3;
  group.add(label);
  group.userData = { label, mat, hp: null, color, ring };
  return group;
}

function makeLabel() {
  const canvas = document.createElement('canvas');
  canvas.width = 160; canvas.height = 56;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(0.8, 0.28, 1);
  sprite.renderOrder = 10;
  sprite.userData.canvas = canvas;
  return sprite;
}
// Health bar: team-coloured frame, fill from green to red, points on the left.
function drawLabel(sprite, piece, color) {
  const c = sprite.userData.canvas, g = c.getContext('2d');
  const f = Math.max(0, Math.min(1, piece.hp / START_POINTS[piece.type]));
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(12,8,6,.85)';
  g.beginPath(); g.roundRect(4, 8, 152, 40, 10); g.fill();
  g.strokeStyle = color; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#fff';
  g.font = 'bold 30px Inter, system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(piece.hp), 32, 29);
  g.fillStyle = 'rgba(255,255,255,.12)';
  g.fillRect(60, 20, 86, 16);
  g.fillStyle = `hsl(${Math.round(f * 110)}, 75%, 50%)`;
  g.fillRect(60, 20, 86 * f, 16);
  sprite.material.map.needsUpdate = true;
}

// ---------- game state ----------
let state = null;
let humanId = null; // null while the menu shows a battle between computer players
let arena = null;
let flagMarker = null;
let tiles = null, tileCells = [], tileFall = [], tileScorch = [], tileJitter = [];
const tileIndex = new Map();
const pieceObjs = new Map();
const arcs = new Map(); // duel id -> arc
let selectedId = null;
let pendingAttack = null;
let shownDuelId = null;
let botWake = [];
let lastSlow = 0;

const selRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 40), new THREE.MeshBasicMaterial({ color: '#ffd36b', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
selRing.rotation.x = -Math.PI / 2;
selRing.visible = false;
scene.add(selRing);

const COLORS = {
  light: new THREE.Color('#a8906c'), dark: new THREE.Color('#4a3a2c'), scorch: new THREE.Color('#1a1210'),
  move: new THREE.Color('#79c46a'), capture: new THREE.Color('#ff3b2f'), doom: new THREE.Color('#ff4a12'), sel: new THREE.Color('#ffd36b'),
  flag: new THREE.Color('#ffd36b'),
};
const tmpC = new THREE.Color();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3(1, 1, 1);

function startGame(players, human) {
  const now = performance.now();
  humanId = human ? 0 : null;
  state = newGame(players, { humans: human ? [0] : [], now, config: { mode } });
  botWake = state.players.map(() => now + 1500 + Math.random() * 2000);
  selectedId = null; pendingAttack = null; shownDuelId = null;
  buildBoard();
  $('attack-panel').hidden = true;
  $('defend-panel').hidden = true;
  $('feed').innerHTML = '';
  controls.autoRotate = !human;
  document.body.classList.toggle('flag-mode', state.mode === 'flag');
  updateSlow(now);
}

function buildBoard() {
  if (arena) { scene.remove(arena.group); }
  if (tiles) { scene.remove(tiles); tiles.geometry.dispose(); tiles.material.dispose(); }
  for (const obj of pieceObjs.values()) scene.remove(obj);
  pieceObjs.clear();
  for (const a of arcs.values()) { scene.remove(a); a.userData.dispose(); }
  arcs.clear();

  const R = state.config.boardRadius;
  if (flagMarker) scene.remove(flagMarker.group);
  flagMarker = state.mode === 'flag' ? buildFlag(state.config.flagRadius) : null;
  if (flagMarker) scene.add(flagMarker.group);
  world.setField(field);
  renderer.toneMappingExposure = field.light.exposure;
  weather.set(field.weather);
  COLORS.light.set(field.board.light);
  COLORS.dark.set(field.board.dark);
  arena = buildArena(R, state.players, field);
  scene.add(arena.group);

  tileCells = [];
  tileIndex.clear();
  for (let r = 0; r < state.size; r++) for (let c = 0; c < state.size; c++) if (isPlayable(state, r, c)) {
    tileIndex.set(r * 1000 + c, tileCells.length);
    tileCells.push([r, c]);
  }
  tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.97, 0.3, 0.97), new THREE.MeshStandardMaterial({ roughness: 0.92 }), tileCells.length);
  tiles.receiveShadow = true;
  tileFall = tileCells.map(() => null);
  tileScorch = tileCells.map(() => 0);
  tileJitter = tileCells.map(() => ({ h: (Math.random() - 0.5) * 0.06, shade: 0.85 + Math.random() * 0.3, spin: (Math.random() - 0.5) * 4 }));
  tileCells.forEach(([r, c], i) => {
    const { x, y } = cellCenter(state, r, c);
    tmpM.makeTranslation(x, -0.15 + tileJitter[i].h, y);
    tiles.setMatrixAt(i, tmpM);
    tiles.setColorAt(i, COLORS.light);
  });
  scene.add(tiles);

  placeCamera();
}

// Pull the camera back on narrow screens so the whole board fits.
function placeCamera() {
  if (!state) return;
  const R = state.config.boardRadius;
  const fit = Math.max(1, 1.15 / camera.aspect);
  camera.position.set(0, R * 1.6 * fit, R * 1.95 * fit);
  controls.target.set(0, 0, R * 0.3);
  controls.maxDistance = R * 3.6 * fit;
  controls.update();
}

function worldPos(r, c, y = 0) {
  const { x, y: z } = cellCenter(state, r, c);
  return new THREE.Vector3(x, y, z);
}

// ---------- per-frame sync ----------
function syncPieces(now, dt) {
  const seen = new Set();
  const inDuel = new Set(state.duels.flatMap((d) => [d.attackerId, d.defenderId]));
  for (let r = 0; r < state.size; r++) for (let c = 0; c < state.size; c++) {
    const p = state.board[r][c];
    if (!p) continue;
    seen.add(p.id);
    const color = state.players[p.owner].color;
    let obj = pieceObjs.get(p.id);
    const { x, y } = cellCenter(state, r, c);
    if (!obj) {
      obj = buildPiece(p, color);
      obj.position.set(x, 0, y);
      obj.rotation.y = Math.atan2(-x, -y); // face the centre
      pieceObjs.set(p.id, obj);
      scene.add(obj);
    }
    const dx = x - obj.position.x, dz = y - obj.position.z;
    const dist = Math.hypot(dx, dz);
    const k = 1 - Math.exp(-dt * 9);
    obj.position.x += dx * k;
    obj.position.z += dz * k;
    const wasMoving = obj.userData.moving;
    obj.userData.moving = dist > 0.05;
    obj.position.y = Math.min(0.9, dist * 0.35);
    if (wasMoving && !obj.userData.moving) fx.dust(x, y);
    if (obj.userData.hp !== p.hp) { drawLabel(obj.userData.label, p, color); obj.userData.hp = p.hp; }
    const fighting = inDuel.has(p.id);
    obj.userData.mat.emissive.set(fighting ? '#ff2a10' : '#000000');
    obj.userData.mat.emissiveIntensity = fighting ? 0.35 + 0.35 * Math.sin(now / 90) : 0;
    obj.children[0].position.x = fighting ? Math.sin(now / 30) * 0.02 : 0;
    // While you defend, protecting pieces glow: gold if they're in, white if they could be.
    const ring = obj.userData.ring;
    const canGuard = defendGuards.some((g) => g.piece.id === p.id);
    if (canGuard) {
      const picked = defendPick.has(p.id);
      ring.material.color.set(picked ? '#ffd36b' : '#ffffff');
      ring.scale.setScalar((picked ? 1.35 : 1.15) + (p.id === hoverGuardId ? 0.25 : 0) + 0.08 * Math.sin(now / 120));
    } else if (ring.scale.x !== 1) {
      ring.material.color.set(color);
      ring.scale.setScalar(1);
    }
  }
  for (const [id, obj] of pieceObjs) {
    if (seen.has(id)) continue;
    if (!obj.userData.dying) {
      obj.userData.dying = true;
      particles.emit(obj.position.x, 0.6, obj.position.z, { color: obj.userData.color, count: 60, speed: 3, up: 4, life: 1, gravity: 8 });
      fx.smokePuff(obj.position.x, obj.position.z, 3);
    }
    obj.position.y += dt * 2;
    obj.rotation.z += dt * 4;
    obj.scale.multiplyScalar(Math.max(0, 1 - dt * 3.5));
    if (obj.scale.x < 0.05) { scene.remove(obj); pieceObjs.delete(id); }
  }
  const sel = selectedId != null && pieceObjs.get(selectedId);
  selRing.visible = !!sel;
  if (sel) {
    selRing.position.set(sel.position.x, 0.03, sel.position.z);
    selRing.scale.setScalar(1 + 0.08 * Math.sin(now / 150));
  }
}

function syncTiles(now) {
  const sel = selectedId != null ? findPiece(state, selectedId) : null;
  const targets = sel ? legalMoves(state, sel[0], sel[1]) : [];
  const marks = new Map(targets.map((m) => [m.r * 1000 + m.c, m.capture ? 'capture' : 'move']));
  const pulse = 0.5 + 0.5 * Math.sin(now / 140);
  let moved = false;
  tileCells.forEach(([r, c], i) => {
    const j = tileJitter[i];
    if (!isPlayable(state, r, c)) {
      if (tileFall[i] == null) {
        tileFall[i] = now;
        if (Math.random() < 0.35) { const p = worldPos(r, c); particles.emit(p.x, 0, p.z, { color: '#ff7a2a', count: 6, speed: 1, up: 2, life: 1.2, gravity: 2 }); }
      }
      const t = (now - tileFall[i]) / 1000;
      if (t < 2.5) {
        const p = worldPos(r, c);
        tmpV.set(p.x, -0.15 - 5 * t * t, p.z);
        tmpQ.setFromEuler(new THREE.Euler(j.spin * t, 0, j.spin * 0.6 * t));
        tiles.setMatrixAt(i, tmpM.compose(tmpV, tmpQ, tmpS));
        moved = true;
      }
      tiles.setColorAt(i, tmpC.set('#ff5a1a').lerp(COLORS.scorch, Math.min(1, t)));
      return;
    }
    tmpC.copy((r + c) % 2 ? COLORS.dark : COLORS.light).multiplyScalar(j.shade);
    if (tileScorch[i] > 0) tmpC.lerp(COLORS.scorch, tileScorch[i]);
    if (isDoomed(state, r, c, now)) tmpC.lerp(COLORS.doom, 0.35 + 0.45 * pulse);
    if (state.mode === 'flag' && inFlag(state, r, c)) tmpC.lerp(COLORS.flag, 0.22 + 0.12 * pulse);
    const mark = marks.get(r * 1000 + c);
    if (mark) tmpC.lerp(COLORS[mark], mark === 'capture' ? 0.55 + 0.3 * pulse : 0.6);
    tiles.setColorAt(i, tmpC);
  });
  tiles.instanceColor.needsUpdate = true;
  if (moved) tiles.instanceMatrix.needsUpdate = true;
}

function scorch(r, c, amount) {
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const i = tileIndex.get((r + dr) * 1000 + (c + dc));
    if (i == null) continue;
    tileScorch[i] = Math.min(0.75, tileScorch[i] + (dr || dc ? amount * 0.4 : amount));
  }
}

function syncArcs(t) {
  const live = new Set(state.duels.map((d) => d.id));
  for (const [id, arc] of arcs) if (!live.has(id)) { scene.remove(arc); arc.userData.dispose(); arcs.delete(id); }
  for (const d of state.duels) {
    if (!arcs.has(d.id)) {
      const a = findPiece(state, d.attackerId), b = findPiece(state, d.defenderId);
      if (!a || !b) continue;
      const arc = duelArc(worldPos(...a, 0.9), worldPos(...b, 0.9));
      arcs.set(d.id, arc);
      scene.add(arc);
    }
    arcs.get(d.id).userData.update(t);
  }
}

// ---------- events from the rules ----------
const me = () => (humanId == null ? null : state.players[humanId]);

function banner(text, sub = '') {
  const el = $('banner');
  el.innerHTML = `${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

function feed(text) {
  const li = document.createElement('li');
  li.textContent = text;
  $('feed').prepend(li);
  while ($('feed').children.length > 7) $('feed').lastChild.remove();
}

function handleEvents() {
  for (const e of state.events.splice(0)) {
    if (e.kind === 'duel') {
      const at = worldPos(...e.to);
      if (e.success) { fx.explosion(at.x, at.z, e.defenderType === 'K' || e.attackBid >= 8); scorch(...e.to, 0.45); }
      else fx.clash(at.x, at.z);
      if (humanId == null) continue;
      const a = state.players[e.attackOwner].name, d = state.players[e.defendOwner].name;
      const guards = e.guards.length ? e.guards.map((g) => `${PIECE_NAMES[g.type]} ${g.bid}`).join(' + ') : 'no guards';
      if (e.attackOwner === humanId) {
        feed(e.success ? `⚔ Your ${PIECE_NAMES[e.attackerType]} took a ${d} ${PIECE_NAMES[e.defenderType]} (${e.attackBid} vs ${e.totalDefense})` : `🛡 ${d} held: ${guards} beat your ${e.attackBid}`);
      } else if (e.defendOwner === humanId) {
        feed(e.success ? `💀 ${a} took your ${PIECE_NAMES[e.defenderType]} (${e.attackBid} vs ${e.totalDefense})` : `🛡 Your guards held off ${a} (${e.totalDefense} vs ${e.attackBid})`);
      } else if (e.success) {
        feed(`⚔ ${a} took a ${d} ${PIECE_NAMES[e.defenderType]}`);
      }
    } else if (e.kind === 'eliminated') {
      if (humanId == null) continue;
      const name = state.players[e.owner].name;
      if (e.owner === humanId) banner('Your king has fallen', 'You are out of the war');
      else banner(`${name} has fallen`, e.reason === 'king captured' ? 'Their king was captured' : 'Their king was lost to the fire');
      feed(`👑 ${name} is out`);
    } else if (e.kind === 'flag') {
      if (humanId != null) { banner('A new flag', 'Get a piece inside the circle'); feed('🚩 A flag went up somewhere else'); }
    } else if (e.kind === 'respawn') {
      const at = worldPos(...e.at);
      fx.ring(at.x, at.z, state.players[e.owner].color, 2.2, 0.8);
      particles.emit(at.x, 0.4, at.z, { color: state.players[e.owner].color, count: 40, speed: 2, up: 3, life: 0.9, gravity: 4 });
      if (e.owner === humanId) feed(`✨ Your ${PIECE_NAMES[e.type]} is back`);
    } else if (e.kind === 'shrink') {
      fx.shake = Math.max(fx.shake, 0.3);
      if (humanId != null) banner('The firestorm closes in');
    } else if (e.kind === 'gameOver') {
      if (humanId == null) { setTimeout(() => startGame(6, false), 4000); continue; }
      setTimeout(showGameOver, 1800);
    }
  }
}

function showGameOver() {
  const w = state.winner;
  $('gameover-title').textContent = w === humanId ? 'Victory' : w == null ? 'Draw' : 'Defeat';
  if (state.mode === 'flag') {
    $('gameover-text').textContent = w === humanId
      ? `You held the flags to ${state.scores[w]} points.`
      : `${state.players[w].name} reached ${state.scores[w]} points. You finished on ${state.scores[humanId]}.`;
  } else {
    $('gameover-text').textContent = w === humanId ? 'Your king is the last one standing.' : w == null ? 'No king survived.' : `${state.players[w].name} rules the battlefield.`;
  }
  $('gameover').hidden = false;
  $('attack-panel').hidden = true;
  $('defend-panel').hidden = true;
}

// ---------- HUD ----------
function updateHud(now) {
  const m = me();
  if (!m) return;
  const wait = Math.max(0, m.readyAt - now);
  const frac = m.alive ? 1 - wait / state.config.cooldown : 0;
  $('ready-ring').style.strokeDashoffset = String(119.4 * (1 - frac));
  document.querySelector('.commander').classList.toggle('waiting', wait > 0);
  $('ready-text').textContent = !m.alive ? 'Defeated' : wait > 0 ? `${(wait / 1000).toFixed(1)}s` : 'Ready';

  const storm = $('storm');
  if (state.mode === 'flag') {
    const left = Math.max(0, (state.flag ? state.flag.until - now : 0) / 1000);
    const hot = left <= 6;
    $('storm-label').textContent = 'Flag moves in';
    $('storm-text').textContent = `${left.toFixed(1)}s`;
    storm.classList.toggle('hot', hot);
  } else if (state.radius <= state.config.minRadius) {
    $('storm-text').textContent = 'Spent';
    storm.classList.remove('hot');
  } else {
    const s = Math.max(0, (state.nextShrinkAt - now) / 1000);
    const hot = s <= state.config.shrinkWarning / 1000;
    $('storm-text').textContent = hot ? `Closing ${s.toFixed(1)}s` : `${Math.floor(s / 60)}:${String(Math.ceil(s) % 60).padStart(2, '0')}`;
    storm.classList.toggle('hot', hot);
  }

  let hint = '';
  if (!m.alive) hint = 'Watch the war play out.';
  else if (pendingAttack) hint = 'Choose how many points to attack with.';
  else if (state.mode === 'flag' && selectedId == null) hint = 'Move pieces into the flag circle to score.';
  else if (selectedId != null) hint = 'Green: move. Red: attack. Click elsewhere to cancel.';
  else hint = 'Click one of your pieces.';
  $('hint').textContent = hint;

  updateAttackPanel();
  updateDefendPanel(now);
}

function updateSlow(now) {
  lastSlow = now;
  if (humanId == null) return;
  const flagging = state.mode === 'flag';
  const holders = flagging ? flagHolders(state) : new Set();
  const totals = pointsByPlayer(state);
  $('armies-label').textContent = flagging ? `First to ${state.config.targetScore}` : 'Armies';
  $('players').innerHTML = state.players.map((p, i) => {
    const val = flagging ? state.scores[i] : totals[i];
    const pct = Math.min(100, (100 * val) / (flagging ? state.config.targetScore : 147));
    return `<li class="${p.alive ? '' : 'out'}"><span class="crest" style="background:${p.color};color:${p.color}"></span>` +
      `<span class="name">${esc(p.name)}${p.human ? ' (you)' : ''}${holders.has(i) ? ' 🚩' : ''}</span>` +
      `<span class="pts">${p.alive ? val : '☠'}</span>` +
      `<span class="bar"><i style="width:${p.alive ? pct : 0}%;background:${p.color}"></i></span></li>`;
  }).join('');
}

// ---------- attacking ----------
function protectors(targetAt) {
  const target = state.board[targetAt[0]][targetAt[1]];
  return eligibleGuards(state, { defenderId: target.id });
}
function openAttack(pieceId, targetId) {
  pendingAttack = { pieceId, targetId };
  const at = findPiece(state, pieceId);
  const p = state.board[at[0]][at[1]];
  const { min, max } = bidLimits(p, 'attack');
  const s = $('attack-bid');
  s.min = min; s.max = max;
  const guards = protectors(findPiece(state, targetId));
  s.value = guards.length ? Math.max(min, Math.min(max, Math.ceil(max / 2))) : min;
  $('attack-out').textContent = s.value;
  $('attack-panel').hidden = false;
  updateAttackPanel();
}
function closeAttack() {
  pendingAttack = null;
  $('attack-panel').hidden = true;
}
function updateAttackPanel() {
  if (!pendingAttack) return;
  const a = findPiece(state, pendingAttack.pieceId), d = findPiece(state, pendingAttack.targetId);
  if (!a || !d) { closeAttack(); return; }
  const ap = state.board[a[0]][a[1]], dp = state.board[d[0]][d[1]];
  const guards = protectors(d);
  const most = guards.reduce((s, g) => s + g.piece.hp - 1, 0);
  $('attack-title').textContent = `${state.players[dp.owner].name} ${PIECE_NAMES[dp.type]}`;
  $('attack-desc').textContent = guards.length
    ? `Protected by ${guards.length} piece${guards.length > 1 ? 's' : ''} that can bid up to ${most} points together. Your ${PIECE_NAMES[ap.type]} has ${ap.hp}. You lose what you bid either way.`
    : `Nothing protects it: any attack takes it. Your ${PIECE_NAMES[ap.type]} has ${ap.hp} points; bid 1 to keep the rest.`;
  const s = $('attack-bid');
  const max = bidLimits(ap, 'attack').max;
  if (Number(s.max) !== max) { s.max = max; if (Number(s.value) > max) s.value = max; $('attack-out').textContent = s.value; }
}
$('attack-bid').addEventListener('input', (e) => { $('attack-out').textContent = e.target.value; });
$('attack-cancel').addEventListener('click', closeAttack);
$('attack-go').addEventListener('click', () => {
  if (!pendingAttack) return;
  const now = performance.now();
  if (!isReady(state, humanId, now)) { banner(`Wait ${((me().readyAt - now) / 1000).toFixed(1)}s`); return; }
  const from = findPiece(state, pendingAttack.pieceId), to = findPiece(state, pendingAttack.targetId);
  const legal = from && to && legalMoves(state, from[0], from[1]).some((m) => m.capture && m.r === to[0] && m.c === to[1]);
  closeAttack();
  if (!legal) { feed('That attack is no longer possible'); return; }
  startAttack(state, { from, to, attackBid: Number($('attack-bid').value) }, now);
  selectedId = null;
});

// ---------- defending ----------
// Quick menu: tick the protecting pieces you want in the defense (or click them on the board)
// and set each one's points.
let defendPick = new Map(); // piece id -> bid, for the pieces taking part
let defendGuards = []; // pieces that can protect the attacked one
let hoverGuardId = null;

function updateDefendPanel(now) {
  const duel = state.duels.filter((d) => d.defendOwner === humanId).sort((a, b) => a.deadline - b.deadline)[0];
  const panel = $('defend-panel');
  if (!duel) { panel.hidden = true; shownDuelId = null; defendGuards = []; return; }
  const dAt = findPiece(state, duel.defenderId), aAt = findPiece(state, duel.attackerId);
  if (!dAt || !aAt) return;
  const dp = state.board[dAt[0]][dAt[1]], ap = state.board[aAt[0]][aAt[1]];
  if (shownDuelId !== duel.id) {
    shownDuelId = duel.id;
    defendGuards = eligibleGuards(state, duel).sort((a, b) => b.piece.hp - a.piece.hp);
    defendPick = new Map();
    $('defend-title').textContent = `Your ${PIECE_NAMES[dp.type]}`;
    $('defend-desc').textContent = `${state.players[ap.owner].name} ${PIECE_NAMES[ap.type]} attacks with a secret bid of up to ${bidLimits(ap, 'attack').max}. ` +
      `Pick the pieces that defend (tap them here or on the board) and how many points each puts in. Beat or tie the attack to survive.`;
    renderGuardRows();
    panel.hidden = false;
  }
  const left = Math.max(0, (duel.deadline - now) / 1000);
  $('defend-count').textContent = Math.ceil(left);
  $('defend-count').classList.toggle('low', left < 4);
}

function renderGuardRows() {
  $('guards').innerHTML = defendGuards.map((g) => {
    const max = bidLimits(g.piece, 'guard').max;
    const on = defendPick.has(g.piece.id);
    const bid = defendPick.get(g.piece.id) ?? 0;
    return `<li class="${on ? 'on' : ''}" data-guard="${g.piece.id}">
      <label class="pick"><input type="checkbox" ${on ? 'checked' : ''}><span>${PIECE_NAMES[g.piece.type]} <small>${g.piece.hp} pts</small></span></label>
      <output>${bid}</output>
      <input type="range" min="0" max="${max}" value="${bid}" ${on ? '' : 'disabled'} aria-label="${PIECE_NAMES[g.piece.type]} points">
      <div class="chips"><button type="button" data-frac="0.25">¼</button><button type="button" data-frac="0.5">½</button><button type="button" data-frac="1">All</button></div>
    </li>`;
  }).join('');
  $('guards').querySelectorAll('li').forEach((li) => {
    const id = Number(li.dataset.guard);
    const g = defendGuards.find((x) => x.piece.id === id);
    const max = bidLimits(g.piece, 'guard').max;
    li.addEventListener('pointerenter', () => { hoverGuardId = id; });
    li.addEventListener('pointerleave', () => { if (hoverGuardId === id) hoverGuardId = null; });
    li.querySelector('input[type=checkbox]').addEventListener('change', (e) => toggleGuard(id, e.target.checked));
    li.querySelector('input[type=range]').addEventListener('input', (e) => setGuardBid(id, Number(e.target.value)));
    li.querySelectorAll('[data-frac]').forEach((b) => b.addEventListener('click', () => {
      setGuardBid(id, Math.round(max * Number(b.dataset.frac)));
    }));
  });
  updateDefenseTotal();
}

function toggleGuard(id, on = !defendPick.has(id)) {
  const g = defendGuards.find((x) => x.piece.id === id);
  if (!g) return;
  if (on) defendPick.set(id, defendPick.get(id) || Math.ceil(bidLimits(g.piece, 'guard').max / 2));
  else defendPick.delete(id);
  renderGuardRows();
}

function setGuardBid(id, bid) {
  if (!defendPick.has(id)) defendPick.set(id, bid);
  defendPick.set(id, bid);
  const li = $('guards').querySelector(`li[data-guard="${id}"]`);
  if (!li.classList.contains('on')) { renderGuardRows(); return; }
  li.querySelector('output').textContent = bid;
  li.querySelector('input[type=range]').value = bid;
  updateDefenseTotal();
}

function updateDefenseTotal() {
  const total = [...defendPick.values()].reduce((s, b) => s + b, 0);
  $('defend-total').textContent = total;
  $('defend-count-pieces').textContent = defendPick.size
    ? `${defendPick.size} of ${defendGuards.length} pieces defending`
    : `${defendGuards.length} piece${defendGuards.length === 1 ? '' : 's'} can defend`;
}

$('defend-all').addEventListener('click', () => {
  for (const g of defendGuards) if (!defendPick.has(g.piece.id)) defendPick.set(g.piece.id, Math.ceil(bidLimits(g.piece, 'guard').max / 2));
  renderGuardRows();
});
$('defend-go').addEventListener('click', () => {
  const duel = state.duels.find((d) => d.id === shownDuelId);
  if (!duel) return;
  const guards = [...defendPick].map(([id, bid]) => ({ id, bid }));
  try {
    defend(state, duel.id, { guards });
  } catch {
    // A guard moved away or got hurt meanwhile: keep only the guards that still can.
    const ok = eligibleGuards(state, duel);
    defend(state, duel.id, { guards: guards.filter((g) => ok.some((o) => o.piece.id === g.id && g.bid <= o.piece.hp - 1)) });
  }
  shownDuelId = null;
  defendGuards = [];
});

// ---------- clicking ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!state || humanId == null || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects([...pieceObjs.values()], true).find((h) => h.object.userData.pieceId);
  if (hit) {
    const at = findPiece(state, hit.object.userData.pieceId);
    if (at) return onCell(at[0], at[1]);
  }
  const t = raycaster.intersectObject(tiles)[0];
  if (t) onCell(...tileCells[t.instanceId]);
});

function onCell(r, c) {
  if (state.gameOver || !me().alive) return;
  const clicked = state.board[r][c];
  if (clicked && defendGuards.some((g) => g.piece.id === clicked.id)) { toggleGuard(clicked.id); return; }
  const now = performance.now();
  const sel = selectedId != null ? findPiece(state, selectedId) : null;
  const target = sel && legalMoves(state, sel[0], sel[1]).find((m) => m.r === r && m.c === c);
  if (target) {
    if (target.capture) { openAttack(selectedId, state.board[r][c].id); return; }
    if (!isReady(state, humanId, now)) { feed(`Wait ${((me().readyAt - now) / 1000).toFixed(1)}s before moving`); return; }
    move(state, sel, [r, c], now);
    selectedId = null;
    return;
  }
  const p = state.board[r][c];
  closeAttack();
  selectedId = p && p.owner === humanId ? (selectedId === p.id ? null : p.id) : null;
}

// ---------- main loop ----------
let last = performance.now();
const camBase = new THREE.Vector3();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  if (state) {
    if (!state.gameOver) {
      tick(state, now);
      for (const pl of state.players) {
        if (pl.human || !pl.alive || !isReady(state, pl.id, now) || now < botWake[pl.id]) continue;
        botAct(state, pl.id, now);
        botWake[pl.id] = state.players[pl.id].readyAt + 600 + Math.random() * 2400;
      }
      for (const d of [...state.duels]) {
        const answerAt = d.deadline - state.config.duelWindow + BOT_ANSWER_DELAY;
        if (!state.players[d.defendOwner].human && now >= answerAt && state.duels.includes(d)) defend(state, d.id, botDefense(state, d));
      }
      if (selectedId != null && !findPiece(state, selectedId)) selectedId = null;
    }
    handleEvents();
    syncPieces(now, dt);
    syncTiles(now);
    syncArcs(t);
    const hot = state.radius > state.config.minRadius && now >= state.nextShrinkAt - state.config.shrinkWarning ? 1 : 0;
    arena.update(t, state.radius, hot, camera);
    if (flagMarker) {
      const f = state.flag;
      flagMarker.group.visible = !!f;
      if (f) {
        flagMarker.group.position.set(f.x, 0, f.y);
        const holders = [...flagHolders(state)];
        COLORS.flag.set(holders.length === 1 ? state.players[holders[0]].color : '#ffd36b');
        flagMarker.update(t, holders.length === 1 ? state.players[holders[0]].color : null, holders.length > 1);
        if (holders.length && Math.random() < 0.25) {
          const a = Math.random() * Math.PI * 2, d = Math.random() * state.config.flagRadius;
          particles.emit(f.x + Math.cos(a) * d, 0.1, f.y + Math.sin(a) * d, { color: COLORS.flag.getStyle(), count: 1, speed: 0.4, up: 1.2, life: 1.4, gravity: -0.3, spread: 0 });
        }
      }
    }
    // Embers rising from the battlefield.
    for (let i = 0; i < (field.weather === 'embers' ? 3 : 1); i++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * (state.radius + 2);
      particles.emit(Math.cos(a) * d, 0.1, Math.sin(a) * d, { color: '#ff8a3a', count: 1, speed: 0.3, up: 0.6, life: 3.5, gravity: -0.15, spread: 0 });
    }
    updateHud(now);
    if (now - lastSlow > 300) updateSlow(now);
  }
  world.update(t);
  weather.update(dt, t);
  particles.update(dt);
  fx.update(dt);
  controls.update();
  camBase.copy(camera.position);
  if (fx.shake > 0.01) camera.position.add(tmpV.set((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake));
  renderer.render(scene, camera);
  camera.position.copy(camBase);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- menus ----------
function showMenu() {
  $('menu').hidden = false;
  $('hud').hidden = true;
  $('gameover').hidden = true;
  startGame(6, false); // a battle between computer players plays behind the menu
}
document.querySelectorAll('[data-players]').forEach((b) => b.addEventListener('click', () => {
  $('menu').hidden = true;
  $('hud').hidden = false;
  startGame(Number(b.dataset.players), true);
  banner(mode === 'flag' ? 'Capture the flag' : field.name, mode === 'flag' ? `First to ${state.config.targetScore} points` : field.place);
}));
// Battlefield picker: the battle behind the menu moves to the chosen field.
function renderFields() {
  $('fields').innerHTML = FIELDS.map((f) => `<button type="button" role="radio" aria-checked="${f === field}" class="field${f === field ? ' on' : ''}" data-field="${f.id}">
    <b>${esc(f.name)}</b><span>${esc(f.place)}</span></button>`).join('');
}
function renderModes() {
  $('games').innerHTML = [
    { id: 'royale', name: 'Battle Royale', sub: 'Last king standing' },
    { id: 'flag', name: 'Capture the Flag', sub: 'First to 60 points' },
  ].map((g) => `<button type="button" role="radio" aria-checked="${g.id === mode}" class="field${g.id === mode ? ' on' : ''}" data-mode="${g.id}">
    <b>${g.name}</b><span>${g.sub}</span></button>`).join('');
}
$('games').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b || b.dataset.mode === mode) return;
  mode = b.dataset.mode;
  try { localStorage.setItem('chessRoyale.mode', mode); } catch { /* not saved; fine */ }
  renderModes();
  document.querySelector('.eyebrow').textContent = mode === 'flag' ? 'Hold the flag' : 'Last king standing';
  startGame(6, false);
});
renderModes();
document.querySelector('.eyebrow').textContent = mode === 'flag' ? 'Hold the flag' : 'Last king standing';
$('fields').addEventListener('click', (e) => {
  const b = e.target.closest('[data-field]');
  if (!b || b.dataset.field === field.id) return;
  field = fieldById(b.dataset.field);
  try { localStorage.setItem('chessRoyale.field', field.id); } catch { /* not saved; fine */ }
  renderFields();
  startGame(6, false);
});
renderFields();
$('quit').addEventListener('click', showMenu);
$('again').addEventListener('click', showMenu);
$('look').addEventListener('click', () => { $('gameover').hidden = true; });
resize();
showMenu();

// Handy for testing from the browser console.
window.chessRoyale = { get state() { return state; }, get humanId() { return humanId; }, clickCell: (r, c) => onCell(r, c), get field() { return field.id; }, get mode() { return mode; } };
