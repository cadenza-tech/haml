import * as assert from 'node:assert';
import { failure, interpretResult, isSkip, looksLikeMissingGem, type RunFailureReason } from '../../hamlLint/outcome';
import type { SpawnResult } from '../../hamlLint/process';

const REPORT = JSON.stringify({ files: [{ path: 'a.haml', offenses: [{ severity: 'warning', message: 'm', location: { line: 3 } }] }] });

function finished(overrides: Partial<Extract<SpawnResult, { ok: true }>> = {}): SpawnResult {
  return { ok: true, code: 0, stdout: '', stderr: '', durationMs: 1, ...overrides };
}

suite('hamlLint/outcome Test Suite', () => {
  suite('isSkip', () => {
    // A skip is the extension's own decision, so it must not be reported as something going wrong.
    test('should classify our own decisions as skips', () => {
      for (const reason of ['untrusted', 'cancelled', 'not-eligible', 'timed-out-before'] as const) {
        assert.strictEqual(isSkip(reason), true, reason);
      }
    });

    test('should classify anything that actually went wrong as a failure', () => {
      for (const reason of ['enoent', 'timeout', 'overflow', 'spawn-error', 'exit', 'unparseable-report'] as const) {
        assert.strictEqual(isSkip(reason), false, reason);
      }
    });
  });

  suite('failure', () => {
    // kind is derived, never passed in, so the two can never disagree at a construction site.
    test('should derive kind from the reason', () => {
      const skipped = failure('cancelled');
      assert.strictEqual(skipped.ok === false && skipped.kind, 'skipped');
      const failed = failure('enoent');
      assert.strictEqual(failed.ok === false && failed.kind, 'failed');
    });

    test('should omit detail entirely when there is none', () => {
      const result = failure('cancelled');
      assert.ok(result.ok === false && !('detail' in result));
    });

    test('should carry the human sentence when there is one', () => {
      const result = failure('not-eligible', 'document is empty');
      assert.strictEqual(result.ok === false && result.detail, 'document is empty');
    });
  });

  suite('looksLikeMissingGem', () => {
    test('should recognise the bundler messages', () => {
      const cases = [
        // The lockfile names the gem but it was never installed.
        { code: 1, stderr: 'Could not find haml_lint-0.76.0 in locally installed gems' },
        // `useBundler: "always"` with a bundle that does not contain the gem: exit 127.
        { code: 127, stderr: 'bundler: command not found: haml-lint\nInstall missing gem executables with `bundle install`' },
        { code: 1, stderr: "Bundler::GemNotFound: can't find gem haml_lint" }
      ];
      for (const { code, stderr } of cases) {
        assert.strictEqual(looksLikeMissingGem(finished({ code, stderr })), true, stderr);
      }
    });

    test('should not fire for a normal report exit', () => {
      assert.strictEqual(looksLikeMissingGem(finished({ code: 65, stderr: 'Could not find' })), false);
    });

    test('should not fire for a lint failure whose stderr is unrelated', () => {
      assert.strictEqual(looksLikeMissingGem(finished({ code: 1, stderr: "undefined method `each' for nil (NoMethodError)" })), false);
    });

    test('should not fire for a spawn that never finished', () => {
      assert.strictEqual(looksLikeMissingGem({ ok: false, reason: 'enoent', stderr: 'Could not find' }), false);
    });
  });

  suite('interpretResult', () => {
    test('should read the report from stdout for a lint run', () => {
      const result = interpretResult(finished({ stdout: REPORT }), 'lint');
      assert.ok(result.ok);
      assert.strictEqual(result.outcome.report?.offenses.length, 1);
      assert.strictEqual(result.outcome.correctedSource, undefined, 'a lint run corrects nothing');
    });

    // Single pass: --stdin plus --stderr without --auto-correct-only puts the corrected source on
    // stdout and the JSON report on stderr.
    test('should read the report from stderr and the source from stdout for a format run', () => {
      const result = interpretResult(finished({ stdout: '%p fixed\n', stderr: REPORT }), 'format-and-lint');
      assert.ok(result.ok);
      assert.strictEqual(result.outcome.report?.offenses.length, 1);
      assert.strictEqual(result.outcome.correctedSource, '%p fixed\n');
    });

    test('should treat exit 65 as a report, not an error', () => {
      const result = interpretResult(finished({ code: 65, stdout: REPORT }), 'lint');
      assert.ok(result.ok);
    });

    test('should report an error exit code as exit, carrying the classification as detail', () => {
      const result = interpretResult(finished({ code: 70, stdout: '' }), 'lint');
      assert.ok(!result.ok);
      assert.strictEqual(result.reason, 'exit');
      assert.strictEqual(result.kind, 'failed');
      assert.ok(result.detail !== undefined && result.detail.length > 0);
    });

    // A shim that resolved to a real file but could not run the gem gives Node no ENOENT, so
    // without this the missing-executable notice never fires for an rbenv or asdf user.
    test('should report exit 127 as enoent so the missing-executable notice fires', () => {
      const result = interpretResult(finished({ code: 127, stderr: 'rbenv: haml-lint: command not found' }), 'lint', '/shims/haml-lint');
      assert.ok(!result.ok);
      assert.strictEqual(result.reason, 'enoent');
      assert.strictEqual(result.kind, 'failed');
      assert.strictEqual(result.command, '/shims/haml-lint');
    });

    // The single-pass mode reads the corrected source off stdout, so a 127 must fail before the
    // parse rather than look like a correction that emptied the buffer.
    test('should report exit 127 as enoent in the formatting mode too, with no corrected source', () => {
      const result = interpretResult(finished({ code: 127, stdout: '', stderr: 'rbenv: haml-lint: command not found' }), 'format-and-lint');
      assert.ok(!result.ok);
      assert.strictEqual(result.reason, 'enoent');
    });

    // The notice falls back to re-resolving when no command is carried, so this must stay omitted
    // rather than become an undefined entry the fallback would skip.
    test('should omit the command on exit 127 when the caller gave none', () => {
      const result = interpretResult(finished({ code: 127 }), 'lint');
      assert.ok(!result.ok);
      assert.strictEqual(result.reason, 'enoent');
      assert.ok(!('command' in result));
    });

    test('should report unparseable output rather than an empty report', () => {
      const result = interpretResult(finished({ stdout: 'Could not find gem\n{"files":[]}' }), 'lint');
      assert.ok(!result.ok);
      assert.strictEqual(result.reason, 'unparseable-report');
    });

    // In this mode the report shares stderr with every warning Ruby, Bundler or a gem prints. One
    // `warning:` line must not cost the user the format they asked for.
    test('should find the report among the warnings a format run shares stderr with', () => {
      const noisy = `warning: base64 was loaded from the standard library\n${REPORT}\nwarning: at exit\n`;
      const result = interpretResult(finished({ code: 65, stdout: '%p fixed\n', stderr: noisy }), 'format-and-lint');
      assert.ok(result.ok);
      assert.strictEqual(result.outcome.report?.offenses.length, 1);
      assert.strictEqual(result.outcome.correctedSource, '%p fixed\n');
    });

    // The report on stderr is the proof that stdout holds the corrected source and nothing else. A
    // wrapper that merges the streams (`2>&1`, a docker exec with a TTY) puts the report into stdout
    // instead, and writing that back would put JSON into the user's file - so without a report on
    // stderr nothing is applied, whatever else stderr says.
    test('should apply nothing when stderr carries no report', () => {
      for (const stderr of ['', 'WARN[0000] the attribute `version` is obsolete\n']) {
        const result = interpretResult(finished({ code: 65, stdout: `%p fixed\n${REPORT}\n`, stderr }), 'format-and-lint');
        assert.ok(!result.ok, JSON.stringify(stderr));
        assert.strictEqual(result.reason, 'unparseable-report');
      }
    });

    test('should apply nothing when stdout carries a report as well', () => {
      const both = `%p fixed\n${REPORT}\n`;
      const result = interpretResult(finished({ code: 65, stdout: both, stderr: both }), 'format-and-lint');
      assert.ok(!result.ok);
      assert.strictEqual(result.reason, 'unparseable-report');
    });

    test('should pass a spawn failure through with its own reason', () => {
      const result = interpretResult({ ok: false, reason: 'enoent', stderr: '', message: 'not found' }, 'lint');
      assert.ok(!result.ok);
      assert.strictEqual(result.reason, 'enoent');
      assert.strictEqual(result.detail, 'not found');
    });

    test('should classify an untrusted refusal as skipped', () => {
      const result = interpretResult({ ok: false, reason: 'untrusted', stderr: '' }, 'lint');
      assert.ok(!result.ok);
      assert.strictEqual(result.kind, 'skipped');
    });
  });

  suite('the failure vocabulary', () => {
    // diagnostics.ts branches on two of these; a typo used to be a silent no-op.
    test('should keep every reason a skip or a failure, never neither', () => {
      const reasons: RunFailureReason[] = [
        'untrusted',
        'enoent',
        'timeout',
        'cancelled',
        'overflow',
        'spawn-error',
        'not-eligible',
        'timed-out-before',
        'exit',
        'unparseable-report'
      ];
      for (const reason of reasons) {
        const result = failure(reason);
        assert.ok(result.ok === false && (result.kind === 'skipped' || result.kind === 'failed'), reason);
      }
    });
  });
});
