/**
 * Darts - Game Logic
 *
 * Supports multiple game modes:
 *  - cutThroat : Cut-Throat Cricket (15-20, Bull; overflow adds points to opponents; lowest score wins)
 *  - cricket   : Standard Cricket  (15-20, Bull; overflow adds points to thrower; highest score wins)
 *  - 501 / 301 : Count-down x01    (start at 501/301; must finish on double; first to 0 wins)
 *  - atw       : Around the World  (hit 1-20 then Bull in order; first to complete wins)
 */

// ── Game mode identifiers ─────────────────────────────────────────────────────
const GAME_MODES = {
  CUT_THROAT: 'cutThroat',
  CRICKET: 'cricket',
  X501: '501',
  X301: '301',
  ATW: 'atw',
};

// ── Cut Throat / Cricket targets ──────────────────────────────────────────────
const TARGETS = [15, 16, 17, 18, 19, 20, 25];
const MARKS_TO_CLOSE = 3;

// ── 501 / 301 targets ─────────────────────────────────────────────────────────
const X01_TARGETS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 25];

// ── Around the World sequence ─────────────────────────────────────────────────
const ATW_TARGETS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 25];

/**
 * Create initial state for a single player.
 * @param {string} id
 * @param {string} name
 * @returns {object}
 */
function createPlayer(id, name) {
  const marks = {};
  TARGETS.forEach((t) => (marks[t] = 0));
  return {
    id,
    name,
    marks,    // marks[target] = 0..3+
    score: 0, // accumulated penalty points (lower is better)
  };
}

/**
 * Check whether a player has closed a specific target.
 * @param {object} player
 * @param {number} target
 * @returns {boolean}
 */
function isClosed(player, target) {
  return player.marks[target] >= MARKS_TO_CLOSE;
}

/**
 * Check whether ALL players have closed a specific target.
 * @param {object[]} players
 * @param {number} target
 * @returns {boolean}
 */
function isTargetClosedByAll(players, target) {
  return players.every((p) => isClosed(p, target));
}

/**
 * Process a single dart throw for the current player.
 *
 * @param {object[]} players - Array of all player objects (mutated in place)
 * @param {number} currentPlayerIndex - Index of the throwing player
 * @param {number} target - Target number hit (one of TARGETS, or 0 for miss)
 * @param {number} multiplier - 1 (single), 2 (double), 3 (triple)
 * @returns {{ marksAdded: number, pointsAdded: { [playerId]: number }, miss: boolean }}
 */
function processThrow(players, currentPlayerIndex, target, multiplier) {
  const thrower = players[currentPlayerIndex];

  if (!TARGETS.includes(target) || target === 0) {
    return { marksAdded: 0, pointsAdded: {}, miss: true };
  }

  const result = { marksAdded: 0, pointsAdded: {}, miss: false };

  // If the target is already closed by everyone, it has no effect
  if (isTargetClosedByAll(players, target)) {
    return result;
  }

  const marksNeededToClose = Math.max(0, MARKS_TO_CLOSE - thrower.marks[target]);
  const marksToAdd = Math.min(multiplier, marksNeededToClose);
  const overflowMarks = multiplier - marksToAdd;

  // Add marks to the thrower
  thrower.marks[target] = Math.min(thrower.marks[target] + multiplier, MARKS_TO_CLOSE);
  result.marksAdded = marksToAdd + overflowMarks; // total marks hit

  // If thrower now has the number closed and there were overflow marks,
  // those overflow marks add points to players who haven't closed the number.
  if (isClosed(thrower, target) && overflowMarks > 0) {
    const pointsPerMark = target === 25 ? 25 : target;
    const totalPoints = overflowMarks * pointsPerMark;

    players.forEach((p) => {
      if (p.id !== thrower.id && !isClosed(p, target)) {
        p.score += totalPoints;
        result.pointsAdded[p.id] = (result.pointsAdded[p.id] || 0) + totalPoints;
      }
    });
  }

  return result;
}

/**
 * Determine whether the game is over, and who the winner is.
 *
 * Game ends when a player has closed ALL targets AND has the lowest score.
 * If a player has closed all targets but does NOT have the lowest score,
 * the game continues until the score condition is met (or another player
 * also closes all targets).
 *
 * @param {object[]} players
 * @returns {{ gameOver: boolean, winnerId: string|null }}
 */
function checkWinCondition(players) {
  const closedAll = players.filter((p) =>
    TARGETS.every((t) => isClosed(p, t))
  );

  if (closedAll.length === 0) {
    return { gameOver: false, winnerId: null };
  }

  const minScore = Math.min(...players.map((p) => p.score));
  const winner = closedAll.find((p) => p.score === minScore);

  if (winner) {
    return { gameOver: true, winnerId: winner.id };
  }

  return { gameOver: false, winnerId: null };
}

// ══════════════════════════════════════════════════════════════════════════════
// Standard Cricket
// Same targets as Cut-Throat, but overflow marks score points for the THROWER
// (not opponents). Win: close all targets AND have the HIGHEST score.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Process a single dart throw for Standard Cricket mode.
 * After closing, overflow marks add points to the THROWER's own score
 * (only if at least one opponent hasn't closed the target yet).
 */
function processThrowCricket(players, currentPlayerIndex, target, multiplier) {
  const thrower = players[currentPlayerIndex];

  if (!TARGETS.includes(target) || target === 0) {
    return { marksAdded: 0, pointsAdded: 0, miss: true };
  }

  if (isTargetClosedByAll(players, target)) {
    return { marksAdded: 0, pointsAdded: 0, miss: false };
  }

  const marksNeeded = Math.max(0, MARKS_TO_CLOSE - thrower.marks[target]);
  const overflowMarks = Math.max(0, multiplier - marksNeeded);

  thrower.marks[target] = Math.min(thrower.marks[target] + multiplier, MARKS_TO_CLOSE);

  let pointsAdded = 0;
  if (isClosed(thrower, target) && overflowMarks > 0) {
    // Score only if at least one opponent hasn't closed this target
    const anyOpen = players.some((p) => p.id !== thrower.id && !isClosed(p, target));
    if (anyOpen) {
      const pointsPerMark = target === 25 ? 25 : target;
      pointsAdded = overflowMarks * pointsPerMark;
      thrower.score += pointsAdded;
    }
  }

  return { marksAdded: multiplier, pointsAdded, miss: false };
}

/**
 * Win condition for Standard Cricket: first player to close all targets
 * AND have the highest score wins.
 */
function checkWinConditionCricket(players) {
  const closedAll = players.filter((p) => TARGETS.every((t) => isClosed(p, t)));

  if (closedAll.length === 0) {
    return { gameOver: false, winnerId: null };
  }

  const maxScore = Math.max(...players.map((p) => p.score));
  const winner = closedAll.find((p) => p.score === maxScore);

  if (winner) {
    return { gameOver: true, winnerId: winner.id };
  }

  return { gameOver: false, winnerId: null };
}

// ══════════════════════════════════════════════════════════════════════════════
// x01 (501 / 301)
// Players start at 501 or 301 and count down. Must finish on a double.
// A throw that would take the score below 0, or to exactly 0 on a non-double,
// is treated as a "bust" (no score change for that dart).
// Win: reach exactly 0 on a double.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Create a player for x01 mode.
 * @param {string} id
 * @param {string} name
 * @param {number} startScore  501 or 301
 */
function createPlayerX01(id, name, startScore) {
  return {
    id,
    name,
    score: startScore,
    marks: {}, // not used, kept for snapshot compatibility
  };
}

/**
 * Process a single dart throw for x01 mode.
 * Returns the score change (negative = points deducted) and whether the dart busted.
 *
 * Bull (target=25):
 *   single (×1) = 25 pts, double (×2) = 50 pts, triple (×3) = invalid (rejected server-side)
 *
 * @returns {{ pointsScored: number, busted: boolean, miss: boolean, won: boolean }}
 */
function processThrowX01(players, currentPlayerIndex, target, multiplier) {
  const thrower = players[currentPlayerIndex];

  if (target === 0 || !X01_TARGETS.includes(target)) {
    return { pointsScored: 0, busted: false, miss: true, won: false };
  }

  // Bull: single=25, double=50
  const pointValue = target === 25
    ? (multiplier === 2 ? 50 : 25)
    : target * multiplier;

  const newScore = thrower.score - pointValue;

  // Bust: score would go below 0
  if (newScore < 0) {
    return { pointsScored: 0, busted: true, miss: false, won: false };
  }

  // Bust: hitting exactly 0 without a double (or double bull)
  if (newScore === 0 && multiplier !== 2) {
    return { pointsScored: 0, busted: true, miss: false, won: false };
  }

  thrower.score = newScore;

  const won = newScore === 0 && multiplier === 2;
  return { pointsScored: pointValue, busted: false, miss: false, won };
}

/**
 * Win condition for x01: any player whose score is exactly 0.
 */
function checkWinConditionX01(players) {
  const winner = players.find((p) => p.score === 0);
  if (winner) return { gameOver: true, winnerId: winner.id };
  return { gameOver: false, winnerId: null };
}

// ══════════════════════════════════════════════════════════════════════════════
// Around the World (ATW)
// Players must hit targets 1-20 then Bull in order.
// Any multiplier counts as a hit; first to complete the sequence wins.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Create a player for Around the World mode.
 */
function createPlayerATW(id, name) {
  return {
    id,
    name,
    score: 0,       // number of targets hit so far (0 – ATW_TARGETS.length)
    targetIndex: 0, // index into ATW_TARGETS of the next required target
    marks: {},      // kept for snapshot compatibility
  };
}

/**
 * Process a single dart throw for ATW mode.
 * @returns {{ hit: boolean, miss: boolean, targetHit: number|null }}
 */
function processThrowATW(players, currentPlayerIndex, target, multiplier) {
  const thrower = players[currentPlayerIndex];

  if (thrower.targetIndex >= ATW_TARGETS.length) {
    // Already finished – shouldn't happen but guard anyway
    return { hit: false, miss: false, targetHit: null };
  }

  const needed = ATW_TARGETS[thrower.targetIndex];

  if (target !== needed) {
    return { hit: false, miss: true, targetHit: null };
  }

  // Any hit (single/double/triple) on the required target advances by 1
  thrower.targetIndex += 1;
  thrower.score = thrower.targetIndex;

  return { hit: true, miss: false, targetHit: needed };
}

/**
 * Win condition for ATW: first player to hit all ATW_TARGETS in order.
 */
function checkWinConditionATW(players) {
  const winner = players.find((p) => p.targetIndex >= ATW_TARGETS.length);
  if (winner) return { gameOver: true, winnerId: winner.id };
  return { gameOver: false, winnerId: null };
}

module.exports = {
  // Constants
  GAME_MODES,
  TARGETS,
  X01_TARGETS,
  ATW_TARGETS,

  // Cut Throat (existing)
  createPlayer,
  processThrow,
  checkWinCondition,
  isClosed,
  isTargetClosedByAll,

  // Standard Cricket
  processThrowCricket,
  checkWinConditionCricket,

  // x01
  createPlayerX01,
  processThrowX01,
  checkWinConditionX01,

  // Around the World
  createPlayerATW,
  processThrowATW,
  checkWinConditionATW,
};
