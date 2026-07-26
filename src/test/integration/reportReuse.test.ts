import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { CapabilityCache, type VersionProbe } from '../../capabilities';
import type { LintRunner, RunResult } from '../../client';
import { DiagnosticsController } from '../../diagnostics';
import { HamlFormattingEditProvider } from '../../formatter';
import type { Invocation } from '../../hamlLint/executable';
import { Logger } from '../../logger';
import { MissingExecutableNotice } from '../../missingExecutableNotice';
import type { HamlLintReport } from '../../types';
import { config, INVOCATION, memento, stubLintRunner } from '../support/doubles';
import { openView } from '../support/host';

const ONE_OFFENSE: HamlLintReport = {
  offenses: [{ line: 1, severity: 'warning', message: 'Line is too long', linterName: 'LineLength' }]
};

/** A probe that answers without a process, so resolveFormatterMode settles on `safe`. */
function capabilities(logger: Logger): CapabilityCache {
  const probe: VersionProbe = {
    resolve: (): Invocation => INVOCATION,
    async probeVersion() {
      return [0, 76, 0];
    }
  };
  return new CapabilityCache(probe, logger);
}

// With the shipped defaults - configurationDefaults turns editor.formatOnSave on and lint.run is
// onSave - a single save ran haml-lint twice: once through the formatter and once more through
// onDidSaveTextDocument. Both are full Ruby boots, which is the whole cost of a run.
suite('report reuse Test Suite', () => {
  let logger: Logger;

  setup(() => {
    logger = new Logger();
  });

  teardown(() => {
    logger.dispose();
  });

  /** Nothing here reaches a missing executable; the notice is only what the controller needs to exist. */
  function notice(): MissingExecutableNotice {
    return new MissingExecutableNotice(logger, memento());
  }

  test('should not run again when the report on screen was produced from the same text', async () => {
    const runner = stubLintRunner(() => ({ ok: true, outcome: { report: ONE_OFFENSE } }));
    const controller = new DiagnosticsController(runner, logger, () => config(), notice());
    const document = await openView('offenses.haml');

    await controller.lint(document, config());
    await controller.lint(document, config());

    assert.strictEqual(runner.modes.length, 1, 'the second lint of unchanged text must reuse the published report');
    controller.dispose();
  });

  // The path that actually matters: the formatter already linted the corrected document, so the save
  // that follows must not start a second process to learn the same thing.
  test('should not run again on save after the formatter published for the same text', async () => {
    const runner = stubLintRunner((mode) =>
      mode === 'lint'
        ? { ok: true, outcome: { report: ONE_OFFENSE } }
        : // Empty corrected source is haml-lint's normal "nothing to correct" answer, and the report
          // still arrives on stderr.
          { ok: true, outcome: { report: ONE_OFFENSE, correctedSource: '' } }
    );
    const controller = new DiagnosticsController(runner, logger, () => config(), notice());
    const formatter = new HamlFormattingEditProvider(runner, capabilities(logger), controller, logger, () => config());
    const document = await openView('offenses.haml');

    const edit = await formatter.computeEdit(document);
    await controller.lint(document, config());

    assert.strictEqual(edit, null, 'an already-correct document yields no edit');
    assert.deepStrictEqual(runner.modes, ['format-and-lint'], 'the save lint must reuse the report the format pass already produced');
    assert.ok(
      vscode.languages.getDiagnostics(document.uri).some((diagnostic) => diagnostic.source === 'haml-lint'),
      'and the diagnostics must actually be on screen, not merely skipped'
    );
    controller.dispose();
  });

  // The format pass gets a report for free from the same process, but "no diagnostics" has to mean no
  // diagnostics whatever produced them. On save the entry was wiped again a moment later, which only
  // looked like a flicker; after Haml: Fix All, which no save event follows, it stayed on screen.
  test('should publish nothing when diagnostics are switched off', async () => {
    const off = config({ lintRun: 'off' });
    const runner = stubLintRunner(() => ({ ok: true, outcome: { report: ONE_OFFENSE, correctedSource: '' } }));
    const controller = new DiagnosticsController(runner, logger, () => off, notice());
    const formatter = new HamlFormattingEditProvider(runner, capabilities(logger), controller, logger, () => off);
    const document = await openView('clean.haml');
    controller.clear(document);

    await formatter.computeEdit(document);

    assert.deepStrictEqual(
      vscode.languages.getDiagnostics(document.uri).filter((diagnostic) => diagnostic.source === 'haml-lint'),
      [],
      'haml.lint.run: "off" must leave the Problems panel alone'
    );
    controller.dispose();
  });

  test('should still correct the document when diagnostics are switched off', async () => {
    const off = config({ lintRun: 'off' });
    const runner = stubLintRunner(() => ({
      ok: true,
      outcome: { report: ONE_OFFENSE, correctedSource: '%p corrected\n' }
    }));
    const controller = new DiagnosticsController(runner, logger, () => off, notice());
    const formatter = new HamlFormattingEditProvider(runner, capabilities(logger), controller, logger, () => off);
    const document = await openView('clean.haml');

    const edit = await formatter.computeEdit(document);

    assert.notStrictEqual(edit, null, 'switching diagnostics off must not switch formatting off with them');
    controller.dispose();
  });

  test('should run again once the text changes', async () => {
    const runner = stubLintRunner(() => ({ ok: true, outcome: { report: ONE_OFFENSE } }));
    const controller = new DiagnosticsController(runner, logger, () => config(), notice());
    const first = await openView('offenses.haml');
    const second = await openView('clean.haml');

    await controller.lint(first, config());
    await controller.lint(second, config());

    assert.strictEqual(runner.modes.length, 2, 'different text must be linted');
    controller.dispose();
  });

  test('should run again when forced', async () => {
    const runner = stubLintRunner(() => ({ ok: true, outcome: { report: ONE_OFFENSE } }));
    const controller = new DiagnosticsController(runner, logger, () => config(), notice());
    const document = await openView('offenses.haml');

    await controller.lint(document, config());
    await controller.lint(document, config(), true);

    assert.strictEqual(runner.modes.length, 2, 'Haml: Lint File must always run');
    assert.strictEqual(runner.forgotten, 1, 'and must lift the timeout back-off too');
    controller.dispose();
  });

  // Diagnostics that are gone are not a report anyone can reuse.
  test('should run again after the diagnostics were cleared', async () => {
    const runner = stubLintRunner(() => ({ ok: true, outcome: { report: ONE_OFFENSE } }));
    const controller = new DiagnosticsController(runner, logger, () => config(), notice());
    const document = await openView('offenses.haml');

    await controller.lint(document, config());
    controller.clear(document);
    await controller.lint(document, config());

    assert.strictEqual(runner.modes.length, 2);
    controller.dispose();
  });

  test('should run again after the document was forgotten', async () => {
    const runner = stubLintRunner(() => ({ ok: true, outcome: { report: ONE_OFFENSE } }));
    const controller = new DiagnosticsController(runner, logger, () => config(), notice());
    const document = await openView('offenses.haml');

    await controller.lint(document, config());
    controller.forget(document);
    await controller.lint(document, config());

    assert.strictEqual(runner.modes.length, 2);
    assert.strictEqual(runner.forgotten, 1, 'closing a document must release the client state it holds');
    controller.dispose();
  });

  // A failed run publishes nothing, so nothing may be reused: the next attempt has to be a real one.
  test('should run again after a failure', async () => {
    let attempts = 0;
    const runner = stubLintRunner(() => {
      attempts++;
      return attempts === 1 ? { ok: false, kind: 'failed', reason: 'timeout' } : { ok: true, outcome: { report: ONE_OFFENSE } };
    });
    const controller = new DiagnosticsController(runner, logger, () => config(), notice());
    const document = await openView('offenses.haml');

    await controller.lint(document, config());
    await controller.lint(document, config());

    assert.strictEqual(runner.modes.length, 2);
    controller.dispose();
  });

  // haml.lint.exclude has to keep a file out of the panel whichever run produced the report; the
  // formatter publishes through the same method the lint path uses.
  test('should not record a report published for an excluded document', async () => {
    const runner = stubLintRunner(() => ({ ok: true, outcome: { report: ONE_OFFENSE } }));
    let current = config({ lintExclude: ['**/offenses.haml'] });
    const controller = new DiagnosticsController(runner, logger, () => current, notice());
    const document = await openView('offenses.haml');

    controller.publish(document, ONE_OFFENSE.offenses, document.getText());

    // Had the excluded publish recorded its digest, this lint of identical text would reuse and skip.
    current = config();
    await controller.lint(document, current);
    assert.strictEqual(runner.modes.length, 1, 'the excluded publish must leave nothing to reuse');
    controller.dispose();
  });

  // Switching lint.run off disarms the debounce timer, but a run already in flight has nothing to
  // trip its staleness check on - same version, same generation. Its result must not repopulate the
  // panel the user just switched off, and must not leave a digest behind that a later lint would
  // mistake for a published report.
  test('should discard a run that was in flight when lint.run switched off', async () => {
    let resolveFirst: ((result: RunResult) => void) | undefined;
    let calls = 0;
    const runner: LintRunner = {
      resolve: (): Invocation => INVOCATION,
      forget: (): void => undefined,
      abandon: (): void => undefined,
      run: (): Promise<RunResult> => {
        calls++;
        if (calls === 1) {
          return new Promise<RunResult>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve({ ok: true, outcome: { report: ONE_OFFENSE } });
      }
    };
    let current = config();
    const controller = new DiagnosticsController(runner, logger, () => current, notice());
    const document = await openView('offenses.haml');

    const inFlight = controller.lint(document, current);
    current = config({ lintRun: 'off' });
    controller.refreshNow(document);
    resolveFirst?.({ ok: true, outcome: { report: ONE_OFFENSE } });
    await inFlight;

    // Behavioural probe: had the abandoned run published, its digest would make this reuse and skip.
    current = config();
    await controller.lint(document, current);
    assert.strictEqual(calls, 2, 'the run cancelled by switching off must not leave a reusable report behind');
    controller.dispose();
  });
});
