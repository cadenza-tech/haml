import * as assert from 'node:assert';
import { buildFormatEdit, restoreEol } from '../../pure/editBuilder';
import type { Eol, TextEditSpec } from '../../pure/textModel';
import { offsetOf } from '../support/snapshot';

/** Applies a spec the way VS Code would, so the tests assert the resulting document. */
function apply(original: string, spec: TextEditSpec, eol: Eol): string {
  const lines = original.split(eol);
  const at = (line: number, character: number): number => offsetOf(lines, line, character, eol);
  return original.slice(0, at(spec.start.line, spec.start.character)) + spec.newText + original.slice(at(spec.end.line, spec.end.character));
}

suite('pure/editBuilder Test Suite', () => {
  suite('restoreEol', () => {
    test('should convert to CRLF', () => {
      assert.strictEqual(restoreEol('a\nb\n', '\r\n'), 'a\r\nb\r\n');
    });

    test('should convert to LF', () => {
      assert.strictEqual(restoreEol('a\r\nb\r\n', '\n'), 'a\nb\n');
    });

    test('should normalize mixed endings to the target', () => {
      assert.strictEqual(restoreEol('a\r\nb\nc', '\n'), 'a\nb\nc');
      assert.strictEqual(restoreEol('a\r\nb\nc', '\r\n'), 'a\r\nb\r\nc');
    });
  });

  suite('buildFormatEdit', () => {
    test('should return null when nothing changed', () => {
      assert.strictEqual(buildFormatEdit('%div\n%p\n', '%div\n%p\n', '\n'), null);
    });

    // Ruby normalizes its output to LF; without restoring CRLF every save would rewrite every line.
    test('should return null when only the reported line endings differ', () => {
      assert.strictEqual(buildFormatEdit('%div\r\n%p\r\n', '%div\n%p\n', '\r\n'), null);
    });

    test('should produce an edit that yields exactly the corrected text', () => {
      const original = '%div\n%p   \n%span\n';
      const corrected = '%div\n%p\n%span\n';
      const spec = buildFormatEdit(original, corrected, '\n');
      assert.ok(spec !== null);
      assert.strictEqual(apply(original, spec, '\n'), corrected);
    });

    test('should touch only the changed line, not the whole document', () => {
      const original = '%a\n%b\n%c\n%d\n%e\n';
      const corrected = '%a\n%b\n%C\n%d\n%e\n';
      const spec = buildFormatEdit(original, corrected, '\n');
      assert.ok(spec !== null);
      assert.strictEqual(spec.start.line, 2);
      assert.strictEqual(spec.end.line, 3);
      assert.strictEqual(spec.newText, '%C\n');
    });

    test('should handle a CRLF document end to end', () => {
      const original = '%div\r\n%p   \r\n';
      const corrected = '%div\n%p\n';
      const spec = buildFormatEdit(original, corrected, '\r\n');
      assert.ok(spec !== null);
      assert.strictEqual(apply(original, spec, '\r\n'), '%div\r\n%p\r\n');
      assert.ok(!spec.newText.includes('\n') || spec.newText.includes('\r\n'), 'must not introduce bare LF');
    });

    // VS Code counts \r\n, \n and \r alike when numbering lines, and a buffer can hold a stray odd
    // one. Splitting on the document eol would see 3 lines where the editor sees 4, and the edit
    // would land on the wrong lines. The spec is asserted directly: apply() above models a uniform
    // document, which is exactly the assumption this case exists to drop.
    test('should number lines the way the editor does when line endings are mixed', () => {
      const spec = buildFormatEdit('%a\r\n%b\n%p   \r\n', '%a\n%b\n%p\n', '\r\n');
      assert.deepStrictEqual(spec, {
        start: { line: 2, character: 0 },
        end: { line: 3, character: 0 },
        newText: '%p\r\n'
      });
    });

    // A zero-width edit would change nothing, and the digest published alongside it would describe
    // text the buffer never holds - re-spawning on every save from then on.
    test('should return null when only a stray line ending differs', () => {
      assert.strictEqual(buildFormatEdit('%a\r\n%b\n', '%a\n%b\n', '\r\n'), null);
    });

    test('should handle inserted lines', () => {
      const original = '%a\n%b\n';
      const corrected = '%a\n%new\n%b\n';
      const spec = buildFormatEdit(original, corrected, '\n');
      assert.ok(spec !== null);
      assert.strictEqual(apply(original, spec, '\n'), corrected);
    });

    test('should handle removed lines', () => {
      const original = '%a\n%gone\n%b\n';
      const corrected = '%a\n%b\n';
      const spec = buildFormatEdit(original, corrected, '\n');
      assert.ok(spec !== null);
      assert.strictEqual(apply(original, spec, '\n'), corrected);
    });

    test('should handle a change on the final line with no trailing newline', () => {
      const original = '%a\n%b';
      const corrected = '%a\n%B';
      const spec = buildFormatEdit(original, corrected, '\n');
      assert.ok(spec !== null);
      assert.strictEqual(apply(original, spec, '\n'), corrected);
    });

    test('should handle a missing final newline being added', () => {
      const original = '%a\n%b';
      const corrected = '%a\n%b\n';
      const spec = buildFormatEdit(original, corrected, '\n');
      assert.ok(spec !== null);
      assert.strictEqual(apply(original, spec, '\n'), corrected);
    });

    test('should handle trailing blank lines being removed', () => {
      const original = '%a\n\n\n\n';
      const corrected = '%a\n';
      const spec = buildFormatEdit(original, corrected, '\n');
      assert.ok(spec !== null);
      assert.strictEqual(apply(original, spec, '\n'), corrected);
    });

    test('should handle a change on the first line', () => {
      const original = '%a\n%b\n';
      const corrected = '%A\n%b\n';
      const spec = buildFormatEdit(original, corrected, '\n');
      assert.ok(spec !== null);
      assert.strictEqual(spec.start.line, 0);
      assert.strictEqual(apply(original, spec, '\n'), corrected);
    });

    test('should handle the whole document being rewritten', () => {
      const original = '%a\n%b\n';
      const corrected = '%x\n%y\n';
      const spec = buildFormatEdit(original, corrected, '\n');
      assert.ok(spec !== null);
      assert.strictEqual(apply(original, spec, '\n'), corrected);
    });

    test('should replace outright when no line is shared and there is no trailing newline', () => {
      const original = '%a\n%b';
      const corrected = '%x\n%y';
      const spec = buildFormatEdit(original, corrected, '\n');
      assert.ok(spec !== null);
      assert.deepStrictEqual(spec.start, { line: 0, character: 0 });
      assert.strictEqual(apply(original, spec, '\n'), corrected);
    });

    test('should handle a single line with no trailing newline', () => {
      const original = '%a';
      const spec = buildFormatEdit(original, '%b', '\n');
      assert.ok(spec !== null);
      assert.strictEqual(apply(original, spec, '\n'), '%b');
    });

    test('should handle the document becoming empty', () => {
      const original = '%a\n';
      const spec = buildFormatEdit(original, '', '\n');
      assert.ok(spec !== null);
      assert.strictEqual(apply(original, spec, '\n'), '');
    });

    test('should handle repeated identical lines without misaligning the diff', () => {
      const original = '%a\n%a\n%a\n';
      const corrected = '%a\n%b\n%a\n';
      const spec = buildFormatEdit(original, corrected, '\n');
      assert.ok(spec !== null);
      assert.strictEqual(apply(original, spec, '\n'), corrected);
    });

    test('should keep non-ascii content intact', () => {
      const original = '%p こんにちは   \n';
      const corrected = '%p こんにちは\n';
      const spec = buildFormatEdit(original, corrected, '\n');
      assert.ok(spec !== null);
      assert.strictEqual(apply(original, spec, '\n'), corrected);
    });
  });
});
