import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { CONFIG_SECTION } from '../../config';
import { CONFIG_KEYS, normalizeConfig } from '../../configSchema';
import type { HamlConfig } from '../../types';
import { formatDocument } from '../support/editor';
import { activateExtension, EXTENSION_ID, FIXTURE_VIEWS, fixtureUri, openView } from '../support/host';

suite('extension integration Test Suite', () => {
  suiteSetup(async () => {
    await activateExtension();
  });

  // Without this the whole point of the fixture is lost: cwd resolution, bundler detection and
  // .haml-lint.yml discovery all key off the workspace folder.
  test('should open with a workspace folder', () => {
    assert.strictEqual(vscode.workspace.workspaceFolders?.length, 1);
  });

  test('should register the extension', () => {
    assert.ok(vscode.extensions.getExtension(EXTENSION_ID), `${EXTENSION_ID} is not installed in the test host`);
  });

  test('should recognise .haml as the haml language', async () => {
    const document = await openView('clean.haml');
    assert.strictEqual(document.languageId, 'haml');
  });

  test('should register every contributed command', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const command of [
      'haml.lintFile',
      'haml.fixAll',
      'haml.restartLinter',
      'haml.showOutput',
      'haml.wrapInConditional',
      'haml.wrapInBlock',
      'haml.splitToPartial'
    ]) {
      assert.ok(commands.includes(command), `${command} is not registered`);
    }
  });

  // src/test/pure/manifest checks package.json's declared defaults against normalizeConfig. What it
  // cannot check is that VS Code *resolves* those ids - a wrong key in CONFIG_KEYS returns undefined
  // and normalizeConfig quietly substitutes the default, so only asking the real API catches it.
  test('should resolve every setting the extension reads to its normalized default', () => {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION, fixtureUri(FIXTURE_VIEWS, 'clean.haml'));
    const defaults = normalizeConfig({});
    for (const [field, key] of Object.entries(CONFIG_KEYS)) {
      assert.deepStrictEqual(config.get(key), defaults[field as keyof HamlConfig], `haml.${key}`);
    }
  });

  // Shipped through contributes.configurationDefaults so format-on-save needs no user setup.
  // It is only ever a no-op when haml.formatter resolves to none.
  test('should default [haml] to formatting on save with this extension', () => {
    const editor = vscode.workspace.getConfiguration('editor', { languageId: 'haml', uri: fixtureUri(FIXTURE_VIEWS, 'clean.haml') });
    assert.strictEqual(editor.get('defaultFormatter'), EXTENSION_ID);
    assert.strictEqual(editor.get('formatOnSave'), true);
    assert.strictEqual(editor.get('formatOnSaveMode'), 'file');
    assert.strictEqual(editor.get('tabSize'), 2);
  });

  test('should offer this extension as a formatter for haml', async () => {
    const document = await openView('clean.haml');
    // Never throws even when haml-lint is absent: the provider resolves to no edits.
    const edits = await formatDocument(document);
    assert.ok(edits === undefined || Array.isArray(edits));
  });

  test('should run the lint command without throwing when haml-lint is unavailable', async () => {
    const document = await openView('offenses.haml');
    await vscode.commands.executeCommand('haml.lintFile', document.uri);
  });

  test('should leave the buffer untouched when fixAll cannot run', async () => {
    const document = await openView('clean.haml');
    const before = document.getText();
    await vscode.commands.executeCommand('haml.fixAll', document.uri);
    assert.strictEqual(document.getText(), before);
  });

  // The commands are registered by the real extension, so registerCommands cannot be called again -
  // a duplicate id throws. Driving them the way a user does is the only entry point left.
  //
  // Be honest about the ceiling: commands.ts is outside the c8 scope so this shows in no number, and
  // showInformationMessage is not queryable at the 1.57 API floor, so "did not throw" is the whole
  // observable contract. Anything beyond these four would be theatre.
  suite('commands with no document to act on', () => {
    setup(async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    for (const command of ['haml.lintFile', 'haml.fixAll', 'haml.restartLinter', 'haml.showOutput']) {
      test(`should not throw for ${command} with no active editor`, async () => {
        await vscode.commands.executeCommand(command);
      });
    }
  });
});
