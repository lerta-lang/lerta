import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { check } from './checker.ts'
import type { CompileWarning } from './errors.ts'
import { generate } from './codegen.ts'
import { tokenize } from './lexer.ts'
import { parse } from './parser.ts'

const runtime_dir = join(import.meta.dirname, '../../runtime')

// Returns the warnings; a compile error is thrown as a CompileError.
export const build = (source_path: string, output_path: string): CompileWarning[] => {
  const program = parse(tokenize(readFileSync(source_path, 'utf8')))
  const { types, warnings } = check(program)
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
    return warnings
  } finally {
    rmSync(work_dir, { recursive: true, force: true })
  }
}
