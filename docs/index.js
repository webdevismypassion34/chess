import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1/+esm';

const chess = new Chess();

// Stockfish
const sfWorker = new Worker(
  URL.createObjectURL(
    new Blob(
      [
        "importScripts('https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js')",
      ],
      { type: 'text/javascript' }
    )
  )
);
let sfReady = false,
  sfCurrent = null;
const sfQueue = [];

sfWorker.onmessage = ({ data: line }) => {
  if (line === 'readyok') {
    sfReady = true;
    sfFlush();
    return;
  }
  if (!sfCurrent) return;
  const cp = line.match(/score cp (-?\d+)/);
  const mate = line.match(/score mate (-?\d+)/);
  if (cp) sfCurrent.score = parseInt(cp[1]);
  if (mate) sfCurrent.score = parseInt(mate[1]) > 0 ? 99999 : -99999;
  if (line.startsWith('bestmove')) {
    const bestMove = line.split(' ')[1]; // uci format like e2e4
    const { resolve, score } = sfCurrent;
    sfCurrent = null;
    resolve({ score, bestMove });
    sfFlush();
  }
};
sfWorker.postMessage('uci');
sfWorker.postMessage('isready');

function sfFlush() {
  if (!sfReady || sfCurrent || !sfQueue.length) return;
  sfCurrent = sfQueue.shift();
  sfWorker.postMessage('position fen ' + sfCurrent.fen);
  sfWorker.postMessage('go depth 12');
}

function sfAnalyze(fen) {
  return new Promise(resolve => {
    sfQueue.push({ fen, score: 0, resolve });
    sfFlush();
  });
}

// the move quality
const QUALITY = {
  best: { label: 'Best', symbol: '!!', color: '#00c9a7' },
  excellent: { label: 'Excellent', symbol: '!', color: '#7bc24a' },
  good: { label: 'Good', symbol: '+', color: '#9ab869' },
  inaccuracy: { label: 'Inaccuracy', symbol: '?!', color: '#f0c040' },
  mistake: { label: 'Mistake', symbol: '?', color: '#e08030' },
  blunder: { label: 'Blunder', symbol: '??', color: '#cc3333' },
};

function classifyMove(cpLoss) {
  if (cpLoss <= 20) return 'best';
  if (cpLoss <= 60) return 'excellent';
  if (cpLoss <= 120) return 'good';
  if (cpLoss <= 250) return 'inaccuracy';
  if (cpLoss <= 500) return 'mistake';
  return 'blunder';
}

const pendingAnalyses = new Map();

async function analyzeMove(entry, idx) {
  if (entry.analysis && entry.analysis !== 'pending') return;
  if (pendingAnalyses.has(entry)) return pendingAnalyses.get(entry);

  entry.analysis = 'pending';
  const p = (async () => {
    const [before, after] = await Promise.all([
      sfAnalyze(entry.fenBefore),
      sfAnalyze(entry.fenAfter),
    ]);
    // if the move that stockfish did is the same then its best
    // maximum zero because it cant be better than the best
    const actualUci = entry.from + entry.to;
    const isEngineBest =
      before.bestMove &&
      (before.bestMove === actualUci ||
        before.bestMove.startsWith(actualUci));
    const loss = isEngineBest
      ? 0
      : Math.max(0, before.score + after.score);
    const displayScore = idx % 2 === 0 ? -after.score : after.score;
    entry.analysis = {
      loss,
      displayScore,
      bestMove: before.bestMove,
    };
    pendingAnalyses.delete(entry);
    renderMoveList();
    if (viewIdx === idx) highlightFlashback(entry);
  })();
  pendingAnalyses.set(entry, p);
  return p;
}

// move history to history the moves
const moveHistory = [];

function recordMove(san, fenBefore, fenAfter, from, to) {
  const idx = moveHistory.length;
  moveHistory.push({
    san,
    fenBefore,
    fenAfter,
    from,
    to,
    analysis: null,
  });
  analyzeMove(moveHistory[idx], idx);
  renderMoveList();
}

// going back
let viewIdx = null; // null = live game, number = viewing that move

function enterFlashback(idx) {
  idx = Math.max(0, Math.min(idx, moveHistory.length - 1));
  // going to current position makes it live
  if (!gameOver && idx >= moveHistory.length - 1) {
    exitFlashback();
    return;
  }
  document
    .querySelectorAll('.last-move')
    .forEach(el => el.classList.remove('last-move'));
  const prevViewIdx = viewIdx;
  viewIdx = idx;
  deselect();
  selected = null;
  clearFlashbackHighlights();

  const entry = moveHistory[idx];

  // animate it when stepping one move forward or back
  if (prevViewIdx !== null) {
    if (idx === prevViewIdx + 1) {
      // animate the piece from its source to destination
      const fromEl = document.querySelector(`.${entry.from}`);
      const toEl = document.querySelector(`.${entry.to}`);
      const piece = fromEl ? pn(fromEl) : '';
      if (fromEl && toEl && piece !== 'empty') {
        fromEl.classList.replace(piece, 'empty');
        renderMoveList();
        animateMove(fromEl, toEl, piece, () => {
          renderFen(entry.fenAfter);
          highlightFlashback(entry);
        });
        return;
      }
    } else if (idx === prevViewIdx - 1) {
      // animate the piece sliding back from destination to source
      const prevEntry = moveHistory[prevViewIdx];
      const fromEl = document.querySelector(`.${prevEntry.to}`);
      const toEl = document.querySelector(`.${prevEntry.from}`);
      const piece = fromEl ? pn(fromEl) : '';
      if (fromEl && toEl && piece !== 'empty') {
        fromEl.classList.replace(piece, 'empty');
        renderMoveList();
        animateMove(fromEl, toEl, piece, () => {
          renderFen(entry.fenAfter);
          highlightFlashback(entry);
        });
        return;
      }
    }
  }

  renderFen(entry.fenAfter);
  highlightFlashback(entry);
  renderMoveList();
}

function exitFlashback() {
  viewIdx = null;
  clearFlashbackHighlights();
  renderBoard();
  highlightLastMove();
  renderMoveList();
}

function renderFen(fen) {
  const temp = new Chess();
  temp.load(fen);
  temp.board().forEach((row, r) => {
    row.forEach((sq, c) => {
      const el = document.querySelector(
        `[data-row="${r}"][data-column="${c}"]`
      );
      if (!el) return;
      const current = pn(el);
      const next = sq ? sq.color + sq.type : 'empty';
      if (current !== next) el.classList.replace(current, next);
    });
  });
  document
    .querySelectorAll('.check')
    .forEach(el => el.classList.remove('check'));
  if (temp.inCheck()) {
    const king = document.querySelector(`.${temp.turn()}k`);
    if (king) king.classList.add('check');
  }
}

function highlightFlashback(entry) {
  clearFlashbackHighlights();
  document
    .querySelector(`.${entry.from}`)
    ?.classList.add('fb-actual');
  document.querySelector(`.${entry.to}`)?.classList.add('fb-actual');
  if (
    showAnalysis &&
    entry.analysis &&
    entry.analysis !== 'pending' &&
    entry.analysis.bestMove
  ) {
    const bm = entry.analysis.bestMove;
    const bmFrom = bm.slice(0, 2);
    const bmTo = bm.slice(2, 4);
    if (bmFrom !== entry.from || bmTo !== entry.to) {
      drawArrow(bmFrom, bmTo);
    }
  }
}

function clearFlashbackHighlights() {
  document
    .querySelectorAll('.fb-actual')
    .forEach(el => el.classList.remove('fb-actual'));
  document.getElementById('fb-arrow')?.remove();
}

function highlightLastMove() {
  document
    .querySelectorAll('.last-move')
    .forEach(el => el.classList.remove('last-move'));
  if (moveHistory.length === 0) return;
  const last = moveHistory[moveHistory.length - 1];
  document.querySelector(`.${last.from}`)?.classList.add('last-move');
  document.querySelector(`.${last.to}`)?.classList.add('last-move');
}

function drawArrow(fromSq, toSq) {
  document.getElementById('fb-arrow')?.remove();
  const fromEl = document.querySelector(`.${fromSq}`);
  const toEl = document.querySelector(`.${toSq}`);
  if (!fromEl || !toEl) return;

  const fr = fromEl.getBoundingClientRect();
  const tr = toEl.getBoundingClientRect();
  const x1 = fr.left + fr.width / 2;
  const y1 = fr.top + fr.height / 2;
  const x2 = tr.left + tr.width / 2;
  const y2 = tr.top + tr.height / 2;

  const dx = x2 - x1,
    dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const r = tr.width * 0.38; // stop before center of destination square
  const ex = x2 - (dx / len) * r;
  const ey = y2 - (dy / len) * r;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.id = 'fb-arrow';
  svg.style.cssText =
    'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:50;overflow:visible;';

  const defs = document.createElementNS(ns, 'defs');
  const marker = document.createElementNS(ns, 'marker');
  marker.setAttribute('id', 'fb-ah');
  marker.setAttribute('markerWidth', '4');
  marker.setAttribute('markerHeight', '4');
  marker.setAttribute('refX', '2.5');
  marker.setAttribute('refY', '2');
  marker.setAttribute('orient', 'auto');
  const tip = document.createElementNS(ns, 'polygon');
  tip.setAttribute('points', '0 0, 4 2, 0 4');
  tip.setAttribute('fill', 'rgba(80, 220, 110, 0.92)');
  marker.appendChild(tip);
  defs.appendChild(marker);
  svg.appendChild(defs);

  const line = document.createElementNS(ns, 'line');
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', ex);
  line.setAttribute('y2', ey);
  line.setAttribute('stroke', 'rgba(80, 220, 110, 0.85)');
  line.setAttribute('stroke-width', fr.width * 0.18);
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('marker-end', 'url(#fb-ah)');
  svg.appendChild(line);

  document.body.appendChild(svg);
}

// Keyboard navigation
document.addEventListener('keydown', e => {
  if (moveHistory.length === 0) return;
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    if (viewIdx === null) enterFlashback(moveHistory.length - 2);
    else if (viewIdx > 0) enterFlashback(viewIdx - 1);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    if (viewIdx === null) return;
    if (viewIdx < moveHistory.length - 1) enterFlashback(viewIdx + 1);
    else exitFlashback();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (moveHistory.length > 0) enterFlashback(0);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    exitFlashback();
  }
});

// Moving possible
function renderMoveList() {
  const info = document.getElementById('info');
  if (!info) return;
  const rows = [];

  for (let i = 0; i < moveHistory.length; i += 2) {
    const num = Math.floor(i / 2) + 1;
    let row = `<div class="move-row"><span class="move-num">${num}.</span>`;

    for (let j = i; j <= i + 1; j++) {
      if (j < moveHistory.length) {
        const e = moveHistory[j];
        let sym = '';
        if (showAnalysis) {
          if (e.analysis && e.analysis !== 'pending') {
            const q = QUALITY[classifyMove(e.analysis.loss)];
            sym = `<sup class="move-quality" style="color:${q.color}">${q.symbol}</sup>`;
          } else if (e.analysis === 'pending') {
            sym = `<sup class="move-quality" style="color:#444">…</sup>`;
          }
        }
        const active = viewIdx === j ? ' active' : '';
        row += `<span class="move-cell${active}" data-idx="${j}">${e.san}${sym}</span>`;
      } else {
        row += `<span class="move-cell empty-move"></span>`;
      }
    }

    row += '</div>';
    rows.push(row);
  }

  info.innerHTML = rows.join('');
  info.querySelectorAll('.move-cell:not(.empty-move)').forEach(el => {
    el.addEventListener('click', () =>
      enterFlashback(parseInt(el.dataset.idx))
    );
    el.addEventListener('mouseenter', () => showAnalysisTip(el));
    el.addEventListener('mouseleave', hideAnalysisTip);
  });

  if (viewIdx !== null) {
    info
      .querySelector('.move-cell.active')
      ?.scrollIntoView({ block: 'nearest' });
  } else {
    info.scrollTop = info.scrollHeight;
  }
}

// analysis when hovered
function showAnalysisTip(el) {
  const idx = parseInt(el.dataset.idx);
  const entry = moveHistory[idx];
  const tip = document.getElementById('analysisTip');
  tip.dataset.idx = String(idx);

  const rect = el.getBoundingClientRect();
  tip.style.left = rect.left + 'px';
  tip.style.top = rect.bottom + 6 + 'px';
  tip.classList.add('visible');

  if (!showAnalysis) {
    tip.textContent = 'Analysis available after the game.';
    return;
  }

  if (!entry.analysis) {
    tip.textContent = 'Analyzing…';
    analyzeMove(entry, idx).then(() => {
      if (tip.dataset.idx === String(idx)) showAnalysisTip(el);
    });
    return;
  }
  if (entry.analysis === 'pending') {
    tip.textContent = 'Analyzing…';
    pendingAnalyses.get(entry)?.then(() => {
      if (tip.dataset.idx === String(idx)) showAnalysisTip(el);
    });
    return;
  }

  const key = classifyMove(entry.analysis.loss);
  const q = QUALITY[key];
  const raw = entry.analysis.displayScore;
  const scoreStr =
    raw >= 99000
      ? 'M+'
      : raw <= -99000
        ? 'M-'
        : (raw >= 0 ? '+' : '') + (raw / 100).toFixed(2);
  tip.innerHTML = `<span style="color:${q.color};font-weight:bold">${q.symbol} ${q.label}</span><br><span style="opacity:0.55">Eval: ${scoreStr}</span>`;
}

function hideAnalysisTip() {
  const tip = document.getElementById('analysisTip');
  tip.classList.remove('visible');
  delete tip.dataset.idx;
}

// toast notification
let toastTimer = null;
function showToast(message, duration = 4000) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  if (duration)
    toastTimer = setTimeout(
      () => toast.classList.remove('visible'),
      duration
    );
}

// controls
function disableControls() {
  document.getElementById('btnResign').disabled = true;
  document.getElementById('btnOfferDraw').disabled = true;
}

function onGameEnd() {
  gameOver = true;
  showAnalysis = true;
  disableControls();
  renderMoveList();
  if (viewIdx !== null && moveHistory[viewIdx])
    highlightFlashback(moveHistory[viewIdx]);
}

function showDrawOfferDialog() {
  document.getElementById('drawOfferDialog').classList.add('visible');
}

function hidDrawOfferDialog() {
  document
    .getElementById('drawOfferDialog')
    .classList.remove('visible');
}

document.addEventListener('DOMContentLoaded', () => {
  document
    .getElementById('btnResign')
    .addEventListener('click', () => {
      if (gameOver) return;
      if (!confirm('Are you sure you want to resign?')) return;
      onGameEnd();
      ws.send(JSON.stringify({ type: 'resign', token }));
    });

  document
    .getElementById('btnOfferDraw')
    .addEventListener('click', () => {
      if (gameOver || drawOfferPending) return;
      drawOfferPending = true;
      ws.send(JSON.stringify({ type: 'draw_offer', token }));
      showToast('Draw offer sent.', 3000);
    });

  document
    .getElementById('btnAcceptDraw')
    .addEventListener('click', () => {
      hidDrawOfferDialog();
      ws.send(
        JSON.stringify({
          type: 'draw_response',
          token,
          accepted: true,
        })
      );
    });

  document
    .getElementById('btnDeclineDraw')
    .addEventListener('click', () => {
      hidDrawOfferDialog();
      ws.send(
        JSON.stringify({
          type: 'draw_response',
          token,
          accepted: false,
        })
      );
    });
});

// ws
const params = new URLSearchParams(window.location.search);
const token = params.get('token');
let side = 'w';
let selected = null;
let gameOver = false;
let showAnalysis = false;
let drawOfferPending = false; // sent a draw offer and are awaiting response

const ws = new WebSocket(
  localStorage.getItem('chessWsUrl') || 'ws://localhost:9001'
);
ws.addEventListener('open', () =>
  ws.send(JSON.stringify({ type: 'join', token }))
);

ws.onmessage = async e => {
  const text =
    typeof e.data === 'string' ? e.data : await e.data.text();
  const msg = JSON.parse(text);

  if (msg.type === 'error') {
    showToast(msg.message, 0);
    if (!gameOver) {
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 2000);
    }
    return;
  }

  if (msg.type === 'joined') {
    side = msg.side;
    document.querySelector('.board').dataset.side =
      side === 'b' ? 'black' : 'white';
    if (msg.moves?.length) {
      const replay = new Chess();
      for (const m of msg.moves) {
        const fenBefore = replay.fen();
        const result = replay.move({
          from: m.from,
          to: m.to,
          promotion: m.promotion || 'q',
        });
        recordMove(result.san, fenBefore, replay.fen(), m.from, m.to);
      }
    }
    chess.load(msg.fen);
    renderBoard();
    return;
  }

  if (msg.type === 'move') {
    const fromEl = document.querySelector(`.${msg.from}`);
    const toEl = document.querySelector(`.${msg.to}`);
    const piece = pn(fromEl);
    const fenBefore = chess.fen();
    const result = chess.move({
      from: msg.from,
      to: msg.to,
      promotion: msg.promotion || 'q',
    });
    const fenAfter = chess.fen();
    recordMove(result.san, fenBefore, fenAfter, msg.from, msg.to);
    if (viewIdx === null) {
      fromEl.classList.replace(piece, 'empty');
      animateMove(fromEl, toEl, piece, () => {
        renderBoard();
        deselect();
        selected = null;
      });
    }
    return;
  }

  if (msg.type === 'checkmate') {
    onGameEnd();
    showToast(
      msg.winner === side
        ? 'Checkmate! You won.'
        : 'Checkmate! You lost.',
      0
    );
    return;
  }

  if (msg.type === 'draw') {
    hidDrawOfferDialog();
    onGameEnd();
    showToast("It's a draw!", 0);
    return;
  }

  if (msg.type === 'resigned') {
    onGameEnd();
    showToast(
      msg.winner === side
        ? 'Your opponent resigned. You win!'
        : 'You resigned.',
      0
    );
    return;
  }

  if (msg.type === 'draw_offer') {
    showDrawOfferDialog();
    return;
  }

  if (msg.type === 'draw_declined') {
    drawOfferPending = false;
    showToast('Draw offer declined.', 3000);
    return;
  }
};

// render board
function renderBoard() {
  chess.board().forEach((row, r) => {
    row.forEach((sq, c) => {
      const el = document.querySelector(
        `[data-row="${r}"][data-column="${c}"]`
      );
      if (!el) return;
      const current = pn(el);
      const next = sq ? sq.color + sq.type : 'empty';
      if (current !== next) el.classList.replace(current, next);
    });
  });
  indicateCheck();
  highlightLastMove();
}

function indicateCheck() {
  document
    .querySelectorAll('.check')
    .forEach(el => el.classList.remove('check'));
  if (chess.inCheck()) {
    const king = document.querySelector(`.${chess.turn()}k`);
    if (king) king.classList.add('check');
  }
}

function pn(el) {
  return el.classList[3] ?? '';
}
function ptn(el) {
  return el.classList[1];
}

function animateMove(fromEl, toEl, pieceName, callback) {
  const fromRect = fromEl.getBoundingClientRect();
  const toRect = toEl.getBoundingClientRect();
  const overlay = document.createElement('div');
  overlay.classList.add('piece-anim', pieceName);
  overlay.style.width = fromRect.width + 'px';
  overlay.style.height = fromRect.height + 'px';
  overlay.style.left = fromRect.left + 'px';
  overlay.style.top = fromRect.top + 'px';
  document.body.appendChild(overlay);
  overlay.getBoundingClientRect();
  overlay.style.left = toRect.left + 'px';
  overlay.style.top = toRect.top + 'px';
  overlay.addEventListener(
    'transitionend',
    () => {
      overlay.remove();
      callback();
    },
    { once: true }
  );
}

function deselect() {
  document
    .querySelectorAll('.possible')
    .forEach(sq => sq.classList.remove('possible', 'take'));
}

function showMovesForSquare(square) {
  deselect();
  chess.moves({ square: ptn(square), verbose: true }).forEach(m => {
    const sq = document.querySelector(`.${m.to}`);
    if (!sq) return;
    sq.classList.add('possible');
    if (pn(sq) !== 'empty') sq.classList.add('take');
  });
}

// setting it up
document.addEventListener('DOMContentLoaded', () => {
  const board = document.querySelector('div.board');
  const initialPieces = [
    ['br', 'bn', 'bb', 'bq', 'bk', 'bb', 'bn', 'br'],
    ['bp', 'bp', 'bp', 'bp', 'bp', 'bp', 'bp', 'bp'],
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['wp', 'wp', 'wp', 'wp', 'wp', 'wp', 'wp', 'wp'],
    ['wr', 'wn', 'wb', 'wq', 'wk', 'wb', 'wn', 'wr'],
  ];

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const square = document.createElement('div');
      square.classList.add('square');
      square.classList.add(
        ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'][col] + (8 - row)
      );
      square.classList.add(['light', 'dark'][(row + col) % 2]);
      square.classList.add(initialPieces[row][col] || 'empty');
      square.dataset.column = col;
      square.dataset.row = row;

      square.addEventListener('click', () => {
        if (viewIdx !== null) return; // no moves while flashback

        if (square.classList.contains('possible')) {
          const from = ptn(selected);
          const to = ptn(square);
          const fromEl = selected;
          const toEl = square;
          const piece = pn(fromEl);
          const fenBefore = chess.fen();
          const result = chess.move({ from, to, promotion: 'q' });
          const fenAfter = chess.fen();
          ws.send(
            JSON.stringify({
              type: 'move',
              token,
              from,
              to,
              fen: fenAfter,
            })
          );
          recordMove(result.san, fenBefore, fenAfter, from, to);
          fromEl.classList.replace(piece, 'empty');
          deselect();
          selected = null;
          animateMove(fromEl, toEl, piece, () => {
            renderBoard();
            if (chess.isCheckmate()) {
              onGameEnd();
              showToast('Checkmate! You won.', 0);
              ws.send(JSON.stringify({ type: 'checkmate', token }));
            } else if (chess.isDraw()) {
              onGameEnd();
              showToast("It's a draw!", 0);
              ws.send(JSON.stringify({ type: 'draw', token }));
            }
          });
        } else if (pn(square)[0] === side && chess.turn() === side) {
          if (selected === square) {
            deselect();
            selected = null;
          } else {
            selected = square;
            showMovesForSquare(square);
          }
        } else {
          deselect();
          selected = null;
        }
      });

      board.appendChild(square);
    }
  }
});
