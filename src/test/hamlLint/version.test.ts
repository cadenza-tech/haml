import * as assert from 'node:assert';
import { gte, parseVersion, supportsHamlAutocorrect } from '../../hamlLint/version';

suite('hamlLint/version Test Suite', () => {
  suite('parseVersion', () => {
    test('should parse a bare version line', () => {
      assert.deepStrictEqual(parseVersion('0.76.0'), [0, 76, 0]);
      assert.deepStrictEqual(parseVersion('0.76.0\n'), [0, 76, 0]);
    });

    test('should pick the version out of verbose output', () => {
      assert.deepStrictEqual(parseVersion('haml-lint 0.73.1\nhaml 6.3.0\nruby 3.4.5'), [0, 73, 1]);
    });

    test('should return null when there is no version', () => {
      for (const input of ['', 'no version here', '1.2', undefined, null, 42]) {
        assert.strictEqual(parseVersion(input), null, JSON.stringify(input));
      }
    });
  });

  suite('gte', () => {
    test('should compare each component in order', () => {
      assert.strictEqual(gte([0, 76, 0], [0, 74, 0]), true);
      assert.strictEqual(gte([0, 74, 0], [0, 74, 0]), true);
      assert.strictEqual(gte([0, 73, 9], [0, 74, 0]), false);
      assert.strictEqual(gte([1, 0, 0], [0, 99, 99]), true);
      assert.strictEqual(gte([0, 74, 1], [0, 74, 2]), false);
    });
  });

  suite('feature gates', () => {
    // HAML-level autocorrect landed in 0.74.0; below that only RuboCop cops are corrected,
    // which would rewrite the Ruby inside a view while leaving the Haml untouched.
    test('should gate haml autocorrect at 0.74.0', () => {
      assert.strictEqual(supportsHamlAutocorrect([0, 73, 9]), false);
      assert.strictEqual(supportsHamlAutocorrect([0, 74, 0]), true);
      assert.strictEqual(supportsHamlAutocorrect([0, 76, 0]), true);
      assert.strictEqual(supportsHamlAutocorrect(null), false);
    });
  });
});
