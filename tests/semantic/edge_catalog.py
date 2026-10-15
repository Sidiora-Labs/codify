"""Source-labelled call edges and deliberately absent calls by language.

Each fixture has a real caller, a real target and a real unrelated function.
Only the caller invokes the target. The unrelated function may mention the
target in a comment or string, which must not become a relationship.
"""

from dataclasses import dataclass
from dataclasses import field


@dataclass(frozen=True)
class EdgeCase:
    adapter: str
    path: str
    source: str
    target: str = "v16_edge_target"
    caller: str = "v16_edge_caller"
    unrelated: str = "v16_edge_unrelated"
    kind: str = "calls"
    extra_files: dict[str, str] = field(default_factory=dict)
    target_qualified: str | None = None
    caller_qualified: str | None = None
    unrelated_qualified: str | None = None


EDGES = [
    EdgeCase("typescript", "src/flow.ts", "export function v16_edge_target() { return 1; }\nexport function v16_edge_caller() { return v16_edge_target(); }\nexport function v16_edge_unrelated() { /* v16_edge_target() */ return 0; }\n"),
    EdgeCase("tsx", "src/flow.tsx", "export function v16_edge_target() { return 1; }\nexport function v16_edge_caller() { return v16_edge_target(); }\nexport function v16_edge_unrelated() { /* v16_edge_target() */ return 0; }\n"),
    EdgeCase("javascript", "src/flow.js", "export function v16_edge_target() { return 1; }\nexport function v16_edge_caller() { return v16_edge_target(); }\nexport function v16_edge_unrelated() { /* v16_edge_target() */ return 0; }\n"),
    EdgeCase("jsx", "src/flow.jsx", "export function v16_edge_target() { return 1; }\nexport function v16_edge_caller() { return v16_edge_target(); }\nexport function v16_edge_unrelated() { /* v16_edge_target() */ return 0; }\n"),
    EdgeCase("c", "src/flow.c", "int v16_edge_target(void) { return 1; }\nint v16_edge_caller(void) { return v16_edge_target(); }\nint v16_edge_unrelated(void) { /* v16_edge_target() */ return 0; }\n"),
    EdgeCase("cpp", "src/flow.cpp", "int v16_edge_target() { return 1; }\nint v16_edge_caller() { return v16_edge_target(); }\nint v16_edge_unrelated() { /* v16_edge_target() */ return 0; }\n"),
    EdgeCase("objective_c", "src/flow.m", "int v16_edge_target(void) { return 1; }\nint v16_edge_caller(void) { return v16_edge_target(); }\nint v16_edge_unrelated(void) { /* v16_edge_target() */ return 0; }\n"),
    EdgeCase("go", "src/flow.go", "package sample\nfunc v16_edge_target() int { return 1 }\nfunc v16_edge_caller() int { return v16_edge_target() }\nfunc v16_edge_unrelated() int { /* v16_edge_target() */ return 0 }\n"),
    EdgeCase("rust", "src/flow.rs", "fn v16_edge_target() -> i32 { 1 }\nfn v16_edge_caller() -> i32 { v16_edge_target() }\nfn v16_edge_unrelated() -> i32 { /* v16_edge_target() */ 0 }\n"),
    EdgeCase("python", "src/flow.py", "def v16_edge_target(): return 1\ndef v16_edge_caller(): return v16_edge_target()\ndef v16_edge_unrelated():\n    # v16_edge_target()\n    return 0\n"),
    EdgeCase("ruby", "src/flow.rb", "def v16_edge_target; 1; end\ndef v16_edge_caller; v16_edge_target(); end\ndef v16_edge_unrelated\n  # v16_edge_target()\n  0\nend\n"),
    EdgeCase("php", "src/flow.php", "<?php\nfunction v16_edge_target() { return 1; }\nfunction v16_edge_caller() { return v16_edge_target(); }\nfunction v16_edge_unrelated() { /* v16_edge_target() */ return 0; }\n"),
    EdgeCase("java", "src/Flow.java", "class Flow {\n  int v16_edge_target() { return 1; }\n  int v16_edge_caller() { return v16_edge_target(); }\n  int v16_edge_unrelated() { /* v16_edge_target() */ return 0; }\n}\n"),
    EdgeCase("kotlin", "src/Flow.kt", "fun v16_edge_target(): Int = 1\nfun v16_edge_caller(): Int = v16_edge_target()\nfun v16_edge_unrelated(): Int { /* v16_edge_target() */ return 0 }\n"),
    EdgeCase("scala", "src/Flow.scala", "object Flow {\n  def v16_edge_target(): Int = 1\n  def v16_edge_caller(): Int = v16_edge_target()\n  def v16_edge_unrelated(): Int = { /* v16_edge_target() */ 0 }\n}\n"),
    EdgeCase("csharp", "src/Flow.cs", "class Flow {\n  int v16_edge_target() { return 1; }\n  int v16_edge_caller() { return v16_edge_target(); }\n  int v16_edge_unrelated() { /* v16_edge_target() */ return 0; }\n}\n"),
    EdgeCase("swift", "src/Flow.swift", "func v16_edge_target() -> Int { return 1 }\nfunc v16_edge_caller() -> Int { return v16_edge_target() }\nfunc v16_edge_unrelated() -> Int { /* v16_edge_target() */ return 0 }\n"),
    EdgeCase("dart", "src/flow.dart", "int v16_edge_target() => 1;\nint v16_edge_caller() => v16_edge_target();\nint v16_edge_unrelated() { /* v16_edge_target() */ return 0; }\n"),
    EdgeCase("lua", "src/flow.lua", "function v16_edge_target() return 1 end\nfunction v16_edge_caller() return v16_edge_target() end\nfunction v16_edge_unrelated() --[[ v16_edge_target() ]] return 0 end\n"),
    EdgeCase("luau", "src/flow.luau", "function v16_edge_target(): number return 1 end\nfunction v16_edge_caller(): number return v16_edge_target() end\nfunction v16_edge_unrelated(): number --[[ v16_edge_target() ]] return 0 end\n"),
    EdgeCase("r", "src/flow.R", "v16_edge_target <- function() 1\nv16_edge_caller <- function() v16_edge_target()\nv16_edge_unrelated <- function() { # v16_edge_target()\n  0\n}\n"),
    EdgeCase("erlang", "src/flow.erl", "-module(flow).\n-export([v16_edge_target/0,v16_edge_caller/0,v16_edge_unrelated/0]).\nv16_edge_target() -> 1.\nv16_edge_caller() -> v16_edge_target().\nv16_edge_unrelated() -> % v16_edge_target()\n  0.\n"),
    EdgeCase("solidity", "src/Flow.sol", "pragma solidity ^0.8.0;\ncontract Flow {\n  function v16_edge_target() public pure returns(uint) { return 1; }\n  function v16_edge_caller() public pure returns(uint) { return v16_edge_target(); }\n  function v16_edge_unrelated() public pure returns(uint) { /* v16_edge_target() */ return 0; }\n}\n"),
    EdgeCase("vbnet", "src/Flow.vb", "Public Class Flow\n  Public Function v16_edge_target() As Integer\n    Return 1\n  End Function\n  Public Function v16_edge_caller() As Integer\n    Return v16_edge_target()\n  End Function\n  Public Function v16_edge_unrelated() As Integer\n    ' v16_edge_target()\n    Return 0\n  End Function\nEnd Class\n"),
    EdgeCase("arkts", "src/flow.ets", "function v16_edge_target(): number { return 1; }\nfunction v16_edge_caller(): number { return v16_edge_target(); }\nfunction v16_edge_unrelated(): number { /* v16_edge_target() */ return 0; }\n"),
    EdgeCase("pascal", "src/flow.pas", "unit Flow;\ninterface\nfunction v16_edge_target: Integer;\nfunction v16_edge_caller: Integer;\nfunction v16_edge_unrelated: Integer;\nimplementation\nfunction v16_edge_target: Integer; begin Result := 1; end;\nfunction v16_edge_caller: Integer; begin Result := v16_edge_target(); end;\nfunction v16_edge_unrelated: Integer; begin { v16_edge_target() } Result := 0; end;\nend.\n"),
    EdgeCase("cobol", "src/flow.cbl", "       IDENTIFICATION DIVISION.\n       PROGRAM-ID. FLOW.\n       PROCEDURE DIVISION.\n       V16-EDGE-CALLER.\n           PERFORM V16-EDGE-TARGET.\n       V16-EDGE-TARGET.\n           DISPLAY 'ok'.\n       V16-EDGE-UNRELATED.\n      *    PERFORM V16-EDGE-TARGET.\n           DISPLAY 'other'.\n", "V16-EDGE-TARGET", "V16-EDGE-CALLER", "V16-EDGE-UNRELATED", "calls"),
    EdgeCase("cfscript", "src/flow.cfc", "<cfscript>\n  function v16_edge_target() { return 1; }\n  function v16_edge_caller() { return v16_edge_target(); }\n  function v16_edge_unrelated() { /* v16_edge_target() */ return 0; }\n</cfscript>\n"),
    EdgeCase("vue", "src/flow.vue", "<script setup lang=\"ts\">\nfunction v16_edge_target() { return 1; }\nfunction v16_edge_caller() { return v16_edge_target(); }\nfunction v16_edge_unrelated() { /* v16_edge_target() */ return 0; }\n</script>\n<template><button @click=\"v16_edge_caller\">go</button></template>\n"),
    EdgeCase("svelte", "src/flow.svelte", "<script lang=\"ts\">\nfunction v16_edge_target() { return 1; }\nfunction v16_edge_caller() { return v16_edge_target(); }\nfunction v16_edge_unrelated() { /* v16_edge_target() */ return 0; }\n</script>\n<button on:click={v16_edge_caller}>go</button>\n"),
    EdgeCase("astro", "src/flow.astro", "---\nfunction v16_edge_target() { return 1; }\nfunction v16_edge_caller() { return v16_edge_target(); }\nfunction v16_edge_unrelated() { /* v16_edge_target() */ return 0; }\n---\n<p>{v16_edge_caller()}</p>\n"),
    EdgeCase("cfml", "src/flow.cfm", "<cffunction name=\"v16_edge_target\"><cfreturn 1></cffunction>\n<cffunction name=\"v16_edge_caller\"><cfreturn v16_edge_target()></cffunction>\n<cffunction name=\"v16_edge_unrelated\"><!--- v16_edge_target() ---><cfreturn 0></cffunction>\n"),
    EdgeCase("terraform", "src/flow.tf", "resource \"null_resource\" \"v16_edge_target\" {}\nresource \"null_resource\" \"v16_edge_caller\" {\n  depends_on = [null_resource.v16_edge_target]\n}\nresource \"null_resource\" \"v16_edge_unrelated\" {\n  # depends_on = [null_resource.v16_edge_target]\n}\n", target="null_resource", caller="null_resource", unrelated="null_resource", kind="references", target_qualified="resource.null_resource.v16_edge_target", caller_qualified="resource.null_resource.v16_edge_caller", unrelated_qualified="resource.null_resource.v16_edge_unrelated"),
    EdgeCase("nix", "src/flow.nix", "{ }: let\n  v16_edge_target = 1;\n  v16_edge_caller = v16_edge_target;\n  v16_edge_unrelated = 0; # v16_edge_target\nin v16_edge_caller\n", kind="references"),
    EdgeCase("mybatis", "src/flow.xml", "<mapper namespace=\"Flow\">\n  <sql id=\"v16_edge_target\">SELECT 1</sql>\n  <select id=\"v16_edge_caller\"><include refid=\"v16_edge_target\"/></select>\n  <select id=\"v16_edge_unrelated\">SELECT 0</select>\n  <!-- <include refid=\"v16_edge_target\"/> -->\n</mapper>\n", kind="references"),
    EdgeCase("cfquery", "src/flow.cfm", "<cfquery name=\"v16_edge_target\" datasource=\"main\">SELECT 1 AS value</cfquery>\n<cfquery name=\"v16_edge_caller\" dbtype=\"query\">SELECT * FROM v16_edge_target</cfquery>\n<cfquery name=\"v16_edge_unrelated\" datasource=\"main\">SELECT 0 AS value</cfquery>\n<!--- v16_edge_unrelated reads v16_edge_target --->\n", kind="references"),
    EdgeCase("delphi_form", "src/Flow.dfm", "object v16_edge_caller: TFlow\n  OnClick = v16_edge_target\n  object v16_edge_unrelated: TPanel\n    Caption = 'v16_edge_target'\n  end\nend\n", kind="references", extra_files={"src/Flow.pas": "unit Flow;\ninterface\ntype\n  TFlow = class(TForm)\n    procedure v16_edge_target(Sender: TObject);\n  end;\nimplementation\nprocedure TFlow.v16_edge_target(Sender: TObject); begin end;\nend.\n"}),
]


assert len({e.adapter for e in EDGES}) == len(EDGES)
