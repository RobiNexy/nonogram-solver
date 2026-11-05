import { MAX_PUZZLE_DIMENSION, type Puzzle } from './solver';

export type WebsitePuzzleParseResult =
  | { readonly status: 'success'; readonly puzzle: Puzzle }
  | { readonly status: 'failure'; readonly message: string };

type Axis = 'row' | 'col';

interface ClueGroup {
  readonly index: number;
  readonly clues: readonly number[];
}

/** Parses the task-group clue markup used by the source nonogram website. */
export function parseWebsitePuzzleHtml(html: string): WebsitePuzzleParseResult {
  if (html.trim() === '') {
    return { status: 'failure', message: '请先粘贴题目页面的 HTML。' };
  }

  const document = new DOMParser().parseFromString(html, 'text/html');
  const rows = extractGroups(document, 'row');
  if (rows.status === 'failure') {
    return rows;
  }
  const columns = extractGroups(document, 'col');
  if (columns.status === 'failure') {
    return columns;
  }

  if (rows.groups.length === 0 || columns.groups.length === 0) {
    return {
      status: 'failure',
      message: '没有找到完整的行列线索。请复制包含 task-row-N 和 task-col-N 的题目 HTML。',
    };
  }

  if (
    rows.groups.length > MAX_PUZZLE_DIMENSION ||
    columns.groups.length > MAX_PUZZLE_DIMENSION
  ) {
    return {
      status: 'failure',
      message: `题目尺寸超过当前上限 ${MAX_PUZZLE_DIMENSION}×${MAX_PUZZLE_DIMENSION}。`,
    };
  }

  const rowClues = rows.groups.map((group) => group.clues);
  const columnClues = columns.groups.map((group) => group.clues);
  const height = rowClues.length;
  const width = columnClues.length;

  for (let row = 0; row < height; row += 1) {
    const clues = rowClues[row];
    if (clues === undefined || minimumLineLength(clues) > width) {
      return {
        status: 'failure',
        message: `第 ${row + 1} 行线索长度超过棋盘宽度，HTML 可能不完整。`,
      };
    }
  }
  for (let column = 0; column < width; column += 1) {
    const clues = columnClues[column];
    if (clues === undefined || minimumLineLength(clues) > height) {
      return {
        status: 'failure',
        message: `第 ${column + 1} 列线索长度超过棋盘高度，HTML 可能不完整。`,
      };
    }
  }

  return {
    status: 'success',
    puzzle: { width, height, rowClues, columnClues },
  };
}

function extractGroups(
  document: Document,
  axis: Axis,
): { readonly status: 'success'; readonly groups: readonly ClueGroup[] } | {
  readonly status: 'failure';
  readonly message: string;
} {
  const groupsByIndex = new Map<number, readonly number[]>();
  const classPattern = new RegExp(`^task-${axis}-(\\d+)$`, 'u');

  for (const group of document.querySelectorAll<HTMLElement>('.task-group')) {
    const matchingClass = Array.from(group.classList).find((className) =>
      classPattern.test(className),
    );
    if (matchingClass === undefined) {
      continue;
    }

    const match = classPattern.exec(matchingClass);
    const indexText = match?.[1];
    const index = indexText === undefined ? Number.NaN : Number(indexText);
    if (!Number.isSafeInteger(index) || index < 0) {
      return {
        status: 'failure',
        message: `发现无法识别的 ${axis === 'row' ? '行' : '列'}线索编号。`,
      };
    }
    if (groupsByIndex.has(index)) {
      return {
        status: 'failure',
        message: `发现重复的 ${axis === 'row' ? '行' : '列'}线索编号 ${index}。`,
      };
    }

    const clues: number[] = [];
    for (const clueCell of group.querySelectorAll('.task-cell.selectable')) {
      const text = clueCell.textContent?.trim() ?? '';
      if (text === '') {
        continue;
      }
      if (!/^\d+$/u.test(text)) {
        return {
          status: 'failure',
          message: `${axis === 'row' ? '行' : '列'} ${index + 1} 中出现非数字线索“${text}”。`,
        };
      }

      const value = Number(text);
      if (!Number.isSafeInteger(value) || value < 1) {
        return {
          status: 'failure',
          message: `${axis === 'row' ? '行' : '列'} ${index + 1} 中出现无效线索。`,
        };
      }
      clues.push(value);
    }
    groupsByIndex.set(index, clues);
  }

  const orderedGroups: ClueGroup[] = [];
  for (let index = 0; index < groupsByIndex.size; index += 1) {
    const clues = groupsByIndex.get(index);
    if (clues === undefined) {
      return {
        status: 'failure',
        message: `${axis === 'row' ? '行' : '列'}线索编号不连续（缺少 ${index}）。`,
      };
    }
    orderedGroups.push({ index, clues });
  }

  return { status: 'success', groups: orderedGroups };
}

function minimumLineLength(clues: readonly number[]): number {
  return clues.reduce((sum, clue) => sum + clue, Math.max(0, clues.length - 1));
}
