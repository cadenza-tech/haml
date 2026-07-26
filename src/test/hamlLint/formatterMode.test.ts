import * as assert from 'node:assert';
import { needsVersionProbe, resolveFormatterMode } from '../../hamlLint/formatterMode';
import type { SemVerTriple } from '../../hamlLint/version';

/** Counts probes so "this mode never spawns anything" is an assertion, not a claim. */
function countingProbe(version: SemVerTriple | null): { probe: () => Promise<SemVerTriple | null>; calls: () => number } {
  let calls = 0;
  return {
    probe: async () => {
      calls++;
      return version;
    },
    calls: () => calls
  };
}

const TRUSTED = true;

suite('hamlLint/formatterMode Test Suite', () => {
  suite('needsVersionProbe', () => {
    test('should only be needed for auto', () => {
      assert.strictEqual(needsVersionProbe('auto'), true);
      assert.strictEqual(needsVersionProbe('safe'), false);
      assert.strictEqual(needsVersionProbe('all'), false);
      assert.strictEqual(needsVersionProbe('none'), false);
    });
  });

  suite('resolveFormatterMode', () => {
    // The documented guarantee behind `haml.formatter: "none"` plus `haml.lint.run: "off"`: nothing
    // is spawned at all. The integration test this replaces could not assert the probe count.
    test('should short-circuit none and the explicit modes without probing', async () => {
      for (const [formatter, expected] of [
        ['none', 'none'],
        ['safe', 'safe'],
        ['all', 'all']
      ] as const) {
        const counting = countingProbe([0, 76, 0]);
        assert.strictEqual(await resolveFormatterMode(formatter, TRUSTED, counting.probe), expected);
        assert.strictEqual(counting.calls(), 0, `${formatter} must not probe`);
      }
    });

    test('should resolve auto to safe when the version supports haml autocorrect', async () => {
      const counting = countingProbe([0, 76, 0]);
      assert.strictEqual(await resolveFormatterMode('auto', TRUSTED, counting.probe), 'safe');
      assert.strictEqual(counting.calls(), 1);
    });

    test('should resolve auto to none below haml-lint 0.74.0', async () => {
      // Below 0.74.0 only RuboCop cops are corrected, which would rewrite the Ruby inside a view
      // while leaving the Haml untouched.
      const counting = countingProbe([0, 73, 9]);
      assert.strictEqual(await resolveFormatterMode('auto', TRUSTED, counting.probe), 'none');
    });

    test('should resolve auto to none when haml-lint cannot be found', async () => {
      const counting = countingProbe(null);
      assert.strictEqual(await resolveFormatterMode('auto', TRUSTED, counting.probe), 'none');
    });

    test('should resolve auto to none in an untrusted workspace without probing', async () => {
      const counting = countingProbe([0, 76, 0]);
      assert.strictEqual(await resolveFormatterMode('auto', false, counting.probe), 'none');
      assert.strictEqual(counting.calls(), 0, 'an untrusted workspace must not start Ruby');
    });
  });
});
