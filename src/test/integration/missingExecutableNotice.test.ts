import * as assert from 'node:assert';
import { Logger } from '../../logger';
import { MissingExecutableNotice, type Notifier } from '../../missingExecutableNotice';
import { memento } from '../support/doubles';

const COMMAND = '/usr/bin/haml-lint';

function counting(choice?: string): Notifier & { calls: number } {
  const notifier = Object.assign(
    async (): Promise<string | undefined> => {
      notifier.calls++;
      return choice;
    },
    { calls: 0 }
  );
  return notifier;
}

// Every one of these used to need a document, a stub runner and a lint call to reach the dialog.
// The notice is its own object now, so they ask it directly.
suite('missing executable notice Test Suite', () => {
  let logger: Logger;

  setup(() => {
    logger = new Logger();
  });

  teardown(() => {
    logger.dispose();
  });

  // Someone who installed this for highlighting and has no Ruby hits ENOENT on every open and every
  // save. Without a session guard each one raised its own warning, burying the editor in
  // notifications until "Don't Show Again" was clicked.
  test('should warn once per command however many times it is asked', async () => {
    const notifier = counting();
    const notice = new MissingExecutableNotice(logger, memento(), notifier);

    for (let i = 0; i < 5; i++) {
      await notice.show(COMMAND);
    }

    assert.strictEqual(notifier.calls, 1, `expected a single warning, got ${notifier.calls}`);
  });

  // Two dialogs can be open at once when a multi-root workspace resolves two commands. Each update
  // has to re-read the persisted list: a list captured before the dialogs would make the second
  // "Don't Show Again" erase the first one's entry.
  test('should keep both suppressions when two notices answer concurrently', async () => {
    const state = memento();
    const answers: ((choice: string | undefined) => void)[] = [];
    const notifier: Notifier = () =>
      new Promise((resolve) => {
        answers.push(resolve);
      });
    const notice = new MissingExecutableNotice(logger, state, notifier);

    const first = notice.show('/a/haml-lint');
    const second = notice.show('/b/haml-lint');
    answers[0]?.("Don't Show Again");
    answers[1]?.("Don't Show Again");
    await Promise.all([first, second]);

    // The next session shares the workspace state; both commands must stay silenced in it.
    const nextSession = counting("Don't Show Again");
    const revived = new MissingExecutableNotice(logger, state, nextSession);
    await revived.show('/a/haml-lint');
    await revived.show('/b/haml-lint');
    assert.strictEqual(nextSession.calls, 0, 'the second update must not have erased the first suppression');
  });

  // The guard is keyed on the command, not on "have we warned at all": a workspace can resolve a
  // different one per document, and the second one is news.
  test('should warn separately for a different command', async () => {
    const notifier = counting();
    const notice = new MissingExecutableNotice(logger, memento(), notifier);

    await notice.show(COMMAND);
    await notice.show('/opt/homebrew/bin/haml-lint');

    assert.strictEqual(notifier.calls, 2);
  });

  test('should warn again after settings change', async () => {
    const notifier = counting();
    const notice = new MissingExecutableNotice(logger, memento(), notifier);

    await notice.show(COMMAND);
    notice.reset();
    await notice.show(COMMAND);

    assert.strictEqual(notifier.calls, 2, 'fixing the executable path should make the notice relevant again');
  });

  test('should stay silent across sessions once dismissed for good', async () => {
    const shared = memento();

    const first = counting("Don't Show Again");
    await new MissingExecutableNotice(logger, shared, first).show(COMMAND);
    assert.strictEqual(first.calls, 1);

    // A fresh notice stands in for the next window: the persisted list must still apply.
    const second = counting();
    await new MissingExecutableNotice(logger, shared, second).show(COMMAND);
    assert.strictEqual(second.calls, 0);
  });

  // "Show Output" must not persist anything, or the one user who looked at the channel would never
  // be told again. Asserted through the memento, which is the only observable the dialog leaves.
  test('should not suppress anything when the output channel is asked for', async () => {
    const shared = memento();
    await new MissingExecutableNotice(logger, shared, counting('Show Output')).show(COMMAND);

    const second = counting();
    await new MissingExecutableNotice(logger, shared, second).show(COMMAND);
    assert.strictEqual(second.calls, 1);
  });
});
