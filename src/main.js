import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  newGame, legalMoves, move, startAttack, defend, tick, eligibleGuards, bidLimits, isPlayable, isDoomed,
  isReady, findPiece, cellCenter, pointsByPlayer, PIECE_NAMES,
} from './rules.js';
import { botAct, botDefense } from './bot.js';

const HUMAN = 0;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const dot = (color) => `<span class="dot" style="background:${color}"></span>`;

// ---------- three.js scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('view').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#15141a');
scene.fog = new THREE.Fog('#15141a', 40, 90);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = 1.3;
controls.minDistance = 6;

scene.add(new THREE.HemisphereLight('#fff6e8', '#2a2633', 1.1));
const sun = new THREE.DirectionalLight('#ffffff', 1.6);
sun.position.set(-12, 30, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 80 });
scene.add(sun);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- piece models (built from simple shapes) ----------
const V = (x, y) => new THREE.Vector2(x, y);
const BASE = [V(0, 0), V(0.38, 0), V(0.38, 0.07), V(0.31, 0.11), V(0.25, 0.15)];
const lathe = (pts) => new THREE.LatheGeometry([...BASE, ...pts], 28);
const GEOMS = {
  P: { parts: [[lathe([V(0.13, 0.22), V(0.1, 0.42), V(0.17, 0.47), V(0.06, 0.5), V(0, 0.5)])],
    [new THREE.SphereGeometry(0.16, 20, 14), [0, 0.62, 0]]], height: 0.78 },
  R: { parts: [[lathe([V(0.22, 0.2), V(0.19, 0.62), V(0.28, 0.66), V(0.28, 0.88), V(0.2, 0.88), V(0.2, 0.8), V(0, 0.8)])]], height: 0.9 },
  B: { parts: [[lathe([V(0.15, 0.25), V(0.11, 0.62), V(0.2, 0.66), V(0.08, 0.7), V(0, 0.7)])],
    [new THREE.SphereGeometry(0.17, 20, 14), [0, 0.84, 0], [1, 1.35, 1]],
    [new THREE.SphereGeometry(0.06, 12, 8), [0, 1.08, 0]]], height: 1.12 },
  N: { parts: [[lathe([V(0.2, 0.22), V(0, 0.22)])],
    [new THREE.BoxGeometry(0.26, 0.55, 0.32), [0, 0.47, -0.04], null, [-0.25, 0, 0]],
    [new THREE.BoxGeometry(0.22, 0.22, 0.48), [0, 0.74, 0.08], null, [0.35, 0, 0]],
    [new THREE.BoxGeometry(0.08, 0.14, 0.08), [0.07, 0.9, -0.07]],
    [new THREE.BoxGeometry(0.08, 0.14, 0.08), [-0.07, 0.9, -0.07]]], height: 0.98 },
  Q: { parts: [[lathe([V(0.18, 0.28), V(0.12, 0.82), V(0.24, 0.9), V(0.2, 1.0), V(0, 1.0)])],
    [new THREE.SphereGeometry(0.09, 14, 10), [0, 1.07, 0]]], height: 1.16 },
  K: { parts: [[lathe([V(0.19, 0.3), V(0.13, 0.88), V(0.25, 0.95), V(0.21, 1.06), V(0, 1.06)])],
    [new THREE.BoxGeometry(0.07, 0.28, 0.07), [0, 1.2, 0]],
    [new THREE.BoxGeometry(0.22, 0.07, 0.07), [0, 1.22, 0]]], height: 1.34 },
};

const materials = new Map();
function materialFor(color) {
  if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.12 }));
  return materials.get(color);
}

function buildPiece(piece, color) {
  const group = new THREE.Group();
  const spec = GEOMS[piece.type];
  // Each piece gets its own material clone so it can glow while locked in a duel.
  const mat = materialFor(color).clone();
  for (const [geom, pos, scale, rot] of spec.parts) {
    const mesh = new THREE.Mesh(geom, mat);
    if (pos) mesh.position.set(...pos);
    if (scale) mesh.scale.set(...scale);
    if (rot) mesh.rotation.set(...rot);
    mesh.castShadow = true;
    mesh.userData.pieceId = piece.id;
    group.add(mesh);
  }
  const label = makeLabel();
  label.position.y = spec.height + 0.32;
  group.add(label);
  group.userData = { label, mat, hp: null, height: spec.height };
  return group;
}

function makeLabel() {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 64;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(0.62, 0.31, 1);
  sprite.renderOrder = 10;
  sprite.userData.canvas = canvas;
  return sprite;
}
function drawLabel(sprite, hp, mine) {
  const c = sprite.userData.canvas, g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = mine ? 'rgba(160,30,30,.92)' : 'rgba(10,10,14,.82)';
  g.beginPath(); g.roundRect(14, 6, 100, 52, 26); g.fill();
  g.fillStyle = '#fff';
  g.font = 'bold 38px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(hp), 64, 33);
  sprite.material.map.needsUpdate = true;
}

// ---------- game objects ----------
let state = null;
let tiles = null; // InstancedMesh, one instance per square of the starting disc
let tileCells = []; // instance index -> [r, c]
let tileFall = []; // instance index -> time it started falling
let boardGroup = null;
let zoneRing = null;
const pieceObjs = new Map(); // piece id -> Group
let selectedId = null;
let pendingAttack = null; // { pieceId, targetId }
let shownDuelId = null;
let botWake = [];
let lastSlowUpdate = 0;

const tileColors = { light: new THREE.Color('#e8d3a8'), dark: new THREE.Color('#9c6f45'), sel: new THREE.Color('#f2d03b'),
  move: new THREE.Color('#5fbf6f'), capture: new THREE.Color('#e04a4a'), doomA: new THREE.Color('#c0392b') };
const tmpColor = new THREE.Color();
const tmpMatrix = new THREE.Matrix4();

function startGame(players) {
  const now = performance.now();
  state = newGame(players, { humans: [HUMAN], now });
  botWake = state.players.map(() => now + 1500 + Math.random() * 1500);
  selectedId = null; pendingAttack = null; shownDuelId = null;
  buildBoard();
  $('setup').hidden = true;
  $('gameover').hidden = true;
  $('hud').hidden = false;
  $('attack-panel').hidden = true;
  $('defend-panel').hidden = true;
  $('log').innerHTML = '';
  updateSlow(now);
}

function buildBoard() {
  if (boardGroup) scene.remove(boardGroup);
  for (const obj of pieceObjs.values()) scene.remove(obj);
  pieceObjs.clear();
  boardGroup = new THREE.Group();
  const R = state.config.boardRadius;

  const base = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.5, R + 0.9, 0.8, 96),
    new THREE.MeshStandardMaterial({ color: '#2b2420', roughness: 0.8 }));
  base.position.y = -0.55;
  base.receiveShadow = true;
  boardGroup.add(base);

  tileCells = [];
  for (let r = 0; r < state.size; r++) for (let c = 0; c < state.size; c++) if (isPlayable(state, r, c)) tileCells.push([r, c]);
  tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.98, 0.24, 0.98),
    new THREE.MeshStandardMaterial({ roughness: 0.6 }), tileCells.length);
  tiles.receiveShadow = true;
  tileFall = tileCells.map(() => null);
  tileCells.forEach(([r, c], i) => {
    const { x, y } = cellCenter(state, r, c);
    tmpMatrix.makeTranslation(x, -0.12, y);
    tiles.setMatrixAt(i, tmpMatrix);
    tiles.setColorAt(i, (r + c) % 2 ? tileColors.dark : tileColors.light);
  });
  boardGroup.add(tiles);

  zoneRing = new THREE.Mesh(ringGeometry(R), new THREE.MeshBasicMaterial({ color: '#ff5050' }));
  zoneRing.rotation.x = Math.PI / 2;
  zoneRing.position.y = 0.05;
  zoneRing.userData.radius = R;
  boardGroup.add(zoneRing);
  scene.add(boardGroup);

  camera.position.set(0, R * 1.9, R * 1.75);
  controls.target.set(0, 0, R * 0.12);
  controls.maxDistance = R * 3.5;
  controls.update();
}

// The red ring marks the edge of the board; rebuilt as it shrinks so the line stays thin.
function ringGeometry(radius) {
  return new THREE.TorusGeometry(radius, 0.06, 8, 160);
}

// ---------- per-frame sync ----------
function syncPieces(now, dt) {
  const seen = new Set();
  const duelPieces = new Set(state.duels.flatMap((d) => [d.attackerId, d.defenderId]));
  for (let r = 0; r < state.size; r++) {
    for (let c = 0; c < state.size; c++) {
      const p = state.board[r][c];
      if (!p) continue;
      seen.add(p.id);
      let obj = pieceObjs.get(p.id);
      const { x, y } = cellCenter(state, r, c);
      if (!obj) {
        obj = buildPiece(p, state.players[p.owner].color);
        obj.position.set(x, 0, y);
        if (p.type === 'N') obj.rotation.y = Math.atan2(-x, -y); // knights face the centre
        pieceObjs.set(p.id, obj);
        scene.add(obj);
      }
      // Glide to the square, with a little hop.
      const dx = x - obj.position.x, dz = y - obj.position.z;
      const dist = Math.hypot(dx, dz);
      const k = 1 - Math.exp(-dt * 10);
      obj.position.x += dx * k;
      obj.position.z += dz * k;
      obj.position.y = Math.min(0.6, dist * 0.25);
      if (obj.userData.hp !== p.hp) { drawLabel(obj.userData.label, p.hp, p.owner === HUMAN); obj.userData.hp = p.hp; }
      const glow = duelPieces.has(p.id) ? 0.35 + 0.35 * Math.sin(now / 120) : p.id === selectedId ? 0.25 : 0;
      obj.userData.mat.emissive.set(duelPieces.has(p.id) ? '#ff3030' : '#ffe680');
      obj.userData.mat.emissiveIntensity = glow;
    }
  }
  // Removed pieces sink and vanish.
  for (const [id, obj] of pieceObjs) {
    if (seen.has(id)) continue;
    obj.position.y -= dt * 3;
    obj.scale.multiplyScalar(Math.max(0, 1 - dt * 3));
    if (obj.scale.x < 0.05) { scene.remove(obj); pieceObjs.delete(id); }
  }
}

function syncTiles(now, dt) {
  const sel = selectedId != null ? findPiece(state, selectedId) : null;
  const targets = sel ? legalMoves(state, sel[0], sel[1]) : [];
  const tKey = new Map(targets.map((m) => [m.r * 1000 + m.c, m.capture ? 'capture' : 'move']));
  const pulse = 0.5 + 0.5 * Math.sin(now / 160);
  let matrixDirty = false;
  tileCells.forEach(([r, c], i) => {
    if (!isPlayable(state, r, c)) {
      if (tileFall[i] == null) tileFall[i] = now;
      const t = (now - tileFall[i]) / 1000;
      if (t < 3) {
        const { x, y } = cellCenter(state, r, c);
        tmpMatrix.makeTranslation(x, -0.12 - 4 * t * t, y);
        tiles.setMatrixAt(i, tmpMatrix);
        matrixDirty = true;
      }
      tiles.setColorAt(i, tmpColor.set('#3a2a22'));
      return;
    }
    const base = (r + c) % 2 ? tileColors.dark : tileColors.light;
    tmpColor.copy(base);
    if (isDoomed(state, r, c, now)) tmpColor.lerp(tileColors.doomA, 0.45 + 0.4 * pulse);
    const key = tKey.get(r * 1000 + c);
    if (key) tmpColor.lerp(tileColors[key], 0.75);
    if (sel && sel[0] === r && sel[1] === c) tmpColor.lerp(tileColors.sel, 0.8);
    tiles.setColorAt(i, tmpColor);
  });
  tiles.instanceColor.needsUpdate = true;
  if (matrixDirty) tiles.instanceMatrix.needsUpdate = true;
  const shown = zoneRing.userData.radius;
  if (Math.abs(shown - state.radius) > 0.01) {
    const next = shown + (state.radius - shown) * (1 - Math.exp(-dt * 3));
    zoneRing.geometry.dispose();
    zoneRing.geometry = ringGeometry(next);
    zoneRing.userData.radius = next;
  }
  zoneRing.material.color.set(now >= state.nextShrinkAt - state.config.shrinkWarning ? (pulse > 0.5 ? '#ff2020' : '#ff9090') : '#ff5050');
}

// ---------- HUD ----------
function updateHud(now) {
  const me = state.players[HUMAN];
  const wait = Math.max(0, me.readyAt - now);
  const ready = $('ready');
  ready.classList.toggle('waiting', wait > 0);
  $('ready-text').textContent = !me.alive ? 'You are out' : wait > 0 ? `Wait ${(wait / 1000).toFixed(1)}s` : 'Ready to move';
  $('ready-bar').style.width = `${me.alive ? 100 * (1 - wait / state.config.cooldown) : 0}%`;

  const shrink = $('shrink');
  if (state.radius <= state.config.minRadius) {
    shrink.textContent = 'The board has stopped shrinking';
    shrink.classList.remove('warn');
  } else {
    const s = Math.max(0, (state.nextShrinkAt - now) / 1000);
    shrink.textContent = s <= state.config.shrinkWarning / 1000 ? `Red squares fall in ${s.toFixed(1)}s!` : `Board shrinks in ${Math.ceil(s)}s`;
    shrink.classList.toggle('warn', s <= state.config.shrinkWarning / 1000);
  }
  updateAttackPanel();
  updateDefendPanel(now);
}

function updateSlow(now) {
  const totals = pointsByPlayer(state);
  $('players').innerHTML = state.players.map((p, i) =>
    `<li class="${p.alive ? '' : 'out'}">${dot(p.color)} ${esc(p.name)}${p.human ? ' (you)' : ''}<span class="pts">${p.alive ? totals[i] : 'out'}</span></li>`).join('');
  $('log').innerHTML = state.log.slice(-25).reverse().map((l) => `<li>${esc(l)}</li>`).join('');
  lastSlowUpdate = now;
}

function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 4000);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
}

function describe(piece) {
  return `${state.players[piece.owner].name} ${PIECE_NAMES[piece.type]} (${piece.hp} pts)`;
}

function handleEvents() {
  for (const e of state.events.splice(0)) {
    if (e.kind === 'duel' && (e.attackOwner === HUMAN || e.defendOwner === HUMAN)) {
      const mineAttacked = e.attackOwner === HUMAN;
      const guard = e.guardType ? ` + ${PIECE_NAMES[e.guardType]} guard ${e.guardBid}` : '';
      const won = mineAttacked ? e.success : !e.success;
      const head = mineAttacked
        ? (e.success ? `Your ${PIECE_NAMES[e.attackerType]} took the ${PIECE_NAMES[e.defenderType]}!` : `Your ${PIECE_NAMES[e.attackerType]} was held off.`)
        : (e.success ? `You lost your ${PIECE_NAMES[e.defenderType]}.` : `Your ${PIECE_NAMES[e.defenderType]} held!`);
      toast(`${head} Attack ${e.attackBid} vs defense ${e.defenseBid}${guard}.`, won ? 'good' : 'bad');
    } else if (e.kind === 'eliminated') {
      toast(e.owner === HUMAN ? 'Your king fell. You are out.' : `${state.players[e.owner].name} is out!`, e.owner === HUMAN ? 'bad' : '');
    } else if (e.kind === 'shrink') {
      toast('The board shrinks!');
    } else if (e.kind === 'gameOver') {
      setTimeout(showGameOver, 900);
    }
  }
}

function showGameOver() {
  const w = state.winner;
  $('gameover-title').textContent = w === HUMAN ? 'You win!' : w == null ? 'Draw' : `${state.players[w].name} wins`;
  $('gameover-text').textContent = w === HUMAN ? 'Last king standing.' : 'Better luck next time.';
  $('gameover').hidden = false;
  $('attack-panel').hidden = true;
  $('defend-panel').hidden = true;
}

// ---------- attacking ----------
function openAttack(pieceId, targetId) {
  pendingAttack = { pieceId, targetId };
  const at = findPiece(state, pieceId);
  const p = state.board[at[0]][at[1]];
  const { min, max } = bidLimits(p, 'attack');
  const slider = $('attack-bid');
  slider.min = min; slider.max = max;
  slider.value = Math.max(min, Math.min(max, Math.ceil(max / 2)));
  $('attack-out').textContent = slider.value;
  $('attack-panel').hidden = false;
  updateAttackPanel();
}
function closeAttack() {
  pendingAttack = null;
  $('attack-panel').hidden = true;
}
function updateAttackPanel() {
  if (!pendingAttack) return;
  const a = findPiece(state, pendingAttack.pieceId);
  const d = findPiece(state, pendingAttack.targetId);
  if (!a || !d) { closeAttack(); return; }
  const ap = state.board[a[0]][a[1]], dp = state.board[d[0]][d[1]];
  $('attack-title').textContent = `Attack the ${PIECE_NAMES[dp.type]}`;
  $('attack-desc').textContent = `Your ${PIECE_NAMES[ap.type]} (${ap.hp} pts) attacks the ${describe(dp)}. You lose what you bid, win or lose.`;
  const slider = $('attack-bid');
  const max = bidLimits(ap, 'attack').max;
  if (Number(slider.max) !== max) { slider.max = max; if (Number(slider.value) > max) slider.value = max; $('attack-out').textContent = slider.value; }
}
$('attack-bid').addEventListener('input', (e) => { $('attack-out').textContent = e.target.value; });
$('attack-cancel').addEventListener('click', closeAttack);
$('attack-go').addEventListener('click', () => {
  if (!pendingAttack) return;
  const now = performance.now();
  if (!isReady(state, HUMAN, now)) { toast(`Wait ${((state.players[HUMAN].readyAt - now) / 1000).toFixed(1)}s before attacking`); return; }
  const from = findPiece(state, pendingAttack.pieceId), to = findPiece(state, pendingAttack.targetId);
  const legal = from && to && legalMoves(state, from[0], from[1]).some((m) => m.capture && m.r === to[0] && m.c === to[1]);
  if (!legal) { toast('That attack is no longer possible'); closeAttack(); return; }
  const duel = startAttack(state, { from, to, attackBid: Number($('attack-bid').value) }, now);
  if (!state.players[duel.defendOwner].human) defend(state, duel.id, botDefense(state, duel));
  closeAttack();
  selectedId = null;
});

// ---------- defending ----------
function updateDefendPanel(now) {
  const duel = state.duels.filter((d) => d.defendOwner === HUMAN).sort((a, b) => a.deadline - b.deadline)[0];
  const panel = $('defend-panel');
  if (!duel) { panel.hidden = true; shownDuelId = null; return; }
  const dAt = findPiece(state, duel.defenderId), aAt = findPiece(state, duel.attackerId);
  if (!dAt || !aAt) return;
  const dp = state.board[dAt[0]][dAt[1]], ap = state.board[aAt[0]][aAt[1]];
  if (shownDuelId !== duel.id) {
    shownDuelId = duel.id;
    const s = $('defend-bid');
    const { max } = bidLimits(dp, 'defense');
    s.min = 0; s.max = max; s.value = Math.floor(max / 2);
    $('defend-out').textContent = s.value;
    const guards = eligibleGuards(state, duel);
    $('guard-box').hidden = guards.length === 0;
    $('guard-sel').innerHTML = '<option value="">No guard</option>' +
      guards.map((g) => `<option value="${g.piece.id}">${esc(PIECE_NAMES[g.piece.type])} (${g.piece.hp} pts)</option>`).join('');
    $('guard-bid').disabled = true; $('guard-bid').value = 0; $('guard-out').textContent = '0';
    panel.hidden = false;
  }
  $('defend-desc').textContent = `The ${describe(ap)} attacks your ${PIECE_NAMES[dp.type]} (${dp.hp} pts). If you don't answer in time, your piece bids half its points.`;
  $('defend-timer').style.width = `${Math.max(0, 100 * (duel.deadline - now) / state.config.duelWindow)}%`;
}
$('defend-bid').addEventListener('input', (e) => { $('defend-out').textContent = e.target.value; });
$('guard-bid').addEventListener('input', (e) => { $('guard-out').textContent = e.target.value; });
$('guard-sel').addEventListener('change', (e) => {
  const id = Number(e.target.value);
  const g = e.target.value === '' ? null : findPiece(state, id);
  const s = $('guard-bid');
  s.disabled = !g;
  if (g) { s.max = bidLimits(state.board[g[0]][g[1]], 'guard').max; s.value = Math.floor(s.max / 2); }
  else s.value = 0;
  $('guard-out').textContent = s.value;
});
$('defend-go').addEventListener('click', () => {
  const duel = state.duels.find((d) => d.id === shownDuelId);
  if (!duel) return;
  const guardVal = $('guard-sel').value;
  const defenseBid = Number($('defend-bid').value);
  const useGuard = guardVal !== '' && !$('guard-box').hidden;
  try {
    defend(state, duel.id, {
      defenseBid,
      guardId: useGuard ? Number(guardVal) : null,
      guardBid: useGuard ? Number($('guard-bid').value) : 0,
    });
  } catch {
    // The guard moved or got hurt meanwhile: defend without it.
    defend(state, duel.id, { defenseBid });
  }
  shownDuelId = null;
});

// ---------- clicking on the board ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!state || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const pieceHits = raycaster.intersectObjects([...pieceObjs.values()], true).filter((h) => h.object.userData.pieceId);
  if (pieceHits.length) {
    const at = findPiece(state, pieceHits[0].object.userData.pieceId);
    if (at) return onCell(at[0], at[1]);
  }
  const hit = raycaster.intersectObject(tiles)[0];
  if (hit) onCell(...tileCells[hit.instanceId]);
});

function onCell(r, c) {
  if (state.gameOver || !state.players[HUMAN].alive) return;
  const now = performance.now();
  const sel = selectedId != null ? findPiece(state, selectedId) : null;
  const target = sel && legalMoves(state, sel[0], sel[1]).find((m) => m.r === r && m.c === c);
  if (target) {
    if (target.capture) { openAttack(selectedId, state.board[r][c].id); return; }
    if (!isReady(state, HUMAN, now)) { toast(`Wait ${((state.players[HUMAN].readyAt - now) / 1000).toFixed(1)}s`); return; }
    move(state, sel, [r, c], now);
    selectedId = null;
    return;
  }
  const p = state.board[r][c];
  closeAttack();
  selectedId = p && p.owner === HUMAN ? (selectedId === p.id ? null : p.id) : null;
}

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state) {
    if (!state.gameOver) {
      tick(state, now);
      for (const pl of state.players) {
        if (pl.human || !pl.alive || !isReady(state, pl.id, now) || now < botWake[pl.id]) continue;
        botAct(state, pl.id, now);
        botWake[pl.id] = state.players[pl.id].readyAt + 300 + Math.random() * 1700;
        // Bots answer attacks on their own pieces straight away.
        for (const d of [...state.duels]) if (!state.players[d.defendOwner].human && state.duels.includes(d)) defend(state, d.id, botDefense(state, d));
      }
      if (selectedId != null && !findPiece(state, selectedId)) selectedId = null;
    }
    handleEvents();
    syncPieces(now, dt);
    syncTiles(now, dt);
    updateHud(now);
    if (now - lastSlowUpdate > 300) updateSlow(now);
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- menus ----------
document.querySelectorAll('[data-players]').forEach((b) => b.addEventListener('click', () => startGame(Number(b.dataset.players))));
$('quit').addEventListener('click', () => { $('setup').hidden = false; $('hud').hidden = true; });
$('again').addEventListener('click', () => { $('gameover').hidden = true; $('setup').hidden = false; $('hud').hidden = true; });
$('look').addEventListener('click', () => { $('gameover').hidden = true; });

// Handy for testing from the browser console.
window.chessRoyale = { get state() { return state; }, clickCell: (r, c) => onCell(r, c) };
