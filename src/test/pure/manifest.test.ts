import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CONFIG_KEYS,
  FORMATTER_VALUES,
  LINT_RUN_VALUES,
  MAX_DEBOUNCE_MS,
  MAX_TIMEOUT_MS,
  MIN_DEBOUNCE_MS,
  MIN_TIMEOUT_MS,
  normalizeConfig,
  RAILS_SNIPPETS_VALUES,
  USE_BUNDLER_VALUES
} from '../../configSchema';
import type { HamlConfig } from '../../types';

// The manifest is a second source of truth for things the source already decides, and every one of
// these disagreements is silent: nothing fails, the user just gets behaviour the settings UI does
// not describe. Read with fs rather than imported, because resolveJsonModule is unset and rootDir
// would put the JSON somewhere out/ does not expect.
const ROOT = path.join(__dirname, '..', '..', '..');

function readJson(...segments: string[]): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(ROOT, ...segments), 'utf8')) as Record<string, unknown>;
}

// biome-ignore lint/suspicious/noExplicitAny: the manifest is untyped JSON; every read is asserted.
const manifest = readJson('package.json') as any;
const defaults = normalizeConfig({});

function property(id: string): Record<string, unknown> {
  const found = manifest.contributes.configuration.properties[id];
  assert.ok(found !== undefined, `package.json declares no ${id}`);
  return found;
}

suite('package.json manifest Test Suite', () => {
  suite('settings', () => {
    // The pair whose disagreement is both silent and user-visible: VS Code clamps settings.json to
    // the JSON schema and configSchema clamps independently to its own constants, so a mismatch
    // means a value the settings UI accepts and the extension quietly rejects.
    test('should declare the same default as normalizeConfig produces', () => {
      for (const [field, key] of Object.entries(CONFIG_KEYS)) {
        assert.deepStrictEqual(property(`haml.${key}`).default, defaults[field as keyof HamlConfig], `haml.${key}`);
      }
    });

    test('should declare the same bounds as configSchema clamps to', () => {
      assert.strictEqual(property('haml.lint.debounceMs').minimum, MIN_DEBOUNCE_MS);
      assert.strictEqual(property('haml.lint.debounceMs').maximum, MAX_DEBOUNCE_MS);
      assert.strictEqual(property('haml.hamlLint.timeoutMs').minimum, MIN_TIMEOUT_MS);
      assert.strictEqual(property('haml.hamlLint.timeoutMs').maximum, MAX_TIMEOUT_MS);
    });

    test('should declare exactly the settings the extension reads', () => {
      const declared = Object.keys(manifest.contributes.configuration.properties).sort();
      const read = Object.values(CONFIG_KEYS)
        .map((key) => `haml.${key}`)
        .sort();
      assert.deepStrictEqual(declared, read);
    });

    test('should offer exactly the enum values configSchema accepts', () => {
      for (const [key, values] of [
        ['lint.run', LINT_RUN_VALUES],
        ['formatter', FORMATTER_VALUES],
        ['hamlLint.useBundler', USE_BUNDLER_VALUES],
        ['snippets.rails', RAILS_SNIPPETS_VALUES]
      ] as const) {
        assert.deepStrictEqual(property(`haml.${key}`).enum, [...values], `haml.${key}`);
      }
    });

    // Parallel arrays: adding a value and forgetting its description shifts every description by
    // one, so the UI silently mislabels every choice rather than showing a gap.
    test('should describe every enum value exactly once', () => {
      for (const id of Object.keys(manifest.contributes.configuration.properties)) {
        const declared = property(id);
        if (declared.enum === undefined) {
          continue;
        }
        assert.strictEqual((declared.enum as unknown[]).length, (declared.enumDescriptions as unknown[]).length, id);
      }
    });

    test('should restrict only settings that exist', () => {
      const declared = new Set(Object.keys(manifest.contributes.configuration.properties));
      for (const id of manifest.capabilities.untrustedWorkspaces.restrictedConfigurations) {
        assert.ok(declared.has(id), `${id} is restricted but not declared`);
      }
    });
  });

  suite('commands', () => {
    // At the 1.57 floor activationEvents is not generated, so a missing entry means the command
    // silently does nothing until the extension happens to already be active.
    test('should have an activation event for every command and vice versa', () => {
      const commands = manifest.contributes.commands.map((command: { command: string }) => command.command).sort();
      const activated = manifest.activationEvents
        .filter((event: string) => event.startsWith('onCommand:'))
        .map((event: string) => event.slice('onCommand:'.length))
        .sort();
      assert.deepStrictEqual(activated, commands);
    });

    test('should only put declared commands in the palette', () => {
      const commands = new Set(manifest.contributes.commands.map((command: { command: string }) => command.command));
      for (const entry of manifest.contributes.menus.commandPalette) {
        assert.ok(commands.has(entry.command), `${entry.command} is in the palette but not declared`);
      }
    });
  });

  suite('grammars', () => {
    // A scope renamed during a vendor update leaves a dead embeddedLanguages entry, and the embedded
    // language silently stops being highlighted. The grammar snapshots do not look at this mapping.
    test('should map only scopes the grammar actually produces', () => {
      const grammar = readJson('syntaxes', 'haml.tmLanguage.json');
      const scopes = new Set<string>();
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
          for (const child of node) {
            walk(child);
          }
          return;
        }
        if (typeof node !== 'object' || node === null) {
          return;
        }
        for (const [key, value] of Object.entries(node)) {
          if ((key === 'name' || key === 'contentName') && typeof value === 'string') {
            for (const scope of value.split(' ')) {
              scopes.add(scope);
            }
          }
          walk(value);
        }
      };
      walk(grammar);

      for (const scope of Object.keys(manifest.contributes.grammars[0].embeddedLanguages)) {
        assert.ok(scopes.has(scope), `${scope} is mapped to an embedded language but the grammar never produces it`);
      }
    });

    // A filter's `end` is only tried while the filter is on top of the rule stack. A construct the
    // embedded grammar leaves open - a `/*`, a template literal, the `{` of a CSS rule being typed -
    // sits above it, so the filter never ends and the rest of the file is coloured as that construct.
    // `while` is asked of every line whatever is open, and pops it all. syntaxes/fixtures/filter-leak.haml
    // is the snapshot; this pins the shape so a rule added later cannot quietly go back to `end`.
    test('should bound every rule with an indented body by while rather than end', () => {
      const grammar = readJson('syntaxes', 'haml.tmLanguage.json') as {
        patterns: { begin?: string; end?: string; while?: string; patterns?: unknown[] }[];
      };
      // A rule that bounds itself by its own header's indent is one that reads the lines below it.
      const bodies = grammar.patterns.filter((rule) => (rule.end ?? rule.while)?.includes('\\1') === true);
      assert.strictEqual(bodies.length, 23, 'the pattern no longer recognises the rules that take a body');
      for (const rule of bodies) {
        assert.strictEqual(rule.end, undefined, `the rule beginning ${rule.begin} ends on a pattern`);
        // The whole condition, not its opening: a `while` is the complement of the `end` it replaces,
        // and the comment's body is told from what follows it by `\n` where a filter's is by `$\n*`.
        // Pasting one rule's condition onto the other reads a blank line as the end of the body.
        const expected = rule.begin?.includes('\\-\\#') === true ? '^(?=\\1\\s+|\\n)' : '^(?=\\1\\s+|$\\n*)';
        assert.strictEqual(rule.while, expected, `the rule beginning ${rule.begin} is bounded by ${rule.while}`);
      }
    });

    // vscode-textmate silently drops an entire pattern when its include target is not registered,
    // so a grammar added without a stub makes the snapshots look unscoped rather than fail.
    test('should register every contributed grammar with the snapshot harness', () => {
      const harness = readJson('syntaxes', 'fixtures', 'grammar-test.config.json') as {
        contributes: { grammars: { scopeName: string }[] };
      };
      const registered = new Set(harness.contributes.grammars.map((grammar) => grammar.scopeName));
      for (const grammar of manifest.contributes.grammars) {
        assert.ok(registered.has(grammar.scopeName), `${grammar.scopeName} is contributed but has no entry in grammar-test.config.json`);
      }
    });

    // The other direction of the same trap. The harness may only stub scopes that stock VS Code
    // registers: a stub for anything else keeps a rule alive in the snapshots that every real editor
    // drops, which is how `:scss` (VS Code's scope is source.css.scss), `:plain` and `:sass` went
    // unhighlighted while their snapshots stayed green. A scope named here is a claim that was checked
    // against the built-in extensions; source.sass is absent because only a third-party extension has it.
    test('should stub only the scopes stock VS Code registers', () => {
      const stock = ['source.coffee', 'source.css', 'source.css.scss', 'source.js', 'source.ruby', 'text.html.markdown', 'text.html.php'];
      const harness = readJson('syntaxes', 'fixtures', 'grammar-test.config.json') as {
        contributes: { grammars: { scopeName: string }[] };
      };
      const contributed = new Set(manifest.contributes.grammars.map((grammar: { scopeName: string }) => grammar.scopeName));
      const stubbed = harness.contributes.grammars.map((grammar) => grammar.scopeName).filter((scope) => !contributed.has(scope));
      assert.deepStrictEqual(stubbed.sort(), stock);
    });
  });

  // Replaces the inline node -e in .github/workflows/lint.yml, which hardcoded the version string.
  test('should pin @types/vscode to the engines.vscode floor', () => {
    const engine = manifest.engines.vscode as string;
    const floor = engine
      .replace(/^[^0-9]*/, '')
      .split('.')
      .slice(0, 2)
      .join('.');
    const types = readJson('node_modules', '@types', 'vscode', 'package.json').version as string;
    assert.ok(types.startsWith(`${floor}.`), `@types/vscode is ${types}, expected ${floor}.x to match engines.vscode ${engine}`);
  });
});
