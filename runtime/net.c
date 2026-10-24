#include <stdlib.h>
#include <string.h>

#include "internal.h"

// The sockets and listeners of std:net, over loop.c's TCP. A handle is the address of a Net, which
// std:net's Handle owns; a close keeps it, closed, until that frees it.

LERTA_STATIC_STRING(cannot_listen, "cannot listen at ");
LERTA_STATIC_STRING(cannot_accept, "cannot accept at ");
LERTA_STATIC_STRING(cannot_connect, "cannot connect to ");
LERTA_STATIC_STRING(cannot_read, "cannot read from ");
LERTA_STATIC_STRING(cannot_write, "cannot write to ");
LERTA_STATIC_STRING(accepted_twice, "a Listener is accepted by another accept that has not ended");

typedef struct Net {
  // NULL once closed.
  LertaTcp *tcp;
  // `host:port`, which the failures name: where it listens, what it connects to or its peer.
  LertaString *address;
  // The promise of the read, the accept or the connect that is pending, which it holds, and how a
  // close fails it, as another task awaits it.
  LertaPromise *pending;
  const void *pending_failure;
  // The socket that the accept pending takes the connection into.
  struct Net *accepted;
} Net;

static Net *net_of(int64_t handle) {
  return (Net *)(intptr_t)handle;
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

static void set_address(Net *net, LertaString *address) {
  if (net->address != NULL) lerta_release(net->address);
  net->address = address;
}

static void reject_with(LertaPromise *promise, const void *failure, const LertaString *address) {
  lerta_raise_with(LERTA_IO_ERROR, failure, address);
  lerta_promise_reject(promise);
}

// The promise that the Net held, taken from it.
static LertaPromise *take_pending(Net *net) {
  LertaPromise *promise = net->pending;
  net->pending = NULL;
  return promise;
}

static void reject_cancelled(Net *net) {
  LertaPromise *promise = take_pending(net);
  lerta_promise_reject_cancelled(promise);
  lerta_release(promise);
}

static void hold_pending(Net *net, LertaPromise *promise, const void *failure, LertaCancel cancel) {
  lerta_retain(promise);
  net->pending = promise;
  net->pending_failure = failure;
  lerta_promise_on_cancel(promise, cancel, net);
}

int64_t lerta_tcp_new(void) {
  Net *net = lerta_checked_calloc(1, sizeof(Net));
  net->tcp = lerta_loop_tcp_new();
  return (int64_t)(intptr_t)net;
}

void lerta_tcp_close(int64_t handle) {
  Net *net = net_of(handle);
  if (net->tcp == NULL) return;
  lerta_loop_tcp_close(net->tcp);
  net->tcp = NULL;
  if (net->pending == NULL) return;
  net->accepted = NULL;
  LertaPromise *promise = take_pending(net);
  reject_with(promise, net->pending_failure, net->address);
  lerta_release(promise);
}

void lerta_tcp_free(int64_t handle) {
  Net *net = net_of(handle);
  lerta_tcp_close(handle);
  set_address(net, NULL);
  free(net);
}

int64_t lerta_tcp_listen(int64_t handle, const LertaString *host, int64_t port) {
  Net *net = net_of(handle);
  char *name = lerta_c_string(host);
  int64_t bound = lerta_loop_tcp_listen(net->tcp, name, port);
  set_address(net, address_text(name, bound >= 0 ? bound : port));
  free(name);
  if (bound < 0) lerta_raise_with(LERTA_IO_ERROR, &cannot_listen, net->address);
  return bound;
}

// The connection goes into the socket, which takes the peer's address.
static void take_connection(Net *listener, LertaPromise *promise) {
  Net *socket = listener->accepted;
  listener->accepted = NULL;
  char host[LERTA_HOST_TEXT_SIZE];
  int64_t port;
  bool taken = lerta_loop_tcp_take(listener->tcp, socket->tcp) &&
               lerta_loop_tcp_peer(socket->tcp, host, &port);
  if (!taken) {
    reject_with(promise, &cannot_accept, listener->address);
    return;
  }
  set_address(socket, address_text(host, port));
  lerta_promise_resolve(promise);
}

static void end_accept(void *context, bool succeeded) {
  Net *listener = context;
  LertaPromise *promise = take_pending(listener);
  if (succeeded) {
    take_connection(listener, promise);
  } else {
    listener->accepted = NULL;
    reject_with(promise, &cannot_accept, listener->address);
  }
  lerta_release(promise);
}

static void cancel_accept(void *context) {
  Net *listener = context;
  lerta_loop_tcp_stop_waiting(listener->tcp);
  listener->accepted = NULL;
  reject_cancelled(listener);
}

// std:net gives a new socket, which it holds until the promise is settled.
LertaPromise *lerta_tcp_accept(int64_t listener_handle, int64_t socket_handle) {
  Net *listener = net_of(listener_handle);
  // As a Reader throws for a read while another is pending.
  if (listener->pending != NULL) {
    lerta_raise(LERTA_VALUE_ERROR, (const LertaString *)&accepted_twice);
    return NULL;
  }
  LertaPromise *promise = lerta_promise_new(LERTA_PLAIN_ITEMS);
  if (listener->tcp == NULL) {
    reject_with(promise, &cannot_accept, listener->address);
    return promise;
  }
  listener->accepted = net_of(socket_handle);
  if (lerta_loop_tcp_wait_connection(listener->tcp, end_accept, listener)) {
    take_connection(listener, promise);
    return promise;
  }
  hold_pending(listener, promise, &cannot_accept, cancel_accept);
  return promise;
}

static void end_connect(void *context, bool succeeded) {
  Net *socket = context;
  LertaPromise *promise = take_pending(socket);
  if (succeeded) lerta_promise_resolve(promise);
  else reject_with(promise, &cannot_connect, socket->address);
  lerta_release(promise);
}

// The socket is closed, which gives up the connect.
static void cancel_connect(void *context) {
  Net *socket = context;
  LertaPromise *promise = take_pending(socket);
  lerta_tcp_close((int64_t)(intptr_t)socket);
  lerta_promise_reject_cancelled(promise);
  lerta_release(promise);
}

LertaPromise *lerta_tcp_connect(int64_t handle, const LertaString *host, int64_t port) {
  Net *socket = net_of(handle);
  LertaPromise *promise = lerta_promise_new(LERTA_PLAIN_ITEMS);
  char *name = lerta_c_string(host);
  set_address(socket, address_text(name, port));
  hold_pending(socket, promise, &cannot_connect, cancel_connect);
  lerta_loop_tcp_connect(socket->tcp, name, port, end_connect, socket);
  free(name);
  return promise;
}

static void end_read(void *context, uint8_t *bytes, int64_t length) {
  Net *socket = context;
  LertaPromise *promise = take_pending(socket);
  if (length < 0) {
    reject_with(promise, &cannot_read, socket->address);
  } else {
    LertaString *chunk = length == 0 ? NULL : lerta_string_from_bytes(bytes, length);
    *(LertaString **)lerta_promise_slot(promise) = chunk;
    lerta_promise_resolve(promise);
  }
  lerta_release(promise);
  free(bytes);
}

static void cancel_read(void *context) {
  Net *socket = context;
  lerta_loop_tcp_stop_reading(socket->tcp);
  reject_cancelled(socket);
}

LertaPromise *lerta_tcp_read(int64_t handle) {
  Net *socket = net_of(handle);
  LertaPromise *promise = lerta_promise_new(LERTA_REFERENCE_ITEMS);
  if (socket->tcp == NULL) {
    reject_with(promise, &cannot_read, socket->address);
    return promise;
  }
  hold_pending(socket, promise, &cannot_read, cancel_read);
  lerta_loop_tcp_read(socket->tcp, end_read, socket);
  return promise;
}

// A write cannot be stopped once given to libuv: a cancelled one goes on, and its end settles
// nothing.
typedef struct {
  LertaPromise *promise;
  LertaString *bytes;
  LertaString *address;
  bool cancelled;
} Write;

static void end_write(void *context, bool succeeded) {
  Write *write = context;
  if (write->cancelled) {
    // Settled already.
  } else if (succeeded) {
    lerta_promise_resolve(write->promise);
  } else {
    reject_with(write->promise, &cannot_write, write->address);
  }
  lerta_release(write->promise);
  lerta_release(write->bytes);
  lerta_release(write->address);
  free(write);
}

static void cancel_write(void *context) {
  Write *write = context;
  write->cancelled = true;
  lerta_promise_reject_cancelled(write->promise);
}

LertaPromise *lerta_tcp_write(int64_t handle, const LertaString *bytes) {
  Net *socket = net_of(handle);
  LertaPromise *promise = lerta_promise_new(LERTA_PLAIN_ITEMS);
  if (socket->tcp == NULL) {
    reject_with(promise, &cannot_write, socket->address);
    return promise;
  }
  Write *write = lerta_checked_malloc(sizeof(Write));
  *write = (Write){promise, (LertaString *)bytes, socket->address, false};
  lerta_retain(promise);
  lerta_retain((void *)bytes);
  lerta_retain(socket->address);
  lerta_promise_on_cancel(promise, cancel_write, write);
  lerta_loop_tcp_write(socket->tcp, bytes->bytes, bytes->length, end_write, write);
  return promise;
}

void lerta_tcp_end(int64_t handle) {
  Net *socket = net_of(handle);
  if (socket->tcp != NULL) lerta_loop_tcp_shutdown(socket->tcp);
}
