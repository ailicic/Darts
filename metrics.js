const promClient = require('prom-client');

// Create default metrics (CPU, memory, etc.)
promClient.collectDefaultMetrics();

// Custom metrics
const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

const httpRequestTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

const activeGames = new promClient.Gauge({
  name: 'active_games',
  help: 'Number of active games',
});

const activePlayers = new promClient.Gauge({
  name: 'active_players',
  help: 'Number of players currently playing',
});

const gameWinsTotal = new promClient.Counter({
  name: 'game_wins_total',
  help: 'Total games won',
  labelNames: ['player_name'],
});

const dartsThrown = new promClient.Counter({
  name: 'darts_thrown_total',
  help: 'Total darts thrown',
});

const socketConnections = new promClient.Gauge({
  name: 'socket_connections',
  help: 'Number of active Socket.IO connections',
});

module.exports = {
  httpRequestDuration,
  httpRequestTotal,
  activeGames,
  activePlayers,
  gameWinsTotal,
  dartsThrown,
  socketConnections,
  register: promClient.register,
};
