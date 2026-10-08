#ifdef _WIN32

#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <windows.h>

#include "lerta.h"

// Windows takes paths and the command line as UTF-16, in its wide-character functions, and Lerta
// keeps them as UTF-8. Both return NULL on failure; the caller frees the result.
static wchar_t *to_utf16(const char *utf8) {
  int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, utf8, -1, NULL, 0);
  if (length == 0) return NULL;
  wchar_t *utf16 = malloc((size_t)length * sizeof(wchar_t));
  if (utf16 == NULL) lerta_panic("out of memory");
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, utf8, -1, utf16, length);
  return utf16;
}

static char *to_utf8(const wchar_t *utf16) {
  int length = WideCharToMultiByte(CP_UTF8, 0, utf16, -1, NULL, 0, NULL, NULL);
  if (length == 0) return NULL;
  char *utf8 = malloc((size_t)length);
  if (utf8 == NULL) lerta_panic("out of memory");
  WideCharToMultiByte(CP_UTF8, 0, utf16, -1, utf8, length, NULL, NULL);
  return utf8;
}

// A stack overflow raises EXCEPTION_STACK_OVERFLOW in the overflowing thread, on what is left of
// its stack; the guarantee keeps enough of it for the handler to report the panic.
static LONG CALLBACK on_exception(EXCEPTION_POINTERS *exception) {
  if (exception->ExceptionRecord->ExceptionCode == EXCEPTION_STACK_OVERFLOW) {
    lerta_panic("stack overflow");
  }
  return EXCEPTION_CONTINUE_SEARCH;
}

// A failure of either call is ignored, as on POSIX: the program still runs, and only the report
// of an overflow is lost.
void lerta_stack_init(void) {
  ULONG guarantee = 1 << 16;
  SetThreadStackGuarantee(&guarantee);
  AddVectoredExceptionHandler(1, on_exception);
}

// The C runtime's argv is in the ANSI code page, which may not hold every character, so the
// arguments are read again from the UTF-16 command line. They are kept for the life of the
// process, so they are never freed.
void lerta_os_arguments(int *argc, char ***argv) {
  wchar_t **wide_arguments = CommandLineToArgvW(GetCommandLineW(), argc);
  if (wide_arguments == NULL) lerta_panic("cannot read the arguments");
  char **arguments = calloc((size_t)*argc + 1, sizeof(char *));
  if (arguments == NULL) lerta_panic("out of memory");
  for (int i = 0; i < *argc; i++) {
    arguments[i] = to_utf8(wide_arguments[i]);
    if (arguments[i] == NULL) lerta_panic("cannot read the arguments");
  }
  LocalFree(wide_arguments);
  *argv = arguments;
}

// WriteFile takes the bytes as they are: no newline becomes CRLF, as it would through the C
// runtime's text mode.
static bool write_all(HANDLE handle, const uint8_t *bytes, int64_t length) {
  while (length > 0) {
    DWORD chunk = length > (1 << 30) ? (1 << 30) : (DWORD)length;
    DWORD written;
    if (!WriteFile(handle, bytes, chunk, &written, NULL) || written == 0) return false;
    bytes += written;
    length -= written;
  }
  return true;
}

static HANDLE standard_handle(int fd) {
  return GetStdHandle(fd == 1 ? STD_OUTPUT_HANDLE : STD_ERROR_HANDLE);
}

static bool is_console(HANDLE handle) {
  DWORD mode;
  return GetConsoleMode(handle, &mode);
}

// How many bytes at the end begin a UTF-8 character that the next bytes would complete.
static int incomplete_tail(const uint8_t *bytes, int64_t length) {
  for (int back = 1; back <= 3 && back <= length; back++) {
    uint8_t byte = bytes[length - back];
    bool is_continuation = (byte & 0xC0) == 0x80;
    if (!is_continuation) {
      int needed = byte >= 0xF0 ? 4 : byte >= 0xE0 ? 3 : byte >= 0xC0 ? 2 : 1;
      return needed > back ? back : 0;
    }
  }
  return 0;
}

// For each of stdout (1) and stderr (2), the start of a character that its last write to a
// console ended in, which the next write completes.
static uint8_t console_tails[3][3];
static int console_tail_lengths[3];

// A console shows bytes in its code page, which is rarely UTF-8, but shows UTF-16 as it is. Bytes
// that are not UTF-8 show as U+FFFD.
static bool write_console(int fd, HANDLE console, const uint8_t *bytes, int64_t length) {
  int tail_length = console_tail_lengths[fd];
  if (length > INT_MAX - tail_length) return false;
  int total = tail_length + (int)length;
  char *text = malloc((size_t)total + 1);
  if (text == NULL) lerta_panic("out of memory");
  memcpy(text, console_tails[fd], (size_t)tail_length);
  memcpy(text + tail_length, bytes, (size_t)length);
  int complete = total - incomplete_tail((const uint8_t *)text, total);
  console_tail_lengths[fd] = total - complete;
  memcpy(console_tails[fd], text + complete, (size_t)(total - complete));
  int wide_length = MultiByteToWideChar(CP_UTF8, 0, text, complete, NULL, 0);
  wchar_t *wide = malloc(((size_t)wide_length + 1) * sizeof(wchar_t));
  if (wide == NULL) lerta_panic("out of memory");
  MultiByteToWideChar(CP_UTF8, 0, text, complete, wide, wide_length);
  free(text);
  const wchar_t *rest = wide;
  bool written = true;
  while (written && wide_length > 0) {
    DWORD count;
    written = WriteConsoleW(console, rest, (DWORD)wide_length, &count, NULL) && count > 0;
    rest += count;
    wide_length -= (int)count;
  }
  free(wide);
  return written;
}

bool lerta_os_write(int fd, const uint8_t *bytes, int64_t length) {
  HANDLE handle = standard_handle(fd);
  return is_console(handle) ? write_console(fd, handle, bytes, length)
                            : write_all(handle, bytes, length);
}

bool lerta_os_is_terminal(int fd) {
  return is_console(standard_handle(fd));
}

void lerta_os_exit(int code) {
  ExitProcess((UINT)code);
}

// 3 is the exit code of C's abort on Windows. Unlike ExitProcess, TerminateProcess runs no code of
// the loaded libraries, which is safer on an overflowed stack.
void lerta_os_abort(void) {
  TerminateProcess(GetCurrentProcess(), 3);
  // TerminateProcess returns while the process ends.
  for (;;) Sleep(INFINITE);
}

// Only FILE_FLAG_BACKUP_SEMANTICS opens a directory, which real_path needs.
static HANDLE open_file(const char *path, DWORD access, DWORD creation, DWORD flags) {
  wchar_t *name = to_utf16(path);
  if (name == NULL) return INVALID_HANDLE_VALUE;
  HANDLE handle = CreateFileW(name, access, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                              NULL, creation, flags, NULL);
  free(name);
  return handle;
}

static int64_t read_handle(void *file, uint8_t *buffer, int64_t size) {
  DWORD chunk = size > (1 << 30) ? (1 << 30) : (DWORD)size;
  DWORD count;
  return ReadFile(file, buffer, chunk, &count, NULL) ? count : -1;
}

LertaString *lerta_os_read_file(const char *path) {
  HANDLE file = open_file(path, GENERIC_READ, OPEN_EXISTING, 0);
  if (file == INVALID_HANDLE_VALUE) return NULL;
  LertaString *contents = lerta_read_chunks(read_handle, file);
  CloseHandle(file);
  return contents;
}

bool lerta_os_write_file(const char *path, const uint8_t *bytes, int64_t length) {
  HANDLE file = open_file(path, GENERIC_WRITE, CREATE_ALWAYS, 0);
  if (file == INVALID_HANDLE_VALUE) return false;
  bool written = write_all(file, bytes, length);
  CloseHandle(file);
  return written;
}

// As POSIX's regular file: opening follows links, so a dangling one fails, and a device such as
// NUL is not a disk file.
bool lerta_os_is_file(const char *path) {
  HANDLE file = open_file(path, 0, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS);
  if (file == INVALID_HANDLE_VALUE) return false;
  BY_HANDLE_FILE_INFORMATION information;
  bool is_file = GetFileType(file) == FILE_TYPE_DISK &&
                 GetFileInformationByHandle(file, &information) &&
                 !(information.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY);
  CloseHandle(file);
  return is_file;
}

// The final path is in the form \\?\C:\dir\file, or \\?\UNC\server\share\file for a network
// share, which is given as the usual C:\dir\file or \\server\share\file.
static const wchar_t *usual_form(wchar_t *final_path) {
  static const wchar_t prefix[] = L"\\\\?\\";
  static const wchar_t unc_prefix[] = L"\\\\?\\UNC\\";
  size_t unc_length = wcslen(unc_prefix);
  if (wcsncmp(final_path, unc_prefix, unc_length) == 0) {
    final_path[unc_length - 2] = L'\\';
    return final_path + unc_length - 2;
  }
  size_t length = wcslen(prefix);
  return wcsncmp(final_path, prefix, length) == 0 ? final_path + length : final_path;
}

char *lerta_os_real_path(const char *path) {
  HANDLE file = open_file(path, 0, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS);
  if (file == INVALID_HANDLE_VALUE) return NULL;
  DWORD length = GetFinalPathNameByHandleW(file, NULL, 0, FILE_NAME_NORMALIZED);
  wchar_t *final_path = length == 0 ? NULL : malloc(length * sizeof(wchar_t));
  bool resolved =
      final_path != NULL &&
      GetFinalPathNameByHandleW(file, final_path, length, FILE_NAME_NORMALIZED) < length;
  CloseHandle(file);
  char *result = resolved ? to_utf8(usual_form(final_path)) : NULL;
  free(final_path);
  return result;
}

// Writes the argument so that CommandLineToArgvW, and the C runtimes that follow the same rules,
// read it back as it is: in quotes if it is empty or holds a space, a tab or a quote, with the
// backslashes before a quote, or before the closing one, doubled and a quote escaped by one more.
// Returns where the argument ends; it takes at most twice its length plus 2.
static char *write_quoted(char *out, const char *argument) {
  size_t length = strlen(argument);
  if (length > 0 && strpbrk(argument, " \t\n\v\"") == NULL) {
    memcpy(out, argument, length);
    return out + length;
  }
  *out++ = '"';
  for (const char *c = argument;; c++) {
    size_t backslashes = 0;
    for (; *c == '\\'; c++) backslashes++;
    bool before_quote = *c == '"' || *c == '\0';
    size_t count = before_quote ? 2 * backslashes : backslashes;
    memset(out, '\\', count);
    out += count;
    if (*c == '\0') break;
    if (*c == '"') *out++ = '\\';
    *out++ = *c;
  }
  *out++ = '"';
  return out;
}

static char *command_line(char **args) {
  size_t size = 1;
  for (char **arg = args; *arg != NULL; arg++) size += 2 * strlen(*arg) + 3;
  char *line = malloc(size);
  if (line == NULL) lerta_panic("out of memory");
  char *end = line;
  for (char **arg = args; *arg != NULL; arg++) {
    if (arg != args) *end++ = ' ';
    end = write_quoted(end, *arg);
  }
  *end = '\0';
  return line;
}

// The file `name` on `path`, as SearchPathW finds it, or NULL; the caller frees it.
static wchar_t *search_file(const wchar_t *path, const wchar_t *name) {
  DWORD size = SearchPathW(path, name, NULL, 0, NULL, NULL);
  while (size > 0) {
    wchar_t *found = malloc(size * sizeof(wchar_t));
    if (found == NULL) lerta_panic("out of memory");
    DWORD length = SearchPathW(path, name, NULL, size, found, NULL);
    if (length > 0 && length < size) return found;
    free(found);
    // The file changed between the calls; `length` is the size it needs now, or 0.
    size = length;
  }
  return NULL;
}

// The file of a command on PATH: <command>.exe, or else the command as it is; NULL if there is
// neither. SearchPathW's own extension argument is not used, since it skips any name with a dot,
// such as python3.11. The caller frees the result.
static wchar_t *search_path(const char *command) {
  DWORD path_size = GetEnvironmentVariableW(L"PATH", NULL, 0);
  wchar_t *path = path_size == 0 ? NULL : malloc(path_size * sizeof(wchar_t));
  bool has_path = path != NULL && GetEnvironmentVariableW(L"PATH", path, path_size) < path_size;
  size_t command_length = strlen(command);
  char *exe_command = malloc(command_length + sizeof ".exe");
  if (exe_command == NULL) lerta_panic("out of memory");
  memcpy(exe_command, command, command_length);
  memcpy(exe_command + command_length, ".exe", sizeof ".exe");
  wchar_t *exe_name = to_utf16(exe_command);
  wchar_t *name = to_utf16(command);
  free(exe_command);
  wchar_t *found = NULL;
  if (has_path && exe_name != NULL && name != NULL) {
    found = search_file(path, exe_name);
    if (found == NULL) found = search_file(path, name);
  }
  free(path);
  free(exe_name);
  free(name);
  return found;
}

// A command without a directory in it is searched for on PATH only, as on POSIX; CreateProcessW
// alone would look in the program's directory and the current one first. One with a directory is
// left to CreateProcessW, which adds .exe if it has no extension. The child gets this program's
// standard handles even when this program has no console.
bool lerta_os_run(char **args, int64_t *exit_code) {
  bool has_directory = strpbrk(args[0], "/\\:") != NULL;
  wchar_t *application = has_directory ? NULL : search_path(args[0]);
  char *line = command_line(args);
  wchar_t *wide_line = to_utf16(line);
  free(line);
  STARTUPINFOW startup = {
    .cb = sizeof startup,
    .dwFlags = STARTF_USESTDHANDLES,
    .hStdInput = GetStdHandle(STD_INPUT_HANDLE),
    .hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE),
    .hStdError = GetStdHandle(STD_ERROR_HANDLE),
  };
  PROCESS_INFORMATION process;
  bool started = (has_directory || application != NULL) && wide_line != NULL &&
                 CreateProcessW(application, wide_line, NULL, NULL, TRUE, 0, NULL, NULL, &startup,
                                &process);
  free(application);
  free(wide_line);
  if (!started) return false;
  DWORD code;
  if (WaitForSingleObject(process.hProcess, INFINITE) != WAIT_OBJECT_0 ||
      !GetExitCodeProcess(process.hProcess, &code)) {
    lerta_panic("cannot wait for a child process");
  }
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  *exit_code = code;
  return true;
}

#endif
