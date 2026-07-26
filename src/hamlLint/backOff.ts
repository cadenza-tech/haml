// The rule that a document which timed out is not retried until something about it changed.
// Pure; no vscode imports.

import type { SpawnResult } from './process';

/** What a document timed out under, so that changing either side of it is what lifts the back-off. */
export interface TimeoutRecord {
  readonly bytes: number;
  readonly timeoutMs: number;
}

/**
 * Whether to refuse a run outright.
 *
 * haml-lint is superlinear in document size - a ~19 KB file exceeds the default 15 s timeout on a
 * normal machine - and nothing about a save makes the next attempt faster. Without this, every save
 * and, in onType mode, every debounce tick starts another Ruby process that is killed 15 s later
 * having produced nothing. A byte count rather than a fixed size limit because how large is too
 * large depends on the machine, the bundle and the enabled cops; measuring it is more honest than
 * guessing it.
 */
export function shouldSkipForBackOff(record: TimeoutRecord | undefined, bytes: number, timeoutMs: number): boolean {
  return record !== undefined && bytes >= record.bytes && timeoutMs <= record.timeoutMs;
}

export type BackOffUpdate = { readonly kind: 'clear' } | { readonly kind: 'record'; readonly record: TimeoutRecord } | { readonly kind: 'keep' };

/**
 * What a finished run should do to the recorded back-off.
 *
 * Only a timeout records. A process that finished proves the document is within budget whatever its
 * exit code was, and a cancelled run - a superseded onType tick - says nothing about the document.
 */
export function backOffUpdateFor(result: SpawnResult, bytes: number, timeoutMs: number): BackOffUpdate {
  if (result.ok) {
    return { kind: 'clear' };
  }
  if (result.reason !== 'timeout') {
    return { kind: 'keep' };
  }
  return { kind: 'record', record: { bytes, timeoutMs } };
}
