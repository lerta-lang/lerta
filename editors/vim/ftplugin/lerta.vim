if exists('b:did_ftplugin')
  finish
endif
let b:did_ftplugin = 1

" Indentation is made of spaces only; a tab in it is a compile error.
setlocal expandtab shiftwidth=2 softtabstop=2
setlocal commentstring=#\ %s comments=:#
compiler lerta

let b:undo_ftplugin = 'setlocal expandtab< shiftwidth< softtabstop< commentstring< comments< makeprg< errorformat< | unlet! b:current_compiler'

" Neovim's own LSP client runs the compiler's language server, if the lerta command is there.
" Neovim reuses a client of the same name and root; `lerta lsp` takes no root, so a fixed one
" makes one server hold all the Lerta buffers, as a program's modules span directories.
if has('nvim-0.8') && executable(get(g:, 'lerta_path', 'lerta'))
  lua vim.lsp.start({ name = 'lerta', cmd = { vim.g.lerta_path or 'lerta', 'lsp' }, root_dir = '/' })
  " Another filetype leaves the buffer to no Lerta server; get_clients replaces get_active_clients
  " from Neovim 0.10. The `lua` goes in an `exe`, so that what is appended after it is a command of
  " its own rather than more Lua.
  let b:undo_ftplugin ..= " | exe 'lua for _, client in ipairs((vim.lsp.get_clients or vim.lsp.get_active_clients)({ bufnr = 0, name = \"lerta\" })) do vim.lsp.buf_detach_client(0, client.id) end'"
endif
