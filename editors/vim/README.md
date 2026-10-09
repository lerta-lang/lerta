# Vim support for Lerta

Syntax highlighting, filetype detection, indentation settings and a compiler plugin for Vim and Neovim.

In a Lerta buffer, `:make` runs `lerta dump-checked` on the current file and puts its errors and warnings (see [Diagnostics](../../docs/reference/compiler.md#diagnostics)) in the quickfix list, including those in the modules it imports. `g:lerta_path` names the `lerta` command, `lerta` on `PATH` by default; set it before the buffer is opened. As the compiler counts columns in code points, which Vim takes as screen columns, a column after a wide character, such as a CJK one, or a tab on the same line is off.

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
