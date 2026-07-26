import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { completionsAt, labelsOf } from '../support/editor';
import { activateExtension, fixtureUri } from '../support/host';

const FIXTURE = 'app/views/attributes.haml';

async function labelsAfter(document: vscode.TextDocument, prefix: string): Promise<string[]> {
  return labelsOf(await completionsAt(document, prefix));
}

suite('data attribute completion integration Test Suite', () => {
  let document: vscode.TextDocument;

  suiteSetup(async () => {
    await activateExtension();
    document = await vscode.workspace.openTextDocument(fixtureUri(FIXTURE));
    await vscode.window.showTextDocument(document);
  });

  test('should complete underscored keys inside a nested data hash', async () => {
    const labels = await labelsAfter(document, '%div{ data: { c');
    assert.ok(labels.includes('controller'), labels.join(' '));
    assert.ok(!labels.includes('data-controller'), labels.join(' '));
  });

  test('should complete quoted dashed keys in the attribute hash', async () => {
    const labels = await labelsAfter(document, "%a{ 'data-tur");
    assert.ok(labels.includes('data-turbo-frame'), labels.join(' '));
  });

  test('should complete HTML-style attribute names', async () => {
    const labels = await labelsAfter(document, '%span(data-turbo-a');
    assert.ok(labels.includes('data-turbo-action'), labels.join(' '));
  });

  // Offering an attribute name where a value belongs would be worse than offering nothing. The list is
  // never empty - the built-in snippet provider answers everywhere - so this asserts by label.
  test('should not complete attribute names in a value position', async () => {
    const labels = await labelsAfter(document, "%div{ data: { controller: 'dr");
    assert.ok(!labels.some((label) => label.startsWith('data-') || label === 'controller' || label === 'turbo_frame'), labels.join(' '));
  });

  test('should not complete attribute names outside an attribute list', async () => {
    const labels = await labelsAfter(document, '%p{ class: ');
    assert.ok(!labels.some((label) => label.startsWith('data-')), labels.join(' '));
  });

  // Both completion providers are registered for haml; only one may answer in an attribute list.
  test('should not offer Rails snippets in an attribute list', async () => {
    const labels = await labelsAfter(document, "%a{ 'data-tur");
    assert.ok(!labels.includes('link_to'), labels.join(' '));
  });
});
