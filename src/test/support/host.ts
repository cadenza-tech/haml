// Extension host helpers. Imports vscode for real, so only src/test/integration may use it.

import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { parseVersion, supportsHamlAutocorrect } from '../../hamlLint/version';

export const EXTENSION_ID = 'cadenza-tech.vscode-haml';
export const FIXTURE_VIEWS = 'app/views';

/** Absolute path inside src/test/fixtures/rails-like, which .vscode-test.mjs opens as the folder. */
export function fixturePath(...segments: string[]): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder !== undefined, 'the test workspace folder is missing; check workspaceFolder in .vscode-test.mjs');
  return path.join(folder.uri.fsPath, ...segments);
}

export function fixtureUri(...segments: string[]): vscode.Uri {
  return vscode.Uri.file(fixturePath(...segments));
}

export function viewUri(name: string): vscode.Uri {
  return fixtureUri(FIXTURE_VIEWS, name);
}

/** Opens a view without showing it. Most tests only need the document. */
export function openView(name: string): Thenable<vscode.TextDocument> {
  return vscode.workspace.openTextDocument(viewUri(name));
}

/** Opens a view *and* makes it active, for the tests that read window.activeTextEditor. */
export async function showView(name: string): Promise<vscode.TextEditor> {
  return vscode.window.showTextDocument(await openView(name), { preview: false });
}

/** Asserts the extension exists rather than silently doing nothing, which `?.activate()` did. */
export async function activateExtension(): Promise<void> {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension !== undefined, `${EXTENSION_ID} is not installed in the test host`);
  await extension.activate();
}

let probe: { available: boolean; autocorrect: boolean } | undefined;

/** One `haml-lint --version` per host rather than one per suite; both answers come from it. */
function hamlLintProbe(): { available: boolean; autocorrect: boolean } {
  if (probe === undefined) {
    try {
      const output = execFileSync('haml-lint', ['--version'], { encoding: 'utf8' });
      probe = { available: true, autocorrect: supportsHamlAutocorrect(parseVersion(output)) };
    } catch {
      probe = { available: false, autocorrect: false };
    }
  }
  return probe;
}

/** Whether the gem is on PATH at all. */
export function hamlLintAvailable(): boolean {
  return hamlLintProbe().available;
}

/**
 * Whether the gem on PATH corrects Haml and not only the RuboCop cops.
 *
 * The CI matrix deliberately runs a leg below the 0.74.0 floor, where `haml.formatter: "auto"`
 * resolves to none and formatting is a no-op by design. A test that asserts edits appear - or that
 * none do - has to know which leg it is on, or the two legs cannot both be green.
 */
export function hamlLintSupportsAutocorrect(): boolean {
  return hamlLintProbe().autocorrect;
}

/** Call from suiteSetup with `this`: skips the suite when the gem is absent. */
export function skipWithoutHamlLint(context: Mocha.Context): void {
  if (!hamlLintAvailable()) {
    context.skip();
  }
}
