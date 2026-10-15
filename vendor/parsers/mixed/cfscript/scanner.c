#include "tree_sitter/parser.h"

#include <stdio.h>
#include <string.h>
#include <wctype.h>

enum TokenType {
    AUTOMATIC_SEMICOLON,
    TEMPLATE_CHARS,
    TERNARY_QMARK,
    ELVIS_OPERATOR,
    LOGICAL_OR,
    REGEX_PATTERN,
    QUERY_TEXT_DOUBLE,
    QUERY_TEXT_SINGLE,
    TAG_LINEFEED,
    CFML_TEMPLATE_CONTENT,
    CFML_COMMENT,
    JAVA_CLASS_CONTENT,
    JAVA_BLOCK_OPEN,
    STATIC_TYPE_PREFIX,
    PARAMETER_SEPARATOR,
    EMPTY_ARROW_BODY,
    SAVECONTENT_KW
};

void *tree_sitter_cfscript_external_scanner_create() { return NULL; }

void tree_sitter_cfscript_external_scanner_destroy(void *p) {}

unsigned tree_sitter_cfscript_external_scanner_serialize(void *payload, char *buffer) { return 0; }

void tree_sitter_cfscript_external_scanner_deserialize(void *p, const char *b, unsigned n) {}

static inline void advance(TSLexer *lexer) { lexer->advance(lexer, false); }

static inline void skip(TSLexer *lexer) { lexer->advance(lexer, true); }

// `iswspace` and friends are out-of-line, locale-aware library calls, and this
// scanner asks them about every character it skips. Answer for ASCII inline and
// keep the library call for the non-ASCII tail, where its answer is the one
// that counts. `common/scanner.h` carries its own copy of these — the two
// scanners share no code by design.
static inline bool cf_isspace(int32_t c) {
    return c == ' ' || c == '\n' || c == '\t' || c == '\r' || c == '\v' || c == '\f' ||
           (c > 127 && iswspace((wint_t)c));
}

static inline bool cf_isalpha(int32_t c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
           (c > 127 && iswalpha((wint_t)c));
}

// `iswdigit` answers only for the ASCII digits in every locale, so this one
// needs no fallback at all.
static inline bool cf_isdigit(int32_t c) { return c >= '0' && c <= '9'; }

static inline bool cf_isalnum(int32_t c) {
    return cf_isdigit(c) || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
           (c > 127 && iswalnum((wint_t)c));
}

static inline int32_t cf_tolower(int32_t c) {
    if (c >= 'A' && c <= 'Z') return c + ('a' - 'A');
    if (c > 127) return (int32_t)towlower((wint_t)c);
    return c;
}

static bool scan_template_chars(TSLexer *lexer) {
    lexer->result_symbol = TEMPLATE_CHARS;
    for (bool has_content = false;; has_content = true) {
        lexer->mark_end(lexer);
        switch (lexer->lookahead) {
            case '`':
                return has_content;
            case '\0':
                return false;
            case '$':
                advance(lexer);
                if (lexer->lookahead == '{') {
                    return has_content;
                }
                break;
            case '\\':
                return has_content;
            default:
                advance(lexer);
        }
    }
}

typedef enum {
    REJECT,     // Semicolon is illegal, ie a syntax error occurred
    NO_NEWLINE, // Unclear if semicolon will be legal, continue
    ACCEPT,     // Semicolon is legal, assuming a comment was encountered
} WhitespaceResult;

/**
 * @param consume If false, only consume enough to check if comment indicates semicolon-legality
 */
static WhitespaceResult scan_whitespace_and_comments(TSLexer *lexer, bool *scanned_comment, bool consume) {
    bool saw_block_newline = false;

    for (;;) {
        while (cf_isspace(lexer->lookahead) ) {
            skip(lexer);
        }

        if (lexer->lookahead == '/') {
            skip(lexer);

            if (lexer->lookahead == '/') {
                skip(lexer);
                while (lexer->lookahead != 0 && lexer->lookahead != '\n' && lexer->lookahead != 0x2028 &&
                       lexer->lookahead != 0x2029) {
                    skip(lexer);
                }
                *scanned_comment = true;
            } else if (lexer->lookahead == '*') {
                skip(lexer);
                while (lexer->lookahead != 0) {
                    if (lexer->lookahead == '*') {
                        skip(lexer);
                        if (lexer->lookahead == '/') {
                            skip(lexer);
                            *scanned_comment = true;

                            if (lexer->lookahead != '/' && !consume) {
                                return saw_block_newline ? ACCEPT : NO_NEWLINE;
                            }

                            break;
                        }
                    } else if (lexer->lookahead == '\n' || lexer->lookahead == 0x2028 || lexer->lookahead == 0x2029) {
                        saw_block_newline = true;
                        skip(lexer);
                    } else {
                        skip(lexer);
                    }
                }
            } else {
                return REJECT;
            }
        } else {
            return ACCEPT;
        }
    }
}

// CFML's word operators. A line that starts with one continues the expression
// on the line before it, so no automatic semicolon may go in front of it —
// `x = a ⏎ CONTAINS b` is one statement, not `x = a;` and a stray
// `CONTAINS b`. Keep in step with `binary_expression`'s operator table.
// Multi-word operators are matched as whole phrases below, not listed here, so
// that `does`, `greater` and `less` stay ordinary identifiers on their own.
static const char *const CFML_WORD_OPERATORS[] = {
    "and", "or", "xor", "eqv", "imp", "not",
    "eq", "neq", "equal", "is", "gt", "gte", "ge", "lt", "lte", "le",
    "ct", "nct", "contains", "mod", "in", "instanceof",
};

// Reads the word at the lexer into `buf`, lower-cased, and reports whether it
// is a WHOLE ASCII word — the only shape an operator has. A digit, `_`, `$` or
// non-ASCII letter straight after the letters means an identifier such as
// `in_stock`, `or_else`, `eq$` or `contains2`, which must NOT suppress the
// semicolon; neither must a word longer than the buffer. Consumes with `skip`,
// so it is lookahead only: the caller has already fixed the token with
// `mark_end`.
static bool scan_whole_word(TSLexer *lexer, char *buf, unsigned size) {
    unsigned len = 0;
    while ((lexer->lookahead >= 'a' && lexer->lookahead <= 'z') ||
           (lexer->lookahead >= 'A' && lexer->lookahead <= 'Z')) {
        if (len + 1 >= size) return false;
        buf[len++] = (char)cf_tolower(lexer->lookahead);
        skip(lexer);
    }
    buf[len] = '\0';
    return len > 0 && !cf_isalnum(lexer->lookahead) && lexer->lookahead != '_' &&
           lexer->lookahead != '$';
}

static bool scan_next_word_is(TSLexer *lexer, const char *expected) {
    while (cf_isspace(lexer->lookahead)) skip(lexer);
    char buf[12];
    return scan_whole_word(lexer, buf, sizeof buf) && strcmp(buf, expected) == 0;
}

// Whether the word at the lexer is a CFML word operator, case-insensitively.
static bool scan_cfml_word_operator(TSLexer *lexer) {
    char word[12];
    if (!scan_whole_word(lexer, word, sizeof word)) return false;
    for (unsigned i = 0; i < sizeof(CFML_WORD_OPERATORS) / sizeof(CFML_WORD_OPERATORS[0]); i++) {
        if (strcmp(word, CFML_WORD_OPERATORS[i]) == 0) return true;
    }
    if (strcmp(word, "does") == 0) {       // DOES NOT CONTAIN
        return scan_next_word_is(lexer, "not") && scan_next_word_is(lexer, "contain");
    }
    if (strcmp(word, "greater") == 0 || strcmp(word, "less") == 0) {   // … THAN [OR EQUAL TO]
        return scan_next_word_is(lexer, "than");
    }
    return false;
}

static bool scan_automatic_semicolon(TSLexer *lexer, bool comment_condition, bool *scanned_comment) {
    lexer->result_symbol = AUTOMATIC_SEMICOLON;
    lexer->mark_end(lexer);

    for (;;) {
        if (lexer->lookahead == 0) {
            return true;
        }

        if (lexer->lookahead == '/') {
            WhitespaceResult result = scan_whitespace_and_comments(lexer, scanned_comment, false);
            if (result == REJECT) {
                return false;
            }

            if (result == ACCEPT && comment_condition && lexer->lookahead != ',' && lexer->lookahead != '=') {
                return true;
            }
        }

        if (lexer->lookahead == '}') {
            return true;
        }

        if (lexer->is_at_included_range_start(lexer)) {
            return true;
        }

        if (lexer->lookahead == '\n' || lexer->lookahead == 0x2028 || lexer->lookahead == 0x2029) {
            break;
        }

        if (!cf_isspace(lexer->lookahead)) {
            return false;
        }

        skip(lexer);
    }

    skip(lexer);

    if (scan_whitespace_and_comments(lexer, scanned_comment, true) == REJECT) {
        return false;
    }

    switch (lexer->lookahead) {
        // No backtick here, unlike the JavaScript scanner this list came from.
        // There a backtick opens a template literal, which continues the
        // expression, so a semicolon must not be inserted before it. CFScript
        // has no template literal: its only backtick is the ``` fence of a tag
        // island, which is a statement of its own and can never continue the
        // one before it. Keeping the JS case meant the fence suppressed the
        // semicolon, and every statement relying on insertion in front of one
        // came out MISSING ";" — `thread name="t" { … }` then a fence (Lucee
        // LDEV4157), `lock { … }` then a fence, and a bare `var q =
        // queryNew("col")` then a fence (BoxLang QoQColumnNameTest). See #118.
        case ',':
        case ':':
        case ';':
        case '*':
        case '%':
        case '>':
        case '<':
        case '=':
        case '[':
        case '(':
        case '?':
        case '^':
        case '|':
        case '&':
        case '/':
            return false;

        // Insert a semicolon before decimals literals but not otherwise.
        case '.':
            skip(lexer);
            return cf_isdigit(lexer->lookahead);

        // Insert a semicolon before `--` and `++`, but not before binary `+` or `-`.
        case '+':
            skip(lexer);
            return lexer->lookahead == '+';
        case '-':
            skip(lexer);
            return lexer->lookahead == '-';

        // Don't insert a semicolon before `!=`, but do insert one before a unary `!`.
        case '!':
            skip(lexer);
            return lexer->lookahead != '=';

        default:
            // A letter may start a CFML word operator, in any casing. Every
            // letter goes through the check rather than a list of first
            // letters: the list had drifted from the operator table and missed
            // `IS`, `XOR`, `CONTAINS`, `DOES NOT CONTAIN`, uppercase `IN` and
            // more, each of which then split into a second statement.
            if (cf_isalpha(lexer->lookahead)) {
                return !scan_cfml_word_operator(lexer);
            }
            break;
    }

    return true;
}

static bool scan_ternary_qmark(TSLexer *lexer) {
    for (;;) {
        if (!cf_isspace(lexer->lookahead)) {
            break;
        }
        skip(lexer);
    }

    if (lexer->lookahead == '?') {
        advance(lexer);

        // Skip whitespace between ? and : for elvis operator
        while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
            advance(lexer);
        }

        if (lexer->lookahead == ':') {

            advance(lexer);
            lexer->mark_end(lexer);
            lexer->result_symbol = ELVIS_OPERATOR;

            return true;
        
        } else if (lexer->lookahead == '?') {
            return false;
        }

        lexer->mark_end(lexer);
        lexer->result_symbol = TERNARY_QMARK;

        if (lexer->lookahead == '.') {
            advance(lexer);
            if (cf_isdigit(lexer->lookahead)) {
                return true;
            }
            return false;
        }
        return true;
    }
    return false;
}

/*
static bool scan_html_comment(TSLexer *lexer) {
    while (cf_isspace(lexer->lookahead) || lexer->lookahead == 0x2028 || lexer->lookahead == 0x2029) {
        skip(lexer);
    }

    const char *comment_start = "<!--";
    const char *comment_end = "-->";

    if (lexer->lookahead == '<') {
        for (unsigned i = 0; i < 4; i++) {
            if (lexer->lookahead != comment_start[i]) {
                return false;
            }
            advance(lexer);
        }
    } else if (lexer->lookahead == '-') {
        for (unsigned i = 0; i < 3; i++) {
            if (lexer->lookahead != comment_end[i]) {
                return false;
            }
            advance(lexer);
        }
    } else {
        return false;
    }

    while (lexer->lookahead != 0 && lexer->lookahead != '\n' && lexer->lookahead != 0x2028 &&
           lexer->lookahead != 0x2029) {
        advance(lexer);
    }

    lexer->result_symbol = HTML_COMMENT;
    lexer->mark_end(lexer);

    return true;
}
    */

    /*
static bool scan_jsx_text(TSLexer *lexer) {
    // saw_text will be true if we see any non-whitespace content, or any whitespace content that is not a newline and
    // does not immediately follow a newline.
    bool saw_text = false;
    // at_newline will be true if we are currently at a newline, or if we are at whitespace that is not a newline but
    // immediately follows a newline.
    bool at_newline = false;

    while (lexer->lookahead != 0 && lexer->lookahead != '<' && lexer->lookahead != '>' && lexer->lookahead != '{' &&
           lexer->lookahead != '}' && lexer->lookahead != '&') {
        bool is_wspace = cf_isspace(lexer->lookahead);
        if (lexer->lookahead == '\n') {
            at_newline = true;
        } else {
            // If at_newline is already true, and we see some whitespace, then it must stay true.
            // Otherwise, it should be false.
            //
            // See the table below to determine the logic for computing `saw_text`.
            //
            // |------------------------------------|
            // | at_newline | is_wspace | saw_text  |
            // |------------|-----------|-----------|
            // | false (0)  | false (0) | true  (1) |
            // | false (0)  | true  (1) | true  (1) |
            // | true  (1)  | false (0) | true  (1) |
            // | true  (1)  | true  (1) | false (0) |
            // |------------------------------------|

            at_newline &= is_wspace;
            if (!at_newline) {
                saw_text = true;
            }
        }

        advance(lexer);
    }

    lexer->result_symbol = JSX_TEXT;
    return saw_text;
}
*/

// The SQL of `queryExecute( "…" )` or `queryExecute( '…' )`, up to the quote
// that closes it. It used to stop only at `"`, so the single-quoted arm could
// never complete and fell back to a plain call, and so did two other shapes:
//
// - a doubled quote, which is an escaped quote in a CFML string and does not
//   close it (`'… WHERE a = ''x'''`);
// - a quote inside a `#…#` span, which is a CFML expression whose own string
//   literals may use either quote (`"… #columns[ "id" ]# …"`, ColdBox's
//   DBAppender). The closing quote is not looked for inside one; `##` is a
//   literal hash, not a span.
static bool scan_query_text(TSLexer *lexer, int32_t quote, enum TokenType symbol) {
    
    bool saw_text = false;
    bool at_newline = false;

    // The EOF checks are not optional: `advance` is a no-op once `lookahead` is
    // 0, so a loop that only stops at the closing quote spins forever on an
    // unterminated string — `queryExecute("` on its own hung the parser.
    for (;;) {
        // Everything consumed so far is SQL; what follows is only lookahead
        // until the loop comes round again.
        lexer->mark_end(lexer);
        if (lexer->lookahead == 0) break;
        if (lexer->lookahead == quote) {
            advance(lexer);
            if (lexer->lookahead != quote) break;
            advance(lexer);
            saw_text = true;
            at_newline = false;
            continue;
        }
        if (lexer->lookahead == '#') {
            advance(lexer);
            if (lexer->lookahead != '#') {
                while (lexer->lookahead != 0 && lexer->lookahead != '#') advance(lexer);
            }
            if (lexer->lookahead == '#') advance(lexer);
            saw_text = true;
            at_newline = false;
            continue;
        }
        bool is_wspace = cf_isspace(lexer->lookahead);
        if (lexer->lookahead == '\n') {
            at_newline = true;
        } else {
            at_newline &= is_wspace;
            if (!at_newline) {
                saw_text = true;
            }
        }
        advance(lexer);
    }

    lexer->result_symbol = symbol;
    return saw_text;
}

static bool scan_cfml_template_content(TSLexer *lexer) {
    lexer->result_symbol = CFML_TEMPLATE_CONTENT;
    bool has_content = false;
    while (lexer->lookahead != 0) {
        if (lexer->lookahead == '`') {
            lexer->mark_end(lexer);
            advance(lexer);
            if (lexer->lookahead == '`') {
                advance(lexer);
                if (lexer->lookahead == '`') {
                    return has_content;
                }
            }
            has_content = true;
        } else {
            advance(lexer);
            has_content = true;
        }
    }
    return false;
}

// `<!--- … --->` — a CFML tag comment. These turn up inside script component
// bodies (Preside handlers, the Lucee test suite) and nest, which a token
// regex cannot express, so they are scanned here.
static bool scan_cfml_comment(TSLexer *lexer) {
    if (lexer->lookahead != '<') return false;
    advance(lexer);
    if (lexer->lookahead != '!') return false;
    advance(lexer);
    for (int i = 0; i < 3; i++) {
        if (lexer->lookahead != '-') return false;
        advance(lexer);
    }

    unsigned depth = 1;
    while (lexer->lookahead) {
        if (lexer->lookahead == '<') {
            advance(lexer);
            if (lexer->lookahead != '!') continue;
            advance(lexer);
            unsigned dashes = 0;
            while (lexer->lookahead == '-') {
                dashes++;
                advance(lexer);
            }
            if (dashes >= 3) depth++;
            continue;
        }
        if (lexer->lookahead == '-') {
            unsigned dashes = 0;
            while (lexer->lookahead == '-') {
                dashes++;
                advance(lexer);
            }
            if (dashes >= 3 && lexer->lookahead == '>') {
                advance(lexer);
                if (--depth == 0) {
                    lexer->result_symbol = CFML_COMMENT;
                    lexer->mark_end(lexer);
                    return true;
                }
            }
            continue;
        }
        advance(lexer);
    }
    return false;
}

// The opener of a Lucee inline Java class block: the word `java`, same-line
// whitespace, and `{`.
//
// The brace is part of the token so that `java` on its own — `new
// java.util.Properties()`, `x = java.lang.System` — is never touched. That much
// a plain internal token also gave. What it could not give is the check below:
// a variable that happens to be named `java` can also sit immediately before a
// brace, as in `loop array=java { x = 1; }`, where the brace opens the tag's
// *body*. Swallowing that produced a silently wrong tree with no ERROR node,
// which is the worst failure mode this parser has.
//
// So the block is only claimed when what follows the brace actually starts a
// Java class body. CFML statements never start with these words in this
// position, and a Java class body always does.
// `cfml:Query::new( … )` — Lucee's type prefix on a STATIC call, as opposed to
// on a `new`. The grammar cannot own this token: `_new_type_prefix` carries the
// colon inside it, so wherever it is valid, longest-match takes `cfml:` in
// preference to `cfml` followed by `:` — and every label and struct key that
// happens to be named `java` or `cfml` is swallowed. `cfml: while (true) { … }`
// became a call to a `prefixed_type` named `cfml:while`, with the label gone.
//
// What separates the two is what comes AFTER the name: a static call has `::`,
// a label has a statement, a pair has a value. That is a bounded lookahead, so
// the scanner can decide it and the grammar cannot. `mark_end` fixes the token
// at the colon first; everything past it is lookahead only, exactly as
// `scan_java_block_open_tail` below does past its brace.
static bool scan_static_type_prefix_tail(TSLexer *lexer) {
    // Entered with `java` or `cfml` already consumed and the word boundary
    // checked. `cfml::foo` is a static call on something named `cfml`, not a
    // prefix, so a doubled colon rejects.
    if (lexer->lookahead != ':') return false;
    advance(lexer);
    if (lexer->lookahead == ':') return false;
    lexer->mark_end(lexer);

    // Lookahead only from here: a dotted name, then `::`. Without the `::` this
    // is a label or a struct key and the prefix reading must not be offered —
    // that is the whole reason this token is external rather than a
    // `token(seq(choice('java','cfml'), ':'))` like `_new_type_prefix`.
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t') advance(lexer);
    for (;;) {
        if (!cf_isalpha(lexer->lookahead) && lexer->lookahead != '_') return false;
        while (cf_isalnum(lexer->lookahead) || lexer->lookahead == '_') advance(lexer);
        while (lexer->lookahead == ' ' || lexer->lookahead == '\t') advance(lexer);
        if (lexer->lookahead == '.') {
            advance(lexer);
            while (lexer->lookahead == ' ' || lexer->lookahead == '\t') advance(lexer);
            continue;
        }
        break;
    }
    if (lexer->lookahead != ':') return false;
    advance(lexer);
    return lexer->lookahead == ':';
}

static bool scan_java_block_open_tail(TSLexer *lexer) {
    // Entered with `java` already consumed and the word boundary checked.
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t') advance(lexer);
    if (lexer->lookahead != '{') return false;
    advance(lexer);
    lexer->mark_end(lexer);

    // Everything from here is lookahead only; mark_end above has already fixed
    // the token at the brace.
    //
    // Comments are skipped as well as whitespace: a Java class body may open
    // with one, and `java { /* } */ public class C { } }` otherwise failed the
    // starter check and lost the block. (Note the brace inside that comment —
    // finding the *end* of the body has the same three exceptions, which
    // `scan_java_class_content` below handles.)
    for (;;) {
        while (cf_isspace(lexer->lookahead)) advance(lexer);
        if (lexer->lookahead != '/') break;
        advance(lexer);
        if (lexer->lookahead == '/') {
            while (lexer->lookahead != 0 && lexer->lookahead != '\n') advance(lexer);
        } else if (lexer->lookahead == '*') {
            advance(lexer);
            while (lexer->lookahead != 0) {
                if (lexer->lookahead == '*') {
                    advance(lexer);
                    if (lexer->lookahead == '/') { advance(lexer); break; }
                } else {
                    advance(lexer);
                }
            }
        } else {
            return false;   // a stray `/` does not start a Java class body
        }
    }

    if (lexer->lookahead == '@') {          // an annotation
        lexer->result_symbol = JAVA_BLOCK_OPEN;
        return true;
    }

    char buf[16];
    int len = 0;
    while (cf_isalpha(lexer->lookahead) && len < 15) {
        buf[len++] = (char)cf_tolower(lexer->lookahead);
        advance(lexer);
    }
    buf[len] = '\0';

    static const char *starters[] = {
        "public", "private", "protected", "static", "final", "abstract",
        "class", "interface", "enum", "record", "import", "package", "strictfp"
    };
    for (unsigned i = 0; i < sizeof(starters) / sizeof(starters[0]); i++) {
        if (strcmp(buf, starters[i]) == 0) {
            lexer->result_symbol = JAVA_BLOCK_OPEN;
            return true;
        }
    }
    return false;
}

// The body of a Lucee inline Java class block, `java { … }` (LDEV4001).
//
// Entered immediately after the opening brace, which the grammar lexes as part
// of the single `_java_block_open` token, so by the time this runs the block is
// already committed — there is no shape in which it has to give characters
// back. It stops *before* the closing brace and leaves it to the grammar, so
// the block's extent is visible in the tree.
//
// The body is Java, not CFML, and is kept opaque on purpose. All this has to do
// is find the matching brace, which means knowing the three places a brace can
// appear without nesting: a string literal, a character literal, and a comment.
static bool scan_java_class_content(TSLexer *lexer) {
    unsigned depth = 1;
    bool any = false;

    for (;;) {
        if (lexer->lookahead == 0) {
            // Unterminated block. End the content at EOF rather than returning
            // false, which would strand everything consumed so far.
            lexer->mark_end(lexer);
            lexer->result_symbol = JAVA_CLASS_CONTENT;
            return any;
        }

        if (lexer->lookahead == '"' || lexer->lookahead == '\'') {
            int32_t quote = lexer->lookahead;
            advance(lexer);
            any = true;
            while (lexer->lookahead != 0 && lexer->lookahead != quote) {
                if (lexer->lookahead == '\\') {
                    advance(lexer);
                    if (lexer->lookahead == 0) break;
                }
                advance(lexer);
            }
            if (lexer->lookahead == quote) advance(lexer);
            continue;
        }

        if (lexer->lookahead == '/') {
            advance(lexer);
            any = true;
            if (lexer->lookahead == '/') {
                while (lexer->lookahead != 0 && lexer->lookahead != '\n') advance(lexer);
            } else if (lexer->lookahead == '*') {
                advance(lexer);
                while (lexer->lookahead != 0) {
                    if (lexer->lookahead == '*') {
                        advance(lexer);
                        if (lexer->lookahead == '/') { advance(lexer); break; }
                    } else {
                        advance(lexer);
                    }
                }
            }
            continue;
        }

        if (lexer->lookahead == '{') {
            depth++;
            advance(lexer);
            any = true;
            continue;
        }

        if (lexer->lookahead == '}') {
            if (depth == 1) {
                // Leave the closing brace for the grammar.
                lexer->mark_end(lexer);
                lexer->result_symbol = JAVA_CLASS_CONTENT;
                return any;
            }
            depth--;
            advance(lexer);
            any = true;
            continue;
        }

        advance(lexer);
        any = true;
    }
}

// `java` and `cfml` open three different things, and all three start by
// consuming the same word. They CANNOT be separate scans tried in turn: within
// a single `scan()` call tree-sitter does not rewind between them, so the first
// to advance past the word leaves the second reading from the middle of it.
// That is exactly what happened — `java:Query::new()` reached the prefix scan
// with the lexer already sitting on the `:`, and silently did nothing. The
// rewind the API gives you is between calls, not inside one.
//
// So the word is matched once, here, and what FOLLOWS it decides:
//
//     java {     an inline Java class block   (#74)
//     java:Q::   a static type prefix         (#93)
//     cfml:Q::   likewise
//
// Leading whitespace is ours to consume: `extras` apply to tokens the generated
// lexer produces, not to an external scan, which starts wherever the previous
// token ended. `skip` rather than `advance` keeps it out of the token.
static bool scan_java_or_cfml_word(TSLexer *lexer, const bool *valid_symbols, bool skip_space) {
    if (skip_space) {
        while (cf_isspace(lexer->lookahead)) skip(lexer);
    }

    const char *word;
    if (cf_tolower(lexer->lookahead) == 'j') {
        word = "java";
    } else if (cf_tolower(lexer->lookahead) == 'c') {
        word = "cfml";
    } else {
        return false;
    }
    for (int i = 0; i < 4; i++) {
        if (cf_tolower(lexer->lookahead) != word[i]) return false;
        advance(lexer);
    }
    // `javaCast`, `javascript`, `cfmlFoo`: the word must end here.
    if (cf_isalnum(lexer->lookahead) || lexer->lookahead == '_') return false;

    if (lexer->lookahead == ':') {
        if (!valid_symbols[STATIC_TYPE_PREFIX]) return false;
        if (!scan_static_type_prefix_tail(lexer)) return false;
        lexer->result_symbol = STATIC_TYPE_PREFIX;
        return true;
    }
    if (word[0] == 'j' && valid_symbols[JAVA_BLOCK_OPEN] &&
        !valid_symbols[AUTOMATIC_SEMICOLON]) {
        return scan_java_block_open_tail(lexer);
    }
    return false;
}


// `x = () => ;` — an arrow function with no body at all (Lucee LDEV4062).
// Zero-width, like AUTOMATIC_SEMICOLON: it reports that an expression cannot
// start here, so the body arm of `arrow_function` does not apply. Offered only
// before a terminator, which is what keeps the empty arm from competing with a
// real body — `() => mod.create( a = 1 )` never reaches it.
static bool scan_empty_arrow_body(TSLexer *lexer) {
    lexer->result_symbol = EMPTY_ARROW_BODY;
    lexer->mark_end(lexer);

    while (cf_isspace(lexer->lookahead)) skip(lexer);

    switch (lexer->lookahead) {
        case 0:
        case ';':
        case ')':
        case '}':
        case ',':
        case ']':
            return true;
        default:
            return false;
    }
}

// `savecontent { … }` used as an expression. The token covers the word only;
// the `{` is left for the grammar's `statement_block`.
//
// Case-insensitive, like every CFML keyword. The word must end at a
// non-identifier character — `savecontentFoo` is an ordinary identifier — and
// the next non-whitespace character must be `{`, which is what separates this
// from the statement form and from every other use of the word.
static bool scan_savecontent_kw(TSLexer *lexer) {
    static const char word[] = "savecontent";
    for (unsigned i = 0; i < sizeof(word) - 1; i++) {
        if (cf_tolower(lexer->lookahead) != word[i]) return false;
        advance(lexer);
    }
    if (cf_isalnum(lexer->lookahead) || lexer->lookahead == '_') return false;

    // The token ends here; everything past it is lookahead.
    lexer->mark_end(lexer);

    // `advance`, not `skip`, for that lookahead. `skip` moves the token's START
    // to the current position — it means "what came before was whitespace" —
    // so skipping here threw away the eleven characters already advanced and
    // left a zero-width token sitting on the `{`, with the word covered by no
    // node at all. Advancing past `mark_end` is the supported way to look
    // further: the token still ends where it was marked.
    while (cf_isspace(lexer->lookahead)) advance(lexer);
    if (lexer->lookahead != '{') return false;

    lexer->result_symbol = SAVECONTENT_KW;
    return true;
}

// A newline acting as a parameter separator, for a parameter list whose comma
// was left out — Lucee, ACF and BoxLang all tolerate it, and TestBox's
// `BaseSpec.cfc` depends on it.
//
// Zero-width, like AUTOMATIC_SEMICOLON: `mark_end` fixes the token at the
// current position and everything past it is lookahead. The line terminator is
// mandatory, which is what keeps this unambiguous — same-line `f( a b )` is not
// this construct and must keep whatever reading it already had.
static bool scan_parameter_separator(TSLexer *lexer) {
    lexer->result_symbol = PARAMETER_SEPARATOR;
    lexer->mark_end(lexer);

    bool saw_newline = false;
    for (;;) {
        if (lexer->lookahead == '\n' || lexer->lookahead == 0x2028 || lexer->lookahead == 0x2029) {
            saw_newline = true;
            skip(lexer);
            continue;
        }
        if (cf_isspace(lexer->lookahead)) {
            skip(lexer);
            continue;
        }
        break;
    }
    if (!saw_newline) return false;

    // What follows has to look like the START OF A PARAMETER, and the check has
    // to be this strict. A `(` is ambiguous with an arrow function's parameter
    // list, so this token is valid inside every parenthesised expression — and
    // a multi-line boolean is the commonest thing in the language:
    //
    //     if (
    //         Len( arguments.name )
    //         && ( … )          <- a newline, then a token that is not `)` or `,`
    //     ) {
    //
    // Accepting that took `wheels/Controller.cfc` from 0 to 96 error nodes and
    // `ColdBox`'s `Router.cfc` from 0 to 18. A parameter can only begin with a
    // letter or `_`, never an operator, a digit or a quote.
    if (!cf_isalpha(lexer->lookahead) && lexer->lookahead != '_') {
        return false;
    }

    // …and CFML's WORD operators are the other half of the same trap, because
    // they begin with letters: `foo` newline `AND bar` is one expression, not
    // two parameters. They are excluded by name. A parameter genuinely named
    // `and`, first on its line with the comma left out, is a shape no corpus
    // file writes — and `_operator_shaped_name` still covers those names in
    // every position the grammar reaches normally.
    {
        char word[10];
        unsigned n = 0;
        while (n < sizeof(word) - 1 && (cf_isalnum(lexer->lookahead) || lexer->lookahead == '_')) {
            word[n++] = (char)cf_tolower(lexer->lookahead);
            advance(lexer);
        }
        word[n] = '\0';
        static const char *const OPERATORS[] = {
            "and", "or", "not", "xor", "eq", "neq", "lt", "gt", "lte", "gte",
            "is", "isnot", "contains", "mod", "imp", "does", "greater",
            "less", "equal",
        };
        for (unsigned i = 0; i < sizeof(OPERATORS) / sizeof(OPERATORS[0]); i++) {
            if (strcmp(word, OPERATORS[i]) == 0) return false;
        }
    }
    return true;
}

bool tree_sitter_cfscript_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    // TERMINAL, and first, for the reason #93 documents: this scan consumes
    // whitespace with `skip` before it can decide, and tree-sitter does not
    // rewind between functions inside a single scan() call. Letting it fall
    // through would hand every later branch a lexer already past the newline
    // they make their own decisions from.
    // TERMINAL, and first, for the reason #93 documents: this scan consumes
    // whitespace with `skip` before it can decide, and tree-sitter does not
    // rewind between functions inside a single scan() call. Falling through
    // would hand every later branch a lexer already past the newline they make
    // their own decisions from.
    //
    // A `(` is ambiguous with an arrow function's parameter list, so this token
    // is valid inside an ordinary parenthesised expression too — which is how
    // the first version of this broke `x = a ? ( b ? 1 : 2 ) : 3`, eating the
    // space before the `?` and never letting the ternary scan run. Excluding
    // the competing symbols outright does not work either: at the position this
    // token actually has to fire, after a parameter default, TERNARY, ELVIS,
    // ASI and LOGICAL_OR are ALL live. So the ternary gets its turn here
    // instead, once the separator has declined.
    if (valid_symbols[PARAMETER_SEPARATOR]) {
        if (scan_parameter_separator(lexer)) {
            return true;
        }
        if ((valid_symbols[TERNARY_QMARK] || valid_symbols[ELVIS_OPERATOR]) &&
            lexer->lookahead == '?') {
            return scan_ternary_qmark(lexer);
        }
        return false;
    }
    // `java_class_content` is only reachable straight after that opener, a
    // state in which no other external token is valid — so AUTOMATIC_SEMICOLON
    // being valid alongside it means the parser is in error recovery, where
    // tree-sitter marks every external token valid. Standing down keeps the
    // balanced-brace walk from running at every recovery step, which is the
    // cost CFML_TEMPLATE_CONTENT below measures.
    if (valid_symbols[JAVA_CLASS_CONTENT]) {
        if (valid_symbols[AUTOMATIC_SEMICOLON]) {
            return false;
        }
        return scan_java_class_content(lexer);
    }

    // `cfml_template_content` is only reachable straight after a ``` fence, a
    // state in which no other external token is valid — so AUTOMATIC_SEMICOLON
    // being valid alongside it means the parser is in error recovery, where
    // tree-sitter marks every external token valid. Scanning there runs to EOF
    // looking for a closing fence that ordinary CFML does not contain, and then
    // returns false having consumed the file for nothing. Over 400 script
    // components (2.2 MB) that happened 3,060 times and accounted for 25.1M of
    // the scanner's 25.13M character advances — 52% of every instruction the
    // parse retired. TEMPLATE_CHARS below already stands down the same way.
    if (valid_symbols[CFML_TEMPLATE_CONTENT]) {
        if (valid_symbols[AUTOMATIC_SEMICOLON]) {
            return false;
        }
        return scan_cfml_template_content(lexer);
    }

    if (valid_symbols[TEMPLATE_CHARS]) {
        if (valid_symbols[AUTOMATIC_SEMICOLON]) {
            return false;
        }
        return scan_template_chars(lexer);
    }

    // if (valid_symbols[JSX_TEXT] && scan_jsx_text(lexer)) {
    //     return true;
    // }

    // Stands down in error recovery like the three branches above: query text
    // is valid alongside AUTOMATIC_SEMICOLON only in the recovery state, where
    // every external token is, and unguarded it scanned to the next quote —
    // or to EOF — at every recovery step, and could return a query_text token
    // from anywhere. Only one of the two is valid in any real parse state: the
    // one for the quote the grammar has just consumed.
    if (!valid_symbols[AUTOMATIC_SEMICOLON]) {
        if (valid_symbols[QUERY_TEXT_DOUBLE] && scan_query_text(lexer, '"', QUERY_TEXT_DOUBLE)) {
            return true;
        }
        if (valid_symbols[QUERY_TEXT_SINGLE] && scan_query_text(lexer, '\'', QUERY_TEXT_SINGLE)) {
            return true;
        }
    }

    // A CFML comment where no semicolon or ternary decision is pending. The
    // whitespace has to be skipped here: the scanner is called before the
    // internal lexer, so the lexer is parked on the whitespace, not on `<`.
    // The semicolon branch below covers the other case — it skips whitespace
    // itself, so by the time it declines the lexer is already on `<`.
    if (valid_symbols[CFML_COMMENT] && !valid_symbols[AUTOMATIC_SEMICOLON] &&
        !valid_symbols[TERNARY_QMARK] && !valid_symbols[ELVIS_OPERATOR]) {
        while (cf_isspace(lexer->lookahead)) skip(lexer);
        if (lexer->lookahead == '<' && scan_cfml_comment(lexer)) {
            return true;
        }
        // This branch owns a statement head, and it must stay TERMINAL: letting
        // it fall through ran automatic-semicolon insertion with the whitespace
        // above already consumed, and a trailing comment then attached to the
        // wrong node — one `(comment)` silently vanished from a Mura file with
        // no `java` or `cfml` in it at all. So `_static_type_prefix`, which is
        // also valid at a statement head, gets its turn HERE instead. The
        // whitespace is already skipped, hence the `false`.
        if (valid_symbols[STATIC_TYPE_PREFIX] &&
            scan_java_or_cfml_word(lexer, valid_symbols, false)) {
            return true;
        }
        return false;
    }

    if (valid_symbols[AUTOMATIC_SEMICOLON] && !valid_symbols[TAG_LINEFEED]) {
        bool scanned_comment = false;
        bool ret = scan_automatic_semicolon(lexer, !valid_symbols[LOGICAL_OR], &scanned_comment);
        if (!ret && !scanned_comment && valid_symbols[TERNARY_QMARK] && lexer->lookahead == '?') {
            return scan_ternary_qmark(lexer);
        }
        if (!ret && valid_symbols[CFML_COMMENT] && lexer->lookahead == '<' && scan_cfml_comment(lexer)) {
            return true;
        }
        return ret;
    }

    // A tag statement (`admin action="…" type="server";`) spans lines, which is
    // why the semicolon branch above stands down while TAG_LINEFEED is live. It
    // cannot continue past `}` or EOF, though, so a statement that ends there
    // still needs its semicolon — ColdBox writes `rethrow` with no semicolon
    // before the closing brace.
    if (valid_symbols[AUTOMATIC_SEMICOLON] && valid_symbols[TAG_LINEFEED]) {
        lexer->mark_end(lexer);
        while (cf_isspace(lexer->lookahead)) skip(lexer);
        if (lexer->lookahead == '}' || lexer->lookahead == 0) {
            lexer->result_symbol = AUTOMATIC_SEMICOLON;
            return true;
        }
    }

    if (valid_symbols[TERNARY_QMARK] || valid_symbols[ELVIS_OPERATOR]) {
        return scan_ternary_qmark(lexer);
    }

    /*if (valid_symbols[HTML_COMMENT] && !valid_symbols[LOGICAL_OR] &&
        !valid_symbols[REGEX_PATTERN]) {
        return scan_html_comment(lexer);
    }*/

    // Last, and deliberately so. This scan consumes leading whitespace with
    // `skip` before it can tell whether the word is `java`, and several of the
    // branches above — automatic semicolon insertion in particular — decide
    // what they do from exactly that whitespace. Running first, it stole the
    // run of spaces before a trailing comment and the comment then attached
    // inside the preceding block instead of after it, which `cfscript comments`
    // caught. Placed here it only ever sees a position nothing else claimed.
    //
    // It needs no recovery guard: it rejects within a few characters of
    // anything that is not the word `java` or `cfml`.
    if ((valid_symbols[JAVA_BLOCK_OPEN] || valid_symbols[STATIC_TYPE_PREFIX]) &&
        scan_java_or_cfml_word(lexer, valid_symbols, true)) {
        return true;
    }

    if (valid_symbols[EMPTY_ARROW_BODY] && scan_empty_arrow_body(lexer)) {
        return true;
    }

    // Last, and for the same reason as the `java` / `cfml` word branch above:
    // it consumes the word before it can tell whether the `{` that makes this a
    // savecontent block follows, and nothing after it needs the position back.
    // It sits below EMPTY_ARROW_BODY for that reason too — both are valid after
    // `=>`, and the zero-width one has to get its answer first. The word is
    // only matched when the parser is actually expecting an expression here,
    // and a `savecontent` not followed by `{` is declined, so the ordinary
    // identifier reading — `savecontent = 1`, `x = savecontent.foo`,
    // `savecontent()` — is untouched. See `savecontent_expression` in the
    // grammar for why this cannot be a keyword token.
    if (valid_symbols[SAVECONTENT_KW] && scan_savecontent_kw(lexer)) {
        return true;
    }

    return false;
}