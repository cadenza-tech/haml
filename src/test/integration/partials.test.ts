import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { completionsAt, definitionsAt, labelsOf } from '../support/editor';
import { activateExtension, FIXTURE_VIEWS, fixtureUri, openView } from '../support/host';

const INDEX = 'posts/index.html.haml';

suite('partial navigation integration Test Suite', () => {
  suiteSetup(async () => {
    await activateExtension();
  });

  test('should resolve a views-root-relative partial', async () => {
    const document = await openView(INDEX);
    const links = await definitionsAt(document, "= render 'shared/fo");
    assert.strictEqual(links.length, 1);
    assert.strictEqual(links[0]?.targetUri.fsPath, fixtureUri(FIXTURE_VIEWS, 'shared', '_foo.html.haml').fsPath);
  });

  test('should resolve a bare name beside the document', async () => {
    const document = await openView(INDEX);
    const links = await definitionsAt(document, "= render 'sideba");
    assert.strictEqual(links.length, 1);
    assert.strictEqual(links[0]?.targetUri.fsPath, fixtureUri(FIXTURE_VIEWS, 'posts', '_sidebar.html.haml').fsPath);
  });

  test('should resolve the partial keyword and a parenthesised call', async () => {
    const document = await openView(INDEX);
    const expected = fixtureUri(FIXTURE_VIEWS, 'shared', '_foo.html.haml').fsPath;
    assert.strictEqual((await definitionsAt(document, "= render partial: 'shared/fo"))[0]?.targetUri.fsPath, expected);
    assert.strictEqual((await definitionsAt(document, "= render('shared/fo"))[0]?.targetUri.fsPath, expected);
  });

  // The underline has to cover the whole name. VS Code would derive it from its own word range
  // otherwise, and '/' is not a word character, so only `foo` would be linked.
  test('should mark the whole literal as the origin', async () => {
    const document = await openView(INDEX);
    const origin = (await definitionsAt(document, "= render 'shared/fo"))[0]?.originSelectionRange;
    assert.ok(origin !== undefined, 'the link has no origin range');
    assert.strictEqual(document.getText(origin), 'shared/foo');
  });

  // The test host runs with --disable-extensions, so this extension is the only definition provider
  // for haml and an empty result really means this provider declined.
  test('should not resolve a partial that does not exist', async () => {
    const document = await openView(INDEX);
    assert.deepStrictEqual(await definitionsAt(document, "= render 'nope/nop"), []);
  });

  test('should not resolve the word render inside prose', async () => {
    const document = await openView(INDEX);
    assert.deepStrictEqual(await definitionsAt(document, "%p Please render 'shared/fo"), []);
  });

  test('should not resolve outside a render call', async () => {
    const document = await openView(INDEX);
    assert.deepStrictEqual(await definitionsAt(document, '%h1 Post'), []);
  });

  test('should complete every partial under the views root', async () => {
    const document = await openView(INDEX);
    const labels = labelsOf(await completionsAt(document, "= render 'shared/fo"));
    assert.ok(labels.includes('shared/foo'), labels.join(' '));
    // Beside the document, and still under the name that resolves from every controller.
    assert.ok(labels.includes('posts/sidebar'), labels.join(' '));
    assert.ok(!labels.includes('sidebar'), labels.join(' '));
  });

  test('should complete through a trigger character', async () => {
    const document = await openView(INDEX);
    const labels = labelsOf(await completionsAt(document, "= render '", "'"));
    assert.ok(labels.includes('shared/foo'), labels.join(' '));
  });

  // The range has to cover the whole literal. Replacing only [start, cursor) would turn re-editing
  // `'shared/foo'` into `'shared/foored/foo'`.
  test('should replace the whole literal when a completion is accepted', async () => {
    const document = await openView(INDEX);
    const item = (await completionsAt(document, "= render 'shared/fo")).find((entry) => entry.label === 'shared/foo');
    const range = item?.range;
    assert.ok(range instanceof vscode.Range, 'the item carries no plain range');
    assert.strictEqual(document.getText(range), 'shared/foo');
  });

  // Both completion providers are registered for haml, and only one may answer here: the Rails
  // snippets stay out because computeCompletionWord rejects a position inside a string literal.
  test('should not offer Rails snippets inside a render literal', async () => {
    const document = await openView(INDEX);
    const labels = labelsOf(await completionsAt(document, "= render 'shared/fo"));
    assert.ok(!labels.includes('link_to'), labels.join(' '));
  });

  test('should not complete partials in prose', async () => {
    const document = await openView(INDEX);
    const labels = labelsOf(await completionsAt(document, "%p Please render 'shared/fo"));
    assert.ok(!labels.includes('shared/foo'), labels.join(' '));
  });
});
