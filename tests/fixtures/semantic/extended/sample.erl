-module(sample).
-record(state, {value}).
launch(X) -> run(X).
% phantom() -> ok.
str() -> "fake()".
