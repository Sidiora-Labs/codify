contract Ledger {
  event Updated(uint value);
  function launch(uint x) public { run(x); }
  function run(uint x) internal {}
  // function phantom() {}
  string private txt = "fake()";
}
