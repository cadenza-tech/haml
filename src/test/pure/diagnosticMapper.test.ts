import * as assert from 'node:assert';
import { linterDocUrl, mapOffense, mapOffenses } from '../../pure/diagnosticMapper';
import type { DocumentSnapshot } from '../../pure/textModel';
import type { Offense } from '../../types';
import { snapshotOfLines } from '../support/snapshot';

const snapshot = (...lines: string[]): DocumentSnapshot => snapshotOfLines(lines);

function offense(overrides: Partial<Offense> = {}): Offense {
  return { line: 1, severity: 'warning', message: 'm', ...overrides };
}

suite('pure/diagnosticMapper Test Suite', () => {
  test('should convert a 1-based line to a 0-based range covering the code', () => {
    const spec = mapOffense(offense({ line: 2 }), snapshot('%div', '  %p hello', '%span'));
    assert.deepStrictEqual(spec.start, { line: 1, character: 2 });
    assert.deepStrictEqual(spec.end, { line: 1, character: 10 });
  });

  test('should skip leading indentation', () => {
    const spec = mapOffense(offense({ line: 1 }), snapshot('      %div'));
    assert.strictEqual(spec.start.character, 6);
  });

  // TrailingWhitespace and FinalNewline report exactly this shape, and skipping the indentation
  // would collapse the range to zero width, which VS Code does not render.
  test('should never produce a zero-width range on a whitespace-only line', () => {
    const spec = mapOffense(offense({ line: 1 }), snapshot('    ', '%div'));
    assert.deepStrictEqual(spec.start, { line: 0, character: 0 });
    assert.deepStrictEqual(spec.end, { line: 0, character: 4 });
  });

  test('should extend an empty line into the next line', () => {
    const spec = mapOffense(offense({ line: 2 }), snapshot('%div', '', '%span'));
    assert.deepStrictEqual(spec.start, { line: 1, character: 0 });
    assert.deepStrictEqual(spec.end, { line: 2, character: 0 });
  });

  test('should extend an empty final line backwards', () => {
    const spec = mapOffense(offense({ line: 2 }), snapshot('%div', ''));
    assert.deepStrictEqual(spec.start, { line: 0, character: 4 });
    assert.deepStrictEqual(spec.end, { line: 1, character: 0 });
  });

  test('should clamp line 0, which haml-lint uses for file-level errors', () => {
    const spec = mapOffense(offense({ line: 0 }), snapshot('%div'));
    assert.strictEqual(spec.start.line, 0);
  });

  test('should clamp a line past the end of the buffer after an edit race', () => {
    const spec = mapOffense(offense({ line: 999 }), snapshot('%div', '%span'));
    assert.strictEqual(spec.start.line, 1);
    assert.strictEqual(spec.end.line, 1);
  });

  test('should carry severity through', () => {
    assert.strictEqual(mapOffense(offense({ severity: 'error' }), snapshot('%div')).severity, 'error');
    assert.strictEqual(mapOffense(offense({ severity: 'warning' }), snapshot('%div')).severity, 'warning');
  });

  test('should attach a documentation link when the linter is known', () => {
    const spec = mapOffense(offense({ linterName: 'LineLength' }), snapshot('%div'));
    assert.deepStrictEqual(spec.code, {
      value: 'LineLength',
      target: 'https://github.com/sds/haml-lint/blob/main/lib/haml_lint/linter/README.md#linelength'
    });
  });

  test('should omit the code when haml-lint reported no linter', () => {
    assert.strictEqual(mapOffense(offense(), snapshot('%div')).code, undefined);
  });

  test('should lowercase the anchor, matching GitHub heading anchors', () => {
    assert.strictEqual(linterDocUrl('RuboCop'), 'https://github.com/sds/haml-lint/blob/main/lib/haml_lint/linter/README.md#rubocop');
  });

  test('should map every offense', () => {
    const specs = mapOffenses([offense({ line: 1 }), offense({ line: 2 })], snapshot('%div', '%span'));
    assert.strictEqual(specs.length, 2);
  });

  // An autocorrect run concatenates two passes, and a linter it may not correct under `-a` -
  // SpaceBeforeScript, EmptyScript - records the same offense in both. With no column to tell them
  // apart, the panel showed the entry twice after a format-on-save and once after opening the file.
  test('should show an offense the report lists twice only once', () => {
    const repeated = offense({ line: 2, message: 'The - symbol should have one space', linterName: 'SpaceBeforeScript' });
    const specs = mapOffenses([repeated, offense({ line: 1 }), { ...repeated }], snapshot('%div', '  -foo'));
    assert.deepStrictEqual(
      specs.map((spec) => [spec.start.line, spec.message]),
      [
        [1, 'The - symbol should have one space'],
        [0, 'm']
      ]
    );
  });

  // The line the offense names and the line it is drawn on are not the same thing: a correcting pass
  // records pre-edit line numbers, so two of them can land past the end of the buffer and clamp onto
  // the same line. Told apart by the line they name, the panel then draws one squiggle twice.
  test('should show one squiggle for offenses that clamp onto the same line', () => {
    const past = offense({ line: 9, message: 'm', linterName: 'RuboCop' });
    const specs = mapOffenses([past, { ...past, line: 10 }], snapshot('%div', '%span'));
    assert.deepStrictEqual(
      specs.map((spec) => [spec.start.line, spec.message]),
      [[1, 'm']]
    );
  });

  test('should keep offenses that differ in line, linter, severity or message', () => {
    const base = offense({ line: 1, message: 'm', linterName: 'A' });
    const variants = [base, { ...base, line: 2 }, { ...base, linterName: 'B' }, { ...base, severity: 'error' as const }, { ...base, message: 'n' }];
    assert.strictEqual(mapOffenses(variants, snapshot('%div', '%span')).length, variants.length);
  });

  test('should return nothing for no offenses', () => {
    assert.deepStrictEqual(mapOffenses([], snapshot('%div')), []);
  });

  test('should survive a single empty line', () => {
    const spec = mapOffense(offense({ line: 1 }), snapshot(''));
    assert.deepStrictEqual(spec.start, { line: 0, character: 0 });
    assert.deepStrictEqual(spec.end, { line: 0, character: 0 });
  });
});
