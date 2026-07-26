import * as assert from 'node:assert';
import { classifyExitCode } from '../../hamlLint/exitCodes';

suite('hamlLint/exitCodes Test Suite', () => {
  test('should treat 0 as a valid report', () => {
    assert.strictEqual(classifyExitCode(0).kind, 'report');
  });

  // 65 is EX_DATAERR, which haml-lint returns whenever any offense reaches --fail-level.
  // The default fail level is `warning`, so a single warning produces 65 on a healthy run.
  test('should treat 65 as a valid report, not a failure', () => {
    assert.strictEqual(classifyExitCode(65).kind, 'report');
  });

  test('should treat usage, no-input, crash and config codes as errors', () => {
    for (const code of [64, 66, 70, 78]) {
      const result = classifyExitCode(code);
      assert.strictEqual(result.kind, 'error', `exit ${code}`);
      assert.ok(result.kind === 'error' && result.reason.includes(String(code)));
    }
  });

  test('should treat any other code as an error', () => {
    for (const code of [1, 2, 126, 255]) {
      assert.strictEqual(classifyExitCode(code).kind, 'error', `exit ${code}`);
    }
  });

  // cli.rb names only Sysexits constants, and an uncaught exception gives Ruby's 1, so a 127 never
  // came from haml-lint: it is the launcher saying it never started it. An rbenv shim produces it
  // whenever the Ruby selected for the linted directory lacks the gem, and the notice that names a
  // missing executable hangs off this kind rather than off the generic error branch.
  test('should give exit 127 its own not-found kind rather than a generic error', () => {
    const result = classifyExitCode(127);
    assert.strictEqual(result.kind, 'not-found');
    assert.ok(result.kind === 'not-found' && result.reason.includes('127'));
  });

  test('should treat a null code (killed by signal) as an error', () => {
    const result = classifyExitCode(null);
    assert.strictEqual(result.kind, 'error');
  });
});
