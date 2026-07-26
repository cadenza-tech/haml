// The "could not run haml-lint" notification.
//
// Its own module because it is self-contained UX - a persisted opt-out, a per-session guard and one
// dialog - with nothing in common with the debouncing, cancellation and generation counting
// DiagnosticsController exists for. It was the only reason that class took a Memento at all.

import * as vscode from 'vscode';
import type { Logger } from './logger';

const SUPPRESS_KEY = 'haml.suppressMissingExecutableNotice';

/** Injected so tests can count how often the user is interrupted. */
export type Notifier = (message: string, ...items: string[]) => Thenable<string | undefined>;

export class MissingExecutableNotice {
  /**
   * Commands already reported this session.
   *
   * Without this, every open and every save of a .haml file raises another warning: the persisted
   * "Don't Show Again" list is the only other guard, so someone who installed the extension purely
   * for highlighting and has no Ruby would be buried in notifications.
   */
  private readonly noticed = new Set<string>();

  constructor(
    private readonly logger: Logger,
    private readonly memento: vscode.Memento,
    private readonly notify: Notifier = (message, ...items) => vscode.window.showWarningMessage(message, ...items)
  ) {}

  /** Called when settings change, so fixing the executable path makes the notice relevant again. */
  reset(): void {
    this.noticed.clear();
  }

  async show(command: string): Promise<void> {
    // Keyed on the resolved command and scoped to the workspace: silencing this once in a
    // Ruby-less repository must not mute it forever in the user's actual Rails project.
    const suppressed = this.memento.get<string[]>(SUPPRESS_KEY, []);
    if (suppressed.includes(command) || this.noticed.has(command)) {
      return;
    }
    // Marked before awaiting the dialog: opening several .haml files fires several lints at once,
    // and they would all slip past a check that only completed after the dialog was dismissed.
    this.noticed.add(command);

    this.logger.warn(`could not run ${command}. Install haml-lint, or set "haml.hamlLint.executablePath".`);
    const choice = await this.notify(
      `Haml: could not run \`${command}\`. Install haml-lint to enable diagnostics and formatting.`,
      'Show Output',
      "Don't Show Again"
    );
    if (choice === 'Show Output') {
      this.logger.show();
    } else if (choice === "Don't Show Again") {
      // Re-read rather than reusing `suppressed`: two notices can be open at once (multi-root
      // resolves different commands), and a list captured before the dialogs would make the second
      // update erase the first one's entry.
      const current = this.memento.get<string[]>(SUPPRESS_KEY, []);
      if (!current.includes(command)) {
        await this.memento.update(SUPPRESS_KEY, [...current, command]);
      }
    }
  }
}
