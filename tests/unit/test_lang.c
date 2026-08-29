/* unit tests for src/lang.c — language-aware definitions and references */
#include "cg.h"
#include "tap.h"

static const SymDef *definition(const ParseResult *result, const char *name) {
    for (int i = 0; i < result->ndefs; i++)
        if (strcmp(result->defs[i].name, name) == 0)
            return &result->defs[i];
    return NULL;
}

static bool reference(const ParseResult *result, const char *name) {
    for (int i = 0; i < result->nrefs; i++)
        if (strcmp(result->refs[i].name, name) == 0)
            return true;
    return false;
}

static const SymRef *ref_of(const ParseResult *result, const char *name) {
    for (int i = 0; i < result->nrefs; i++)
        if (strcmp(result->refs[i].name, name) == 0)
            return &result->refs[i];
    return NULL;
}

/* a captured comment span starting at `line`, or NULL */
static const CmtDef *span_at(const ParseResult *result, int line) {
    for (int i = 0; i < result->ncmts; i++)
        if (result->cmts[i].line == line)
            return &result->cmts[i];
    return NULL;
}

static bool import_row(const ParseResult *result, const char *name,
                       const char *module) {
    for (int i = 0; i < result->nimports; i++)
        if (strcmp(result->imports[i].name, name) == 0 &&
            strcmp(result->imports[i].module, module) == 0)
            return true;
    return false;
}

static bool system_import(const ParseResult *result, const char *module) {
    for (int i = 0; i < result->nimports; i++)
        if (strcmp(result->imports[i].module, module) == 0 &&
            result->imports[i].system)
            return true;
    return false;
}

static int def_count(const ParseResult *result, const char *name) {
    int n = 0;
    for (int i = 0; i < result->ndefs; i++)
        if (strcmp(result->defs[i].name, name) == 0) n++;
    return n;
}

int main(void) {
    lang_global_init();
    ParseResult parsed;

    const char rust[] =
        "pub mod delete;\n"
        "pub fn new() {}\n"
        "fn call() { delete(); new(); if (true) {} }\n";
    lang_parse("rust", "src/lib.rs", rust, sizeof rust - 1, &parsed);

    const SymDef *delete_module = definition(&parsed, "delete");
    ok(delete_module != NULL, "Rust permits a module named delete");
    ok(delete_module && strcmp(delete_module->kind, "module") == 0,
       "delete retains its module kind");
    ok(definition(&parsed, "new") != NULL, "Rust permits a function named new");
    ok(reference(&parsed, "delete"), "Rust delete call is a reference");
    ok(reference(&parsed, "new"), "Rust new call is a reference");
    ok(!reference(&parsed, "if"), "Rust control-flow keyword is not a reference");
    parse_result_free(&parsed);

    /* ---- brace scope ends ---- */
    const char js[] =
        "export function alpha() {\n"
        "  return beta();\n"
        "}\n"
        "\n"
        "export function beta() {\n"
        "  return 2;\n"
        "}\n";
    lang_parse("typescript", "src/a.ts", js, sizeof js - 1, &parsed);
    const SymDef *alpha = definition(&parsed, "alpha");
    const SymDef *beta = definition(&parsed, "beta");
    ok(alpha && alpha->end_line == 3, "brace scope: alpha ends at its brace");
    ok(beta && beta->end_line == 7, "brace scope: beta ends at file's brace");
    parse_result_free(&parsed);

    /* ---- python indentation scope ends ---- */
    const char py[] =
        "def outer(x):\n"
        "    y = helper(x)\n"
        "    return y\n"
        "\n"
        "top_level(1)\n";
    lang_parse("python", "lib/a.py", py, sizeof py - 1, &parsed);
    const SymDef *outer = definition(&parsed, "outer");
    ok(outer && outer->end_line == 3,
       "python scope: last deeper-indented line ends the def");
    parse_result_free(&parsed);

    /* ---- python triple-quoted continuation lines are blanked ---- */
    const char pdoc[] =
        "\"\"\"module doc\n"
        "def fake(x):\n"
        "    ghost(x)\n"
        "\"\"\"\n"
        "def real(y):\n"
        "    return y\n";
    lang_parse("python", "lib/doc.py", pdoc, sizeof pdoc - 1, &parsed);
    ok(definition(&parsed, "fake") == NULL,
       "def inside a docstring is not a symbol");
    ok(!reference(&parsed, "ghost"), "call inside a docstring is not a ref");
    ok(definition(&parsed, "real") != NULL, "def after the docstring survives");
    parse_result_free(&parsed);

    /* ---- js template-literal continuation lines are blanked ---- */
    const char tjs[] =
        "const T = `\n"
        "function ghost() {}\n"
        "callGhost();\n"
        "`;\n"
        "function real2() { return 1; }\n";
    lang_parse("javascript", "src/t.js", tjs, sizeof tjs - 1, &parsed);
    ok(definition(&parsed, "ghost") == NULL,
       "def inside a template literal is not a symbol");
    ok(!reference(&parsed, "callGhost"),
       "call inside a template literal is not a ref");
    const SymDef *real2 = definition(&parsed, "real2");
    ok(real2 != NULL, "def after the template literal survives");
    ok(real2 && real2->end_line == 5, "one-line body closes on its own line");
    parse_result_free(&parsed);

    /* ---- qualifier capture ---- */
    const char qjs[] =
        "function run() {\n"
        "  client.fetchData();\n"
        "  plain();\n"
        "}\n";
    lang_parse("javascript", "src/q.js", qjs, sizeof qjs - 1, &parsed);
    const SymRef *fetch = ref_of(&parsed, "fetchData");
    const SymRef *plain = ref_of(&parsed, "plain");
    ok(fetch && strcmp(fetch->qual, "client") == 0, "a.b( captures receiver a");
    ok(fetch && fetch->ref_kind == 'c', "refs carry the call kind");
    ok(plain && plain->qual[0] == 0, "bare call has an empty qualifier");
    parse_result_free(&parsed);

    const char qc[] =
        "static int go(struct P *p) {\n"
        "    return p->send(1);\n"
        "}\n";
    lang_parse("c", "src/q.c", qc, sizeof qc - 1, &parsed);
    const SymRef *send = ref_of(&parsed, "send");
    ok(send && strcmp(send->qual, "p") == 0, "a->b( captures receiver a");
    parse_result_free(&parsed);

    const char qrs[] =
        "fn main() {\n"
        "    Config::load();\n"
        "}\n";
    lang_parse("rust", "src/q.rs", qrs, sizeof qrs - 1, &parsed);
    const SymRef *load = ref_of(&parsed, "load");
    ok(load && strcmp(load->qual, "Config") == 0, "A::b( captures receiver A");
    parse_result_free(&parsed);

    /* ---- imports: js/ts ---- */
    const char ijs[] =
        "import { alpha, beta } from \"./mod\";\n"
        "import dflt from \"other\";\n"
        "import * as ns from \"star\";\n"
        "const legacy = require(\"legacy-lib\");\n";
    lang_parse("typescript", "src/i.ts", ijs, sizeof ijs - 1, &parsed);
    ok(import_row(&parsed, "alpha", "./mod"), "js named import: first name");
    ok(import_row(&parsed, "beta", "./mod"), "js named import: second name");
    ok(import_row(&parsed, "dflt", "other"), "js default import");
    ok(import_row(&parsed, "*", "star"), "js namespace import is *");
    ok(import_row(&parsed, "*", "legacy-lib"), "require() is a * import");
    parse_result_free(&parsed);

    /* ---- imports: python ---- */
    const char ipy[] =
        "from pkg.mod import alpha, beta\n"
        "import os\n"
        "import a.b as c\n";
    lang_parse("python", "lib/i.py", ipy, sizeof ipy - 1, &parsed);
    ok(import_row(&parsed, "alpha", "pkg.mod"), "python from-import: first");
    ok(import_row(&parsed, "beta", "pkg.mod"), "python from-import: second");
    ok(import_row(&parsed, "*", "os"), "python import m is *");
    ok(import_row(&parsed, "*", "a.b"), "python dotted import keeps module");
    parse_result_free(&parsed);

    /* ---- imports: go, incl. blocks ---- */
    const char igo[] =
        "package x\n"
        "import \"fmt\"\n"
        "import (\n"
        "\t\"net/http\"\n"
        "\tj \"encoding/json\"\n"
        ")\n";
    lang_parse("go", "cmd/i.go", igo, sizeof igo - 1, &parsed);
    ok(import_row(&parsed, "*", "fmt"), "go single import");
    ok(import_row(&parsed, "*", "net/http"), "go import block: plain path");
    ok(import_row(&parsed, "*", "encoding/json"), "go import block: aliased");
    parse_result_free(&parsed);

    /* ---- imports: c includes (local and system) ---- */
    const char ic[] =
        "#include \"util.h\"\n"
        "#include <stdio.h>\n";
    lang_parse("c", "src/i.c", ic, sizeof ic - 1, &parsed);
    ok(import_row(&parsed, "*", "util.h"), "c local include recorded");
    ok(import_row(&parsed, "*", "stdio.h"), "c system include recorded");
    ok(parsed.nimports == 2, "c both includes counted");
    ok(!parsed.imports[0].system, "c local include not flagged system");
    ok(system_import(&parsed, "stdio.h"), "c system include flagged system");
    parse_result_free(&parsed);

    /* ---- imports: rust ---- */
    const char irs[] =
        "use a::b::{c, d};\n"
        "use x::y::z;\n";
    lang_parse("rust", "src/i.rs", irs, sizeof irs - 1, &parsed);
    ok(import_row(&parsed, "c", "a::b"), "rust brace use: first name");
    ok(import_row(&parsed, "d", "a::b"), "rust brace use: second name");
    ok(import_row(&parsed, "z", "x::y"), "rust plain use path");
    parse_result_free(&parsed);

    /* ---- imports: java + c# ---- */
    const char ijava[] = "import a.b.Client;\n";
    lang_parse("java", "src/I.java", ijava, sizeof ijava - 1, &parsed);
    ok(import_row(&parsed, "Client", "a.b"), "java import splits last segment");
    parse_result_free(&parsed);

    const char ics[] = "using A.B;\n";
    lang_parse("csharp", "src/I.cs", ics, sizeof ics - 1, &parsed);
    ok(import_row(&parsed, "B", "A"), "c# using splits last segment");
    parse_result_free(&parsed);

    /* ---- comment capture: spans, coalescing, purity ---- */
    const char cmt[] =
        "/* header line one\n"
        " * header line two */\n"
        "\n"
        "/* doc for f */\n"
        "int f(void) {\n"
        "    int x = 1;   /* trailing */\n"
        "    /* step */\n"
        "    return x;\n"
        "}\n";
    lang_parse("c", "src/c.c", cmt, sizeof cmt - 1, &parsed);
    const CmtDef *c1 = span_at(&parsed, 1);
    ok(c1 != NULL, "c: header span captured");
    ok(c1 && c1->end_line == 2, "c: block comment coalesces across lines");
    ok(c1 && c1->pure, "c: a comment-only line is pure");
    ok(span_at(&parsed, 3) == NULL, "c: a blank line closes the span");
    const CmtDef *c4 = span_at(&parsed, 4);
    ok(c4 && c4->end_line == 4, "c: doc span stops before the definition");
    const CmtDef *c6 = span_at(&parsed, 6);
    ok(c6 && !c6->pure, "c: a comment trailing code is not pure");
    ok(span_at(&parsed, 7) != NULL, "c: an in-body comment is its own span");
    ok(parsed.first_code_line == 5, "c: first code line is the definition");
    parse_result_free(&parsed);

    /* line comments on consecutive lines are one span, not three */
    const char run[] =
        "// one\n"
        "// two\n"
        "// three\n"
        "int g(void) { return 0; }\n";
    lang_parse("c", "src/r.c", run, sizeof run - 1, &parsed);
    ok(parsed.ncmts == 1, "c: consecutive line comments coalesce");
    ok(span_at(&parsed, 1) && span_at(&parsed, 1)->end_line == 3,
       "c: coalesced span spans all three lines");
    parse_result_free(&parsed);

    /* python docstrings are the language's doc comments, and they follow
       the definition rather than precede it */
    const char pydoc[] =
        "\"\"\"module doc\"\"\"\n"
        "\n"
        "def f(path):\n"
        "    \"\"\"doc for f\n"
        "    second line\"\"\"\n"
        "    return path\n";
    lang_parse("python", "src/p.py", pydoc, sizeof pydoc - 1, &parsed);
    const CmtDef *p1 = span_at(&parsed, 1);
    ok(p1 != NULL, "python: module docstring captured");
    ok(p1 && p1->below, "python: docstring flagged as documenting from below");
    const CmtDef *p4 = span_at(&parsed, 4);
    ok(p4 != NULL, "python: function docstring captured");
    ok(p4 && p4->end_line == 5, "python: multi-line docstring coalesces");
    ok(parsed.first_code_line == 3, "python: docstring is not code");
    parse_result_free(&parsed);

    /* a triple-quoted string that is not in a docstring position stays a
       string — capturing it would fill the index with data */
    const char pystr[] =
        "def f():\n"
        "    x = 1\n"
        "    q = \"\"\"just a string\"\"\"\n"
        "    return q\n";
    lang_parse("python", "src/q.py", pystr, sizeof pystr - 1, &parsed);
    ok(parsed.ncmts == 0, "python: a plain triple-quoted string is not a doc");
    parse_result_free(&parsed);

    /* ---- C/C++ definition sites vs use sites ---- */

    /* struct use: `struct stat st;` is a variable declaration, not a def */
    const char cuse[] =
        "int f(void) {\n"
        "    struct stat st;\n"
        "    struct dirent *e;\n"
        "    union sigval sv;\n"
        "    enum state s = OK;\n"
        "    return 0;\n"
        "}\n";
    lang_parse("c", "src/use.c", cuse, sizeof cuse - 1, &parsed);
    ok(definition(&parsed, "stat") == NULL,
       "c: struct stat st is a use, not a def");
    ok(definition(&parsed, "dirent") == NULL,
       "c: struct dirent *e is a use, not a def");
    ok(definition(&parsed, "sigval") == NULL,
       "c: union sigval sv is a use, not a def");
    ok(definition(&parsed, "state") == NULL,
       "c: enum state s = OK is a use, not a def");
    ok(definition(&parsed, "f") != NULL,
       "c: the function itself is still recorded");
    parse_result_free(&parsed);

    /* struct definition: body brace */
    const char cdef[] =
        "struct Point {\n"
        "    int x, y;\n"
        "};\n"
        "union Data {\n"
        "    int i;\n"
        "    float f;\n"
        "};\n"
        "enum Color { RED, GREEN, BLUE };\n";
    lang_parse("c", "src/def.c", cdef, sizeof cdef - 1, &parsed);
    ok(definition(&parsed, "Point") != NULL,
       "c: struct with body brace is a def");
    ok(definition(&parsed, "Data") != NULL,
       "c: union with body brace is a def");
    ok(definition(&parsed, "Color") != NULL,
       "c: enum with body brace is a def");
    ok(def_count(&parsed, "Point") == 1,
       "c: struct body recorded exactly once");
    parse_result_free(&parsed);

    /* typedef struct — the typedef keyword signals a def */
    const char ctdef[] =
        "typedef struct Pair {\n"
        "    int a, b;\n"
        "} Pair;\n"
        "typedef enum { A, B } AB;\n"
        "typedef unsigned long size_t;\n";
    lang_parse("c", "src/tdef.c", ctdef, sizeof ctdef - 1, &parsed);
    ok(definition(&parsed, "Pair") != NULL,
       "c: typedef struct is a def");
    ok(definition(&parsed, "AB") != NULL,
       "c: typedef enum with body is a def");
    ok(definition(&parsed, "size_t") != NULL,
       "c: plain typedef is a def");
    parse_result_free(&parsed);

    /* forward declaration: `struct Foo;` */
    const char cfwd[] =
        "struct Opaque;\n"
        "enum Forward;\n";
    lang_parse("c", "src/fwd.c", cfwd, sizeof cfwd - 1, &parsed);
    ok(definition(&parsed, "Opaque") != NULL,
       "c: forward decl struct is a def");
    ok(definition(&parsed, "Forward") != NULL,
       "c: forward decl enum is a def");
    parse_result_free(&parsed);

    /* C++ class: use vs definition */
    const char cppuse[] =
        "void f(class Widget *w) {\n"
        "    struct stat st;\n"
        "}\n";
    lang_parse("cpp", "src/use.cpp", cppuse, sizeof cppuse - 1, &parsed);
    ok(definition(&parsed, "Widget") == NULL,
       "cpp: class in param is a use, not a def");
    ok(definition(&parsed, "stat") == NULL,
       "cpp: struct stat st is a use in C++ too");
    parse_result_free(&parsed);

    const char cppdef[] =
        "class Widget {\n"
        "    int x;\n"
        "};\n"
        "struct Pod {\n"
        "    int y;\n"
        "};\n";
    lang_parse("cpp", "src/def.cpp", cppdef, sizeof cppdef - 1, &parsed);
    ok(definition(&parsed, "Widget") != NULL,
       "cpp: class with body is a def");
    ok(definition(&parsed, "Pod") != NULL,
       "cpp: struct with body is a def");
    parse_result_free(&parsed);

    /* C prototype vs definition: prototype (;) suppressed, definition kept */
    const char cproto[] =
        "int compute(int x);\n"
        "int compute(int x) { return x * 2; }\n";
    lang_parse("c", "src/proto.c", cproto, sizeof cproto - 1, &parsed);
    ok(def_count(&parsed, "compute") == 1,
       "c: prototype + definition yields one symbol");
    ok(definition(&parsed, "compute") != NULL &&
       definition(&parsed, "compute")->line == 2,
       "c: the definition line wins, not the prototype");
    parse_result_free(&parsed);

    /* C++ class inheritance: `class Foo : public Bar {` has body */
    const char cppinherit[] =
        "class Derived : public Base {\n"
        "    int z;\n"
        "};\n";
    lang_parse("cpp", "src/inh.cpp", cppinherit, sizeof cppinherit - 1, &parsed);
    ok(definition(&parsed, "Derived") != NULL,
       "cpp: class with : inheritance and body is a def");
    parse_result_free(&parsed);

    return t_done("lang");
}
