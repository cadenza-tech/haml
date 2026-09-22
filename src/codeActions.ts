// Code actions.
//
// A per-offense quick fix is not implementable honestly: haml-lint reports no column, `-a` corrects
// everything correctable in the file at once, and `correctable` only exists from 0.76.0. So the
// autocorrect side is offered per file, and the per-line actions are the ones that need no
// subprocess at all.

import * as vscode from 'vscode';
import { eolOf, snapshotOf } from './documentSnapshot';
import type { HamlFormattingEditProvider } from './formatter';
import { buildDisableComment, disableActionTitle, planDisableActions } from './pure/disableComment';
import type { HamlConfig } from './types';

export const FIX_ALL_TITLE = 'Fix all auto-correctable Haml offenses';
/**
 * A user-facing contract string: people write `source.fixAll.haml` in editor.codeActionsOnSave, so
 * this must not follow HAML_LANGUAGE_ID if that ever moves.
 */
export const FIX_ALL_KIND = vscode.CodeActionKind.SourceFixAll.append('haml');

export class HamlCodeActionProvider implements vscode.CodeActionProvider {
  static readonly metadata: vscode.CodeActionProviderMetadata = {
    providedCodeActionKinds: [FIX_ALL_KIND, vscode.CodeActionKind.SourceFixAll, vscode.CodeActionKind.QuickFix]
  };

  constructor(
    // Narrowed to what is actually called, so a test can pass a two-line fake without a cast.
    private readonly formatter: Pick<HamlFormattingEditProvider, 'computeEdit'>,
    private readonly getConfig: (resource: vscode.Uri) => HamlConfig
  ) {}

  async provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [...this.disableActions(document, context)];
    const config = this.getConfig(document.uri);

    if (config.formatter === 'none') {
      return actions;
    }

    // provideCodeActions fires on every cursor move, so the lightbulb path must never spawn.
    // Only an explicit invocation or codeActionsOnSave, which set context.only, computes the edit.
    const requestedExplicitly = context.only?.intersects(vscode.CodeActionKind.SourceFixAll) === true;
    if (!requestedExplicitly) {
      const deferred = new vscode.CodeAction(FIX_ALL_TITLE, FIX_ALL_KIND);
      deferred.command = { command: 'haml.fixAll', title: FIX_ALL_TITLE, arguments: [document.uri] };
      actions.push(deferred);
      return actions;
    }

    try {
      const edit = await this.formatter.computeEdit(document, token);
      if (edit !== null) {
        const action = new vscode.CodeAction(FIX_ALL_TITLE, FIX_ALL_KIND);
        action.edit = new vscode.WorkspaceEdit();
        action.edit.set(document.uri, [edit]);
        actions.push(action);
      }
    } catch {
      // This path is codeActionsOnSave, so a throw would surface as an error on every save.
      // computeEdit already logs; offering only the disable actions is the better failure.
    }
    return actions;
  }

  /**
   * Pure text edits with no process behind them. Which ones is decided in src/pure.
   *
   * Not free, though: placing each pair walks the lines around its offense, and codeActionsOnSave
   * asks for `source.fixAll` over the whole document with every diagnostic in it. VS Code drops what
   * is not of the kind it asked for, so none are built unless a quick fix could be kept.
   */
  private disableActions(document: vscode.TextDocument, context: vscode.CodeActionContext): vscode.CodeAction[] {
    if (context.only !== undefined && !context.only.contains(vscode.CodeActionKind.QuickFix)) {
      return [];
    }
    const snapshot = snapshotOf(document);
    const eol = eolOf(document);

    return planDisableActions(
      context.diagnostics.map((diagnostic) => ({
        source: diagnostic.source,
        code: diagnostic.code,
        line: diagnostic.range.start.line
      }))
    ).map((plan) => {
      const action = new vscode.CodeAction(disableActionTitle(plan.linterName), vscode.CodeActionKind.QuickFix);
      action.diagnostics = [context.diagnostics[plan.index] as vscode.Diagnostic];
      action.edit = new vscode.WorkspaceEdit();
      for (const insertion of buildDisableComment(plan.line, plan.linterName, snapshot, eol)) {
        action.edit.insert(document.uri, new vscode.Position(insertion.line, insertion.character), insertion.text);
      }
      return action;
    });
  }
}
