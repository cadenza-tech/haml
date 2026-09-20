// Where a Haml block starts and ends, for the edits that must not cut one in half. Pure; no vscode
// imports.
//
// A block is a line plus every line indented deeper - except that Ruby's mid-block keywords sit at
// the opener's own indent and still belong to it:
//
//   - if a
//     %p x
//   - else          <- indent 0, same as `- if`, and not a sibling
//     %p y
//
// Reading the block as ending before `- else` is what put a `-# haml-lint:enable` comment between an
// `if` body and its `else`, which Haml rejects ("Got else with no preceding if"), and what let
// Split to Partial leave the `- else` behind. Checked against haml 6.4: a silent comment is also a
// syntax error between `- begin` and `- rescue` and between `- case` and its first `- when`, and
// between two `- when`s it renders nothing at all without saying why. Around the whole construct it
// is harmless, so both ends move outwards to the construct.

import { findLiteralEnd, isBlankText } from './characters';
import type { DocumentSnapshot } from './textModel';

/**
 * `- in` is left out although Ruby has it: Haml itself does not compile `case`/`in`. The lookahead
 * keeps `- else_branch = 1` and `- when_ready` ordinary script lines.
 */
const CONTINUATION = /^[ \t]*-[ \t]*(else|elsif|when|rescue|ensure)(?![\w?!])/;
/** Haml's own START_BLOCK_KEYWORD_REGEX takes an assignment in front of the keyword: `- y = case x`. */
const CASE_OPENER = /^[ \t]*[-=][ \t]*(?:[@$]?\w+(?:[ \t]*,[ \t]*[@$]?\w+)*[ \t]*=[ \t]*)?case(?![\w?!])/;

function continuationKeyword(text: string): string | null {
  return CONTINUATION.exec(text)?.[1] ?? null;
}

/**
 * The last line of the block that reaches `lastLine` at `indent`: every following line indented
 * deeper, and every mid-block keyword at exactly that indent with what it holds.
 *
 * Blank lines never end a block on their own - they are only excluded when nothing of the block
 * follows - so a stanza split by an empty line stays intact. An infinite `indent`, which is what a
 * blank target has, extends over nothing.
 */
export function extendBlock(lastLine: number, indent: number, document: DocumentSnapshot): number {
  let blockEnd = lastLine;
  for (let index = lastLine + 1; index < document.lineCount; index++) {
    const line = document.lineAt(index);
    if (isBlankText(line.text)) {
      continue;
    }
    const lineIndent = line.firstNonWhitespaceCharacterIndex;
    if (lineIndent < indent || (lineIndent === indent && continuationKeyword(line.text) === null)) {
      break;
    }
    blockEnd = index;
  }
  return blockEnd;
}

/**
 * The line that opens the construct `lineIndex` continues, or `lineIndex` itself when it continues
 * none.
 *
 * The opener is normally the nearest line above at the same indent that is not itself a mid-block
 * keyword. A `case` is the exception: Haml takes `- when` one level under `- case` as well as beside
 * it, and once it has, the `- else` of that case sits at the nested level too - so for those two a
 * shallower `case` is the opener. Any other shallower line means the document is not what it looks
 * like, and nothing is moved.
 */
export function findBlockStart(lineIndex: number, document: DocumentSnapshot): number {
  const target = document.lineAt(lineIndex);
  const keyword = continuationKeyword(target.text);
  if (keyword === null) {
    return lineIndex;
  }
  const indent = target.firstNonWhitespaceCharacterIndex;
  for (let index = lineIndex - 1; index >= 0; index--) {
    const line = document.lineAt(index);
    if (isBlankText(line.text) || line.firstNonWhitespaceCharacterIndex > indent) {
      continue;
    }
    if (line.firstNonWhitespaceCharacterIndex < indent) {
      return (keyword === 'when' || keyword === 'else') && CASE_OPENER.test(line.text) ? index : lineIndex;
    }
    if (continuationKeyword(line.text) === null) {
      return index;
    }
  }
  return lineIndex;
}

// The second way a line belongs to something larger: it is not a line of Haml of its own. haml-lint
// reports lines inside a filter body and on the later lines of a construct that spans several, and a
// `-#` written there is not a comment - inside `:javascript` it is emitted into the page, and between
// the lines of an attribute list or of a continued script it is a syntax error. Around the whole
// construct it is valid and still silences the offense (checked with haml-lint 0.76.0).
//
// The disable quick fix uses what follows, and the snippet provider its cheap reading,
// hasConsumingAncestor. The selection refactorings keep to indentation and the mid-block keywords,
// and README lists filters and multi-line Ruby as their known limitation.

const FILTER_HEADER = /^[ \t]*:[A-Za-z][\w-]*[ \t]*$/;
/** `-#` is a comment and `==` interpolated text; neither is continued by a comma. */
const SCRIPT_START = /^[ \t]*(?:-(?!#)|=(?!=)|~|[!&]=(?!=))/;
/** The same markers where a tag's own content starts, which `-` cannot: `%p- x` is text. */
const SCRIPT_AFTER_TAG = /^(?:=(?!=)|~|[!&]=(?!=))/;
/** Haml's parser takes `[-:\w.#@]*` after the tag name, which is what lets `.md:flex` be a class. */
const TAG_HEAD = /^[ \t]*(?:%[-:\w]+|[.#][-:\w@]+)(?:[.#][-:\w@]+)*/;
const TRAILING_COMMA = /,[ \t]*$/;
/** Haml's own test (Parser#is_multiline?): whitespace, a pipe, and not the end of `do |a, b |`. */
const TRAILING_PIPE = /\s\|[ \t]*$/;
const BLOCK_PARAMETERS = /do\s*\|\s*[^|]*\s+\|[ \t]*$/;
/**
 * How far a construct is followed, in either direction. Nothing written by hand is this long, and the
 * bound is what keeps one misread quote - `%q(')`, `?'` - from stretching a construct to the end of the
 * file and wrapping everything below it.
 */
const MAX_CONSTRUCT_LINES = 50;

const CLOSERS: Readonly<Record<string, string>> = { '{': '}', '(': ')', '[': ']' };

function isPipeLine(text: string): boolean {
  return TRAILING_PIPE.test(text) && !BLOCK_PARAMETERS.test(text);
}

/**
 * Steps over the attribute lists that start at `index`, across lines if they do not close on this one.
 * Returns where the scan stopped, or null when a list did not close within reach.
 */
function skipAttributeLists(startLine: number, startIndex: number, document: DocumentSnapshot): { line: number; index: number } | null {
  let line = startLine;
  let index = startIndex;
  let text = document.lineAt(line).text;
  const closers: string[] = [];
  while (closers.length > 0 || CLOSERS[text[index] as string] !== undefined) {
    if (index >= text.length) {
      // An open list is what continues the tag, comma or not: `%div(a='1'` runs on without one.
      if (line + 1 >= document.lineCount || line - startLine >= MAX_CONSTRUCT_LINES) {
        return null;
      }
      line++;
      text = document.lineAt(line).text;
      index = 0;
      continue;
    }
    const character = text[index] as string;
    if (character === "'" || character === '"') {
      index = findLiteralEnd(text, index);
    } else if (CLOSERS[character] !== undefined) {
      closers.push(CLOSERS[character] as string);
    } else if (character === closers[closers.length - 1]) {
      closers.pop();
    }
    index++;
  }
  return { line, index };
}

/**
 * The last line of the construct that starts on `lineIndex`, which is `lineIndex` itself for anything
 * written on one line.
 *
 * A comma continues a script and nothing else: `%p Hello,` is text, and the line below it a sibling.
 * So a tag is only followed past its attribute lists when what comes next is a script marker.
 */
function constructExtent(lineIndex: number, document: DocumentSnapshot): number {
  // Haml reads on past a blank line inside all of these - `= [1,` / `` / `  2].sum` renders 3 - so a
  // run is followed from one line that has something on it to the next.
  const nextWithText = (from: number): number | null => {
    for (let index = from + 1; index < document.lineCount && index - lineIndex <= MAX_CONSTRUCT_LINES; index++) {
      if (!isBlankText(document.lineAt(index).text)) {
        return index;
      }
    }
    return null;
  };

  const text = document.lineAt(lineIndex).text;
  if (isPipeLine(text)) {
    let last = lineIndex;
    for (let next = nextWithText(last); next !== null && isPipeLine(document.lineAt(next).text); next = nextWithText(last)) {
      last = next;
    }
    return last;
  }

  let last = lineIndex;
  if (!SCRIPT_START.test(text)) {
    const head = TAG_HEAD.exec(text);
    if (head === null) {
      return lineIndex;
    }
    const after = skipAttributeLists(lineIndex, head[0].length, document);
    if (after === null) {
      return lineIndex;
    }
    last = after.line;
    let rest = document.lineAt(last).text.slice(after.index);
    while (rest.startsWith('<') || rest.startsWith('>')) {
      rest = rest.slice(1);
    }
    if (!SCRIPT_AFTER_TAG.test(rest)) {
      return last;
    }
  }
  for (let next = nextWithText(last); next !== null && TRAILING_COMMA.test(document.lineAt(last).text); next = nextWithText(last)) {
    last = next;
  }
  return last;
}

function filterHeaderAbove(lineIndex: number, document: DocumentSnapshot): number | null {
  let indent = document.lineAt(lineIndex).firstNonWhitespaceCharacterIndex;
  let header: number | null = null;
  for (let index = lineIndex - 1; index >= 0 && indent > 0; index--) {
    const line = document.lineAt(index);
    if (isBlankText(line.text) || line.firstNonWhitespaceCharacterIndex >= indent) {
      continue;
    }
    indent = line.firstNonWhitespaceCharacterIndex;
    // The outermost one wins: a `:symbol` alone on a line of a `:ruby` body looks like a header too,
    // and the real header is an ancestor of both.
    if (FILTER_HEADER.test(line.text)) {
      header = index;
    }
  }
  return header;
}

/** `-#` takes every deeper line as more of the comment, with or without text of its own. */
const SILENT_COMMENT = /^[ \t]*-#/;

/**
 * Whether the tag on `lineIndex` opens an attribute list that nothing closes within reach - which is
 * what every list looks like while it is being typed. constructExtent reads such a line as ending
 * where it stands, the safe answer for a comment about to be written; for a suggestion it is not.
 */
function leavesListOpen(lineIndex: number, document: DocumentSnapshot): boolean {
  const text = document.lineAt(lineIndex).text;
  const head = SCRIPT_START.test(text) ? null : TAG_HEAD.exec(text);
  return head !== null && skipAttributeLists(lineIndex, head[0].length, document) === null;
}

/**
 * Whether some line above `lineIndex` takes it for itself, judged from indentation alone: the body of
 * a filter or of a `-#` comment, or a later line of something a shallower line opens.
 *
 * The cheap reading, for a caller that runs on a keystroke and for whom a wrong answer costs a
 * suggestion: it climbs only the lines indented shallower, so a construct whose later lines sit at
 * the asked line's own indent or shallower escapes it. findConstructStart is the one to ask when the
 * answer decides what is written into the document.
 *
 * Each of those lines is read as the construct it opens, not on its own: the head of a Rails form -
 * `= form_with model: @user,` - is unfinished when read alone, but only the lines that finish it are
 * its own, and what follows them is an ordinary block. `/` is not on the list at all: Haml parses
 * what is nested under an HTML comment, and a `- if` there runs (rendered with haml 6.4 to check).
 */
export function hasConsumingAncestor(lineIndex: number, document: DocumentSnapshot): boolean {
  let indent = document.lineAt(lineIndex).firstNonWhitespaceCharacterIndex;
  for (let index = lineIndex - 1; index >= 0 && indent > 0; index--) {
    const line = document.lineAt(index);
    if (isBlankText(line.text) || line.firstNonWhitespaceCharacterIndex >= indent) {
      continue;
    }
    if (FILTER_HEADER.test(line.text) || SILENT_COMMENT.test(line.text) || constructExtent(index, document) >= lineIndex) {
      return true;
    }
    if (lineIndex - index <= MAX_CONSTRUCT_LINES && leavesListOpen(index, document)) {
      return true;
    }
    indent = line.firstNonWhitespaceCharacterIndex;
  }
  return false;
}

/**
 * The first line of whatever `lineIndex` is a part of: the header of the filter it is in the body of,
 * the opener of the multi-line construct it continues, and from there the opener of the conditional
 * it is a branch of.
 */
export function findConstructStart(lineIndex: number, document: DocumentSnapshot): number {
  if (isBlankText(document.lineAt(lineIndex).text)) {
    // A blank line has no indent to find ancestors by, and continues nothing - but inside a filter it
    // is body like the lines around it. The line below it says which, as it does for the indent.
    let below = lineIndex + 1;
    while (below < document.lineCount && isBlankText(document.lineAt(below).text)) {
      below++;
    }
    const header = below < document.lineCount ? filterHeaderAbove(below, document) : null;
    return header !== null && header < lineIndex ? header : lineIndex;
  }
  const header = filterHeaderAbove(lineIndex, document);
  if (header !== null) {
    return header;
  }
  // The topmost line that reaches the target, not the nearest: every line of a pipe block is a pipe
  // line in its own right, and a continuation line such as `  -1,` reads as a script of its own, so
  // the nearest hit can be the middle of the construct. Haml parses forwards, and so from the top.
  //
  // Nothing on the way up ends the search early. A line that stops short of the target proves nothing
  // about the lines above it when it is a continuation line itself - RuboCop aligns a nested hash
  // under its first key, so the line above the target is often the shallower one - and an attribute
  // list may hold a blank line. The window is what bounds this.
  let opener = lineIndex;
  for (let index = lineIndex - 1; index >= 0 && index >= lineIndex - MAX_CONSTRUCT_LINES; index--) {
    if (!isBlankText(document.lineAt(index).text) && constructExtent(index, document) >= lineIndex) {
      opener = index;
    }
  }
  return findBlockStart(opener, document);
}

/** The last line of the block that `startLine` - a line findConstructStart returned - opens. */
export function findConstructEnd(startLine: number, document: DocumentSnapshot): number {
  const start = document.lineAt(startLine);
  const indent = isBlankText(start.text) ? Number.POSITIVE_INFINITY : start.firstNonWhitespaceCharacterIndex;
  // From the end of the construct rather than from its first line: continuation lines are usually
  // indented under their opener, but nothing makes them, and an enable comment in front of one that
  // is not would split the construct just the same.
  return extendBlock(isBlankText(start.text) ? startLine : constructExtent(startLine, document), indent, document);
}
