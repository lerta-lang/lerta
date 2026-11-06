// The Objective-C side of twice.lerta, which test/cli/extern.lerta links with it and with Foundation.
#import <Foundation/Foundation.h>
#include <stdint.h>

int64_t twice(int64_t n) {
  @autoreleasepool {
    NSNumber *doubled = [NSNumber numberWithLongLong:2 * n];
    return doubled.longLongValue;
  }
}
