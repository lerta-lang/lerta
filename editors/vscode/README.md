# VS Code support for Lerta

A VS Code extension for syntax highlighting and compiler diagnostics.

When a `.lerta` file is opened or saved, the extension runs `lerta dump-checked` on it and shows its errors and warnings (see [Diagnostics](../../docs/reference/compiler.md#diagnostics)), including those in the modules it imports. The setting `lerta.path` names the `lerta` command; by default it is the workspace's `bin/lerta` if it exists, otherwise `lerta` on `PATH`. As the command may come from the workspace, it runs only in trusted workspaces; an untrusted one has syntax highlighting only.

## Installing

Link this directory into the extensions directory and reload VS Code:

```
ln -s "$PWD/editors/vscode" ~/.vscode/extensions/lerta
```

Run it from the repository root.
