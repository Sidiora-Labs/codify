#!/usr/bin/env python3
"""Run the real domain07 component fixture for this task only."""
import importlib.util
from pathlib import Path
import sys
spec=importlib.util.spec_from_file_location("graph_domain_fixture",Path(__file__).with_name("7_2.py"))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
native=module.native;expect=module.expect;sql=module.sql
shared_publication=module.publication
native_service=native.Service

class Service(native_service):
    # The identity fixture's real migration engine already applies the complete
    # release including 0007-graph; re-running its DDL raw fails with 42P07.
    # Require the engine-applied graph migration to be checksum-pinned instead.
    def __init__(self,*args,graph_schema=False,**kw):
        super().__init__(*args,graph_schema=False,**kw)
        if graph_schema:self.fixture.apply_migration("0007-graph")
native.Service=Service

def failed_build_exposes_debt(f):
    # A real syntax error makes the native parser record partial coverage; that
    # staged build must stay unpublishable while the prior generation is served.
    def scenario():
        source=f.native.repo
        (source/"broken.py").write_text("def broken(value:\n    return value +\n")
        native.process(["git","add","broken.py"],source);native.process(["git","commit","-qm","failed parse chunk fixture"],source)
        commit=native.process(["git","rev-parse","HEAD"],source);tree=native.process(["git","rev-parse","HEAD^{tree}"],source)
        sql("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id) VALUES('"+module.SCOPE["organisation_id"]+"','"+native.UUIDS["repository_id"]+"','"+commit+"')")
        f.native.input.update(commit=commit,tree=tree)
        before=sql("SELECT manifest_id::text||'|'||publication_generation::text FROM hyperfide.graph_channels WHERE name='main'").stdout.strip()
        expect(before.count("|")==1,"no previously published generation to preserve")
        manifest=f.extract("7")
        expect(manifest["coverage"]["complete"] is False and manifest["coverage"]["failed_files"]>=1,"native extraction hid the failed parse: "+native.encoded(manifest["coverage"]))
        build=f.create(manifest)["build_id"];f.stage(build,manifest,f.native.chunks(manifest))
        f.reject("7.2","graph.ingest.seal",f.scoped(build_id=build),"GRAPH_INCOMPLETE")
        f.reject("7.3","graph.publish.commit",f.scoped(build_id=build,channel="main",expected_generation=before.split("|")[1],operation_id=str(module.uuid.uuid4())),"GRAPH_INCOMPLETE")
        inspected=f.ok("7.2","graph.ingest.inspect",f.scoped(build_id=build))
        expect(inspected["coverage"]["failed_files"]>=1 and inspected["build"]["state"]=="STAGING","ingestion inspect hid failed staging coverage")
        debt=f.ok("7.3","graph.publish.debt",f.scoped(build_id=build,channel="main"))
        expect(debt["publishable"] is False and debt["failed_files"]>=1 and debt["resolution_phase"] is None and debt["incomplete_sources"],"publication debt hid failed staging: "+native.encoded(debt))
        expect(debt["published_manifest_id"]+"|"+debt["published_generation"]==before,"debt report misattributed the retained generation")
        expect(sql("SELECT manifest_id::text||'|'||publication_generation::text FROM hyperfide.graph_channels WHERE name='main'").stdout.strip()==before,"failed build changed the published channel")
        expect(sql("SELECT count(*) FROM hyperfide.graph_manifests WHERE build_id='"+build+"'").stdout.strip()=="0","failed build produced a manifest")
        retained=f.ok("7.3","graph.publish.debt",f.scoped(build_id=sql("SELECT m.build_id::text FROM hyperfide.graph_manifests m JOIN hyperfide.graph_channels c ON c.manifest_id=m.id WHERE c.name='main'").stdout.strip(),channel="main"))
        expect(retained["publishable"] is True and retained["state"]=="PUBLISHED" and int(retained["unresolved_reference_count"])>=0,"retained complete generation lost its coverage report")
    module.check("graph.publication.failed-build-exposes-debt",scenario)

def publication(f):
    shared_publication(f)
    failed_build_exposes_debt(f)
module.publication=publication

if __name__=="__main__":
    sys.exit(module.cleanup() if "--cleanup" in sys.argv else module.main("7.3"))
