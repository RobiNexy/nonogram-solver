export type CellState = 'unknown' | 'filled' | 'empty';

export interface Puzzle {
  readonly width: number;
  readonly height: number;
  readonly rowClues: readonly (readonly number[])[];
  readonly columnClues: readonly (readonly number[])[];
}

export interface CellSupport {
  readonly canBeFilled: boolean;
  readonly canBeEmpty: boolean;
}

export type LineAnalysis =
  | { readonly status: 'impossible' }
  | {
      readonly status: 'possible';
      readonly cells: readonly CellSupport[];
      /** Sum of viable block starts; this is a branching heuristic, not a solution count. */
      readonly flexibility: number;
    };

export type SolveResult =
  | {
      readonly status: 'solved';
      readonly grid: readonly (readonly CellState[])[];
      readonly visitedNodes: number;
    }
  | { readonly status: 'unsatisfiable'; readonly visitedNodes: number }
  | { readonly status: 'search-limit'; readonly visitedNodes: number }
  | { readonly status: 'invalid-puzzle'; readonly message: string };

export const MAX_PUZZLE_DIMENSION = 60;
const DEFAULT_NODE_LIMIT = 100_000;

/**
 * Computes the projection of all clue-compatible strings onto each cell.
 * It uses forward and backward feasibility over legal block start positions,
 * rather than enumerating complete line patterns.
 */
export function analyzeLine(
  clues: readonly number[],
  current: readonly CellState[],
): LineAnalysis {
  const length = current.length;
  const blockCount = clues.length;

  if (
    clues.some((clue) => !Number.isSafeInteger(clue) || clue < 1) ||
    clues.reduce((sum, clue) => sum + clue, Math.max(0, blockCount - 1)) > length
  ) {
    return { status: 'impossible' };
  }

  if (blockCount === 0) {
    if (current.some((cell) => cell === 'filled')) {
      return { status: 'impossible' };
    }

    return {
      status: 'possible',
      cells: current.map(() => ({ canBeFilled: false, canBeEmpty: true })),
      flexibility: 1,
    };
  }

  const lastFilledBefore = new Array<number>(length + 1).fill(-1);
  const firstFilledAtOrAfter = new Array<number>(length + 1).fill(length);
  const emptyPrefix = new Array<number>(length + 1).fill(0);

  for (let position = 0; position < length; position += 1) {
    const cell = current[position];
    const priorLast = lastFilledBefore[position];
    const priorEmptyCount = emptyPrefix[position];

    lastFilledBefore[position + 1] =
      cell === 'filled' ? position : (priorLast ?? -1);
    emptyPrefix[position + 1] =
      (priorEmptyCount ?? 0) + (cell === 'empty' ? 1 : 0);
  }

  for (let position = length - 1; position >= 0; position -= 1) {
    const cell = current[position];
    const nextFilled = firstFilledAtOrAfter[position + 1];
    firstFilledAtOrAfter[position] =
      cell === 'filled' ? position : (nextFilled ?? length);
  }

  const candidates: boolean[][] = [];
  for (let block = 0; block < blockCount; block += 1) {
    const clue = clues[block];
    if (clue === undefined) {
      return { status: 'impossible' };
    }

    const starts = new Array<boolean>(length).fill(false);
    for (let start = 0; start + clue <= length; start += 1) {
      const emptyBefore = emptyPrefix[start] ?? 0;
      const emptyAfter = emptyPrefix[start + clue] ?? 0;
      starts[start] = emptyAfter === emptyBefore;
    }
    candidates.push(starts);
  }

  const forward: boolean[][] = [];
  for (let block = 0; block < blockCount; block += 1) {
    const clue = clues[block];
    const starts = candidates[block];
    if (clue === undefined || starts === undefined) {
      return { status: 'impossible' };
    }

    const reachable = new Array<boolean>(length).fill(false);
    const priorClue = block > 0 ? clues[block - 1] : undefined;
    const priorReachable = block > 0 ? forward[block - 1] : undefined;
    const endCounts = new Array<number>(length + 1).fill(0);

    if (priorClue !== undefined && priorReachable !== undefined) {
      for (let start = 0; start < length; start += 1) {
        if (priorReachable[start] === true) {
          const end = start + priorClue;
          endCounts[end] = (endCounts[end] ?? 0) + 1;
        }
      }
    }

    const endPrefix = new Array<number>(length + 2).fill(0);
    for (let end = 0; end <= length; end += 1) {
      endPrefix[end + 1] =
        (endPrefix[end] ?? 0) + (endCounts[end] ?? 0);
    }

    for (let start = 0; start < length; start += 1) {
      if (starts[start] !== true) {
        continue;
      }

      if (block === 0) {
        reachable[start] = lastFilledBefore[start] === -1;
        continue;
      }

      const lastFilled = lastFilledBefore[start] ?? -1;
      const firstAllowedEnd = lastFilled + 1;
      const lastAllowedEnd = start - 1;
      if (firstAllowedEnd <= lastAllowedEnd) {
        const count =
          (endPrefix[lastAllowedEnd + 1] ?? 0) -
          (endPrefix[firstAllowedEnd] ?? 0);
        reachable[start] = count > 0;
      }
    }

    forward.push(reachable);
  }

  const backward: boolean[][] = new Array<boolean[]>(blockCount);
  for (let block = blockCount - 1; block >= 0; block -= 1) {
    const clue = clues[block];
    const starts = candidates[block];
    if (clue === undefined || starts === undefined) {
      return { status: 'impossible' };
    }

    const reachable = new Array<boolean>(length).fill(false);
    const nextStarts = block + 1 < blockCount ? backward[block + 1] : undefined;
    const nextClue = block + 1 < blockCount ? clues[block + 1] : undefined;
    const nextCounts = new Array<number>(length + 1).fill(0);

    if (nextStarts !== undefined) {
      for (let start = 0; start < length; start += 1) {
        if (nextStarts[start] === true) {
          nextCounts[start] = (nextCounts[start] ?? 0) + 1;
        }
      }
    }

    const nextPrefix = new Array<number>(length + 2).fill(0);
    for (let start = 0; start <= length; start += 1) {
      nextPrefix[start + 1] =
        (nextPrefix[start] ?? 0) + (nextCounts[start] ?? 0);
    }

    for (let start = 0; start < length; start += 1) {
      if (starts[start] !== true) {
        continue;
      }

      const end = start + clue;
      if (nextStarts === undefined || nextClue === undefined) {
        reachable[start] = firstFilledAtOrAfter[end] === length;
        continue;
      }

      const firstFilled = firstFilledAtOrAfter[end] ?? length;
      const firstAllowedNextStart = end + 1;
      const lastAllowedNextStart = Math.min(firstFilled, length - 1);
      if (firstAllowedNextStart <= lastAllowedNextStart) {
        const count =
          (nextPrefix[lastAllowedNextStart + 1] ?? 0) -
          (nextPrefix[firstAllowedNextStart] ?? 0);
        reachable[start] = count > 0;
      }
    }

    backward[block] = reachable;
  }

  const viable = candidates.map((starts, block) =>
    starts.map(
      (isCandidate, start) =>
        isCandidate && forward[block]?.[start] === true && backward[block]?.[start] === true,
    ),
  );
  const hasSolution = viable.some((starts) => starts.some((isViable) => isViable));
  if (!hasSolution) {
    return { status: 'impossible' };
  }

  const filledCoverage = new Array<number>(length + 1).fill(0);
  const emptyCoverage = new Array<number>(length + 1).fill(0);
  let flexibility = 0;
  const addRange = (coverage: number[], from: number, through: number): void => {
    if (from > through || from < 0 || through >= length) {
      return;
    }
    coverage[from] = (coverage[from] ?? 0) + 1;
    coverage[through + 1] = (coverage[through + 1] ?? 0) - 1;
  };

  for (let block = 0; block < blockCount; block += 1) {
    const clue = clues[block];
    const starts = viable[block];
    if (clue === undefined || starts === undefined) {
      return { status: 'impossible' };
    }

    for (let start = 0; start < length; start += 1) {
      if (starts[start] === true) {
        flexibility += 1;
        addRange(filledCoverage, start, start + clue - 1);
      }
    }
  }

  const firstBlockStarts = viable[0];
  if (firstBlockStarts !== undefined) {
    for (let start = 0; start < length; start += 1) {
      if (firstBlockStarts[start] === true) {
        addRange(emptyCoverage, 0, start - 1);
      }
    }
  }

  const lastBlockIndex = blockCount - 1;
  const lastBlockClue = clues[lastBlockIndex];
  const lastBlockStarts = viable[lastBlockIndex];
  if (lastBlockClue !== undefined && lastBlockStarts !== undefined) {
    for (let start = 0; start < length; start += 1) {
      if (lastBlockStarts[start] === true) {
        addRange(emptyCoverage, start + lastBlockClue, length - 1);
      }
    }
  }

  for (let block = 0; block + 1 < blockCount; block += 1) {
    const clue = clues[block];
    const forwardStarts = forward[block];
    const nextBackwardStarts = backward[block + 1];
    const nextClue = clues[block + 1];
    if (
      clue === undefined ||
      forwardStarts === undefined ||
      nextBackwardStarts === undefined ||
      nextClue === undefined
    ) {
      return { status: 'impossible' };
    }

    const lastViableNextStartAtOrBefore = new Array<number>(length).fill(-1);
    let mostRecent = -1;
    for (let position = 0; position < length; position += 1) {
      if (nextBackwardStarts[position] === true) {
        mostRecent = position;
      }
      lastViableNextStartAtOrBefore[position] = mostRecent;
    }

    for (let start = 0; start < length; start += 1) {
      if (forwardStarts[start] !== true) {
        continue;
      }

      const end = start + clue;
      const firstFilled = firstFilledAtOrAfter[end] ?? length;
      const firstAllowedNextStart = end + 1;
      const lastAllowedNextStart = Math.min(firstFilled, length - 1);
      if (firstAllowedNextStart > lastAllowedNextStart) {
        continue;
      }

      const nextStart = lastViableNextStartAtOrBefore[lastAllowedNextStart] ?? -1;
      if (nextStart >= firstAllowedNextStart) {
        addRange(emptyCoverage, end, nextStart - 1);
      }
    }
  }

  let filledCount = 0;
  let emptyCount = 0;
  const cells: CellSupport[] = [];
  for (let position = 0; position < length; position += 1) {
    filledCount += filledCoverage[position] ?? 0;
    emptyCount += emptyCoverage[position] ?? 0;
    const canBeFilled = filledCount > 0;
    const canBeEmpty = emptyCount > 0;
    if (!canBeFilled && !canBeEmpty) {
      return { status: 'impossible' };
    }
    cells.push({ canBeFilled, canBeEmpty });
  }

  return { status: 'possible', cells, flexibility: Math.max(1, flexibility) };
}

export function solvePuzzle(
  puzzle: Puzzle,
  nodeLimit = DEFAULT_NODE_LIMIT,
): SolveResult {
  const invalidMessage = validatePuzzle(puzzle);
  if (invalidMessage !== null) {
    return { status: 'invalid-puzzle', message: invalidMessage };
  }

  if (!Number.isSafeInteger(nodeLimit) || nodeLimit < 1) {
    return {
      status: 'invalid-puzzle',
      message: '搜索节点上限必须是正整数。',
    };
  }

  let visitedNodes = 0;
  const initialGrid = Array.from({ length: puzzle.height }, () =>
    Array<CellState>(puzzle.width).fill('unknown'),
  );

  const search = (
    grid: CellState[][],
  ):
    | { readonly status: 'solved'; readonly grid: CellState[][] }
    | { readonly status: 'unsatisfiable' }
    | { readonly status: 'search-limit' } => {
    if (visitedNodes >= nodeLimit) {
      return { status: 'search-limit' };
    }
    visitedNodes += 1;

    const propagation = propagate(grid, puzzle);
    if (propagation === null) {
      return { status: 'unsatisfiable' };
    }

    let branchRow = -1;
    let branchColumn = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let row = 0; row < puzzle.height; row += 1) {
      for (let column = 0; column < puzzle.width; column += 1) {
        if (grid[row]?.[column] === 'unknown') {
          const rowFlexibility = propagation.rowFlexibilities[row] ?? 1;
          const columnFlexibility = propagation.columnFlexibilities[column] ?? 1;
          const score = rowFlexibility * columnFlexibility;
          if (score < bestScore) {
            bestScore = score;
            branchRow = row;
            branchColumn = column;
          }
        }
      }
    }

    if (branchRow === -1 || branchColumn === -1) {
      return { status: 'solved', grid };
    }

    for (const assumption of ['filled', 'empty'] as const) {
      const branch = grid.map((line) => [...line]);
      const branchLine = branch[branchRow];
      if (branchLine === undefined) {
        return { status: 'unsatisfiable' };
      }
      branchLine[branchColumn] = assumption;

      const result = search(branch);
      if (result.status !== 'unsatisfiable') {
        return result;
      }
    }

    return { status: 'unsatisfiable' };
  };

  const result = search(initialGrid);
  switch (result.status) {
    case 'solved':
      return {
        status: 'solved',
        grid: result.grid,
        visitedNodes,
      };
    case 'unsatisfiable':
      return { status: 'unsatisfiable', visitedNodes };
    case 'search-limit':
      return { status: 'search-limit', visitedNodes };
  }
}

function validatePuzzle(puzzle: Puzzle): string | null {
  if (
    !Number.isSafeInteger(puzzle.width) ||
    !Number.isSafeInteger(puzzle.height) ||
    puzzle.width < 1 ||
    puzzle.height < 1 ||
    puzzle.width > MAX_PUZZLE_DIMENSION ||
    puzzle.height > MAX_PUZZLE_DIMENSION
  ) {
    return `棋盘宽高必须是 1–${MAX_PUZZLE_DIMENSION} 之间的整数。`;
  }
  if (puzzle.rowClues.length !== puzzle.height) {
    return '行线索数量必须与棋盘高度相同。';
  }
  if (puzzle.columnClues.length !== puzzle.width) {
    return '列线索数量必须与棋盘宽度相同。';
  }
  if (puzzle.rowClues.some((clues) => !validClues(clues))) {
    return '行线索必须是正整数。';
  }
  if (puzzle.columnClues.some((clues) => !validClues(clues))) {
    return '列线索必须是正整数。';
  }
  return null;
}

function validClues(clues: readonly number[]): boolean {
  return clues.every((clue) => Number.isSafeInteger(clue) && clue > 0);
}

interface PropagationSummary {
  readonly rowFlexibilities: readonly number[];
  readonly columnFlexibilities: readonly number[];
}

function propagate(grid: CellState[][], puzzle: Puzzle): PropagationSummary | null {
  const lineCount = puzzle.height + puzzle.width;
  const queue: number[] = [];
  const queued = new Array<boolean>(lineCount).fill(false);
  const rowFlexibilities = new Array<number>(puzzle.height).fill(1);
  const columnFlexibilities = new Array<number>(puzzle.width).fill(1);

  const enqueue = (lineID: number): void => {
    if (queued[lineID] !== true) {
      queued[lineID] = true;
      queue.push(lineID);
    }
  };

  for (let row = 0; row < puzzle.height; row += 1) {
    enqueue(row);
  }
  for (let column = 0; column < puzzle.width; column += 1) {
    enqueue(puzzle.height + column);
  }

  let queueHead = 0;
  while (queueHead < queue.length) {
    const lineID = queue[queueHead];
    queueHead += 1;
    if (lineID === undefined) {
      return null;
    }
    queued[lineID] = false;

    if (lineID < puzzle.height) {
      const row = lineID;
      const line = grid[row];
      const clues = puzzle.rowClues[row];
      if (line === undefined || clues === undefined) {
        return null;
      }
      const analysis = analyzeLine(clues, line);
      if (analysis.status === 'impossible') {
        return null;
      }
      rowFlexibilities[row] = analysis.flexibility;

      for (let column = 0; column < puzzle.width; column += 1) {
        const cell = line[column];
        const support = analysis.cells[column];
        if (cell === undefined || support === undefined) {
          return null;
        }
        if (!support.canBeFilled && cell === 'filled') {
          return null;
        }
        if (!support.canBeEmpty && cell === 'empty') {
          return null;
        }
        if (cell === 'unknown') {
          if (!support.canBeFilled) {
            line[column] = 'empty';
            enqueue(puzzle.height + column);
          } else if (!support.canBeEmpty) {
            line[column] = 'filled';
            enqueue(puzzle.height + column);
          }
        }
      }
      continue;
    }

    const column = lineID - puzzle.height;
    const line: CellState[] = [];
    for (let row = 0; row < puzzle.height; row += 1) {
      const cell = grid[row]?.[column];
      if (cell === undefined) {
        return null;
      }
      line.push(cell);
    }

    const clues = puzzle.columnClues[column];
    if (clues === undefined) {
      return null;
    }
    const analysis = analyzeLine(clues, line);
    if (analysis.status === 'impossible') {
      return null;
    }
    columnFlexibilities[column] = analysis.flexibility;

    for (let row = 0; row < puzzle.height; row += 1) {
      const cell = grid[row]?.[column];
      const support = analysis.cells[row];
      if (cell === undefined || support === undefined) {
        return null;
      }
      if (!support.canBeFilled && cell === 'filled') {
        return null;
      }
      if (!support.canBeEmpty && cell === 'empty') {
        return null;
      }
      if (cell === 'unknown') {
        const targetRow = grid[row];
        if (targetRow === undefined) {
          return null;
        }
        if (!support.canBeFilled) {
          targetRow[column] = 'empty';
          enqueue(row);
        } else if (!support.canBeEmpty) {
          targetRow[column] = 'filled';
          enqueue(row);
        }
      }
    }
  }

  return { rowFlexibilities, columnFlexibilities };
}
