if exists('b:current_syntax')
  finish
endif

" When several matches start at the same position, the one defined last wins,
" and keywords win over matches.

syn match lertaOperator "\.\.\.\|->\|[=!<>+\-*/%:]=\|[-+*/%<>=?!@|]"
syn match lertaCall "\<[a-z_]\w*\ze("
syn match lertaType "\<[A-Z]\w*\>"
syn match lertaConstant "\<[A-Z][A-Z0-9_]\+\>"
syn match lertaDeclarationName "\%(\<\%(class\|struct\|extend\|enum\|interface\)\s\+\)\@<=\h\w*"

" The keywords are those of docs/reference/syntax.md. `is`, `as`, `at`, `in` and `when` are not
" keywords, so they are highlighted only where they take that role, and can be names elsewhere:
" `is` and `as` where a name follows, `at` and `in` after the variables of `for`, and `when` after
" that `in` on the same line or at the start of a `case` arm.
syn match lertaWordOperator "\.\@<!\<\%(is\|as\)\>\ze\s\+\h"
syn match lertaControl "\%(\<for\s\+\%(\h\w*\|([^)]*)\)\%(\s\+at\s\+\h\w*\)\=\s\+\)\@<=in\>"
syn match lertaControl "\%(\<for\s\+\%(\h\w*\|([^)]*)\)\%(\s\+at\s\+\h\w*\)\=\s\+in\s.*\)\@<=\<when\>\ze\s"
syn match lertaControl "\%(^\s*\)\@<=when\>\ze\s"
syn match lertaControl "\%(\<for\s\+\%(\h\w*\|([^)]*)\)\s\+\)\@<=at\>\ze\s\+\h\w*\s\+in\>"
" `private`, `weak` and `default` are not keywords either: `private` before a member, `weak`
" before `var`, a field, a declaration or a function literal, and `default` before the operand of
" a field, not before a binary operator, so that `default - 1` stays a subtraction.
syn match lertaStorage "\%(^\s*\)\@<=private\ze\s\+\h"
syn match lertaStorage "[.@]\@<!\<weak\ze\s\+\%(var\>\|\h\w*\s*:\|(\|->\)"
syn match lertaStorage "\%([^=!<>]=\s*\)\@<=default\ze\s\+\%(\%(and\|or\|not\s\+in\|is\|as\|in\|if\|unless\|then\|for\|while\|until\|when\)\>\)\@!\%(-\S\|[^-+*/%<>=!&|^[:space:]]\)"
syn keyword lertaBoolean true false nil
syn keyword lertaWordOperator and or not
syn keyword lertaControl if else then while unless until for break continue return case throw try catch finally yield await import export
syn keyword lertaStorage const var class struct extern intrinsic extend enum interface

syn match lertaInvalidNumber "\<\d\w*\>"
syn match lertaNumber "\<\%(0x\x\+\|0\|[1-9]\%(_\=\d\)*\)\>"
syn match lertaFloat "\<\%(0\|[1-9]\%(_\=\d\)*\)\%(\.\d\%(_\=\d\)*\%([eE][-+]\=\d\%(_\=\d\)*\)\=\|[eE][-+]\=\d\%(_\=\d\)*\)\>"

syn match lertaInvalidEscape "\\." contained
syn match lertaEscape "\\\%([ntr0\\\"#]\|u{\x\+}\)" contained
syn region lertaBraces start="{" end="}" contained transparent contains=@lertaCode,lertaBraces
syn region lertaInterpolation matchgroup=lertaInterpolationDelimiter start="#{" end="}" contained contains=@lertaCode,lertaBraces
syn region lertaString start=+"+ end=+"\|$+ contains=lertaEscape,lertaInvalidEscape,lertaInterpolation
syn region lertaMultilineString start=+"""+ end=+"""+ contains=lertaEscape,lertaInvalidEscape,lertaInterpolation
syn match lertaRawString "'[^']*'"
" Defined after lertaRawString, so that it wins where both start.
syn region lertaRawMultilineString start=+'''+ end=+'''+

syn match lertaComment "#.*$" contains=@Spell

syn cluster lertaCode contains=lertaComment,lertaRawString,lertaRawMultilineString,lertaString,lertaMultilineString,lertaNumber,lertaFloat,lertaInvalidNumber,lertaDeclarationName,lertaBoolean,lertaWordOperator,lertaControl,lertaStorage,lertaConstant,lertaType,lertaCall,lertaOperator

hi def link lertaComment Comment
hi def link lertaRawString String
hi def link lertaRawMultilineString String
hi def link lertaString String
hi def link lertaMultilineString String
hi def link lertaEscape SpecialChar
hi def link lertaInvalidEscape Error
hi def link lertaInterpolationDelimiter Delimiter
hi def link lertaNumber Number
hi def link lertaFloat Float
hi def link lertaInvalidNumber Error
hi def link lertaBoolean Boolean
hi def link lertaWordOperator Operator
hi def link lertaControl Statement
hi def link lertaStorage StorageClass
hi def link lertaDeclarationName Type
hi def link lertaType Type
hi def link lertaConstant Constant
hi def link lertaCall Function
hi def link lertaOperator Operator

let b:current_syntax = 'lerta'
