let
  launch = x: run x;
  value = launch 1;
  # phantom = x: x;
  txt = "fake()";
in value
