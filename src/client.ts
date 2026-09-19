// Orchestrates a single haml-lint run for a document: resolve, spawn, interpret.
//
// Lives outside src/hamlLint because it touches vscode (workspace folders, documents, tokens).
// Everything it decides is delegated to the pure modules there; what is left is request coalescing,
// the back-off bookkeeping and the logging.

import * as path from 'node:path';
import * as vscode from 'vscode';
import { buildAutocorrectArgs, buildLintArgs, buildVersionArgs } from './hamlLint/args';
import { type BackOffUpdate, backOffUpdateFor, shouldSkipForBackOff, type TimeoutRecord } from './hamlLint/backOff';
import { applyCmdWrapper } from './hamlLint/cmdWrapper';
import { classifyDocument } from './hamlLint/eligibility';
import { buildEnv } from './hamlLint/env';
import { type Invocation, type ResolveDeps, resolveConfigPath, resolveInvocation, stdinPathFor } from './hamlLint/executable';
import { classifyExitCode } from './hamlLint/exitCodes';
import { failure, interpretResult, isSkip, looksLikeMissingGem, type RunFailureReason, type RunRequest, type RunResult } from './hamlLint/outcome';
import type { ProcessRunner, SpawnResult } from './hamlLint/process';
import { parseVersion, type SemVerTriple } from './hamlLint/version';
import type { Logger } from './logger';
import type { HamlConfig } from './types';

const SLOW_RUN_MS = 3000;

export type { RunOutcome, RunRequest, RunResult } from './hamlLint/outcome';

/** The slice of HamlLintClient the diagnostics layer needs. Narrow so it can be faked in tests. */
export interface LintRunner {
  resolve(document: vscode.TextDocument, config: HamlConfig): Invocation;
  run(document: vscode.TextDocument, config: HamlConfig, request: RunRequest, token?: vscode.CancellationToken, force?: boolean): Promise<RunResult>;
  forget(uri: vscode.Uri): void;
  abandon(uri: vscode.Uri): void;
}

/** `null` for a buffer with no path of its own, which is what stdinPathFor expects. */
function fsPathOf(uri: vscode.Uri): string | null {
  return uri.scheme === 'file' ? uri.fsPath : null;
}

/**
 * getWorkspaceFolder matches by uri prefix, so it never matches `untitled:` - which would make the
 * eligibility rule "untitled needs a workspace folder" unsatisfiable and untitled linting dead code.
 * An untitled buffer belongs to the window, and the window's first folder is the conventional home.
 */
function workspaceFolderFor(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (folder !== undefined) {
    return folder;
  }
  return uri.scheme === 'untitled' ? vscode.workspace.workspaceFolders?.[0] : undefined;
}

export class HamlLintClient {
  private readonly inFlight = new Map<string, Promise<RunResult>>();
  private readonly slowWarned = new Set<string>();
  /** Documents a run has already timed out on. See src/hamlLint/backOff.ts for why. */
  private readonly timedOut = new Map<string, TimeoutRecord>();

  constructor(
    private readonly runner: ProcessRunner,
    private readonly logger: Logger,
    private readonly deps: ResolveDeps
  ) {}

  /** Resolves how haml-lint would be invoked for this document, without running it. */
  resolve(document: vscode.TextDocument, config: HamlConfig): Invocation {
    const folder = workspaceFolderFor(document.uri);
    // Not stdinPathFor: that one needs the cwd this call is about to derive, so it cannot be used
    // to derive it. The fallback differs for the same reason - there is no cwd yet to fall back to.
    const documentPath = fsPathOf(document.uri) ?? path.join(folder?.uri.fsPath ?? process.cwd(), 'untitled.haml');
    return resolveInvocation(
      {
        documentPath,
        workspaceFolderPath: folder?.uri.fsPath,
        executablePath: config.executablePath,
        useBundler: config.useBundler
      },
      this.deps
    );
  }

  /**
   * Whether a version probe for this document could ever be used.
   *
   * A document with neither a path of its own nor a workspace folder is one classifyDocument
   * refuses, so the probe's answer would go unused - and resolve() would fall back to the
   * extension host's own cwd, spawning in (and under bundler, evaluating a Gemfile from) a
   * directory unrelated to anything the user opened.
   */
  canProbe(document: vscode.TextDocument): boolean {
    return fsPathOf(document.uri) !== null || workspaceFolderFor(document.uri) !== undefined;
  }

  /** Probes `haml-lint --version`. Returns null when the executable is missing or unreadable. */
  async probeVersion(document: vscode.TextDocument, config: HamlConfig, token?: vscode.CancellationToken): Promise<SemVerTriple | null> {
    // The capability cache refuses before building a cache key; checked again here so the guard
    // cannot be bypassed by a future caller reaching the probe directly.
    if (!this.canProbe(document)) {
      return null;
    }
    let invocation = this.resolve(document, config);
    let result = await this.spawn(invocation, buildVersionArgs(), '', config, token);
    // The same fallback execute() applies: without it, a lock file naming haml_lint in a bundle
    // that was never installed leaves lint working through PATH while `formatter: "auto"` silently
    // resolves to none, because only the probe kept failing through bundler.
    if (invocation.usesBundler && looksLikeMissingGem(result)) {
      this.logger.warn(`bundle exec could not find haml_lint; probing the executable on PATH instead. ${result.ok ? result.stderr.trim() : ''}`);
      invocation = this.resolve(document, { ...config, useBundler: 'never' });
      result = await this.spawn(invocation, buildVersionArgs(), '', config, token);
    }
    if (!result.ok || classifyExitCode(result.code).kind !== 'report') {
      return null;
    }
    return parseVersion(result.stdout) ?? parseVersion(result.stderr);
  }

  /**
   * Runs haml-lint for a document, coalescing identical concurrent requests.
   *
   * The key includes the document version, so format-on-save and a source.fixAll code action for
   * the same save share one Ruby process instead of starting two. The parts are joined with a NUL
   * byte because it cannot appear in any of them, so no combination of values can collide.
   *
   * `force` skips the lookup: the settings or rule files just changed, so a run already in flight
   * was spawned under the old ones and its answer must not be handed to the request that exists to
   * replace it. The fresh promise overwrites the map entry, so later same-key callers join the run
   * that reflects the new state.
   */
  run(document: vscode.TextDocument, config: HamlConfig, request: RunRequest, token?: vscode.CancellationToken, force = false): Promise<RunResult> {
    const formatter = request.mode === 'lint' ? '' : request.formatter;
    const key = `${document.uri.toString()}\u0000${document.version}\u0000${request.mode}\u0000${formatter}`;
    if (!force) {
      const existing = this.inFlight.get(key);
      if (existing !== undefined) {
        return existing;
      }
    }
    const promise = this.execute(document, config, request, token).finally(() => {
      // Only the entry this promise owns: a forced run may have overwritten it, and the abandoned
      // run finishing later must not delete the fresh entry out from under its coalesced callers.
      if (this.inFlight.get(key) === promise) {
        this.inFlight.delete(key);
      }
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  /** Drops the timeout back-off for a document, so an explicit user action always runs. */
  forget(uri: vscode.Uri): void {
    this.timedOut.delete(uri.toString());
  }

  /**
   * Drops every in-flight entry for a document, whatever version or mode it was keyed under.
   *
   * For the close of a document: its runs are cancelled, but one still parked on the process
   * runner's concurrency queue stays unsettled until a slot frees. Reopening restarts versions at
   * 1, so the first lint of the reopened document would coalesce onto that dead run and be answered
   * 'cancelled' without a spawn - publishing nothing until the next edit. Deleting up front is safe
   * because the settle handler in run() only deletes the entry it still owns. Separate from
   * forget() because the force paths call that while counting on run(force) to replace entries.
   */
  abandon(uri: vscode.Uri): void {
    const prefix = `${uri.toString()}\u0000`;
    for (const key of this.inFlight.keys()) {
      if (key.startsWith(prefix)) {
        this.inFlight.delete(key);
      }
    }
  }

  /** Settings changed, so advice keyed on the previous ones is worth giving again. */
  resetNotices(): void {
    this.slowWarned.clear();
  }

  private async execute(
    document: vscode.TextDocument,
    config: HamlConfig,
    request: RunRequest,
    token?: vscode.CancellationToken
  ): Promise<RunResult> {
    const source = document.getText();
    const folder = workspaceFolderFor(document.uri);
    const eligibility = classifyDocument({
      scheme: document.uri.scheme,
      languageId: document.languageId,
      isClosed: document.isClosed,
      textLength: source.length,
      hasWorkspaceFolder: folder !== undefined
    });
    if (!eligibility.ok) {
      return failure('not-eligible', eligibility.reason);
    }

    const documentKey = document.uri.toString();
    if (shouldSkipForBackOff(this.timedOut.get(documentKey), source.length, config.timeoutMs)) {
      return failure('timed-out-before', 'a previous run timed out on this document');
    }

    const workspaceFolderPath = folder?.uri.fsPath;
    let invocation = this.resolve(document, config);
    const args = this.buildArgs(request, invocation.cwd, document, config, workspaceFolderPath);
    let result = await this.spawn(invocation, args, source, config, token);

    // `bundle exec haml-lint` when the gem is not in the bundle fails with a non-zero exit and a
    // message on stderr, not ENOENT, so it never reaches the missing-executable path.
    if (invocation.usesBundler && looksLikeMissingGem(result)) {
      this.logger.warn(`bundle exec could not find haml_lint; retrying with the executable on PATH. ${result.ok ? result.stderr.trim() : ''}`);
      invocation = this.resolve(document, { ...config, useBundler: 'never' });
      const retryArgs = this.buildArgs(request, invocation.cwd, document, config, workspaceFolderPath);
      result = await this.spawn(invocation, retryArgs, source, config, token);
    }

    this.applyBackOff(documentKey, document, backOffUpdateFor(result, source.length, config.timeoutMs), config.timeoutMs);

    // `invocation` is the retried one when the missing-gem path ran, which is the command an exit
    // 127 has to be reported against.
    const interpreted = interpretResult(result, request.mode, invocation.command);
    if (!interpreted.ok) {
      this.logFailure(interpreted.reason, interpreted.detail, result, request.mode);
    }
    return interpreted;
  }

  private applyBackOff(documentKey: string, document: vscode.TextDocument, update: BackOffUpdate, timeoutMs: number): void {
    if (update.kind === 'clear') {
      this.timedOut.delete(documentKey);
      return;
    }
    if (update.kind === 'keep') {
      return;
    }
    this.timedOut.set(documentKey, update.record);
    this.logger.warn(
      `haml-lint timed out after ${timeoutMs}ms on ${path.basename(document.uri.path)} (${Math.round(update.record.bytes / 1024)} KB). ` +
        'Automatic runs for it are paused until it is smaller, "haml.hamlLint.timeoutMs" is raised, or "Haml: Lint File" is run. ' +
        'haml-lint costs disproportionately more on a large file, so retrying on every save would only burn the same time again.'
    );
  }

  /**
   * Interpretation says what happened; this decides how loudly to say it.
   *
   * A skip is the extension's own decision and gets nothing: `cancelled` alone would otherwise put
   * a line in the output channel on most keystrokes under onType. Every other failure leaves at
   * least one line: for spawn-error and overflow the detail is the only evidence there is, and
   * stderr is usually empty, so a run that produced no diagnostics stayed wholly unexplained.
   */
  private logFailure(reason: RunFailureReason, detail: string | undefined, result: SpawnResult, mode: RunRequest['mode']): void {
    if (isSkip(reason)) {
      return;
    }
    if (reason === 'unparseable-report') {
      this.logger.warn(detail ?? 'could not parse the haml-lint report; keeping the previous diagnostics');
      // The stream the report was expected on. In a format run that is stderr, and stdout is the
      // user's own document - which explains nothing and does not belong in a log.
      this.logger.detail('raw output', result.ok && mode === 'lint' ? result.stdout || result.stderr : result.stderr);
      return;
    }
    // A timeout's line is the back-off warning applyBackOff just wrote, with the size and the
    // remedy; a second, generic line here would say less than the one above it.
    if (reason !== 'timeout') {
      this.logger.error(detail ?? `haml-lint failed (${reason})`);
    }
    if (result.stderr.trim() !== '') {
      this.logger.detail('stderr', result.stderr);
    }
  }

  private buildArgs(
    request: RunRequest,
    cwd: string,
    document: vscode.TextDocument,
    config: HamlConfig,
    workspaceFolderPath: string | undefined
  ): string[] {
    const configPath = resolveConfigPath(config.configPath, workspaceFolderPath, this.deps.platform);
    const stdinPath = stdinPathFor(fsPathOf(document.uri), cwd, this.deps.platform);
    if (request.mode === 'lint') {
      return buildLintArgs({ stdinPath, configPath });
    }
    return buildAutocorrectArgs({ mode: request.formatter, stdinPath, configPath });
  }

  private async spawn(
    invocation: Invocation,
    args: readonly string[],
    stdin: string,
    config: HamlConfig,
    token?: vscode.CancellationToken
  ): Promise<SpawnResult> {
    const fullArgs = [...invocation.argsPrefix, ...args];
    const wrapped = applyCmdWrapper(invocation.command, fullArgs, invocation.needsCmdWrapper, process.env.ComSpec, process.env.SystemRoot);
    this.logger.command(wrapped.command, wrapped.args, invocation.cwd);

    const result = await this.runner.run(
      {
        command: wrapped.command,
        args: wrapped.args,
        cwd: invocation.cwd,
        stdin,
        env: buildEnv(process.env, { bundleGemfile: invocation.bundleGemfile }),
        timeoutMs: config.timeoutMs,
        windowsVerbatimArguments: wrapped.windowsVerbatimArguments,
        // The runner answers ENOENT for this without spawning, after its trust and cancellation
        // checks - so an unresolved command in an untrusted workspace stays a silent skip.
        commandMissing: invocation.commandMissing
      },
      token
    );

    if (result.ok && result.durationMs > SLOW_RUN_MS && !this.slowWarned.has(invocation.command)) {
      this.slowWarned.add(invocation.command);
      this.logger.warn(
        `haml-lint took ${result.durationMs}ms. If this is slow for you, a globally installed haml-lint is usually 3-5x faster than bundle exec; set "haml.hamlLint.useBundler": "never".`
      );
    }
    return result;
  }
}
