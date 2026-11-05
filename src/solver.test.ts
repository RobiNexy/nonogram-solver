import { describe, expect, it } from 'vitest';
import { analyzeLine, solvePuzzle, type CellState, type Puzzle } from './solver';

function cluesFor(bits: readonly boolean[]): number[] {
  const clues: number[] = [];
  let run = 0;
  for (const bit of bits) {
    if (bit) {
      run += 1;
    } else if (run > 0) {
      clues.push(run);
      run = 0;
    }
  }
  if (run > 0) {
    clues.push(run);
  }
  return clues;
}

function bitsForMask(mask: number, length: number): boolean[] {
  return Array.from({ length }, (_, index) => (mask & (1 << index)) !== 0);
}

function allClueSequences(length: number): readonly (readonly number[])[] {
  const clues = new Map<string, readonly number[]>();
  for (const bits of bitsForMaskRange(length)) {
    const sequence = cluesFor(bits);
    clues.set(sequence.join(','), sequence);
  }
  return [...clues.values()];
}

describe('analyzeLine', () => {
  it('matches brute-force projections for all short lines and partial assignments', () => {
    for (let length = 1; length <= 5; length += 1) {
      const distinctClues = new Map<string, readonly number[]>();
      for (let mask = 0; mask < 1 << length; mask += 1) {
        const clues = cluesFor(bitsForMask(mask, length));
        distinctClues.set(clues.join(','), clues);
      }

      const partialCount = 3 ** length;
      for (const clues of distinctClues.values()) {
        for (let partial = 0; partial < partialCount; partial += 1) {
          let remainder = partial;
          const current: CellState[] = Array.from({ length }, () => {
            const trit = remainder % 3;
            remainder = Math.floor(remainder / 3);
            if (trit === 0) return 'unknown';
            if (trit === 1) return 'empty';
            return 'filled';
          });

          const completions = [...bitsForMaskRange(length)]
            .filter((bits) => cluesFor(bits).join(',') === clues.join(','))
            .filter((bits) =>
              bits.every((bit, index) => {
                const assigned = current[index];
                return assigned === 'unknown' || (assigned === 'filled') === bit;
              }),
            );
          const actual = analyzeLine(clues, current);

          if (completions.length === 0) {
            expect(actual).toEqual({ status: 'impossible' });
          } else {
            expect(actual.status).toBe('possible');
            if (actual.status !== 'possible') {
              continue;
            }
            expect(actual.cells, `length=${length}, clues=${clues}, current=${current.join('/')}`)
              .toEqual(
              Array.from({ length }, (_, index) => ({
                canBeFilled: completions.some((bits) => bits[index] === true),
                canBeEmpty: completions.some((bits) => bits[index] === false),
              })),
            );
          }
        }
      }
    }
  });

  it('handles an empty clue as an all-empty line', () => {
    expect(analyzeLine([], ['unknown', 'unknown'])).toEqual({
      status: 'possible',
      cells: [
        { canBeFilled: false, canBeEmpty: true },
        { canBeFilled: false, canBeEmpty: true },
      ],
      flexibility: 1,
    });
  });
});

function* bitsForMaskRange(length: number): Generator<boolean[]> {
  for (let mask = 0; mask < 1 << length; mask += 1) {
    yield bitsForMask(mask, length);
  }
}

describe('solvePuzzle', () => {
  it('matches brute-force satisfiability for every 2×2 clue combination', () => {
    const lineClues = allClueSequences(2);
    for (const row0 of lineClues) {
      for (const row1 of lineClues) {
        for (const column0 of lineClues) {
          for (const column1 of lineClues) {
            const puzzle: Puzzle = {
              width: 2,
              height: 2,
              rowClues: [row0, row1],
              columnClues: [column0, column1],
            };
            const hasBruteForceSolution = Array.from({ length: 1 << 4 }, (_, mask) =>
              Array.from({ length: 2 }, (_, row) =>
                Array.from({ length: 2 }, (_, column) =>
                  (mask & (1 << (row * 2 + column))) !== 0,
                ),
              ),
            ).some(
              (grid) =>
                grid.every(
                  (row, index) =>
                    row !== undefined &&
                    JSON.stringify(cluesFor(row)) === JSON.stringify(puzzle.rowClues[index]),
                ) &&
                Array.from({ length: 2 }, (_, column) =>
                  cluesFor(grid.flatMap((row) => (row?.[column] === true ? [true] : [false]))),
                ).every(
                  (clues, index) =>
                    JSON.stringify(clues) === JSON.stringify(puzzle.columnClues[index]),
                ),
            );
            const actual = solvePuzzle(puzzle);
            expect(actual.status, JSON.stringify(puzzle)).toBe(
              hasBruteForceSolution ? 'solved' : 'unsatisfiable',
            );
          }
        }
      }
    }
  });

  it('solves the bundled 5×5 sample', () => {
    const sample: Puzzle = {
      width: 5,
      height: 5,
      rowClues: [[1], [3], [5], [3], [1]],
      columnClues: [[1], [3], [5], [3], [1]],
    };
    const result = solvePuzzle(sample);
    expect(result.status).toBe('solved');
    if (result.status !== 'solved') return;
    expect(result.grid.map((row) => row.map((cell) => cell === 'filled'))).toEqual([
      [false, false, true, false, false],
      [false, true, true, true, false],
      [true, true, true, true, true],
      [false, true, true, true, false],
      [false, false, true, false, false],
    ]);
  });

  it('reports a root contradiction as unsatisfiable', () => {
    const contradiction: Puzzle = {
      width: 1,
      height: 1,
      rowClues: [[1]],
      columnClues: [[]],
    };
    expect(solvePuzzle(contradiction).status).toBe('unsatisfiable');
  });

  it('finds one solution in a puzzle with multiple solutions', () => {
    const ambiguous: Puzzle = {
      width: 2,
      height: 2,
      rowClues: [[1], [1]],
      columnClues: [[1], [1]],
    };
    expect(solvePuzzle(ambiguous).status).toBe('solved');
  });

  it('distinguishes a search limit from an unsatisfiable puzzle', () => {
    const ambiguous: Puzzle = {
      width: 2,
      height: 2,
      rowClues: [[1], [1]],
      columnClues: [[1], [1]],
    };
    expect(solvePuzzle(ambiguous, 1).status).toBe('search-limit');
  });

  it('solves a fully filled 60×60 board', () => {
    const clues = Array.from({ length: 60 }, () => [60]);
    const result = solvePuzzle({
      width: 60,
      height: 60,
      rowClues: clues,
      columnClues: clues,
    });
    expect(result.status).toBe('solved');
    if (result.status !== 'solved') return;
    expect(result.grid).toHaveLength(60);
    expect(result.grid.every((row) => row.length === 60 && row.every((cell) => cell === 'filled')))
      .toBe(true);
  });

  it('solves a 60×60 permutation puzzle with constrained branching', () => {
    const clues = Array.from({ length: 60 }, () => [1]);
    const result = solvePuzzle({
      width: 60,
      height: 60,
      rowClues: clues,
      columnClues: clues,
    });
    expect(result.status).toBe('solved');
    if (result.status !== 'solved') return;
    expect(result.visitedNodes).toBeLessThanOrEqual(60);
  });

  it('rejects dimensions above 60', () => {
    expect(
      solvePuzzle({ width: 61, height: 1, rowClues: [[]], columnClues: Array.from({ length: 61 }, () => []) }),
    ).toMatchObject({ status: 'invalid-puzzle' });
  });
});
