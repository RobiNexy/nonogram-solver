import {
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
import { parseWebsitePuzzleHtml } from './website-import';
import './App.css';

const SAMPLE_CLUES = ['1', '3', '5', '3', '1'] as const;
const MIN_DIMENSION = 1;

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
  const [importPanelOpen, setImportPanelOpen] = useState(false);
  const boardViewportRef = useRef<HTMLDivElement>(null);
  const [boardMetrics, setBoardMetrics] = useState<BoardMetrics>(INITIAL_BOARD_METRICS);
  const compactBoard = Math.max(width, height) >= 20;
  const maxColumnClueParts = Math.min(
    Math.ceil(height / 2),
    Math.max(1, ...columnInputs.map(cluePartCount)),
  );

  useLayoutEffect(() => {
    const viewport = boardViewportRef.current;
    if (viewport === null) {
      return;
    }

    const measure = (): void => {
      const frameWidth = viewport.clientWidth;
      const viewportRect = viewport.getBoundingClientRect();
      const documentTop = viewportRect.top + window.scrollY;
      const rowClueWidth = width >= 40 ? 42 : width >= 20 ? 50 : 64;
      const widthLimit = Math.max(2, (frameWidth - rowClueWidth - 2) / width);
      const heightBudget = Math.max(80, window.innerHeight - documentTop - 190);
      let cellSize = Math.min(48, widthLimit, heightBudget / height);
      let columnHeaderHeight = 14;

      for (let iteration = 0; iteration < 3; iteration += 1) {
        const clueLineHeight = Math.max(3.5, Math.min(10, cellSize * 0.62));
        columnHeaderHeight = Math.max(14, maxColumnClueParts * clueLineHeight + 6);
        cellSize = Math.min(
          48,
          widthLimit,
          (heightBudget - columnHeaderHeight) / height,
        );
      }

      cellSize = Math.max(2, cellSize);
      const clueFontSize = Math.max(3, Math.min(10, cellSize * 0.58));
      const clueLineHeight = Math.max(3.5, Math.min(10, cellSize * 0.62));
      columnHeaderHeight = Math.max(14, maxColumnClueParts * clueLineHeight + 6);

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
    observer.observe(viewport);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [height, importFeedback, importPanelOpen, maxColumnClueParts, width]);

  const parsed = useMemo(
    () => cluesToPuzzle(width, height, rowInputs, columnInputs),
    [columnInputs, height, rowInputs, width],
  );

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

  const resize = (nextWidth: number, nextHeight: number): void => {
    setWidth(nextWidth);
    setHeight(nextHeight);
    setRowInputs((current) => makeClues(nextHeight, current));
    setColumnInputs((current) => makeClues(nextWidth, current));
    setSolution(null);
    setMessage(null);
  };

  const updateRowClue = (index: number, value: string): void => {
    setRowInputs((current) => current.map((clue, clueIndex) => (clueIndex === index ? value : clue)));
    setSolution(null);
    setMessage(null);
  };

  const updateColumnClue = (index: number, value: string): void => {
    setColumnInputs((current) =>
      current.map((clue, clueIndex) => (clueIndex === index ? value : clue)),
    );
    setSolution(null);
    setMessage(null);
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
    setSolution(null);
    setMessage(null);
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
    setColumnInputs(puzzle.columnClues.map((clues) => clues.join(' ')));
    setSolution(null);
    setMessage(null);
    setImportFeedback({
      kind: 'success',
      text: `已导入 ${puzzle.width} × ${puzzle.height} 题目线索，可以开始求解。`,
    });
  };

  const handleSolve = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSolution(null);

    if (parsed.puzzle === null) {
      setMessage({ kind: 'invalid', text: parsed.error ?? '请检查输入的线索。' });
      return;
    }

    const result = solvePuzzle(parsed.puzzle);
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
  const boardStyle = {
    gridTemplateColumns: `${boardMetrics.rowClueWidth}px repeat(${width}, ${boardMetrics.cellSize}px)`,
    gridTemplateRows: `${boardMetrics.columnHeaderHeight}px repeat(${height}, ${boardMetrics.cellSize}px)`,
    '--cell-size': `${boardMetrics.cellSize}px`,
    '--clue-font-size': `${boardMetrics.clueFontSize}px`,
  } as CSSProperties;

  return (
    <main className={`page-shell${compactBoard ? ' page-shell-compact' : ''}`}>
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="数织求解器首页">
          <span className="wordmark-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>GRID / LOGIC</span>
        </a>
        <span className="topbar-note">NONOGRAM STUDIO&nbsp; · &nbsp;BETA</span>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span /> 逻辑，逐格显现</p>
          <h1>数织求解器</h1>
          <p className="hero-description">
            输入行列线索，让约束传播与回溯找到答案。
            <br className="desktop-break" />
            空白线索代表该行或列全部留白。
          </p>
        </div>
        <div className="hero-stamp" aria-hidden="true">
          <span>PUZZLE</span>
          <strong>01</strong>
          <span>FIND THE PATTERN</span>
        </div>
      </section>

      <form className="workspace" onSubmit={handleSolve}>
        <div className="workspace-heading">
          <div>
            <p className="section-kicker">01 / PUZZLE SETUP</p>
            <h2>设置题目</h2>
          </div>
          <button className="text-button" type="button" onClick={resetSample}>
            <span aria-hidden="true">↺</span> 恢复示例
          </button>
        </div>

        <section className="dimension-bar" aria-label="棋盘尺寸">
          <div className="dimension-copy">
            <span className="dimension-icon" aria-hidden="true">▦</span>
            <div>
              <strong>棋盘尺寸</strong>
              <small>可调整为 1–{MAX_PUZZLE_DIMENSION} 格</small>
            </div>
          </div>
          <div className="dimension-fields">
            <label>
              <span>宽</span>
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
              <span>高</span>
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
        </section>

        <details
          className="import-panel"
          onToggle={(event) => setImportPanelOpen(event.currentTarget.open)}
        >
          <summary>从数织网站 HTML 导入</summary>
          <div className="import-content">
            <p>粘贴包含 <code>task-row-N</code> 和 <code>task-col-N</code> 的题目页面 HTML。</p>
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
              <button className="import-button" type="button" onClick={handleWebsiteImport}>
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

        <div className="editor-card">
          <div className="editor-topline">
            <div>
              <h3>填写线索</h3>
              <p>线索可用空格、英文或中文逗号分隔，例如 <code>3 1</code></p>
            </div>
            <span className="board-size-tag">{width} × {height}</span>
          </div>

          <div className="board-scroll" ref={boardViewportRef} aria-label="数织线索与解答棋盘">
            <div className="puzzle-grid" style={boardStyle}>
              <div className="corner-label" aria-hidden="true">列 ↓<br />行 →</div>
              {columnInputs.map((value, index) => (
                <label className="column-clue" key={`column-${index}`}>
                  <span className="sr-only">第 {index + 1} 列线索</span>
                  <textarea
                    data-clue-input
                    data-clue-kind="column"
                    data-clue-index={index}
                    aria-invalid={columnErrors[index] !== null}
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
                    const cell = solution?.[rowIndex]?.[columnIndex] ?? 'unknown';
                    return (
                      <span
                        className={`board-cell board-cell-${cell}${rowIndex === 0 ? ' board-cell-first-row' : ''}${columnIndex === 0 ? ' board-cell-first-column' : ''}`}
                        key={`cell-${rowIndex}-${columnIndex}`}
                        aria-label={cellLabel(rowIndex, columnIndex, cell)}
                      >
                        {cell === 'filled' ? <span aria-hidden="true" /> : null}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="editor-footer">
            <span className="legend"><i className="legend-filled" />黑格 <i className="legend-empty" />空格</span>
            <span className="hint">Tab 下一格并清空 · Shift+Tab 上一格并清空</span>
          </div>
        </div>

        <div className="solve-row">
          <p className="solve-note">求解器最多搜索 100,000 个分支节点</p>
          <button className="solve-button" type="submit">
            <span>开始求解</span><span className="button-arrow" aria-hidden="true">↗</span>
          </button>
        </div>

        <div className={`result-panel ${message === null ? 'result-idle' : `result-${message.kind}`}`} aria-live="polite">
          {messageText === null ? (
            <>
              <span className="result-icon" aria-hidden="true">✳</span>
              <span>准备就绪 <small>输入线索后开始求解</small></span>
            </>
          ) : (
            <>
              <span className="result-icon" aria-hidden="true">{messageText.kind === 'solved' ? '✓' : '!'}</span>
              <span>{messageText.title}<small>{messageText.detail}</small></span>
            </>
          )}
        </div>
      </form>

      <footer className="page-footer">
        <span>基于约束满足与有限回溯</span>
        <span>每一步推理，都有迹可循。</span>
      </footer>
    </main>
  );
}

function formatMessage(message: SolveMessage): { readonly title: string; readonly detail: string } {
  switch (message.kind) {
    case 'solved':
      return {
        title: '找到可行解',
        detail: `已完成棋盘 · 搜索 ${message.nodes.toLocaleString('zh-CN')} 个节点`,
      };
    case 'unsatisfiable':
      return {
        title: '这组线索无解',
        detail: `行列约束彼此冲突 · 检查后重试（${message.nodes} 个节点）`,
      };
    case 'search-limit':
      return {
        title: '搜索达到上限',
        detail: `已检查 ${message.nodes.toLocaleString('zh-CN')} 个节点，暂未找到解。`,
      };
    case 'invalid':
      return { title: '请检查输入', detail: message.text };
  }
}

function cellLabel(row: number, column: number, cell: CellState): string {
  const state = cell === 'filled' ? '黑格' : cell === 'empty' ? '空格' : '待求解';
  return `第 ${row + 1} 行，第 ${column + 1} 列：${state}`;
}
