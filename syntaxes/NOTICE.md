# Third-Party Notices

## Haml TextMate grammar, language configuration, and snippets

`syntaxes/haml.tmLanguage.json`, `language-configuration.json`, `snippets/haml.code-snippets`, and
`src/pure/railsSnippetsUpstream.ts` are derived from **haml-vscode** by Karuna Murti.

`src/pure/railsSnippetsUpstream.ts` is not shipped as a file: esbuild bundles it into
`dist/extension.js`, which is where the derived work lives in the published extension.

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
- The `end` of the `:sass`, `:styles`/`:style` and `:plain` filters was `^(?=\1\s+|$\n*)`, a
  positive lookahead where a negative one was intended. The region closed on the first line that was
  indented under the filter, which is the first line of its body, so those bodies were never scoped.
- Patterns were added for the `:escaped`, `:preserve`, `:cdata`, and `:erb` filters, which upstream
  has no pattern for at all. (Upstream's README acknowledges `:preserve` as a known bug.) They are
  scoped `meta.filter.<name>.haml`; `:escaped`, `:preserve`, and `:cdata` include `#interpolated_ruby`
  because Haml interpolates `#{}` inside them, and `:erb` includes `source.ruby`.
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
  - `snippets/haml.code-snippets` keeps the 7 Haml structural snippets (`if`, `else`, `elsif`,
    `unless`, `each`, `yield`, `content_for`) and adds Haml constructs upstream did not cover —
    filters, doctypes, comments, `case`/`when`, `begin`/`rescue`, and `haml-lint:disable` blocks.
  - `src/pure/railsSnippetsUpstream.ts` holds the remaining 221. Prefixes and bodies are verbatim
    apart from the container, which changed from a JSON object keyed by name to a TypeScript array,
    and three repaired bodies. `fields_for` had `${:record_object}` with no tab stop number and
    `render_partial_collection` had `${7, layout: $8}` with a comma where a colon belongs — both
    rejected by VS Code's snippet parser, so that upstream inserts their literal text — and
    `video_tag` had `autobuf.fer:` where Rails wants `autobuffer:`, which upstream inserts as
    broken Ruby. The seven above are excluded so the two sets never offer the same prefix twice.
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
