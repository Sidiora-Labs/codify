import { record } from "./metrics";

export function bumpGauge(): number {
  return record(2);
}
