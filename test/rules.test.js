import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, legalMoves, move, startAttack, defend, tick, eligibleGuards, isPlayable, isDoomed,
  autoDefense, pointsByPlayer, findPiece, START_POINTS,
} from '../src/rules.js';
import { botAct, botDefense } from '../src/bot.js';

const CFG = { boardRadius: 8, cooldown: 1000, duelWindow: 5000, shrinkStart: 60000, shrinkEvery: 30000, shrinkWarning: 5000, minRadius: 3 };

// A 2-player game with an empty board; place pieces by hand. Board cells run 0..15.
function emptyGame(players = 2, config = {}) {
  const s = newGame(players, { humans: [], now: 0, config: { ...CFG, ...config } });
  for (const row of s.board) row.fill(null);
  return s;
}
let id = 1000;
function put(s, r, c, type, owner, hp) {
  const p = { id: id++, type, owner, hp };
  s.board[r][c] = p;
  return p;
}
function withKings(s) {
  put(s, 8, 1, 'K', 0, 30);
  put(s, 8, 14, 'K', 1, 30);
}

test('armies fit on the round board for 2 to 8 players, 147 points each', () => {
  for (let n = 2; n <= 8; n++) {
    const s = newGame(n);
    assert.deepEqual(pointsByPlayer(s), Array(n).fill(147), `${n} players`);
    for (let r = 0; r < s.size; r++)
      for (let c = 0; c < s.size; c++)
        if (s.board[r][c]) assert.ok(isPlayable(s, r, c), `${n} players: piece off the board at ${r},${c}`);
  }
});

test('corners of the grid are off the round board', () => {
  const s = newGame(2);
  assert.equal(isPlayable(s, 0, 0), false);
  assert.equal(isPlayable(s, s.size / 2, s.size / 2), true);
});

test('pawns step straight in any direction and capture diagonally in any direction', () => {
  const s = emptyGame();
  withKings(s);
  put(s, 8, 8, 'P', 0, 3);
  put(s, 7, 7, 'N', 1, 9);
  put(s, 9, 8, 'N', 1, 9); // blocks the downward step
  const moves = legalMoves(s, 8, 8);
  const quiet = moves.filter((m) => !m.capture).map((m) => [m.r, m.c]).sort();
  assert.deepEqual(quiet, [[7, 8], [8, 7], [8, 9]]);
  assert.deepEqual(moves.filter((m) => m.capture).map((m) => [m.r, m.c]), [[7, 7]]);
});

test('no turns: anyone can act once their wait time is over', () => {
  const s = emptyGame();
  withKings(s);
  put(s, 8, 5, 'R', 0, 15);
  put(s, 8, 10, 'R', 1, 15);
  move(s, [8, 5], [7, 5], 0);
  move(s, [8, 10], [7, 10], 10); // player 1 moves right away, no turn order
  assert.throws(() => move(s, [7, 5], [6, 5], 500), /waiting/);
  move(s, [7, 5], [6, 5], 1000);
});

test('an unprotected piece falls at once: the attacker pays its bid and takes the square', () => {
  const s = emptyGame();
  withKings(s);
  const rook = put(s, 8, 4, 'R', 0, 15);
  const bishop = put(s, 8, 9, 'B', 1, 9);
  const duel = startAttack(s, { from: [8, 4], to: [8, 9], attackBid: 1 }, 0);
  assert.equal(duel.result.success, true);
  assert.equal(s.duels.length, 0);
  assert.equal(s.board[8][9], rook);
  assert.equal(findPiece(s, bishop.id), null);
  assert.equal(rook.hp, 14);
});

test('only protecting pieces defend: guards bid, the attacked piece pays nothing', () => {
  const s = emptyGame();
  withKings(s);
  const rook = put(s, 8, 4, 'R', 0, 15);
  const bishop = put(s, 8, 9, 'B', 1, 9);
  const knight = put(s, 6, 8, 'N', 1, 9); // covers (8, 9)
  const pawn = put(s, 9, 10, 'P', 1, 3); // covers (8, 9) diagonally
  const duel = startAttack(s, { from: [8, 4], to: [8, 9], attackBid: 8 }, 0);
  assert.equal(duel.result, undefined, 'protected target waits for an answer');
  assert.equal(legalMoves(s, 8, 4).length, 0, 'attacker is locked while the duel is open');
  assert.deepEqual(eligibleGuards(s, duel).map((g) => g.piece).sort((a, b) => a.id - b.id), [knight, pawn]);
  const res = defend(s, duel.id, { guards: [{ id: knight.id, bid: 6 }, { id: pawn.id, bid: 2 }] });
  assert.equal(res.success, false, 'a tie goes to the defenders');
  assert.equal(res.totalDefense, 8);
  assert.equal(rook.hp, 7);
  assert.equal(knight.hp, 3);
  assert.equal(pawn.hp, 1);
  assert.equal(bishop.hp, 9);
  assert.equal(s.board[8][4], rook);
});

test('a higher attack beats the guards and takes the square', () => {
  const s = emptyGame();
  withKings(s);
  const rook = put(s, 8, 4, 'R', 0, 15);
  put(s, 8, 9, 'B', 1, 9);
  const knight = put(s, 6, 8, 'N', 1, 9);
  const duel = startAttack(s, { from: [8, 4], to: [8, 9], attackBid: 6 }, 0);
  const res = defend(s, duel.id, { guards: [{ id: knight.id, bid: 5 }] });
  assert.equal(res.success, true);
  assert.equal(s.board[8][9], rook);
  assert.equal(rook.hp, 9);
  assert.equal(knight.hp, 4);
});

test('pieces that do not protect the square cannot defend it', () => {
  const s = emptyGame();
  withKings(s);
  put(s, 8, 4, 'R', 0, 15);
  put(s, 8, 9, 'B', 1, 9);
  put(s, 6, 8, 'N', 1, 9);
  const far = put(s, 2, 2, 'Q', 1, 27);
  const duel = startAttack(s, { from: [8, 4], to: [8, 9], attackBid: 6 }, 0);
  assert.throws(() => defend(s, duel.id, { guards: [{ id: far.id, bid: 10 }] }), /cannot guard/);
});

test('when time runs out, each guard bids half its points', () => {
  const s = emptyGame();
  withKings(s);
  put(s, 8, 4, 'R', 0, 15);
  const bishop = put(s, 8, 9, 'B', 1, 9);
  const knight = put(s, 6, 8, 'N', 1, 9);
  const duel = startAttack(s, { from: [8, 4], to: [8, 9], attackBid: 3 }, 0);
  assert.deepEqual(autoDefense(s, duel), { guards: [{ id: knight.id, bid: 4 }] });
  tick(s, CFG.duelWindow - 1);
  assert.equal(s.duels.length, 1);
  tick(s, CFG.duelWindow);
  assert.equal(s.duels.length, 0);
  assert.equal(knight.hp, 5);
  assert.equal(s.board[8][9], bishop);
});

test('killing a king eliminates the player and ends a 2-player game', () => {
  const s = emptyGame();
  withKings(s);
  put(s, 8, 10, 'Q', 0, 27);
  put(s, 3, 3, 'R', 1, 15);
  startAttack(s, { from: [8, 10], to: [8, 14], attackBid: 10 }, 0);
  assert.equal(s.players[1].alive, false);
  assert.equal(s.board[3][3], null);
  assert.equal(s.gameOver, true);
  assert.equal(s.winner, 0);
});

test('the board shrinks on schedule and pieces on the edge fall off', () => {
  const s = emptyGame();
  put(s, 8, 8, 'K', 0, 30);
  put(s, 8, 9, 'K', 1, 30);
  const rook = put(s, 8, 0, 'R', 1, 15); // distance 7.5 from the centre
  assert.equal(isDoomed(s, 8, 0, 50000), false);
  assert.equal(isDoomed(s, 8, 0, 55000), true);
  tick(s, 60000);
  assert.equal(s.radius, 7);
  assert.equal(findPiece(s, rook.id), null);
  assert.equal(s.nextShrinkAt, 90000);
});

test('a king on the edge when it collapses eliminates its player', () => {
  const s = emptyGame();
  put(s, 8, 8, 'K', 0, 30);
  put(s, 8, 0, 'K', 1, 30);
  tick(s, 60000);
  assert.equal(s.players[1].alive, false);
  assert.equal(s.winner, 0);
});

test('bots alone can play a full 4-player game to a winner', () => {
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const s = newGame(4, { humans: [], now: 0 });
  let now = 0;
  while (!s.gameOver && now < 3_600_000) {
    now += 250;
    for (const pl of s.players) if (pl.alive) botAct(s, pl.id, now, rng);
    for (const d of [...s.duels]) if (s.duels.includes(d)) defend(s, d.id, botDefense(s, d, rng));
    tick(s, now);
  }
  assert.equal(s.gameOver, true);
  assert.ok(s.winner === null || s.players[s.winner].alive);
});

// ---------- capture the flag ----------
test('capture the flag: a piece on the flag scores, and two points when alone', () => {
  const s = newGame(4, { humans: [], now: 0, config: { mode: 'flag' } });
  assert.ok(s.flag, 'a flag is up from the start');
  const { r, c } = s.flag;
  s.board[r][c] = { id: 9001, type: 'R', owner: 0, hp: 15 };
  tick(s, 3000);
  assert.equal(s.scores[0], 6); // 3 seconds alone on the flag
  assert.deepEqual(s.scores.slice(1), [0, 0, 0]);
});

test('capture the flag: sharing the flag is worth one point each', () => {
  const s = newGame(4, { humans: [], now: 0, config: { mode: 'flag' } });
  const { r, c } = s.flag;
  s.board[r][c] = { id: 9001, type: 'R', owner: 0, hp: 15 };
  s.board[r][c + 1] = { id: 9002, type: 'R', owner: 1, hp: 15 };
  tick(s, 2000);
  assert.deepEqual(s.scores.slice(0, 2), [2, 2]);
});

test('capture the flag: the flag moves on its own', () => {
  const s = newGame(4, { humans: [], now: 0, config: { mode: 'flag' } });
  const first = { ...s.flag };
  tick(s, s.config.flagLife + 10);
  assert.notDeepEqual([s.flag.x, s.flag.y], [first.x, first.y]);
});

test('capture the flag: captured pieces come back, kings do not end the game', () => {
  const s = newGame(2, { humans: [], now: 0, config: { mode: 'flag' } });
  const kingAt = findPiece(s, s.board.flat().find((p) => p && p.type === 'K' && p.owner === 1).id);
  const kings = s.board[kingAt[0]][kingAt[1]];
  // A lone attacker next to the enemy king takes it.
  s.board[kingAt[0]][kingAt[1] + 1] = { id: 9003, type: 'Q', owner: 0, hp: 27 };
  const duel = startAttack(s, { from: [kingAt[0], kingAt[1] + 1], to: kingAt, attackBid: 20 }, 1000);
  if (!duel.result) defend(s, duel.id, { guards: [] }, 1000);
  assert.equal(s.players[1].alive, true, 'nobody is eliminated in this mode');
  assert.equal(s.gameOver, false);
  assert.equal(s.respawns.length, 1);
  assert.equal(s.respawns[0].type, 'K');
  tick(s, 1000 + s.config.respawnDelay + 10);
  assert.equal(s.respawns.length, 0);
  const back = s.board.flat().filter((p) => p && p.owner === 1 && p.type === 'K');
  assert.equal(back.length, 1);
  assert.equal(back[0].hp, START_POINTS.K, 'it comes back at full points');
  assert.notEqual(back[0].id, kings.id);
});

test('capture the flag: first to the target score wins', () => {
  const s = newGame(2, { humans: [], now: 0, config: { mode: 'flag', targetScore: 10 } });
  const { r, c } = s.flag;
  s.board[r][c] = { id: 9004, type: 'R', owner: 1, hp: 15 };
  tick(s, 6000);
  assert.equal(s.gameOver, true);
  assert.equal(s.winner, 1);
});

test('royale mode is unchanged: no flag, no respawns', () => {
  const s = newGame(4, { humans: [], now: 0 });
  assert.equal(s.mode, 'royale');
  assert.equal(s.flag, null);
  tick(s, 60000);
  assert.equal(s.respawns.length, 0);
});
