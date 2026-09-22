import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

// VS Code evaluates onEnterRules synchronously in the renderer on every Enter, against the text left
// of the cursor. Nothing else exercises these regexes - the extension host tests never press Enter -
// so a rule that misfires, or one that backtracks, is only ever found by a user.
const ROOT = path.join(__dirname, '..', '..', '..');

interface OnEnterRule {
  readonly beforeText: string;
}

const rules = (
  JSON.parse(fs.readFileSync(path.join(ROOT, 'language-configuration.json'), 'utf8')) as { onEnterRules: OnEnterRule[] }
).onEnterRules.map((rule) => new RegExp(rule.beforeText));

function indentsAfter(line: string): boolean {
  return rules.some((rule) => rule.test(line));
}

suite('language configuration Test Suite', () => {
  test('should indent after a line that opens a block', () => {
    for (const line of [
      '%div',
      '.card',
      '#main',
      '%ul.nav#main',
      '  %section.hero',
      "%a{ href: '/' }",
      '%a(href="/")',
      '%a[@post]',
      '%a{ href: \'/\' }(title="x")[@post]',
      '- if user',
      '- else',
      '= form_with model: @post do |f|',
      '- items.each do',
      ':javascript'
    ]) {
      assert.strictEqual(indentsAfter(line), true, line);
    }
  });

  test('should not indent after a line that carries its own content', () => {
    for (const line of ['%p Hello', '-# comment', '!!! 5', '= link_to "x", root_path', "%a{ href: '/' } Home", '%p= title', '%br/']) {
      assert.strictEqual(indentsAfter(line), false, line);
    }
  });

  // Haml writes whitespace removal after the attributes: `%p{ a: 1 }<>` is a tag, while in
  // `%p<{ a: 1 }` the braces are already text.
  test('should read whitespace removal where Haml does, after the attributes', () => {
    assert.strictEqual(indentsAfter('%p<'), true);
    assert.strictEqual(indentsAfter("%p{ id: 'a' }<>"), true);
    assert.strictEqual(indentsAfter("%p<{ id: 'a' }"), false);
  });

  // An element that can have no children opens no block: nesting the next line under `%meta` is
  // never what a `%head` full of them wants.
  test('should not indent after a void element', () => {
    for (const line of [
      '%br',
      '%hr',
      "%meta{ charset: 'utf-8' }",
      '%link(rel="stylesheet" href="app.css")',
      "%img{ src: 'a.png', alt: '' }",
      "%input.form-control{ type: 'text' }"
    ]) {
      assert.strictEqual(indentsAfter(line), false, line);
    }
  });

  test('should still indent after a tag that merely begins like a void element', () => {
    for (const line of ['%brand', '%input-group', "%link-list{ class: 'x' }", '%svg:img', '.input', '#img']) {
      assert.strictEqual(indentsAfter(line), true, line);
    }
  });

  // `(\{.*\}|\(.*\)|\[.*\])*` - a `.*` inside a starred group - tried every way of splitting a run of
  // adjacent groups before giving up: 26 of them took over a second, doubling with every two more,
  // with the whole window frozen for the duration.
  test('should give up quickly on a line that cannot match', () => {
    const started = Date.now();
    for (const line of [`%a${'()'.repeat(200)}!`, `%f${'(x){y}'.repeat(200)};`, `%a{ ${'b: "c", '.repeat(2000)}!`, `- if ${'x '.repeat(20000)}`]) {
      indentsAfter(line);
    }
    assert.ok(Date.now() - started < 1000, `took ${Date.now() - started}ms`);
  });
});
