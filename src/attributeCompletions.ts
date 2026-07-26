// Offers the Hotwire and Rails data attributes. VS Code glue only; every decision is made in src/pure.

import * as vscode from 'vscode';
import { classifyAttributePosition } from './pure/attributePosition';
import { DATA_ATTRIBUTE_COMPLETIONS } from './pure/dataAttributes';
import type { AttributeSyntax, DataAttributeCompletion, HamlConfig } from './types';

/**
 * Built once at load: a SnippetString is immutable and provideCompletionItems runs synchronously on
 * every keystroke. Same reasoning as SNIPPET_STRINGS in src/completions.ts, and the same reason it
 * lives here rather than beside the data - src/pure must not import vscode.
 */
interface PreparedAttribute {
  readonly completion: DataAttributeCompletion;
  readonly insertText: vscode.SnippetString;
}

function prepare(completions: readonly DataAttributeCompletion[]): readonly PreparedAttribute[] {
  return completions.map((completion) => ({ completion, insertText: new vscode.SnippetString(completion.body) }));
}

// Paired rather than kept in a parallel array, for the same reason as RAILS_ITEMS in
// src/completions.ts: the correlation is the type instead of an index. The three keys are written out
// rather than derived, because noUncheckedIndexedAccess would put the cast straight back.
const PREPARED: Readonly<Record<AttributeSyntax, readonly PreparedAttribute[]>> = {
  htmlAttributes: prepare(DATA_ATTRIBUTE_COMPLETIONS.htmlAttributes),
  rubyHash: prepare(DATA_ATTRIBUTE_COMPLETIONS.rubyHash),
  rubyDataHash: prepare(DATA_ATTRIBUTE_COMPLETIONS.rubyDataHash)
};

class DataAttributeItem extends vscode.CompletionItem {
  constructor(
    readonly completion: DataAttributeCompletion,
    insertText: vscode.SnippetString
  ) {
    // Property rather than Snippet: this is an attribute name, and it should survive
    // editor.snippetSuggestions being set to none.
    super(completion.label, vscode.CompletionItemKind.Property);
    this.insertText = insertText;
    this.detail = completion.detail;
  }
}

export class DataAttributeCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly getConfig: (resource: vscode.Uri) => HamlConfig) {}

  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
    // The cheap string test first: most positions in a Haml file are not inside an attribute list, and
    // none of those read the configuration.
    const attribute = classifyAttributePosition(document.lineAt(position.line).text.slice(0, position.character));
    if (attribute === null || !this.getConfig(document.uri).completionsDataAttributes) {
      return undefined;
    }

    const replaced = attribute.identifierLength + attribute.markerLength;
    const range = new vscode.Range(position.translate(0, -replaced), position);
    const items: DataAttributeItem[] = [];
    for (const { completion, insertText } of PREPARED[attribute.syntax]) {
      const item = new DataAttributeItem(completion, insertText);
      item.range = range;
      // The range reaches back over the opening quote, so the filter word starts with it too and the
      // label alone would never match. Same trick as buildItem in src/completions.ts.
      item.filterText = attribute.marker + completion.label;
      items.push(item);
    }
    return items;
  }

  /** Kept out of provideCompletionItems so 25 descriptions are not rendered on every keystroke. */
  resolveCompletionItem(item: vscode.CompletionItem): vscode.CompletionItem {
    if (item instanceof DataAttributeItem) {
      item.documentation = new vscode.MarkdownString(item.completion.documentation);
    }
    return item;
  }
}
