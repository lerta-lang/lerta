import { execFile } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { check_modules, type Checked } from './check/checker.ts'
import { generate } from './codegen/codegen.ts'
import type { CompileWarning } from './errors.ts'
import { load_modules, type Module } from './loader.ts'

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

// What clang wrote, which it writes for problems in the generated code or the runtime.
export class ClangError extends Error {
  readonly messages: string

  constructor(messages: string) {
    super(`clang failed:\n${messages}`)
    this.messages = messages
  }
}

// The program's modules (see load_modules), what checking them found, and its warnings; a compile
// error is thrown as a CompileError.
export const load_and_check = (
  source_path: string,
): { modules: Module[]; checked: Checked[]; warnings: CompileWarning[] } => {
  const modules = load_modules(source_path)
  const checked = check_modules(modules)
  return { modules, checked, warnings: checked.at(-1)!.warnings }
}

// Returns the warnings, and clang's messages, if it wrote any; a compile error is thrown as a
// CompileError, and clang's failure as a ClangError. Asynchronous, so that several builds can run
// clang at once.
export const build = async (
  source_path: string,
  output_path: string,
  options: BuildOptions,
): Promise<{ warnings: CompileWarning[]; clang_messages: string }> => {
  const { modules, checked, warnings } = load_and_check(source_path)
  const work_dir = mkdtempSync(join(tmpdir(), 'lerta-'))
  try {
    const ir_path = options.llvm_path ?? join(work_dir, 'main.ll')
    writeFileSync(ir_path, generate(modules, checked))
    const clang_args = [
      // clang warns that the .ll has no target triple; the host default is intended.
      '-Wno-override-module',
      ir_path,
      ...runtime_clang_args(options.optimize),
      '-o',
      output_path,
    ]
    const clang_messages = await run_clang(clang_args)
    return { warnings, clang_messages }
  } finally {
    rmSync(work_dir, { recursive: true, force: true })
  }
}

// The most output kept from a program that a build or a test runs.
export const OUTPUT_LIMIT = 64 * 1024 * 1024

// Returns what clang wrote to stderr.
const run_clang = (args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    // The limit is only there to stop runaway output.
    execFile(
      'clang',
      args,
      { encoding: 'utf8', maxBuffer: OUTPUT_LIMIT },
      (error, _stdout, stderr) => {
        if (error === null) resolve(stderr)
        else reject(new ClangError(stderr || error.message))
      },
    )
  })
