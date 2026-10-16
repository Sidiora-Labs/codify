/* Runtime observations, never scheduling or publication authority. */
#define _GNU_SOURCE
#include "components.h"
#include "preparation_support.h"
#include <ctype.h>
#include <dirent.h>
#include <netdb.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/statvfs.h>
#include <sys/utsname.h>

static const char *verify_script =
    "import fs from 'node:fs';import{createHash}from'node:crypto';\nconst "
    "out=value=>process.stdout.write(JSON.stringify(value)+'\\n');\nconst "
    "sha=value=>'sha256:'+createHash('sha256').update(value).digest('hex');"
    "\nconst "
    "canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+'"
    "]':value&&typeof "
    "value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':"
    "'+canonical(value[k])).join(',')+'}':JSON.stringify(value);\ntry{\n const "
    "bytes=fs.readFileSync(Number(process.env.HF_VERIFY_MODULE_FD));\n "
    "if(sha(bytes)!==process.env.HF_VERIFY_MODULE_DIGEST)throw Error();\n "
    "const module=await "
    "import('data:text/javascript;base64,'+bytes.toString('base64'));\n const "
    "manifest=JSON.parse(fs.readFileSync(Number(process.env.HF_VERIFY_MANIFEST_"
    "FD),'utf8'));\n const "
    "policy=JSON.parse(fs.readFileSync(Number(process.env.HF_VERIFY_POLICY_FD),"
    "'utf8'));\n "
    "if(manifest.digest!==process.env.HF_VERIFY_PREPARATION_DIGEST||sha("
    "canonical(manifest.profile))!==process.env.HF_VERIFY_PROFILE_DIGEST)throw "
    "Error();\n const controller=new "
    "AbortController();process.once('SIGTERM',()=>controller.abort());\n const "
    "result=await "
    "module.verifyManifest({candidate_path:process.env.HF_VERIFY_BASE,manifest,"
    "scan_policy:policy},\n  "
    "{signal:controller.signal,env:{HF_PREPARATION_ALLOWED_ROOT:process.env.HF_"
    "VERIFY_ROOT}});\n "
    "out({verified:true,digest:result.digest,file_count:result.file_count});\n}"
    "catch{out({verified:false});process.exitCode=1;}";
static void readiness_signal(int number) {
  (void)number;
  hp_cancelled = 1;
}
static int config_file(const char *name, size_t maximum) {
  const char *path = getenv(name);
  if (!path || path[0] != '/' || !hp_relative(path + 1))
    return -1;
  char copy[PATH_MAX];
  if (strlen(path) >= sizeof copy)
    return -1;
  strcpy(copy, path + 1);
  char *base = copy, *slash = strrchr(copy, '/');
  int parent = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (parent < 0)
    return -1;
  if (slash) {
    *slash = 0;
    base = slash + 1;
    int next = hp_open_dir(parent, copy, 0);
    close(parent);
    parent = next;
    if (parent < 0)
      return -1;
  }
  int fd = openat(parent, base, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  close(parent);
  struct stat info;
  if (fd < 0)
    return -1;
  if (fstat(fd, &info) || !S_ISREG(info.st_mode) || info.st_nlink != 1 ||
      info.st_size < 1 || (uint64_t)info.st_size > maximum ||
      (info.st_mode & 0022) || (info.st_uid != 0 && info.st_uid != geteuid())) {
    close(fd);
    return -1;
  }
  return fd;
}
static char *read_json_fd(int fd, size_t maximum) {
  struct stat info;
  if (fstat(fd, &info) || info.st_size < 2 ||
      (uint64_t)info.st_size > maximum || lseek(fd, 0, SEEK_SET) < 0)
    return NULL;
  char *data = malloc((size_t)info.st_size + 1);
  if (!data)
    return NULL;
  size_t offset = 0;
  while (offset < (size_t)info.st_size) {
    ssize_t n = read(fd, data + offset, (size_t)info.st_size - offset);
    if (n < 0 && errno == EINTR)
      continue;
    if (n <= 0) {
      free(data);
      return NULL;
    }
    offset += (size_t)n;
  }
  data[offset] = 0;
  if (strlen(data) != offset || !hp_valid(data)) {
    free(data);
    return NULL;
  }
  lseek(fd, 0, SEEK_SET);
  return data;
}
static int environment_equal(const char *name, const char *expected) {
  const char *actual = getenv(name);
  return actual && !strcmp(actual, expected);
}
static int decimal_value(const char *raw, const char *key, uint64_t *out) {
  char value[32], *end = NULL;
  if (!hp_text(raw, key, value, sizeof value) || value[0] == '-')
    return 0;
  if (value[0] == '0' && value[1])
    return 0;
  errno = 0;
  unsigned long long result = strtoull(value, &end, 10);
  if (errno || *end || result > INT64_MAX)
    return 0;
  *out = (uint64_t)result;
  return 1;
}
static int hash_absolute(const char *path, char out[72]) {
  if (!path || path[0] != '/' || !hp_relative(path + 1))
    return 0;
  int root = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (root < 0)
    return 0;
  int ok = hp_hash_file(root, path + 1, out);
  close(root);
  return ok;
}
static int manifest_check(const char *base, int manifest, const char *profile,
                          const char *preparation, const char *diagnostics,
                          int *sequence, const char *root_env) {
  int module = config_file("HF_READINESS_MODULE_PATH", 4 * 1024 * 1024),
      policy = config_file("HF_READINESS_SCAN_POLICY_FILE", 1024 * 1024);
  const char *node = getenv("HF_READINESS_NODE_EXECUTABLE"),
             *module_digest = getenv("HF_READINESS_MODULE_DIGEST"),
             *node_digest = getenv("HF_READINESS_NODE_DIGEST");
  char actual[72];
  int ok = 0;
  if (module < 0 || policy < 0 || lseek(manifest, 0, SEEK_SET) < 0 || !node ||
      !hp_digest(module_digest) || !hp_digest(node_digest) ||
      !hash_absolute(node, actual) || strcmp(actual, node_digest))
    goto done;
  int descriptors[] = {module, manifest, policy};
  for (unsigned i = 0; i < 3; i++)
    if (fcntl(descriptors[i], F_SETFD, 0))
      goto done;
  char module_fd[32], manifest_fd[32], policy_fd[32], log[PATH_MAX];
  snprintf(module_fd, sizeof module_fd, "%d", module);
  snprintf(manifest_fd, sizeof manifest_fd, "%d", manifest);
  snprintf(policy_fd, sizeof policy_fd, "%d", policy);
  const char *root = getenv(root_env);
  const char *names[] = {"HF_VERIFY_MODULE_FD",
                         "HF_VERIFY_MANIFEST_FD",
                         "HF_VERIFY_POLICY_FD",
                         "HF_VERIFY_MODULE_DIGEST",
                         "HF_VERIFY_PREPARATION_DIGEST",
                         "HF_VERIFY_PROFILE_DIGEST",
                         "HF_VERIFY_BASE",
                         "HF_VERIFY_ROOT"};
  const char *values[] = {module_fd,   manifest_fd, policy_fd, module_digest,
                          preparation, profile,     base,      root};
  char *extra[9] = {0};
  for (unsigned i = 0; i < 8; i++)
    if (!values[i] || asprintf(&extra[i], "%s=%s", names[i], values[i]) < 0) {
      for (unsigned j = 0; j < 8; j++)
        free(extra[j]);
      goto done;
    }
  if (snprintf(log, sizeof log, "%s/manifest-%06d.jsonl", diagnostics,
               (*sequence)++) >= (int)sizeof log) {
    for (unsigned j = 0; j < 8; j++)
      free(extra[j]);
    goto done;
  }
  char *argv[] = {(char *)node, "--input-type=module", "-e",
                  (char *)verify_script, NULL};
  int result = hp_spawn_env(diagnostics, argv, log, 300, extra);
  for (unsigned i = 0; i < 8; i++)
    free(extra[i]);
  for (unsigned i = 0; i < 3; i++)
    fcntl(descriptors[i], F_SETFD, FD_CLOEXEC);
  if (result)
    goto done;
  FILE *stream = fopen(log, "r");
  char line[4096], observed[72];
  if (!stream)
    goto done;
  if (!fgets(line, sizeof line, stream) || fgetc(stream) != EOF) {
    fclose(stream);
    goto done;
  }
  fclose(stream);
  char *verified = hp_field(line, "verified");
  ok = hp_valid(line) && verified && !strcmp(verified, "true") &&
       hp_text(line, "digest", observed, sizeof observed) &&
       !strcmp(observed, preparation);
  free(verified);
done:
  fcntl(manifest, F_SETFD, FD_CLOEXEC);
  if (module >= 0)
    close(module);
  if (policy >= 0)
    close(policy);
  return ok;
}
static int profile_os(const char *profile) {
  char *os = hp_field(profile, "os"), arch[64], distribution[128], version[128];
  int ok = 0;
  if (!os || !hp_text(os, "architecture", arch, sizeof arch) ||
      !hp_text(os, "distribution", distribution, sizeof distribution) ||
      !hp_text(os, "version", version, sizeof version))
    goto done;
  struct utsname info;
  if (uname(&info) || strcmp(info.machine, arch))
    goto done;
  FILE *stream = fopen("/etc/os-release", "r");
  if (!stream)
    goto done;
  char line[2048], actual_id[128] = "", actual_version[128] = "";
  while (fgets(line, sizeof line, stream)) {
    char *target = NULL, *value = NULL;
    if (!strncmp(line, "ID=", 3)) {
      target = actual_id;
      value = line + 3;
    } else if (!strncmp(line, "VERSION_ID=", 11)) {
      target = actual_version;
      value = line + 11;
    }
    if (target && value) {
      value[strcspn(value, "\r\n")] = 0;
      if (value[0] == '"') {
        value++;
        char *end = strrchr(value, '"');
        if (end)
          *end = 0;
      }
      if (strlen(value) < 128)
        strcpy(target, value);
    }
  }
  fclose(stream);
  ok = !strcmp(distribution, actual_id) && !strcmp(version, actual_version);
done:
  free(os);
  return ok;
}
static int find_binding(const char *bindings, const char *name,
                        const char *version, char **out) {
  int n = hp_count(bindings), found = 0;
  if (n < 0 || n > 1024)
    return 0;
  for (int i = 0; i < n; i++) {
    char *row = hp_item(bindings, i), actual_name[128], actual_version[128];
    if (row && hp_text(row, "name", actual_name, sizeof actual_name) &&
        !strcmp(actual_name, name)) {
      if (found ||
          !hp_text(row, "version", actual_version, sizeof actual_version) ||
          strcmp(actual_version, version)) {
        free(row);
        free(*out);
        *out = NULL;
        return 0;
      }
      *out = row;
      found = 1;
    } else
      free(row);
  }
  return found;
}
static int probe_tool(const char *binding, const char *workspace,
                      const char *diagnostics, int *sequence) {
  static const char *const keys[] = {"name", "version", "executable", "argv",
                                     "output_digest"};
  char executable[PATH_MAX], expected[72];
  char *args = hp_field(binding, "argv");
  int count = hp_count(args), ok = 0;
  if (!hp_shape(binding, keys, 5) ||
      !hp_text(binding, "executable", executable, sizeof executable) ||
      executable[0] != '/' ||
      !hp_text(binding, "output_digest", expected, sizeof expected) ||
      !hp_digest(expected) || count < 0 || count > 64)
    goto done;
  char resolved[PATH_MAX];
  struct stat info;
  if (!realpath(executable, resolved) || stat(resolved, &info) ||
      !S_ISREG(info.st_mode) || access(resolved, X_OK))
    goto done;
  char **argv = calloc((size_t)count + 2, sizeof(char *));
  if (!argv)
    goto done;
  argv[0] = strdup(resolved);
  for (int i = 0; i < count; i++) {
    char *raw = hp_item(args, i), text[4097];
    if (!raw || !hp_argument(raw, text, sizeof text)) {
      free(raw);
      goto argv_done;
    }
    free(raw);
    argv[i + 1] = strdup(text);
    if (!argv[i + 1])
      goto argv_done;
  }
  char log[PATH_MAX], relative[64];
  snprintf(relative, sizeof relative, "tool-%06d.txt", (*sequence)++);
  if (snprintf(log, sizeof log, "%s/%s", diagnostics, relative) >=
          (int)sizeof log ||
      hp_spawn(workspace, argv, log, 30))
    goto argv_done;
  int root = open(diagnostics, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  char actual[72];
  if (root >= 0) {
    ok = hp_hash_file(root, relative, actual) && !strcmp(actual, expected);
    close(root);
  }
argv_done:
  for (int i = 0; i < count + 1; i++)
    free(argv[i]);
  free(argv);
done:
  free(args);
  return ok;
}
static int tools_ready(const char *profile, const char *workspace,
                       const char *diagnostics, int *sequence) {
  int fd = config_file("HF_READINESS_TOOL_BINDINGS_FILE", 1024 * 1024);
  if (fd < 0)
    return 0;
  char *config = read_json_fd(fd, 1024 * 1024);
  close(fd);
  if (!config)
    return 0;
  char *bindings = hp_field(config, "bindings");
  int ok = 1;
  const char *groups[] = {"toolchains", "package_managers", "native_agents",
                          "connectors", "system_packages"};
  for (unsigned group = 0; group < 5 && ok; group++) {
    char *values = hp_field(profile, groups[group]);
    int count = hp_count(values);
    if (count < 0) {
      free(values);
      ok = 0;
      break;
    }
    for (int i = 0; i < count && ok; i++) {
      char *pin = hp_item(values, i), name[128], version[128], *binding = NULL;
      ok = pin && hp_text(pin, "name", name, sizeof name) &&
           hp_text(pin, "version", version, sizeof version) &&
           find_binding(bindings, name, version, &binding) &&
           probe_tool(binding, workspace, diagnostics, sequence);
      free(pin);
      free(binding);
    }
    free(values);
  }
  const char *single[] = {"supervisor", "hyperfide"};
  for (unsigned i = 0; i < 2 && ok; i++) {
    char *pin = hp_field(profile, single[i]), name[128], version[128],
         *binding = NULL;
    ok = pin && hp_text(pin, "version", version, sizeof version);
    if (i == 1)
      strcpy(name, "hyperfide");
    else
      ok = ok && hp_text(pin, "name", name, sizeof name);
    ok = ok && find_binding(bindings, name, version, &binding) &&
         probe_tool(binding, workspace, diagnostics, sequence);
    free(pin);
    free(binding);
  }
  free(bindings);
  free(config);
  return ok;
}
/* Verify tracked bytes against Git objects without trusting the worker index or
 * invoking filters. */
static int source_same_stat(const struct stat *a, const struct stat *b) {
  return a->st_dev == b->st_dev && a->st_ino == b->st_ino &&
         a->st_mode == b->st_mode && a->st_nlink == b->st_nlink &&
         a->st_size == b->st_size && a->st_mtim.tv_sec == b->st_mtim.tv_sec &&
         a->st_mtim.tv_nsec == b->st_mtim.tv_nsec &&
         a->st_ctim.tv_sec == b->st_ctim.tv_sec &&
         a->st_ctim.tv_nsec == b->st_ctim.tv_nsec;
}
static int source_parent(int root, const char *relative,
                         char leaf[NAME_MAX + 1]) {
  if (!hp_relative(relative))
    return -1;
  char *copy = strdup(relative);
  if (!copy)
    return -1;
  char *last = strrchr(copy, '/');
  int parent;
  if (last) {
    *last = 0;
    parent = hp_open_dir(root, copy, 0);
    last++;
  } else {
    parent = dup(root);
    last = copy;
  }
  if (strlen(last) > NAME_MAX) {
    if (parent >= 0)
      close(parent);
    free(copy);
    return -1;
  }
  strcpy(leaf, last);
  free(copy);
  return parent;
}
static int source_metadata_open(int root, const char *relative) {
  if (!relative || !*relative || relative[0] == '/' ||
      strlen(relative) >= PATH_MAX)
    return -1;
  char *copy = strdup(relative), *save = NULL;
  int current = dup(root);
  if (!copy)
    return -1;
  for (char *part = strtok_r(copy, "/", &save); part && current >= 0;
       part = strtok_r(NULL, "/", &save)) {
    if (!strcmp(part, ".") || !strcmp(part, "..")) {
      close(current);
      current = -1;
      break;
    }
    int next =
        openat(current, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    close(current);
    current = next;
  }
  free(copy);
  return current;
}
static int source_metadata_safe(const char *repository, const char *workspace) {
  int root = open(repository, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC),
      metadata = -1;
  if (root < 0)
    return 0;
  struct stat info;
  if (fstatat(root, ".git", &info, AT_SYMLINK_NOFOLLOW))
    goto done;
  if (S_ISDIR(info.st_mode))
    metadata =
        openat(root, ".git", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  else if (S_ISREG(info.st_mode) && info.st_nlink == 1 && info.st_size > 8 &&
           info.st_size < PATH_MAX) {
    int fd = openat(root, ".git", O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    char data[PATH_MAX], candidate[PATH_MAX], resolved[PATH_MAX];
    ssize_t n = fd >= 0 ? read(fd, data, sizeof data - 1) : -1;
    struct stat after;
    int stable =
        fd >= 0 && fstat(fd, &after) == 0 && source_same_stat(&info, &after);
    if (fd >= 0)
      close(fd);
    if (!stable || n != info.st_size)
      goto done;
    data[n] = 0;
    if (strncmp(data, "gitdir: ", 8) || strchr(data + 8, '\r'))
      goto done;
    data[strcspn(data, "\n")] = 0;
    int written = data[8] == '/'
                      ? snprintf(candidate, sizeof candidate, "%s", data + 8)
                      : snprintf(candidate, sizeof candidate, "%s/%s",
                                 repository, data + 8);
    size_t length = strlen(workspace);
    if (written < 0 || written >= (int)sizeof candidate ||
        !realpath(candidate, resolved) ||
        strncmp(resolved, workspace, length) || resolved[length] != '/')
      goto done;
    int workspace_fd =
        open(workspace, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (workspace_fd >= 0) {
      metadata = source_metadata_open(workspace_fd, resolved + length + 1);
      close(workspace_fd);
    }
  }
  if (metadata >= 0) {
    const char *denied[] = {"commondir", "objects/info/alternates",
                            "objects/info/http-alternates", "info/grafts",
                            "refs/replace"};
    for (unsigned i = 0; i < sizeof denied / sizeof denied[0]; i++) {
      char leaf[NAME_MAX + 1];
      int parent = source_parent(metadata, denied[i], leaf);
      if (parent < 0) {
        if (errno == ENOENT)
          continue;
        close(metadata);
        metadata = -1;
        break;
      }
      int found = fstatat(parent, leaf, &info, AT_SYMLINK_NOFOLLOW) == 0;
      int saved = errno;
      close(parent);
      if (found || saved != ENOENT) {
        close(metadata);
        metadata = -1;
        break;
      }
    }
  }
done:
  close(root);
  if (metadata < 0)
    return 0;
  close(metadata);
  return 1;
}
static int source_git(const char *repository, const char *diagnostics,
                      int *sequence, char *const tail[],
                      char output[PATH_MAX]) {
  struct stat executable;
  if (stat("/usr/bin/git", &executable) || !S_ISREG(executable.st_mode) ||
      executable.st_uid != 0 || (executable.st_mode & 022))
    return 0;
  if (snprintf(output, PATH_MAX, "%s/content-%06d.txt", diagnostics,
               (*sequence)++) >= PATH_MAX)
    return 0;
  char *argv[96];
  int n = 0;
  argv[n++] = "/usr/bin/git";
  argv[n++] = "--no-pager";
  argv[n++] = "-c";
  argv[n++] = "core.hooksPath=/dev/null";
  argv[n++] = "-c";
  argv[n++] = "core.fsmonitor=false";
  argv[n++] = "-c";
  argv[n++] = "protocol.allow=never";
  for (int i = 0; tail[i]; i++) {
    if (n >= 94)
      return 0;
    argv[n++] = tail[i];
  }
  argv[n] = NULL;
  char *extra[] = {"GIT_NO_LAZY_FETCH=1", "GIT_NO_REPLACE_OBJECTS=1", NULL};
  return hp_spawn_env(repository, argv, output,
                      !strcmp(tail[0], "fsck") ? 300 : 30, extra) == 0;
}
static int source_config_safe(const char *repository, const char *diagnostics,
                              int *sequence) {
  char log[PATH_MAX];
  char *args[] = {"config",      "--local", "--no-includes",
                  "--name-only", "--list",  NULL};
  if (!source_git(repository, diagnostics, sequence, args, log))
    return 0;
  FILE *file = fopen(log, "r");
  if (!file)
    return 0;
  char line[8192];
  int ok = 1;
  while (fgets(line, sizeof line, file)) {
    if (!strchr(line, '\n') && !feof(file)) {
      ok = 0;
      break;
    }
    for (char *p = line; *p; p++)
      *p = (char)tolower((unsigned char)*p);
    line[strcspn(line, "\r\n")] = 0;
    size_t n = strlen(line);
    if (!strncmp(line, "include.", 8) || !strncmp(line, "includeif.", 10) ||
        !strncmp(line, "fsck.", 5) || !strncmp(line, "fetch.fsck.", 11) ||
        !strncmp(line, "receive.fsck.", 13) ||
        !strcmp(line, "extensions.partialclone") ||
        !strcmp(line, "extensions.worktreeconfig") ||
        (n >= 9 && !strcmp(line + n - 9, ".promisor"))) {
      ok = 0;
      break;
    }
  }
  if (ferror(file))
    ok = 0;
  fclose(file);
  return ok;
}
static int source_blob_at(int root, const char *relative, const char *mode,
                          const char *expected, char sha256[72],
                          uint64_t *size) {
  char leaf[NAME_MAX + 1];
  int parent = source_parent(root, relative, leaf), fd = -1, ok = 0;
  struct stat before, after, named;
  if (parent < 0)
    return 0;
  if (fstatat(parent, leaf, &before, AT_SYMLINK_NOFOLLOW))
    goto done;
  int link = !strcmp(mode, "120000");
  if (link ? !S_ISLNK(before.st_mode) : !S_ISREG(before.st_mode))
    goto done;
  if (before.st_size < 0 || before.st_size > 2147483648LL ||
      (!link &&
       (((before.st_mode & S_IXUSR) != 0) != (strcmp(mode, "100755") == 0))))
    goto done;
  EVP_MD_CTX *git = EVP_MD_CTX_new(), *raw = EVP_MD_CTX_new();
  if (!git || !raw) {
    EVP_MD_CTX_free(git);
    EVP_MD_CTX_free(raw);
    goto done;
  }
  const EVP_MD *algorithm = strlen(expected) == 40 ? EVP_sha1() : EVP_sha256();
  char header[96];
  int header_size =
      snprintf(header, sizeof header, "blob %lld", (long long)before.st_size);
  ok = header_size > 0 && EVP_DigestInit_ex(git, algorithm, NULL) &&
       EVP_DigestInit_ex(raw, EVP_sha256(), NULL) &&
       EVP_DigestUpdate(git, header, (size_t)header_size + 1);
  uint64_t total = 0;
  if (link) {
    char target[65536];
    ssize_t n = readlinkat(parent, leaf, target, sizeof target);
    ok = ok && n == before.st_size && n >= 0 && (size_t)n < sizeof target;
    if (ok) {
      ok = EVP_DigestUpdate(git, target, (size_t)n) &&
           EVP_DigestUpdate(raw, target, (size_t)n);
      total = (uint64_t)n;
    }
  } else {
    fd = openat(parent, leaf, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0)
      ok = 0;
    if (ok && (fstat(fd, &after) || !source_same_stat(&before, &after)))
      ok = 0;
    unsigned char buffer[65536];
    while (ok) {
      if (hp_cancelled) {
        ok = 0;
        break;
      }
      ssize_t n = read(fd, buffer, sizeof buffer);
      if (n < 0 && errno == EINTR)
        continue;
      if (n < 0) {
        ok = 0;
        break;
      }
      if (!n)
        break;
      total += (uint64_t)n;
      if (total > (uint64_t)before.st_size) {
        ok = 0;
        break;
      }
      ok = EVP_DigestUpdate(git, buffer, (size_t)n) &&
           EVP_DigestUpdate(raw, buffer, (size_t)n);
    }
    if (ok && (fstat(fd, &after) || !source_same_stat(&before, &after)))
      ok = 0;
  }
  unsigned char git_bytes[EVP_MAX_MD_SIZE], raw_bytes[EVP_MAX_MD_SIZE];
  unsigned git_size = 0, raw_size = 0;
  if (ok)
    ok = total == (uint64_t)before.st_size &&
         EVP_DigestFinal_ex(git, git_bytes, &git_size) &&
         EVP_DigestFinal_ex(raw, raw_bytes, &raw_size) && raw_size == 32;
  EVP_MD_CTX_free(git);
  EVP_MD_CTX_free(raw);
  if (ok) {
    char actual[129];
    for (unsigned i = 0; i < git_size; i++)
      snprintf(actual + i * 2, 3, "%02x", git_bytes[i]);
    strcpy(sha256, "sha256:");
    for (unsigned i = 0; i < 32; i++)
      snprintf(sha256 + 7 + i * 2, 3, "%02x", raw_bytes[i]);
    *size = total;
    ok = !strcmp(actual, expected) ? 1 : 2;
    if (fstatat(parent, leaf, &named, AT_SYMLINK_NOFOLLOW) ||
        !source_same_stat(&before, &named))
      ok = 0;
  }
done:
  if (fd >= 0)
    close(fd);
  close(parent);
  return ok;
}
static int source_lfs_matches(const char *repository, const char *oid,
                              const char *actual, uint64_t size,
                              const char *diagnostics, int *sequence) {
  char log[PATH_MAX];
  char *args[] = {"cat-file", "blob", (char *)oid, NULL};
  if (!source_git(repository, diagnostics, sequence, args, log))
    return 0;
  struct stat info;
  if (stat(log, &info) || info.st_size < 1 || info.st_size > 1024)
    return 0;
  FILE *file = fopen(log, "r");
  char data[1025], hex[65], length[32];
  if (!file)
    return 0;
  size_t n = fread(data, 1, sizeof data - 1, file);
  int ok = !ferror(file) && n == (size_t)info.st_size;
  fclose(file);
  data[n] = 0;
  if (!ok || memchr(data, 0, n))
    return 0;
  int consumed = 0;
  if (sscanf(data,
             "version https://git-lfs.github.com/spec/v1\noid "
             "sha256:%64[0-9a-f]\nsize %31[0-9]\n%n",
             hex, length, &consumed) != 2 ||
      strlen(hex) != 64 || consumed != (int)n)
    return 0;
  char expected[1025], raw[72];
  uint64_t declared;
  if ((length[0] == '0' && length[1]) || strlen(length) > 20)
    return 0;
  errno = 0;
  char *end = NULL;
  declared = strtoull(length, &end, 10);
  if (errno || !end || *end || declared != size ||
      snprintf(raw, sizeof raw, "sha256:%s", hex) >= (int)sizeof raw ||
      strcmp(raw, actual))
    return 0;
  int written = snprintf(
      expected, sizeof expected,
      "version https://git-lfs.github.com/spec/v1\noid sha256:%s\nsize %s\n",
      hex, length);
  return written == (int)n && !memcmp(data, expected, n);
}
static int source_tree_clean(const char *repository, const char *commit,
                             const char *workspace, const char *diagnostics,
                             int *sequence, int lfs, int depth, int *budget) {
  if (hp_cancelled || depth > 32 || --*budget < 0 ||
      !source_metadata_safe(repository, workspace) ||
      !source_config_safe(repository, diagnostics, sequence))
    return 0;
  char log[PATH_MAX];
  char *fsck[] = {"fsck",          "--full",        "--no-reflogs",
                  "--no-dangling", "--no-progress", NULL};
  if (!source_git(repository, diagnostics, sequence, fsck, log))
    return 0;
  char *head[] = {"rev-parse", "--verify", "HEAD", NULL};
  if (!source_git(repository, diagnostics, sequence, head, log))
    return 0;
  FILE *file = fopen(log, "r");
  char observed[128];
  int ok = file && fgets(observed, sizeof observed, file);
  if (file)
    fclose(file);
  if (!ok)
    return 0;
  observed[strcspn(observed, "\r\n")] = 0;
  if (strcmp(observed, commit))
    return 0;
  char *index_args[] = {
      "diff-index",    "--cached",     "--quiet", "--no-ext-diff",
      "--no-textconv", (char *)commit, "--",      NULL};
  if (!source_git(repository, diagnostics, sequence, index_args, log))
    return 0;
  char *args[] = {"ls-tree", "-r", "-z", (char *)commit, NULL};
  if (!source_git(repository, diagnostics, sequence, args, log))
    return 0;
  struct stat listing;
  if (stat(log, &listing) || listing.st_size < 0 ||
      listing.st_size > 16 * 1024 * 1024)
    return 0;
  file = fopen(log, "rb");
  if (!file)
    return 0;
  char *entries = malloc((size_t)listing.st_size + 1);
  if (!entries) {
    fclose(file);
    return 0;
  }
  size_t bytes = fread(entries, 1, (size_t)listing.st_size, file);
  ok = !ferror(file) && bytes == (size_t)listing.st_size;
  fclose(file);
  entries[bytes] = 0;
  int root = open(repository, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (root < 0)
    ok = 0;
  size_t offset = 0;
  while (ok && offset < bytes) {
    char *entry = entries + offset;
    size_t n = strnlen(entry, bytes - offset);
    if (n == bytes - offset) {
      ok = 0;
      break;
    }
    offset += n + 1;
    char *tab = strchr(entry, '\t'), mode[8], type[16], oid[65], extra;
    if (!tab) {
      ok = 0;
      break;
    }
    *tab = 0;
    if (sscanf(entry, "%7s %15s %64s %c", mode, type, oid, &extra) != 3 ||
        !hp_oid(oid) || !hp_relative(tab + 1)) {
      ok = 0;
      break;
    }
    if (!strcmp(mode, "160000") && !strcmp(type, "commit")) {
      char child[PATH_MAX];
      int child_fd = hp_open_dir(root, tab + 1, 0);
      if (child_fd < 0 || snprintf(child, sizeof child, "%s/%s", repository,
                                   tab + 1) >= (int)sizeof child) {
        if (child_fd >= 0)
          close(child_fd);
        ok = 0;
        break;
      }
      close(child_fd);
      ok = source_tree_clean(child, oid, workspace, diagnostics, sequence, lfs,
                             depth + 1, budget);
    } else if ((!strcmp(mode, "100644") || !strcmp(mode, "100755") ||
                !strcmp(mode, "120000")) &&
               !strcmp(type, "blob")) {
      char actual[72];
      uint64_t size = 0;
      int content = source_blob_at(root, tab + 1, mode, oid, actual, &size);
      ok = content == 1 || (content == 2 && lfs && strcmp(mode, "120000") &&
                            source_lfs_matches(repository, oid, actual, size,
                                               diagnostics, sequence));
    } else
      ok = 0;
  }
  if (root >= 0)
    close(root);
  free(entries);
  return ok;
}

static int source_ready(const char *profile, const char *workspace,
                        const char *diagnostics, int *sequence,
                        int inventory_verified, int source_only,
                        char **bindings) {
  char *captured = NULL;
  size_t captured_size = 0;
  FILE *capture = open_memstream(&captured, &captured_size);
  if (!capture)
    return 0;
  fputs("[", capture);
  char *repos = hp_field(profile, "repositories");
  int count = hp_count(repos), ok = count > 0 && count <= 64;
  if (ok && !inventory_verified) {
    DIR *directory = opendir(workspace);
    if (!directory)
      ok = 0;
    if (directory) {
      struct dirent *entry;
      while ((entry = readdir(directory))) {
        if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, ".."))
          continue;
        int declared = 0;
        for (int j = 0; j < count; j++) {
          char *row = hp_item(repos, j), id[97];
          if (row && hp_text(row, "id", id, sizeof id) &&
              !strcmp(id, entry->d_name))
            declared = 1;
          free(row);
        }
        struct stat info;
        if (!declared ||
            fstatat(dirfd(directory), entry->d_name, &info,
                    AT_SYMLINK_NOFOLLOW) ||
            !S_ISDIR(info.st_mode)) {
          ok = 0;
          break;
        }
      }
      closedir(directory);
    }
  }
  for (int i = 0; i < count && ok; i++) {
    char *repo = hp_item(repos, i), id[97], commit[65], directory[PATH_MAX],
         log[PATH_MAX];
    ok = repo && hp_text(repo, "id", id, sizeof id) && hp_id(id) &&
         hp_text(repo, "commit", commit, sizeof commit) && hp_oid(commit);
    char *lfs_value = repo ? hp_field(repo, "lfs") : NULL;
    int allow_lfs = lfs_value && !strcmp(lfs_value, "true");
    free(lfs_value);
    free(repo);
    if (!ok)
      break;
    int root = open(workspace, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC),
        sub = -1;
    if (root >= 0) {
      sub = hp_open_dir(root, id, 0);
      close(root);
    }
    if (sub < 0) {
      ok = 0;
      break;
    }
    close(sub);
    if (snprintf(directory, sizeof directory, "%s/%s", workspace, id) >=
            (int)sizeof directory ||
        snprintf(log, sizeof log, "%s/source-%06d.txt", diagnostics,
                 (*sequence)++) >= (int)sizeof log) {
      ok = 0;
      break;
    }
    if (!source_metadata_safe(directory, workspace) ||
        !source_config_safe(directory, diagnostics, sequence)) {
      ok = 0;
      break;
    }
    char *argv[] = {"/usr/bin/git", "--no-replace-objects",
                    "-c",           "core.hooksPath=/dev/null",
                    "-c",           "core.fsmonitor=false",
                    "rev-parse",    "--verify",
                    "HEAD",         NULL};
    if (hp_spawn(directory, argv, log, 30)) {
      ok = 0;
      break;
    }
    FILE *stream = fopen(log, "r");
    char observed[128];
    ok = stream && fgets(observed, sizeof observed, stream);
    if (stream)
      fclose(stream);
    if (ok) {
      observed[strcspn(observed, "\r\n")] = 0;
      ok = !strcmp(observed, commit);
    }
    if (ok) {
      snprintf(log, sizeof log, "%s/source-%06d.txt", diagnostics,
               (*sequence)++);
      char *tree_args[] = {"/usr/bin/git", "--no-replace-objects",
                           "-c",           "core.hooksPath=/dev/null",
                           "-c",           "core.fsmonitor=false",
                           "rev-parse",    "--verify",
                           "HEAD^{tree}",  NULL};
      char tree[128];
      if (hp_spawn(directory, tree_args, log, 30)) {
        ok = 0;
        break;
      }
      FILE *tree_stream = fopen(log, "r");
      ok = tree_stream && fgets(tree, sizeof tree, tree_stream);
      if (tree_stream)
        fclose(tree_stream);
      if (ok) {
        tree[strcspn(tree, "\r\n")] = 0;
        ok = hp_oid(tree);
      }
      if (ok) {
        if (i)
          fputc(',', capture);
        fputs("{\"commit\":", capture);
        hp_quote(capture, commit);
        fputs(",\"id\":", capture);
        hp_quote(capture, id);
        fputs(",\"tree\":", capture);
        hp_quote(capture, tree);
        fputc('}', capture);
      }
    }
    if (ok) {
      snprintf(log, sizeof log, "%s/source-%06d.txt", diagnostics,
               (*sequence)++);
      int budget = 256;
      ok = source_tree_clean(directory, commit, workspace, diagnostics,
                             sequence, allow_lfs, 0, &budget);
    }

    if (ok && !inventory_verified) {
      for (int ignored = 0; ignored < 2 && ok; ignored++) {
        snprintf(log, sizeof log, "%s/source-%06d.txt", diagnostics,
                 (*sequence)++);
        char *untracked[] = {"/usr/bin/git",
                             "--no-replace-objects",
                             "-c",
                             "core.hooksPath=/dev/null",
                             "-c",
                             "core.fsmonitor=false",
                             "ls-files",
                             "--others",
                             "--exclude-standard",
                             "-z",
                             "--",
                             NULL};
        char *ignored_files[] = {"/usr/bin/git",
                                 "--no-replace-objects",
                                 "-c",
                                 "core.hooksPath=/dev/null",
                                 "-c",
                                 "core.fsmonitor=false",
                                 "ls-files",
                                 "--others",
                                 "--ignored",
                                 "--exclude-standard",
                                 "-z",
                                 "--",
                                 NULL};
        struct stat listing;
        ok = hp_spawn(directory, ignored ? ignored_files : untracked, log,
                      30) == 0 &&
             stat(log, &listing) == 0 && listing.st_size == 0;
      }
    }
    if (ok) {
      char *description = hp_item(repos, i),
           *modules = description ? hp_field(description, "submodules") : NULL;
      int module_count = hp_count(modules);
      ok = module_count >= 0;
      for (int m = 0; m < module_count && ok; m++) {
        char *pin = hp_item(modules, m), relative[2049], expected[65],
             child[PATH_MAX];
        ok = pin && hp_text(pin, "path", relative, sizeof relative) &&
             hp_relative(relative) &&
             hp_text(pin, "commit", expected, sizeof expected);
        free(pin);
        if (!ok)
          break;
        int parent = open(directory,
                          O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC),
            fd = parent >= 0 ? hp_open_dir(parent, relative, 0) : -1;
        if (parent >= 0)
          close(parent);
        if (fd < 0) {
          ok = 0;
          break;
        }
        close(fd);
        if (snprintf(child, sizeof child, "%s/%s", directory, relative) >=
            (int)sizeof child) {
          ok = 0;
          break;
        }
        snprintf(log, sizeof log, "%s/source-%06d.txt", diagnostics,
                 (*sequence)++);
        if (!source_metadata_safe(child, workspace) ||
            !source_config_safe(child, diagnostics, sequence)) {
          ok = 0;
          break;
        }
        char *head[] = {"/usr/bin/git", "--no-replace-objects",
                        "-c",           "core.hooksPath=/dev/null",
                        "-c",           "core.fsmonitor=false",
                        "rev-parse",    "--verify",
                        "HEAD",         NULL};
        if (hp_spawn(child, head, log, 30)) {
          ok = 0;
          break;
        }
        FILE *module_stream = fopen(log, "r");
        char actual[128];
        ok = module_stream && fgets(actual, sizeof actual, module_stream);
        if (module_stream)
          fclose(module_stream);
        if (ok) {
          actual[strcspn(actual, "\r\n")] = 0;
          ok = !strcmp(actual, expected);
        }
        if (ok) {
          snprintf(log, sizeof log, "%s/source-%06d.txt", diagnostics,
                   (*sequence)++);
          int budget = 256;
          ok = source_tree_clean(child, expected, workspace, diagnostics,
                                 sequence, allow_lfs, 0, &budget);
        }
      }
      char *lfs = description ? hp_field(description, "lfs") : NULL;
      if (ok && !source_only && lfs && !strcmp(lfs, "true")) {
        snprintf(log, sizeof log, "%s/source-%06d.txt", diagnostics,
                 (*sequence)++);
        char *verify[] = {"/usr/bin/git", "--no-replace-objects",
                          "-c",           "core.hooksPath=/dev/null",
                          "lfs",          "fsck",
                          "--objects",    "--pointers",
                          "HEAD",         NULL};
        ok = hp_spawn(directory, verify, log, 60) == 0;
      }
      free(lfs);
      free(modules);
      free(description);
    }
  }
  fputs("]", capture);
  if (fclose(capture))
    ok = 0;
  if (ok) {
    free(*bindings);
    *bindings = captured;
  } else
    free(captured);
  free(repos);
  return ok;
}
static int same_scope(const char *a, const char *b) {
  const char *keys[] = {"run_id", "actor_id", "attempt_id"};
  for (unsigned i = 0; i < 3; i++) {
    char *x = hp_field(a, keys[i]), *y = hp_field(b, keys[i]);
    int ok = x && y && !strcmp(x, y);
    free(x);
    free(y);
    if (!ok)
      return 0;
  }
  return 1;
}
static int future_time(const char *raw) {
  if (!strcmp(raw, "null"))
    return 1;
  char text[64];
  if (!hp_text(raw, NULL, text, sizeof text))
    return 0;
  if (strlen(text) != 24 || text[19] != '.' || text[23] != 'Z' ||
      !isdigit((unsigned char)text[20]) || !isdigit((unsigned char)text[21]) ||
      !isdigit((unsigned char)text[22]))
    return 0;
  struct tm parsed;
  memset(&parsed, 0, sizeof parsed);
  char *end = strptime(text, "%Y-%m-%dT%H:%M:%S", &parsed);
  if (!end || end != text + 19)
    return 0;
  time_t expiration = timegm(&parsed);
  struct tm normalized;
  char roundtrip[32];
  if (!gmtime_r(&expiration, &normalized) ||
      !strftime(roundtrip, sizeof roundtrip, "%Y-%m-%dT%H:%M:%S",
                &normalized) ||
      strncmp(roundtrip, text, 19))
    return 0;
  return expiration > time(NULL);
}
static int credentials_ready(const char *profile) {
  char *refs = hp_field(profile, "credential_references");
  int count = hp_count(refs), ok = count >= 0 && count <= 256;
  if (!count) {
    free(refs);
    return ok;
  }
  int fd = config_file("HF_CREDENTIAL_AVAILABILITY_FILE", 1048576),
      scopefd = config_file("HF_INVOCATION_SCOPE_FILE", 65536);
  char *config = fd >= 0 ? read_json_fd(fd, 1048576) : NULL,
       *scope = scopefd >= 0 ? read_json_fd(scopefd, 65536) : NULL;
  if (fd >= 0)
    close(fd);
  if (scopefd >= 0)
    close(scopefd);
  char *records = config ? hp_field(config, "records") : NULL;
  int n = hp_count(records);
  static const char *const envelope_keys[] = {"schema_version", "records"};
  static const char *const scope_keys[] = {"run_id", "actor_id", "attempt_id"};
  int envelope_version;
  if (!config || !scope || !hp_shape(config, envelope_keys, 2) ||
      !hp_integer(config, "schema_version", 1, 1, &envelope_version) ||
      !hp_shape(scope, scope_keys, 3) || n < 0 || n > 4096)
    ok = 0;
  for (int i = 0; i < count && ok; i++) {
    char *raw = hp_item(refs, i), reference[256];
    ok = raw && hp_text(raw, NULL, reference, sizeof reference);
    free(raw);
    int found = 0;
    for (int j = 0; j < n && ok; j++) {
      char *record = hp_item(records, j), id[256];
      if (record && hp_text(record, "reference_id", id, sizeof id) &&
          !strcmp(id, reference)) {
        char state[32], version[256], attachment[256];
        char *assignment = hp_field(record, "assignment_scope"),
             *expires = hp_field(record, "expires_at");
        int schema;
        static const char *const record_keys[] = {
            "schema_version", "reference_id", "credential_version",
            "status",         "expires_at",   "assignment_scope",
            "attachment_id"};
        static const char *const assignment_keys[] = {"run_id", "actor_id",
                                                      "attempt_id"};
        ok = !found && hp_shape(record, record_keys, 7) &&
             hp_integer(record, "schema_version", 1, 1, &schema) &&
             hp_text(record, "status", state, sizeof state) &&
             !strcmp(state, "AVAILABLE") &&
             hp_text(record, "credential_version", version, sizeof version) &&
             hp_text(record, "attachment_id", attachment, sizeof attachment) &&
             assignment && hp_shape(assignment, assignment_keys, 3) &&
             same_scope(assignment, scope) && expires && future_time(expires);
        free(assignment);
        free(expires);
        found = 1;
      }
      free(record);
    }
    if (!found)
      ok = 0;
  }
  free(refs);
  free(records);
  free(config);
  free(scope);
  return ok;
}
static int tcp_reachable(const char *hostname, int port, int timeout) {
  pid_t child = fork();
  if (child < 0)
    return 0;
  if (!child) {
    char service[8];
    snprintf(service, sizeof service, "%d", port);
    struct addrinfo hints = {0}, *addresses = NULL;
    hints.ai_socktype = SOCK_STREAM;
    hints.ai_family = AF_UNSPEC;
    if (getaddrinfo(hostname, service, &hints, &addresses))
      _exit(1);
    int ok = 0;
    for (struct addrinfo *address = addresses; address;
         address = address->ai_next) {
      int fd = socket(address->ai_family,
                      address->ai_socktype | SOCK_NONBLOCK | SOCK_CLOEXEC,
                      address->ai_protocol);
      if (fd < 0)
        continue;
      int result = connect(fd, address->ai_addr, address->ai_addrlen);
      if (!result) {
        ok = 1;
        close(fd);
        break;
      }
      if (errno == EINPROGRESS) {
        struct pollfd pfd = {fd, POLLOUT, 0};
        int error = 1;
        socklen_t size = sizeof error;
        if (poll(&pfd, 1, timeout) > 0 &&
            !getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &size) && !error)
          ok = 1;
      }
      close(fd);
      if (ok)
        break;
    }
    freeaddrinfo(addresses);
    _exit(ok ? 0 : 1);
  }
  long long deadline = hp_millis() + timeout;
  int status = 0;
  pid_t waited;
  while ((waited = waitpid(child, &status, WNOHANG)) == 0 ||
         (waited < 0 && errno == EINTR)) {
    if (hp_cancelled || hp_millis() > deadline) {
      kill(child, SIGKILL);
      while (waitpid(child, &status, 0) < 0 && errno == EINTR) {
      }
      return 0;
    }
    struct timespec pause = {0, 5000000};
    nanosleep(&pause, NULL);
  }
  return waited == child && WIFEXITED(status) && WEXITSTATUS(status) == 0;
}
static int network_ready(const char *profile, int timeout, int *probes) {
  char *network = hp_field(profile, "network");
  int ok = network != NULL;
  *probes = 0;
  const char *groups[] = {"routes", "registries"};
  for (unsigned group = 0; group < 2 && ok; group++) {
    char *values = hp_field(network, groups[group]);
    int count = hp_count(values);
    if (count < 0) {
      free(values);
      ok = 0;
      break;
    }
    for (int i = 0; i < count && ok; i++) {
      char *value = hp_item(values, i), host[256];
      ok = value && hp_text(value, NULL, host, sizeof host);
      free(value);
      if (!ok)
        break;
      int port = 443;
      char *colon = strrchr(host, ':');
      if (colon) {
        *colon = 0;
        char *end = NULL;
        long parsed = strtol(colon + 1, &end, 10);
        if (!*host || !colon[1] || *end || parsed < 1 || parsed > 65535) {
          ok = 0;
          break;
        }
        port = (int)parsed;
      }
      ok = tcp_reachable(host, port, timeout);
      (*probes)++;
    }
    free(values);
  }
  free(network);
  return ok;
}
int hf_component_11_3(const char *action, const char *request, FILE *output) {
  static const char *const keys[] = {"schema_version",
                                     "workspace",
                                     "base",
                                     "manifest",
                                     "boot_id",
                                     "profile_digest",
                                     "preparation_digest",
                                     "minimum_free_bytes",
                                     "minimum_free_inodes",
                                     "network_timeout_milliseconds"};
  int source_only = !strcmp(action, "environment.source.verify");
  if ((!source_only && strcmp(action, "environment.readiness")) ||
      !hp_valid(request) || !hp_shape(request, keys, 10))
    return 2;
  int version, timeout;
  char workspace_name[2049], base_name[2049], manifest_name[2049], boot[97],
      profile_digest[72], preparation[72];
  uint64_t minimum_bytes, minimum_inodes;
  if (!hp_integer(request, "schema_version", 1, 1, &version) ||
      !hp_text(request, "workspace", workspace_name, sizeof workspace_name) ||
      !hp_relative(workspace_name) ||
      !hp_text(request, "base", base_name, sizeof base_name) ||
      !hp_relative(base_name) ||
      !hp_text(request, "manifest", manifest_name, sizeof manifest_name) ||
      !hp_relative(manifest_name) ||
      !hp_text(request, "boot_id", boot, sizeof boot) || !hp_id(boot) ||
      !hp_text(request, "profile_digest", profile_digest,
               sizeof profile_digest) ||
      !hp_digest(profile_digest) ||
      !hp_text(request, "preparation_digest", preparation,
               sizeof preparation) ||
      !hp_digest(preparation) ||
      !decimal_value(request, "minimum_free_bytes", &minimum_bytes) ||
      !decimal_value(request, "minimum_free_inodes", &minimum_inodes) ||
      !hp_integer(request, "network_timeout_milliseconds", 100, 10000,
                  &timeout))
    return 2;
  int workspace_root = -1, workspace_fd = -1, manifest_root = -1,
      manifest_fd = -1, diagnostics_root = -1;
  char *manifest = NULL, *profile = NULL, *source_bindings = NULL;
  const char *reason = "RUNTIME_BINDING_MISMATCH";
  int ready = 0, sequence = 0, network_probes = 0;
  uint64_t available_bytes = 0, available_inodes = 0;
  if (!environment_equal("HF_SANDBOX_BOOT_ID", boot) ||
      !environment_equal("HF_RUNNER_PROFILE_DIGEST", profile_digest) ||
      !environment_equal("HF_RUNNER_PREPARATION_DIGEST", preparation))
    goto done;
  workspace_root = hp_root("HF_PREPARATION_WORKSPACE_ROOT");
  manifest_root = hp_root("HF_PREPARATION_MANIFEST_ROOT");
  diagnostics_root = hp_root("HF_READINESS_DIAGNOSTICS_ROOT");
  reason = "READINESS_CONFIG_INVALID";
  if (workspace_root < 0 || manifest_root < 0 || diagnostics_root < 0)
    goto done;
  workspace_fd = hp_open_dir(workspace_root, workspace_name, 0);
  if (workspace_fd < 0)
    goto done;
  char workspace[PATH_MAX], path[PATH_MAX];
  snprintf(path, sizeof path, "/proc/self/fd/%d", workspace_fd);
  if (!realpath(path, workspace))
    goto done;
  char manifest_parent[2049];
  strcpy(manifest_parent, manifest_name);
  char *name = manifest_parent, *slash = strrchr(manifest_parent, '/');
  int parent = dup(manifest_root);
  if (parent < 0)
    goto done;
  if (slash) {
    *slash = 0;
    name = slash + 1;
    int child = hp_open_dir(parent, manifest_parent, 0);
    close(parent);
    parent = child;
  }
  if (parent < 0)
    goto done;
  manifest_fd = openat(parent, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  close(parent);
  if (manifest_fd < 0)
    goto done;
  manifest = read_json_fd(manifest_fd, 64 * 1024 * 1024);
  if (!manifest)
    goto done;
  profile = hp_field(manifest, "profile");
  if (!profile)
    goto done;
  char directory[128], diagnostics[PATH_MAX];
  snprintf(directory, sizeof directory, "readiness-%ld-%lld", (long)getpid(),
           hp_millis());
  if (mkdirat(diagnostics_root, directory, 0700))
    goto done;
  snprintf(path, sizeof path, "/proc/self/fd/%d/%s", diagnostics_root,
           directory);
  if (!realpath(path, diagnostics))
    goto done;
  struct sigaction old_term, old_int, handler;
  memset(&handler, 0, sizeof handler);
  handler.sa_handler = readiness_signal;
  sigemptyset(&handler.sa_mask);
  hp_cancelled = 0;
  sigaction(SIGTERM, &handler, &old_term);
  sigaction(SIGINT, &handler, &old_int);
  reason = "PREPARATION_MANIFEST_INVALID";
  if (!manifest_check(base_name, manifest_fd, profile_digest, preparation,
                      diagnostics, &sequence, "HF_PREPARATION_BASE_ROOT"))
    goto restore;
  int workspace_inventory_verified = 0;
  const char *workspace_digest = getenv("HF_RUNNER_WORKSPACE_DIGEST");
  {
    reason = "WORKSPACE_INVENTORY_INVALID";
    int workspace_manifest =
        config_file("HF_READINESS_WORKSPACE_MANIFEST_FILE", 64 * 1024 * 1024);
    if (workspace_manifest < 0 || !hp_digest(workspace_digest)) {
      if (workspace_manifest >= 0)
        close(workspace_manifest);
      goto restore;
    }
    workspace_inventory_verified = manifest_check(
        workspace_name, workspace_manifest, profile_digest, workspace_digest,
        diagnostics, &sequence, "HF_PREPARATION_WORKSPACE_ROOT");
    close(workspace_manifest);
    if (!workspace_inventory_verified)
      goto restore;
  }
  reason = "OS_PROFILE_MISMATCH";
  if (!profile_os(profile))
    goto restore;
  reason = "PREPARATION_EXPIRED";
  char *policy = hp_field(profile, "policy"),
       *expiration = policy ? hp_field(policy, "expires_at") : NULL;
  int fresh = expiration && future_time(expiration);
  free(policy);
  free(expiration);
  if (!fresh)
    goto restore;
  reason = "SOURCE_MISMATCH";
  if (!source_ready(profile, workspace, diagnostics, &sequence,
                    workspace_inventory_verified, source_only,
                    &source_bindings))
    goto restore;
  if (source_only)
    goto final_checks;
  reason = "TOOLCHAIN_MISMATCH";
  if (!tools_ready(profile, workspace, diagnostics, &sequence))
    goto restore;
  reason = "CREDENTIAL_UNAVAILABLE";
  if (!credentials_ready(profile))
    goto restore;
  struct statvfs storage;
  reason = "STORAGE_UNAVAILABLE";
  if (fstatvfs(workspace_fd, &storage))
    goto restore;
  __uint128_t bytes = (__uint128_t)storage.f_bavail * storage.f_frsize;
  available_bytes = bytes > UINT64_MAX ? UINT64_MAX : (uint64_t)bytes;
  available_inodes = storage.f_favail;
  reason = "STORAGE_CAPACITY_INSUFFICIENT";
  if (available_bytes < minimum_bytes || available_inodes < minimum_inodes)
    goto restore;
  reason = "NETWORK_UNAVAILABLE";
  if (!network_ready(profile, timeout, &network_probes))
    goto restore;
  reason = "CAPABILITY_UNSUPPORTED";
  char *capabilities = hp_field(profile, "required_capabilities");
  int count = hp_count(capabilities), ok = count >= 1;
  for (int i = 0; i < count && ok; i++) {
    char *raw = hp_item(capabilities, i), capability[128];
    ok = raw && hp_text(raw, NULL, capability, sizeof capability);
    free(raw);
    if (!ok)
      break;
    if (!strcmp(capability, "execute")) {
      char log[PATH_MAX];
      char *args[] = {"/usr/bin/true", NULL};
      ok = snprintf(log, sizeof log, "%s/execute.txt", diagnostics) <
               (int)sizeof log &&
           hp_spawn(workspace, args, log, 5) == 0;
    } else if (!strcmp(capability, "transfer")) {
      char probe[128];
      snprintf(probe, sizeof probe, ".readiness-write-%ld", (long)getpid());
      int fd = openat(workspace_fd, probe,
                      O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
      char value[8] = {0};
      ok = fd >= 0 && write(fd, "probe", 5) == 5 && fsync(fd) == 0 &&
           lseek(fd, 0, SEEK_SET) == 0 && read(fd, value, 5) == 5 &&
           !strcmp(value, "probe");
      if (fd >= 0)
        close(fd);
      unlinkat(workspace_fd, probe, 0);
    } else if (!strcmp(capability, "linux.subreaper")) {
      char log[PATH_MAX];
      const char *script =
          "import ctypes,json,os,sys\nassert "
          "sys.platform=='linux'\nlibc=ctypes.CDLL(None,use_errno=True)"
          "\nassert libc.prctl(36,1,0,0,0)==0\nflag=ctypes.c_int()\nassert "
          "libc.prctl(37,ctypes.byref(flag),0,0,0)==0 and flag.value==1\nwith "
          "open('/proc/self/task/'+str(os.getpid())+'/children') as "
          "stream:stream.read()\nassert "
          "callable(os.waitpid)\nprint(json.dumps({'linux':True,'subreaper':"
          "True,'proc_children':True},sort_keys=True,separators=(',',':')))\n";
      char *args[] = {"/usr/bin/python3", "-c", (char *)script, NULL};
      ok = snprintf(log, sizeof log, "%s/subreaper.txt", diagnostics) <
               (int)sizeof log &&
           hp_spawn(workspace, args, log, 5) == 0;
    } else if (!strcmp(capability, "network"))
      ok = network_probes > 0;
    else
      ok = 0;
  }
  free(capabilities);
  if (!ok)
    goto restore;
final_checks:
  reason = "CANCELLED";
  if (hp_cancelled)
    goto restore;
  reason = "PREPARATION_MANIFEST_INVALID";
  if (!manifest_check(base_name, manifest_fd, profile_digest, preparation,
                      diagnostics, &sequence, "HF_PREPARATION_BASE_ROOT"))
    goto restore;
  if (workspace_inventory_verified) {
    reason = "WORKSPACE_INVENTORY_INVALID";
    int checked =
        config_file("HF_READINESS_WORKSPACE_MANIFEST_FILE", 64 * 1024 * 1024);
    int valid =
        checked >= 0 && manifest_check(workspace_name, checked, profile_digest,
                                       workspace_digest, diagnostics, &sequence,
                                       "HF_PREPARATION_WORKSPACE_ROOT");
    if (checked >= 0)
      close(checked);
    if (!valid)
      goto restore;
  }
  reason = "SOURCE_MISMATCH";
  if (!source_ready(profile, workspace, diagnostics, &sequence,
                    workspace_inventory_verified, source_only,
                    &source_bindings))
    goto restore;
  ready = 1;
  reason = "CHECKS_PASSED";
restore:
  sigaction(SIGTERM, &old_term, NULL);
  sigaction(SIGINT, &old_int, NULL);
done:
  fprintf(output, "{\"schema_version\":1,\"state\":\"%s\",\"reason\":",
          source_only ? (ready ? "SOURCE_VERIFIED" : "SOURCE_INVALID")
                      : (ready ? "READY" : "NOT_READY"));
  hp_quote(output, reason);
  fputs(",\"boot_id\":", output);
  hp_quote(output, boot);
  fputs(",\"profile_digest\":", output);
  hp_quote(output, profile_digest);
  fputs(",\"preparation_digest\":", output);
  hp_quote(output, preparation);
  fputs(",\"source_bindings\":", output);
  fputs(source_bindings ? source_bindings : "null", output);
  fputs(",\"source_state_digest\":", output);
  char source_hex[65], source_digest[72];
  if (source_bindings &&
      hp_hash_bytes(source_bindings, strlen(source_bindings), source_hex)) {
    snprintf(source_digest, sizeof source_digest, "sha256:%s", source_hex);
    hp_quote(output, source_digest);
  } else
    fputs("null", output);
  fputs(",\"workspace_digest\":", output);
  const char *reported_workspace_digest = getenv("HF_RUNNER_WORKSPACE_DIGEST");
  if (ready && reported_workspace_digest)
    hp_quote(output, reported_workspace_digest);
  else
    fputs("null", output);
  fprintf(output,
          ",\"available_bytes\":\"%llu\",\"available_inodes\":\"%llu\","
          "\"network_probes\":%d,\"authority_granted\":false}",
          (unsigned long long)available_bytes,
          (unsigned long long)available_inodes, network_probes);
  free(source_bindings);
  free(profile);
  free(manifest);
  if (manifest_fd >= 0)
    close(manifest_fd);
  if (manifest_root >= 0)
    close(manifest_root);
  if (workspace_fd >= 0)
    close(workspace_fd);
  if (workspace_root >= 0)
    close(workspace_root);
  if (diagnostics_root >= 0)
    close(diagnostics_root);
  return 0;
}
