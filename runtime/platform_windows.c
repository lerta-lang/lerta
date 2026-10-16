#ifdef _WIN32

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

bool lerta_os_is_terminal(int fd) {
  return is_console(standard_handle(fd));
}

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

// As POSIX's stat: opening follows links, so a dangling one fails, and a device such as NUL is not
// a disk file, which this tells apart. The attributes of what the path names, if it is one.
static bool disk_attributes(const char *path, DWORD *attributes) {
  HANDLE file = open_file(path, 0, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS);
  if (file == INVALID_HANDLE_VALUE) return false;
  BY_HANDLE_FILE_INFORMATION information;
  bool is_disk_file = GetFileType(file) == FILE_TYPE_DISK &&
                      GetFileInformationByHandle(file, &information);
  CloseHandle(file);
  if (is_disk_file) *attributes = information.dwFileAttributes;
  return is_disk_file;
}

bool lerta_os_is_file(const char *path) {
  DWORD attributes;
  return disk_attributes(path, &attributes) && !(attributes & FILE_ATTRIBUTE_DIRECTORY);
}

bool lerta_os_is_dir(const char *path) {
  DWORD attributes;
  return disk_attributes(path, &attributes) && (attributes & FILE_ATTRIBUTE_DIRECTORY);
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
