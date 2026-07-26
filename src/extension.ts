// Extension entry point: registration, wiring, and disposal.

import * as vscode from 'vscode';
import { DataAttributeCompletionProvider } from './attributeCompletions';
import { CapabilityCache } from './capabilities';
import { HamlLintClient } from './client';
import { HamlCodeActionProvider } from './codeActions';
import { registerCommands } from './commands';
import { RailsDetectionCache, RailsSnippetCompletionProvider } from './completions';
import { CONFIG_SECTION, loadConfig } from './config';
import { DiagnosticsController } from './diagnostics';
import { HamlFormattingEditProvider } from './formatter';
import { isHamlDocument, openHamlDocuments } from './hamlDocuments';
import { HAML_LANGUAGE_ID } from './hamlLint/eligibility';
import { CONFIG_FILE_NAME } from './hamlLint/executable';
import { createProcessRunner, type DisposableProcessRunner } from './hamlLint/process';
import { Logger } from './logger';
import { MissingExecutableNotice } from './missingExecutableNotice';
import { nodeResolveDeps } from './nodeDeps';
import { PartialCompletionProvider, PartialDefinitionProvider } from './partials';
import { GEMFILE_LOCK_NAME } from './pure/fsWalk';
import { APPLICATION_RB_SEGMENTS } from './pure/railsDetection';
import { registerRefactorCommands } from './refactorCommands';

/** Formatting and code actions only apply where a local process can see the file. */
const HAML_SELECTOR: vscode.DocumentSelector = [
  { language: HAML_LANGUAGE_ID, scheme: 'file' },
  { language: HAML_LANGUAGE_ID, scheme: 'untitled' }
];

/**
 * Held outside activate() so deactivate() can reach it. Not every spawn has a CancellationToken to
 * cancel through - the fix-all command and the version probe do not - so shutdown needs an explicit
 * kill rather than relying on subscriptions alone. The runner is *also* a subscription, so a second
 * activate() cannot orphan the first runner's children; dispose() is idempotent.
 */
let runnerToDispose: DisposableProcessRunner | undefined;

function watchFiles(pattern: string, onChange: () => void): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);
  watcher.onDidCreate(onChange);
  watcher.onDidChange(onChange);
  watcher.onDidDelete(onChange);
  return watcher;
}

/** `bundle install` fires create+change per lock in a burst; one forced sweep at the end is enough. */
const LOCK_SWEEP_DELAY_MS = 500;

function trailingDebounce(action: () => void, delayMs: number): vscode.Disposable & { schedule(): void } {
  let timer: NodeJS.Timeout | undefined;
  return {
    schedule(): void {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = undefined;
        action();
      }, delayMs);
    },
    dispose(): void {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    }
  };
}

export function activate(context: vscode.ExtensionContext): void {
  const logger = new Logger();
  context.subscriptions.push(logger);

  // Trust is injected rather than read inside the process layer, so src/hamlLint stays free of the
  // vscode module and the gate cannot be bypassed by a call site.
  const runner = createProcessRunner({ isTrusted: () => vscode.workspace.isTrusted });
  const fsDeps = nodeResolveDeps();
  const client = new HamlLintClient(runner, logger, fsDeps);
  context.subscriptions.push(runner);
  runnerToDispose = runner;

  const getConfig = (resource: vscode.Uri) => loadConfig(resource);
  const missingExecutable = new MissingExecutableNotice(logger, context.workspaceState);
  const diagnostics = new DiagnosticsController(client, logger, getConfig, missingExecutable);
  const capabilities = new CapabilityCache(client, logger);
  context.subscriptions.push(diagnostics, capabilities);

  const formatter = new HamlFormattingEditProvider(client, capabilities, diagnostics, logger, getConfig);
  const codeActions = new HamlCodeActionProvider(formatter, getConfig);
  // Snippets are declared as working everywhere, including virtual and untrusted workspaces, so
  // this one selector is broader than HAML_SELECTOR: no process is ever started for a completion.
  const railsCache = new RailsDetectionCache(fsDeps);
  const completions = new RailsSnippetCompletionProvider(railsCache, getConfig);
  // Partial navigation reads file names off the disk, so it needs the narrower selector even though
  // it starts no process: HAML_SELECTOR is the line between "resolves a real path" and "does not".
  const partialDefinitions = new PartialDefinitionProvider(fsDeps);
  const partialCompletions = new PartialCompletionProvider(getConfig, fsDeps.platform);
  const attributeCompletions = new DataAttributeCompletionProvider(getConfig);

  const reconsider = (document: vscode.TextDocument, force = false): void => {
    diagnostics.refreshNow(document, force);
    // Warms the version probe in the background so the first save is not stuck behind two
    // consecutive `bundle exec` cold starts. Unconditional because prime() is already a no-op unless
    // haml.formatter is "auto", which is what keeps "none plus lint.run off spawns nothing" true.
    capabilities.prime(document, getConfig(document.uri));
  };

  /**
   * Every path that has to reconsider open documents goes through here.
   *
   * Three of the five sites this replaces called only refreshNow, so a document that was already
   * open when the extension activated - or when trust was granted - never got its version probe
   * warmed until its first save.
   */
  const sweep = (reason: string, force: boolean): void => {
    logger.info(`${reason}; re-linting open Haml documents`);
    for (const document of openHamlDocuments()) {
      reconsider(document, force);
    }
  };

  const lockSweep = trailingDebounce(() => sweep('Gemfile.lock changed', true), LOCK_SWEEP_DELAY_MS);

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(HAML_SELECTOR, formatter),
    vscode.languages.registerCodeActionsProvider(HAML_SELECTOR, codeActions, HamlCodeActionProvider.metadata),
    vscode.languages.registerCompletionItemProvider(HAML_LANGUAGE_ID, completions),
    vscode.languages.registerDefinitionProvider(HAML_SELECTOR, partialDefinitions),
    // Trigger characters are per registration, which is why this cannot join the snippet provider
    // above. They are needed at all because the grammar hands `= render '...'` to source.ruby, so the
    // name is a Ruby string token and editor.quickSuggestions.strings defaults to off.
    vscode.languages.registerCompletionItemProvider(HAML_SELECTOR, partialCompletions, "'", '"'),
    // No trigger characters here: an attribute name is not a string token, so the default
    // editor.quickSuggestions.other already opens the widget. Declaring '-' would also drag the
    // contributed Haml snippets in on every `- if`, since the trigger path always includes them.
    vscode.languages.registerCompletionItemProvider(HAML_LANGUAGE_ID, attributeCompletions),
    ...registerCommands({ diagnostics, formatter, capabilities, logger, getConfig, sweep }),
    ...registerRefactorCommands({ logger, fs: fsDeps })
  );

  /**
   * Re-lints every open Haml document, forced.
   *
   * Forced because the report already published for a document is keyed on its content, which a
   * changed rule does not alter, and because a document that timed out deserves another chance under
   * rules that may well be cheaper.
   */
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (isHamlDocument(document)) {
        reconsider(document);
      }
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (isHamlDocument(document)) {
        diagnostics.refreshNow(document);
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (isHamlDocument(event.document)) {
        diagnostics.refreshDebounced(event.document);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (isHamlDocument(document)) {
        diagnostics.forget(document);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(CONFIG_SECTION)) {
        capabilities.invalidate();
        missingExecutable.reset();
        // The slow-run advice names a setting the user may have just changed, so it is worth giving
        // again rather than staying silenced for the rest of the session.
        client.resetNotices();
        // Forced: both the report already published for a document and the back-off recorded for one
        // that timed out were formed under the settings that just changed.
        sweep('settings changed', true);
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      capabilities.invalidate();
      railsCache.invalidate();
      // Forced for the same reason the config watchers force: the folder set moves cwd boundaries
      // and lock discovery, which change the answer without changing any text - and the report
      // reuse below is keyed on text alone.
      sweep('workspace folders changed', true);
    }),
    lockSweep,
    // A changed lock file can flip the extension between bundle exec and the executable on PATH,
    // and can add or remove rails, which is what the Rails snippet detection looks for. The caches
    // drop immediately; only the re-lint is debounced.
    watchFiles(`**/${GEMFILE_LOCK_NAME}`, () => {
      capabilities.invalidate();
      railsCache.invalidate();
      lockSweep.schedule();
    }),
    // The other Rails signal. `rails new --skip-bundle` writes this and no lock file, so without
    // watching it the "not a Rails project" verdict would stick for the rest of the session.
    watchFiles(`**/${APPLICATION_RB_SEGMENTS.join('/')}`, () => railsCache.invalidate()),
    // Neither of these is a VS Code setting, so onDidChangeConfiguration never fires for them.
    // .rubocop.yml counts because haml-lint delegates its Ruby cops to RuboCop, so a rule changed
    // there changes the offenses reported for a Haml file just as much.
    watchFiles(`**/${CONFIG_FILE_NAME}`, () => sweep('.haml-lint.yml changed', true)),
    watchFiles('**/.rubocop.yml', () => sweep('.rubocop.yml changed', true))
  );

  // Granting trust mid-session must not require a reload.
  if (typeof vscode.workspace.onDidGrantWorkspaceTrust === 'function') {
    context.subscriptions.push(
      // Not forced: nothing already concluded was wrong, there simply was not a run before.
      vscode.workspace.onDidGrantWorkspaceTrust(() => sweep('workspace trust granted', false))
    );
  }

  sweep('extension activated', false);
}

export function deactivate(): void {
  // VS Code awaits this, which is the one chance to stop children that no token covers.
  runnerToDispose?.dispose();
  runnerToDispose = undefined;
}
