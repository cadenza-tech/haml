// Finds the partial name literal that a `render` call in a Haml line is pointing at.
//
// The hard part is not the literal, it is deciding that `render` is a Ruby call at all. A Haml line
// that merely contains the word (`%p Please render 'x'`), a Ruby assignment inside a :ruby filter
// (`x = render 'y'`) and a method on a receiver (`x.render 'y'`) all have to be rejected, and that is
// exactly the question computeCompletionWord already answers - so it is reused rather than reproduced.
//
// Everything here scans linearly. provideCompletionItems runs synchronously on every keystroke and a
// Haml line can hold an inline data URI, which is the constraint src/pure/completionWord.ts documents.

import { findLiteralEnd, isClosingBracket, isOpeningBracket, isSpaceCharacter, isWordCharacter, skipSpaces } from './characters';
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
  /** Offset of the closing quote, or the line length while the literal is still unterminated. */
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

/** `quoteIndex` addresses the opening quote. An unterminated literal runs to the end of the line. */
function readLiteral(line: string, quoteIndex: number): PartialReference {
  const start = quoteIndex + 1;
  const end = findLiteralEnd(line, quoteIndex);
  return { name: line.slice(start, end), start, end };
}

/** Skips a bracketed group whole, so that the literals inside `locals: { a: 'b' }` stay invisible. */
function skipBalanced(line: string, openIndex: number): number {
  let depth = 0;
  let index = openIndex;
  while (index < line.length) {
    const character = line[index] as string;
    if (character === "'" || character === '"') {
      // findLiteralEnd rather than readLiteral: the name is thrown away here, and slicing every
      // literal inside every skipped group is what made an inline data URI measurable.
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
      const literal = readLiteral(line, index);
      const isPartialName = expectingPositional || (pendingKey !== null && PARTIAL_KEYWORDS.has(pendingKey));
      // Both ends count as inside, so re-editing an existing name resolves and completes.
      if (isPartialName && character >= literal.start && character <= literal.end) {
        return literal;
      }
      index = literal.end + 1;
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
