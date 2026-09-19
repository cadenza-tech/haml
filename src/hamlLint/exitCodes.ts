// haml-lint exit codes. Pure; no vscode imports.
//
// haml-lint's CLI intends to use sysexits, but the intent is not reliable: on 0.76.0 an invalid
// flag exits 1 with a Ruby backtrace because handle_exception itself raises before the logger is
// built. Only 0 and 65 are therefore treated as "a report was produced"; everything else is an
// error, whatever the number. That allowlist is what makes the classification robust.
//
// 127 is the one error that is not haml-lint's at all, which is why it gets its own kind. Every
// code it can produce is either a Sysexits constant cli.rb names (0, 64, 65, 66, 70, 78) or the 1
// Ruby gives an uncaught exception; 127 is the convention of whatever tried to launch it and
// never did. A version manager shim is the common source - rbenv prints "rbenv: haml-lint: command
// not found" and exits 127 when the Ruby selected for the cwd lacks the gem, and since cwd is the
// directory owning .haml-lint.yml, that is decided per project. The command resolved to a real
// file, so Node reports no ENOENT and the missing-executable notice would otherwise stay silent
// for exactly the users who need it.

/** No offenses. */
const EXIT_OK = 0;
/** EX_USAGE: bad command line. */
const EXIT_USAGE = 64;
/** EX_DATAERR: offenses at or above the fail level. This is a NORMAL outcome. */
const EXIT_OFFENSES = 65;
/** EX_NOINPUT: file not found / no linters. */
const EXIT_NO_INPUT = 66;
/** EX_SOFTWARE: crashed. The backtrace goes where cli.rb's logger points: stderr with --stderr, stdout without. */
const EXIT_SOFTWARE = 70;
/** EX_CONFIG: configuration error. */
const EXIT_CONFIG = 78;
/** Not haml-lint's own: the conventional "could not find the program" of whatever launched it. */
const EXIT_COMMAND_NOT_FOUND = 127;

export type ExitClassification =
  | { readonly kind: 'report' }
  | { readonly kind: 'not-found'; readonly reason: string }
  | { readonly kind: 'error'; readonly reason: string };

/**
 * Classifies a haml-lint exit code.
 *
 * Only decides whether a report was produced. Never derive "has offenses" from the exit code:
 * --fail-level is user configurable, so a project with `fail_level: error` exits 0 while warnings
 * are present. Offense presence always comes from the parsed JSON.
 */
export function classifyExitCode(code: number | null): ExitClassification {
  switch (code) {
    case EXIT_OK:
    case EXIT_OFFENSES:
      return { kind: 'report' };
    case EXIT_USAGE:
      return { kind: 'error', reason: 'haml-lint rejected the command line (exit 64)' };
    case EXIT_NO_INPUT:
      return { kind: 'error', reason: 'haml-lint found no input to lint (exit 66)' };
    case EXIT_SOFTWARE:
      return { kind: 'error', reason: 'haml-lint crashed (exit 70)' };
    case EXIT_CONFIG:
      return { kind: 'error', reason: 'haml-lint could not load its configuration (exit 78)' };
    case EXIT_COMMAND_NOT_FOUND:
      return {
        kind: 'not-found',
        reason:
          'haml-lint resolved to a real file but could not be started (exit 127). A version manager shim reports this ' +
          'when the Ruby selected for the linted directory does not have haml_lint installed.'
      };
    default:
      return { kind: 'error', reason: `haml-lint exited with ${code === null ? 'no code' : code}` };
  }
}
