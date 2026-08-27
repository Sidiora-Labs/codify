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

static bool import_row(const ParseResult *result, const char *name,
                       const char *module) {
    for (int i = 0; i < result->nimports; i++)
        if (strcmp(result->imports[i].name, name) == 0 &&
            strcmp(result->imports[i].module, module) == 0)
            return true;
    return false;
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

    /* ---- imports: c local includes only ---- */
    const char ic[] =
        "#include \"util.h\"\n"
        "#include <stdio.h>\n";
    lang_parse("c", "src/i.c", ic, sizeof ic - 1, &parsed);
    ok(import_row(&parsed, "*", "util.h"), "c local include recorded");
    ok(parsed.nimports == 1, "c system include ignored");
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

    return t_done("lang");
}
