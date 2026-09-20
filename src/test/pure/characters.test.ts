import * as assert from 'node:assert';
import {
  findInterpolationEnd,
  findLiteralEnd,
  isBlankText,
  isClosingBracket,
  isIdentifierStart,
  isNameCharacter,
  isOpeningBracket,
  isSpaceCharacter,
  isWordCharacter,
  skipSpaces
} from '../../pure/characters';
import { FAST_ENOUGH_MS, fastestOf } from '../support/timing';

/**
 * The regexes these predicates replaced.
 *
 * Kept here as the oracle rather than deleted: the point of the change was the constant factor, so
 * the one thing that must be proven is that nothing about the classification moved.
 */
const ORACLES: readonly { readonly name: string; readonly subject: (character: string | undefined) => boolean; readonly pattern: RegExp }[] = [
  { name: 'isIdentifierStart', subject: isIdentifierStart, pattern: /^[A-Za-z_]$/ },
  { name: 'isWordCharacter', subject: isWordCharacter, pattern: /^[A-Za-z0-9_]$/ },
  { name: 'isNameCharacter', subject: isNameCharacter, pattern: /^[A-Za-z0-9_-]$/ },
  { name: 'isSpaceCharacter', subject: isSpaceCharacter, pattern: /^[ \t]$/ },
  { name: 'isOpeningBracket', subject: isOpeningBracket, pattern: /^[{([]$/ },
  { name: 'isClosingBracket', subject: isClosingBracket, pattern: /^[})\]]$/ }
];

suite('pure/characters Test Suite', () => {
  // Every call site indexes into a string, so the domain is exactly "one code unit, or undefined past
  // the end of the line". Anything longer is out of contract: the regexes were unanchored and would
  // have matched a character anywhere in it, which no call site ever relied on.
  for (const { name, subject, pattern } of ORACLES) {
    test(`should classify every code unit exactly as ${name}'s regex did`, () => {
      for (let code = 0; code <= 0xffff; code++) {
        const character = String.fromCharCode(code);
        assert.strictEqual(subject(character), pattern.test(character), `code ${code} (${JSON.stringify(character)})`);
      }
    });
  }

  test('should reject the end of the line', () => {
    assert.strictEqual(isIdentifierStart(undefined), false);
    assert.strictEqual(isWordCharacter(undefined), false);
    assert.strictEqual(isNameCharacter(undefined), false);
  });

  // charCodeAt returns NaN here, and every comparison against NaN is false. Asserted rather than
  // assumed, because it is the one input where the range checks and a regex could plausibly diverge.
  test('should reject the empty string', () => {
    assert.strictEqual(isIdentifierStart(''), false);
    assert.strictEqual(isWordCharacter(''), false);
    assert.strictEqual(isNameCharacter(''), false);
  });

  test('should separate the three classes where they differ', () => {
    assert.strictEqual(isIdentifierStart('7'), false, 'a digit cannot open an identifier');
    assert.strictEqual(isWordCharacter('7'), true);
    assert.strictEqual(isWordCharacter('-'), false, 'a dash is not part of a Ruby identifier');
    assert.strictEqual(isNameCharacter('-'), true, 'but it is part of data-turbo-frame');
  });

  suite('skipSpaces', () => {
    test('should stop at the first character that is not a space or tab', () => {
      assert.strictEqual(skipSpaces('  \t%p', 0), 3);
    });

    test('should return the length when there is nothing but whitespace', () => {
      assert.strictEqual(skipSpaces('   ', 0), 3);
      assert.strictEqual(skipSpaces('', 0), 0);
    });

    test('should start where it is told and never go backwards', () => {
      assert.strictEqual(skipSpaces('%p  x', 2), 4);
      assert.strictEqual(skipSpaces('%p', 99), 99);
    });
  });

  suite('isBlankText', () => {
    test('should treat empty, spaces and tabs as blank', () => {
      for (const text of ['', ' ', '\t', '  \t ']) {
        assert.strictEqual(isBlankText(text), true, JSON.stringify(text));
      }
    });

    // Deliberately narrower than trim(): VS Code counts space and tab only, so under the trim
    // definition a NBSP line reported indent 0 *and* blank, making its indent width infinite.
    test('should not treat exotic whitespace as blank', () => {
      for (const text of ['\u00a0', '\u000b', '\u000c', '\u2028', '\u3000']) {
        assert.strictEqual(isBlankText(text), false, JSON.stringify(text));
      }
    });

    test('should not treat content as blank', () => {
      assert.strictEqual(isBlankText('  %p'), false);
    });
  });

  suite('findLiteralEnd', () => {
    test('should find the closing quote of both quote styles', () => {
      assert.strictEqual(findLiteralEnd("render 'card'", 7), 12);
      assert.strictEqual(findLiteralEnd('render "card"', 7), 12);
    });

    test('should not stop at the other quote style', () => {
      assert.strictEqual(findLiteralEnd(`x '"' y`, 2), 4);
    });

    // `x 'a\'b' y`: the backslash at 4 escapes the quote at 5, so the literal is `a\'b` and the
    // real terminator is the quote at 7.
    test('should treat a backslash as consuming whatever follows it', () => {
      assert.strictEqual(findLiteralEnd(`x 'a\\'b' y`, 2), 7);
    });

    test('should run to the end of the line when the literal is unterminated', () => {
      const line = "render 'card";
      assert.strictEqual(findLiteralEnd(line, 7), line.length);
    });

    // A trailing backslash consumes past the end, which must not read as a closing quote.
    test('should run to the end when a trailing backslash swallows the terminator', () => {
      const line = "render 'card\\";
      assert.strictEqual(findLiteralEnd(line, 7), line.length);
    });

    test('should give an empty literal for an immediately closed quote', () => {
      assert.strictEqual(findLiteralEnd("x ''", 2), 3);
    });

    // `"a#{x["k"]}"`: the quotes at 6 and 8 belong to the interpolation, and Ruby reads the literal
    // through to 11. Reading 6 as the terminator truncates the literal mid-way.
    test('should step over an interpolation holding the same quote', () => {
      assert.strictEqual(findLiteralEnd('"a#{x["k"]}"', 0), 11);
    });

    test('should step over nested braces and literals inside an interpolation', () => {
      assert.strictEqual(findLiteralEnd('"#{ {a: "}"} }"', 0), 14);
    });

    // Single quotes do not interpolate in Ruby, so `#{` there is ordinary text.
    test('should not interpolate inside single quotes', () => {
      assert.strictEqual(findLiteralEnd("'a#{x'", 0), 5);
    });

    test('should treat an unterminated interpolation as an unterminated literal', () => {
      const line = '"a#{x';
      assert.strictEqual(findLiteralEnd(line, 0), line.length);
    });

    // Each `"#{` nests a literal inside an interpolation; without a depth cap this is two stack
    // frames per three characters, and a 30 KB hostile line overflows the stack mid-keystroke.
    test('should survive a hostile line of nested interpolation openers', () => {
      const line = '"#{'.repeat(10000);
      const elapsed = fastestOf(() => {
        assert.strictEqual(findLiteralEnd(line, 0), line.length);
      });
      assert.ok(elapsed < FAST_ENOUGH_MS, `took ${elapsed}ms`);
    });
  });

  suite('findInterpolationEnd', () => {
    test('should return the index after the closing brace', () => {
      assert.strictEqual(findInterpolationEnd('a#{b}c', 2, 6), 5);
      assert.strictEqual(findInterpolationEnd('#{a { b } c}', 1, 12), 12);
    });

    // The limit is the end of the literal the interpolation is written in: a brace that closes it
    // exactly there counts, and one that lies at the limit or past it does not.
    test('should look no further than the limit', () => {
      assert.strictEqual(findInterpolationEnd('#{a}', 1, 4), 4);
      assert.strictEqual(findInterpolationEnd('#{a}', 1, 3), -1);
      assert.strictEqual(findInterpolationEnd('#{a', 1, 3), -1);
    });

    // -1 rather than the limit, which a caller could only tell from a close by looking at the last
    // character - and `#{ki, locals: { a: 1 }` ends in a brace that closes something else.
    test('should not take a brace that closes something else for its own', () => {
      assert.strictEqual(findInterpolationEnd('#{ {a}', 1, 6), -1);
      assert.strictEqual(findInterpolationEnd('#{x "}', 1, 6), -1);
      assert.strictEqual(findInterpolationEnd('#{ki, locals: { a: 1 }', 1, 22), -1);
    });

    test('should step over a nested literal that holds a brace', () => {
      assert.strictEqual(findInterpolationEnd(`#{h['}', ',']}`, 1, 14), 14);
      assert.strictEqual(findInterpolationEnd('#{"a#{b}"}', 1, 10), 10);
    });

    test('should not let an escaped brace close it', () => {
      assert.strictEqual(findInterpolationEnd('#{a\\}b}', 1, 7), 7);
    });

    // Timed as well as asserted: the two scanners call each other, and a step that fails to advance
    // hangs here rather than failing. Mocha's timeout cannot interrupt a synchronous loop, so without
    // this the build would stop rather than go red.
    test('should report a hostile line of nested openers as unclosed', () => {
      const line = '#{"'.repeat(10000);
      const elapsed = fastestOf(() => {
        assert.strictEqual(findInterpolationEnd(line, 1, line.length), -1);
      });
      assert.ok(elapsed < FAST_ENOUGH_MS, `took ${elapsed}ms`);
    });
  });
});
