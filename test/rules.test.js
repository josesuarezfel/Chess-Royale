import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, legalMoves, attack, move, pass, eligibleGuards, isPlayable, isDoomed, roundsUntilCollapse,
} from '../src/rules.js';

// An empty board of the given player count, then place pieces by hand.
function emptyGame(players = 2, config) {
  const s = newGame(players, config);
  for (const row of s.board) row.fill(null);
  return s;
}
function put(s, r, c, type, owner, hp) {
  const p = { id: Math.random(), type, owner, hp, moved: true };
  s.board[r][c] = p;
  return p;
}

test('starting armies are 147 points each', () => {
  for (const n of [2, 3, 4]) {
    const s = newGame(n);
    const totals = Array(n).fill(0);
    for (const row of s.board) for (const p of row) if (p) totals[p.owner] += p.hp;
    assert.deepEqual(totals, Array(n).fill(147));
    for (let r = 0; r < s.size; r++)
      for (let c = 0; c < s.size; c++)
        if (s.board[r][c]) assert.ok(isPlayable(s, r, c), `piece on dead square ${r},${c}`);
  }
});

test('every seat has opening moves on the cross board', () => {
  const s = newGame(4);
  for (let owner = 0; owner < 4; owner++) {
    let count = 0;
    for (let r = 0; r < 14; r++)
      for (let c = 0; c < 14; c++)
        if (s.board[r][c]?.owner === owner) count += legalMoves(s, r, c).length;
    assert.equal(count, 20, `seat ${owner}`); // 16 pawn moves + 4 knight moves, as in chess
  }
});

test('successful attack: defender dies, attacker moves in and pays its bid', () => {
  const s = emptyGame();
  put(s, 7, 4, 'K', 0, 30); put(s, 0, 4, 'K', 1, 30);
  const rook = put(s, 4, 0, 'R', 0, 15);
  put(s, 4, 5, 'B', 1, 9);
  const res = attack(s, { from: [4, 0], to: [4, 5], attackBid: 6, defenseBid: 5 });
  assert.equal(res.success, true);
  assert.equal(s.board[4][5], rook);
  assert.equal(s.board[4][0], null);
  assert.equal(rook.hp, 9);
  assert.equal(s.current, 1);
});

test('failed attack and ties: both sides pay, nobody moves', () => {
  const s = emptyGame();
  put(s, 7, 4, 'K', 0, 30); put(s, 0, 4, 'K', 1, 30);
  const rook = put(s, 4, 0, 'R', 0, 15);
  const bishop = put(s, 4, 5, 'B', 1, 9);
  const res = attack(s, { from: [4, 0], to: [4, 5], attackBid: 6, defenseBid: 6 });
  assert.equal(res.success, false);
  assert.equal(rook.hp, 9);
  assert.equal(bishop.hp, 3);
  assert.equal(s.board[4][0], rook);
  assert.equal(s.board[4][5], bishop);
});

test('guard adds to defense and pays its bid', () => {
  const s = emptyGame();
  put(s, 7, 4, 'K', 0, 30); put(s, 0, 7, 'K', 1, 30);
  put(s, 4, 0, 'R', 0, 15);
  const bishop = put(s, 4, 5, 'B', 1, 9);
  const knight = put(s, 2, 4, 'N', 1, 9); // knight on (2,4) covers (4,5)
  const guards = eligibleGuards(s, [4, 5]);
  assert.deepEqual(guards.map((g) => g.piece), [knight]);
  const res = attack(s, { from: [4, 0], to: [4, 5], attackBid: 8, defenseBid: 4, guard: [2, 4], guardBid: 4 });
  assert.equal(res.success, false);
  assert.equal(res.totalDefense, 8);
  assert.equal(bishop.hp, 5);
  assert.equal(knight.hp, 5);
});

test('bid limits: pieces must keep 1 point and a 1-point piece cannot attack', () => {
  const s = emptyGame();
  put(s, 7, 4, 'K', 0, 30); put(s, 0, 4, 'K', 1, 30);
  put(s, 4, 0, 'R', 0, 15);
  put(s, 4, 5, 'B', 1, 9);
  assert.throws(() => attack(s, { from: [4, 0], to: [4, 5], attackBid: 15, defenseBid: 0 }));
  assert.throws(() => attack(s, { from: [4, 0], to: [4, 5], attackBid: 0, defenseBid: 0 }));
  assert.throws(() => attack(s, { from: [4, 0], to: [4, 5], attackBid: 3, defenseBid: 9 }));
  s.board[4][0].hp = 1;
  assert.equal(legalMoves(s, 4, 0).some((m) => m.capture), false);
});

test('killing a king eliminates the player, removes their pieces and ends a 2-player game', () => {
  const s = emptyGame();
  put(s, 7, 4, 'K', 0, 30);
  put(s, 0, 4, 'K', 1, 30);
  put(s, 0, 0, 'R', 1, 15);
  put(s, 3, 4, 'Q', 0, 27);
  attack(s, { from: [3, 4], to: [0, 4], attackBid: 10, defenseBid: 9 });
  assert.equal(s.players[1].alive, false);
  assert.equal(s.board[0][0], null);
  assert.equal(s.gameOver, true);
  assert.equal(s.winner, 0);
});

test('eliminated players are skipped in turn order', () => {
  const s = emptyGame(3);
  put(s, 13, 7, 'K', 0, 30);
  put(s, 7, 0, 'K', 1, 30);
  put(s, 0, 7, 'K', 2, 30);
  put(s, 7, 3, 'Q', 0, 27);
  attack(s, { from: [7, 3], to: [7, 0], attackBid: 5, defenseBid: 0 });
  assert.equal(s.players[1].alive, false);
  assert.equal(s.current, 2);
  pass(s);
  assert.equal(s.current, 0);
  assert.equal(s.round, 2);
});

test('pawn promotes to a queen and keeps its points', () => {
  const s = emptyGame();
  put(s, 7, 4, 'K', 0, 30); put(s, 0, 7, 'K', 1, 30);
  const pawn = put(s, 1, 0, 'P', 0, 2);
  move(s, [1, 0], [0, 0]);
  assert.equal(pawn.type, 'Q');
  assert.equal(pawn.hp, 2);
});

test('board shrinks after the configured rounds and kills pieces on the edge', () => {
  const s = emptyGame(2, { shrinkStart: 2, shrinkEvery: 2 });
  put(s, 7, 4, 'K', 0, 30);
  put(s, 3, 3, 'K', 1, 30);
  const rook = put(s, 0, 0, 'R', 1, 15);
  assert.equal(roundsUntilCollapse(s), 2);
  pass(s); pass(s); // end of round 1
  assert.equal(isDoomed(s, 0, 0), true);
  pass(s); pass(s); // end of round 2: collapse
  assert.equal(s.collapse, 1);
  assert.equal(isPlayable(s, 0, 0), false);
  assert.ok(!s.board.flat().includes(rook));
  assert.equal(s.players[0].alive, false); // white king stood on the edge
  assert.equal(s.winner, 1);
});
