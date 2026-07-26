import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { eolOf, snapshotOf } from '../../documentSnapshot';
import { snapshotOfLines } from '../support/snapshot';

/**
 * The lines src/test/support/snapshot models, chosen for the cases where a fake could drift:
 * tab indentation, a whitespace-only line, an empty line, and a normal indented line.
 */
const LINES = ['%h1 Posts', '\t\t%p tabbed', '   ', '', '  .card', ''];

// Sixteen pure tests build a DocumentSnapshot by hand rather than through this adapter, because
// using the real one would drag vscode into the plain-Node suite - which is the whole reason
// src/pure is unit testable. This is the test that licenses that: it pins the fake against the real
// adapter so the two cannot drift apart unnoticed.
suite('documentSnapshot adapter Test Suite', () => {
  let document: vscode.TextDocument;

  suiteSetup(async () => {
    document = await vscode.workspace.openTextDocument({ language: 'haml', content: LINES.join('\n') });
  });

  test('should agree with the hand-built fake on every line', () => {
    const real = snapshotOf(document);
    const fake = snapshotOfLines(LINES);

    assert.strictEqual(real.lineCount, fake.lineCount);
    for (let index = 0; index < real.lineCount; index++) {
      const actual = real.lineAt(index);
      const expected = fake.lineAt(index);
      assert.strictEqual(actual.text, expected.text, `line ${index} text`);
      assert.strictEqual(
        actual.firstNonWhitespaceCharacterIndex,
        expected.firstNonWhitespaceCharacterIndex,
        `line ${index} indent of ${JSON.stringify(actual.text)}`
      );
    }
  });

  test('should count a whitespace-only line as indented to its full length', () => {
    // Both sides have to agree that '   ' has no content, which is what makes indentWidth infinite
    // for it in disableComment.
    assert.strictEqual(snapshotOf(document).lineAt(2).firstNonWhitespaceCharacterIndex, 3);
  });

  test('should read tabs as indentation', () => {
    assert.strictEqual(snapshotOf(document).lineAt(1).firstNonWhitespaceCharacterIndex, 2);
  });

  test('should report the document line endings', () => {
    // Not forced to CRLF: VS Code normalises on open per files.eol, so asking for one is unreliable.
    // The CRLF half of the contract is covered by restoreEol in src/test/pure/editBuilder.
    assert.strictEqual(eolOf(document), document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
  });
});
