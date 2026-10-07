import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generate } from './codegen.ts'
import { tokenize } from './lexer.ts'

const runtime_dir = join(import.meta.dirname, '../../runtime')

export const build = (source_path: string, output_path: string): void => {
  const tokens = tokenize(readFileSync(source_path, 'utf8'))
  const work_dir = mkdtempSync(join(tmpdir(), 'lerta-'))
  try {
    const ir_path = join(work_dir, 'main.ll')
    writeFileSync(ir_path, generate(tokens))
    const runtime_sources = [join(runtime_dir, 'lerta.c')]
    // clang warns that the .ll has no target triple; the host default is intended.
    const clang_args = ['-Wno-override-module', ir_path, ...runtime_sources, '-o', output_path]
    execFileSync('clang', clang_args, { stdio: 'inherit' })
  } finally {
    rmSync(work_dir, { recursive: true, force: true })
  }
}
