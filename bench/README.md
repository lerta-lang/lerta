# Benchmarks

## Running

From the repository root:

```
make bench             # the benchmarks' times
make bench-http        # the HTTP server's requests per second
```

- Each benchmark here is written in Lerta, Swift, Go, JavaScript and C. Each program prints what its benchmark's `main.out` holds.
  - `regex` is not written in C: C's standard library has no regular expressions, and Windows has no POSIX `regex.h`.
- On Windows, run `make bench` where `vcvars64.bat` has run, as in the x64 Native Tools Command Prompt, so that cl is on the PATH.
- `run.lerta` (`make bench`) builds them and prints each language's version, their times side by side and each language's geometric mean. Where stdout is colored, the fastest other than C is bold.
- `http/` holds an HTTP server in Lerta, Go and JavaScript. Its `run.lerta` (`make bench-http`) loads each with `load.lerta` and prints their requests per second.
- `shared.lerta` holds what both runners use.
- The run tests build each Lerta source here, and run each benchmark's `main.lerta`, whose stdout must be its `main.out`.
- The top page of the site, `site/index.md`, copies the table of the results below: update both together.

## The benchmarks

| Benchmark | What it does |
|---|---|
| `binary_trees` | Builds and drops many binary trees: allocation |
| `expr` | Builds a tree of expressions as a union of types, and evaluates it many times |
| `fib` | Naive recursion: calls |
| `iter` | Sums lazy pipelines of filters and maps over a generator |
| `json` | Parses a JSON text with a parser written by hand in each language, not the language's own, into arrays, maps and strings |
| `mandelbrot` | Floating-point loops |
| `nbody` | Floating-point fields of a few objects in an array |
| `regex` | Tests, finds, replaces and splits lines of a log by regular expressions |
| `sieve` | Loops over an array of booleans |
| `tokens` | Lexes a text into small structs, and keeps the names in a map |
| `word_count` | Joins and splits strings, and counts them in a map |

## Method

- **The programs.** Each benchmark is the same algorithm on the same data in every language, written as a user of that language would write it, using only what ships with the language.
- **The builds.** Each program is built with its language's usual optimized build. None of the compiled ones is built for the machine's own processor (no `-march=native`).

  | Language | Built with |
  |---|---|
  | Lerta | `lerta build -O`: clang's `-O2`, with link-time optimization across the program and the runtime |
  | Swift | `swiftc -O`, which keeps the checks of integer overflow and of indexes, as Lerta has them; not `-Ounchecked` |
  | Go | `go build`; run with `GOMAXPROCS=2` (see below) |
  | JavaScript | Run by `node`, without options |
  | C | `cc -O2`, or `cl -O2` on Windows |

- **The times.** Each program is run 10 times, each time in its own process, and its time is the shortest wall-clock time of those runs. So it includes process startup, which takes a few milliseconds (tens of milliseconds for Node.js), and the warm-up of Node.js's compiler.
- **Go's threads.** Go's programs run with `GOMAXPROCS=2`. Go collects garbage on as many threads as the machine has, and these programs, whose heaps are small, collect it often. On the machine below, which has 20 threads, that made `binary_trees` and `word_count` two to four times slower than with 2, and with 4 or more `word_count`'s times varied from run to run, between 0.75 and 1.6 seconds.
- **C** is a baseline, not a bound: plain C built by the system's compiler, with `malloc` and `free`, written as the other versions are and not tuned. Its geometric mean is over the ten benchmarks that it has.

What to keep in mind when reading the results:

- The benchmarks are few and small, and they are Lerta's own: they were chosen and written, in every language, for developing Lerta, whose compiler and runtime have been tuned on them. The versions in the other languages are written plainly, and are not the work of experts in those languages.
- `regex` compares the regular expressions that ship with each language: Lerta's and Go's engines, V8's regex compiler, and Swift's `Regex`.
- `iter` compares lazy pipelines of functions, not loops written by hand: a generator with iterator helpers in JavaScript, which Node.js runs slowly, and, in C, calls through function pointers, which is what a pipeline built at run time comes down to.

## Results

Seconds, lower is better. Measured on 2026-11-22 with `make bench` on Ubuntu 22.04 with an Intel Core i7-12700KF, on commit 676f45014 with the benchmark programs and the runner as they are here.

```
swift: Swift version 6.4.1 (swift-6.4.1-RELEASE)
go: go version go1.27.4 linux/amd64
node: v24.22.2
c: cc (Ubuntu 11.4.0-1ubuntu1~22.04.3) 11.4.0

benchmark       lerta    swift       go     node        c
---------------------------------------------------------
binary_trees     0.13     0.29     0.21     0.12     0.13
expr             0.29     0.38     0.36     0.99     0.35
fib              0.35     0.35     0.34     0.62     0.10
iter             0.19     0.19     0.19     1.57     0.25
json             0.45     1.01     0.42     0.73     0.52
mandelbrot       0.32     0.32     0.34     0.35     0.32
nbody            0.51     0.32     0.53     0.49     0.34
regex            0.44     4.22     0.74     0.31        -
sieve            0.24     0.25     0.22     0.30     0.22
tokens           0.19     0.30     0.22     0.44     0.14
word_count       0.66     1.83     0.56     0.88     0.52
---------------------------------------------------------
geomean          0.31     0.49     0.34     0.51     0.25
```
