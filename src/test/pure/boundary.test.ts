import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

// src/hamlLint and src/pure must stay free of the vscode module so they can be unit tested with
// plain Node and measured by c8. Importing vscode there would also be a runtime crash outside the
// extension host. Layering decays quietly, so it is asserted rather than documented.

const OUT_ROOT = path.resolve(__dirname, '..', '..');
const VSCODE_FREE_DIRECTORIES = ['hamlLint', 'pure'];
/** Must always exist; the others are checked once they do. */
const REQUIRED_DIRECTORY = 'hamlLint';

function collectJsFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectJsFiles(full);
    }
    return entry.isFile() && full.endsWith('.js') ? [full] : [];
  });
}

suite('layering boundary Test Suite', () => {
  test('should compile the vscode-free directories', () => {
    assert.ok(
      collectJsFiles(path.join(OUT_ROOT, REQUIRED_DIRECTORY)).length > 0,
      `no compiled output found in out/${REQUIRED_DIRECTORY}; run compile-tests first`
    );
    for (const directory of VSCODE_FREE_DIRECTORIES) {
      const full = path.join(OUT_ROOT, directory);
      if (fs.existsSync(full)) {
        assert.ok(collectJsFiles(full).length > 0, `out/${directory} exists but is empty`);
      }
    }
  });

  test('should not require vscode from src/hamlLint or src/pure', () => {
    const offenders: string[] = [];
    for (const directory of VSCODE_FREE_DIRECTORIES) {
      for (const file of collectJsFiles(path.join(OUT_ROOT, directory))) {
        const contents = fs.readFileSync(file, 'utf8');
        if (/require\(["']vscode["']\)/.test(contents)) {
          offenders.push(path.relative(OUT_ROOT, file));
        }
      }
    }
    assert.deepStrictEqual(offenders, [], `these modules import vscode and must not: ${offenders.join(', ')}`);
  });
});
