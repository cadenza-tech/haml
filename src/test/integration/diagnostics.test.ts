import * as assert from 'node:assert';
import { DiagnosticsController } from '../../diagnostics';
import type { RunFailureReason } from '../../hamlLint/outcome';
import { Logger } from '../../logger';
import { MissingExecutableNotice, type Notifier } from '../../missingExecutableNotice';
import { config, memento, stubLintRunner } from '../support/doubles';
import { openView } from '../support/host';

function counting(): Notifier & { calls: number } {
  const notifier = Object.assign(
    async (): Promise<string | undefined> => {
      notifier.calls++;
      return undefined;
    },
    { calls: 0 }
  );
  return notifier;
}

/** Lints once with a runner that always fails for `reason`, and reports whether the user was warned. */
async function warningsFor(reason: RunFailureReason): Promise<number> {
  const notifier = counting();
  const logger = new Logger();
  const controller = new DiagnosticsController(
    stubLintRunner(() => ({ ok: false, kind: 'failed', reason })),
    logger,
    () => config(),
    new MissingExecutableNotice(logger, memento(), notifier)
  );
  const document = await openView('offenses.haml');

  await controller.lint(document, config());

  controller.dispose();
  logger.dispose();
  return notifier.calls;
}

// What the notice itself does once asked is pinned in missingExecutableNotice.test.ts. These
// pin the routing: which failures are worth interrupting the user for, and under which name.
suite('diagnostics missing executable Test Suite', () => {
  test('should warn when the executable could not be run', async () => {
    assert.strictEqual(await warningsFor('enoent'), 1);
  });

  test('should not warn for failures that are not a missing executable', async () => {
    assert.strictEqual(await warningsFor('timeout'), 0);
  });

  // After the client's bundler retry the ENOENT belongs to the PATH executable, and the run result
  // carries that command. Re-resolving the config here would name the bundle that worked - and
  // "Don't Show Again" would persist against the wrong path.
  test('should name the command carried by the failed run, not a fresh resolve', async () => {
    const messages: string[] = [];
    const notifier: Notifier = async (message) => {
      messages.push(message);
      return undefined;
    };
    const logger = new Logger();
    const controller = new DiagnosticsController(
      stubLintRunner(() => ({ ok: false, kind: 'failed', reason: 'enoent', command: '/gems/bin/haml-lint' })),
      logger,
      () => config(),
      new MissingExecutableNotice(logger, memento(), notifier)
    );
    const document = await openView('offenses.haml');

    await controller.lint(document, config());

    assert.strictEqual(messages.length, 1);
    assert.ok(messages[0]?.includes('/gems/bin/haml-lint'), `the notice must name the failing command, got: ${messages[0]}`);
    controller.dispose();
    logger.dispose();
  });
});
