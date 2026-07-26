import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { FIX_ALL_KIND, FIX_ALL_TITLE, HamlCodeActionProvider } from '../../codeActions';
import type { HamlFormattingEditProvider } from '../../formatter';
import { DIAGNOSTIC_SOURCE } from '../../pure/diagnosticMapper';
import { config } from '../support/doubles';
import { activateExtension, openView, viewUri } from '../support/host';

/** Counts computeEdit calls: "the lightbulb never spawns" is a count, not a shape. */
function fakeFormatter(edit: vscode.TextEdit | null): Pick<HamlFormattingEditProvider, 'computeEdit'> & { calls: number } {
  const formatter = {
    calls: 0,
    async computeEdit(): Promise<vscode.TextEdit | null> {
      formatter.calls++;
      return edit;
    }
  };
  return formatter;
}

function context(overrides: Partial<vscode.CodeActionContext> = {}): vscode.CodeActionContext {
  return { diagnostics: [], triggerKind: vscode.CodeActionTriggerKind.Automatic, only: undefined, ...overrides };
}

function hamlLintDiagnostic(line: number, code: string | { value: string; target: vscode.Uri } | undefined): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(new vscode.Range(line, 0, line, 5), 'Line is too long', vscode.DiagnosticSeverity.Warning);
  diagnostic.source = DIAGNOSTIC_SOURCE;
  if (code !== undefined) {
    diagnostic.code = code;
  }
  return diagnostic;
}

const SOME_EDIT = vscode.TextEdit.replace(new vscode.Range(0, 0, 0, 1), 'x');

suite('code action provider Test Suite', () => {
  let document: vscode.TextDocument;

  suiteSetup(async () => {
    await activateExtension();
    document = await openView('clean.haml');
  });

  const providerFor = (formatter: Pick<HamlFormattingEditProvider, 'computeEdit'>, formatterMode: 'safe' | 'none' = 'safe') =>
    new HamlCodeActionProvider(formatter, () => config({ formatter: formatterMode }));

  const range = new vscode.Range(0, 0, 0, 0);
  const noToken = new vscode.CancellationTokenSource().token;

  suite('fix all', () => {
    // provideCodeActions fires on every cursor move. Before this test nothing checked that the
    // lightbulb path defers instead of computing, so a regression would have started one Ruby
    // process per cursor move with no failing test to show for it.
    test('should defer to a command without computing when the lightbulb asks', async () => {
      const formatter = fakeFormatter(SOME_EDIT);
      const actions = await providerFor(formatter).provideCodeActions(document, range, context(), noToken);

      assert.strictEqual(formatter.calls, 0, 'the lightbulb path must never spawn haml-lint');
      const fixAll = actions.find((action) => action.kind?.value === FIX_ALL_KIND.value);
      assert.ok(fixAll !== undefined);
      assert.strictEqual(fixAll.edit, undefined, 'a deferred action carries a command, not an edit');
      assert.strictEqual(fixAll.command?.command, 'haml.fixAll');
      assert.strictEqual(fixAll.title, FIX_ALL_TITLE);
    });

    test('should compute the edit when source.fixAll is requested explicitly', async () => {
      const formatter = fakeFormatter(SOME_EDIT);
      const only = context({ only: vscode.CodeActionKind.SourceFixAll });
      const actions = await providerFor(formatter).provideCodeActions(document, range, only, noToken);

      assert.strictEqual(formatter.calls, 1);
      const fixAll = actions.find((action) => action.kind?.value === FIX_ALL_KIND.value);
      assert.ok(fixAll?.edit !== undefined, 'an explicit request carries the edit itself');
      assert.strictEqual(fixAll.command, undefined);
    });

    test('should offer nothing to fix when there is no edit', async () => {
      const formatter = fakeFormatter(null);
      const only = context({ only: vscode.CodeActionKind.SourceFixAll });
      const actions = await providerFor(formatter).provideCodeActions(document, range, only, noToken);

      assert.strictEqual(formatter.calls, 1);
      assert.strictEqual(
        actions.find((action) => action.kind?.value === FIX_ALL_KIND.value),
        undefined
      );
    });

    test('should offer no fix all at all when the formatter is off', async () => {
      const formatter = fakeFormatter(SOME_EDIT);
      const only = context({ only: vscode.CodeActionKind.SourceFixAll, diagnostics: [hamlLintDiagnostic(0, 'LineLength')] });
      const actions = await providerFor(formatter, 'none').provideCodeActions(document, range, only, noToken);

      assert.strictEqual(formatter.calls, 0);
      assert.strictEqual(
        actions.find((action) => action.kind?.value === FIX_ALL_KIND.value),
        undefined
      );
      assert.strictEqual(actions.length, 1, 'the disable action costs nothing and is still offered');
    });
  });

  suite('disable quick fixes', () => {
    test('should attach the diagnostic the action answers', async () => {
      // Line 0: clean.haml is a single line, and buildDisableComment reads the line it is given.
      const diagnostic = hamlLintDiagnostic(0, 'AltText');
      const actions = await providerFor(fakeFormatter(null)).provideCodeActions(document, range, context({ diagnostics: [diagnostic] }), noToken);

      const quickFix = actions.find((action) => action.kind?.value === vscode.CodeActionKind.QuickFix.value);
      assert.ok(quickFix !== undefined);
      assert.deepStrictEqual(quickFix.diagnostics, [diagnostic]);
      assert.ok(quickFix.edit !== undefined, 'the comment pair is a plain edit, so it is offered directly');
    });
  });

  // The one thing constructing the provider directly cannot show: that it is wired to .haml files
  // with the metadata VS Code needs to offer source.fixAll.haml at all.
  //
  // Deliberately unfiltered. Passing the kind would set context.only, which is the path that calls
  // the real formatter - a Ruby process, and then no action at all for a file with nothing to fix.
  // The lightbulb path answers the registration question without either.
  test('should be registered for haml documents', async () => {
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', viewUri('clean.haml'), range);
    assert.ok(actions !== undefined, 'executeCodeActionProvider found no provider at all');
    const fixAll = actions.find((action) => action.title === FIX_ALL_TITLE);
    assert.ok(fixAll !== undefined, 'the provider must be registered against HAML_SELECTOR');
    assert.strictEqual(fixAll.kind?.value, FIX_ALL_KIND.value, 'and it must declare source.fixAll.haml, which codeActionsOnSave asks for by name');
  });
});
