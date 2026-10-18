# VS Code support for Lerta

A VS Code extension for syntax highlighting, diagnostics and formatting.

It runs the language server of the compiler, `lerta lsp` (see [the reference](../../docs/reference/compiler.md#lsp)), for the `.lerta` files that are open: as you type, it checks the program whose entry module is each open file and shows the errors and warnings of its files, as the reference says, **Format Document** writes a file in the style, as `lerta fmt --fix` would, and hovering a name shows its type, and **Go to Definition** goes to where it is declared. It is a small client of its own, so it needs no `npm install`. The setting `lerta.path` names the `lerta` command; by default it is the workspace's `bin/lerta` if it exists, otherwise `lerta` on `PATH`. A change of it takes effect for a file when the file is opened again; the server of the old command runs until VS Code closes. As the command may come from the workspace, it runs only in trusted workspaces; an untrusted one has syntax highlighting only. If the server cannot start or ends, a message says so; reopening a file starts it again.

## Installing

Link this directory into the extensions directory, from the repository root, and restart VS Code:

```
ln -s "$PWD/editors/vscode" ~/.vscode/extensions/lerta
```

The link keeps the extension as the repository has it; the server is the `lerta` command that `lerta.path` names, so rebuild `bin/lerta` (`make`) to have its changes.

VS Code registers an extension in `~/.vscode/extensions/extensions.json`. It ignores a linked one that is not there once it has been uninstalled, which it lists in `~/.vscode/extensions/.obsolete` and marks removed again at each start. To install it again then, with VS Code closed, remove the entry `lerta.lerta-0.0.1` from `.obsolete` and add one for it to `extensions.json`, as the others are written, with `"identifier": {"id": "lerta.lerta"}`, `"version": "0.0.1"`, the link's path as its `location` and `"relativeLocation": "lerta"`.
