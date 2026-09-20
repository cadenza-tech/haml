// The character classes, and the one-pass scans built on them, that the per-keystroke scanners
// share. Pure; no vscode imports.
//
// Comparing code points rather than running a regex per character is what keeps these affordable.
// `/[A-Za-z0-9_-]/.test(c)` measures ~17x slower than the range checks below, and the scanners in
// attributePosition.ts and renderPartial.ts call one of these for most characters of the line - which
// on a line holding an inline data URI is the difference between microseconds and milliseconds, on
// every keystroke.

const DIGIT_0 = 48;
const DIGIT_9 = 57;
const UPPER_A = 65;
const UPPER_Z = 90;
const LOWER_A = 97;
const LOWER_Z = 122;
const UNDERSCORE = 95;
const DASH = 45;
const SPACE = 32;
const TAB = 9;
const BRACE_OPEN = 123;
const BRACE_CLOSE = 125;
const PAREN_OPEN = 40;
const PAREN_CLOSE = 41;
const BRACKET_OPEN = 91;
const BRACKET_CLOSE = 93;
const BACKSLASH = 92;
const HASH = 35;

function isLetter(code: number): boolean {
  return (code >= LOWER_A && code <= LOWER_Z) || (code >= UPPER_A && code <= UPPER_Z);
}

function isDigit(code: number): boolean {
  return code >= DIGIT_0 && code <= DIGIT_9;
}

/** `[A-Za-z_]`: what a Ruby identifier may open with. */
export function isIdentifierStart(character: string | undefined): boolean {
  if (character === undefined) {
    return false;
  }
  const code = character.charCodeAt(0);
  return isLetter(code) || code === UNDERSCORE;
}

/** `[A-Za-z0-9_]`: what the rest of a Ruby identifier is made of. */
export function isWordCharacter(character: string | undefined): boolean {
  if (character === undefined) {
    return false;
  }
  const code = character.charCodeAt(0);
  return isLetter(code) || isDigit(code) || code === UNDERSCORE;
}

/** `[A-Za-z0-9_-]`: a word character or a dash, which is what an HTML attribute name adds. */
export function isNameCharacter(character: string | undefined): boolean {
  if (character === undefined) {
    return false;
  }
  const code = character.charCodeAt(0);
  return isLetter(code) || isDigit(code) || code === UNDERSCORE || code === DASH;
}

/** `[ \t]`: the only whitespace Haml indents with, and the only whitespace VS Code counts as indent. */
export function isSpaceCharacter(character: string | undefined): boolean {
  if (character === undefined) {
    return false;
  }
  const code = character.charCodeAt(0);
  return code === SPACE || code === TAB;
}

/** `[{([]` */
export function isOpeningBracket(character: string | undefined): boolean {
  if (character === undefined) {
    return false;
  }
  const code = character.charCodeAt(0);
  return code === BRACE_OPEN || code === PAREN_OPEN || code === BRACKET_OPEN;
}

/** `[})\]]` */
export function isClosingBracket(character: string | undefined): boolean {
  if (character === undefined) {
    return false;
  }
  const code = character.charCodeAt(0);
  return code === BRACE_CLOSE || code === PAREN_CLOSE || code === BRACKET_CLOSE;
}

/** First index at or after `from` that is not a space or tab; `text.length` when there is none. */
export function skipSpaces(text: string, from: number): number {
  let index = from;
  while (index < text.length && isSpaceCharacter(text[index])) {
    index++;
  }
  return index;
}

/**
 * True when `text` holds nothing but spaces and tabs.
 *
 * Deliberately narrower than `text.trim() === ''`: firstNonWhitespaceCharacterIndex - the other
 * half of a LineSnapshot - counts space and tab only, and Haml rejects anything else as
 * indentation. Under the trim definition a line holding one NBSP reports index 0 *and* blank, which
 * makes its indent width infinite for a line that renders as content.
 */
export function isBlankText(text: string): boolean {
  return skipSpaces(text, 0) === text.length;
}

/**
 * Sane code nests a literal inside an interpolation inside a literal two or three levels deep; only
 * a hostile line - `'"#{'.repeat(10000)` is enough - goes further, and each level is two stack
 * frames. Beyond the cap the rest of the line reads as an unterminated literal, which is what every
 * scanner already treats conservatively.
 */
const MAX_INTERPOLATION_DEPTH = 32;

/**
 * Index of the quote closing the Ruby string literal opened at `quoteIndex`, or `text.length` when
 * the literal is unterminated. A backslash always consumes the next character, including a closing
 * quote and including the last character of the line.
 *
 * A double-quoted literal steps over `#{...}` whole, because Ruby does: in `"a#{x["k"]}"` the inner
 * quotes belong to the interpolation, and reading the first of them as the closing quote truncates
 * the literal mid-way. Single quotes do not interpolate, so there `#{` stays ordinary text.
 *
 * Returns an index rather than the text: attributePosition only needs to step over the literal and
 * skipBalanced only needs to ignore it, so neither should pay for a slice on every keystroke.
 */
export function findLiteralEnd(text: string, quoteIndex: number): number {
  return findLiteralEndAt(text, quoteIndex, 0);
}

function findLiteralEndAt(text: string, quoteIndex: number, depth: number): number {
  if (depth > MAX_INTERPOLATION_DEPTH) {
    return text.length;
  }
  const quote = text[quoteIndex];
  const interpolates = quote === '"';
  let index = quoteIndex + 1;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === BACKSLASH) {
      index += 2;
      continue;
    }
    if (interpolates && code === HASH && text.charCodeAt(index + 1) === BRACE_OPEN) {
      index = skipInterpolation(text, index + 1, depth + 1);
      continue;
    }
    if (text[index] === quote) {
      return index;
    }
    index++;
  }
  return text.length;
}

/**
 * Index of the character after the `}` matching the `#{`'s brace at `braceIndex`, or `text.length`
 * when the interpolation never closes. Nested braces and nested string literals - which may hold
 * unbalanced braces of their own - are consumed whole.
 */
function skipInterpolation(text: string, braceIndex: number, depth: number): number {
  if (depth > MAX_INTERPOLATION_DEPTH) {
    return text.length;
  }
  let nesting = 0;
  let index = braceIndex;
  while (index < text.length) {
    const character = text[index];
    if (character === "'" || character === '"') {
      index = findLiteralEndAt(text, index, depth + 1) + 1;
      continue;
    }
    const code = text.charCodeAt(index);
    if (code === BACKSLASH) {
      index += 2;
      continue;
    }
    if (code === BRACE_OPEN) {
      nesting++;
    } else if (code === BRACE_CLOSE) {
      nesting--;
      if (nesting === 0) {
        return index + 1;
      }
    }
    index++;
  }
  return text.length;
}
