// Shared types. No runtime code and no vscode imports.
//
// The path is pinned: src/pure/railsSnippetsUpstream.ts is generated from a vendored haml-vscode
// commit and imports RailsSnippet from '../types', so neither this file nor that symbol can move
// without regenerating it.

export type LintRunMode = 'onSave' | 'onType' | 'off';
export type FormatterMode = 'auto' | 'safe' | 'all' | 'none';
export type ResolvedFormatterMode = 'safe' | 'all' | 'none';
export type UseBundler = 'auto' | 'always' | 'never';
export type RailsSnippetsMode = 'auto' | 'on' | 'off';

export interface HamlConfig {
  readonly lintRun: LintRunMode;
  readonly lintDebounceMs: number;
  readonly lintExclude: readonly string[];
  readonly formatter: FormatterMode;
  readonly executablePath: string | null;
  readonly useBundler: UseBundler;
  readonly configPath: string | null;
  readonly timeoutMs: number;
  readonly snippetsRails: RailsSnippetsMode;
  readonly completionsPartials: boolean;
  readonly completionsDataAttributes: boolean;
}

/**
 * The three ways a Haml tag can carry attributes. Declared here rather than beside the classifier so
 * that this file stays a leaf: it imports nothing, and src/pure imports from it.
 */
export type AttributeSyntax = 'rubyHash' | 'rubyDataHash' | 'htmlAttributes';

export type DataAttributeSource = 'Turbo' | 'Rails UJS' | 'Stimulus';

export interface DataAttribute {
  /** Dash form, which is canonical; the underscored and quoted spellings are derived from it. */
  readonly name: string;
  readonly source: DataAttributeSource;
  readonly description: string;
  /** True when presence is the value, e.g. data-turbo-permanent. */
  readonly valueless?: boolean;
}

/** One data attribute rendered for one syntax. Built once at load, like RAILS_SNIPPETS. */
export interface DataAttributeCompletion {
  readonly label: string;
  /** Snippet syntax; the glue wraps it in a SnippetString. */
  readonly body: string;
  readonly detail: string;
  readonly documentation: string;
}

/** One Rails view helper snippet. `contributes.snippets` cannot be toggled by a setting. */
export interface RailsSnippet {
  readonly prefix: string;
  /** Lines joined with '\n'; SnippetString interprets them directly. */
  readonly body: string;
  readonly detail: string;
}

export type OffenseSeverity = 'error' | 'warning';

export interface Offense {
  /** 1-based line as reported by haml-lint. haml-lint never reports a column. */
  readonly line: number;
  readonly severity: OffenseSeverity;
  readonly message: string;
  /** Absent for syntax/parse errors, which have no linter. */
  readonly linterName?: string;
}

export interface HamlLintReport {
  readonly offenses: readonly Offense[];
}
