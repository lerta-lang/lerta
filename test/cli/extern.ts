// A program with an extern of its own, linked with its C function in each form that clang takes,
// unoptimized and optimized, which compiles C with -flto too. The object and the archive are
// built without -flto, which the optimized build must link as well.
import { join } from 'node:path'
import { compiler, root_dir } from '../lerta.ts'
import { compare_text, expect_success } from '../expect.ts'
import type { Check } from '../report.ts'
import { run_command, work_dir } from './common.ts'

const twice_dir = join(root_dir, 'tests/extern/lib')
const twice_source = join(twice_dir, 'twice.lerta')
const twice_c = join(twice_dir, 'twice.c')
// Each check makes its inputs under names of its own, `name`, since the checks may run at once.
const twice_inputs: [string, (name: string) => Promise<string>][] = [
  ['.c', async () => twice_c],
  ['.o', (name) => compile_c(['-c'], `${name}.o`)],
  ['.ll', (name) => compile_c(['-S', '-emit-llvm'], `${name}.ll`)],
  ['.a', async (name) => archive(await compile_c(['-c'], `${name}.o`), `${name}.a`)],
]

// Runs a tool that makes an input, and throws, which fails the check, if it fails.
const run_tool = async (command: string, args: string[]): Promise<void> => {
  const ran = await run_command(command, args)
  const reasons = expect_success(command, ran)
  if (reasons.length > 0) throw new Error(reasons.join('\n'))
}

const compile_c = async (flags: string[], name: string): Promise<string> => {
  const output = join(work_dir, name)
  await run_tool('clang', [...flags, twice_c, '-o', output])
  return output
}

const archive = async (object: string, name: string): Promise<string> => {
  const output = join(work_dir, name)
  await run_tool('ar', ['rcs', output, object])
  return output
}

// Builds twice.lerta with `file` linked, from `cwd`, and runs it.
const build_twice = async (
  file: string,
  flags: string[],
  cwd: string,
  name: string,
): Promise<string[]> => {
  const executable = join(work_dir, name)
  const args = ['build', twice_source, file, '-o', executable, ...flags]
  const built = await run_command(compiler, args, { cwd })
  if (built.status !== 0) return expect_success('build', built)
  const ran = await run_command(executable, [])
  return [...compare_text('stdout', '42\n', ran.stdout), ...expect_success('run', ran)]
}

export const extern_checks: Check[] = [
  ...twice_inputs.flatMap(([extension, make_input]) =>
    [[], ['-O']].map((flags) => ({
      name: `lerta build <source> <file${extension}> ${[...flags, ''].join(' ')}links the file`,
      run: async () => {
        const name = `twice${extension}${flags.join('')}`
        return build_twice(await make_input(`${name}_input`), flags, work_dir, name)
      },
    })),
  ),
  {
    name: 'lerta build <source> <file> links a file given by a path relative to the current directory',
    run: () => build_twice('twice.c', [], twice_dir, 'twice_relative'),
  },
]
