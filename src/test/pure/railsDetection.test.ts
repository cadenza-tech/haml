import * as assert from 'node:assert';
import type { FsDeps } from '../../pure/fsWalk';
import { detectRails } from '../../pure/railsDetection';

const RAILS_LOCK = 'GEM\n  specs:\n    rails (8.0.0)\n    rake (13.0.0)\n';
const PLAIN_LOCK = 'GEM\n  specs:\n    haml (6.3.0)\n    sinatra (4.0.0)\n';

function deps(files: Record<string, string | true>): FsDeps {
  return {
    fileExists: (target) => target in files,
    readFile: (target) => {
      const value = files[target];
      return typeof value === 'string' ? value : null;
    },
    platform: 'linux'
  };
}

const VIEW = '/repo/app/views/posts/index.haml';

suite('pure/railsDetection Test Suite', () => {
  test('should detect a Rails app from config/application.rb', () => {
    assert.strictEqual(detectRails({ documentPath: VIEW, workspaceFolderPath: '/repo' }, deps({ '/repo/config/application.rb': true })), true);
  });

  test('should detect a Rails app from a Gemfile.lock listing rails', () => {
    assert.strictEqual(detectRails({ documentPath: VIEW, workspaceFolderPath: '/repo' }, deps({ '/repo/Gemfile.lock': RAILS_LOCK })), true);
  });

  // Plenty of Haml projects have a Gemfile without Rails in it.
  test('should not detect a Rails app from a Gemfile.lock without rails', () => {
    assert.strictEqual(detectRails({ documentPath: VIEW, workspaceFolderPath: '/repo' }, deps({ '/repo/Gemfile.lock': PLAIN_LOCK })), false);
  });

  test('should not detect a Rails app when neither signal is present', () => {
    assert.strictEqual(detectRails({ documentPath: VIEW, workspaceFolderPath: '/repo' }, deps({ '/repo/Gemfile': true })), false);
  });

  test('should find the signal beside the document as well as at the root', () => {
    const nested = deps({ '/repo/packages/web/config/application.rb': true });
    const input = { documentPath: '/repo/packages/web/app/views/x.haml', workspaceFolderPath: '/repo' };
    assert.strictEqual(detectRails(input, nested), true);
  });

  // The workspace folder is the boundary, exactly as it is for .haml-lint.yml and Gemfile.lock.
  test('should stop at the workspace folder', () => {
    const outside = deps({ '/repo/config/application.rb': true });
    const input = { documentPath: '/repo/packages/web/app/views/x.haml', workspaceFolderPath: '/repo/packages/web' };
    assert.strictEqual(detectRails(input, outside), false);
  });

  // Opening a single file with no folder gives no boundary, so only its own directory is examined.
  test('should examine only the document directory without a workspace folder', () => {
    assert.strictEqual(detectRails({ documentPath: VIEW }, deps({ '/repo/config/application.rb': true })), false);
    assert.strictEqual(detectRails({ documentPath: VIEW }, deps({ '/repo/app/views/posts/config/application.rb': true })), true);
  });

  test('should treat an unreadable lock file as no signal', () => {
    assert.strictEqual(detectRails({ documentPath: VIEW, workspaceFolderPath: '/repo' }, deps({ '/repo/Gemfile.lock': true })), false);
  });

  test('should match rails only in the specs section, not as a substring', () => {
    const decoy = 'GEM\n  specs:\n    rails-html-sanitizer (1.6.0)\n    railties (8.0.0)\n';
    assert.strictEqual(detectRails({ documentPath: VIEW, workspaceFolderPath: '/repo' }, deps({ '/repo/Gemfile.lock': decoy })), false);
  });
});
