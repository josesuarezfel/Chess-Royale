import {
  newGame, legalMoves, move, attack, pass, eligibleGuards, bidLimits,
  isPlayable, isDoomed, roundsUntilCollapse,
} from './rules.js';

const GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
const NAME = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight', P: 'Pawn' };

const $ = (id) => document.getElementById(id);
let state = null;
let selected = null; // [r, c]
let targets = []; // legal moves of the selected piece
let duel = null; // { from, to, attackBid }
let highlightGuards = [];

function square(r, c) {
  return String.fromCharCode(97 + c) + (state.size - r);
}
function label(p, r, c) {
  return `${NAME[p.type]} on ${square(r, c)} (${p.hp} pts)`;
}
function player(i) { return state.players[i]; }
function dot(color) { return `<span class="dot" style="background:${color}"></span>`; }
function esc(s) { return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]); }

// ---------- setup ----------
document.querySelectorAll('[data-players]').forEach((b) =>
  b.addEventListener('click', () => start(Number(b.dataset.players))));
$('new-btn').addEventListener('click', () => {
  $('game').hidden = true;
  $('setup').hidden = false;
});
$('pass-btn').addEventListener('click', () => {
  if (!state || state.gameOver) return;
  pass(state);
  clearSelection();
  render();
});
$('rules-btn').addEventListener('click', () => openModal($('rules-tpl').innerHTML));

function start(n) {
  state = newGame(n);
  clearSelection();
  $('setup').hidden = true;
  $('game').hidden = false;
  render();
}

function clearSelection() {
  selected = null;
  targets = [];
  highlightGuards = [];
}

// ---------- board ----------
function render() {
  const board = $('board');
  const n = state.size;
  board.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  board.innerHTML = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const el = document.createElement('div');
      el.className = 'sq';
      const inShape = state.shape !== 'cross' || !((r < 3 || r > 10) && (c < 3 || c > 10));
      if (!inShape) {
        el.classList.add('off');
      } else if (!isPlayable(state, r, c)) {
        el.classList.add('gone');
      } else {
        el.classList.add((r + c) % 2 ? 'dark' : 'light');
        if (isDoomed(state, r, c)) el.classList.add('doomed');
        const p = state.board[r][c];
        if (p) {
          el.innerHTML = `<span class="piece" style="color:${player(p.owner).color}">${GLYPH[p.type]}</span><span class="hp">${p.hp}</span>`;
          el.title = `${player(p.owner).name} ${label(p, r, c)}`;
        }
        if (selected && selected[0] === r && selected[1] === c) el.classList.add('sel');
        const t = targets.find((m) => m.r === r && m.c === c);
        if (t) el.classList.add(t.capture ? 'capture' : 'move');
        if (highlightGuards.some(([gr, gc]) => gr === r && gc === c)) el.classList.add('guard');
        el.addEventListener('click', () => onSquare(r, c));
      }
      board.appendChild(el);
    }
  }
  renderPanel();
}

function renderPanel() {
  const cur = player(state.current);
  $('turn').innerHTML = state.gameOver
    ? (state.winner === null ? 'Draw' : `${dot(player(state.winner).color)} ${esc(player(state.winner).name)} wins!`)
    : `${dot(cur.color)} ${esc(cur.name)} to move · Round ${state.round}`;
  const left = roundsUntilCollapse(state);
  $('shrink').textContent = left === Infinity
    ? 'The board has stopped shrinking.'
    : left === 1
      ? 'Striped squares collapse at the end of this round!'
      : `Board shrinks in ${left} rounds.`;
  const totals = state.players.map(() => 0);
  for (const row of state.board) for (const p of row) if (p) totals[p.owner] += p.hp;
  $('players').innerHTML = state.players.map((p, i) =>
    `<li class="${p.alive ? '' : 'out'}">${dot(p.color)} ${esc(p.name)}<span class="pts">${p.alive ? totals[i] + ' pts' : 'out'}</span></li>`).join('');
  $('log').innerHTML = state.log.slice(-30).reverse().map((l) => `<li>${esc(l)}</li>`).join('');
  $('pass-btn').disabled = state.gameOver;
}

function onSquare(r, c) {
  if (state.gameOver || duel) return;
  const p = state.board[r][c];
  const target = targets.find((m) => m.r === r && m.c === c);
  if (selected && target) {
    const from = selected;
    clearSelection();
    if (target.capture) {
      startDuel(from, [r, c]);
    } else {
      move(state, from, [r, c]);
      render();
      if (state.gameOver) announceWinner();
    }
    return;
  }
  if (p && p.owner === state.current) {
    selected = [r, c];
    targets = legalMoves(state, r, c);
  } else {
    clearSelection();
  }
  render();
}

// ---------- duel ----------
function startDuel(from, to) {
  duel = { from, to };
  const a = state.board[from[0]][from[1]];
  const d = state.board[to[0]][to[1]];
  const lim = bidLimits(a, 'attack');
  openModal(`
    <h2>${dot(player(a.owner).color)} Attack!</h2>
    <p class="warn">${esc(player(d.owner).name)}, look away while ${esc(player(a.owner).name)} bids.</p>
    <p>Your ${esc(label(a, ...from))} attacks the ${esc(player(d.owner).name)} ${esc(label(d, ...to))}.</p>
    <label for="bid">Attack points (${lim.min} to ${lim.max})</label>
    <input id="bid" type="password" inputmode="numeric" autocomplete="off" placeholder="hidden">
    <p class="error" id="err"></p>
    <div class="row"><button class="ghost" id="cancel">Cancel</button><button id="ok">Lock in</button></div>`);
  $('cancel').onclick = () => { duel = null; closeModal(); render(); };
  $('ok').onclick = () => {
    const bid = Number($('bid').value);
    if (!Number.isInteger(bid) || bid < lim.min || bid > lim.max) {
      $('err').textContent = `Enter a whole number from ${lim.min} to ${lim.max}.`;
      return;
    }
    duel.attackBid = bid;
    handoff(d.owner);
  };
  $('bid').focus();
}

function handoff(defOwner) {
  const att = player(state.current);
  const def = player(defOwner);
  openModal(`
    <h2>Pass to ${dot(def.color)} ${esc(def.name)}</h2>
    <p>${esc(att.name)} has locked in a secret attack. ${esc(att.name)}, look away now.</p>
    <div class="row"><button id="ok">I'm ${esc(def.name)}, ready</button></div>`);
  $('ok').onclick = defend;
}

function defend() {
  const { from, to } = duel;
  const a = state.board[from[0]][from[1]];
  const d = state.board[to[0]][to[1]];
  const dLim = bidLimits(d, 'defense');
  const guards = eligibleGuards(state, to);
  highlightGuards = guards.map((g) => [g.r, g.c]);
  render();
  const options = guards.map((g, i) => `<option value="${i}">${esc(label(g.piece, g.r, g.c))}</option>`).join('');
  openModal(`
    <h2>${dot(player(d.owner).color)} Defend!</h2>
    <p>The ${esc(player(a.owner).name)} ${esc(label(a, ...from))} attacks your ${esc(label(d, ...to))}.</p>
    <label for="bid">Defense points (${dLim.min} to ${dLim.max})</label>
    <input id="bid" type="password" inputmode="numeric" autocomplete="off" placeholder="hidden" value="">
    <label for="guard">Guard</label>
    ${guards.length
      ? `<select id="guard"><option value="">No guard</option>${options}</select>
         <label for="gbid">Guard points</label>
         <input id="gbid" type="password" inputmode="numeric" autocomplete="off" placeholder="hidden" disabled>`
      : '<p class="muted">None of your pieces covers this square.</p>'}
    <p class="error" id="err"></p>
    <p class="muted">You lose what you bid, win or lose. If the attack is higher, your piece dies.</p>
    <div class="row"><button id="ok">Reveal</button></div>`);
  const guardSel = $('guard');
  if (guardSel) {
    guardSel.onchange = () => {
      $('gbid').disabled = guardSel.value === '';
      if (guardSel.value !== '') {
        const g = guards[Number(guardSel.value)];
        $('gbid').previousElementSibling.textContent = `Guard points (0 to ${bidLimits(g.piece, 'guard').max})`;
      }
    };
  }
  $('ok').onclick = () => {
    const defenseBid = Number($('bid').value || 0);
    if (!Number.isInteger(defenseBid) || defenseBid < dLim.min || defenseBid > dLim.max) {
      $('err').textContent = `Defense must be a whole number from ${dLim.min} to ${dLim.max}.`;
      return;
    }
    let guard = null, guardBid = 0;
    if (guardSel && guardSel.value !== '') {
      const g = guards[Number(guardSel.value)];
      const gLim = bidLimits(g.piece, 'guard');
      guardBid = Number($('gbid').value || 0);
      if (!Number.isInteger(guardBid) || guardBid < gLim.min || guardBid > gLim.max) {
        $('err').textContent = `Guard points must be a whole number from ${gLim.min} to ${gLim.max}.`;
        return;
      }
      guard = [g.r, g.c];
    }
    const res = attack(state, { from, to, attackBid: duel.attackBid, defenseBid, guard, guardBid });
    duel = null;
    highlightGuards = [];
    reveal(res);
  };
  $('bid').focus();
}

function reveal(res) {
  render();
  const guardLine = res.guardType ? ` + ${NAME[res.guardType]} guard ${res.guardBid}` : '';
  openModal(`
    <h2>Duel result</h2>
    <p class="big">${res.attackBid} vs ${res.totalDefense}</p>
    <p>Attack: ${NAME[res.attackerType]} bid ${res.attackBid}.<br>Defense: ${NAME[res.defenderType]} bid ${res.defenseBid}${guardLine}.</p>
    <p><strong>${res.success ? `The ${NAME[res.attackerType]} wins and takes the square.` : `The ${NAME[res.defenderType]} holds!`}</strong></p>
    <div class="row"><button id="ok">Continue</button></div>`);
  $('ok').onclick = () => {
    closeModal();
    if (state.gameOver) announceWinner();
  };
}

function announceWinner() {
  const w = state.winner === null ? null : player(state.winner);
  openModal(`
    <h2>${w ? `${dot(w.color)} ${esc(w.name)} wins!` : 'Draw'}</h2>
    <p>${w ? 'Last king standing.' : 'No kings left.'} Rounds played: ${state.round}.</p>
    <div class="row"><button class="ghost" data-close>View board</button><button id="again">New game</button></div>`);
  $('again').onclick = () => { closeModal(); $('game').hidden = true; $('setup').hidden = false; };
}

// ---------- modal ----------
function openModal(html) {
  $('modal-body').innerHTML = html;
  $('modal').hidden = false;
  $('modal-body').querySelectorAll('[data-close]').forEach((b) => (b.onclick = closeModal));
}
function closeModal() {
  $('modal').hidden = true;
}
