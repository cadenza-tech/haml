import * as assert from 'node:assert';
import * as nodePath from 'node:path';
import { findUpwards, MAX_UPWARD_LEVELS, pathApi } from '../../pure/fsWalk';

suite('pure/fsWalk Test Suite', () => {
  suite('pathApi', () => {
    test('should give win32 semantics only on win32', () => {
      assert.strictEqual(pathApi('win32'), nodePath.win32);
      assert.strictEqual(pathApi('darwin'), nodePath.posix);
      assert.strictEqual(pathApi('linux'), nodePath.posix);
    });
  });

  suite('findUpwards', () => {
    test('should stop at the filesystem root when there is no boundary', () => {
      // A loose file outside any workspace can otherwise walk all the way to / and pick up a
      // stray .haml-lint.yml from $HOME or above.
      assert.strictEqual(
        findUpwards('/a/b/c', undefined, () => false, 'darwin'),
        null
      );
    });

    test('should find a match at the filesystem root', () => {
      assert.strictEqual(
        findUpwards('/a/b', undefined, (dir) => dir === '/', 'darwin'),
        '/'
      );
    });

    test('should give up after the level cap', () => {
      const deep = `/${Array.from({ length: MAX_UPWARD_LEVELS + 5 }, (_, i) => `d${i}`).join('/')}`;
      assert.strictEqual(
        findUpwards(deep, undefined, (dir) => dir === '/', 'darwin'),
        null
      );
    });

    test('should examine the boundary itself before stopping', () => {
      assert.strictEqual(
        findUpwards('/repo/app', '/repo', (dir) => dir === '/repo', 'darwin'),
        '/repo'
      );
    });
  });
});
