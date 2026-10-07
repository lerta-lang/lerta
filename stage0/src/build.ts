import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { check } from './checker.ts'
import { generate } from './codegen.ts'
import { tokenize } from './lexer.ts'
import { parse } from './parser.ts'

const runtime_dir = join(import.meta.dirname, '../../runtime')

export const build = (source_path: string, output_path: string): void => {
  const program = parse(tokenize(readFileSync(source_path, 'utf8')))
  const types = check(program)
  const work_dir = mkdtempSync(join(tmpdir(), 'lerta-'))
  try {
    const ir_path = join(work_dir, 'main.ll')
    writeFileSync(ir_path, generate(program, types))
    const runtime_sources = readdirSync(runtime_dir)
      .filter((file) => file.endsWith('.c'))
      .map((file) => join(runtime_dir, file))
    // clang warns that the .ll has no target triple; the host default is intended.
    const clang_args = ['-Wno-override-module', ir_path, ...runtime_sources, '-o', output_path]
    execFileSync('clang', clang_args, { stdio: 'inherit' })
  } finally {
    rmSync(work_dir, { recursive: true, force: true })
  }
}
