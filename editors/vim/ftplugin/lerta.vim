if exists('b:did_ftplugin')
  finish
endif
let b:did_ftplugin = 1

" Indentation is made of spaces only; a tab in it is a compile error.
setlocal expandtab shiftwidth=2 softtabstop=2
setlocal commentstring=#\ %s comments=:#
compiler lerta

let b:undo_ftplugin = 'setlocal expandtab< shiftwidth< softtabstop< commentstring< comments< makeprg< errorformat< | unlet! b:current_compiler'
