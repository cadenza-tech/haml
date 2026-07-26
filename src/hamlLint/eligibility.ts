// Decides whether a document may be handed to haml-lint. Pure; no vscode imports.
//
// Centralized so no call site can forget a case. Allowlist, never a denylist: new URI schemes
// appear every VS Code release, and an unfiltered `git:` scheme alone spawns one Ruby process per
// pane when a pull request diff with many .haml files is opened.

export const HAML_LANGUAGE_ID = 'haml';
export const SUPPORTED_SCHEMES: readonly string[] = ['file', 'untitled'];
/** Above this, linting costs more than it is worth. */
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

export interface DocumentFacts {
  readonly scheme: string;
  readonly languageId: string;
  readonly isClosed: boolean;
  readonly textLength: number;
  readonly hasWorkspaceFolder: boolean;
}

export type Eligibility = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const OK: Eligibility = { ok: true };

export function classifyDocument(facts: DocumentFacts, maxBytes: number = MAX_DOCUMENT_BYTES): Eligibility {
  if (facts.languageId !== HAML_LANGUAGE_ID) {
    return { ok: false, reason: `language is ${facts.languageId}, not ${HAML_LANGUAGE_ID}` };
  }
  if (facts.isClosed) {
    return { ok: false, reason: 'document is closed' };
  }
  if (!SUPPORTED_SCHEMES.includes(facts.scheme)) {
    // git:, gitlens:, pr:, review: are read-only history; vscode-vfs:, memfs: have no local path.
    return { ok: false, reason: `scheme ${facts.scheme} is not backed by a local file` };
  }
  if (facts.scheme === 'untitled' && !facts.hasWorkspaceFolder) {
    // No defensible cwd: $HOME could pick up a stray .haml-lint.yml and a temp dir gives
    // misleading default-config diagnostics.
    return { ok: false, reason: 'untitled document outside any workspace folder' };
  }
  if (facts.textLength === 0) {
    return { ok: false, reason: 'document is empty' };
  }
  if (facts.textLength > maxBytes) {
    return { ok: false, reason: `document is larger than ${maxBytes} bytes` };
  }
  return OK;
}
