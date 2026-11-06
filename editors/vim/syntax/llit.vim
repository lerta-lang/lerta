" llit is Lerta's literals (see docs/internals/llit.md), which Lerta's syntax colors.
if exists('b:current_syntax')
  finish
endif

runtime! syntax/lerta.vim
let b:current_syntax = 'llit'
