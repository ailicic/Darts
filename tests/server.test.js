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

// ── POST /api/games/:gameId/bounce ─────────────────────────────────────────

describe('POST /api/games/:gameId/bounce', () => {
  test('reverts the last throw in the current turn', async () => {
    const { gameId, players } = await createGame();

    // Throw target 20 single → Alice gets 1 mark on 20
    await request(app)
      .post(`/api/games/${gameId}/throw`)
      .send({ playerId: players[0].id, target: 20, multiplier: 1 });

    // Bounce it
    const res = await request(app)
      .post(`/api/games/${gameId}/bounce`)
      .send({ playerId: players[0].id });

    expect(res.status).toBe(200);
    expect(res.body.players[0].marks[20]).toBe(0);
    expect(res.body.dartsThrown).toBe(0);
    expect(res.body.currentTurnThrows).toHaveLength(0);
  });

  test('reverts score changes caused by the bounced throw', async () => {
    const { gameId, players } = await createGame();

    // Give Alice 2 marks on 20 via two single throws
    await request(app)
      .post(`/api/games/${gameId}/throw`)
      .send({ playerId: players[0].id, target: 20, multiplier: 1 });
    await request(app)
      .post(`/api/games/${gameId}/throw`)
      .send({ playerId: players[0].id, target: 20, multiplier: 1 });

    // Third throw: triple → Alice closes 20 with 2 overflow → Bob +40
    await request(app)
      .post(`/api/games/${gameId}/throw`)
      .send({ playerId: players[0].id, target: 20, multiplier: 3 });

    // Verify Bob has 40 points
    let state = await request(app).get(`/api/games/${gameId}`);
    expect(state.body.players[1].score).toBe(40);

    // Bounce the triple
    const res = await request(app)
      .post(`/api/games/${gameId}/bounce`)
      .send({ playerId: players[0].id });

    expect(res.status).toBe(200);
    expect(res.body.players[0].marks[20]).toBe(2); // back to 2 marks
    expect(res.body.players[1].score).toBe(0);     // Bob's penalty removed
    expect(res.body.dartsThrown).toBe(2);
  });

  test('returns 409 when there are no throws to revert', async () => {
    const { gameId, players } = await createGame();
    const res = await request(app)
      .post(`/api/games/${gameId}/bounce`)
      .send({ playerId: players[0].id });
    expect(res.status).toBe(409);
  });

  test("returns 403 when it is not the player's turn", async () => {
    const { gameId, players } = await createGame();
    const res = await request(app)
      .post(`/api/games/${gameId}/bounce`)
      .send({ playerId: players[1].id });
    expect(res.status).toBe(403);
  });

  test('returns 404 for unknown game', async () => {
    const res = await request(app)
      .post('/api/games/no-such-game/bounce')
      .send({ playerId: 'any' });
    expect(res.status).toBe(404);
  });

  test('allows multiple sequential bounces', async () => {
    const { gameId, players } = await createGame();

    await request(app)
      .post(`/api/games/${gameId}/throw`)
      .send({ playerId: players[0].id, target: 20, multiplier: 1 });
    await request(app)
      .post(`/api/games/${gameId}/throw`)
      .send({ playerId: players[0].id, target: 19, multiplier: 1 });

    // Bounce throw 2
    await request(app)
      .post(`/api/games/${gameId}/bounce`)
      .send({ playerId: players[0].id });

    // Bounce throw 1
    const res = await request(app)
      .post(`/api/games/${gameId}/bounce`)
      .send({ playerId: players[0].id });

    expect(res.status).toBe(200);
    expect(res.body.players[0].marks[20]).toBe(0);
    expect(res.body.players[0].marks[19]).toBe(0);
    expect(res.body.dartsThrown).toBe(0);
  });
});

// ── POST /api/games/:gameId/reset ──────────────────────────────────────────

describe('POST /api/games/:gameId/reset', () => {
  test('creates a new game with the same player names', async () => {
    const { gameId, players } = await createGame(['Alice', 'Bob']);
    const res = await request(app).post(`/api/games/${gameId}/reset`);

    expect(res.status).toBe(201);
    expect(res.body.gameId).toBeDefined();
    expect(res.body.gameId).not.toBe(gameId);
    expect(res.body.players).toHaveLength(2);
    expect(res.body.players[0].name).toBe('Alice');
    expect(res.body.players[1].name).toBe('Bob');
  });

  test('new game has fresh scores (reset to 0)', async () => {
    const { gameId, players } = await createGame(['Alice', 'Bob']);

    // Record some throws so score state is non-trivial
    await request(app)
      .post(`/api/games/${gameId}/throw`)
      .send({ playerId: players[0].id, target: 20, multiplier: 1 });

    const resetRes = await request(app).post(`/api/games/${gameId}/reset`);
    expect(resetRes.status).toBe(201);

    const newGameId = resetRes.body.gameId;
    const state = await request(app).get(`/api/games/${newGameId}`);

    expect(state.status).toBe(200);
    expect(state.body.gameOver).toBe(false);
    expect(state.body.dartsThrown).toBe(0);
    state.body.players.forEach((p) => {
      expect(p.score).toBe(0);
    });
  });

  test('new game assigns fresh player IDs', async () => {
    const { gameId, players } = await createGame(['Alice', 'Bob']);
    const res = await request(app).post(`/api/games/${gameId}/reset`);

    expect(res.status).toBe(201);
    const newIds = res.body.players.map((p) => p.id);
    const oldIds = players.map((p) => p.id);
    newIds.forEach((id) => expect(oldIds).not.toContain(id));
  });

  test('returns 404 for unknown game', async () => {
    const res = await request(app).post('/api/games/no-such-game/reset');
    expect(res.status).toBe(404);
  });

  test('original game is still accessible after reset', async () => {
    const { gameId } = await createGame(['Alice', 'Bob']);
    await request(app).post(`/api/games/${gameId}/reset`);

    const state = await request(app).get(`/api/games/${gameId}`);
    expect(state.status).toBe(200);
  });
});


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
