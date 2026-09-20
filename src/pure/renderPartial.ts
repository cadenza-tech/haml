// Finds the partial name literal that a `render` call in a Haml line is pointing at.
//
// The hard part is not the literal, it is deciding that `render` is a Ruby call at all. A Haml line
// that merely contains the word (`%p Please render 'x'`), a Ruby assignment inside a :ruby filter
// (`x = render 'y'`) and a method on a receiver (`x.render 'y'`) all have to be rejected, and that is
// exactly the question computeCompletionWord already answers - so it is reused rather than reproduced.
//
// Everything here scans linearly. provideCompletionItems runs synchronously on every keystroke and a
// Haml line can hold an inline data URI, which is the constraint src/pure/completionWord.ts documents.

import {
  findInterpolationEnd,
  findLiteralEnd,
  isClosingBracket,
  isOpeningBracket,
  isSpaceCharacter,
  isWordCharacter,
  skipSpaces
} from './characters';
import { computeCompletionWord } from './completionWord';

/**
 * How many `render` tokens left of the cursor are examined.
 *
 * A Haml line has a single script marker, so in real code the first candidate that clears the cheap
 * guards is the only one that can pass the marker test as well. The limit exists for input like
 * `'render '.repeat(20000)`, where every candidate clears the guards and computeCompletionWord would
 * slice the whole prefix each time, turning the scan quadratic.
 */
const MAX_RENDER_CANDIDATES = 8;

/**
 * How many literals of one argument list may be cut short of where findLiteralEnd put their end.
 *
 * The search for a closing quote is paid for by resuming behind it. A literal cut short - left open,
 * as in `title: 'a, x: \'b`, or closed by a quote that belongs to a later argument, as in
 * `partial: 'a, partial: \'b'` - resumes inside the text searched instead, where an escaped quote
 * opens another literal whose search covers that text again: quadratic on a line full of them. A
 * line being typed holds one or two. Past the limit the argument list is given up on.
 */
const MAX_CUT_SHORT_LITERALS = 8;

/**
 * How many `#{` a partial name is asked about before the rest of it is read as text.
 *
 * Looking for an interpolation's close costs a search as far as the literal's own end, and finds
 * nothing when it never closes. One name does not hold this many, and past it the scan would be
 * quadratic on `'#{'.repeat(n)`.
 */
const MAX_UNCLOSED_INTERPOLATIONS = 4;

const RENDER = 'render';
/**
 * Keywords whose value is a partial name. `template:` is deliberately absent: it resolves without the
 * leading underscore, so treating it as a partial would send go to definition to a file that is not
 * there. `collection:` and `object:` take models, not names. `spacer_template:` is a partial like
 * `partial:` - Rails underscores it the same way when rendering a collection's separators.
 */
const PARTIAL_KEYWORDS = new Set(['partial', 'layout', 'spacer_template']);

export interface PartialReference {
  readonly name: string;
  /** Offset of the character after the opening quote. */
  readonly start: number;
  /** Offset of the closing quote, or of where a literal that had to be cut short ends. */
  readonly end: number;
}

/** A dot counts, so that `x.render` is not mistaken for a bare `render`. */
function isIdentifierNeighbour(character: string | undefined): boolean {
  return isWordCharacter(character) || character === '.';
}

/** What may follow `render` and still leave it a call: an argument list, with or without parentheses. */
function opensArguments(character: string | undefined): boolean {
  return character === undefined || isSpaceCharacter(character) || character === '(';
}

function readIdentifier(line: string, from: number): number {
  let index = from;
  while (index < line.length && isWordCharacter(line[index])) {
    index++;
  }
  return index;
}

function endsUnterminatedName(character: string): boolean {
  return isSpaceCharacter(character) || isClosingBracket(character) || character === ',' || character === '"' || character === "'";
}

/**
 * Whether the path written between `start` and `end` holds a comma of its own.
 *
 * Only as far as `end`: past the literal the search would run to the end of the line once per
 * `partial:` value, which is quadratic on a line full of them. A comma inside an interpolation -
 * `"cards/#{kind.tr('-', '_')}"` - counts here like any other. Whose it is gets settled by
 * unterminatedEnd, which steps over the interpolation and hands a complete path back whole.
 */
function pathHoldsComma(line: string, start: number, end: number): boolean {
  for (let index = start; index < end; index++) {
    if (line[index] === ',') {
      return true;
    }
  }
  return false;
}

/**
 * Where a literal whose content begins at `start` ends when its closing quote cannot be relied on.
 *
 * A partial name ends at the first character no path holds: whitespace, a comma, a closing bracket
 * or a quote. Narrower would be wrong - a directory may be named `my-dir` even though a partial may
 * not. An interpolation that closes before `closed` is part of the name, brace and commas and all,
 * which is what hands `"cards/#{kind.tr('-', '_')}"` back whole and still ends
 * `"cards/#{kind}/sha, title: "` at its comma. In single quotes `#{` interpolates nothing, but it is
 * written there by mistake often enough, in a literal that is just as complete. One that nothing
 * closes is text, and the first few end the looking: each costs a search as far as `closed`, and a
 * name made of them would be searched once per `#{`.
 *
 * Any other value ends at its first comma and nowhere before it. A title holds spaces and brackets,
 * and cutting there hands the scan back among its words, where `layout:` reads as a keyword and the
 * quote after it as the start of a name. Nothing replaces a value, so all that matters is that the
 * scan resumes before the next argument.
 */
function unterminatedEnd(line: string, start: number, closed: number, isPartialName: boolean): number {
  if (!isPartialName) {
    const comma = line.indexOf(',', start);
    return comma === -1 ? line.length : comma;
  }
  let unclosed = 0;
  let end = start;
  while (end < line.length && !endsUnterminatedName(line[end] as string)) {
    if (unclosed < MAX_UNCLOSED_INTERPOLATIONS && line[end] === '#' && line[end + 1] === '{') {
      const after = findInterpolationEnd(line, end + 1, closed);
      if (after !== -1) {
        end = after;
        continue;
      }
      unclosed++;
    }
    end++;
  }
  return end;
}

/**
 * Where the literal opened at `quoteIndex` ends. `closed` is what findLiteralEnd made of it: its
 * closing quote, or the end of the line when it has none.
 *
 * With none it is cut short whatever it holds. A value left open has the rest of the call behind it
 * just as a name has, and giving up on the line there loses a partial name that is complete. A
 * closing quote proves little for a partial name: in `'sha, title: 'x'` it is the one that opens the
 * next argument. No partial path holds a comma outside an interpolation, so a name that does is cut
 * short as well. Any other value is taken whole - `title: 'a, b'` holds a comma of its own.
 */
function literalEnd(line: string, quoteIndex: number, closed: number, isPartialName: boolean): number {
  const start = quoteIndex + 1;
  const cutShort = closed >= line.length || (isPartialName && pathHoldsComma(line, start, closed));
  return cutShort ? unterminatedEnd(line, start, closed, isPartialName) : closed;
}

/** Skips a bracketed group whole, so that the literals inside `locals: { a: 'b' }` stay invisible. */
function skipBalanced(line: string, openIndex: number): number {
  let depth = 0;
  let index = openIndex;
  while (index < line.length) {
    const character = line[index] as string;
    if (character === "'" || character === '"') {
      // The index alone, never the text: nothing here is a name, and slicing every literal inside
      // every skipped group is what made an inline data URI measurable.
      index = findLiteralEnd(line, index) + 1;
      continue;
    }
    if (isOpeningBracket(character)) {
      depth++;
      index++;
      continue;
    }
    if (isClosingBracket(character)) {
      depth--;
      index++;
      if (depth === 0) {
        return index;
      }
      continue;
    }
    index++;
  }
  return line.length;
}

/**
 * Walks the argument list starting at `from` and returns the partial name literal covering `character`.
 *
 * Only the first positional argument and the value of `partial:` / `layout:` are partial names, which
 * is what keeps `render 'x', locals: { a: 'b' }` from offering view names for `'b'`.
 */
function referenceCovering(line: string, from: number, character: number): PartialReference | null {
  let index = skipSpaces(line, from);
  let expectingPositional = true;
  let pendingKey: string | null = null;
  let parenthesised = false;
  let cutShort = 0;

  if (line[index] === '(') {
    parenthesised = true;
    index++;
  }

  while (index < line.length) {
    const current = line[index] as string;
    if (isSpaceCharacter(current)) {
      index++;
      continue;
    }
    if (current === "'" || current === '"') {
      const isPartialName = expectingPositional || (pendingKey !== null && PARTIAL_KEYWORDS.has(pendingKey));
      const closed = findLiteralEnd(line, index);
      const end = literalEnd(line, index, closed, isPartialName);
      if (end !== closed) {
        cutShort++;
        if (cutShort > MAX_CUT_SHORT_LITERALS) {
          return null;
        }
      }
      const start = index + 1;
      // Both ends count as inside, so re-editing an existing name resolves and completes.
      if (isPartialName && character >= start && character <= end) {
        return { name: line.slice(start, end), start, end };
      }
      index = end + 1;
      expectingPositional = false;
      pendingKey = null;
      continue;
    }
    if (isOpeningBracket(current)) {
      index = skipBalanced(line, index);
      expectingPositional = false;
      pendingKey = null;
      continue;
    }
    if (parenthesised && current === ')') {
      return null;
    }
    if (current === ',') {
      index++;
      expectingPositional = false;
      pendingKey = null;
      continue;
    }
    const identifierEnd = readIdentifier(line, index);
    if (identifierEnd > index) {
      const identifier = line.slice(index, identifierEnd);
      const afterIdentifier = skipSpaces(line, identifierEnd);
      // `a ? b : c` would otherwise read as a keyword argument, but `::` is a constant path.
      if (line[afterIdentifier] === ':' && line[afterIdentifier + 1] !== ':') {
        pendingKey = identifier;
        expectingPositional = false;
        index = afterIdentifier + 1;
        continue;
      }
      // A block opener ends the argument list; anything after it belongs to the block.
      if (identifier === 'do') {
        return null;
      }
      index = identifierEnd;
      expectingPositional = false;
      pendingKey = null;
      continue;
    }
    index++;
  }
  return null;
}

/** Returns the partial name literal the cursor sits in, or null wherever there is not one. */
export function partialReferenceAt(line: string, character: number): PartialReference | null {
  let searchFrom = Math.min(character, line.length);
  for (let examined = 0; examined < MAX_RENDER_CANDIDATES; examined++) {
    if (searchFrom < 0) {
      return null;
    }
    const tokenStart = line.lastIndexOf(RENDER, searchFrom);
    if (tokenStart === -1) {
      return null;
    }
    searchFrom = tokenStart - 1;
    const tokenEnd = tokenStart + RENDER.length;
    if (isIdentifierNeighbour(line[tokenStart - 1]) || !opensArguments(line[tokenEnd])) {
      continue;
    }
    const word = computeCompletionWord(line.slice(0, tokenEnd));
    // No marker means plain text or a filter body, where `render 'x'` is rendered literally.
    if (word === null || word.markerLength === 0) {
      continue;
    }
    const reference = referenceCovering(line, tokenEnd, character);
    if (reference !== null) {
      return reference;
    }
  }
  return null;
}
