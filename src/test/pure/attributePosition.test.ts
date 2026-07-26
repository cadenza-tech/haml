import * as assert from 'node:assert';
import { classifyAttributePosition } from '../../pure/attributePosition';
import type { AttributeSyntax } from '../../types';
import { FAST_ENOUGH_MS, fastestOf } from '../support/timing';

function syntaxAt(linePrefix: string): AttributeSyntax | null {
  return classifyAttributePosition(linePrefix)?.syntax ?? null;
}

/** What the line becomes once an item is accepted, so expectations read as Haml. */
function applied(linePrefix: string, body: string): string | null {
  const position = classifyAttributePosition(linePrefix);
  if (position === null) {
    return null;
  }
  return linePrefix.slice(0, linePrefix.length - position.identifierLength - position.markerLength) + body;
}

suite('pure/attributePosition Test Suite', () => {
  suite('positions that take an attribute name', () => {
    test('should classify a Ruby hash key', () => {
      assert.strictEqual(syntaxAt('%div{ dat'), 'rubyHash');
      assert.strictEqual(syntaxAt('%div{ '), 'rubyHash');
      assert.strictEqual(syntaxAt('%div{'), 'rubyHash');
      assert.strictEqual(syntaxAt('%div{ id: 1, dat'), 'rubyHash');
    });

    test('should classify a quoted Ruby hash key', () => {
      assert.strictEqual(syntaxAt("%div{ 'data-tur"), 'rubyHash');
      assert.strictEqual(syntaxAt('%div{ "data-tur'), 'rubyHash');
    });

    test('should classify a nested data hash key', () => {
      assert.strictEqual(syntaxAt('%div{ data: { tur'), 'rubyDataHash');
      assert.strictEqual(syntaxAt('%div{ data: {'), 'rubyDataHash');
      assert.strictEqual(syntaxAt('%div{ id: 1, data: { controller: "x", tur'), 'rubyDataHash');
    });

    // `'data':` is the same key as `data:`; skipping the literal without recording it would lose
    // the ownerKey the nested-hash rule reads.
    test('should classify a nested data hash opened by a quoted key', () => {
      assert.strictEqual(syntaxAt("%div{ 'data': { tur"), 'rubyDataHash');
    });

    test('should classify an HTML-style attribute name', () => {
      assert.strictEqual(syntaxAt('%div(data-tur'), 'htmlAttributes');
      assert.strictEqual(syntaxAt('%div('), 'htmlAttributes');
      assert.strictEqual(syntaxAt('%a(href="/" data-tur'), 'htmlAttributes');
    });

    test('should classify after class, id and object reference shorthand', () => {
      assert.strictEqual(syntaxAt('%div.card#main{ dat'), 'rubyHash');
      assert.strictEqual(syntaxAt('.card{ dat'), 'rubyHash');
      assert.strictEqual(syntaxAt('#main{ dat'), 'rubyHash');
      assert.strictEqual(syntaxAt('%div[@post]{ dat'), 'rubyHash');
      assert.strictEqual(syntaxAt('%div(a="b"){ dat'), 'rubyHash');
    });

    // The identifier has to reach back over the dashes, or accepting data-turbo-frame at `data-tur`
    // would leave `data-data-turbo-frame` behind - the f.f.text_field bug in another guise.
    test('should replace the whole attribute name including dashes and quotes', () => {
      assert.strictEqual(applied('%div(data-tur', 'data-turbo-frame="$1"'), '%div(data-turbo-frame="$1"');
      assert.strictEqual(applied("%div{ 'data-tur", "'data-turbo-frame': '$1'"), "%div{ 'data-turbo-frame': '$1'");
      assert.strictEqual(applied('%div{ "data-tur', "'data-turbo-frame': '$1'"), "%div{ 'data-turbo-frame': '$1'");
      assert.strictEqual(applied('%div{ data: { tur', "turbo_frame: '$1'"), "%div{ data: { turbo_frame: '$1'");
    });

    test('should report the marker so the filter can match past the quote', () => {
      const quoted = classifyAttributePosition("%div{ 'data-tur");
      assert.strictEqual(quoted?.marker, "'");
      assert.strictEqual(quoted?.identifierLength, 'data-tur'.length);
      const bare = classifyAttributePosition('%div{ dat');
      assert.strictEqual(bare?.marker, '');
      assert.strictEqual(bare?.identifierLength, 3);
    });
  });

  suite('positions that do not', () => {
    // Offering an attribute name where a value belongs is worse than offering nothing.
    test('should reject a value position', () => {
      assert.strictEqual(syntaxAt('%div{ data: { turbo_frame: '), null);
      assert.strictEqual(syntaxAt("%div{ data: { turbo_frame: 'mo"), null);
      assert.strictEqual(syntaxAt("%div{ class: 'x"), null);
      assert.strictEqual(syntaxAt('%div{ class: dat'), null);
      assert.strictEqual(syntaxAt('%a(href="x'), null);
      assert.strictEqual(syntaxAt('%a(href=dat'), null);
    });

    // Legacy hashrocket syntax: `=>` separates a value exactly the way `:` does.
    test('should reject a hashrocket value position', () => {
      assert.strictEqual(syntaxAt("%div{ 'data-url' => dat"), null);
      assert.strictEqual(syntaxAt('%div{ data_url => dat'), null);
      assert.strictEqual(syntaxAt('%div{ :confirm => dat'), null);
    });

    // The tail walk cannot rewrite a closing quote: accepting there would destroy a completed key,
    // and the position after one is not a name position at all.
    test('should reject the position directly after a completed quoted key', () => {
      assert.strictEqual(syntaxAt("%div{ 'data-turbo'"), null);
      assert.strictEqual(syntaxAt('%div{ "data-turbo"'), null);
    });

    // Haml renders `foo: { data: { x: 1 } }` as foo-data-x, where Turbo and Stimulus names are wrong.
    test('should reject a data hash nested under another key', () => {
      assert.strictEqual(syntaxAt('%div{ foo: { data: { tur'), null);
    });

    test('should reject a hash that is not the attribute hash or a data hash', () => {
      assert.strictEqual(syntaxAt('%div{ locals: { dat'), null);
      assert.strictEqual(syntaxAt('%div{ data: { x: { dat'), null);
    });

    test('should reject once the attribute list is closed', () => {
      assert.strictEqual(syntaxAt('%div{ class: 1 }= lin'), null);
      assert.strictEqual(syntaxAt('%div{ class: 1 } dat'), null);
      assert.strictEqual(syntaxAt('%div(a="b") dat'), null);
    });

    test('should reject plain text and script lines', () => {
      for (const line of ['%p Hello dat', '= render dat', '- if dat', '  Some prose about dat', '', '   ', '%p']) {
        assert.strictEqual(syntaxAt(line), null, JSON.stringify(line));
      }
    });

    // A brace in the body of a tag is not an attribute hash.
    test('should reject a brace that follows the tag body', () => {
      assert.strictEqual(syntaxAt('%p Hello { dat'), null);
      assert.strictEqual(syntaxAt('%p= "#{x}" { dat'), null);
    });

    test('should reject an object reference and a Ruby call', () => {
      assert.strictEqual(syntaxAt('%div[@pos'), null);
      assert.strictEqual(syntaxAt('%div{ class: helper(dat'), null);
    });

    // Interpolation braces inside a string must not be counted as hash frames.
    test('should not count braces inside a string', () => {
      assert.strictEqual(syntaxAt('%div{ title: "a#{b}c", dat'), 'rubyHash');
      assert.strictEqual(syntaxAt('%div{ title: "a{", dat'), 'rubyHash');
      assert.strictEqual(syntaxAt("%div{ title: 'it\\'s', dat"), 'rubyHash');
    });

    test('should not treat a constant path as a key separator', () => {
      assert.strictEqual(syntaxAt('%div{ class: Foo::Bar'), null);
    });
  });

  // The same constraint completionWord documents: this runs on every keystroke.
  test('should stay fast on a very long line', () => {
    const dataUri = `%img{src: "data:image/png;base64,${'A'.repeat(100000)}", dat`;
    const plainText = `%p ${'a'.repeat(100000)} dat`;
    const elapsed = fastestOf(() => {
      classifyAttributePosition(dataUri);
      classifyAttributePosition(plainText);
    });
    assert.ok(elapsed < FAST_ENOUGH_MS, `took ${elapsed}ms`);
  });
});
