// Command palette entries.

import * as vscode from 'vscode';
import type { CapabilityCache } from './capabilities';
import type { DiagnosticsController } from './diagnostics';
import type { HamlFormattingEditProvider } from './formatter';
import { resolveHamlDocument } from './hamlDocuments';
import type { Logger } from './logger';
import type { HamlConfig } from './types';

export interface CommandDeps {
  readonly diagnostics: DiagnosticsController;
  readonly formatter: HamlFormattingEditProvider;
  readonly capabilities: CapabilityCache;
  readonly logger: Logger;
  readonly getConfig: (resource: vscode.Uri) => HamlConfig;
  /**
   * Re-lints and re-primes every open Haml document.
   *
   * Injected rather than built here: the action needs diagnostics, capabilities and the logger all
   * at once, so it can only be assembled in activate(), and commands.ts cannot import extension.ts.
   */
  readonly sweep: (reason: string, force: boolean) => void;
}

export function registerCommands(deps: CommandDeps): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('haml.lintFile', async (uri?: vscode.Uri) => {
      const document = await resolveHamlDocument(uri);
      if (document === undefined) {
        return;
      }
      // Forced: an explicit Lint File that reused an existing report, or declined to run because an
      // earlier run timed out, would look like the command did nothing.
      await deps.diagnostics.lint(document, deps.getConfig(document.uri), true);
    }),

    vscode.commands.registerCommand('haml.fixAll', async (uri?: vscode.Uri) => {
      const document = await resolveHamlDocument(uri);
      if (document === undefined) {
        return;
      }
      const edit = await deps.formatter.computeEdit(document);
      if (edit === null) {
        // Also the normal outcome for an already-clean file: haml-lint emits nothing to apply.
        deps.logger.info('nothing to auto-correct');
        return;
      }
      const workspaceEdit = new vscode.WorkspaceEdit();
      workspaceEdit.set(document.uri, [edit]);
      await vscode.workspace.applyEdit(workspaceEdit);
    }),

    vscode.commands.registerCommand('haml.restartLinter', () => {
      deps.capabilities.invalidate();
      // Forced, because "restart" has to mean every conclusion is dropped, including the report
      // already published and the back-off from a run that timed out.
      deps.sweep('linter state cleared; the haml-lint version will be probed again', true);
    }),

    vscode.commands.registerCommand('haml.showOutput', () => {
      deps.logger.show();
    })
  ];
}
