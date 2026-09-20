# Grammar regression tests

`yarn test:grammar` runs `vscode-tmgrammar-snap` over `*.haml` in this directory and compares the
result against the committed `*.haml.snap` files. Run `yarn test:grammar:update` to accept
intentional changes, and read the diff before committing it.

## Why `grammar-test.config.json` and `stubs/` exist

`vscode-tmgrammar-snap` resolves `include:` targets through a `contributes.grammars` registry, and
**vscode-textmate silently drops an entire pattern when its include target is not registered** — not
just the include. The Haml grammar's filter patterns all include an external grammar
(`source.ruby`, `source.css`, …), so running the snapshots against the extension's own
`package.json` produces output where every `:ruby` / `:css` / `:javascript` / `:plain` / `:markdown`
region is unscoped. That looks exactly like a broken grammar, but it is an artifact of the harness.

`stubs/` holds near-empty grammars that only claim those scope names, and
`grammar-test.config.json` registers them alongside the real Haml grammar. This keeps the filter
region boundaries — which this extension owns — under test, without vendoring third-party
Ruby/CSS/JavaScript grammars.

The stubs tokenize nothing a real template holds, so the snapshots assert where each filter region
starts and ends, not how its contents are tokenized. Highlighting *inside* a filter comes from the
real embedded grammar at runtime and has to be checked by hand in the Extension Development Host
(`Developer: Inspect Editor Tokens and Scopes`).

Each stub does carry one rule, which opens on `LEFT_OPEN_BY_THE_STUB` and never finds its end. It
stands for whatever a real grammar leaves open across lines — a block comment, a template literal, a
`{`. The other fixtures pin where a region ends when nothing inside it is open; `filter-leak.haml`
pins that it ends *anyway*, which is the whole difference between `while` and `end`: an open
construct sits above the filter on the rule stack, and a region bounded by `end` is never asked
again. It is the one fixture that holds the word. `comment-leak.haml` pins the same property for a
comment, whose body is Haml and so needs no stub to leave something open.
