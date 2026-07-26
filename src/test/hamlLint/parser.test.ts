import * as assert from 'node:assert';
import { parseReport } from '../../hamlLint/parser';

function report(files: unknown, metadata?: unknown): string {
  return JSON.stringify({ metadata: metadata ?? { haml_lint_version: '0.76.0' }, files, summary: {} });
}

suite('hamlLint/parser Test Suite', () => {
  test('should parse a well formed report', () => {
    const result = parseReport(
      report([
        {
          path: 'app/views/x.haml',
          offenses: [
            {
              severity: 'warning',
              message: 'Line is too long',
              corrected: false,
              correctable: true,
              location: { line: 502 },
              linter_name: 'LineLength'
            }
          ]
        }
      ])
    );
    assert.ok(result.ok);
    // `corrected` and `correctable` are present in the payload and deliberately dropped: nothing
    // reads them, and deepStrictEqual is what proves the parser does not smuggle them through.
    assert.deepStrictEqual(result.report.offenses, [{ line: 502, severity: 'warning', message: 'Line is too long', linterName: 'LineLength' }]);
  });

  test('should read the line from the nested location object, not a flat line key', () => {
    const result = parseReport(report([{ path: 'x', offenses: [{ severity: 'warning', message: 'm', line: 99, location: { line: 7 } }] }]));
    assert.ok(result.ok);
    assert.strictEqual(result.report.offenses[0]?.line, 7);
  });

  test('should omit linterName when haml-lint omits it', () => {
    const result = parseReport(report([{ path: 'x', offenses: [{ severity: 'error', message: 'syntax error', location: { line: 1 } }] }]));
    assert.ok(result.ok);
    assert.strictEqual(result.report.offenses[0]?.linterName, undefined);
    assert.ok(!('linterName' in (result.report.offenses[0] as object)));
  });

  test('should parse an offense from haml-lint below 0.76, which emits no correctable keys', () => {
    const result = parseReport(
      report([{ path: 'x', offenses: [{ severity: 'warning', message: 'm', location: { line: 3 }, linter_name: 'TagName' }] }])
    );
    assert.ok(result.ok);
    assert.deepStrictEqual(result.report.offenses, [{ line: 3, severity: 'warning', message: 'm', linterName: 'TagName' }]);
  });

  test('should return an empty offense list for a clean document', () => {
    const result = parseReport(report([]));
    assert.ok(result.ok);
    assert.deepStrictEqual(result.report.offenses, []);
  });

  test('should merge offenses from every file entry', () => {
    const result = parseReport(
      report([
        { path: 'a', offenses: [{ severity: 'warning', message: 'one', location: { line: 1 } }] },
        { path: 'b', offenses: [{ severity: 'error', message: 'two', location: { line: 2 } }] }
      ])
    );
    assert.ok(result.ok);
    assert.strictEqual(result.report.offenses.length, 2);
  });

  test('should default an unknown severity to warning', () => {
    const result = parseReport(report([{ path: 'x', offenses: [{ severity: 'catastrophe', message: 'm', location: { line: 1 } }] }]));
    assert.ok(result.ok);
    assert.strictEqual(result.report.offenses[0]?.severity, 'warning');
  });

  test('should default a missing location to line 1', () => {
    const result = parseReport(report([{ path: 'x', offenses: [{ severity: 'error', message: 'm' }] }]));
    assert.ok(result.ok);
    assert.strictEqual(result.report.offenses[0]?.line, 1);
  });

  // A fractional line would survive the mapper's clamp and reach lineAt(), which rejects it.
  test('should default a non-integer line to 1', () => {
    const result = parseReport(report([{ path: 'x', offenses: [{ severity: 'error', message: 'm', location: { line: 2.5 } }] }]));
    assert.ok(result.ok);
    assert.strictEqual(result.report.offenses[0]?.line, 1);
  });

  test('should drop offenses whose message is missing or not a string', () => {
    const result = parseReport(
      report([
        { path: 'x', offenses: [{ severity: 'warning', location: { line: 1 } }, { severity: 'warning', message: 42, location: { line: 2 } }, 'nope'] }
      ])
    );
    assert.ok(result.ok);
    assert.deepStrictEqual(result.report.offenses, []);
  });

  test('should skip file entries that are not objects or lack an offenses array', () => {
    const result = parseReport(
      report([
        'nope',
        { path: 'x' },
        { path: 'y', offenses: 'no' },
        { path: 'z', offenses: [{ severity: 'warning', message: 'ok', location: { line: 1 } }] }
      ])
    );
    assert.ok(result.ok);
    assert.strictEqual(result.report.offenses.length, 1);
  });

  test('should fail on malformed json rather than salvaging a substring', () => {
    const polluted = 'Could not find gem\n{"files":[]}';
    const result = parseReport(polluted);
    assert.ok(!result.ok);
    assert.strictEqual(result.raw, polluted);
  });

  test('should fail on empty and whitespace-only input', () => {
    for (const input of ['', '   ', '\n\n']) {
      const result = parseReport(input);
      assert.ok(!result.ok, JSON.stringify(input));
    }
  });

  test('should fail when files is missing or not an array', () => {
    for (const payload of ['{}', '{"files":{}}', '[]', 'null', '"a string"']) {
      const result = parseReport(payload);
      assert.ok(!result.ok, payload);
    }
  });

  test('should tolerate a missing or malformed metadata block', () => {
    for (const metadata of [undefined, null, 'nope', {}, { haml_lint_version: 5 }]) {
      const result = parseReport(JSON.stringify({ metadata, files: [] }));
      assert.ok(result.ok, JSON.stringify(metadata));
      assert.deepStrictEqual(result.report.offenses, []);
    }
  });

  test('should never throw for non-string input', () => {
    for (const input of [undefined, null, 42, {}, []]) {
      const result = parseReport(input);
      assert.ok(!result.ok);
    }
  });
});
