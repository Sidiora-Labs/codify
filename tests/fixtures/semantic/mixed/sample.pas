unit Sample;
interface
uses SysUtils;
type TWorker = class
  procedure Run;
end;
implementation
procedure TWorker.Run;
begin
  WriteLn('ready');
end;
end.
