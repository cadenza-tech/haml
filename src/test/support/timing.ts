// Shared by the "should stay fast on a very long line" guards in src/test/pure.

/** The budget every one of those guards is held to, so it is one decision rather than three. */
export const FAST_ENOUGH_MS = 50;

/**
 * The fastest of several runs, in milliseconds.
 *
 * These guards exist to catch an *algorithmic* regression - the quadratic `computeCompletionWord`
 * they were written for took two seconds on a 30,000 character line - and something that slow is
 * slow on every attempt, so the best of several still catches it with room to spare. A single timed
 * run does not have that property: it occasionally catches a garbage collection in the extension
 * host and reports 100ms for work that takes one, failing the build while saying nothing about the
 * code.
 *
 * Build the inputs before calling rather than inside `run`: allocating a 100 KB string per attempt
 * is itself a good way to provoke the collection this is trying not to measure.
 */
export function fastestOf(run: () => void, attempts = 5): number {
  let fastest = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const started = Date.now();
    run();
    fastest = Math.min(fastest, Date.now() - started);
  }
  return fastest;
}

/**
 * The ceiling for a wait gated on a haml-lint run rather than on something the editor does.
 *
 * Every run boots Ruby and RuboCop from cold, which on a loaded machine takes tens of seconds, so
 * the 60 s default below - sized for an editor event - is the wrong budget. Two of these still fit
 * inside the 180 s mocha timeout the tests that need them declare.
 */
export const LINT_RUN_TIMEOUT_MS = 80000;

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls until `condition` holds, then returns; throws naming `what` if it never does.
 *
 * Polling rather than sleeping a fixed amount because a watcher event and a Ruby boot are both
 * unbounded, and a fixed sleep long enough to be safe makes every green run pay for it. The message
 * matters: a bare `assert.ok(list.length > 0)` after a loop says nothing about what was waited for.
 */
export async function waitFor(condition: () => boolean, what: string, timeoutMs = 60000, intervalMs = 250): Promise<void> {
  const attempts = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (condition()) {
      return;
    }
    await wait(intervalMs);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
}
