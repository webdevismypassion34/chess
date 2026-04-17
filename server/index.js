const { WebSocketServer } = require('ws');
const { randomUUID } = require('crypto');
const wss = new WebSocketServer({ port: 9001 });
console.log('WebSocket server running on ws://localhost:9001');

let queue = null;
const games = new Map();  // gameId -> { w, b, ended, turn }
const tokens = new Map(); // token -> { gameId, side }

wss.on('connection', ws => {
  ws.on('error', err => console.error('client error:', err.message));

  ws.on('message', data => {
    const msg = JSON.parse(data.toString());

    if (msg.type === 'queue') {
      console.log('player queued');
      if (queue && queue.readyState === 1) {
        const gameId = randomUUID();
        const tokenW = randomUUID();
        const tokenB = randomUUID();

        games.set(gameId, { w: null, b: null, ended: false, turn: 'w', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves: [] });
        tokens.set(tokenW, { gameId, side: 'w' });
        tokens.set(tokenB, { gameId, side: 'b' });

        queue.send(JSON.stringify({ type: 'start', token: tokenW }));
        ws.send(JSON.stringify({ type: 'start', token: tokenB }));
        queue = null;
      } else {
        queue = ws;
      }
      return;
    }

    if (msg.type === 'join') {
      const entry = tokens.get(msg.token);
      if (!entry) {
        ws.send(JSON.stringify({ type: 'error', message: 'Game not found.' }));
        return;
      }
      const game = games.get(entry.gameId);
      if (game.ended) {
        ws.send(JSON.stringify({ type: 'error', message: 'This game has ended.' }));
        return;
      }
      game[entry.side] = ws;
      ws.send(JSON.stringify({ type: 'joined', side: entry.side, turn: game.turn, fen: game.fen, moves: game.moves }));
      return;
    }

    if (msg.type === 'move') {
      const entry = tokens.get(msg.token);
      if (!entry) return;
      const game = games.get(entry.gameId);
      if (!game || game.ended) return;
      if (game.turn !== entry.side) return;

      game.turn = entry.side === 'w' ? 'b' : 'w';
      if (msg.fen) game.fen = msg.fen;
      game.moves.push({ from: msg.from, to: msg.to, promotion: msg.promotion || null });

      const partner = entry.side === 'w' ? game.b : game.w;
      if (partner?.readyState === 1) {
        partner.send(JSON.stringify({ type: 'move', from: msg.from, to: msg.to, promotion: msg.promotion }));
      }
      return;
    }

    if (msg.type === 'checkmate') {
      const entry = tokens.get(msg.token);
      if (!entry) return;
      const game = games.get(entry.gameId);
      if (!game) return;
      game.ended = true;
      const partner = entry.side === 'w' ? game.b : game.w;
      if (partner?.readyState === 1) {
        partner.send(JSON.stringify({ type: 'checkmate', winner: entry.side }));
      }
      return;
    }

    if (msg.type === 'draw') {
      const entry = tokens.get(msg.token);
      if (!entry) return;
      const game = games.get(entry.gameId);
      if (!game) return;
      game.ended = true;
      const partner = entry.side === 'w' ? game.b : game.w;
      if (partner?.readyState === 1) {
        partner.send(JSON.stringify({ type: 'draw' }));
      }
      return;
    }

    if (msg.type === 'resign') {
      const entry = tokens.get(msg.token);
      if (!entry) return;
      const game = games.get(entry.gameId);
      if (!game || game.ended) return;
      game.ended = true;
      const winner = entry.side === 'w' ? 'b' : 'w';
      [game.w, game.b].forEach(ws => {
        if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'resigned', winner }));
      });
      return;
    }

    if (msg.type === 'draw_offer') {
      const entry = tokens.get(msg.token);
      if (!entry) return;
      const game = games.get(entry.gameId);
      if (!game || game.ended) return;
      const partner = entry.side === 'w' ? game.b : game.w;
      if (partner?.readyState === 1) {
        partner.send(JSON.stringify({ type: 'draw_offer' }));
      }
      return;
    }

    if (msg.type === 'draw_response') {
      const entry = tokens.get(msg.token);
      if (!entry) return;
      const game = games.get(entry.gameId);
      if (!game || game.ended) return;
      if (msg.accepted) {
        game.ended = true;
        [game.w, game.b].forEach(ws => {
          if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'draw' }));
        });
      } else {
        const partner = entry.side === 'w' ? game.b : game.w;
        if (partner?.readyState === 1) {
          partner.send(JSON.stringify({ type: 'draw_declined' }));
        }
      }
      return;
    }
  });

  ws.on('close', () => {
    if (queue === ws) queue = null;
  });
});