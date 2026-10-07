import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { check } from './checker.ts'
import { generate } from './codegen.ts'
import type { CompileWarning } from './errors.ts'
import { tokenize } from './lexer.ts'
import { parse } from './parser.ts'

const runtime_dir = join(import.meta.dirname, '../../runtime')

export type BuildOptions = {
  optimize: boolean
  // Where to write the generated LLVM IR, which is also what clang compiles.
  llvm_path?: string
}

// Link-time optimization lets the generated code inline the runtime's C functions.
const optimization_flags = ['-O2', '-flto']
// Unoptimized builds use the debug runtime, which checks for leaks at exit.
const debug_flags = ['-D', 'LERTA_DEBUG']

// The clang arguments that compile the runtime, shared with the runtime's own checks.
export const runtime_clang_args = (optimize: boolean): string[] => [
  ...(optimize ? optimization_flags : debug_flags),
  ...readdirSync(runtime_dir)
    .filter((file) => file.endsWith('.c'))
    .map((file) => join(runtime_dir, file)),
]

// Returns the warnings; a compile error is thrown as a CompileError.
export const build = (
  source_path: string,
  output_path: string,
  options: BuildOptions,
): CompileWarning[] => {
  const program = parse(tokenize(readFileSync(source_path, 'utf8')))
  const { types, warnings } = check(program)
  const work_dir = mkdtempSync(join(tmpdir(), 'lerta-'))
  try {
    const ir_path = options.llvm_path ?? join(work_dir, 'main.ll')
    writeFileSync(ir_path, generate(program, types))
    const clang_args = [
      // clang warns that the .ll has no target triple; the host default is intended.
      '-Wno-override-module',
      ir_path,
      ...runtime_clang_args(options.optimize),
      '-o',
      output_path,
    ]
    execFileSync('clang', clang_args, { stdio: 'inherit' })
    return warnings
  } finally {
    rmSync(work_dir, { recursive: true, force: true })
  }
}
