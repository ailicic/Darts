const {
  TARGETS,
  createPlayer,
  processThrow,
  checkWinCondition,
  isClosed,
  isTargetClosedByAll,
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
