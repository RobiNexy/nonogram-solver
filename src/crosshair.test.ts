import { describe, expect, it } from 'vitest';
import { getCrosshairInfo } from './crosshair';
import type { CellState } from './solver';

describe('getCrosshairInfo', () => {
  const grid: readonly (readonly CellState[])[] = [
    ['empty', 'empty', 'filled', 'empty', 'empty'],
    ['empty', 'filled', 'filled', 'filled', 'empty'],
    ['filled', 'empty', 'filled', 'empty', 'filled'],
    ['empty', 'empty', 'empty', 'empty', 'empty'],
  ];

  it('counts the horizontal and vertical runs through the hovered cell', () => {
    expect(getCrosshairInfo(grid, 1, 2)).toEqual({
      row: 1,
      column: 2,
      horizontal: { start: 1, end: 3, count: 3 },
      vertical: { start: 0, end: 2, count: 3 },
    });
  });

  it('stops at empty cells and handles a single-cell run', () => {
    expect(getCrosshairInfo(grid, 2, 0)).toEqual({
      row: 2,
      column: 0,
      horizontal: { start: 0, end: 0, count: 1 },
      vertical: { start: 2, end: 2, count: 1 },
    });
  });

  it('does not show a crosshair for a non-black cell', () => {
    expect(getCrosshairInfo(grid, 1, 0)).toBeNull();
  });
});
