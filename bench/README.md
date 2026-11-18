# Benchmarks

## Running

From the repository root:

```
make bench             # the benchmarks' times
make bench-http        # the HTTP server's requests per second
```

- Each benchmark here is written in Lerta, Swift, Go, JavaScript and C; C is the reference, built with the system's own compiler: cc, or cl on Windows. Each prints its `main.out`.
  - `regex` is not written in C: C's standard library has no regular expressions, and Windows has no POSIX `regex.h`. So C's geometric mean leaves it out.
- On Windows, run `make bench` where `vcvars64.bat` has run, as in the x64 Native Tools Command Prompt, so that cl is on the PATH.
- `run.lerta` (`make bench`) builds them and prints each language's version, their times side by side and each language's geometric mean. Where stdout is colored, the fastest other than C is bold.
- `http/` holds an HTTP server in Lerta, Go and JavaScript. Its `run.lerta` (`make bench-http`) loads each with `load.lerta` and prints their requests per second.
- `shared.lerta` holds what both runners use.
- The run tests build each Lerta source here, and run each benchmark's `main.lerta`, whose stdout must be its `main.out`.

## Results

Seconds, lower is better. Measured on 2026-11-14 with `make bench` on Ubuntu 22.04 with an Intel Core i7-12700KF.

```
lerta: c1a8aa3ed
swift: Swift version 6.4.1 (swift-6.4.1-RELEASE)
go: go version go1.27.4 linux/amd64
node: v24.22.2
c: cc (Ubuntu 11.4.0-1ubuntu1~22.04.3) 11.4.0

benchmark       lerta    swift       go     node        c
---------------------------------------------------------
binary_trees     0.13     0.29     0.45     0.13     0.13
expr             0.30     0.38     0.36     0.99     0.36
fib              0.35     0.35     0.34     0.63     0.10
iter             0.19     0.19     0.19     1.58     0.26
json             0.47     1.01     0.44     1.26     0.52
mandelbrot       0.32     0.32     0.34     0.35     0.32
nbody            0.51     0.32     0.53     0.49     0.34
sieve            0.24     0.25     0.22     0.30     0.22
word_count       0.59     1.84     1.18     0.88     0.54
---------------------------------------------------------
geomean          0.31     0.41     0.39     0.58     0.27
```
