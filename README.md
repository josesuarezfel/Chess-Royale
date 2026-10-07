# Chess Royale

Free-for-all chess in 3D on a round board. There are no turns: after every move you wait a few seconds, then go again. Every capture is a secret bidding duel, and the last king standing wins.

## Rules in short

- Points are life: King 30, Queen 27, Rook 15, Bishop 9, Knight 9, Pawn 3.
- Pieces move like in chess. Pawns have no "forward" on a round board: they step one square straight in any direction and capture one square diagonally in any direction.
- After each move or attack, a player waits 4 seconds before acting again.
- Attacking starts a duel. Both sides bid points in secret; the defender may add one guard (another of its pieces covering the square). Every piece loses what it bid. Higher attack wins and takes the square; a tie or higher defense holds.
- A defender has 7 seconds to answer, or its piece bids half its points.
- The board shrinks one ring after 90 seconds and every 45 seconds after that. Lose your king and you are out.

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
- `src/main.js` — 3D board (three.js), controls and the duel panels
- `test/rules.test.js` — rules tests, including a full bots-only game
