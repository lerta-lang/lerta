if exists('current_compiler')
  finish
endif
let current_compiler = 'lerta'

if exists(':CompilerSet') != 2
  command -nargs=* CompilerSet setlocal <args>
endif

" dump-checked prints the typed syntax tree to stdout, which the subshell discards,
" so that only the diagnostics on stderr reach the quickfix list.
let s:lerta = shellescape(get(g:, 'lerta_path', 'lerta'))
execute 'CompilerSet makeprg=' .. escape('(' .. s:lerta .. ' dump-checked %:S >/dev/null)', ' \|"')
CompilerSet errorformat=%f:%l:%v:\ %tarning:\ %m,%f:%l:%v:\ %m
