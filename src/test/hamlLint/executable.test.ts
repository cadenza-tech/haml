import * as assert from 'node:assert';
import {
  findBundlerGemfile,
  type ResolveDeps,
  type ResolveInput,
  resolveConfigPath,
  resolveCwd,
  resolveInvocation,
  resolveOnPath
} from '../../hamlLint/executable';

const LOCK_WITH_HAML_LINT = ['GEM', '  remote: https://rubygems.org/', '  specs:', '    haml_lint (0.76.0)', '    rubocop (1.88.2)', ''].join('\n');
const LOCK_WITHOUT_HAML_LINT = ['GEM', '  specs:', '    rails (8.1.0)', ''].join('\n');

function deps(files: Record<string, string>, overrides: Partial<ResolveDeps> = {}): ResolveDeps {
  const platform = overrides.platform ?? 'darwin';
  // Windows filesystems are case-insensitive, so `fs.existsSync('X\\a.BAT')` finds `X\a.bat`.
  // Modelling that here matters: PATHEXT is conventionally uppercase while installers write
  // lowercase names, and an exact-match fake would fail a lookup that succeeds in production.
  const lookup = (candidate: string): string | undefined => {
    if (candidate in files) {
      return files[candidate];
    }
    if (platform !== 'win32') {
      return undefined;
    }
    const needle = candidate.toLowerCase();
    const hit = Object.keys(files).find((key) => key.toLowerCase() === needle);
    return hit === undefined ? undefined : files[hit];
  };

  return {
    fileExists: (path) => lookup(path) !== undefined,
    readFile: (path) => lookup(path) ?? null,
    platform: 'darwin',
    env: {},
    ...overrides
  };
}

function input(overrides: Partial<ResolveInput> = {}): ResolveInput {
  return { documentPath: '/repo/app/views/users/index.haml', workspaceFolderPath: '/repo', useBundler: 'auto', ...overrides };
}

suite('hamlLint/executable Test Suite', () => {
  suite('resolveCwd', () => {
    test('should use the workspace folder when only the root has a config', () => {
      assert.strictEqual(resolveCwd(input(), deps({ '/repo/.haml-lint.yml': '' })), '/repo');
    });

    // Pinning cwd to the workspace root breaks this case: haml-lint only searches upward,
    // so packages/web/.haml-lint.yml would never be found from /repo.
    test('should use the nearest ancestor holding the config in a monorepo', () => {
      const monorepo = input({ documentPath: '/repo/packages/web/app/views/x.haml' });
      const files = { '/repo/.haml-lint.yml': '', '/repo/packages/web/.haml-lint.yml': '' };
      assert.strictEqual(resolveCwd(monorepo, deps(files)), '/repo/packages/web');
    });

    test('should fall back to the workspace folder when no config exists', () => {
      assert.strictEqual(resolveCwd(input(), deps({})), '/repo');
    });

    test('should never search above the workspace folder', () => {
      assert.strictEqual(resolveCwd(input(), deps({ '/.haml-lint.yml': '' })), '/repo');
    });

    test('should use the document directory when there is no workspace folder', () => {
      const loose = input({ documentPath: '/tmp/scratch/a.haml', workspaceFolderPath: undefined });
      assert.strictEqual(resolveCwd(loose, deps({})), '/tmp/scratch');
    });

    test('should find a config in the document directory itself', () => {
      const files = { '/repo/app/views/users/.haml-lint.yml': '' };
      assert.strictEqual(resolveCwd(input(), deps(files)), '/repo/app/views/users');
    });
  });

  suite('resolveConfigPath', () => {
    test('should leave an absolute path untouched', () => {
      assert.strictEqual(resolveConfigPath('/etc/haml-lint.yml', '/repo', 'darwin'), '/etc/haml-lint.yml');
    });

    // The setting documents the workspace folder as the base. Leaving the path relative would hand
    // it to the process, which resolves it against cwd -- and resolveCwd moves cwd to whichever
    // directory owns .haml-lint.yml, so the same setting would mean a different file per document.
    test('should resolve a relative path against the workspace folder', () => {
      assert.strictEqual(resolveConfigPath('config/haml-lint.yml', '/repo', 'darwin'), '/repo/config/haml-lint.yml');
      assert.strictEqual(resolveConfigPath('../shared/haml-lint.yml', '/repo/app', 'darwin'), '/repo/shared/haml-lint.yml');
    });

    test('should treat a drive-qualified path as absolute on win32', () => {
      assert.strictEqual(resolveConfigPath('C:\\repo\\.haml-lint.yml', 'C:\\other', 'win32'), 'C:\\repo\\.haml-lint.yml');
      assert.strictEqual(resolveConfigPath('config\\haml-lint.yml', 'C:\\repo', 'win32'), 'C:\\repo\\config\\haml-lint.yml');
    });

    test('should pass the value through when there is no workspace folder', () => {
      assert.strictEqual(resolveConfigPath('haml-lint.yml', undefined, 'darwin'), 'haml-lint.yml');
    });

    test('should return null for an unset or blank setting', () => {
      for (const value of [null, undefined, '', '  ']) {
        assert.strictEqual(resolveConfigPath(value, '/repo', 'darwin'), null, `configPath=${String(value)}`);
      }
    });
  });

  suite('findBundlerGemfile', () => {
    // A Gemfile alone is not enough: most Rails apps have one without haml_lint, and
    // `bundle exec haml-lint` then fails with "Could not find gem" instead of ENOENT.
    test('should require haml_lint in Gemfile.lock under auto', () => {
      const withIt = deps({ '/repo/Gemfile': '', '/repo/Gemfile.lock': LOCK_WITH_HAML_LINT });
      const withoutIt = deps({ '/repo/Gemfile': '', '/repo/Gemfile.lock': LOCK_WITHOUT_HAML_LINT });
      assert.strictEqual(findBundlerGemfile(input(), withIt), '/repo/Gemfile');
      assert.strictEqual(findBundlerGemfile(input(), withoutIt), null);
    });

    test('should return null under auto when there is no lock file', () => {
      assert.strictEqual(findBundlerGemfile(input(), deps({ '/repo/Gemfile': '' })), null);
    });

    test('should accept any Gemfile under always', () => {
      const always = input({ useBundler: 'always' });
      assert.strictEqual(findBundlerGemfile(always, deps({ '/repo/Gemfile': '' })), '/repo/Gemfile');
    });

    test('should return null under always when no Gemfile exists at all', () => {
      assert.strictEqual(findBundlerGemfile(input({ useBundler: 'always' }), deps({})), null);
    });

    test('should return null under never even with a matching lock file', () => {
      const never = input({ useBundler: 'never' });
      const files = deps({ '/repo/Gemfile': '', '/repo/Gemfile.lock': LOCK_WITH_HAML_LINT });
      assert.strictEqual(findBundlerGemfile(never, files), null);
    });

    test('should pick the nearest Gemfile in a monorepo', () => {
      const monorepo = input({ documentPath: '/repo/packages/web/app/x.haml' });
      const files = deps({
        '/repo/Gemfile.lock': LOCK_WITH_HAML_LINT,
        '/repo/packages/web/Gemfile': '',
        '/repo/packages/web/Gemfile.lock': LOCK_WITH_HAML_LINT
      });
      assert.strictEqual(findBundlerGemfile(monorepo, files), '/repo/packages/web/Gemfile');
    });
  });

  suite('resolveOnPath', () => {
    test('should find a command on a posix PATH', () => {
      const d = deps({ '/usr/local/bin/haml-lint': '' }, { env: { PATH: '/usr/bin:/usr/local/bin' } });
      assert.strictEqual(resolveOnPath('haml-lint', d), '/usr/local/bin/haml-lint');
    });

    // On Windows CreateProcess searches the current directory before PATH, so a repository can ship
    // its own haml-lint.exe. Empty entries mean "current directory" and are dropped for that reason.
    test('should skip empty and dot PATH entries', () => {
      const d = deps({ 'haml-lint': '', './haml-lint': '' }, { env: { PATH: ':.:' } });
      assert.strictEqual(resolveOnPath('haml-lint', d), null);
    });

    test('should try PATHEXT extensions on win32', () => {
      const d = deps({ 'C:\\Ruby\\bin\\haml-lint.bat': '' }, { platform: 'win32', env: { PATH: 'C:\\Ruby\\bin', PATHEXT: '.EXE;.BAT;.CMD' } });
      // The extension's casing comes from PATHEXT and is irrelevant on a case-insensitive
      // filesystem, so only the resolved location is asserted.
      assert.strictEqual(resolveOnPath('haml-lint', d)?.toLowerCase(), 'c:\\ruby\\bin\\haml-lint.bat');
    });

    test('should verify an explicit path instead of scanning PATH', () => {
      assert.strictEqual(resolveOnPath('/opt/haml-lint', deps({ '/opt/haml-lint': '' })), '/opt/haml-lint');
      assert.strictEqual(resolveOnPath('/opt/haml-lint', deps({})), null);
    });

    test('should return null when the command is nowhere on PATH', () => {
      assert.strictEqual(resolveOnPath('haml-lint', deps({}, { env: { PATH: '/usr/bin' } })), null);
    });
  });

  suite('resolveInvocation', () => {
    test('should prefer an explicit executablePath and skip bundler entirely', () => {
      const files = deps({ '/repo/Gemfile': '', '/repo/Gemfile.lock': LOCK_WITH_HAML_LINT });
      const result = resolveInvocation(input({ executablePath: '/opt/bin/haml-lint' }), files);
      assert.strictEqual(result.command, '/opt/bin/haml-lint');
      assert.deepStrictEqual(result.argsPrefix, []);
      assert.strictEqual(result.usesBundler, false);
    });

    test('should ignore a blank executablePath', () => {
      const result = resolveInvocation(input({ executablePath: '   ' }), deps({}));
      assert.strictEqual(result.command, 'haml-lint');
    });

    test('should build a bundle exec invocation and pin BUNDLE_GEMFILE', () => {
      const files = deps({ '/repo/Gemfile': '', '/repo/Gemfile.lock': LOCK_WITH_HAML_LINT, '/usr/bin/bundle': '' }, { env: { PATH: '/usr/bin' } });
      const result = resolveInvocation(input(), files);
      assert.strictEqual(result.command, '/usr/bin/bundle');
      assert.deepStrictEqual(result.argsPrefix, ['exec', 'haml-lint']);
      assert.strictEqual(result.usesBundler, true);
      assert.strictEqual(result.bundleGemfile, '/repo/Gemfile');
    });

    test('should fall back to haml-lint on PATH', () => {
      const files = deps({ '/usr/bin/haml-lint': '' }, { env: { PATH: '/usr/bin' } });
      const result = resolveInvocation(input(), files);
      assert.strictEqual(result.command, '/usr/bin/haml-lint');
      assert.strictEqual(result.usesBundler, false);
      assert.strictEqual(result.bundleGemfile, undefined);
      assert.strictEqual(result.commandMissing, false);
    });

    // The bare name stays for the missing-executable notice; commandMissing is what keeps it from
    // being spawned, where the OS - on Windows the current directory first - would redo the search.
    test('should keep the bare command when PATH resolution fails, so ENOENT is reported', () => {
      const result = resolveInvocation(input(), deps({}));
      assert.strictEqual(result.command, 'haml-lint');
      assert.strictEqual(result.commandMissing, true);
    });

    test('should read a quoted PATH entry the way cmd.exe does', () => {
      const files = deps(
        { 'C:\\Ruby\\bin\\haml-lint.bat': '' },
        { platform: 'win32', env: { PATH: '"C:\\Ruby\\bin"', PATHEXT: '.COM;.EXE;.BAT;.CMD' } }
      );
      const result = resolveInvocation(input(), files);
      // .BAT: the candidate is spelled with PATHEXT's extension, and the case-insensitive
      // filesystem answers for it - the same name production existsSync and spawn accept.
      assert.strictEqual(result.command, 'C:\\Ruby\\bin\\haml-lint.BAT');
      assert.strictEqual(result.commandMissing, false);
      assert.strictEqual(result.needsCmdWrapper, true);
    });

    // Node cannot spawn .bat/.cmd without a shell since CVE-2024-27980, and `shell: true` would
    // reopen command injection through executablePath.
    test('should flag .bat and .cmd on win32 for cmd.exe wrapping', () => {
      const win = { platform: 'win32' as const, env: { PATH: 'C:\\bin', PATHEXT: '.EXE;.BAT;.CMD' } };
      const bat = resolveInvocation(input(), deps({ 'C:\\bin\\haml-lint.bat': '' }, win));
      assert.strictEqual(bat.needsCmdWrapper, true);
      const exe = resolveInvocation(input(), deps({ 'C:\\bin\\haml-lint.exe': '' }, win));
      assert.strictEqual(exe.needsCmdWrapper, false);
    });

    test('should never need a cmd wrapper off win32', () => {
      const result = resolveInvocation(input({ executablePath: '/opt/haml-lint.cmd' }), deps({}));
      assert.strictEqual(result.needsCmdWrapper, false);
    });

    test('should carry the resolved cwd through', () => {
      const files = deps({ '/repo/packages/web/.haml-lint.yml': '' });
      const result = resolveInvocation(input({ documentPath: '/repo/packages/web/a.haml' }), files);
      assert.strictEqual(result.cwd, '/repo/packages/web');
    });
  });
});
