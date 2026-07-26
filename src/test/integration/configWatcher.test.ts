import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { activateExtension, FIXTURE_VIEWS, fixturePath, openView, skipWithoutHamlLint } from '../support/host';
import { LINT_RUN_TIMEOUT_MS, waitFor } from '../support/timing';

/**
 * Written next to the document, so it wins the upward search over the fixture's own config.
 *
 * resolveCwd stops at the nearest .haml-lint.yml walking up from the document, and haml-lint then
 * searches upward from that cwd - so this file, not the one at the workspace root, is what it reads.
 */
const OVERRIDE = 'linters:\n  LineLength:\n    enabled: false\n';

function hasLineLength(uri: vscode.Uri): boolean {
  return vscode.languages
    .getDiagnostics(uri)
    .some((diagnostic) => (typeof diagnostic.code === 'object' && diagnostic.code !== null ? String(diagnostic.code.value) : '') === 'LineLength');
}

// .haml-lint.yml and .rubocop.yml are not VS Code settings, so onDidChangeConfiguration never fires
// for them. Without a watcher a changed rule only took effect the next time a .haml file happened to
// be edited and saved.
suite('haml-lint configuration watcher Test Suite', () => {
  const overridePath = fixturePath(FIXTURE_VIEWS, '.haml-lint.yml');

  suiteSetup(async function () {
    skipWithoutHamlLint(this);
    await activateExtension();
  });

  // Runs even when a test fails: leaving this behind would silently disable LineLength for every
  // suite that follows, and hamlLint.test.ts asserts it fires.
  teardown(async function () {
    this.timeout(180000);
    if (!fs.existsSync(overridePath)) {
      return;
    }
    fs.rmSync(overridePath);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(fixturePath(FIXTURE_VIEWS, 'offenses.haml')));
    await vscode.commands.executeCommand('haml.lintFile', document.uri);
    await waitFor(() => hasLineLength(document.uri), 'the fixture configuration to apply again', LINT_RUN_TIMEOUT_MS);
  });

  // Four Ruby boots end to end, counting the teardown. The suite-wide 60 s would leave the second
  // wait whatever the first did not use, which on a loaded CI runner is not enough. Raising this
  // alone does nothing, though: each waitFor keeps its own 60 s default, so a single slow boot
  // still fails a test with 180 s of budget left. Both ceilings have to move together.
  test('should re-lint open documents when .haml-lint.yml changes', async function () {
    this.timeout(180000);
    const document = await openView('offenses.haml');
    await vscode.commands.executeCommand('haml.lintFile', document.uri);
    await waitFor(() => hasLineLength(document.uri), 'the fixture LineLength offense', LINT_RUN_TIMEOUT_MS);

    // Nothing touches the document itself: the watcher is the only thing that can cause a re-lint.
    fs.writeFileSync(overridePath, OVERRIDE, 'utf8');

    await waitFor(() => !hasLineLength(document.uri), 'the offense to disappear once the rule was disabled', LINT_RUN_TIMEOUT_MS);
  });
});
