// Selection normalization and indentation arithmetic, shared by the selection refactorings.
//
// The block rule mirrors disableComment's findBlockEnd - a Haml block is its own line plus every
// line indented deeper - but anchored to the selection's shallowest indent rather than to one line.

import { isBlankText, skipSpaces } from './characters';
import type { DocumentSnapshot } from './textModel';

const MIN_TAB_SIZE = 1;
const MAX_TAB_SIZE = 8;
const DEFAULT_TAB_SIZE = 2;

export interface LineRange {
  readonly startLine: number;
  /** Inclusive. */
  readonly endLine: number;
}

/** Shaped like a vscode.Selection so the glue translation is a straight copy of its four values. */
export interface SelectionInput {
  readonly startLine: number;
  /** Deliberately ignored: a wrap has to replace from column 0, so there is no partial-line case. */
  readonly startCharacter: number;
  readonly endLine: number;
  readonly endCharacter: number;
}

function sharedPrefix(left: string, right: string): string {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index++;
  }
  return left.slice(0, index);
}

/**
 * Turns a selection into the whole lines a refactoring should act on, or null when there are none.
 *
 * The extension at the end is the important part: raising a parent one level without its children
 * would leave them at the parent's own depth and silently detach them, which is the same failure
 * src/pure/disableComment.ts exists to avoid.
 *
 * It extends past the end while lines are deeper than the selection's *shallowest* indent, not just
 * past the last selected line's own block. A selection covering two same-depth siblings can end in
 * the middle of the second one, and asking findBlockEnd about any single line would leave that
 * sibling's remaining children behind. Everything up to the next line at or above the shallowest
 * indent belongs to something selected.
 */
export function normalizeSelection(selection: SelectionInput, document: DocumentSnapshot): LineRange | null {
  // Dragging over line numbers and Ctrl+L both end on column 0 of the line after the last one wanted.
  let endLine = selection.endCharacter === 0 && selection.endLine > selection.startLine ? selection.endLine - 1 : selection.endLine;
  let startLine = selection.startLine;

  while (startLine <= endLine && isBlankText(document.lineAt(startLine).text)) {
    startLine++;
  }
  while (endLine >= startLine && isBlankText(document.lineAt(endLine).text)) {
    endLine--;
  }
  if (startLine > endLine) {
    return null;
  }

  let shallowestIndent = Number.POSITIVE_INFINITY;
  for (let index = startLine; index <= endLine; index++) {
    const line = document.lineAt(index);
    if (isBlankText(line.text)) {
      continue;
    }
    if (line.firstNonWhitespaceCharacterIndex < shallowestIndent) {
      shallowestIndent = line.firstNonWhitespaceCharacterIndex;
    }
  }
  // Blank lines defer to what follows them, the way findBlockEnd reads a block: a stanza split by
  // an empty line stays intact, and trailing blanks are not dragged in.
  let blockEnd = endLine;
  for (let index = endLine + 1; index < document.lineCount; index++) {
    const line = document.lineAt(index);
    if (isBlankText(line.text)) {
      continue;
    }
    if (line.firstNonWhitespaceCharacterIndex <= shallowestIndent) {
      break;
    }
    blockEnd = index;
  }
  return { startLine, endLine: blockEnd };
}

export function linesOf(range: LineRange, document: DocumentSnapshot): string[] {
  const lines: string[] = [];
  for (let index = range.startLine; index <= range.endLine; index++) {
    lines.push(document.lineAt(index).text);
  }
  return lines;
}

/**
 * The leading whitespace every non-blank line shares, as a string rather than a width.
 *
 * Taken verbatim the way disableComment takes it, so tabs stay tabs. Mixed tabs and spaces share no
 * prefix and yield '', which makes the caller do nothing rather than something wrong - and Haml
 * rejects mixed indentation itself, so there is no correct answer to reach for.
 */
export function commonIndent(lines: readonly string[]): string {
  let common: string | null = null;
  for (const line of lines) {
    if (isBlankText(line)) {
      continue;
    }
    const indent = line.slice(0, skipSpaces(line, 0));
    common = common === null ? indent : sharedPrefix(common, indent);
  }
  return common ?? '';
}

/** Blank lines stay empty: indenting one would be trailing whitespace, which haml-lint reports. */
export function indentLines(lines: readonly string[], unit: string): string[] {
  return lines.map((line) => (isBlankText(line) ? line : unit + line));
}

export function dedentLines(lines: readonly string[]): string[] {
  const common = commonIndent(lines);
  if (common === '') {
    return [...lines];
  }
  return lines.map((line) => (isBlankText(line) ? line : line.slice(common.length)));
}

/**
 * One indentation level, derived from the editor's own options and nothing else.
 *
 * insertSnippet runs every inserted line through normalizeIndentation, which uses exactly these two
 * values, so choosing anything else here would have VS Code rewrite the result. The clamp is the same
 * defence configSchema applies: detectIndentation reports whatever it found and settings.json is
 * hand-editable.
 */
export function indentUnit(insertSpaces: boolean, tabSize: number | undefined): string {
  if (!insertSpaces) {
    return '\t';
  }
  const width =
    tabSize !== undefined && Number.isFinite(tabSize) ? Math.min(MAX_TAB_SIZE, Math.max(MIN_TAB_SIZE, Math.trunc(tabSize))) : DEFAULT_TAB_SIZE;
  return ' '.repeat(width);
}
