/**
 * Cut Throat Darts - Game Logic
 *
 * Rules:
 * - Targets: 15, 16, 17, 18, 19, 20, Bull (25)
 * - Each player needs 3 marks on a number to "close" it
 * - Single = 1 mark, Double = 2 marks, Triple = 3 marks
 * - Once you close a number, hitting it again adds points to all OTHER players
 *   who have NOT yet closed that number
 * - Goal: Have the LOWEST score when someone closes all numbers
 * - Game ends when a player closes all numbers AND has the lowest score
 */

const TARGETS = [15, 16, 17, 18, 19, 20, 25];
const MARKS_TO_CLOSE = 3;

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

module.exports = { TARGETS, createPlayer, processThrow, checkWinCondition, isClosed, isTargetClosedByAll };
