#!/usr/bin/env bash
# Native web grammar extraction: structure, bindings, calls and negative syntax.
. "$(dirname "$0")/../lib.sh"
mkdir -p "$TMP/project/src"
cp "$FIXTURES"/semantic/web/* "$TMP/project/src/"
cd "$TMP/project"
"$CG" init >/dev/null
DB="$(printf '%s\n' .*/graph.db | head -1)"
count() { sqlite3 "$DB" "$1"; }
expect_some() { local n; n="$(count "$1")"; [ "$n" -ge 1 ] || fail "$2 (got $n)"; }
expect_none() { local n; n="$(count "$1")"; [ "$n" -eq 0 ] || fail "$2 (got $n)"; }

# A complete statement above a malformed tail still yields sound facts.
expect_some "SELECT count(*) FROM symbols s JOIN files f ON f.id=s.file_id WHERE f.path='src/broken.ts' AND s.name='intact'" 'lost complete declaration during recovery'
expect_none "SELECT count(*) FROM symbols s JOIN files f ON f.id=s.file_id WHERE f.path='src/broken.ts' AND s.name='unfinished'" 'fabricated incomplete declaration'

# Multiline declaration, owner-aware class method and object actions.
expect_some "SELECT count(*) FROM semantic_symbols WHERE qualified_name='Panel.render' AND start_line<end_line" 'missing multiline class method'
expect_some "SELECT count(*) FROM semantic_symbols WHERE qualified_name='Screen' AND start_line<end_line" 'missing multiline exported function'
expect_some "SELECT count(*) FROM semantic_symbols WHERE qualified_name='Screen.actions.save'" 'missing object action'
expect_some "SELECT count(*) FROM semantic_symbols WHERE qualified_name='Screen.actions.cancel'" 'missing object shorthand method'
expect_some "SELECT count(*) FROM semantic_symbols WHERE qualified_name='View.actions.open'" 'missing JSX file action'
expect_some "SELECT count(*) FROM semantic_symbols WHERE qualified_name='Counter.increment'" 'missing plain JavaScript method'
one="$(count "SELECT count(*) FROM symbols WHERE name='Screen'")"
[ "$one" -eq 1 ] || fail "semantic projection duplicated Screen ($one definitions)"

# Aliases and reexports retain both written and local names.
expect_some "SELECT count(*) FROM semantic_bindings WHERE module='./service' AND local_name='load' AND original_name='fetchItem' AND kind='import'" 'missing named import alias'
expect_some "SELECT count(*) FROM semantic_bindings WHERE module='./api' AND local_name='API' AND kind='namespace'" 'missing namespace import'
expect_some "SELECT count(*) FROM semantic_bindings WHERE local_name='load' AND exported_name='reload' AND is_export=1" 'missing local export alias'
expect_some "SELECT count(*) FROM semantic_bindings WHERE module='./shared' AND kind='export_all'" 'missing star reexport'
expect_some "SELECT count(*) FROM semantic_bindings WHERE local_name='View' AND exported_name='default' AND is_export=1" 'missing default export binding'

# Syntax facts expose type, callback and component relations with source sites.
expect_some "SELECT count(*) FROM semantic_type_facts WHERE kind='variable_type' AND name='panel'" 'missing declared variable type'
expect_some "SELECT count(*) FROM semantic_type_facts WHERE kind='constructor' AND name='panel'" 'missing constructor fact'
expect_some "SELECT count(*) FROM semantic_type_facts WHERE kind='callback_registration' AND name='bus.on'" 'missing callback registration'
expect_some "SELECT count(*) FROM semantic_type_facts WHERE kind='event_subscription' AND name='saved'" 'missing literal subscription'
expect_some "SELECT count(*) FROM semantic_type_facts WHERE kind='channel:bus:consumer' AND name='saved' AND value='src/main.tsx:bus'" 'missing proven bus consumer'
expect_some "SELECT count(*) FROM semantic_type_facts WHERE kind='channel:bus:producer' AND name='saved' AND value='src/main.tsx:bus'" 'missing proven bus producer'
expect_some "SELECT count(*) FROM semantic_type_facts WHERE kind='channel:http:producer' AND name='/local' AND value='POST'" 'missing literal HTTP producer'
expect_none "SELECT count(*) FROM semantic_type_facts WHERE kind LIKE 'channel:%' AND (name LIKE '%example.invalid%' OR name LIKE '%suffix%' OR name='remoteUrl')" 'dynamic or external channel was asserted'
expect_some "SELECT count(*) FROM semantic_type_facts WHERE kind='jsx_component' AND name='PanelView'" 'missing JSX component'
expect_some "SELECT count(*) FROM semantic_type_facts WHERE kind='observer_subscription' AND name='change'" 'missing literal observer registration'
expect_some "SELECT count(*) FROM semantic_references WHERE kind='call' AND original_text='load'" 'missing call reference'

# Strings, comments and type names do not become executable declarations/calls.
expect_none "SELECT count(*) FROM symbols WHERE name IN ('Phantom','Bogus','FakeClass','Pretend')" 'comment/string created definition'
expect_none "SELECT count(*) FROM semantic_references WHERE original_text IN ('Ghost','FakeAction')" 'comment created call'

# The semantic information must survive a no-op sync and change with edits.
"$CG" sync >/dev/null
expect_some "SELECT count(*) FROM semantic_symbols WHERE qualified_name='Panel.render'" 'no-op sync lost method'
sed -i 's/async render(/async draw(/' src/main.tsx
"$CG" sync >/dev/null
expect_some "SELECT count(*) FROM semantic_symbols WHERE qualified_name='Panel.draw'" 'edit did not replace method'
expect_none "SELECT count(*) FROM semantic_symbols WHERE qualified_name='Panel.render'" 'stale method survived edit'
echo ok
