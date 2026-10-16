# Codify — agent-native code graph + version control, pure C11.
# Targets: all (default), test, unit, integration, install, uninstall, clean

CC       ?= cc
CFLAGS   ?= -O2
CFLAGS   += -std=gnu11 -Wall -Wextra -pthread
CFLAGS   += -Ivendor/tree-sitter/lib/include -Ivendor/tree-sitter/lib/src
LDLIBS    = -lsqlite3 -lpthread -lm -lcurl -lcrypto
PREFIX   ?= /usr/local
BUILD     = build

BIN       = cg
SRCS      = $(wildcard src/*.c) src/hyperfide/client.c src/hyperfide/transport.c
SRC_HEADERS = $(wildcard src/*.h)
OBJS      = $(patsubst src/%.c,$(BUILD)/%.o,$(SRCS))
TS_RUNTIME = $(BUILD)/vendor/tree-sitter-lib.o
# Family-owned grammar directories are discovered without a shared manifest
# edit. Generated parser and C scanner source must remain in the checkout.
PARSER_SRCS = $(shell test ! -d vendor/parsers || find vendor/parsers -type f \( -name parser.c -o -name scanner.c \))
PARSER_OBJS = $(patsubst vendor/%.c,$(BUILD)/vendor/%.o,$(PARSER_SRCS))
OBJS += $(TS_RUNTIME) $(PARSER_OBJS)
LIB       = $(BUILD)/libcg.a          # everything except main.o, for tests

UNIT_SRCS = $(wildcard tests/unit/test_*.c)
UNIT_BINS = $(patsubst tests/unit/%.c,$(BUILD)/%,$(UNIT_SRCS))

all: $(BIN)

$(BIN): $(OBJS)
	$(CC) $(CFLAGS) -o $@ $(OBJS) $(LDLIBS)

$(BUILD)/%.o: src/%.c $(SRC_HEADERS) | $(BUILD)
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -c -o $@ $<

$(BUILD)/vendor/tree-sitter-lib.o: vendor/tree-sitter/lib/src/lib.c | $(BUILD)
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -Wno-unused-parameter -c -o $@ $<

$(BUILD)/vendor/%.o: vendor/%.c | $(BUILD)
	@mkdir -p $(dir $@)
	$(CC) -I$(dir $<) $(CFLAGS) -Wno-unused-parameter -Wno-unused-function \
		-Wno-unused-value -Wno-unused-const-variable -Wno-implicit-fallthrough \
		-Wno-sign-compare \
		-Wno-unused-variable \
		-Wno-missing-field-initializers -c -o $@ $<

$(LIB): $(filter-out $(BUILD)/main.o,$(OBJS))
	ar rcs $@ $^

$(BUILD)/test_%: tests/unit/test_%.c $(LIB)
	$(CC) $(CFLAGS) -Isrc -o $@ $< $(filter-out $(BUILD)/main.o,$(OBJS)) $(LDLIBS)

$(BUILD):
	mkdir -p $(BUILD)

unit: $(UNIT_BINS)
	@fail=0; for t in $(UNIT_BINS); do ./$$t || fail=1; done; exit $$fail

integration: $(BIN)
	@CG=$(CURDIR)/$(BIN) tests/run.sh

test: unit integration

install: $(BIN)
	install -m 755 $(BIN) $(PREFIX)/bin/$(BIN)

uninstall:
	rm -f $(PREFIX)/bin/$(BIN)

clean:
	rm -rf $(BUILD) $(BIN)

.PHONY: all unit integration test install uninstall clean release

# static release binary published to the web root (see scripts/release.sh)
release:
	scripts/release.sh

# Hyperfide approved split runtime: explicit dependency setup and service builds.
# Build-time Python validates native fragments; native execution remains a C binary.
.PHONY: hyperfide-deps hyperfide-services hyperfide-check hyperfide-native
hyperfide-deps:
	npm --prefix services/hyperfide ci --ignore-scripts

hyperfide-services:
	npm --prefix services/hyperfide run build

hyperfide-check:
	npm --prefix services/hyperfide run check

# Always rediscover fragments, including removals. A failed validation/build
# removes the old executable so a normal build cannot expose stale dispatch.
hyperfide-native:
	@mkdir -p $(BUILD)
	@rm -f $(BUILD)/hyperfide-native $(BUILD)/hyperfide-native.tmp
	python3 scripts/hyperfide-native-components.py --generate $(BUILD)/hyperfide-native-registry.inc
	$(CC) $(CFLAGS) -Isrc/hyperfide -I$(BUILD) -o $(BUILD)/hyperfide-native.tmp src/hyperfide/component_main.c src/sha256.c $$(python3 scripts/hyperfide-native-components.py --sources) $(LDLIBS) $$(python3 scripts/hyperfide-native-components.py --libraries)
	mv $(BUILD)/hyperfide-native.tmp $(BUILD)/hyperfide-native
