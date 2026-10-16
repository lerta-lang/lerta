// The C side of sized.lerta, which test/cli.ts links with it: each type as C has it, so that a
// value comes and goes extended by its sign.
#include <stdint.h>

int8_t negate8(int8_t n) { return (int8_t)-n; }
int16_t half16(int16_t n) { return (int16_t)(n / 2); }
int32_t add32(int32_t a, int32_t b) { return a + b; }
uint16_t top16(void) { return 0xFFFF; }
uint32_t top32(void) { return 0xFFFFFFFFu; }
uint64_t top64(void) { return 0xFFFFFFFFFFFFFFFFu; }
int64_t widen8(int8_t n) { return n; }
int64_t widen_u16(uint16_t n) { return n; }
int64_t narrow16(int16_t n) { return n; }
uint64_t widen_u32(uint32_t n) { return n; }
