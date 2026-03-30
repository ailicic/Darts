const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

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

  if (game.dartsThrown >= 3) {
    return res.status(409).json({ error: 'Turn already complete, call end-turn first.' });
  }

  const result = processThrow(game.players, game.currentPlayerIndex, t, m);
  game.dartsThrown += 1;
  game.currentTurnThrows.push({ target: t, multiplier: m, result });

  const { gameOver, winnerId } = checkWinCondition(game.players);

  if (gameOver) {
    game.gameOver = true;
    game.winnerId = winnerId;
  }

  // Emit real-time update to all clients watching this game
  io.to(gameId(game)).emit('gameUpdate', gameState(game));

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

  io.to(gameId(game)).emit('gameUpdate', gameState(game));

  return res.json(gameState(game));
});

// ── Page routes ───────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/display/:gameId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

app.get('/play/:gameId/:playerId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mobile.html'));
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

function gameId(game) {
  return game.id;
}

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
  };
}

// ── Start server ──────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Darts server running on http://localhost:${PORT}`);
});

module.exports = { app, server, games };
