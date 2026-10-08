// `--target <triple>`, the one option of the run and bootstrap checks, has the compiler build the
// programs for another target than the host, such as i686-linux-gnu for the 32-bit programs that an
// x86-64 host can run. Returns the arguments to pass to the compiler's build.
export const target_args = (script: string): string[] => {
  const [option, triple, ...rest] = process.argv.slice(2)
  if (option === undefined) return []
  if (option !== '--target' || triple === undefined || rest.length > 0) {
    console.error(`usage: node test/${script} [--target <triple>]`)
    process.exit(2)
  }
  return ['--target', triple]
}
