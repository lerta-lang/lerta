const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const vscode = require('vscode')

// A client of `lerta lsp` (see docs/reference/compiler.md#lsp), written without the
// vscode-languageclient package, so that the extension needs no install of its own: it sends the
// Lerta documents' texts, shows the diagnostics that the server publishes, and formats a document
// by its edits. One server runs for each lerta command, as each workspace folder may have its own.
// A server that fails is started again only when a document is opened, not at each edit.
function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection('lerta')
  // The servers by their commands, and the server that each open document was sent to, by URI.
  const servers = new Map()
  const holders = new Map()

  // Only the documents of files: a program's modules are files, and the server reads no others.
  const isLerta = document =>
    vscode.workspace.isTrusted && document.languageId === 'lerta' && document.uri.scheme === 'file'

  function start(command) {
    const child = spawn(command, ['lsp'], { stdio: ['pipe', 'pipe', 'pipe'] })
    const server = { command, child, nextId: 1, pending: new Map(), published: new Set(), ended: false }
    servers.set(command, server)
    let buffer = Buffer.alloc(0)
    let stderr = ''
    child.stdout.on('data', data => {
      buffer = Buffer.concat([buffer, data])
      for (;;) {
        const headerEnd = buffer.indexOf('\r\n\r\n')
        if (headerEnd < 0) return
        const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, headerEnd).toString())?.[1])
        const start = headerEnd + 4
        if (buffer.length < start + length) return
        receive(server, JSON.parse(buffer.subarray(start, start + length).toString()))
        buffer = buffer.subarray(start + length)
      }
    })
    // Only the end of what the server wrote is kept, for the message when it ends.
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-1000) })
    // A write to a server that has just ended fails; its end is reported as the child ends.
    child.stdin.on('error', () => {})
    child.on('error', error => end(server, `cannot run '${error.path}' (${error.code})`))
    child.on('close', (code, signal) => {
      end(server, `lerta lsp ended (${signal ?? `exit code ${code}`}) ${stderr.trim()}`.trim())
    })
    // Nothing but the initialize request goes before its result comes, as the protocol has it.
    const params = { processId: process.pid, rootUri: null, capabilities: {} }
    server.ready = call(server, 'initialize', params).then(() => write(server, { method: 'initialized', params: {} }))
    server.ready.catch(() => {})
    return server
  }

  // A server that ends takes its diagnostics with it, and lets go of the documents sent to it.
  function end(server, message) {
    if (server.ended) return
    server.ended = true
    for (const { reject } of server.pending.values()) reject(new Error(message))
    const othersPublished = uri =>
      [...servers.values()].some(other => other !== server && !other.ended && other.published.has(uri))
    for (const uri of server.published) {
      if (!othersPublished(uri)) diagnostics.delete(vscode.Uri.parse(uri))
    }
    for (const [uri, holder] of holders) if (holder === server) holders.delete(uri)
    if (!server.stopping) {
      vscode.window.showErrorMessage(`Lerta: ${message}. Set lerta.path, or open a file to start it again.`)
    }
  }

  function write(server, message) {
    if (server.ended) return
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }))
    server.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
    server.child.stdin.write(body)
  }

  function call(server, method, params) {
    const id = server.nextId++
    write(server, { id, method, params })
    return new Promise((resolve, reject) => server.pending.set(id, { resolve, reject }))
  }

  const notify = (server, method, params) => server.ready.then(() => write(server, { method, params }), () => {})

  const request = (server, method, params) => server.ready.then(() => call(server, method, params))

  function receive(server, message) {
    if (message.method === 'textDocument/publishDiagnostics') {
      const uri = vscode.Uri.parse(message.params.uri)
      const document = vscode.workspace.textDocuments.find(each => each.uri.fsPath === uri.fsPath)
      server.published.add(message.params.uri)
      diagnostics.set(uri, message.params.diagnostics.map(each => toDiagnostic(each, document)))
      return
    }
    const waiting = server.pending.get(message.id)
    if (!waiting) return
    server.pending.delete(message.id)
    if (message.error) waiting.reject(new Error(message.error.message))
    else waiting.resolve(message.result)
  }

  // Sends the document to the server of its command, which is started if there is none or it has
  // ended, and then sent each open document of that command that no other server holds.
  function open(document) {
    if (!isLerta(document) || holders.has(document.uri.toString())) return
    const command = lertaPath(document)
    const running = servers.get(command)
    if (running && !running.ended) return sendOpen(running, document)
    const server = start(command)
    vscode.workspace.textDocuments
      .filter(each => isLerta(each) && lertaPath(each) === command && !holders.has(each.uri.toString()))
      .forEach(each => sendOpen(server, each))
  }

  function sendOpen(server, document) {
    const uri = document.uri.toString()
    holders.set(uri, server)
    const textDocument = { uri, languageId: 'lerta', version: document.version, text: document.getText() }
    notify(server, 'textDocument/didOpen', { textDocument })
  }

  function change(event) {
    const uri = event.document.uri.toString()
    const server = holders.get(uri)
    if (!server) return
    const textDocument = { uri, version: event.document.version }
    notify(server, 'textDocument/didChange', { textDocument, contentChanges: [{ text: event.document.getText() }] })
  }

  function close(document) {
    const uri = document.uri.toString()
    const server = holders.get(uri)
    if (!server) return
    holders.delete(uri)
    notify(server, 'textDocument/didClose', { textDocument: { uri } })
  }

  const formatter = {
    async provideDocumentFormattingEdits(document) {
      const server = holders.get(document.uri.toString())
      if (!server) return []
      const params = { textDocument: { uri: document.uri.toString() }, options: {} }
      const edits = await request(server, 'textDocument/formatting', params).catch(() => null)
      return (edits ?? []).map(edit => vscode.TextEdit.replace(toRange(edit.range), edit.newText))
    },
  }

  function stop(server) {
    if (server.ended) return
    server.stopping = true
    request(server, 'shutdown', null)
      .then(() => notify(server, 'exit', null), () => {})
      .finally(() => server.child.stdin.end())
  }

  context.subscriptions.push(
    diagnostics,
    vscode.workspace.onDidOpenTextDocument(open),
    vscode.workspace.onDidChangeTextDocument(change),
    vscode.workspace.onDidCloseTextDocument(close),
    vscode.workspace.onDidGrantWorkspaceTrust(() => vscode.workspace.textDocuments.forEach(open)),
    vscode.languages.registerDocumentFormattingEditProvider({ language: 'lerta', scheme: 'file' }, formatter),
    { dispose: () => servers.forEach(stop) },
  )
  vscode.workspace.textDocuments.forEach(open)
}

function lertaPath(document) {
  const configured = vscode.workspace.getConfiguration('lerta', document.uri).get('path')
  if (configured) return configured
  const folder = vscode.workspace.getWorkspaceFolder(document.uri)
  const repositoryLerta = folder && path.join(folder.uri.fsPath, 'bin', 'lerta')
  return repositoryLerta && fs.existsSync(repositoryLerta) ? repositoryLerta : 'lerta'
}

// The server's positions are in UTF-16 units, as VS Code's are, since the client does not offer
// UTF-32: they need no conversion, though they differ from the columns that lerta build prints,
// in code points, after a character above U+FFFF.
const toPosition = ({ line, character }) => new vscode.Position(line, character)

const toRange = ({ start, end }) => new vscode.Range(toPosition(start), toPosition(end))

// A diagnostic at a point covers the word there in its document, if it is open, so that it shows.
function toDiagnostic({ range, severity, message }, document) {
  const start = toPosition(range.start)
  const shown = document?.getWordRangeAtPosition(start) ?? new vscode.Range(start, start.translate(0, 1))
  const kind = severity === 2 ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error
  const diagnostic = new vscode.Diagnostic(shown, message, kind)
  diagnostic.source = 'lerta'
  return diagnostic
}

module.exports = { activate }
