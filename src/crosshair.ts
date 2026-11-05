import type { CellState } from './solver';

export interface HoveredCell {
  readonly row: number;
  readonly column: number;
}

export interface RunSpan {
  readonly start: number;
  readonly end: number;
  readonly count: number;
}

export interface CrosshairInfo extends HoveredCell {
  readonly horizontal: RunSpan;
  readonly vertical: RunSpan;
}

export function getCrosshairInfo(
  grid: readonly (readonly CellState[])[],
  row: number,
  column: number,
): CrosshairInfo | null {
  if (grid[row]?.[column] !== 'filled') {
    return null;
  }

  let firstColumn = column;
  while (firstColumn > 0 && grid[row]?.[firstColumn - 1] === 'filled') {
    firstColumn -= 1;
  }
  let lastColumn = column;
  while (grid[row]?.[lastColumn + 1] === 'filled') {
    lastColumn += 1;
  }

  let firstRow = row;
  while (firstRow > 0 && grid[firstRow - 1]?.[column] === 'filled') {
    firstRow -= 1;
  }
  let lastRow = row;
  while (grid[lastRow + 1]?.[column] === 'filled') {
    lastRow += 1;
  }

  return {
    row,
    column,
    horizontal: {
      start: firstColumn,
      end: lastColumn,
      count: lastColumn - firstColumn + 1,
    },
    vertical: {
      start: firstRow,
      end: lastRow,
      count: lastRow - firstRow + 1,
    },
  };
}
