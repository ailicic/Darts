const {
  TARGETS,
  X01_TARGETS,
  ATW_TARGETS,
  GAME_MODES,
  createPlayer,
  processThrow,
  checkWinCondition,
  isClosed,
  isTargetClosedByAll,
  processThrowCricket,
  checkWinConditionCricket,
  createPlayerX01,
  processThrowX01,
  checkWinConditionX01,
  createPlayerATW,
  processThrowATW,
  checkWinConditionATW,
} = require('../gameLogic');

describe('TARGETS constant', () => {
  test('contains the correct cut-throat targets', () => {
    expect(TARGETS).toEqual([15, 16, 17, 18, 19, 20, 25]);
  });
});

describe('createPlayer', () => {
  test('creates a player with correct structure', () => {
    const p = createPlayer('id1', 'Alice');
    expect(p.id).toBe('id1');
    expect(p.name).toBe('Alice');
    expect(p.score).toBe(0);
    TARGETS.forEach((t) => expect(p.marks[t]).toBe(0));
  });
});

describe('isClosed', () => {
  test('returns false when marks < 3', () => {
    const p = createPlayer('id1', 'Alice');
    p.marks[20] = 2;
    expect(isClosed(p, 20)).toBe(false);
  });

  test('returns true when marks >= 3', () => {
    const p = createPlayer('id1', 'Alice');
    p.marks[20] = 3;
    expect(isClosed(p, 20)).toBe(true);
  });
});

describe('isTargetClosedByAll', () => {
  test('returns false when only some players have closed a target', () => {
    const p1 = createPlayer('1', 'A');
    const p2 = createPlayer('2', 'B');
    p1.marks[20] = 3;
    expect(isTargetClosedByAll([p1, p2], 20)).toBe(false);
  });

  test('returns true when all players have closed a target', () => {
    const p1 = createPlayer('1', 'A');
    const p2 = createPlayer('2', 'B');
    p1.marks[20] = 3;
    p2.marks[20] = 3;
    expect(isTargetClosedByAll([p1, p2], 20)).toBe(true);
  });
});

describe('processThrow – miss', () => {
  test('returns miss=true for target 0', () => {
    const p = createPlayer('1', 'A');
    const result = processThrow([p], 0, 0, 1);
    expect(result.miss).toBe(true);
  });

  test('returns miss=true for invalid target', () => {
    const p = createPlayer('1', 'A');
    const result = processThrow([p], 0, 99, 1);
    expect(result.miss).toBe(true);
  });
});

describe('processThrow – single hit', () => {
  test('adds 1 mark to thrower for single', () => {
    const p1 = createPlayer('1', 'A');
    const p2 = createPlayer('2', 'B');
    processThrow([p1, p2], 0, 20, 1);
    expect(p1.marks[20]).toBe(1);
  });

  test('adds 2 marks to thrower for double', () => {
    const p1 = createPlayer('1', 'A');
    const p2 = createPlayer('2', 'B');
    processThrow([p1, p2], 0, 20, 2);
    expect(p1.marks[20]).toBe(2);
  });

  test('closes number with triple', () => {
    const p1 = createPlayer('1', 'A');
    const p2 = createPlayer('2', 'B');
    processThrow([p1, p2], 0, 20, 3);
    expect(p1.marks[20]).toBe(3);
    expect(isClosed(p1, 20)).toBe(true);
  });

  test('does NOT add points to others when closing (no overflow)', () => {
    const p1 = createPlayer('1', 'A');
    const p2 = createPlayer('2', 'B');
    processThrow([p1, p2], 0, 20, 3); // exactly closes, no overflow
    expect(p2.score).toBe(0);
  });
});

describe('processThrow – overflow scoring', () => {
  test('adds points to other players on overflow after close', () => {
    const p1 = createPlayer('1', 'A');
    const p2 = createPlayer('2', 'B');
    // Give p1 2 marks already, then throw triple → close + 2 overflow
    p1.marks[20] = 2;
    processThrow([p1, p2], 0, 20, 3);
    // p1 is now closed (2+1 needed to close, 2 overflow), p2 gets 20*2 = 40
    expect(p1.marks[20]).toBe(3);
    expect(p2.score).toBe(40);
  });

  test('overflow on Bull uses 25 points per mark', () => {
    const p1 = createPlayer('1', 'A');
    const p2 = createPlayer('2', 'B');
    p1.marks[25] = 2;
    processThrow([p1, p2], 0, 25, 3);
    // 1 mark needed to close, 2 overflow → p2 gets 25*2 = 50
    expect(p2.score).toBe(50);
  });

  test('does NOT add points to players who have already closed the number', () => {
    const p1 = createPlayer('1', 'A');
    const p2 = createPlayer('2', 'B');
    const p3 = createPlayer('3', 'C');
    p2.marks[20] = 3; // p2 already closed 20
    p1.marks[20] = 2;
    processThrow([p1, p2, p3], 0, 20, 3); // p1 closes with 2 overflow
    expect(p2.score).toBe(0);   // p2 already closed → no points
    expect(p3.score).toBe(40);  // p3 hasn't closed → 20*2 = 40
  });

  test('no effect when target already closed by all', () => {
    const p1 = createPlayer('1', 'A');
    const p2 = createPlayer('2', 'B');
    p1.marks[20] = 3;
    p2.marks[20] = 3;
    const result = processThrow([p1, p2], 0, 20, 3);
    expect(result.marksAdded).toBe(0);
    expect(p2.score).toBe(0);
  });
});

describe('checkWinCondition', () => {
  function makeClosedPlayer(id, name, score) {
    const p = createPlayer(id, name);
    TARGETS.forEach((t) => (p.marks[t] = 3));
    p.score = score;
    return p;
  }

  test('returns gameOver=false when no one has closed all', () => {
    const p1 = createPlayer('1', 'A');
    const p2 = createPlayer('2', 'B');
    expect(checkWinCondition([p1, p2])).toEqual({ gameOver: false, winnerId: null });
  });

  test('returns gameOver=true with correct winner when one player closes all with lowest score', () => {
    const p1 = makeClosedPlayer('1', 'A', 0);
    const p2 = createPlayer('2', 'B');
    const result = checkWinCondition([p1, p2]);
    expect(result.gameOver).toBe(true);
    expect(result.winnerId).toBe('1');
  });

  test('returns gameOver=false when closed player does not have lowest score', () => {
    const p1 = makeClosedPlayer('1', 'A', 100);
    const p2 = createPlayer('2', 'B');
    p2.score = 50;
    const result = checkWinCondition([p1, p2]);
    expect(result.gameOver).toBe(false);
  });

  test('picks the correct winner when multiple players close all numbers', () => {
    const p1 = makeClosedPlayer('1', 'A', 30);
    const p2 = makeClosedPlayer('2', 'B', 10);
    const result = checkWinCondition([p1, p2]);
    expect(result.gameOver).toBe(true);
    expect(result.winnerId).toBe('2');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Standard Cricket
// ─────────────────────────────────────────────────────────────────────────────

describe('processThrowCricket – marks and own scoring', () => {
  test('adds marks to thrower', () => {
    const p1 = createPlayer('1', 'A');
    const p2 = createPlayer('2', 'B');
    processThrowCricket([p1, p2], 0, 20, 1);
    expect(p1.marks[20]).toBe(1);
  });

  test('overflow marks after close add points to THROWER (not opponents)', () => {
    const p1 = createPlayer('1', 'A');
    const p2 = createPlayer('2', 'B');
    p1.marks[20] = 2; // needs 1 to close
    processThrowCricket([p1, p2], 0, 20, 3); // 1 to close + 2 overflow
    expect(p1.score).toBe(40);  // thrower gains 20×2
    expect(p2.score).toBe(0);   // opponent unaffected
  });

  test('no points scored when all opponents have already closed the target', () => {
    const p1 = createPlayer('1', 'A');
    const p2 = createPlayer('2', 'B');
    p2.marks[20] = 3; // p2 already closed 20
    p1.marks[20] = 2;
    processThrowCricket([p1, p2], 0, 20, 3);
    expect(p1.score).toBe(0); // no opponent open to score against
  });

  test('miss returns miss=true', () => {
    const p = createPlayer('1', 'A');
    const result = processThrowCricket([p], 0, 0, 1);
    expect(result.miss).toBe(true);
  });
});

describe('checkWinConditionCricket', () => {
  function makeClosedCricket(id, name, score) {
    const p = createPlayer(id, name);
    TARGETS.forEach((t) => (p.marks[t] = 3));
    p.score = score;
    return p;
  }

  test('no winner when nobody has closed all', () => {
    const p1 = createPlayer('1', 'A');
    const p2 = createPlayer('2', 'B');
    expect(checkWinConditionCricket([p1, p2])).toEqual({ gameOver: false, winnerId: null });
  });

  test('winner is the closed player with HIGHEST score', () => {
    const p1 = makeClosedCricket('1', 'A', 100);
    const p2 = createPlayer('2', 'B');
    expect(checkWinConditionCricket([p1, p2])).toEqual({ gameOver: true, winnerId: '1' });
  });

  test('when multiple close, winner has highest score', () => {
    const p1 = makeClosedCricket('1', 'A', 80);
    const p2 = makeClosedCricket('2', 'B', 120);
    expect(checkWinConditionCricket([p1, p2])).toEqual({ gameOver: true, winnerId: '2' });
  });

  test('returns gameOver=false when closed player does not have highest score', () => {
    const p1 = makeClosedCricket('1', 'A', 50);
    const p2 = createPlayer('2', 'B');
    p2.score = 80; // p2 not closed but has higher score
    expect(checkWinConditionCricket([p1, p2]).gameOver).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// x01 (501 / 301)
// ─────────────────────────────────────────────────────────────────────────────

describe('createPlayerX01', () => {
  test('creates a player with correct startScore', () => {
    const p = createPlayerX01('id1', 'Alice', 501);
    expect(p.score).toBe(501);
    expect(p.id).toBe('id1');
    expect(p.name).toBe('Alice');
  });
});

describe('processThrowX01 – normal scoring', () => {
  test('subtracts single hit from score', () => {
    const p = createPlayerX01('1', 'A', 501);
    const result = processThrowX01([p], 0, 20, 1);
    expect(p.score).toBe(481);
    expect(result.pointsScored).toBe(20);
    expect(result.busted).toBe(false);
    expect(result.miss).toBe(false);
  });

  test('subtracts double hit (40 pts) correctly', () => {
    const p = createPlayerX01('1', 'A', 501);
    processThrowX01([p], 0, 20, 2);
    expect(p.score).toBe(461);
  });

  test('single Bull scores 25', () => {
    const p = createPlayerX01('1', 'A', 100);
    const result = processThrowX01([p], 0, 25, 1);
    expect(p.score).toBe(75);
    expect(result.pointsScored).toBe(25);
  });

  test('double Bull scores 50', () => {
    const p = createPlayerX01('1', 'A', 100);
    const result = processThrowX01([p], 0, 25, 2);
    expect(p.score).toBe(50);
    expect(result.pointsScored).toBe(50);
  });

  test('miss (target 0) returns miss=true', () => {
    const p = createPlayerX01('1', 'A', 501);
    const result = processThrowX01([p], 0, 0, 1);
    expect(result.miss).toBe(true);
    expect(p.score).toBe(501);
  });
});

describe('processThrowX01 – bust rules', () => {
  test('busts when score would go below 0', () => {
    const p = createPlayerX01('1', 'A', 10);
    const result = processThrowX01([p], 0, 20, 1); // would score -10
    expect(result.busted).toBe(true);
    expect(p.score).toBe(10); // no change
  });

  test('busts when hitting exactly 0 on a non-double', () => {
    const p = createPlayerX01('1', 'A', 20);
    const result = processThrowX01([p], 0, 20, 1); // single = not double
    expect(result.busted).toBe(true);
    expect(p.score).toBe(20);
  });

  test('wins when hitting exactly 0 on a double', () => {
    const p = createPlayerX01('1', 'A', 40);
    const result = processThrowX01([p], 0, 20, 2); // D20 = 40
    expect(result.busted).toBe(false);
    expect(result.won).toBe(true);
    expect(p.score).toBe(0);
  });

  test('wins with double Bull (50) at score 50', () => {
    const p = createPlayerX01('1', 'A', 50);
    const result = processThrowX01([p], 0, 25, 2);
    expect(result.won).toBe(true);
    expect(p.score).toBe(0);
  });
});

describe('checkWinConditionX01', () => {
  test('no winner when nobody is at 0', () => {
    const p1 = createPlayerX01('1', 'A', 100);
    const p2 = createPlayerX01('2', 'B', 50);
    expect(checkWinConditionX01([p1, p2])).toEqual({ gameOver: false, winnerId: null });
  });

  test('declares winner when a player reaches 0', () => {
    const p1 = createPlayerX01('1', 'A', 0);
    const p2 = createPlayerX01('2', 'B', 50);
    expect(checkWinConditionX01([p1, p2])).toEqual({ gameOver: true, winnerId: '1' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Around the World (ATW)
// ─────────────────────────────────────────────────────────────────────────────

describe('createPlayerATW', () => {
  test('creates a player starting at target index 0', () => {
    const p = createPlayerATW('id1', 'Alice');
    expect(p.targetIndex).toBe(0);
    expect(p.score).toBe(0);
  });
});

describe('processThrowATW', () => {
  test('advances target index when correct target is hit', () => {
    const p = createPlayerATW('1', 'A');
    const result = processThrowATW([p], 0, 1, 1); // first target is 1
    expect(result.hit).toBe(true);
    expect(p.targetIndex).toBe(1);
    expect(p.score).toBe(1);
  });

  test('misses when wrong target is thrown', () => {
    const p = createPlayerATW('1', 'A');
    const result = processThrowATW([p], 0, 2, 1); // needs 1 not 2
    expect(result.miss).toBe(true);
    expect(p.targetIndex).toBe(0);
  });

  test('any multiplier counts as a hit', () => {
    const p = createPlayerATW('1', 'A');
    processThrowATW([p], 0, 1, 3); // triple 1
    expect(p.targetIndex).toBe(1);
  });

  test('advances through multiple targets', () => {
    const p = createPlayerATW('1', 'A');
    // Hit 1, 2, 3 in order
    [1, 2, 3].forEach((t) => processThrowATW([p], 0, t, 1));
    expect(p.targetIndex).toBe(3);
    expect(p.score).toBe(3);
  });

  test('final target is Bull (25)', () => {
    const p = createPlayerATW('1', 'A');
    p.targetIndex = 20; // last index, ATW_TARGETS[20] === 25
    const result = processThrowATW([p], 0, 25, 1);
    expect(result.hit).toBe(true);
    expect(p.targetIndex).toBe(21);
  });
});

describe('checkWinConditionATW', () => {
  test('no winner when no player has finished', () => {
    const p1 = createPlayerATW('1', 'A');
    const p2 = createPlayerATW('2', 'B');
    p1.targetIndex = 15;
    expect(checkWinConditionATW([p1, p2])).toEqual({ gameOver: false, winnerId: null });
  });

  test('winner when a player completes all 21 targets', () => {
    const p1 = createPlayerATW('1', 'A');
    const p2 = createPlayerATW('2', 'B');
    p1.targetIndex = ATW_TARGETS.length; // all done
    expect(checkWinConditionATW([p1, p2])).toEqual({ gameOver: true, winnerId: '1' });
  });
});
