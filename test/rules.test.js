import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, legalMoves, move, startAttack, defend, tick, eligibleGuards, isPlayable, isDoomed,
  autoDefense, pointsByPlayer, findPiece,
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

test('duel: the attack wins, both bids are paid, the attacker takes the square', () => {
  const s = emptyGame();
  withKings(s);
  const rook = put(s, 8, 4, 'R', 0, 15);
  put(s, 8, 9, 'B', 1, 9);
  const duel = startAttack(s, { from: [8, 4], to: [8, 9], attackBid: 6 }, 0);
  assert.equal(legalMoves(s, 8, 4).length, 0, 'attacker is locked while the duel is open');
  const res = defend(s, duel.id, { defenseBid: 5 });
  assert.equal(res.success, true);
  assert.equal(s.board[8][9], rook);
  assert.equal(rook.hp, 9);
});

test('duel: ties go to the defender and both pay', () => {
  const s = emptyGame();
  withKings(s);
  const rook = put(s, 8, 4, 'R', 0, 15);
  const bishop = put(s, 8, 9, 'B', 1, 9);
  const duel = startAttack(s, { from: [8, 4], to: [8, 9], attackBid: 6 }, 0);
  const res = defend(s, duel.id, { defenseBid: 6 });
  assert.equal(res.success, false);
  assert.equal(rook.hp, 9);
  assert.equal(bishop.hp, 3);
  assert.equal(s.board[8][4], rook);
});

test('guard adds its bid and pays it', () => {
  const s = emptyGame();
  withKings(s);
  put(s, 8, 4, 'R', 0, 15);
  const bishop = put(s, 8, 9, 'B', 1, 9);
  const knight = put(s, 6, 8, 'N', 1, 9); // covers (8, 9)
  const duel = startAttack(s, { from: [8, 4], to: [8, 9], attackBid: 8 }, 0);
  assert.deepEqual(eligibleGuards(s, duel).map((g) => g.piece), [knight]);
  const res = defend(s, duel.id, { defenseBid: 4, guardId: knight.id, guardBid: 4 });
  assert.equal(res.success, false);
  assert.equal(bishop.hp, 5);
  assert.equal(knight.hp, 5);
});

test('an unanswered attack gets the automatic defense when time runs out', () => {
  const s = emptyGame();
  withKings(s);
  put(s, 8, 4, 'R', 0, 15);
  const bishop = put(s, 8, 9, 'B', 1, 9);
  const duel = startAttack(s, { from: [8, 4], to: [8, 9], attackBid: 3 }, 0);
  assert.equal(autoDefense(s, duel).defenseBid, 4);
  tick(s, 4999);
  assert.equal(s.duels.length, 1);
  tick(s, 5000);
  assert.equal(s.duels.length, 0);
  assert.equal(bishop.hp, 5);
  assert.equal(s.board[8][9], bishop);
});

test('killing a king eliminates the player and ends a 2-player game', () => {
  const s = emptyGame();
  withKings(s);
  put(s, 8, 10, 'Q', 0, 27);
  put(s, 3, 8, 'R', 1, 15);
  const duel = startAttack(s, { from: [8, 10], to: [8, 14], attackBid: 10 }, 0);
  defend(s, duel.id, { defenseBid: 9 });
  assert.equal(s.players[1].alive, false);
  assert.equal(s.board[3][8], null);
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
