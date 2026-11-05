import type { CellState, SolveStep } from './solver';

interface Assignment {
  readonly row: number;
  readonly column: number;
  readonly depth: number;
}

export class SolveReplay {
  readonly grid: CellState[][];
  readonly guess: boolean[][];
  latest: { readonly row: number; readonly column: number } | null = null;
  caption = '准备演示求解过程';
  private readonly assignments: Assignment[] = [];
  private nextIndex = 0;

  constructor(
    private readonly height: number,
    private readonly width: number,
    private readonly steps: readonly SolveStep[],
  ) {
    this.grid = this.emptyGrid<CellState>('unknown');
    this.guess = this.emptyGrid<boolean>(false);
  }

  get total(): number {
    return this.steps.length;
  }

  get progress(): number {
    return this.steps.length === 0 ? 1 : this.nextIndex / this.steps.length;
  }

  get done(): boolean {
    return this.nextIndex >= this.steps.length;
  }

  advance(count: number): void {
    const end = Math.min(this.steps.length, this.nextIndex + count);
    for (; this.nextIndex < end; this.nextIndex += 1) {
      this.apply(this.steps[this.nextIndex]!);
    }
    if (this.done) {
      this.latest = null;
    }
  }

  finish(): void {
    this.advance(this.steps.length);
  }

  restart(): void {
    for (const row of this.grid) {
      row.fill('unknown');
    }
    for (const row of this.guess) {
      row.fill(false);
    }
    this.assignments.length = 0;
    this.latest = null;
    this.nextIndex = 0;
    this.caption = '准备演示求解过程';
  }

  private apply(step: SolveStep): void {
    if (step.kind === 'assign') {
      const label = step.value === 'filled' ? '黑格' : '空格';
      const position = `第 ${step.row + 1} 行第 ${step.column + 1} 列`;
      this.grid[step.row]![step.column] = step.value;
      this.guess[step.row]![step.column] = step.source === 'guess';
      this.assignments.push({ row: step.row, column: step.column, depth: step.depth });
      this.latest = { row: step.row, column: step.column };
      this.caption =
        step.source === 'guess'
          ? `假设：${position} 为${label}，继续推演`
          : `线索推出：${position} 为${label}`;
      return;
    }

    while (this.assignments.length > 0) {
      const last = this.assignments[this.assignments.length - 1]!;
      if (last.depth < step.depth) {
        break;
      }
      this.assignments.pop();
      this.grid[last.row]![last.column] = 'unknown';
      this.guess[last.row]![last.column] = false;
    }
    this.latest = null;
    this.caption = '出现矛盾，撤销假设并回溯';
  }

  private emptyGrid<T>(value: T): T[][] {
    return Array.from({ length: this.height }, () => Array<T>(this.width).fill(value));
  }
}
