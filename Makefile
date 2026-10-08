# Builds the compiler from the seed, the compiler's own LLVM IR, and checks and tests it. See
# README.md for the targets and docs/internals.md#bootstrap for the bootstrap. Written for GNU make
# 3.81, the one macOS has.

SOURCES := $(shell find compiler -name '*.lerta') $(wildcard std/*.lerta)
# The runtime and its flags as clang_args in compiler/build.lerta gives them, which test/runtime.ts
# checks.
RUNTIME_C := $(wildcard runtime/*.c)
RUNTIME := $(RUNTIME_C) $(wildcard runtime/*.h)
BUILD_COMPILER := build compiler/main.lerta --root .

ifdef TARGET
TARGET_FLAGS := --target $(TARGET)
EXE := $(if $(filter %-w64-mingw32,$(TARGET)),.exe)
COMPILER := bin/lerta-$(TARGET)$(EXE)
else
COMPILER := bin/lerta
endif
BOOTSTRAP := build/bootstrap$(if $(TARGET),-$(TARGET))

all: $(COMPILER)

build/seed.ll: seed/lerta.ll
	@mkdir -p build
	cp seed/lerta.ll $@

# Linked with the debug runtime, as the compiler's own unoptimized build does: clang compiles the
# IR far faster without optimization than stage1 loses running unoptimized, and stage1 runs once.
build/stage1: build/seed.ll $(RUNTIME)
	clang -Wno-override-module build/seed.ll -D LERTA_DEBUG $(RUNTIME_C) -o $@

# --emit-llvm puts the IR in build/; the compiler would otherwise leave it beside the executable.
bin/lerta: build/stage1 $(SOURCES) $(RUNTIME)
	@mkdir -p bin
	build/stage1 $(BUILD_COMPILER) -o $@ -O --emit-llvm build/lerta.ll

ifdef TARGET
$(COMPILER): bin/lerta
	bin/lerta $(BUILD_COMPILER) -o $@ -O --emit-llvm build/lerta-$(TARGET).ll $(TARGET_FLAGS)
endif

# stage2 is unoptimized, so that its run, which builds stage3, checks for leaks.
$(BOOTSTRAP)/stage2: bin/lerta
	@mkdir -p $(BOOTSTRAP)
	bin/lerta $(BUILD_COMPILER) -o $@ --emit-llvm $@.ll $(TARGET_FLAGS)

$(BOOTSTRAP)/stage3: $(BOOTSTRAP)/stage2
	$(BOOTSTRAP)/stage2 $(BUILD_COMPILER) -o $@ --emit-llvm $@.ll $(TARGET_FLAGS)

# Only the IR is compared (see docs/internals.md#bootstrap).
ifneq ($(EXE),)
# Its stages would be Windows programs, which need Wine to run and a clang for Windows to build
# the next stage.
check-bootstrap:
	@echo 'check-bootstrap does not support Windows targets yet' >&2; exit 2
else
check-bootstrap: $(BOOTSTRAP)/stage3
	@cmp -s $(BOOTSTRAP)/stage2.ll $(BOOTSTRAP)/stage3.ll \
	  || { echo 'bootstrap: stage2 and stage3 write different IR' >&2; exit 1; }
	@echo 'bootstrap: stage2 and stage3 write the same IR'
endif

# Written only from IR that check-bootstrap has found to be a fixed point.
# The seed is written from the host's bootstrap only, so that a target given by mistake cannot
# change it.
ifdef TARGET
seed:
	@echo 'make seed does not take TARGET' >&2; exit 2
else
seed: check-bootstrap
	cp $(BOOTSTRAP)/stage2.ll seed/lerta.ll
endif

# The tests run on the host only: tools/test_in_docker.sh runs them for other targets.
ifdef TARGET
test:
	@echo 'make test does not take TARGET: run node test/run.ts --target <triple>' >&2; exit 2
else
# Every suite runs even if one before it fails.
test: bin/lerta
	@status=0; \
	nice node test/run.ts || status=1; \
	nice node test/cli.ts || status=1; \
	nice node test/runtime.ts || status=1; \
	nice $(MAKE) --no-print-directory check-bootstrap || status=1; \
	exit $$status
endif

clean:
	rm -rf build bin

.PHONY: all check-bootstrap seed test clean
