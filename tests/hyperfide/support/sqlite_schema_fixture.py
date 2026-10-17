"""Synthetic SQLite schemas extracted from the repository's actual C DDL, never private databases."""
import ast,hashlib,re,sqlite3
from pathlib import Path
def _literals(text,start):
 parts=[]
 token=re.compile(r'"(?:\\.|[^"\\])*"|/\*[\s\S]*?\*/|//[^\n]*|[;,]')
 for match in token.finditer(text,start):
  value=match.group()
  if value.startswith('"'):parts.append(ast.literal_eval(value))
  elif value in (';',','):break
 if not parts:raise AssertionError("actual source DDL literals absent")
 return ''.join(parts)
def source_variant(root,database):
 files={name:(root/name).read_text() for name in ["src/db.c","src/semantic.c","src/sem_routes.c","src/index_health.c","src/journal.c"]}
 def schema(name,symbol):
  text=files[name];marker="static const char *"+symbol+" ="
  return _literals(text,text.index(marker)+len(marker))
 c=sqlite3.connect(database)
 c.executescript(schema("src/db.c","SCHEMA"))
 c.executescript(schema("src/semantic.c","SEM_SCHEMA"))
 c.executescript(schema("src/sem_routes.c","SCHEMA"))
 text=files["src/index_health.c"];c.executescript(_literals(text,text.index('"CREATE TABLE IF NOT EXISTS extraction_health(')))
 text=files["src/db.c"];start=text.index("static const char *V18[][2] =")
 section=text[start:text.index("};",start)]
 agents=dict(re.findall(r'\{"([a-z_]+)",\s*"([A-Z]+)"\}',section))
 if len(agents)!=17:raise AssertionError("source agent additive inventory changed; fixture must be reviewed")
 additions={"agents":agents,"files":{"base":"TEXT","mtime_ns":"INTEGER"},
  "runtime_events":{"semantic_fingerprint":"TEXT"},"attempts":{"branch":"TEXT","worktree":"TEXT","parent":"TEXT"},
  "memories":{"branch":"TEXT","class":"TEXT","confidence":"REAL"},"leases":{"ahead":"TEXT"},
  "extraction_health":{"diagnostics":"TEXT NOT NULL DEFAULT ''","pending_version":"INTEGER"},
  "semantic_route_facts":{"registration_column":"INTEGER NOT NULL DEFAULT 0"}}
 for table,columns in additions.items():
  actual={row[1]:row for row in c.execute('PRAGMA table_info("'+table+'")')}
  for column,fallback in list(columns.items()):
   row=actual.get(column)
   if row:
    definition=row[2]+(" NOT NULL" if row[3] else "")+(" DEFAULT "+row[4] if row[4] is not None else "")
    columns[column]=definition
  for index, in list(c.execute("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL",(table,))):
   c.execute('DROP INDEX "'+index.replace('"','""')+'"')
  for column in columns:
   if column in actual:c.execute('ALTER TABLE "'+table+'" DROP COLUMN "'+column+'"')
 c.execute("DROP TABLE IF EXISTS journal_applied")
 c.execute("INSERT INTO meta(key,value) VALUES('schema_version','18') ON CONFLICT(key) DO UPDATE SET value='18'")
 c.commit()
 journal=files["src/journal.c"];journal=_literals(journal,journal.index('"CREATE TABLE IF NOT EXISTS journal_applied('))
 provenance={"source_digests":{name:"sha256:"+hashlib.sha256(text.encode()).hexdigest() for name,text in files.items()},"sqlite_version":sqlite3.sqlite_version,"fixture":"actual lexical C DDL plus source-documented same-v18 additive variants","private_records_used":False}
 def widen():
  for table,columns in additions.items():
   for column,definition in columns.items():c.execute('ALTER TABLE "'+table+'" ADD COLUMN "'+column+'" '+definition)
  c.executescript(journal);c.commit()
 return c,additions,widen,provenance
