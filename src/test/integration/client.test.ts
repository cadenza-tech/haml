import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { HamlLintClient } from '../../client';
import type { ResolveDeps } from '../../hamlLint/executable';
import { createProcessRunner, type ProcessRunner, type SpawnRequest, type SpawnResult } from '../../hamlLint/process';
import { Logger } from '../../logger';
import { config } from '../support/doubles';
import { openView } from '../support/host';

const REPORT = JSON.stringify({ files: [{ path: 'a.haml', offenses: [] }] });

/** Records every request that reaches the process layer, which is what these tests count. */
function recordingRunner(results: readonly SpawnResult[]): ProcessRunner & { readonly requests: SpawnRequest[] } {
  const requests: SpawnRequest[] = [];
  return {
    requests,
    async run(request: SpawnRequest): Promise<SpawnResult> {
      requests.push(request);
      return results[Math.min(requests.length - 1, results.length - 1)] as SpawnResult;
    }
  };
}

const TIMED_OUT: SpawnResult = { ok: false, reason: 'timeout', stderr: '' };
const SUCCEEDED: SpawnResult = { ok: true, code: 0, stdout: REPORT, stderr: '', durationMs: 10 };

let logger: Logger;

/**
 * Fake resolution that always finds haml-lint on a fake PATH. These tests are about coalescing and
 * back-off, and have to pass on a host with no Ruby at all: with the real filesystem, a machine
 * without the gem would answer every run with the missing-command short-circuit instead.
 */
const RESOLVING_DEPS: ResolveDeps = {
  fileExists: (target) => target.endsWith('/haml-lint'),
  readFile: () => null,
  platform: 'linux',
  env: { PATH: '/usr/bin' }
};

function clientFor(runner: ProcessRunner): HamlLintClient {
  return new HamlLintClient(runner, logger, RESOLVING_DEPS);
}

// This is what makes a debounce on the .haml-lint.yml watcher unnecessary. A single write commonly
// produces more than one filesystem event, and switching branches can change .haml-lint.yml and
// .rubocop.yml at once, firing both watchers: every one of those asks for the same document at the
// same version, so they arrive at the request already in flight instead of at a second Ruby process.
suite('client request coalescing Test Suite', () => {
  setup(() => {
    logger = new Logger();
  });

  teardown(() => {
    logger.dispose();
  });

  test('should spawn once for concurrent identical requests', async () => {
    const runner = recordingRunner([SUCCEEDED]);
    const client = clientFor(runner);
    const document = await openView('offenses.haml');

    const results = await Promise.all([
      client.run(document, config(), { mode: 'lint' }),
      client.run(document, config(), { mode: 'lint' }),
      client.run(document, config(), { mode: 'lint' })
    ]);

    assert.strictEqual(runner.requests.length, 1, 'three watcher events for one unchanged document must share one process');
    assert.ok(results.every((result) => result.ok));
  });

  // The formatter and the lint that follows it ask different questions, so they are deliberately not
  // shared - that redundancy is handled by reusing the published report, not by coalescing.
  test('should not coalesce across modes', async () => {
    const runner = recordingRunner([SUCCEEDED]);
    const client = clientFor(runner);
    const document = await openView('offenses.haml');

    await Promise.all([
      client.run(document, config(), { mode: 'lint' }),
      client.run(document, config(), { mode: 'format-and-lint', formatter: 'safe' })
    ]);

    assert.strictEqual(runner.requests.length, 2);
  });
});

// haml-lint is superlinear in document size: a ~19 KB file already takes longer than the default
// 15 s timeout on a normal machine. Without a back-off, every save and - in onType mode - every
// debounce tick starts another Ruby process that is killed 15 s later having produced nothing.
suite('client timeout back-off Test Suite', () => {
  setup(() => {
    logger = new Logger();
  });

  teardown(() => {
    logger.dispose();
  });

  test('should not spawn again after a run timed out on the same document', async () => {
    const runner = recordingRunner([TIMED_OUT]);
    const client = clientFor(runner);
    const document = await openView('offenses.haml');

    const first = await client.run(document, config(), { mode: 'lint' });
    const second = await client.run(document, config(), { mode: 'lint' });

    assert.strictEqual(first.ok, false);
    assert.strictEqual(second.ok, false);
    assert.strictEqual(runner.requests.length, 1, 'the second run must not reach the process layer');
  });

  test('should report the skip as skipped rather than as a fresh failure', async () => {
    const runner = recordingRunner([TIMED_OUT]);
    const client = clientFor(runner);
    const document = await openView('offenses.haml');

    await client.run(document, config(), { mode: 'lint' });
    const skipped = await client.run(document, config(), { mode: 'lint' });

    assert.strictEqual(skipped.ok, false);
    assert.strictEqual(skipped.kind, 'skipped');
  });

  // The back-off is keyed on the size that timed out, so the document that shrank below it is worth
  // another try - and a formatter run of the same document is not a different document.
  test('should spawn again for a smaller document', async () => {
    const runner = recordingRunner([TIMED_OUT]);
    const client = clientFor(runner);
    const large = await openView('offenses.haml');
    const small = await openView('clean.haml');
    assert.ok(small.getText().length < large.getText().length, 'the fixture must be smaller for this test to mean anything');

    await client.run(large, config(), { mode: 'lint' });
    await client.run(small, config(), { mode: 'lint' });

    assert.strictEqual(runner.requests.length, 2, 'a different, smaller document must still run');
  });

  // Raising the timeout is exactly how a user says "this file is large, wait longer for it", so it
  // has to be what lifts the back-off. Keying on the value avoids needing an invalidation hook.
  test('should spawn again once the timeout is raised', async () => {
    const runner = recordingRunner([TIMED_OUT]);
    const client = clientFor(runner);
    const document = await openView('offenses.haml');

    await client.run(document, config({ timeoutMs: 15000 }), { mode: 'lint' });
    await client.run(document, config({ timeoutMs: 60000 }), { mode: 'lint' });

    assert.strictEqual(runner.requests.length, 2);
  });

  test('should spawn again after the back-off is forgotten', async () => {
    const runner = recordingRunner([TIMED_OUT]);
    const client = clientFor(runner);
    const document = await openView('offenses.haml');

    await client.run(document, config(), { mode: 'lint' });
    client.forget(document.uri);
    await client.run(document, config(), { mode: 'lint' });

    assert.strictEqual(runner.requests.length, 2, 'an explicit Haml: Lint File must always run');
  });

  // Only a timeout backs off. A process that finished, whatever its exit code, proves the document is
  // within budget, and cancelling a superseded onType run says nothing about the document at all.
  test('should not back off for a run that finished', async () => {
    const runner = recordingRunner([SUCCEEDED]);
    const client = clientFor(runner);
    const document = await openView('offenses.haml');

    await client.run(document, config(), { mode: 'lint' });
    await client.run(document, config(), { mode: 'lint' });

    assert.strictEqual(runner.requests.length, 2);
  });

  test('should not back off for a cancelled run', async () => {
    const runner = recordingRunner([{ ok: false, reason: 'cancelled', stderr: '' }]);
    const client = clientFor(runner);
    const document = await openView('offenses.haml');

    await client.run(document, config(), { mode: 'lint' });
    await client.run(document, config(), { mode: 'lint' });

    assert.strictEqual(runner.requests.length, 2);
  });

  test('should lift the back-off as soon as a run finishes', async () => {
    const runner = recordingRunner([TIMED_OUT, SUCCEEDED, SUCCEEDED]);
    const client = clientFor(runner);
    const document = await openView('offenses.haml');

    await client.run(document, config(), { mode: 'lint' });
    client.forget(document.uri);
    await client.run(document, config(), { mode: 'lint' });
    await client.run(document, config(), { mode: 'lint' });

    assert.strictEqual(runner.requests.length, 3, 'the run that finished must clear the recorded size');
  });
});

// The settings or a rule file changed while a run was in flight: the forced re-lint must not be
// handed that run's answer, because it was spawned under the state the force exists to replace.
suite('client forced run Test Suite', () => {
  setup(() => {
    logger = new Logger();
  });

  teardown(() => {
    logger.dispose();
  });

  test('should not coalesce a forced run onto one already in flight', async () => {
    const runner = recordingRunner([SUCCEEDED]);
    const client = clientFor(runner);
    const document = await openView('offenses.haml');

    const stale = client.run(document, config(), { mode: 'lint' });
    const forced = client.run(document, config(), { mode: 'lint' }, undefined, true);
    await Promise.all([stale, forced]);

    assert.strictEqual(runner.requests.length, 2, 'the forced run must spawn afresh under the new state');
  });

  test('should let later requests join the forced run, not the abandoned one', async () => {
    const runner = recordingRunner([SUCCEEDED]);
    const client = clientFor(runner);
    const document = await openView('offenses.haml');

    const stale = client.run(document, config(), { mode: 'lint' });
    const forced = client.run(document, config(), { mode: 'lint' }, undefined, true);
    const follower = client.run(document, config(), { mode: 'lint' });
    await Promise.all([stale, forced, follower]);

    assert.strictEqual(runner.requests.length, 2, 'the follower must share the forced run, not add a third');
  });
});

// A command that PATH resolution could not find must never reach the OS as a bare name: on Windows
// CreateProcess searches the current directory - the repository - before PATH.
suite('client missing command Test Suite', () => {
  setup(() => {
    logger = new Logger();
  });

  teardown(() => {
    logger.dispose();
  });

  test('should answer enoent without spawning when the command is not on PATH', async () => {
    // The real runner: the refusal lives behind its trust and cancellation checks, so a missing
    // command in a trusted workspace is ENOENT while an untrusted one stays a silent skip.
    const real = createProcessRunner({ isTrusted: () => true });
    const deps: ResolveDeps = { fileExists: () => false, readFile: () => null, platform: 'linux', env: { PATH: '/usr/bin' } };
    const client = new HamlLintClient(real, logger, deps);
    const document = await openView('offenses.haml');

    const result = await client.run(document, config(), { mode: 'lint' });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.ok ? undefined : result.reason, 'enoent');
    real.dispose();
  });

  test('should stay a silent untrusted skip when the workspace is not trusted', async () => {
    const real = createProcessRunner({ isTrusted: () => false });
    const deps: ResolveDeps = { fileExists: () => false, readFile: () => null, platform: 'linux', env: { PATH: '/usr/bin' } };
    const client = new HamlLintClient(real, logger, deps);
    const document = await openView('offenses.haml');

    const result = await client.run(document, config(), { mode: 'lint' });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.ok ? undefined : result.reason, 'untrusted', 'trust must outrank the missing command');
    real.dispose();
  });
});

// applyCmdWrapper builds a pre-quoted cmd.exe line and marks it verbatim; dropping that flag on the
// way to spawn lets Node re-quote the /c payload into backslash-escaped garbage, which is why every
// .bat/.cmd invocation - the standard gem layout on Windows - used to fail.
suite('client windows command wrapping Test Suite', () => {
  setup(() => {
    logger = new Logger();
  });

  teardown(() => {
    logger.dispose();
  });

  test('should carry the cmd wrapper and its verbatim flag through to the process layer', async () => {
    const runner = recordingRunner([SUCCEEDED]);
    const deps: ResolveDeps = { fileExists: () => false, readFile: () => null, platform: 'win32', env: {} };
    const client = new HamlLintClient(runner, logger, deps);
    const document = await openView('offenses.haml');

    await client.run(document, config({ executablePath: 'C:\\Ruby\\bin\\haml-lint.bat' }), { mode: 'lint' });

    const request = runner.requests[0];
    assert.ok(request !== undefined);
    assert.deepStrictEqual(request.args.slice(0, 3), ['/d', '/s', '/c'], 'a .bat command must go through cmd.exe');
    assert.strictEqual(request.windowsVerbatimArguments, true, 'the pre-quoted line must reach spawn verbatim');
  });
});

// getWorkspaceFolder never matches untitled:, so without the workspaceFolders fallback the
// eligibility rule "untitled needs a workspace folder" was unsatisfiable and untitled linting dead.
suite('client untitled document Test Suite', () => {
  setup(() => {
    logger = new Logger();
  });

  teardown(() => {
    logger.dispose();
  });

  test('should lint an untitled document inside a workspace window', async () => {
    const runner = recordingRunner([SUCCEEDED]);
    const client = clientFor(runner);
    const document = await vscode.workspace.openTextDocument({ language: 'haml', content: '%p x\n' });

    const result = await client.run(document, config(), { mode: 'lint' });

    assert.ok(result.ok, 'untitled plus a workspace folder must be eligible');
    assert.strictEqual(runner.requests.length, 1);
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder !== undefined, 'the extension host opens a workspace folder');
    assert.ok(runner.requests[0]?.cwd.startsWith(folder.uri.fsPath), 'the run must anchor inside the workspace folder');
  });
});

/** Captures error and warn lines so a test can assert what the output channel would have received. */
class RecordingLogger extends Logger {
  readonly errors: string[] = [];
  readonly warnings: string[] = [];

  override error(message: string, error?: unknown): void {
    this.errors.push(message);
    super.error(message, error);
  }

  override warn(message: string): void {
    this.warnings.push(message);
    super.warn(message);
  }
}

// A failure that is neither 'exit' nor 'unparseable-report' used to log nothing at all when stderr
// was empty: an executablePath without the execute bit (EACCES) or an overflow left the user with
// diagnostics that silently vanished and an output channel with no trace of why.
suite('client failure logging Test Suite', () => {
  let recording: RecordingLogger;

  setup(() => {
    recording = new RecordingLogger();
  });

  teardown(() => {
    recording.dispose();
  });

  test('should leave a line for a spawn error', async () => {
    const runner = recordingRunner([{ ok: false, reason: 'spawn-error', stderr: '', message: 'spawn EACCES' }]);
    const client = new HamlLintClient(runner, recording, RESOLVING_DEPS);
    const document = await openView('offenses.haml');

    const result = await client.run(document, config(), { mode: 'lint' });

    assert.strictEqual(result.ok, false);
    assert.ok(
      recording.errors.some((line) => line.includes('EACCES')),
      `the spawn error detail must reach the output channel, got ${JSON.stringify(recording.errors)}`
    );
  });

  test('should leave a line for an overflow with nothing on stderr', async () => {
    const runner = recordingRunner([{ ok: false, reason: 'overflow', stderr: '' }]);
    const client = new HamlLintClient(runner, recording, RESOLVING_DEPS);
    const document = await openView('offenses.haml');

    const result = await client.run(document, config(), { mode: 'lint' });

    assert.strictEqual(result.ok, false);
    assert.ok(
      recording.errors.some((line) => line.includes('overflow')),
      `an overflow must name itself in the output channel, got ${JSON.stringify(recording.errors)}`
    );
  });

  // The back-off warning already carries the size and the remedy, so the generic line would only
  // repeat it with less; a timeout must still be explained, but exactly once.
  test('should leave the back-off warning as the only line for a timeout', async () => {
    const runner = recordingRunner([TIMED_OUT]);
    const client = new HamlLintClient(runner, recording, RESOLVING_DEPS);
    const document = await openView('offenses.haml');

    const result = await client.run(document, config(), { mode: 'lint' });

    assert.strictEqual(result.ok, false);
    assert.ok(
      recording.warnings.some((line) => line.includes('timed out')),
      `the back-off warning must explain the timeout, got ${JSON.stringify(recording.warnings)}`
    );
    assert.strictEqual(recording.errors.length, 0, 'a timeout must not add a second, generic line');
  });
});

// Closing a document cancels its runs, but one parked on the process runner's concurrency queue
// stays unsettled until a slot frees. Reopening restarts versions at 1, so without abandon() the
// first lint of the reopened document coalesced onto the dead run, was answered 'cancelled', and
// published nothing until the next edit.
suite('client abandoned document Test Suite', () => {
  setup(() => {
    logger = new Logger();
  });

  teardown(() => {
    logger.dispose();
  });

  const CANCELLED: SpawnResult = { ok: false, reason: 'cancelled', stderr: '' };

  /** A runner whose spawns stay pending until the test settles them, like a saturated queue. */
  function manualRunner(): { runner: ProcessRunner & { readonly requests: SpawnRequest[] }; settle(index: number, result: SpawnResult): void } {
    const settlers: Array<(result: SpawnResult) => void> = [];
    const requests: SpawnRequest[] = [];
    return {
      runner: {
        requests,
        run(request: SpawnRequest): Promise<SpawnResult> {
          requests.push(request);
          return new Promise<SpawnResult>((resolve) => settlers.push(resolve));
        }
      },
      settle: (index, result) => settlers[index]?.(result)
    };
  }

  test('should start a fresh run for the same version after abandon', async () => {
    const { runner, settle } = manualRunner();
    const client = clientFor(runner);
    const document = await openView('offenses.haml');

    const dead = client.run(document, config(), { mode: 'lint' });
    client.abandon(document.uri);
    const fresh = client.run(document, config(), { mode: 'lint' });

    assert.strictEqual(runner.requests.length, 2, 'the request after abandon must spawn afresh, not join the dead run');
    settle(0, CANCELLED);
    settle(1, SUCCEEDED);
    const [deadResult, freshResult] = await Promise.all([dead, fresh]);
    assert.strictEqual(deadResult.ok, false);
    assert.ok(freshResult.ok, 'the reopened document must get a real answer');
  });

  test('should keep the fresh entry when the abandoned run settles later', async () => {
    const { runner, settle } = manualRunner();
    const client = clientFor(runner);
    const document = await openView('offenses.haml');

    const dead = client.run(document, config(), { mode: 'lint' });
    client.abandon(document.uri);
    const fresh = client.run(document, config(), { mode: 'lint' });
    settle(0, CANCELLED);
    await dead;

    const follower = client.run(document, config(), { mode: 'lint' });
    assert.strictEqual(runner.requests.length, 2, "the dead run's settle must not delete the fresh entry out from under later callers");
    settle(1, SUCCEEDED);
    const [freshResult, followerResult] = await Promise.all([fresh, follower]);
    assert.ok(freshResult.ok && followerResult.ok);
  });
});

// After the bundler retry, an ENOENT belongs to the PATH executable. Re-resolving from the original
// config for the notice named the bundle command that had just worked, and "Don't Show Again" then
// persisted against that path, muting a future genuine bundle failure.
suite('client enoent command Test Suite', () => {
  setup(() => {
    logger = new Logger();
  });

  teardown(() => {
    logger.dispose();
  });

  test('should name the PATH executable, not the bundle, when the retry hits ENOENT', async () => {
    const MISSING_EXEC: SpawnResult = {
      ok: true,
      code: 127,
      stdout: '',
      stderr: 'bundler: command not found: haml-lint\nInstall missing gem executables with `bundle install`',
      durationMs: 5
    };
    // `command` comes from the spawn layer, which is the only place that knows what it tried to
    // run: after the retry that is the PATH executable, not the bundle the config re-resolves to.
    const ENOENT: SpawnResult = {
      ok: false,
      reason: 'enoent',
      stderr: '',
      message: 'spawn /usr/bin/haml-lint ENOENT',
      command: '/usr/bin/haml-lint'
    };
    const runner = recordingRunner([MISSING_EXEC, ENOENT]);
    const deps: ResolveDeps = {
      fileExists: () => true,
      readFile: (target) => (target.endsWith('Gemfile.lock') ? 'GEM\n  specs:\n    haml_lint (0.76.0)\n' : null),
      platform: 'linux',
      env: { PATH: '/usr/bin' }
    };
    const client = new HamlLintClient(runner, logger, deps);
    const document = await openView('offenses.haml');

    const result = await client.run(document, config(), { mode: 'lint' });

    assert.strictEqual(runner.requests.length, 2, 'bundler: command not found (exit 127) must trigger the PATH retry');
    assert.ok(runner.requests[1]?.command.endsWith('/haml-lint'), 'the retry must not go through bundler');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.ok ? undefined : result.reason, 'enoent');
    assert.strictEqual(result.ok ? undefined : result.command, '/usr/bin/haml-lint', 'the result must carry the command that failed');
  });
});

// The lint path falls back to PATH when bundle exec reports a missing gem; without the same
// fallback in the probe, `formatter: "auto"` silently resolved to none while lint kept working.
suite('client version probe Test Suite', () => {
  setup(() => {
    logger = new Logger();
  });

  teardown(() => {
    logger.dispose();
  });

  test('should fall back to PATH when bundle exec cannot find the gem', async () => {
    const MISSING_GEM: SpawnResult = {
      ok: true,
      code: 1,
      stdout: '',
      stderr: 'Could not find haml_lint-0.76.0 in locally installed gems',
      durationMs: 5
    };
    const VERSION: SpawnResult = { ok: true, code: 0, stdout: 'haml-lint 0.76.0', stderr: '', durationMs: 5 };
    const runner = recordingRunner([MISSING_GEM, VERSION]);
    const deps: ResolveDeps = {
      fileExists: () => true,
      readFile: (target) => (target.endsWith('Gemfile.lock') ? 'GEM\n  specs:\n    haml_lint (0.76.0)\n' : null),
      platform: 'linux',
      env: { PATH: '/usr/bin' }
    };
    const client = new HamlLintClient(runner, logger, deps);
    const document = await openView('clean.haml');

    const version = await client.probeVersion(document, config());

    assert.deepStrictEqual(version, [0, 76, 0]);
    assert.strictEqual(runner.requests.length, 2, 'the probe must retry on PATH after the missing-gem failure');
    assert.ok(runner.requests[1]?.command.endsWith('haml-lint'), 'the retry must not go through bundler');
  });
});
