// Chess Royale rules engine. Pure functions over a plain state object, no DOM.

export const START_POINTS = { K: 30, Q: 27, R: 15, B: 9, N: 9, P: 3 };

export const DEFAULT_CONFIG = {
  shrinkStart: 15, // last round before the first collapse
  shrinkEvery: 5, // rounds between collapses
};

const BACK_RANK = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];

// Seats on the board. `dir` is the pawn's forward step [dRow, dCol].
const SEATS_2P = [
  { name: 'White', color: '#f2efe6', dir: [-1, 0] },
  { name: 'Black', color: '#2b2b2b', dir: [1, 0] },
];
const SEATS_CROSS = [
  { name: 'Red', color: '#d64545', dir: [-1, 0] },
  { name: 'Blue', color: '#3b6fd6', dir: [0, 1] },
  { name: 'Yellow', color: '#e0b323', dir: [1, 0] },
  { name: 'Green', color: '#3fa34d', dir: [0, -1] },
];

let nextPieceId = 1;

function makePiece(type, owner) {
  return { id: nextPieceId++, type, owner, hp: START_POINTS[type], moved: false };
}

export function newGame(playerCount, config = {}) {
  if (playerCount < 2 || playerCount > 4) throw new Error('Prototype supports 2 to 4 players');
  const cross = playerCount > 2;
  const size = cross ? 14 : 8;
  const seats = cross ? SEATS_CROSS.slice(0, playerCount) : SEATS_2P;
  const board = Array.from({ length: size }, () => Array(size).fill(null));
  const state = {
    size,
    shape: cross ? 'cross' : 'square',
    board,
    players: seats.map((s, i) => ({ id: i, name: s.name, color: s.color, dir: s.dir, alive: true })),
    current: 0,
    round: 1,
    collapse: 0, // number of outer rings removed
    config: { ...DEFAULT_CONFIG, ...config },
    winner: null,
    gameOver: false,
    log: [],
  };

  if (!cross) {
    for (let c = 0; c < 8; c++) {
      board[7][c] = makePiece(BACK_RANK[c], 0);
      board[6][c] = makePiece('P', 0);
      board[0][c] = makePiece(BACK_RANK[c], 1);
      board[1][c] = makePiece('P', 1);
    }
  } else {
    for (let i = 0; i < 8; i++) {
      const k = 3 + i;
      const place = (owner, back, pawn) => {
        if (owner >= playerCount) return;
        board[back[0]][back[1]] = makePiece(BACK_RANK[owner % 2 ? 7 - i : i], owner);
        board[pawn[0]][pawn[1]] = makePiece('P', owner);
      };
      place(0, [13, k], [12, k]); // Red, bottom
      place(1, [k, 0], [k, 1]); // Blue, left
      place(2, [0, 10 - i], [1, 10 - i]); // Yellow, top (mirrored)
      place(3, [10 - i, 13], [10 - i, 12]); // Green, right
    }
  }
  return state;
}

// Distance of a square from the nearest edge: 0 is the outer ring.
export function ring(state, r, c) {
  const n = state.size;
  return Math.min(r, c, n - 1 - r, n - 1 - c);
}

export function maxCollapse(state) {
  return (state.size - 4) / 2; // stop at a 4x4 centre
}

function onShape(state, r, c) {
  const n = state.size;
  if (r < 0 || c < 0 || r >= n || c >= n) return false;
  if (state.shape === 'cross') {
    const edge = (x) => x < 3 || x > 10;
    if (edge(r) && edge(c)) return false;
  }
  return true;
}

// A square pieces can stand on right now.
export function isPlayable(state, r, c) {
  return onShape(state, r, c) && ring(state, r, c) >= state.collapse;
}

export function pieceAt(state, r, c) {
  return isPlayable(state, r, c) ? state.board[r][c] : null;
}

const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KNIGHT_JUMPS = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];

// Squares a piece threatens (could capture on), whoever stands there.
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
    case 'P': {
      const [fr, fc] = state.players[p.owner].dir;
      // Diagonal-forward: forward step plus one sideways step.
      step(fr !== 0 ? [[fr, 1], [fr, -1]] : [[1, fc], [-1, fc]]);
      break;
    }
  }
  return out;
}

// Legal destinations for the piece on (r, c): [{ r, c, capture }].
export function legalMoves(state, r, c) {
  const p = state.board[r][c];
  if (!p || state.gameOver) return [];
  const moves = [];
  const canAttack = p.hp >= 2; // an attacker must bid at least 1 and keep 1
  for (const [rr, cc] of attacks(state, r, c)) {
    const target = state.board[rr][cc];
    if (target && target.owner !== p.owner && canAttack) moves.push({ r: rr, c: cc, capture: true });
    else if (!target && p.type !== 'P') moves.push({ r: rr, c: cc, capture: false });
  }
  if (p.type === 'P') {
    const [fr, fc] = state.players[p.owner].dir;
    const r1 = r + fr, c1 = c + fc;
    if (isPlayable(state, r1, c1) && !state.board[r1][c1]) {
      moves.push({ r: r1, c: c1, capture: false });
      const r2 = r1 + fr, c2 = c1 + fc;
      if (!p.moved && isPlayable(state, r2, c2) && !state.board[r2][c2]) moves.push({ r: r2, c: c2, capture: false });
    }
  }
  return moves;
}

function isLegal(state, from, to, wantCapture) {
  return legalMoves(state, from[0], from[1]).some((m) => m.r === to[0] && m.c === to[1] && m.capture === wantCapture);
}

// Pieces of the defender's owner that could capture onto the attacked square.
export function eligibleGuards(state, to) {
  const defender = state.board[to[0]][to[1]];
  if (!defender) return [];
  const guards = [];
  for (let r = 0; r < state.size; r++) {
    for (let c = 0; c < state.size; c++) {
      const p = state.board[r][c];
      if (!p || p === defender || p.owner !== defender.owner || p.hp < 2) continue;
      if (attacks(state, r, c).some(([rr, cc]) => rr === to[0] && cc === to[1])) guards.push({ r, c, piece: p });
    }
  }
  return guards;
}

export function bidLimits(piece, role) {
  return { min: role === 'attack' ? 1 : 0, max: Math.max(0, piece.hp - 1) };
}

function checkBid(piece, bid, role) {
  const { min, max } = bidLimits(piece, role);
  if (!Number.isInteger(bid) || bid < min || bid > max) {
    throw new Error(`${role} bid must be a whole number from ${min} to ${max}`);
  }
}

function maybePromote(state, r, c) {
  const p = state.board[r][c];
  if (p.type !== 'P') return;
  const [fr, fc] = state.players[p.owner].dir;
  const n = state.size;
  const atEdge = (fr === -1 && r === 0) || (fr === 1 && r === n - 1) || (fc === -1 && c === 0) || (fc === 1 && c === n - 1);
  if (atEdge) {
    p.type = 'Q'; // keeps its current points
    state.log.push(`${state.players[p.owner].name} pawn promoted to queen`);
  }
}

function eliminate(state, owner, reason) {
  const player = state.players[owner];
  if (!player.alive) return;
  player.alive = false;
  for (let r = 0; r < state.size; r++)
    for (let c = 0; c < state.size; c++)
      if (state.board[r][c]?.owner === owner) state.board[r][c] = null;
  state.log.push(`${player.name} is eliminated (${reason})`);
}

function checkWinner(state) {
  const alive = state.players.filter((p) => p.alive);
  if (alive.length <= 1) {
    state.gameOver = true;
    state.winner = alive.length === 1 ? alive[0].id : null;
    state.log.push(alive.length === 1 ? `${alive[0].name} wins!` : 'Everyone is out: draw');
  }
}

export function roundsUntilCollapse(state) {
  if (state.collapse >= maxCollapse(state)) return Infinity;
  const { shrinkStart, shrinkEvery } = state.config;
  if (state.round <= shrinkStart) return shrinkStart - state.round + 1;
  const sinceFirst = state.round - shrinkStart - 1;
  return shrinkEvery - (sinceFirst % shrinkEvery);
}

// The squares that vanish at the next collapse are marked one round ahead.
export function isDoomed(state, r, c) {
  return roundsUntilCollapse(state) === 1 && onShape(state, r, c) && ring(state, r, c) === state.collapse;
}

function doCollapse(state) {
  const level = state.collapse;
  const kingsLost = new Set();
  for (let r = 0; r < state.size; r++) {
    for (let c = 0; c < state.size; c++) {
      const p = state.board[r][c];
      if (p && ring(state, r, c) === level) {
        if (p.type === 'K') kingsLost.add(p.owner);
        state.board[r][c] = null;
      }
    }
  }
  state.collapse++;
  state.log.push(`The board shrinks (ring ${level + 1} collapsed)`);
  for (const owner of kingsLost) eliminate(state, owner, 'king fell off the board');
}

function endTurn(state) {
  checkWinner(state);
  if (state.gameOver) return;
  const n = state.players.length;
  let next = state.current;
  do {
    next = (next + 1) % n;
    if (next <= state.current) {
      // Wrapped past the end of the seat order: new round.
      if (roundsUntilCollapse(state) === 1) doCollapse(state);
      state.round++;
    }
  } while (!state.players[next].alive && next !== state.current);
  state.current = next;
  checkWinner(state);
  if (!state.gameOver && !state.players[state.current].alive) endTurn(state);
}

function assertTurn(state, from) {
  if (state.gameOver) throw new Error('Game is over');
  const p = state.board[from[0]][from[1]];
  if (!p || p.owner !== state.current) throw new Error('Not your piece');
  return p;
}

// A plain move onto an empty square.
export function move(state, from, to) {
  const p = assertTurn(state, from);
  if (!isLegal(state, from, to, false)) throw new Error('Illegal move');
  state.board[to[0]][to[1]] = p;
  state.board[from[0]][from[1]] = null;
  p.moved = true;
  maybePromote(state, to[0], to[1]);
  endTurn(state);
}

// A capture attempt. Bids are secret until this call; everyone loses what they bid.
// duel = { from, to, attackBid, defenseBid, guard: [r, c] | null, guardBid }
export function attack(state, duel) {
  const { from, to, attackBid, defenseBid = 0, guard = null, guardBid = 0 } = duel;
  const attacker = assertTurn(state, from);
  if (!isLegal(state, from, to, true)) throw new Error('Illegal attack');
  const defender = state.board[to[0]][to[1]];
  checkBid(attacker, attackBid, 'attack');
  checkBid(defender, defenseBid, 'defense');
  let guardPiece = null;
  if (guard) {
    const g = eligibleGuards(state, to).find((x) => x.r === guard[0] && x.c === guard[1]);
    if (!g) throw new Error('That piece cannot guard this square');
    guardPiece = g.piece;
    checkBid(guardPiece, guardBid, 'guard');
  }
  const gBid = guardPiece ? guardBid : 0;
  const totalDefense = defenseBid + gBid;
  const success = attackBid > totalDefense;

  attacker.hp -= attackBid;
  if (guardPiece) guardPiece.hp -= gBid;
  const attName = `${state.players[attacker.owner].name} ${attacker.type}`;
  const defName = `${state.players[defender.owner].name} ${defender.type}`;
  const result = {
    success, attackBid, defenseBid, guardBid: gBid, totalDefense,
    attackerType: attacker.type, defenderType: defender.type, guardType: guardPiece?.type ?? null,
    defenderOwner: defender.owner,
  };

  if (success) {
    state.board[to[0]][to[1]] = attacker;
    state.board[from[0]][from[1]] = null;
    attacker.moved = true;
    state.log.push(`${attName} beat ${defName} (${attackBid} vs ${totalDefense})`);
    if (defender.type === 'K') eliminate(state, defender.owner, 'king captured');
    if (state.board[to[0]][to[1]] === attacker) maybePromote(state, to[0], to[1]);
  } else {
    defender.hp -= defenseBid;
    state.log.push(`${defName} held off ${attName} (${totalDefense} vs ${attackBid})`);
  }
  endTurn(state);
  return result;
}

// Skip the turn (for when no move is wanted or possible).
export function pass(state) {
  if (state.gameOver) throw new Error('Game is over');
  state.log.push(`${state.players[state.current].name} passed`);
  endTurn(state);
}
