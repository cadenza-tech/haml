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

`stubs/` holds empty grammars that only claim those scope names, and
`grammar-test.config.json` registers them alongside the real Haml grammar. This keeps the filter
region boundaries — which this extension owns — under test, without vendoring third-party
Ruby/CSS/JavaScript grammars.

The stubs contribute no patterns, so the snapshots assert where each filter region starts and ends,
not how its contents are tokenized. Highlighting *inside* a filter comes from the real embedded
grammar at runtime and has to be checked by hand in the Extension Development Host
(`Developer: Inspect Editor Tokens and Scopes`).
