// Resolution of `haml.formatter`. Pure; no vscode imports.
//
// The 0.74.0 floor and the trust rule are haml-lint domain knowledge over a SemVerTriple, so they
// belong beside supportsHamlAutocorrect rather than inside the class that caches version probes.

import type { FormatterMode, ResolvedFormatterMode } from '../types';
import { type SemVerTriple, supportsHamlAutocorrect } from './version';

/**
 * Whether the probed version is needed at all.
 *
 * Only `auto` consumes it: `safe` and `all` are explicit choices, and `none` disables formatting
 * outright. Probing regardless would spawn Ruby - and under bundler evaluate the workspace Gemfile -
 * for a user who set `haml.formatter: "none"` and `haml.lint.run: "off"` precisely to get
 * highlighting without running anything.
 */
export function needsVersionProbe(formatter: FormatterMode): boolean {
  return formatter === 'auto';
}

/**
 * Resolves the effective autocorrect mode.
 *
 * `auto` mirrors Shopify's Ruby LSP, whose `formatter: "auto"` resolves to `none` unless the bundle
 * actually has a formatter. That is what makes shipping `editor.formatOnSave: true` through
 * configurationDefaults safe: without a usable haml-lint the formatter is a complete no-op.
 *
 * The 0.74.0 floor matters because earlier versions autocorrect RuboCop cops only. Formatting a
 * view would then rewrite the embedded Ruby while leaving the Haml untouched, which is the most
 * surprising thing a thing called "the Haml formatter" could do.
 *
 * `probeVersion` is a thunk rather than a value so the guarantee above is structural: for `none`,
 * `safe` and `all` it is never called, so nothing can be spawned on their behalf.
 */
export async function resolveFormatterMode(
  formatter: FormatterMode,
  isTrusted: boolean,
  probeVersion: () => Promise<SemVerTriple | null>
): Promise<ResolvedFormatterMode> {
  if (formatter === 'none') {
    return 'none';
  }
  if (formatter === 'safe' || formatter === 'all') {
    return formatter;
  }
  if (!isTrusted) {
    return 'none';
  }
  return supportsHamlAutocorrect(await probeVersion()) ? 'safe' : 'none';
}
