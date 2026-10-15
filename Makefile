# Codify — agent-native code graph + version control, pure C11.
# Targets: all (default), test, unit, integration, install, uninstall, clean

CC       ?= cc
CFLAGS   ?= -O2
CFLAGS   += -std=gnu11 -Wall -Wextra -pthread
CFLAGS   += -Ivendor/tree-sitter/lib/include -Ivendor/tree-sitter/lib/src
LDLIBS    = -lsqlite3 -lpthread -lm
PREFIX   ?= /usr/local
BUILD     = build

BIN       = cg
SRCS      = $(wildcard src/*.c)
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
	$(CC) $(CFLAGS) -c -o $@ $<

$(BUILD)/vendor/tree-sitter-lib.o: vendor/tree-sitter/lib/src/lib.c | $(BUILD)
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -Wno-unused-parameter -c -o $@ $<

$(BUILD)/vendor/%.o: vendor/%.c | $(BUILD)
	@mkdir -p $(dir $@)
	$(CC) -I$(dir $<) $(CFLAGS) -Wno-unused-parameter -Wno-unused-function \
		-Wno-unused-value -Wno-unused-const-variable -Wno-implicit-fallthrough \
		-Wno-missing-field-initializers -c -o $@ $<

$(LIB): $(filter-out $(BUILD)/main.o,$(OBJS))
	ar rcs $@ $^

$(BUILD)/test_%: tests/unit/test_%.c $(LIB)
	$(CC) $(CFLAGS) -Isrc -o $@ $< $(LIB) $(LDLIBS)

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
