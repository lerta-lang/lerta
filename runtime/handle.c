#include <stdlib.h>
#include <string.h>

#include <uv.h>

#include "internal.h"

// Each Handle holds a libuv stream: a socket or a listener of std:net, or a pipe of std:process.
// Lerta holds a Handle by its address, in a Handle of std/internal/handle.lerta, which frees it; a
// close keeps it, closed, until then.

LERTA_STATIC_STRING(cannot_listen, "cannot listen at ");
LERTA_STATIC_STRING(cannot_accept, "cannot accept at ");
LERTA_STATIC_STRING(cannot_connect, "cannot connect to ");
LERTA_STATIC_STRING(cannot_read, "cannot read from ");
LERTA_STATIC_STRING(cannot_write, "cannot write to ");
LERTA_STATIC_STRING(cannot_open_pipe, "cannot open ");
LERTA_STATIC_STRING(accepted_twice, "a Listener is accepted by another accept that has not ended");

// A socket, a listener or a pipe, whose libuv stream is unreferenced but while a read or an accept
// is pending, so that one left open does not keep the program running. It is freed once Lerta has
// freed it and the requests that are pending, and the closes of its libuv streams, have ended,
// which they do on the loop.
typedef struct Handle {
  // NULL once closed.
  uv_stream_t *stream;
  bool freed;
  int requests;
  // What the failures name: a socket's `host:port`, where it listens, what it connects to or its
  // peer, or a pipe's name.
  LertaString *address;
  // The promise of the read, the accept or the connect that is pending, which it holds, and how a
  // close fails it, as another task awaits it.
  LertaPromise *pending;
  const void *pending_failure;
  // The rest is TCP's. The socket that the accept pending takes the connection into.
  struct Handle *accepted;
  // The connections that have come and are not taken yet.
  int64_t connections;
  // What a connect resolved, and the address that it tries next; each attempt takes a new libuv
  // stream (see reopen_tcp).
  struct addrinfo *addresses;
  struct addrinfo *next_address;
  uv_getaddrinfo_t resolving;
  uv_connect_t connecting;
} Handle;

static Handle *handle_of(int64_t pointer) {
  return (Handle *)(intptr_t)pointer;
}

static void set_address(Handle *handle, LertaString *address) {
  if (handle->address != NULL) lerta_release(handle->address);
  handle->address = address;
}

static void free_handle_if_done(Handle *handle) {
  if (handle->freed && handle->requests == 0) free(handle);
}

static void end_request(Handle *handle) {
  handle->requests--;
  free_handle_if_done(handle);
}

static void free_stream(uv_handle_t *stream) {
  Handle *handle = stream->data;
  free(stream);
  end_request(handle);
}

static uv_tcp_t *tcp_of(Handle *handle) {
  return (uv_tcp_t *)handle->stream;
}

static void set_stream(Handle *handle, uv_stream_t *stream) {
  handle->stream = stream;
  stream->data = handle;
  uv_unref((uv_handle_t *)stream);
}

static void open_tcp(Handle *handle) {
  uv_tcp_t *tcp = lerta_checked_malloc(sizeof(uv_tcp_t));
  uv_tcp_init(uv_default_loop(), tcp);
  set_stream(handle, (uv_stream_t *)tcp);
}

static void close_stream(Handle *handle) {
  handle->requests++;
  uv_close((uv_handle_t *)handle->stream, free_stream);
  handle->stream = NULL;
}

// A failed connect leaves its socket, of its address's family, on the libuv stream, which libuv
// would connect again to the next address, even of the other family; so each attempt takes a new
// stream.
static void reopen_tcp(Handle *handle) {
  close_stream(handle);
  open_tcp(handle);
}

// An IPv6 address is written in brackets, as in a URL, so that its port is told from it.
static LertaString *address_text(const char *host, int64_t port) {
  bool is_ip6 = strchr(host, ':') != NULL;
  uint8_t digits[LERTA_INT_TEXT_MAX];
  int64_t start = lerta_format_int(port, digits);
  int64_t host_length = (int64_t)strlen(host);
  int64_t port_length = LERTA_INT_TEXT_MAX - start;
  LertaString *text = lerta_string_new(host_length + port_length + (is_ip6 ? 3 : 1));
  uint8_t *end = text->bytes;
  if (is_ip6) *end++ = '[';
  memcpy(end, host, (size_t)host_length);
  end += host_length;
  if (is_ip6) *end++ = ']';
  *end++ = ':';
  memcpy(end, digits + start, (size_t)port_length);
  return text;
}

// The port as getaddrinfo takes it, a service named by its number.
static char *port_text(int64_t port, uint8_t buffer[LERTA_INT_TEXT_MAX + 1]) {
  int64_t start = lerta_format_int(port, buffer);
  buffer[LERTA_INT_TEXT_MAX] = '\0';
  return (char *)buffer + start;
}

static const struct addrinfo tcp_hints = {
  .ai_family = AF_UNSPEC, .ai_socktype = SOCK_STREAM, .ai_flags = AI_NUMERICSERV};

static int64_t port_of(const struct sockaddr_storage *address) {
  if (address->ss_family == AF_INET6) return ntohs(((struct sockaddr_in6 *)address)->sin6_port);
  return ntohs(((struct sockaddr_in *)address)->sin_port);
}

static void reject_with(LertaPromise *promise, const void *failure, const LertaString *address) {
  lerta_raise_with(LERTA_IO_ERROR, failure, address);
  lerta_promise_reject(promise);
}

// The promise that the Handle held, taken from it.
static LertaPromise *take_pending(Handle *handle) {
  LertaPromise *promise = handle->pending;
  handle->pending = NULL;
  return promise;
}

static void reject_cancelled(Handle *handle) {
  LertaPromise *promise = take_pending(handle);
  lerta_promise_reject_cancelled(promise);
  lerta_release(promise);
}

static void hold_pending(Handle *handle, LertaPromise *promise, const void *failure,
                         LertaCancel cancel) {
  lerta_retain(promise);
  handle->pending = promise;
  handle->pending_failure = failure;
  lerta_promise_on_cancel(promise, cancel, handle);
}

int64_t lerta_tcp_new(void) {
  Handle *handle = lerta_checked_calloc(1, sizeof(Handle));
  open_tcp(handle);
  return (int64_t)(intptr_t)handle;
}

int64_t lerta_pipe_new(const LertaString *name) {
  Handle *handle = lerta_checked_calloc(1, sizeof(Handle));
  uv_pipe_t *pipe = lerta_checked_malloc(sizeof(uv_pipe_t));
  uv_pipe_init(uv_default_loop(), pipe, 0);
  set_stream(handle, (uv_stream_t *)pipe);
  lerta_retain((void *)name);
  handle->address = (LertaString *)name;
  return (int64_t)(intptr_t)handle;
}

int64_t lerta_pipe_of_file(const LertaString *name, int64_t file) {
  int64_t pointer = lerta_pipe_new(name);
  if (uv_pipe_open((uv_pipe_t *)lerta_handle_stream(pointer), (uv_file)file) != 0) {
    lerta_handle_free(pointer);
    lerta_raise_with(LERTA_IO_ERROR, &cannot_open_pipe, name);
    return 0;
  }
  return pointer;
}

uv_stream_t *lerta_handle_stream(int64_t pointer) {
  return handle_of(pointer)->stream;
}

void lerta_handle_close(int64_t pointer) {
  Handle *handle = handle_of(pointer);
  if (handle->stream == NULL) return;
  close_stream(handle);
  if (handle->pending == NULL) return;
  handle->accepted = NULL;
  LertaPromise *promise = take_pending(handle);
  reject_with(promise, handle->pending_failure, handle->address);
  lerta_release(promise);
}

void lerta_handle_free(int64_t pointer) {
  Handle *handle = handle_of(pointer);
  lerta_handle_close(pointer);
  // At once, as a Handle released at the end of the program, after the loop, would leave it.
  set_address(handle, NULL);
  handle->freed = true;
  free_handle_if_done(handle);
}

// The listener's stream is referenced while an accept waits.
static void stop_waiting(Handle *listener) {
  uv_unref((uv_handle_t *)listener->stream);
}

// The address of the socket's peer, or NULL if it cannot be read.
static LertaString *peer_address(Handle *socket) {
  struct sockaddr_storage peer;
  int length = sizeof(peer);
  if (uv_tcp_getpeername(tcp_of(socket), (struct sockaddr *)&peer, &length) != 0) return NULL;
  char host[INET6_ADDRSTRLEN];
  int status = peer.ss_family == AF_INET6
                 ? uv_ip6_name((struct sockaddr_in6 *)&peer, host, sizeof(host))
                 : uv_ip4_name((struct sockaddr_in *)&peer, host, sizeof(host));
  return status == 0 ? address_text(host, port_of(&peer)) : NULL;
}

// The connection goes into the socket, which takes the peer's address.
static void take_connection(Handle *listener, LertaPromise *promise) {
  Handle *socket = listener->accepted;
  listener->accepted = NULL;
  listener->connections--;
  bool accepted = uv_accept(listener->stream, socket->stream) == 0;
  LertaString *address = accepted ? peer_address(socket) : NULL;
  if (address == NULL) {
    reject_with(promise, &cannot_accept, listener->address);
    return;
  }
  set_address(socket, address);
  lerta_promise_resolve(promise);
}

// A failure fails the accept that waits, and is no connection.
static void come_connection(uv_stream_t *stream, int status) {
  Handle *listener = stream->data;
  if (status == 0) listener->connections++;
  if (listener->pending == NULL) return;
  stop_waiting(listener);
  LertaPromise *promise = take_pending(listener);
  if (status == 0) {
    take_connection(listener, promise);
  } else {
    listener->accepted = NULL;
    reject_with(promise, &cannot_accept, listener->address);
  }
  lerta_release(promise);
}

int64_t lerta_tcp_listen(int64_t pointer, const LertaString *host, int64_t port) {
  Handle *handle = handle_of(pointer);
  char *name = lerta_c_string(host);
  uint8_t buffer[LERTA_INT_TEXT_MAX + 1];
  uv_getaddrinfo_t request;
  // Without a callback, libuv resolves the name at once.
  bool resolved = uv_getaddrinfo(uv_default_loop(), &request, NULL, name, port_text(port, buffer),
                                 &tcp_hints) == 0;
  bool listening = resolved && uv_tcp_bind(tcp_of(handle), request.addrinfo->ai_addr, 0) == 0 &&
                   uv_listen(handle->stream, SOMAXCONN, come_connection) == 0;
  if (resolved) uv_freeaddrinfo(request.addrinfo);
  struct sockaddr_storage address;
  int length = sizeof(address);
  bool bound =
    listening && uv_tcp_getsockname(tcp_of(handle), (struct sockaddr *)&address, &length) == 0;
  int64_t bound_port = bound ? port_of(&address) : -1;
  set_address(handle, address_text(name, bound ? bound_port : port));
  free(name);
  if (!bound) lerta_raise_with(LERTA_IO_ERROR, &cannot_listen, handle->address);
  return bound_port;
}

static void cancel_accept(void *context) {
  Handle *listener = context;
  stop_waiting(listener);
  listener->accepted = NULL;
  reject_cancelled(listener);
}

// std:net gives a new socket, which it holds until the promise is settled.
LertaPromise *lerta_tcp_accept(int64_t listener_pointer, int64_t socket_pointer) {
  Handle *listener = handle_of(listener_pointer);
  // As a Reader throws for a read while another is pending.
  if (listener->pending != NULL) {
    lerta_raise(LERTA_VALUE_ERROR, (const LertaString *)&accepted_twice);
    return NULL;
  }
  LertaPromise *promise = lerta_promise_new(LERTA_PLAIN_ITEMS);
  if (listener->stream == NULL) {
    reject_with(promise, &cannot_accept, listener->address);
    return promise;
  }
  listener->accepted = handle_of(socket_pointer);
  if (listener->connections > 0) {
    take_connection(listener, promise);
    return promise;
  }
  uv_ref((uv_handle_t *)listener->stream);
  hold_pending(listener, promise, &cannot_accept, cancel_accept);
  return promise;
}

static void end_connect(Handle *socket, bool connected) {
  uv_freeaddrinfo(socket->addresses);
  socket->addresses = NULL;
  LertaPromise *promise = take_pending(socket);
  if (connected) lerta_promise_resolve(promise);
  else reject_with(promise, &cannot_connect, socket->address);
  lerta_release(promise);
}

static void try_next_address(Handle *socket);

// A close cancels the attempt, which then ends with UV_ECANCELED.
static void end_connect_attempt(uv_connect_t *request, int status) {
  Handle *socket = request->data;
  socket->requests--;
  if (socket->stream == NULL) {
    uv_freeaddrinfo(socket->addresses);
    socket->addresses = NULL;
    free_handle_if_done(socket);
  } else if (status == 0) {
    end_connect(socket, true);
  } else {
    reopen_tcp(socket);
    try_next_address(socket);
  }
}

static void try_next_address(Handle *socket) {
  for (struct addrinfo *address = socket->next_address; address != NULL;
       address = address->ai_next) {
    socket->next_address = address->ai_next;
    socket->connecting.data = socket;
    if (uv_tcp_connect(&socket->connecting, tcp_of(socket), address->ai_addr,
                       end_connect_attempt) == 0) {
      socket->requests++;
      return;
    }
    reopen_tcp(socket);
  }
  end_connect(socket, false);
}

static void end_resolve(uv_getaddrinfo_t *request, int status, struct addrinfo *addresses) {
  Handle *socket = request->data;
  socket->requests--;
  if (socket->stream == NULL) {
    uv_freeaddrinfo(addresses);
    free_handle_if_done(socket);
    return;
  }
  socket->addresses = addresses;
  socket->next_address = status == 0 ? addresses : NULL;
  try_next_address(socket);
}

// The socket is closed, which gives up the connect.
static void cancel_connect(void *context) {
  Handle *socket = context;
  LertaPromise *promise = take_pending(socket);
  lerta_handle_close((int64_t)(intptr_t)socket);
  lerta_promise_reject_cancelled(promise);
  lerta_release(promise);
}

// The host is resolved on the thread pool, and each of its addresses is tried in turn until one
// connects.
LertaPromise *lerta_tcp_connect(int64_t pointer, const LertaString *host, int64_t port) {
  Handle *socket = handle_of(pointer);
  LertaPromise *promise = lerta_promise_new(LERTA_PLAIN_ITEMS);
  char *name = lerta_c_string(host);
  set_address(socket, address_text(name, port));
  if (socket->stream == NULL) {
    free(name);
    reject_with(promise, &cannot_connect, socket->address);
    return promise;
  }
  hold_pending(socket, promise, &cannot_connect, cancel_connect);
  uint8_t buffer[LERTA_INT_TEXT_MAX + 1];
  socket->resolving.data = socket;
  int status = uv_getaddrinfo(uv_default_loop(), &socket->resolving, end_resolve, name,
                              port_text(port, buffer), &tcp_hints);
  free(name);
  if (status == 0) socket->requests++;
  else end_connect(socket, false);
  return promise;
}

// The socket's stream is referenced while a read waits.
static void stop_reading(Handle *socket) {
  uv_read_stop(socket->stream);
  uv_unref((uv_handle_t *)socket->stream);
}

static void allocate_chunk(uv_handle_t *stream, size_t suggested_size, uv_buf_t *buffer) {
  (void)stream;
  *buffer = uv_buf_init(lerta_checked_malloc(suggested_size), (unsigned int)suggested_size);
}

// One chunk ends a read, so that a cancelled read, which stops the reads, loses none; libuv may
// give 0 bytes, which are none.
static void read_chunk(uv_stream_t *stream, ssize_t count, const uv_buf_t *buffer) {
  Handle *socket = stream->data;
  if (count == 0) {
    free(buffer->base);
    return;
  }
  stop_reading(socket);
  LertaPromise *promise = take_pending(socket);
  if (count == UV_EOF) {
    *(LertaString **)lerta_promise_slot(promise) = NULL;
    lerta_promise_resolve(promise);
  } else if (count < 0) {
    reject_with(promise, &cannot_read, socket->address);
  } else {
    *(LertaString **)lerta_promise_slot(promise) = lerta_string_from_bytes(buffer->base, count);
    lerta_promise_resolve(promise);
  }
  lerta_release(promise);
  free(buffer->base);
}

static void cancel_read(void *context) {
  Handle *socket = context;
  stop_reading(socket);
  reject_cancelled(socket);
}

LertaPromise *lerta_handle_read(int64_t pointer) {
  Handle *socket = handle_of(pointer);
  LertaPromise *promise = lerta_promise_new(LERTA_REFERENCE_ITEMS);
  bool started = socket->stream != NULL &&
                 uv_read_start(socket->stream, allocate_chunk, read_chunk) == 0;
  if (!started) {
    reject_with(promise, &cannot_read, socket->address);
    return promise;
  }
  uv_ref((uv_handle_t *)socket->stream);
  hold_pending(socket, promise, &cannot_read, cancel_read);
  return promise;
}

// A write cannot be stopped once given to libuv: a cancelled one goes on, and its end settles
// nothing. It holds its bytes, which libuv writes in place, and the address, as the socket may be
// freed first.
typedef struct {
  uv_write_t request;
  Handle *socket;
  LertaPromise *promise;
  LertaString *bytes;
  LertaString *address;
  bool cancelled;
} Write;

static void end_write(uv_write_t *request, int status) {
  Write *write = request->data;
  if (write->cancelled) {
    // Settled already.
  } else if (status == 0) {
    lerta_promise_resolve(write->promise);
  } else {
    reject_with(write->promise, &cannot_write, write->address);
  }
  lerta_release(write->promise);
  lerta_release(write->bytes);
  lerta_release(write->address);
  end_request(write->socket);
  free(write);
}

static void cancel_write(void *context) {
  Write *write = context;
  write->cancelled = true;
  lerta_promise_reject_cancelled(write->promise);
}

// A buffer's length is an unsigned long on Windows, of 32 bits, so the bytes go in parts of 1 GiB.
enum { WRITE_PART = 1 << 30 };

// libuv copies the buffers, but not the bytes. An empty write is one empty buffer, as libuv takes
// at least one.
static int start_write(Write *write) {
  int64_t length = write->bytes->length;
  int64_t count = length == 0 ? 1 : (length + WRITE_PART - 1) / WRITE_PART;
  uv_buf_t *buffers = lerta_checked_malloc((size_t)count * sizeof(uv_buf_t));
  for (int64_t i = 0; i < count; i++) {
    int64_t part = length - i * WRITE_PART;
    if (part > WRITE_PART) part = WRITE_PART;
    buffers[i] = uv_buf_init((char *)write->bytes->bytes + i * WRITE_PART, (unsigned int)part);
  }
  int status = uv_write(&write->request, write->socket->stream, buffers,
                        (unsigned int)count, end_write);
  free(buffers);
  return status;
}

LertaPromise *lerta_handle_write(int64_t pointer, const LertaString *bytes) {
  Handle *socket = handle_of(pointer);
  LertaPromise *promise = lerta_promise_new(LERTA_PLAIN_ITEMS);
  if (socket->stream == NULL) {
    reject_with(promise, &cannot_write, socket->address);
    return promise;
  }
  Write *write = lerta_checked_malloc(sizeof(Write));
  *write = (Write){.socket = socket, .promise = promise, .bytes = (LertaString *)bytes,
                   .address = socket->address};
  write->request.data = write;
  if (start_write(write) != 0) {
    free(write);
    reject_with(promise, &cannot_write, socket->address);
    return promise;
  }
  socket->requests++;
  lerta_retain(promise);
  lerta_retain((void *)bytes);
  lerta_retain(socket->address);
  lerta_promise_on_cancel(promise, cancel_write, write);
  return promise;
}

static void end_shutdown(uv_shutdown_t *request, int status) {
  (void)status;
  Handle *socket = request->data;
  free(request);
  end_request(socket);
}

// A failure is not reported: the peer reads the end once the socket is closed in any case.
void lerta_handle_end(int64_t pointer) {
  Handle *socket = handle_of(pointer);
  if (socket->stream == NULL) return;
  uv_shutdown_t *request = lerta_checked_malloc(sizeof(uv_shutdown_t));
  request->data = socket;
  if (uv_shutdown(request, socket->stream, end_shutdown) == 0) socket->requests++;
  else free(request);
}
