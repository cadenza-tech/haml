// Settings normalization. Pure; no vscode imports.
//
// package.json's schema is not trusted: a user can hand-edit settings.json to anything, and VS Code
// hands the raw value through. Every field is re-validated and clamped here so the rest of the
// extension can rely on its types.

import type { FormatterMode, HamlConfig, LintRunMode, RailsSnippetsMode, UseBundler } from './types';

export const DEFAULT_LINT_RUN: LintRunMode = 'onSave';
export const DEFAULT_DEBOUNCE_MS = 500;
export const MIN_DEBOUNCE_MS = 0;
export const MAX_DEBOUNCE_MS = 10000;
export const DEFAULT_FORMATTER: FormatterMode = 'auto';
export const DEFAULT_USE_BUNDLER: UseBundler = 'auto';
export const DEFAULT_SNIPPETS_RAILS: RailsSnippetsMode = 'auto';
export const DEFAULT_TIMEOUT_MS = 15000;
export const MIN_TIMEOUT_MS = 1000;
export const MAX_TIMEOUT_MS = 120000;
export const DEFAULT_COMPLETIONS_PARTIALS = true;
export const DEFAULT_COMPLETIONS_DATA_ATTRIBUTES = true;

// Exported so src/test/pure/manifest can check package.json's enum lists against them: adding a
// value there and forgetting it here is silent, and the settings UI then offers something the
// extension falls back out of.
export const LINT_RUN_VALUES: readonly LintRunMode[] = ['onSave', 'onType', 'off'];
export const FORMATTER_VALUES: readonly FormatterMode[] = ['auto', 'safe', 'all', 'none'];
export const USE_BUNDLER_VALUES: readonly UseBundler[] = ['auto', 'always', 'never'];
export const RAILS_SNIPPETS_VALUES: readonly RailsSnippetsMode[] = ['auto', 'on', 'off'];

/**
 * The VS Code setting id, minus the `haml.` section, for every field of RawConfig.
 *
 * Data rather than a list of `raw.get('...')` calls, because that list cannot be tested: a wrong key
 * makes get() return undefined, normalizeConfig substitutes the default, and every assertion still
 * passes. As a map it can be checked against package.json's own property names.
 */
export const CONFIG_KEYS = {
  lintRun: 'lint.run',
  lintDebounceMs: 'lint.debounceMs',
  lintExclude: 'lint.exclude',
  formatter: 'formatter',
  executablePath: 'hamlLint.executablePath',
  useBundler: 'hamlLint.useBundler',
  configPath: 'hamlLint.configPath',
  timeoutMs: 'hamlLint.timeoutMs',
  snippetsRails: 'snippets.rails',
  completionsPartials: 'completions.partials',
  completionsDataAttributes: 'completions.dataAttributes'
} as const satisfies Record<keyof RawConfig, string>;

export interface RawConfig {
  readonly lintRun?: unknown;
  readonly lintDebounceMs?: unknown;
  readonly lintExclude?: unknown;
  readonly formatter?: unknown;
  readonly executablePath?: unknown;
  readonly useBundler?: unknown;
  readonly configPath?: unknown;
  readonly timeoutMs?: unknown;
  readonly snippetsRails?: unknown;
  readonly completionsPartials?: unknown;
  readonly completionsDataAttributes?: unknown;
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function nonEmptyStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  // Trimmed as well as filtered: a glob is matched character for character, so a space left behind
  // in settings.json makes the pattern match nothing, with no sign that it is being ignored.
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

export function normalizeConfig(raw: RawConfig): HamlConfig {
  return {
    lintRun: pickEnum(raw.lintRun, LINT_RUN_VALUES, DEFAULT_LINT_RUN),
    lintDebounceMs: clampNumber(raw.lintDebounceMs, MIN_DEBOUNCE_MS, MAX_DEBOUNCE_MS, DEFAULT_DEBOUNCE_MS),
    lintExclude: stringArray(raw.lintExclude),
    formatter: pickEnum(raw.formatter, FORMATTER_VALUES, DEFAULT_FORMATTER),
    executablePath: nonEmptyStringOrNull(raw.executablePath),
    useBundler: pickEnum(raw.useBundler, USE_BUNDLER_VALUES, DEFAULT_USE_BUNDLER),
    configPath: nonEmptyStringOrNull(raw.configPath),
    timeoutMs: clampNumber(raw.timeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    snippetsRails: pickEnum(raw.snippetsRails, RAILS_SNIPPETS_VALUES, DEFAULT_SNIPPETS_RAILS),
    completionsPartials: booleanOr(raw.completionsPartials, DEFAULT_COMPLETIONS_PARTIALS),
    completionsDataAttributes: booleanOr(raw.completionsDataAttributes, DEFAULT_COMPLETIONS_DATA_ATTRIBUTES)
  };
}
