import * as assert from 'node:assert';
import { digestOf, isStale, type StalenessFacts, shouldPublishReport, shouldReuseReport } from '../../pure/publishDecision';

function facts(overrides: Partial<StalenessFacts> = {}): StalenessFacts {
  return { isClosed: false, versionBefore: 7, versionNow: 7, superseded: false, ...overrides };
}

suite('pure/publishDecision Test Suite', () => {
  suite('digestOf', () => {
    test('should give the same digest for the same text', () => {
      assert.strictEqual(digestOf('%p hello\n'), digestOf('%p hello\n'));
    });

    test('should give a different digest for different text', () => {
      assert.notStrictEqual(digestOf('%p hello\n'), digestOf('%p hello \n'));
    });

    test('should stay a fixed size whatever the input length', () => {
      assert.strictEqual(digestOf('x').length, digestOf('x'.repeat(500000)).length);
    });
  });

  suite('shouldReuseReport', () => {
    test('should reuse when the published report came from exactly this text', () => {
      assert.strictEqual(shouldReuseReport(digestOf('%p a\n'), '%p a\n', false), true);
    });

    test('should not reuse when the text moved on', () => {
      assert.strictEqual(shouldReuseReport(digestOf('%p a\n'), '%p b\n', false), false);
    });

    test('should not reuse when nothing has been published yet', () => {
      assert.strictEqual(shouldReuseReport(undefined, '%p a\n', false), false);
    });

    // A settings change alters the answer without altering the text, which is the whole reason
    // force exists: the digest cannot see it.
    test('should never reuse when the caller forces', () => {
      assert.strictEqual(shouldReuseReport(digestOf('%p a\n'), '%p a\n', true), false);
    });
  });

  suite('isStale', () => {
    test('should accept a document that has not moved', () => {
      assert.strictEqual(isStale(facts()), false);
    });

    test('should reject a document the user edited during the run', () => {
      assert.strictEqual(isStale(facts({ versionNow: 8 })), true);
    });

    test('should reject a closed document', () => {
      assert.strictEqual(isStale(facts({ isClosed: true })), true);
    });

    test('should reject a superseded run even at the same version', () => {
      assert.strictEqual(isStale(facts({ superseded: true })), true);
    });
  });

  suite('shouldPublishReport', () => {
    // "off" has to mean no diagnostics whatever produced them, including the report the single-pass
    // format run gets for free.
    test('should publish nothing when diagnostics are switched off', () => {
      assert.strictEqual(shouldPublishReport(true, 'off'), false);
    });

    test('should publish for the modes that want diagnostics', () => {
      assert.strictEqual(shouldPublishReport(true, 'onSave'), true);
      assert.strictEqual(shouldPublishReport(true, 'onType'), true);
    });

    test('should publish nothing when there is no report', () => {
      assert.strictEqual(shouldPublishReport(false, 'onSave'), false);
    });
  });
});
