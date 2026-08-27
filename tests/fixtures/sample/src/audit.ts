import { trackChange } from "./hooks";

export function record(entry: string): string {
  return entry;
}

trackChange("audit");
