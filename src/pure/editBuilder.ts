// Turns haml-lint's corrected source into a minimal edit. Pure; no vscode imports.

import type { Eol, TextEditSpec } from './textModel';

/**
 * Restores the document's line endings.
 *
 * Ruby normalizes output to LF, so replacing a CRLF document with it wholesale rewrites every line
 * on every save and produces a whole-file diff on the next commit.
 */
export function restoreEol(text: string, eol: Eol): string {
  const normalized = text.replace(/\r\n/g, '\n');
  return eol === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized;
}

/**
 * Builds the edit that turns `original` into `corrected`, or null when there is nothing to do.
 *
 * Returns null rather than a whole-document replacement when the text is unchanged: a no-op edit
 * still dirties the undo stack and re-marks the buffer. Only the differing middle is replaced, so
 * the cursor position, folds and scroll offset survive a save.
 */
export function buildFormatEdit(original: string, corrected: string, eol: Eol): TextEditSpec | null {
  const target = restoreEol(corrected, eol);
  if (target === original) {
    return null;
  }

  // Split on any line ending, not on `eol`: VS Code's line numbering counts \r\n, \n and \r alike,
  // and a buffer can hold a stray odd one (an edit from another extension is enough). Splitting on
  // the document eol alone would misalign every coordinate below against the editor's line model.
  const originalLines = original.split(/\r\n|\r|\n/);
  const targetLines = target.split(/\r\n|\r|\n/);

  if (originalLines.length === targetLines.length && originalLines.every((line, index) => line === targetLines[index])) {
    // Only line endings differ. A zero-width edit would change nothing, but returning it would
    // publish a digest of text the buffer will never hold, and every following save would re-spawn
    // for a document that is already clean.
    return null;
  }

  const maxCommon = Math.min(originalLines.length, targetLines.length);
  let prefix = 0;
  while (prefix < maxCommon && originalLines[prefix] === targetLines[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (suffix < maxCommon - prefix && originalLines[originalLines.length - 1 - suffix] === targetLines[targetLines.length - 1 - suffix]) {
    suffix++;
  }

  const originalEnd = originalLines.length - suffix;
  const middle = targetLines.slice(prefix, targetLines.length - suffix);
  const lastIndex = originalLines.length - 1;
  const lastLine = originalLines[lastIndex] ?? '';

  if (originalEnd < originalLines.length) {
    // Whole lines in the middle of the document: each replaced line carries its trailing eol.
    return {
      start: { line: prefix, character: 0 },
      end: { line: originalEnd, character: 0 },
      newText: middle.map((line) => line + eol).join('')
    };
  }

  // Through the end of the document, where the separator belongs *before* each line rather than
  // after it. Anchoring to the end of the previous line is what makes appending a final newline and
  // deleting trailing blank lines come out right.
  if (prefix > 0) {
    const previous = originalLines[prefix - 1] ?? '';
    return {
      start: { line: prefix - 1, character: previous.length },
      end: { line: lastIndex, character: lastLine.length },
      newText: middle.map((line) => eol + line).join('')
    };
  }

  // Nothing in common at all: replace the document outright.
  return {
    start: { line: 0, character: 0 },
    end: { line: lastIndex, character: lastLine.length },
    newText: middle.join(eol)
  };
}
