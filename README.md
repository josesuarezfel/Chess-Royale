# Chess Royale

Free-for-all chess for 2 to 4 players on one screen. Pieces move like in chess, but every capture is a secret bidding duel, and the last king standing wins.

## Rules in short

- Points are life: King 30, Queen 27, Rook 15, Bishop 9, Knight 9, Pawn 3.
- Moving onto an enemy starts a duel. Attacker and defender bid points in secret; the defender may add one guard (another of its pieces covering the square).
- Every piece loses what it bid. Higher attack wins and takes the square; a tie or higher defense stops it.
- Lose your king and you are out. After round 15 the outer ring of the board collapses every 5 rounds.

2 players use an 8x8 board; 3 or 4 players use a 14x14 cross board.

## Run it

```sh
npm start      # serves the folder, then open the printed URL
npm test       # rules engine tests (Node 20+)
```

Any static file server works; the page uses ES modules, so opening `index.html` straight from disk will not load.

## Layout

- `src/rules.js` — rules engine (pure functions, no DOM)
- `src/main.js` — board UI and the hot-seat duel flow
- `test/rules.test.js` — rules tests
