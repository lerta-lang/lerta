#ifndef LERTA_INTERNAL_H
#define LERTA_INTERNAL_H

// What only the runtime's own C code uses; lerta.h declares what the generated code, std and the C
// files linked with a program use.
#include "lerta.h"

// Memory (memory.c). With LERTA_DEBUG, live objects are counted; returns false after reporting a
// leak to stderr.
bool lerta_check_leaks(void);
// malloc, realloc and calloc that panic when out of memory instead of returning NULL.
void *lerta_checked_malloc(size_t size);
void *lerta_checked_realloc(void *memory, size_t size);
void *lerta_checked_calloc(size_t count, size_t size);

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

// Process (process.c): main's arguments, without the program name.
void lerta_set_arguments(int argc, char **argv);

// Files (file.c). Reads a file to its end through `read`, which returns how many bytes it put in
// `buffer`, 0 at the end, or -1 on failure; returns NULL on failure.
LertaString *lerta_read_chunks(int64_t (*read)(void *file, uint8_t *buffer, int64_t size),
                               void *file);

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

// What differs between systems: platform_posix.c and platform_windows.c, each of which compiles to
// nothing on the other. Paths and arguments are NUL-terminated UTF-8, and a false or NULL result
// is a failure.
// Stack overflow: reported as a panic. Called first thing in main.
void lerta_stack_init(void);
// Gives main's arguments as the system's bytes, which are UTF-8 on Windows: POSIX leaves them as
// they are, and Windows replaces them with ones read from its UTF-16 command line.
void lerta_os_arguments(int *argc, char ***argv);
// Writes all the bytes to stdout (1) or stderr (2); on POSIX, to any file descriptor.
bool lerta_os_write(int fd, const uint8_t *bytes, int64_t length);
bool lerta_os_is_terminal(int fd);
// A clock that only goes forward, in nanoseconds from an arbitrary start, and waiting on it.
int64_t lerta_os_monotonic_ns(void);
void lerta_os_sleep_ns(int64_t nanoseconds);
// Ends the program at once, without flushing stdout.
_Noreturn void lerta_os_exit(int code);
// Ends the program as a failure that is not an exit code, as C's abort does.
_Noreturn void lerta_os_abort(void);
LertaString *lerta_os_read_file(const char *path);
bool lerta_os_write_file(const char *path, const uint8_t *bytes, int64_t length);
bool lerta_os_is_file(const char *path);
// The absolute path with no links, which the caller frees.
char *lerta_os_real_path(const char *path);
// A new, empty directory in the system's directory for temporary files, whose path the caller
// frees.
char *lerta_os_make_temp_dir(void);
// Removes a file, or a directory with everything in it; a symbolic link is removed, not followed.
bool lerta_os_remove_tree(const char *path);
// Runs the command `args[0]`, found as the system finds commands, with `args`, which end with
// NULL, and waits for it to end.
bool lerta_os_run(char **args, int64_t *exit_code);

#endif
