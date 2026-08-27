import { record } from "../audit.js";

export function replayAudit(): string {
  return record("replay");
}
