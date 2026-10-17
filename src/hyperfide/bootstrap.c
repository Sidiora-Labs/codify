/* Exact remote source materialisation. Filesystem success grants no task
 * authority. */
#define _GNU_SOURCE
#include "components.h"
#include "preparation_support.h"
#include <dirent.h>
#include <sys/prctl.h>

typedef struct {
  char id[97], url[2049], commit[65];
  char *submodules;
  int lfs;
} HpRepository;
typedef struct {
  char repository[97], path[2049], digest[72];
} HpLock;
typedef struct {
  char repository[97];
  char **argv;
  int argc, timeout;
} HpCommand;
static void bootstrap_signal(int signal_number) {
  (void)signal_number;
  hp_cancelled = 1;
}
static int repository_index(HpRepository *repos, int count, const char *id) {
  for (int i = 0; i < count; i++)
    if (!strcmp(repos[i].id, id))
      return i;
  return -1;
}
static int source_allowed(const char *source) {
  for (const char *p = source; *p; p++)
    if ((unsigned char)*p < 33 || *p == '\\' || *p == '@' || *p == '?' ||
        *p == '#')
      return 0;
  if (!strncmp(source, "https://", 8) || !strncmp(source, "ssh://", 6)) {
    const char *allow = getenv("HF_BOOTSTRAP_ALLOW_NETWORK");
    const char *host = strstr(source, "://") + 3;
    return allow && !strcmp(allow, "1") && *host && *host != '/' &&
           strchr(host, '/');
  }
  const char *root = getenv("HF_BOOTSTRAP_SOURCE_ROOT");
  char canonical[PATH_MAX], base[PATH_MAX];
  if (!root || !realpath(root, base) || !realpath(source, canonical) ||
      strcmp(source, canonical))
    return 0;
  size_t n = strlen(base);
  return n > 1 && !strncmp(base, canonical, n) && canonical[n] == '/';
}
static int log_run(const char *cwd, const char *temporary, int *sequence,
                   char *const argv[], int timeout) {
  char log[PATH_MAX];
  if (hp_cancelled)
    return 125;
  if (snprintf(log, sizeof log, "%s/log-%06d.txt", temporary, (*sequence)++) >=
      (int)sizeof log)
    return -1;
  return hp_spawn(cwd, argv, log, timeout);
}
static int git_run(const char *cwd, const char *temporary, int *seq,
                   char *const tail[], int local, int timeout) {
  char *argv[160];
  int n = 0;
  argv[n++] = "git";
  argv[n++] = "-c";
  argv[n++] = "core.hooksPath=/dev/null";
  /* Detached auto-maintenance would outlive the bounded, supervised run. */
  argv[n++] = "-c";
  argv[n++] = "maintenance.auto=false";
  argv[n++] = "-c";
  argv[n++] = "gc.auto=0";
  argv[n++] = "-c";
  argv[n++] = "protocol.ext.allow=never";
  argv[n++] = "-c";
  argv[n++] =
      local ? "protocol.file.allow=always" : "protocol.file.allow=never";
  for (int i = 0; tail[i]; i++) {
    if (n >= 158)
      return -1;
    argv[n++] = tail[i];
  }
  argv[n] = NULL;
  if (!strcmp(tail[0], "lfs")) {
    char log[PATH_MAX];
    if (hp_cancelled || snprintf(log, sizeof log, "%s/log-%06d.txt", temporary,
                                 (*seq)++) >= (int)sizeof log)
      return -1;
    char *extra[] = {"GIT_LFS_SKIP_SMUDGE=0", NULL};
    return hp_spawn_env(cwd, argv, log, timeout, extra);
  }
  return log_run(cwd, temporary, seq, argv, timeout);
}
static int file_digest(const char *directory, const char *path,
                       const char *temporary, int *seq, char result[72]) {
  (void)temporary;
  (void)seq;
  int fd = open(directory, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0)
    return 0;
  int ok = hp_hash_file(fd, path, result);
  close(fd);
  return ok;
}
static int parse_repositories(const char *raw, HpRepository **out, int *count) {
  int n = hp_count(raw);
  if (n < 1 || n > 64)
    return 0;
  HpRepository *items = calloc((size_t)n, sizeof *items);
  if (!items)
    return 0;
  static const char *const keys[] = {"id", "url", "commit", "submodules",
                                     "lfs"};
  for (int i = 0; i < n; i++) {
    char *item = hp_item(raw, i), *lfs = NULL;
    if (!item || !hp_shape(item, keys, 5) ||
        !hp_text(item, "id", items[i].id, sizeof items[i].id) ||
        !hp_id(items[i].id) ||
        !hp_text(item, "url", items[i].url, sizeof items[i].url) ||
        !source_allowed(items[i].url) ||
        !hp_text(item, "commit", items[i].commit, sizeof items[i].commit) ||
        !hp_oid(items[i].commit)) {
      free(item);
      goto bad;
    }
    items[i].submodules = hp_field(item, "submodules");
    lfs = hp_field(item, "lfs");
    if (hp_count(items[i].submodules) < 0 ||
        hp_count(items[i].submodules) > 128 || !lfs ||
        (strcmp(lfs, "true") && strcmp(lfs, "false"))) {
      free(item);
      free(lfs);
      goto bad;
    }
    items[i].lfs = !strcmp(lfs, "true");
    free(lfs);
    free(item);
    for (int j = 0; j < i; j++)
      if (!strcmp(items[j].id, items[i].id))
        goto bad;
  }
  *out = items;
  *count = n;
  return 1;
bad:
  for (int i = 0; i < n; i++)
    free(items[i].submodules);
  free(items);
  return 0;
}
static int parse_locks(const char *raw, HpLock **out, int *count,
                       HpRepository *repos, int repositories) {
  int n = hp_count(raw);
  if (n < 0 || n > 512)
    return 0;
  HpLock *items = calloc((size_t)(n ? n : 1), sizeof *items);
  if (!items)
    return 0;
  static const char *const keys[] = {"repository", "path", "digest"};
  for (int i = 0; i < n; i++) {
    char *item = hp_item(raw, i);
    int ok = item && hp_shape(item, keys, 3) &&
             hp_text(item, "repository", items[i].repository,
                     sizeof items[i].repository) &&
             repository_index(repos, repositories, items[i].repository) >= 0 &&
             hp_text(item, "path", items[i].path, sizeof items[i].path) &&
             hp_relative(items[i].path) &&
             hp_text(item, "digest", items[i].digest, sizeof items[i].digest) &&
             hp_digest(items[i].digest);
    free(item);
    if (!ok)
      goto bad;
    for (int j = 0; j < i; j++)
      if (!strcmp(items[j].repository, items[i].repository) &&
          !strcmp(items[j].path, items[i].path))
        goto bad;
  }
  *out = items;
  *count = n;
  return 1;
bad:
  free(items);
  return 0;
}
static void commands_free(HpCommand *items, int count) {
  if (!items)
    return;
  for (int i = 0; i < count; i++) {
    for (int j = 0; j < items[i].argc; j++)
      free(items[i].argv[j]);
    free(items[i].argv);
  }
  free(items);
}
static int parse_commands(const char *raw, HpCommand **out, int *count,
                          HpRepository *repos, int repositories) {
  int n = hp_count(raw);
  if (n < 0 || n > 128)
    return 0;
  HpCommand *items = calloc((size_t)(n ? n : 1), sizeof *items);
  if (!items)
    return 0;
  static const char *const keys[] = {"repository", "argv", "timeout_seconds"};
  for (int i = 0; i < n; i++) {
    char *item = hp_item(raw, i), *args = NULL;
    if (!item || !hp_shape(item, keys, 3) ||
        !hp_text(item, "repository", items[i].repository,
                 sizeof items[i].repository) ||
        repository_index(repos, repositories, items[i].repository) < 0 ||
        !hp_integer(item, "timeout_seconds", 1, 3600, &items[i].timeout)) {
      free(item);
      goto bad;
    }
    args = hp_field(item, "argv");
    free(item);
    int argc = hp_count(args);
    if (argc < 1 || argc > 128) {
      free(args);
      goto bad;
    }
    items[i].argv = calloc((size_t)argc + 1, sizeof(char *));
    items[i].argc = argc;
    if (!items[i].argv) {
      free(args);
      goto bad;
    }
    for (int j = 0; j < argc; j++) {
      char *arg = hp_item(args, j), value[8193];
      if (!arg || !(j ? hp_argument(arg, value, sizeof value)
                      : hp_text(arg, NULL, value, sizeof value))) {
        free(arg);
        free(args);
        goto bad;
      }
      free(arg);
      items[i].argv[j] = strdup(value);
      if (!items[i].argv[j]) {
        free(args);
        goto bad;
      }
    }
    free(args);
  }
  *out = items;
  *count = n;
  return 1;
bad:
  commands_free(items, n);
  return 0;
}
static int verify_git_head(const char *repo, const char *temporary, int *seq,
                           const char *commit) {
  int index = *seq;
  char *argv[] = {"rev-parse", "--verify", "HEAD", NULL};
  if (git_run(repo, temporary, seq, argv, 0, 60))
    return 0;
  char file[PATH_MAX], line[128];
  snprintf(file, sizeof file, "%s/log-%06d.txt", temporary, index);
  FILE *stream = fopen(file, "r");
  int ok = stream && fgets(line, sizeof line, stream);
  if (stream)
    fclose(stream);
  if (!ok)
    return 0;
  line[strcspn(line, "\r\n")] = 0;
  return !strcmp(line, commit);
}

static char *git_output(const char *repo, const char *temporary, int *sequence,
                        char *const argv[], int local, size_t *length) {
  int index = *sequence;
  if (git_run(repo, temporary, sequence, argv, local, 120))
    return NULL;
  char path[PATH_MAX];
  if (snprintf(path, sizeof path, "%s/log-%06d.txt", temporary, index) >=
      (int)sizeof path)
    return NULL;
  FILE *stream = fopen(path, "rb");
  if (!stream)
    return NULL;
  if (fseek(stream, 0, SEEK_END)) {
    fclose(stream);
    return NULL;
  }
  long size = ftell(stream);
  if (size < 0 || size > 1048576 || fseek(stream, 0, SEEK_SET)) {
    fclose(stream);
    return NULL;
  }
  char *data = malloc((size_t)size + 1);
  if (!data) {
    fclose(stream);
    return NULL;
  }
  if (fread(data, 1, (size_t)size, stream) != (size_t)size) {
    free(data);
    fclose(stream);
    return NULL;
  }
  fclose(stream);
  data[size] = 0;
  if (length)
    *length = (size_t)size;
  return data;
}
static int submodule_pin(const char *pins, const char *path,
                         char expected[65]) {
  static const char *const keys[] = {"path", "commit"};
  int count = hp_count(pins), found = 0;
  for (int i = 0; i < count; i++) {
    char *item = hp_item(pins, i), candidate[2049], commit[65];
    int ok = item && hp_shape(item, keys, 2) &&
             hp_text(item, "path", candidate, sizeof candidate) &&
             hp_relative(candidate) &&
             hp_text(item, "commit", commit, sizeof commit) && hp_oid(commit);
    free(item);
    if (!ok)
      return -1;
    if (!strcmp(candidate, path)) {
      if (found)
        return -1;
      strcpy(expected, commit);
      found = 1;
    }
  }
  return found;
}
/* Walk Git's committed gitlink graph. Every nested module must have a declared
 * exact pin and an independently approved URL before Git may contact it. */
static int materialize_modules(const char *repo, const char *prefix,
                               const char *pins, const char *temporary,
                               int *sequence, int depth, int *seen) {
  if (depth > 32 || *seen > 128)
    return 0;
  char *args[] = {"ls-tree", "-r", "-z", "HEAD", NULL};
  size_t size = 0;
  char *tree = git_output(repo, temporary, sequence, args, 0, &size);
  if (!tree)
    return 0;
  size_t offset = 0;
  int ok = 1;
  while (offset < size && ok) {
    char *entry = tree + offset;
    size_t n = strnlen(entry, size - offset);
    if (n == size - offset) {
      ok = 0;
      break;
    }
    offset += n + 1;
    if (strncmp(entry, "160000 commit ", 14))
      continue;
    char *tab = strchr(entry, '\t');
    if (!tab) {
      ok = 0;
      break;
    }
    *tab = 0;
    const char *path = tab + 1;
    char global[2049], expected[65];
    if (!hp_relative(path) ||
        snprintf(global, sizeof global, "%s%s", prefix, path) >=
            (int)sizeof global ||
        submodule_pin(pins, global, expected) != 1 ||
        strcmp(entry + 14, expected)) {
      ok = 0;
      break;
    }
    char *config_args[] = {"config",
                           "--file",
                           ".gitmodules",
                           "--get-regexp",
                           "^submodule\\..*\\.path$",
                           NULL};
    char *config = git_output(repo, temporary, sequence, config_args, 0, NULL),
         key[4096] = "";
    int matches = 0;
    if (!config) {
      ok = 0;
      break;
    }
    char *save = NULL;
    for (char *line = strtok_r(config, "\n", &save); line;
         line = strtok_r(NULL, "\n", &save)) {
      char *space = strchr(line, ' ');
      if (!space)
        continue;
      *space = 0;
      size_t length = strlen(line);
      if (!strcmp(space + 1, path) && length > 5 &&
          !strcmp(line + length - 5, ".path")) {
        if (++matches > 1 || length + 1 >= sizeof key) {
          ok = 0;
          break;
        }
        memcpy(key, line, length - 4);
        strcpy(key + length - 4, "url");
      }
    }
    free(config);
    if (!ok || matches != 1) {
      ok = 0;
      break;
    }
    char *url_args[] = {"config", "--file", ".gitmodules", "--get", key, NULL};
    char *url = git_output(repo, temporary, sequence, url_args, 0, NULL);
    if (!url) {
      ok = 0;
      break;
    }
    url[strcspn(url, "\r\n")] = 0;
    int local = url[0] == '/';
    ok = source_allowed(url);
    free(url);
    if (!ok)
      break;
    char *update[] = {"submodule", "update",     "--init", "--checkout",
                      "--",        (char *)path, NULL};
    if (git_run(repo, temporary, sequence, update, local, 300)) {
      ok = 0;
      break;
    }
    char child[PATH_MAX], child_prefix[2049];
    if (snprintf(child, sizeof child, "%s/%s", repo, path) >=
            (int)sizeof child ||
        snprintf(child_prefix, sizeof child_prefix, "%s/", global) >=
            (int)sizeof child_prefix ||
        !verify_git_head(child, temporary, sequence, expected)) {
      ok = 0;
      break;
    }
    (*seen)++;
    if (!materialize_modules(child, child_prefix, pins, temporary, sequence,
                             depth + 1, seen)) {
      ok = 0;
      break;
    }
  }
  free(tree);
  return ok;
}
static int verify_modules(const char *repo, const char *pins,
                          const char *temporary, int *sequence) {
  int count = hp_count(pins);
  for (int i = 0; i < count; i++) {
    char *item = hp_item(pins, i), path[2049], commit[65], directory[PATH_MAX];
    int ok = item && hp_text(item, "path", path, sizeof path) &&
             hp_relative(path) &&
             hp_text(item, "commit", commit, sizeof commit) && hp_oid(commit);
    free(item);
    if (!ok || snprintf(directory, sizeof directory, "%s/%s", repo, path) >=
                   (int)sizeof directory)
      return 0;
    int root = open(repo, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC),
        child = root >= 0 ? hp_open_dir(root, path, 0) : -1;
    if (root >= 0)
      close(root);
    if (child < 0)
      return 0;
    close(child);
    char *diff[] = {"diff", "--quiet", "--exit-code", "HEAD", "--", NULL};
    if (!verify_git_head(directory, temporary, sequence, commit) ||
        git_run(directory, temporary, sequence, diff, 0, 60))
      return 0;
  }
  return 1;
}

static int git_metadata_digest(const char *repo, const char *temporary,
                               int *sequence, const char *pins, char out[72]) {
  char *identity = NULL;
  size_t bytes = 0;
  FILE *stream = open_memstream(&identity, &bytes);
  if (!stream)
    return 0;
  int ok = 1, count = hp_count(pins);
  for (int index = -1; index < count && ok; index++) {
    char directory[PATH_MAX];
    strcpy(directory, repo);
    if (index >= 0) {
      char *pin = hp_item(pins, index), path[2049];
      ok = pin && hp_text(pin, "path", path, sizeof path) && hp_relative(path);
      free(pin);
      if (!ok || snprintf(directory, sizeof directory, "%s/%s", repo, path) >=
                     (int)sizeof directory) {
        ok = 0;
        break;
      }
    }
    char *args[] = {"rev-parse", "--absolute-git-dir", NULL};
    char *metadata = git_output(directory, temporary, sequence, args, 0, NULL);
    if (!metadata) {
      ok = 0;
      break;
    }
    metadata[strcspn(metadata, "\r\n")] = 0;
    size_t root_length = strlen(temporary);
    if (metadata[0] != '/' || strncmp(metadata, temporary, root_length) ||
        metadata[root_length] != '/') {
      free(metadata);
      ok = 0;
      break;
    }
    int parent = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    char *save = NULL;
    for (char *part = strtok_r(metadata + 1, "/", &save); part && parent >= 0;
         part = strtok_r(NULL, "/", &save)) {
      if (!strcmp(part, ".") || !strcmp(part, "..")) {
        close(parent);
        parent = -1;
        break;
      }
      int child = openat(parent, part,
                         ((save && *save) ? O_PATH : O_RDONLY) | O_DIRECTORY |
                             O_NOFOLLOW | O_CLOEXEC);
      close(parent);
      parent = child;
    }
    free(metadata);
    if (parent < 0) {
      ok = 0;
      break;
    }
    const char *files[] = {"index", "config", "info/attributes", "info/grafts"};
    for (unsigned j = 0; j < 4 && ok; j++) {
      struct stat info;
      char actual[72];
      if (fstatat(parent, files[j], &info, AT_SYMLINK_NOFOLLOW)) {
        if (errno != ENOENT) {
          ok = 0;
          break;
        }
        fprintf(stream, "%d:%s:absent\n", index, files[j]);
        continue;
      }
      if (!hp_hash_file(parent, files[j], actual)) {
        ok = 0;
        break;
      }
      fprintf(stream, "%d:%s:%s\n", index, files[j], actual);
    }
    close(parent);
  }
  if (fclose(stream))
    ok = 0;
  char hex[65];
  if (ok)
    ok = hp_hash_bytes(identity, bytes, hex);
  free(identity);
  if (ok)
    snprintf(out, 72, "sha256:%s", hex);
  return ok;
}

static int verify_locks(const char *temporary, HpLock *locks, int count,
                        int *sequence) {
  for (int i = 0; i < count; i++) {
    char repo[PATH_MAX], actual[72];
    if (snprintf(repo, sizeof repo, "%s/%s", temporary, locks[i].repository) >=
            (int)sizeof repo ||
        !file_digest(repo, locks[i].path, temporary, sequence, actual) ||
        strcmp(actual, locks[i].digest))
      return 0;
  }
  return 1;
}

static int parse_cache_paths(const char *raw, HpLock **out, int *count,
                             HpRepository *repos, int repositories) {
  int n = hp_count(raw);
  if (n < 0 || n > 128)
    return 0;
  HpLock *items = calloc((size_t)(n ? n : 1), sizeof *items);
  if (!items)
    return 0;
  static const char *const keys[] = {"repository", "path"};
  for (int i = 0; i < n; i++) {
    char *item = hp_item(raw, i);
    int ok = item && hp_shape(item, keys, 2) &&
             hp_text(item, "repository", items[i].repository,
                     sizeof items[i].repository) &&
             repository_index(repos, repositories, items[i].repository) >= 0 &&
             hp_text(item, "path", items[i].path, sizeof items[i].path) &&
             hp_relative(items[i].path);
    free(item);
    if (!ok)
      goto bad;
    const char *unsafe[] = {".env", ".npmrc", ".netrc",  ".ssh",
                            ".aws", ".codex", ".claude", NULL};
    for (int j = 0; unsafe[j]; j++) {
      size_t n = strlen(unsafe[j]);
      const char *p = items[i].path;
      while (p) {
        if (!strncmp(p, unsafe[j], n) &&
            (p[n] == '/' || p[n] == 0 || p[n] == '.'))
          goto bad;
        p = strchr(p, '/');
        if (p)
          p++;
      }
    }
    for (int j = 0; j < i; j++)
      if (!strcmp(items[j].repository, items[i].repository) &&
          !strcmp(items[j].path, items[i].path))
        goto bad;
  }
  *out = items;
  *count = n;
  return 1;
bad:
  free(items);
  return 0;
}
static int copy_file_at(int source_root, const char *source_relative,
                        int target_root, const char *target_relative) {
  if (!hp_relative(source_relative) || !hp_relative(target_relative))
    return 0;
  char source[2049], target[2049];
  strcpy(source, source_relative);
  strcpy(target, target_relative);
  char *source_name = source, *target_name = target,
       *slash = strrchr(source, '/');
  int source_parent = dup(source_root), target_parent = dup(target_root),
      input = -1, output = -1, ok = 0;
  if (source_parent < 0 || target_parent < 0)
    goto done;
  if (slash) {
    *slash = 0;
    source_name = slash + 1;
    int fd = hp_open_dir(source_parent, source, 0);
    close(source_parent);
    source_parent = fd;
    if (fd < 0)
      goto done;
  }
  slash = strrchr(target, '/');
  if (slash) {
    *slash = 0;
    target_name = slash + 1;
    int fd = hp_open_dir(target_parent, target, 1);
    close(target_parent);
    target_parent = fd;
    if (fd < 0)
      goto done;
  }
  input = openat(source_parent, source_name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  struct stat before, after, named;
  if (input < 0 || fstat(input, &before) || !S_ISREG(before.st_mode) ||
      before.st_nlink != 1 || (before.st_mode & 07000))
    goto done;
  output = openat(target_parent, target_name,
                  O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (output < 0)
    goto done;
  char buffer[65536];
  ssize_t n;
  while ((n = read(input, buffer, sizeof buffer)) != 0) {
    if (hp_cancelled)
      goto done;
    if (n < 0) {
      if (errno == EINTR)
        continue;
      goto done;
    }
    ssize_t offset = 0;
    while (offset < n) {
      ssize_t written = write(output, buffer + offset, (size_t)(n - offset));
      if (written < 0 && errno == EINTR)
        continue;
      if (written <= 0)
        goto done;
      offset += written;
    }
  }
  if (fstat(input, &after) ||
      fstatat(source_parent, source_name, &named, AT_SYMLINK_NOFOLLOW) ||
      before.st_dev != after.st_dev || before.st_ino != after.st_ino ||
      before.st_size != after.st_size ||
      before.st_mtim.tv_sec != after.st_mtim.tv_sec ||
      before.st_mtim.tv_nsec != after.st_mtim.tv_nsec ||
      before.st_ctim.tv_sec != after.st_ctim.tv_sec ||
      before.st_ctim.tv_nsec != after.st_ctim.tv_nsec ||
      before.st_dev != named.st_dev || before.st_ino != named.st_ino ||
      before.st_size != named.st_size ||
      before.st_mtim.tv_sec != named.st_mtim.tv_sec ||
      before.st_mtim.tv_nsec != named.st_mtim.tv_nsec ||
      fchmod(output, before.st_mode & 0777) || fsync(output))
    goto done;
  ok = 1;
done:
  if (input >= 0)
    close(input);
  if (output >= 0)
    close(output);
  if (!ok && output >= 0)
    unlinkat(target_parent, target_name, 0);
  if (source_parent >= 0)
    close(source_parent);
  if (target_parent >= 0)
    close(target_parent);
  return ok;
}
static char *read_manifest_at(int root, const char *name) {
  int fd = openat(root, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  struct stat info;
  if (fd < 0)
    return NULL;
  if (fstat(fd, &info) || !S_ISREG(info.st_mode) || info.st_nlink != 1 ||
      info.st_size < 2 || info.st_size > 1048576) {
    close(fd);
    return NULL;
  }
  char *data = malloc((size_t)info.st_size + 1);
  if (!data) {
    close(fd);
    return NULL;
  }
  size_t offset = 0;
  while (offset < (size_t)info.st_size) {
    ssize_t n = read(fd, data + offset, (size_t)info.st_size - offset);
    if (n < 0 && errno == EINTR)
      continue;
    if (n <= 0) {
      free(data);
      close(fd);
      return NULL;
    }
    offset += (size_t)n;
  }
  data[offset] = 0;
  close(fd);
  if (strlen(data) != offset || !hp_valid(data)) {
    free(data);
    return NULL;
  }
  return data;
}
static int cache_manifest(int fd, HpLock *paths, int count, const char *key,
                          int restoring, int workspace) {
  char *manifest = read_manifest_at(fd, "manifest.json");
  if (!manifest)
    return 0;
  static const char *const keys[] = {"schema_version", "cache_key", "files"};
  char claimed[72];
  int version;
  char *files = hp_field(manifest, "files");
  int ok = hp_shape(manifest, keys, 3) &&
           hp_integer(manifest, "schema_version", 1, 1, &version) &&
           hp_text(manifest, "cache_key", claimed, sizeof claimed) &&
           !strcmp(claimed, key) && hp_count(files) == count;
  for (int i = 0; ok && i < count; i++) {
    char *item = hp_item(files, i), repository[97], path[2049], expected[72],
         relative[2200], actual[72];
    static const char *const filekeys[] = {"repository", "path", "digest"};
    ok = item && hp_shape(item, filekeys, 3) &&
         hp_text(item, "repository", repository, sizeof repository) &&
         hp_text(item, "path", path, sizeof path) &&
         hp_text(item, "digest", expected, sizeof expected) &&
         hp_digest(expected) && !strcmp(repository, paths[i].repository) &&
         !strcmp(path, paths[i].path);
    free(item);
    if (!ok)
      break;
    if (snprintf(relative, sizeof relative, "%s/%s", repository, path) >=
        (int)sizeof relative) {
      ok = 0;
      break;
    }
    ok = hp_hash_file(fd, relative, actual) && !strcmp(actual, expected);
    if (ok && restoring)
      ok = copy_file_at(fd, relative, workspace, relative);
    if (ok && restoring)
      ok = hp_hash_file(workspace, relative, actual) &&
           !strcmp(actual, expected);
    if (ok && restoring)
      strcpy(paths[i].digest, expected);
    if (ok && !restoring)
      ok = !strcmp(paths[i].digest, expected);
  }
  free(files);
  free(manifest);
  return ok;
}
static int cache_capture(int cache, const char *cachehex, const char *key,
                         int workspace, HpLock *paths, int count) {
  char temporary[120];
  snprintf(temporary, sizeof temporary, ".cache-%s-%ld", cachehex,
           (long)getpid());
  if (mkdirat(cache, temporary, 0700))
    return 0;
  int fd = hp_open_dir(cache, temporary, 0);
  if (fd < 0)
    return 0;
  int ok = 1;
  for (int i = 0; i < count && ok; i++) {
    char relative[2200];
    if (snprintf(relative, sizeof relative, "%s/%s", paths[i].repository,
                 paths[i].path) >= (int)sizeof relative) {
      ok = 0;
      break;
    }
    ok = hp_hash_file(workspace, relative, paths[i].digest) &&
         copy_file_at(workspace, relative, fd, relative);
    char actual[72];
    if (ok)
      ok = hp_hash_file(fd, relative, actual) &&
           !strcmp(actual, paths[i].digest);
  }
  int metadata = -1;
  FILE *stream = NULL;
  if (ok) {
    metadata =
        openat(fd, "manifest.json",
               O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (metadata < 0)
      ok = 0;
  }
  if (ok) {
    stream = fdopen(metadata, "w");
    if (!stream) {
      close(metadata);
      ok = 0;
    }
  }
  if (ok) {
    fprintf(stream, "{\"schema_version\":1,\"cache_key\":");
    hp_quote(stream, key);
    fputs(",\"files\":[", stream);
    for (int i = 0; i < count; i++) {
      if (i)
        fputc(',', stream);
      fputs("{\"repository\":", stream);
      hp_quote(stream, paths[i].repository);
      fputs(",\"path\":", stream);
      hp_quote(stream, paths[i].path);
      fputs(",\"digest\":", stream);
      hp_quote(stream, paths[i].digest);
      fputc('}', stream);
    }
    fputs("]}", stream);
    if (fflush(stream) || fsync(fileno(stream)))
      ok = 0;
    if (fclose(stream))
      ok = 0;
  }
  if (ok && fsync(fd))
    ok = 0;
  close(fd);
  if (!ok)
    return 0;
  if (renameat(cache, temporary, cache, cachehex)) {
    if (errno != EEXIST && errno != ENOTEMPTY)
      return 0;
    int existing = hp_open_dir(cache, cachehex, 0);
    if (existing < 0)
      return 0;
    ok = cache_manifest(existing, paths, count, key, 0, workspace);
    close(existing);
    return ok;
  }
  return fsync(cache) == 0;
}
static int materialize(const char *action, const char *request,
                       FILE *output) {
  static const char *const keys[] = {"schema_version",   "workspace",
                                     "profile_digest",   "preparation_digest",
                                     "boot_id",          "repositories",
                                     "toolchain_digest", "configuration_digest",
                                     "lock_inputs",      "commands",
                                     "cache_paths",      "cache_scope"};
  if (strcmp(action, "bootstrap.materialize") || !hp_valid(request) ||
      !hp_shape(request, keys, 12))
    return 2;
  char cache_scope[97], workspace[97], profile[72], preparation[72], boot[97],
      toolchain[72], configuration[72];
  int version;
  if (!hp_integer(request, "schema_version", 1, 1, &version) ||
      !hp_text(request, "workspace", workspace, sizeof workspace) ||
      !hp_id(workspace) ||
      !hp_text(request, "cache_scope", cache_scope, sizeof cache_scope) ||
      !hp_id(cache_scope) ||
      !hp_text(request, "profile_digest", profile, sizeof profile) ||
      !hp_digest(profile) ||
      !hp_text(request, "preparation_digest", preparation,
               sizeof preparation) ||
      !hp_digest(preparation) ||
      !hp_text(request, "boot_id", boot, sizeof boot) || !hp_id(boot) ||
      !hp_text(request, "toolchain_digest", toolchain, sizeof toolchain) ||
      !hp_digest(toolchain) ||
      !hp_text(request, "configuration_digest", configuration,
               sizeof configuration) ||
      !hp_digest(configuration))
    return 2;
  HpRepository *repos = NULL;
  HpLock *locks = NULL, *caches = NULL;
  HpCommand *commands = NULL;
  int nrepos = 0, nlocks = 0, ncommands = 0, ncaches = 0, root = -1, cache = -1,
      workspace_fd = -1;
  char *repositories = hp_field(request, "repositories"),
       *lock_inputs = hp_field(request, "lock_inputs"),
       *command_input = hp_field(request, "commands"),
       *cache_paths = hp_field(request, "cache_paths");
  if (!parse_repositories(repositories, &repos, &nrepos) ||
      !parse_locks(lock_inputs, &locks, &nlocks, repos, nrepos) ||
      !parse_commands(command_input, &commands, &ncommands, repos, nrepos) ||
      !parse_cache_paths(cache_paths, &caches, &ncaches, repos, nrepos))
    goto invalid;
  root = hp_root("HF_PREPARATION_WORKSPACE_ROOT");
  if (root < 0)
    goto invalid;
  struct stat existing;
  if (!fstatat(root, workspace, &existing, AT_SYMLINK_NOFOLLOW) ||
      errno != ENOENT)
    goto invalid;
  char temporary_name[200], temporary[PATH_MAX], result_path[PATH_MAX];
  snprintf(temporary_name, sizeof temporary_name, ".preparing-%s-%ld-%lld",
           workspace, (long)getpid(), hp_millis());
  if (mkdirat(root, temporary_name, 0700))
    goto invalid;
  if (snprintf(temporary, sizeof temporary, "/proc/self/fd/%d/%s", root,
               temporary_name) >= (int)sizeof temporary ||
      !realpath(temporary, result_path))
    goto invalid;
  strcpy(temporary, result_path);
  int sequence = 0;
  const char *failure = "SOURCE_FETCH_FAILED";
  struct sigaction old_term, old_int, handler;
  memset(&handler, 0, sizeof handler);
  handler.sa_handler = bootstrap_signal;
  sigemptyset(&handler.sa_mask);
  hp_cancelled = 0;
  sigaction(SIGTERM, &handler, &old_term);
  sigaction(SIGINT, &handler, &old_int);
  for (int i = 0; i < nrepos; i++) {
    int local = repos[i].url[0] == '/';
    failure = "SOURCE_FETCH_FAILED";
    char *clone[] = {"clone", "--no-checkout", "--no-hardlinks",
                     "--",    repos[i].url,    repos[i].id,
                     NULL};
    if (git_run(temporary, temporary, &sequence, clone, local, 300))
      goto failed;
    char repo[PATH_MAX];
    if (snprintf(repo, sizeof repo, "%s/%s", temporary, repos[i].id) >=
        (int)sizeof repo)
      goto failed;
    char *checkout[] = {"checkout", "--detach", "--force", repos[i].commit,
                        NULL};
    if (git_run(repo, temporary, &sequence, checkout, local, 300) ||
        !verify_git_head(repo, temporary, &sequence, repos[i].commit))
      goto failed;
    failure = "SUBMODULE_PIN_MISMATCH";
    int seen = 0;
    if (!materialize_modules(repo, "", repos[i].submodules, temporary,
                             &sequence, 0, &seen) ||
        seen != hp_count(repos[i].submodules) ||
        !verify_modules(repo, repos[i].submodules, temporary, &sequence))
      goto failed;
    if (repos[i].lfs) {
      failure = "LFS_MATERIALIZATION_FAILED";
      char *install[] = {"lfs",           "install",     "--local",
                         "--skip-smudge", "--skip-repo", NULL},
           *pull[] = {"lfs", "pull", NULL},
           *checkout_lfs[] = {"lfs", "checkout", NULL},
           *verify[] = {"lfs", "fsck", "--objects", "--pointers", "HEAD", NULL};
      if (git_run(repo, temporary, &sequence, install, local, 60) ||
          git_run(repo, temporary, &sequence, pull, local, 300) ||
          git_run(repo, temporary, &sequence, checkout_lfs, local, 300) ||
          git_run(repo, temporary, &sequence, verify, local, 300))
        goto failed;
    }
  }
  failure = "LOCK_INPUT_MISMATCH";
  if (!verify_locks(temporary, locks, nlocks, &sequence))
    goto failed;
  char *identity = NULL;
  size_t identity_size = 0;
  FILE *identity_stream = open_memstream(&identity, &identity_size);
  if (!identity_stream) {
    failure = "HASH_FAILED";
    goto failed;
  }
  fprintf(identity_stream, "hyperfide-bootstrap-v1\n%s\n%s\n%s\n%s\n%s\n",
          cache_scope, profile, preparation, toolchain, configuration);
  for (int i = 0; i < nrepos; i++)
    fprintf(identity_stream, "%s:%s\n", repos[i].id, repos[i].commit);
  for (int i = 0; i < nlocks; i++)
    fprintf(identity_stream, "%s:%s:%s\n", locks[i].repository, locks[i].path,
            locks[i].digest);
  for (int i = 0; i < ncommands; i++) {
    fprintf(identity_stream, "%s:%d:[", commands[i].repository,
            commands[i].timeout);
    for (int j = 0; j < commands[i].argc; j++) {
      if (j)
        fputc(',', identity_stream);
      hp_quote(identity_stream, commands[i].argv[j]);
    }
    fputs("]\n", identity_stream);
  }
  for (int i = 0; i < ncaches; i++)
    fprintf(identity_stream, "%s:%s\n", caches[i].repository, caches[i].path);
  fclose(identity_stream);
  char cache_hex[65], cache_key[72];
  int hash_ok = hp_hash_bytes(identity, identity_size, cache_hex);
  free(identity);
  if (!hash_ok) {
    failure = "HASH_FAILED";
    goto failed;
  }
  snprintf(cache_key, sizeof cache_key, "sha256:%s", cache_hex);
  workspace_fd =
      open(temporary, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  int restored = 0;
  if (workspace_fd < 0) {
    failure = "WORKSPACE_FAILED";
    goto failed;
  }
  for (int i = 0; i < ncaches; i++) {
    char repo[PATH_MAX];
    snprintf(repo, sizeof repo, "%s/%s", temporary, caches[i].repository);
    char *tracked[] = {"ls-files", "--error-unmatch", "--", caches[i].path,
                       NULL};
    if (git_run(repo, temporary, &sequence, tracked, 0, 30) == 0) {
      close(workspace_fd);
      workspace_fd = -1;
      failure = "CACHE_OVERWRITES_SOURCE";
      goto failed;
    }
  }
  if (ncaches) {
    int base = hp_root("HF_PREPARATION_CACHE_ROOT");
    if (base < 0) {
      close(workspace_fd);
      workspace_fd = -1;
      failure = "CACHE_CONFIG_INVALID";
      goto failed;
    }
    cache = hp_open_dir(base, cache_scope, 1);
    close(base);
    if (cache < 0) {
      close(workspace_fd);
      workspace_fd = -1;
      failure = "CACHE_CONFIG_INVALID";
      goto failed;
    }
    struct stat status;
    if (!fstatat(cache, cache_hex, &status, AT_SYMLINK_NOFOLLOW)) {
      int entry = hp_open_dir(cache, cache_hex, 0);
      if (entry < 0 ||
          !cache_manifest(entry, caches, ncaches, cache_key, 1, workspace_fd)) {
        if (entry >= 0)
          close(entry);
        close(workspace_fd);
        workspace_fd = -1;
        failure = "CACHE_INTEGRITY_FAILED";
        goto failed;
      }
      close(entry);
      restored = 1;
    } else if (errno != ENOENT) {
      close(workspace_fd);
      workspace_fd = -1;
      failure = "CACHE_INSPECTION_FAILED";
      goto failed;
    }
  }
  char source_controls[64][72];
  failure = "SOURCE_CONTROL_INSPECTION_FAILED";
  for (int i = 0; i < nrepos; i++) {
    char repo[PATH_MAX];
    snprintf(repo, sizeof repo, "%s/%s", temporary, repos[i].id);
    if (!git_metadata_digest(repo, temporary, &sequence, repos[i].submodules,
                             source_controls[i]))
      goto failed;
  }
  failure = "DEPENDENCY_COMMAND_FAILED";
  for (int i = 0; i < ncommands; i++) {
    char repo[PATH_MAX];
    if (snprintf(repo, sizeof repo, "%s/%s", temporary,
                 commands[i].repository) >= (int)sizeof repo)
      goto failed;
    if (log_run(repo, temporary, &sequence, commands[i].argv,
                commands[i].timeout))
      goto failed;
  }
  failure = "SOURCE_MUTATED";
  for (int i = 0; i < nrepos; i++) {
    char repo[PATH_MAX];
    snprintf(repo, sizeof repo, "%s/%s", temporary, repos[i].id);
    char control[72];
    if (!git_metadata_digest(repo, temporary, &sequence, repos[i].submodules,
                             control) ||
        strcmp(control, source_controls[i]))
      goto failed;
    char *diff[] = {"-c",
                    "core.trustctime=true",
                    "-c",
                    "core.ignoreStat=false",
                    "diff",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--quiet",
                    "--exit-code",
                    "HEAD",
                    "--",
                    NULL};
    if (git_run(repo, temporary, &sequence, diff, 0, 60) ||
        !verify_git_head(repo, temporary, &sequence, repos[i].commit) ||
        !verify_modules(repo, repos[i].submodules, temporary, &sequence))
      goto failed;
  }
  failure = "LOCK_INPUT_MISMATCH";
  if (!verify_locks(temporary, locks, nlocks, &sequence))
    goto failed;
  failure = "CANCELLED";
  if (hp_cancelled)
    goto failed;
  if (restored) {
    for (int i = 0; i < ncaches; i++) {
      char path[2200], actual[72];
      snprintf(path, sizeof path, "%s/%s", caches[i].repository,
               caches[i].path);
      if (!hp_hash_file(workspace_fd, path, actual) ||
          strcmp(actual, caches[i].digest)) {
        failure = "CACHE_MUTATED_BY_COMMAND";
        goto failed;
      }
    }
  }
  if (ncaches && !restored &&
      !cache_capture(cache, cache_hex, cache_key, workspace_fd, caches,
                     ncaches)) {
    close(workspace_fd);
    workspace_fd = -1;
    failure = "CACHE_PUBLICATION_FAILED";
    goto failed;
  }
  close(workspace_fd);
  workspace_fd = -1;
  if (cache >= 0) {
    close(cache);
    cache = -1;
  }
  failure = "WORKSPACE_PUBLICATION_FAILED";
  if (renameat2(root, temporary_name, root, workspace, RENAME_NOREPLACE) ||
      fsync(root))
    goto failed;
  sigaction(SIGTERM, &old_term, NULL);
  sigaction(SIGINT, &old_int, NULL);
  fputs("{\"schema_version\":1,\"state\":\"MATERIALIZED\",\"workspace\":",
        output);
  hp_quote(output, workspace);
  fputs(",\"profile_digest\":", output);
  hp_quote(output, profile);
  fputs(",\"preparation_digest\":", output);
  hp_quote(output, preparation);
  fputs(",\"boot_id\":", output);
  hp_quote(output, boot);
  fprintf(
      output,
      ",\"cache_key\":\"sha256:%s\",\"cache_restored\":%s,\"source_commits\":[",
      cache_hex, restored ? "true" : "false");
  for (int i = 0; i < nrepos; i++) {
    if (i)
      fputc(',', output);
    fputs("{\"id\":", output);
    hp_quote(output, repos[i].id);
    fputs(",\"commit\":", output);
    hp_quote(output, repos[i].commit);
    fputc('}', output);
  }
  fputs("],\"authority_granted\":false}", output);
  if (cache >= 0)
    close(cache);
  close(root);
  for (int i = 0; i < nrepos; i++)
    free(repos[i].submodules);
  free(repos);
  free(locks);
  free(caches);
  commands_free(commands, ncommands);
  free(repositories);
  free(lock_inputs);
  free(command_input);
  free(cache_paths);
  return 0;
failed:
  if (workspace_fd >= 0)
    close(workspace_fd);
  sigaction(SIGTERM, &old_term, NULL);
  sigaction(SIGINT, &old_int, NULL);
  fputs("{\"schema_version\":1,\"state\":\"FAILED\",\"reason\":", output);
  hp_quote(output, failure);
  fputs(",\"quarantine_workspace\":", output);
  hp_quote(output, temporary_name);
  fputs(",\"authority_granted\":false}", output);
  close(root);
  for (int i = 0; i < nrepos; i++)
    free(repos[i].submodules);
  free(repos);
  free(locks);
  free(caches);
  commands_free(commands, ncommands);
  free(repositories);
  free(lock_inputs);
  free(command_input);
  free(cache_paths);
  return 0;
invalid:
  if (workspace_fd >= 0)
    close(workspace_fd);
  if (root >= 0)
    close(root);
  if (repos) {
    for (int i = 0; i < nrepos; i++)
      free(repos[i].submodules);
    free(repos);
  }
  if (cache >= 0)
    close(cache);
  free(locks);
  free(caches);
  commands_free(commands, ncommands);
  free(repositories);
  free(lock_inputs);
  free(command_input);
  free(cache_paths);
  return 2;
}
/* Job processes run in their own groups and are killed with them, but a killed
 * grandchild whose parent already exited (a transport helper after a failed
 * clone, a background job after a timeout) is reparented. Adopt and reap those
 * here so no bootstrap process outlives the component. */
static void reap_orphans(void) {
  long long deadline = hp_millis() + 2000;
  for (;;) {
    pid_t pid = waitpid(-1, NULL, WNOHANG);
    if (pid > 0)
      continue;
    if ((pid < 0 && errno != EINTR) || hp_millis() > deadline)
      return;
    if (pid == 0) {
      struct timespec pause = {0, 10 * 1000 * 1000};
      nanosleep(&pause, NULL);
    }
  }
}
int hf_component_11_2(const char *action, const char *request, FILE *output) {
  int adopted = prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) == 0;
  int result = materialize(action, request, output);
  if (adopted) {
    reap_orphans();
    prctl(PR_SET_CHILD_SUBREAPER, 0, 0, 0, 0);
  }
  return result;
}
