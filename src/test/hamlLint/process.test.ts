import * as assert from 'node:assert';
import type { CancellationLike, SpawnRequest } from '../../hamlLint/process';
import { createProcessRunner, type ProcessRunnerDeps } from '../../hamlLint/process';

const NODE = process.execPath;

function request(script: string, overrides: Partial<SpawnRequest> = {}): SpawnRequest {
  return {
    command: NODE,
    args: ['-e', script],
    cwd: process.cwd(),
    stdin: '',
    env: process.env,
    timeoutMs: 10000,
    ...overrides
  };
}

function runner(overrides: Partial<ProcessRunnerDeps> = {}) {
  return createProcessRunner({ isTrusted: () => true, ...overrides });
}

/** Minimal CancellationToken stand-in so the process layer stays free of vscode. */
function token(): CancellationLike & { cancel(): void } {
  const listeners: (() => void)[] = [];
  let requested = false;
  return {
    get isCancellationRequested() {
      return requested;
    },
    onCancellationRequested(listener: () => void) {
      listeners.push(listener);
      return { dispose: () => undefined };
    },
    cancel() {
      requested = true;
      for (const listener of listeners) {
        listener();
      }
    }
  };
}

suite('hamlLint/process Test Suite', () => {
  suite('workspace trust gate', () => {
    // `bundle exec` evaluates the workspace Gemfile as Ruby, .haml-lint.yml is ERB, and
    // .rubocop.yml can `require` any .rb in the repository.
    test('should refuse to spawn in an untrusted workspace', async () => {
      const result = await runner({ isTrusted: () => false }).run(request('process.stdout.write("ran")'));
      assert.ok(!result.ok);
      assert.strictEqual(result.reason, 'untrusted');
    });

    test('should refuse before doing any work when already cancelled', async () => {
      const cancelled = token();
      cancelled.cancel();
      const result = await runner().run(request('process.stdout.write("ran")'), cancelled);
      assert.ok(!result.ok);
      assert.strictEqual(result.reason, 'cancelled');
    });
  });

  suite('normal completion', () => {
    test('should return stdout, stderr and the exit code', async () => {
      const result = await runner().run(request('process.stdout.write("out");process.stderr.write("err");process.exit(65)'));
      assert.ok(result.ok);
      assert.strictEqual(result.stdout, 'out');
      assert.strictEqual(result.stderr, 'err');
      assert.strictEqual(result.code, 65);
      assert.ok(result.durationMs >= 0);
    });

    test('should pipe stdin through to the child', async () => {
      const script = 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>process.stdout.write(d.toUpperCase()))';
      const result = await runner().run(request(script, { stdin: 'haml' }));
      assert.ok(result.ok);
      assert.strictEqual(result.stdout, 'HAML');
    });

    test('should round-trip non-ascii content without corruption', async () => {
      const script = 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>process.stdout.write(d))';
      const source = '%p 日本語のテキスト\n';
      const result = await runner().run(request(script, { stdin: source }));
      assert.ok(result.ok);
      assert.strictEqual(result.stdout, source);
    });

    test('should run in the requested cwd', async () => {
      const result = await runner().run(request('process.stdout.write(process.cwd())', { cwd: __dirname }));
      assert.ok(result.ok);
      assert.strictEqual(result.stdout, __dirname);
    });

    test('should pass the requested environment', async () => {
      const result = await runner().run(
        request('process.stdout.write(process.env.HAML_TEST_VAR||"")', { env: { ...process.env, HAML_TEST_VAR: 'x' } })
      );
      assert.ok(result.ok);
      assert.strictEqual(result.stdout, 'x');
    });
  });

  suite('failure paths', () => {
    test('should report ENOENT instead of rejecting', async () => {
      const result = await runner().run(request('', { command: '/nonexistent/haml-lint', args: [] }));
      assert.ok(!result.ok);
      assert.strictEqual(result.reason, 'enoent');
    });

    // A truncated stdout used as replacement text would silently destroy a large .haml, and the
    // "empty stdout means no edit" guard does not catch it.
    test('should report overflow rather than returning truncated stdout', async () => {
      const result = await runner({ maxBufferBytes: 1000 }).run(request('process.stdout.write("x".repeat(200000))'));
      assert.ok(!result.ok);
      assert.strictEqual(result.reason, 'overflow');
    });

    test('should not report overflow for output within the limit', async () => {
      const result = await runner({ maxBufferBytes: 100000 }).run(request('process.stdout.write("x".repeat(5000))'));
      assert.ok(result.ok);
      assert.strictEqual(result.stdout.length, 5000);
    });

    test('should time out and kill the child', async () => {
      const started = Date.now();
      const result = await runner().run(request('setTimeout(()=>{},30000)', { timeoutMs: 200 }));
      assert.ok(!result.ok);
      assert.strictEqual(result.reason, 'timeout');
      assert.ok(Date.now() - started < 10000, 'must not wait for the child to finish on its own');
    });

    // An executablePath wrapper that does not `exec` - a docker `bin/haml-lint`, say - leaves the real
    // work in a grandchild. Signalling the wrapper alone kills nothing that matters: the grandchild
    // keeps the inherited pipes open, 'close' waits for it, and the run holds its concurrency slot
    // until the very process that just timed out has finished on its own.
    test('should take a grandchild down with a wrapper that timed out', async function () {
      if (process.platform === 'win32') {
        // taskkill /T already walks the tree there, and this wrapper shape is POSIX's.
        this.skip();
      }
      const grandchild = 'process.stderr.write(String(process.pid)); setTimeout(()=>{},20000)';
      const wrapper = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'inherit' }); setTimeout(()=>{},20000)`;
      const started = Date.now();
      // Long enough for the wrapper to have spawned: a kill that lands first proves nothing.
      const result = await runner({ killGraceMs: 500 }).run(request(wrapper, { timeoutMs: 1500 }));
      assert.ok(!result.ok);
      assert.strictEqual(result.reason, 'timeout');
      assert.ok(Date.now() - started < 8000, `the run must not wait for the grandchild, took ${Date.now() - started}ms`);
      // Without this the test would also pass on a kill that landed before there was a grandchild.
      // That it is gone is what the time above says: 'close' only comes once it has let go of the
      // pipes. Probing the pid would add nothing but a race with whoever reaps it.
      assert.ok(Number(result.stderr) > 0, `the grandchild must have started, got ${JSON.stringify(result.stderr)}`);
    });

    // What the group kill cannot reach: a descendant that left the group (its own `setsid`) and still
    // holds the pipes. The group is empty by then, the signal has nobody to go to, and the run ends
    // when that process does - as every run with a grandchild used to.
    test('should fall back to the child alone once the group is gone', async function () {
      if (process.platform === 'win32') {
        this.skip();
      }
      const escaped = 'setTimeout(()=>{},2500)';
      const wrapper = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(escaped)}], { stdio: 'inherit', detached: true })`;
      const result = await runner({ killGraceMs: 200 }).run(request(wrapper, { timeoutMs: 1000 }));
      assert.ok(!result.ok);
      assert.strictEqual(result.reason, 'timeout');
    });

    // A timeout and a cancellation can both arrive for one run: the editor cancels while the child is
    // still inside its grace period. Arming a second kill timer over the first leaves the first one
    // to fire after the run has settled - at a process group that, by then, may be somebody else's.
    test('should not signal anything once the run has settled', async function () {
      if (process.platform === 'win32') {
        this.skip();
      }
      const signalled: string[] = [];
      let settled = false;
      const kill = process.kill;
      process.kill = ((pid: number, signal?: string | number): true => {
        if (settled) {
          signalled.push(`${pid} ${String(signal)}`);
        }
        return kill.call(process, pid, signal);
      }) as typeof process.kill;
      try {
        const cancellation = token();
        // Outlives SIGTERM for a moment, so that the cancellation lands between the two signals.
        const lingering = "process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),300)); setTimeout(()=>{},30000)";
        const promise = runner({ killGraceMs: 600 }).run(request(lingering, { timeoutMs: 400 }), cancellation);
        setTimeout(() => cancellation.cancel(), 500);
        await promise;
        settled = true;
        await new Promise((resolve) => setTimeout(resolve, 900));
      } finally {
        process.kill = kill;
      }
      assert.deepStrictEqual(signalled, []);
    });

    // A child slow to die on SIGTERM is still alive when the timeout comes due, and answering
    // `timeout` for it records a back-off against a document whose run was merely superseded: the
    // next save is then skipped as "timed out before" with nothing having timed out.
    test('should keep calling a cancelled run cancelled when the timeout expires while it dies', async function () {
      if (process.platform === 'win32') {
        // taskkill /F has no grace period for the timeout to land in.
        this.skip();
      }
      const cancellation = token();
      const ignoresSigterm = 'process.on("SIGTERM",()=>{});setTimeout(()=>{},30000)';
      const promise = runner({ killGraceMs: 1500 }).run(request(ignoresSigterm, { timeoutMs: 1000 }), cancellation);
      setTimeout(() => cancellation.cancel(), 500);
      const result = await promise;
      assert.ok(!result.ok);
      assert.strictEqual(result.reason, 'cancelled');
    });

    test('should stop on cancellation', async () => {
      const cancellation = token();
      const promise = runner().run(request('setTimeout(()=>{},30000)'), cancellation);
      setTimeout(() => cancellation.cancel(), 50);
      const result = await promise;
      assert.ok(!result.ok);
      assert.strictEqual(result.reason, 'cancelled');
    });

    // haml-lint exits before draining stdin on a bad flag (64) or broken config (78). Without an
    // 'error' listener on child.stdin the resulting EPIPE is an uncaught exception that takes down
    // the extension host, so this test failing would show up as a crash, not an assertion.
    test('should survive the child exiting before reading stdin', async () => {
      const result = await runner().run(request('process.exit(64)', { stdin: 'x'.repeat(2 * 1024 * 1024) }));
      assert.ok(result.ok || !result.ok, 'must settle rather than crash the host');
      if (result.ok) {
        assert.strictEqual(result.code, 64);
      }
    });
  });

  suite('dispose', () => {
    // The fix-all command and the version probe spawn without a CancellationToken, so shutdown
    // needs an explicit kill rather than relying on token cancellation alone.
    test('should kill live children', async () => {
      const disposable = runner();
      const promise = disposable.run(request('setTimeout(()=>{},30000)'));
      await new Promise((resolve) => setTimeout(resolve, 150));
      disposable.dispose();

      const result = await promise;
      assert.ok(result.ok, 'a SIGKILLed child still closes normally');
      assert.strictEqual(result.code, null, 'a signalled exit reports no code');
    });

    test('should be safe with nothing running', () => {
      const disposable = runner();
      disposable.dispose();
      disposable.dispose();
    });

    // Requests still queued on the semaphore when dispose() runs would otherwise spawn afterwards,
    // with nothing left alive to kill them.
    test('should refuse to spawn after dispose', async () => {
      const disposable = runner();
      disposable.dispose();

      const result = await disposable.run(request('setTimeout(()=>{},30000)'));

      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.ok ? undefined : result.reason, 'cancelled');
    });
  });

  suite('missing command', () => {
    test('should answer enoent without spawning', async () => {
      const result = await runner().run(request('', { command: 'haml-lint', commandMissing: true }));

      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.ok ? undefined : result.reason, 'enoent');
    });

    // The refusal sits behind the trust gate on purpose: an untrusted workspace is a deliberate
    // silent skip, and surfacing a missing-executable dialog there would be a regression.
    test('should let trust outrank the missing command', async () => {
      const result = await runner({ isTrusted: () => false }).run(request('', { command: 'haml-lint', commandMissing: true }));

      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.ok ? undefined : result.reason, 'untrusted');
    });

    test('should let cancellation outrank the missing command', async () => {
      const token = { isCancellationRequested: true, onCancellationRequested: () => ({ dispose: () => undefined }) };
      const result = await runner().run(request('', { command: 'haml-lint', commandMissing: true }), token);

      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.ok ? undefined : result.reason, 'cancelled');
    });
  });

  suite('concurrency', () => {
    test('should not run more children at once than the limit', async () => {
      const limited = runner({ maxConcurrent: 2 });
      const started = Date.now();
      // setTimeout guarantees a lower bound, so only the lower bound is asserted: four 200 ms
      // children through a limit of two cannot finish in under two rounds.
      await Promise.all(Array.from({ length: 4 }, () => limited.run(request('setTimeout(()=>{},200)'))));
      assert.ok(Date.now() - started >= 350, `expected at least two rounds, took ${Date.now() - started}ms`);
    });

    test('should not spawn a request cancelled while it waited for a slot', async () => {
      const limited = runner({ maxConcurrent: 1 });
      const cancellable = token();
      const blocker = limited.run(request('setTimeout(()=>{},300)'));
      // Queued behind the blocker, then superseded before a slot frees - the onType case.
      const queued = limited.run(request('process.stdout.write("SPAWNED")'), cancellable);
      cancellable.cancel();

      const result = await queued;
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.ok === false && result.reason, 'cancelled');
      // ok:false carries no stdout, so the marker never being produced is the assertion that the
      // process was skipped rather than started and killed.
      await blocker;
    });
  });

  suite('buffer budgets', () => {
    // Without --auto-correct-only both streams are live at once, so a shared budget let a Ruby
    // backtrace on stderr discard a perfectly good corrected source on stdout.
    test('should keep a large stderr from aborting a valid stdout capture', async () => {
      const small = runner({ maxBufferBytes: 1000 });
      const result = await small.run(request('process.stderr.write("x".repeat(200000)); process.stdout.write("0123456789");'));
      assert.ok(result.ok, 'a big stderr must not overflow the stdout budget');
      assert.strictEqual(result.ok && result.stdout, '0123456789');
    });

    test('should cap a runaway stderr rather than failing the run', async () => {
      const small = runner({ maxBufferBytes: 1000 });
      const result = await small.run(request('process.stderr.write("x".repeat(200000));'));
      assert.ok(result.ok, 'stderr is logged or parsed, never written back, so it is capped not fatal');
      assert.ok(result.ok && result.stderr.length <= 1000, `stderr must stay within the budget, got ${result.ok && result.stderr.length}`);
    });

    test('should still fail the run when stdout overflows', async () => {
      const small = runner({ maxBufferBytes: 1000 });
      const result = await small.run(request('process.stdout.write("x".repeat(200000));'));
      assert.ok(!result.ok);
      assert.strictEqual(result.ok === false && result.reason, 'overflow');
    });
  });
});
