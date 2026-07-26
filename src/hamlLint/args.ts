// haml-lint command line construction. Pure; no vscode imports.
//
// This is the ONLY place that builds autocorrect arguments, because of one invariant:
//
//   runner.rb: @autocorrect_stdout = options[:stdin] && options[:stderr]
//
// haml-lint only writes the corrected source to stdout when BOTH --stdin and --stderr are given.
// Drop --stderr and document.rb's write_to_disk! calls File.write instead, silently rewriting the
// user's file behind the editor's back while the buffer is dirty. Keeping the flag next to the
// -a/-A that requires it, in a single function, is what makes that impossible to get wrong.

import type { ResolvedFormatterMode } from '../types';

const AUTOCORRECT_FLAG: Readonly<Record<Exclude<ResolvedFormatterMode, 'none'>, string>> = {
  safe: '-a',
  all: '-A'
};

export interface BaseArgsOptions {
  /** Absolute path reported to haml-lint for the piped source. */
  readonly stdinPath: string;
  /** Passed through as -c. */
  readonly configPath?: string | null;
}

export interface AutocorrectArgsOptions extends BaseArgsOptions {
  readonly mode: Exclude<ResolvedFormatterMode, 'none'>;
}

function configArgs(configPath: string | null | undefined): string[] {
  return configPath ? ['-c', configPath] : [];
}

/** Lint only: JSON report on stdout. */
export function buildLintArgs(options: BaseArgsOptions): string[] {
  return ['--reporter', 'json', ...configArgs(options.configPath), '--stdin', options.stdinPath];
}

/**
 * Autocorrect: corrected source on stdout, JSON report on stderr. Always pairs -a/-A with --stderr.
 *
 * --auto-correct-only is deliberately never passed. Without it haml-lint also lints the corrected
 * document, so one process yields both the formatted source and the diagnostics that follow it.
 */
export function buildAutocorrectArgs(options: AutocorrectArgsOptions): string[] {
  return [AUTOCORRECT_FLAG[options.mode], '--stderr', '--reporter', 'json', ...configArgs(options.configPath), '--stdin', options.stdinPath];
}

/** Probes the installed version. */
export function buildVersionArgs(): string[] {
  return ['--version'];
}
