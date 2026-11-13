# Issues

Known defects. Each says where it is, how to see it and how to fix it. An issue marked *unverified* was found by reading the code and has not been reproduced.

## lerta_program_path is apart from lerta_argv

`lerta_argv` (`runtime/process.c`) gives the arguments without the program's path, and `lerta_program_path` gives the path, which std:process's `program` reads. One function could give both, the path first, but `lerta_argv` cannot change before a seed refresh, as the seed is compiled from a std that takes its result for the arguments alone: the seed's minilerta would take its own path for its first argument. Fix: once the seed is refreshed, have `lerta_argv` give the path first, have std:process take `argv` and `program` from it, and remove `lerta_program_path` from `runtime/process.c` and `runtime/lerta.h`.
