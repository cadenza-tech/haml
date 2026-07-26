import * as assert from 'node:assert';
import { classifyDocument, type DocumentFacts, MAX_DOCUMENT_BYTES } from '../../hamlLint/eligibility';

function facts(overrides: Partial<DocumentFacts> = {}): DocumentFacts {
  return { scheme: 'file', languageId: 'haml', isClosed: false, textLength: 10, hasWorkspaceFolder: true, ...overrides };
}

suite('hamlLint/eligibility Test Suite', () => {
  test('should accept a haml file inside a workspace folder', () => {
    assert.strictEqual(classifyDocument(facts()).ok, true);
  });

  test('should accept a haml file with no workspace folder', () => {
    assert.strictEqual(classifyDocument(facts({ hasWorkspaceFolder: false })).ok, true);
  });

  test('should accept an untitled document when a workspace folder exists', () => {
    assert.strictEqual(classifyDocument(facts({ scheme: 'untitled' })).ok, true);
  });

  test('should reject an untitled document with no workspace folder', () => {
    // There is no defensible cwd: $HOME can hold a stray .haml-lint.yml.
    assert.strictEqual(classifyDocument(facts({ scheme: 'untitled', hasWorkspaceFolder: false })).ok, false);
  });

  // Without this, opening a pull request diff with 30 changed .haml files spawns 30 Ruby processes
  // and paints diagnostics onto read-only history.
  test('should reject read-only and virtual schemes', () => {
    for (const scheme of ['git', 'gitlens', 'pr', 'review', 'vscode-vfs', 'memfs', 'output', 'vscode-userdata', 'debug']) {
      assert.strictEqual(classifyDocument(facts({ scheme })).ok, false, scheme);
    }
  });

  test('should reject a non-haml language', () => {
    assert.strictEqual(classifyDocument(facts({ languageId: 'ruby' })).ok, false);
  });

  test('should reject a closed document', () => {
    assert.strictEqual(classifyDocument(facts({ isClosed: true })).ok, false);
  });

  test('should reject an empty document', () => {
    assert.strictEqual(classifyDocument(facts({ textLength: 0 })).ok, false);
  });

  test('should reject a document over the size limit but accept one exactly at it', () => {
    assert.strictEqual(classifyDocument(facts({ textLength: MAX_DOCUMENT_BYTES })).ok, true);
    assert.strictEqual(classifyDocument(facts({ textLength: MAX_DOCUMENT_BYTES + 1 })).ok, false);
  });

  test('should honour a custom size limit', () => {
    assert.strictEqual(classifyDocument(facts({ textLength: 50 }), 10).ok, false);
  });

  test('should always explain a rejection', () => {
    const result = classifyDocument(facts({ scheme: 'git' }));
    assert.ok(!result.ok && result.reason.length > 0);
  });
});
