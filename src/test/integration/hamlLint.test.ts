import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { formatDocument } from '../support/editor';
import { activateExtension, FIXTURE_VIEWS, fixturePath, hamlLintSupportsAutocorrect, openView, skipWithoutHamlLint } from '../support/host';
import { waitFor } from '../support/timing';

// These only run where the gem is installed. CI installs it across a version matrix; locally they
// skip rather than fail so `yarn test` stays useful without Ruby.
suite('haml-lint round trip Test Suite', () => {
  suiteSetup(async function () {
    skipWithoutHamlLint(this);
    await activateExtension();
  });

  test('should report diagnostics for a file with offenses', async () => {
    const document = await openView('offenses.haml');
    await vscode.commands.executeCommand('haml.lintFile', document.uri);

    // The lint runs asynchronously behind the command; poll rather than sleep a fixed amount.
    await waitFor(() => vscode.languages.getDiagnostics(document.uri).some((d) => d.source === 'haml-lint'), 'a haml-lint diagnostic', 15000);

    const diagnostics = vscode.languages.getDiagnostics(document.uri).filter((d) => d.source === 'haml-lint');
    // The fixture .haml-lint.yml sets LineLength.max to 40, so finding it proves cwd resolution
    // reached the config: haml-lint only searches upward from the process cwd.
    assert.ok(
      diagnostics.some((d) => (typeof d.code === 'object' && d.code !== null ? String(d.code.value) : String(d.code)) === 'LineLength'),
      'expected LineLength, which only fires when the fixture .haml-lint.yml was discovered'
    );
  });

  // The two halves of the version matrix. Below the 0.74.0 floor haml-lint corrects RuboCop cops
  // only, so `haml.formatter: "auto"` resolves to none and formatting is a deliberate no-op - which
  // is the entire reason the 0.73.0 leg exists. Asserting edits unconditionally would fail there.
  test('should produce edits for a file with correctable offenses', async function () {
    if (!hamlLintSupportsAutocorrect()) {
      this.skip();
    }
    const document = await openView('offenses.haml');
    const edits = await formatDocument(document);
    assert.ok(edits !== undefined && edits.length > 0, 'expected trailing whitespace to be corrected');
  });

  test('should produce no edits below the Haml autocorrect floor', async function () {
    if (hamlLintSupportsAutocorrect()) {
      this.skip();
    }
    const document = await openView('offenses.haml');
    const edits = await formatDocument(document);
    assert.ok(edits === undefined || edits.length === 0, 'formatting must be a no-op when only RuboCop cops would be corrected');
  });

  // The regression net for the whole class of bugs around the --stderr invariant: without it,
  // haml-lint's write_to_disk! calls File.write and rewrites the user's file behind the editor.
  test('should never write to the file on disk while formatting', async () => {
    const target = fixturePath(FIXTURE_VIEWS, 'offenses.haml');
    const before = fs.readFileSync(target);
    const document = await openView('offenses.haml');
    await formatDocument(document);
    await vscode.commands.executeCommand('haml.fixAll', document.uri);
    assert.deepStrictEqual(fs.readFileSync(target), before, 'haml-lint wrote to disk; --stderr must be missing from the autocorrect arguments');
  });

  test('should produce no edits for an already clean file', async () => {
    const document = await openView('clean.haml');
    const edits = await formatDocument(document);
    assert.ok(edits === undefined || edits.length === 0, 'a clean file yields empty stdout, which must mean no edit');
  });
});
