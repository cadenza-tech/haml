import * as assert from 'node:assert';
import { commonIndent, dedentLines, indentLines, indentUnit, linesOf, normalizeSelection, type SelectionInput } from '../../pure/lineRange';
import type { DocumentSnapshot } from '../../pure/textModel';
import { snapshotOfLines } from '../support/snapshot';

/** A whole-line selection, which is what dragging over the text produces. */
function whole(document: DocumentSnapshot, startLine: number, endLine: number): SelectionInput {
  return { startLine, startCharacter: 0, endLine, endCharacter: document.lineAt(endLine).text.length };
}

/** A collapsed selection, which is what a plain cursor is. */
function caret(line: number, character = 0): SelectionInput {
  return { startLine: line, startCharacter: character, endLine: line, endCharacter: character };
}

const CARD = ['%h1 Posts', '  .card', '    %h2 Title', '    %p Body', '  .footer', ''];

suite('pure/lineRange Test Suite', () => {
  suite('normalizeSelection', () => {
    test('should keep a whole-line selection as it is', () => {
      const document = snapshotOfLines(['%p a', '%p b', '%p c']);
      assert.deepStrictEqual(normalizeSelection(whole(document, 0, 1), document), { startLine: 0, endLine: 1 });
    });

    // The start column is dropped because insertSnippet has to replace from column 0.
    test('should ignore the start column', () => {
      const document = snapshotOfLines(['%p a', '%p b']);
      assert.deepStrictEqual(normalizeSelection({ startLine: 0, startCharacter: 3, endLine: 1, endCharacter: 4 }, document), {
        startLine: 0,
        endLine: 1
      });
    });

    // Dragging over line numbers and Ctrl+L both end on column 0 of the following line.
    test('should drop a trailing line the selection only touches at column 0', () => {
      const document = snapshotOfLines(['%p a', '%p b', '%p c']);
      assert.deepStrictEqual(normalizeSelection({ startLine: 0, startCharacter: 0, endLine: 2, endCharacter: 0 }, document), {
        startLine: 0,
        endLine: 1
      });
    });

    test('should not drop the only line of a single-line selection ending at column 0', () => {
      const document = snapshotOfLines(['%p a', '%p b']);
      assert.deepStrictEqual(normalizeSelection(caret(1), document), { startLine: 1, endLine: 1 });
    });

    // A cursor on a parent means the parent and its children, which is the same rule the disable
    // quick fix follows when it places its comment pair.
    test('should take the whole block under a caret', () => {
      const document = snapshotOfLines(CARD);
      assert.deepStrictEqual(normalizeSelection(caret(1), document), { startLine: 1, endLine: 3 });
    });

    test('should take only the line under a caret on a leaf', () => {
      const document = snapshotOfLines(CARD);
      assert.deepStrictEqual(normalizeSelection(caret(2), document), { startLine: 2, endLine: 2 });
    });

    // The regression this rule exists for: raising `.card` one level without its children would put
    // `%h2` at the same depth as `.card`, and the children would stop being children.
    test('should extend a selection whose last line still has children', () => {
      const document = snapshotOfLines(CARD);
      assert.deepStrictEqual(normalizeSelection(whole(document, 1, 1), document), { startLine: 1, endLine: 3 });
    });

    test('should leave a selection that already contains its children alone', () => {
      const document = snapshotOfLines(CARD);
      assert.deepStrictEqual(normalizeSelection(whole(document, 1, 3), document), { startLine: 1, endLine: 3 });
    });

    // Two same-depth siblings can both be selected with the selection ending inside the second one.
    // Extending only the shallowest line's own block would leave `%p f` behind: it would detach from
    // `.footer` and, under a wrap, land outside the new conditional.
    test('should keep the second sibling children when the selection ends inside it', () => {
      const document = snapshotOfLines(['%h1', '  .card', '    %p a', '  .footer', '    %p f', '%end']);
      assert.deepStrictEqual(normalizeSelection({ startLine: 1, startCharacter: 0, endLine: 4, endCharacter: 0 }, document), {
        startLine: 1,
        endLine: 4
      });
    });

    // The last line's own block can be complete while the selection still cuts a parent's children in
    // half. Extending from the last line alone would leave `%p Body` behind as a sibling of `.card`.
    test('should extend from the shallowest line, not the last one', () => {
      const document = snapshotOfLines(CARD);
      assert.deepStrictEqual(normalizeSelection(whole(document, 1, 2), document), { startLine: 1, endLine: 3 });
    });

    // `%h1 Posts` sits at column zero, so raising it one level would make every line below a sibling.
    test('should extend to the end of the shallowest line block', () => {
      const document = snapshotOfLines(CARD);
      assert.deepStrictEqual(normalizeSelection(whole(document, 0, 2), document), { startLine: 0, endLine: 4 });
    });

    // Wrapping an `if` without its `else` leaves valid Haml in which the else answers to the new
    // outer conditional instead - nothing breaks, the page just renders something else. Extracting
    // it leaves a dangling `- else`, which does break.
    test('should take the else along with the if under a caret', () => {
      const document = snapshotOfLines(['- if a', '  %p x', '- else', '  %p y', '%p after']);
      assert.deepStrictEqual(normalizeSelection(caret(0), document), { startLine: 0, endLine: 3 });
    });

    test('should take the else along even when only the if branch was selected', () => {
      const document = snapshotOfLines(['- if a', '  %p x', '- else', '  %p y', '%p after']);
      assert.deepStrictEqual(normalizeSelection(whole(document, 0, 1), document), { startLine: 0, endLine: 3 });
    });

    test('should reach back to the if when the selection starts on its else', () => {
      const document = snapshotOfLines(['%div', '  - if a', '    %p x', '  - else', '    %p y', '  %p after']);
      assert.deepStrictEqual(normalizeSelection(caret(3), document), { startLine: 1, endLine: 4 });
    });

    test('should reach back to the case from a when nested under it', () => {
      const document = snapshotOfLines(['- case a', '  - when 1', '    %p one', '  - when 2', '    %p two', '%p after']);
      assert.deepStrictEqual(normalizeSelection(caret(3), document), { startLine: 0, endLine: 4 });
    });

    test('should reach back to the case from an else nested under it', () => {
      const document = snapshotOfLines(['- case a', '  - when 1', '    %p one', '  - else', '    %p other', '%p after']);
      assert.deepStrictEqual(normalizeSelection(caret(3), document), { startLine: 0, endLine: 4 });
    });

    test('should leave a selection inside one branch alone', () => {
      const document = snapshotOfLines(['- if a', '  %p x', '  %p y', '- else', '  %p z']);
      assert.deepStrictEqual(normalizeSelection(whole(document, 1, 2), document), { startLine: 1, endLine: 2 });
    });

    test('should trim blank lines from both ends', () => {
      const document = snapshotOfLines(['', '  %p a', '  %p b', '', '']);
      assert.deepStrictEqual(normalizeSelection(whole(document, 0, 4), document), { startLine: 1, endLine: 2 });
    });

    // A blank line has no indent to compare, so it must not be mistaken for the shallowest line and
    // send the extension off the wrong block.
    test('should ignore blank lines when looking for the shallowest line', () => {
      const document = snapshotOfLines(['  .card', '', '    %h2 Title', '    %p Body', '%p Done']);
      assert.deepStrictEqual(normalizeSelection(whole(document, 0, 2), document), { startLine: 0, endLine: 3 });
    });

    test('should return null for a selection that is only blank lines', () => {
      const document = snapshotOfLines(['%p a', '', '  ', '%p b']);
      assert.strictEqual(normalizeSelection(whole(document, 1, 2), document), null);
      assert.strictEqual(normalizeSelection(caret(1), document), null);
    });

    test('should return null for an empty document', () => {
      const document = snapshotOfLines(['']);
      assert.strictEqual(normalizeSelection(caret(0), document), null);
    });

    test('should handle a selection reaching the last line', () => {
      const document = snapshotOfLines(['%p a', '  %p b']);
      assert.deepStrictEqual(normalizeSelection(whole(document, 0, 1), document), { startLine: 0, endLine: 1 });
    });
  });

  suite('linesOf', () => {
    test('should return the text of every line in the range', () => {
      const document = snapshotOfLines(CARD);
      assert.deepStrictEqual(linesOf({ startLine: 1, endLine: 3 }, document), ['  .card', '    %h2 Title', '    %p Body']);
    });
  });

  suite('indentUnit', () => {
    test('should build a run of spaces or a single tab', () => {
      assert.strictEqual(indentUnit(true, 2), '  ');
      assert.strictEqual(indentUnit(true, 4), '    ');
      assert.strictEqual(indentUnit(false, 8), '\t');
    });

    // settings.json is hand-editable and detectIndentation reports whatever it found.
    test('should clamp and truncate a hostile tab size', () => {
      assert.strictEqual(indentUnit(true, 0), ' ');
      assert.strictEqual(indentUnit(true, 99), '        ');
      assert.strictEqual(indentUnit(true, 3.5), '   ');
      assert.strictEqual(indentUnit(true, Number.NaN), '  ');
      // What editor.options gives when tabSize is unresolved; the glue used to pass NaN for this.
      assert.strictEqual(indentUnit(true, undefined), '  ');
    });
  });

  suite('commonIndent', () => {
    test('should take the shallowest indent as a string, not a width', () => {
      assert.strictEqual(commonIndent(['    %h2 a', '  .card', '    %p b']), '  ');
      assert.strictEqual(commonIndent(['\t\t%h2 a', '\t.card']), '\t');
    });

    test('should ignore blank lines', () => {
      assert.strictEqual(commonIndent(['  %p a', '', '  %p b']), '  ');
    });

    // Nothing is safe to assume when tabs and spaces are mixed, so nothing is claimed.
    test('should give up on mixed tabs and spaces', () => {
      assert.strictEqual(commonIndent(['\t%p a', '  %p b']), '');
    });

    test('should return an empty string for column zero and for no lines', () => {
      assert.strictEqual(commonIndent(['%p a', '  %p b']), '');
      assert.strictEqual(commonIndent([]), '');
      assert.strictEqual(commonIndent(['', '  ']), '');
    });
  });

  suite('indentLines', () => {
    test('should prefix every non-blank line with the unit', () => {
      assert.deepStrictEqual(indentLines(['  .card', '    %h2 a'], '  '), ['    .card', '      %h2 a']);
      assert.deepStrictEqual(indentLines(['\t.card'], '\t'), ['\t\t.card']);
    });

    // A blank line gaining an indent would be trailing whitespace, which haml-lint reports.
    test('should leave blank lines empty', () => {
      assert.deepStrictEqual(indentLines(['  %p a', '', '  %p b'], '  '), ['    %p a', '', '    %p b']);
      assert.deepStrictEqual(indentLines(['   '], '  '), ['   ']);
    });
  });

  suite('dedentLines', () => {
    test('should remove only the common prefix', () => {
      assert.deepStrictEqual(dedentLines(['  .card', '    %h2 a']), ['.card', '  %h2 a']);
      assert.deepStrictEqual(dedentLines(['\t\t.card', '\t\t\t%h2 a']), ['.card', '\t%h2 a']);
    });

    test('should leave blank lines empty and column-zero lines alone', () => {
      assert.deepStrictEqual(dedentLines(['  %p a', '', '  %p b']), ['%p a', '', '%p b']);
      assert.deepStrictEqual(dedentLines(['.card', '  %h2 a']), ['.card', '  %h2 a']);
    });

    test('should change nothing when tabs and spaces are mixed', () => {
      assert.deepStrictEqual(dedentLines(['\t%p a', '  %p b']), ['\t%p a', '  %p b']);
    });
  });

  // isBlankText counts space and tab only, matching a LineSnapshot's firstNonWhitespaceCharacterIndex.
  // Under the old trim() definition a NBSP line was blank *and* reported indent 0, which made its
  // indent width infinite for a line that renders as content.
  suite('exotic whitespace', () => {
    test('should treat a line of NBSP as content, not as blank', () => {
      assert.strictEqual(commonIndent(['  %p', '\u00a0']), '');
    });
  });
});
