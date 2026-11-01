#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <windows.h>

#include "internal.h"

// Both return NULL on failure; the caller frees the result.
static wchar_t *to_utf16(const char *utf8) {
  int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, utf8, -1, NULL, 0);
  if (length == 0) return NULL;
  wchar_t *utf16 = lerta_checked_malloc((size_t)length * sizeof(wchar_t));
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, utf8, -1, utf16, length);
  return utf16;
}

static char *to_utf8(const wchar_t *utf16) {
  int length = WideCharToMultiByte(CP_UTF8, 0, utf16, -1, NULL, 0, NULL, NULL);
  if (length == 0) return NULL;
  char *utf8 = lerta_checked_malloc((size_t)length);
  WideCharToMultiByte(CP_UTF8, 0, utf16, -1, utf8, length, NULL, NULL);
  return utf8;
}

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

// The arguments are kept for the life of the process, so they are never freed.
void lerta_os_arguments(int *argc, char ***argv) {
  wchar_t **wide_arguments = CommandLineToArgvW(GetCommandLineW(), argc);
  if (wide_arguments == NULL) lerta_panic("cannot read the arguments");
  char **arguments = lerta_checked_calloc((size_t)*argc + 1, sizeof(char *));
  for (int i = 0; i < *argc; i++) {
    arguments[i] = to_utf8(wide_arguments[i]);
    if (arguments[i] == NULL) lerta_panic("cannot read the arguments");
  }
  LocalFree(wide_arguments);
  *argv = arguments;
}

static bool write_all(HANDLE handle, const uint8_t *bytes, int64_t length) {
  while (length > 0) {
    DWORD chunk = (DWORD)lerta_io_chunk(length);
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
      // 0xC0, 0xC1 and the bytes above 0xF4 begin no character, so they are shown at once.
      bool is_lead = byte >= 0xC2 && byte <= 0xF4;
      int needed = !is_lead ? 1 : byte >= 0xF0 ? 4 : byte >= 0xE0 ? 3 : 2;
      return needed > back ? back : 0;
    }
  }
  return 0;
}

// For each of stdout (1) and stderr (2), the start of a character that its last write to a
// console ended in, which the next write completes.
static uint8_t console_tails[3][3];
static int console_tail_lengths[3];

static bool write_console(int fd, HANDLE console, const uint8_t *bytes, int64_t length) {
  int tail_length = console_tail_lengths[fd];
  if (length > INT_MAX - tail_length) return false;
  int total = tail_length + (int)length;
  char *text = lerta_checked_malloc((size_t)total + 1);
  memcpy(text, console_tails[fd], (size_t)tail_length);
  memcpy(text + tail_length, bytes, (size_t)length);
  int complete = total - incomplete_tail((const uint8_t *)text, total);
  console_tail_lengths[fd] = total - complete;
  memcpy(console_tails[fd], text + complete, (size_t)(total - complete));
  int wide_length = MultiByteToWideChar(CP_UTF8, 0, text, complete, NULL, 0);
  wchar_t *wide = lerta_checked_malloc(((size_t)wide_length + 1) * sizeof(wchar_t));
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

// A console shows the escape sequences of colors, as a terminal does, only once told to. The mode
// is left so at exit, as it shows what other programs write as before.
void lerta_os_stdio_init(void) {
  for (int fd = 1; fd <= 2; fd++) {
    HANDLE handle = standard_handle(fd);
    DWORD mode;
    if (GetConsoleMode(handle, &mode)) {
      SetConsoleMode(handle, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING);
    }
  }
}

void lerta_os_exit(int code) {
  ExitProcess((UINT)code);
}

void lerta_os_abort(void) {
  TerminateProcess(GetCurrentProcess(), 3);
  // TerminateProcess returns while the process ends.
  for (;;) Sleep(INFINITE);
}

static int64_t read_handle(void *file, uint8_t *buffer, int64_t size) {
  DWORD chunk = (DWORD)lerta_io_chunk(size);
  DWORD count;
  return ReadFile(file, buffer, chunk, &count, NULL) ? (int64_t)count : -1;
}

enum { CONSOLE_READ_UNITS = 8192 };

// A high surrogate that the last read from a console ended in, which the next read completes, as
// write_console keeps the start of a character, and whether the next read starts a line, as a
// console gives a line longer than a read in pieces; only the thread that reads stdin touches them.
static wchar_t console_high_surrogate = 0;
static bool console_line_start = true;

// A console is read as UTF-16, whatever its code page, and given as UTF-8, as write_console writes
// to it: as many units as fit in `size` as UTF-8, at most 3 bytes each; LERTA_STDIN_MIN_READ makes
// that at least two, so that a unit is read past a held high surrogate. A line that begins with
// Ctrl-Z ends the input, as ReadFile reads it.
static int64_t read_console(HANDLE console, uint8_t *buffer, int64_t size) {
  wchar_t wide[CONSOLE_READ_UNITS];
  int64_t fitting = size / 3 < CONSOLE_READ_UNITS ? size / 3 : CONSOLE_READ_UNITS;
  for (;;) {
    int start = 0;
    if (console_high_surrogate != 0) {
      wide[start++] = console_high_surrogate;
      console_high_surrogate = 0;
    }
    DWORD count;
    if (!ReadConsoleW(console, wide + start, (DWORD)(fitting - start), &count, NULL)) return -1;
    // The end drops a held surrogate, as nothing follows to complete it.
    if (count == 0) return 0;
    if (console_line_start && wide[start] == 0x1A) return 0;
    int total = start + (int)count;
    console_line_start = wide[total - 1] == L'\n';
    if (IS_HIGH_SURROGATE(wide[total - 1])) console_high_surrogate = wide[--total];
    if (total == 0) continue;
    int length = WideCharToMultiByte(CP_UTF8, 0, wide, total, (char *)buffer, (int)size, NULL, NULL);
    return length > 0 ? length : -1;
  }
}

// A pipe whose writer has closed it fails with ERROR_BROKEN_PIPE, which is its end; a program
// without stdin reads it as empty, as on POSIX.
int64_t lerta_os_read_stdin(uint8_t *buffer, int64_t size) {
  HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  if (input == NULL || input == INVALID_HANDLE_VALUE) return 0;
  if (is_console(input)) return read_console(input, buffer, size);
  int64_t count = read_handle(input, buffer, size);
  return count < 0 && GetLastError() == ERROR_BROKEN_PIPE ? 0 : count;
}

bool lerta_os_copy_file(const char *from, const char *to) {
  wchar_t *wide_from = to_utf16(from);
  wchar_t *wide_to = to_utf16(to);
  bool copied = wide_from != NULL && wide_to != NULL && CopyFileW(wide_from, wide_to, FALSE);
  free(wide_from);
  free(wide_to);
  return copied;
}


#ifndef SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE
#define SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE 0x2
#endif

// Whether the target, relative to the link's directory unless it is absolute, is a directory, which
// Windows must be told as the link is made.
static bool links_to_dir(const wchar_t *target, const wchar_t *path) {
  bool is_absolute = target[0] == L'\\' || (target[0] != L'\0' && target[1] == L':');
  const wchar_t *end = path;
  for (const wchar_t *c = path; *c != L'\0'; c++) {
    if (*c == L'\\') end = c + 1;
  }
  size_t dir_length = is_absolute ? 0 : (size_t)(end - path);
  size_t target_length = wcslen(target);
  wchar_t *resolved = lerta_checked_malloc((dir_length + target_length + 1) * sizeof(wchar_t));
  memcpy(resolved, path, dir_length * sizeof(wchar_t));
  memcpy(resolved + dir_length, target, (target_length + 1) * sizeof(wchar_t));
  DWORD attributes = GetFileAttributesW(resolved);
  free(resolved);
  return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY);
}

// Windows reads only backslashes in a link's target. Making a link needs no privilege in
// developer mode, which the flag asks for.
bool lerta_os_make_link(const char *target, const char *path) {
  wchar_t *wide_target = to_utf16(target);
  wchar_t *wide_path = to_utf16(path);
  bool made = false;
  if (wide_target != NULL && wide_path != NULL) {
    for (wchar_t *c = wide_target; *c != L'\0'; c++) {
      if (*c == L'/') *c = L'\\';
    }
    for (wchar_t *c = wide_path; *c != L'\0'; c++) {
      if (*c == L'/') *c = L'\\';
    }
    DWORD flags = SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE;
    if (links_to_dir(wide_target, wide_path)) flags |= SYMBOLIC_LINK_FLAG_DIRECTORY;
    made = CreateSymbolicLinkW(wide_path, wide_target, flags);
  }
  free(wide_target);
  free(wide_path);
  return made;
}

// Windows compares the names of variables without case.
bool lerta_os_same_env_name(const char *a, const char *b) {
  wchar_t *wide_a = to_utf16(a);
  wchar_t *wide_b = to_utf16(b);
  bool same = wide_a != NULL && wide_b != NULL &&
              CompareStringOrdinal(wide_a, -1, wide_b, -1, TRUE) == CSTR_EQUAL;
  free(wide_a);
  free(wide_b);
  return same;
}

bool lerta_os_is_separator(char c) {
  return c == '/' || c == '\\';
}

char lerta_os_separator(void) { return '\\'; }

// Wine tells libuv's uv_os_uname the system that it runs on, not Windows.
const char *lerta_os_platform(void) { return "windows"; }

// A variable that is not valid UTF-16 is read with U+FFFD in place of what is not, as the other
// texts that Windows gives are.
void lerta_os_environ(LertaArray *entries) {
  wchar_t *block = GetEnvironmentStringsW();
  if (block == NULL) return;
  for (wchar_t *entry = block; *entry != L'\0'; entry += wcslen(entry) + 1) {
    char *text = to_utf8(entry);
    if (text != NULL) lerta_append_c_string(entries, text);
    free(text);
  }
  FreeEnvironmentStringsW(block);
}

int64_t lerta_os_process_id(void) {
  return GetCurrentProcessId();
}

// As libuv's kill with signal 0: a process that cannot be opened for another reason than that there
// is none, such as one the program may not signal, is running.
bool lerta_os_is_running(int id) {
  DWORD access = PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE;
  HANDLE process = OpenProcess(access, FALSE, (DWORD)id);
  if (process == NULL) return GetLastError() != ERROR_INVALID_PARAMETER;
  DWORD status;
  bool running = !GetExitCodeProcess(process, &status) ||
                 (status == STILL_ACTIVE && WaitForSingleObject(process, 0) != WAIT_OBJECT_0);
  CloseHandle(process);
  return running;
}

// The file `name` on `path`, as SearchPathW finds it, or NULL; the caller frees it.
static wchar_t *search_file(const wchar_t *path, const wchar_t *name) {
  DWORD size = SearchPathW(path, name, NULL, 0, NULL, NULL);
  while (size > 0) {
    wchar_t *found = lerta_checked_malloc(size * sizeof(wchar_t));
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
  wchar_t *path = path_size == 0 ? NULL : lerta_checked_malloc(path_size * sizeof(wchar_t));
  bool has_path = path != NULL && GetEnvironmentVariableW(L"PATH", path, path_size) < path_size;
  size_t command_length = strlen(command);
  char *exe_command = lerta_checked_malloc(command_length + sizeof ".exe");
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

static bool has_directory(const char *command) {
  return strpbrk(command, "/\\:") != NULL;
}

// Windows runs a batch file through cmd.exe, which parses the command line again with its own
// metacharacters, which libuv's quoting does not escape. Windows drops the dots and spaces that end
// a name, so `t.bat.` names t.bat.
static bool is_batch_file(const char *file) {
  size_t length = strlen(file);
  while (length > 0 && (file[length - 1] == '.' || file[length - 1] == ' ')) length--;
  if (length < 4) return false;
  const char *extension = file + length - 4;
  return _strnicmp(extension, ".bat", 4) == 0 || _strnicmp(extension, ".cmd", 4) == 0;
}

char *lerta_os_program_file(const char *command) {
  char *file;
  if (has_directory(command)) {
    file = _strdup(command);
  } else {
    wchar_t *found = search_path(command);
    file = found == NULL ? NULL : to_utf8(found);
    free(found);
  }
  if (file != NULL && is_batch_file(file)) {
    free(file);
    return NULL;
  }
  return file;
}

void *lerta_os_map_region(int64_t size) {
  if ((uint64_t)size > SIZE_MAX) return NULL;
  return VirtualAlloc(NULL, (SIZE_T)size, MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE);
}

void lerta_os_unmap_region(void *region, int64_t size) {
  (void)size;
  VirtualFree(region, 0, MEM_RELEASE);
}

void lerta_os_discard_region(void *region, int64_t size) {
  VirtualAlloc(region, (SIZE_T)size, MEM_RESET, PAGE_READWRITE);
}
