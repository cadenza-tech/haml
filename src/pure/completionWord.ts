// Works out what a Rails snippet completion should replace, and whether it belongs there at all.
//
// Three things go wrong without this.
//
// 1. VS Code's default word boundary excludes '.', so at `f.te` the current word is `te`. The 37
//    dotted prefixes still surface through fuzzy matching, but the replace range covers only `te`,
//    so accepting one yields `f.f.text_field`.
//
// 2. Nearly every body starts with `= ` or `- `. Accepting `link_to` at `= link` would otherwise
//    produce `= = link_to(...)`. The script marker has to be inside the replaced range.
//
// 3. Not every body fits every position. A tag can carry a one-line output helper (`%p= link_to`)
//    but not a silent-script one and not a block, and a body with no marker of its own only makes
//    sense after a marker the user typed.
//
// Everything here scans linearly. An earlier version used /[A-Za-z_][A-Za-z0-9_]*...$/ with no left
// anchor, which is quadratic: a 30,000 character line - an inline data URI is enough - took two
// seconds, and provideCompletionItems runs synchronously on every keystroke.

import {
  findLiteralEnd,
  isBlankText,
  isClosingBracket,
  isIdentifierStart,
  isOpeningBracket,
  isSpaceCharacter,
  isWordCharacter,
  skipSpaces
} from './characters';

const MARKER_MODIFIERS = new Set(['!', '&', '<', '>']);
/** What a Haml line may begin with before its script marker. */
const TAG_HEADER_STARTS = new Set(['%', '.', '#', '{', '(', '[']);

export interface CompletionWord {
  /** Characters before the cursor that make up the identifier being typed. */
  readonly identifierLength: number;
  /** Characters before the identifier that make up the Haml script marker, if any. */
  readonly markerLength: number;
  /** The marker text itself, e.g. '= '. Empty when there is none. */
  readonly marker: string;
  /** True when nothing but whitespace precedes the marker, so any body may replace it. */
  readonly markerAtLineStart: boolean;
}

/** Length of the identifier ending at the cursor, including one dot and a trailing '?'. */
function identifierLength(linePrefix: string): number {
  let end = linePrefix.length;
  if (linePrefix[end - 1] === '?') {
    end--;
  }
  let start = end;
  let dotSeen = false;
  while (start > 0) {
    const character = linePrefix[start - 1];
    if (isWordCharacter(character)) {
      start--;
    } else if (character === '.' && !dotSeen) {
      dotSeen = true;
      start--;
    } else {
      break;
    }
  }
  // An identifier cannot open with a digit or with the dot just walked over.
  while (start < end && !isIdentifierStart(linePrefix[start])) {
    start++;
  }
  return start === end ? 0 : linePrefix.length - start;
}

/**
 * True when `text` is a Haml line opening - a tag, class, id or attribute group - and nothing else.
 *
 * This is what keeps helpers out of positions that merely happen to end in '='. Plain text
 * (`%p Price = tot`), a Ruby assignment inside a filter (`x = tot`), a comment (`-# see = x`) and an
 * unbalanced HTML-style attribute (`%a(href=x`) are all rejected; `%p{ href: "a=b" }=` is not.
 */
function isTagHeader(text: string): boolean {
  let index = skipSpaces(text, 0);
  if (index === text.length) {
    return true;
  }
  if (!TAG_HEADER_STARTS.has(text[index] as string)) {
    return false;
  }
  let depth = 0;
  for (; index < text.length; index++) {
    const character = text[index] as string;
    if (character === "'" || character === '"') {
      // A quoted value is opaque: `%span{ title: ":)" }` holds a bracket and `%p{ a: "b c" }` holds
      // a space, and counting either would reject a perfectly balanced header.
      const end = findLiteralEnd(text, index);
      if (end === text.length) {
        // Unterminated: whatever follows - including the '=' that made classifyHead ask - is still
        // string content, not a header.
        return false;
      }
      index = end;
    } else if (isOpeningBracket(character)) {
      depth++;
    } else if (isClosingBracket(character)) {
      depth--;
      if (depth < 0) {
        return false;
      }
    } else if (depth === 0 && isSpaceCharacter(character)) {
      return false;
    }
  }
  return depth === 0;
}

function classifyHead(head: string): Pick<CompletionWord, 'marker' | 'markerLength' | 'markerAtLineStart'> | null {
  let end = head.length;
  while (end > 0 && isSpaceCharacter(head[end - 1])) {
    end--;
  }
  if (end === 0) {
    return { marker: '', markerLength: 0, markerAtLineStart: true };
  }

  // A silent script marker is only ever the first thing on a line.
  if (head[end - 1] === '-') {
    return isBlankText(head.slice(0, end - 1)) ? marker(head, end - 1, true) : null;
  }
  if (head[end - 1] !== '=') {
    return null;
  }

  let runStart = end;
  while (runStart > 0 && head[runStart - 1] === '=') {
    runStart--;
  }
  let headerEnd = runStart;
  while (headerEnd > 0 && MARKER_MODIFIERS.has(head[headerEnd - 1] as string)) {
    headerEnd--;
  }
  if (!isTagHeader(head.slice(0, headerEnd))) {
    return null;
  }
  // Only the last '=' is taken, so '!', '&' and any preceding '=' keep the meaning the user typed.
  return marker(head, end - 1, isBlankText(head.slice(0, end - 1)));
}

function marker(head: string, from: number, atLineStart: boolean): Pick<CompletionWord, 'marker' | 'markerLength' | 'markerAtLineStart'> {
  const text = head.slice(from);
  return { marker: text, markerLength: text.length, markerAtLineStart: atLineStart };
}

/** Returns null wherever a Rails helper cannot go. */
export function computeCompletionWord(linePrefix: string): CompletionWord | null {
  const length = identifierLength(linePrefix);
  if (length === 0) {
    return null;
  }
  const head = classifyHead(linePrefix.slice(0, linePrefix.length - length));
  return head === null ? null : { identifierLength: length, ...head };
}

/**
 * How many characters this particular body should replace, or null when it does not belong here.
 *
 * The eight upstream helpers that carry no marker of their own (image_alt, strip_tags, ...) go
 * inside an existing expression, so they need the marker the user typed to stay put.
 */
export function computeReplaceLength(word: CompletionWord, body: string): number | null {
  const carriesMarker = body.startsWith('= ') || body.startsWith('- ');
  if (word.markerLength === 0) {
    // Nothing but the identifier: only a body that supplies its own marker yields a valid line.
    return carriesMarker ? word.identifierLength : null;
  }
  // A tag already opened the line, so `%p- cache` (a tag literally named `p-`) and the illegal
  // nesting of `%p= form_with ... do` are both out.
  if (!word.markerAtLineStart && (!body.startsWith('= ') || body.includes('\n'))) {
    return null;
  }
  return word.identifierLength + (carriesMarker ? word.markerLength : 0);
}

/**
 * The word VS Code should filter the item by.
 *
 * The filter word runs from the replaced range's start to the cursor, so when the range reaches back
 * over the Haml script marker the prefix alone would never match what the user has typed.
 */
export function filterTextFor(word: CompletionWord, replaceLength: number, prefix: string): string {
  return (replaceLength > word.identifierLength ? word.marker : '') + prefix;
}
