<p align="center">
  <img src="https://raw.githubusercontent.com/cadenza-tech/haml/refs/heads/main/images/icon.png" alt="Haml" width="128" height="128">
  <h1 align="center">Haml</h1>
</p>

<p align="center">
  Haml language support with syntax highlighting, linting, and formatting powered by haml-lint.
</p>

<p align="center">
  <a href="https://github.com/cadenza-tech/haml/blob/main/LICENSE.txt"><img src="https://img.shields.io/github/license/cadenza-tech/haml?label=License&labelColor=343B42&color=blue" alt="License"></a>
  <a href="https://github.com/cadenza-tech/haml/blob/main/CHANGELOG.md"><img src="https://img.shields.io/github/tag/cadenza-tech/haml?label=Tag&logo=github&labelColor=343B42&color=2EBC4F" alt="Tag"></a>
  <a href="https://github.com/cadenza-tech/haml/actions?query=workflow%3Atest"><img src="https://github.com/cadenza-tech/haml/actions/workflows/test.yml/badge.svg" alt="Test"></a>
  <a href="https://github.com/cadenza-tech/haml/actions?query=workflow%3Alint"><img src="https://github.com/cadenza-tech/haml/actions/workflows/lint.yml/badge.svg" alt="Lint"></a>
</p>

---

## Features

- Syntax highlighting for `.haml`, including the `:ruby`, `:javascript`, `:css`, `:sass`, `:scss`, `:coffee`, `:markdown`, `:plain`, `:escaped`, `:preserve`, `:cdata` and `:erb` filters
- Multi-line Ruby, continued either with a trailing comma or with the explicit `|` marker
- `#{...}` interpolation highlighted as Ruby wherever it appears, including inside filters
- Diagnostics from [haml-lint](https://github.com/sds/haml-lint), with each linter name linking to its documentation
- Format on save through haml-lint's auto-correct, enabled out of the box and a complete no-op when haml-lint is not available
- Quick Fixes to disable a linter for a block, and a file-level "Fix all auto-correctable Haml offenses" source action
- Go to Definition and completion for the partial a `render` call names, resolved the way Rails resolves it
- Selection refactorings: wrap in a conditional or a Ruby block, and extract to a new partial
- Completion for the `data-*` attributes Turbo, Stimulus and Rails UJS define, in all three Haml notations
- Snippets for Haml control flow, filters, doctypes and comments
- 239 Rails view helper snippets (`link_to`, `form_with`, `f.text_field`, `turbo_frame_tag`, ...), offered only when the file belongs to a Rails project
- Automatic `bundle exec` detection, with a fallback to the `haml-lint` on your `PATH`
- No telemetry and no network requests

## Requirements

Syntax highlighting and snippets work on their own. Diagnostics and formatting need [haml-lint](https://github.com/sds/haml-lint):

```sh
gem install haml_lint
```

or add it to your `Gemfile`:

```ruby
gem 'haml_lint', require: false
```

haml-lint 0.54.0 or newer is required: 0.54.0 introduced `--stdin`, the flag this extension lints your unsaved buffer through, 0.52.0 the `--stderr` that autocorrect has to be paired with, and 0.22.0 the inline `haml-lint:disable` comments the Quick Fixes write.

**haml-lint 0.74.0 or newer is recommended.** Earlier versions only auto-correct RuboCop cops, so formatting would rewrite the Ruby embedded in your views while leaving the Haml untouched. `haml.formatter` defaults to `auto`, which detects this and disables formatting rather than doing something surprising.

## Completion and Emmet

VS Code's built-in Emmet counts Haml among the languages it handles, so it is active in `.haml` files whether or not you want it there. Its Haml support is not good, and its suggestions crowd out the word-based suggestions VS Code would otherwise offer from the current file.

If completion feels unhelpful, turn Emmet off for Haml alone:

```jsonc
"emmet.excludeLanguages": ["markdown", "haml"]
```

Two things to know:

- **Keep `"markdown"` in the list.** It is there by default, and because this setting is an array your value replaces the default rather than adding to it.
- **`emmet.showExpandedAbbreviation` cannot do this.** It is a window-scoped setting, so putting it under `"[haml]"` has no effect, and setting it to `"never"` globally would disable Emmet in HTML too. Its `"inMarkupAndStylesheetFilesOnly"` value does not help either: it only restricts Emmet to the languages it supports natively, and Haml is one of them.

This extension deliberately does not disable Emmet on your behalf, since plenty of people want it.

## Format on Save

Formatting is on by default for `.haml`, with no configuration required — this extension ships the following as defaults:

```jsonc
"[haml]": {
  "editor.defaultFormatter": "cadenza-tech.haml",
  "editor.formatOnSave": true,
  "editor.formatOnSaveMode": "file",
  "editor.tabSize": 2,
  "editor.insertSpaces": true
}
```

These are contributed defaults, so your own settings always win. To turn formatting off, either:

```jsonc
// Leave the formatter registered but stop formatting on save
"[haml]": { "editor.formatOnSave": false }

// Or disable formatting entirely, including manual Format Document
"haml.formatter": "none"
```

If you prefer the code-actions-on-save style instead, note that it runs the same auto-correct — there is no reason to enable both:

```jsonc
// VS Code 1.85 and newer
"editor.codeActionsOnSave": { "source.fixAll.haml": "explicit" }

// VS Code 1.57 to 1.84, where only booleans are supported
"editor.codeActionsOnSave": { "source.fixAll.haml": true }
```

## Rails snippets

On top of the Haml snippets, 239 Rails view helper snippets are available: the full set from
[haml-vscode](https://github.com/karuna/haml-vscode) plus 18 helpers it predates, such as
`form_with`, `turbo_frame_tag`, `turbo_stream_from`, `dom_id`, `rich_text_area` and the `tag`
builder. Typing `= link` and accepting `link_to` gives you `= link_to(...)`, not `= = link_to(...)`,
and `f.te` completes to `f.text_field` rather than `f.f.text_field`.

They are off in a plain Haml project and on in a Rails one, with nothing to configure:

```jsonc
// Look for config/application.rb or a Gemfile.lock listing rails (default)
"haml.snippets.rails": "auto"

// Always offer them
"haml.snippets.rails": "on"

// Never offer them
"haml.snippets.rails": "off"
```

`auto` reads the workspace from disk, so it is always off for files that are not on the local
filesystem — a virtual workspace such as GitHub Repositories, a diff from the `git:` scheme, or an
untitled buffer. It is also off for a file opened on its own without a workspace folder, since there
is then no directory to search upwards from. Set `"on"` in those cases.

Two behaviours differ from the built-in Haml snippets, because a contributed snippet file cannot be
switched off by a setting and these are therefore supplied by a completion provider instead:

- they do not appear in the **Insert Snippet** command
- they do not expand with `editor.tabCompletion`

They are suggested as you type like any other snippet, and honour
`editor.snippetSuggestions: "none"`.

## Partials

`Ctrl` / `Cmd` click a partial name in a `render` call to open it, or use **Go to Definition** and
**Peek Definition**. Typing inside the quotes completes the names of the partials that exist. There is
nothing to configure and no Ruby process is involved — only file names are read, so both work in an
untrusted workspace too.

The name resolves the way Rails resolves it, against the `app/views` directory that contains the
current file:

| Written | Opens |
| - | - |
| `= render 'shared/foo'` | `app/views/shared/_foo.html.haml` |
| `= render 'sidebar'` | `_sidebar.html.haml` beside the current file, then `app/views/application/` |
| `= render partial: 'shared/foo'` | the same as the first form |
| `= render layout: 'shared/foo' do` | the same as the first form |

`.haml` is preferred over `.erb`, and the current file's own format over `html`: from
`index.turbo_stream.haml`, `= render 'shared/foo'` opens `_foo.turbo_stream.haml` when it exists and
falls back to `_foo.html.haml` when it does not.

`= render template: 'posts/index'` is deliberately not followed. A template resolves without the
leading underscore, so treating it as a partial would point at a file that is not there.

Completion offers a partial that sits beside the current file under its bare name, and everything else
under its `app/views`-relative name, which is what Rails needs in each case. Turn it off with:

```jsonc
"haml.completions.partials": false
```

## data attribute completion

Inside an attribute list, typing `data-` completes the attributes Turbo, Stimulus and Rails UJS
define, in whichever of Haml's three notations you are using:

```haml
%a{ 'data-turbo-frame': 'modal' }
%div{ data: { controller: 'dropdown' } }
%span(data-turbo-action="advance")
```

In a nested `data:` hash the key is offered underscored (`turbo_frame`), because Haml converts an
underscore there into a dash. Everywhere else the dashed name is offered, quoted with single quotes
whichever quote you started typing.

Attributes whose presence *is* the value — `data-turbo-permanent`, `data-turbo-stream` and the rest —
are inserted without one. Stimulus contributes only `data-controller` and `data-action`: target, value
and class names are per controller, so a placeholder for them would never match what you type.

Nothing is read from disk and no process is started, so this works in an untrusted or virtual
workspace. Turn it off with:

```jsonc
"haml.completions.dataAttributes": false
```

## Syntax highlighting only

To get highlighting and snippets without ever starting a Ruby process:

```jsonc
"haml.formatter": "none",
"haml.lint.run": "off"
```

With both set, nothing is spawned when you open, edit or save a `.haml` file — not even the version probe. The `Haml: Lint File` command still runs haml-lint, because invoking it explicitly is a deliberate request.

Rails snippets never spawn anything either, but `auto` does read `Gemfile.lock` from the workspace. Set `"haml.snippets.rails": "off"` to stop even that.

## Settings

| Setting | Default | Description |
| - | - | - |
| `haml.lint.run` | `onSave` | When to run diagnostics: `onSave` (also on open), `onType`, or `off`. |
| `haml.lint.debounceMs` | `500` | Debounce in milliseconds while typing. Only used when `haml.lint.run` is `onType`. |
| `haml.lint.exclude` | `[]` | Glob patterns of files to skip, relative to the workspace folder. See [Known Limitations](#known-limitations). |
| `haml.formatter` | `auto` | Auto-correct mode: `auto`, `safe` (`haml-lint -a`), `all` (`haml-lint -A`), or `none`. |
| `haml.hamlLint.executablePath` | `null` | Absolute path to the haml-lint executable, or a bare command name resolved on `PATH`; relative paths are refused. Skips bundler detection when set. |
| `haml.hamlLint.useBundler` | `auto` | Whether to run through `bundle exec`: `auto`, `always`, or `never`. |
| `haml.hamlLint.configPath` | `null` | Configuration file passed as `-c`. |
| `haml.hamlLint.timeoutMs` | `15000` | How long to wait for a haml-lint process before terminating it. See [Known Limitations](#known-limitations). |
| `haml.snippets.rails` | `auto` | Whether to offer Rails view helper snippets: `auto`, `on`, or `off`. See [Rails snippets](#rails-snippets). |
| `haml.completions.partials` | `true` | Whether to complete partial names inside a `render` call. See [Partials](#partials). |
| `haml.completions.dataAttributes` | `true` | Whether to complete Turbo, Stimulus and Rails UJS `data-*` attributes. See [data attribute completion](#data-attribute-completion). |

`haml.formatter: "all"` maps to `haml-lint -A`, which includes RuboCop's unsafe auto-corrections. Those can change what your program does.

`haml.hamlLint.executablePath`, `haml.hamlLint.useBundler` and `haml.hamlLint.configPath` are machine-scoped, so a repository cannot point them at an arbitrary binary through its own `.vscode/settings.json`.

## Commands

| Command | Description |
| - | - |
| `Haml: Lint File` | Run haml-lint against the active file. |
| `Haml: Fix All Auto-correctable Offenses` | Apply haml-lint auto-correct to the active file. |
| `Haml: Wrap in Conditional` | Wrap the selection in `- if`, with the condition selected so you can type over it. |
| `Haml: Wrap in Block` | Wrap the selection in a Ruby `each` block, with the collection selected. |
| `Haml: Split to Partial` | Move the selection into a new partial and replace it with `= render`. |
| `Haml: Restart Linter` | Forget the cached haml-lint version and re-lint open files. |
| `Haml: Show Output Channel` | Open the log, which records every command, its working directory, exit code and stderr. |

## Security

Linting a Haml file runs Ruby code from your workspace: `bundle exec` evaluates the `Gemfile`, `.haml-lint.yml` is processed as ERB, and `.rubocop.yml` can `require` arbitrary `.rb` files. This extension therefore declares limited support for untrusted workspaces — in a workspace you have not trusted, syntax highlighting and snippets work, and no process is ever spawned.

## Known Limitations

- **`exclude:` in `.haml-lint.yml` is not applied.** haml-lint skips its file finder when reading from stdin, and because the config is ERB it cannot be parsed to reproduce the behaviour. Use `haml.lint.exclude` instead. Per-linter `include:` / `exclude:` are unaffected and still work.
- **Diagnostics cover a whole line.** haml-lint reports a line number and no column.
- **A file that times out is left alone until something changes.** haml-lint costs disproportionately more on a large file, so once a run has exceeded `haml.hamlLint.timeoutMs` on a document, saving it again would only spend the same time to be killed again. Automatic runs for that document are therefore paused until it gets smaller, `haml.hamlLint.timeoutMs` is raised, or you run `Haml: Lint File` or `Haml: Restart Linter`. The output channel records it when it happens.
- **This extension never writes to your configuration files.**
- **Only `.haml-lint.yml`, `.haml-lint_todo.yml` and `.rubocop.yml` are watched.** Changing any of them re-lints the Haml files you have open. `.haml-lint_todo.yml` is watched because `haml-lint --auto-gen-config` always writes that name, but haml-lint reads it only when your `.haml-lint.yml` names it in `inherits_from` — without that line it is watched and still inert, exactly as it is on the command line. A configuration reached some other way — a file named by `haml.hamlLint.configPath`, or any other file pulled in by `inherits_from` — is still read on every run, but changing it does not refresh anything on its own until you edit a `.haml` file or run `Haml: Lint File`.
- **`Haml: Split to Partial` adds no `locals:`.** Instance variables carry over on their own, but a selection using a block variable needs the argument adding by hand — deriving them means parsing the Ruby in the selection, and getting that wrong would silently change what the view renders. It also never overwrites: if a partial of that name already exists the command stops, and it needs a file saved on disk, unlike the two wrap commands which work in an untitled buffer too.
- **A selection is interpreted by indentation alone.** With no selection the block under the cursor is used, and a selection whose last line still has children is extended to include them — otherwise raising it one level would detach them. The one thing read beyond indentation is a mid-block keyword: an `- else`, `- elsif`, `- when`, `- rescue` or `- ensure` stays with the `- if`, `- case` or `- begin` it belongs to, so a selection that covers only part of such a construct grows to all of it. Nothing understands filters, so wrapping the body of a `:ruby` or `:javascript` filter produces broken Ruby or JavaScript, and neither does anything understand multi-line Ruby, so a selection starting midway through a `|`-continued or comma-continued expression is not valid either.
- **Partials are resolved against one `app/views`.** The one containing the current file, which means an engine's or a dummy app's is used when the file lives there. `prepend_view_path` and an engine's view path chain would need the application to be booted, so they are not followed.
- **Attribute completion reads one line.** An attribute hash spread over several lines cannot be judged from the line being typed, so nothing is offered there.
- **Partial completion needs a workspace folder.** File search always comes back empty without one, so a `.haml` file opened on its own gets Go to Definition but no completion. Multi-line `render partial:` calls are not covered either, since the name has to be on the line being typed.
- **`haml` language id conflicts.** Several extensions contribute the `haml` language and the `text.haml` grammar. If more than one is installed the result is whichever loads last, so installing only one is recommended.

## Contributing

Bug reports and pull requests are welcome on GitHub at https://github.com/cadenza-tech/haml. This project is intended to be a safe, welcoming space for collaboration, and contributors are expected to adhere to the [code of conduct](https://github.com/cadenza-tech/haml/blob/main/CODE_OF_CONDUCT.md).

## License

The extension is available as open source under the terms of the [MIT License](https://github.com/cadenza-tech/haml/blob/main/LICENSE.txt).

The bundled TextMate grammar, language configuration, snippets and Rails snippet set are derived from [haml-vscode](https://github.com/karuna/haml-vscode) by Karuna Murti, also MIT licensed. See [syntaxes/NOTICE.md](https://github.com/cadenza-tech/haml/blob/main/syntaxes/NOTICE.md) for the vendored commit and the list of modifications.

## Code of Conduct

Everyone interacting in the Haml project's codebases, issue trackers, chat rooms and mailing lists is expected to follow the [code of conduct](https://github.com/cadenza-tech/haml/blob/main/CODE_OF_CONDUCT.md).

## Sponsor

You can sponsor this project on [GitHub Sponsors](https://github.com/sponsors/cadenza-tech).
