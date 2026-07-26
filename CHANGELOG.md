# Change Log

All notable changes to the "Haml" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.0.0]: https://github.com/cadenza-tech/haml/releases/tag/v0.0.0
