// Decides whether the cursor sits where a Haml tag attribute name belongs, and in which of the three
// notations.
//
// A tag can carry `{ruby: 'hash'}`, `(html style)` and `[object, :reference]`, in any combination, and
// only the first two hold attribute names. Telling a key position from a value position is the whole
// job: offering `data-turbo-frame` where a value belongs is worse than offering nothing.
//
// Single line only. A hash spread over several lines cannot be judged from the prefix of one of them,
// which is what provideCompletionItems has to work with.
//
// Everything scans linearly, for the reason src/pure/completionWord.ts documents: this runs on every
// keystroke and a Haml line can hold an inline data URI.

import type { AttributeSyntax } from '../types';
import { findLiteralEnd, isNameCharacter, isOpeningBracket, isSpaceCharacter, skipSpaces } from './characters';

/** What a Haml line may open with and still be a tag. */
const TAG_STARTS = new Set(['%', '.', '#']);
/** Quotes the insertion rewrites, so they have to be inside the replaced range. */
const MARKERS = new Set(["'", '"']);
const DATA_KEY = 'data';

type FrameKind = 'hash' | 'html' | 'reference' | 'paren';

interface Frame {
  readonly kind: FrameKind;
  /** The key that opened this frame, so `data: {` can be told from `locals: {`. */
  readonly ownerKey: string | null;
  /** Whether a value separator has been seen since the last item separator. */
  sawValueSeparator: boolean;
  lastKey: string | null;
}

export interface AttributePosition {
  readonly syntax: AttributeSyntax;
  /**
   * Length of the name being typed. Unlike completionWord's identifier this reaches back over dashes:
   * replacing only `tur` in `data-tur` would leave `data-data-turbo-frame` behind, which is the
   * f.f.text_field bug in another guise.
   */
  readonly identifierLength: number;
  /** Characters before the name that the insertion rewrites, i.e. an opening quote. */
  readonly markerLength: number;
  readonly marker: string;
  /**
   * Characters after the cursor that the insertion rewrites as well: the closing quote, when it is
   * the very next character. Typing the opening one makes VS Code write it, and every quoted item
   * brings its own, so leaving it there turns `'data-tur|'` into `'data-turbo-frame': '''`.
   */
  readonly trailingLength: number;
}

interface ScanResult {
  readonly frame: Frame | null;
  readonly depth: number;
  /** Opening quote of the literal the prefix ends inside, or null when every literal is closed. */
  readonly openLiteralStart: number | null;
}

/** Walks the line once and reports the innermost bracket frame the cursor ends up in. */
function scan(linePrefix: string): ScanResult | null {
  let index = skipSpaces(linePrefix, 0);
  if (!TAG_STARTS.has(linePrefix[index] as string)) {
    return null;
  }

  const stack: Frame[] = [];
  let openLiteralStart: number | null = null;
  // An html-style `=` whose value has not started. Haml takes `href= "/x"` and `href = "/x"`, so the
  // whitespace after it separates nothing yet. A flag rather than a look back over the spaces, which
  // would be quadratic on a line that is mostly spaces.
  let awaitingValue = false;
  // Whitespace removal comes after the attribute lists: Haml renders `%a<(href="/x") t` with the
  // parentheses as text, so no bracket that follows `<` or `>` on the header opens anything.
  let sawWhitespaceRemoval = false;

  for (; index < linePrefix.length; index++) {
    const character = linePrefix[index] as string;
    const stillAwaitingValue = awaitingValue;
    awaitingValue = false;

    if (character === "'" || character === '"') {
      const end = findLiteralEnd(linePrefix, index);
      if (end === linePrefix.length) {
        // Unterminated: the cursor sits inside this literal, which is what makes its opening quote
        // a rewritable marker. Recorded so the tail walk can tell it from a closing quote.
        openLiteralStart = index;
        break;
      }
      // A completed literal can be a key: `'data': {` must record `data` the way a bareword does,
      // and `'data-url' =>` must leave a key behind for the separator to consume.
      const owner = stack[stack.length - 1];
      if (owner !== undefined) {
        owner.lastKey = linePrefix.slice(index + 1, end);
      }
      index = end;
      continue;
    }

    const top = stack[stack.length - 1];
    if (top === undefined && sawWhitespaceRemoval && isOpeningBracket(character)) {
      return null;
    }
    if (character === '{') {
      stack.push({ kind: 'hash', ownerKey: top?.lastKey ?? null, sawValueSeparator: false, lastKey: null });
      continue;
    }
    if (character === '[') {
      stack.push({ kind: 'reference', ownerKey: null, sawValueSeparator: false, lastKey: null });
      continue;
    }
    if (character === '(') {
      // Only a parenthesis on the tag header itself opens HTML-style attributes; anywhere deeper it
      // is a Ruby call, and nothing inside it is an attribute name.
      stack.push({ kind: stack.length === 0 ? 'html' : 'paren', ownerKey: null, sawValueSeparator: false, lastKey: null });
      continue;
    }
    if (character === '}' || character === ']' || character === ')') {
      stack.pop();
      continue;
    }
    if (top === undefined) {
      // Outside every frame, whitespace or a script marker starts the tag's body: a brace after that
      // is text, not an attribute hash.
      if (isSpaceCharacter(character) || character === '=' || character === '/') {
        return null;
      }
      if (character === '<' || character === '>') {
        sawWhitespaceRemoval = true;
      }
      continue;
    }
    if (character === ',') {
      top.sawValueSeparator = false;
      top.lastKey = null;
      continue;
    }
    // HTML-style attributes are separated by whitespace rather than commas - except between an `=`
    // and the value it is still waiting for.
    if (isSpaceCharacter(character) && top.kind === 'html') {
      if (stillAwaitingValue) {
        awaitingValue = true;
        continue;
      }
      top.sawValueSeparator = false;
      top.lastKey = null;
      continue;
    }
    if (character === ':') {
      // `::` is a constant path, not a key separator.
      if (linePrefix[index + 1] === ':') {
        index++;
        continue;
      }
      top.sawValueSeparator = true;
      continue;
    }
    if (character === '=') {
      if (top.kind === 'html') {
        top.sawValueSeparator = true;
        awaitingValue = true;
        continue;
      }
      // `=>` is the hashrocket separator of a Ruby hash. A lone `=` in a Ruby frame belongs to a
      // value expression (`==`, `<=`) and changes nothing.
      if (linePrefix[index + 1] === '>') {
        top.sawValueSeparator = true;
        index++;
      }
      continue;
    }
    if (isNameCharacter(character)) {
      let end = index;
      while (end < linePrefix.length && isNameCharacter(linePrefix[end])) {
        end++;
      }
      top.lastKey = linePrefix.slice(index, end);
      index = end - 1;
    }
  }
  return { frame: stack[stack.length - 1] ?? null, depth: stack.length, openLiteralStart };
}

function syntaxOf(frame: Frame, depth: number): AttributeSyntax | null {
  if (frame.kind === 'html') {
    return 'htmlAttributes';
  }
  if (frame.kind !== 'hash') {
    return null;
  }
  if (depth === 1) {
    return 'rubyHash';
  }
  // A nested hash is only ours when it is the `data:` one directly inside the attribute frame;
  // `locals: {`, deeper nesting and `foo: { data: {` - which Haml renders as foo-data-* - are not.
  return depth === 2 && frame.ownerKey === DATA_KEY ? 'rubyDataHash' : null;
}

/**
 * Whether the quote at the start of `lineSuffix` closes a key that already has its value: `': 'x'`,
 * `' => 1`. A lone `::` is a constant path, not a separator.
 */
function closesKeyWithValue(lineSuffix: string): boolean {
  const next = skipSpaces(lineSuffix, 1);
  if (lineSuffix.startsWith('=>', next)) {
    return true;
  }
  return lineSuffix[next] === ':' && lineSuffix[next + 1] !== ':';
}

/** Null wherever an attribute name cannot go. `lineSuffix` is the rest of the line after the cursor. */
export function classifyAttributePosition(linePrefix: string, lineSuffix: string): AttributePosition | null {
  const scanned = scan(linePrefix);
  if (scanned === null || scanned.frame === null || scanned.frame.sawValueSeparator) {
    return null;
  }
  const syntax = syntaxOf(scanned.frame, scanned.depth);
  if (syntax === null) {
    return null;
  }

  let start = linePrefix.length;
  while (start > 0 && isNameCharacter(linePrefix[start - 1])) {
    start--;
  }
  if (MARKERS.has(linePrefix[start - 1] as string)) {
    // Only the opening quote of the literal the cursor is inside is a rewritable marker. A closing
    // quote looks identical to this walk, but rewriting it would destroy a completed key - and the
    // position after `%div{ 'data-turbo'` is not a name position at all.
    if (scanned.openLiteralStart !== start - 1) {
      return null;
    }
    const marker = linePrefix.slice(start - 1, start);
    const closesHere = lineSuffix.startsWith(marker);
    // A key that already has its value is being edited, not written: every item would put a second
    // separator and a second value in front of the first. Offering nothing beats that.
    if (closesHere && closesKeyWithValue(lineSuffix)) {
      return null;
    }
    return {
      syntax,
      identifierLength: linePrefix.length - start,
      markerLength: 1,
      marker,
      trailingLength: closesHere ? 1 : 0
    };
  }
  return {
    syntax,
    identifierLength: linePrefix.length - start,
    markerLength: 0,
    marker: '',
    trailingLength: 0
  };
}
