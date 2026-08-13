/* unit tests for src/json.c — the minimal JSON reader used by MCP + agentmd */
#include "cg.h"
#include "tap.h"

int main(void) {
    const char *obj =
        "{\"name\":\"code\\\"graph\\\"\",\"n\":42,\"neg\":-7,"
        "\"esc\":\"line1\\nline2\\ttab\",\"uni\":\"caf\\u00e9\","
        "\"nested\":{\"inner\":{\"deep\":\"yes\"},\"brace\":\"}{\"},"
        "\"arr\":[1,2,3],\"flag\":true}";

    char *v = json_get_string(obj, "name");
    ok_str(v, "code\"graph\"");
    free(v);

    ok(json_get_int(obj, "n", -1) == 42, "int");
    ok(json_get_int(obj, "neg", -1) == -7, "negative int");
    ok(json_get_int(obj, "missing", 99) == 99, "int default");

    v = json_get_string(obj, "esc");
    ok_str(v, "line1\nline2\ttab");
    free(v);

    v = json_get_string(obj, "uni");
    ok_str(v, "caf\xc3\xa9");                 /* é -> UTF-8 */
    free(v);

    v = json_get_raw(obj, "flag");
    ok_str(v, "true");
    free(v);

    char *nested = json_get_object(obj, "nested");
    ok(nested != NULL, "nested object extracted");
    if (nested) {
        /* keys at THIS nesting level only; "deep" is one level down and a
           string containing braces must not confuse the scanner */
        char *inner = json_get_object(nested, "inner");
        ok(inner != NULL, "inner object");
        if (inner) {
            v = json_get_string(inner, "deep");
            ok_str(v, "yes");
            free(v);
        }
        free(inner);
        v = json_get_string(nested, "brace");
        ok_str(v, "}{");
        free(v);
        v = json_get_string(nested, "deep");
        ok(v == NULL, "deep key not visible at outer level");
        free(v);
    }
    free(nested);

    char *keys[8];
    char *inner2 = json_get_object(obj, "nested");
    int nk = inner2 ? json_object_keys(inner2, keys, 8) : -1;
    ok(nk == 2, "nested has 2 keys (got %d)", nk);
    if (nk == 2) {
        ok_str(keys[0], "inner");
        ok_str(keys[1], "brace");
    }
    for (int i = 0; i < nk; i++) free(keys[i]);
    free(inner2);

    ok(json_get_string(obj, "absent") == NULL, "absent string is NULL");
    ok(json_get_object(obj, "name") == NULL, "string is not an object");

    return t_done("json");
}
