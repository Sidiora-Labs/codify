export async function fetchNotes(project: string): Promise<string[]> {
  const r = await fetch(`/api/${project}/notes`);
  return r.json();
}
