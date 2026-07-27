// The version probe cache. The decision it feeds lives in src/hamlLint/formatterMode.ts.

import type * as vscode from 'vscode';
import type { Invocation } from './hamlLint/executable';
import { needsVersionProbe } from './hamlLint/formatterMode';
import { type SemVerTriple, supportsHamlAutocorrect } from './hamlLint/version';
import type { Logger } from './logger';
import type { HamlConfig } from './types';

/**
 * The probe gets its own, longer budget than a lint run: `bundle exec` cold start is seconds, and a
 * probe that times out must not be mistaken for "haml-lint cannot format".
 */
export const PROBE_TIMEOUT_MS = 30000;

/** The slice of HamlLintClient this cache needs. Narrow so it can be faked in tests. */
export interface VersionProbe {
  canProbe(document: vscode.TextDocument): boolean;
  resolve(document: vscode.TextDocument, config: HamlConfig): Invocation;
  probeVersion(document: vscode.TextDocument, config: HamlConfig, token?: vscode.CancellationToken): Promise<SemVerTriple | null>;
}

export class CapabilityCache implements vscode.Disposable {
  /** Keyed on the resolved command plus cwd, so switching bundles re-probes. */
  private readonly probes = new Map<string, Promise<SemVerTriple | null>>();

  constructor(
    private readonly client: VersionProbe,
    private readonly logger: Logger
  ) {}

  /**
   * Starts a probe without waiting for it, when one is needed at all.
   *
   * Called when a document opens rather than when it is saved: probing on first save would make the
   * initial save block on two consecutive cold starts, and a probe timeout there would silently
   * disable formatting for that one save.
   */
  prime(document: vscode.TextDocument, config: HamlConfig): void {
    if (!needsVersionProbe(config.formatter)) {
      return;
    }
    // Detached on purpose: this warms the cache, and its failure is already logged below.
    void this.version(document, config).catch(() => undefined);
  }

  version(document: vscode.TextDocument, config: HamlConfig): Promise<SemVerTriple | null> {
    // Refused before resolve(): for a document the probe guard rejects, resolve() falls back to
    // the extension host's own cwd, which would build a meaningless cache key and - through the
    // null-probe path below - log a "could not determine" warning for a command never attempted.
    if (!this.client.canProbe(document)) {
      return Promise.resolve(null);
    }
    const invocation = this.client.resolve(document, config);
    const key = `${invocation.command}\u0000${invocation.cwd}`;
    const cached = this.probes.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const probe = this.client
      .probeVersion(document, { ...config, timeoutMs: PROBE_TIMEOUT_MS })
      .then((version) => {
        if (version === null) {
          // Not cached as a failure: the next request re-probes rather than treating a transient
          // timeout as a permanent "no formatter". Only the entry this probe owns is deleted -
          // guarded like HamlLintClient.run's settle handler - because invalidate() may have run
          // while it was in flight, and the fresh probe under the same key must not lose its entry
          // to this stale one.
          if (this.probes.get(key) === probe) {
            this.probes.delete(key);
          }
          this.logger.warn(`could not determine the haml-lint version for ${invocation.command}`);
          return null;
        }
        this.logger.info(`haml-lint ${version.join('.')} at ${invocation.command} (haml autocorrect: ${supportsHamlAutocorrect(version)})`);
        return version;
      })
      .catch((error: unknown) => {
        // Logged rather than swallowed: the branch above logs when the probe merely returns null,
        // so a throw being the one silent path was the inconsistency.
        if (this.probes.get(key) === probe) {
          this.probes.delete(key);
        }
        this.logger.error(`the haml-lint version probe for ${invocation.command} threw: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });

    this.probes.set(key, probe);
    return probe;
  }

  /** Settings or the bundle changed, so the cached answer may no longer describe what would run. */
  invalidate(): void {
    this.probes.clear();
  }

  /**
   * Same effect, different reason: this one is VS Code tearing the extension down. Kept separate so
   * the Disposable contract does not have to be read as "a settings change".
   */
  dispose(): void {
    this.invalidate();
  }
}
