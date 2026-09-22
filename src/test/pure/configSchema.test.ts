import * as assert from 'node:assert';
import {
  DEFAULT_COMPLETIONS_DATA_ATTRIBUTES,
  DEFAULT_COMPLETIONS_PARTIALS,
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_FORMATTER,
  DEFAULT_LINT_RUN,
  DEFAULT_SNIPPETS_RAILS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_USE_BUNDLER,
  MAX_DEBOUNCE_MS,
  MAX_TIMEOUT_MS,
  MIN_DEBOUNCE_MS,
  MIN_TIMEOUT_MS,
  normalizeConfig
} from '../../configSchema';

suite('configSchema Test Suite', () => {
  test('should fall back to defaults for an empty object', () => {
    const config = normalizeConfig({});
    assert.strictEqual(config.lintRun, DEFAULT_LINT_RUN);
    assert.strictEqual(config.lintDebounceMs, DEFAULT_DEBOUNCE_MS);
    assert.deepStrictEqual(config.lintExclude, []);
    assert.strictEqual(config.formatter, DEFAULT_FORMATTER);
    assert.strictEqual(config.executablePath, null);
    assert.strictEqual(config.useBundler, DEFAULT_USE_BUNDLER);
    assert.strictEqual(config.configPath, null);
    assert.strictEqual(config.timeoutMs, DEFAULT_TIMEOUT_MS);
    assert.strictEqual(config.snippetsRails, DEFAULT_SNIPPETS_RAILS);
    assert.strictEqual(config.completionsPartials, DEFAULT_COMPLETIONS_PARTIALS);
    assert.strictEqual(config.completionsDataAttributes, DEFAULT_COMPLETIONS_DATA_ATTRIBUTES);
  });

  test('should keep valid values', () => {
    const config = normalizeConfig({
      lintRun: 'onType',
      lintDebounceMs: 250,
      lintExclude: ['**/vendor/**'],
      formatter: 'all',
      executablePath: '/opt/haml-lint',
      useBundler: 'never',
      configPath: '/w/.haml-lint.yml',
      timeoutMs: 30000,
      snippetsRails: 'off',
      completionsPartials: false,
      completionsDataAttributes: false
    });
    assert.strictEqual(config.lintRun, 'onType');
    assert.strictEqual(config.lintDebounceMs, 250);
    assert.deepStrictEqual(config.lintExclude, ['**/vendor/**']);
    assert.strictEqual(config.formatter, 'all');
    assert.strictEqual(config.executablePath, '/opt/haml-lint');
    assert.strictEqual(config.useBundler, 'never');
    assert.strictEqual(config.configPath, '/w/.haml-lint.yml');
    assert.strictEqual(config.timeoutMs, 30000);
    assert.strictEqual(config.snippetsRails, 'off');
    assert.strictEqual(config.completionsPartials, false);
    assert.strictEqual(config.completionsDataAttributes, false);
  });

  test('should fall back for non-boolean values of a boolean setting', () => {
    for (const value of ['false', 0, 1, null, {}, []]) {
      const label = JSON.stringify(value);
      assert.strictEqual(normalizeConfig({ completionsPartials: value }).completionsPartials, DEFAULT_COMPLETIONS_PARTIALS, label);
      assert.strictEqual(normalizeConfig({ completionsDataAttributes: value }).completionsDataAttributes, DEFAULT_COMPLETIONS_DATA_ATTRIBUTES, label);
    }
  });

  test('should clamp debounce and timeout to their bounds', () => {
    assert.strictEqual(normalizeConfig({ lintDebounceMs: -1 }).lintDebounceMs, MIN_DEBOUNCE_MS);
    assert.strictEqual(normalizeConfig({ lintDebounceMs: 999999 }).lintDebounceMs, MAX_DEBOUNCE_MS);
    assert.strictEqual(normalizeConfig({ timeoutMs: 0 }).timeoutMs, MIN_TIMEOUT_MS);
    assert.strictEqual(normalizeConfig({ timeoutMs: 999999999 }).timeoutMs, MAX_TIMEOUT_MS);
  });

  test('should reject NaN, Infinity and non-numbers for numeric settings', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, '500', null, {}, []]) {
      assert.strictEqual(normalizeConfig({ lintDebounceMs: value }).lintDebounceMs, DEFAULT_DEBOUNCE_MS, JSON.stringify(value));
      assert.strictEqual(normalizeConfig({ timeoutMs: value }).timeoutMs, DEFAULT_TIMEOUT_MS, JSON.stringify(value));
    }
  });

  test('should fall back for values outside the enums', () => {
    assert.strictEqual(normalizeConfig({ lintRun: 'sometimes' }).lintRun, DEFAULT_LINT_RUN);
    assert.strictEqual(normalizeConfig({ formatter: 'aggressive' }).formatter, DEFAULT_FORMATTER);
    assert.strictEqual(normalizeConfig({ useBundler: 'maybe' }).useBundler, DEFAULT_USE_BUNDLER);
    assert.strictEqual(normalizeConfig({ lintRun: 42 }).lintRun, DEFAULT_LINT_RUN);
    assert.strictEqual(normalizeConfig({ snippetsRails: 'yes' }).snippetsRails, DEFAULT_SNIPPETS_RAILS);
    assert.strictEqual(normalizeConfig({ snippetsRails: true }).snippetsRails, DEFAULT_SNIPPETS_RAILS);
  });

  test('should treat blank paths as unset', () => {
    assert.strictEqual(normalizeConfig({ executablePath: '' }).executablePath, null);
    assert.strictEqual(normalizeConfig({ executablePath: '   ' }).executablePath, null);
    assert.strictEqual(normalizeConfig({ configPath: '\t' }).configPath, null);
    assert.strictEqual(normalizeConfig({ executablePath: 42 }).executablePath, null);
  });

  test('should trim surrounding whitespace from paths', () => {
    assert.strictEqual(normalizeConfig({ executablePath: '  /opt/haml-lint  ' }).executablePath, '/opt/haml-lint');
  });

  test('should drop non-string and blank entries from lintExclude', () => {
    assert.deepStrictEqual(normalizeConfig({ lintExclude: ['a', 42, '', '  ', null, 'b'] }).lintExclude, ['a', 'b']);
    assert.deepStrictEqual(normalizeConfig({ lintExclude: 'not an array' }).lintExclude, []);
  });

  // A glob is matched character for character, so `"vendor/** "` - a space left behind in
  // settings.json - excluded nothing, and nothing said so.
  test('should trim the lintExclude entries it keeps', () => {
    assert.deepStrictEqual(normalizeConfig({ lintExclude: [' vendor/** ', '\tapp/views/legacy/*.haml'] }).lintExclude, [
      'vendor/**',
      'app/views/legacy/*.haml'
    ]);
  });
});
