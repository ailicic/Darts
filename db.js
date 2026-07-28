const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://darts:darts123@localhost:5432/darts',
});

async function initDb() {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS wins (' +
    '  id SERIAL PRIMARY KEY,' +
    '  player_name VARCHAR(60) NOT NULL,' +
    '  date TIMESTAMPTZ NOT NULL DEFAULT NOW()' +
    ')'
  );
  await pool.query(
    'CREATE TABLE IF NOT EXISTS results (' +
    '  id SERIAL PRIMARY KEY,' +
    '  players TEXT[] NOT NULL,' +
    '  winner VARCHAR(60) NOT NULL,' +
    '  game_mode VARCHAR(20),' +
    '  placements JSONB,' +
    '  date TIMESTAMPTZ NOT NULL DEFAULT NOW()' +
    ')'
  );
  await pool.query('ALTER TABLE results ADD COLUMN IF NOT EXISTS game_mode VARCHAR(20)');
}

async function loadWins() {
  const { rows } = await pool.query('SELECT player_name AS "playerName", date FROM wins ORDER BY id');
  return rows;
}

async function saveWin(playerName, date) {
  await pool.query('INSERT INTO wins (player_name, date) VALUES ($1, $2)', [playerName, date]);
}

async function loadResults() {
  const { rows } = await pool.query('SELECT players, winner, game_mode AS "gameMode", placements, date FROM results ORDER BY id');
  return rows;
}

async function saveResult(players, winner, gameMode, placements, date) {
  await pool.query(
    'INSERT INTO results (players, winner, game_mode, placements, date) VALUES ($1, $2, $3, $4, $5)',
    [players, winner, gameMode, JSON.stringify(placements), date]
  );
}

module.exports = { pool, initDb, loadWins, saveWin, loadResults, saveResult };
