import * as assert from 'node:assert';
import { computeCompletionWord, computeReplaceLength, filterTextFor } from '../../pure/completionWord';
import { CONTROL_SNIPPETS, controlSnippetsFor } from '../../pure/controlSnippets';
import { RAILS_SNIPPETS } from '../../pure/railsSnippets';

function bodyOf(prefix: string): string {
  const snippet = CONTROL_SNIPPETS.find((candidate) => candidate.prefix === prefix);
  assert.ok(snippet !== undefined, `there is no control snippet called ${prefix}`);
  return snippet.body;
}

/** The first line the document holds once the snippet is accepted, or null where it is not offered. */
function applied(linePrefix: string, prefix: string): string | null {
  const word = computeCompletionWord(linePrefix);
  const length = word === null ? null : computeReplaceLength(word, bodyOf(prefix));
  if (length === null) {
    return null;
  }
  return linePrefix.slice(0, linePrefix.length - length) + (bodyOf(prefix).split('\n')[0] as string);
}

function filterTextAt(linePrefix: string, prefix: string): string | null {
  const word = computeCompletionWord(linePrefix);
  const length = word === null ? null : computeReplaceLength(word, bodyOf(prefix));
  return word === null || length === null ? null : filterTextFor(word, length, prefix);
}

// These were contributed through snippets/haml.code-snippets, and a contributed snippet replaces
// nothing but the word that matches its prefix: accepting `if` after a `- ` already typed wrote
// `- - if condition`. Once the line was highlighted the position counted as Ruby and the Haml set
// was not offered there at all. Supplied by the provider, the marker sits inside the replaced range.
suite('pure/controlSnippets Test Suite', () => {
  test('should replace a marker already typed instead of repeating it', () => {
    assert.strictEqual(applied('- if', 'if'), '- if ${1:condition}');
    assert.strictEqual(applied('-if', 'if'), '- if ${1:condition}');
    assert.strictEqual(applied('  - if', 'if'), '  - if ${1:condition}');
    assert.strictEqual(applied('\t- else', 'else'), '\t- else');
    assert.strictEqual(applied('- when', 'when'), '- when ${1:value}');
    assert.strictEqual(applied('= yield', 'yield'), '= yield ${1::section}');
    assert.strictEqual(applied('- each', 'each'), '- ${1:collection}.each do |${2:item}|');
  });

  test('should bring its own marker where none was typed', () => {
    assert.strictEqual(applied('if', 'if'), '- if ${1:condition}');
    assert.strictEqual(applied('    unless', 'unless'), '    - unless ${1:condition}');
    assert.strictEqual(applied('yield', 'yield'), '= yield ${1::section}');
  });

  // The marker the body carries is the one that belongs to it, whichever one was typed.
  test('should put its own marker in place of the other one', () => {
    assert.strictEqual(applied('= if', 'if'), '- if ${1:condition}');
    assert.strictEqual(applied('- yield', 'yield'), '= yield ${1::section}');
  });

  // A tag can carry a one-line output body and nothing else: `%p= if` is not Haml.
  test('should keep silent script off a line a tag has already opened', () => {
    for (const snippet of CONTROL_SNIPPETS.filter((candidate) => candidate.prefix !== 'yield')) {
      assert.strictEqual(applied(`%p= ${snippet.prefix}`, snippet.prefix), null, snippet.prefix);
    }
    assert.strictEqual(applied('%p= yield', 'yield'), '%p= yield ${1::section}');
    assert.strictEqual(applied('.card{ id: 1 }= yield', 'yield'), '.card{ id: 1 }= yield ${1::section}');
  });

  test('should stay out of plain text', () => {
    assert.strictEqual(applied('%p Please if', 'if'), null);
    assert.strictEqual(applied('%p if', 'if'), null);
    assert.strictEqual(applied('Please if', 'if'), null);
  });

  // The filter word runs from the start of the replaced range to the cursor, so once the range takes
  // the marker in, the prefix alone would never match what has been typed and the item would vanish.
  test('should be filtered by the marker as well once it replaces it', () => {
    assert.strictEqual(filterTextAt('- if', 'if'), '- if');
    assert.strictEqual(filterTextAt('-if', 'if'), '-if');
    assert.strictEqual(filterTextAt('  - if', 'if'), '- if');
    assert.strictEqual(filterTextAt('if', 'if'), 'if');
  });

  suite('controlSnippetsFor', () => {
    const prefixesFor = (identifier: string): string[] => controlSnippetsFor(identifier).map((snippet) => snippet.prefix);

    test('should answer with the snippets the typed word can still become', () => {
      assert.deepStrictEqual(prefixesFor('if'), ['if', 'ifelse']);
      assert.deepStrictEqual(prefixesFor('e').sort(), ['each', 'eachwi', 'else', 'elsif']);
      assert.deepStrictEqual(prefixesFor('WH').sort(), ['when', 'while']);
      assert.deepStrictEqual(prefixesFor('content_f'), ['content_for']);
    });

    // Once a provider has returned any item, VS Code stops asking the ones ranked below it, the
    // word-based one among them: fifteen items returned for `sect` would cost every word typed at a
    // line start its suggestions, for nothing the list could ever show. `se` is the reason the match
    // is by prefix and not by subsequence: it is one of `else` and of `case`.
    test('should answer with nothing for a word that is none of them', () => {
      assert.deepStrictEqual(prefixesFor('sect'), []);
      assert.deepStrictEqual(prefixesFor('se'), []);
      assert.deepStrictEqual(prefixesFor('f.if'), []);
      assert.deepStrictEqual(prefixesFor('items.each'), []);
      assert.deepStrictEqual(prefixesFor('iff'), []);
    });
  });

  test('should carry the fifteen that snippets/haml.code-snippets used to', () => {
    assert.deepStrictEqual(
      CONTROL_SNIPPETS.map((snippet) => snippet.prefix),
      ['if', 'ifelse', 'elsif', 'else', 'unless', 'each', 'eachwi', 'case', 'when', 'while', 'until', 'begin', 'do', 'yield', 'content_for']
    );
  });

  test('should open every body with the marker it needs', () => {
    for (const snippet of CONTROL_SNIPPETS) {
      assert.ok(snippet.body.startsWith('- ') || snippet.body.startsWith('= '), snippet.prefix);
    }
  });

  test('should keep every prefix unique, and clear of the Rails set', () => {
    const prefixes = CONTROL_SNIPPETS.map((snippet) => snippet.prefix);
    assert.strictEqual(new Set(prefixes).size, prefixes.length);
    const rails = new Set(RAILS_SNIPPETS.map((snippet) => snippet.prefix));
    assert.deepStrictEqual(
      prefixes.filter((prefix) => rails.has(prefix)),
      []
    );
  });
});
