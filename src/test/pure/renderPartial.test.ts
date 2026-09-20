import * as assert from 'node:assert';
import { partialReferenceAt } from '../../pure/renderPartial';
import { FAST_ENOUGH_MS, fastestOf } from '../support/timing';

/** Fixtures carry a `|` where the cursor sits, so they read as Haml rather than as offsets. */
function cursor(marked: string): { line: string; character: number } {
  const character = marked.indexOf('|');
  assert.ok(character !== -1, `${JSON.stringify(marked)} has no cursor marker`);
  return { line: marked.slice(0, character) + marked.slice(character + 1), character };
}

function nameAt(marked: string): string | null {
  const { line, character } = cursor(marked);
  const reference = partialReferenceAt(line, character);
  return reference === null ? null : reference.name;
}

/** What the line becomes once a completion item replaces the literal, which is what the range is for. */
function replaced(marked: string, insertion: string): string | null {
  const { line, character } = cursor(marked);
  const reference = partialReferenceAt(line, character);
  return reference === null ? null : line.slice(0, reference.start) + insertion + line.slice(reference.end);
}

suite('pure/renderPartial Test Suite', () => {
  suite('render calls that carry a partial name', () => {
    test('should take a single-quoted positional argument', () => {
      assert.strictEqual(nameAt("= render 'shared/foo|'"), 'shared/foo');
      assert.strictEqual(nameAt("= render 'sha|red/foo'"), 'shared/foo');
    });

    test('should take a double-quoted positional argument', () => {
      assert.strictEqual(nameAt('= render "shared/foo|"'), 'shared/foo');
    });

    test('should take a parenthesised argument', () => {
      assert.strictEqual(nameAt("= render('shared/foo|')"), 'shared/foo');
      assert.strictEqual(nameAt("%p= render( 'x|' )"), 'x');
    });

    // `~` is output that keeps the whitespace of a <pre> or a <textarea>, which is what a partial
    // holding one is rendered with. Haml takes it wherever it takes `=` (rendered with haml 6.4).
    test('should take a call behind the whitespace-preserving marker', () => {
      assert.strictEqual(nameAt("~ render 'shared/foo|'"), 'shared/foo');
      assert.strictEqual(nameAt("  ~ render partial: 'x|'"), 'x');
      assert.strictEqual(nameAt("%div~ render 'x|'"), 'x');
      assert.strictEqual(nameAt("!~ render 'x|'"), 'x');
      assert.strictEqual(nameAt("%p ~ render 'x|'"), null, 'after a space it is text');
    });

    test('should take the partial keyword', () => {
      assert.strictEqual(nameAt("= render partial: 'shared/foo|'"), 'shared/foo');
      assert.strictEqual(nameAt("= render(partial: 'x|')"), 'x');
    });

    test('should take the layout keyword', () => {
      assert.strictEqual(nameAt("= render layout: 'l|' do"), 'l');
    });

    // Rails resolves spacer_template: with the leading underscore, exactly like partial:, and the
    // render_partial_collection snippet inserts the keyword.
    test('should take the spacer_template keyword', () => {
      assert.strictEqual(nameAt("= render partial: 'x', collection: @posts, spacer_template: 's|'"), 's');
    });

    test('should take a silent script marker and a tag marker', () => {
      assert.strictEqual(nameAt("- render 'x|'"), 'x');
      assert.strictEqual(nameAt("%p= render 'x|'"), 'x');
      assert.strictEqual(nameAt("%td.a{ b: 1 }= render 'x|'"), 'x');
    });

    test('should take an empty literal, which is where completion starts', () => {
      assert.strictEqual(nameAt("= render '|'"), '');
      assert.strictEqual(nameAt('= render "|"'), '');
    });

    // The literal is unterminated for as long as the user is typing the name.
    test('should treat an unterminated literal as reaching the end of the line', () => {
      assert.strictEqual(nameAt("= render 'sha|"), 'sha');
      assert.strictEqual(replaced("= render 'sha|", 'shared/foo'), "= render 'shared/foo");
    });

    // Both ends count as inside so that re-editing an existing name resolves and completes.
    test('should cover both ends of the literal', () => {
      assert.strictEqual(nameAt("= render '|x'"), 'x');
      assert.strictEqual(nameAt("= render 'x|'"), 'x');
    });

    test('should keep the rest of the line when the literal is replaced', () => {
      assert.strictEqual(replaced("= render 'sha|', locals: { a: 1 }", 'shared/foo'), "= render 'shared/foo', locals: { a: 1 }");
      assert.strictEqual(replaced("= render('x|')", 'y'), "= render('y')");
    });

    // `#{}` may hold the literal's own quote character; the literal still runs to its real
    // terminator, not to the interpolation's inner quote.
    test('should span an interpolation holding the same quote', () => {
      assert.strictEqual(nameAt('= render "card|#{x["k"]}"'), 'card#{x["k"]}');
    });
  });

  suite('literals that are not partial names', () => {
    // Taking this one would offer view names inside every locals hash.
    test('should not take a value inside a nested hash', () => {
      assert.strictEqual(nameAt("= render 'x', locals: { a: 'b|' }"), null);
      assert.strictEqual(nameAt("= render partial: 'x', locals: { a: { b: 'c|' } }"), null);
    });

    test('should not take the value of a keyword that does not name a partial', () => {
      assert.strictEqual(nameAt("= render collection: 'x|'"), null);
      assert.strictEqual(nameAt("= render object: 'x|'"), null);
      assert.strictEqual(nameAt("= render template: 'x|'"), null);
    });

    test('should take the partial keyword even when other keywords precede it', () => {
      assert.strictEqual(nameAt("= render collection: @posts, partial: 'x|'"), 'x');
    });

    // Only the first positional argument is the partial name.
    test('should not take a later positional argument', () => {
      assert.strictEqual(nameAt("= render 'x', 'y|'"), null);
    });

    test('should not take anything past a block opener', () => {
      assert.strictEqual(nameAt("= render layout: 'l' do |x| = f 'y|'"), null);
    });

    // The argument list ends at the closing parenthesis, so a later call on the line is not ours.
    test('should not take anything past a closing parenthesis', () => {
      assert.strictEqual(nameAt("= render('x') + f('y|')"), null);
    });

    // A hash the user has not finished typing runs to the end of the line and swallows the rest.
    test('should not take a value inside an unterminated hash', () => {
      assert.strictEqual(nameAt("= render 'x', locals: { a: 'b|'"), null);
    });

    test('should return null outside any literal', () => {
      assert.strictEqual(nameAt("= render 'x'|"), null);
      assert.strictEqual(nameAt("= render| 'x'"), null);
      assert.strictEqual(nameAt("|= render 'x'"), null);
    });

    // An escaped quote does not end the literal, so the cursor is still inside it.
    test('should not let an escaped quote end the literal', () => {
      assert.strictEqual(nameAt("= render 'it\\'s x|'"), "it\\'s x");
    });
  });

  suite('positions where render is not a Haml script call', () => {
    // These are the five cases computeCompletionWord decides; renderPartial reuses it as the guard.
    test('should reject prose that merely contains the word render', () => {
      assert.strictEqual(nameAt("%p Please render 'x|'"), null);
      assert.strictEqual(nameAt("  Some prose about render 'x|'"), null);
    });

    test('should reject a Ruby assignment, which is what a :ruby filter body looks like', () => {
      assert.strictEqual(nameAt("  x = render 'y|'"), null);
    });

    // A line with no script marker renders as literal text, so nothing on it is a call.
    test('should reject a line with no script marker', () => {
      assert.strictEqual(nameAt("render 'x|'"), null);
      assert.strictEqual(nameAt("  render 'x|'"), null);
    });

    test('should reject render as part of a longer identifier', () => {
      assert.strictEqual(nameAt("= x.render 'y|'"), null);
      assert.strictEqual(nameAt("= _render 'y|'"), null);
      assert.strictEqual(nameAt("= renders 'y|'"), null);
      assert.strictEqual(nameAt("= render_async 'y|'"), null);
    });

    test('should reject a different helper', () => {
      assert.strictEqual(nameAt("= link_to 'x|'"), null);
      assert.strictEqual(nameAt("= t('.title|')"), null);
    });

    test('should reject an attribute hash', () => {
      assert.strictEqual(nameAt("%div{ class: 'x|' }"), null);
      assert.strictEqual(nameAt('%a(href="x|")'), null);
    });
  });

  // A quadratic scan here would freeze the extension host on a line holding a data URI, once per
  // keystroke. The repeated-token line is the input that punishes slicing the prefix per candidate:
  // without the candidate limit its 5000 `render` tokens would each slice the whole prefix.
  test('should stay fast on a very long line', () => {
    const repeated = `= render ${'render '.repeat(5000)}'x'`;
    const dataUri = `%img{src: "data:image/png;base64,${'A'.repeat(100000)}"}= render 'x'`;
    const elapsed = fastestOf(() => {
      partialReferenceAt(dataUri, 100060);
      partialReferenceAt(repeated, repeated.length);
    });
    assert.ok(elapsed < FAST_ENOUGH_MS, `took ${elapsed}ms`);
  });
});
