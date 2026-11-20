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
" Its root is the repository that holds the buffer, or else the buffer's directory: the server
" finds references in the files under it, and Neovim reuses the client of a root for its buffers.
if has('nvim-0.8') && executable(get(g:, 'lerta_path', 'lerta'))
  lua << EOF
    local dir = vim.fs.dirname(vim.api.nvim_buf_get_name(0))
    local repository = vim.fs.find('.git', { upward = true, path = dir })[1]
    local root_dir = repository and vim.fs.dirname(repository) or dir
    vim.lsp.start({ name = 'lerta', cmd = { vim.g.lerta_path or 'lerta', 'lsp' }, root_dir = root_dir })
EOF
  " Another filetype leaves the buffer to no Lerta server; get_clients replaces get_active_clients
  " from Neovim 0.10. The `lua` goes in an `exe`, so that what is appended after it is a command of
  " its own rather than more Lua.
  let b:undo_ftplugin ..= " | exe 'lua for _, client in ipairs((vim.lsp.get_clients or vim.lsp.get_active_clients)({ bufnr = 0, name = \"lerta\" })) do vim.lsp.buf_detach_client(0, client.id) end'"
endif
