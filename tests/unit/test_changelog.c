/* unit tests for src/changelog.c — version parsing from the version source */
#include "cg.h"
#include "tap.h"

/* defined in changelog.c without a cg.h declaration */
void changelog_version_parse(const char *src, const char *body, char *out, size_t cap);

int main(void) {
    char v[64];

    changelog_version_parse("src/cg.h",
        "#ifndef HYPERFIDE_VERSION\n"
        "#define HYPERFIDE_VERSION \"2.0.0-dev\"\n"
        "#endif\n"
        "#define CG_VERSION HYPERFIDE_VERSION\n"
        "#define HYPERFIDE_PRODUCT \"Hyperfide\"\n", v, sizeof v);
    ok_str(v, "2.0.0-dev");

    /* the indirection target may follow CG_VERSION */
    changelog_version_parse("src/cg.h",
        "#define CG_VERSION HYPERFIDE_VERSION\n"
        "#define HYPERFIDE_PRODUCT \"Hyperfide\"\n"
        "#define HYPERFIDE_VERSION \"2.1.0\"\n", v, sizeof v);
    ok_str(v, "2.1.0");

    /* 1.x revisions define the literal; a longer name with the same prefix is not it */
    changelog_version_parse("src/cg.h",
        "#define CG_VERSION_NOTE \"x\"\n"
        "#define CG_VERSION  \"1.6.0\"\n", v, sizeof v);
    ok_str(v, "1.6.0");

    changelog_version_parse("src/cg.h", "#define CG_VERSION MISSING\n", v, sizeof v);
    ok_str(v, "");
    changelog_version_parse("src/cg.h",
        "#define CG_VERSION A\n#define A B\n#define B A\n", v, sizeof v);
    ok_str(v, "");

    changelog_version_parse("VERSION", "v1.2.3\n", v, sizeof v);
    ok_str(v, "1.2.3");
    changelog_version_parse("package.json", "{\"name\":\"x\",\"version\":\"0.4.0\"}", v, sizeof v);
    ok_str(v, "0.4.0");

    return t_done("changelog");
}
