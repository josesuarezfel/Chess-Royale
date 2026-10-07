// Simple computer opponents. They act as soon as their wait time is over, plus a short "thinking" pause.
import {
  legalMoves, isReady, startAttack, move, eligibleGuards, findPiece, distFromCenter, isDoomed, START_POINTS,
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

  // Attack when the odds look good: plenty of points compared with the target.
  let best = null;
  for (const a of captures) {
    const target = state.board[a.to[0]][a.to[1]];
    const odds = (a.piece.hp - 1) / Math.max(1, target.hp);
    const value = START_POINTS[target.type] + (target.type === 'K' ? 40 : 0);
    const score = value * Math.min(odds, 2) - (a.piece.type === 'K' ? 20 : 0);
    if (odds >= 0.6 && (!best || score > best.score)) best = { ...a, score, target };
  }
  if (best) {
    const want = Math.ceil(best.target.hp * rand(rng, 0.45, 1.0));
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

// The bot's secret answer to an attack on one of its pieces.
export function botDefense(state, duel, rng = Math.random) {
  const at = findPiece(state, duel.defenderId);
  const defender = state.board[at[0]][at[1]];
  const share = defender.type === 'K' ? rand(rng, 0.6, 1) : rand(rng, 0.25, 0.85);
  const defenseBid = Math.round((defender.hp - 1) * share);
  const guards = eligibleGuards(state, duel).sort((a, b) => b.piece.hp - a.piece.hp);
  if (guards.length && rng() < 0.7) {
    const g = guards[0].piece;
    return { defenseBid, guardId: g.id, guardBid: Math.round((g.hp - 1) * rand(rng, 0.2, 0.6)) };
  }
  return { defenseBid, guardId: null, guardBid: 0 };
}
