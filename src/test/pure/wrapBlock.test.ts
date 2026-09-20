import * as assert from 'node:assert';
import { CONTROL_SNIPPETS } from '../../pure/controlSnippets';
import type { LineRange } from '../../pure/lineRange';
import type { Eol } from '../../pure/textModel';
import { buildBlockWrap, buildConditionalWrap, escapeSnippetText, type WrapSpec } from '../../pure/wrapBlock';
import { snapshotOfLines } from '../support/snapshot';

function firstLineOf(prefix: string): string | undefined {
  return CONTROL_SNIPPETS.find((snippet) => snippet.prefix === prefix)?.body.split('\n')[0];
}

/** What the snippet becomes once it is accepted with every placeholder left at its default. */
function expand(snippet: string): string {
  return snippet.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\\([$}\\])/g, '$1');
}

/** Replays the spec the way VS Code would, so expectations read as Haml rather than as offsets. */
function applied(lines: readonly string[], spec: WrapSpec, eol: Eol = '\n'): string[] {
  return [...lines.slice(0, spec.start.line), ...expand(spec.snippet).split(eol), ...lines.slice(spec.end.line + 1)];
}

function wrap(lines: readonly string[], range: LineRange, unit = '  ', eol: Eol = '\n'): WrapSpec {
  return buildConditionalWrap(range, snapshotOfLines(lines), unit, eol);
}

suite('pure/wrapBlock Test Suite', () => {
  suite('buildConditionalWrap', () => {
    test('should wrap the selection and indent it one level', () => {
      const lines = ['%h1 Posts', '  %p= @post.body', '%p Done'];
      const spec = wrap(lines, { startLine: 1, endLine: 1 });
      assert.deepStrictEqual(applied(lines, spec), ['%h1 Posts', '  - if condition', '    %p= @post.body', '%p Done']);
    });

    test('should keep the relative depth of a multi-line selection', () => {
      const lines = ['  .card', '    %h2 Title', '    %p Body'];
      const spec = wrap(lines, { startLine: 0, endLine: 2 });
      assert.deepStrictEqual(applied(lines, spec), ['  - if condition', '    .card', '      %h2 Title', '      %p Body']);
    });

    // The header takes the shallowest indent, not the first line's: a selection whose first line is
    // deeper than a later one would otherwise be wrapped inside its own body.
    test('should indent the header to the shallowest line', () => {
      const lines = ['    %h2 Title', '  .card'];
      const spec = wrap(lines, { startLine: 0, endLine: 1 });
      assert.deepStrictEqual(applied(lines, spec), ['  - if condition', '      %h2 Title', '    .card']);
    });

    // The header must match the `if` control snippet so one extension speaks one dialect, and the
    // placeholder must carry a default so Esc leaves `- if condition` rather than `- if `.
    test('should use the same header and tab stop as the if snippet', () => {
      const spec = wrap(['%p a'], { startLine: 0, endLine: 0 });
      assert.strictEqual(spec.snippet.split('\n')[0], '- if ${1:condition}');
      assert.strictEqual(spec.snippet.split('\n')[0], firstLineOf('if'));
    });

    // Haml carries these characters constantly, and an unescaped one would corrupt the body before the
    // user even leaves the snippet.
    test('should escape snippet syntax in the body', () => {
      const lines = ['%div{ class: \'x\' }= "$100"'];
      const spec = wrap(lines, { startLine: 0, endLine: 0 });
      assert.ok(spec.snippet.includes('%div{ class: \'x\' \\}= "\\$100"'), spec.snippet);
      assert.deepStrictEqual(applied(lines, spec), ['- if condition', '  %div{ class: \'x\' }= "$100"']);
    });

    test('should escape interpolation and backslashes', () => {
      const spec = wrap(['%p= "#{@post.title}\\n"'], { startLine: 0, endLine: 0 });
      assert.ok(spec.snippet.includes('%p= "#{@post.title\\}\\\\n"'), spec.snippet);
    });

    test('should leave blank lines inside the selection empty', () => {
      const lines = ['%p a', '', '%p b'];
      const spec = wrap(lines, { startLine: 0, endLine: 2 });
      assert.deepStrictEqual(applied(lines, spec), ['- if condition', '  %p a', '', '  %p b']);
    });

    test('should use tabs when the unit is a tab', () => {
      const lines = ['\t.card'];
      const spec = wrap(lines, { startLine: 0, endLine: 0 }, '\t');
      assert.deepStrictEqual(applied(lines, spec), ['\t- if condition', '\t\t.card']);
    });

    test('should use CRLF when the document does', () => {
      const lines = ['%p a'];
      const spec = wrap(lines, { startLine: 0, endLine: 0 }, '  ', '\r\n');
      assert.strictEqual(spec.snippet, '- if ${1:condition}\r\n  %p a');
      assert.deepStrictEqual(applied(lines, spec, '\r\n'), ['- if condition', '  %p a']);
    });

    // The range stops at the end of the last line, never past it, so a document with no final newline
    // does not grow one and the last line of the file needs no special case.
    test('should end the range at the end of the last selected line', () => {
      const lines = ['%h1 a', '  %p b'];
      const spec = wrap(lines, { startLine: 1, endLine: 1 });
      assert.deepStrictEqual(spec.start, { line: 1, character: 0 });
      assert.deepStrictEqual(spec.end, { line: 1, character: '  %p b'.length });
      assert.ok(!spec.snippet.endsWith('\n'), spec.snippet);
    });
  });

  suite('buildBlockWrap', () => {
    // Must match the `each` control snippet, tab stop numbering included: the first stop is the
    // receiver, which is what the user types first.
    test('should use the same header and tab stops as the each snippet', () => {
      const spec = buildBlockWrap({ startLine: 0, endLine: 0 }, snapshotOfLines(['%p a']), '  ', '\n');
      assert.strictEqual(spec.snippet.split('\n')[0], '- ${1:collection}.each do |${2:item}|');
      assert.strictEqual(spec.snippet.split('\n')[0], firstLineOf('each'));
    });

    test('should leave valid Haml when the placeholders are not filled in', () => {
      const lines = ['  %p= post.title'];
      const spec = buildBlockWrap({ startLine: 0, endLine: 0 }, snapshotOfLines(lines), '  ', '\n');
      assert.deepStrictEqual(applied(lines, spec), ['  - collection.each do |item|', '    %p= post.title']);
    });
  });

  suite('escapeSnippetText', () => {
    test('should escape exactly what SnippetString.appendText escapes', () => {
      assert.strictEqual(escapeSnippetText('$'), '\\$');
      assert.strictEqual(escapeSnippetText('}'), '\\}');
      assert.strictEqual(escapeSnippetText('\\'), '\\\\');
      assert.strictEqual(escapeSnippetText('{'), '{');
      assert.strictEqual(escapeSnippetText('%p plain'), '%p plain');
    });
  });
});
