/* unit tests for src/drivers.c — argv building and the stream parser that
 * turns Claude stream-json and Codex exec --json lines into agent events */
#include "cg.h"
#include "tap.h"

typedef struct {
    int n;
    char kind[8][16], text[8][160], tool[8][64], sub[8][64], sess[8][64];
    long tin[8], tout[8], turns[8];
    double cost[8];
    int err[8];
} Seen;

static void on(const DriverEvent *e, void *ud) {
    Seen *s = ud;
    if (s->n >= 8) return;
    int i = s->n++;
    snprintf(s->kind[i], sizeof s->kind[i], "%s", e->kind);
    snprintf(s->text[i], sizeof s->text[i], "%s", e->text ? e->text : "");
    snprintf(s->tool[i], sizeof s->tool[i], "%s", e->tool ? e->tool : "");
    snprintf(s->sub[i], sizeof s->sub[i], "%s", e->subtype ? e->subtype : "");
    snprintf(s->sess[i], sizeof s->sess[i], "%s", e->session ? e->session : "");
    s->tin[i] = e->tokens_in;
    s->tout[i] = e->tokens_out;
    s->turns[i] = e->turns;
    s->cost[i] = e->cost;
    s->err[i] = e->is_error;
}

static int parse(const char *line, Seen *s) {
    memset(s, 0, sizeof *s);
    return driver_stream_parse(line, on, s);
}

static char *joined(char **av) {
    static char buf[1024];
    buf[0] = 0;
    for (int i = 0; av[i]; i++) {
        if (i) strcat(buf, " ");
        strcat(buf, av[i]);
    }
    return buf;
}

int main(void) {
    Seen s;

    /* ---- Claude Code stream-json ---- */
    ok(parse("{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"s-1\","
             "\"model\":\"opus\"}", &s) == 1, "claude init");
    ok_str(s.kind[0], "session");
    ok_str(s.sess[0], "s-1");
    ok_str(s.text[0], "opus");

    ok(parse("{\"type\":\"assistant\",\"message\":{\"content\":["
             "{\"type\":\"text\",\"text\":\"Looking at it.\"},"
             "{\"type\":\"tool_use\",\"name\":\"Bash\",\"input\":{\"command\":\"make test\"}},"
             "{\"type\":\"tool_use\",\"name\":\"Read\",\"input\":{\"file_path\":\"src/a.c\"}},"
             "{\"type\":\"thinking\",\"thinking\":\"...\"}],"
             "\"usage\":{\"input_tokens\":10,\"cache_read_input_tokens\":5,"
             "\"output_tokens\":7}}}", &s) == 4, "claude assistant: text, 2 tools, usage");
    ok_str(s.kind[0], "text");
    ok_str(s.text[0], "Looking at it.");
    ok_str(s.kind[1], "tool");
    ok_str(s.tool[1], "Bash");
    ok_str(s.text[1], "make test");
    ok_str(s.tool[2], "Read");
    ok_str(s.text[2], "src/a.c");
    ok_str(s.kind[3], "usage");
    ok(s.tin[3] == 15 && s.tout[3] == 7, "claude usage sums cache reads: %ld/%ld",
       s.tin[3], s.tout[3]);

    ok(parse("{\"type\":\"user\",\"message\":{\"content\":[{\"type\":"
             "\"tool_result\",\"content\":\"ok\"}]}}", &s) == 0,
       "claude tool results are not events");

    ok(parse("{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,"
             "\"total_cost_usd\":0.25,\"num_turns\":4,\"duration_ms\":900,"
             "\"session_id\":\"s-1\",\"result\":\"All done\","
             "\"usage\":{\"input_tokens\":100,\"output_tokens\":20}}", &s) == 1,
       "claude result");
    ok_str(s.kind[0], "result");
    ok_str(s.sub[0], "success");
    ok_str(s.text[0], "All done");
    ok(s.cost[0] > 0.2499 && s.cost[0] < 0.2501, "claude cost %f", s.cost[0]);
    ok(s.turns[0] == 4 && s.tin[0] == 100 && s.tout[0] == 20 && !s.err[0],
       "claude result totals");
    ok(parse("{\"type\":\"result\",\"subtype\":\"error_max_turns\","
             "\"is_error\":true}", &s) == 1 && s.err[0] && s.cost[0] < 0,
       "claude error result without a cost reads cost as unknown");

    /* ---- Codex exec --json ---- */
    ok(parse("{\"type\":\"thread.started\",\"thread_id\":\"th-9\"}", &s) == 1,
       "codex thread");
    ok_str(s.kind[0], "session");
    ok_str(s.sess[0], "th-9");
    ok(parse("{\"type\":\"item.started\",\"item\":{\"id\":\"1\",\"type\":"
             "\"command_execution\",\"command\":\"ls -la\"}}", &s) == 1,
       "codex command starts");
    ok_str(s.tool[0], "command_execution");
    ok_str(s.text[0], "ls -la");
    ok(parse("{\"type\":\"item.completed\",\"item\":{\"id\":\"1\",\"type\":"
             "\"command_execution\",\"command\":\"ls -la\",\"exit_code\":0}}",
             &s) == 0, "codex tool reported once, at its start");
    ok(parse("{\"type\":\"item.started\",\"item\":{\"id\":\"2\",\"type\":"
             "\"file_change\",\"changes\":[{\"path\":\"src/b.c\",\"kind\":"
             "\"update\"}]}}", &s) == 1, "codex file change");
    ok_str(s.text[0], "src/b.c");
    ok(parse("{\"type\":\"item.started\",\"item\":{\"id\":\"3\",\"type\":"
             "\"mcp_tool_call\",\"server\":\"codify\",\"tool\":\"get_context\"}}",
             &s) == 1, "codex mcp call");
    ok_str(s.tool[0], "get_context");
    ok(parse("{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\","
             "\"text\":\"Finished.\"}}", &s) == 1, "codex message");
    ok_str(s.kind[0], "text");
    ok_str(s.text[0], "Finished.");
    ok(parse("{\"type\":\"item.started\",\"item\":{\"type\":\"reasoning\","
             "\"text\":\"hmm\"}}", &s) == 0, "codex reasoning is not an event");
    ok(parse("{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":50,"
             "\"cached_input_tokens\":25,\"output_tokens\":9}}", &s) == 1,
       "codex usage");
    ok(s.tin[0] == 75 && s.tout[0] == 9 && s.turns[0] == 1, "codex usage values");
    ok(parse("{\"type\":\"turn.failed\",\"error\":{\"message\":\"boom\"}}", &s) == 1
       && s.err[0] && strcmp(s.text[0], "boom") == 0, "codex failure");

    /* ---- not a stream line ---- */
    ok(parse("plain text from stderr", &s) == 0, "plain text");
    ok(parse("", &s) == 0, "empty");
    ok(parse("{\"no_type\":1}", &s) == 0, "json without type");
    ok(parse("{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"te",
             &s) == 0, "truncated json yields nothing");

    /* ---- argv ---- */
    char *av[64];
    DriverSpec d = { "claude", "sonnet", "--x y", NULL, true };
    ok(driver_argv(&d, "/r", "/p", "1.1", "a", av, 64) > 0, "claude argv");
    ok_str(joined(av), "claude -p --permission-mode acceptEdits --output-format "
                       "stream-json --verbose --model sonnet --x y");
    for (int i = 0; av[i]; i++) free(av[i]);
    DriverSpec c = { "codex", "", "--extra", NULL, true };
    ok(driver_argv(&c, "/r", "/p", "1.1", "a", av, 64) > 0, "codex argv");
    ok_str(joined(av), "codex exec --sandbox workspace-write --skip-git-repo-check "
                       "-C /r --json --extra -");
    for (int i = 0; av[i]; i++) free(av[i]);
    DriverSpec u = { "custom", "m1", NULL, "run ${TASK} ${MODEL} ${AGENT} ${OTHER}", false };
    ok(driver_argv(&u, "/r", "/p", "2.3", "w-1", av, 64) == 3, "custom argv");
    ok_str(av[2], "run 2.3 m1 w-1 ${OTHER}");
    for (int i = 0; av[i]; i++) free(av[i]);
    DriverSpec none = { "custom", NULL, NULL, NULL, true };
    ok(driver_argv(&none, "/r", "/p", "1", "a", av, 64) == -1,
       "custom without a template");
    DriverSpec bad = { "gpt", NULL, NULL, NULL, true };
    ok(driver_argv(&bad, "/r", "/p", "1", "a", av, 64) == -1, "unknown driver");

    return t_done("drivers");
}
