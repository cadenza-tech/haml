// Adapters from a vscode.TextDocument to the shapes src/pure works with.
//
// snapshotOf is a live view, not a copy: it reads document.lineAt on demand. A caller that awaits
// anything between building the snapshot and using it is looking at the document as it is *then*, so
// it has to check document.version itself - splitToPartial does, around its name prompt.

import * as vscode from 'vscode';
import { findViewsRoot } from './pure/partialPaths';
import type { DocumentSnapshot, Eol } from './pure/textModel';

export function snapshotOf(document: vscode.TextDocument): DocumentSnapshot {
  return {
    lineCount: document.lineCount,
    lineAt: (index) => {
      const line = document.lineAt(index);
      return { text: line.text, firstNonWhitespaceCharacterIndex: line.firstNonWhitespaceCharacterIndex };
    }
  };
}

export function eolOf(document: vscode.TextDocument): Eol {
  return document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
}

export interface ViewsContext {
  readonly documentPath: string;
  readonly workspaceFolderPath: string | undefined;
  /** findViewsRoot's answer. Null falls back to the document's own directory. */
  readonly viewsRoot: string | null;
}

/**
 * The three values every partial-path caller derives before it can ask src/pure anything.
 *
 * `platform` is injected rather than read from the host so the comparison dialect matches whatever
 * the pure helpers are then given.
 */
export function viewsContextOf(document: vscode.TextDocument, platform: NodeJS.Platform): ViewsContext {
  const documentPath = document.uri.fsPath;
  const workspaceFolderPath = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
  return { documentPath, workspaceFolderPath, viewsRoot: findViewsRoot(documentPath, workspaceFolderPath, platform) };
}
