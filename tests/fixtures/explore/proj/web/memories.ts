import { fetchNotes } from "./api";

/** Download every memory as one JSON file the user can keep. */
export async function exportMemory(project: string): Promise<Blob> {
  const notes = await fetchNotes(project);
  return new Blob([JSON.stringify(notes)], { type: "application/json" });
}

export function renderBadge(count: number): string {
  return `${count} notes`;
}
