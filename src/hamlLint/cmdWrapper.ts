// Windows argument quoting for .bat/.cmd executables. Pure; no vscode imports.
//
// Nothing to do with spawning: it turns one command line into another, and the process runner never
// calls it. Keeping it out of process.ts is what stops that file from looking like it owns two
// subjects.

import * as path from 'node:path';

export interface ResolvedCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly windowsVerbatimArguments: boolean;
}

/**
 * cmd.exe's metacharacters, `%` included: cmd expands `%NAME%` even inside double quotes and no
 * flag turns that off, so a document named `sale%OS%.haml` would reach haml-lint as
 * `saleWindows_NT.haml` and per-linter include/exclude matching would silently miss it.
 *
 * The escaping is ported from cross-spawn's escape.js (MIT, https://github.com/moxystudio/node-cross-spawn,
 * itself based on https://qntm.org/cmd): caret-escape every metacharacter - which also splits
 * `%NAME%` pairs so percent expansion never sees a name - and give arguments the pass twice,
 * because cmd parses the line once for itself and once more when it hands off to a batch file.
 */
const CMD_METACHARACTERS = /([()\][%!^"`<>&|;, *?])/g;

function escapeCommandToken(token: string): string {
  return token.replace(CMD_METACHARACTERS, '^$1');
}

function escapeArgumentToken(token: string): string {
  // Double the backslashes that precede a quote (embedded or the closing one about to be added),
  // so the argv parsing the batch file's interpreter applies reads them literally.
  let escaped = token.replace(/(\\*)"/g, '$1$1\\"');
  escaped = escaped.replace(/(\\*)$/, '$1$1');
  escaped = `"${escaped}"`;
  return escaped.replace(CMD_METACHARACTERS, '^$1').replace(CMD_METACHARACTERS, '^$1');
}

/**
 * Wraps .bat/.cmd invocations in cmd.exe.
 *
 * Since CVE-2024-27980 Node refuses to spawn a batch file without a shell, and `shell: true` would
 * reopen command injection through the user-configurable executable path. Going through ComSpec
 * explicitly keeps argument handling under our control.
 *
 * With ComSpec absent, cmd.exe is addressed absolutely under SystemRoot - the same resolution
 * killTree applies to taskkill.exe, and for the same reason: handing CreateProcess a bare name lets
 * it search the current directory, which is the workspace, before PATH.
 */
export function applyCmdWrapper(
  command: string,
  args: readonly string[],
  needsCmdWrapper: boolean,
  comSpec?: string,
  systemRoot?: string
): ResolvedCommand {
  if (!needsCmdWrapper) {
    return { command, args, windowsVerbatimArguments: false };
  }
  // `||` rather than `??`, matching cross-spawn: an empty ComSpec must fall back too, or spawn('')
  // throws synchronously and the wrapper path is dead in that environment.
  const shell = comSpec || `${systemRoot || 'C:\\Windows'}\\System32\\cmd.exe`;
  // The command token is caret-escaped rather than quoted, and cmd.exe reads an unquoted `/` as the
  // start of a switch: `C:/Ruby/bin/haml-lint.bat` would run `C:`. cross-spawn normalizes here too.
  const line = [escapeCommandToken(path.win32.normalize(command)), ...args.map(escapeArgumentToken)].join(' ');
  return { command: shell, args: ['/d', '/s', '/c', `"${line}"`], windowsVerbatimArguments: true };
}
