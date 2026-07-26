// Builds the snippet that wraps a selection in a Haml block.
//
// A snippet rather than a plain edit because the point of these commands is that you can type the
// condition or the collection straight away, and only a tab stop gives that. It also means the whole
// operation is one editor.insertSnippet call, so the undo stack gets one step and nothing can change
// the document in between.

import { commonIndent, indentLines, type LineRange, linesOf } from './lineRange';
import type { DocumentSnapshot, Eol, Position } from './textModel';

/**
 * The first line of the matching entry in snippets/haml.code-snippets, so the extension offers one
 * dialect rather than two. The defaults matter: Esc leaves them in place, and `- if condition` is
 * still valid Haml where a bare `- if ` would be a Ruby syntax error. They are deliberately not
 * guesses about the user's data either - `@items` left behind by Esc would read as real code.
 */
const CONDITIONAL_HEADER = '- if ${1:condition}';
const BLOCK_HEADER = '- ${1:collection}.each do |${2:item}|';

export interface WrapSpec {
  readonly start: Position;
  readonly end: Position;
  /** Snippet syntax, for editor.insertSnippet. */
  readonly snippet: string;
}

/** Escapes exactly what vscode.SnippetString.appendText escapes. */
export function escapeSnippetText(text: string): string {
  return text.replace(/[$}\\]/g, '\\$&');
}

function buildWrap(header: string, range: LineRange, document: DocumentSnapshot, unit: string, eol: Eol): WrapSpec {
  const lines = linesOf(range, document);
  // The shallowest indent, not the first line's: a selection opening deeper than it ends would
  // otherwise put its own header inside its body.
  const indent = commonIndent(lines);
  const body = indentLines(lines, unit);

  return {
    // Column 0 is mandatory: SnippetSession.adjustWhitespace prefixes every line after the first with
    // the leading whitespace up to the insertion column, so starting anywhere else double-indents.
    start: { line: range.startLine, character: 0 },
    // The end of the last line rather than the start of the next: a document with no final newline
    // does not grow one, and the last line of the file needs no special case.
    end: { line: range.endLine, character: document.lineAt(range.endLine).text.length },
    snippet: [indent + header, ...body.map(escapeSnippetText)].join(eol)
  };
}

export function buildConditionalWrap(range: LineRange, document: DocumentSnapshot, unit: string, eol: Eol): WrapSpec {
  return buildWrap(CONDITIONAL_HEADER, range, document, unit, eol);
}

export function buildBlockWrap(range: LineRange, document: DocumentSnapshot, unit: string, eol: Eol): WrapSpec {
  return buildWrap(BLOCK_HEADER, range, document, unit, eol);
}
