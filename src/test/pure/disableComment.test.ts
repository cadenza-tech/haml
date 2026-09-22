import * as assert from 'node:assert';
import { findConstructEnd } from '../../pure/blockStructure';
import { DIAGNOSTIC_SOURCE } from '../../pure/diagnosticMapper';
import {
  buildDisableComment,
  type DiagnosticFacts,
  disableActionTitle,
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
  // The end of the block the pair is written around; src/test/pure/blockStructure has the rest.
  suite('findConstructEnd', () => {
    test('should return the line itself for a leaf', () => {
      assert.strictEqual(findConstructEnd(1, snapshotOfLines(['%div', '  %p text', '  %span'])), 1);
    });

    test('should include nested children', () => {
      assert.strictEqual(findConstructEnd(0, snapshotOfLines(['%div', '  %img', '  %span', '%footer'])), 2);
    });

    test('should include children across a blank line', () => {
      assert.strictEqual(findConstructEnd(0, snapshotOfLines(['%div', '  %img', '', '  %span', '%footer'])), 3);
    });

    test('should not swallow trailing blank lines', () => {
      assert.strictEqual(findConstructEnd(0, snapshotOfLines(['%div', '  %img', '', ''])), 1);
    });

    test('should stop at a sibling with the same indent', () => {
      assert.strictEqual(findConstructEnd(0, snapshotOfLines(['%div', '%span'])), 0);
    });

    test('should run to the end of the document', () => {
      assert.strictEqual(findConstructEnd(0, snapshotOfLines(['%div', '  %a', '  %b'])), 2);
    });

    test('should handle the last line', () => {
      assert.strictEqual(findConstructEnd(1, snapshotOfLines(['%div', '  %a'])), 1);
    });

    test('should treat deeper tab indentation as nesting', () => {
      assert.strictEqual(findConstructEnd(0, snapshotOfLines(['%div', '\t%img', '%footer'])), 1);
    });

    // Ruby's mid-block keywords sit at the opener's own indent, so "this line plus everything
    // deeper" stops short of them.
    test('should run through an else at the indent of the if it belongs to', () => {
      assert.strictEqual(findConstructEnd(0, snapshotOfLines(['- if a', '  %p x', '- elsif b', '  %p y', '- else', '  %p z', '%footer'])), 5);
    });

    test('should not take an identifier that merely starts like a keyword for one', () => {
      assert.strictEqual(findConstructEnd(0, snapshotOfLines(['- if a', '  %p x', '- else_branch = 1', '- when_ready'])), 1);
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

    // All four shapes below were checked against haml 6.4: a comment between an `if` body and its
    // `else`, or between a `begin` body and its `rescue`, is a syntax error; one between `case` and its
    // first `when` is too; and one between two `when`s renders nothing at all without saying why.
    test('should keep the enable comment out from between an if and its else', () => {
      const lines = ['- if a', '  %p x', '- elsif b', '  %p y', '- else', '  %p z', '%footer'];
      assert.deepStrictEqual(apply(lines, buildDisableComment(0, 'LineLength', snapshotOfLines(lines), '\n')), [
        '-# haml-lint:disable LineLength',
        '- if a',
        '  %p x',
        '- elsif b',
        '  %p y',
        '- else',
        '  %p z',
        '-# haml-lint:enable LineLength',
        '%footer'
      ]);
    });

    test('should wrap the whole conditional when the offense is on its else', () => {
      const lines = ['%div', '  - if a', '    %p x', '  - else', '    %p y', '  %footer'];
      assert.deepStrictEqual(apply(lines, buildDisableComment(3, 'LineLength', snapshotOfLines(lines), '\n')), [
        '%div',
        '  -# haml-lint:disable LineLength',
        '  - if a',
        '    %p x',
        '  - else',
        '    %p y',
        '  -# haml-lint:enable LineLength',
        '  %footer'
      ]);
    });

    test('should keep a rescue and an ensure with their begin', () => {
      const lines = ['- begin', '  %p x', '- rescue => e', '  %p y', '- ensure', '  %p z'];
      assert.deepStrictEqual(apply(lines, buildDisableComment(2, 'RuboCop', snapshotOfLines(lines), '\n')), [
        '-# haml-lint:disable RuboCop',
        ...lines,
        '-# haml-lint:enable RuboCop'
      ]);
    });

    // Haml takes `- when` one level under `- case` as well as beside it.
    test('should wrap the whole case when the offense is on a when nested under it', () => {
      const lines = ['- case a', '  - when 1', '    %p one', '  - when 2', '    %p two', '%footer'];
      assert.deepStrictEqual(apply(lines, buildDisableComment(3, 'LineLength', snapshotOfLines(lines), '\n')), [
        '-# haml-lint:disable LineLength',
        '- case a',
        '  - when 1',
        '    %p one',
        '  - when 2',
        '    %p two',
        '-# haml-lint:enable LineLength',
        '%footer'
      ]);
    });

    test('should wrap the whole case when the offense is on an else nested under it', () => {
      const lines = ['- y = case a', '  - when 1', '    %p one', '  - else', '    %p other', '%footer'];
      assert.deepStrictEqual(apply(lines, buildDisableComment(3, 'LineLength', snapshotOfLines(lines), '\n')), [
        '-# haml-lint:disable LineLength',
        ...lines.slice(0, 5),
        '-# haml-lint:enable LineLength',
        '%footer'
      ]);
    });

    test('should wrap the whole case when the offense is on a when beside it', () => {
      const lines = ['- case a', '- when 1', '  %p one', '- when 2', '  %p two', '%footer'];
      assert.deepStrictEqual(apply(lines, buildDisableComment(3, 'LineLength', snapshotOfLines(lines), '\n')), [
        '-# haml-lint:disable LineLength',
        ...lines.slice(0, 5),
        '-# haml-lint:enable LineLength',
        '%footer'
      ]);
    });

    // haml-lint reports lines inside a filter and on the later lines of a construct that spans
    // several, and a comment written there is not a comment: inside `:javascript` it is emitted into
    // the page, and between the lines of an attribute list or a continued script it is a syntax error.
    // Around the whole thing it silences the offense and stays valid (checked with haml-lint 0.76.0).
    suite('lines that belong to something larger', () => {
      const wrapped = (lines: string[], target: number): string[] =>
        apply(lines, buildDisableComment(target, 'LineLength', snapshotOfLines(lines), '\n'));
      const DISABLE = '-# haml-lint:disable LineLength';
      const ENABLE = '-# haml-lint:enable LineLength';

      test('should go around the filter for an offense inside its body', () => {
        const lines = ['%div', '  :javascript', '    if (x) {', '      const long = 1;', '    }', '  %p after'];
        assert.deepStrictEqual(wrapped(lines, 3), ['%div', `  ${DISABLE}`, ...lines.slice(1, 5), `  ${ENABLE}`, '  %p after']);
      });

      test('should take the outermost filter when its body holds something that looks like one', () => {
        const lines = [':ruby', '  x = [', '    :javascript', '      ]', '%p after'];
        assert.deepStrictEqual(wrapped(lines, 3), [DISABLE, ...lines.slice(0, 4), ENABLE, '%p after']);
      });

      test('should go around a tag whose attribute hash runs over several lines', () => {
        const lines = ["%div{ class: 'a',", "  title: 'long' }", '  %p child', '%p after'];
        assert.deepStrictEqual(wrapped(lines, 1), [DISABLE, ...lines.slice(0, 3), ENABLE, '%p after']);
      });

      // HTML-style attributes continue without any comma, so only the open bracket says so.
      test('should go around a tag whose html-style attributes run over several lines', () => {
        const lines = ["%div(class='a'", "  title='long')", '%p after'];
        assert.deepStrictEqual(wrapped(lines, 1), [DISABLE, ...lines.slice(0, 2), ENABLE, '%p after']);
      });

      test('should go around a script continued by commas, bare or after a tag', () => {
        const bare = ["= link_to 'x',", '  some_path,', "  class: 'long'", '%p after'];
        assert.deepStrictEqual(wrapped(bare, 2), [DISABLE, ...bare.slice(0, 3), ENABLE, '%p after']);
        const tagged = ["%p{ id: 'a' }= link_to 'x',", '  some_path', '%p after'];
        assert.deepStrictEqual(wrapped(tagged, 1), [DISABLE, ...tagged.slice(0, 2), ENABLE, '%p after']);
      });

      test('should go around a block continued by pipes', () => {
        const lines = ['%p before', "= link_to 'x', |", '  some_path,    |', "  class: 'b'    |", '%p after'];
        assert.deepStrictEqual(wrapped(lines, 2), ['%p before', DISABLE, ...lines.slice(1, 4), ENABLE, '%p after']);
      });

      // Every line of a pipe block is itself a pipe line, and a continuation line can look like a
      // script of its own, so the nearest line above that reaches the target is not the opener.
      test('should go back to the first line from the last line of a long construct', () => {
        const pipes = ["= link_to 'x', |", '  some_path,    |', "  class: 'b'    |", '%p after'];
        assert.deepStrictEqual(wrapped(pipes, 2), [DISABLE, ...pipes.slice(0, 3), ENABLE, '%p after']);
        const commas = ['= sum 1,', '  -1,', '  2', '%p after'];
        assert.deepStrictEqual(wrapped(commas, 2), [DISABLE, ...commas.slice(0, 3), ENABLE, '%p after']);
      });

      // TrailingWhitespace reports a whitespace-only line, and inside a filter that line is body too.
      test('should go around the filter for a blank line inside its body', () => {
        const lines = ['%div', '  :javascript', '    a();', '    ', '    b();', '  %p after'];
        assert.deepStrictEqual(wrapped(lines, 3), ['%div', `  ${DISABLE}`, ...lines.slice(1, 5), `  ${ENABLE}`, '  %p after']);
      });

      // `-#` and `==` start with a script marker without being scripts: a comment and interpolated text.
      test('should not take a comment or interpolated text ending in a comma for a script', () => {
        for (const first of ['-# first, second,', '== Hello #{name},']) {
          assert.deepStrictEqual(wrapped([first, '%p World'], 1), [first, DISABLE, '%p World', ENABLE], first);
        }
      });

      test('should end after continuation lines that are not indented under their opener', () => {
        const lines = ["%div{ class: 'a',", "title: 'long' }", '%p after'];
        assert.deepStrictEqual(wrapped(lines, 0), [DISABLE, ...lines.slice(0, 2), ENABLE, '%p after']);
      });

      // Text that merely ends in a comma continues nothing, after a tag as little as on its own, and
      // `==` is interpolated text however much it looks like a script.
      test('should not take plain text for a continuation', () => {
        for (const first of ['%p Hello,', '%p== Hello #{name},']) {
          assert.deepStrictEqual(wrapped([first, '%p World'], 1), [first, DISABLE, '%p World', ENABLE], first);
        }
      });

      // Spaced block parameters end in whitespace and a pipe, exactly like a pipe line. Haml tells
      // them apart (Parser#is_multiline?), and reading them as one would wrap the block from its opener.
      test('should not take block parameters for a pipe line', () => {
        const lines = ['- items.each do | item |', '  = foo + |', '    bar   |', '%p after'];
        assert.deepStrictEqual(wrapped(lines, 1), [lines[0], `  ${DISABLE}`, lines[1], lines[2], `  ${ENABLE}`, '%p after']);
      });

      // RuboCop aligns a nested hash under its first key, which puts a later line deeper than the one
      // above it. That shallower line continues the list as much as the target does.
      test('should find the opener past continuation lines that are shallower than the target', () => {
        const aligned = ['%a{ href: "/x",', '  data: { confirm: "x",', '          method: :delete } }', '%p after'];
        assert.deepStrictEqual(wrapped(aligned, 2), [DISABLE, ...aligned.slice(0, 3), ENABLE, '%p after']);
        const script = ['= link_to "x", path,', '    class: "a",', '  data: { a: 1,', '          b: 2 }', '%p after'];
        assert.deepStrictEqual(wrapped(script, 3), [DISABLE, ...script.slice(0, 4), ENABLE, '%p after']);
      });

      test('should find the opener past a blank line inside an attribute list', () => {
        const lines = ["%div{ class: 'a',", '', "  title: 'long' }", '%p after'];
        assert.deepStrictEqual(wrapped(lines, 2), [DISABLE, ...lines.slice(0, 3), ENABLE, '%p after']);
      });

      // Haml takes `[-:\w.#@]*` after the tag name, which is what Tailwind's `md:flex` relies on.
      test('should know a tag whose classes carry a colon or an at sign', () => {
        for (const head of ['.md:flex', '%div.md:flex#a', '.foo@bar']) {
          const lines = [`${head}{ a: 1,`, '  b: "long" }', '%p after'];
          assert.deepStrictEqual(wrapped(lines, 1), [DISABLE, ...lines.slice(0, 2), ENABLE, '%p after'], head);
        }
      });
    });

    test('should still wrap a line inside a branch on its own', () => {
      const lines = ['- if a', '  %p x', '- else', '  %p y'];
      assert.deepStrictEqual(apply(lines, buildDisableComment(1, 'LineLength', snapshotOfLines(lines), '\n')), [
        '- if a',
        '  -# haml-lint:disable LineLength',
        '  %p x',
        '  -# haml-lint:enable LineLength',
        '- else',
        '  %p y'
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

    // The preceding line is no guide when it is part of something larger. The last line of a filter
    // body is indented like the body, and a comment written at that indent is body too: under `:css`
    // the pair was rendered into the <style> element (haml 6.4). With a line below, that line decides
    // and the pair already lands outside; at the end of the document nothing does.
    test('should leave the filter before writing the pair of a trailing blank target', () => {
      const lines = [':css', '  a { }', '  '];
      assert.deepStrictEqual(apply(lines, buildDisableComment(2, 'TrailingWhitespace', snapshotOfLines(lines), '\n')), [
        ':css',
        '  a { }',
        '-# haml-lint:disable TrailingWhitespace',
        '  ',
        '-# haml-lint:enable TrailingWhitespace'
      ]);

      const nested = ['%div', '  :css', '    a { }', '    ', ''];
      assert.deepStrictEqual(apply(nested, buildDisableComment(3, 'TrailingWhitespace', snapshotOfLines(nested), '\n')), [
        '%div',
        '  :css',
        '    a { }',
        '  -# haml-lint:disable TrailingWhitespace',
        '    ',
        '  -# haml-lint:enable TrailingWhitespace',
        ''
      ]);
    });

    test('should leave a continued script before writing the pair of a trailing blank target', () => {
      const lines = ["= link_to 'x',", '    some_path', '    '];
      assert.deepStrictEqual(apply(lines, buildDisableComment(2, 'TrailingWhitespace', snapshotOfLines(lines), '\n')), [
        "= link_to 'x',",
        '    some_path',
        '-# haml-lint:disable TrailingWhitespace',
        '    ',
        '-# haml-lint:enable TrailingWhitespace'
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

    // The one value from the process's output that is written into the document. The report is not
    // trusted input - a workspace can put its own haml-lint on PATH - and a name holding a newline
    // would let it write a line of its choosing into the template.
    test('should refuse a name that is not a Ruby class name', () => {
      for (const name of ['LineLength\n= system("x")', 'Line Length', 'RuboCop; rm', '', '1st', 'Rails::Cop']) {
        assert.strictEqual(linterNameOf(name), undefined, JSON.stringify(name));
        assert.strictEqual(linterNameOf({ value: name, target: 'https://example.test' }), undefined, JSON.stringify(name));
      }
      assert.strictEqual(linterNameOf('RuboCop'), 'RuboCop');
      assert.strictEqual(linterNameOf('Space_Inside2'), 'Space_Inside2');
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
