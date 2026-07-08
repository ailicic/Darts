const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const rateLimit = require('express-rate-limit');

// ── App version (matches the Docker image tag from versions.txt) ─────────────
// Allow an explicit override via APP_VERSION, otherwise fall back to the
// versions.txt file that drives the image tag, then to 'dev'.
const APP_VERSION = (() => {
  if (process.env.APP_VERSION) return process.env.APP_VERSION.trim();
  try {
    return fs.readFileSync(path.join(__dirname, 'versions.txt'), 'utf8').trim();
  } catch {
    return 'dev';
  }
})();

const { createPlayer, processThrow, checkWinCondition, TARGETS, isClosed } = require('./gameLogic');
const {
  httpRequestDuration,
  httpRequestTotal,
  activeGames,
  activePlayers,
  gameWinsTotal,
  dartsThrown,
  socketConnections,
  register,
} = require('./metrics');
const { initDb, loadWins, saveWin, loadResults, saveResult } = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Prometheus metrics middleware ──────────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route?.path || req.path;
    httpRequestDuration.labels(req.method, route, res.statusCode).observe(duration);
    httpRequestTotal.labels(req.method, route, res.statusCode).inc();
  });
  next();
});

// ── In-memory game store ──────────────────────────────────────────────────────
const games = {};

// ── In-memory caches (loaded from DB on startup) ─────────────────────────────
let wins = [];
let results = [];

// ── Helper: sanitize a player name ──────────────────────────────────────────
function sanitizeName(name) {
  return String(name || '').trim().slice(0, 30).replace(/[<>"']/g, '');
}

// ── Helper: rank players at end of game ──────────────────────────────────────
function computePlacements(players, winnerId) {
  const winner = players.find((p) => p.id === winnerId);
  const others = players.filter((p) => p.id !== winnerId);
  others.sort((a, b) => a.score - b.score);
  return [winner, ...others].map((p, i) => ({ name: p.name, rank: i + 1 }));
}

// ── REST API ──────────────────────────────────────────────────────────────────

app.post('/api/games', (req, res) => {
  const { playerNames } = req.body;

  if (!Array.isArray(playerNames) || playerNames.length < 2) {
    return res.status(400).json({ error: 'At least 2 players are required.' });
  }
  if (playerNames.length > 8) {
    return res.status(400).json({ error: 'Maximum 8 players are supported.' });
  }

  const sanitized = playerNames.map(sanitizeName).filter(Boolean);
  if (sanitized.length < 2) {
    return res.status(400).json({ error: 'At least 2 valid player names are required.' });
  }

  const gameId = uuidv4();
  const players = sanitized.map((name) => createPlayer(uuidv4(), name));

  games[gameId] = {
    id: gameId,
    players,
    currentPlayerIndex: 0,
    dartsThrown: 0,
    turnHistory: [],
    currentTurnThrows: [],
    claimedPlayerIds: new Set(),
    gameOver: false,
    winnerId: null,
    createdAt: Date.now(),
  };

  activeGames.set(Object.keys(games).length);
  activePlayers.set(players.length);

  return res.status(201).json({
    gameId,
    players: players.map(({ id, name }) => ({ id, name })),
  });
});

app.get('/api/games/:gameId', (req, res) => {
  const game = games[req.params.gameId];
  if (!game) return res.status(404).json({ error: 'Game not found.' });
  return res.json(gameState(game));
});

app.post('/api/games/:gameId/throw', async (req, res) => {
  const game = games[req.params.gameId];
  if (!game) return res.status(404).json({ error: 'Game not found.' });
  if (game.gameOver) return res.status(409).json({ error: 'Game is already over.' });

  const { playerId, target, multiplier } = req.body;
  const currentPlayer = game.players[game.currentPlayerIndex];

  if (currentPlayer.id !== playerId) {
    return res.status(403).json({ error: 'It is not your turn.' });
  }

  const t = Number(target);
  const m = Number(multiplier);

  if (![1, 2, 3].includes(m)) {
    return res.status(400).json({ error: 'Multiplier must be 1, 2 or 3.' });
  }
  if (t !== 0 && !TARGETS.includes(t)) {
    return res.status(400).json({ error: 'Invalid target.' });
  }
  if (t === 25 && m === 3) {
    return res.status(400).json({ error: 'Bullseye cannot be a triple (single=25, double=50 only).' });
  }

  if (game.dartsThrown >= 3) {
    return res.status(409).json({ error: 'Turn already complete, call end-turn first.' });
  }

  const snapshot = game.players.map((p) => ({
    id: p.id,
    marks: { ...p.marks },
    score: p.score,
  }));

  const result = processThrow(game.players, game.currentPlayerIndex, t, m);
  game.dartsThrown += 1;
  game.currentTurnThrows.push({ target: t, multiplier: m, result, snapshot });

  dartsThrown.inc();

  const winCheck = checkWinCondition(game.players);

  if (winCheck.gameOver) {
    game.gameOver = true;
    game.winnerId = winCheck.winnerId;
    const winner = game.players.find((p) => p.id === winCheck.winnerId);
    if (winner) {
      const now = new Date().toISOString();
      const placements = computePlacements(game.players, winCheck.winnerId);

      // Only award placement points for 3+ player games
      const finalPlacements = game.players.length >= 3 ? placements : null;

      // Save to DB
      await saveWin(winner.name, now);
      await saveResult(game.players.map((p) => p.name), winner.name, finalPlacements, now);

      // Update in-memory cache
      wins.push({ playerName: winner.name, date: now });
      results.push({
        players: game.players.map((p) => p.name),
        winner: winner.name,
        placements: finalPlacements,
        date: now,
      });

      gameWinsTotal.labels(winner.name).inc();
    }
    activeGames.set(Math.max(0, Object.keys(games).length - 1));
  }

  io.to(game.id).emit('gameUpdate', gameState(game));
  return res.json(gameState(game));
});

app.post('/api/games/:gameId/end-turn', (req, res) => {
  const game = games[req.params.gameId];
  if (!game) return res.status(404).json({ error: 'Game not found.' });
  if (game.gameOver) return res.status(409).json({ error: 'Game is already over.' });

  const { playerId } = req.body;
  const currentPlayer = game.players[game.currentPlayerIndex];

  if (currentPlayer.id !== playerId) {
    return res.status(403).json({ error: 'It is not your turn.' });
  }

  game.turnHistory.push({
    playerId: currentPlayer.id,
    playerName: currentPlayer.name,
    throws: [...game.currentTurnThrows],
  });

  game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
  game.dartsThrown = 0;
  game.currentTurnThrows = [];

  io.to(game.id).emit('gameUpdate', gameState(game));
  return res.json(gameState(game));
});

app.post('/api/games/:gameId/bounce', (req, res) => {
  const game = games[req.params.gameId];
  if (!game) return res.status(404).json({ error: 'Game not found.' });
  if (game.gameOver) return res.status(409).json({ error: 'Game is already over.' });

  const { playerId } = req.body;
  const currentPlayer = game.players[game.currentPlayerIndex];

  if (currentPlayer.id !== playerId) {
    return res.status(403).json({ error: 'It is not your turn.' });
  }

  if (game.currentTurnThrows.length === 0) {
    return res.status(409).json({ error: 'No throws to revert in the current turn.' });
  }

  const lastThrow = game.currentTurnThrows.pop();
  lastThrow.snapshot.forEach((saved, idx) => {
    game.players[idx].marks = { ...saved.marks };
    game.players[idx].score = saved.score;
  });
  game.dartsThrown -= 1;

  io.to(game.id).emit('gameUpdate', gameState(game));
  return res.json(gameState(game));
});

app.post('/api/games/:gameId/undo-turn', (req, res) => {
  const game = games[req.params.gameId];
  if (!game) return res.status(404).json({ error: 'Game not found.' });
  if (game.gameOver) return res.status(409).json({ error: 'Game is already over.' });

  if (game.turnHistory.length === 0) {
    return res.status(409).json({ error: 'No previous turn to undo.' });
  }

  // Only allow undo if current player has not thrown yet
  if (game.currentTurnThrows.length > 0) {
    return res.status(409).json({ error: 'Current player has already thrown. Use bounce first.' });
  }

  // Pop the last completed turn
  const lastTurn = game.turnHistory.pop();

  // Restore player states from the snapshot of the first throw of that turn
  if (lastTurn.throws.length > 0 && lastTurn.throws[0].snapshot) {
    lastTurn.throws[0].snapshot.forEach((saved, idx) => {
      game.players[idx].marks = { ...saved.marks };
      game.players[idx].score = saved.score;
    });
  }

  // Move back to the previous player
  const prevIndex = game.players.findIndex((p) => p.id === lastTurn.playerId);
  if (prevIndex !== -1) {
    game.currentPlayerIndex = prevIndex;
  } else {
    game.currentPlayerIndex = (game.currentPlayerIndex - 1 + game.players.length) % game.players.length;
  }

  game.dartsThrown = 0;
  game.currentTurnThrows = [];

  io.to(game.id).emit('gameUpdate', gameState(game));
  return res.json(gameState(game));
});

app.post('/api/games/:gameId/claim/:playerId', (req, res) => {
  const game = games[req.params.gameId];
  if (!game) return res.status(404).json({ error: 'Game not found.' });

  const { playerId } = req.params;
  const player = game.players.find((p) => p.id === playerId);
  if (!player) return res.status(404).json({ error: 'Player not found.' });

  if (game.claimedPlayerIds.has(playerId)) {
    return res.status(409).json({ error: 'This player has already been taken by another device.' });
  }

  game.claimedPlayerIds.add(playerId);
  io.to(game.id).emit('gameUpdate', gameState(game));
  return res.json({ ok: true });
});

app.post('/api/games/:gameId/reset', (req, res) => {
  const game = games[req.params.gameId];
  if (!game) return res.status(404).json({ error: 'Game not found.' });

  const playerNames = game.players.map((p) => p.name);
  const newGameId = uuidv4();
  const players = playerNames.map((name) => createPlayer(uuidv4(), name));

  games[newGameId] = {
    id: newGameId,
    players,
    currentPlayerIndex: 0,
    dartsThrown: 0,
    turnHistory: [],
    currentTurnThrows: [],
    claimedPlayerIds: new Set(),
    gameOver: false,
    winnerId: null,
    createdAt: Date.now(),
  };

  // Notify every client still connected to the old game (display, mobiles,
  // shared) so they all follow the rematch to the new game instead of only
  // the device that triggered the reset.
  io.to(game.id).emit('rematch', { newGameId });

  return res.status(201).json({
    gameId: newGameId,
    players: players.map(({ id, name }) => ({ id, name })),
  });
});

app.get('/api/version', (req, res) => {
  res.json({ version: APP_VERSION });
});

app.get('/api/wins', (req, res) => {
  res.json(wins);
});

app.get('/api/results', (req, res) => {
  res.json(results);
});

const pageRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/', pageRateLimit, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/display/:gameId', pageRateLimit, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

app.get('/join/:gameId', pageRateLimit, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'join.html'));
});

app.get('/play/:gameId/:playerId', pageRateLimit, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mobile.html'));
});

app.get('/scoreboard', pageRateLimit, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'scoreboard.html'));
});

app.get('/shared/:gameId', pageRateLimit, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'shared.html'));
});

app.get('/api/games/:gameId/shared-qr', async (req, res) => {
  const game = games[req.params.gameId];
  if (!game) return res.status(404).json({ error: 'Game not found.' });

  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const sharedUrl = proto + '://' + host + '/shared/' + req.params.gameId;

  try {
    const svg = await QRCode.toString(sharedUrl, { type: 'svg', margin: 2, width: 250 });
    res.set('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code.' });
  }
});

app.get('/api/games/:gameId/join-qr', async (req, res) => {
  const game = games[req.params.gameId];
  if (!game) return res.status(404).json({ error: 'Game not found.' });

  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const joinUrl = proto + '://' + host + '/join/' + req.params.gameId;

  try {
    const svg = await QRCode.toString(joinUrl, { type: 'svg', margin: 2, width: 250 });
    res.set('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code.' });
  }
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  socketConnections.inc();

  socket.on('joinGame', ({ gameId: gid }) => {
    socket.join(gid);
    const game = games[gid];
    if (game) {
      socket.emit('gameUpdate', gameState(game));
    }
  });

  socket.on('disconnect', () => {
    socketConnections.dec();
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function gameState(game) {
  return {
    id: game.id,
    players: game.players,
    currentPlayerId: game.players[game.currentPlayerIndex]?.id,
    dartsThrown: game.dartsThrown,
    currentTurnThrows: game.currentTurnThrows,
    turnHistory: game.turnHistory,
    gameOver: game.gameOver,
    winnerId: game.winnerId,
    targets: TARGETS,
    claimedPlayerIds: [...game.claimedPlayerIds],
  };
}

// ── Start server ──────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

async function start() {
  await initDb();
  wins = await loadWins();
  results = await loadResults();
  console.log('Loaded ' + wins.length + ' wins and ' + results.length + ' results from database');

  server.listen(PORT, () => {
    console.log('Darts server running on http://localhost:' + PORT);
  });
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});

module.exports = { app, server, games };
