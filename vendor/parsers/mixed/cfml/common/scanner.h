#include "tag.h"
#include "tree_sitter/parser.h"

#include <stdint.h>
#include <string.h>
#include <wctype.h>

enum TokenType {
    AUTOMATIC_SEMICOLON,
    TERNARY_QMARK,
    ELVIS_OPERATOR,
    LOGICAL_OR,
    CF_START_TAG_NAME,
    CF_END_TAG_NAME,
    ERRONEOUS_CF_END_TAG_NAME,
    CF_SELF_CLOSING_TAG_DELIMITER,
    CF_SELF_CLOSING_VOID_TAG_DELIMITER,
    IMPLICIT_CF_END_TAG,
    RAW_TEXT,
    CFML_COMMENT,
    CLOSE_TAG_DELIM,
    CLOSE_CF_TAG_DELIM,
    HTML_TEXT,
    CF_VOID_START_TAG_NAME,
    CF_SET_START_TAG_NAME,
    CF_IF_START_TAG_NAME,
    CF_IF_END_TAG_NAME,
    CF_ELSEIF_TAG_NAME,
    CF_ELSE_TAG_NAME,
    CF_RETURN_START_TAG_NAME,
    CF_OUTPUT_START_TAG_NAME,

    // Rules below this point are not included by the cfquery dialect
    SCRIPT_START_TAG_NAME,
    STYLE_START_TAG_NAME,
    START_TAG_NAME,
    END_TAG_NAME,
    ERRONEOUS_END_TAG_NAME,
    SELF_CLOSING_TAG_DELIMITER,
    IMPLICIT_END_TAG,

    START_HASH_EXPRESSION,
    SINGLE_HASH,
    HASH_EMPTY,

    CF_XML_START_TAG_NAME,
    CF_XML_END_TAG_NAME,
    CF_XML_CONTENT,

    CF_QUERY_START_TAG_NAME,
    CF_QUERY_END_TAG_NAME,
    CF_QUERY_CONTENT,

    CF_SCRIPT_START_TAG_NAME,
    CF_SCRIPT_END_TAG_NAME,
    CF_SCRIPT_CONTENT,

    CF_SAVECONTENT_START_TAG_NAME,
    CF_SAVECONTENT_END_TAG_NAME,
    CF_SAVECONTENT_BODY_CFML,
    CF_SAVECONTENT_BODY_HTML,
    CF_SAVECONTENT_BODY_SCRIPT,
    CF_SAVECONTENT_BODY_CSS,
    CF_SAVECONTENT_BODY_XML,
    CF_SAVECONTENT_BODY_SQL,
    CF_SAVECONTENT_BODY_RAW,
    CF_SAVECONTENT_CONTENT,

    CF_FUNCTION_START_TAG_NAME,
    CF_FUNCTION_END_TAG_NAME,

    CF_COMPONENT_START_TAG_NAME,
    CF_COMPONENT_END_TAG_NAME,

    CF_COMPONENT_CONTENT,
    SCANNER_SYMBOL_COUNT
};

// Room for the prefixes a template declares with `<cfimport prefix="…">`, each
// stored as a length byte and its upper-cased name. tassweb's busiest pages
// import two or three (`control`, `container`, `content`), so this is several
// times what real code needs while staying a small, fixed share of the
// serialisation buffer the tag stacks also live in.
#define IMPORT_PREFIX_BYTES 64
#define IMPORT_PREFIX_MAX_LEN 32

typedef struct {
    Array(Tag) tags;
    Array(Tag) cf_tags;
    uint16_t cfoutput_depth;
    uint16_t cfcomponent_depth;
    // `cfcomponent_depth` + 1 at the outermost open `<cfcomponent>` whose
    // `output` is a literal true, 0 while none is open. `<cfcomponent>` is never
    // pushed on `cf_tags`, so its flag cannot ride there as a function's does.
    uint16_t cfcomponent_output_depth;
    // Bit i: `cf_tags[i]` is a `<cffunction>` whose `output` is a literal true.
    // Written for index i by every push at i, so a bit left behind by a popped
    // tag is overwritten before anything reads it — `scanner_in_hash_eval_context`
    // only looks below `cf_tags.size`. A function deeper than 32 CF tags reads as
    // not evaluating.
    uint32_t cffunction_output_mask;
    char import_prefixes[IMPORT_PREFIX_BYTES];
    uint8_t import_prefixes_len;
    // Set while the scanner is inside the start tag of an element whose name
    // carries an imported prefix, so `#` in its attributes opens an expression.
    bool in_prefixed_start_tag;
} Scanner;

#define SCANNER_FLAGS_SIZE (sizeof(uint16_t) * 3 + sizeof(uint32_t))

// The bytes `serialize` writes after the flag fields: the start-tag flag, the
// prefix buffer's length, and the buffer.
static inline unsigned import_section_size(const Scanner *scanner) {
    return 2 + scanner->import_prefixes_len;
}

typedef enum {
    REJECT,     // Semicolon is illegal, ie a syntax error occurred
    NO_NEWLINE, // Unclear if semicolon will be legal, continue
    ACCEPT,     // Semicolon is legal, assuming a comment was encountered
} WhitespaceResult;

#define MAX(a, b) ((a) > (b) ? (a) : (b))

#define MAX_CF_END_DELIMITER_SIZE 256

#define VS(vs, sym, count) ((unsigned)(sym) < (count) && (vs)[(sym)])

static inline void advance(TSLexer *lexer) { lexer->advance(lexer, false); }

static inline void skip(TSLexer *lexer) { lexer->advance(lexer, true); }

// `iswspace` and friends are out-of-line, locale-aware library calls, and this
// scanner asks them about every character it reads. CFML source is ASCII in the
// parts that matter, so answer for ASCII inline and keep the library call for
// the non-ASCII tail, where its answer is the one that counts. In the "C"
// locale a parser embedded in an editor or a Node addon runs under, the two
// agree for ASCII by definition; a locale that classified an ASCII character
// differently would change these answers, but no locale in practice does.
static inline bool cf_isspace(int32_t c) {
    return c == ' ' || c == '\n' || c == '\t' || c == '\r' || c == '\v' || c == '\f' ||
           (c > 127 && iswspace((wint_t)c));
}

static inline bool cf_isalpha(int32_t c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
           (c > 127 && iswalpha((wint_t)c));
}

// `iswdigit` and `iswxdigit` answer only for the ASCII digits in every locale,
// so these need no fallback at all.
static inline bool cf_isdigit(int32_t c) { return c >= '0' && c <= '9'; }

static inline bool cf_isxdigit(int32_t c) {
    return cf_isdigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}

static inline bool cf_isalnum(int32_t c) {
    return cf_isdigit(c) || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
           (c > 127 && iswalnum((wint_t)c));
}

static inline int32_t cf_toupper(int32_t c) {
    if (c >= 'a' && c <= 'z') return c - ('a' - 'A');
    if (c > 127) return (int32_t)towupper((wint_t)c);
    return c;
}

static inline int32_t cf_tolower(int32_t c) {
    if (c >= 'A' && c <= 'Z') return c + ('a' - 'A');
    if (c > 127) return (int32_t)towlower((wint_t)c);
    return c;
}

static inline bool tag_has_name(TagType type, bool is_cfquery_context) {
    return type == CUSTOM || type == CFML || type == CF_VOID || type == CF_SET ||
           type == CF_XML || type == CF_SCRIPT || type == CF_SAVECONTENT ||
           type == CF_QUERY || type == CF_OUTPUT || type == CF_FUNCTION || type == CF_RETURN ||
           type == CF_IF || type == CF_ELSEIF || type == CF_ELSE;
}

static inline bool valid_start_tag_name(const bool *vs, unsigned count) {
    return VS(vs, START_TAG_NAME, count) || VS(vs, SCRIPT_START_TAG_NAME, count) ||
           VS(vs, CF_START_TAG_NAME, count) ||
           VS(vs, CF_SET_START_TAG_NAME, count) || VS(vs, CF_VOID_START_TAG_NAME, count) ||
           VS(vs, CF_RETURN_START_TAG_NAME, count) || VS(vs, CF_XML_START_TAG_NAME, count) ||
           VS(vs, CF_QUERY_START_TAG_NAME, count) || VS(vs, CF_SCRIPT_START_TAG_NAME, count) ||
           VS(vs, CF_SAVECONTENT_START_TAG_NAME, count) || VS(vs, CF_OUTPUT_START_TAG_NAME, count) ||
           VS(vs, CF_FUNCTION_START_TAG_NAME, count) ||
           VS(vs, CF_COMPONENT_START_TAG_NAME, count) ||
           VS(vs, CF_IF_START_TAG_NAME, count) || VS(vs, CF_ELSEIF_TAG_NAME, count) ||
           VS(vs, CF_ELSE_TAG_NAME, count);
}

static inline bool valid_end_tag_name(const bool *vs, unsigned count) {
    return VS(vs, END_TAG_NAME, count) || VS(vs, CF_END_TAG_NAME, count) ||
           VS(vs, CF_XML_END_TAG_NAME, count) || VS(vs, CF_QUERY_END_TAG_NAME, count) ||
           VS(vs, CF_SCRIPT_END_TAG_NAME, count) || VS(vs, CF_SAVECONTENT_END_TAG_NAME, count) ||
           VS(vs, CF_FUNCTION_END_TAG_NAME, count) ||
           VS(vs, CF_IF_END_TAG_NAME, count);
}

static inline bool valid_cf_start_tag_name(const bool *vs, unsigned count) {
    return VS(vs, CF_START_TAG_NAME, count) || VS(vs, CF_SET_START_TAG_NAME, count) ||
           VS(vs, CF_VOID_START_TAG_NAME, count) || VS(vs, CF_RETURN_START_TAG_NAME, count) ||
           VS(vs, CF_XML_START_TAG_NAME, count) || VS(vs, CF_QUERY_START_TAG_NAME, count) ||
           VS(vs, CF_SCRIPT_START_TAG_NAME, count) || VS(vs, CF_SAVECONTENT_START_TAG_NAME, count) ||
           VS(vs, CF_OUTPUT_START_TAG_NAME, count) || VS(vs, CF_FUNCTION_START_TAG_NAME, count) ||
           VS(vs, CF_COMPONENT_START_TAG_NAME, count) ||
           VS(vs, CF_IF_START_TAG_NAME, count) || VS(vs, CF_ELSEIF_TAG_NAME, count) ||
           VS(vs, CF_ELSE_TAG_NAME, count);
}

static inline bool valid_cf_end_tag_name(const bool *vs, unsigned count) {
    return VS(vs, CF_END_TAG_NAME, count) || VS(vs, CF_XML_END_TAG_NAME, count) ||
           VS(vs, CF_QUERY_END_TAG_NAME, count) || VS(vs, CF_SCRIPT_END_TAG_NAME, count) ||
           VS(vs, CF_SAVECONTENT_END_TAG_NAME, count) || VS(vs, CF_FUNCTION_END_TAG_NAME, count) ||
           VS(vs, CF_IF_END_TAG_NAME, count);
}

static inline bool no_content_symbols(const bool *vs, unsigned count) {
    return !VS(vs, RAW_TEXT, count) && !VS(vs, CF_XML_CONTENT, count) &&
           !VS(vs, CF_QUERY_CONTENT, count) && !VS(vs, CF_SCRIPT_CONTENT, count);
}

static inline bool implicit_cf_end_tag_valid(const bool *vs, unsigned count) {
    return VS(vs, IMPLICIT_CF_END_TAG, count) && !VS(vs, CF_XML_END_TAG_NAME, count) &&
           !VS(vs, CF_QUERY_END_TAG_NAME, count) && !VS(vs, CF_SCRIPT_END_TAG_NAME, count) &&
           !VS(vs, CF_SAVECONTENT_END_TAG_NAME, count) && !VS(vs, CF_FUNCTION_END_TAG_NAME, count) &&
           !VS(vs, CF_IF_END_TAG_NAME, count) &&
           !VS(vs, CF_ELSEIF_TAG_NAME, count) && !VS(vs, CF_ELSE_TAG_NAME, count);
}

// Each serialized tag array is a 4-byte header — `_serialized`, then `_count` —
// followed by `_serialized` entries. The two differ when the buffer runs out:
// deserialize restores that many real tags and pads to `_count` with empty ones.
//
// `reserve` is how many bytes must still be free *after* this array, so that
// whatever serialize writes next always fits. Getting this wrong is what caused
// #57: the second array found no room for its own header, skipped writing it,
// and left a stream whose shape no longer matched what deserialize expected —
// which then read past the end of the buffer. The header is written
// unconditionally now, and only the entries are ever dropped.
#define TAGS_HEADER_SIZE (2 * sizeof(uint16_t))

// How many bytes SERIALIZE_TAGS below will spend on one tag. Kept beside it so
// the two cannot drift: if the serialized shape of a tag changes, this changes.
static unsigned tag_serialized_size(const Tag *tag, bool is_cfquery_context) {
    if (!tag_has_name(tag->type, is_cfquery_context)) return 1;
    unsigned len = tag->tag_name.size;
    if (len > UINT8_MAX) len = UINT8_MAX;
    return 2 + len + sizeof(tag->html_depth);
}

#define SERIALIZE_TAGS(tags_field, buffer, size, reserve, is_cfquery_context) do { \
    uint16_t _count = (tags_field).size > UINT16_MAX ? UINT16_MAX : (tags_field).size; \
    uint16_t _serialized = 0; \
    unsigned _count_offset = (size); \
    unsigned _limit = TREE_SITTER_SERIALIZATION_BUFFER_SIZE - (reserve); \
    /* Unreachable with the reserves serialize() passes: the first array is */ \
    /* capped so the second's header always fits. Kept so a future caller */ \
    /* that reserves too little truncates rather than corrupting the stream. */ \
    if ((size) + TAGS_HEADER_SIZE > _limit) break; \
    (size) += TAGS_HEADER_SIZE; \
    for (; _serialized < _count; _serialized++) { \
        Tag _tag = (tags_field).contents[_serialized]; \
        if (tag_has_name(_tag.type, is_cfquery_context)) { \
            unsigned _len = _tag.tag_name.size; \
            if (_len > UINT8_MAX) _len = UINT8_MAX; \
            if ((size) + 2 + _len + sizeof(_tag.html_depth) > _limit) break; \
            (buffer)[(size)++] = (char)_tag.type; \
            (buffer)[(size)++] = (char)_len; \
            memcpy(&(buffer)[(size)], _tag.tag_name.contents, _len); \
            (size) += _len; \
            memcpy(&(buffer)[(size)], &_tag.html_depth, sizeof(_tag.html_depth)); \
            (size) += sizeof(_tag.html_depth); \
        } else { \
            if ((size) + 1 > _limit) break; \
            (buffer)[(size)++] = (char)_tag.type; \
        } \
    } \
    memcpy(&(buffer)[_count_offset], &_serialized, sizeof(_serialized)); \
    memcpy(&(buffer)[_count_offset + sizeof(_serialized)], &_count, sizeof(_count)); \
} while(0)

// Would pushing `incoming` take the two tag stacks past what `serialize` can
// write? tree-sitter caps that buffer at TREE_SITTER_SERIALIZATION_BUFFER_SIZE,
// and SERIALIZE_TAGS truncates when it runs out — deserialize then pads the
// remainder with nameless END_ sentinels, so the stack comes back *different*
// from the one that was saved and every later end-tag decision is made against
// tags that have lost their names.
//
// That is #55. A run of unpaired `<cf_foo>` tags nests, one level per tag, and
// past ~1KB of stack the whole document collapsed to a single ERROR at 1:1 —
// including the perfectly good `<cfscript>` block after the run. It is a BYTE
// budget rather than a tag count, which is what the bug report's "~71" missed:
// the limit moves with the tag NAME LENGTH, measured at 124 tags for `cf_a`
// down to 41 for `cf_runtest1234567890`.
//
// The cost is O(depth) per start tag rather than a maintained counter,
// deliberately: tags are popped from several places and a counter that drifts
// would reintroduce exactly the silent mismatch this exists to prevent. Real
// nesting depth is a handful of tags, so the loop is not measurable.
#define TAG_STACK_HEADROOM 256

// A second margin, below the first, for the HTML side. An unrecognised HTML tag
// left unclosed — tassweb's `<control:hiddenfield …>`, written thirty times in
// a row — nests exactly as an unpaired `<cf_foo>` does, and costs its name's
// bytes on the stack. Held only to the budget above, such a run fills the
// stack right up to it, and the `<cfloop>` after it is then the tag that
// cannot be pushed: `CFML` is the type an ordinary `<cfloop>` gets too, so it
// meets the same check and is completed as void, leaving its `</cfloop>` with
// no opener. Stopping HTML custom tags this much earlier keeps room for the CF
// tags that genuinely nest inside such a page — about ten `<cfloop>` levels.
#define CUSTOM_HTML_TAG_HEADROOM 128

static inline unsigned scanner_depths_size(const Scanner *scanner) {
    (void)scanner;
    return SCANNER_FLAGS_SIZE;
}

// Every byte `serialize` needs except the two tag stacks' entries.
static inline unsigned scanner_fixed_size(const Scanner *scanner) {
    return 2 * TAGS_HEADER_SIZE + scanner_depths_size(scanner) + import_section_size(scanner);
}

static unsigned tag_stacks_size(const Scanner *scanner, bool is_cfquery_context) {
    unsigned used = 0;
    for (unsigned i = 0; i < scanner->tags.size; i++) {
        used += tag_serialized_size(&scanner->tags.contents[i], is_cfquery_context);
    }
    for (unsigned i = 0; i < scanner->cf_tags.size; i++) {
        used += tag_serialized_size(&scanner->cf_tags.contents[i], is_cfquery_context);
    }
    return used;
}

static bool tag_stack_would_overflow_by(const Scanner *scanner, const Tag *incoming,
                                        bool is_cfquery_context, unsigned headroom) {
    // Headroom, and it is the whole point rather than a safety margin. The tag
    // that overflowed in the bug report was NOT one of the custom tags: 72
    // `<cf_runtest>` tags fit, and the `<cfscript>` after them became the 73rd
    // and was the one truncated. So a run of non-nesting tags must stop short of
    // the budget by enough for the tags that legitimately DO nest — a
    // `<cfscript>`, `<cfoutput>`, `<cfquery>` — to still fit after it. 256 bytes
    // is roughly 18 further named tags, well past any real nesting depth.
    const unsigned budget =
        TREE_SITTER_SERIALIZATION_BUFFER_SIZE - scanner_fixed_size(scanner) - headroom;
    return tag_stacks_size(scanner, is_cfquery_context) +
           tag_serialized_size(incoming, is_cfquery_context) > budget;
}

static bool tag_stack_would_overflow(const Scanner *scanner, const Tag *incoming,
                                     bool is_cfquery_context) {
    return tag_stack_would_overflow_by(scanner, incoming, is_cfquery_context, TAG_STACK_HEADROOM);
}

static unsigned serialize(Scanner *scanner, char *buffer, bool is_cfquery_context) {
    unsigned size = 0;
    const unsigned depths = SCANNER_FLAGS_SIZE;
    const unsigned imports = import_section_size(scanner);
    // `tags` must leave room for cf_tags' header, the four fields after it and
    // the import section; `cf_tags` for the last two. That keeps every section
    // present even when the tag stacks are deep enough to fill the buffer on
    // their own.
    SERIALIZE_TAGS(scanner->tags, buffer, size, TAGS_HEADER_SIZE + depths + imports, is_cfquery_context);
    SERIALIZE_TAGS(scanner->cf_tags, buffer, size, depths + imports, is_cfquery_context);
    if (size + depths <= TREE_SITTER_SERIALIZATION_BUFFER_SIZE) {
        memcpy(&buffer[size], &scanner->cfoutput_depth, sizeof(scanner->cfoutput_depth));
        size += sizeof(scanner->cfoutput_depth);
        memcpy(&buffer[size], &scanner->cfcomponent_depth, sizeof(scanner->cfcomponent_depth));
        size += sizeof(scanner->cfcomponent_depth);
        memcpy(&buffer[size], &scanner->cfcomponent_output_depth, sizeof(scanner->cfcomponent_output_depth));
        size += sizeof(scanner->cfcomponent_output_depth);
        memcpy(&buffer[size], &scanner->cffunction_output_mask, sizeof(scanner->cffunction_output_mask));
        size += sizeof(scanner->cffunction_output_mask);
    }
    if (size + imports <= TREE_SITTER_SERIALIZATION_BUFFER_SIZE) {
        buffer[size++] = (char)scanner->in_prefixed_start_tag;
        buffer[size++] = (char)scanner->import_prefixes_len;
        if (scanner->import_prefixes_len) {
            memcpy(&buffer[size], scanner->import_prefixes, scanner->import_prefixes_len);
            size += scanner->import_prefixes_len;
        }
    }
    return size;
}

// Deserialize runs once per external-token lex — 85,213 times over 300 corpus
// templates — which made rebuilding the tag stack from scratch the scanner's
// most expensive operation: a free and a malloc for every tag on it, on every
// call. The stack barely changes between calls, so the slots already in the
// array are reused in place and keep the name buffers they hold; only a change
// in depth touches the allocator now. Reuse is safe because every Tag owns its
// name buffer regardless of type (see `tag_free`), so overwriting a slot never
// strands one.
//
// Every read is bounded by `length` (#57). The counts and lengths driving this
// loop are read out of the buffer, so trusting them is trusting the input: an
// over-long `_serialized` used to walk straight off the end of the heap block
// and segfault the process. When a read would not fit, `_stop` latches and the
// remaining slots are emptied — the same state a serialize-side truncation
// leaves, so a short or foreign buffer costs scanner state, not memory safety.
#define DESERIALIZE_TAGS(tags_field, buffer, size, length, is_cfquery_context) do { \
    uint16_t _serialized = 0, _count = 0; \
    if ((size) + TAGS_HEADER_SIZE <= (length)) { \
        memcpy(&_serialized, &(buffer)[(size)], sizeof(_serialized)); (size) += sizeof(_serialized); \
        memcpy(&_count, &(buffer)[(size)], sizeof(_count)); (size) += sizeof(_count); \
    } \
    for (unsigned _i = _count; _i < (tags_field).size; _i++) tag_free(&(tags_field).contents[_i]); \
    if ((tags_field).size > _count) (tags_field).size = _count; \
    array_reserve(&(tags_field), _count); \
    while ((tags_field).size < _count) array_push(&(tags_field), tag_new()); \
    bool _stop = false; \
    for (unsigned _i = 0; _i < _count; _i++) { \
        Tag *_tag = &(tags_field).contents[_i]; \
        bool _filled = false; \
        if (!_stop && _i < _serialized && (size) + 1 <= (length)) { \
            TagType _type = (TagType)(unsigned char)(buffer)[(size)]; \
            if (!tag_has_name(_type, is_cfquery_context)) { \
                (size) += 1; \
                _tag->type = _type; \
                _tag->tag_name.size = 0; \
                _tag->html_depth = 0; \
                _filled = true; \
            } else if ((size) + 2 <= (length)) { \
                uint16_t _len = (uint8_t)(buffer)[(size) + 1]; \
                if ((size) + 2 + _len + sizeof(_tag->html_depth) <= (length)) { \
                    (size) += 2; \
                    _tag->type = _type; \
                    array_reserve(&_tag->tag_name, _len); \
                    /* memcpy(NULL, …, 0) is undefined; a zero-length name */ \
                    /* can leave `contents` NULL. */ \
                    if (_len) memcpy(_tag->tag_name.contents, &(buffer)[(size)], _len); \
                    _tag->tag_name.size = _len; \
                    (size) += _len; \
                    memcpy(&_tag->html_depth, &(buffer)[(size)], sizeof(_tag->html_depth)); \
                    (size) += sizeof(_tag->html_depth); \
                    _filled = true; \
                } \
            } \
        } \
        if (!_filled) { \
            _stop = true; \
            _tag->type = END_; \
            _tag->tag_name.size = 0; \
            _tag->html_depth = 0; \
        } \
    } \
} while(0)

static void deserialize(Scanner *scanner, const char *buffer, unsigned length, bool is_cfquery_context) {
    scanner->cfoutput_depth = 0;
    scanner->cfcomponent_depth = 0;
    scanner->cfcomponent_output_depth = 0;
    scanner->cffunction_output_mask = 0;
    scanner->in_prefixed_start_tag = false;
    scanner->import_prefixes_len = 0;
    if (length > 0) {
        unsigned size = 0;
        DESERIALIZE_TAGS(scanner->tags, buffer, size, length, is_cfquery_context);
        DESERIALIZE_TAGS(scanner->cf_tags, buffer, size, length, is_cfquery_context);
        if (size + sizeof(scanner->cfoutput_depth) <= length) {
            memcpy(&scanner->cfoutput_depth, &buffer[size], sizeof(scanner->cfoutput_depth));
            size += sizeof(scanner->cfoutput_depth);
        }
        if (size + sizeof(scanner->cfcomponent_depth) <= length) {
            memcpy(&scanner->cfcomponent_depth, &buffer[size], sizeof(scanner->cfcomponent_depth));
            size += sizeof(scanner->cfcomponent_depth);
        }
        if (size + sizeof(scanner->cfcomponent_output_depth) <= length) {
            memcpy(&scanner->cfcomponent_output_depth, &buffer[size], sizeof(scanner->cfcomponent_output_depth));
            size += sizeof(scanner->cfcomponent_output_depth);
        }
        if (size + sizeof(scanner->cffunction_output_mask) <= length) {
            memcpy(&scanner->cffunction_output_mask, &buffer[size], sizeof(scanner->cffunction_output_mask));
            size += sizeof(scanner->cffunction_output_mask);
        }
        // Bounded like every read above (#57): the length comes out of the
        // buffer, and one that overruns it or the field leaves no prefixes
        // rather than a read past either end.
        if (size + 2 <= length) {
            scanner->in_prefixed_start_tag = buffer[size] != 0;
            uint8_t len = (uint8_t)buffer[size + 1];
            size += 2;
            if (len <= IMPORT_PREFIX_BYTES && size + len <= length) {
                if (len) memcpy(scanner->import_prefixes, &buffer[size], len);
                scanner->import_prefixes_len = len;
                size += len;
            }
        }
    } else {
        for (unsigned i = 0; i < scanner->tags.size; i++) tag_free(&scanner->tags.contents[i]);
        array_clear(&scanner->tags);
        for (unsigned i = 0; i < scanner->cf_tags.size; i++) tag_free(&scanner->cf_tags.contents[i]);
        array_clear(&scanner->cf_tags);
    }
}

typedef struct {
    String tag_name;
    bool is_cf_tag;
} TagNameResult;

static TagNameResult scan_tag_name(TSLexer *lexer, bool is_cfquery_context) {
    TagNameResult result;
    String tag_name = array_new();
    bool is_cf_tag = false;

    // One allocation instead of the four `array_push` would make growing from
    // empty to a typical tag name a byte at a time. Longer names still grow.
    array_reserve(&tag_name, TAG_NAME_FIELD);

    // ColdFusion tags might start with 'C', ie. <cfcomponent or <cfcontinue
    if ( lexer->lookahead == 'c' || lexer->lookahead == 'C' ) {
        array_push(&tag_name, cf_toupper(lexer->lookahead));
        advance(lexer);
        if (lexer->lookahead == 'f' || lexer->lookahead == 'F') {
            is_cf_tag = true;
            array_delete(&tag_name);
            advance(lexer);
        }
    }

    // `.` is a name character in XML (`<system.webServer>` in an IIS
    // web.config), but not in a CF tag name, and never the first character.
    // Without it the start tag read as `<system` with an attribute
    // `.webServer`, and its end tag matched nothing (#169).
    while (( cf_isalnum(lexer->lookahead) || lexer->lookahead == '-' || lexer->lookahead == '_' || lexer->lookahead == ':' ||
             (lexer->lookahead == '.' && !is_cf_tag && tag_name.size > 0) )) {
        array_push(&tag_name, cf_toupper(lexer->lookahead));
        advance(lexer);
    }

    result.tag_name = tag_name;
    result.is_cf_tag = is_cf_tag;

    return result;
}

// Longest tag name, prefix and `#…#` spans together, that a dynamic suffix may
// build. Past it the suffix is not read at all and the tag behaves as it did
// before #132. The tag stack is serialized into a fixed buffer with each name
// capped at UINT8_MAX bytes: a name cut short there would stop matching its end
// tag after a reparse, and long names crowd out the tags that legitimately nest.
#define DYNAMIC_TAG_NAME_MAX 64

// `<h#field.getLevel()#>`, `<dc:#container#>` — an HTML tag name with a static
// prefix and a `#…#` expression run straight onto it (#132). `scan_tag_name`
// stops at the `#`, so the start tag used to read as `<h` with an attribute
// named `#…#`, and its end tag `</h#…#>` could not parse at all, taking the rest
// of the file with it. Only a span with no whitespace before it counts:
// `<input #attrs#>` is an attribute and stays one.
//
// Entered on the `#`. Appends the span and any name characters after it to
// `name`, uppercased like the rest of the name, so an end tag spelled the same
// way matches through the ordinary tag stack — the expression's text is
// compared, not its value. On false `name` is restored, but what was read stays
// consumed: a caller producing the name token must have called `mark_end`
// first, and one scanning lookahead only need not.
static bool scan_tag_name_hash_span(TSLexer *lexer, String *name) {
    uint32_t keep = name->size;
    bool ok = true;

    array_push(name, '#');
    advance(lexer);
    // `##` is a literal hash, not an expression.
    if (lexer->lookahead == '#') ok = false;
    while (ok && lexer->lookahead != '#') {
        int32_t c = lexer->lookahead;
        if (c == 0 || c == '\n' || c == '\r' || c == '<' || c == '>' ||
            name->size >= DYNAMIC_TAG_NAME_MAX) {
            ok = false;
            break;
        }
        array_push(name, cf_toupper(c));
        advance(lexer);
    }
    if (ok) {
        array_push(name, '#');
        advance(lexer);
        while (cf_isalnum(lexer->lookahead) || lexer->lookahead == '-' ||
               lexer->lookahead == '_' || lexer->lookahead == ':') {
            if (name->size >= DYNAMIC_TAG_NAME_MAX) {
                ok = false;
                break;
            }
            array_push(name, cf_toupper(lexer->lookahead));
            advance(lexer);
        }
    }
    if (!ok) name->size = keep;
    return ok;
}

// `</#expr#>` with no element open for it to close (#132, second shape).
// Taffy's anythingtoxml opens `<#name#>` in one `<cfoutput>` and closes it in a
// later one, so by the time the end tag arrives its element is gone — the first
// block's end closed it. A stray static end tag is an `erroneous_end_tag`
// already; a stray dynamic one fell into `scan_end_tag_name`'s `</#` branch,
// which answers END_TAG_NAME whether or not that is valid, and here it is not:
// the parse failed and took the rest of the file. It is an `erroneous_end_tag`
// now too, named by the whole `#…#` span. Nothing is pushed or popped, so no
// length cap applies; a span must still close on its line without `<` or `>`.
static bool scan_erroneous_dynamic_end_tag_name(TSLexer *lexer) {
    bool any = false;
    while (lexer->lookahead == '#') {
        advance(lexer);
        // `##` is a literal hash, not an expression.
        if (lexer->lookahead == '#') break;
        while (lexer->lookahead != '#' && lexer->lookahead != 0 && lexer->lookahead != '\n' &&
               lexer->lookahead != '\r' && lexer->lookahead != '<' && lexer->lookahead != '>') {
            advance(lexer);
        }
        if (lexer->lookahead != '#') break;
        advance(lexer);
        while (cf_isalnum(lexer->lookahead) || lexer->lookahead == '-' ||
               lexer->lookahead == '_' || lexer->lookahead == ':') {
            advance(lexer);
        }
        lexer->mark_end(lexer);
        any = true;
    }
    lexer->result_symbol = ERRONEOUS_END_TAG_NAME;
    return any;
}

// Extend a start or end tag's name through any `#…#` spans run onto it, as the
// name token: each span that closes moves the token's end past it.
static void scan_dynamic_tag_name_suffix(TSLexer *lexer, TagNameResult *result, bool is_cfquery_context) {
    if (result->is_cf_tag || is_cfquery_context || lexer->lookahead != '#') return;
    lexer->mark_end(lexer);
    while (lexer->lookahead == '#' && scan_tag_name_hash_span(lexer, &result->tag_name)) {
        lexer->mark_end(lexer);
    }
}

static bool scan_comment(TSLexer *lexer, bool is_cfquery_context) {
    if (lexer->lookahead != '-') {
        return false;
    }
    advance(lexer);
    if (lexer->lookahead != '-') {
        return false;
    }

    advance(lexer);

    // IE conditional comments: <!--[if ...]>...<![endif]--> or <!--<![endif]-->
    // These don't nest — just scan until -->
    if (lexer->lookahead == '[' || lexer->lookahead == '<') {
        unsigned close_dashes = 0;
        while (lexer->lookahead) {
            if (lexer->lookahead == '-') {
                close_dashes++;
            } else if (lexer->lookahead == '>' && close_dashes >= 2) {
                lexer->result_symbol = CFML_COMMENT;
                advance(lexer);
                lexer->mark_end(lexer);
                return true;
            } else {
                close_dashes = 0;
            }
            advance(lexer);
        }
        return false;
    }

    unsigned dashes = 0;
    unsigned direction = -1;
    unsigned nesting = 1;

    while (lexer->lookahead) {
        switch (lexer->lookahead) {
            case '-':
                ++dashes;
                if ( direction == 1 && dashes >= 2 ) {
                    ++nesting;
                    direction = -1;
                    dashes = 0;
                }
                break;
            case '>':
                if (dashes >= 2) {
                    --nesting;
                    lexer->result_symbol = CFML_COMMENT;
                    advance(lexer);
                    lexer->mark_end(lexer);
                    if ( nesting == 0 ) {
                        return true;
                    }
                    dashes = 0;
                    direction = -1;
                    continue;
                }
                direction = -1;
                dashes = 0;
                break;
            case '<':
                direction = 0;
                dashes = 0;
                break;
            case '!':
                if ( direction == 0 ) {
                    direction = 1;
                    break;
                }
                direction = -1;
                dashes = 0;
                break;
            default:
                direction = -1;
                dashes = 0;
                break;
        }
        advance(lexer);
    }
    return false;
}

static WhitespaceResult scan_whitespace_and_comments(TSLexer *lexer, bool *scanned_comment, bool consume, bool is_cfquery_context) {
    bool saw_block_newline = false;
    for (;;) {
        while (cf_isspace(lexer->lookahead)) {
            skip(lexer);
        }

        if (lexer->lookahead == '/') {
            skip(lexer);

            if (lexer->lookahead == '/') {
                skip(lexer);
                while (lexer->lookahead != 0 && lexer->lookahead != '\n' && lexer->lookahead != 0x2028 && lexer->lookahead != 0x2029) {
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


// Consume the body of a CFML comment, the lexer sitting just past the opening
// `<!---`. CFML comments nest, so track depth. Stops at EOF on an unterminated
// comment rather than spinning.
static void skip_cfml_comment_body(TSLexer *lexer) {
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
                if (--depth == 0) return;
            }
            continue;
        }
        advance(lexer);
    }
}

// `lt_consumed` means the caller has already advanced past a `<` that belongs
// to this text run, having decided from the character after it that no tag can
// start there. See the dispatcher's `case '<'`.
static bool scan_html_text(Scanner *scanner, TSLexer *lexer, bool is_cfquery_context,
                           const bool *valid_symbols, unsigned count, bool lt_consumed) {
    // Check if we're inside a script/style tag
    bool in_script_style = false;
    if (scanner->tags.size > 0) {
        TagType type = array_back(&scanner->tags)->type;
        if (type == SCRIPT || type == STYLE) {
            in_script_style = true;
        }
    }

    // saw_text will be true if we see any non-whitespace content, or any whitespace content that is not a newline and
    // does not immediately follow a newline.
    bool saw_text = false;
    // at_newline will be true if we are currently at a newline, or if we are at whitespace that is not a newline but
    // immediately follows a newline.
    bool at_newline = false;

    bool saw_any = false;

    if (in_script_style && !lt_consumed) {
        // Inside script/style: consume until #, <cf, </cf, or </script|</style
        lexer->mark_end(lexer);
        while (lexer->lookahead != 0 && lexer->lookahead != '#') {
            if (lexer->lookahead == '<') {
                // Peek for <cf or </cf or </script|</style
                advance(lexer);
                if (cf_toupper(lexer->lookahead) == 'C') {
                    advance(lexer);
                    if (cf_toupper(lexer->lookahead) == 'F') {
                        break;
                    }
                    lexer->mark_end(lexer);
                    saw_text = true;
                    saw_any = true;
                    continue;
                } else if (lexer->lookahead == '/') {
                    advance(lexer);
                    if (cf_toupper(lexer->lookahead) == 'C') {
                        advance(lexer);
                        if (cf_toupper(lexer->lookahead) == 'F') {
                            break;
                        }
                        lexer->mark_end(lexer);
                        saw_text = true;
                        saw_any = true;
                        continue;
                    } else if (cf_toupper(lexer->lookahead) == 'S') {
                        // Potential </script or </style - stop
                        break;
                    }
                    lexer->mark_end(lexer);
                    saw_text = true;
                    saw_any = true;
                    continue;
                } else if (lexer->lookahead == '!') {
                    // See scan_raw_text: `#` inside a CFML comment is never
                    // interpolated, so the comment is consumed whole.
                    advance(lexer);
                    if (lexer->lookahead == '-') {
                        advance(lexer);
                        if (lexer->lookahead == '-') {
                            advance(lexer);
                            if (lexer->lookahead == '-') {
                                skip_cfml_comment_body(lexer);
                            }
                        }
                    }
                    lexer->mark_end(lexer);
                    saw_text = true;
                    saw_any = true;
                    continue;
                }
                lexer->mark_end(lexer);
                saw_text = true;
                saw_any = true;
                continue;
            }
            saw_text = true;
            saw_any = true;
            advance(lexer);
            lexer->mark_end(lexer);
        }
        lexer->result_symbol = HTML_TEXT;
        return saw_text || (saw_any && lexer->lookahead == '#');
    }

    // `>` only ends a tag when the parser is actually inside one, which it
    // signals by making a closing delimiter valid. Anywhere else — `<p>a > b</p>`,
    // `#ratio#% ==>` — it is ordinary text.
    bool tag_delimiter_expected =
        VS(valid_symbols, CLOSE_TAG_DELIM, count) ||
        VS(valid_symbols, CLOSE_CF_TAG_DELIM, count) ||
        VS(valid_symbols, SELF_CLOSING_TAG_DELIMITER, count) ||
        VS(valid_symbols, CF_SELF_CLOSING_TAG_DELIMITER, count) ||
        VS(valid_symbols, CF_SELF_CLOSING_VOID_TAG_DELIMITER, count);

    if (lt_consumed) {
        // The `<` the caller consumed is the first character of this token.
        lexer->mark_end(lexer);
        saw_text = true;
        saw_any = true;
    }

    while (lexer->lookahead != 0 && lexer->lookahead != '{' &&
           lexer->lookahead != '}' && lexer->lookahead != '#') {
        if (lexer->lookahead == '<') {
            // Peeking past `<` consumes it, and this scanner cannot rewind: if
            // the function then returns false the dispatcher below is left
            // looking at the character *after* the `<` and never sees the tag or
            // comment. Only peek once some text has been collected, which
            // guarantees a `true` return; a `<` at the very start of a text run
            // is left to the tag rules as before.
            if (!saw_text) {
                break;
            }
            // A `<` starts a tag only when a name, `/`, `!`, `?` or a dynamic
            // `#name#` can follow it. `5 < 6` is text, the same rule browsers
            // apply. mark_end first: on a real tag the token has to end here.
            lexer->mark_end(lexer);
            advance(lexer);
            if (lexer->lookahead == 0 || cf_isalpha(lexer->lookahead) || lexer->lookahead == '/' ||
                lexer->lookahead == '!' || lexer->lookahead == '?' || lexer->lookahead == '#') {
                break;
            }
            saw_text = true;
            saw_any = true;
            lexer->mark_end(lexer);
            continue;
        }
        if (lexer->lookahead == '>') {
            if (tag_delimiter_expected) {
                break;
            }
            advance(lexer);
            saw_text = true;
            saw_any = true;
            lexer->mark_end(lexer);
            continue;
        }
        if (lexer->lookahead == '&') {
            // Peek ahead to determine if this is an entity
            lexer->mark_end(lexer);
            advance(lexer);
            if (lexer->lookahead == '#') {
                // Could be numeric entity (&#digits; or &#xhex;) or &# followed by CFML hash
                // Mark end after & so it's consumed as text
                lexer->mark_end(lexer);
                saw_text = true;
                saw_any = true;
                advance(lexer);
                if (lexer->lookahead == 'x' || lexer->lookahead == 'X' || cf_isdigit(lexer->lookahead)) {
                    // Numeric entity - consume fully as text
                    if (lexer->lookahead == 'x' || lexer->lookahead == 'X') {
                        advance(lexer);
                        while (cf_isxdigit(lexer->lookahead)) advance(lexer);
                    } else {
                        while (cf_isdigit(lexer->lookahead)) advance(lexer);
                    }
                    if (lexer->lookahead == ';') advance(lexer);
                    lexer->mark_end(lexer);
                    continue;
                }
                // &# not followed by digit/x - & consumed as text, break at #
                break;
            }
            if (cf_isalpha(lexer->lookahead)) {
                // Could be &word; - scan ahead for ;
                unsigned count = 0;
                while (cf_isalpha(lexer->lookahead) && count < 31) {
                    advance(lexer);
                    count++;
                }
                if (lexer->lookahead == ';' && count > 0) {
                    // Valid entity pattern - stop before &
                    break;
                }
                // Not a valid entity - consume as text
                lexer->mark_end(lexer);
                saw_text = true;
                saw_any = true;
                continue;
            }
            // & followed by non-alpha, non-# - consume as text
            lexer->mark_end(lexer);
            saw_text = true;
            saw_any = true;
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
        saw_any = true;
        advance(lexer);
        lexer->mark_end(lexer);
    }

    lexer->result_symbol = HTML_TEXT;
    // Emit whitespace-only content when the next char is '#' so the parser
    // advances to a state where hash tokens become valid.
    return saw_text || (saw_any && lexer->lookahead == '#');
}


static bool scan_script_comment(TSLexer *lexer, bool is_cfquery_context) {

    for (;;) {

        if (lexer->lookahead == '/') {
            skip(lexer);
            while (lexer->lookahead != 0 && lexer->lookahead != '\n' && lexer->lookahead != 0x2028 &&
                    lexer->lookahead != 0x2029) {
                skip(lexer);
            }
            //*scanned_comment = true;
        } else if (lexer->lookahead == '*') {
            skip(lexer);
            while (lexer->lookahead != 0) {
                if (lexer->lookahead == '*') {
                    skip(lexer);
                    if (lexer->lookahead == '/') {
                        skip(lexer);
                        //*scanned_comment = true;
                        break;
                    }
                } else {
                    skip(lexer);
                }
            }
        } else {
            return false;
        }
    }
}


static bool scan_cfquery_content(Scanner *scanner, TSLexer *lexer, bool is_cfquery_context) {

    if (scanner->cf_tags.size == 0) {
        return false;
    }

    Tag *cf_tag = array_back(&scanner->cf_tags);
    if (cf_tag->type != CF_QUERY) {
        return false;
    }

    lexer->mark_end(lexer);

    size_t tag_len = cf_tag->tag_name.size;
    if (tag_len > MAX_CF_END_DELIMITER_SIZE - 5) return false;

    char end_delimiter[MAX_CF_END_DELIMITER_SIZE];
    memcpy(end_delimiter, "</CF", 4);
    memcpy(&end_delimiter[4], cf_tag->tag_name.contents, tag_len);
    end_delimiter[4 + tag_len] = '\0';

    size_t delimiter_index = 0;
    size_t end_delim_len = 4 + tag_len;

    while (lexer->lookahead) {
        if (cf_toupper(lexer->lookahead) == end_delimiter[delimiter_index]) {
            delimiter_index++;
            if (delimiter_index == end_delim_len) {
                break;
            }
            advance(lexer);
        } else if (delimiter_index > 0) {
            // A partial match failed. What it consumed is content, and the
            // character that broke it may begin the delimiter itself: in
            // `x <</cfscript>` it is the `<` of the close tag. Advancing past
            // it here hid the close tag, and the rest of the document with it.
            // Only `<` can restart a match, and it only opens the delimiter,
            // so re-testing this one character is enough.
            delimiter_index = 0;
            lexer->mark_end(lexer);
        } else {
            advance(lexer);
            lexer->mark_end(lexer);
        }
    }

    lexer->result_symbol = CF_QUERY_CONTENT;
    return true;
}

static bool scan_cfxml_content(Scanner *scanner, TSLexer *lexer, bool is_cfquery_context) {

    if (scanner->cf_tags.size == 0) {
        return false;
    }

    Tag *cf_tag = array_back(&scanner->cf_tags);
    if (cf_tag->type != CF_XML) {
        return false;
    }

    lexer->mark_end(lexer);

    size_t tag_len = cf_tag->tag_name.size;
    if (tag_len > MAX_CF_END_DELIMITER_SIZE - 5) return false;

    char end_delimiter[MAX_CF_END_DELIMITER_SIZE];
    memcpy(end_delimiter, "</CF", 4);
    memcpy(&end_delimiter[4], cf_tag->tag_name.contents, tag_len);
    end_delimiter[4 + tag_len] = '\0';

    size_t delimiter_index = 0;
    size_t end_delim_len = 4 + tag_len;

    while (lexer->lookahead) {
        if (cf_toupper(lexer->lookahead) == end_delimiter[delimiter_index]) {
            delimiter_index++;
            if (delimiter_index == end_delim_len) {
                break;
            }
            advance(lexer);
        } else if (delimiter_index > 0) {
            // A partial match failed. What it consumed is content, and the
            // character that broke it may begin the delimiter itself: in
            // `x <</cfscript>` it is the `<` of the close tag. Advancing past
            // it here hid the close tag, and the rest of the document with it.
            // Only `<` can restart a match, and it only opens the delimiter,
            // so re-testing this one character is enough.
            delimiter_index = 0;
            lexer->mark_end(lexer);
        } else {
            advance(lexer);
            lexer->mark_end(lexer);
        }
    }

    lexer->result_symbol = CF_XML_CONTENT;
    return true;
}


// How deep the string / `#…#` nesting inside a script body is tracked before
// the scanner stops counting. Real CFML nests two or three levels; past this
// the extra openers are simply not pushed, which degrades to the old
// string-blind behaviour for that stretch rather than misreading it.
#define CF_SCRIPT_CONTEXT_DEPTH 16

static bool scan_cfscript_content(Scanner *scanner, TSLexer *lexer, bool is_cfquery_context) {

    if (scanner->cf_tags.size == 0) {
        return false;
    }

    Tag *cf_tag = array_back(&scanner->cf_tags);
    if (cf_tag->type != CF_SCRIPT) {
        return false;
    }

    lexer->mark_end(lexer);

    size_t tag_len = cf_tag->tag_name.size;
    if (tag_len > MAX_CF_END_DELIMITER_SIZE - 5) return false;

    char end_delimiter[MAX_CF_END_DELIMITER_SIZE];
    memcpy(end_delimiter, "</CF", 4);
    memcpy(&end_delimiter[4], cf_tag->tag_name.contents, tag_len);
    end_delimiter[4 + tag_len] = '\0';

    size_t delimiter_index = 0;
    size_t end_delim_len = 4 + tag_len;

    // A `</cfscript>` written inside a string or a comment does not end the
    // block. Lucee agrees: `cfscript` has a `tagdependent` body handled by
    // `CFMLScriptTransformer`, which ends it through `isFinish()` between
    // complete statements, so a string is consumed by the expression parser
    // long before the tag inside it could be noticed, and no raw search for
    // `</cfscript>` happens there at all. Without this the block ended at the
    // literal, the rest of it became template text and the real closing tag an
    // erroneous end tag (#56).
    //
    // Comments are skipped for a reason the strings make necessary rather than
    // as a bonus: CFML escapes a quote by doubling it and has no backslash
    // escape, so a lone apostrophe in `// don't do this` would otherwise open a
    // string that runs to the end of the file and swallow the closing tag. The
    // three comment forms a script body accepts are all handled — `//`, `/* */`
    // and the tag comment `<!--- --->`, which `tag_comment_in_script_body.cfc`
    // pins as legal here.
    // The context stack: a quote character means "inside a string of that
    // kind", 0 means "inside a `#…#` interpolation". CFML nests the two
    // arbitrarily — `'"#replaceNoCase( v, '"', '""', 'all' )#"'` is one
    // string containing an interpolation containing three more strings
    // (RustCFML's test_tag_return_nested_quote_interpolation.cfm) — so a single
    // "are we in a string" flag desynchronises on the first one and every
    // later `</cfscript>` lands in the wrong place.
    int32_t context[CF_SCRIPT_CONTEXT_DEPTH];
    unsigned depth = 0;

    while (lexer->lookahead) {
        if (depth > 0 && context[depth - 1] != 0) {
            int32_t quote = context[depth - 1];
            if (lexer->lookahead == quote) {
                advance(lexer);
                lexer->mark_end(lexer);
                // `""` and `''` are CFML's escape for a quote inside a string
                // of the same kind, so the string continues.
                if (lexer->lookahead == quote) {
                    advance(lexer);
                    lexer->mark_end(lexer);
                    continue;
                }
                depth--;
                continue;
            }
            if (lexer->lookahead == '#') {
                advance(lexer);
                lexer->mark_end(lexer);
                // `##` is an escaped hash, not an interpolation.
                if (lexer->lookahead == '#') {
                    advance(lexer);
                    lexer->mark_end(lexer);
                    continue;
                }
                if (depth < CF_SCRIPT_CONTEXT_DEPTH) context[depth++] = 0;
                continue;
            }
            advance(lexer);
            lexer->mark_end(lexer);
            continue;
        }

        if (depth > 0 && lexer->lookahead == '#') {
            // The interpolation ends here.
            advance(lexer);
            lexer->mark_end(lexer);
            depth--;
            continue;
        }

        if (lexer->lookahead == '"' || lexer->lookahead == '\'') {
            if (depth < CF_SCRIPT_CONTEXT_DEPTH) context[depth++] = lexer->lookahead;
            delimiter_index = 0;
            advance(lexer);
            lexer->mark_end(lexer);
            continue;
        }

        if (lexer->lookahead == '/') {
            delimiter_index = 0;
            advance(lexer);
            lexer->mark_end(lexer);
            if (lexer->lookahead == '/') {
                // Every line terminator ends it, `\r` included: ColdBox ships
                // CR-only files (cbi18n's `i18n.cfc`, and RustCFML has a test
                // fixture named after the problem), and stopping only at `\n`
                // made a single `//` comment swallow the whole file.
                while (lexer->lookahead && lexer->lookahead != '\n' && lexer->lookahead != '\r' &&
                       lexer->lookahead != 0x2028 && lexer->lookahead != 0x2029) {
                    advance(lexer);
                    lexer->mark_end(lexer);
                }
            } else if (lexer->lookahead == '*') {
                advance(lexer);
                lexer->mark_end(lexer);
                while (lexer->lookahead) {
                    if (lexer->lookahead == '*') {
                        advance(lexer);
                        lexer->mark_end(lexer);
                        if (lexer->lookahead == '/') {
                            advance(lexer);
                            lexer->mark_end(lexer);
                            break;
                        }
                        continue;
                    }
                    advance(lexer);
                    lexer->mark_end(lexer);
                }
            }
            continue;
        }

        if (lexer->lookahead == '<') {
            // `<` is the first character of the close delimiter, so it is
            // consumed WITHOUT `mark_end`: the token has to be able to end in
            // front of it. What follows decides whether it did open the close
            // tag, a CFML comment, or nothing.
            advance(lexer);

            if (lexer->lookahead == '!') {
                advance(lexer);
                unsigned dashes = 0;
                while (lexer->lookahead == '-') {
                    dashes++;
                    advance(lexer);
                }
                if (dashes >= 3) skip_cfml_comment_body(lexer);
                // The comment, and the `<` that opened it, are content.
                lexer->mark_end(lexer);
                delimiter_index = 0;
                continue;
            }

            if (cf_toupper(lexer->lookahead) == end_delimiter[1]) {
                delimiter_index = 2;
                advance(lexer);
                continue;
            }

            // An ordinary `<` — a comparison, or `<=`. It is content, so the
            // token may now cover it.
            delimiter_index = 0;
            lexer->mark_end(lexer);
            continue;
        }

        if (cf_toupper(lexer->lookahead) == end_delimiter[delimiter_index]) {
            delimiter_index++;
            if (delimiter_index == end_delim_len) {
                break;
            }
            advance(lexer);
        } else if (delimiter_index > 0) {
            // A partial match failed. What it consumed is content, and the
            // character that broke it may begin the delimiter itself: in
            // `x <</cfscript>` it is the `<` of the close tag. Advancing past
            // it here hid the close tag, and the rest of the document with it.
            // Only `<` can restart a match, and it only opens the delimiter,
            // so re-testing this one character is enough.
            delimiter_index = 0;
            lexer->mark_end(lexer);
        } else {
            advance(lexer);
            lexer->mark_end(lexer);
        }
    }

    lexer->result_symbol = CF_SCRIPT_CONTENT;
    return true;
}

static bool scan_cfsavecontent_body_type(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols, unsigned count, bool is_cfquery_context) {
    if (scanner->cf_tags.size == 0) return false;
    Tag *cf_tag = array_back(&scanner->cf_tags);
    if (cf_tag->type != CF_SAVECONTENT) return false;

    // Default to cfml
    unsigned result = CF_SAVECONTENT_BODY_CFML;

    // Mark end at current position - this is a zero-width token
    lexer->mark_end(lexer);

    // Peek ahead for <!--- @content TYPE --->
    // Skip whitespace first
    while (cf_isspace(lexer->lookahead)) advance(lexer);

    if (lexer->lookahead == '<') {
        advance(lexer);
        if (lexer->lookahead == '!') {
            advance(lexer);
            if (lexer->lookahead == '-') {
                advance(lexer);
                if (lexer->lookahead == '-') {
                    advance(lexer);
                    if (lexer->lookahead == '-') {
                        advance(lexer);
                        // Skip whitespace after <!---
                        while (cf_isspace(lexer->lookahead)) advance(lexer);
                        // Check for @content
                        const char *directive = "@content";
                        size_t di = 0;
                        bool matched = true;
                        while (di < 8) {
                            if (lexer->lookahead != directive[di]) { matched = false; break; }
                            advance(lexer);
                            di++;
                        }
                        if (matched) {
                            // Skip whitespace
                            while (cf_isspace(lexer->lookahead)) advance(lexer);
                            // Read type word
                            char type_buf[16];
                            int len = 0;
                            while (cf_isalpha(lexer->lookahead) && len < 15) {
                                type_buf[len++] = cf_tolower(lexer->lookahead);
                                advance(lexer);
                            }
                            type_buf[len] = '\0';
                            if (strcmp(type_buf, "script") == 0) result = CF_SAVECONTENT_BODY_SCRIPT;
                            else if (strcmp(type_buf, "css") == 0) result = CF_SAVECONTENT_BODY_CSS;
                            else if (strcmp(type_buf, "xml") == 0) result = CF_SAVECONTENT_BODY_XML;
                            else if (strcmp(type_buf, "sql") == 0) result = CF_SAVECONTENT_BODY_SQL;
                            else if (strcmp(type_buf, "raw") == 0) result = CF_SAVECONTENT_BODY_RAW;
                            else if (strcmp(type_buf, "html") == 0) result = CF_SAVECONTENT_BODY_HTML;
                        }
                    }
                }
            }
        }
    }

    if (!VS(valid_symbols, result, count)) return false;
    lexer->result_symbol = result;
    return true;
}

static bool scan_cfsavecontent_content(Scanner *scanner, TSLexer *lexer, bool is_cfquery_context) {
    if (scanner->cf_tags.size == 0) return false;
    Tag *cf_tag = array_back(&scanner->cf_tags);
    if (cf_tag->type != CF_SAVECONTENT) return false;

    lexer->mark_end(lexer);

    size_t tag_len = cf_tag->tag_name.size;
    if (tag_len > MAX_CF_END_DELIMITER_SIZE - 5) return false;

    char end_delimiter[MAX_CF_END_DELIMITER_SIZE];
    memcpy(end_delimiter, "</CF", 4);
    memcpy(&end_delimiter[4], cf_tag->tag_name.contents, tag_len);
    end_delimiter[4 + tag_len] = '\0';
    size_t end_delim_len = 4 + tag_len;

    bool has_content = false;

    while (lexer->lookahead) {
        if (lexer->lookahead == '<') {
            lexer->mark_end(lexer);
            advance(lexer);
            if (lexer->lookahead == '/') {
                advance(lexer);
                size_t i = 2;
                bool matched = true;
                while (i < end_delim_len) {
                    if (cf_toupper(lexer->lookahead) != end_delimiter[i]) { matched = false; break; }
                    i++;
                    if (i < end_delim_len) advance(lexer);
                }
                if (matched) {
                    lexer->result_symbol = CF_SAVECONTENT_CONTENT;
                    return has_content;
                }
            }
            has_content = true;
            lexer->mark_end(lexer);
        } else {
            has_content = true;
            advance(lexer);
            lexer->mark_end(lexer);
        }
    }

    lexer->result_symbol = CF_SAVECONTENT_CONTENT;
    return has_content;
}

// Whether a `#` in template text here opens an expression. In Lucee it does only
// inside the body of a tag that turns expression parsing on (CFMLTransformer
// evaluates text only while `data.parseExpression` is set), and once on it stays
// on for everything nested inside. The tags that turn it on are the ones whose
// `body-rtexprvalue` is true in core-base.tld — `output`, `mail`, `objectcache`,
// and `query`, whose body is the cfquery grammar's — plus `<cffunction>` and
// `<cfcomponent>` when their `output` is a literal true, which their attribute
// evaluators decide (see `peek_output_attribute_is_true`). Everywhere else the
// engine prints `#x#` as written.
//
// This used to count every `<cffunction>` and `<cfcomponent>` (#146), so a
// literal `#` in a tag-based function body — CSS in a `<style>`, `#top` in an
// href — opened an expression and broke the parse, and `<div>#x#</div>` there
// was highlighted as an expression the engine never evaluates. Lucee's own admin
// shows both halves: `debug/Simple.cfc` keeps a stylesheet's `#-lucee-debug` and
// hex colours in a function with no `output`, while `web_functions.cfm` writes
// `#arguments.isExpand ? 'expanded' : ''#` into a function with `output="true"`
// and no `<cfoutput>`, and means it to be evaluated.
static bool scanner_in_hash_eval_context(Scanner *scanner, bool is_cfquery_context) {
    if (scanner->cfoutput_depth > 0 || scanner->cfcomponent_output_depth > 0) {
        return true;
    }
    for (unsigned i = scanner->cf_tags.size; i > 0; i--) {
        if (i - 1 < 32 && (scanner->cffunction_output_mask >> (i - 1)) & 1) {
            return true;
        }
        const Tag *tag = &scanner->cf_tags.contents[i - 1];
        if (tag->type != CFML) continue;
        if ((tag->tag_name.size == 4 && memcmp(tag->tag_name.contents, "MAIL", 4) == 0) ||
            (tag->tag_name.size == 11 && memcmp(tag->tag_name.contents, "OBJECTCACHE", 11) == 0)) {
            return true;
        }
    }
    // A custom tag's attributes are evaluated wherever the tag is, which is
    // what lets `click="#URLEncodedFormat("a=b")#"` hold a quote of its own.
    // Outside this, an HTML attribute's `#` is text and the inner `"` really
    // does end the value, so the flag covers only an imported prefix's tag.
    return scanner->in_prefixed_start_tag;
}

static bool scan_raw_text(Scanner *scanner, TSLexer *lexer, bool is_cfquery_context) {
    if (scanner->tags.size == 0) {
        return false;
    }

    lexer->mark_end(lexer);

    const char *end_delimiter = array_back(&scanner->tags)->type == SCRIPT ? "</SCRIPT" : "</STYLE";
    // Both delimiters are literals, but the compiler cannot fold a `strlen` of
    // the ternary's result, so it was running one per matching character.
    const unsigned end_delimiter_len = array_back(&scanner->tags)->type == SCRIPT ? 8 : 7;

    bool stop_at_cfml = !is_cfquery_context &&
        (array_back(&scanner->tags)->type == SCRIPT || array_back(&scanner->tags)->type == STYLE);

    bool has_content = false;
    unsigned delimiter_index = 0;
    while (lexer->lookahead) {
        // CFML boundary checks (only when not mid-delimiter match)
        if (stop_at_cfml && delimiter_index == 0) {
            if (lexer->lookahead == '#' && scanner_in_hash_eval_context(scanner, is_cfquery_context)) {
                break;
            }
            if (lexer->lookahead == '<') {
                advance(lexer);
                if (cf_toupper(lexer->lookahead) == 'C') {
                    advance(lexer);
                    if (cf_toupper(lexer->lookahead) == 'F') {
                        // Stop before <cf
                        break;
                    }
                    lexer->mark_end(lexer);
                    has_content = true;
                    continue;
                } else if (lexer->lookahead == '/') {
                    advance(lexer);
                    if (cf_toupper(lexer->lookahead) == 'C') {
                        advance(lexer);
                        if (cf_toupper(lexer->lookahead) == 'F') {
                            // Stop before </cf
                            break;
                        }
                        lexer->mark_end(lexer);
                        has_content = true;
                        continue;
                    } else if (cf_toupper(lexer->lookahead) == end_delimiter[2]) {
                        // Potential </script or </style
                        delimiter_index = 3;
                        advance(lexer);
                        continue;
                    }
                    lexer->mark_end(lexer);
                    has_content = true;
                    continue;
                } else if (lexer->lookahead == '!') {
                    // A CFML comment is stripped by the engine before anything
                    // inside it is evaluated, so a `#` in there never starts a
                    // hash expression. Swallow the whole comment as raw text so
                    // the `#` in `<!--- see http://x/#anchor --->` cannot open
                    // one. Extras are not reachable inside a script element, so
                    // it cannot be tokenised as a comment node here.
                    advance(lexer);
                    if (lexer->lookahead == '-') {
                        advance(lexer);
                        if (lexer->lookahead == '-') {
                            advance(lexer);
                            if (lexer->lookahead == '-') {
                                skip_cfml_comment_body(lexer);
                                lexer->mark_end(lexer);
                                has_content = true;
                                continue;
                            }
                        }
                    }
                    lexer->mark_end(lexer);
                    has_content = true;
                    continue;
                } else {
                    lexer->mark_end(lexer);
                    has_content = true;
                    continue;
                }
            }
        }

        if (cf_toupper(lexer->lookahead) == end_delimiter[delimiter_index]) {
            delimiter_index++;
            if (delimiter_index == end_delimiter_len) {
                break;
            }
            advance(lexer);
        } else if (delimiter_index > 0) {
            // A failed partial match: keep what it consumed as content and
            // re-test this character, which may open the delimiter (`</s</script>`).
            // See scan_cfquery_content.
            delimiter_index = 0;
            lexer->mark_end(lexer);
            has_content = true;
        } else {
            advance(lexer);
            lexer->mark_end(lexer);
            has_content = true;
        }
    }

    if (!has_content) {
        return false;
    }

    lexer->result_symbol = RAW_TEXT;
    return true;
}

static void pop_tag(Scanner *scanner, bool is_cf_context) {
    if ( is_cf_context ) {
        Tag popped_tag = array_pop(&scanner->cf_tags);
        tag_free(&popped_tag);
    } else {
        Tag popped_tag = array_pop(&scanner->tags);
        tag_free(&popped_tag);
    }
}

// Whether a CF tag's end tag is optional, so an unpaired one is a whole tag
// with no body: a custom tag (`<cf_foo>`, whose stored name is `_FOO`) or
// `<cfmodule>`.
static bool cf_tag_end_is_optional(const Tag *tag) {
    if (tag->type != CFML) {
        return false;
    }
    const String *name = &tag->tag_name;
    return (name->size > 0 && name->contents[0] == '_') ||
           (name->size == 6 && memcmp(name->contents, "MODULE", 6) == 0);
}

// Whether an HTML element called `name` is open among the first `depth`
// entries of the HTML stack: the ones already open when a CF tag pushed at
// that depth was opened.
static bool html_tag_open_below(const Scanner *scanner, unsigned depth, const String *name) {
    String copy = array_new();
    array_extend(&copy, name->size, name->contents);
    Tag html = tag_for_name(copy);
    bool found = false;
    for (unsigned i = depth < scanner->tags.size ? depth : scanner->tags.size; i > 0; i--) {
        if (tag_eq(&scanner->tags.contents[i - 1], &html)) {
            found = true;
            break;
        }
    }
    tag_free(&html);
    return found;
}

// The name of the nearest CF tag below the innermost one that must be closed,
// or NULL when there is none. An optional-end tag (another custom tag) is not a
// boundary: it may have no end tag at all.
static const String *enclosing_block_cf_tag_name(const Scanner *scanner) {
    for (unsigned i = scanner->cf_tags.size - 1; i > 0; i--) {
        const Tag *tag = &scanner->cf_tags.contents[i - 1];
        if (!cf_tag_end_is_optional(tag)) {
            return &tag->tag_name;
        }
    }
    return NULL;
}

// Whether the rest of the document pairs the CF tag stored as `name`: a
// `</cf<name>` appears before anything that settles it the other way. The
// engine gives a custom tag a body exactly when its end tag exists, so this is
// what tells an unpaired `<cf_foo>` from a paired one that crosses an HTML
// boundary (`<div><cf_foo>body</div></cf_foo>`). Closing the paired one at
// `</div>` strands its `</cf_foo>`, which is an ERROR.
//
// It stops early, which is what keeps it linear. Scanning to the end of the
// document at every decision was quadratic in exactly the common case: 4,000
// unpaired custom tags in divs, with no end tag anywhere, parsed in 3.2 s
// against 132 ms. The scan stops at:
//
// - another `<cf<name>` start tag. The one still open is unpaired, and a later
//   `</cf<name>` belongs to the new one. Also the more correct answer, since
//   `<div><cf_foo></div><p><cf_foo>b</cf_foo></p>` closes the first.
// - the end tag of the nearest enclosing block CF tag, `boundary` (NULL at
//   the top level). CF tags nest properly, so no end tag lies beyond it.
// - end of input.
//
// CFML comments are skipped. Read-ahead only: the caller's token is zero-width
// and already marked, so nothing read here becomes part of it.
static bool cf_end_tag_follows(TSLexer *lexer, const String *name, const String *boundary) {
    char word[65];
    while (!lexer->eof(lexer)) {
        if (lexer->lookahead != '<') {
            advance(lexer);
            continue;
        }
        advance(lexer);
        if (lexer->lookahead == '!') {
            advance(lexer);
            unsigned dashes = 0;
            while (lexer->lookahead == '-') {
                dashes++;
                advance(lexer);
            }
            if (dashes >= 3) {
                skip_cfml_comment_body(lexer);
            }
            continue;
        }
        bool closing = lexer->lookahead == '/';
        if (closing) advance(lexer);
        if (cf_tolower(lexer->lookahead) != 'c') continue;
        advance(lexer);
        if (cf_tolower(lexer->lookahead) != 'f') continue;
        advance(lexer);
        unsigned len = 0;
        for (;;) {
            int32_t c = lexer->lookahead;
            if (!cf_isalnum(c) && c != '_' && c != '-' && c != ':' && c != '.') break;
            if (len < sizeof(word) - 1) word[len] = (char)cf_toupper(c);
            len++;
            advance(lexer);
        }
        if (len >= sizeof(word)) continue;
        bool is_name = len == name->size && memcmp(word, name->contents, len) == 0;
        if (is_name) return closing;
        if (closing && boundary && len == boundary->size &&
                memcmp(word, boundary->contents, len) == 0) {
            return false;
        }
    }
    return false;
}

static bool scan_implicit_end_tag(Scanner *scanner, TSLexer *lexer, bool is_cf_context, bool is_cfquery_context, bool from_tag_open) {

    Tag *parent = is_cf_context
        ? (scanner->cf_tags.size == 0 ? NULL : array_back(&scanner->cf_tags))
        : (scanner->tags.size == 0 ? NULL : array_back(&scanner->tags));

    bool is_closing_tag = false;
    if (lexer->lookahead == '/') {
        is_closing_tag = true;
        advance(lexer);
    } else {
        // Void tag processing
        if (!is_cf_context && parent && tag_is_void(parent)) {
            pop_tag(scanner, false);
            lexer->result_symbol = IMPLICIT_END_TAG;
            return true;
        }
        // Void tag processing
        if (is_cf_context && parent && cf_tag_is_void(parent)) {
            pop_tag(scanner, true);
            lexer->result_symbol = IMPLICIT_CF_END_TAG;
            return true;
        }
    }

    TagNameResult result = scan_tag_name(lexer, is_cfquery_context);
    if (result.tag_name.size == 0 && !lexer->eof(lexer)) {
        array_delete(&result.tag_name);
        return false;
    }
    // The same name the start or end tag will build, so a `</h#x#>` can close
    // what is open inside its `<h#x#>`. Lookahead only: this token is zero-width,
    // so what the span reads is never part of it.
    if (!result.is_cf_tag && !is_cfquery_context) {
        while (lexer->lookahead == '#' && scan_tag_name_hash_span(lexer, &result.tag_name)) {}
    }

    if (result.is_cf_tag && !is_closing_tag &&
        ((result.tag_name.size == 4 && memcmp(result.tag_name.contents, "ELSE", 4) == 0) ||
         (result.tag_name.size == 6 && memcmp(result.tag_name.contents, "ELSEIF", 6) == 0))) {
        array_delete(&result.tag_name);
        if (is_cf_context && parent &&
            parent->type != CF_IF && parent->type != CF_ELSEIF && parent->type != CF_ELSE) {
            pop_tag(scanner, true);
            lexer->result_symbol = IMPLICIT_CF_END_TAG;
            return true;
        }
        if (!is_cf_context && scanner->tags.size > 0) {
            // Check if there's a CF_IF on the cf_tags stack whose html_depth
            // is less than current tags.size (meaning HTML tags opened inside cfif)
            for (unsigned i = scanner->cf_tags.size; i > 0; i--) {
                Tag *ct = &scanner->cf_tags.contents[i - 1];
                if (ct->type == CF_IF || ct->type == CF_ELSEIF || ct->type == CF_ELSE) {
                    if (scanner->tags.size > ct->html_depth) {
                        pop_tag(scanner, false);
                        lexer->result_symbol = IMPLICIT_END_TAG;
                        return true;
                    }
                    break;
                }
            }
        }
        return false;
    }

    if (result.is_cf_tag && !is_cf_context && is_closing_tag) {
        // A CF closing tag in HTML context: only implicitly close HTML tags
        // that were opened inside this CF tag (i.e. tags.size > cf html_depth)
        Tag cf_next = cf_tag_for_name(result.tag_name);
        unsigned cf_html_depth = 0;
        bool found = false;
        for (unsigned i = scanner->cf_tags.size; i > 0; i--) {
            if (tag_eq(&scanner->cf_tags.contents[i - 1], &cf_next)) {
                cf_html_depth = scanner->cf_tags.contents[i - 1].html_depth;
                found = true;
                break;
            }
        }
        tag_free(&cf_next);
        if (found && scanner->tags.size > cf_html_depth) {
            pop_tag(scanner, false);
            lexer->result_symbol = IMPLICIT_END_TAG;
            return true;
        }
        return false;
    }

    if (result.is_cf_tag && !is_cf_context) {
        array_delete(&result.tag_name);
        return false;
    }

    // An HTML end tag for an element opened outside the innermost CF tag,
    // when that tag's end tag is optional. An unpaired `<cf_foo …>` has no
    // body: the engine runs it once, with `thisTag.hasEndTag` false. So in
    // `<div><cf_foo></div>` the `</div>` is the div's. It used to be an
    // `erroneous_end_tag` inside the custom tag, and the div got an invented
    // end instead (#160). Closing the custom tag here is what an HTML end tag
    // already does to an open HTML child. Only when no HTML element is open
    // inside the custom tag: those close first, through the HTML path. And
    // only when the custom tag is really unpaired: a `</cf_foo>` later in the
    // document gives it a body, and it stays open (see cf_end_tag_follows).
    if (is_cf_context && is_closing_tag && !result.is_cf_tag && parent &&
            cf_tag_end_is_optional(parent) && scanner->tags.size <= parent->html_depth &&
            html_tag_open_below(scanner, parent->html_depth, &result.tag_name) &&
            !cf_end_tag_follows(lexer, &parent->tag_name, enclosing_block_cf_tag_name(scanner))) {
        array_delete(&result.tag_name);
        pop_tag(scanner, true);
        lexer->result_symbol = IMPLICIT_CF_END_TAG;
        return true;
    }

    Tag next_tag = is_cf_context ? cf_tag_for_name(result.tag_name) : tag_for_name(result.tag_name);

    if (is_closing_tag) {
        // The tag correctly closes the topmost element on the stack
        if (is_cf_context ? (scanner->cf_tags.size > 0 && tag_eq(array_back(&scanner->cf_tags), &next_tag))
                          : (scanner->tags.size > 0 && tag_eq(array_back(&scanner->tags), &next_tag))) {
            // Before accepting the CF close, check if HTML tags opened inside
            // this CF tag need implicit closing (e.g. <cfloop><span></cfloop>)
            if (is_cf_context && scanner->tags.size > array_back(&scanner->cf_tags)->html_depth) {
                pop_tag(scanner, false);
                lexer->result_symbol = IMPLICIT_END_TAG;
                tag_free(&next_tag);
                return true;
            }
            tag_free(&next_tag);
            return false;
        }

        // if (is_cf ? (scanner->cf_tags.size > 0 && !tag_eq(array_back(&scanner->cf_tags), &next_tag))
        //                   : (scanner->tags.size > 0 && !tag_eq(array_back(&scanner->tags), &next_tag))) {
        //     pop_tag(scanner, is_cf);
        //     lexer->result_symbol = is_cf ? IMPLICIT_CF_END_TAG : IMPLICIT_END_TAG;
        //     tag_free(&next_tag);
        //     return true;
        // }

        // Otherwise, dig deeper and queue implicit end tags (to be nice in
        // the case of malformed HTML)
        if (is_cf_context) {
            for (unsigned i = scanner->cf_tags.size; i > 0; i--) {
                if (tag_eq(&scanner->cf_tags.contents[i - 1], &next_tag)) {
                    pop_tag(scanner, true);
                    lexer->result_symbol = IMPLICIT_CF_END_TAG;
                    tag_free(&next_tag);
                    return true;
                }
            }
        } else {
            for (unsigned i = scanner->tags.size; i > 0; i--) {
                if (tag_eq(&scanner->tags.contents[i - 1], &next_tag)) {
                    pop_tag(scanner, false);
                    lexer->result_symbol = IMPLICIT_END_TAG;
                    tag_free(&next_tag);
                    return true;
                }
            }
        }
    } else {

        if (from_tag_open && is_cf_context && !result.is_cf_tag && parent && tag_eq(parent, &next_tag)) {
            pop_tag(scanner, true);
            lexer->result_symbol = IMPLICIT_CF_END_TAG;
            tag_free(&next_tag);
            return true;
        }

        if (!is_cf_context && parent && tag_eq(parent, &next_tag) && tag_implicitly_closes_self(parent)) {
            pop_tag(scanner, false);
            lexer->result_symbol = IMPLICIT_END_TAG;
            tag_free(&next_tag);
            return true;
        }

        if (
            parent &&
            (
                (lexer->eof(lexer))
                || (is_cf_context && lexer->eof(lexer))
            )
        ) {
            pop_tag(scanner, is_cf_context);
            lexer->result_symbol = is_cf_context ? IMPLICIT_CF_END_TAG : IMPLICIT_END_TAG;
            tag_free(&next_tag);
            return true;
        }
    }

    tag_free(&next_tag);
    return false;
}

// Whether the `output` attribute of the `<cffunction>` or `<cfcomponent>` whose
// name was just read is a literal true — the one case in which Lucee evaluates
// `#` in that tag's body. Its attribute evaluators (`attributes.impl.Function`,
// `.Component`) turn body parsing on exactly then, and a non-literal `output` is
// a compile error, so `true`, `yes`, a non-zero integer and `#true#` are the
// whole of it. The caller has marked the token's end at the name; this reads on
// to the tag's `>` without consuming anything.
static bool peek_output_attribute_is_true(TSLexer *lexer) {
    bool output = false;
    for (;;) {
        while (cf_isspace(lexer->lookahead)) advance(lexer);
        // `/>`, `>`, the end of input, or anything that is not an attribute
        // name (a comment, a stray `<`) ends the tag as far as this is concerned.
        char name[7];
        unsigned name_len = 0;
        while (cf_isalnum(lexer->lookahead) || lexer->lookahead == '-' ||
               lexer->lookahead == '_' || lexer->lookahead == ':') {
            if (name_len < sizeof(name)) name[name_len] = (char)cf_toupper(lexer->lookahead);
            name_len++;
            advance(lexer);
        }
        if (name_len == 0) return output;
        const bool is_output = name_len == 6 && memcmp(name, "OUTPUT", 6) == 0;

        while (cf_isspace(lexer->lookahead)) advance(lexer);
        if (lexer->lookahead != '=') {
            if (is_output) output = false;
            continue;
        }
        advance(lexer);
        while (cf_isspace(lexer->lookahead)) advance(lexer);

        // The value, upper-cased; anything longer than `#TRUE#` is not true.
        char value[7];
        unsigned value_len = 0;
        int32_t quote = 0;
        if (lexer->lookahead == '"' || lexer->lookahead == '\'') {
            quote = lexer->lookahead;
            advance(lexer);
        }
        bool in_hash = false;
        for (;;) {
            int32_t c = lexer->lookahead;
            if (c == 0) return false;
            if (quote) {
                if (c == quote && !in_hash) {
                    advance(lexer);
                    if (lexer->lookahead != quote) break;
                } else if (in_hash && (c == '"' || c == '\'')) {
                    // A string inside `#...#` may hold the attribute's own quote.
                    advance(lexer);
                    while (lexer->lookahead && lexer->lookahead != c) advance(lexer);
                    if (!lexer->lookahead) return false;
                }
            } else if (cf_isspace(c) || c == '>' || (c == '/' && !in_hash)) {
                break;
            }
            if (c == '#') in_hash = !in_hash;
            if (value_len < sizeof(value)) value[value_len] = (char)cf_toupper(c);
            value_len++;
            advance(lexer);
        }
        if (!is_output) continue;

        output = false;
        if ((value_len == 4 && memcmp(value, "TRUE", 4) == 0) ||
            (value_len == 3 && memcmp(value, "YES", 3) == 0) ||
            (value_len == 6 && memcmp(value, "#TRUE#", 6) == 0)) {
            output = true;
        } else if (value_len > 0 && value_len <= sizeof(value)) {
            bool digits = true, nonzero = false;
            for (unsigned i = 0; i < value_len; i++) {
                if (!cf_isdigit(value[i])) digits = false;
                else if (value[i] != '0') nonzero = true;
            }
            output = digits && nonzero;
        }
    }
}

// Whether an HTML-side tag name — `CONTROL:HIDDENFIELD`, upper-cased by
// `scan_tag_name` — starts with a prefix the template imported.
static bool has_import_prefix(const Scanner *scanner, const String *name) {
    unsigned colon = 0;
    while (colon < name->size && name->contents[colon] != ':') colon++;
    if (colon == 0 || colon == name->size) return false;
    for (unsigned i = 0; i < scanner->import_prefixes_len;) {
        uint8_t len = (uint8_t)scanner->import_prefixes[i];
        if (len == colon && memcmp(&scanner->import_prefixes[i + 1], name->contents, len) == 0) {
            return true;
        }
        i += 1 + len;
    }
    return false;
}

static void record_import_prefix(Scanner *scanner, const char *prefix, unsigned len,
                                 bool is_cfquery_context) {
    if (len == 0 || len > IMPORT_PREFIX_MAX_LEN) return;
    for (unsigned i = 0; i < scanner->import_prefixes_len;) {
        uint8_t have = (uint8_t)scanner->import_prefixes[i];
        if (have == len && memcmp(&scanner->import_prefixes[i + 1], prefix, len) == 0) return;
        i += 1 + have;
    }
    if (scanner->import_prefixes_len + 1 + len > IMPORT_PREFIX_BYTES) return;
    // A prefix is only kept if the state still serialises with it. Tags already
    // on the stack were pushed against the budget without it, so this is the
    // one place the import section can grow past what they left free; dropping
    // the prefix leaves its tags parsed as plain HTML, which is today's answer.
    if (tag_stacks_size(scanner, is_cfquery_context) + scanner_fixed_size(scanner) + 1 + len >
        TREE_SITTER_SERIALIZATION_BUFFER_SIZE) {
        return;
    }
    scanner->import_prefixes[scanner->import_prefixes_len] = (char)len;
    memcpy(&scanner->import_prefixes[scanner->import_prefixes_len + 1], prefix, len);
    scanner->import_prefixes_len += 1 + len;
}

// Reads the attributes of a `<cfimport …>` for `prefix="…"`, as lookahead: the
// caller has already fixed the tag-name token with `mark_end`, so nothing
// consumed here belongs to it, and the grammar lexes the attributes itself.
//
// The scan is the scanner's own because a custom tag's attributes are the one
// place the grammar needs to know a prefix before it has parsed anything that
// names one. It stops at the tag's end, at anything that is not an attribute,
// and after a fixed number of characters, so a malformed or unterminated
// `<cfimport` costs at most that — the state an editor is in mid-keystroke.
// A `#…#` prefix is dynamic and is not recorded.
static void capture_import_prefix(Scanner *scanner, TSLexer *lexer, bool is_cfquery_context) {
    unsigned budget = 1024;
    while (budget > 0 && lexer->lookahead != 0) {
        while (budget > 0 && cf_isspace(lexer->lookahead)) { advance(lexer); budget--; }

        char name[8];
        unsigned name_len = 0;
        bool name_fits = true;
        while (budget > 0 && (cf_isalnum(lexer->lookahead) || lexer->lookahead == '_' ||
                              lexer->lookahead == '-')) {
            if (name_len < sizeof(name)) name[name_len++] = (char)cf_tolower(lexer->lookahead);
            else name_fits = false;
            advance(lexer);
            budget--;
        }
        if (name_len == 0) return;

        while (budget > 0 && cf_isspace(lexer->lookahead)) { advance(lexer); budget--; }
        if (lexer->lookahead != '=') continue;
        advance(lexer);
        budget--;
        while (budget > 0 && cf_isspace(lexer->lookahead)) { advance(lexer); budget--; }

        int32_t quote = 0;
        if (lexer->lookahead == '"' || lexer->lookahead == '\'') {
            quote = lexer->lookahead;
            advance(lexer);
            budget--;
        }

        char value[IMPORT_PREFIX_MAX_LEN];
        unsigned value_len = 0;
        bool value_ok = true;
        while (budget > 0 && lexer->lookahead != 0) {
            int32_t c = lexer->lookahead;
            if (quote ? c == quote : (cf_isspace(c) || c == '>' || c == '/')) break;
            if (c == '<' && !quote) return;
            if ((cf_isalnum(c) || c == '_' || c == '-') && c < 128 && value_len < sizeof(value)) {
                value[value_len++] = (char)cf_toupper(c);
            } else {
                value_ok = false;
            }
            advance(lexer);
            budget--;
        }
        if (quote) {
            if (lexer->lookahead != quote) return;
            advance(lexer);
            budget--;
        }

        if (name_fits && name_len == 6 && memcmp(name, "prefix", 6) == 0) {
            if (value_ok) record_import_prefix(scanner, value, value_len, is_cfquery_context);
            return;
        }
    }
}

static bool scan_start_tag_name(Scanner *scanner, TSLexer *lexer, bool is_cf_context, bool is_cfquery_context) {

    scanner->in_prefixed_start_tag = false;

    // Dynamic tag name: <#expression#>
    if (lexer->lookahead == '#') {
        Tag tag = tag_new();
        tag.type = DYNAMIC;
        array_push(&scanner->tags, tag);
        lexer->result_symbol = START_TAG_NAME;
        return true;
    }

    TagNameResult result = scan_tag_name(lexer, is_cfquery_context);

    if (result.tag_name.size == 0) {
        array_delete(&result.tag_name);
        return false;
    }

    if ( result.is_cf_tag && !is_cf_context ) {
        array_delete(&result.tag_name);
        return false;
    }

    if (!is_cf_context) scan_dynamic_tag_name_suffix(lexer, &result, is_cfquery_context);

    // bool is_cf = result.is_cf_tag || is_cf_context;
    Tag tag = is_cf_context ? cf_tag_for_name(result.tag_name) : tag_for_name(result.tag_name);
    bool function_output = false;

    // printf("scan_start_tag_name: tag=%.*s, is_cf_tag=%d, is_cf_context=%d, type=%d\n",
    // (int)result.tag_name.size, result.tag_name.contents, result.is_cf_tag, is_cf_context, tag.type);

    switch (tag.type) {
        case SCRIPT:
            lexer->result_symbol = SCRIPT_START_TAG_NAME;
            break;
        case STYLE:
            lexer->result_symbol = STYLE_START_TAG_NAME;
            break;
        case CF_VOID:
            if (is_cf_context && tag.tag_name.size == 9 &&
                memcmp(tag.tag_name.contents, "COMPONENT", 9) == 0) {
                lexer->mark_end(lexer);
                if (peek_output_attribute_is_true(lexer) && scanner->cfcomponent_output_depth == 0) {
                    scanner->cfcomponent_output_depth = scanner->cfcomponent_depth + 1;
                }
                scanner->cfcomponent_depth++;
                lexer->result_symbol = CF_COMPONENT_START_TAG_NAME;
            } else {
                lexer->result_symbol = CF_VOID_START_TAG_NAME;
                if (is_cf_context && tag.tag_name.size == 6 &&
                    memcmp(tag.tag_name.contents, "IMPORT", 6) == 0) {
                    lexer->mark_end(lexer);
                    capture_import_prefix(scanner, lexer, is_cfquery_context);
                }
            }
            tag_free(&tag);
            return true;
        case CF_SET:
            lexer->result_symbol = CF_SET_START_TAG_NAME;
            return true;
        case CF_RETURN:
            lexer->result_symbol = CF_RETURN_START_TAG_NAME;
            return true;
        case CF_IF:
            lexer->result_symbol = CF_IF_START_TAG_NAME;
            break;
        case CF_ELSEIF:
            lexer->result_symbol = CF_ELSEIF_TAG_NAME;
            return true;
        case CF_ELSE:
            lexer->result_symbol = CF_ELSE_TAG_NAME;
            return true;
        case CF_XML:
            lexer->result_symbol = CF_XML_START_TAG_NAME;
            break;
        case CF_QUERY:
            lexer->result_symbol = CF_QUERY_START_TAG_NAME;
            break;
        case CF_SCRIPT:
            lexer->result_symbol = CF_SCRIPT_START_TAG_NAME;
            break;
         case CF_SAVECONTENT:
            lexer->result_symbol = CF_SAVECONTENT_START_TAG_NAME;
            break;
        case CF_OUTPUT:
            lexer->result_symbol = CF_OUTPUT_START_TAG_NAME;
            if (is_cf_context) {
                scanner->cfoutput_depth++;
            }
            break;
        case CF_FUNCTION:
            lexer->result_symbol = CF_FUNCTION_START_TAG_NAME;
            if (is_cf_context) {
                lexer->mark_end(lexer);
                function_output = peek_output_attribute_is_true(lexer);
            }
            break;
        default:
            lexer->result_symbol = is_cf_context ? CF_START_TAG_NAME : START_TAG_NAME;
            break;
    }

    // A custom tag whose push would break the serialize/deserialize round trip
    // does not nest. `CFML` is the type `cf_tag_for_name` gives an unrecognised
    // `<cf_foo>` — `CUSTOM` is the HTML-side type and never reaches here. `CUSTOM` only, and deliberately: the cases above this point
    // that reach the push also bump a depth counter (`cfoutput`, `cffunction`,
    // `cfcomponent`), so bailing out here would leave the counter incremented
    // for a tag that was never pushed. A `<cf_foo>` run is the shape that
    // actually reaches ~1KB of stack, and `CF_VOID_START_TAG_NAME` completes
    // such an element without an end tag — the same symbol the void tags in
    // `CF_VOID_TAGS` use, so no new grammar rule is needed.
    //
    // The tag stops nesting rather than the document being lost. Whether an
    // unpaired custom tag should nest AT ALL is the open question on #55; this
    // does not settle it, it stops the failure being unrecoverable.
    if (is_cf_context && tag.type == CFML &&
        tag_stack_would_overflow(scanner, &tag, is_cfquery_context)) {
        lexer->result_symbol = CF_VOID_START_TAG_NAME;
        tag_free(&tag);
        return true;
    }

    // The HTML side of the same problem, with a wider margin — see
    // `CUSTOM_HTML_TAG_HEADROOM`. The symbol is already START_TAG_NAME; what
    // changes is that the pushed tag is void, so the next token closes it the
    // way it closes an `<input>`, instead of everything after it nesting inside.
    if (!is_cf_context && tag.type == CUSTOM) {
        // A `<control:x>` whose prefix the template imported is a custom tag
        // call, and CFML evaluates `#…#` in its attributes.
        scanner->in_prefixed_start_tag = has_import_prefix(scanner, &tag.tag_name);
        if (tag_stack_would_overflow_by(scanner, &tag, is_cfquery_context,
                                        TAG_STACK_HEADROOM + CUSTOM_HTML_TAG_HEADROOM)) {
            tag_free(&tag);
            tag = tag_new();
            tag.type = CUSTOM_VOID;
        }
    }

    if ( is_cf_context ) {
        tag.html_depth = scanner->tags.size;
        if (scanner->cf_tags.size < 32) {
            const uint32_t bit = (uint32_t)1 << scanner->cf_tags.size;
            if (function_output) {
                scanner->cffunction_output_mask |= bit;
            } else {
                scanner->cffunction_output_mask &= ~bit;
            }
        }
        array_push(&scanner->cf_tags, tag);
    } else {
        array_push(&scanner->tags, tag);
    }

    return true;
}

static void set_end_tag_symbol(Scanner *scanner, TSLexer *lexer, Tag *tag, bool is_cf_context, bool is_cfquery_context) {
    if (is_cf_context && tag->type == CF_OUTPUT) {
        if (scanner->cfoutput_depth > 0) scanner->cfoutput_depth--;
        lexer->result_symbol = CF_END_TAG_NAME;
    } else if (is_cf_context && tag->type == CF_FUNCTION) {
        lexer->result_symbol = CF_FUNCTION_END_TAG_NAME;
    } else if (is_cf_context && tag->type == CF_XML) {
        lexer->result_symbol = CF_XML_END_TAG_NAME;
    } else if (is_cf_context && tag->type == CF_QUERY) {
        lexer->result_symbol = CF_QUERY_END_TAG_NAME;
    } else if (is_cf_context && tag->type == CF_SCRIPT) {
        lexer->result_symbol = CF_SCRIPT_END_TAG_NAME;
    } else if (is_cf_context && tag->type == CF_SAVECONTENT) {
        lexer->result_symbol = CF_SAVECONTENT_END_TAG_NAME;
    } else if (is_cf_context && tag->type == CF_IF) {
        lexer->result_symbol = CF_IF_END_TAG_NAME;
    } else {
        lexer->result_symbol = is_cf_context ? CF_END_TAG_NAME : END_TAG_NAME;
    }
}

static bool scan_end_tag_name(Scanner *scanner, TSLexer *lexer, bool is_cf_context, bool is_cfquery_context) {

    scanner->in_prefixed_start_tag = false;

    // Dynamic closing tag: </#expression#>
    if (lexer->lookahead == '#') {
        if (scanner->tags.size > 0 && array_back(&scanner->tags)->type == DYNAMIC) {
            pop_tag(scanner, false);
        }
        lexer->result_symbol = END_TAG_NAME;
        return true;
    }

    TagNameResult result = scan_tag_name(lexer, is_cfquery_context);

    if (result.tag_name.size == 0) {
        array_delete(&result.tag_name);
        return false;
    }

    if ( result.is_cf_tag && !is_cf_context ) {
        array_delete(&result.tag_name);
        return false;
    }

    if (!is_cf_context) scan_dynamic_tag_name_suffix(lexer, &result, is_cfquery_context);

    // printf("scan_end_tag_name: tag=%.*s, is_cf_context=%d, tags.size=%d, cf_tags.size=%d\n",
    // (int)result.tag_name.size, result.tag_name.contents, is_cf_context,
    // scanner->tags.size, scanner->cf_tags.size);

    // bool is_cf = result.is_cf_tag || is_cf_context;

    Tag tag = is_cf_context ? cf_tag_for_name(result.tag_name) : tag_for_name(result.tag_name);

    // cfcomponent is a void tag (never pushed); just decrement depth
    if (is_cf_context && tag.type == CF_VOID &&
        tag.tag_name.size == 9 && memcmp(tag.tag_name.contents, "COMPONENT", 9) == 0) {
        if (scanner->cfcomponent_depth > 0) scanner->cfcomponent_depth--;
        if (scanner->cfcomponent_output_depth > scanner->cfcomponent_depth) {
            scanner->cfcomponent_output_depth = 0;
        }
        lexer->result_symbol = CF_COMPONENT_END_TAG_NAME;
        tag_free(&tag);
        return true;
    }

    // Determine the minimum HTML stack index we can search to.
    // CF control-flow tags record html_depth when pushed; don't search below that.
    unsigned html_floor = 0;
    if (!is_cf_context && scanner->cf_tags.size > 0) {
        html_floor = array_back(&scanner->cf_tags)->html_depth;
    }

    Tag *tag_back = (is_cf_context) ? ( scanner->cf_tags.size > 0 ? array_back(&scanner->cf_tags) : NULL )
                   : ( scanner->tags.size > html_floor) ? array_back(&scanner->tags) : NULL;

    if ( tag_back && tag_eq(tag_back, &tag) ) {
        pop_tag(scanner, is_cf_context);
        set_end_tag_symbol(scanner, lexer, &tag, is_cf_context, is_cfquery_context);
    } else {
        // Search deeper in the stack for a matching tag
        bool found = false;
        if (is_cf_context) {
            for (unsigned i = scanner->cf_tags.size; i > 0; i--) {
                if (tag_eq(&scanner->cf_tags.contents[i - 1], &tag)) {
                    found = true;
                    break;
                }
            }
        } else {
            for (unsigned i = scanner->tags.size; i > html_floor; i--) {
                if (tag_eq(&scanner->tags.contents[i - 1], &tag)) {
                    found = true;
                    break;
                }
            }
        }

        if (found) {
            pop_tag(scanner, is_cf_context);
            set_end_tag_symbol(scanner, lexer, &tag, is_cf_context, is_cfquery_context);
        } else {
            lexer->result_symbol = is_cf_context ? ERRONEOUS_CF_END_TAG_NAME : ERRONEOUS_END_TAG_NAME;
        }
    }

    tag_free(&tag);
    return true;
}

static bool scan_cf_self_closing_tag_delimiter(Scanner *scanner, TSLexer *lexer, bool is_void, bool is_cfquery_context) {
     if (lexer->lookahead == '>') {
        advance(lexer);
        // Explicit, because the dispatcher marks an end before its whitespace
        // skip where an automatic semicolon is valid (#148), and `/>` is
        // scanned in one of those states.
        lexer->mark_end(lexer);
        if (is_void) {
            lexer->result_symbol = CF_SELF_CLOSING_VOID_TAG_DELIMITER;
        } else {
            lexer->result_symbol = CF_SELF_CLOSING_TAG_DELIMITER;
            if (scanner->cf_tags.size > 0) {
                pop_tag(scanner, true);
            }

        }
        return true;
    }
    return false;
}

static bool scan_self_closing_tag_delimiter(Scanner *scanner, TSLexer *lexer, bool is_cfquery_context) {
     if (lexer->lookahead == '>') {
        scanner->in_prefixed_start_tag = false;
        advance(lexer);
        if (scanner->tags.size > 0) {
            pop_tag(scanner, false);
        }
        lexer->result_symbol = SELF_CLOSING_TAG_DELIMITER;
        return true;
    }
    return false;
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

static bool automatic_semicolon_after_newline(TSLexer *lexer, bool *scanned_comment, bool is_cfquery_context);

// `end_marked`: the dispatcher marked the end before skipping the whitespace
// that precedes the lexer, so the semicolon is already fixed, zero-width, at the
// end of the statement. Marking again here would move it past that whitespace,
// and the statement and every node it closes would end there too.
static bool scan_automatic_semicolon(TSLexer *lexer, bool comment_condition, bool *scanned_comment, bool is_cfquery_context, bool end_marked) {
    lexer->result_symbol = AUTOMATIC_SEMICOLON;
    if (!end_marked) {
        lexer->mark_end(lexer);
    }

    for (;;) {
        if (lexer->lookahead == 0) {
            return true;
        }

        if (lexer->lookahead == '/') {
            WhitespaceResult result = scan_whitespace_and_comments(lexer, scanned_comment, false, is_cfquery_context);
            // Compared with the enum, as cfscript/src/scanner.c does. This was
            // `result == false` / `result == true`: the first is REJECT by
            // luck, the second is NO_NEWLINE — a comment WITHOUT a newline —
            // which is the opposite of the ACCEPT the other scanner tests.
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

    return automatic_semicolon_after_newline(lexer, scanned_comment, is_cfquery_context);
}

// The half of `scan_automatic_semicolon` that runs once a newline has been
// crossed: whether what starts the next line continues the statement. Split out
// for the dispatcher, whose leading whitespace skip can cross that newline
// before the semicolon branch is reached (#148).
static bool automatic_semicolon_after_newline(TSLexer *lexer, bool *scanned_comment, bool is_cfquery_context) {
    if (scan_whitespace_and_comments(lexer, scanned_comment, true, is_cfquery_context) == REJECT) {
        return false;
    }

    switch (lexer->lookahead) {
        case '`':
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

static bool scan_ternary_qmark(TSLexer *lexer, bool is_cfquery_context) {
    for (;;) {
        if (!cf_isspace(lexer->lookahead)) {
            break;
        }
        skip(lexer);
    }

    if (lexer->lookahead == '?') {
        advance(lexer);

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

static bool scan_closetag_delim(Scanner *scanner, TSLexer *lexer, bool is_cf_context, bool is_cfquery_context) {
    if ( lexer->lookahead == '>' ) {
        if (!is_cf_context) scanner->in_prefixed_start_tag = false;
        advance(lexer);
        lexer->mark_end(lexer);
        lexer->result_symbol = is_cf_context ? CLOSE_CF_TAG_DELIM : CLOSE_TAG_DELIM;
        return true;
    } else {
        return false;
    }
}

static bool scan_cf_component_content(TSLexer *lexer, bool is_cfquery_context) {
    // Skip whitespace and script-style comments (// and /* */)
    for (;;) {
        while (cf_isspace(lexer->lookahead)) advance(lexer);
        if (lexer->lookahead == '/') {
            advance(lexer);
            if (lexer->lookahead == '/') {
                advance(lexer);
                while (lexer->lookahead != 0 && lexer->lookahead != '\n') advance(lexer);
            } else if (lexer->lookahead == '*') {
                advance(lexer);
                while (lexer->lookahead != 0) {
                    if (lexer->lookahead == '*') { advance(lexer); if (lexer->lookahead == '/') { advance(lexer); break; } }
                    else advance(lexer);
                }
            } else {
                return false;
            }
        } else {
            break;
        }
    }

    // Read the first word
    char word[16];
    int len = 0;
    while (cf_isalpha(lexer->lookahead) && len < 15) {
        word[len++] = cf_tolower(lexer->lookahead);
        advance(lexer);
    }
    word[len] = '\0';

    // Must not be followed by another identifier char (e.g. 'componentFoo')
    if (cf_isalnum(lexer->lookahead) || lexer->lookahead == '_') return false;

    // If the word is a modifier, skip whitespace and read the next one.
    //
    // `final` was missing from this set, which is what made a `.cfc` starting
    // `final component` fall through to `html_text` instead of being recognised
    // as a component file — a silent degradation rather than an ERROR, so every
    // consumer believed it had a valid parse of a text file.
    //
    // Looped rather than done once because Lucee accepts more than one modifier
    // (`final abstract component`). The loop terminates because each iteration
    // either consumes a word or reads none, and an empty word matches no
    // modifier.
    while (strcmp(word, "abstract") == 0 || strcmp(word, "static") == 0
            || strcmp(word, "final") == 0) {
        while (cf_isspace(lexer->lookahead)) advance(lexer);
        len = 0;
        while (cf_isalpha(lexer->lookahead) && len < 15) {
            word[len++] = cf_tolower(lexer->lookahead);
            advance(lexer);
        }
        word[len] = '\0';
        if (cf_isalnum(lexer->lookahead) || lexer->lookahead == '_') return false;
        if (len == 0) return false;
    }

    if (strcmp(word, "component") != 0 && strcmp(word, "property") != 0 &&
            strcmp(word, "interface") != 0 && strcmp(word, "import") != 0) {
        return false;
    }

    // Consume the rest of the file
    while (lexer->lookahead != 0) advance(lexer);
    lexer->mark_end(lexer);
    lexer->result_symbol = CF_COMPONENT_CONTENT;
    return true;
}

static bool external_scanner_scan(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols, unsigned count, bool is_cfquery_context) {

    // Where a statement can end, this skip crosses the newline that automatic
    // semicolon insertion decides from, and the semicolon branch at the bottom
    // never saw it: every statement in a closure in a tag expression that was
    // not followed by `}` came out MISSING ";" (#148). So the newline is noted,
    // and the end is marked first, making a semicolon inserted from it
    // zero-width at the end of the statement, where cfscript's scanner puts
    // one, rather than at the start of the next line. HTML_TEXT alongside the
    // semicolon is error recovery (see `recovering` below), which never skips.
    //
    // The semicolon branch at the bottom keeps that mark too (`end_marked`). It
    // used to mark again after the skip, so a statement closed by `}` rather
    // than by a newline — `{ return 1 }`, or a closure that ends a struct
    // literal spanning lines — ran on over the whitespace before the `}`, and
    // took any comment there inside it.
    const bool semicolon_valid = VS(valid_symbols, AUTOMATIC_SEMICOLON, count) && !VS(valid_symbols, HTML_TEXT, count);
    bool crossed_newline = false;
    bool end_marked = false;

    if (!VS(valid_symbols, HTML_TEXT, count) && !VS(valid_symbols, RAW_TEXT, count)) {
        if (semicolon_valid) {
            lexer->mark_end(lexer);
            end_marked = true;
        }
        while (cf_isspace(lexer->lookahead)) {
            if (lexer->lookahead == '\n' || lexer->lookahead == 0x2028 || lexer->lookahead == 0x2029) {
                crossed_newline = true;
            }
            skip(lexer);
        }
    }

    // Decided here only for what nothing below makes a token of in these
    // states, where this scan used to return false. `<` (a comment), `/` (`/>`,
    // or a comment, which the `/` case below reads through), `>`, `?` (the
    // ternary), and `}` and end of input (which the semicolon branch accepts
    // without a newline) go the way they always have.
    if (semicolon_valid && crossed_newline) {
        switch (lexer->lookahead) {
            case '<':
            case '/':
            case '>':
            case '?':
            case '}':
            case 0:
                break;
            default: {
                bool scanned_comment = false;
                lexer->result_symbol = AUTOMATIC_SEMICOLON;
                return automatic_semicolon_after_newline(lexer, &scanned_comment, is_cfquery_context);
            }
        }
    }

    if ((VS(valid_symbols, START_HASH_EXPRESSION, count) || VS(valid_symbols, SINGLE_HASH, count) || VS(valid_symbols, HASH_EMPTY, count))
            && !VS(valid_symbols, AUTOMATIC_SEMICOLON, count) && lexer->lookahead == '#') {
        advance(lexer);
        if (lexer->lookahead == '#') {
            advance(lexer);
            lexer->mark_end(lexer);
            lexer->result_symbol = HASH_EMPTY;
        } else if (scanner_in_hash_eval_context(scanner, is_cfquery_context)) {
            lexer->result_symbol = START_HASH_EXPRESSION;
        } else {
            lexer->mark_end(lexer);
            lexer->result_symbol = SINGLE_HASH;
        }
        return true;
    }

    if (VS(valid_symbols, CF_COMPONENT_CONTENT, count)
            && scanner->tags.size == 0 && scanner->cf_tags.size == 0
            && scan_cf_component_content(lexer, is_cfquery_context)) {
        return true;
    }

    if (VS(valid_symbols, RAW_TEXT, count) && !VS(valid_symbols, START_TAG_NAME, count) && !VS(valid_symbols, END_TAG_NAME, count)) {
        if (scan_raw_text(scanner, lexer, is_cfquery_context)) {
            return true;
        }
    }

    // Error recovery (#145). While recovering, tree-sitter marks every external
    // token valid, and this pair is valid together nowhere else — checked against
    // `ts_external_scanner_states` in both cfml and cfquery.
    //
    // Recovery used to get nothing from this scanner: the CF_XML_CONTENT branch
    // below returned its scan's `false` as the scanner's answer before any other
    // branch ran, so recovery had only internal tokens to resynchronise on, and a
    // single bad construct could cost everything to the end of the file.
    //
    // It now gets exactly the tokens anchored at a real `<` or at end of input —
    // a comment, `<`-led text, an implicit end tag — and nothing else. Each of
    // the other branches was measured doing harm there (the corpus audit in
    // #145): the content scans run to a delimiter from wherever recovery happens
    // to be; the default branch reads a "tag name" from arbitrary text, and an
    // end-tag name that matches the stack pops it; at `/>` every delimiter is
    // valid, so the first — a CF self-closing delimiter — wins and pops the
    // enclosing `<cffunction>` at a `<cfreturn … />`. Free-running text is the
    // subtle one: it pops nothing, yet offering it made recovery take paths that
    // swallowed a whole file where the local error had cost 107 bytes, and it is
    // left out for that reason alone.
    const bool recovering = VS(valid_symbols, AUTOMATIC_SEMICOLON, count) && VS(valid_symbols, HTML_TEXT, count);

    if (recovering) {
        if (lexer->lookahead != '<' && lexer->lookahead != 0) {
            return false;
        }
    } else {
        if (VS(valid_symbols, CF_XML_CONTENT, count)) {
            return scan_cfxml_content(scanner, lexer, is_cfquery_context);
        }

        if (VS(valid_symbols, CF_QUERY_CONTENT, count)) {
            return scan_cfquery_content(scanner, lexer, is_cfquery_context);
        }

        if (VS(valid_symbols, CF_SCRIPT_CONTENT, count)) {
            return scan_cfscript_content(scanner, lexer, is_cfquery_context);
        }

        if (VS(valid_symbols, CF_SAVECONTENT_BODY_CFML, count) || VS(valid_symbols, CF_SAVECONTENT_BODY_HTML, count) ||
            VS(valid_symbols, CF_SAVECONTENT_BODY_SCRIPT, count) ||
            VS(valid_symbols, CF_SAVECONTENT_BODY_CSS, count) || VS(valid_symbols, CF_SAVECONTENT_BODY_XML, count) ||
            VS(valid_symbols, CF_SAVECONTENT_BODY_SQL, count) || VS(valid_symbols, CF_SAVECONTENT_BODY_RAW, count)) {
            if (scan_cfsavecontent_body_type(scanner, lexer, valid_symbols, count, is_cfquery_context)) {
                return true;
            }
        }

        if (VS(valid_symbols, CF_SAVECONTENT_CONTENT, count)) {
            return scan_cfsavecontent_content(scanner, lexer, is_cfquery_context);
        }


        if (VS(valid_symbols, HTML_TEXT, count) && scan_html_text(scanner, lexer, is_cfquery_context, valid_symbols, count, false)) {
            return true;
        }
    }

    switch (lexer->lookahead) {
        case ';':
            return false;
        break;
        case '<':
            lexer->mark_end(lexer);
            end_marked = false;
            advance(lexer);

            if (VS(valid_symbols, CFML_COMMENT, count) && lexer->lookahead == '!') {
                advance(lexer);
                return scan_comment(lexer, is_cfquery_context);
            }

            // A `<` that opens a run of template text — `<- back` written as
            // the first non-whitespace on its line, or `<< Go Back` straight
            // after a tag. `scan_html_text` applies
            // exactly this test mid-line and calls such a `<` text, but it
            // refuses to peek past a `<` it has not already covered with text:
            // peeking consumes the character, this scanner cannot rewind, and
            // a `false` return would then leave the branches below looking at
            // the character *after* the `<`. So the decision lands here
            // instead, where the `<` is consumed either way and the text scan
            // can simply be told to keep it. Leading whitespace does not count
            // as text — deliberately, since emitting it would put a
            // whitespace-only `html_text` in front of every indented tag — and
            // that is what made the same `<` text mid-line and a tag at the
            // start of a line.
            if (VS(valid_symbols, HTML_TEXT, count) && lexer->lookahead != 0 &&
                !cf_isalpha(lexer->lookahead) && lexer->lookahead != '/' &&
                lexer->lookahead != '!' && lexer->lookahead != '?' &&
                lexer->lookahead != '#' &&
                scan_html_text(scanner, lexer, is_cfquery_context, valid_symbols, count, true)) {
                return true;
            }

            if (implicit_cf_end_tag_valid(valid_symbols, count)) {
                return scan_implicit_end_tag(scanner, lexer, true, is_cfquery_context, true);
            }

            if (VS(valid_symbols, IMPLICIT_END_TAG, count)) {
                return scan_implicit_end_tag(scanner, lexer, false, is_cfquery_context, true);
            }

            break;

        case '\0':

            if (implicit_cf_end_tag_valid(valid_symbols, count)) {
                return scan_implicit_end_tag(scanner, lexer, true, is_cfquery_context, true);
            }

            if (VS(valid_symbols, IMPLICIT_END_TAG, count)) {
                return scan_implicit_end_tag(scanner, lexer, false, is_cfquery_context, true);
            }
            break;

        case '/':

            advance(lexer);
            if (lexer->lookahead == '>') {
                if (VS(valid_symbols, CF_SELF_CLOSING_TAG_DELIMITER, count)) {
                    return scan_cf_self_closing_tag_delimiter(scanner, lexer, false, is_cfquery_context);
                }
                if (VS(valid_symbols, CF_SELF_CLOSING_VOID_TAG_DELIMITER, count)) {
                    return scan_cf_self_closing_tag_delimiter(scanner, lexer, true, is_cfquery_context);
                }
                if (VS(valid_symbols, SELF_CLOSING_TAG_DELIMITER, count)) {
                    return scan_self_closing_tag_delimiter(scanner, lexer, is_cfquery_context);
                }
                if (VS(valid_symbols, CLOSE_CF_TAG_DELIM, count)) {
                    return scan_closetag_delim(scanner, lexer, true, is_cfquery_context);
                }
                if (VS(valid_symbols, CLOSE_TAG_DELIM, count)) {
                    return scan_closetag_delim(scanner, lexer, false, is_cfquery_context);
                }
            } else if (lexer->lookahead == '/' || lexer->lookahead == '*') {
                // A comment opening the line after a statement. The semicolon
                // decision reads through it, as cfscript's scanner does, so the
                // comment falls between the two statements instead of inside
                // the first (#148). `scan_script_comment` only consumes.
                if (semicolon_valid && crossed_newline) {
                    bool scanned_comment = true;
                    scan_script_comment(lexer, is_cfquery_context);
                    lexer->result_symbol = AUTOMATIC_SEMICOLON;
                    return automatic_semicolon_after_newline(lexer, &scanned_comment, is_cfquery_context);
                }
                if (!scan_script_comment(lexer, is_cfquery_context)) {
                    return false;
                }
            }

            break;

        default:
            if (valid_start_tag_name(valid_symbols, count) && no_content_symbols(valid_symbols, count)) {
                return scan_start_tag_name(scanner, lexer, valid_cf_start_tag_name(valid_symbols, count), is_cfquery_context);
            }
            if (valid_end_tag_name(valid_symbols, count) && no_content_symbols(valid_symbols, count)) {
                return scan_end_tag_name(scanner, lexer, valid_cf_end_tag_name(valid_symbols, count), is_cfquery_context);
            }

            if (VS(valid_symbols, IMPLICIT_END_TAG, count)) {
                return scan_implicit_end_tag(scanner, lexer, false, is_cfquery_context, false);
            } else if (VS(valid_symbols, IMPLICIT_CF_END_TAG, count)) {
                return scan_implicit_end_tag(scanner, lexer, true, is_cfquery_context, false);
            }

            if (VS(valid_symbols, ERRONEOUS_END_TAG_NAME, count)) {
                if (lexer->lookahead == '#' && !is_cfquery_context) {
                    return scan_erroneous_dynamic_end_tag_name(lexer);
                }
                return scan_end_tag_name(scanner, lexer, false, is_cfquery_context);
            } else if (VS(valid_symbols, ERRONEOUS_CF_END_TAG_NAME, count)) {
                return scan_end_tag_name(scanner, lexer, true, is_cfquery_context);
            }

            if (VS(valid_symbols, CF_COMPONENT_END_TAG_NAME, count)) {
                return scan_end_tag_name(scanner, lexer, true, is_cfquery_context);
            }

            if (VS(valid_symbols, CLOSE_CF_TAG_DELIM, count)) {
                if (scan_closetag_delim(scanner, lexer, true, is_cfquery_context)) {
                    return true;
                }
            }

            if (VS(valid_symbols, CLOSE_TAG_DELIM, count)) {
                if (scan_closetag_delim(scanner, lexer, false, is_cfquery_context)) {
                    return true;
                }
            }
    }

    if (recovering) {
        return false;
    }

    if (VS(valid_symbols, AUTOMATIC_SEMICOLON, count)) {
        bool scanned_comment = false;
        bool ret = scan_automatic_semicolon(lexer, !VS(valid_symbols, LOGICAL_OR, count), &scanned_comment, is_cfquery_context, end_marked);
        if (!ret && !scanned_comment && VS(valid_symbols, TERNARY_QMARK, count) && lexer->lookahead == '?') {
            return scan_ternary_qmark(lexer, is_cfquery_context);
        }
        return ret;
    }

    if (VS(valid_symbols, TERNARY_QMARK, count) || VS(valid_symbols, ELVIS_OPERATOR, count)) {
        return scan_ternary_qmark(lexer, is_cfquery_context);
    }

    return false;
}
