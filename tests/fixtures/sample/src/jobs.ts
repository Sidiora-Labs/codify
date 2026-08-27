import { registerHandler } from "./hooks";

export function scheduleJob(name: string): string {
  return name.trim();
}

registerHandler("jobs");
