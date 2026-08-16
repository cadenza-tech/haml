import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { RULE_SWEEP_DELAY_MS } from '../../extension';
import { countDiagnosticsWithCode } from '../support/editor';
import { activateExtension, FIXTURE_VIEWS, fixturePath, openView, skipWithoutHamlLint } from '../support/host';
import { LINT_RUN_TIMEOUT_MS, wait, waitFor } from '../support/timing';

/**
 * Deliberately not the fixture root's `max: 40`, which writing this file shadows: offenses.haml has
 * one line over forty characters and two over ten, so waiting for *two* is a baseline the root
 * configuration cannot produce. Waiting for "at least one" would also be satisfied by the
 * diagnostics that were already on screen, and would prove nothing about this file having landed.
 */
const CONFIG = 'inherits_from:\n  - .haml-lint_todo.yml\nlinters:\n  LineLength:\n    max: 10\n';
const OFFENSES_UNDER_CONFIG = 2;
/** Written before the change under test so that the change is an edit, not a create. */
const TODO_INERT = 'linters:\n  LineLength:\n    enabled: true\n';
const TODO_DISABLING = 'linters:\n  LineLength:\n    enabled: false\n';

/*
 * Separate from configWatcher.test.ts because it pins something that suite cannot: haml-lint never
 * discovers .haml-lint_todo.yml itself, so nothing is wrong with the extension if the file is read
 * only when .haml-lint.yml is also touched. What has to hold is that its own watcher pattern is
 * right, and a wrong pattern fails silently - no error, just diagnostics that no longer match the
 * configuration.
 */
suite('haml-lint todo watcher Test Suite', () => {
  const configPath = fixturePath(FIXTURE_VIEWS, '.haml-lint.yml');
  const todoPath = fixturePath(FIXTURE_VIEWS, '.haml-lint_todo.yml');

  suiteSetup(async function () {
    skipWithoutHamlLint(this);
    await activateExtension();
  });

  // Runs even when the test fails: both files sit next to the fixture views and would silently
  // reconfigure every suite that follows.
  teardown(async function () {
    this.timeout(180000);
    const written = [configPath, todoPath].filter((file) => fs.existsSync(file));
    if (written.length === 0) {
      return;
    }
    for (const file of written) {
      fs.rmSync(file);
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(fixturePath(FIXTURE_VIEWS, 'offenses.haml')));
    await vscode.commands.executeCommand('haml.lintFile', document.uri);
    await waitFor(() => countDiagnosticsWithCode(document.uri, 'LineLength') === 1, 'the fixture configuration to apply again', LINT_RUN_TIMEOUT_MS);
  });

  test('should re-lint open documents when .haml-lint_todo.yml changes', async function () {
    this.timeout(180000);
    const document = await openView('offenses.haml');

    fs.writeFileSync(configPath, CONFIG, 'utf8');
    fs.writeFileSync(todoPath, TODO_INERT, 'utf8');
    await vscode.commands.executeCommand('haml.lintFile', document.uri);
    await waitFor(
      () => countDiagnosticsWithCode(document.uri, 'LineLength') === OFFENSES_UNDER_CONFIG,
      'the offense count only the written configuration produces',
      LINT_RUN_TIMEOUT_MS
    );
    // A sleep rather than a waitFor because what has to be true here is the absence of a pending
    // sweep, which no condition can observe. Derived from the production constant rather than
    // written out: a copy would stop outlasting the debounce the moment that number grew, and the
    // test would then pass on the .haml-lint.yml watcher's sweep with this one's pattern deleted.
    await wait(RULE_SWEEP_DELAY_MS * 6);

    // An edit to a file that already exists, so the only watcher that can answer is this one - the
    // .haml-lint.yml pattern matches neither the path nor, since nothing was created, a create.
    fs.writeFileSync(todoPath, TODO_DISABLING, 'utf8');

    await waitFor(
      () => countDiagnosticsWithCode(document.uri, 'LineLength') === 0,
      'the offenses to disappear once the todo file disabled the rule',
      LINT_RUN_TIMEOUT_MS
    );
  });
});
