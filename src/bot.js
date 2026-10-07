// Simple computer opponents. They act as soon as their wait time is over, plus a short "thinking" pause.
import {
  legalMoves, isReady, startAttack, move, eligibleGuards, findPiece, distFromCenter, isDoomed, attacks, START_POINTS,
} from './rules.js';

const rand = (rng, a, b) => a + (b - a) * rng();

// Returns what the bot did, or null if it had nothing to do.
export function botAct(state, owner, now, rng = Math.random) {
  if (!isReady(state, owner, now)) return null;
  const captures = [];
  const quiet = [];
  for (let r = 0; r < state.size; r++) {
    for (let c = 0; c < state.size; c++) {
      const p = state.board[r][c];
      if (!p || p.owner !== owner) continue;
      for (const m of legalMoves(state, r, c)) (m.capture ? captures : quiet).push({ from: [r, c], to: [m.r, m.c], piece: p });
    }
  }

  // Attack when the odds look good: unprotected targets are free, protected ones cost more.
  let best = null;
  for (const a of captures) {
    const target = state.board[a.to[0]][a.to[1]];
    const guardPower = protectionOf(state, a.to, target);
    const odds = (a.piece.hp - 1) / Math.max(1, guardPower * 0.6);
    const value = START_POINTS[target.type] + (target.type === 'K' ? 40 : 0);
    const score = value * Math.min(odds, 2) - (a.piece.type === 'K' ? 20 : 0);
    if ((guardPower === 0 || odds >= 0.8) && (!best || score > best.score)) best = { ...a, score, guardPower };
  }
  if (best) {
    const want = best.guardPower === 0 ? 1 : Math.ceil(best.guardPower * rand(rng, 0.35, 0.8));
    const attackBid = Math.max(1, Math.min(best.piece.hp - 1, want));
    startAttack(state, { from: best.from, to: best.to, attackBid }, now);
    return { kind: 'attack', from: best.from, to: best.to };
  }

  if (!quiet.length) return null;
  // Otherwise drift toward the centre, stepping off squares that are about to collapse.
  const scored = quiet.map((m) => {
    const before = distFromCenter(state, ...m.from);
    const after = distFromCenter(state, ...m.to);
    let score = (before - after) * (before > state.radius - 3 ? 2 : 0.4) + rand(rng, 0, 1.5);
    if (isDoomed(state, ...m.from, now)) score += m.piece.type === 'K' ? 30 : 10;
    if (isDoomed(state, ...m.to, now)) score -= 20;
    if (m.piece.type === 'K') score -= 0.8; // keep the king back
    return { ...m, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const pick = scored[0];
  move(state, pick.from, pick.to, now);
  return { kind: 'move', from: pick.from, to: pick.to };
}

// Points the pieces protecting a square could put up (what an attacker has to beat at most).
function protectionOf(state, at, target) {
  let total = 0;
  for (let r = 0; r < state.size; r++) {
    for (let c = 0; c < state.size; c++) {
      const p = state.board[r][c];
      if (!p || p === target || p.owner !== target.owner || p.hp < 2) continue;
      if (attacks(state, r, c).some(([rr, cc]) => rr === at[0] && cc === at[1])) total += p.hp - 1;
    }
  }
  return total;
}

// The bot's secret answer to an attack: each protecting piece bids part of its points.
export function botDefense(state, duel, rng = Math.random) {
  const at = findPiece(state, duel.defenderId);
  const kingAttacked = state.board[at[0]][at[1]].type === 'K';
  return {
    guards: eligibleGuards(state, duel).map((g) => ({
      id: g.piece.id,
      bid: Math.round((g.piece.hp - 1) * (kingAttacked ? rand(rng, 0.6, 1) : rand(rng, 0.25, 0.75))),
    })),
  };
}
