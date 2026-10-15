
#include <stdint.h>
#include <string.h>
#include <stdio.h>

/*
const char *RESERVED_NAMES[] = {
    "and", "break",    "do",   "else",  "elseif", "end", "false",
    "for", "function", "if",   "in",    "local",  "nil", "not",
    "or",  "repeat", "return",   "true", "then", "until", "while"};

First-last character encodings
  "ad" "bk" "do" "ee"
  "ef" "ed" "fe" "fr"
  "fn" "if" "in" "ll"
  "nl" "nt" "or" "rt"
  "rn" "te" "tn" "ul"
  "we" 
These are all unique, so a 16 bit index into the hash table is possible

For the following 32-bit PCG-based hasher with the given state,
on a size 32 hash table with indices given as "hash modulo 32":
Hash Entry 2 is 'true'
Hash Entry 3 is 'or'
Hash Entry 4 is 'not'
Hash Entry 6 is 'then'
Hash Entry 7 is 'break'
Hash Entry 8 is 'nil'
Hash Entry 9 is 'if'
Hash Entry 10 is 'else'
Hash Entry 12 is 'false'
Hash Entry 13 is 'return'
Hash Entry 14 is 'while'
Hash Entry 15 is 'in'
Hash Entry 20 is 'repeat'
Hash Entry 21 is 'elseif'
Hash Entry 24 is 'function'
Hash Entry 26 is 'end'
Hash Entry 27 is 'for'
Hash Entry 28 is 'until'
Hash Entry 29 is 'local'
Hash Entry 30 is 'do'
Hash Entry 31 is 'and'

*/

// pcg-xsh-rr 64-to-32-bit seeded prng

#define LUAUTS_HASHTABLE_SIZE 32

#define LUAUTS_MIN_KW_LEN 2
#define LUAUTS_MAX_KW_LEN 8

static const char *LUAUTS_HASHTABLE[LUAUTS_HASHTABLE_SIZE] = {NULL};

static uint64_t const luauts_pcg_state = 0x207a194e06944755;
static uint64_t const luauts_pcg_multiplier = 6364136223846793005u;
static uint64_t const luauts_pcg_increment = 1442695040888963407u;

#define BIT32_RROTATE(x, r) (x >> r | x << (-r & 31))

static uint32_t luauts_pcg32_hash(uint64_t x) {
  x ^= luauts_pcg_state;
  x = x * luauts_pcg_multiplier + luauts_pcg_increment;
  unsigned count = (unsigned)(x >> 59);

  x ^= x >> 18;
  return BIT32_RROTATE((uint32_t)(x >> 27), count);
}

inline static uint32_t luauts_hash_to_index(uint32_t hash) {
  return hash & (LUAUTS_HASHTABLE_SIZE - 1);
}

static uint16_t luauts_keyword_to_word16(const char *kw, const size_t kwlen) {
  return (kw[0] << 8) | kw[kwlen-1];
}

enum LuauTSKeyword {
  LuauNotAKeyword,
  LuauTrue,
  LuauOr,
  LuauNot,
  LuauThen,
  LuauBreak,
  LuauNil,
  LuauIf,
  LuauElse,
  LuauFalse,
  LuauReturn,
  LuauWhile,
  LuauIn,
  LuauRepeat,
  LuauElseif,
  LuauFunction,
  LuauEnd,
  LuauFor,
  LuauUntil,
  LuauLocal,
  LuauDo,
  LuauAnd
};

static enum LuauTSKeyword luauts_keyword_compare(enum LuauTSKeyword kwtoken,
                                                 const char *probe,
                                                 const size_t kwlen,
                                                 const char *kw) {
  if (*probe == *kw && !strncmp(kw+1, probe+1, kwlen-1) && probe[kwlen]=='\0') {
    return kwtoken;
  }
  return LuauNotAKeyword;
}

#define LUAUTS_KWCMP_CASE(kwindex, kwtoken, probe, kwlen, kw)                  \
  case kwindex: {                                                              \
    if (probe_size == kwlen) { \
      luau_keyword = luauts_keyword_compare(kwtoken, probe, kwlen, kw);          \
      break; \
    } \
  }

enum LuauTSKeyword luauts_keyword_test(const char *probe, const size_t probe_size) {
  // size_t probe_size = strnlen(probe, LUAUTS_MAX_KW_LEN + 1);
  // printf("aaaaaa %zu\n", probe_size);
  if (probe_size > LUAUTS_MAX_KW_LEN || probe_size < LUAUTS_MIN_KW_LEN) {
    return LuauNotAKeyword;
  }

  uint16_t probe_w16 = luauts_keyword_to_word16(probe, probe_size);
  uint32_t probe_hash = luauts_pcg32_hash((uint64_t)probe_w16);
  uint32_t probe_index = luauts_hash_to_index(probe_hash);

  enum LuauTSKeyword luau_keyword;

  // printf("> probe: %s; hash: %x; index: %d; size: %zu\n", probe, probe_hash, probe_index, probe_size);

  switch (probe_index) {
  LUAUTS_KWCMP_CASE(2, LuauTrue, probe, 4, "true")
  LUAUTS_KWCMP_CASE(3, LuauOr, probe, 2, "or")
  LUAUTS_KWCMP_CASE(4, LuauNot, probe, 3, "not")
  LUAUTS_KWCMP_CASE(6, LuauThen, probe, 4, "then")
  LUAUTS_KWCMP_CASE(7, LuauBreak, probe, 5, "break")
  LUAUTS_KWCMP_CASE(8, LuauNil, probe, 3, "nil")
  LUAUTS_KWCMP_CASE(9, LuauIf, probe, 2, "if")
  LUAUTS_KWCMP_CASE(10, LuauElse, probe, 4, "else")
  LUAUTS_KWCMP_CASE(12, LuauFalse, probe, 5, "false")
  LUAUTS_KWCMP_CASE(13, LuauReturn, probe, 6, "return");
  LUAUTS_KWCMP_CASE(14, LuauWhile, probe, 5, "while")
  LUAUTS_KWCMP_CASE(15, LuauIn, probe, 2, "in")
  LUAUTS_KWCMP_CASE(20, LuauRepeat, probe, 6, "repeat")
  LUAUTS_KWCMP_CASE(21, LuauElseif, probe, 6, "elseif")
  LUAUTS_KWCMP_CASE(24, LuauFunction, probe, 8, "function")
  LUAUTS_KWCMP_CASE(26, LuauEnd, probe, 3, "end")
  LUAUTS_KWCMP_CASE(27, LuauFor, probe, 3, "for")
  LUAUTS_KWCMP_CASE(28, LuauUntil, probe, 5, "until")
  LUAUTS_KWCMP_CASE(29, LuauLocal, probe, 5, "local")
  LUAUTS_KWCMP_CASE(30, LuauDo, probe, 2, "do")
  LUAUTS_KWCMP_CASE(31, LuauAnd, probe, 3, "and")
  default: {
    luau_keyword = LuauNotAKeyword;
  }
  }

  return luau_keyword;
}
