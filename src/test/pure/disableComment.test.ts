import * as assert from 'node:assert';
import { DIAGNOSTIC_SOURCE } from '../../pure/diagnosticMapper';
import {
  buildDisableComment,
  type DiagnosticFacts,
  disableActionTitle,
  findBlockEnd,
  type InsertionSpec,
  linterNameOf,
  planDisableActions
} from '../../pure/disableComment';
import type { Eol } from '../../pure/textModel';
import { offsetOf, snapshotOfLines } from '../support/snapshot';

/** Applies both insertions so the tests assert the resulting Haml, not the coordinates. */
function apply(lines: string[], insertions: readonly InsertionSpec[], eol: Eol = '\n'): string[] {
  let text = lines.join(eol);
  // Apply from the bottom up so earlier offsets stay valid.
  for (const insertion of [...insertions].sort((a, b) => b.line - a.line || b.character - a.character)) {
    const offset = offsetOf(lines, insertion.line, insertion.character, eol);
    text = text.slice(0, offset) + insertion.text + text.slice(offset);
  }
  return text.split(eol);
}

suite('pure/disableComment Test Suite', () => {
  suite('findBlockEnd', () => {
    test('should return the line itself for a leaf', () => {
      assert.strictEqual(findBlockEnd(1, snapshotOfLines(['%div', '  %p text', '  %span'])), 1);
    });

    test('should include nested children', () => {
      assert.strictEqual(findBlockEnd(0, snapshotOfLines(['%div', '  %img', '  %span', '%footer'])), 2);
    });

    test('should include children across a blank line', () => {
      assert.strictEqual(findBlockEnd(0, snapshotOfLines(['%div', '  %img', '', '  %span', '%footer'])), 3);
    });

    test('should not swallow trailing blank lines', () => {
      assert.strictEqual(findBlockEnd(0, snapshotOfLines(['%div', '  %img', '', ''])), 1);
    });

    test('should stop at a sibling with the same indent', () => {
      assert.strictEqual(findBlockEnd(0, snapshotOfLines(['%div', '%span'])), 0);
    });

    test('should run to the end of the document', () => {
      assert.strictEqual(findBlockEnd(0, snapshotOfLines(['%div', '  %a', '  %b'])), 2);
    });

    test('should handle the last line', () => {
      assert.strictEqual(findBlockEnd(1, snapshotOfLines(['%div', '  %a'])), 1);
    });

    test('should treat deeper tab indentation as nesting', () => {
      assert.strictEqual(findBlockEnd(0, snapshotOfLines(['%div', '\t%img', '%footer'])), 1);
    });
  });

  suite('buildDisableComment', () => {
    // The regression this whole module exists for: children must survive the edit.
    test('should place enable after the block so nested lines are not swallowed', () => {
      const lines = ['%section', '  %div{ class: "x" }', '    %img{ src: "a.gif" }', '    %span Hello', '  %footer'];
      const result = apply(lines, buildDisableComment(1, 'AltText', snapshotOfLines(lines), '\n'));
      assert.deepStrictEqual(result, [
        '%section',
        '  -# haml-lint:disable AltText',
        '  %div{ class: "x" }',
        '    %img{ src: "a.gif" }',
        '    %span Hello',
        '  -# haml-lint:enable AltText',
        '  %footer'
      ]);
    });

    test('should wrap a leaf line tightly', () => {
      const lines = ['%div', '  %img', '%footer'];
      assert.deepStrictEqual(apply(lines, buildDisableComment(1, 'AltText', snapshotOfLines(lines), '\n')), [
        '%div',
        '  -# haml-lint:disable AltText',
        '  %img',
        '  -# haml-lint:enable AltText',
        '%footer'
      ]);
    });

    // A blank target - the shape TrailingWhitespace reports - has no indent of its own. Writing the
    // pair at column 0 would let the enable comment swallow `  %p b` out of the rendered output,
    // which is the exact failure this module's header describes.
    test('should indent the pair of a blank target so the following line is not swallowed', () => {
      const lines = ['%div', '  %p a', '  ', '  %p b'];
      assert.deepStrictEqual(apply(lines, buildDisableComment(2, 'TrailingWhitespace', snapshotOfLines(lines), '\n')), [
        '%div',
        '  %p a',
        '  -# haml-lint:disable TrailingWhitespace',
        '  ',
        '  -# haml-lint:enable TrailingWhitespace',
        '  %p b'
      ]);
    });

    test('should fall back to the preceding indent for a trailing blank target', () => {
      const lines = ['%div', '  %p a', '   '];
      assert.deepStrictEqual(apply(lines, buildDisableComment(2, 'TrailingWhitespace', snapshotOfLines(lines), '\n')), [
        '%div',
        '  %p a',
        '  -# haml-lint:disable TrailingWhitespace',
        '   ',
        '  -# haml-lint:enable TrailingWhitespace'
      ]);
    });

    test('should keep children separated by a blank line inside the block', () => {
      const lines = ['%div', '  %a', '', '  %b', '%footer'];
      assert.deepStrictEqual(apply(lines, buildDisableComment(0, 'X', snapshotOfLines(lines), '\n')), [
        '-# haml-lint:disable X',
        '%div',
        '  %a',
        '',
        '  %b',
        '-# haml-lint:enable X',
        '%footer'
      ]);
    });

    test('should append after the final line', () => {
      const lines = ['%div', '  %img'];
      assert.deepStrictEqual(apply(lines, buildDisableComment(0, 'X', snapshotOfLines(lines), '\n')), [
        '-# haml-lint:disable X',
        '%div',
        '  %img',
        '-# haml-lint:enable X'
      ]);
    });

    test('should handle the first line of the document', () => {
      const lines = ['%div', '%span'];
      assert.deepStrictEqual(apply(lines, buildDisableComment(0, 'X', snapshotOfLines(lines), '\n')), [
        '-# haml-lint:disable X',
        '%div',
        '-# haml-lint:enable X',
        '%span'
      ]);
    });

    test('should match the indentation of the target line', () => {
      const lines = ['%a', '    %deep', '%b'];
      const [disable, enable] = buildDisableComment(1, 'X', snapshotOfLines(lines), '\n');
      assert.ok(disable.text.startsWith('    -#'));
      assert.ok(enable.text.startsWith('    -#'));
    });

    test('should reuse tab indentation verbatim', () => {
      const lines = ['%a', '\t%deep', '%b'];
      const [disable] = buildDisableComment(1, 'X', snapshotOfLines(lines), '\n');
      assert.ok(disable.text.startsWith('\t-#'));
    });

    test('should use the document line ending', () => {
      const lines = ['%div', '%span'];
      const [disable] = buildDisableComment(0, 'X', snapshotOfLines(lines), '\r\n');
      assert.ok(disable.text.endsWith('\r\n'));
    });

    test('should put the separator first when appending past the last line', () => {
      const lines = ['%div'];
      const [, enable] = buildDisableComment(0, 'X', snapshotOfLines(lines), '\n');
      assert.ok(enable.text.startsWith('\n'));
      assert.strictEqual(enable.line, 0);
      assert.strictEqual(enable.character, 4);
    });
  });

  suite('disableActionTitle', () => {
    // haml-lint has no per-cop inline disable, so this must not claim to silence one cop.
    test('should say all cops for RuboCop', () => {
      assert.strictEqual(disableActionTitle('RuboCop'), 'Disable RuboCop (all cops) for this block');
    });

    test('should name the linter otherwise', () => {
      assert.strictEqual(disableActionTitle('LineLength'), 'Disable LineLength for this block');
    });
  });

  suite('linterNameOf', () => {
    test('should take a plain string code as the linter name', () => {
      assert.strictEqual(linterNameOf('LineLength'), 'LineLength');
    });

    // The shape diagnostics.ts actually produces: a code with a documentation target.
    test('should read the value out of a code object', () => {
      assert.strictEqual(linterNameOf({ value: 'AltText', target: 'https://example.test' }), 'AltText');
    });

    // Syntax and parse errors carry no linter, so nothing can be disabled for them.
    test('should return undefined when there is no linter to name', () => {
      for (const code of [undefined, null, 42, {}, []]) {
        assert.strictEqual(linterNameOf(code), undefined, JSON.stringify(code) ?? 'undefined');
      }
    });
  });

  suite('planDisableActions', () => {
    const facts = (overrides: Partial<DiagnosticFacts> = {}): DiagnosticFacts => ({
      source: DIAGNOSTIC_SOURCE,
      code: 'LineLength',
      line: 3,
      ...overrides
    });

    test('should plan one action per diagnostic, keeping the input index', () => {
      const plans = planDisableActions([facts(), facts({ line: 9, code: 'AltText' })]);
      assert.deepStrictEqual(plans, [
        { index: 0, line: 3, linterName: 'LineLength' },
        { index: 1, line: 9, linterName: 'AltText' }
      ]);
    });

    // haml-lint reports no column, so two offenses of one linter on one line are indistinguishable
    // and would offer the same comment twice.
    test('should offer one action per line and linter', () => {
      const plans = planDisableActions([facts(), facts()]);
      assert.strictEqual(plans.length, 1);
    });

    test('should keep the same linter on a different line', () => {
      const plans = planDisableActions([facts(), facts({ line: 4 })]);
      assert.strictEqual(plans.length, 2);
    });

    test('should keep a different linter on the same line', () => {
      const plans = planDisableActions([facts(), facts({ code: 'AltText' })]);
      assert.strictEqual(plans.length, 2);
    });

    // Writing a haml-lint directive for another extension's finding would silence nothing.
    test('should ignore diagnostics from anything but haml-lint', () => {
      assert.deepStrictEqual(planDisableActions([facts({ source: 'eslint' }), facts({ source: undefined })]), []);
    });

    test('should ignore diagnostics with no linter to disable', () => {
      assert.deepStrictEqual(planDisableActions([facts({ code: undefined })]), []);
    });
  });
});
