import { record } from "./audit";

export function writeReport(): string {
  return record("r");
}
