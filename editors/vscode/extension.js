const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const vscode = require('vscode')

const DIAGNOSTIC_LINE = /^(.+?):(\d+):(\d+): (warning: )?(.*)$/

function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection('lerta')
  const running = new Map()
  // For each checked source, the diagnostics of its last run by file, which may be modules it imports.
  const results = new Map()
  let reportedSpawnFailure = false

  function check(document) {
    if (!vscode.workspace.isTrusted || document.languageId !== 'lerta' || document.uri.scheme !== 'file') return
    const source = document.uri.fsPath
    running.get(source)?.kill()
    const cwd = path.dirname(source)
    // dump-checked prints the typed syntax tree to stdout, which only the diagnostics on stderr matter beside.
    const child = spawn(lertaPath(document), ['dump-checked', source], { cwd, stdio: ['ignore', 'ignore', 'pipe'] })
    running.set(source, child)
    let stderr = ''
    let spawnFailed = false
    child.stderr.on('data', data => { stderr += data })
    child.on('error', error => {
      spawnFailed = true
      running.delete(source)
      if (reportedSpawnFailure) return
      reportedSpawnFailure = true
      vscode.window.showErrorMessage(`Lerta: cannot run '${error.path}' (${error.code}). Set lerta.path.`)
    })
    child.on('close', (code, signal) => {
      // A killed run was superseded by a newer one, which reports instead.
      if (child.killed || spawnFailed) return
      running.delete(source)
      reportedSpawnFailure = false
      const byFile = parseDiagnostics(stderr, cwd, source)
      if (code !== 0 && byFile.size === 0) {
        byFile.set(source, [{ line: 0, codePoint: 0, isWarning: false, message: `lerta failed (${signal ?? `exit code ${code}`})` }])
      }
      publish(source, byFile)
    })
  }

  function publish(source, byFile) {
    const files = new Set([...(results.get(source)?.keys() ?? []), ...byFile.keys()])
    if (byFile.size === 0) results.delete(source)
    else results.set(source, byFile)
    for (const file of files) {
      const uri = vscode.Uri.file(file)
      diagnostics.set(uri, uniqueEntries(file).map(entry => toDiagnostic(file, entry)))
    }
  }

  // Sources that import the same module report its diagnostics each.
  function uniqueEntries(file) {
    const byKey = new Map()
    for (const byFile of results.values()) {
      for (const entry of byFile.get(file) ?? []) byKey.set(JSON.stringify(entry), entry)
    }
    return [...byKey.values()]
  }

  function forget(document) {
    if (document.uri.scheme !== 'file') return
    const source = document.uri.fsPath
    running.get(source)?.kill()
    running.delete(source)
    publish(source, new Map())
  }

  context.subscriptions.push(
    diagnostics,
    vscode.workspace.onDidOpenTextDocument(check),
    vscode.workspace.onDidSaveTextDocument(check),
    vscode.workspace.onDidCloseTextDocument(forget),
    vscode.workspace.onDidGrantWorkspaceTrust(() => vscode.workspace.textDocuments.forEach(check)),
  )
  vscode.workspace.textDocuments.forEach(check)
}

function lertaPath(document) {
  const configured = vscode.workspace.getConfiguration('lerta', document.uri).get('path')
  if (configured) return configured
  const folder = vscode.workspace.getWorkspaceFolder(document.uri)
  const repositoryLerta = folder && path.join(folder.uri.fsPath, 'bin', 'lerta')
  return repositoryLerta && fs.existsSync(repositoryLerta) ? repositoryLerta : 'lerta'
}

// Lines that are not diagnostics, such as "'<source>' is not a file" or a crash of the compiler,
// go on the first line of the source.
function parseDiagnostics(stderr, cwd, source) {
  const byFile = new Map()
  const add = (file, entry) => byFile.set(file, [...(byFile.get(file) ?? []), entry])
  for (const line of stderr.split('\n').filter(line => line !== '')) {
    const match = DIAGNOSTIC_LINE.exec(line)
    if (match) {
      const [, file, lineNumber, column, warning, message] = match
      add(path.resolve(cwd, file), { line: Number(lineNumber) - 1, codePoint: Number(column) - 1, isWarning: !!warning, message })
    } else {
      add(source, { line: 0, codePoint: 0, isWarning: false, message: line })
    }
  }
  return byFile
}

function toDiagnostic(file, { line, codePoint, isWarning, message }) {
  const severity = isWarning ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error
  return new vscode.Diagnostic(rangeAt(file, line, codePoint), message, severity)
}

// The compiler counts columns in code points, VS Code in UTF-16 code units.
function rangeAt(file, line, codePoint) {
  const document = vscode.workspace.textDocuments.find(document => document.uri.fsPath === file)
  const text = document && line < document.lineCount ? document.lineAt(line).text : undefined
  const character = text === undefined ? codePoint : [...text].slice(0, codePoint).join('').length
  const position = new vscode.Position(line, character)
  const word = document?.getWordRangeAtPosition(position)
  return word ?? new vscode.Range(position, position.translate(0, 1))
}

module.exports = { activate }
