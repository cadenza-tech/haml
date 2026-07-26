import * as assert from 'node:assert';
import { buildAutocorrectArgs, buildLintArgs, buildVersionArgs } from '../../hamlLint/args';
import type { ResolvedFormatterMode } from '../../types';

const MODES: Exclude<ResolvedFormatterMode, 'none'>[] = ['safe', 'all'];
const CONFIGS: (string | null | undefined)[] = [undefined, null, '', '/w/.haml-lint.yml'];

/** The invariant these tests assert against. Lives here so it is checked, not just believed. */
function violatesStderrInvariant(args: readonly string[]): boolean {
  const autocorrects = args.includes('-a') || args.includes('-A');
  return autocorrects && !args.includes('--stderr');
}

suite('hamlLint/args Test Suite', () => {
  suite('buildLintArgs', () => {
    test('should request the json reporter and pipe the given path', () => {
      assert.deepStrictEqual(buildLintArgs({ stdinPath: '/w/a.haml' }), ['--reporter', 'json', '--stdin', '/w/a.haml']);
    });

    test('should pass configPath through as -c', () => {
      assert.deepStrictEqual(buildLintArgs({ stdinPath: '/w/a.haml', configPath: '/w/.haml-lint.yml' }), [
        '--reporter',
        'json',
        '-c',
        '/w/.haml-lint.yml',
        '--stdin',
        '/w/a.haml'
      ]);
    });

    test('should omit -c for null, undefined and empty configPath', () => {
      for (const configPath of [null, undefined, '']) {
        assert.ok(!buildLintArgs({ stdinPath: '/w/a.haml', configPath }).includes('-c'), `configPath=${String(configPath)}`);
      }
    });

    test('should never autocorrect', () => {
      const args = buildLintArgs({ stdinPath: '/w/a.haml' });
      assert.ok(!args.includes('-a'));
      assert.ok(!args.includes('-A'));
    });
  });

  suite('buildAutocorrectArgs', () => {
    test('should map safe to -a and all to -A', () => {
      assert.ok(buildAutocorrectArgs({ mode: 'safe', stdinPath: '/w/a.haml' }).includes('-a'));
      assert.ok(buildAutocorrectArgs({ mode: 'all', stdinPath: '/w/a.haml' }).includes('-A'));
    });

    test('should never pass --auto-correct-only, so haml-lint lints the corrected document too', () => {
      const args = buildAutocorrectArgs({ mode: 'safe', stdinPath: '/w/a.haml' });
      assert.ok(!args.includes('--auto-correct-only'), 'single pass must let haml-lint lint as well');
      assert.ok(args.includes('--reporter'));
      assert.ok(args.includes('json'));
    });

    // The invariant that keeps haml-lint from writing the corrected source straight to disk.
    test('should always pair an autocorrect flag with --stderr, for every combination', () => {
      let checked = 0;
      for (const mode of MODES) {
        for (const configPath of CONFIGS) {
          const args = buildAutocorrectArgs({ mode, stdinPath: '/w/a.haml', configPath });
          assert.ok(args.includes('--stderr'), `missing --stderr for ${mode}/${String(configPath)}`);
          assert.ok(!violatesStderrInvariant(args), `invariant violated for ${mode}/${String(configPath)}`);
          assert.ok(args.includes('--stdin'));
          checked++;
        }
      }
      assert.strictEqual(checked, MODES.length * CONFIGS.length);
    });

    test('should place the stdin path last so it is never read as another flag value', () => {
      const args = buildAutocorrectArgs({ mode: 'all', stdinPath: '/w/a.haml', configPath: '/w/c.yml' });
      assert.strictEqual(args[args.length - 1], '/w/a.haml');
      assert.strictEqual(args[args.length - 2], '--stdin');
    });
  });

  suite('violatesStderrInvariant', () => {
    test('should detect an autocorrect flag without --stderr', () => {
      assert.strictEqual(violatesStderrInvariant(['-a', '--stdin', 'x']), true);
      assert.strictEqual(violatesStderrInvariant(['-A', '--stdin', 'x']), true);
    });

    test('should accept args with no autocorrect flag', () => {
      assert.strictEqual(violatesStderrInvariant(buildLintArgs({ stdinPath: '/w/a.haml' })), false);
      assert.strictEqual(violatesStderrInvariant(buildVersionArgs()), false);
    });
  });

  suite('buildVersionArgs', () => {
    test('should ask only for the version', () => {
      assert.deepStrictEqual(buildVersionArgs(), ['--version']);
    });
  });
});
