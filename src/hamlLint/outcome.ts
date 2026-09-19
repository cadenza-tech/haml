// Turning one finished haml-lint process into the answer a run produced. Pure; no vscode imports.
//
// Which stream carries the report for which mode, what a missing gem looks like, and what a failure
// is called are all haml-lint knowledge. This module never logs: the caller owns the output channel
// and decides at what level to report.

import type { HamlLintReport } from '../types';
import { classifyExitCode } from './exitCodes';
import { parseReport, parseReportLine } from './parser';
import type { SpawnFailureReason, SpawnResult } from './process';

/**
 * `bundle exec` failing because the gem is absent, rather than because linting failed.
 *
 * Two message shapes, both verified against bundler's source: "Could not find <gem> ..." (SpecSet,
 * also the GemNotFound exception text) when the lockfile names haml_lint but it is not installed,
 * and "bundler: command not found: haml-lint" (CLI::Exec, exit 127) when the bundle does not
 * contain the gem at all - the shape `useBundler: "always"` produces on a project without it.
 */
const MISSING_GEM_PATTERN = /Could not find|bundler: command not found|Bundler::GemNotFound/i;

/** What haml-lint is asked to do. `formatter` is the mode already resolved, never re-derived here. */
export type RunRequest = { readonly mode: 'lint' } | { readonly mode: 'format-and-lint'; readonly formatter: 'safe' | 'all' };

/**
 * Why a run produced no report.
 *
 * A closed vocabulary, unlike the free-form strings this replaces: `diagnostics.ts` branches on two
 * of these, and a token nobody can typo is what makes that safe. Human-readable context travels in
 * `detail` instead.
 */
export type RunFailureReason = SpawnFailureReason | 'not-eligible' | 'timed-out-before' | 'exit' | 'unparseable-report';

export interface RunOutcome {
  readonly report?: HamlLintReport;
  readonly correctedSource?: string;
}

export type RunResult =
  | { readonly ok: true; readonly outcome: RunOutcome }
  | {
      readonly ok: false;
      readonly kind: 'skipped' | 'failed';
      readonly reason: RunFailureReason;
      /** The sentence for the output channel. Never matched on. */
      readonly detail?: string;
      /**
       * The resolved command an `enoent` failure could not find. The missing-executable notice
       * names this rather than re-resolving, because the run that failed may have been the
       * missing-gem retry, whose command a fresh resolution under the original config never yields.
       */
      readonly command?: string;
    };

/**
 * Whether a failure means "we chose not to run", as opposed to "we tried and it went wrong".
 *
 * `cancelled` counts as a skip: a superseded onType tick is the extension's own decision, and
 * reporting it as an error would put a line in the output channel on most keystrokes.
 */
export function isSkip(reason: RunFailureReason): boolean {
  return reason === 'untrusted' || reason === 'cancelled' || reason === 'not-eligible' || reason === 'timed-out-before';
}

/** Builds a failure with `kind` derived from the reason, so the two can never disagree. */
export function failure(reason: RunFailureReason, detail?: string, command?: string): RunResult {
  return {
    ok: false,
    kind: isSkip(reason) ? 'skipped' : 'failed',
    reason,
    ...(detail === undefined ? {} : { detail }),
    ...(command === undefined ? {} : { command })
  };
}

export function looksLikeMissingGem(result: SpawnResult): boolean {
  if (!result.ok) {
    return false;
  }
  // "anything but a report", not "error": CLI::Exec's shape for this exits 127, which classifies as
  // not-found. Matching only 'error' would strand both callers on the very code that names them -
  // the PATH retry in execute(), and the probeVersion fallback that decides `formatter: "auto"`.
  return classifyExitCode(result.code).kind !== 'report' && MISSING_GEM_PATTERN.test(result.stderr);
}

/**
 * Turns a finished spawn into the run's answer.
 *
 * Single pass puts the corrected source on stdout and the JSON report on stderr; lint-only puts the
 * report on stdout.
 *
 * `command` is what the run actually invoked, and only an exit 127 uses it: that failure means the
 * program never started, so it is reported as `enoent` and reaches the missing-executable notice.
 * The caller passes it because a spawn that finished carries no command of its own, and after the
 * missing-gem retry the notice must name the executable that failed rather than the bundle command
 * that ran fine.
 */
export function interpretResult(result: SpawnResult, mode: RunRequest['mode'], command?: string): RunResult {
  if (!result.ok) {
    return failure(result.reason, result.message, result.command);
  }

  const classification = classifyExitCode(result.code);
  if (classification.kind === 'not-found') {
    // Before any parse, so the formatter's `!result.ok` guard still returns null and nothing is
    // written back to the buffer - a 127 must never look like an empty correction.
    return failure('enoent', classification.reason, command);
  }
  if (classification.kind === 'error') {
    return failure('exit', classification.reason);
  }

  if (mode === 'lint') {
    const parsed = parseReport(result.stdout);
    if (!parsed.ok) {
      // Bundler and gems occasionally write to the same stream, and exit 70 puts a backtrace there.
      return failure('unparseable-report', 'could not parse the haml-lint report; keeping the previous diagnostics');
    }
    return { ok: true, outcome: { report: parsed.report } };
  }

  // The report shares stderr with every warning Ruby, Bundler or a gem prints, so it is looked for
  // line by line. Finding it there is also what vouches for stdout: a wrapper that merges the streams
  // leaves the report in stdout, and then stdout is not a corrected source to write back.
  const parsed = parseReportLine(result.stderr);
  if (!parsed.ok) {
    return failure('unparseable-report', 'could not find the haml-lint report on stderr; applying no corrections');
  }
  // And the other half of the same check: a wrapper that copies both streams into both (`tee`) puts
  // a report on stderr *and* in stdout, which is then still not a corrected source.
  if (parseReportLine(result.stdout).ok) {
    return failure('unparseable-report', 'found a haml-lint report in stdout, where the corrected source belongs; applying no corrections');
  }
  return { ok: true, outcome: { report: parsed.report, correctedSource: result.stdout } };
}
