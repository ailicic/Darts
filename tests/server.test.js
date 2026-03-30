const request = require('supertest');
const { app, server, games } = require('../server');

afterAll((done) => {
  server.close(done);
});

// Helper: create a game and return { gameId, players }
async function createGame(names = ['Alice', 'Bob']) {
  const res = await request(app)
    .post('/api/games')
    .send({ playerNames: names });
  return res.body;
}

// ── POST /api/games ────────────────────────────────────────────────────────

describe('POST /api/games', () => {
  test('creates a game with 2 players', async () => {
    const res = await request(app)
      .post('/api/games')
      .send({ playerNames: ['Alice', 'Bob'] });

    expect(res.status).toBe(201);
    expect(res.body.gameId).toBeDefined();
    expect(res.body.players).toHaveLength(2);
    expect(res.body.players[0].name).toBe('Alice');
    expect(res.body.players[1].name).toBe('Bob');
  });

  test('rejects fewer than 2 players', async () => {
    const res = await request(app)
      .post('/api/games')
      .send({ playerNames: ['Alice'] });
    expect(res.status).toBe(400);
  });

  test('rejects more than 8 players', async () => {
    const res = await request(app)
      .post('/api/games')
      .send({ playerNames: ['A','B','C','D','E','F','G','H','I'] });
    expect(res.status).toBe(400);
  });

  test('strips HTML from player names', async () => {
    const res = await request(app)
      .post('/api/games')
      .send({ playerNames: ['<script>evil</script>', 'Bob'] });
    expect(res.status).toBe(201);
    expect(res.body.players[0].name).not.toContain('<');
  });
});

// ── GET /api/games/:gameId ─────────────────────────────────────────────────

describe('GET /api/games/:gameId', () => {
  test('returns 404 for unknown game', async () => {
    const res = await request(app).get('/api/games/no-such-game');
    expect(res.status).toBe(404);
  });

  test('returns game state for valid game', async () => {
    const { gameId } = await createGame();
    const res = await request(app).get(`/api/games/${gameId}`);
    expect(res.status).toBe(200);
    expect(res.body.players).toHaveLength(2);
    expect(res.body.gameOver).toBe(false);
  });
});

// ── POST /api/games/:gameId/throw ──────────────────────────────────────────

describe('POST /api/games/:gameId/throw', () => {
  test('records a valid throw', async () => {
    const { gameId, players } = await createGame();
    const res = await request(app)
      .post(`/api/games/${gameId}/throw`)
      .send({ playerId: players[0].id, target: 20, multiplier: 1 });
    expect(res.status).toBe(200);
    expect(res.body.players[0].marks[20]).toBe(1);
  });

  test("returns 403 when it is not the player's turn", async () => {
    const { gameId, players } = await createGame();
    const res = await request(app)
      .post(`/api/games/${gameId}/throw`)
      .send({ playerId: players[1].id, target: 20, multiplier: 1 });
    expect(res.status).toBe(403);
  });

  test('returns 400 for invalid target', async () => {
    const { gameId, players } = await createGame();
    const res = await request(app)
      .post(`/api/games/${gameId}/throw`)
      .send({ playerId: players[0].id, target: 13, multiplier: 1 });
    expect(res.status).toBe(400);
  });

  test('returns 400 for invalid multiplier', async () => {
    const { gameId, players } = await createGame();
    const res = await request(app)
      .post(`/api/games/${gameId}/throw`)
      .send({ playerId: players[0].id, target: 20, multiplier: 4 });
    expect(res.status).toBe(400);
  });

  test('records a miss (target 0)', async () => {
    const { gameId, players } = await createGame();
    const res = await request(app)
      .post(`/api/games/${gameId}/throw`)
      .send({ playerId: players[0].id, target: 0, multiplier: 1 });
    expect(res.status).toBe(200);
    expect(res.body.players[0].marks[20]).toBe(0); // no marks added
  });
});

// ── POST /api/games/:gameId/end-turn ──────────────────────────────────────

describe('POST /api/games/:gameId/end-turn', () => {
  test('advances to the next player', async () => {
    const { gameId, players } = await createGame();
    const res = await request(app)
      .post(`/api/games/${gameId}/end-turn`)
      .send({ playerId: players[0].id });
    expect(res.status).toBe(200);
    expect(res.body.currentPlayerId).toBe(players[1].id);
  });

  test("returns 403 when it is not the player's turn", async () => {
    const { gameId, players } = await createGame();
    const res = await request(app)
      .post(`/api/games/${gameId}/end-turn`)
      .send({ playerId: players[1].id });
    expect(res.status).toBe(403);
  });
});

// ── GET /api/games/:gameId/join-qr ─────────────────────────────────────────

describe('GET /api/games/:gameId/join-qr', () => {
  test('returns an SVG QR code for a valid game', async () => {
    const { gameId } = await createGame();
    const res = await request(app).get(`/api/games/${gameId}/join-qr`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/svg/);
    // SVG responses may be buffered; convert body or text to string for assertion
    const bodyText = res.text || (Buffer.isBuffer(res.body) ? res.body.toString() : '');
    expect(bodyText).toContain('<svg');
  });

  test('returns 404 for an unknown game', async () => {
    const res = await request(app).get('/api/games/nonexistent/join-qr');
    expect(res.status).toBe(404);
  });
});

// ── Page routes ────────────────────────────────────────────────────────────

describe('Page routes', () => {
  test('GET / returns HTML', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });

  test('GET /display/:gameId returns HTML', async () => {
    const res = await request(app).get('/display/test-id');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });

  test('GET /join/:gameId returns HTML', async () => {
    const res = await request(app).get('/join/test-id');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });

  test('GET /play/:gameId/:playerId returns HTML', async () => {
    const res = await request(app).get('/play/test-id/player-id');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });
});
