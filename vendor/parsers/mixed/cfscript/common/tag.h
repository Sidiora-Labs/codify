#include "tree_sitter/array.h"

#include <string.h>

typedef enum {
    AREA,
    BASE,
    BASEFONT,
    BGSOUND,
    BR,
    COL,
    COMMAND,
    EMBED,
    FRAME,
    HR,
    IMAGE,
    IMG,
    INPUT,
    ISINDEX,
    KEYGEN,
    LINK,
    MENUITEM,
    META,
    NEXTID,
    PARAM,
    SOURCE,
    TRACK,
    WBR,
    // An unrecognised tag the scanner declined to nest because its name would
    // no longer fit in the serialised tag stack. It has no name in the table:
    // `scan_start_tag_name` assigns it in place of `CUSTOM`, and being inside
    // the void range is what closes it like `<input>`.
    CUSTOM_VOID,
    END_OF_VOID_TAGS,

    CUSTOM,
    DYNAMIC,
    CFML,
    CF_VOID,
    CF_SET,
    CF_RETURN,
    CF_IF,
    CF_ELSEIF,
    CF_ELSE,
    CF_OUTPUT,
    CF_FUNCTION,
    CF_QUERY,
    CF_XML,
    CF_SCRIPT,
    CF_SAVECONTENT,

    A,
    ABBR,
    ADDRESS,
    ARTICLE,
    ASIDE,
    AUDIO,
    B,
    BDI,
    BDO,
    BLOCKQUOTE,
    BODY,
    BUTTON,
    CANVAS,
    CAPTION,
    CITE,
    CODE,
    COLGROUP,
    DATA,
    DATALIST,
    DD,
    DEL,
    DETAILS,
    DFN,
    DIALOG,
    DIV,
    DL,
    DT,
    EM,
    FIELDSET,
    FIGCAPTION,
    FIGURE,
    FOOTER,
    FORM,
    H1,
    H2,
    H3,
    H4,
    H5,
    H6,
    HEAD,
    HEADER,
    HGROUP,
    HTML,
    I,
    IFRAME,
    INS,
    KBD,
    LABEL,
    LEGEND,
    LI,
    MAIN,
    MAP,
    MARK,
    MATH,
    MENU,
    METER,
    NAV,
    NOSCRIPT,
    OBJECT,
    OL,
    OPTGROUP,
    OPTION,
    OUTPUT,
    P,
    PICTURE,
    PRE,
    PROGRESS,
    Q,
    RB,
    RP,
    RT,
    RTC,
    RUBY,
    S,
    SAMP,
    SCRIPT,
    SECTION,
    SELECT,
    SLOT,
    SMALL,
    SPAN,
    STRONG,
    STYLE,
    SUB,
    SUMMARY,
    SUP,
    SVG,
    TABLE,
    TBODY,
    TD,
    TEMPLATE,
    TEXTAREA,
    TFOOT,
    TH,
    THEAD,
    TIME,
    TITLE,
    TR,
    U,
    UL,
    VAR,
    VIDEO,
    END_,
} TagType;

typedef Array(char) String;

// The name field is a fixed, NUL-padded array rather than a pointer on purpose:
// it lets `tag_type_for_name` test an entry's length by reading one byte
// (`tag_name[size] == '\0'`) instead of calling `strlen` on it. Every name in
// the table has to stay shorter than the field for that test to hold.
#define TAG_NAME_FIELD 16

typedef struct {
    char tag_name[TAG_NAME_FIELD];
    TagType tag_type;
} TagMapEntry;

typedef struct {
    TagType type;
    String tag_name;
    unsigned html_depth;
} Tag;

static const TagMapEntry TAG_TYPES_BY_TAG_NAME[126] = {
    {"AREA",       AREA      },
    {"BASE",       BASE      },
    {"BASEFONT",   BASEFONT  },
    {"BGSOUND",    BGSOUND   },
    {"BR",         BR        },
    {"COL",        COL       },
    {"COMMAND",    COMMAND   },
    {"EMBED",      EMBED     },
    {"FRAME",      FRAME     },
    {"HR",         HR        },
    {"IMAGE",      IMAGE     },
    {"IMG",        IMG       },
    {"INPUT",      INPUT     },
    {"ISINDEX",    ISINDEX   },
    {"KEYGEN",     KEYGEN    },
    {"LINK",       LINK      },
    {"MENUITEM",   MENUITEM  },
    {"META",       META      },
    {"NEXTID",     NEXTID    },
    {"PARAM",      PARAM     },
    {"SOURCE",     SOURCE    },
    {"TRACK",      TRACK     },
    {"WBR",        WBR       },
    {"A",          A         },
    {"ABBR",       ABBR      },
    {"ADDRESS",    ADDRESS   },
    {"ARTICLE",    ARTICLE   },
    {"ASIDE",      ASIDE     },
    {"AUDIO",      AUDIO     },
    {"B",          B         },
    {"BDI",        BDI       },
    {"BDO",        BDO       },
    {"BLOCKQUOTE", BLOCKQUOTE},
    {"BODY",       BODY      },
    {"BUTTON",     BUTTON    },
    {"CANVAS",     CANVAS    },
    {"CAPTION",    CAPTION   },
    {"CITE",       CITE      },
    {"CODE",       CODE      },
    {"COLGROUP",   COLGROUP  },
    {"DATA",       DATA      },
    {"DATALIST",   DATALIST  },
    {"DD",         DD        },
    {"DEL",        DEL       },
    {"DETAILS",    DETAILS   },
    {"DFN",        DFN       },
    {"DIALOG",     DIALOG    },
    {"DIV",        DIV       },
    {"DL",         DL        },
    {"DT",         DT        },
    {"EM",         EM        },
    {"FIELDSET",   FIELDSET  },
    {"FIGCAPTION", FIGCAPTION},
    {"FIGURE",     FIGURE    },
    {"FOOTER",     FOOTER    },
    {"FORM",       FORM      },
    {"H1",         H1        },
    {"H2",         H2        },
    {"H3",         H3        },
    {"H4",         H4        },
    {"H5",         H5        },
    {"H6",         H6        },
    {"HEAD",       HEAD      },
    {"HEADER",     HEADER    },
    {"HGROUP",     HGROUP    },
    {"HTML",       HTML      },
    {"I",          I         },
    {"IFRAME",     IFRAME    },
    {"INS",        INS       },
    {"KBD",        KBD       },
    {"LABEL",      LABEL     },
    {"LEGEND",     LEGEND    },
    {"LI",         LI        },
    {"MAIN",       MAIN      },
    {"MAP",        MAP       },
    {"MARK",       MARK      },
    {"MATH",       MATH      },
    {"MENU",       MENU      },
    {"METER",      METER     },
    {"NAV",        NAV       },
    {"NOSCRIPT",   NOSCRIPT  },
    {"OBJECT",     OBJECT    },
    {"OL",         OL        },
    {"OPTGROUP",   OPTGROUP  },
    {"OPTION",     OPTION    },
    {"OUTPUT",     OUTPUT    },
    {"P",          P         },
    {"PICTURE",    PICTURE   },
    {"PRE",        PRE       },
    {"PROGRESS",   PROGRESS  },
    {"Q",          Q         },
    {"RB",         RB        },
    {"RP",         RP        },
    {"RT",         RT        },
    {"RTC",        RTC       },
    {"RUBY",       RUBY      },
    {"S",          S         },
    {"SAMP",       SAMP      },
    {"SCRIPT",     SCRIPT    },
    {"SECTION",    SECTION   },
    {"SELECT",     SELECT    },
    {"SLOT",       SLOT      },
    {"SMALL",      SMALL     },
    {"SPAN",       SPAN      },
    {"STRONG",     STRONG    },
    {"STYLE",      STYLE     },
    {"SUB",        SUB       },
    {"SUMMARY",    SUMMARY   },
    {"SUP",        SUP       },
    {"SVG",        SVG       },
    {"TABLE",      TABLE     },
    {"TBODY",      TBODY     },
    {"TD",         TD        },
    {"TEMPLATE",   TEMPLATE  },
    {"TEXTAREA",   TEXTAREA  },
    {"TFOOT",      TFOOT     },
    {"TH",         TH        },
    {"THEAD",      THEAD     },
    {"TIME",       TIME      },
    {"TITLE",      TITLE     },
    {"TR",         TR        },
    {"U",          U         },
    {"UL",         UL        },
    {"VAR",        VAR       },
    {"VIDEO",      VIDEO     },
    {"CUSTOM",     CUSTOM    },
};

static const TagType TAG_TYPES_NOT_ALLOWED_IN_PARAGRAPHS[] = {
    ADDRESS,  ARTICLE,    ASIDE,  BLOCKQUOTE, DETAILS, DIV, DL,
    FIELDSET, FIGCAPTION, FIGURE, FOOTER,     FORM,    H1,  H2,
    H3,       H4,         H5,     H6,         HEADER,  HR,  MAIN,
    NAV,      OL,         P,      PRE,        SECTION,
};

#define TAG_TYPE_COUNT (sizeof(TAG_TYPES_BY_TAG_NAME) / sizeof(TAG_TYPES_BY_TAG_NAME[0]))

// Called for every HTML tag name the scanner reads, and it walks the whole
// table. The `strlen` it used to run per entry was 2.2% of every instruction a
// corpus parse retired with `cfml` — 126 library calls to reject one name.
// Comparing the first byte rejects almost every entry in a single load; the
// NUL-padded name field supplies the length without a call.
static TagType tag_type_for_name(const String *tag_name) {
    unsigned size = tag_name->size;
    if (size == 0 || size >= TAG_NAME_FIELD) {
        return CUSTOM;
    }
    char first = tag_name->contents[0];
    for (unsigned i = 0; i < TAG_TYPE_COUNT; i++) {
        const TagMapEntry *entry = &TAG_TYPES_BY_TAG_NAME[i];
        if (
            entry->tag_name[0] == first &&
            entry->tag_name[size] == '\0' &&
            memcmp(entry->tag_name, tag_name->contents, size) == 0
        ) {
            return entry->tag_type;
        }
    }
    return CUSTOM;
}

static inline Tag tag_new() {
    Tag tag;
    tag.type = END_;
    tag.tag_name = (String) array_new();
    tag.html_depth = 0;
    return tag;
}

// Fixed-width and NUL-padded for the same reason as TAG_TYPES_BY_TAG_NAME: the
// lookup reads the length out of the padding instead of calling `strlen` on
// every entry. Names must stay shorter than TAG_NAME_FIELD.
static const char CF_VOID_TAGS[][TAG_NAME_FIELD] = {
    "COMPONENT", "PARAM", "ARGUMENT", "PROPERTY", "RETHROW", "THROW", "SCHEDULE", "HTTPPARAM", "QUERYPARAM", "FLUSH", "LOGOUT", "ZIPELEMENT",
    "BREAK", "CONTINUE", "ABORT", "EXIT", "INCLUDE", "LOCATION", "HEADER", "DUMP",
    "CONTENT", "COOKIE", "LOG", "FILE", "DIRECTORY", "WDDX",
    "AUTHENTICATE", "NTAUTHENTICATE", "REPORTPARAM",
    "PROCPARAM", "PROCRESULT", "INVOKEARGUMENT", "SPREADSHEET", "PDFPARAM",
    "PDFFORMPARAM", "PDFSUBFORM", "MAILPARAM", "GRIDROW", "GRIDUPDATE", "IMAGE",
    "TREEITEM", "MENUITEM", "MAPLOCATION", "PRESENTERITEM", "IMPORT", "TRACE",
    "GRIDCOLUMN", "OBJECT",
    // `<cfsetting>` never has a body — `</cfsetting>` does not appear once in
    // the 12,549-file corpus — but it was treated as a paired tag, so one
    // `<cfsetting showdebugoutput="false">` swallowed the rest of the template.
    "SETTING",
    // `TIMER` is deliberately absent: `<cftimer>` times the code between its
    // start and end tags, so listing it here made `<cftimer label="t">…
    // </cftimer>` fail. The corpus is silent on this one — `<cftimer` appears
    // in none of the 12,549 files — so the call rests on the tag's semantics
    // rather than on usage.
};

#define CF_VOID_TAG_COUNT (sizeof(CF_VOID_TAGS) / sizeof(CF_VOID_TAGS[0]))

static inline bool cf_tag_name_in(const String *name, const char list[][TAG_NAME_FIELD], unsigned count) {
    unsigned size = name->size;
    if (size == 0 || size >= TAG_NAME_FIELD) {
        return false;
    }
    char first = name->contents[0];
    for (unsigned i = 0; i < count; i++) {
        if (list[i][0] == first && list[i][size] == '\0' &&
            memcmp(list[i], name->contents, size) == 0) {
            return true;
        }
    }
    return false;
}

static inline Tag cf_tag_for_name(String name) {
    Tag tag = tag_new();
    // printf("checking if %.*s is a cf tag\n", name.size, name.contents);
    if (name.size == 3 && memcmp(name.contents, "SET", 3) == 0) {
        tag.type = CF_SET;
    } else if (name.size == 6 && memcmp(name.contents, "RETURN", 6) == 0) {
        tag.type = CF_RETURN;
    } else if (name.size == 6 && memcmp(name.contents, "OUTPUT", 6) == 0) {
        tag.type = CF_OUTPUT;
    } else if (name.size == 8 && memcmp(name.contents, "FUNCTION", 8) == 0) {
        tag.type = CF_FUNCTION;
    } else if (name.size == 2 && memcmp(name.contents, "IF", 2) == 0) {
        tag.type = CF_IF;
    } else if (name.size == 6 && memcmp(name.contents, "ELSEIF", 6) == 0) {
        tag.type = CF_ELSEIF;
    } else if (name.size == 4 && memcmp(name.contents, "ELSE", 4) == 0) {
        tag.type = CF_ELSE;
    } else if (name.size == 3 && memcmp(name.contents, "XML", 3) == 0) {
        tag.type = CF_XML;
    } else if (name.size == 5 && memcmp(name.contents, "QUERY", 5) == 0) {
        tag.type = CF_QUERY;
    } else if (name.size == 6 && memcmp(name.contents, "SCRIPT", 6) == 0) {
        tag.type = CF_SCRIPT;
    } else if (name.size == 11 && memcmp(name.contents, "SAVECONTENT", 11) == 0) {
        tag.type = CF_SAVECONTENT;
    } else if (cf_tag_name_in(&name, CF_VOID_TAGS, CF_VOID_TAG_COUNT)) {
        tag.type = CF_VOID;
    } else {
        tag.type = CFML;
    }
    tag.tag_name = name;
    return tag;
}

static inline Tag tag_for_name(String name) {
    Tag tag = tag_new();
    tag.type = tag_type_for_name(&name);
    if (tag.type == CUSTOM) {
        tag.tag_name = name;
    } else {
        array_delete(&name);
    }
    return tag;
}

// Every Tag owns its name buffer, whether or not its type carries a name — a
// type that does not simply holds an empty (or emptied-but-still-allocated)
// array. Freeing unconditionally is what makes it safe for `deserialize` to
// overwrite a Tag in place and keep the buffer it already has, which is where
// the scanner's allocator traffic used to come from.
static inline void tag_free(Tag *tag) {
    array_delete(&tag->tag_name);
}

static inline bool tag_is_void(const Tag *self) {
    return self->type < END_OF_VOID_TAGS;
}

static inline bool cf_tag_is_void(const Tag *self) {
    return self->type == CF_VOID;
}

// Tags that implicitly close when they encounter another opening tag of the same type.
// Per HTML spec: p, li, dt, dd, td, th, tr, thead, tbody, tfoot, colgroup, option, optgroup, head, body, html, rb, rp, rt, rtc.
static inline bool tag_implicitly_closes_self(const Tag *self) {
    switch (self->type) {
        case P:
        case LI:
        case DT:
        case DD:
        case TD:
        case TH:
        case TR:
        case THEAD:
        case TBODY:
        case TFOOT:
        case COLGROUP:
        case OPTION:
        case OPTGROUP:
        case HEAD:
        case BODY:
        case HTML:
        case RB:
        case RP:
        case RT:
        case RTC:
            return true;
        default:
            return false;
    }
}

static inline bool tag_eq(const Tag *self, const Tag *other) {
    if (self->type != other->type) return false;
    if (self->type == CUSTOM || self->type == CFML || self->type == CF_VOID || self->type == CF_XML || self->type == CF_QUERY || self->type == CF_SCRIPT || self->type == CF_SAVECONTENT || self->type == CF_OUTPUT || self->type == CF_FUNCTION || self->type == CF_SET || self->type == CF_RETURN || self->type == CF_IF || self->type == CF_ELSEIF || self->type == CF_ELSE) {
        if (self->tag_name.size != other->tag_name.size) {
            return false;
        }
        if (memcmp(
            self->tag_name.contents,
            other->tag_name.contents,
            self->tag_name.size
        ) != 0) {
            return false;
        }
    }
    return true;
}
