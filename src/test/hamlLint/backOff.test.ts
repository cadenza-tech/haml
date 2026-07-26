import * as assert from 'node:assert';
import { backOffUpdateFor, shouldSkipForBackOff, type TimeoutRecord } from '../../hamlLint/backOff';
import type { SpawnResult } from '../../hamlLint/process';

const RECORD: TimeoutRecord = { bytes: 19000, timeoutMs: 15000 };
const TIMED_OUT: SpawnResult = { ok: false, reason: 'timeout', stderr: '' };

suite('hamlLint/backOff Test Suite', () => {
  suite('shouldSkipForBackOff', () => {
    test('should never skip when nothing timed out', () => {
      assert.strictEqual(shouldSkipForBackOff(undefined, 999999, 1), false);
    });

    test('should skip the same document under the same budget', () => {
      assert.strictEqual(shouldSkipForBackOff(RECORD, 19000, 15000), true);
      assert.strictEqual(shouldSkipForBackOff(RECORD, 25000, 15000), true);
    });

    // The document shrank below what timed out, so it is worth another try.
    test('should run again for a smaller document', () => {
      assert.strictEqual(shouldSkipForBackOff(RECORD, 18999, 15000), false);
    });

    // Raising the timeout is exactly how a user says "wait longer for this file".
    test('should run again once the budget is raised', () => {
      assert.strictEqual(shouldSkipForBackOff(RECORD, 19000, 15001), false);
    });
  });

  suite('backOffUpdateFor', () => {
    test('should record the size and budget that timed out', () => {
      assert.deepStrictEqual(backOffUpdateFor(TIMED_OUT, 19000, 15000), { kind: 'record', record: RECORD });
    });

    // A process that finished proves the document is within budget whatever its exit code was.
    test('should clear the back-off for any finished run', () => {
      for (const code of [0, 65, 70]) {
        assert.deepStrictEqual(backOffUpdateFor({ ok: true, code, stdout: '', stderr: '', durationMs: 1 }, 19000, 15000), { kind: 'clear' });
      }
    });

    // A superseded onType tick says nothing about the document, so it must not record or lift.
    test('should leave the back-off alone for any other failure', () => {
      for (const reason of ['cancelled', 'enoent', 'overflow', 'spawn-error', 'untrusted'] as const) {
        assert.deepStrictEqual(backOffUpdateFor({ ok: false, reason, stderr: '' }, 19000, 15000), { kind: 'keep' }, reason);
      }
    });
  });
});
