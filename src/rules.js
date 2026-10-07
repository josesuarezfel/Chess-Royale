// Chess Royale rules engine: a round board, no turns, a wait time after every action.
// Pure functions over a plain state object. Time is always passed in as `now` (ms).

export const START_POINTS = { K: 30, Q: 27, R: 15, B: 9, N: 9, P: 3 };
export const PIECE_NAMES = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight', P: 'Pawn' };

export const DEFAULT_CONFIG = {
  mode: 'royale', // 'royale' (last king standing) or 'flag' (hold the flag for points)
  boardRadius: null, // in squares from the centre to the edge; null picks one by player count
  cooldown: 5000, // wait after each move or attack
  duelWindow: 15000, // time a defender has to answer an attack
  shrinkStart: 120000, // first collapse
  shrinkEvery: 60000, // between collapses
  shrinkWarning: 15000, // doomed squares are marked this long before
  minRadius: 3, // the board stops shrinking here
  // Capture the flag
  flagRadius: 2.6, // how far from the flag a piece still counts as inside, in squares
  flagLife: 30000, // a flag stays this long, then one appears somewhere else
  flagScoreEvery: 1000, // a point is handed out this often
  targetScore: 60, // first to this many points wins
  respawnDelay: 10000, // a captured piece comes back this long after it falls
};

export const SEAT_COLORS = [
  { name: 'Red', color: '#d64545' },
  { name: 'Blue', color: '#3b6fd6' },
  { name: 'Yellow', color: '#e0b323' },
  { name: 'Green', color: '#3fa34d' },
  { name: 'Purple', color: '#8e4fd6' },
  { name: 'Orange', color: '#e07a23' },
  { name: 'Teal', color: '#1fa3a3' },
  { name: 'Pink', color: '#d64f9a' },
];

const BACK_RANK = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];

let nextId = 1;

// Cell (r, c) centre in board units, origin at the board centre.
export function cellCenter(state, r, c) {
  const R = state.config.boardRadius;
  return { x: c - R + 0.5, y: r - R + 0.5 };
}
export function distFromCenter(state, r, c) {
  const { x, y } = cellCenter(state, r, c);
  return Math.hypot(x, y);
}
function cellAt(state, x, y) {
  const R = state.config.boardRadius;
  return [Math.floor(y + R), Math.floor(x + R)];
}

// Players sit evenly around the circle. Each army is a straight back rank with pawns one step
// inward, lined up with the nearest grid direction (straight or diagonal) so ranks stay clean.
function placeArmies(state, count) {
  const R = state.config.boardRadius;
  for (let i = 0; i < count; i++) {
    const angle = Math.PI / 2 + (2 * Math.PI * i) / count; // seat 0 at the bottom of the screen
    const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
    const u = [Math.round(Math.cos(snapped)), Math.round(Math.sin(snapped))]; // outward, grid step [x, y]
    const t = [-u[1], u[0]]; // along the rank
    const cellsFor = (d) => {
      const anchor = cellAt(state, Math.cos(angle) * d, Math.sin(angle) * d); // [r, c]
      const out = [];
      for (let k = 0; k < 8; k++) {
        const off = k - 4;
        const back = [anchor[0] + t[1] * off, anchor[1] + t[0] * off];
        out.push({ type: BACK_RANK[k], at: back }, { type: 'P', at: [back[0] - u[1], back[1] - u[0]] });
      }
      return out;
    };
    // Push the army as far out as it fits, leaving the outer ring free so the first collapse
    // doesn't wipe out the corners of every army.
    const fits = ({ at }) => isPlayable(state, at[0], at[1]) && distFromCenter(state, at[0], at[1]) <= R - 1.2;
    let d = R;
    while (d > 0 && !cellsFor(d).every(fits)) d -= 0.25;
    for (const { type, at } of cellsFor(d)) {
      if (state.board[at[0]][at[1]]) throw new Error('Board too small for this many players');
      state.board[at[0]][at[1]] = makePiece(type, i);
      state.homes[i].push([at[0], at[1]]); // where this army respawns in capture the flag
    }
  }
}

function makePiece(type, owner) {
  return { id: nextId++, type, owner, hp: START_POINTS[type] };
}

// players: number of seats (2 to 8). humans: seat ids played by people; the rest are bots.
export function newGame(players, { humans = [0], now = 0, config = {} } = {}) {
  if (players < 2 || players > 8) throw new Error('2 to 8 players');
  const cfg = { ...DEFAULT_CONFIG, ...config };
  cfg.boardRadius ??= players <= 4 ? 11 : players <= 6 ? 14 : 17;
  const size = cfg.boardRadius * 2;
  const state = {
    config: cfg,
    size,
    radius: cfg.boardRadius,
    board: Array.from({ length: size }, () => Array(size).fill(null)),
    players: Array.from({ length: players }, (_, i) => ({
      id: i, ...SEAT_COLORS[i], human: humans.includes(i), alive: true, readyAt: now,
    })),
    duels: [],
    homes: Array.from({ length: players }, () => []),
    // Capture the flag only:
    mode: cfg.mode,
    scores: Array.from({ length: players }, () => 0),
    flag: null, // { r, c, x, y, until }
    nextScoreAt: Infinity, // when the next point is handed out
    respawns: [], // [{ owner, type, at }]
    nextShrinkAt: cfg.mode === 'flag' ? Infinity : now + cfg.shrinkStart,
    now,
    startedAt: now,
    gameOver: false,
    winner: null,
    log: [],
    events: [], // results for the UI to show, drained by the caller
  };
  placeArmies(state, players);
  if (cfg.mode === 'flag') { state.nextScoreAt = now + cfg.flagScoreEvery; moveFlag(state, now); }
  return state;
}

// ---------- capture the flag ----------
// One flag at a time. Pieces standing within flagRadius of it earn their player points.
export function moveFlag(state, now) {
  const R = state.config.boardRadius;
  const far = state.flag ? [state.flag.x, state.flag.y] : null;
  // Where each army sits, so no one gets a flag on their doorstep.
  const camps = state.homes.map((h) => {
    const cs = h.map(([r, c]) => cellCenter(state, r, c));
    return [cs.reduce((t, p) => t + p.x, 0) / cs.length, cs.reduce((t, p) => t + p.y, 0) / cs.length];
  });
  const reach = (state.radius - state.config.flagRadius - 1) * 0.75;
  let best = null;
  for (let tries = 0; tries < 80; tries++) {
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * reach;
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    const ds = camps.map(([cx, cy]) => Math.hypot(x - cx, y - cy));
    const fairness = Math.min(...ds) / Math.max(...ds); // 1 means the same walk for everyone
    const away = far ? Math.min(Math.hypot(x - far[0], y - far[1]), state.radius) : state.radius;
    const score = fairness * 3 + away / state.radius;
    if (!best || score > best.score) best = { x, y, score };
  }
  const [r, c] = [Math.floor(best.y + R), Math.floor(best.x + R)];
  state.flag = { r, c, x: best.x, y: best.y, until: now + state.config.flagLife };
  state.log.push('A new flag is raised');
  state.events.push({ kind: 'flag', r, c, x: best.x, y: best.y });
}

// Is this square inside the flag's circle?
export function inFlag(state, r, c) {
  if (!state.flag) return false;
  const { x, y } = cellCenter(state, r, c);
  return Math.hypot(x - state.flag.x, y - state.flag.y) <= state.config.flagRadius;
}

// Which players have a piece standing on the flag right now.
export function flagHolders(state) {
  const out = new Set();
  if (!state.flag) return out;
  for (let r = 0; r < state.size; r++)
    for (let c = 0; c < state.size; c++)
      if (state.board[r][c] && inFlag(state, r, c)) out.add(state.board[r][c].owner);
  return out;
}

// A captured piece comes back on its army's starting squares after a wait.
function scheduleRespawn(state, piece, now) {
  state.respawns.push({ owner: piece.owner, type: piece.type, at: now + state.config.respawnDelay });
}

function doRespawns(state, now) {
  for (const re of [...state.respawns]) {
    if (now < re.at) continue;
    const free = state.homes[re.owner].filter(([r, c]) => isPlayable(state, r, c) && !state.board[r][c]);
    const spot = free.length ? free[Math.floor(Math.random() * free.length)] : nearestFree(state, re.owner);
    if (!spot) continue; // no room yet: try again next tick
    state.respawns = state.respawns.filter((x) => x !== re);
    state.board[spot[0]][spot[1]] = makePiece(re.type, re.owner);
    state.log.push(`${state.players[re.owner].name} ${PIECE_NAMES[re.type]} returns to the field`);
    state.events.push({ kind: 'respawn', owner: re.owner, type: re.type, at: spot });
  }
}

function nearestFree(state, owner) {
  const home = state.homes[owner];
  const cx = home.reduce((s, [r]) => s + r, 0) / home.length;
  const cy = home.reduce((s, [, c]) => s + c, 0) / home.length;
  let best = null;
  for (let r = 0; r < state.size; r++)
    for (let c = 0; c < state.size; c++) {
      if (!isPlayable(state, r, c) || state.board[r][c]) continue;
      const d = Math.hypot(r - cx, c - cy);
      if (!best || d < best.d) best = { at: [r, c], d };
    }
  return best?.at ?? null;
}

// A point a second for every player on the flag, and one more for holding it alone.
function scoreFlag(state, now) {
  while (now >= state.nextScoreAt) {
    const holders = [...flagHolders(state)];
    for (const owner of holders) state.scores[owner] += holders.length === 1 ? 2 : 1;
    if (holders.length) state.events.push({ kind: 'score', holders, alone: holders.length === 1 });
    state.nextScoreAt += state.config.flagScoreEvery;
  }
}

export function isPlayable(state, r, c) {
  if (r < 0 || c < 0 || r >= state.size || c >= state.size) return false;
  return distFromCenter(state, r, c) <= state.radius;
}

// Squares that vanish at the next collapse, marked during the warning window.
export function isDoomed(state, r, c, now) {
  if (state.radius <= state.config.minRadius) return false;
  if (now < state.nextShrinkAt - state.config.shrinkWarning) return false;
  return isPlayable(state, r, c) && distFromCenter(state, r, c) > state.radius - 1;
}

export function findPiece(state, id) {
  for (let r = 0; r < state.size; r++)
    for (let c = 0; c < state.size; c++)
      if (state.board[r][c]?.id === id) return [r, c];
  return null;
}

// A piece in a pending duel can't move and can't be attacked by anyone else.
export function isLocked(state, piece) {
  return state.duels.some((d) => d.attackerId === piece.id || d.defenderId === piece.id);
}

const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KNIGHT_JUMPS = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];

// Squares a piece threatens (could capture on), whoever stands there.
// Pawns have no forward on a round board: they step straight and capture diagonally, any direction.
export function attacks(state, r, c) {
  const p = state.board[r][c];
  if (!p) return [];
  const out = [];
  const slide = (dirs) => {
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (isPlayable(state, rr, cc)) {
        out.push([rr, cc]);
        if (state.board[rr][cc]) break;
        rr += dr; cc += dc;
      }
    }
  };
  const step = (offsets) => {
    for (const [dr, dc] of offsets) if (isPlayable(state, r + dr, c + dc)) out.push([r + dr, c + dc]);
  };
  switch (p.type) {
    case 'R': slide(ROOK_DIRS); break;
    case 'B': slide(BISHOP_DIRS); break;
    case 'Q': slide([...ROOK_DIRS, ...BISHOP_DIRS]); break;
    case 'N': step(KNIGHT_JUMPS); break;
    case 'K': step([...ROOK_DIRS, ...BISHOP_DIRS]); break;
    case 'P': step(BISHOP_DIRS); break;
  }
  return out;
}

// Legal destinations for the piece on (r, c), ignoring the wait time: [{ r, c, capture }].
export function legalMoves(state, r, c) {
  const p = state.board[r]?.[c];
  if (!p || state.gameOver || isLocked(state, p)) return [];
  const moves = [];
  const canAttack = p.hp >= 2; // an attacker must bid at least 1 and keep 1
  for (const [rr, cc] of attacks(state, r, c)) {
    const t = state.board[rr][cc];
    if (t) {
      if (t.owner !== p.owner && canAttack && !isLocked(state, t)) moves.push({ r: rr, c: cc, capture: true });
    } else if (p.type !== 'P') {
      moves.push({ r: rr, c: cc, capture: false });
    }
  }
  if (p.type === 'P') {
    for (const [dr, dc] of ROOK_DIRS) {
      const rr = r + dr, cc = c + dc;
      if (isPlayable(state, rr, cc) && !state.board[rr][cc]) moves.push({ r: rr, c: cc, capture: false });
    }
  }
  return moves;
}

export function isReady(state, owner, now) {
  const p = state.players[owner];
  return p.alive && !state.gameOver && now >= p.readyAt;
}

function checkAction(state, from, to, capture, now) {
  if (state.gameOver) throw new Error('Game is over');
  const p = state.board[from[0]]?.[from[1]];
  if (!p) throw new Error('No piece there');
  if (!isReady(state, p.owner, now)) throw new Error('Still waiting');
  const ok = legalMoves(state, from[0], from[1]).some((m) => m.r === to[0] && m.c === to[1] && m.capture === capture);
  if (!ok) throw new Error(capture ? 'Illegal attack' : 'Illegal move');
  return p;
}

export function move(state, from, to, now) {
  const p = checkAction(state, from, to, false, now);
  state.now = now;
  state.board[to[0]][to[1]] = p;
  state.board[from[0]][from[1]] = null;
  state.players[p.owner].readyAt = now + state.config.cooldown;
}

export function bidLimits(piece, role) {
  return { min: role === 'attack' ? 1 : 0, max: Math.max(0, piece.hp - 1) };
}
function checkBid(piece, bid, role) {
  const { min, max } = bidLimits(piece, role);
  if (!Number.isInteger(bid) || bid < min || bid > max) throw new Error(`${role} bid must be ${min} to ${max}`);
}

// Pieces of the defender's side that cover its square and can still bid.
export function eligibleGuards(state, duel) {
  const at = findPiece(state, duel.defenderId);
  if (!at) return [];
  const defender = state.board[at[0]][at[1]];
  const out = [];
  for (let r = 0; r < state.size; r++) {
    for (let c = 0; c < state.size; c++) {
      const p = state.board[r][c];
      if (!p || p === defender || p.owner !== defender.owner || p.hp < 2 || isLocked(state, p)) continue;
      if (attacks(state, r, c).some(([rr, cc]) => rr === at[0] && cc === at[1])) out.push({ r, c, piece: p });
    }
  }
  return out;
}

// Starts a duel. The attacker's wait time begins now; the defender's side answers with defend().
// An unprotected target is resolved at once (duel.result is set).
export function startAttack(state, { from, to, attackBid }, now) {
  const attacker = checkAction(state, from, to, true, now);
  state.now = now;
  checkBid(attacker, attackBid, 'attack');
  const defender = state.board[to[0]][to[1]];
  state.players[attacker.owner].readyAt = now + state.config.cooldown;
  const duel = {
    id: nextId++,
    attackerId: attacker.id,
    defenderId: defender.id,
    attackOwner: attacker.owner,
    defendOwner: defender.owner,
    attackBid,
    deadline: now + state.config.duelWindow,
  };
  state.duels.push(duel);
  // Nothing protects the target: there is nothing to decide, so it falls right away.
  if (eligibleGuards(state, duel).length === 0) duel.result = defend(state, duel.id, { guards: [] }, now);
  return duel;
}

// What the guards bid when the defender doesn't answer in time: each guard half its points.
export function autoDefense(state, duel) {
  return { guards: eligibleGuards(state, duel).map((g) => ({ id: g.piece.id, bid: Math.floor((g.piece.hp - 1) / 2) })) };
}

// Resolves a duel. The attacked piece can't bid for itself: only the pieces protecting it
// (its guards) defend. Every piece loses what it bid; a higher attack kills the defender and takes its square.
// answer = { guards: [{ id, bid }] }
export function defend(state, duelId, { guards = [] } = {}, now = null) {
  const duel = state.duels.find((d) => d.id === duelId);
  if (!duel) throw new Error('No such duel');
  const aAt = findPiece(state, duel.attackerId);
  const dAt = findPiece(state, duel.defenderId);
  const attacker = aAt && state.board[aAt[0]][aAt[1]];
  const defender = dAt && state.board[dAt[0]][dAt[1]];
  if (!attacker || !defender) {
    state.duels = state.duels.filter((d) => d !== duel); // someone fell off the board meanwhile
    return null;
  }
  const eligible = eligibleGuards(state, duel);
  const used = [];
  for (const { id, bid } of guards) {
    const g = eligible.find((e) => e.piece.id === id);
    if (!g) throw new Error('That piece cannot guard');
    if (used.some((u) => u.piece === g.piece)) throw new Error('Guard listed twice');
    checkBid(g.piece, bid, 'guard');
    if (bid > 0) used.push({ piece: g.piece, bid });
  }
  state.duels = state.duels.filter((d) => d !== duel);

  const totalDefense = used.reduce((sum, u) => sum + u.bid, 0);
  const success = duel.attackBid > totalDefense;
  attacker.hp -= duel.attackBid;
  for (const u of used) u.piece.hp -= u.bid;
  const result = {
    duelId, success, attackBid: duel.attackBid, totalDefense,
    guards: used.map((u) => ({ type: u.piece.type, bid: u.bid })),
    attackerType: attacker.type, defenderType: defender.type,
    attackOwner: attacker.owner, defendOwner: defender.owner,
    from: aAt, to: dAt,
  };
  const aName = `${state.players[attacker.owner].name} ${PIECE_NAMES[attacker.type]}`;
  const dName = `${state.players[defender.owner].name} ${PIECE_NAMES[defender.type]}`;
  if (success) {
    state.board[dAt[0]][dAt[1]] = attacker;
    state.board[aAt[0]][aAt[1]] = null;
    state.log.push(`${aName} beat ${dName} (${duel.attackBid} vs ${totalDefense})`);
    if (state.mode === 'flag') scheduleRespawn(state, defender, now ?? state.now);
    else if (defender.type === 'K') eliminate(state, defender.owner, 'king captured');
  } else {
    state.log.push(`${dName} was saved by its guards (${totalDefense} vs ${duel.attackBid})`);
  }
  state.events.push({ kind: 'duel', ...result });
  checkWinner(state);
  return result;
}

function eliminate(state, owner, reason) {
  const pl = state.players[owner];
  if (!pl.alive) return;
  pl.alive = false;
  for (let r = 0; r < state.size; r++)
    for (let c = 0; c < state.size; c++)
      if (state.board[r][c]?.owner === owner) state.board[r][c] = null;
  state.duels = state.duels.filter((d) => d.attackOwner !== owner && d.defendOwner !== owner);
  state.log.push(`${pl.name} is eliminated (${reason})`);
  state.events.push({ kind: 'eliminated', owner, reason });
}

function checkWinner(state) {
  if (state.gameOver) return;
  if (state.mode === 'flag') {
    const top = state.scores.reduce((b, v, i) => (v > state.scores[b] ? i : b), 0);
    if (state.scores[top] >= state.config.targetScore) {
      state.gameOver = true;
      state.winner = top;
      state.duels = [];
      state.log.push(`${state.players[top].name} wins the flags!`);
      state.events.push({ kind: 'gameOver', winner: top });
    }
    return;
  }
  const alive = state.players.filter((p) => p.alive);
  if (alive.length <= 1) {
    state.gameOver = true;
    state.winner = alive[0]?.id ?? null;
    state.duels = [];
    state.log.push(alive[0] ? `${alive[0].name} wins!` : 'Everyone is out: draw');
    state.events.push({ kind: 'gameOver', winner: state.winner });
  }
}

function shrink(state) {
  state.radius -= 1;
  const kingsLost = new Set();
  for (let r = 0; r < state.size; r++) {
    for (let c = 0; c < state.size; c++) {
      const p = state.board[r][c];
      if (p && !isPlayable(state, r, c)) {
        if (p.type === 'K') kingsLost.add(p.owner);
        state.board[r][c] = null;
      }
    }
  }
  state.log.push(`The board shrinks to radius ${state.radius}`);
  state.events.push({ kind: 'shrink', radius: state.radius });
  for (const owner of kingsLost) eliminate(state, owner, 'king fell off the board');
}

// Advances the clock: unanswered duels get the automatic defense, and the board shrinks on schedule.
export function tick(state, now) {
  if (state.gameOver) return;
  state.now = now;
  for (const duel of [...state.duels]) {
    if (now >= duel.deadline && state.duels.includes(duel)) defend(state, duel.id, autoDefense(state, duel), now);
  }
  if (state.mode === 'flag') {
    doRespawns(state, now);
    if (!state.flag || now >= state.flag.until) moveFlag(state, now);
    scoreFlag(state, now);
  }
  while (!state.gameOver && now >= state.nextShrinkAt && state.radius > state.config.minRadius) {
    shrink(state);
    state.nextShrinkAt += state.config.shrinkEvery;
    // Drop duels whose pieces fell off.
    state.duels = state.duels.filter((d) => findPiece(state, d.attackerId) && findPiece(state, d.defenderId));
  }
  checkWinner(state);
}

export function pointsByPlayer(state) {
  const totals = state.players.map(() => 0);
  for (const row of state.board) for (const p of row) if (p) totals[p.owner] += p.hp;
  return totals;
}
