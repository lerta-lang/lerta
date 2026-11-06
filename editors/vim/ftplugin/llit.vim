" Lerta's literals (see docs/internals/llit.md): indented with spaces only, as a tab in it is an
" error, as in Lerta; without its compiler or its language server, which would take a file as a
" program.
if exists('b:did_ftplugin')
  finish
endif
let b:did_ftplugin = 1

setlocal expandtab shiftwidth=2 softtabstop=2
setlocal commentstring=#\ %s comments=:#

let b:undo_ftplugin = 'setlocal expandtab< shiftwidth< softtabstop< commentstring< comments<'
