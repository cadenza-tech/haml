import * as assert from 'node:assert';
import { buildEnv, FALLBACK_LOCALE, RUBY_ENCODING_OPTION } from '../../hamlLint/env';

suite('hamlLint/env Test Suite', () => {
  // Without LANG, Ruby's default_external becomes US-ASCII and haml-lint exits 70 with
  // "invalid byte sequence" on any .haml containing non-ASCII text.
  test('should supply a UTF-8 locale when LANG is absent', () => {
    const env = buildEnv({});
    assert.strictEqual(env.LANG, FALLBACK_LOCALE);
    assert.strictEqual(env.LC_ALL, FALLBACK_LOCALE);
  });

  test('should treat an empty LANG as absent', () => {
    assert.strictEqual(buildEnv({ LANG: '' }).LANG, FALLBACK_LOCALE);
    assert.strictEqual(buildEnv({ LANG: '   ' }).LANG, FALLBACK_LOCALE);
  });

  test('should not override a locale the user already set', () => {
    const env = buildEnv({ LANG: 'ja_JP.UTF-8', LC_ALL: 'en_GB.UTF-8' });
    assert.strictEqual(env.LANG, 'ja_JP.UTF-8');
    assert.strictEqual(env.LC_ALL, 'en_GB.UTF-8');
  });

  test('should derive LC_ALL from LANG when only LANG is set', () => {
    assert.strictEqual(buildEnv({ LANG: 'ja_JP.UTF-8' }).LC_ALL, 'ja_JP.UTF-8');
  });

  // `bundle exec` passes -rbundler/setup through RUBYOPT; replacing it breaks the Bundler path.
  test('should append to RUBYOPT rather than replacing it', () => {
    assert.strictEqual(buildEnv({ RUBYOPT: '-rbundler/setup' }).RUBYOPT, `-rbundler/setup ${RUBY_ENCODING_OPTION}`);
  });

  test('should set RUBYOPT alone when it was unset or blank', () => {
    assert.strictEqual(buildEnv({}).RUBYOPT, RUBY_ENCODING_OPTION);
    assert.strictEqual(buildEnv({ RUBYOPT: '  ' }).RUBYOPT, RUBY_ENCODING_OPTION);
  });

  test('should set BUNDLE_GEMFILE only when a Gemfile was resolved', () => {
    assert.strictEqual(buildEnv({}).BUNDLE_GEMFILE, undefined);
    assert.strictEqual(buildEnv({}, { bundleGemfile: '/repo/Gemfile' }).BUNDLE_GEMFILE, '/repo/Gemfile');
  });

  test('should carry the rest of the parent environment through', () => {
    assert.strictEqual(buildEnv({ PATH: '/usr/bin', HOME: '/home/x' }).PATH, '/usr/bin');
    assert.strictEqual(buildEnv({ HOME: '/home/x' }).HOME, '/home/x');
  });

  test('should not mutate the environment it was given', () => {
    const base: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    buildEnv(base, { bundleGemfile: '/repo/Gemfile' });
    assert.deepStrictEqual(base, { PATH: '/usr/bin' });
  });
});
