// Wine runs the Windows programs. One wineserver serves all the programs of a prefix, and serves
// them one request at a time, so that it limits how many run at once; concurrent runs are given
// prefixes of their own, each with its own wineserver.
import { spawn } from 'node:child_process'
import { copyFileSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const source_prefix = process.env.WINEPREFIX ?? join(homedir(), '.wine')

// Wine starts its device service as it starts a prefix, whose kernel, ntoskrnl.exe, may fault when
// the machine is busy, as when the cross tests run, and writes so to the program's stderr. No
// tested program needs a device driver, so the service is not started.
process.env.WINEDLLOVERRIDES = 'winedevice.exe=d'

// How long a wineserver outlives its last program, in seconds: long enough to serve every run, and
// short enough that one left by a killed test run goes away.
const SERVER_LINGER = 60

// Prefixes that a run takes for itself and gives back when it ends. `take` gives none when none is
// free, and the run then uses the prefix of the environment, as all do with no prefixes.
export type WinePrefixes = {
  take: () => string | undefined
  give_back: (prefix: string) => void
  stop: () => Promise<void>
}

const prefix_pool = (prefixes: string[]): WinePrefixes => {
  const free = [...prefixes]
  return {
    take: () => free.pop(),
    give_back: (prefix) => {
      free.push(prefix)
    },
    stop: () => stop_prefixes(prefixes),
  }
}

export const NO_WINE_PREFIXES = prefix_pool([])

// `count` copies of the prefix in `dir`, started; none if the prefix cannot be copied, as when it
// is on another file system, which is reported.
export const start_wine_prefixes = async (dir: string, count: number): Promise<WinePrefixes> => {
  const prefixes = Array.from({ length: count }, (_, i) => join(dir, `wine-${i}`))
  const started: string[] = []
  try {
    await update_source_prefix()
    // All of them end before any fails the whole, so that every wineserver started is stopped.
    const results = await Promise.allSettled(
      prefixes.map((prefix) => start_prefix(prefix, started)),
    )
    const failure = results.find((result) => result.status === 'rejected')
    if (failure !== undefined) throw failure.reason
    return prefix_pool(prefixes)
  } catch (error) {
    await stop_prefixes(started)
    console.log(`the runs share the Wine prefix ${source_prefix}: ${(error as Error).message}`)
    return NO_WINE_PREFIXES
  }
}

// A wineserver writes the registry back when it stops, so it stops before the caller removes its
// prefix. Stopping one in a directory where none runs would leave a directory of Wine's in /tmp.
const stop_prefixes = async (prefixes: string[]): Promise<void> => {
  await Promise.all(prefixes.map((prefix) => wine_in(prefix, 'wineserver', ['-k']).catch(() => {})))
}

// Wine updates a prefix made by another version of it as it starts, in place, which would change
// the files the copies link to; so the prefix is updated first, and its wineserver stops, writing
// the registry, before the copies are made.
// tools/test_cross.sh updates it once for the runs that it starts at the same time.
const update_source_prefix = async (): Promise<void> => {
  if (process.env.LERTA_WINE_PREFIX_UPDATED === source_prefix) return
  await run('wine', ['cmd', '/c', 'exit'], process.env)
  await run('wineserver', ['--wait'], process.env)
}

// The files are linked, but for the registry, which Wine rewrites in place: a test run leaves every
// other file of the prefix as it was, and the programs write only in their own directories.
// A wineserver that stays spares each run the start of one, and of Wine's services with it, which
// start with a first run. The prefix is added to `started` once its wineserver runs.
const start_prefix = async (prefix: string, started: string[]): Promise<void> => {
  await run('cp', ['-al', source_prefix, prefix], process.env)
  for (const name of readdirSync(prefix).filter((name) => name.endsWith('.reg'))) {
    rmSync(join(prefix, name))
    copyFileSync(join(source_prefix, name), join(prefix, name))
  }
  await wine_in(prefix, 'wineserver', [`--persistent=${SERVER_LINGER}`])
  started.push(prefix)
  await wine_in(prefix, 'wine', ['cmd', '/c', 'exit'])
}

const wine_in = (prefix: string, file: string, args: string[]) =>
  run(file, args, { ...process.env, WINEPREFIX: prefix })

// Waits for the program to exit, not for its output to close, which what it leaves running may
// hold; it has no output.
const run = (file: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${file} failed`))))
  })
