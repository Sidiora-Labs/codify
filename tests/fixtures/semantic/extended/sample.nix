let
  launch = x: run x;
  value = launch 1;
  # phantom = x: x;
  txt = "fake()";
  v16_edge_target = 1;
  v16_edge_caller = v16_edge_target;
  v16_edge_unrelated = 0; # v16_edge_target
in value
