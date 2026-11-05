import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  MAX_PUZZLE_DIMENSION,
  solvePuzzle,
  type CellState,
  type Puzzle,
} from './solver';
import {
  getCrosshairInfo,
  type CrosshairInfo,
  type HoveredCell,
} from './crosshair';
import { parseWebsitePuzzleHtml } from './website-import';
import { SolveReplay } from './replay';
import './App.css';

const SAMPLE_CLUES = ['1', '3', '5', '3', '1'] as const;
const MIN_DIMENSION = 1;
const CLUE_LINE_HEIGHT = 1.15;
const BOARD_PADDING = 24;
const MAX_CELL_SIZE = 72;
const TOOLTIP_WIDTH = 116;
const PLAYBACK_INTERVAL_MS = 50;
const PLAYBACK_TICKS = 120;

type SolveMessage =
  | { readonly kind: 'solved'; readonly nodes: number }
  | { readonly kind: 'unsatisfiable'; readonly nodes: number }
  | { readonly kind: 'search-limit'; readonly nodes: number }
  | { readonly kind: 'invalid'; readonly text: string };

interface ParsedClues {
  readonly values: readonly number[];
  readonly error: string | null;
}

interface BoardMetrics {
  readonly cellSize: number;
  readonly columnHeaderHeight: number;
  readonly clueFontSize: number;
  readonly rowClueWidth: number;
}

interface ImportFeedback {
  readonly kind: 'success' | 'error';
  readonly text: string;
}

const INITIAL_BOARD_METRICS: BoardMetrics = {
  cellSize: 32,
  columnHeaderHeight: 24,
  clueFontSize: 10,
  rowClueWidth: 64,
};

function makeClues(count: number, initial: readonly string[] = []): string[] {
  return Array.from({ length: count }, (_, index) => initial[index] ?? '');
}

function parseClue(text: string): ParsedClues {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { values: [], error: null };
  }
  if (!/^\d+(?:[\s,，]+\d+)*$/u.test(trimmed)) {
    return { values: [], error: '请用空格、英文逗号或中文逗号分隔正整数。' };
  }

  const values = trimmed.split(/[\s,，]+/u).map((value) => Number(value));
  if (values.some((value) => !Number.isSafeInteger(value) || value < 1)) {
    return { values: [], error: '每个线索都必须是正整数。' };
  }
  return { values, error: null };
}

function cluesToPuzzle(
  width: number,
  height: number,
  rowInputs: readonly string[],
  columnInputs: readonly string[],
): { readonly puzzle: Puzzle | null; readonly error: string | null } {
  const parsedRows = rowInputs.map(parseClue);
  const parsedColumns = columnInputs.map(parseClue);
  const firstError = [...parsedRows, ...parsedColumns].find((entry) => entry.error !== null);
  if (firstError !== undefined) {
    return { puzzle: null, error: firstError.error };
  }
  return {
    puzzle: {
      width,
      height,
      rowClues: parsedRows.map((entry) => entry.values),
      columnClues: parsedColumns.map((entry) => entry.values),
    },
    error: null,
  };
}

function clueLengthError(clues: readonly number[], lineLength: number): string | null {
  const required = clues.reduce((sum, clue) => sum + clue, Math.max(0, clues.length - 1));
  return required > lineLength
    ? `线索至少需要 ${required} 格，但棋盘只有 ${lineLength} 格。`
    : null;
}

function cluePartCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 1 : trimmed.split(/[\s,，]+/u).length;
}

function toStackedClue(text: string): string {
  return text.replace(/[\s,，]+/gu, '\n');
}

export default function App() {
  const [width, setWidth] = useState(5);
  const [height, setHeight] = useState(5);
  const [rowInputs, setRowInputs] = useState<string[]>(() => makeClues(5, SAMPLE_CLUES));
  const [columnInputs, setColumnInputs] = useState<string[]>(() =>
    makeClues(5, SAMPLE_CLUES),
  );
  const [solution, setSolution] = useState<readonly (readonly CellState[])[] | null>(null);
  const [message, setMessage] = useState<SolveMessage | null>(null);
  const [websiteHtml, setWebsiteHtml] = useState('');
  const [importFeedback, setImportFeedback] = useState<ImportFeedback | null>(null);
  const [hoveredCell, setHoveredCell] = useState<HoveredCell | null>(null);
  const [solveCount, setSolveCount] = useState(0);
  const [replay, setReplay] = useState<SolveReplay | null>(null);
  const [playing, setPlaying] = useState(false);
  const [, setReplayTick] = useState(0);
  const boardAreaRef = useRef<HTMLDivElement>(null);
  const [boardMetrics, setBoardMetrics] = useState<BoardMetrics>(INITIAL_BOARD_METRICS);
  const maxColumnClueParts = Math.min(
    Math.ceil(height / 2),
    Math.max(1, ...columnInputs.map(cluePartCount)),
  );

  useLayoutEffect(() => {
    const area = boardAreaRef.current;
    if (area === null) {
      return;
    }

    const measure = (): void => {
      const frameWidth = area.clientWidth - BOARD_PADDING * 2;
      const frameHeight = area.clientHeight - BOARD_PADDING * 2;
      const rowClueWidth = width >= 40 ? 42 : width >= 20 ? 50 : 64;
      const widthLimit = Math.max(2, (frameWidth - rowClueWidth - 2) / width);
      const heightBudget = Math.max(80, frameHeight);
      const clueFontFor = (size: number): number => Math.max(3, Math.min(10, size * 0.58));
      const headerFor = (size: number): number =>
        Math.max(14, maxColumnClueParts * clueFontFor(size) * CLUE_LINE_HEIGHT + 6);

      let cellSize = Math.min(MAX_CELL_SIZE, widthLimit, heightBudget / height);
      for (let iteration = 0; iteration < 3; iteration += 1) {
        cellSize = Math.min(MAX_CELL_SIZE, widthLimit, (heightBudget - headerFor(cellSize)) / height);
      }

      cellSize = Math.max(2, cellSize);
      const clueFontSize = clueFontFor(cellSize);
      const columnHeaderHeight = headerFor(cellSize);

      setBoardMetrics((current) => {
        if (
          Math.abs(current.cellSize - cellSize) < 0.25 &&
          Math.abs(current.columnHeaderHeight - columnHeaderHeight) < 0.5 &&
          Math.abs(current.clueFontSize - clueFontSize) < 0.25 &&
          current.rowClueWidth === rowClueWidth
        ) {
          return current;
        }
        return { cellSize, columnHeaderHeight, clueFontSize, rowClueWidth };
      });
    };

    const observer = new ResizeObserver(measure);
    observer.observe(area);
    measure();
    return () => observer.disconnect();
  }, [height, maxColumnClueParts, width]);

  const parsed = useMemo(
    () => cluesToPuzzle(width, height, rowInputs, columnInputs),
    [columnInputs, height, rowInputs, width],
  );
  const displayGrid = replay !== null ? replay.grid : solution;
  const crosshairInfo =
    hoveredCell === null || displayGrid === null
      ? null
      : getCrosshairInfo(displayGrid, hoveredCell.row, hoveredCell.column);
  const replaying = replay !== null && !replay.done;

  const rowErrors = rowInputs.map((text) => {
    const result = parseClue(text);
    return result.error ?? (result.values.length > 0 ? clueLengthError(result.values, width) : null);
  });
  const columnErrors = columnInputs.map((text) => {
    const result = parseClue(text);
    return (
      result.error ??
      (result.values.length > 0 ? clueLengthError(result.values, height) : null)
    );
  });

  const clearSolution = (): void => {
    setSolution(null);
    setReplay(null);
    setPlaying(false);
  };

  const resize = (nextWidth: number, nextHeight: number): void => {
    setWidth(nextWidth);
    setHeight(nextHeight);
    setRowInputs((current) => makeClues(nextHeight, current));
    setColumnInputs((current) => makeClues(nextWidth, current));
    clearSolution();
    setMessage(null);
    setHoveredCell(null);
  };

  const updateRowClue = (index: number, value: string): void => {
    setRowInputs((current) => current.map((clue, clueIndex) => (clueIndex === index ? value : clue)));
    clearSolution();
    setMessage(null);
    setHoveredCell(null);
  };

  const updateColumnClue = (index: number, value: string): void => {
    setColumnInputs((current) =>
      current.map((clue, clueIndex) => (clueIndex === index ? toStackedClue(value) : clue)),
    );
    clearSolution();
    setMessage(null);
    setHoveredCell(null);
  };

  const handleClueKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): void => {
    if (event.key !== 'Tab') {
      return;
    }

    const clueInputs = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-clue-input]'),
    );
    const currentIndex = clueInputs.indexOf(event.currentTarget);
    if (currentIndex < 0 || clueInputs.length === 0) {
      return;
    }

    event.preventDefault();
    const direction = event.shiftKey ? -1 : 1;
    const targetIndex =
      (currentIndex + direction + clueInputs.length) % clueInputs.length;
    const target = clueInputs[targetIndex];
    if (target === undefined) {
      return;
    }

    target.focus();
    const targetClueIndex = Number(target.dataset['clueIndex']);
    if (!Number.isSafeInteger(targetClueIndex)) {
      return;
    }
    if (target.dataset['clueKind'] === 'row') {
      updateRowClue(targetClueIndex, '');
    } else if (target.dataset['clueKind'] === 'column') {
      updateColumnClue(targetClueIndex, '');
    }
  };

  const resetSample = (): void => {
    setWidth(5);
    setHeight(5);
    setRowInputs(makeClues(5, SAMPLE_CLUES));
    setColumnInputs(makeClues(5, SAMPLE_CLUES));
    clearSolution();
    setMessage(null);
    setHoveredCell(null);
  };

  const handleWebsiteImport = (): void => {
    const result = parseWebsitePuzzleHtml(websiteHtml);
    if (result.status === 'failure') {
      setImportFeedback({ kind: 'error', text: result.message });
      return;
    }

    const { puzzle } = result;
    setWidth(puzzle.width);
    setHeight(puzzle.height);
    setRowInputs(puzzle.rowClues.map((clues) => clues.join(' ')));
    setColumnInputs(puzzle.columnClues.map((clues) => clues.join('\n')));
    clearSolution();
    setMessage(null);
    setHoveredCell(null);
    setImportFeedback({
      kind: 'success',
      text: `已导入 ${puzzle.width} × ${puzzle.height} 题目线索。`,
    });
  };

  useEffect(() => {
    if (replay === null || !playing) {
      return undefined;
    }
    const stepsPerTick = Math.max(1, Math.ceil(replay.total / PLAYBACK_TICKS));
    const timer = window.setInterval(() => {
      replay.advance(stepsPerTick);
      setReplayTick((tick) => tick + 1);
      if (replay.done) {
        setPlaying(false);
      }
    }, PLAYBACK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [playing, replay]);

  const toggleReplay = (): void => {
    if (replay === null) {
      return;
    }
    if (replay.done) {
      replay.restart();
      setPlaying(true);
    } else {
      setPlaying((value) => !value);
    }
    setReplayTick((tick) => tick + 1);
  };

  const skipReplay = (): void => {
    if (replay === null) {
      return;
    }
    replay.finish();
    setPlaying(false);
    setReplayTick((tick) => tick + 1);
  };

  const handleSolve = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    clearSolution();
    setHoveredCell(null);
    setSolveCount((count) => count + 1);

    if (parsed.puzzle === null) {
      setMessage({ kind: 'invalid', text: parsed.error ?? '请检查输入的线索。' });
      return;
    }

    const result = solvePuzzle(parsed.puzzle);
    if (result.status !== 'invalid-puzzle' && result.trace.complete) {
      const nextReplay = new SolveReplay(parsed.puzzle.height, parsed.puzzle.width, result.trace.steps);
      setReplay(nextReplay);
      setPlaying(!nextReplay.done);
    }
    switch (result.status) {
      case 'solved':
        setSolution(result.grid);
        setMessage({ kind: 'solved', nodes: result.visitedNodes });
        break;
      case 'unsatisfiable':
        setMessage({ kind: 'unsatisfiable', nodes: result.visitedNodes });
        break;
      case 'search-limit':
        setMessage({ kind: 'search-limit', nodes: result.visitedNodes });
        break;
      case 'invalid-puzzle':
        setMessage({ kind: 'invalid', text: result.message });
        break;
    }
  };

  const messageText =
    message === null ? null : { ...formatMessage(message), kind: message.kind };
  const statusText =
    replaying && replay !== null
      ? replay.caption
      : messageText === null
        ? ''
        : messageText.detail === ''
          ? messageText.title
          : `${messageText.title} · ${messageText.detail}`;
  const statusTone =
    !replaying && (message?.kind === 'unsatisfiable' || message?.kind === 'invalid')
      ? 'conflict'
      : 'plain';
  const lineWeight = Math.max(0.6, Math.min(1.2, boardMetrics.cellSize * 0.035));
  const boardStyle = {
    gridTemplateColumns: `${boardMetrics.rowClueWidth}px repeat(${width}, ${boardMetrics.cellSize}px)`,
    gridTemplateRows: `${boardMetrics.columnHeaderHeight}px repeat(${height}, ${boardMetrics.cellSize}px)`,
    '--cell-size': `${boardMetrics.cellSize}px`,
    '--clue-font-size': `${boardMetrics.clueFontSize}px`,
    '--line-cell': `${lineWeight}px`,
    '--line-mid': `${lineWeight * 2}px`,
    '--line-outer': `${lineWeight * 3}px`,
  } as CSSProperties;

  return (
    <main className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <h1>数织求解器</h1>
        </div>
        <div className="header-tools">
          <div className="dimension-fields" role="group" aria-label="棋盘尺寸">
            <label>
              <span className="sr-only">宽</span>
              <input
                aria-label="棋盘宽度"
                type="number"
                min={MIN_DIMENSION}
                max={MAX_PUZZLE_DIMENSION}
                value={width}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (
                    Number.isInteger(next) &&
                    next >= MIN_DIMENSION &&
                    next <= MAX_PUZZLE_DIMENSION
                  ) {
                    resize(next, height);
                  }
                }}
              />
            </label>
            <span className="dimension-cross" aria-hidden="true">×</span>
            <label>
              <span className="sr-only">高</span>
              <input
                aria-label="棋盘高度"
                type="number"
                min={MIN_DIMENSION}
                max={MAX_PUZZLE_DIMENSION}
                value={height}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (
                    Number.isInteger(next) &&
                    next >= MIN_DIMENSION &&
                    next <= MAX_PUZZLE_DIMENSION
                  ) {
                    resize(width, next);
                  }
                }}
              />
            </label>
          </div>
          <button className="text-button" type="button" onClick={resetSample}>
            恢复示例
          </button>
        </div>
      </header>

      <details className="import-panel">
        <summary>从网站 HTML 导入</summary>
        <div className="import-content">
          <textarea
            className="import-source"
            value={websiteHtml}
            onChange={(event) => {
              setWebsiteHtml(event.currentTarget.value);
              setImportFeedback(null);
            }}
            placeholder="在此粘贴网站题目 HTML…"
            spellCheck={false}
            aria-label="网站题目 HTML"
          />
          <div className="import-actions">
            <button className="ghost-button" type="button" onClick={handleWebsiteImport}>
              解析并导入线索
            </button>
            {importFeedback !== null && (
              <span className={`import-feedback import-feedback-${importFeedback.kind}`} role="status">
                {importFeedback.text}
              </span>
            )}
          </div>
        </div>
      </details>

      <form className="workspace" onSubmit={handleSolve}>
        <div className="board-area" ref={boardAreaRef}>
          <div className="board-scroll" aria-label="数织线索与解答棋盘">
            <div key={`${width}x${height}`} className="puzzle-grid" style={boardStyle}>
              <span aria-hidden="true" />
              {columnInputs.map((value, index) => (
                <label className="column-clue" key={`column-${index}`}>
                  <span className="sr-only">第 {index + 1} 列线索</span>
                  <textarea
                    data-clue-input
                    data-clue-kind="column"
                    data-clue-index={index}
                    aria-invalid={columnErrors[index] !== null}
                    className={crosshairInfo?.column === index ? 'clue-active' : undefined}
                    value={value}
                    rows={cluePartCount(value)}
                    onChange={(event) => updateColumnClue(index, event.currentTarget.value)}
                    onKeyDown={handleClueKeyDown}
                    placeholder="·"
                    spellCheck={false}
                  />
                  {columnErrors[index] !== null && (
                    <span className="sr-only">{columnErrors[index]}</span>
                  )}
                </label>
              ))}

              {rowInputs.map((value, rowIndex) => (
                <div className="board-row" key={`row-${rowIndex}`}>
                  <label className="row-clue">
                    <span className="sr-only">第 {rowIndex + 1} 行线索</span>
                    <input
                      data-clue-input
                      data-clue-kind="row"
                      data-clue-index={rowIndex}
                      aria-invalid={rowErrors[rowIndex] !== null}
                      className={crosshairInfo?.row === rowIndex ? 'clue-active' : undefined}
                      value={value}
                      onChange={(event) => updateRowClue(rowIndex, event.currentTarget.value)}
                      onKeyDown={handleClueKeyDown}
                      placeholder="·"
                      spellCheck={false}
                    />
                    {rowErrors[rowIndex] !== null && (
                      <span className="sr-only">{rowErrors[rowIndex]}</span>
                    )}
                  </label>
                  {Array.from({ length: width }, (_, columnIndex) => {
                    const cell = displayGrid?.[rowIndex]?.[columnIndex] ?? 'unknown';
                    const isCrosshairOrigin =
                      crosshairInfo?.row === rowIndex && crosshairInfo.column === columnIndex;
                    const isLatest =
                      replay?.latest?.row === rowIndex && replay.latest.column === columnIndex;
                    const isGuess = replay?.guess[rowIndex]?.[columnIndex] === true;
                    const positionClasses = [
                      rowIndex === 0 ? 'board-cell-first-row' : '',
                      columnIndex === 0 ? 'board-cell-first-column' : '',
                      rowIndex === height - 1 ? 'board-cell-last-row' : '',
                      columnIndex === width - 1 ? 'board-cell-last-column' : '',
                      (rowIndex + 1) % 5 === 0 ? 'board-cell-group-bottom' : '',
                      (columnIndex + 1) % 5 === 0 ? 'board-cell-group-right' : '',
                      isLatest ? 'board-cell-latest' : '',
                      isGuess ? 'board-cell-guess' : '',
                    ]
                      .filter((className) => className !== '')
                      .join(' ');
                    const revealDelay =
                      cell === 'unknown' ? 0 : Math.min(1200, (rowIndex + columnIndex) * 22);
                    const cellStyle = { '--reveal-delay': `${revealDelay}ms` } as CSSProperties;
                    return (
                      <span
                        className={`board-cell board-cell-${cell} ${positionClasses}`}
                        style={cellStyle}
                        key={`cell-${solveCount}-${rowIndex}-${columnIndex}`}
                        aria-label={
                          isCrosshairOrigin && crosshairInfo !== null
                            ? `黑格，横向连续 ${crosshairInfo.horizontal.count} 格，纵向连续 ${crosshairInfo.vertical.count} 格`
                            : cellLabel(rowIndex, columnIndex, cell)
                        }
                        onMouseEnter={() =>
                          setHoveredCell(
                            cell === 'filled' ? { row: rowIndex, column: columnIndex } : null,
                          )
                        }
                        onMouseLeave={() => setHoveredCell(null)}
                      >
                        {cell === 'filled' ? <span className="board-cell-dot" aria-hidden="true" /> : null}
                      </span>
                    );
                  })}
                </div>
              ))}
              {crosshairInfo !== null && (
                <CrossOverlay
                  info={crosshairInfo}
                  metrics={boardMetrics}
                  width={width}
                  height={height}
                />
              )}
            </div>
          </div>
        </div>

        <div className="control-bar">
          <div className="replay-controls">
            {replay !== null && (
              <>
                <button className="ghost-button" type="button" onClick={toggleReplay}>
                  {replay.done ? '重播' : playing ? '暂停' : '播放'}
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={skipReplay}
                  disabled={replay.done}
                >
                  跳到结果
                </button>
              </>
            )}
          </div>
          <p className={`status status-${statusTone}`} role="status" aria-live="polite">
            {replaying && (
              <span className="brand-mark brand-mark-busy" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
            )}
            <span>{statusText}</span>
          </p>
          <button className="solve-button" type="submit">
            开始求解
          </button>
        </div>
      </form>
    </main>
  );
}

function formatMessage(message: SolveMessage): { readonly title: string; readonly detail: string } {
  switch (message.kind) {
    case 'solved':
      return {
        title: '找到可行解',
        detail: `搜索 ${message.nodes.toLocaleString('zh-CN')} 个节点`,
      };
    case 'unsatisfiable':
      return { title: '这组线索无解', detail: `搜索 ${message.nodes} 个节点` };
    case 'search-limit':
      return {
        title: '搜索达到上限',
        detail: `已检查 ${message.nodes.toLocaleString('zh-CN')} 个节点`,
      };
    case 'invalid':
      return { title: '请检查输入', detail: message.text };
  }
}

function cellLabel(row: number, column: number, cell: CellState): string {
  const state = cell === 'filled' ? '黑格' : cell === 'empty' ? '空格' : '待求解';
  return `第 ${row + 1} 行，第 ${column + 1} 列：${state}`;
}

interface CrossOverlayProps {
  readonly info: CrosshairInfo;
  readonly metrics: BoardMetrics;
  readonly width: number;
  readonly height: number;
}

function CrossOverlay({ info, metrics, width, height }: CrossOverlayProps) {
  const size = metrics.cellSize;
  const gridWidth = metrics.rowClueWidth + width * size;
  const gridHeight = metrics.columnHeaderHeight + height * size;
  const originX = metrics.rowClueWidth + (info.column + 0.5) * size;
  const originY = metrics.columnHeaderHeight + (info.row + 0.5) * size;
  const dotSize = Math.max(2, Math.min(6, size * 0.2));
  const outline = crossOutlinePath(info, metrics);
  const crossLeft = metrics.rowClueWidth + Math.min(info.horizontal.start, info.column) * size;
  const crossRight = metrics.rowClueWidth + (Math.max(info.horizontal.end, info.column) + 1) * size;
  const tooltipGap = 8;
  const tooltipPlacement: CSSProperties =
    crossLeft - tooltipGap - TOOLTIP_WIDTH >= 0 && crossRight + tooltipGap + TOOLTIP_WIDTH > gridWidth
      ? { left: crossLeft - tooltipGap, top: originY, transform: 'translate(-100%, -50%)' }
      : { left: crossRight + tooltipGap, top: originY, transform: 'translateY(-50%)' };

  return (
    <>
      <svg
        key={`${info.row}-${info.column}`}
        className="cross-overlay"
        width={gridWidth}
        height={gridHeight}
        viewBox={`0 0 ${gridWidth} ${gridHeight}`}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="cross-fill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3b423b" />
            <stop offset="1" stopColor="#1d211e" />
          </linearGradient>
        </defs>
        <g className="cross-group" style={{ transformOrigin: `${originX}px ${originY}px` }}>
          {crossCells(info).map(({ row, column }) => {
            const x = metrics.rowClueWidth + column * size;
            const y = metrics.columnHeaderHeight + row * size;
            return (
              <g key={`${row}-${column}`}>
                <rect x={x} y={y} width={size} height={size} fill="url(#cross-fill)" />
                <rect
                  x={x + (size - dotSize) / 2}
                  y={y + (size - dotSize) / 2}
                  width={dotSize}
                  height={dotSize}
                  className="cross-dot"
                />
              </g>
            );
          })}
          <path className="cross-outline-base" d={outline} />
          <path className="cross-outline-trail" d={outline} pathLength={100} />
          <path className="cross-outline-flow" d={outline} pathLength={100} />
        </g>
      </svg>
      <span className="crosshair-tooltip" style={tooltipPlacement} aria-hidden="true">
        <span>横向连续 <b>{info.horizontal.count}</b> 格</span>
        <span>纵向连续 <b>{info.vertical.count}</b> 格</span>
      </span>
    </>
  );
}

function isCrossCell(info: CrosshairInfo, row: number, column: number): boolean {
  return (
    (row === info.row && column >= info.horizontal.start && column <= info.horizontal.end) ||
    (column === info.column && row >= info.vertical.start && row <= info.vertical.end)
  );
}

function crossCells(info: CrosshairInfo): { readonly row: number; readonly column: number }[] {
  const cells: { row: number; column: number }[] = [];
  for (let column = info.horizontal.start; column <= info.horizontal.end; column += 1) {
    cells.push({ row: info.row, column });
  }
  for (let row = info.vertical.start; row <= info.vertical.end; row += 1) {
    if (row !== info.row) {
      cells.push({ row, column: info.column });
    }
  }
  return cells;
}

function crossOutlinePath(info: CrosshairInfo, metrics: BoardMetrics): string {
  const size = metrics.cellSize;
  const next = new Map<string, readonly [number, number]>();
  const addEdge = (x1: number, y1: number, x2: number, y2: number): void => {
    next.set(`${x1},${y1}`, [x2, y2]);
  };
  for (const { row, column } of crossCells(info)) {
    const x = metrics.rowClueWidth + column * size;
    const y = metrics.columnHeaderHeight + row * size;
    if (!isCrossCell(info, row - 1, column)) {
      addEdge(x, y, x + size, y);
    }
    if (!isCrossCell(info, row, column + 1)) {
      addEdge(x + size, y, x + size, y + size);
    }
    if (!isCrossCell(info, row + 1, column)) {
      addEdge(x + size, y + size, x, y + size);
    }
    if (!isCrossCell(info, row, column - 1)) {
      addEdge(x, y + size, x, y);
    }
  }

  const start = next.keys().next().value;
  if (start === undefined) {
    return '';
  }
  let path = '';
  let key = start;
  for (let step = 0; step <= next.size; step += 1) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    path += `${step === 0 ? 'M' : 'L'}${x} ${y}`;
    const following = next.get(key);
    if (following === undefined) {
      break;
    }
    key = `${following[0]},${following[1]}`;
    if (key === start) {
      break;
    }
  }
  return `${path}Z`;
}
