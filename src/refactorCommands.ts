// Selection refactorings.
//
// Unlike src/commands.ts these take no uri argument. A selection belongs to an editor, not to a
// document, so "wrap the selection" is undefined for a document that is not on screen. The
// `enablement` clause in package.json only greys out UI, so the language is re-checked here the way
// resolveDocument does in src/commands.ts.

import * as vscode from 'vscode';
import { eolOf, snapshotOf, viewsContextOf } from './documentSnapshot';
import { hasLocalPath, resolveHamlEditor } from './hamlDocuments';
import type { Logger } from './logger';
import type { FsDeps } from './pure/fsWalk';
import { indentUnit, type LineRange, normalizeSelection, type SelectionInput } from './pure/lineRange';
import { buildPartialExtraction, isSubmittablePartialName, suggestPartialName, validatePartialName } from './pure/partialExtraction';
import type { DocumentSnapshot, Eol } from './pure/textModel';
import { buildBlockWrap, buildConditionalWrap, type WrapSpec } from './pure/wrapBlock';

type WrapBuilder = (range: LineRange, document: DocumentSnapshot, unit: string, eol: Eol) => WrapSpec;

/** Injected so the extraction has a testable happy path, the way Notifier is in src/missingExecutableNotice.ts. */
export type PartialNamePrompt = (suggestion: string) => Thenable<string | undefined>;

export interface RefactorCommandDeps {
  readonly logger: Logger;
  /** Only fileExists and platform are used: the collision message and the path arithmetic. */
  readonly fs: FsDeps;
  /** Defaults to the real input box; injected only so the extraction has a testable happy path. */
  readonly prompt?: PartialNamePrompt;
}

const promptForPartialName: PartialNamePrompt = (suggestion) =>
  vscode.window.showInputBox({
    title: 'Split to Partial',
    prompt: "Partial name. The file becomes _<name> with this file's suffix.",
    value: suggestion,
    // validateInput takes (value) => string | null, which is validatePartialName exactly.
    validateInput: validatePartialName
  });

function selectionOf(editor: vscode.TextEditor): SelectionInput {
  const { start, end } = editor.selection;
  return { startLine: start.line, startCharacter: start.character, endLine: end.line, endCharacter: end.character };
}

/**
 * The indentation unit comes from the editor and nowhere else.
 *
 * insertSnippet runs every inserted line through normalizeIndentation, which reads exactly these two
 * values, so anything else would be rewritten on the way in. They are also the result of
 * editor.detectIndentation, which is what makes a tab-indented file keep its tabs for free. Reading
 * them always yields a resolved boolean and number; the wider declared types exist for the setter.
 */
function unitOf(editor: vscode.TextEditor): string {
  const { insertSpaces, tabSize } = editor.options;
  return indentUnit(insertSpaces === true, typeof tabSize === 'number' ? tabSize : undefined);
}

async function wrapSelection(editor: vscode.TextEditor, build: WrapBuilder): Promise<void> {
  const document = editor.document;
  const snapshot = snapshotOf(document);
  const range = normalizeSelection(selectionOf(editor), snapshot);
  if (range === null) {
    void vscode.window.showInformationMessage('Haml: select the lines to wrap first.');
    return;
  }
  const spec = build(range, snapshot, unitOf(editor), eolOf(document));
  // One API call, so the undo stack gets one step and nothing can change the document in between.
  // Mixing insertSnippet with a WorkspaceEdit is not possible anyway: an edit cannot carry tab stops.
  await editor.insertSnippet(
    new vscode.SnippetString(spec.snippet),
    new vscode.Range(spec.start.line, spec.start.character, spec.end.line, spec.end.character)
  );
}

export function wrapInConditional(editor: vscode.TextEditor): Promise<void> {
  return wrapSelection(editor, buildConditionalWrap);
}

export function wrapInBlock(editor: vscode.TextEditor): Promise<void> {
  return wrapSelection(editor, buildBlockWrap);
}

export async function splitToPartial(editor: vscode.TextEditor, deps: RefactorCommandDeps): Promise<void> {
  const document = editor.document;
  // A new file needs a real directory to sit in. An untitled document has no path at all, and a
  // virtual scheme's fsPath addresses a directory on the user's own disk that has nothing to do with it.
  if (!hasLocalPath(document.uri)) {
    void vscode.window.showInformationMessage('Haml: Split to Partial needs a file saved on disk.');
    return;
  }
  const snapshot = snapshotOf(document);
  const range = normalizeSelection(selectionOf(editor), snapshot);
  if (range === null) {
    void vscode.window.showInformationMessage('Haml: select the lines to extract first.');
    return;
  }

  // snapshotOf is a live adapter over document.lineAt, and the range was decided before the prompt, so
  // anything that edits the document while the box is open (a git checkout reloading the model, another
  // extension) would have the lines read here no longer be the lines the user selected.
  const version = document.version;
  const partialName = await (deps.prompt ?? promptForPartialName)(suggestPartialName(document.lineAt(range.startLine).text));
  // Re-validated rather than trusted: the prompt is injected, and validateInput is a UI affordance.
  if (partialName === undefined || !isSubmittablePartialName(partialName)) {
    return;
  }
  if (document.version !== version) {
    void vscode.window.showInformationMessage('Haml: the file changed while the name was being entered.');
    return;
  }
  const { documentPath, viewsRoot } = viewsContextOf(document, deps.fs.platform);
  const extraction = buildPartialExtraction({ documentPath, viewsRoot, partialName, range }, snapshot, eolOf(document), deps.fs.platform);
  const target = vscode.Uri.file(extraction.filePath);
  if (deps.fs.fileExists(extraction.filePath)) {
    // A friendlier message than the failed edit below, which is what actually guards the file.
    void vscode.window.showInformationMessage(`Haml: ${vscode.workspace.asRelativePath(target)} already exists.`);
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  // No options. ignoreIfExists would only make createFile a no-op and let the insert below prepend the
  // extracted Haml to somebody else's partial. With both unset the 1.57 contract is that the edit
  // "cannot be applied successfully" when the file already exists (index.d.ts:3340-3341), and an edit
  // containing a resource creation abandons the rest once one part fails (index.d.ts:10536-10538), so
  // neither the insert nor the render replacement runs. That is the real collision guard.
  edit.createFile(target);
  edit.insert(target, new vscode.Position(0, 0), extraction.partialText);
  const { start, end, newText } = extraction.replacement;
  edit.replace(document.uri, new vscode.Range(start.line, start.character, end.line, end.character), newText);
  // applyEdit resolves false rather than rejecting: the bulk edit host turns the error into a boolean.
  if (!(await vscode.workspace.applyEdit(edit))) {
    void vscode.window.showInformationMessage(`Haml: could not create ${vscode.workspace.asRelativePath(target)}.`);
    return;
  }
  deps.logger.info(`extracted ${extraction.renderPath} to ${extraction.filePath}`);
  // createFile writes an empty file to disk and the insert edits the open model, so the new document is
  // dirty and unsaved. Showing it is what keeps an empty partial from becoming a runtime surprise; it
  // is deliberately not saved, so the user's own save is what runs haml-lint over it.
  await vscode.window.showTextDocument(target, { preview: false });
}

function editorCommand(id: string, run: (editor: vscode.TextEditor) => Promise<void>): vscode.Disposable {
  return vscode.commands.registerCommand(id, async () => {
    const editor = resolveHamlEditor();
    if (editor === undefined) {
      return;
    }
    await run(editor);
  });
}

export function registerRefactorCommands(deps: RefactorCommandDeps): vscode.Disposable[] {
  return [
    editorCommand('haml.wrapInConditional', wrapInConditional),
    editorCommand('haml.wrapInBlock', wrapInBlock),
    editorCommand('haml.splitToPartial', (editor) => splitToPartial(editor, deps))
  ];
}
