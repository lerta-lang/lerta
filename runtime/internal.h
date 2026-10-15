#ifndef LERTA_INTERNAL_H
#define LERTA_INTERNAL_H

// What only the runtime's own C code uses; lerta.h declares what the generated code, std and the C
// files linked with a program use.
#include "lerta.h"

// Memory (memory.c).
void lerta_report_leaks(void);
// malloc, realloc and calloc that panic when out of memory instead of returning NULL.
void *lerta_checked_malloc(size_t size);
void *lerta_checked_realloc(void *memory, size_t size);
void *lerta_checked_calloc(size_t count, size_t size);
// The allocator (allocator.c), which frees with no size, and NULL as free does.
void *lerta_mem_alloc(int64_t size);
void lerta_mem_free(void *memory);
// Keeps the place when it holds `size` bytes and is not more than twice as large; else moves what
// it holds, as far as it fits, to a new one. NULL is none.
void *lerta_mem_realloc(void *memory, int64_t size);

// Strings (string.c). A new string or Binary value whose bytes the caller fills.
LertaString *lerta_string_new(int64_t length);
enum { LERTA_INT_TEXT_MAX = 20 };  // 19 digits and a sign
// Writes the decimal text of n at the end of buffer and returns where it starts.
int64_t lerta_format_int(int64_t n, uint8_t buffer[LERTA_INT_TEXT_MAX]);
// The string as a NUL-terminated C string, which the caller frees; NULL if it holds a NUL byte,
// which C would take as its end.
char *lerta_c_string(const LertaString *s);

// Items (array.c): the size of an item of the kind, and the counting of the reference it holds.
int64_t lerta_item_size(LertaItemKind kind);
void lerta_retain_item(LertaItemKind kind, const void *item);
void lerta_release_item(LertaItemKind kind, const void *item);
// The item at the index of an array of any kind but interface values, as 8 bytes: a byte item is
// zero-extended.
int64_t lerta_word_item(const LertaArray *array, int64_t index);
// Appends an item of any kind but interface values, given as 8 bytes (see lerta_word_item).
void lerta_array_append_word(LertaArray *array, int64_t word);

// The event loop's backend (loop.c). Resolves the promise, which it holds meanwhile, once the
// milliseconds have passed.
void lerta_loop_resolve_after(uint64_t milliseconds, LertaPromise *promise);
// Waits for what settles promises, and settles them, once; false, without waiting, if nothing is
// left to wait for.
bool lerta_loop_wait(void);
// What is called once a program has exited and its output, if read, has ended: the output, owned,
// or NULL if it is not read or cannot be.
typedef void (*LertaProgramEnd)(void *context, int64_t exit_code, LertaString *output);
// Starts the program `file` with `args`, which end with NULL, as lerta_os_program_file and
// lerta_os_program_argument give them, sharing this program's standard streams but for its standard
// output when `reads_output`; false if it cannot start, and `end` is not called.
bool lerta_loop_run_program(char *file, char **args, bool reads_output, LertaProgramEnd end,
                            void *context);

// Process (process.c): main's arguments, without the program name.
void lerta_set_arguments(int argc, char **argv);

// Files (file.c). Reads a file to its end through `read`, which returns how many bytes it put in
// `buffer`, 0 at the end, or -1 on failure; returns NULL on failure.
LertaString *lerta_read_chunks(int64_t (*read)(void *file, uint8_t *buffer, int64_t size),
                               void *file);
// Appends the C string to an array of strings, as a new string.
void lerta_append_c_string(LertaArray *array, const char *text);

// Output (io.c). For how stdout is buffered, which init decides, see docs/internals.md#output.
void lerta_stdout_init(void);
// Returns false if any output to stdout has failed.
bool lerta_stdout_flush(void);
void lerta_stderr_write(const uint8_t *bytes, int64_t length);

// Errors (io.c, lerta.c). The message of the pending exception, owned, which the first entry of an
// Error's itab gives.
LertaString *lerta_exception_message(void);
// As lerta_raise, with the message made of a prefix, a LertaString such as a LERTA_STATIC_STRING,
// and the detail.
void lerta_raise_with(LertaErrorKind kind, const void *prefix, const LertaString *detail);
// An IndexError of an index out of range, as of an array or a Binary.
void lerta_raise_index_out_of_range(void);
// Prints the message to stderr and exits with status 1: for an uncaught exception, and for an
// error raised without a raise function.
_Noreturn void lerta_exit_with_error(const LertaString *message);
_Noreturn void lerta_panic(const char *message);
_Noreturn void lerta_panic_with(const char *prefix, const LertaString *message);

// What differs between systems (see docs/internals.md#platforms). Paths and arguments are
// NUL-terminated UTF-8, and a false or NULL result is a failure.
// Stack overflow: reported as a panic. Called first thing in main.
void lerta_stack_init(void);
// Gives main's arguments as the system's bytes, which are UTF-8 on Windows: POSIX leaves them as
// they are, and Windows replaces them with ones read from its UTF-16 command line.
void lerta_os_arguments(int *argc, char ***argv);
// Writes all the bytes to stdout (1) or stderr (2); on POSIX, to any file descriptor.
bool lerta_os_write(int fd, const uint8_t *bytes, int64_t length);
bool lerta_os_is_terminal(int fd);
// Seconds since the Unix epoch, 1970-01-01T00:00:00Z.
double lerta_os_unix_time(void);
// Ends the program at once, without flushing stdout.
_Noreturn void lerta_os_exit(int code);
// Ends the program as a failure that is not an exit code, as C's abort does.
_Noreturn void lerta_os_abort(void);
// Memory from the system for the allocator (allocator.c): `size` bytes, a multiple of
// LERTA_REGION_SIZE, aligned to it, or NULL; and back to the system.
#define LERTA_REGION_SIZE ((int64_t)1 << 16)
void *lerta_os_map_region(int64_t size);
void lerta_os_unmap_region(void *region, int64_t size);
LertaString *lerta_os_read_file(const char *path);
bool lerta_os_write_file(const char *path, const uint8_t *bytes, int64_t length);
bool lerta_os_is_file(const char *path);
// Whether the path names a directory, through symbolic links.
bool lerta_os_is_dir(const char *path);
// Appends the names of the entries of the directory, without `.` and `..`, in no order, to the array
// of strings.
bool lerta_os_list_dir(const char *path, LertaArray *names);
// The absolute path with no links, which the caller frees.
char *lerta_os_real_path(const char *path);
// A new, empty directory in the system's directory for temporary files, whose path the caller
// frees.
char *lerta_os_make_temp_dir(void);
// Removes a file, or a directory with everything in it; a symbolic link is removed, not followed.
bool lerta_os_remove_tree(const char *path);
// Makes the directory, whose parent must be there; true if it is a directory afterwards, made now
// or before.
bool lerta_os_make_dir(const char *path);
// Whether the byte separates the directories of a path.
bool lerta_os_is_separator(char c);
// Moves a file or a directory, replacing a file at `to`.
bool lerta_os_rename(const char *from, const char *to);
// The system's name: linux, macos or windows.
const char *lerta_os_platform(void);
// The number of CPUs that are online, at least 1.
int64_t lerta_os_cpu_count(void);
// The value of an environment variable, which the caller frees, or NULL if it is not set.
char *lerta_os_env(const char *name);
// The file of a command for lerta_loop_run_program, which on Windows is searched for on PATH if it
// holds no directory (see docs/reference/modules.md#stdprocess); NULL if there is none. The caller
// frees it.
char *lerta_os_program_file(const char *command);
// An argument as lerta_loop_run_program takes it, which the caller frees.
char *lerta_os_program_argument(const char *argument);

#endif
