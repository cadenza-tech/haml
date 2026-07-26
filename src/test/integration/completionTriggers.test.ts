import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { positionAfter } from '../support/editor';
import { activateExtension, fixtureUri } from '../support/host';
import { wait } from '../support/timing';

// The partial completion provider declares ' and " as trigger characters, because the grammar hands a
// partial name to source.ruby and editor.quickSuggestions.strings defaults to off, so nothing else
// would open the widget there. A trigger character is a per-registration argument, but the trigger path
// itself is VS Code's: it also folds in the built-in snippet support, and a Haml file is full of quotes.
//
// What keeps that from turning every quote into a popup is that no contributed Haml snippet starts with
// one and the word-based provider declares no trigger characters at all - neither of which is a contract
// this extension controls. So the outcome is pinned here rather than reasoned about.
//
// executeCompletionItemProvider cannot answer this: it asks every provider regardless of triggers, and
// whether the widget opens is SuggestModel's decision. So these tests type the character for real and
// then ask the widget to accept whatever it has selected. With no widget open that is a no-op. Nothing
// cheaper works either: a provider registered with no trigger characters of its own is not asked during
// a trigger character session, so one cannot be added here to watch a session start.

const FIXTURE = 'app/views/triggers.haml';
const POLL_INTERVAL_MS = 50;
/**
 * Ceiling for the control case, which polls rather than sleeping.
 *
 * Generous because it is free on a run that passes - the poll returns as soon as the widget opens,
 * which is well under a second on an idle host - while the first widget a cold one draws is bounded by
 * nothing this extension controls. The 5000ms this used to allow was exceeded on a machine still
 * scanning a freshly downloaded VS Code, and the run went red saying nothing about the code.
 */
const OPEN_DEADLINE_MS = 15000;
/** Ceiling for the diagnosis below, which runs only once the control's deadline has already expired. */
const CAPABILITY_DEADLINE_MS = 10000;
/**
 * How long the negative cases wait before concluding nothing opened. Derived from what the control
 * actually measured on this machine, so a slow host cannot turn them into silent passes; the floor
 * covers the case where the control opened almost instantly.
 *
 * The ceiling keeps a slow host from multiplying its way into mocha's timeout, and cannot make a
 * negative case vacuous: a regression they would catch opens the widget through the same trigger
 * character path the control just timed, so it shows up at around `elapsed`, not at five times it.
 */
const MIN_QUIET_MS = 1500;
const MAX_QUIET_MS = 10000;
const QUIET_MULTIPLIER = 5;

suite('completion trigger integration Test Suite', () => {
  let document: vscode.TextDocument;
  /** Measured by the control test, which runs first, and used as the negative cases' budget. */
  let quietBudgetMs = MIN_QUIET_MS;
  /** Set by the control when it never saw a widget, which leaves the negative cases nothing to stand on. */
  let widgetNeverOpened = false;

  suiteSetup(async () => {
    await activateExtension();
    document = await vscode.workspace.openTextDocument(fixtureUri(FIXTURE));
  });

  // Typing edits a checked-in fixture, so every test puts it back.
  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  });

  async function typeAt(prefix: string, character: string): Promise<string> {
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    const at = positionAfter(document, prefix);
    editor.selection = new vscode.Selection(at, at);
    await vscode.commands.executeCommand('type', { text: character });
    return document.getText();
  }

  async function accepted(): Promise<string> {
    await vscode.commands.executeCommand('acceptSelectedSuggestion');
    await wait(POLL_INTERVAL_MS * 4);
    return document.getText();
  }

  /** How long the accept probe took to insert something, or -1 if it never did. */
  async function pollUntilAccepted(typed: string, deadlineMs: number): Promise<number> {
    const started = Date.now();
    while (Date.now() - started < deadlineMs) {
      if ((await accepted()) !== typed) {
        return Date.now() - started;
      }
      await wait(POLL_INTERVAL_MS);
    }
    return -1;
  }

  /**
   * Whether this host draws a suggest widget at all, asked so that nothing in this extension can decide
   * the answer: an explicit trigger at the end of a prose line, where the only items on offer are the
   * editor's own word based ones and the typed space leaves them no prefix they have to match.
   *
   * Only the failure message depends on this. A host too loaded to draw a widget is still a failure -
   * skipping there would leave the suite green having measured nothing - but it is not the same failure
   * as the extension having stopped declaring its trigger characters, and saying which one it is saves
   * the next person the twenty minutes this cost.
   */
  async function hostCanShowWidget(): Promise<boolean> {
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    const typed = await typeAt('%p 1/2 and a - dash', ' ');
    await vscode.commands.executeCommand('editor.action.triggerSuggest');
    return (await pollUntilAccepted(typed, CAPABILITY_DEADLINE_MS)) >= 0;
  }

  // The control runs first for two reasons: without it the negative cases would also pass if typing
  // never opened anything in this host, and it is what measures how long the widget actually takes.
  test('should open the widget for a quote that starts a partial name', async () => {
    const typed = await typeAt('= render ', "'");
    const elapsed = await pollUntilAccepted(typed, OPEN_DEADLINE_MS);
    if (elapsed < 0) {
      widgetNeverOpened = true;
      assert.fail(
        (await hostCanShowWidget())
          ? `the widget did not open within ${OPEN_DEADLINE_MS}ms, on a host that draws one when asked explicitly`
          : `this host drew no suggest widget within ${CAPABILITY_DEADLINE_MS}ms even when asked explicitly, so it is too loaded to measure anything here`
      );
    }
    quietBudgetMs = Math.min(MAX_QUIET_MS, Math.max(MIN_QUIET_MS, elapsed * QUIET_MULTIPLIER));
    assert.ok(document.getText().includes("= render 'posts/sidebar'"), document.getText());
  });

  /** Waits the measured budget and then asks the widget to accept: a no-op when none is open. */
  async function assertNoWidget(context: Mocha.Context, prefix: string, character: string): Promise<void> {
    // With no widget seen on this host, "nothing opened" is what every one of these would report
    // whatever the extension did, so they are pending rather than four more passes that measured nothing.
    if (widgetNeverOpened) {
      context.skip();
    }
    const typed = await typeAt(prefix, character);
    await wait(quietBudgetMs);
    const text = await accepted();
    assert.strictEqual(text, typed, `a suggestion was accepted after typing ${JSON.stringify(character)} at ${JSON.stringify(prefix)}`);
  }

  test('should not open the widget for a quote inside an attribute value', async function () {
    await assertNoWidget(this, "%div{ class: '", "'");
  });

  test('should not open the widget for a double quote inside an attribute value', async function () {
    await assertNoWidget(this, '%a{ href: "', '"');
  });

  test('should not open the widget for a quote after another helper', async function () {
    await assertNoWidget(this, "= link_to '", "'");
  });

  test('should not open the widget for a quote inside a translation call', async function () {
    await assertNoWidget(this, "= t('", "'");
  });
});
