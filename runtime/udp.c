#include <stdlib.h>
#include <string.h>

#include <uv.h>

#include "internal.h"

// The UDP sockets of std:net. Lerta holds a Udp by its address, in a UdpHandle of std:net, which
// frees it; a close keeps it, closed, until then.

LERTA_STATIC_STRING(cannot_bind, "cannot bind at ");
LERTA_STATIC_STRING(cannot_receive, "cannot receive at ");
LERTA_STATIC_STRING(cannot_send, "cannot send to ");
LERTA_STATIC_STRING(received_twice,
                    "a UdpSocket is received by another receive that has not ended");

// How long a name that a send resolved is taken for its address, for the sends that follow to it.
static const uint64_t cache_lifetime_ns = 1000000000;

// Large enough for any datagram, so that none is cut.
enum { DATAGRAM_MAX = 65536 };

// A socket whose libuv handle is unreferenced but while a receive is pending, so that one left open
// does not keep the program running; a send, a request of the loop, does. It is freed once Lerta
// has freed it and the sends that are under way, and the close of its libuv handle, have ended.
typedef struct {
  // NULL once closed.
  uv_udp_t *udp;
  bool freed;
  int requests;
  // The family of the address it is bound at, the only one it sends to.
  int family;
  // Where it is bound, which the failures of a receive name.
  LertaString *address;
  // The receive that is pending, which it holds.
  LertaPromise *pending;
  // Where the datagram that the last receive gave came from, which std:net reads as the receive's
  // await ends: no other receive can end before, as datagrams come only when the loop polls again,
  // after the tasks that are ready have run.
  LertaString *sender_host;
  int64_t sender_port;
  // The name that a send resolved last, NULL if none, its port, its address and when it was
  // resolved.
  char *cached_host;
  int64_t cached_port;
  struct sockaddr_storage cached_address;
  uint64_t cached_at;
  char buffer[DATAGRAM_MAX];
} Udp;

static Udp *udp_of(int64_t pointer) {
  return (Udp *)(intptr_t)pointer;
}

static void free_udp_if_done(Udp *socket) {
  if (!socket->freed || socket->requests > 0) return;
  free(socket->cached_host);
  free(socket);
}

static void end_request(Udp *socket) {
  socket->requests--;
  free_udp_if_done(socket);
}

static void free_libuv_handle(uv_handle_t *handle) {
  Udp *socket = handle->data;
  free(handle);
  end_request(socket);
}

static void set_lerta_string(LertaString **field, LertaString *value) {
  if (*field != NULL) lerta_release(*field);
  *field = value;
}

int64_t lerta_udp_new(void) {
  Udp *socket = lerta_checked_calloc(1, sizeof(Udp));
  socket->udp = lerta_checked_malloc(sizeof(uv_udp_t));
  uv_udp_init(uv_default_loop(), socket->udp);
  socket->udp->data = socket;
  uv_unref((uv_handle_t *)socket->udp);
  return (int64_t)(intptr_t)socket;
}

static LertaPromise *take_pending(Udp *socket) {
  LertaPromise *promise = socket->pending;
  socket->pending = NULL;
  return promise;
}

void lerta_udp_close(int64_t pointer) {
  Udp *socket = udp_of(pointer);
  if (socket->udp == NULL) return;
  socket->requests++;
  uv_close((uv_handle_t *)socket->udp, free_libuv_handle);
  socket->udp = NULL;
  if (socket->pending == NULL) return;
  LertaPromise *promise = take_pending(socket);
  lerta_promise_reject_io(promise, LERTA_STR(cannot_receive), socket->address);
  lerta_release(promise);
}

void lerta_udp_free(int64_t pointer) {
  Udp *socket = udp_of(pointer);
  lerta_udp_close(pointer);
  // At once, as a Udp released at the end of the program, after the loop, would leave them.
  set_lerta_string(&socket->address, NULL);
  set_lerta_string(&socket->sender_host, NULL);
  socket->freed = true;
  free_udp_if_done(socket);
}

static const struct addrinfo bind_hints = {
  .ai_family = AF_UNSPEC, .ai_socktype = SOCK_DGRAM, .ai_flags = AI_NUMERICSERV};

int64_t lerta_udp_bind(int64_t pointer, const LertaString *host, int64_t port) {
  Udp *socket = udp_of(pointer);
  char *name = lerta_c_string(host);
  uint8_t buffer[LERTA_INT_TEXT_MAX + 1];
  uv_getaddrinfo_t request;
  // Without a callback, libuv resolves the name at once.
  bool resolved = uv_getaddrinfo(uv_default_loop(), &request, NULL, name,
                                 lerta_port_text(port, buffer), &bind_hints) == 0;
  bool bound = resolved && uv_udp_bind(socket->udp, request.addrinfo->ai_addr, 0) == 0;
  if (resolved) uv_freeaddrinfo(request.addrinfo);
  struct sockaddr_storage address;
  int length = sizeof(address);
  bound = bound && uv_udp_getsockname(socket->udp, (struct sockaddr *)&address, &length) == 0;
  int64_t bound_port = bound ? lerta_port_of(&address) : -1;
  if (bound) socket->family = address.ss_family;
  set_lerta_string(&socket->address, lerta_address_text(name, bound ? bound_port : port));
  free(name);
  if (!bound) lerta_raise_with(LERTA_IO_ERROR, LERTA_STR(cannot_bind), socket->address);
  return bound_port;
}

// The libuv handle is referenced while a receive waits.
static void stop_receiving(Udp *socket) {
  uv_udp_recv_stop(socket->udp);
  uv_unref((uv_handle_t *)socket->udp);
}

static void allocate_datagram(uv_handle_t *handle, size_t suggested_size, uv_buf_t *buffer) {
  (void)suggested_size;
  Udp *socket = handle->data;
  *buffer = uv_buf_init(socket->buffer, sizeof(socket->buffer));
}

static void take_sender(Udp *socket, const struct sockaddr *sender) {
  const struct sockaddr_storage *address = (const struct sockaddr_storage *)sender;
  char host[INET6_ADDRSTRLEN];
  if (!lerta_host_of(address, host)) host[0] = '\0';
  set_lerta_string(&socket->sender_host, lerta_string_from_c(host));
  socket->sender_port = lerta_port_of(address);
}

// One datagram ends a receive, so that a cancelled receive, which stops the receives, loses none:
// the system keeps what comes meanwhile. libuv gives 0 bytes and no sender when there is nothing to
// read, which is no datagram; an empty datagram has a sender.
static void receive_datagram(uv_udp_t *handle, ssize_t count, const uv_buf_t *buffer,
                             const struct sockaddr *sender, unsigned flags) {
  (void)flags;
  Udp *socket = handle->data;
  if (count == 0 && sender == NULL) return;
  stop_receiving(socket);
  LertaPromise *promise = take_pending(socket);
  if (count < 0) {
    lerta_promise_reject_io(promise, LERTA_STR(cannot_receive), socket->address);
  } else {
    take_sender(socket, sender);
    *(LertaString **)lerta_promise_slot(promise) = lerta_string_from_bytes(buffer->base, count);
    lerta_promise_resolve(promise);
  }
  lerta_release(promise);
}

static void cancel_receive(void *context) {
  Udp *socket = context;
  stop_receiving(socket);
  LertaPromise *promise = take_pending(socket);
  lerta_promise_reject_cancelled(promise);
  lerta_release(promise);
}

LertaPromise *lerta_udp_receive(int64_t pointer) {
  Udp *socket = udp_of(pointer);
  // As a Reader throws for a read while another is pending.
  if (socket->pending != NULL) {
    lerta_raise(LERTA_VALUE_ERROR, LERTA_STR(received_twice));
    return NULL;
  }
  LertaPromise *promise = lerta_promise_new(LERTA_REFERENCE_ITEMS);
  bool started = socket->udp != NULL &&
                 uv_udp_recv_start(socket->udp, allocate_datagram, receive_datagram) == 0;
  if (!started) {
    lerta_promise_reject_io(promise, LERTA_STR(cannot_receive), socket->address);
    return promise;
  }
  uv_ref((uv_handle_t *)socket->udp);
  lerta_retain(promise);
  socket->pending = promise;
  lerta_promise_on_cancel(promise, cancel_receive, socket);
  return promise;
}

LertaString *lerta_udp_sender_host(int64_t pointer) {
  LertaString *host = udp_of(pointer)->sender_host;
  lerta_retain(host);
  return host;
}

int64_t lerta_udp_sender_port(int64_t pointer) {
  return udp_of(pointer)->sender_port;
}

// A send, which resolves its host first unless it is a numeric address or one resolved within
// cache_lifetime_ns. A cancelled send that is resolving is given up; one given to libuv goes on,
// and its end settles nothing. It holds its bytes, which libuv sends in place, and its address, the
// destination's.
typedef struct {
  uv_udp_send_t request;
  uv_getaddrinfo_t resolving;
  Udp *socket;
  LertaPromise *promise;
  LertaString *bytes;
  LertaString *address;
  char *host;
  int64_t port;
  bool cancelled;
} Send;

static void end_send(Send *send, int status) {
  if (send->cancelled) {
    // Settled already.
  } else if (status == 0) {
    lerta_promise_resolve(send->promise);
  } else {
    lerta_promise_reject_io(send->promise, LERTA_STR(cannot_send), send->address);
  }
  lerta_release(send->promise);
  lerta_release(send->bytes);
  lerta_release(send->address);
  free(send->host);
  Udp *socket = send->socket;
  free(send);
  end_request(socket);
}

static void end_libuv_send(uv_udp_send_t *request, int status) {
  end_send(request->data, status);
}

static void start_send(Send *send, const struct sockaddr *destination) {
  Udp *socket = send->socket;
  int status = UV_EBADF;
  if (socket->udp != NULL && !send->cancelled) {
    uv_buf_t buffer = uv_buf_init((char *)send->bytes->bytes, (unsigned int)send->bytes->length);
    status = uv_udp_send(&send->request, socket->udp, &buffer, 1, destination, end_libuv_send);
  }
  if (status != 0) end_send(send, status);
}

static void cache_address(Udp *socket, const Send *send, const struct sockaddr *address,
                          size_t length) {
  free(socket->cached_host);
  size_t host_size = strlen(send->host) + 1;
  socket->cached_host = lerta_checked_malloc(host_size);
  memcpy(socket->cached_host, send->host, host_size);
  socket->cached_port = send->port;
  memset(&socket->cached_address, 0, sizeof(socket->cached_address));
  memcpy(&socket->cached_address, address, length);
  socket->cached_at = uv_hrtime();
}

static bool is_cached(const Udp *socket, const char *host, int64_t port) {
  return socket->cached_host != NULL && socket->cached_port == port &&
         strcmp(socket->cached_host, host) == 0 &&
         uv_hrtime() - socket->cached_at < cache_lifetime_ns;
}

// The numeric address of the host, which is false for a name.
static bool parse_numeric(const char *host, int64_t port, struct sockaddr_storage *address) {
  memset(address, 0, sizeof(*address));
  return uv_ip4_addr(host, (int)port, (struct sockaddr_in *)address) == 0 ||
         uv_ip6_addr(host, (int)port, (struct sockaddr_in6 *)address) == 0;
}

static void end_resolve(uv_getaddrinfo_t *request, int status, struct addrinfo *addresses) {
  Send *send = request->data;
  if (status == 0) {
    if (send->socket->udp != NULL) {
      cache_address(send->socket, send, addresses->ai_addr, addresses->ai_addrlen);
    }
    start_send(send, addresses->ai_addr);
  } else {
    end_send(send, status);
  }
  uv_freeaddrinfo(addresses);
}

static void cancel_send(void *context) {
  Send *send = context;
  send->cancelled = true;
  lerta_promise_reject_cancelled(send->promise);
}

static void resolve(Send *send) {
  Udp *socket = send->socket;
  struct addrinfo hints = {
    .ai_family = socket->family, .ai_socktype = SOCK_DGRAM, .ai_flags = AI_NUMERICSERV};
  uint8_t buffer[LERTA_INT_TEXT_MAX + 1];
  send->resolving.data = send;
  int status = uv_getaddrinfo(uv_default_loop(), &send->resolving, end_resolve, send->host,
                              lerta_port_text(send->port, buffer), &hints);
  if (status != 0) end_send(send, status);
}

// The datagram goes to the host's first address of the socket's family.
LertaPromise *lerta_udp_send(int64_t pointer, const LertaString *bytes, const LertaString *host,
                             int64_t port) {
  Udp *socket = udp_of(pointer);
  LertaPromise *promise = lerta_promise_new(LERTA_PLAIN_ITEMS);
  Send *send = lerta_checked_malloc(sizeof(Send));
  char *name = lerta_c_string(host);
  *send = (Send){.socket = socket, .promise = promise, .bytes = (LertaString *)bytes,
                 .address = lerta_address_text(name, port), .host = name, .port = port};
  send->request.data = send;
  socket->requests++;
  lerta_retain(promise);
  lerta_retain((void *)bytes);
  lerta_promise_on_cancel(promise, cancel_send, send);
  struct sockaddr_storage numeric;
  if (socket->udp == NULL) {
    end_send(send, UV_EBADF);
  } else if (parse_numeric(name, port, &numeric)) {
    start_send(send, (struct sockaddr *)&numeric);
  } else if (is_cached(socket, name, port)) {
    start_send(send, (struct sockaddr *)&socket->cached_address);
  } else {
    resolve(send);
  }
  return promise;
}
