// Diagnostic collection, listeners and debouncing.

import * as path from 'node:path';
import * as vscode from 'vscode';
import type { LintRunner } from './client';
import { snapshotOf } from './documentSnapshot';
import { HAML_LANGUAGE_ID } from './hamlLint/eligibility';
import type { Logger } from './logger';
import type { MissingExecutableNotice } from './missingExecutableNotice';
import { DIAGNOSTIC_SOURCE, mapOffenses } from './pure/diagnosticMapper';
import { digestOf, isStale, shouldReuseReport } from './pure/publishDecision';
import type { HamlConfig } from './types';

function toSeverity(severity: 'error' | 'warning'): vscode.DiagnosticSeverity {
  return severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
}

/**
 * haml-lint's own top-level `exclude:` never applies to a --stdin run, and .haml-lint.yml is ERB so
 * it cannot be parsed to reproduce it. This is the honest replacement.
 *
 * A string glob in a DocumentFilter is matched against the absolute path, so `vendor/**` - the shape
 * an `exclude:` entry has - would never match anything. Anchoring a relative pattern to the
 * workspace folder is what makes it mean what it says; `**` patterns match the same either way.
 */
function isExcluded(document: vscode.TextDocument, patterns: readonly string[]): boolean {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  return patterns.some((pattern) => {
    const anchored = folder === undefined || path.isAbsolute(pattern) ? pattern : new vscode.RelativePattern(folder, pattern);
    return vscode.languages.match({ pattern: anchored }, document) > 0;
  });
}

export class DiagnosticsController implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  /**
   * One entry per document, tagged with the version it belongs to.
   *
   * Cancelling on every request would be wrong: HamlLintClient coalesces requests that share a
   * document version, so a second request for the same version receives the first one's promise -
   * after having cancelled it. Opening a file and immediately running `Haml: Lint File` would then
   * silently produce no diagnostics at all. Only a genuinely superseded run is cancelled.
   */
  private readonly cancellations = new Map<string, { version: number; source: vscode.CancellationTokenSource }>();
  /** Guards against a killed process resolving after a newer request already published. */
  private readonly generations = new Map<string, number>();
  /**
   * The text each document's published diagnostics were produced from.
   *
   * With the shipped defaults a save ran haml-lint twice: format-on-save runs `format-and-lint`, and
   * the onDidSaveTextDocument that follows runs `lint` over the text the first run already reported
   * on. They cannot be coalesced, being different modes, but when the format pass had nothing to
   * correct the answer is the same, and a Ruby boot is the entire cost of a run. Keyed on content rather
   * than on the version, because content is what a report is true of: an undo back to the published
   * text reuses it as well, under a version that was never linted.
   */
  private readonly publishedFor = new Map<string, string>();
  /**
   * The text a format edit is about to put into each document, as a digest.
   *
   * A format pass that corrected something publishes nothing. Its report is not a lint of the
   * corrected text - runner.rb concatenates what the correcting pass recorded, at the lines those
   * offenses had before the fix, with a second pass over the result - and whatever it says could only
   * be mapped onto lines that are not in the buffer until VS Code applies the edit. So the formatter
   * leaves the expected text here, and the change that produces it starts an ordinary lint. On a
   * save that lint is the one onDidSaveTextDocument asks for a moment later, which joins it.
   */
  private readonly awaitedText = new Map<string, string>();

  constructor(
    private readonly client: LintRunner,
    private readonly logger: Logger,
    private readonly getConfig: (resource: vscode.Uri) => HamlConfig,
    private readonly notice: MissingExecutableNotice
  ) {
    this.collection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
  }

  /**
   * Called when a document is opened or saved, and when a format edit has landed in it.
   *
   * `force` is for the paths that invalidate what has already been concluded - a settings change, or
   * the user asking for a restart - since the reuse below is keyed on content, which a settings
   * change does not alter.
   */
  refreshNow(document: vscode.TextDocument, force = false): void {
    const config = this.getConfig(document.uri);
    if (config.lintRun === 'off') {
      // Disarming matters: lint() deliberately does not re-check lintRun, because `Haml: Lint File`
      // has to run whatever the setting says. A timer left armed here would fire a moment later and
      // repopulate the panel the user just switched off - and so would a run already in flight,
      // whose staleness check has nothing to trip on (same version, same generation). discard()
      // cancels that run and drops its generation, so its result can never publish. Not forget():
      // every save comes through here, and lifting the timeout back-off each time would make
      // format-on-save spend the whole timeout again on a file it has already given up on. A forced
      // request still lifts it, as it does with diagnostics on: the settings or rules just changed,
      // or the user asked for a restart, and the formatter is the one run this document still gets.
      if (force) {
        this.client.forget(document.uri);
      }
      this.discard(document);
      return;
    }
    this.detached('lint', this.lint(document, config, force));
  }

  /** Called by the formatter with the text its edit will produce, in place of publishing. */
  expectEdit(document: vscode.TextDocument, text: string): void {
    this.awaitedText.set(document.uri.toString(), digestOf(text));
  }

  /**
   * Called on every content change, which is how a format edit landing is noticed: a command and a
   * manual Format Document are followed by no save to hang this on.
   *
   * The first change decides. VS Code drops a formatting result when the buffer has moved on, so
   * what arrives may be the user's typing instead, and under onSave that must not start a lint.
   */
  settle(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const awaited = this.awaitedText.get(key);
    if (awaited === undefined) {
      return;
    }
    this.awaitedText.delete(key);
    if (awaited === digestOf(document.getText())) {
      this.refreshNow(document);
    }
  }

  /** Called on every keystroke; only acts when the user opted into onType. */
  refreshDebounced(document: vscode.TextDocument): void {
    const config = this.getConfig(document.uri);
    const key = document.uri.toString();
    // Before the guard, so switching away from onType also disarms whatever is already pending.
    this.cancelDebounce(key);
    if (config.lintRun !== 'onType') {
      return;
    }
    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        this.detached('lint', this.lint(document, this.getConfig(document.uri)));
      }, config.lintDebounceMs)
    );
  }

  private cancelDebounce(key: string): void {
    const timer = this.debounceTimers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.debounceTimers.delete(key);
    }
  }

  /**
   * Runs background work whose failure would otherwise be invisible.
   *
   * lint() builds vscode.Diagnostic, Range and Uri.parse from a report a workspace executable
   * produced, so a throw here is an unhandled rejection: a "the extension crashed" notification with
   * nothing in the output channel to explain it.
   */
  private detached(what: string, work: Promise<unknown>): void {
    void work.catch((error: unknown) => {
      this.logger.error(`${what} failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  /**
   * Publishes diagnostics from a report another path already produced, e.g. format-on-save.
   *
   * `source` is the document text the report describes, and is not optional: it is what lets the save
   * that follows a format-on-save reuse this report instead of starting a second Ruby process.
   */
  publish(document: vscode.TextDocument, offenses: Parameters<typeof mapOffenses>[0], source: string): void {
    if (document.isClosed) {
      return;
    }
    // Checked here rather than only in lint(), because the formatter publishes through this method
    // too: `haml.lint.exclude` has to keep a file out of the panel whichever run produced the report.
    if (isExcluded(document, this.getConfig(document.uri).lintExclude)) {
      return;
    }
    const specs = mapOffenses(offenses, snapshotOf(document));
    this.collection.set(
      document.uri,
      specs.map((spec) => {
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(spec.start.line, spec.start.character, spec.end.line, spec.end.character),
          spec.message,
          toSeverity(spec.severity)
        );
        diagnostic.source = DIAGNOSTIC_SOURCE;
        if (spec.code !== undefined) {
          diagnostic.code = { value: spec.code.value, target: vscode.Uri.parse(spec.code.target) };
        }
        return diagnostic;
      })
    );
    // After the collection, not before: the digest asserts "the panel shows this text's report", and
    // recording it first would let a throw above pin an empty panel as published forever.
    this.publishedFor.set(document.uri.toString(), digestOf(source));
  }

  clear(document: vscode.TextDocument): void {
    // Diagnostics that are gone are not a report anyone can reuse.
    this.publishedFor.delete(document.uri.toString());
    this.collection.delete(document.uri);
  }

  /** Cancels any in-flight run for a document and forgets its state, the timeout back-off included. */
  forget(document: vscode.TextDocument): void {
    this.client.forget(document.uri);
    this.discard(document);
  }

  /** Everything forget() does except lifting the back-off, which an ordinary save must not do. */
  private discard(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    this.publishedFor.delete(key);
    this.awaitedText.delete(key);
    // A run parked on the process runner's concurrency queue survives the cancel below unsettled;
    // left in the client's coalescing map it would swallow the first lint after a reopen, which
    // starts again at the version the dead run was keyed under.
    this.client.abandon(document.uri);
    this.cancelDebounce(key);
    const inFlight = this.cancellations.get(key);
    if (inFlight !== undefined) {
      inFlight.source.cancel();
      inFlight.source.dispose();
      this.cancellations.delete(key);
    }
    this.generations.delete(key);
    this.collection.delete(document.uri);
  }

  async lint(document: vscode.TextDocument, config: HamlConfig, force = false): Promise<void> {
    if (document.languageId !== HAML_LANGUAGE_ID) {
      return;
    }
    if (isExcluded(document, config.lintExclude)) {
      this.clear(document);
      return;
    }

    const key = document.uri.toString();
    const source = document.getText();
    if (force) {
      this.client.forget(document.uri);
    } else if (shouldReuseReport(this.publishedFor.get(key), source, force)) {
      // The diagnostics on screen were produced by haml-lint from exactly this text, under settings
      // that have not changed since - every path that changes them forces. Running again would spend
      // a Ruby boot to arrive at what is already displayed.
      return;
    }

    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);

    const version = document.version;
    const previous = this.cancellations.get(key);
    // A forced request also abandons a same-version run: it was started under settings or rule files
    // that just changed. Sharing its token source instead would leave whichever run finishes second
    // uncancellable, because the first one to return disposes the shared source.
    if (previous !== undefined && (previous.version !== version || force)) {
      previous.source.cancel();
      previous.source.dispose();
      this.cancellations.delete(key);
    }
    let entry = this.cancellations.get(key);
    if (entry === undefined) {
      entry = { version, source: new vscode.CancellationTokenSource() };
      this.cancellations.set(key, entry);
    }

    const result = await this.client.run(document, config, { mode: 'lint' }, entry.source.token, force);

    if (this.cancellations.get(key) === entry) {
      entry.source.dispose();
      this.cancellations.delete(key);
    }

    const stale = isStale({
      superseded: this.generations.get(key) !== generation,
      isClosed: document.isClosed,
      versionBefore: version,
      versionNow: document.version
    });
    if (stale) {
      // A newer request already owns this document, or the buffer moved on.
      return;
    }

    if (result.ok) {
      // `source` rather than a fresh getText(): it is the exact text handed to haml-lint, and the
      // version guard above has already established that the buffer still holds it.
      this.publish(document, result.outcome.report?.offenses ?? [], source);
      return;
    }

    if (result.reason === 'unparseable-report') {
      // Deliberately leaves the previous diagnostics in place: silently emptying the panel turns a
      // polluted stream into an unexplainable bug report.
      return;
    }
    if (result.reason === 'enoent') {
      // The result carries the command the run actually failed on: after the client's bundler
      // retry that is the PATH executable, while re-resolving the config here would name the
      // bundle that worked. resolve() remains as the fallback for results built without one.
      this.detached('the missing-executable notice', this.notice.show(result.command ?? this.client.resolve(document, config).command));
    }
    this.clear(document);
  }

  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    for (const entry of this.cancellations.values()) {
      entry.source.cancel();
      entry.source.dispose();
    }
    this.cancellations.clear();
    this.generations.clear();
    this.publishedFor.clear();
    this.awaitedText.clear();
    this.collection.dispose();
  }
}
