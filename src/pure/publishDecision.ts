// The rules that decide whether a haml-lint report reaches the Problems panel. Pure; no vscode
// imports.
//
// Every one of these was previously reachable only through the extension host, which is why the
// report-reuse contract could be described in prose but never asserted directly.

import { createHash } from 'node:crypto';
import type { LintRunMode } from '../types';

/**
 * Identifies the text a published report was produced from.
 *
 * A digest rather than the text itself so that the caller's map stays a few dozen bytes per document
 * instead of a second copy of every open buffer, which the 2 MB eligibility ceiling would otherwise
 * allow to add up.
 */
export function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('base64');
}

/**
 * Whether the report already on screen answers this request.
 *
 * Keyed on content, never on the version: the report the formatter produces describes the document
 * as it will be *after* its edit lands, whose version cannot be known in advance. A settings change
 * alters the answer without altering the text, so every path that changes settings must pass
 * `force` - that is the whole reason this takes the flag rather than inferring anything.
 */
export function shouldReuseReport(publishedDigest: string | undefined, text: string, force: boolean): boolean {
  return !force && publishedDigest !== undefined && publishedDigest === digestOf(text);
}

export interface StalenessFacts {
  readonly isClosed: boolean;
  readonly versionBefore: number;
  readonly versionNow: number;
  /** How the caller knows: a cancellation token in the formatter, a generation counter in diagnostics. */
  readonly superseded: boolean;
}

/** A report describing a buffer the user has already moved past must not reach the panel. */
export function isStale(facts: StalenessFacts): boolean {
  return facts.superseded || facts.isClosed || facts.versionNow !== facts.versionBefore;
}

/**
 * `haml.lint.run: "off"` has to mean no diagnostics whatever produced them - including the report
 * the single-pass format run gets for free.
 */
export function shouldPublishReport(hasReport: boolean, lintRun: LintRunMode): boolean {
  return hasReport && lintRun !== 'off';
}
