import { createRequire } from 'node:module';
import { join } from 'node:path';
import { defineConfig } from '@vscode/test-cli';

// Only the two options the host runner needs, so the plain-Node `spec` glob cannot leak into it.
const { ui, timeout } = createRequire(import.meta.url)('./.mocharc.json');

const testId = process.env.VSCODE_TEST_ID;
const profileBase = testId ? join(import.meta.dirname, 'tmp', 'haml-vscode-test', testId) : null;
const profileLaunchArgs = profileBase ? [`--user-data-dir=${join(profileBase, 'user')}`, `--extensions-dir=${join(profileBase, 'ext')}`] : [];

export default defineConfig({
  tests: [
    {
      // Integration only. The vscode-free suites run once under plain Node via `yarn test:unit`;
      // re-running them inside Electron produced no additional signal and made a failure ambiguous
      // about which runner it came from.
      files: 'out/test/integration/**/*.test.js',
      // The core of this extension resolves cwd, bundler usage, and .haml-lint.yml from the workspace folder.
      // Without this fixture, getWorkspaceFolder() is always undefined and none of that is exercised.
      workspaceFolder: './src/test/fixtures/rails-like',
      mocha: { ui, timeout },
      launchArgs: ['--disable-extensions', ...profileLaunchArgs]
    }
  ]
});
