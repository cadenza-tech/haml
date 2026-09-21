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

/**
 * The scopes the extensions built into VS Code register, of those this grammar includes. Each one is
 * a claim that was checked against their `contributes.grammars`; `source.sass` is absent because
 * only a third-party extension has it.
 */
const STOCK_SCOPES = ['source.coffee', 'source.css', 'source.css.scss', 'source.js', 'source.ruby', 'text.html.markdown', 'text.html.php'] as const;

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

    // An interpolation belongs to the line it is written on. Without the `$` a `#{` still being typed
    // opened a Ruby region that ran to whatever line finally held a `}`. The brace is the leftmost
    // match, so a complete interpolation pays nothing; the nested-brace rules need the bound as much,
    // since while a `{` inside is open the outer `end` is never tried.
    //
    // Both files: the injection is excluded from `comment`, so inside a `-#` body it is the grammar's
    // own `interpolated_ruby` that opens the region, and only these two rules bound it there.
    test('should end every interpolation at its brace or its line', () => {
      const injection = readJson('syntaxes', 'haml-interpolation.injection.json') as {
        patterns: { begin?: string; end?: string }[];
        repository: Record<string, { begin?: string; end?: string }>;
      };
      const grammar = readJson('syntaxes', 'haml.tmLanguage.json') as {
        repository: Record<string, { patterns: { begin?: string; end?: string }[] } | undefined>;
      };
      const own = ['interpolated_ruby', 'nest_curly_and_self'].flatMap((key) => {
        const rule = grammar.repository[key];
        assert.ok(rule !== undefined, `the grammar no longer has a ${key} repository entry`);
        return rule.patterns;
      });
      const regions = [...injection.patterns, ...Object.values(injection.repository), ...own].filter((rule) => rule.begin !== undefined);
      assert.strictEqual(regions.length, 4, 'the two files no longer open a region for the interpolation and one for its braces');
      for (const rule of regions) {
        // The grammar's own rule captures the brace, so its end carries a group the injection's does not.
        assert.ok(/^\(?\\\}\)?\|\$$/.test(rule.end ?? ''), `the rule beginning ${rule.begin} ends at ${rule.end}, which runs past its line`);
      }
    });

    /**
     * A child pattern that reaches the end of the line makes `rubyline`'s `end` unreachable: the end
     * has to see a non-space behind it, and once the scan is past the spaces it never can. Pinned as
     * strings because one backslash too few in either writes something that still parses and still
     * matches most lines - `[^,\` plus the letter `s` stops ending a Ruby line that ends in an `s` -
     * and no fixture would catch it.
     */
    test('should leave the whitespace a Ruby line ends on to the end that reads it', () => {
      const grammar = readJson('syntaxes', 'haml.tmLanguage.json') as {
        repository: Record<string, { end?: string; patterns?: { match?: string }[] } | undefined>;
      };
      assert.strictEqual(
        grammar.repository.rubyline?.end,
        '(((?<!\\w)do|\\{)(\\s*\\|[^|]*\\|)?)[ \\t]*(#.*)?$|(?<=[^,\\s])[ \\t]*$|^',
        'the end no longer asks about the last character with only spaces and tabs behind it'
      );
      const comments = JSON.stringify(grammar.repository).match(/"match":"#[^"]*"/g) ?? [];
      assert.ok(comments.length > 0, 'the Ruby comment pattern is gone from the repository');
      for (const pattern of comments) {
        assert.strictEqual(pattern, '"match":"#.*?(?=[ \\\\t]*$)"', 'a Ruby comment pattern consumes the spaces the end needs to see');
      }
    });

    // The fixture's whole point is the space after a comment, which an editor that trims trailing
    // whitespace removes without a word - leaving a snapshot that agrees with itself and tests
    // nothing. .editorconfig asks editors not to; this notices when one did.
    test('should keep the trailing whitespace the multi-line Ruby fixture is made of', () => {
      const fixture = fs.readFileSync(path.join(ROOT, 'syntaxes', 'fixtures', 'multiline-ruby.haml'), 'utf8').split('\n');
      for (const marker of [',', '# note', '# every one']) {
        const padded = fixture.some((line) => line.endsWith(`${marker} `) || line.endsWith(`${marker}\t`));
        assert.ok(padded, `no line ends in \`${marker}\` and whitespace any more, so the case it stands for is untested`);
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
      const harness = readJson('syntaxes', 'fixtures', 'grammar-test.config.json') as {
        contributes: { grammars: { scopeName: string }[] };
      };
      const contributed = new Set(manifest.contributes.grammars.map((grammar: { scopeName: string }) => grammar.scopeName));
      const stubbed = harness.contributes.grammars.map((grammar) => grammar.scopeName).filter((scope) => !contributed.has(scope));
      assert.deepStrictEqual(stubbed.sort(), [...STOCK_SCOPES]);
    });

    /**
     * Every filter the README promises still opens a region in an editor with no third-party grammar
     * installed. The snapshots cannot see this: the harness registers a stub for every scope, so a
     * rule it keeps alive there is dropped in a real VS Code, header read as a tag name and body as
     * Haml. `:sass` survives only because the copy of its rule that wins also includes
     * `#interpolated_ruby`; nothing about the vendored order makes that so, and reordering the
     * duplicates would take the region away without a snapshot noticing.
     */
    test('should open a region for every filter without a third-party grammar', () => {
      const grammar = readJson('syntaxes', 'haml.tmLanguage.json') as {
        patterns: { begin?: string; patterns?: { include?: string }[] }[];
      };
      const stock = new Set<string>(STOCK_SCOPES);
      // vscode-textmate drops a rule whose every pattern includes a grammar that is not registered.
      const survives = (rule: { patterns?: { include?: string }[] }): boolean =>
        rule.patterns?.some((pattern) => pattern.include === undefined || pattern.include.startsWith('#') || stock.has(pattern.include)) === true;

      for (const filter of [
        'ruby',
        'javascript',
        'css',
        'sass',
        'scss',
        'coffee',
        'markdown',
        'plain',
        'escaped',
        'preserve',
        'cdata',
        'erb',
        'php'
      ]) {
        const header = `:${filter}`;
        const winner = grammar.patterns.find((rule) => rule.begin !== undefined && new RegExp(rule.begin).test(header) && survives(rule));
        assert.ok(winner !== undefined, `nothing that survives in a stock VS Code opens a region for ${header}`);
      }
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
