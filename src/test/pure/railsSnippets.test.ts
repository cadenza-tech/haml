import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MODERN_RAILS_SNIPPETS, RAILS_SNIPPETS, shouldOfferRailsSnippets } from '../../pure/railsSnippets';
import { UPSTREAM_RAILS_SNIPPETS } from '../../pure/railsSnippetsUpstream';

const EXPECTED_UPSTREAM = 221;
const EXPECTED_MODERN = 18;

/**
 * Walks a snippet body the way VS Code does, so `\$` and `\}` are not mistaken for syntax.
 * Returns the message of the first problem, or null.
 */
function placeholderProblem(body: string): string | null {
  let depth = 0;
  for (let index = 0; index < body.length; index++) {
    const character = body[index];
    if (character === '\\') {
      index++;
      continue;
    }
    if (character === '$') {
      const next = body[index + 1];
      if (next === '{') {
        // VS Code's parser wants ${<number>} or ${<name>}, then one of } : | / - nothing else.
        // Without this, `${:record_object}` and `${7, layout: $8}` pass and insert literal text.
        if (!/^\$\{(?:\d+|[A-Za-z_][A-Za-z0-9_]*)[}:|/]/.test(body.slice(index))) {
          return `an unparseable \${ at index ${index}`;
        }
        depth++;
        index++;
      } else if (next === undefined || !/[0-9]/.test(next)) {
        return `a bare $ at index ${index}`;
      }
      continue;
    }
    if (character === '}' && depth > 0) {
      depth--;
    }
  }
  return depth === 0 ? null : `${depth} unclosed \${`;
}

/**
 * The contributed snippets, read from the repository root. Compiled tests live in
 * out/test/pure, which is three levels down. The file is JSONC by contract but currently holds no
 * comments, so JSON.parse works; add a stripper here if that ever changes.
 */
function contributedPrefixes(): string[] {
  const file = path.resolve(__dirname, '..', '..', '..', 'snippets', 'haml.code-snippets');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, { prefix: string | string[] }>;
  // prefix may be a string or an array of strings in the .code-snippets format.
  return Object.values(parsed).flatMap((entry) => [entry.prefix].flat());
}

suite('pure/railsSnippets Test Suite', () => {
  test('should carry every upstream helper that does not clash with a contributed one', () => {
    assert.strictEqual(UPSTREAM_RAILS_SNIPPETS.length, EXPECTED_UPSTREAM);
    assert.strictEqual(MODERN_RAILS_SNIPPETS.length, EXPECTED_MODERN);
    assert.strictEqual(RAILS_SNIPPETS.length, EXPECTED_UPSTREAM + EXPECTED_MODERN);
  });

  test('should keep every prefix unique', () => {
    const seen = new Set<string>();
    for (const snippet of RAILS_SNIPPETS) {
      assert.ok(!seen.has(snippet.prefix), `duplicate prefix ${snippet.prefix}`);
      seen.add(snippet.prefix);
    }
  });

  // Both sets are offered at once, so an overlap would show the same word twice with two bodies.
  test('should not collide with the contributed Haml snippets', () => {
    const contributed = new Set(contributedPrefixes());
    for (const snippet of RAILS_SNIPPETS) {
      assert.ok(!contributed.has(snippet.prefix), `${snippet.prefix} is already in haml.code-snippets`);
    }
  });

  test('should have a non-empty prefix, body and detail', () => {
    for (const snippet of RAILS_SNIPPETS) {
      assert.ok(snippet.prefix.length > 0, 'empty prefix');
      assert.ok(snippet.body.length > 0, `empty body for ${snippet.prefix}`);
      assert.ok(snippet.detail.length > 0, `empty detail for ${snippet.prefix}`);
    }
  });

  // A malformed body inserts rubbish with no error anywhere, so it is checked mechanically.
  test('should use well-formed placeholder syntax', () => {
    for (const snippet of RAILS_SNIPPETS) {
      const problem = placeholderProblem(snippet.body);
      assert.strictEqual(problem, null, `${snippet.prefix} has ${problem}: ${snippet.body}`);
    }
  });

  // The three repairs documented in railsSnippetsUpstream.ts and syntaxes/NOTICE.md; regenerating
  // from the pinned upstream commit reverts them, which is exactly what this must catch.
  test('should keep the documented upstream repairs applied', () => {
    const byPrefix = new Map(UPSTREAM_RAILS_SNIPPETS.map((snippet) => [snippet.prefix, snippet.body]));
    assert.ok(byPrefix.get('fields_for')?.includes('${2:record_object}'), 'fields_for lost its tab stop repair');
    assert.ok(byPrefix.get('render_partial_collection')?.includes('${7:, layout: $8}'), 'render_partial_collection lost its colon repair');
    assert.ok(byPrefix.get('video_tag')?.includes('autobuffer: $4'), 'video_tag lost its autobuffer repair');
  });

  // Haml is indentation-sensitive and rejects tabs outright.
  test('should never contain a tab', () => {
    for (const snippet of RAILS_SNIPPETS) {
      assert.ok(!snippet.body.includes('\t'), `${snippet.prefix} contains a tab`);
    }
  });

  // The provider only swallows the marker the user typed when the body brings its own. Eight
  // upstream helpers (image_alt, strip_tags, ...) are meant to sit inside an existing expression.
  test('should start each body with a script marker or a bare expression', () => {
    const markerless = RAILS_SNIPPETS.filter((snippet) => !snippet.body.startsWith('= ') && !snippet.body.startsWith('- '));
    assert.deepStrictEqual(markerless.map((snippet) => snippet.prefix).sort(), [
      'cdata_section',
      'compute_asset_extname',
      'compute_asset_host',
      'compute_asset_path',
      'current_page?',
      'image_alt',
      'strip_links',
      'strip_tags'
    ]);
  });

  suite('shouldOfferRailsSnippets', () => {
    function counting(result: boolean) {
      const probe = Object.assign(
        () => {
          probe.calls++;
          return result;
        },
        { calls: 0 }
      );
      return probe;
    }

    test('should always offer when on and never when off', () => {
      assert.strictEqual(shouldOfferRailsSnippets('on', counting(false)), true);
      assert.strictEqual(shouldOfferRailsSnippets('on', counting(true)), true);
      assert.strictEqual(shouldOfferRailsSnippets('off', counting(true)), false);
      assert.strictEqual(shouldOfferRailsSnippets('off', counting(false)), false);
    });

    test('should follow the detector when auto', () => {
      assert.strictEqual(shouldOfferRailsSnippets('auto', counting(true)), true);
      assert.strictEqual(shouldOfferRailsSnippets('auto', counting(false)), false);
    });

    // Resolving the detector walks up to 32 directories doing existsSync.
    test('should not consult the detector unless the mode is auto', () => {
      const onProbe = counting(true);
      shouldOfferRailsSnippets('on', onProbe);
      assert.strictEqual(onProbe.calls, 0);

      const offProbe = counting(true);
      shouldOfferRailsSnippets('off', offProbe);
      assert.strictEqual(offProbe.calls, 0);

      const autoProbe = counting(true);
      shouldOfferRailsSnippets('auto', autoProbe);
      assert.strictEqual(autoProbe.calls, 1);
    });
  });
});
