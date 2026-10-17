/* Hyperfide display identity is separate from immutable Codify history and protocols. */
#include "../cg.h"
#include "components.h"
#include <ctype.h>

static int empty_object(const char *p) {
    if (!p) return 0;
    while (isspace((unsigned char)*p)) ++p;
    if (*p++ != '{') return 0;
    while (isspace((unsigned char)*p)) ++p;
    if (*p++ != '}') return 0;
    while (isspace((unsigned char)*p)) ++p;
    return *p == '\0';
}
int hf_component_branding(const char *action, const char *request_json, FILE *output) {
    if (!action || !output || !empty_object(request_json)) {
        if (output) fputs("{\"ok\":false,\"error\":\"INVALID_INPUT\"}\n", output);
        return 2;
    }
    if (!strcmp(action, "branding.identity.describe")) {
        fprintf(output, "{\"product\":\"Hyperfide\",\"version\":\"%s\","
            "\"canonical_command\":\"hyperfide\",\"compatibility_commands\":[\"cg\"],"
            "\"native_protocol_version\":1,\"release_status\":\"development\"}\n", CG_VERSION);
        return 0;
    }
    if (!strcmp(action, "branding.compatibility.inventory")) {
        fputs("{\"historical_product\":\"Codify\","
            "\"preserved\":[\"feature IDs\",\"task IDs\",\"commit tags\",\"Git object IDs\","
            "\"provider native IDs\",\"codify-workflow package identity\",\"SidioraLabs publisher\"],"
            "\"legacy_config\":\"codify.kvx\",\"canonical_config\":\"hyperfide.kvx\","
            "\"legacy_resource_scheme\":\"codify://\",\"canonical_resource_scheme\":\"hyperfide://\","
            "\"namespace_ownership\":\"not_assumed\",\"compatibility_removal\":\"explicit_future_release\"}\n", output);
        return 0;
    }
    fputs("{\"ok\":false,\"error\":\"UNKNOWN_ACTION\"}\n", output);
    return 2;
}
