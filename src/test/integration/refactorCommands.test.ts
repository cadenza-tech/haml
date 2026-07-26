import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Logger } from '../../logger';
import { nodeResolveDeps } from '../../nodeDeps';
import { type RefactorCommandDeps, splitToPartial, wrapInBlock, wrapInConditional } from '../../refactorCommands';
import { activateExtension, FIXTURE_VIEWS, fixtureUri, showView } from '../support/host';

const TOUCHED_FIXTURES = ['clean.haml', 'tabbed.haml'];
const CARD = '%h1 Posts\n  .card\n    %p Body\n';

suite('selection refactoring integration Test Suite', () => {
  const logger = new Logger();
  /**
   * Extraction writes files, so it runs against a throwaway tree rather than the checked-in fixtures.
   * VSCODE_TEST_ID cannot be used for this: CI does not set it.
   */
  let scratch = '';

  suiteSetup(async () => {
    await activateExtension();
  });

  suiteTeardown(() => {
    logger.dispose();
    // Only the fixtures this suite opens: hamlLint.test.ts deliberately leaves offenses.haml dirty.
    for (const name of TOUCHED_FIXTURES) {
      const onDisk = fs.readFileSync(fixtureUri(FIXTURE_VIEWS, name).fsPath, 'utf8');
      assert.ok(!onDisk.includes('- if'), `${name} was written to disk`);
    }
  });

  setup(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'haml-split-'));
  });

  // Extraction opens a second editor, so more than one may need reverting. Reverting rather than
  // closing is what keeps the checked-in fixtures clean.
  teardown(async () => {
    for (let attempt = 0; attempt < 4 && vscode.window.activeTextEditor !== undefined; attempt++) {
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  function scratchViews(name: string): string {
    return path.join(scratch, name, 'app', 'views', 'posts');
  }

  async function openScratch(name: string, contents = CARD): Promise<vscode.TextEditor> {
    const directory = scratchViews(name);
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'show.html.haml');
    fs.writeFileSync(file, contents, 'utf8');
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    return vscode.window.showTextDocument(document);
  }

  function deps(partialName: string | undefined, overrides: Partial<RefactorCommandDeps> = {}): RefactorCommandDeps {
    return { logger, fs: nodeResolveDeps(), prompt: () => Promise.resolve(partialName), ...overrides };
  }

  // The one thing no unit test can show: the placeholder ends up selected, so the user types over it.
  test('should wrap the selection and leave the placeholder selected', async () => {
    const editor = await showView('clean.haml');
    editor.selection = new vscode.Selection(0, 0, 0, editor.document.lineAt(0).text.length);
    await wrapInConditional(editor);
    assert.strictEqual(editor.document.getText(), '- if condition\n  %p Clean\n');
    assert.strictEqual(editor.document.getText(editor.selection), 'condition');
  });

  // buildBlockWrap is covered by src/test/pure/wrapBlock; the only thing the glue can get wrong is
  // passing the other builder, which the header text is enough to catch.
  test('should wrap with the block builder, not the conditional one', async () => {
    const editor = await showView('clean.haml');
    editor.selection = new vscode.Selection(0, 0, 0, editor.document.lineAt(0).text.length);
    await wrapInBlock(editor);
    assert.strictEqual(editor.document.getText(), '- collection.each do |item|\n  %p Clean\n');
    assert.strictEqual(editor.document.getText(editor.selection), 'collection');
  });

  test('should wrap the whole block under a bare cursor', async () => {
    const editor = await showView('tabbed.haml');
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    await wrapInConditional(editor);
    const lines = editor.document.getText().split('\n');
    assert.strictEqual(lines[0], '- if condition');
    assert.ok(lines[2]?.includes('%p Body'), editor.document.getText());
  });

  // insertSnippet re-indents every inserted line through normalizeIndentation, which reads
  // editor.options - the same values unitOf derives the unit from. Deriving it anywhere else would
  // have VS Code rewrite the body; this is the test that would catch that.
  test('should keep tabs when the editor is set to tabs', async () => {
    const editor = await showView('tabbed.haml');
    editor.options = { insertSpaces: false, tabSize: 2 };
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    await wrapInConditional(editor);
    assert.ok(!editor.document.getText().includes('  '), editor.document.getText());
  });

  test('should leave the document alone when there is nothing to wrap', async () => {
    const editor = await showView('clean.haml');
    const before = editor.document.getText();
    editor.selection = new vscode.Selection(1, 0, 1, 0);
    await wrapInConditional(editor);
    assert.strictEqual(editor.document.getText(), before);
  });

  // createFile has no contents option at 1.57, so creation and the render replacement have to be one
  // WorkspaceEdit to stay a single undo step. This is the test that proves the pair actually applies.
  test('should extract the selection into a new partial and leave a render call', async () => {
    const editor = await openScratch('ok');
    editor.selection = new vscode.Selection(1, 0, 1, 0);
    await splitToPartial(editor, deps('card'));

    const partial = path.join(scratchViews('ok'), '_card.html.haml');
    const opened = vscode.workspace.textDocuments.find((document) => document.uri.fsPath === partial);
    assert.ok(opened !== undefined, 'the new partial was not opened');
    assert.strictEqual(opened.getText(), '.card\n  %p Body\n');
    assert.strictEqual(editor.document.getText(), "%h1 Posts\n  = render 'posts/card'\n");
  });

  // The real collision guard is createFile refusing to overwrite; the fileExists pre-check would
  // return before ever reaching it. Stubbing the pre-check out is the only way to exercise the guard,
  // and it also shows that the pre-check is a message rather than the safety mechanism.
  test('should not touch an existing partial when the pre-check is bypassed', async () => {
    const editor = await openScratch('clash');
    const partial = path.join(scratchViews('clash'), '_card.html.haml');
    fs.writeFileSync(partial, '%p Existing\n', 'utf8');
    editor.selection = new vscode.Selection(1, 0, 1, 0);
    const before = editor.document.getText();

    const stubbed = deps('card');
    await splitToPartial(editor, { ...stubbed, fs: { ...stubbed.fs, fileExists: () => false } });

    assert.strictEqual(fs.readFileSync(partial, 'utf8'), '%p Existing\n');
    assert.strictEqual(editor.document.getText(), before, 'the render replacement ran despite the failed creation');
  });

  test('should report a collision without changing anything', async () => {
    const editor = await openScratch('exists');
    const partial = path.join(scratchViews('exists'), '_card.html.haml');
    fs.writeFileSync(partial, '%p Existing\n', 'utf8');
    editor.selection = new vscode.Selection(1, 0, 1, 0);
    const before = editor.document.getText();

    await splitToPartial(editor, deps('card'));

    assert.strictEqual(fs.readFileSync(partial, 'utf8'), '%p Existing\n');
    assert.strictEqual(editor.document.getText(), before);
  });

  test('should do nothing when the name prompt is cancelled', async () => {
    const editor = await openScratch('cancel');
    editor.selection = new vscode.Selection(1, 0, 1, 0);
    const before = editor.document.getText();
    await splitToPartial(editor, deps(undefined));
    assert.strictEqual(editor.document.getText(), before);
    assert.ok(!fs.existsSync(path.join(scratchViews('cancel'), '_card.html.haml')));
  });

  // The prompt is injected, so the validator has to hold here too - the name becomes a real path.
  test('should refuse a name that escapes the directory', async () => {
    const editor = await openScratch('evil');
    editor.selection = new vscode.Selection(1, 0, 1, 0);
    const before = editor.document.getText();
    await splitToPartial(editor, deps('../../../evil'));
    assert.strictEqual(editor.document.getText(), before);
    // Where `../../../` from app/views/posts would have landed, plus the scratch root for good measure.
    assert.ok(!fs.existsSync(path.join(scratch, 'evil', '_evil.html.haml')), 'a file was written outside the target directory');
    assert.ok(!fs.existsSync(path.join(scratch, '_evil.html.haml')), 'a file was written above the target directory');
  });

  test('should refuse an empty name', async () => {
    const editor = await openScratch('blank');
    editor.selection = new vscode.Selection(1, 0, 1, 0);
    const before = editor.document.getText();
    await splitToPartial(editor, deps(''));
    assert.strictEqual(editor.document.getText(), before);
  });

  // Extraction needs a real directory to write into, which an untitled document does not have.
  test('should refuse a document that is not on disk', async () => {
    const document = await vscode.workspace.openTextDocument({ language: 'haml', content: CARD });
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(1, 0, 1, 0);
    await splitToPartial(editor, deps('card'));
    assert.strictEqual(editor.document.getText(), CARD);
  });
});
