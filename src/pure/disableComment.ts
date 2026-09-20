// Builds `-# haml-lint:disable` / `enable` insertions. Pure; no vscode imports.
//
// `-#` is a Haml *silent* comment, and every line indented deeper than it is swallowed as part of
// the comment and never rendered. Putting the `enable` marker directly after the offending line
// therefore deletes that line's children from the output:
//
//   -# haml-lint:disable AltText
//   %div{ class: 'x' }            <- offending line, indent 2
//   -# haml-lint:enable AltText   <- placed here...
//     %img{ src: 'a.gif' }        <- ...and indent 4 > 2 swallows this, so it disappears
//
// The marker therefore goes after the whole block, never after the single line.

import { findConstructEnd, findConstructStart } from './blockStructure';
import { isBlankText } from './characters';
import { DIAGNOSTIC_SOURCE } from './diagnosticMapper';
import type { DocumentSnapshot, Eol } from './textModel';

export interface InsertionSpec {
  readonly line: number;
  readonly character: number;
  readonly text: string;
}

/**
 * The indentation both comments are written at.
 *
 * A blank target - the shape TrailingWhitespace and EmptyLines report - has no indent of its own,
 * and writing the pair at column 0 there is not neutral: the `enable` marker is a silent comment,
 * and anything after it indented deeper is swallowed out of the rendered output. The following
 * non-blank line's indent is the one level that can never swallow it; a trailing blank falls back
 * to the preceding line, after which nothing follows that could be swallowed at any indent - or
 * rather to the first line of whatever that line is a part of. The last line of a filter body is
 * indented like the body, and a comment written at that indent is emitted into the page with it.
 */
function insertionIndent(lineIndex: number, document: DocumentSnapshot): string {
  const target = document.lineAt(lineIndex);
  if (!isBlankText(target.text)) {
    return target.text.slice(0, target.firstNonWhitespaceCharacterIndex);
  }
  for (let index = lineIndex + 1; index < document.lineCount; index++) {
    const line = document.lineAt(index);
    if (!isBlankText(line.text)) {
      return line.text.slice(0, line.firstNonWhitespaceCharacterIndex);
    }
  }
  for (let index = lineIndex - 1; index >= 0; index--) {
    if (!isBlankText(document.lineAt(index).text)) {
      const owner = document.lineAt(findConstructStart(index, document));
      return owner.text.slice(0, owner.firstNonWhitespaceCharacterIndex);
    }
  }
  return '';
}

/** Returns the two insertions that wrap a block in a haml-lint disable/enable pair. */
export function buildDisableComment(lineIndex: number, linterName: string, document: DocumentSnapshot, eol: Eol): [InsertionSpec, InsertionSpec] {
  // The pair goes around whatever the offending line is a part of, never into it: an `- else` is
  // wrapped from its `- if`, a line of a filter body from the filter's header, and a later line of an
  // attribute list from the tag. src/pure/blockStructure.ts has what each of those breaks otherwise.
  const startLine = findConstructStart(lineIndex, document);
  const indent = insertionIndent(startLine, document);
  const blockEnd = findConstructEnd(startLine, document);

  const disable: InsertionSpec = {
    line: startLine,
    character: 0,
    text: `${indent}-# haml-lint:disable ${linterName}${eol}`
  };

  if (blockEnd + 1 < document.lineCount) {
    return [disable, { line: blockEnd + 1, character: 0, text: `${indent}-# haml-lint:enable ${linterName}${eol}` }];
  }

  // Appending past the last line: the separator has to come first.
  const lastLine = document.lineAt(blockEnd);
  return [disable, { line: blockEnd, character: lastLine.text.length, text: `${eol}${indent}-# haml-lint:enable ${linterName}` }];
}

/**
 * haml-lint has no per-cop inline disable, so silencing the RuboCop linter silences all Ruby
 * linting. Saying "Style/StringLiterals" while doing that would be dishonest.
 */
export function disableActionTitle(linterName: string): string {
  return linterName === 'RuboCop' ? 'Disable RuboCop (all cops) for this block' : `Disable ${linterName} for this block`;
}

/** The parts of a vscode.Diagnostic this decision reads, so the decision itself needs no vscode. */
export interface DiagnosticFacts {
  readonly source: string | undefined;
  /** `string | number | { value, target }` in the API. Narrowed here, not at the call site. */
  readonly code: unknown;
  readonly line: number;
}

export interface DisableActionPlan {
  /** Index into the input, so the caller can attach the diagnostic the action answers. */
  readonly index: number;
  readonly line: number;
  readonly linterName: string;
}

/** Syntax and parse errors carry no linter, so nothing can be disabled for them. */
export function linterNameOf(code: unknown): string | undefined {
  if (typeof code === 'string') {
    return code;
  }
  if (typeof code === 'object' && code !== null && 'value' in code) {
    return String((code as { value: unknown }).value);
  }
  return undefined;
}

/**
 * Which disable actions to offer, in input order.
 *
 * One per (line, linter): haml-lint reports no column, so two offenses of the same linter on one
 * line would otherwise offer two identical comments. Diagnostics from other extensions are skipped -
 * offering to write a haml-lint directive for someone else's finding would do nothing.
 */
export function planDisableActions(diagnostics: readonly DiagnosticFacts[]): readonly DisableActionPlan[] {
  const plans: DisableActionPlan[] = [];
  const seen = new Set<string>();

  for (const [index, diagnostic] of diagnostics.entries()) {
    if (diagnostic.source !== DIAGNOSTIC_SOURCE) {
      continue;
    }
    const linterName = linterNameOf(diagnostic.code);
    if (linterName === undefined) {
      continue;
    }
    // NUL-joined for the same reason the client's coalescing key is: it cannot appear in either part.
    const key = `${diagnostic.line}\u0000${linterName}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    plans.push({ index, line: diagnostic.line, linterName });
  }
  return plans;
}
