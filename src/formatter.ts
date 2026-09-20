// DocumentFormattingEditProvider backed by haml-lint autocorrect.
//
// The provider is registered unconditionally. contributes.configurationDefaults points
// editor.defaultFormatter at this extension, and if no provider existed VS Code would answer a
// manual Format Document with "configured as formatter but it cannot format 'haml'-files".
// Deciding inside the call also means a settings change takes effect without a reload.

import * as vscode from 'vscode';
import type { CapabilityCache } from './capabilities';
import type { LintRunner } from './client';
import type { DiagnosticsController } from './diagnostics';
import { eolOf } from './documentSnapshot';
import { resolveFormatterMode } from './hamlLint/formatterMode';
import type { Logger } from './logger';
import { buildFormatEdit, restoreEol } from './pure/editBuilder';
import { isStale, shouldPublishReport } from './pure/publishDecision';
import type { HamlConfig, HamlLintReport } from './types';

export class HamlFormattingEditProvider implements vscode.DocumentFormattingEditProvider {
  constructor(
    private readonly client: LintRunner,
    private readonly capabilities: CapabilityCache,
    private readonly diagnostics: DiagnosticsController,
    private readonly logger: Logger,
    private readonly getConfig: (resource: vscode.Uri) => HamlConfig
  ) {}

  async provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    _options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): Promise<vscode.TextEdit[]> {
    try {
      const edit = await this.computeEdit(document, token);
      return edit === null ? [] : [edit];
    } catch (error) {
      // Rejecting here surfaces as an editor error on every save, because configurationDefaults
      // ships editor.formatOnSave: true. Formatting nothing is the better failure.
      this.logger.error(`formatting failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /** Shared with the fix-all command so both paths agree on the safety rules. */
  async computeEdit(document: vscode.TextDocument, token?: vscode.CancellationToken): Promise<vscode.TextEdit | null> {
    const config = this.getConfig(document.uri);
    const mode = await resolveFormatterMode(config.formatter, vscode.workspace.isTrusted, () => this.capabilities.version(document, config));
    if (mode === 'none') {
      return null;
    }

    const versionBefore = document.version;
    const original = document.getText();

    // Single pass: with --stdin and --stderr but without --auto-correct-only, haml-lint puts the
    // corrected source on stdout and the JSON report on stderr, so when there is nothing to correct -
    // every save but the first of a tidy file - one Ruby process serves both format-on-save and the
    // diagnostics that follow it.
    const result = await this.client.run(document, config, { mode: 'format-and-lint', formatter: mode }, token);

    if (!result.ok) {
      this.logger.info(`no formatting applied (${result.detail ?? result.reason})`);
      return null;
    }

    // Checked before anything is published, not just before the edit is returned: a report that
    // describes a buffer the user has already moved past must not reach the Problems panel.
    const stale = isStale({
      isClosed: document.isClosed,
      versionBefore,
      versionNow: document.version,
      superseded: token?.isCancellationRequested === true
    });
    if (stale) {
      this.logger.info('discarding formatting result because the document moved on');
      return null;
    }

    const eol = eolOf(document);
    const report = result.outcome.report;
    const corrected = result.outcome.correctedSource;
    if (corrected === undefined || corrected === '') {
      // Not defensive: haml-lint's write_to_disk! starts with `return unless @source_was_changed`,
      // so a document that needed no correction produces empty stdout. That is the normal path - and
      // the run still linted the document, so publishing here is what spares the save that follows a
      // second Ruby boot to reach the same report.
      this.publishReport(document, report, original, config);
      return null;
    }

    const spec = buildFormatEdit(original, corrected, eol);
    if (spec === null) {
      // buildFormatEdit returns null precisely when the corrected source restores to the original, so
      // no line moves and the report is as true of the buffer as it is on the path above.
      this.publishReport(document, report, original, config);
      return null;
    }

    // Nothing is published for a run that corrected something: its report is not a lint of the
    // corrected text, and that text is not in the buffer to map it onto until this edit is applied.
    // The edit landing starts the lint instead - see DiagnosticsController.awaitedText.
    this.diagnostics.expectEdit(document, restoreEol(corrected, eol));
    return vscode.TextEdit.replace(new vscode.Range(spec.start.line, spec.start.character, spec.end.line, spec.end.character), spec.newText);
  }

  /**
   * Publishes the report the format pass got for free, unless the user asked for no diagnostics.
   *
   * `haml.lint.run: "off"` has to mean no diagnostics whatever produced them. Without the check the
   * entry appeared anyway: on save it was wiped a moment later by the refresh that honours the
   * setting, which read as a flicker, and after `Haml: Fix All` - which no save event follows - it
   * simply stayed.
   */
  private publishReport(document: vscode.TextDocument, report: HamlLintReport | undefined, source: string, config: HamlConfig): void {
    if (!shouldPublishReport(report !== undefined, config.lintRun)) {
      return;
    }
    this.diagnostics.publish(document, report?.offenses ?? [], source);
  }
}
