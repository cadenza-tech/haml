// Offers the snippets that open with a Haml script marker: the control-flow set and the Rails view
// helpers. They come from a provider rather than from snippets/haml.code-snippets because only a
// provider can replace the marker the user has already typed. VS Code glue only; every decision is
// made in src/pure.

import * as path from 'node:path';
import * as vscode from 'vscode';
import { snapshotOf } from './documentSnapshot';
import { hasLocalPath } from './hamlDocuments';
import { HAML_LANGUAGE_ID } from './hamlLint/eligibility';
import { hasConsumingAncestor } from './pure/blockStructure';
import { type CompletionWord, computeCompletionWord, computeReplaceLength, filterTextFor } from './pure/completionWord';
import { controlSnippetsFor } from './pure/controlSnippets';
import type { FsDeps } from './pure/fsWalk';
import { detectRails } from './pure/railsDetection';
import { RAILS_SNIPPETS, shouldOfferRailsSnippets } from './pure/railsSnippets';
import type { HamlConfig, ProvidedSnippet } from './types';

interface PreparedSnippet {
  readonly snippet: ProvidedSnippet;
  readonly insertText: vscode.SnippetString;
}

/**
 * Built once at load. A SnippetString is immutable, and provideCompletionItems runs synchronously on
 * every keystroke. It lives here rather than beside the data because src/pure must not import vscode.
 *
 * Paired rather than kept in a parallel array: the correlation is then the type, not an index, so
 * reordering RAILS_SNIPPETS cannot silently attach the wrong body to a prefix.
 */
const RAILS_ITEMS: readonly PreparedSnippet[] = RAILS_SNIPPETS.map((snippet) => ({
  snippet,
  insertText: new vscode.SnippetString(snippet.body)
}));

class ProvidedSnippetItem extends vscode.CompletionItem {
  constructor(
    readonly snippet: ProvidedSnippet,
    insertText: vscode.SnippetString
  ) {
    super(snippet.prefix, vscode.CompletionItemKind.Snippet);
    this.insertText = insertText;
    this.detail = snippet.detail;
  }
}

function buildItem(prepared: PreparedSnippet, word: CompletionWord, position: vscode.Position): ProvidedSnippetItem | null {
  const { snippet, insertText } = prepared;
  const length = computeReplaceLength(word, snippet.body);
  if (length === null) {
    return null;
  }
  const item = new ProvidedSnippetItem(snippet, insertText);
  item.range = new vscode.Range(position.translate(0, -length), position);
  item.filterText = filterTextFor(word, length, snippet.prefix);
  return item;
}

/**
 * Caches the Rails verdict per directory.
 *
 * Per directory rather than per workspace folder because the answer genuinely differs by file: a
 * monorepo holding packages/rails-app next to packages/static-site must resolve both correctly.
 */
export class RailsDetectionCache {
  private readonly results = new Map<string, boolean>();

  constructor(private readonly deps: FsDeps) {}

  isRails(document: vscode.TextDocument): boolean {
    // Anything but `file:` would send a synthetic path into a real filesystem walk. The fsPath of
    // `vscode-vfs://github/org/repo/app/views/a.haml` is `/org/repo/app/views/a.haml`, which would
    // have us stat up to 32 ancestors of a directory on the user's own disk; untitled documents
    // resolve to the extension host's cwd. Neither answer would mean anything.
    if (!hasLocalPath(document.uri)) {
      return false;
    }
    const documentPath = document.uri.fsPath;
    const key = path.dirname(documentPath);
    const cached = this.results.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const detected = detectRails({ documentPath, workspaceFolderPath: vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath }, this.deps);
    this.results.set(key, detected);
    return detected;
  }

  invalidate(): void {
    this.results.clear();
  }
}

export class SnippetCompletionProvider implements vscode.CompletionItemProvider {
  constructor(
    private readonly rails: RailsDetectionCache,
    private readonly getConfig: (resource: vscode.Uri) => HamlConfig
  ) {}

  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
    // The cheap string test comes first: most cursor positions in a Haml file are plain text,
    // attribute hashes or class shorthand, and none of those reach the checks below.
    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    const word = computeCompletionWord(linePrefix);
    if (word === null) {
      return undefined;
    }
    const items = [...this.controlItems(document, position, linePrefix, word), ...this.railsItems(document, position, word)];
    return items.length === 0 ? undefined : items;
  }

  /** Haml's own, so neither haml.snippets.rails nor the kind of workspace has any say in them. */
  private controlItems(document: vscode.TextDocument, position: vscode.Position, linePrefix: string, word: CompletionWord): ProvidedSnippetItem[] {
    const candidates = controlSnippetsFor(linePrefix.slice(linePrefix.length - word.identifierLength));
    // Read only once something could be offered, because it climbs the document: inside a filter
    // `if` is JavaScript or Markdown, and `- if condition` has no business there. The contributed
    // snippets stayed out of a filter body for free, VS Code reading it as the embedded language; a
    // provider is asked by the document's language wherever the cursor is.
    if (candidates.length === 0 || hasConsumingAncestor(position.line, snapshotOf(document))) {
      return [];
    }
    const items: ProvidedSnippetItem[] = [];
    for (const snippet of candidates) {
      const item = buildItem({ snippet, insertText: new vscode.SnippetString(snippet.body) }, word, position);
      if (item !== null) {
        items.push(item);
      }
    }
    return items;
  }

  private railsItems(document: vscode.TextDocument, position: vscode.Position, word: CompletionWord): ProvidedSnippetItem[] {
    const config = this.getConfig(document.uri);
    if (!shouldOfferRailsSnippets(config.snippetsRails, () => this.rails.isRails(document))) {
      return [];
    }
    const items: ProvidedSnippetItem[] = [];
    for (const prepared of RAILS_ITEMS) {
      const item = buildItem(prepared, word, position);
      if (item !== null) {
        items.push(item);
      }
    }
    return items;
  }

  /** Kept out of provideCompletionItems so hundreds of rendered bodies are not serialised on every keystroke. */
  resolveCompletionItem(item: vscode.CompletionItem): vscode.CompletionItem {
    if (item instanceof ProvidedSnippetItem) {
      item.documentation = new vscode.MarkdownString().appendCodeblock(item.snippet.body, HAML_LANGUAGE_ID);
    }
    return item;
  }
}
