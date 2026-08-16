// Editor query helpers: what a test asks the extension host *about* a document.
//
// Imports vscode for real, so only src/test/integration may use it. This is the other half of
// host.ts - that one opens documents, this one interrogates them.

import * as assert from 'node:assert';
import * as vscode from 'vscode';

/** The position at the end of `prefix`, which the fixtures make land where the test needs the cursor. */
export function positionAfter(document: vscode.TextDocument, prefix: string): vscode.Position {
  const index = document.getText().indexOf(prefix);
  assert.ok(index !== -1, `the fixture has nothing matching ${JSON.stringify(prefix)}`);
  return document.positionAt(index + prefix.length);
}

/**
 * Note the return type: this command answers with a CompletionList, not an array. Treating it as one
 * fails at runtime rather than at compile time.
 *
 * `documentation` is deliberately asserted nowhere - without an itemResolveCount argument VS Code
 * never calls resolveCompletionItem, so it would always be undefined.
 *
 * Pass `triggerCharacter` where the provider declares one: that is how the widget really opens there.
 */
export async function completionsAt(document: vscode.TextDocument, prefix: string, triggerCharacter?: string): Promise<vscode.CompletionItem[]> {
  const list = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider',
    document.uri,
    positionAfter(document, prefix),
    triggerCharacter
  );
  return list?.items ?? [];
}

export async function definitionsAt(document: vscode.TextDocument, prefix: string): Promise<vscode.LocationLink[]> {
  const links = await vscode.commands.executeCommand<vscode.LocationLink[]>(
    'vscode.executeDefinitionProvider',
    document.uri,
    positionAfter(document, prefix)
  );
  return links ?? [];
}

/**
 * A label is declared as a plain string at the 1.57 API floor, but the host these tests run in is much
 * newer and other providers do answer with the CompletionItemLabel form, so both shapes reach here.
 */
export function labelOf(item: vscode.CompletionItem): string {
  const label: unknown = item.label;
  if (typeof label === 'string') {
    return label;
  }
  return typeof label === 'object' && label !== null && 'label' in label ? String(label.label) : String(label);
}

export function labelsOf(items: readonly vscode.CompletionItem[]): string[] {
  return items.map(labelOf);
}

/**
 * How many of a document's published diagnostics carry `code`.
 *
 * A count rather than a predicate because the two configuration watcher suites need to tell "the
 * rule is off" from "the rule is on and reporting a different number of lines", which is what makes
 * a written config file distinguishable from the fixture's own.
 *
 * The shape check is not defensive: mapOffenses attaches the linter's documentation URL, so `code`
 * is the {value, target} form rather than the string it is declared as.
 */
export function countDiagnosticsWithCode(uri: vscode.Uri, code: string): number {
  return vscode.languages
    .getDiagnostics(uri)
    .filter((diagnostic) => (typeof diagnostic.code === 'object' && diagnostic.code !== null ? String(diagnostic.code.value) : '') === code).length;
}

/** Formats with the tabSize and insertSpaces the shipped [haml] defaults give a real editor. */
export function formatDocument(document: vscode.TextDocument): Thenable<vscode.TextEdit[] | undefined> {
  return vscode.commands.executeCommand<vscode.TextEdit[] | undefined>('vscode.executeFormatDocumentProvider', document.uri, {
    tabSize: 2,
    insertSpaces: true
  });
}
