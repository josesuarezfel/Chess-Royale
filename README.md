# Chess Royale

Free-for-all chess in 3D on a round board. There are no turns: after every move you wait a few seconds, then go again. Every capture is a secret bidding duel, and the last king standing wins.

## Rules in short

- Points are life: King 30, Queen 27, Rook 15, Bishop 9, Knight 9, Pawn 3.
- Pieces move like in chess. Pawns have no "forward" on a round board: they step one square straight in any direction and capture one square diagonally in any direction.
- After each move or attack, a player waits 5 seconds before acting again.
- Attacking starts a duel. The attacker bids points in secret. The attacked piece can't defend itself: only the pieces protecting its square (that could capture there) bid to save it. Every piece loses what it bid. Higher attack wins and takes the square; a tie holds. An unprotected piece falls at once.
- The defending side has 15 seconds to answer, or each protecting piece bids half its points.
- A ring of fire shrinks the board one square after 2 minutes and every minute after that; the squares fall into the lava. Lose your king and you are out.

The prototype is you (Red) against 1 to 7 computer players.

## Run it

```sh
npm start      # serves the folder, then open the printed URL
npm test       # rules engine tests (Node 20+)
```

Any static file server works. The page loads three.js from the jsDelivr CDN and uses ES modules, so opening `index.html` straight from disk will not work.

## Layout

- `src/rules.js` — rules engine (pure functions, no DOM; time is passed in)
- `src/bot.js` — computer players
- `src/main.js` — game loop, 3D pieces, controls and the duel panels
- `src/fx.js` — battlefield scenery and combat effects (lava, fire wall, explosions)
- `test/rules.test.js` — rules tests, including a full bots-only game
