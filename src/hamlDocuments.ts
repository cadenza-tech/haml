// "Which documents are ours" and how to reach them, in one place.
//
// Four files used to ask this and answered it five different ways, which is how the definition drifted
// between them.

import * as vscode from 'vscode';
import { HAML_LANGUAGE_ID } from './hamlLint/eligibility';

export const NO_HAML_FILE_MESSAGE = 'Haml: open a .haml file first.';

export function isHamlDocument(document: vscode.TextDocument): boolean {
  return document.languageId === HAML_LANGUAGE_ID;
}

/**
 * Whether the uri addresses a file the extension can resolve paths against.
 *
 * Deliberately narrower than SUPPORTED_SCHEMES, which also admits `untitled:` because haml-lint can
 * be handed a synthetic path for it. An untitled document's fsPath is the extension host's cwd, so
 * anything that walks the filesystem from it would be looking in the wrong tree.
 */
export function hasLocalPath(uri: vscode.Uri): boolean {
  return uri.scheme === 'file';
}

export function openHamlDocuments(): readonly vscode.TextDocument[] {
  return vscode.workspace.textDocuments.filter(isHamlDocument);
}

/** The document a uri-taking command should act on, or undefined after telling the user why not. */
export async function resolveHamlDocument(uri: vscode.Uri | undefined): Promise<vscode.TextDocument | undefined> {
  if (uri !== undefined) {
    return vscode.workspace.openTextDocument(uri);
  }
  const active = vscode.window.activeTextEditor?.document;
  if (active !== undefined && isHamlDocument(active)) {
    return active;
  }
  void vscode.window.showInformationMessage(NO_HAML_FILE_MESSAGE);
  return undefined;
}

/**
 * The editor a selection command should act on, or undefined after telling the user why not.
 *
 * An editor rather than a document, because a selection belongs to the editor: the same document can
 * be open in two panes with different selections.
 */
export function resolveHamlEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor !== undefined && isHamlDocument(editor.document)) {
    return editor;
  }
  void vscode.window.showInformationMessage(NO_HAML_FILE_MESSAGE);
  return undefined;
}
