"""Reviewable source labels for the 1.6 structural extraction corpus.

Every case has a real source file, a positive symbol and a decoy in non-code.
The labels deliberately use reserved v16_* names so precision is measured only
over statements for which this catalogue supplies ground truth.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Case:
    adapter: str
    path: str
    source: str
    symbol: str
    kind: str
    absent: str
    support: str = "structural"
    line: int | None = None
    qualified: str | None = None


CASES = [
    Case("typescript", "src/types.ts", "// function v16_decoy_ts() {}\nexport function v16_ts(value: number): number {\n  return value + 1;\n}\n", "v16_ts", "function", "v16_decoy_ts"),
    Case("tsx", "src/view.tsx", "// function v16_decoy_tsx() {}\nexport function v16_tsx() {\n  return <span>ok</span>;\n}\n", "v16_tsx", "function", "v16_decoy_tsx"),
    Case("javascript", "src/core.js", "// function v16_decoy_js() {}\nexport function v16_js() {\n  return 1;\n}\n", "v16_js", "function", "v16_decoy_js"),
    Case("jsx", "src/view.jsx", "// function v16_decoy_jsx() {}\nexport function v16_jsx() {\n  return <p>ok</p>;\n}\n", "v16_jsx", "function", "v16_decoy_jsx"),
    Case("c", "src/core.c", "/* int v16_decoy_c(void) { return 0; } */\nint v16_c(void) {\n  return 1;\n}\n", "v16_c", "function", "v16_decoy_c"),
    Case("cpp", "src/core.cpp", "// int v16_decoy_cpp() { return 0; }\nint v16_cpp() {\n  return 1;\n}\n", "v16_cpp", "function", "v16_decoy_cpp"),
    Case("objective_c", "src/core.m", "// int v16_decoy_objc() { return 0; }\nint v16_objc(void) {\n  return 1;\n}\n", "v16_objc", "function", "v16_decoy_objc"),
    Case("go", "src/core.go", "package sample\n// func v16_decoy_go() {}\nfunc v16_go() int {\n  return 1\n}\n", "v16_go", "function", "v16_decoy_go"),
    Case("rust", "src/lib.rs", "// fn v16_decoy_rust() {}\npub fn v16_rust() -> i32 {\n  1\n}\n", "v16_rust", "function", "v16_decoy_rust"),
    Case("python", "src/core.py", "# def v16_decoy_py(): pass\ndef v16_py():\n    return 1\n", "v16_py", "function", "v16_decoy_py"),
    Case("ruby", "src/core.rb", "# def v16_decoy_ruby; end\ndef v16_ruby\n  1\nend\n", "v16_ruby", "function", "v16_decoy_ruby"),
    Case("php", "src/core.php", "<?php\n// function v16_decoy_php() {}\nfunction v16_php(): int {\n  return 1;\n}\n", "v16_php", "function", "v16_decoy_php"),
    Case("java", "src/Core.java", "class Core {\n  // public int v16_decoy_java() { return 0; }\n  public int v16_java() {\n    return 1;\n  }\n}\n", "v16_java", "method", "v16_decoy_java"),
    Case("kotlin", "src/Core.kt", "// fun v16_decoy_kotlin() = 0\nfun v16_kotlin(): Int {\n  return 1\n}\n", "v16_kotlin", "function", "v16_decoy_kotlin"),
    Case("scala", "src/Core.scala", "object Core {\n  // def v16_decoy_scala: Int = 0\n  def v16_scala: Int = 1\n}\n", "v16_scala", "method", "v16_decoy_scala"),
    Case("csharp", "src/Core.cs", "class Core {\n  // public int v16_decoy_csharp() => 0;\n  public int v16_csharp() {\n    return 1;\n  }\n}\n", "v16_csharp", "method", "v16_decoy_csharp"),
    Case("swift", "src/Core.swift", "// func v16_decoy_swift() -> Int { return 0 }\nfunc v16_swift() -> Int {\n  return 1\n}\n", "v16_swift", "function", "v16_decoy_swift"),
    Case("dart", "src/core.dart", "// int v16_decoy_dart() => 0;\nint v16_dart() {\n  return 1;\n}\n", "v16_dart", "function", "v16_decoy_dart"),
    Case("lua", "src/core.lua", "-- function v16_decoy_lua() end\nfunction v16_lua()\n  return 1\nend\n", "v16_lua", "function", "v16_decoy_lua"),
    Case("luau", "src/core.luau", "-- function v16_decoy_luau() end\nfunction v16_luau(): number\n  return 1\nend\n", "v16_luau", "function", "v16_decoy_luau"),
    Case("r", "src/core.R", "# v16_decoy_r <- function() 0\nv16_r <- function() {\n  1\n}\n", "v16_r", "function", "v16_decoy_r"),
    Case("erlang", "src/core.erl", "-module(core).\n-export([v16_erlang/0]).\n% v16_decoy_erlang() -> 0.\nv16_erlang() -> 1.\n", "v16_erlang", "function", "v16_decoy_erlang", line=4),
    Case("solidity", "src/Core.sol", "pragma solidity ^0.8.0;\ncontract Core {\n  // function v16_decoy_solidity() public pure returns(uint) { return 0; }\n  function v16_solidity() public pure returns(uint) { return 1; }\n}\n", "v16_solidity", "function", "v16_decoy_solidity"),
    Case("terraform", "src/main.tf", "# resource \"null_resource\" \"v16_decoy_tf\" {}\nresource \"null_resource\" \"v16_tf\" {}\n", "null_resource", "block", "v16_decoy_tf", qualified="resource.null_resource.v16_tf"),
    Case("nix", "src/default.nix", "{ }: let\n  # v16_decoy_nix = 0;\n  v16_nix = 1;\nin v16_nix\n", "v16_nix", "attribute", "v16_decoy_nix"),
    Case("pascal", "src/core.pas", "unit Core;\ninterface\n// procedure v16_decoy_pascal;\nprocedure v16_pascal;\nimplementation\nprocedure v16_pascal; begin end;\nend.\n", "v16_pascal", "function", "v16_decoy_pascal"),
    Case("cobol", "src/core.cbl", "       IDENTIFICATION DIVISION.\n       PROGRAM-ID. CORE.\n       PROCEDURE DIVISION.\n      *    V16-DECOY-COBOL.\n       V16-COBOL.\n           DISPLAY 'ok'.\n", "V16-COBOL", "paragraph", "V16-DECOY-COBOL"),
    Case("vbnet", "src/Core.vb", "Public Class Core\n    ' Public Sub v16_decoy_vbnet()\n    Public Sub v16_vbnet()\n    End Sub\nEnd Class\n", "v16_vbnet", "method", "v16_decoy_vbnet"),
    Case("cfscript", "src/core.cfc", "<cfscript>\n  // function v16_decoy_cfscript() {}\n  function v16_cfscript() { return 1; }\n</cfscript>\n", "v16_cfscript", "function", "v16_decoy_cfscript"),
    Case("cfquery", "src/core.cfm", "<cfquery name=\"v16_cfquery\" datasource=\"main\">\nSELECT 1\n</cfquery>\n<!--- <cfquery name=\"v16_decoy_cfquery\"> --->\n", "v16_cfquery", "query", "v16_decoy_cfquery"),
    Case("arkts", "src/core.ets", "// function v16_decoy_arkts() {}\nexport function v16_arkts(): number {\n  return 1;\n}\n", "v16_arkts", "function", "v16_decoy_arkts"),
    Case("vue", "src/Widget.vue", "<script setup lang=\"ts\">\n// function v16_decoy_vue() {}\nfunction v16_vue() { return 1; }\n</script>\n<template><button @click=\"v16_vue\">run</button></template>\n", "v16_vue", "function", "v16_decoy_vue"),
    Case("svelte", "src/Widget.svelte", "<script lang=\"ts\">\n// function v16_decoy_svelte() {}\nfunction v16_svelte() { return 1; }\n</script>\n<button on:click={v16_svelte}>run</button>\n", "v16_svelte", "function", "v16_decoy_svelte"),
    Case("astro", "src/Widget.astro", "---\n// function v16_decoy_astro() {}\nfunction v16_astro() { return 1; }\n---\n<button>{v16_astro()}</button>\n", "v16_astro", "function", "v16_decoy_astro"),
    Case("liquid", "src/widget.liquid", "{% comment %}{% render 'v16_decoy_liquid' %}{% endcomment %}\n{% render 'v16_liquid' %}\n", "v16_liquid", "template", "v16_decoy_liquid", "reference-only"),
    Case("razor", "src/Widget.cshtml", "@* @model v16_decoy_razor *@\n@model v16_razor\n", "v16_razor", "type", "v16_decoy_razor", "reference-only"),
    Case("cfml", "src/widget.cfm", "<!--- <cffunction name=\"v16_decoy_cfml\"> --->\n<cffunction name=\"v16_cfml\"><cfreturn 1></cffunction>\n", "v16_cfml", "function", "v16_decoy_cfml"),
    Case("delphi_form", "src/Widget.dfm", "object v16_form: TForm\n  Caption = 'v16_decoy_form'\n  OnClick = v16_on_click\nend\n", "v16_form", "component", "v16_decoy_form"),
    Case("mybatis", "src/Widget.xml", "<mapper namespace=\"Widget\">\n  <!-- <select id=\"v16_decoy_mybatis\">x</select> -->\n  <select id=\"v16_mybatis\">SELECT 1</select>\n</mapper>\n", "v16_mybatis", "statement", "v16_decoy_mybatis"),
    Case("json", "src/data.json", '{"v16_json": 1, "v16_decoy_json": "text"}\n', "", "", "", "file-only"),
    Case("yaml", "src/data.yaml", "v16_yaml: 1\nv16_decoy_yaml: text\n", "", "", "", "file-only"),
    Case("twig", "src/data.twig", "{{ v16_twig }}\n{# v16_decoy_twig #}\n", "", "", "", "file-only"),
    Case("properties", "src/data.properties", "v16_properties=1\nv16_decoy_properties=text\n", "", "", "", "file-only"),
]


REQUIRED_ADAPTERS = frozenset({
    "typescript", "tsx", "javascript", "jsx", "c", "cpp", "objective_c", "go", "rust",
    "python", "ruby", "php", "java", "kotlin", "scala", "csharp", "swift", "dart",
    "lua", "luau", "r", "erlang", "solidity", "terraform", "nix", "pascal",
    "cobol", "vbnet", "cfscript", "cfquery", "arkts", "vue", "svelte", "astro",
    "liquid", "razor", "cfml", "delphi_form", "mybatis", "json", "yaml", "twig",
    "properties",
})
assert {c.adapter for c in CASES} == REQUIRED_ADAPTERS
assert len(REQUIRED_ADAPTERS) == len(CASES), "one independently scored fixture per adapter"
