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

    // The closing quote goes missing whenever a name is retyped in front of arguments that are
    // already there. Read to the end of the line, the name took them along, and accepting a
    // completion replaced the whole rest of the call with it.
    test('should end an unterminated name where the rest of the call begins', () => {
      assert.strictEqual(nameAt("= render 'sha|, locals: { post: @post }"), 'sha');
      assert.strictEqual(replaced("= render 'sha|, locals: { post: @post }", 'shared/foo'), "= render 'shared/foo, locals: { post: @post }");
      assert.strictEqual(nameAt("= render('sha|)"), 'sha');
      assert.strictEqual(nameAt('= render \'sha| "x"'), 'sha');
      assert.strictEqual(nameAt("= render 'sha| if admin?"), 'sha');
    });

    // A later argument written with the same quote closes the literal as far as a scanner can tell,
    // which is the usual shape under RuboCop's single quotes. A partial path holds no comma, so one
    // inside the literal says the closing quote belongs to something else.
    test('should end a name that a later literal appears to close', () => {
      assert.strictEqual(nameAt("= render 'sha|, title: 'x'"), 'sha');
      assert.strictEqual(replaced("= render 'sha|, title: 'x'", 'shared/foo'), "= render 'shared/foo, title: 'x'");
      assert.strictEqual(nameAt("= render partial: 'sha|, locals: { a: 'b' }"), 'sha');
      assert.strictEqual(nameAt("= render 'sha, title: 'x|'"), null);
      // The name ends where the call goes on, not at the comma, and the quote that seemed to close
      // it no longer bounds it: a cursor between the two is outside the name.
      assert.strictEqual(nameAt("= render 'sha| , title: 'x'"), 'sha');
      assert.strictEqual(nameAt("= render 'sha, ti|tle: 'x'"), null);
    });

    // The comma that gives a later argument away is one in the path itself. One inside `#{...}` is
    // Ruby's, in a literal that is complete: cutting the name there resumes the scan inside the
    // interpolation, takes the real closing quote for an opening one, and loses every argument after.
    test('should not take a comma inside an interpolation for the end of the name', () => {
      assert.strictEqual(nameAt(`= render "cards/#{card.kind.tr('-', '_')}", layout: 'bo|x'`), 'box');
      assert.strictEqual(nameAt(`= render partial: "cards/#{kind.tr('-', '_')}", spacer_template: 'cards/spa|cer'`), 'cards/spacer');
      assert.strictEqual(nameAt(`= render "cards/|#{card.kind.tr('-', '_')}"`), "cards/#{card.kind.tr('-', '_')}");
      assert.strictEqual(replaced(`= render "cards/|#{card.kind.tr('-', '_')}"`, 'cards/item'), '= render "cards/item"');
      assert.strictEqual(nameAt('= render "sha|, title: "x"'), 'sha');
    });

    // A comma before the first `#{` gives a later argument away, and one inside a complete
    // interpolation does not - but a path may hold both, in either order. The interpolation is
    // stepped over whole instead, so where it sits stops mattering.
    test('should end a name at a comma that follows an interpolation', () => {
      assert.strictEqual(nameAt('= render "cards/#{kind}/sha|, title: "x"'), 'cards/#{kind}/sha');
      assert.strictEqual(nameAt('= render "a/#{b}/#{c}/sha|, title: "x"'), 'a/#{b}/#{c}/sha');
      assert.strictEqual(replaced('= render "cards/#{kind}/sha|, title: "x"', 'shared/foo'), '= render "shared/foo, title: "x"');
      assert.strictEqual(nameAt(`= render "cards/#{kind.tr('-', '_')}/sha|, title: "x"`), `cards/#{kind.tr('-', '_')}/sha`);
    });

    // An interpolation nothing closes is text, and the name ends where a name ends. Looking for the
    // close costs a search as far as the closing quote, so a name made of them is not searched once
    // per brace.
    test('should end a name that opens an interpolation it never closes', () => {
      assert.strictEqual(nameAt('= render "cards/#{ki|, title: "x"'), 'cards/#{ki');
      assert.strictEqual(nameAt('= render "a#{b#{c#{d|, title: "x"'), 'a#{b#{c#{d');
    });

    // Where the looking stops: after four `#{` have come back unclosed, the next one is read as text
    // rather than looked up, so the comma inside it ends the name and the cursor past it is outside.
    test('should give up looking after four unclosed interpolations', () => {
      assert.strictEqual(nameAt('= render "a#{#{#{x#{k,v}/sha|, title: "x"'), 'a#{#{#{x#{k,v}/sha');
      assert.strictEqual(nameAt('= render "a#{#{#{#{x#{k,v}/sha|, title: "x"'), null);
    });

    // Single quotes do not interpolate, so `#{` there is a mistake - but it is one people make, the
    // line is complete, and cutting the name inside it wrote `'shared/foo"-", "_")}'` on accepting.
    test('should not look for the comma past a #{ in single quotes either', () => {
      assert.strictEqual(nameAt(`= render 'cards/#{kind.tr("-", "_")}', layout: 'bo|x'`), 'box');
      assert.strictEqual(replaced(`= render 'cards/|#{kind.tr("-", "_")}', layout: 'box'`, 'shared/foo'), "= render 'shared/foo', layout: 'box'");
    });

    // The comma rule is for a partial name only. Applied to any other value it cuts `'a, partial: '`
    // off at the comma, reads the words after it as a keyword, and takes the quote that closes the
    // value for the one that opens a partial name.
    test('should leave a comma alone in a literal that is not a partial name', () => {
      assert.strictEqual(nameAt("= render 'x', title: 'a, b', layout: 'l|'"), 'l');
      assert.strictEqual(nameAt("= render 'x', title: 'a, partial: |'"), null);
      assert.strictEqual(nameAt("= render 'x', title: 'a, partial: '|"), null);
      assert.strictEqual(nameAt("= render 'x', title: 'a, layout: 'b|"), null);
    });

    // Stepping over a value whole must not mean to the end of the line when its closing quote is
    // still to come: a name half typed is rescued, and the arguments after a value half typed are
    // no less worth reaching.
    test('should end an unterminated value at its comma', () => {
      assert.strictEqual(nameAt(`= render 'x', title: 'abc, layout: "l|"`), 'l');
      assert.strictEqual(nameAt(`= render 'x', title: "abc, layout: 'l|'`), 'l');
    });

    // A value ends at its first comma and nowhere before it. A title holds spaces and brackets, and
    // cutting there hands the scan back in the middle of its words: `layout:` then reads as a
    // keyword and the quote that follows as the start of a name.
    test('should not end an unterminated value at a space or a bracket', () => {
      assert.strictEqual(nameAt(`= render 'x', title: 'see layout: "l|"`), null);
      assert.strictEqual(nameAt(`= render 'x', title: 'a (b) layout: "l|"`), null);
      assert.strictEqual(nameAt(`= render 'x', title: 'a, see layout: "l|"`), 'l', 'the comma still hands it back');
    });

    // A partial's own name is word characters, but the directories in front of it are not bound by that.
    test('should keep a dash or a dot in an unterminated name', () => {
      assert.strictEqual(nameAt("= render 'my-dir/v1.2/sha|, locals: {}"), 'my-dir/v1.2/sha');
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
  // The line of keywords is the one that punishes looking for a comma past the literal being read:
  // every `partial:` value is a name, and none of them holds a comma to stop the search early. It is
  // a megabyte because that search is a native indexOf, which c8 does not slow down while it slows
  // the scan around it: at a quarter of the size the search costs 249 ms, inside the budget c8 is
  // given, against 29 ms without it. At this size it is 3597 ms against 27.
  test('should stay fast on a very long line', () => {
    const repeated = `= render ${'render '.repeat(5000)}'x'`;
    const dataUri = `%img{src: "data:image/png;base64,${'A'.repeat(100000)}"}= render 'x'`;
    const keywords = `= render ${"partial: 'x' ".repeat(80000)}`;
    const elapsed = fastestOf(() => {
      partialReferenceAt(dataUri, 100060);
      partialReferenceAt(repeated, repeated.length);
      partialReferenceAt(keywords, keywords.length);
    });
    assert.ok(elapsed < FAST_ENOUGH_MS, `took ${elapsed}ms`);
  });

  // A literal cut short hands the scan back in the middle of what was already walked, where every
  // escaped quote opens a literal of its own - and each of those used to be walked to the end of the
  // line and cut short in its turn. 60 KB of `\'` took over a second. Each line keeps its cuts under
  // the limit, so what is measured is the cost of a cut and not the cost of giving up: the value
  // carries its commas so every `\'b` behind it is cut too, and the name is cut at each `\'`.
  // The interpolations are the other search a name pays for, and the one nothing closes is capped.
  test('should stay fast on a line where every quote opens a literal that is cut short', () => {
    const value = `= render 'y', title: 'a${", x: \\'b".repeat(7)}, layout: 'l ${"\\' ".repeat(5000)}`;
    const name = `= render 'a ${"\\' ".repeat(5000)}`;
    const commas = `= render partial: 'a, ${"partial: \\'b, ".repeat(5000)}'`;
    const interpolated = `= render "a${'#{b}'.repeat(5000)}, title: "x"`;
    const unclosed = `= render "a${'#{'.repeat(5000)}`;
    const elapsed = fastestOf(() => {
      partialReferenceAt(value, value.length);
      partialReferenceAt(name, name.length);
      partialReferenceAt(commas, commas.length);
      partialReferenceAt(interpolated, interpolated.length);
      partialReferenceAt(unclosed, unclosed.length);
    });
    assert.ok(elapsed < FAST_ENOUGH_MS, `took ${elapsed}ms`);
  });

  // The limit that keeps that line fast is far above anything typed by hand, where one literal is
  // unfinished at a time - here two are, and the name after them is still found.
  test('should still reach a name past two unfinished literals', () => {
    assert.strictEqual(nameAt(`= render 'sha, title: "abc, layout: 'l|'`), 'l');
  });

  // A literal cut short puts the scan back inside text its search has been through, where an escaped
  // quote opens another literal. What cut it makes no difference. The value left open is cut at its
  // comma, and so is each `\'b` behind it: one and seven. The name holding a comma is closed by a
  // quote far behind it, and so is each `\'b` it leaves but the last: eight of eight. Eight still
  // resolve - far more than a line being typed holds - and nine do not.
  test('should give up on a call that keeps cutting literals short', () => {
    const open = (count: number): string => `= render 'x', title: 'a${", x: \\'b".repeat(count)}, layout: "l|"`;
    const commas = (count: number): string => `= render partial: 'a${", partial: \\'b".repeat(count)}', layout: "l|"`;
    assert.strictEqual(nameAt(open(7)), 'l');
    assert.strictEqual(nameAt(open(8)), null);
    assert.strictEqual(nameAt(commas(8)), 'l');
    assert.strictEqual(nameAt(commas(9)), null);
  });

  // Past the limit the line is not one being typed, and a name cut short in it is as much a guess
  // under the cursor as anywhere else. A name that runs to the end of the line is not cut at all.
  test('should refuse a ninth literal cut short even under the cursor', () => {
    const eight = `= render 'x', title: 'a${", x: \\'b".repeat(7)}, layout: `;
    assert.strictEqual(nameAt(`${eight}"l|, more: 1`), null);
    assert.strictEqual(nameAt(`${eight}"l|`), 'l');
  });
});
