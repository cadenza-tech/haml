# Change Log

All notable changes to the "Haml" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-23

### Changed

- Completion: a partial beside the current file is inserted under its `app/views`-relative name (`posts/sidebar`) like every other, since the bare name only resolves from a view in the rendering controller's own directory; typing `side` still finds it, and such partials are still listed first
- Documentation: note that enabling both `editor.formatOnSave` and `source.fixAll` on save runs the same auto-correct twice per save
- Packaging: contributor files (`CLAUDE.md`, `.claude/`, `.ruby-lsp/` and the SVG icon source) are no longer shipped in the VSIX
- Snippets: the Haml control-flow snippets (`if`, `ifelse`, `each`, `case`, ...) are supplied by the completion provider rather than the snippet file, so like the Rails ones they no longer appear in `Insert Snippet` or expand with `editor.tabCompletion`; they match by prefix only (`c` finds `content_for`, `cf` does not) and are not offered inside a filter body or a `-#` comment

### Fixed

- Code action: a line led by a no-break space or an ideographic space is no longer read as indented, so the disable quick fix and the selection refactorings no longer treat it as a child of the line above
- Code action: the disable quick fix for an offense in a filter body, on a later line of a multi-line attribute list, or in a comma- or `|`-continued script wraps the whole construct, rather than writing a `-#` inside it, where it was emitted into the page or was a syntax error
- Code action: the disable quick fix for an offense on a blank line after a filter body writes its pair at the filter's indent rather than the body's, where the comment was emitted into the page
- Code action: the disable quick fix for an offense on an `- else`, `- elsif`, `- when`, `- rescue` or `- ensure` wraps the whole `- if`, `- case` or `- begin`, rather than putting a `-#` between the two, which Haml rejects
- Command: `Haml: Wrap in Conditional`, `Haml: Wrap in Block` and `Haml: Split to Partial` grow a selection that covers only part of an `- if`/`- else`, `- case`/`- when` or `- begin`/`- rescue` to the whole construct, instead of leaving the `- else` behind
- Completion: `data-*` attributes are no longer offered inside a value written with spaces around its `=` (`href = "/x"`), nor after `%a<(`, where Haml renders the parentheses as text
- Completion: a partial name still being typed ahead of further arguments (`= render 'sha|, locals: { a: 1 }`) is completed from `sha`, not from the rest of the line
- Completion: accepting a `data-*` attribute inside a quote VS Code auto-closed no longer leaves the closing quote behind (`'data-turbo-frame': '''`), and nothing is offered while a key that already has its value is being edited
- Diagnostics: a forced run after a settings change or `Haml: Restart Linter` that fails no longer leaves the previous report to be reused on every later save
- Diagnostics: a run abandoned when `haml.lint.run` was switched off can no longer overwrite the diagnostics of the run started after it was switched back on
- Diagnostics: a run superseded by a newer request is no longer recorded as a timeout while its process takes its grace period to die, which paused diagnostics for the file
- Diagnostics: after a format that changed the document, the panel shows a lint of the corrected text instead of the correcting run's report, whose line numbers predate the edit; after `Haml: Fix All` or a manual Format Document, which no save follows, that lint is what refreshes it
- Diagnostics: an offense an auto-correct run reports twice (a linter such as `SpaceBeforeScript`, which `-a` cannot correct) is shown once
- Editing: pressing Enter after a tag line with attribute brackets no longer stalls on a long line
- Editing: pressing Enter after a void element (`%br`, `%img`, `%input`, `%meta`, ...) no longer indents the next line
- Formatting: `haml.formatter: "auto"` is decided per `Gemfile.lock` when several packages share one `.haml-lint.yml`, rather than from whichever bundle was probed first
- Formatting: a format run whose stderr also carries Ruby, Bundler or gem warnings applies its corrections instead of being discarded as unparseable, and a wrapper that copies the report into stdout no longer has it written into the document
- Formatting: with `haml.lint.run: "off"`, a save no longer lifts the timeout back-off, so format-on-save no longer spends the whole timeout again on a file haml-lint already timed out on
- Grammar: `:erb` hands only the inside of `<% %>` tags to Ruby, so a `%>` or an apostrophe in the ERB markup no longer opens a Ruby string that runs to the end of the file
- Grammar: a filter, `%script` or comment body left open by an unfinished construct inside it (a `/*`, a template literal, the `{` of a CSS rule, an attribute hash in a `-#`) no longer colours the rest of the file, and the line after a `:markdown` body is no longer read as more of its paragraph
- Grammar: a Ruby line ending in a `# comment` followed by trailing spaces no longer keeps the next line from being read as a tag
- Grammar: an unfinished `#{` no longer colours the rest of the file as Ruby; an interpolation ends at its line, so one carried into the next line inside an attribute value or a filter body has its continuation highlighted as Haml
- Grammar: the `:scss`, `:plain` and `:sass` filter bodies are scoped again, `:scss` with VS Code's SCSS grammar and `:sass` with a Sass grammar when one is installed; they had been dropped whole for naming grammars VS Code does not register
- Grammar: the line after `- foo do # comment`, the line after a `|`-continued block on a tag (`%p= foo |`), and a `-#` or `/` comment under a tag are no longer tokenized as Ruby or as more of the tag
- Linting: on macOS and Linux a timed-out or cancelled run kills its whole process group, so an `executablePath` wrapper that does not `exec` (a docker script) no longer leaves haml-lint running and holding the run's slot
- Linting: on Windows, `haml.hamlLint.executablePath` naming a command with its extension (`haml-lint.bat`) resolves on `PATH`, rather than being looked for as `haml-lint.bat.exe`
- Linting: on Windows, a `haml-lint.bat` whose path is written with forward slashes (`C:/Ruby/bin/haml-lint.bat`) runs, rather than cmd.exe reading the `/` as a switch
- Navigation: a `render` call behind the `~` marker (`~ render 'foo'`) gets Go to Definition and partial completion
- Output: a lint run that exits with an error logs what haml-lint printed to stdout, which is where a broken `.haml-lint.yml` is explained
- Setting: a relative `haml.lint.exclude` pattern such as `vendor/**/*.haml` is matched against the workspace folder rather than the absolute path, which no relative pattern could match
- Setting: surrounding whitespace in a `haml.lint.exclude` entry is trimmed rather than making the pattern match nothing
- Snippets: accepting a control-flow snippet after a `- ` already typed no longer inserts `- - if condition`, and the snippets are offered on a line VS Code already highlights as embedded Ruby
- Snippets: five Rails snippets (`stylesheet_link_tag`, `button_block`, `f.button_block`, `select`, `tag.div_block`) inserted Ruby with a syntax error, and three (`mail_to_block`, `collection_radio_buttons`, `collection_radio_buttons_block`) described another helper

### Security

- Code action: the disable quick fix refuses a linter name from the report that is not a class name, since it is the one value from haml-lint's output written into the document
- Linting: a relative `PATH` entry (`.`, `./bin`, or a drive-relative one on Windows) is skipped when resolving `haml-lint`, since the file checked against the extension host's directory and the file spawned against the linted document's would differ

## [0.0.2] - 2026-08-16

### Added

- Diagnostics: re-run for open files when `.haml-lint_todo.yml` changes, for a `.haml-lint.yml` that pulls it in with `inherits_from`

## [0.0.1] - 2026-07-28

### Changed

- Changes to `.haml-lint.yml`, `.rubocop.yml` and `Gemfile.lock` now share one debounced re-lint, so a branch switch re-lints open files once instead of once per file event
- `haml.hamlLint.executablePath` now resolves a bare command name on `PATH` and refuses a relative path, which spawn would have resolved against the linted document's directory

### Fixed

- A version probe failing after a settings or bundle change no longer evicts the probe started for the new state
- The version probe no longer spawns haml-lint for a document that can never be linted, such as an untitled buffer in a window with no workspace folder

## [0.0.0] - 2026-07-27

### Added

- Code action: disable a haml-lint linter for a block with `-# haml-lint:disable` comments
- Code action: Fix all auto-correctable Haml offenses, contributed as `source.fixAll.haml`
- Command: `Haml: Fix All Auto-correctable Offenses`
- Command: `Haml: Lint File`
- Command: `Haml: Restart Linter`
- Command: `Haml: Show Output Channel`
- Command: `Haml: Split to Partial`
- Command: `Haml: Wrap in Block`
- Command: `Haml: Wrap in Conditional`
- Completion: `data-*` attributes from Turbo, Stimulus and Rails UJS, in all three Haml attribute notations
- Completion: partial names inside a `render` call
- Diagnostics: haml-lint offenses, with each linter name linking to its documentation
- Diagnostics: paused for a file a haml-lint run timed out on, until it gets smaller, `haml.hamlLint.timeoutMs` is raised, or a command asks for it
- Diagnostics: re-run for open files when `.haml-lint.yml` or `.rubocop.yml` changes
- Documentation: how to turn Emmet off for Haml alone, which restores VS Code's word-based completion
- Formatting: haml-lint auto-correct, enabled for `.haml` on save through `contributes.configurationDefaults`
- Grammar: `#{...}` interpolation is highlighted as Ruby everywhere, including inside filters, with `\#{}` left alone
- Grammar: multi-line Ruby continued with a trailing comma or an explicit `|` marker
- Grammar: patterns for the `:escaped`, `:preserve`, `:cdata` and `:erb` filters, which the upstream grammar did not cover
- Highlighting: Haml syntax with embedded Ruby, JavaScript, CSS, Sass, SCSS, CoffeeScript, Markdown and PHP
- Linting: automatic `bundle exec` detection from `Gemfile.lock`, with a fallback to the `haml-lint` on `PATH`
- Navigation: Go to Definition for the partial a `render` call names, resolved the way Rails resolves it
- Setting: `haml.formatter` to choose the auto-correct mode or disable formatting
- Setting: `haml.hamlLint.configPath` to pass a configuration file to haml-lint
- Setting: `haml.hamlLint.executablePath` to override the haml-lint executable
- Setting: `haml.hamlLint.timeoutMs` to bound how long a haml-lint process may run
- Setting: `haml.hamlLint.useBundler` to control `bundle exec` detection
- Setting: `haml.lint.debounceMs` to debounce linting while typing
- Setting: `haml.lint.exclude` to skip files, since haml-lint's own `exclude:` does not apply to stdin
- Setting: `haml.lint.run` to choose when diagnostics run
- Setting: `haml.snippets.rails` to offer Rails view helper snippets, defaulting to automatic detection
- Snippets: 239 Rails view helper snippets, offered only when the file belongs to a Rails project
- Snippets: Haml control flow, filters, doctypes and comments

[1.0.0]: https://github.com/cadenza-tech/haml/compare/v0.0.2...v1.0.0
[0.0.2]: https://github.com/cadenza-tech/haml/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/cadenza-tech/haml/compare/v0.0.0...v0.0.1
[0.0.0]: https://github.com/cadenza-tech/haml/releases/tag/v0.0.0
