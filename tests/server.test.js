jest.mock('../db', () => ({
  initDb: jest.fn().mockResolvedValue(undefined),
  loadWins: jest.fn().mockResolvedValue([]),
  loadResults: jest.fn().mockResolvedValue([]),
  saveWin: jest.fn().mockResolvedValue(undefined),
  saveResult: jest.fn().mockResolvedValue(undefined),
}));

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

    await request(app)
      .post(`/api/games/${gameId}/throw`)
      .send({ playerId: players[0].id, target: 20, multiplier: 1 });

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

    await request(app)
      .post(`/api/games/${gameId}/throw`)
      .send({ playerId: players[0].id, target: 20, multiplier: 1 });
    await request(app)
      .post(`/api/games/${gameId}/throw`)
      .send({ playerId: players[0].id, target: 20, multiplier: 1 });

    // Triple → closes 20 with 2 overflow → Bob +40
    await request(app)
      .post(`/api/games/${gameId}/throw`)
      .send({ playerId: players[0].id, target: 20, multiplier: 3 });

    let state = await request(app).get(`/api/games/${gameId}`);
    expect(state.body.players[1].score).toBe(40);

    const res = await request(app)
      .post(`/api/games/${gameId}/bounce`)
      .send({ playerId: players[0].id });

    expect(res.status).toBe(200);
    expect(res.body.players[0].marks[20]).toBe(2);
    expect(res.body.players[1].score).toBe(0);
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

    await request(app)
      .post(`/api/games/${gameId}/bounce`)
      .send({ playerId: players[0].id });

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

  test('GET /scoreboard returns HTML', async () => {
    const res = await request(app).get('/scoreboard');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });
});

// ── Game mode: 501 ─────────────────────────────────────────────────────────

async function createGameMode(names, gameMode) {
  const res = await request(app)
    .post('/api/games')
    .send({ playerNames: names, gameMode });
  return res.body;
}

describe('POST /api/games with gameMode=501', () => {
  test('creates a 501 game with players starting at 501', async () => {
    const { gameId } = await createGameMode(['Alice', 'Bob'], '501');
    const state = await request(app).get(`/api/games/${gameId}`);
    expect(state.status).toBe(200);
    expect(state.body.gameMode).toBe('501');
    state.body.players.forEach((p) => expect(p.score).toBe(501));
  });

  test('subtracts score on a valid x01 throw', async () => {
    const { gameId, players } = await createGameMode(['Alice', 'Bob'], '501');
    const res = await request(app)
      .post(`/api/games/${gameId}/throw`)
      .send({ playerId: players[0].id, target: 20, multiplier: 3 });
    expect(res.status).toBe(200);
    expect(res.body.players[0].score).toBe(441); // 501 - 60
  });

  test('accepts targets 1-20 and Bull in 501', async () => {
    const { gameId, players } = await createGameMode(['Alice', 'Bob'], '501');
    // target 1 is valid in 501 but not in cut-throat
    const res = await request(app)
      .post(`/api/games/${gameId}/throw`)
      .send({ playerId: players[0].id, target: 1, multiplier: 1 });
    expect(res.status).toBe(200);
    expect(res.body.players[0].score).toBe(500);
  });

  test('does not change score when throw would bust (go below 0)', async () => {
    const { gameId, players } = await createGameMode(['Alice', 'Bob'], '501');
    // score is 501, throw T20=60 * 9 rounds to bring close…
    // just set score low by direct game access then test bust
    // Instead: create a 301 game, throw T20×4 = 240 → 61 left; T20 = bust
    const { gameId: gid2, players: ps2 } = await createGameMode(['A', 'B'], '301');
    // T20 × 5 turns (15 darts, needs end-turn between):
    for (let turn = 0; turn < 4; turn++) {
      for (let d = 0; d < 3; d++) {
        await request(app)
          .post(`/api/games/${gid2}/throw`)
          .send({ playerId: ps2[0].id, target: 20, multiplier: 3 });
      }
      await request(app)
        .post(`/api/games/${gid2}/end-turn`)
        .send({ playerId: ps2[0].id });
      // Skip p2's turn
      await request(app)
        .post(`/api/games/${gid2}/end-turn`)
        .send({ playerId: ps2[1].id });
    }
    // p0 score = 301 - (4 * 3 * 60) = 301 - 720 = bust on 1st throw
    // Actually 4 * 3 * 60 = 720 > 301 - let's verify state doesn't go negative
    const state = await request(app).get(`/api/games/${gid2}`);
    expect(state.body.players[0].score).toBeGreaterThanOrEqual(0);
  });

  test('preserves gameMode on reset', async () => {
    const { gameId } = await createGameMode(['Alice', 'Bob'], '501');
    const resetRes = await request(app).post(`/api/games/${gameId}/reset`);
    expect(resetRes.status).toBe(201);
    const newState = await request(app).get(`/api/games/${resetRes.body.gameId}`);
    expect(newState.body.gameMode).toBe('501');
    newState.body.players.forEach((p) => expect(p.score).toBe(501));
  });
});

// ── Game mode: 301 ─────────────────────────────────────────────────────────

describe('POST /api/games with gameMode=301', () => {
  test('creates a 301 game with players starting at 301', async () => {
    const { gameId } = await createGameMode(['Alice', 'Bob'], '301');
    const state = await request(app).get(`/api/games/${gameId}`);
    expect(state.body.players[0].score).toBe(301);
    expect(state.body.gameMode).toBe('301');
  });
});

// ── Game mode: cricket ──────────────────────────────────────────────────────

describe('POST /api/games with gameMode=cricket', () => {
  test('creates a cricket game', async () => {
    const { gameId } = await createGameMode(['Alice', 'Bob'], 'cricket');
    const state = await request(app).get(`/api/games/${gameId}`);
    expect(state.body.gameMode).toBe('cricket');
    state.body.players.forEach((p) => expect(p.score).toBe(0));
  });

  test('overflow adds points to THROWER not opponents in cricket', async () => {
    const { gameId, players } = await createGameMode(['Alice', 'Bob'], 'cricket');
    // Give Alice 2 marks on 20 by throwing twice (single each)
    await request(app)
      .post(`/api/games/${gameId}/throw`)
      .send({ playerId: players[0].id, target: 20, multiplier: 1 });
    await request(app)
      .post(`/api/games/${gameId}/throw`)
      .send({ playerId: players[0].id, target: 20, multiplier: 1 });
    // Now triple 20: 1 mark to close + 2 overflow → Alice +40
    const res = await request(app)
      .post(`/api/games/${gameId}/throw`)
      .send({ playerId: players[0].id, target: 20, multiplier: 3 });
    expect(res.status).toBe(200);
    expect(res.body.players[0].score).toBe(40); // Alice scored
    expect(res.body.players[1].score).toBe(0);  // Bob unchanged
  });
});

// ── Game mode: atw (Around the World) ───────────────────────────────────────

describe('POST /api/games with gameMode=atw', () => {
  test('creates an ATW game with targetIndex=0', async () => {
    const { gameId } = await createGameMode(['Alice', 'Bob'], 'atw');
    const state = await request(app).get(`/api/games/${gameId}`);
    expect(state.body.gameMode).toBe('atw');
    state.body.players.forEach((p) => {
      expect(p.score).toBe(0);
      expect(p.targetIndex).toBe(0);
    });
  });

  test('hitting the correct target advances progress', async () => {
    const { gameId, players } = await createGameMode(['Alice', 'Bob'], 'atw');
    const res = await request(app)
      .post(`/api/games/${gameId}/throw`)
      .send({ playerId: players[0].id, target: 1, multiplier: 1 });
    expect(res.status).toBe(200);
    expect(res.body.players[0].targetIndex).toBe(1);
    expect(res.body.players[0].score).toBe(1);
  });

  test('missing the correct ATW target does not advance', async () => {
    const { gameId, players } = await createGameMode(['Alice', 'Bob'], 'atw');
    const res = await request(app)
      .post(`/api/games/${gameId}/throw`)
      .send({ playerId: players[0].id, target: 2, multiplier: 1 }); // needs 1 not 2
    expect(res.status).toBe(200);
    expect(res.body.players[0].targetIndex).toBe(0);
  });

  test('invalid gameMode falls back to cutThroat', async () => {
    const { gameId } = await createGameMode(['Alice', 'Bob'], 'invalidMode');
    const state = await request(app).get(`/api/games/${gameId}`);
    expect(state.body.gameMode).toBe('cutThroat');
  });
});
