import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { completionsAt, labelsOf } from '../support/editor';
import { activateExtension, openView } from '../support/host';

suite('completions integration Test Suite', () => {
  suiteSetup(async () => {
    await activateExtension();
  });

  // The settings are left at their defaults on purpose. Writing haml.snippets.rails would either
  // create .vscode/settings.json inside the fixture (which .gitignore does not cover) or land in
  // the developer's real user settings, since .vscode-test.mjs only isolates the user data
  // directory when VSCODE_TEST_ID is set. The three modes are pinned by the unit tests for
  // shouldOfferRailsSnippets instead.
  // completion.haml is the single line `= link`, so the prefix puts the cursor at its end.
  test('should offer Rails helpers in a Rails workspace at a script position', async () => {
    const document = await openView('completion.haml');

    const labels = labelsOf(await completionsAt(document, '= link'));
    assert.ok(labels.includes('link_to'), `link_to is missing from ${labels.length} items`);
    assert.ok(labels.includes('link_to_block'), 'link_to_block is missing');
  });

  test('should replace the script marker so the body does not double it', async () => {
    const document = await openView('completion.haml');

    const item = (await completionsAt(document, '= link')).find((candidate) => candidate.label === 'link_to');
    assert.ok(item !== undefined, 'link_to is missing');
    assert.ok(item.range instanceof vscode.Range, 'the range must be set explicitly, not left to the default word');
    assert.strictEqual(item.range.start.character, 0, 'the range must start at the "=" so it is replaced, not repeated');
  });

  // clean.haml is `%p Clean`: plain text, where a line beginning with "= " could never be right.
  test('should offer nothing in plain text', async () => {
    const document = await openView('clean.haml');

    const labels = labelsOf(await completionsAt(document, '%p Clean'));
    assert.ok(!labels.includes('link_to'), 'Rails helpers must not appear in plain text');
  });
});
