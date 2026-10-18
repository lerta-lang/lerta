#ifdef _WIN32

#include <fcntl.h>
#include <io.h>
#include <limits.h>
#include <stdio.h>
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

void lerta_os_stdio_init(void) {}

// A FILETIME counts 100-nanosecond intervals since 1601-01-01, 11644473600 seconds before 1970.
double lerta_os_unix_time(void) {
  FILETIME now;
  GetSystemTimePreciseAsFileTime(&now);
  uint64_t intervals = ((uint64_t)now.dwHighDateTime << 32) | now.dwLowDateTime;
  // Whole seconds and the rest apart, as the count is past what a double holds exactly.
  uint64_t seconds = intervals / 10000000 - 11644473600;
  return (double)seconds + (double)(intervals % 10000000) / 1e7;
}

void lerta_os_exit(int code) {
  ExitProcess((UINT)code);
}

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
  return ReadFile(file, buffer, chunk, &count, NULL) ? (int64_t)count : -1;
}

enum { CONSOLE_READ_UNITS = 8192 };

// A high surrogate that the last read from a console ended in, which the next read completes, as
// write_console keeps the start of a character, and whether the next read starts a line, as a
// console gives a line longer than a read in pieces; only the thread that reads stdin touches them.
static wchar_t console_high_surrogate = 0;
static bool console_line_start = true;

// A console is read as UTF-16, whatever its code page, and given as UTF-8, as write_console writes
// to it: as many units as fit in `size` as UTF-8, at most 3 bytes each. A line that begins with
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
    if (start == 0 && count == 0) return 0;
    if (console_line_start && wide[0] == 0x1A) return 0;
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

uint8_t *lerta_os_read_file(const char *path, int64_t *length) {
  HANDLE file = open_file(path, GENERIC_READ, OPEN_EXISTING, 0);
  if (file == INVALID_HANDLE_VALUE) return NULL;
  uint8_t *contents = lerta_read_chunks(read_handle, file, length);
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

// A FILETIME counts 100-nanosecond intervals since 1601-01-01, 11644473600 seconds before 1970.
static int64_t nanoseconds_since_epoch(FILETIME time) {
  int64_t intervals = (int64_t)(((uint64_t)time.dwHighDateTime << 32) | time.dwLowDateTime);
  return (intervals - 116444736000000000) * 100;
}

// As POSIX's stat: opening follows links, so a dangling one is not there, and nothing is at a
// name that Windows does not take, as nothing is at a missing one; a loop of links fails.
int lerta_os_stat(const char *path, LertaFileStatus *status) {
  HANDLE file = open_file(path, 0, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS);
  if (file == INVALID_HANDLE_VALUE) {
    DWORD error = GetLastError();
    bool is_missing = error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND ||
                      error == ERROR_INVALID_NAME;
    return is_missing ? 0 : -1;
  }
  BY_HANDLE_FILE_INFORMATION information;
  bool is_disk_file = GetFileType(file) == FILE_TYPE_DISK;
  bool read = is_disk_file && GetFileInformationByHandle(file, &information);
  CloseHandle(file);
  // A device, such as NUL, is not a disk file.
  if (!is_disk_file) {
    *status = (LertaFileStatus){.kind = LERTA_OTHER_KIND};
    return 1;
  }
  if (!read) return -1;
  bool is_dir = information.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY;
  status->kind = is_dir ? LERTA_DIR_KIND : LERTA_FILE_KIND;
  status->size = (int64_t)(((uint64_t)information.nFileSizeHigh << 32) | information.nFileSizeLow);
  status->modified_time = nanoseconds_since_epoch(information.ftLastWriteTime);
  return 1;
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

bool lerta_os_copy_file(const char *from, const char *to) {
  wchar_t *wide_from = to_utf16(from);
  wchar_t *wide_to = to_utf16(to);
  bool copied = wide_from != NULL && wide_to != NULL && CopyFileW(wide_from, wide_to, FALSE);
  free(wide_from);
  free(wide_to);
  return copied;
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
  wchar_t *final_path = length == 0 ? NULL : lerta_checked_malloc(length * sizeof(wchar_t));
  bool resolved =
      final_path != NULL &&
      GetFinalPathNameByHandleW(file, final_path, length, FILE_NAME_NORMALIZED) < length;
  CloseHandle(file);
  char *result = resolved ? to_utf8(usual_form(final_path)) : NULL;
  free(final_path);
  return result;
}

// The path of `name` in the directory `dir`, which the caller frees.
static wchar_t *join_path(const wchar_t *dir, const wchar_t *name) {
  size_t dir_length = wcslen(dir);
  size_t name_length = wcslen(name);
  wchar_t *path = lerta_checked_malloc((dir_length + name_length + 2) * sizeof(wchar_t));
  memcpy(path, dir, dir_length * sizeof(wchar_t));
  path[dir_length] = L'\\';
  memcpy(path + dir_length + 1, name, (name_length + 1) * sizeof(wchar_t));
  return path;
}

// Windows has no mkdtemp: names are tried until one is new. The process ID and the time make a
// clash with another process unlikely.
char *lerta_os_make_temp_dir(void) {
  wchar_t dir[MAX_PATH + 1];
  DWORD length = GetTempPathW(MAX_PATH + 1, dir);
  if (length == 0 || length > MAX_PATH) return NULL;
  // The path ends with a backslash, which join_path adds.
  dir[length - 1] = L'\0';
  unsigned long seed = GetCurrentProcessId() * 0x10000UL + GetTickCount();
  for (unsigned long attempt = 0; attempt < 100; attempt++) {
    wchar_t name[sizeof "lerta-ffffffff"];
    unsigned long number = (seed + attempt) & 0xFFFFFFFFUL;
    _snwprintf(name, sizeof name / sizeof *name, L"lerta-%08lx", number);
    wchar_t *path = join_path(dir, name);
    if (CreateDirectoryW(path, NULL)) {
      char *result = to_utf8(path);
      free(path);
      return result;
    }
    free(path);
    if (GetLastError() != ERROR_ALREADY_EXISTS) return NULL;
  }
  return NULL;
}

// The file is removed once the last handle to it, the program's, is closed.
int lerta_os_input_file(const uint8_t *bytes, int64_t length) {
  wchar_t dir[MAX_PATH + 1];
  wchar_t path[MAX_PATH + 1];
  DWORD dir_length = GetTempPathW(MAX_PATH + 1, dir);
  if (dir_length == 0 || dir_length > MAX_PATH) return -1;
  if (GetTempFileNameW(dir, L"lin", 0, path) == 0) return -1;
  DWORD share = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
  DWORD flags = FILE_ATTRIBUTE_TEMPORARY | FILE_FLAG_DELETE_ON_CLOSE;
  HANDLE file =
    CreateFileW(path, GENERIC_READ | GENERIC_WRITE, share, NULL, OPEN_EXISTING, flags, NULL);
  if (file == INVALID_HANDLE_VALUE) {
    DeleteFileW(path);
    return -1;
  }
  bool written = true;
  for (int64_t done = 0; written && done < length;) {
    int64_t left = length - done;
    DWORD chunk = left > 0x40000000 ? 0x40000000 : (DWORD)left;
    DWORD count = 0;
    written = WriteFile(file, bytes + done, chunk, &count, NULL);
    done += count;
  }
  LARGE_INTEGER start = {0};
  int fd = -1;
  if (written && SetFilePointerEx(file, start, NULL, FILE_BEGIN)) {
    fd = _open_osfhandle((intptr_t)file, _O_RDONLY);
  }
  if (fd < 0) CloseHandle(file);
  return fd;
}

void lerta_os_close_input_file(int fd) {
  _close(fd);
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

bool lerta_os_make_dir(const char *path) {
  wchar_t *name = to_utf16(path);
  if (name == NULL) return false;
  DWORD attributes = CreateDirectoryW(name, NULL) ? FILE_ATTRIBUTE_DIRECTORY
                                                   : GetFileAttributesW(name);
  free(name);
  return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY);
}

bool lerta_os_is_separator(char c) {
  return c == '/' || c == '\\';
}

bool lerta_os_rename(const char *from, const char *to) {
  wchar_t *from_name = to_utf16(from);
  wchar_t *to_name = to_utf16(to);
  bool renamed = from_name != NULL && to_name != NULL &&
                 MoveFileExW(from_name, to_name, MOVEFILE_REPLACE_EXISTING);
  free(from_name);
  free(to_name);
  return renamed;
}

const char *lerta_os_platform(void) { return "windows"; }

int64_t lerta_os_cpu_count(void) {
  DWORD count = GetActiveProcessorCount(ALL_PROCESSOR_GROUPS);
  return count > 0 ? count : 1;
}

char *lerta_os_env(const char *name) {
  wchar_t *wide_name = to_utf16(name);
  DWORD size = wide_name == NULL ? 0 : GetEnvironmentVariableW(wide_name, NULL, 0);
  char *result = NULL;
  while (size > 0) {
    wchar_t *value = lerta_checked_malloc(size * sizeof(wchar_t));
    value[0] = L'\0';
    // A call that succeeds need not clear the last error, which tells an empty value apart.
    SetLastError(ERROR_SUCCESS);
    DWORD length = GetEnvironmentVariableW(wide_name, value, size);
    // 0 is an empty value, or a variable removed between the calls.
    bool is_set = length > 0 || GetLastError() != ERROR_ENVVAR_NOT_FOUND;
    if (length < size && is_set) result = to_utf8(value);
    free(value);
    // The variable grew between the calls; `length` is the size it needs now.
    size = length < size ? 0 : length;
  }
  free(wide_name);
  return result;
}

static bool is_dot_or_dot_dot(const wchar_t *name) {
  return wcscmp(name, L".") == 0 || wcscmp(name, L"..") == 0;
}

// A directory always holds `.` and `..`, so finding nothing is a failure.
bool lerta_os_list_dir(const char *path, LertaArray *names) {
  wchar_t *dir = to_utf16(path);
  if (dir == NULL) return false;
  wchar_t *pattern = join_path(dir, L"*");
  free(dir);
  WIN32_FIND_DATAW entry;
  HANDLE find = FindFirstFileW(pattern, &entry);
  free(pattern);
  if (find == INVALID_HANDLE_VALUE) return false;
  bool listed = true;
  do {
    if (is_dot_or_dot_dot(entry.cFileName)) continue;
    char *name = to_utf8(entry.cFileName);
    listed = name != NULL;
    if (listed) lerta_append_c_string(names, name);
    free(name);
  } while (listed && FindNextFileW(find, &entry));
  listed = listed && GetLastError() == ERROR_NO_MORE_FILES;
  FindClose(find);
  return listed;
}

static bool remove_tree(const wchar_t *path);

static bool remove_entries(const wchar_t *path) {
  wchar_t *pattern = join_path(path, L"*");
  WIN32_FIND_DATAW entry;
  HANDLE find = FindFirstFileW(pattern, &entry);
  free(pattern);
  if (find == INVALID_HANDLE_VALUE) return false;
  bool removed = true;
  do {
    if (is_dot_or_dot_dot(entry.cFileName)) continue;
    wchar_t *child = join_path(path, entry.cFileName);
    removed = remove_tree(child);
    free(child);
  } while (removed && FindNextFileW(find, &entry));
  FindClose(find);
  return removed;
}

// A link to a directory (a reparse point) is removed itself, not what it links to.
static bool remove_tree(const wchar_t *path) {
  DWORD attributes = GetFileAttributesW(path);
  if (attributes == INVALID_FILE_ATTRIBUTES) return false;
  if (!(attributes & FILE_ATTRIBUTE_DIRECTORY)) return DeleteFileW(path);
  bool is_link = attributes & FILE_ATTRIBUTE_REPARSE_POINT;
  return (is_link || remove_entries(path)) && RemoveDirectoryW(path);
}

bool lerta_os_remove_tree(const char *path) {
  wchar_t *name = to_utf16(path);
  bool removed = name != NULL && remove_tree(name);
  free(name);
  return removed;
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

// Quoted, for libuv to put on the command line as it is.
char *lerta_os_program_argument(const char *argument) {
  char *quoted = lerta_checked_malloc(2 * strlen(argument) + 3);
  *write_quoted(quoted, argument) = '\0';
  return quoted;
}

static bool has_directory(const char *command) {
  return strpbrk(command, "/\\:") != NULL;
}

char *lerta_os_program_file(const char *command) {
  if (has_directory(command)) return _strdup(command);
  wchar_t *found = search_path(command);
  char *file = found == NULL ? NULL : to_utf8(found);
  free(found);
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

#endif
