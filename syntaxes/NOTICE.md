# Third-Party Notices

## Haml TextMate grammar, language configuration, and snippets

`syntaxes/haml.tmLanguage.json`, `language-configuration.json`, `src/pure/controlSnippets.ts`, and
`src/pure/railsSnippetsUpstream.ts` are derived from **haml-vscode** by Karuna Murti.

Neither TypeScript file is shipped as one: esbuild bundles both into `dist/extension.js`, which is
where the derived work lives in the published extension.

- Upstream: https://github.com/karuna/haml-vscode
- Vendored commit: `504875f60bcd474f17762b2daf97680476135f79` (master, 2022-07-03)
- Upstream files: `syntaxes/haml.json`, `language-configuration.json`, `snippets/snippets.json`
- License: MIT

### Modifications

- `syntaxes/haml.json` was renamed to `syntaxes/haml.tmLanguage.json`.
- The `:php` filter's include was `text.html.php#language`, a repository key that does not exist in
  VS Code's php grammar in any supported version; vscode-textmate silently drops a rule whose include
  target is missing, so the whole filter region went unscoped. It now includes `text.html.php`
  itself, the way the other filters include their grammars' root scopes.
- The same defect hid three more filters. `:scss` included `source.scss`, but VS Code's SCSS grammar
  is `source.css.scss`; `:plain` included `text.plain`, which no grammar registers; and `:sass`
  included `source.sass`, which only a third-party extension provides. `:scss` now includes
  `source.css.scss`, `:plain` includes `#interpolated_ruby` and nothing external, and the `:sass`
  rule includes `#interpolated_ruby` next to `source.sass` so that it survives without a Sass
  grammar - the region is scoped either way, and highlighted inside when one is installed. The two
  `:style`/`:styles` rules that also name `source.sass` are left to be dropped without it, because
  that is what lets `:style` fall through to the CSS rule.
- Multiline Ruby was fixed (upstream issue #9). The `rubyline` rule's `end` was
  `((do|\{)( \|[.*]+\|)?)$|$|^(?!.*\|\s*)$\n?`: the bare `$` in the middle matches at every line
  ending, so the region always closed after one line and the third alternative — the one meant to
  keep a piped block open — was unreachable. That is why continuation never worked, with or without
  pipes. It is now two rules, because the two continuation styles terminate in opposite ways: a
  comma-continued expression ends *on* the first line without a trailing comma, while a piped block
  ends *before* the first line without a trailing pipe. `rubyline_pipe` is anchored at the top level
  so that closing it at the start of the next line leaves no enclosing rule open; while one was left
  open, `rubyline`'s unanchored `(=|-|~)` matched hyphens inside ordinary words. The block-argument
  group was also `( \|[.*]+\|)?`, where `[.*]` is a character class of a literal `.` and `*` rather
  than "any characters", so `do |item|` never matched; it is now `(\s*\|[^|]*\|)?`.
- Two ways were left for `rubyline` to stay open one line too long, so that the line *after* the
  construct was tokenized as Ruby. Upstream's inner pattern `(\||,|<|do|\{)\s*(\#.*)?$\n*` consumed
  the newline for every one of its alternatives, and once the newline is gone no `$`-anchored `end`
  can match on that line. After `- foo do # comment` that swallowed the line below the block opener;
  the `end` now takes the trailing comment itself. After a pipe block continued from a tag
  (`%p= foo |`), which `rubyline_pipe` cannot cover because it is anchored at the top level, the rule
  only closed at the end of the first line *without* a pipe. The two real continuations are now
  nested rules of their own - a trailing `,` closes on the first line without one, a trailing ` |`
  closes before the first line without one - and `rubyline` itself closes at any line start, which
  it can no longer legitimately be open at. The tag rule around it does the same (`(?!\G)^`, so that
  a `.class` line, whose begin matches nothing, is not closed where it opened): its `end` was a
  lookahead that a following `-#` or `/` line does not satisfy, so such a comment was read as more of
  the tag and its nested lines as live Haml.
- The `end` of the `:sass`, `:styles`/`:style` and `:plain` filters was `^(?=\1\s+|$\n*)`, a
  positive lookahead where a negative one was intended. The region closed on the first line that was
  indented under the filter, which is the first line of its body, so those bodies were never scoped.
- Patterns were added for the `:escaped`, `:preserve`, `:cdata`, and `:erb` filters, which upstream
  has no pattern for at all. (Upstream's README acknowledges `:preserve` as a known bug.) They are
  scoped `meta.filter.<name>.haml`; `:escaped`, `:preserve`, and `:cdata` include `#interpolated_ruby`
  because Haml interpolates `#{}` inside them. `:erb` hands only the inside of a `<% %>` tag to
  `source.ruby`, the shape the ERB grammar shipped with vscode-ruby and Ruby LSP has; VS Code has
  none of its own. Handing it the whole body did not work: the body is markup, where Ruby reads the
  `%>` closing a tag as the start of a `%`-literal and an apostrophe as the start of a string, and
  because a filter's `end` is only tried while the filter is on top of the rule stack, the string
  scope then ran to the end of the file.
- Every rule that takes an indented body — the filters, `%script` and the `-#` / `/` comment — is
  written as `begin`/`while` (`^(?=\1\s+|$\n*)`) where upstream has `begin`/`end`
  (`^(?!\1\s+|$\n*)`). The two tell a body line from what follows it in the same way, and against
  the grammars VS Code ships — the real ones, registered from the built-in extensions, not the
  stubs the snapshots use — every well-formed body tokenizes the same either way: checked over 757
  documents, fifteen filters in twenty-five body shapes in two nestings, among them the ones whose grammars
  anchor on `\G`, which is the one thing `while` sets and `end` does not (a Ruby heredoc, a nested
  and lazily continued Markdown list, a fenced block, a quote, a `@media` block, SCSS nesting, a
  `<?php ?>` tag, a JavaScript template literal). What `end` could not do is end the region
  while something inside it is still open, because an `end` is only tried while its own rule is on
  top of the rule stack: a `/*`, a template literal, or simply the `{` of a CSS rule still being
  typed sat above the filter, and everything below was coloured as that construct to the end of the
  file. A comment leaks through Haml's own rules rather than an embedded grammar's, since its body
  includes `text.haml`: `-#` holding `%div{ id: 1,` greyed out the rest of the file. `while` is
  asked of every line whatever is open, and pops it all — which also takes back the line after a
  `:markdown` body, whose own paragraph rule used to claim the next, more shallowly indented Haml
  line as a continuation. `src/test/pure/manifest.test.ts` pins the shape, and
  `syntaxes/fixtures/filter-leak.haml` and `comment-leak.haml` are the snapshots.
- Upstream carries the `:ruby`, `:sass` and `:plain` filters several times over, and which copy wins
  is not simply the first. A rule whose every pattern includes an unregistered grammar is dropped
  whole, so the `:sass` and `:style`/`:styles` copies that include nothing but `source.sass` — which
  no stock VS Code registers — never run at all; `:sass` is scoped by the one copy that also includes
  `#interpolated_ruby`, and `:style`/`:styles` fall through to the `meta.embedded.css` rule. Among
  the copies that survive, the first at a position wins, which the `keyword.control.filter.haml`
  capture makes visible: `:ruby` does not get it, and the only `:ruby` rule that grants it is the
  fourth. The duplicates are converted along with the rest so that the rule above holds without an
  exception.
- `interpolated_ruby`'s two rules began at a bare `#{`, so `\#{...}` was scoped as live Ruby. Haml
  renders that literally — in filters as well as in plain text — so both rules, and the injection
  below, now require that the `#` is not escaped.
- `syntaxes/haml-interpolation.injection.json` was added (upstream issue #10). It is original work,
  not vendored, but it exists to correct the vendored grammar's behaviour: a filter hands its body
  to another grammar, which then reads the `{` of `#{` as its own syntax. In JavaScript that opens
  an object literal, and a quote inside the Ruby breaks the recovery, so every following line of the
  filter is mis-tokenized. Adding the interpolation rule to the filter's own patterns does not work,
  because TextMate takes the leftmost match on a line and the embedded grammar's rules start
  earlier; once its begin/end rules are entered, the filter's patterns no longer apply inside them.
  An injection applies at every level of the scope stack, which is why it is the right mechanism.
- `language-configuration.json`: the upstream `indentationRules.increaseIndentPattern` was
  `"^s*(([-%#\\:\\.\\=])|(.*sdo\b))\b[^{;]*$"`, which parses to
  `'^s*(([-%#\\:\\.\\=])|(.*sdo\x08))\x08[^{;]*$'` — `\s` had lost its backslash and each `\b`
  is a literal U+0008 BACKSPACE rather than a word boundary. It matched nothing at all
  (not `%div`, not `- if x`, not `.klass`, not `= foo`), so upstream auto-indent never worked.
  It has been replaced with `onEnterRules`.
- `snippets/snippets.json`: the upstream file contains 228 snippets, most of which are Rails view
  helpers (`link_to`, `url_for`, `audio_tag`, …). They are split across two places here.
  - `src/pure/controlSnippets.ts` keeps the 7 Haml structural snippets (`if`, `else`, `elsif`,
    `unless`, `each`, `yield`, `content_for`) and adds control flow upstream did not cover —
    `case`/`when`, `while`, `until`, `begin`/`rescue` and blocks. They go through the completion
    provider, ungated, because only a provider can replace the `-` or `=` a body opens with when
    the user has already typed it. `snippets/haml.code-snippets` holds nothing of upstream's any
    more: filters, doctypes, comments and `haml-lint:disable` blocks are original to this
    repository.
  - `src/pure/railsSnippetsUpstream.ts` holds the remaining 221. Prefixes and bodies are verbatim
    apart from the container, which changed from a JSON object keyed by name to a TypeScript array,
    and seven repaired bodies. `fields_for` had `${:record_object}` with no tab stop number and
    `render_partial_collection` had `${7, layout: $8}` with a comma where a colon belongs — both
    rejected by VS Code's snippet parser, so that upstream inserts their literal text. The other
    five inserted Ruby that is a syntax error as it stands: `video_tag` had `autobuf.fer:` where
    Rails wants `autobuffer:`; `stylesheet_link_tag` had no comma between the source and `media:`;
    `button_block` and `f.button_block` opened their argument list with the comma of the optional
    hash, which is now parenthesized as in `time_tag_block`; and `select` had a comma before that
    placeholder as well as inside it. Three `detail` strings that named another helper were
    corrected: `mail_to_block`, `collection_radio_buttons` and `collection_radio_buttons_block`.
    The header of the file lists each change exactly, so that they can be reapplied after
    regenerating it. The seven above are excluded so the two sets never offer the same prefix twice.
    They are offered through a CompletionItemProvider rather than `contributes.snippets`, because
    that contribution point takes only `language` and `path` and so cannot be turned off by a
    setting; `haml.snippets.rails` controls them, and defaults to detecting whether the workspace
    is a Rails project.
  - The 18 further helpers in `src/pure/railsSnippets.ts` (`form_with`, `turbo_frame_tag`,
    `dom_id`, …) are original to this repository and are not covered by the notice below.

### Upstream license

```
The MIT License (MIT)
=====================

Copyright © `2016` `Karuna Murti <karuna.murti at gmail dot com>`

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.
```
