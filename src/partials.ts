// Resolves the partial a render call names. VS Code glue only; every decision is made in src/pure.

import * as vscode from 'vscode';
import { viewsContextOf } from './documentSnapshot';
import { hasLocalPath } from './hamlDocuments';
import { type FsDeps, pathApi } from './pure/fsWalk';
import { partialCompletionCandidates, partialGlob, resolvePartialPath } from './pure/partialPaths';
import { partialReferenceAt } from './pure/renderPartial';
import type { HamlConfig } from './types';

/** Nothing is opened, so the target is the head of the file. */
const FILE_START = new vscode.Range(0, 0, 0, 0);

/** An app/views can hold thousands of partials, and the widget stops being useful long before this. */
const MAX_PARTIAL_RESULTS = 5000;

export class PartialDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly deps: FsDeps) {}

  provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.DefinitionLink[] | undefined {
    // Same reason as RailsDetectionCache: the fsPath of a non-file scheme addresses a path on the
    // user's own disk that has nothing to do with the document, so resolving against it is meaningless.
    if (!hasLocalPath(document.uri)) {
      return undefined;
    }
    const reference = partialReferenceAt(document.lineAt(position.line).text, position.character);
    if (reference === null) {
      return undefined;
    }
    const { documentPath, viewsRoot } = viewsContextOf(document, this.deps.platform);
    const resolved = resolvePartialPath({ documentPath, viewsRoot, name: reference.name }, this.deps);
    if (resolved === null) {
      return undefined;
    }
    return [
      {
        // A plain Location would have VS Code derive the origin from its own word range, and '/' is
        // not a word character, so the underline would cover only the last segment of the name.
        originSelectionRange: new vscode.Range(position.line, reference.start, position.line, reference.end),
        targetUri: vscode.Uri.file(resolved),
        targetRange: FILE_START,
        targetSelectionRange: FILE_START
      }
    ];
  }
}

/**
 * Completes partial names inside a render call.
 *
 * There is no index and no watcher behind this. A provider that returns a complete list is asked once
 * per widget, not once per keystroke - VS Code filters locally unless the list is marked incomplete -
 * so a cache would save one narrow findFiles at the price of a recursive workspace watcher.
 */
export class PartialCompletionProvider implements vscode.CompletionItemProvider {
  constructor(
    private readonly getConfig: (resource: vscode.Uri) => HamlConfig,
    private readonly platform: NodeJS.Platform
  ) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.CompletionList | undefined> {
    if (!hasLocalPath(document.uri)) {
      return undefined;
    }
    // The cheap string test comes first, as in SnippetCompletionProvider: only a cursor actually
    // inside a render call's name literal is allowed to reach the filesystem.
    const reference = partialReferenceAt(document.lineAt(position.line).text, position.character);
    if (reference === null || !this.getConfig(document.uri).completionsPartials) {
      return undefined;
    }
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    // findFiles always resolves to [] without a folder, so there is nothing to offer.
    if (folder === undefined) {
      return undefined;
    }
    // One path API for the whole method, chosen from the injected platform rather than the host's, so
    // every comparison below is made in the same dialect as the pure helpers it feeds.
    const p = pathApi(this.platform);
    const { documentPath, viewsRoot } = viewsContextOf(document, this.platform);
    const workspaceFolderPath = folder.uri.fsPath;
    const documentDirectory = p.dirname(documentPath);
    const glob = partialGlob({ workspaceFolderPath, viewsRoot, documentDirectory }, this.platform);
    if (glob === null) {
      return undefined;
    }

    // exclude is undefined rather than null so the user's files.exclude and search.exclude still
    // apply: someone who has hidden app/views/legacy from search should not be shown it here.
    // One more than the cap is requested so a full page can be told from a truncated search: with an
    // equality test a workspace holding exactly the cap would report itself incomplete forever.
    const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, glob), undefined, MAX_PARTIAL_RESULTS + 1, token);
    // A cancelled findFiles resolves to [], and returning [] would claim there are no candidates.
    if (token.isCancellationRequested) {
      return undefined;
    }
    const truncated = found.length > MAX_PARTIAL_RESULTS;
    const page = truncated ? found.slice(0, MAX_PARTIAL_RESULTS) : found;

    const base = viewsRoot ?? documentDirectory;
    const range = new vscode.Range(position.line, reference.start, position.line, reference.end);
    const byPath = new Map(page.map((uri) => [uri.fsPath, uri]));
    const items = partialCompletionCandidates(
      page.map((uri) => uri.fsPath),
      base,
      documentDirectory,
      this.platform
    ).map((candidate) => {
      const item = new vscode.CompletionItem(candidate.label, vscode.CompletionItemKind.File);
      const uri = byPath.get(candidate.path);
      if (uri !== undefined) {
        item.detail = vscode.workspace.asRelativePath(uri);
      }
      // One range covering the whole literal: replacing only [start, cursor) would turn re-editing
      // `'shared/foo'` into `'shared/foored/foo'`. No filterText - the filter word runs from
      // range.start to the cursor, which is already just the name being typed.
      item.range = range;
      item.sortText = candidate.sortText;
      return item;
    });
    // Marked incomplete only when the search hit the cap, so VS Code asks again as the name is typed
    // rather than filtering a truncated list locally. Below the cap the list really is complete.
    return new vscode.CompletionList(items, truncated);
  }
}
