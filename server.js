const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const QRCode = require('qrcode');
const rateLimit = require('express-rate-limit');

const { createPlayer, processThrow, checkWinCondition, TARGETS } = require('./gameLogic');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ── In-memory game store ──────────────────────────────────────────────────────
// games[gameId] = { id, players[], currentPlayerIndex, turns[], gameOver, winnerId, createdAt }
const games = {};

// ── In-memory wins history ────────────────────────────────────────────────────
// wins = [{ playerName, date }]
let wins = [];

// ── Helper: sanitize a player name ──────────────────────────────────────────
function sanitizeName(name) {
  return String(name || '').trim().slice(0, 30).replace(/[<>"']/g, '');
}

// ── REST API ──────────────────────────────────────────────────────────────────

/**
 * POST /api/games
 * Body: { playerNames: string[] }
 * Creates a new game and returns { gameId, players }
 */
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
    dartsThrown: 0,           // darts thrown this turn (0-3)
    turnHistory: [],           // [{ playerId, throws: [{target, multiplier, result}] }]
    currentTurnThrows: [],     // throws within the current turn
    claimedPlayerIds: new Set(), // player IDs that have been claimed by a device
    gameOver: false,
    winnerId: null,
    createdAt: Date.now(),
  };

  return res.status(201).json({
    gameId,
    players: players.map(({ id, name }) => ({ id, name })),
  });
});

/**
 * GET /api/games/:gameId
 * Returns full game state.
 */
app.get('/api/games/:gameId', (req, res) => {
  const game = games[req.params.gameId];
  if (!game) return res.status(404).json({ error: 'Game not found.' });
  return res.json(gameState(game));
});

/**
 * POST /api/games/:gameId/throw
 * Body: { playerId, target, multiplier }
 *   target: 15|16|17|18|19|20|25|0 (0 = miss)
 *   multiplier: 1|2|3
 * Records a dart throw and advances turn after 3 darts.
 */
app.post('/api/games/:gameId/throw', (req, res) => {
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

  // Snapshot player states before the throw so it can be undone via bounce
  const snapshot = game.players.map((p) => ({
    id: p.id,
    marks: { ...p.marks },
    score: p.score,
  }));

  const result = processThrow(game.players, game.currentPlayerIndex, t, m);
  game.dartsThrown += 1;
  game.currentTurnThrows.push({ target: t, multiplier: m, result, snapshot });

  const { gameOver, winnerId } = checkWinCondition(game.players);

  if (gameOver) {
    game.gameOver = true;
    game.winnerId = winnerId;
    const winner = game.players.find(p => p.id === winnerId);
    if (winner) {
      wins.push({ playerName: winner.name, date: new Date().toISOString() });
      // Keep the wins log from growing indefinitely
      if (wins.length > 1000) wins = wins.slice(-1000);
    }
  }

  // Emit real-time update to all clients watching this game
  io.to(game.id).emit('gameUpdate', gameState(game));

  return res.json(gameState(game));
});

/**
 * POST /api/games/:gameId/end-turn
 * Body: { playerId }
 * Ends the current player's turn (even if fewer than 3 darts thrown).
 */
app.post('/api/games/:gameId/end-turn', (req, res) => {
  const game = games[req.params.gameId];
  if (!game) return res.status(404).json({ error: 'Game not found.' });
  if (game.gameOver) return res.status(409).json({ error: 'Game is already over.' });

  const { playerId } = req.body;
  const currentPlayer = game.players[game.currentPlayerIndex];

  if (currentPlayer.id !== playerId) {
    return res.status(403).json({ error: 'It is not your turn.' });
  }

  // Save turn to history
  game.turnHistory.push({
    playerId: currentPlayer.id,
    playerName: currentPlayer.name,
    throws: [...game.currentTurnThrows],
  });

  // Advance to next player
  game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
  game.dartsThrown = 0;
  game.currentTurnThrows = [];

  io.to(game.id).emit('gameUpdate', gameState(game));

  return res.json(gameState(game));
});

/**
 * POST /api/games/:gameId/bounce
 * Body: { playerId }
 * Reverts the last dart throw in the current turn.
 * Can only undo throws made within the current (not-yet-ended) turn.
 */
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

  // Pop the last throw and restore the player snapshot from before that throw
  const lastThrow = game.currentTurnThrows.pop();
  lastThrow.snapshot.forEach((saved, idx) => {
    game.players[idx].marks = { ...saved.marks };
    game.players[idx].score = saved.score;
  });
  game.dartsThrown -= 1;

  io.to(game.id).emit('gameUpdate', gameState(game));
  return res.json(gameState(game));
});

/**
 * POST /api/games/:gameId/claim/:playerId
 * Atomically claims a player slot for a device.
 * Returns 409 if that player has already been claimed by another device.
 */
app.post('/api/games/:gameId/claim/:playerId', (req, res) => {
  const game = games[req.params.gameId];
  if (!game) return res.status(404).json({ error: 'Game not found.' });

  const { playerId } = req.params;
  const player = game.players.find(p => p.id === playerId);
  if (!player) return res.status(404).json({ error: 'Player not found.' });

  if (game.claimedPlayerIds.has(playerId)) {
    return res.status(409).json({ error: 'This player has already been taken by another device.' });
  }

  // Node.js is single-threaded: has() + add() is effectively atomic for in-memory state.
  game.claimedPlayerIds.add(playerId);
  // Broadcast updated state so the join page reflects the new claim
  io.to(game.id).emit('gameUpdate', gameState(game));
  return res.json({ ok: true });
});

/**
 * POST /api/games/:gameId/reset
 * Creates a fresh game with the same player names and returns { gameId, players }.
 * The original game is left intact so existing display/mobile links don't crash.
 */
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

  return res.status(201).json({
    gameId: newGameId,
    players: players.map(({ id, name }) => ({ id, name })),
  });
});

/**
 * GET /api/wins
 * Returns the all-time wins history: [{ playerName, date }]
 */
app.get('/api/wins', (req, res) => {
  res.json(wins);
});

const pageRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,            // up to 120 page loads per minute per IP
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

/**
 * GET /api/games/:gameId/join-qr
 * Returns an SVG QR code whose content is the join URL for this game.
 * The join URL points to /join/:gameId so any player can pick their seat.
 */
app.get('/api/games/:gameId/join-qr', async (req, res) => {
  const game = games[req.params.gameId];
  if (!game) return res.status(404).json({ error: 'Game not found.' });

  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const joinUrl = `${proto}://${host}/join/${req.params.gameId}`;

  try {
    const svg = await QRCode.toString(joinUrl, { type: 'svg', margin: 2, width: 250 });
    res.set('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code.' });
  }
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  socket.on('joinGame', ({ gameId: gid }) => {
    socket.join(gid);
    const game = games[gid];
    if (game) {
      socket.emit('gameUpdate', gameState(game));
    }
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
server.listen(PORT, () => {
  console.log(`Darts server running on http://localhost:${PORT}`);
});

module.exports = { app, server, games, wins };
