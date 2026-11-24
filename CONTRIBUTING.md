# Contributing

Before changing the language, read [Changing the language](#changing-the-language). For a feature that [the roadmap](docs/roadmap/README.md) does not describe, open an issue first.

## Repository layout

| Path | Contents |
|---|---|
| `compiler/` | The compiler (see [below](#the-compiler)) |
| `std/` | The standard modules, in Lerta, which the compiler embeds |
| `runtime/` | The C runtime, which the compiler embeds. For each system, `<system>.mk`, which make includes, lists the `platform_*.c` files and the libuv sources that the runtime is built from, with their flags and libraries |
| `seed/` | The seed, from which `make` builds the compiler (see [the bootstrap](docs/internals/architecture.md#bootstrap)) |
| `LICENSE-MIT`, `LICENSE-APACHE` | Lerta's licenses (see [License](README.md#license)) |
| `VERSION` | Lerta's version, on one line, as `0.1.0` or `0.2.0-dev`, which the compiler carries and [`lerta --version`](docs/reference/compiler.md#--version) prints |
| `third_party/` | libuv and the Unicode Character Database, with their licenses, whose notices go with the compiler and the programs it builds (see [License](README.md#license)) |
| `tools/` | `build.lerta` and `build/`, which build, check and test the compiler for the goals of `make` (see [the bootstrap](docs/internals/architecture.md#bootstrap)); `docker/`, the Docker images that `make test-targets` runs in, with `run.sh` to run a command (bash by default) in one |
| `test/` | The test driver and suites (see [Testing](#testing)) |
| `tests/` | The run tests: Lerta sources and their expected output; also the files of the CLI checks (`tests/cli/`) and the formatter cases (`tests/format/`) |
| `examples/` | Example programs, run as tests (expected output in `tests/examples/`) |
| `bench/` | The benchmarks, how to run them and their results (see [its README](bench/README.md)) |
| `editors/` | Editor support for VS Code and Vim; each subdirectory's README says how to install it |
| `site/` | The website, written from `docs/` (see [Website](#website)) |

### The compiler

| Path in `compiler/` | Role |
|---|---|
| `lexer/`, `parser/` | Build the tree of `ast.lerta` |
| `loader.lerta` | Reads the modules of a program |
| `checker/` | Checks them |
| `codegen/` | Emits LLVM IR |
| `format/` | The formatter (see [the formatter](docs/internals/compiler.md#formatter)) |
| `llit.lerta` | Reads [llit](docs/internals/llit.md), Lerta literals as data, for the tools |
| `main.lerta` | The commands |
| `minilerta.lerta` | The entry that the seed is made from |

## Building

[Getting started](README.md#getting-started) says what the build needs on each system.

```
make                   # bin/lerta, the compiler, built from the seed
make TARGET=<target>   # bin/lerta-<target>, the compiler for another target
make test-bootstrap    # checks that the compiler builds itself to the same IR (TARGET builds the stages for it)
make seed              # rewrites the seed, only when needed (see the bootstrap)
make clean
```

`make` rebuilds only when what the compiler is built from changes: the seed, `compiler/`, `std/`, `runtime/`, `third_party/libuv`, the license notices, `VERSION`, `tools/build.lerta` or `tools/build/`.

## Testing

The tests run on Linux, macOS and Windows. A check of what only POSIX systems have, such as signals, does not run on Windows; nor do the tests of a `posix/` directory.

```
make test              # builds bin/lerta, then runs the tests, the bootstrap's among them, on the host only
make test-targets      # the tests of the targets that test-targets.llit names, each where it says (see below)
make test-target TARGET=<target>  # the tests of that target here, as test-targets runs them
make check             # checks that the code is in the style (lerta fmt)
make format            # lays out the .lerta files in the style (lerta fmt --fix); the samples of the documents are left to fix by hand
```

- Every language feature gets run tests in `tests/`: a Lerta source and its expected output, as the top of `test/run.lerta` describes. The programs in `examples/` are run as tests too, and so are the samples of the documents (see [Website](#website)).
- A test that checks values, rather than what a program prints, uses `assert` inside the `test` blocks that [tests/lib/test.lerta](tests/lib/test.lerta) provides, as [tests/args/args.lerta](tests/args/args.lerta) does, and needs no expected-output file.
- The compilers that the tests run share the compiler's default [cache](docs/reference/compiler.md#cache), or the one that `LERTA_CACHE_DIR` names, with every other build and worktree. Each entry is keyed by what it is made from, so no build of another compiler or with other flags takes it. The cache only grows: run `bin/lerta clean` to free the space, or set `LERTA_CACHE_DIR` to an empty directory to test with an empty cache.
- `make check` checks the style of the tests too. Code that breaks the style on purpose, such as a test of a form that the style rewrites, keeps its form with `# fmt: skip` or `# fmt: off` (see [fmt](docs/reference/compiler.md#fmt)). A file that does not parse starts with `# fmt: off`.

### Testing other targets

`make test-targets` runs the tests of the targets that `test-targets.llit` names (see [llit](docs/internals/llit.md)), each where it says. The file is each developer's own, and git ignores it: copy [tools/test-targets.example.llit](tools/test-targets.example.llit) to it and edit it.

- A target is a short name of [`--target`](docs/reference/compiler.md#--target-target), and runs in one of these places:
  - `local`: here;
  - `docker`: in a container of the image named there, of `tools/docker/` (`linux`, or `wine`, for Windows programs under Wine), on the tree mounted read-only (see `tools/docker/run.sh`);
  - `ssh`: on the host named there, in a temporary directory that the tree is sent to and that is removed afterwards. The tree sent is what `make check` checks: the files that git lists, including those not added yet. The commands run in bash, so its `PATH` there must have make and clang, as in the shell of Git for Windows.
- The host's own target runs `make test`. Another target runs the run tests and the runtime checks built for it (`bin/test --target`), and `make test-bootstrap` for it. A Windows target elsewhere than on Windows runs under Wine, whose bootstrap needs a clang for Windows (such as [llvm-mingw](https://github.com/mstorsjo/llvm-mingw)'s, which the `wine` image has) on Wine's `PATH` (`WINEPATH`), and fails without one.
- `make test-targets TARGETS="windows-amd64 windows-i386"` runs those alone.
- The targets run one after another, in the order of the file, but those of SSH hosts after the others, each host's after the tree is sent there once. The run ends with a summary of how each target went. An interruption, such as Ctrl-C, removes the containers and the temporary directories.

### Continuous integration

GitHub Actions runs the tests on each push to `main` and on each pull request (`.github/workflows/ci.yml`). For a push to `main`, each job then packs the compiler of its target for a [release](#releases).

- Each target of [`--target`](docs/reference/compiler.md#--target-target) but `macos-universal` and `linux-armhf` runs `make test-target` in a job of its own, on a runner of its system and architecture; a 32-bit target runs on the runner of its 64-bit one. GitHub has no runner for `linux-armhf`, whose tests run on a Raspberry Pi with `make test-targets`.
- Another job runs `make check`, on Linux.
- The Windows jobs use llvm-mingw of the version that the `wine` image has, and turn off the [scanning of new programs](#scanning-of-new-programs); the macOS jobs run with it.

### Scanning of new programs

The tests build many programs and run each for the first time. macOS and Windows scan such programs, which slows the tests down significantly. To prevent this:

- **macOS** scans them with XProtect unless the app that runs them is a developer tool. Add the apps that run `make`, such as Terminal, Visual Studio Code, or `/usr/libexec/sshd-keygen-wrapper` for SSH sessions, to System Settings › Privacy & Security › Developer Tools, and restart them, or log in again. If the list is missing, `sudo spctl developer-mode enable-terminal` shows it.
- **Microsoft Defender** scans them in real time. Exclude the tree, the [cache](docs/reference/compiler.md#cache) and the temporary directory, where `ssh` targets run, in PowerShell as administrator:
  ```
  Add-MpPreference -ExclusionPath C:\path\to\lerta, $env:LOCALAPPDATA\lerta, $env:TEMP
  ```
- **Smart App Control**, on Windows 11, asks the cloud about each program before it runs. Turn it off in Windows Security › App & browser control › Smart App Control settings. Once off, it stays off until Windows is reinstalled.

### The driver

- `test/main.lerta`, the driver, is built by minilerta into `bin/test`, as `tools/build.lerta` is, so that a change to `compiler/` cannot break the harness that tests it.
- `make test` builds and runs it. It runs all the suites, or those named, with their checks as one list: as many at once as `-j` says, each result shown as it finishes, and each suite's summary at the end. The processes that the suites run to get ready, such as the builds of the runtimes, count toward `-j` too.
- Its options are listed at the top of `test/main.lerta`: `-k <text>` (the checks whose names hold the text, or one of the texts if it is given more than once), `--failed` (those that failed last time), `--target <target>` (the run tests and the runtime checks built for another target), and more.
- A failed check runs once more, alone, after the others, and passes as flaky if it passes then. `--no-retry` turns that off.

```
bin/test runtime            # the runtime checks alone
bin/test -k tests/string    # the checks whose names hold tests/string
bin/test -k tests/string -k tests/char  # those that hold either
bin/test --failed           # the checks that failed when they last ran
```

### Suites

| Suite | File | Checks |
|---|---|---|
| `bootstrap` | `test/bootstrap.lerta` | That the compiler builds itself, as `make test-bootstrap` checks, but with stage2 and `bin/lerta` as they are: it fails when stage2 is older than `bin/lerta`; `make test` builds both first |
| `run` | `test/run.lerta` | The run tests |
| `cli` | `test/cli.lerta`, checks in `test/cli/*.lerta` | The command line |
| `format` | `test/format.lerta` | The formatter; its cases are the exact specification of the style |
| `runtime` | `test/runtime.lerta` | What no Lerta program can trigger: each check links a C program of `test/runtime/`, standing in for generated code, with the runtime |
| `leaks` | `test/leaks.lerta` | The compiler's own leaks and uses of dropped objects, which the bootstrap's stage2, built with the memory checks, reports while running `dump-llvm` and `fmt` on each test and example |
| `self` | `test/self.lerta` | The driver itself: it must report the tests of `tests/harness/` (most of which must fail, each as it should) and take its options as it says |

### Modules

| Module in `test/lib/` | Role |
|---|---|
| `lerta` | Where the repository and the compiler are; running it; the run's directories; caching the runtimes before the tests |
| `report` | Selecting, running and reporting checks |
| `expect` | What checks expect of the programs they run |
| `target` | `--target` |
| `wine` | Running Windows programs under Wine |
| `cli` | Running the compiler in directories of its own |
| `lsp` | Sessions with the language server |

## Website

```
make site              # build/site, the website
make site-serve        # serves it at http://127.0.0.1:8000/ to look at
```

- `site/site.lerta` writes the pages that `site/pages.lerta` lists: `site/index.md`, the top page, whose links are written as if the file were in `docs/`; `docs/philosophy.md`; and the pages of `docs/tour/`, `docs/reference/` and `docs/internals/`. Each is written at its path in `docs/`, so that their links work as on GitHub. A link to what is not on the site goes to GitHub (`site/links.lerta`).
- The site is served at the root of its domain, [lerta.org](https://lerta.org/): its links start with `/`. GitHub Pages serves it, as GitHub Actions builds it on each push to `main` (`.github/workflows/site.yml`); the repository's Pages settings take GitHub Actions as the source and hold the domain.
- `site/template.html` is the template that wraps each document. `site/layout.lerta` fills it in: the title, URL and description that search engines and link previews show, the navigation, the sidebar for the document's section, and the links to the previous and next pages of that section.
- The images are copied as they are. `site/images.sh` renders `og.png`, the preview image shown when the site is linked, from `og.svg`, and `favicon.ico` and `apple-touch-icon.png` from `favicon.svg`: run it by hand after changing an SVG.
- `site/markdown.lerta` takes only the Markdown that `docs/` writes: headings, paragraphs, lists, tables and fenced code; code spans, emphasis and links. Anything else fails the build with its line.
- A ```` ```lerta ```` block followed by an ```` ```output ```` block, blank lines between them allowed, is a sample, which must print the output and nothing else, and succeed: the run tests run those of README.md and of the site's pages. An output block after anything else fails the build. README.md is read for its samples as `docs/` is, so it keeps to the same Markdown. `make check` checks that the samples are in the style, as `lerta fmt` does, and reports each place in its document.
- A ```` ```lerta ```` block is colored by the compiler's lexer (`site/highlight.lerta`); one that the lexer rejects, such as code of a planned feature, is shown without colors, with a warning.
- The run tests write the site, which must give no warning, and the tests in `tests/site/` check the Markdown and the colors.

## Releases

A release is made from a tag `v<version>` of a commit of `main` whose `VERSION` holds that version:

1. Set `VERSION` to the version, such as `0.1.0`, and push the commit to `main`.
2. Tag the commit `v0.1.0`, and push the tag.
3. On the tag, `.github/workflows/release.yml` checks that the tag is `v` followed by `VERSION`, and waits for the [CI](#continuous-integration) run of the commit on `main`, so that the commit is tested once. Once its tests all pass, it makes a draft release of what that run packed: the compiler of each target that it tests, and of `macos-universal`, each alone, in `lerta-<version>-<target>.tar.gz`, or `.zip` for Windows (`tools/package.sh`), with their `SHA256SUMS`. If the CI run fails, and passes when run again, run the release again too.
4. Write the draft's notes by hand, and publish it.
5. Set `VERSION` to the next version with `-dev`, such as `0.2.0-dev`.

## Changing the language

- Implement a feature as [the roadmap](docs/roadmap/README.md) specifies it. When it is implemented, move its description to [the reference](docs/reference/README.md) or [the internals](docs/internals/README.md) and remove it from the roadmap.
- The tour shows the language as a newcomer meets it, not every rule: a feature goes there only if such a reader would miss it, and a change that alters what a page shows updates the page.
- When a design question is not covered, apply [the principles](docs/philosophy.md) in priority order.
- Follow [the runtime rules](docs/internals/architecture.md#runtime-rules), and [the bootstrap](docs/internals/architecture.md#bootstrap) for which features the compiler may use.

## Coding style

Simplicity of the result comes first (KISS). Simplicity of the process does not matter.

Unless it conflicts with KISS:

- **DRY.** No duplicated logic.
- **Separation of concerns.** One module, one responsibility. Split long functions and classes.
- **Consistency.** Follow the naming and structure that already exist.
- **Least surprise.**

Let the code speak instead of relying on comments:

- Name things so that **what** they do is clear.
- Structure logic so that **how** it works is clear. Break complex parts into named intermediate values.
- Comment only the **why** that the code cannot show.

Documentation follows the same rules: no redundancy, no duplication, and a clear structure. State each fact in one place and point to it from elsewhere.

The style of Lerta code is in [the reference](docs/reference/style.md).

## Licensing

Lerta is licensed under either the [MIT License](LICENSE-MIT) or the [Apache License, Version 2.0](LICENSE-APACHE), at your option.

Unless you explicitly state otherwise, any contribution you intentionally submit for inclusion in Lerta, as defined in the Apache License, Version 2.0, shall be dual licensed as above, without any additional terms or conditions. You keep the copyright of your contribution.
