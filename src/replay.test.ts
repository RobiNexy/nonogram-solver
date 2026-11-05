import { describe, expect, it } from 'vitest';

import { SolveReplay } from './replay';
import { solvePuzzle, type CellState, type Puzzle } from './solver';

function cluesOf(line: readonly boolean[]): number[] {
  const clues: number[] = [];
  let run = 0;
  for (const filled of line) {
    if (filled) {
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

function puzzleFromPattern(pattern: readonly (readonly boolean[])[]): Puzzle {
  const height = pattern.length;
  const width = pattern[0]?.length ?? 0;
  const columns = Array.from({ length: width }, (_, column) =>
    pattern.map((row) => row[column] === true),
  );
  return {
    width,
    height,
    rowClues: pattern.map((row) => cluesOf(row)),
    columnClues: columns.map((column) => cluesOf(column)),
  };
}

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

describe('SolveReplay', () => {
  it('replays a solved trace to the solver grid', () => {
    const random = seededRandom(7);
    for (let trial = 0; trial < 30; trial += 1) {
      const pattern = Array.from({ length: 6 }, () =>
        Array.from({ length: 6 }, () => random() < 0.5),
      );
      const result = solvePuzzle(puzzleFromPattern(pattern));
      expect(result.status).toBe('solved');
      if (result.status !== 'solved') {
        continue;
      }
      expect(result.trace.complete).toBe(true);

      const replay = new SolveReplay(6, 6, result.trace.steps);
      replay.finish();
      expect(replay.grid).toEqual(result.grid);
    }
  });

  it('records guesses and clears them after an unsatisfiable search', () => {
    const puzzle: Puzzle = {
      width: 2,
      height: 2,
      rowClues: [[2], [2]],
      columnClues: [[1], [1]],
    };
    const result = solvePuzzle(puzzle);
    expect(result.status).toBe('unsatisfiable');
    if (result.status !== 'unsatisfiable') {
      return;
    }

    const replay = new SolveReplay(2, 2, result.trace.steps);
    replay.finish();
    const cells = replay.grid.flat() as CellState[];
    expect(cells.every((cell) => cell === 'unknown')).toBe(true);
    expect(replay.guess.flat().some((isGuess) => isGuess)).toBe(false);
  });

  it('advances incrementally and reports progress', () => {
    const result = solvePuzzle({
      width: 2,
      height: 2,
      rowClues: [[1], [1]],
      columnClues: [[1], [1]],
    });
    expect(result.status).toBe('solved');
    if (result.status !== 'solved') {
      return;
    }

    const replay = new SolveReplay(2, 2, result.trace.steps);
    expect(replay.progress).toBe(0);
    replay.advance(1);
    expect(replay.latest).not.toBeNull();
    replay.finish();
    expect(replay.done).toBe(true);
    expect(replay.progress).toBe(1);
    replay.restart();
    expect(replay.done).toBe(false);
    expect(replay.grid.flat().every((cell) => cell === 'unknown')).toBe(true);
  });
});
