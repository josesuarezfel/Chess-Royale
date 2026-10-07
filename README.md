# Chess Royale

Free-for-all chess in 3D on a round board. There are no turns: after every move you wait a few seconds, then go again. Every capture is a secret bidding duel, and the last king standing wins.

## Rules in short

- Points are life: King 30, Queen 27, Rook 15, Bishop 9, Knight 9, Pawn 3.
- Pieces move like in chess. Pawns have no "forward" on a round board: they step one square straight in any direction and capture one square diagonally in any direction.
- After each move or attack, a player waits 5 seconds before acting again.
- Attacking starts a duel. The attacker bids points in secret. The attacked piece can't defend itself: only the pieces protecting its square (that could capture there) bid to save it. Every piece loses what it bid. Higher attack wins and takes the square; a tie holds. An unprotected piece falls at once.
- When you're attacked, a quick menu lists the pieces protecting that square. Pick any of them (in the menu or by clicking them on the board) and set how many points each one bids; the defense is their total. You have 15 seconds to answer, or each protecting piece bids half its points.
- A ring of fire shrinks the board one square after 2 minutes and every minute after that; the squares fall into the lava. Lose your king and you are out.

The prototype is you (Red) against 1 to 7 computer players.

## Game modes

- **Battle Royale**: the rules above. Lose your king and you are out; the last king standing wins.
- **Capture the Flag**: a flag circle appears on the board, one at a time, and moves somewhere else every 30 seconds. Each second you have a piece inside it you score a point, or two while you hold it alone. Points are a separate score, not the pieces' own points. A captured piece comes back on its army's starting squares 10 seconds later at full points, kings included, so nobody is eliminated and the board never shrinks. First to 60 points wins.

## Battlefields

Pick where the war is fought from the menu. The rules are the same on every field; the sky, land, moat, props and weather change.

- **The Forge** (legend): a volcano with a lava moat and drifting embers.
- **Waterloo** (Belgium, 1815): green farmland, a river, farmhouses, cannons and rain.
- **Stalingrad** (Russia, 1942): snow, a frozen river, bombed-out buildings, tank traps and wrecked tanks.
- **El Alamein** (Egypt, 1942): desert dunes, a sand pit, palms, wrecked tanks and blowing sand.
- **Thermopylae** (Greece, 480 BC): rocky hills at sunset over the sea, marble columns, olive trees and fallen shields.
- **Sekigahara** (Japan, 1600): misty green mountains, a river, cherry trees, torii gates, stone lanterns and falling petals.

## Run it

```sh
npm start      # serves the folder, then open the printed URL
npm test       # rules engine tests (Node 20+)
```

Any static file server works. The page loads three.js from the jsDelivr CDN and uses ES modules, so opening `index.html` straight from disk will not work.

## Layout

- `src/rules.js` — rules engine for both modes (pure functions, no DOM; time is passed in)
- `src/bot.js` — computer players
- `src/main.js` — game loop, 3D pieces, controls and the duel panels
- `src/fields.js` — the battlefields: colors, moat, props and weather for each
- `src/fx.js` — battlefield scenery (shader fire and smoke, lava moat, terrain, ruins, banners) and combat effects
- `test/rules.test.js` — rules tests, including a full bots-only game
