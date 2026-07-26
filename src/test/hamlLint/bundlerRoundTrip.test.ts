import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildLintArgs } from '../../hamlLint/args';
import { buildEnv } from '../../hamlLint/env';
import { resolveInvocation } from '../../hamlLint/executable';
import { parseReport } from '../../hamlLint/parser';
import { createProcessRunner } from '../../hamlLint/process';
import { nodeResolveDeps } from '../../nodeDeps';

// The bundler half of the invocation contract, end to end.
//
// resolveInvocation's *decision* is covered exhaustively against a fake filesystem in
// executable.test.ts. What no other test covers is that the command line and environment it produces
// actually run: `bundle exec haml-lint` puts 'exec' and the gem name in argsPrefix, pins the bundle
// through BUNDLE_GEMFILE, and injects -rbundler/setup through RUBYOPT - which buildEnv must append to
// rather than replace, or the whole Bundler path breaks.
//
// The integration suites cannot cover it: the fixture workspace deliberately has no Gemfile, so that
// they exercise the PATH branch instead. Hence a scratch tree here, the way refactorCommands does.
//
// No vscode, so this runs in the plain-Node lane and lands inside the c8 scope.

const FIXTURE_GEMFILE = path.join(__dirname, '..', '..', '..', 'src', 'test', 'fixtures', 'gem', 'Gemfile');
const SOURCE = '%p\n  = link_to "Home", root_path\n';

/** The bundle CI installs and a developer gets from `bundle install` in src/test/fixtures/gem. */
function bundlerAvailable(): boolean {
  try {
    execFileSync('bundle', ['exec', 'haml-lint', '--version'], { stdio: 'ignore', env: { ...process.env, BUNDLE_GEMFILE: FIXTURE_GEMFILE } });
    return true;
  } catch {
    return false;
  }
}

suite('hamlLint bundler round trip Test Suite', () => {
  let scratch = '';

  suiteSetup(function () {
    if (!bundlerAvailable()) {
      this.skip();
    }
    // A lock naming haml_lint beside the document is exactly what makes useBundler "auto" choose
    // Bundler, so the tree is what puts the resolver on the branch under test.
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'haml-bundler-'));
    fs.copyFileSync(FIXTURE_GEMFILE, path.join(scratch, 'Gemfile'));
    fs.copyFileSync(`${FIXTURE_GEMFILE}.lock`, path.join(scratch, 'Gemfile.lock'));
    fs.writeFileSync(path.join(scratch, 'view.haml'), SOURCE, 'utf8');
  });

  suiteTeardown(() => {
    if (scratch !== '') {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  test('should resolve a tree whose lock names haml_lint onto Bundler', () => {
    const invocation = resolveInvocation(
      { documentPath: path.join(scratch, 'view.haml'), workspaceFolderPath: scratch, useBundler: 'auto' },
      nodeResolveDeps()
    );

    assert.strictEqual(invocation.usesBundler, true);
    assert.deepStrictEqual(invocation.argsPrefix, ['exec', 'haml-lint']);
    assert.strictEqual(invocation.bundleGemfile, path.join(scratch, 'Gemfile'));
    assert.ok(path.isAbsolute(invocation.command), 'the command must be absolute; a bare name lets cwd win on Windows');
  });

  test('should produce a parseable report through bundle exec', async () => {
    const documentPath = path.join(scratch, 'view.haml');
    const invocation = resolveInvocation({ documentPath, workspaceFolderPath: scratch, useBundler: 'auto' }, nodeResolveDeps());
    const runner = createProcessRunner({ isTrusted: () => true });

    const result = await runner.run({
      command: invocation.command,
      args: [...invocation.argsPrefix, ...buildLintArgs({ stdinPath: documentPath })],
      cwd: invocation.cwd,
      stdin: SOURCE,
      env: buildEnv(process.env, { bundleGemfile: invocation.bundleGemfile }),
      timeoutMs: 120000
    });

    assert.ok(result.ok, `bundle exec did not finish: ${result.ok ? '' : result.reason} ${result.stderr}`);
    // 0 and 65 both mean a report was produced; anything else is Bundler or Ruby failing.
    assert.ok(result.code === 0 || result.code === 65, `exit ${result.code}\n${result.stderr}`);

    const parsed = parseReport(result.stdout);
    assert.ok(parsed.ok, `unparseable report:\n${parsed.ok ? '' : parsed.raw}`);
  });

  // buildEnv *appends* the encoding option to RUBYOPT rather than assigning it, because a host
  // launched from inside `bundle exec` already has -rbundler/setup there and overwriting it breaks
  // Bundler. env.test.ts asserts the string it builds; this asserts the value actually survives the
  // hop through a real `bundle exec`, which rewrites RUBYOPT again on the way to the child.
  test('should carry both the inherited RUBYOPT and the encoding option into the bundled child', async () => {
    const invocation = resolveInvocation(
      { documentPath: path.join(scratch, 'view.haml'), workspaceFolderPath: scratch, useBundler: 'auto' },
      nodeResolveDeps()
    );
    const runner = createProcessRunner({ isTrusted: () => true });

    const result = await runner.run({
      command: invocation.command,
      // `bundle exec ruby`, not the resolved argsPrefix: this asks what the environment looks like
      // inside a bundled process, so it must not go through haml-lint.
      args: ['exec', 'ruby', '-e', 'print ENV["RUBYOPT"].to_s'],
      cwd: invocation.cwd,
      stdin: '',
      // -W0 stands in for the -rbundler/setup an already-bundled host would be carrying.
      env: buildEnv({ ...process.env, RUBYOPT: '-W0' }, { bundleGemfile: invocation.bundleGemfile }),
      timeoutMs: 120000
    });

    assert.ok(result.ok && result.code === 0, `exit ${result.ok ? result.code : result.reason}\n${result.stderr}`);
    assert.ok(result.stdout.includes('-W0'), `the inherited RUBYOPT was dropped: ${result.stdout}`);
    assert.ok(result.stdout.includes('-EUTF-8:UTF-8'), `the encoding option was dropped: ${result.stdout}`);
  });

  // The symptom the encoding option exists for: without it Ruby sets default_external to US-ASCII on
  // a host with no LANG, and haml-lint dies with "invalid byte sequence" (exit 70) on any view with
  // non-ASCII text - which is most of them outside English-speaking projects.
  test('should lint non-ascii source through bundle exec without a LANG', async () => {
    const documentPath = path.join(scratch, 'japanese.haml');
    const source = '%p 日本語のテキスト\n';
    fs.writeFileSync(documentPath, source, 'utf8');
    const invocation = resolveInvocation({ documentPath, workspaceFolderPath: scratch, useBundler: 'auto' }, nodeResolveDeps());
    const runner = createProcessRunner({ isTrusted: () => true });

    const { LANG, LC_ALL, ...withoutLocale } = process.env;
    const result = await runner.run({
      command: invocation.command,
      args: [...invocation.argsPrefix, ...buildLintArgs({ stdinPath: documentPath })],
      cwd: invocation.cwd,
      stdin: source,
      env: buildEnv(withoutLocale, { bundleGemfile: invocation.bundleGemfile }),
      timeoutMs: 120000
    });

    assert.ok(result.ok, `bundle exec did not finish: ${result.ok ? '' : result.reason}`);
    assert.notStrictEqual(result.code, 70, `haml-lint crashed on non-ascii input:\n${result.stderr}`);
    assert.ok(parseReport(result.stdout).ok, `unparseable report:\n${result.stdout}\n${result.stderr}`);
  });
});
