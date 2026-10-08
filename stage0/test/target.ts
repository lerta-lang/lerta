// `--target <triple>`, the one option of the run and bootstrap checks, has the compiler build the
// programs for another target than the host, such as i686-linux-gnu for the 32-bit programs that an
// x86-64 host can run, or x86_64-w64-mingw32 for Windows programs, which Wine runs.
export type Target = {
  // The arguments to pass to the compiler's build.
  args: string[]
  windows: boolean
}

export const parse_target = (script: string): Target => {
  const [option, triple, ...rest] = process.argv.slice(2)
  if (option === undefined) return { args: [], windows: false }
  if (option !== '--target' || triple === undefined || rest.length > 0) {
    console.error(`usage: node test/${script} [--target <triple>]`)
    process.exit(2)
  }
  return { args: ['--target', triple], windows: triple.endsWith('-w64-mingw32') }
}
