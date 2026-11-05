// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseWebsitePuzzleHtml } from './website-import';

const sampleHtml = `
  <div id="taskTop">
    <div class="task-group task-col-0">
      <div class="task-cell"></div>
      <div class="task-cell selectable">1</div>
      <div class="task-cell selectable">1</div>
    </div>
    <div class="task-group task-col-1">
      <div class="task-cell"></div>
      <div class="task-cell selectable">2</div>
    </div>
    <div class="task-group task-col-2">
      <div class="task-cell"></div>
    </div>
  </div>
  <div id="taskLeft">
    <div class="task-group task-row-0">
      <div class="task-cell selectable">1</div>
      <div class="task-cell selectable">1</div>
    </div>
    <div class="task-group task-row-1">
      <div class="task-cell selectable">2</div>
    </div>
    <div class="task-group task-row-2">
      <div class="task-cell"></div>
    </div>
  </div>
  <div class="row"><div class="cell selectable">99</div></div>
`;

describe('parseWebsitePuzzleHtml', () => {
  it('extracts ordered row and column task clues and ignores grid cells', () => {
    expect(parseWebsitePuzzleHtml(sampleHtml)).toEqual({
      status: 'success',
      puzzle: {
        width: 3,
        height: 3,
        rowClues: [[1, 1], [2], []],
        columnClues: [[1, 1], [2], []],
      },
    });
  });

  it('rejects HTML without both row and column clue groups', () => {
    expect(parseWebsitePuzzleHtml('<div class="task-group task-col-0"></div>')).toMatchObject({
      status: 'failure',
    });
  });

  it('rejects non-contiguous clue group indices', () => {
    const missingRow = sampleHtml.replace('task-row-1', 'task-row-3');
    expect(parseWebsitePuzzleHtml(missingRow)).toMatchObject({
      status: 'failure',
      message: expect.stringContaining('编号不连续'),
    });
  });

  it('rejects clue runs that cannot fit the parsed board dimensions', () => {
    const tooLong = sampleHtml.replace(
      '<div class="task-cell selectable">2</div>\n    </div>\n    <div class="task-group task-col-2">',
      '<div class="task-cell selectable">4</div>\n    </div>\n    <div class="task-group task-col-2">',
    );
    expect(parseWebsitePuzzleHtml(tooLong)).toMatchObject({ status: 'failure' });
  });
});
