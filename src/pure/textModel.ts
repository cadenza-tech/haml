// The shape of a text document as the vscode-free layers see it. Types only, no runtime code.
//
// A DocumentSnapshot is a live view over a vscode.TextDocument (src/documentSnapshot.ts), never a
// copy: the pure callers read lineAt on demand, which is why splitToPartial re-checks
// document.version around its prompt.
//
// These live here rather than beside their first consumer because several modules need them and
// none of those is their subject: diagnosticMapper is about offenses, editBuilder about diffing.

export interface Position {
  readonly line: number;
  readonly character: number;
}

export interface LineSnapshot {
  readonly text: string;
  /** Space and tab only, as VS Code's own firstNonWhitespaceCharacterIndex counts it. */
  readonly firstNonWhitespaceCharacterIndex: number;
}

export interface DocumentSnapshot {
  readonly lineCount: number;
  lineAt(index: number): LineSnapshot;
}

export type Eol = '\n' | '\r\n';

export interface TextEditSpec {
  readonly start: Position;
  readonly end: Position;
  readonly newText: string;
}
