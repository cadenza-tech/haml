// Output channel wrapper.
//
// LogOutputChannel (createOutputChannel(name, { log: true })) is VS Code 1.74+, and this extension
// declares ^1.57.0, so levels are prefixed by hand instead.

import * as vscode from 'vscode';

const CHANNEL_NAME = 'Haml';
/** Enough of a backtrace or a polluted stream to diagnose it, without pasting a whole file. */
const DETAIL_LIMIT = 8000;

export class Logger implements vscode.Disposable {
  private readonly channel: vscode.OutputChannel;

  constructor() {
    this.channel = vscode.window.createOutputChannel(CHANNEL_NAME);
  }

  info(message: string): void {
    this.write('INFO', message);
  }

  warn(message: string): void {
    this.write('WARN', message);
  }

  error(message: string, error?: unknown): void {
    const detail = error === undefined ? '' : ` ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
    this.write('ERROR', message + detail);
  }

  /** Records exactly what was run, so "it does not work" reports can be triaged from the channel alone. */
  command(command: string, args: readonly string[], cwd: string): void {
    this.info(`run: ${command} ${args.join(' ')} (cwd: ${cwd})`);
  }

  /** Truncates so a crash backtrace or a polluted stream cannot flood the channel. */
  detail(label: string, text: string, limit = DETAIL_LIMIT): void {
    const trimmed = text.trim();
    if (trimmed === '') {
      return;
    }
    const body = trimmed.length > limit ? `${trimmed.slice(0, limit)}\n... (truncated, ${trimmed.length} bytes total)` : trimmed;
    this.write('INFO', `${label}:\n${body}`);
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }

  private write(level: string, message: string): void {
    this.channel.appendLine(`[${new Date().toISOString()}] [${level}] ${message}`);
  }
}
