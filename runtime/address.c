#include <string.h>

#include <uv.h>

#include "internal.h"

// The addresses of std:net's sockets, as the failures name them and getaddrinfo takes them.

LertaString *lerta_address_text(const char *host, int64_t port) {
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

char *lerta_port_text(int64_t port, uint8_t buffer[LERTA_INT_TEXT_MAX + 1]) {
  int64_t start = lerta_format_int(port, buffer);
  buffer[LERTA_INT_TEXT_MAX] = '\0';
  return (char *)buffer + start;
}

int64_t lerta_port_of(const struct sockaddr_storage *address) {
  if (address->ss_family == AF_INET6) return ntohs(((struct sockaddr_in6 *)address)->sin6_port);
  return ntohs(((struct sockaddr_in *)address)->sin_port);
}

bool lerta_host_of(const struct sockaddr_storage *address, char *host) {
  int status = address->ss_family == AF_INET6
                 ? uv_ip6_name((const struct sockaddr_in6 *)address, host, INET6_ADDRSTRLEN)
                 : uv_ip4_name((const struct sockaddr_in *)address, host, INET6_ADDRSTRLEN);
  return status == 0;
}
