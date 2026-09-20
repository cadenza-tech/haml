import * as assert from 'node:assert';
import { extendBlock, findBlockStart } from '../../pure/blockStructure';
import { snapshotOfLines } from '../support/snapshot';

suite('pure/blockStructure Test Suite', () => {
  suite('extendBlock', () => {
    test('should take every deeper line and stop at a sibling', () => {
      assert.strictEqual(extendBlock(0, 0, snapshotOfLines(['%div', '  %p a', '    %b', '%footer'])), 2);
    });

    test('should run through every mid-block keyword at the block indent', () => {
      const lines = ['- begin', '  %p x', '- rescue => e', '  %p y', '- ensure', '  %p z', '%p after'];
      assert.strictEqual(extendBlock(0, 0, snapshotOfLines(lines)), 5);
    });

    // A keyword one level in belongs to something nested, which the deeper-line rule already covers;
    // one level out belongs to an enclosing construct and ends this block.
    test('should end at a mid-block keyword that is shallower than the block', () => {
      const lines = ['- if a', '  - if b', '    %p x', '- else', '  %p y'];
      assert.strictEqual(extendBlock(1, 2, snapshotOfLines(lines)), 2);
    });

    test('should not count trailing blank lines', () => {
      assert.strictEqual(extendBlock(0, 0, snapshotOfLines(['- if a', '  %p x', '- else', '  %p y', '', ''])), 3);
    });

    test('should extend over nothing for a blank target, whose indent is infinite', () => {
      assert.strictEqual(extendBlock(1, Number.POSITIVE_INFINITY, snapshotOfLines(['%div', '', '  %p a'])), 1);
    });

    // `in` is Ruby's, but Haml does not compile case/in, so it is not treated as one here either.
    test('should read only whole keywords Haml knows', () => {
      for (const line of ['- else_branch = 1', '- when_ready', '- rescued = true', '- ensure!', '- in Integer', '%p else', '= else']) {
        assert.strictEqual(extendBlock(0, 0, snapshotOfLines(['- if a', line])), 0, line);
      }
      for (const line of ['- else', '-else', '-  elsif b', '- when 1, 2', '- rescue', '- ensure']) {
        assert.strictEqual(extendBlock(0, 0, snapshotOfLines(['- if a', line])), 1, line);
      }
    });
  });

  suite('findBlockStart', () => {
    test('should stay put on a line that continues nothing', () => {
      assert.strictEqual(findBlockStart(1, snapshotOfLines(['- if a', '  %p x'])), 1);
    });

    test('should skip the branches in between on the way to the opener', () => {
      const lines = ['%p before', '- if a', '  %p x', '', '- elsif b', '  %p y', '- else', '  %p z'];
      assert.strictEqual(findBlockStart(6, snapshotOfLines(lines)), 1);
    });

    // Once Haml has seen a `- when` nested under its `- case`, the `- else` of that case sits at the
    // nested level too - and a comment above it makes the else branch vanish without an error.
    test('should find a case one level out from a when or an else, but nothing else out there', () => {
      assert.strictEqual(findBlockStart(3, snapshotOfLines(['= case a', '  - when 1', '    %p one', '  - when 2'])), 0);
      assert.strictEqual(findBlockStart(3, snapshotOfLines(['- case a', '  - when 1', '    %p one', '  - else'])), 0);
      assert.strictEqual(findBlockStart(1, snapshotOfLines(['%div', '  - when 1'])), 1);
      assert.strictEqual(findBlockStart(1, snapshotOfLines(['- case a', '  - rescue'])), 1);
    });

    // START_BLOCK_KEYWORD_REGEX in Haml's parser accepts an assignment in front of the keyword.
    test('should know a case whose value is assigned', () => {
      for (const opener of ['- y = case x', '- a, b = case x', '= @label = case x']) {
        assert.strictEqual(findBlockStart(3, snapshotOfLines([opener, '  - when 1', "    - 'one'", '  - when 2'])), 0, opener);
      }
      assert.strictEqual(findBlockStart(1, snapshotOfLines(['- y == case_insensitive', '  - when 1'])), 1);
    });

    test('should stay put when nothing above opens it', () => {
      assert.strictEqual(findBlockStart(0, snapshotOfLines(['- else', '  %p y'])), 0);
      assert.strictEqual(findBlockStart(1, snapshotOfLines(['    %p deeper', '- else'])), 1);
    });
  });
});
