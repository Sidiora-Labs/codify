#include "tree_sitter/alloc.h"
#include "tree_sitter/parser.h"
#include <stdarg.h>
#include <stdint.h>
#include <wctype.h>

#include "luauts_pcg_hash_table.h"

#define IS_LINE_CUT(lexer) (lexer->eof(lexer) || lexer->lookahead == '\n')
#define IS_LINE_NOT_CUT(lexer) (!lexer->eof(lexer) && lexer->lookahead != '\n')

// #define LUAUTS_DEBUG

enum TokenType {
  KEYWORD_TRUE,
  KEYWORD_OR,
  KEYWORD_NOT,
  KEYWORD_THEN,
  KEYWORD_BREAK,
  KEYWORD_NIL,
  KEYWORD_IF,
  KEYWORD_ELSE,
  KEYWORD_FALSE,
  KEYWORD_RETURN,
  KEYWORD_WHILE,
  KEYWORD_IN,
  KEYWORD_REPEAT,
  KEYWORD_ELSEIF,
  KEYWORD_FUNCTION,
  KEYWORD_END,
  KEYWORD_FOR,
  KEYWORD_UNTIL,
  KEYWORD_LOCAL,
  KEYWORD_DO,
  KEYWORD_AND,
  COMMENT_START,
  COMMENT_CONTENT,
  COMMENT_END,
  STRING_START,
  STRING_CONTENT,
  STRING_END,
  INTERP_START,
  INTERP_CONTENT,
  INTERP_BRACE_OPEN,
  INTERP_BRACE_CLOSE,
  INTERP_END,
  SIMPLE_ESCAPE_SEQUENCE,
  UNICODE_ESCAPE_SEQUENCE,
  DEC_BYTE_ESCAPE_SEQUENCE,
  HEX_BYTE_ESCAPE_SEQUENCE,
};

static void consume(TSLexer *lexer) { lexer->advance(lexer, false); }
static void skip(TSLexer *lexer) { lexer->advance(lexer, true); }
static bool consume_if(TSLexer *lexer, const int32_t character) {
  if (lexer->lookahead == character) {
    consume(lexer);
    return true;
  }

  return false;
}
static bool skipwspace(TSLexer *lexer) {
  if (iswspace(lexer->lookahead) || lexer->lookahead == '\r') {
    skip(lexer);
    return true;
  }
  return false;
}
static bool skip_if(TSLexer *lexer, const int32_t character) {
  if (lexer->lookahead == character) {
    skip(lexer);
    return true;
  }
  return false;
}

const char SQ_STRING_DELIMITER = '\'';
const char DQ_STRING_DELIMITER = '"';
const char TICK_DELIMITER = '`';
const char OPEN_INTERP_EXP = '{';
const char CLOSE_INTERP_EXP = '}';

enum StartedToken {
  // NAME_BOUNDARY = 1,
  SHORT_COMMENT = 1,
  SHORT_SQ_STRING,
  SHORT_DQ_STRING,
  LONG_COMMENT,
  LONG_STRING,
  TICK_STRING,
  INTERP_EXPRESSION,
  ESCAPE_BACKSLASH,
};

struct ScannerState {
  enum StartedToken started;
  enum StartedToken stashed;
  unsigned int depth;
  unsigned int idepth;
  bool implicit_escape;
};
#define TSLUAU_STATE_SERIALIZED_LENGTH 7

#define RELEASE_STATE_GENERIC(state)                                           \
  state->started = state->idepth > 0 ? INTERP_EXPRESSION : 0

#define PRINT_SCANNER_STATE(state)                                             \
  printf("started: %d; depth: %d; idepth: %d\n", state->started, state->depth, \
         state->idepth);

// #define TSLUAU_DEBUG
#ifdef TSLUAU_DEBUG

#define TSLUAU_DEBUG_PRINTF(...) fprintf(stderr, __VA_ARGS__)

#define KEYWORD_PRINT_ENABLE(kwname)                                           \
  if (valid_symbols[kwname]) {                                                 \
    list[listn++] = #kwname;                                                   \
  }

static void print_all_valid_keywords(const bool *valid_symbols) {
  char *list[21] = {NULL};
  uint32_t listn = 0;
  KEYWORD_PRINT_ENABLE(KEYWORD_TRUE);
  KEYWORD_PRINT_ENABLE(KEYWORD_OR);
  KEYWORD_PRINT_ENABLE(KEYWORD_NOT);
  KEYWORD_PRINT_ENABLE(KEYWORD_THEN);
  KEYWORD_PRINT_ENABLE(KEYWORD_BREAK);
  KEYWORD_PRINT_ENABLE(KEYWORD_NIL);
  KEYWORD_PRINT_ENABLE(KEYWORD_IF);
  KEYWORD_PRINT_ENABLE(KEYWORD_ELSE);
  KEYWORD_PRINT_ENABLE(KEYWORD_FALSE);
  KEYWORD_PRINT_ENABLE(KEYWORD_RETURN);
  KEYWORD_PRINT_ENABLE(KEYWORD_WHILE);
  KEYWORD_PRINT_ENABLE(KEYWORD_IN);
  KEYWORD_PRINT_ENABLE(KEYWORD_REPEAT);
  KEYWORD_PRINT_ENABLE(KEYWORD_ELSEIF);
  KEYWORD_PRINT_ENABLE(KEYWORD_FUNCTION);
  KEYWORD_PRINT_ENABLE(KEYWORD_END);
  KEYWORD_PRINT_ENABLE(KEYWORD_FOR);
  KEYWORD_PRINT_ENABLE(KEYWORD_UNTIL);
  KEYWORD_PRINT_ENABLE(KEYWORD_LOCAL);
  KEYWORD_PRINT_ENABLE(KEYWORD_DO);
  KEYWORD_PRINT_ENABLE(KEYWORD_AND);
  for (int i = 0; i < listn; i++) {
    printf("%s ", list[i]);
  }
  printf("\n");
}
const char *scanner_started_name[] = {
    "short comment",
    "short single-quoted string",
    "short double-quoted string",
    "long comment",
    "long string",
    "tick string",
    "interp expression",
    "escape backslash",
};
void print_scanner_state(struct ScannerState *state) {
  printf("--- begin state\n");
  printf("mode: %s\n", scanner_started_name[state->started - 1]);
  printf("stashed mode: %s\n", scanner_started_name[state->stashed - 1]);
  printf("interp depth: %d\n", state->idepth);
  printf("comment depth: %d\n", state->depth);
  printf("implicit escape: %s\n", state->implicit_escape ? "yes" : "no");
  printf("--- end state\n");
}
#else
#define TSLUAU_DEBUG_PRINTF(...)
#endif

void *tree_sitter_luau_external_scanner_create() {
  // this used to be allocated without instantiation
  struct ScannerState *state = ts_malloc(sizeof(struct ScannerState));

  state->started = 0;
  state->stashed = 0;
  state->depth = 0;
  state->idepth = 0;
  state->implicit_escape = true;

  return state;
}

void tree_sitter_luau_external_scanner_destroy(void *payload) {
  struct ScannerState *state = payload;
  ts_free(state);
}

unsigned int tree_sitter_luau_external_scanner_serialize(void *payload,
                                                         char *buffer) {
  // printf("serializing...\n");
  struct ScannerState *state = payload;

  buffer[0] = state->started;
  buffer[1] = state->stashed;
  buffer[2] = (unsigned char)(state->depth >> 8);
  buffer[3] = (unsigned char)(state->depth);
  buffer[4] = (unsigned char)(state->idepth >> 8);
  buffer[5] = (unsigned char)(state->idepth);
  // implicit escape vanishes on serialization
  buffer[6] = false;

  return TSLUAU_STATE_SERIALIZED_LENGTH;
}

void tree_sitter_luau_external_scanner_deserialize(void *payload,
                                                   const char *buffer,
                                                   unsigned int length) {
  if (length == TSLUAU_STATE_SERIALIZED_LENGTH) {
    // printf("deserializing...\n");
    struct ScannerState *state = payload;

    state->started = buffer[0];
    state->stashed = buffer[1];
    state->depth = (buffer[2] << 8) | buffer[3];
    state->idepth = (buffer[4] << 8) | buffer[5];
    state->implicit_escape = buffer[6];
  }
}

static unsigned int get_depth(TSLexer *lexer) {
  unsigned int current_depth = 0;
  while (consume_if(lexer, '=')) {
    current_depth += 1;
  }

  return current_depth;
}

static bool scan_depth(TSLexer *lexer, unsigned int remaining_depth) {
  while (remaining_depth > 0 && consume_if(lexer, '=')) {
    remaining_depth -= 1;
  }

  return remaining_depth == 0;
}

/*
  The following constant escape sequences are special in the Lua specs:
  - \a is bell, char 0x7
  - \b is backspace, char 0x8
  - \f is form feed, char 0xC
  - \n is newline, char 0xA
  - \r is carriage return, char 0xD
  - \t is horizontal tab, char 0x9
  - \v is vertical tab, 0xB
  - \\ is backslash, char 0x5C
  - \" is double quote, char 0x22
  - \' is single quote, char 0x27
  The following parameterized escape sequences are special in the Luau specs:
  - \u{ABCDEFGHIJKLMNO} is the unicode sequence where any capital letter stands
    for a hex digit
  - \ABC is the decimal-encoded binary sequence where any capital letter stands
    for a decimal digit
  - \xAB is the hex-encoded binary sequence where any capital letter stands for
    a hex digit
  The following escape sequence is a control sequence that continues a line on
  the next line, annihilating the line break in the process:
    A \<linebreak> B
    where capital letters stand for a series of Luau tokens that make up a
    statement or series of statements that would be valid on one line.
  The following escape sequence is a control sequence that continues a line at
  the first non-whitespace match, annihilating all whitespace in the process:
    A \z B C
    where the letters A and C stand for a series of Luau tokens that make up a
    statement or series of statements that would be valid on one line, and B
    stands for any kind and amount of whitespace/line breaks.
  Any undocumented escape sequence assumes default behavior, which is that the
  backslash is annihilated. Control-type escapes are not tokenized.
*/
static bool process_escape(struct ScannerState *state, TSLexer *lexer,
                           const bool *valid_symbols) {
  if (lexer->eof(lexer))
    return false;
  bool escaped = false;
  if (state->implicit_escape) {
    TSLUAU_DEBUG_PRINTF("escp> implicit escape\n");
    state->implicit_escape = false;
    escaped = true;
  } else if (lexer->lookahead == '\\') {
    TSLUAU_DEBUG_PRINTF("escp> backslashed escape\n");
    lexer->advance(lexer, false);
    escaped = true;
  } else {
    TSLUAU_DEBUG_PRINTF("escp> failed to detect the escape mode\n");
  }

  TSLUAU_DEBUG_PRINTF("escp> valid \\u{abc}.\\000.\\x00.\\n: "
                      "%d%d%d%d\n",
                      valid_symbols[UNICODE_ESCAPE_SEQUENCE],
                      valid_symbols[DEC_BYTE_ESCAPE_SEQUENCE],
                      valid_symbols[HEX_BYTE_ESCAPE_SEQUENCE],
                      valid_symbols[SIMPLE_ESCAPE_SEQUENCE]);

  if (!lexer->eof(lexer) && escaped) {
    if (!lexer->eof(lexer)) {
      uint32_t esc_mode = lexer->lookahead;
      TSLUAU_DEBUG_PRINTF("escp> %d\n", esc_mode);
      switch (esc_mode) {
      case 'u': {
        if (!valid_symbols[UNICODE_ESCAPE_SEQUENCE]) {
          return false;
        }
        TSLUAU_DEBUG_PRINTF("escp> unicode return\n");
        lexer->result_symbol = UNICODE_ESCAPE_SEQUENCE;
        lexer->advance(lexer, false);
        break;
      }
      case '0':
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7':
      case '8':
      case '9': {
        if (!valid_symbols[DEC_BYTE_ESCAPE_SEQUENCE]) {
          return false;
        }
        TSLUAU_DEBUG_PRINTF("escp> decimal byte return\n");
        lexer->result_symbol = DEC_BYTE_ESCAPE_SEQUENCE;
        break;
      }
      case 'x': {
        if (!valid_symbols[HEX_BYTE_ESCAPE_SEQUENCE]) {
          return false;
        }
        TSLUAU_DEBUG_PRINTF("escp> hex byte return\n");
        lexer->result_symbol = HEX_BYTE_ESCAPE_SEQUENCE;
        lexer->advance(lexer, false);
        break;
      }
      case '\r':
      case '\n':
      case 'z': {
        // printf("This should never print\n");
        return false;
      }
      default: {
        if (!valid_symbols[SIMPLE_ESCAPE_SEQUENCE]) {
          return false;
        }
        TSLUAU_DEBUG_PRINTF("escp> standard return\n");
        lexer->result_symbol = SIMPLE_ESCAPE_SEQUENCE;
        lexer->advance(lexer, false);
      }
      }

      lexer->mark_end(lexer);
      state->started = state->stashed;
      state->stashed = 0;

      return true;
    }
  }

  TSLUAU_DEBUG_PRINTF("escp> bad return\n");

  return false;
}

static bool escape_handler(struct ScannerState *state, TSLexer *lexer,
                           const bool *valid_symbols, const bool is_start) {
  // NOTE: skipping moves the beginning of the lexer match
  TSLUAU_DEBUG_PRINTF("esch> is_start: %s\n", is_start ? "yes" : "no");
  do {
    lexer->advance(lexer, false);
    if (lexer->eof(lexer)) {
      return false;
    }
    switch (lexer->lookahead) {
    case '\r': {
      TSLUAU_DEBUG_PRINTF("esch> found \\r\n");
      lexer->advance(lexer, is_start);
      if (lexer->eof(lexer))
        return false;
    }
    case '\n': {
      TSLUAU_DEBUG_PRINTF("esch> found \\n\n");
      lexer->advance(lexer, is_start);
      lexer->mark_end(lexer);
      break;
    }
    case 'z': {
      TSLUAU_DEBUG_PRINTF("esch> found z\n");
      lexer->advance(lexer, is_start);
      while (!lexer->eof(lexer) && iswspace(lexer->lookahead)) {
        lexer->advance(lexer, is_start);
      }
      lexer->mark_end(lexer);
      break;
    }
    default: {
      TSLUAU_DEBUG_PRINTF("esch> found escape, pass to escp\n");
      state->stashed = state->started;
      state->started = ESCAPE_BACKSLASH;
      return true;
    }
    }
  } while (lexer->lookahead == '\\');
  TSLUAU_DEBUG_PRINTF("esch> no pass\n");
  return false;
}

static bool is_invalid_luau_name_character(int32_t c) {
  return ((c < 65) || ((c > 90) && (c < 97)) || (c > 122)) && (c != 95);
}

#define INITIAL_NAME_CAPACITY 256

// a keyword is never a variable name - assert it even when it's not valid
#define KW2TS_TOKENMAP_CASE(kwtoken1, tstoken1)                                \
  case kwtoken1: {                                                             \
    lexer->mark_end(lexer);                                                    \
    lexer->result_symbol = tstoken1;                                           \
    good = true;                                                               \
    break;                                                                     \
  }

static bool process_name(struct ScannerState *state, TSLexer *lexer,
                         const bool *valid_symbols) {
  size_t name_capacity = INITIAL_NAME_CAPACITY;
  size_t name_size = 0;
  char *name = ts_calloc(name_capacity, sizeof(char));

  lexer->mark_end(lexer);
  while (!lexer->eof(lexer) &&
         !is_invalid_luau_name_character(lexer->lookahead)) {
    if (name_size + 1 == name_capacity) {
      name_capacity = name_capacity << 1;
      char *grown = ts_realloc(name, name_capacity * sizeof(char));
      if (!grown) {
        ts_free(name);
        return false;
      }
      name = grown;
      memset(name + name_size, 0, name_size * sizeof(char));
    }
    name[name_size++] = (char)lexer->lookahead;
    // printf("size: %zu; capacity: %zu; char: %d\n", name_size,
    // name_capacity,
    //        lexer->lookahead);
    consume(lexer);
  }

  name[name_size] = '\0';

  enum LuauTSKeyword kwtoken = luauts_keyword_test(name, name_size);

  // printf("idepth: %d; kwtoken: %d\n", state->idepth, kwtoken);

  ts_free(name);
  RELEASE_STATE_GENERIC(state);

  if (kwtoken != LuauNotAKeyword) {
    bool good = false;
    switch (kwtoken) {
      KW2TS_TOKENMAP_CASE(LuauTrue, KEYWORD_TRUE)
      KW2TS_TOKENMAP_CASE(LuauOr, KEYWORD_OR)
      KW2TS_TOKENMAP_CASE(LuauNot, KEYWORD_NOT)
      KW2TS_TOKENMAP_CASE(LuauThen, KEYWORD_THEN)
      KW2TS_TOKENMAP_CASE(LuauBreak, KEYWORD_BREAK)
      KW2TS_TOKENMAP_CASE(LuauNil, KEYWORD_NIL)
      KW2TS_TOKENMAP_CASE(LuauIf, KEYWORD_IF)
      KW2TS_TOKENMAP_CASE(LuauElse, KEYWORD_ELSE)
      KW2TS_TOKENMAP_CASE(LuauFalse, KEYWORD_FALSE)
      KW2TS_TOKENMAP_CASE(LuauReturn, KEYWORD_RETURN)
      KW2TS_TOKENMAP_CASE(LuauWhile, KEYWORD_WHILE)
      KW2TS_TOKENMAP_CASE(LuauIn, KEYWORD_IN)
      KW2TS_TOKENMAP_CASE(LuauRepeat, KEYWORD_REPEAT)
      KW2TS_TOKENMAP_CASE(LuauElseif, KEYWORD_ELSEIF)
      KW2TS_TOKENMAP_CASE(LuauFunction, KEYWORD_FUNCTION)
      KW2TS_TOKENMAP_CASE(LuauEnd, KEYWORD_END)
      KW2TS_TOKENMAP_CASE(LuauFor, KEYWORD_FOR)
      KW2TS_TOKENMAP_CASE(LuauUntil, KEYWORD_UNTIL)
      KW2TS_TOKENMAP_CASE(LuauLocal, KEYWORD_LOCAL)
      KW2TS_TOKENMAP_CASE(LuauDo, KEYWORD_DO)
      KW2TS_TOKENMAP_CASE(LuauAnd, KEYWORD_AND)
    default: {
    }
    }
    return good;
  }

  return false;
}

static bool process_comment(struct ScannerState *state, TSLexer *lexer,
                            const bool *valid_symbols) {
  if (IS_LINE_CUT(lexer)) {
    if (valid_symbols[COMMENT_END]) {
      // try to match the short comment's end (new line or eof)
      RELEASE_STATE_GENERIC(state);

      lexer->result_symbol = COMMENT_END;
      return true;
    }
  } else if (valid_symbols[COMMENT_CONTENT]) {
    // consume all characters till a short comment's end
    do {
      consume(lexer);
    } while (IS_LINE_NOT_CUT(lexer));

    lexer->result_symbol = COMMENT_CONTENT;

    return true;
  }

  return false;
}

#define STOP_ON_ESCAPE_SEQUENCE(state, lexer, valid_symbols, is_start)         \
  if (lexer->lookahead == '\\') {                                              \
    lexer->mark_end(lexer);                                                    \
    if (escape_handler(state, lexer, valid_symbols, is_start)) {               \
      ESCSEQ_STOPPER;                                                          \
    }                                                                          \
  }

static bool process_string(struct ScannerState *state, TSLexer *lexer,
                           const bool *valid_symbols, const char delimiter) {
#define ESCSEQ_STOPPER                                                         \
  state->implicit_escape = true;                                               \
  return false
  STOP_ON_ESCAPE_SEQUENCE(state, lexer, valid_symbols, true);
#undef ESCSEQ_STOPPER

  // try to match the short string's end (" or ')
  if (consume_if(lexer, delimiter) && valid_symbols[STRING_END]) {
    RELEASE_STATE_GENERIC(state);

    lexer->result_symbol = STRING_END;
    return true;
  } else if (IS_LINE_NOT_CUT(lexer) && valid_symbols[STRING_CONTENT]) {
    // consume any character till a short string's end
    // invoke escape handler for all backslash and z escapes
    do {
#define ESCSEQ_STOPPER break
      STOP_ON_ESCAPE_SEQUENCE(state, lexer, valid_symbols, false);
#undef ESCSEQ_STOPPER

      consume(lexer);
    } while (IS_LINE_NOT_CUT(lexer) && lexer->lookahead != delimiter);

    lexer->result_symbol = STRING_CONTENT;
    return true;
  }

  return false;
}

static bool process_tstring(struct ScannerState *state, TSLexer *lexer,
                            const bool *valid_symbols, const char delimiter) {
  const bool is_delim = lexer->lookahead == '`';
  const bool is_brace_open = lexer->lookahead == '{';
#define ESCSEQ_STOPPER                                                         \
  state->implicit_escape = true;                                               \
  return false
  STOP_ON_ESCAPE_SEQUENCE(state, lexer, valid_symbols, true);
#undef ESCSEQ_STOPPER
  TSLUAU_DEBUG_PRINTF("tstr> %d\n", lexer->lookahead);
  if (valid_symbols[INTERP_END] && is_delim && consume_if(lexer, delimiter)) {
    RELEASE_STATE_GENERIC(state);

    lexer->result_symbol = INTERP_END;
    return true;
  } else if (valid_symbols[INTERP_BRACE_OPEN] && is_brace_open &&
             consume_if(lexer, '{')) {
    state->idepth++;
    state->started = INTERP_EXPRESSION;
    lexer->result_symbol = INTERP_BRACE_OPEN;
    return true;
  } else if (IS_LINE_NOT_CUT(lexer) && valid_symbols[INTERP_CONTENT]) {
    if (!is_delim && !is_brace_open) {
      do {
        if (lexer->lookahead == '{') {
          break;
        } else {
#define ESCSEQ_STOPPER break
          STOP_ON_ESCAPE_SEQUENCE(state, lexer, valid_symbols, false);
#undef ESCSEQ_STOPPER
        }

        consume(lexer);
        TSLUAU_DEBUG_PRINTF("tstr>> %d\n", lexer->lookahead);
      } while (IS_LINE_NOT_CUT(lexer) && lexer->lookahead != delimiter);
    }

    lexer->result_symbol = INTERP_CONTENT;
    return true;
  }

  return false;
}

static bool process_mline(struct ScannerState *state, TSLexer *lexer,
                          const bool *valid_symbols, const bool comment) {
  bool consumed = false;

  if (comment ? valid_symbols[COMMENT_END] : valid_symbols[STRING_END]) {
    // try to match the long comment's/string's end (]=*])
    if (consume_if(lexer, ']')) {
      if (scan_depth(lexer, state->depth) && consume_if(lexer, ']')) {
        RELEASE_STATE_GENERIC(state);
        state->depth = 0;

        lexer->result_symbol = comment ? COMMENT_END : STRING_END;
        return true;
      }

      consumed = true;
    }
  }

  if (comment ? valid_symbols[COMMENT_CONTENT]
              : valid_symbols[STRING_CONTENT]) {
    if (!consumed) {
      if (lexer->eof(lexer)) {
        return false;
      }

      // consume the next character as it can't start a long
      // comment's/string's end ([)
      consume(lexer);
    }

    // consume any character till a long comment's/string's end or eof
    while (true) {
      lexer->mark_end(lexer);

      if (consume_if(lexer, ']')) {
        if (scan_depth(lexer, state->depth)) {
          if (consume_if(lexer, ']')) {
            break;
          }
        } else {
          continue;
        }
      }

      if (lexer->eof(lexer)) {
        break;
      }

      consume(lexer);
    }

    lexer->result_symbol = comment ? COMMENT_CONTENT : STRING_CONTENT;
    return true;
  }

  return false;
}

bool truthy_println(const char *str) {
  printf("%s\n", str);
  return true;
}

bool tree_sitter_luau_external_scanner_scan(void *payload, TSLexer *lexer,
                                            const bool *valid_symbols) {
  struct ScannerState *state = payload;

  switch (state->started) {
  case ESCAPE_BACKSLASH: {
    if (process_escape(state, lexer, valid_symbols)) {
      // state->started = state->stashed;
      // state->stashed = 0;
      return true;
    }

    break;
  }
  case SHORT_COMMENT: {
    if (process_comment(state, lexer, valid_symbols))
      return true;

    break;
  }
  case TICK_STRING:
  case SHORT_DQ_STRING:
  case SHORT_SQ_STRING: {
    char delimiter = TICK_DELIMITER;
    // setting this to &process_tstring as a default rather than using an else
    // statement produces strange behavior. in the file picker of helix, however
    // the scanner is executed there, it effectively seems to speculatively
    // execute the branch (state->started != TICK_STRING), but the function
    // pointer is changed from process_tstring to process_string without any
    // rollback. i haven't investigated the details, but it caused an error on
    // tick strings in the file previewer.
    static bool (*string_processor)(struct ScannerState *, struct TSLexer *,
                                    const bool *, const char);

    if (state->started != TICK_STRING) {
      delimiter = state->started == SHORT_DQ_STRING ? DQ_STRING_DELIMITER
                                                    : SQ_STRING_DELIMITER;
      string_processor = &process_string;
    } else {
      string_processor = &process_tstring;
    }

    if ((*string_processor)(state, lexer, valid_symbols, delimiter) ||
        (state->started == ESCAPE_BACKSLASH &&
         process_escape(state, lexer, valid_symbols)))
      return true;

    break;
  }
  case LONG_COMMENT:
  case LONG_STRING: {
    const bool is_inside_a_comment = state->started == LONG_COMMENT;

    if (process_mline(state, lexer, valid_symbols, is_inside_a_comment))
      return true;

    break;
  }
  case INTERP_EXPRESSION: {
    while (skipwspace(lexer))
      ;

    if (valid_symbols[INTERP_BRACE_CLOSE]) {
      if (consume_if(lexer, '}')) {
        state->idepth--;
        state->started = TICK_STRING;
        lexer->result_symbol = INTERP_BRACE_CLOSE;
        return true;
      }
    }
  }
  default: {
    // ignore all whitespace
    while (skipwspace(lexer))
      ;

    if (valid_symbols[COMMENT_START]) {
      if (consume_if(lexer, '-')) {
        if (consume_if(lexer, '-')) {
          state->started = SHORT_COMMENT;

          lexer->mark_end(lexer);
          if (consume_if(lexer, '[')) {
            unsigned int possible_depth = get_depth(lexer);

            if (consume_if(lexer, '[')) {
              state->started = LONG_COMMENT;
              state->depth = possible_depth;

              lexer->mark_end(lexer);
            }
          }

          lexer->result_symbol = COMMENT_START;
          return true;
        }

        break;
      }
    }

    if (valid_symbols[STRING_START]) {
      bool enter = false;
      if (consume_if(lexer, SQ_STRING_DELIMITER)) {
        state->started = SHORT_SQ_STRING;
        enter = true;
      } else if (consume_if(lexer, DQ_STRING_DELIMITER)) {
        state->started = SHORT_DQ_STRING;
        enter = true;
      } else if (consume_if(lexer, '[')) {
        unsigned int possible_depth = get_depth(lexer);

        if (consume_if(lexer, '[')) {
          state->started = LONG_STRING;
          state->depth = possible_depth;
          enter = true;
        }
      }

      if (enter) {
        lexer->result_symbol = STRING_START;
        return true;
      }
    }

    if (valid_symbols[INTERP_START]) {
      if (consume_if(lexer, TICK_DELIMITER)) {
        state->started = TICK_STRING;
        lexer->result_symbol = INTERP_START;
        return true;
      }
    }

    bool IS_KEYWORD_VALID =
        valid_symbols[KEYWORD_OR] || valid_symbols[KEYWORD_NOT] ||
        valid_symbols[KEYWORD_THEN] || valid_symbols[KEYWORD_BREAK] ||
        valid_symbols[KEYWORD_NIL] || valid_symbols[KEYWORD_IF] ||
        valid_symbols[KEYWORD_ELSE] || valid_symbols[KEYWORD_FALSE] ||
        valid_symbols[KEYWORD_RETURN] || valid_symbols[KEYWORD_WHILE] ||
        valid_symbols[KEYWORD_IN] || valid_symbols[KEYWORD_REPEAT] ||
        valid_symbols[KEYWORD_ELSEIF] || valid_symbols[KEYWORD_FUNCTION] ||
        valid_symbols[KEYWORD_END] || valid_symbols[KEYWORD_FOR] ||
        valid_symbols[KEYWORD_UNTIL] || valid_symbols[KEYWORD_LOCAL] ||
        valid_symbols[KEYWORD_DO] || valid_symbols[KEYWORD_AND];

    if (!lexer->eof(lexer) && IS_KEYWORD_VALID) {
      if (!is_invalid_luau_name_character(lexer->lookahead)) {
        if (process_name(state, lexer, valid_symbols)) {
          return true;
        } else {
          return false;
        }
      }
    }

    RELEASE_STATE_GENERIC(state);

    break;
  }
  }

  return false;
}

#undef TSLUAU_DEBUG_PRINTF
