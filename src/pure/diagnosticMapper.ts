// Turns haml-lint offenses into plain range specs. Pure; no vscode imports.
//
// haml-lint reports a line and nothing else - no column, no end position - so every diagnostic is
// line-wide by construction.

import type { Offense, OffenseSeverity } from '../types';
import type { DocumentSnapshot, Position } from './textModel';

const LINTER_DOC_BASE_URL = 'https://github.com/sds/haml-lint/blob/main/lib/haml_lint/linter/README.md';
export const DIAGNOSTIC_SOURCE = 'haml-lint';

export interface DiagnosticSpec {
  readonly start: Position;
  readonly end: Position;
  readonly severity: OffenseSeverity;
  readonly message: string;
  /** Rendered as a link in the Problems panel and on hover. */
  readonly code?: { readonly value: string; readonly target: string };
}

/** GitHub lowercases heading anchors, and each linter has its own section. */
export function linterDocUrl(linterName: string): string {
  return `${LINTER_DOC_BASE_URL}#${linterName.toLowerCase()}`;
}

/**
 * Picks a range that is always visible.
 *
 * A blank or whitespace-only line is the interesting case: skipping the leading indentation there
 * produces start === end, and VS Code draws nothing for a zero-width range - which is exactly the
 * shape TrailingWhitespace and FinalNewline report.
 */
function rangeFor(lineIndex: number, document: DocumentSnapshot): { start: Position; end: Position } {
  const line = document.lineAt(lineIndex);
  const length = line.text.length;

  if (length === 0) {
    if (lineIndex + 1 < document.lineCount) {
      return { start: { line: lineIndex, character: 0 }, end: { line: lineIndex + 1, character: 0 } };
    }
    if (lineIndex > 0) {
      const previous = document.lineAt(lineIndex - 1);
      return { start: { line: lineIndex - 1, character: previous.text.length }, end: { line: lineIndex, character: 0 } };
    }
    return { start: { line: lineIndex, character: 0 }, end: { line: lineIndex, character: 0 } };
  }

  const indent = line.firstNonWhitespaceCharacterIndex;
  const start = indent >= length ? 0 : indent;
  return { start: { line: lineIndex, character: start }, end: { line: lineIndex, character: length } };
}

export function mapOffense(offense: Offense, document: DocumentSnapshot): DiagnosticSpec {
  // haml-lint can report line 0 for file-level errors, and an edit racing the process can leave the
  // reported line past the end of the buffer.
  const lineIndex = Math.min(Math.max(offense.line - 1, 0), Math.max(document.lineCount - 1, 0));
  const { start, end } = rangeFor(lineIndex, document);

  return {
    start,
    end,
    severity: offense.severity,
    message: offense.message,
    ...(offense.linterName === undefined ? {} : { code: { value: offense.linterName, target: linterDocUrl(offense.linterName) } })
  };
}

/**
 * Maps every offense, keeping the first of any that would be drawn identically.
 *
 * An autocorrect run's report is two passes concatenated (runner.rb: `autocorrect_document`, then
 * every linter again), and a linter that `-a` may not correct - SpaceBeforeScript, EmptyScript -
 * records its offense in both. haml-lint reports no column, so the copies would be the same squiggle
 * under the same message.
 *
 * Keyed on the range rather than on `offense.line`, because the two are not the same thing: the
 * correcting pass records pre-edit line numbers, so two of them can land past the end of the buffer
 * and clamp onto the line that is there. How many times an offense was reported goes with the
 * repeats, and nothing in the panel could have shown it. The message is part of the key even though
 * disableComment.ts leaves it out of its own - the linter is `RuboCop` for every cop, so dropping it
 * would silently merge two real findings. NUL-joined because haml-lint never writes one; a report is
 * not trusted input, but one that carried a NUL could at worst hide a diagnostic.
 */
export function mapOffenses(offenses: readonly Offense[], document: DocumentSnapshot): DiagnosticSpec[] {
  const seen = new Set<string>();
  const specs: DiagnosticSpec[] = [];

  for (const offense of offenses) {
    const spec = mapOffense(offense, document);
    const key = [spec.start.line, spec.start.character, spec.end.line, spec.end.character, spec.severity, spec.code?.value ?? '', spec.message].join(
      '\u0000'
    );
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    specs.push(spec);
  }
  return specs;
}
