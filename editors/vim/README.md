# Vim support for Lerta

Syntax highlighting, filetype detection, indentation settings and a compiler plugin for Vim and Neovim.

In Neovim 0.8 or later, a Lerta buffer starts the compiler's language server, `lerta lsp` (see [the reference](../../docs/reference/compiler.md#lsp)), through Neovim's own LSP client, if the `lerta` command is there: as you type, it checks the program whose entry module is each open buffer and shows the errors and warnings of its files, as the reference says, `:lua vim.lsp.buf.format()` writes the buffer in the style, as `lerta fmt --fix` would, and `vim.lsp.buf.hover()` and `vim.lsp.buf.definition()` (`K` and `gd` with the usual mappings) show a name's type and go to its declaration; completion is Neovim's `omnifunc` through the client (`<C-x><C-o>`). In Vim, and in Neovim too, `:make` runs `lerta dump-checked` on the current file and puts its errors and warnings (see [Diagnostics](../../docs/reference/compiler.md#diagnostics)) in the quickfix list, including those in the modules it imports. `g:lerta_path` names the `lerta` command, `lerta` on `PATH` by default; set it before the buffer is opened. As the compiler counts columns in code points, which Vim takes as screen columns, a column after a wide character, such as a CJK one, or a tab on the same line is off.

`.llit` files, Lerta's literals as data (see [llit](../../docs/internals/llit.md)), have the filetype `llit`: Lerta's syntax highlighting and indentation settings, without the compiler plugin or the language server, which would take them as programs.

## Installing

Add this directory to the runtime path in your `vimrc` (or `init.vim`):

```vim
set runtimepath+=/path/to/lerta/editors/vim
```

With pathogen, link this directory into the bundle directory instead:

```
ln -s "$PWD/editors/vim" ~/.vim/bundle/lerta
```

Run it from the repository root.
