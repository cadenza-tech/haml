import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CONTROL_SNIPPETS } from '../../pure/controlSnippets';
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
 * What a body becomes once it is accepted with every placeholder left at its default: tab stops
 * vanish, a default stays, the first choice is taken, and an escape yields the character it guards.
 */
function expandDefaults(body: string): string {
  let index = 0;
  const run = (nested: boolean): string => {
    let out = '';
    while (index < body.length) {
      const character = body[index] as string;
      if (character === '\\' && index + 1 < body.length) {
        out += body[index + 1];
        index += 2;
        continue;
      }
      if (nested && character === '}') {
        index++;
        return out;
      }
      const braced = character === '$' && body[index + 1] === '{';
      let cursor = index + (braced ? 2 : 1);
      while (character === '$' && /[0-9]/.test(body[cursor] ?? '')) {
        cursor++;
      }
      if (character !== '$' || cursor === index + (braced ? 2 : 1)) {
        out += character;
        index++;
        continue;
      }
      index = cursor;
      if (braced && body[index] === ':') {
        index++;
        out += run(true);
      } else if (braced && body[index] === '|') {
        const end = body.indexOf('|}', index);
        // Without this an unclosed choice rewinds the index and the loop never ends.
        assert.ok(end !== -1, `${JSON.stringify(body)} opens a choice it never closes`);
        out += body.slice(index + 1, end).split(',')[0] as string;
        index = end + 2;
      } else if (braced) {
        index++;
      }
    }
    return out;
  };
  return run(false);
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

/** Everything the completion provider supplies. The checks on a body's shape hold for all of it. */
const PROVIDED_SNIPPETS = [...RAILS_SNIPPETS, ...CONTROL_SNIPPETS];

suite('pure/railsSnippets Test Suite', () => {
  test('should carry every upstream helper that does not clash with a Haml control snippet', () => {
    assert.strictEqual(UPSTREAM_RAILS_SNIPPETS.length, EXPECTED_UPSTREAM);
    assert.strictEqual(MODERN_RAILS_SNIPPETS.length, EXPECTED_MODERN);
    assert.strictEqual(RAILS_SNIPPETS.length, EXPECTED_UPSTREAM + EXPECTED_MODERN);
  });

  test('should keep every prefix unique', () => {
    const seen = new Set<string>();
    for (const snippet of PROVIDED_SNIPPETS) {
      assert.ok(!seen.has(snippet.prefix), `duplicate prefix ${snippet.prefix}`);
      seen.add(snippet.prefix);
    }
  });

  // Both sets are offered at once, so an overlap would show the same word twice with two bodies.
  test('should not collide with the contributed Haml snippets', () => {
    const contributed = new Set(contributedPrefixes());
    for (const snippet of PROVIDED_SNIPPETS) {
      assert.ok(!contributed.has(snippet.prefix), `${snippet.prefix} is already in haml.code-snippets`);
    }
  });

  test('should have a non-empty prefix, body and detail', () => {
    for (const snippet of PROVIDED_SNIPPETS) {
      assert.ok(snippet.prefix.length > 0, 'empty prefix');
      assert.ok(snippet.body.length > 0, `empty body for ${snippet.prefix}`);
      assert.ok(snippet.detail.length > 0, `empty detail for ${snippet.prefix}`);
    }
  });

  // A malformed body inserts rubbish with no error anywhere, so it is checked mechanically.
  test('should use well-formed placeholder syntax', () => {
    for (const snippet of PROVIDED_SNIPPETS) {
      const problem = placeholderProblem(snippet.body);
      assert.strictEqual(problem, null, `${snippet.prefix} has ${problem}: ${snippet.body}`);
    }
  });

  // Three of the repairs documented in railsSnippetsUpstream.ts and syntaxes/NOTICE.md; regenerating
  // from the pinned upstream commit reverts them, which is exactly what this must catch. The comma
  // repairs are caught by shape, in 'the Ruby a body inserts' below.
  test('should keep the documented upstream repairs applied', () => {
    const byPrefix = new Map(UPSTREAM_RAILS_SNIPPETS.map((snippet) => [snippet.prefix, snippet.body]));
    assert.ok(byPrefix.get('fields_for')?.includes('${2:record_object}'), 'fields_for lost its tab stop repair');
    assert.ok(byPrefix.get('render_partial_collection')?.includes('${7:, layout: $8}'), 'render_partial_collection lost its colon repair');
    assert.ok(byPrefix.get('video_tag')?.includes('autobuffer: $4'), 'video_tag lost its autobuffer repair');
  });

  // Nothing parses the Ruby a body inserts, so the ways a body has actually gone wrong are looked for
  // by shape, in what it becomes when every placeholder is left at its default. All three have shipped:
  // `${2:, class: '$3'}` - how an optional argument is written - directly after the method name gave
  // `tag.div, class: ''`; upstream's `select` had a comma before such a placeholder as well, and its
  // `stylesheet_link_tag` had none at all between the source and `media:`.
  suite('the Ruby a body inserts', () => {
    let headers: { prefix: string; header: string }[] = [];

    // Expanded here rather than while the suite is being defined, so that a body the expander
    // chokes on fails these tests by name instead of taking mocha down as it loads the file.
    suiteSetup(() => {
      headers = PROVIDED_SNIPPETS.map((snippet) => ({ prefix: snippet.prefix, header: expandDefaults(snippet.body).split('\n')[0] as string }));
    });

    test('should not open the argument list with a comma', () => {
      for (const { prefix, header } of headers) {
        assert.ok(!/^[=-]+\s*[\w.?!]+\s*,/.test(header), `${prefix} expands to ${JSON.stringify(header)}`);
      }
    });

    test('should not leave an argument empty', () => {
      for (const { prefix, header } of headers) {
        assert.ok(!/,\s*,/.test(header), `${prefix} expands to ${JSON.stringify(header)}`);
      }
    });

    test('should separate a keyword argument from the literal before it', () => {
      for (const { prefix, header } of headers) {
        assert.ok(!/['"]\s+[a-z_]+:\s/.test(header), `${prefix} expands to ${JSON.stringify(header)}`);
      }
    });

    // The checks above are only as good as the expansion: `${2:, {\\}}` holds an escaped brace, and an
    // expander that stops at it leaves the placeholder - comma and all - unexpanded and unseen.
    test('should be read through an expansion that understands escapes, nesting and choices', () => {
      assert.strictEqual(expandDefaults('= button ${1:name}${2:, {\\}} do\n  $3'), '= button name, {} do\n  ');
      assert.strictEqual(expandDefaults('= submit${1: ${2:value}${3:, {\\}}}'), '= submit value, {}');
      assert.strictEqual(expandDefaults('!!! ${1|5,XML,Strict|}'), '!!! 5');
      assert.strictEqual(expandDefaults('= number_to_currency "\\$${1:1}"'), '= number_to_currency "$1"');
      assert.throws(() => expandDefaults('= f ${1|a,b}'), /never closes/);
    });
  });

  // Upstream labelled these three after a neighbouring helper, and the label is all the suggestion
  // list shows beside the prefix. Pinned because regenerating the vendored file brings them back.
  test('should label the three helpers upstream mislabelled after themselves', () => {
    const detailOf = (prefix: string): string | undefined => RAILS_SNIPPETS.find((snippet) => snippet.prefix === prefix)?.detail;
    assert.strictEqual(detailOf('mail_to_block'), 'mail_to block');
    assert.strictEqual(detailOf('collection_radio_buttons'), 'collection_radio_buttons');
    assert.strictEqual(detailOf('collection_radio_buttons_block'), 'collection_radio_buttons block');
  });

  // Haml is indentation-sensitive and rejects tabs outright.
  test('should never contain a tab', () => {
    for (const snippet of PROVIDED_SNIPPETS) {
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
