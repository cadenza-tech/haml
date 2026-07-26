import * as assert from 'node:assert';
import type { LineRange } from '../../pure/lineRange';
import {
  buildPartialExtraction,
  isSubmittablePartialName,
  type PartialExtraction,
  suggestPartialName,
  validatePartialName
} from '../../pure/partialExtraction';
import type { Eol } from '../../pure/textModel';
import { snapshotOfLines } from '../support/snapshot';

/** Replays the replacement the way VS Code would, so expectations read as Haml. */
function applied(lines: readonly string[], extraction: PartialExtraction, eol: Eol = '\n'): string[] {
  const { start, end, newText } = extraction.replacement;
  return [...lines.slice(0, start.line), ...newText.split(eol), ...lines.slice(end.line + 1)];
}

const CARD = ['%h1 Posts', '  .card', '    %h2= @post.title', '    %p= @post.body', '%p Done'];
const CARD_RANGE: LineRange = { startLine: 1, endLine: 3 };
const VIEW = '/repo/app/views/posts/show.html.haml';

function extract(
  lines: readonly string[],
  partialName: string,
  options: { documentPath?: string; viewsRoot?: string | null; range?: LineRange; eol?: Eol; platform?: NodeJS.Platform } = {}
): PartialExtraction {
  return buildPartialExtraction(
    {
      documentPath: options.documentPath ?? VIEW,
      viewsRoot: options.viewsRoot === undefined ? '/repo/app/views' : options.viewsRoot,
      partialName,
      range: options.range ?? CARD_RANGE
    },
    snapshotOfLines(lines),
    options.eol ?? '\n',
    options.platform ?? 'linux'
  );
}

suite('pure/partialExtraction Test Suite', () => {
  suite('buildPartialExtraction', () => {
    test('should move the selection into a partial beside the document and leave a render call', () => {
      const extraction = extract(CARD, 'card');
      assert.strictEqual(extraction.filePath, '/repo/app/views/posts/_card.html.haml');
      assert.strictEqual(extraction.renderPath, 'posts/card');
      assert.strictEqual(extraction.partialText, '.card\n  %h2= @post.title\n  %p= @post.body\n');
      assert.deepStrictEqual(applied(CARD, extraction), ['%h1 Posts', "  = render 'posts/card'", '%p Done']);
    });

    test('should put a slashed name under the views root', () => {
      const extraction = extract(CARD, 'shared/card');
      assert.strictEqual(extraction.filePath, '/repo/app/views/shared/_card.html.haml');
      assert.strictEqual(extraction.renderPath, 'shared/card');
    });

    // The document's own suffix is reused rather than hard-coding .html, so a turbo_stream template
    // extracts into a turbo_stream partial.
    test('should reuse the suffix of the document', () => {
      assert.ok(extract(CARD, 'card', { documentPath: '/repo/app/views/posts/index.haml' }).filePath.endsWith('_card.haml'));
      const turbo = extract(CARD, 'card', { documentPath: '/repo/app/views/posts/index.turbo_stream.haml' });
      assert.ok(turbo.filePath.endsWith('_card.turbo_stream.haml'), turbo.filePath);
    });

    test('should write a bare render path for a document directly under the views root', () => {
      const extraction = extract(CARD, 'card', { documentPath: '/repo/app/views/index.haml' });
      assert.strictEqual(extraction.filePath, '/repo/app/views/_card.haml');
      assert.strictEqual(extraction.renderPath, 'card');
    });

    // Not an error: an engine's dummy app or a plain Haml site has no app/views, and the edit is one
    // undo away in any case.
    test('should fall back to the document directory without a views root', () => {
      const extraction = extract(CARD, 'card', { documentPath: '/site/pages/index.haml', viewsRoot: null });
      assert.strictEqual(extraction.filePath, '/site/pages/_card.haml');
      assert.strictEqual(extraction.renderPath, 'card');
    });

    // The file keeps the underscore, the render call must not: Rails prepends it to the final
    // segment itself, so `render 'posts/_card'` resolves to `posts/__card` and raises
    // ActionView::MissingTemplate at runtime.
    test('should not add a second underscore to a name that already has one', () => {
      const extraction = extract(CARD, '_card');
      assert.strictEqual(extraction.filePath, '/repo/app/views/posts/_card.html.haml');
      assert.strictEqual(extraction.renderPath, 'posts/card');
      assert.strictEqual(extraction.replacement.newText, "  = render 'posts/card'");
    });

    test('should write a bare render stem for an underscored name in every placement', () => {
      const slashed = extract(CARD, 'shared/_card');
      assert.strictEqual(slashed.filePath, '/repo/app/views/shared/_card.html.haml');
      assert.strictEqual(slashed.renderPath, 'shared/card');
      const noRoot = extract(CARD, '_card', { documentPath: '/site/pages/index.haml', viewsRoot: null });
      assert.strictEqual(noRoot.filePath, '/site/pages/_card.haml');
      assert.strictEqual(noRoot.renderPath, 'card');
    });

    // Only the underscore Rails adds is dropped; further ones belong to the name itself.
    test('should keep underscores that are part of the name', () => {
      const extraction = extract(CARD, '__card');
      assert.strictEqual(extraction.filePath, '/repo/app/views/posts/__card.html.haml');
      assert.strictEqual(extraction.renderPath, 'posts/_card');
    });

    test('should normalise the extracted lines to column zero', () => {
      const extraction = extract(['%h1 a', '        .deep', '          %p b'], 'card', { range: { startLine: 1, endLine: 2 } });
      assert.strictEqual(extraction.partialText, '.deep\n  %p b\n');
    });

    test('should keep the indent of the selection on the render call', () => {
      const extraction = extract(CARD, 'card');
      assert.strictEqual(extraction.replacement.newText, "  = render 'posts/card'");
    });

    // haml-lint's FinalNewline linter would fire on the new file otherwise.
    test('should end the partial with a newline', () => {
      assert.ok(extract(CARD, 'card').partialText.endsWith('\n'));
      assert.ok(extract(CARD, 'card', { eol: '\r\n' }).partialText.endsWith('\r\n'));
    });

    test('should use CRLF throughout when the document does', () => {
      const extraction = extract(CARD, 'card', { eol: '\r\n' });
      assert.strictEqual(extraction.partialText, '.card\r\n  %h2= @post.title\r\n  %p= @post.body\r\n');
    });

    test('should leave blank lines inside the selection empty', () => {
      const lines = ['%h1 a', '  .card', '', '  .footer'];
      const extraction = extract(lines, 'card', { range: { startLine: 1, endLine: 3 } });
      assert.strictEqual(extraction.partialText, '.card\n\n.footer\n');
    });

    test('should end the replacement at the end of the last selected line', () => {
      const extraction = extract(CARD, 'card');
      assert.deepStrictEqual(extraction.replacement.start, { line: 1, character: 0 });
      assert.deepStrictEqual(extraction.replacement.end, { line: 3, character: '    %p= @post.body'.length });
    });

    // The path is a real path, the render argument is a Rails string. They differ on Windows.
    test('should build a win32 file path but a posix render path', () => {
      const extraction = extract(CARD, 'shared/card', {
        documentPath: 'C:\\repo\\app\\views\\posts\\show.html.haml',
        viewsRoot: 'C:\\repo\\app\\views',
        platform: 'win32'
      });
      assert.strictEqual(extraction.filePath, 'C:\\repo\\app\\views\\shared\\_card.html.haml');
      assert.strictEqual(extraction.renderPath, 'shared/card');
    });

    test('should build a win32 render path for a bare name too', () => {
      const extraction = extract(CARD, 'card', {
        documentPath: 'C:\\repo\\app\\views\\posts\\show.html.haml',
        viewsRoot: 'C:\\repo\\app\\views',
        platform: 'win32'
      });
      assert.strictEqual(extraction.renderPath, 'posts/card');
    });
  });

  suite('suggestPartialName', () => {
    test('should suggest a class or id shorthand', () => {
      assert.strictEqual(suggestPartialName('.card'), 'card');
      assert.strictEqual(suggestPartialName('  .card'), 'card');
      assert.strictEqual(suggestPartialName('#main'), 'main');
      assert.strictEqual(suggestPartialName('.card.wide'), 'card');
      assert.strictEqual(suggestPartialName('.card{ id: 1 }'), 'card');
    });

    // An invalid suggestion would be rejected by the validator the moment the box opens.
    test('should suggest nothing that is not a valid partial name', () => {
      for (const line of ['.card-wide', '%div.card', '%h2 Title', '= render', '', '  ', '.Card']) {
        assert.strictEqual(suggestPartialName(line), '', line);
      }
    });
  });

  suite('validatePartialName', () => {
    test('should accept an identifier and a slashed path', () => {
      for (const name of ['card', 'shared/card', 'a/b/c', '_card', 'card_2']) {
        assert.strictEqual(validatePartialName(name), null, name);
      }
    });

    // The name becomes a filesystem path, so traversal is a security requirement, not a nicety.
    test('should reject traversal, absolute and empty segments', () => {
      for (const name of ['..', '../secrets', 'a/../b', '/card', 'card/', 'a//b', '.']) {
        assert.ok(validatePartialName(name) !== null, name);
      }
    });

    // Doubles as the InputBox validator, and the box opens empty when the first line suggests nothing.
    // Greeting the user with an error there would be rude, so the caller rejects '' after the box closes.
    test('should accept the empty name so the prompt does not open with an error', () => {
      assert.strictEqual(validatePartialName(''), null);
    });

    test('should reject what Rails itself would reject', () => {
      for (const name of ['Card', 'card-wide', 'card wide', '2card', 'card.html', 'card\\x']) {
        assert.ok(validatePartialName(name) !== null, name);
      }
    });

    test('should reject surrounding whitespace', () => {
      assert.ok(validatePartialName(' card') !== null);
      assert.ok(validatePartialName('card ') !== null);
    });

    // `_` alone names the file `_.html.haml`, which no render call can address: the underscore is
    // the prefix Rails adds, so the name under it is empty and `render '_'` asks for `__`.
    test('should reject a name that is only the underscore prefix', () => {
      assert.ok(validatePartialName('_') !== null);
      assert.ok(validatePartialName('shared/_') !== null);
      assert.strictEqual(validatePartialName('_card'), null);
      assert.strictEqual(validatePartialName('__'), null, 'the file `__` is addressable as `render "_"`');
    });
  });

  suite('isSubmittablePartialName', () => {
    // validatePartialName has to let '' pass so the input box does not open showing an error; this
    // is the other half of that contract, which the glue used to restate.
    test('should reject the empty name the validator lets through', () => {
      assert.strictEqual(validatePartialName(''), null);
      assert.strictEqual(isSubmittablePartialName(''), false);
    });

    test('should accept what the validator accepts', () => {
      for (const name of ['card', 'shared/header', '_card']) {
        assert.strictEqual(isSubmittablePartialName(name), true, name);
      }
    });

    test('should reject what the validator rejects', () => {
      for (const name of ['../etc/passwd', 'Card', ' card', 'a b']) {
        assert.strictEqual(isSubmittablePartialName(name), false, name);
      }
    });
  });
});
